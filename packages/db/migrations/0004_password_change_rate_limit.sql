-- Durable per-account rate limit for POST /accounts/me/password
-- (docs/15_Security_Architecture.md §7.1, docs/18_API_Design.md §6:
-- "3/hour, PostgreSQL") — the same discipline as the login lockout
-- columns already on this table (D-15-03: a control that vanishes on
-- restart is one an attacker waits out). A flat fixed window, not
-- progressive lockout: the endpoint's own limit is flat, unlike login's
-- escalating curve (docs/17 §5.1, §9 D-17-14).
ALTER TABLE accounts
  ADD COLUMN password_change_count integer NOT NULL DEFAULT 0,
  ADD COLUMN password_change_window_started_at timestamptz;
