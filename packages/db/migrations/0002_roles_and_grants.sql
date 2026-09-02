-- Roles and privileges (docs/17_Database_Design.md §7.2). Column-level
-- denial on `private_state` is the second barrier behind encryption
-- (D-17-03): a query written by mistake, or by an injection that reached
-- the general role, cannot return the column at all.
--
-- Roles are created idempotently — a role may already exist from a prior
-- environment bootstrap outside this migration's control.
DO $$
BEGIN
  IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'app') THEN
    CREATE ROLE app LOGIN;
  END IF;
  IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'app_readonly') THEN
    CREATE ROLE app_readonly LOGIN;
  END IF;
  IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'migrator') THEN
    CREATE ROLE migrator LOGIN;
  END IF;
END
$$;

GRANT USAGE ON SCHEMA public TO app, app_readonly;

-- app: SELECT/INSERT/UPDATE/DELETE on every table, except no SELECT at all
-- on either private_state column — obtained only through the dedicated
-- decryption path (docs/17 §7.2).
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO app;
REVOKE SELECT ON checkpoints, correction_checkpoints FROM app;
GRANT SELECT (game_id, seq, public_state, receipts, key_version, written_at) ON checkpoints TO app;
GRANT SELECT (id, game_id, seq, public_state, key_version, written_at) ON correction_checkpoints TO app;

-- app_readonly: operational inspection during an incident. SELECT on
-- fully-public tables; column-restricted where a table carries anything
-- secret or concealed. No grant at all on connect_tickets (its hash
-- follows the same "don't expose, even hashed" posture as a session's hash column).
GRANT SELECT ON tables, table_seats, games, game_events, command_receipts TO app_readonly;
GRANT SELECT (id, email, email_verified_at, display_name, role, status, created_at, updated_at)
  ON accounts TO app_readonly;
GRANT SELECT (id, account_id, issued_at, last_seen_at, absolute_expires_at, revoked_at, ip, user_agent)
  ON sessions TO app_readonly;
GRANT SELECT (game_id, seq, public_state, receipts, key_version, written_at) ON checkpoints TO app_readonly;
GRANT SELECT (id, game_id, seq, public_state, key_version, written_at)
  ON correction_checkpoints TO app_readonly;
GRANT SELECT (id, actor_account_id, action, target_type, target_id, reason, ip, occurred_at)
  ON audit_log TO app_readonly;

-- migrator: DDL only, used only by migrations (docs/17 §7.2).
GRANT CREATE ON SCHEMA public TO migrator;
