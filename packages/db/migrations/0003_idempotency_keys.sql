-- idempotency_keys (docs/17_Database_Design.md §5.12; docs/18_API_Design.md
-- §3, D-18-10): the `Idempotency-Key` replay cache for `POST /tables`.
--
-- `response_body` holding a plaintext `join_code` is a deliberate, narrow
-- exception to D-18-05/D-17-07 ("join code returned exactly once, stored
-- irreversibly"): a client that created a table but never received the
-- response has no other way to recover a code it already earned, and
-- D-18-10 exists specifically to serve that retry. The exception is
-- bounded by `expires_at`, not by convention — an expired row is invisible
-- to every lookup (`idempotency/postgres-repository.ts`), the same
-- lazy-expiry discipline `connect_tickets` already uses.
--
-- No `app_readonly` grant, below — same posture as `connect_tickets`
-- (0002_roles_and_grants.sql): a table holding a plaintext secret gets no
-- operational-inspection grant, even column-restricted.
CREATE TABLE idempotency_keys (
  account_id uuid NOT NULL REFERENCES accounts (id) ON DELETE CASCADE,
  endpoint text NOT NULL,
  key text NOT NULL,
  response_status smallint NOT NULL,
  response_body jsonb NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz NOT NULL,
  PRIMARY KEY (account_id, endpoint, key)
);

GRANT SELECT, INSERT ON idempotency_keys TO app;
