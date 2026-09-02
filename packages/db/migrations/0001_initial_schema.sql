-- Initial schema (docs/17_Database_Design.md). Eleven tables, in
-- dependency order. Forward-only (docs/17 §3): this migration, once
-- applied anywhere, is immutable — a correction is a new migration file,
-- never an edit to this one.
--
-- citext gives case-insensitive email/display-name comparisons without
-- application-side lower()-ing (docs/17 §3).
CREATE EXTENSION IF NOT EXISTS citext;

CREATE TYPE account_role AS ENUM ('player', 'administrator');
CREATE TYPE account_status AS ENUM ('active', 'disabled');
CREATE TYPE seat_position AS ENUM ('east', 'south', 'west', 'north');
CREATE TYPE table_status AS ENUM ('open', 'seated', 'abandoned', 'closed');
CREATE TYPE game_state AS ENUM ('idle', 'dealing', 'in_play', 'concluding', 'concluded');
-- 'abandoned' is a documented outcome (docs/09 §4's "unanimous abandonment"
-- transition) that no command in dealer-core's Phase 2 slice produces yet
-- (docs/10's catalog names no such command either) — the schema follows
-- the design document, not the current implementation's coverage of it.
CREATE TYPE game_outcome AS ENUM ('declaration_accepted', 'ended_by_agreement', 'abandoned');

-- 5.1 accounts
CREATE TABLE accounts (
  id uuid PRIMARY KEY,
  email citext NOT NULL UNIQUE,
  email_verified_at timestamptz,
  password_hash text NOT NULL,
  display_name citext NOT NULL,
  role account_role NOT NULL DEFAULT 'player',
  status account_status NOT NULL DEFAULT 'active',
  failed_logins integer NOT NULL DEFAULT 0,
  locked_until timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

-- 5.2 sessions
CREATE TABLE sessions (
  id uuid PRIMARY KEY,
  account_id uuid NOT NULL REFERENCES accounts (id) ON DELETE CASCADE,
  token_hash bytea NOT NULL,
  csrf_secret text NOT NULL,
  issued_at timestamptz NOT NULL DEFAULT now(),
  last_seen_at timestamptz NOT NULL DEFAULT now(),
  absolute_expires_at timestamptz NOT NULL,
  revoked_at timestamptz,
  ip text,
  user_agent text
);
CREATE UNIQUE INDEX sessions_token_hash_key ON sessions (token_hash);
CREATE INDEX sessions_active_by_account_idx ON sessions (account_id) WHERE revoked_at IS NULL;

-- 5.4 tables
CREATE TABLE tables (
  id uuid PRIMARY KEY,
  join_code_hash bytea NOT NULL,
  host_account_id uuid REFERENCES accounts (id) ON DELETE SET NULL,
  status table_status NOT NULL DEFAULT 'open',
  -- The process that owns this table; constant in v1 (D-03-08, D-17-08).
  -- Present now so the multi-node seam is a code change, not a migration
  -- on live data.
  owner_node text NOT NULL,
  deal_count_default smallint NOT NULL DEFAULT 13,
  deal_count_dealer smallint NOT NULL DEFAULT 14,
  created_at timestamptz NOT NULL DEFAULT now(),
  closed_at timestamptz
);
-- A join code is unique among live tables, and may be reused once a table
-- closes (docs/17 §5.4).
CREATE UNIQUE INDEX tables_join_code_hash_live_key ON tables (join_code_hash) WHERE status <> 'closed';

-- 5.5 table_seats
CREATE TABLE table_seats (
  id uuid PRIMARY KEY,
  table_id uuid NOT NULL REFERENCES tables (id) ON DELETE CASCADE,
  seat seat_position NOT NULL,
  account_id uuid REFERENCES accounts (id) ON DELETE SET NULL,
  is_ready boolean NOT NULL DEFAULT false,
  occupied_at timestamptz,
  UNIQUE (table_id, seat)
);
-- One seat per account, platform-wide (FR-024, D-17-02): prevents one
-- person occupying two seats and thereby seeing two hands, which would
-- falsify the four-player guarantee. A partial index because application
-- logic checking this would race.
CREATE UNIQUE INDEX table_seats_one_per_account_key ON table_seats (account_id) WHERE account_id IS NOT NULL;

-- 5.3 connect_tickets (after tables: the FK needs it to exist)
CREATE TABLE connect_tickets (
  id uuid PRIMARY KEY,
  ticket_hash bytea NOT NULL UNIQUE,
  account_id uuid NOT NULL REFERENCES accounts (id) ON DELETE CASCADE,
  session_id uuid NOT NULL REFERENCES sessions (id) ON DELETE CASCADE,
  table_id uuid NOT NULL REFERENCES tables (id) ON DELETE CASCADE,
  seat seat_position NOT NULL,
  expires_at timestamptz NOT NULL,
  redeemed_at timestamptz
);

-- 5.6 games
CREATE TABLE games (
  id uuid PRIMARY KEY,
  table_id uuid NOT NULL REFERENCES tables (id) ON DELETE CASCADE,
  state game_state NOT NULL DEFAULT 'idle',
  seq bigint NOT NULL DEFAULT 0,
  commitment bytea,
  outcome game_outcome,
  outcome_seat seat_position,
  started_at timestamptz,
  concluded_at timestamptz,
  purged_at timestamptz
);
-- At most one live game per table (docs/17 §5.6).
CREATE UNIQUE INDEX games_one_live_per_table_key ON games (table_id) WHERE state <> 'concluded';

-- 5.7 checkpoints — one row per game, overwritten in place.
CREATE TABLE checkpoints (
  game_id uuid PRIMARY KEY REFERENCES games (id) ON DELETE CASCADE,
  seq bigint NOT NULL,
  public_state jsonb NOT NULL,
  -- AES-256-GCM ciphertext, encrypted in the application (docs/17 §7.1).
  -- The plaintext never touches the database.
  private_state bytea NOT NULL,
  receipts jsonb NOT NULL DEFAULT '[]'::jsonb,
  key_version smallint NOT NULL,
  written_at timestamptz NOT NULL DEFAULT now()
);

-- 5.8 correction_checkpoints — retained for the correction window, not overwritten.
CREATE TABLE correction_checkpoints (
  id uuid PRIMARY KEY,
  game_id uuid NOT NULL REFERENCES games (id) ON DELETE CASCADE,
  seq bigint NOT NULL,
  public_state jsonb NOT NULL,
  private_state bytea NOT NULL,
  key_version smallint NOT NULL,
  written_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (game_id, seq)
);

-- 5.9 game_events — append-only public record.
CREATE TABLE game_events (
  id uuid PRIMARY KEY,
  game_id uuid NOT NULL REFERENCES games (id) ON DELETE CASCADE,
  seq bigint NOT NULL,
  type text NOT NULL,
  seat seat_position,
  -- Public content only (docs/16 §6.1): no tile face that was not already
  -- public at the moment the event occurred. Checked at review per event
  -- type, not enforced by this column's type.
  payload jsonb NOT NULL,
  occurred_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (game_id, seq)
);

-- 5.10 command_receipts — idempotency (docs/13 §4).
CREATE TABLE command_receipts (
  game_id uuid NOT NULL REFERENCES games (id) ON DELETE CASCADE,
  cmd_id uuid NOT NULL,
  seq bigint NOT NULL,
  applied_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (game_id, cmd_id)
);

-- 5.11 audit_log — authentication and administrative events only. No game
-- content, ever (docs/17 §5.11): an audit log recording gameplay would be
-- a permanent concealed-material store.
CREATE TABLE audit_log (
  id uuid PRIMARY KEY,
  actor_account_id uuid REFERENCES accounts (id) ON DELETE SET NULL,
  action text NOT NULL,
  target_type text,
  target_id uuid,
  -- Mandatory for administrative actions (FR-166) — an application-layer
  -- rule, since "administrative" isn't a property this column alone
  -- expresses.
  reason text,
  ip text,
  occurred_at timestamptz NOT NULL DEFAULT now()
);

-- Append-only enforcement (D-17-06): a record that can be rewritten is not
-- a record. One trigger function, reused on both append-only tables.
CREATE FUNCTION forbid_update_delete() RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION '% is append-only: % is not permitted', TG_TABLE_NAME, TG_OP;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER game_events_append_only
  BEFORE UPDATE OR DELETE ON game_events
  FOR EACH ROW EXECUTE FUNCTION forbid_update_delete();

CREATE TRIGGER audit_log_append_only
  BEFORE UPDATE OR DELETE ON audit_log
  FOR EACH ROW EXECUTE FUNCTION forbid_update_delete();
