-- Extends app_checkpoint_reader (migration 0006, D-17-18) to
-- correction_checkpoints (docs/17_Database_Design.md §7.2, D-17-19) — the
-- deferred follow-on 0006's own header comment named. Same role, same
-- "distinct secret, independent rotation" property (D-17-15's reasoning):
-- widening one role's grant to a second table of the same data class is
-- not the same risk as widening app's own grant, since this role already
-- has no write access anywhere and app still cannot read either
-- private_state column at all.
GRANT SELECT (game_id, seq, private_state, key_version) ON correction_checkpoints TO app_checkpoint_reader;
