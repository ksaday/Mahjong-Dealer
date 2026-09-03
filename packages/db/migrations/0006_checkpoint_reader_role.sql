-- The checkpoint-restore role (docs/17_Database_Design.md §7.2, D-17-18;
-- docs/29_Disaster_Recovery.md; ADR-0010).
--
-- 0002_roles_and_grants.sql already revokes SELECT on checkpoints.
-- private_state (and correction_checkpoints.private_state) from `app`
-- entirely, "obtained through a dedicated decryption path" being the
-- stated design rather than an oversight. Until now nothing used that
-- path, since no checkpoint-persistence subsystem existed. This role is
-- that path: SELECT-only, on exactly the columns crash-recovery restore
-- needs, on exactly one table. It gets no other grant — not INSERT,
-- UPDATE, or DELETE anywhere, and nothing at all on correction_checkpoints
-- (durability for that table remains deferred, docs/29 session notes).
--
-- Rotating this role's credentials never touches app's, and vice versa —
-- the same "distinct secret, independent rotation" property D-17-15
-- already gives the checkpoint encryption key relative to the TOTP key.
DO $$
BEGIN
  IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'app_checkpoint_reader') THEN
    CREATE ROLE app_checkpoint_reader LOGIN;
  END IF;
END
$$;

GRANT USAGE ON SCHEMA public TO app_checkpoint_reader;
GRANT SELECT (game_id, private_state, key_version) ON checkpoints TO app_checkpoint_reader;
