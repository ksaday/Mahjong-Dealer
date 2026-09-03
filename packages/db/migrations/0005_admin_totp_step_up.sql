-- Administrator TOTP step-up (docs/15_Security_Architecture.md §8.1/§8.2,
-- docs/17_Database_Design.md §5.1/§5.2/§7, ADR-0017).
--
-- accounts.totp_secret is application-layer AES-256-GCM ciphertext
-- (docs/17 §7.1), keyed separately from the checkpoint encryption key
-- (D-17-15) — not column-denied from `app` the way `private_state` is,
-- since it's decrypted on the normal POST /sessions/mfa path, not through
-- a narrow occasional one (D-17-15). mfa_failed_attempts/mfa_locked_until
-- are a separate durable counter from failed_logins/locked_until
-- (D-17-16): a wrong TOTP code and a wrong password are different
-- failures. sessions.mfa_verified_at is per-session, not per-account
-- (D-17-17): a new login starts unverified again.
ALTER TABLE accounts
  ADD COLUMN totp_secret bytea,
  ADD COLUMN totp_secret_key_version integer,
  ADD COLUMN totp_enrolled_at timestamptz,
  ADD COLUMN totp_last_used_step bigint,
  ADD COLUMN mfa_failed_attempts integer NOT NULL DEFAULT 0,
  ADD COLUMN mfa_locked_until timestamptz;

ALTER TABLE sessions
  ADD COLUMN mfa_verified_at timestamptz;

-- app_readonly already has table-scoped-but-column-restricted SELECT on
-- both tables from 0002_roles_and_grants.sql; mfa_verified_at joins that
-- grant since it carries no secret (docs/17 §7.2). The totp_* and
-- mfa_failed_attempts/mfa_locked_until columns deliberately do not: the
-- same posture failed_logins/locked_until and password_hash/token_hash
-- already have.
GRANT SELECT (mfa_verified_at) ON sessions TO app_readonly;
