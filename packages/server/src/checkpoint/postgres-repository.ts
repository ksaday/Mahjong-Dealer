// Postgres-backed `CheckpointRepository`, written against
// packages/db/migrations/0001_initial_schema.sql's `checkpoints` table and
// migration `0006`'s `app_checkpoint_reader` role. Not exercised against a
// live database in this environment — same scope note as every other
// `postgres-repository.ts` in this codebase.
//
// Two pools, deliberately: `writePool` (the app's normal role — `record`/
// `deleteForGame`, both already granted) and `readPool` (connected as
// `app_checkpoint_reader`, the only role granted SELECT on `private_state`
// at all) — used *only* inside `readForRestore`. Never widen `writePool`'s
// role to cover reads; that would defeat the column-level denial docs/17
// §7.2 relies on as a second barrier behind encryption.
import type { Pool } from "pg";
import type { CheckpointRow } from "@mahjong-dealer/db";
import type { CheckpointForRestore, CheckpointRepository, NewCheckpointRow } from "./repository.js";

export class PostgresCheckpointRepository implements CheckpointRepository {
  constructor(
    private readonly writePool: Pool,
    private readonly readPool: Pool,
  ) {}

  async record(row: NewCheckpointRow): Promise<void> {
    await this.writePool.query(
      `INSERT INTO checkpoints (game_id, seq, public_state, private_state, receipts, key_version)
       VALUES ($1, $2, $3, $4, $5, $6)
       ON CONFLICT (game_id) DO UPDATE SET
         seq = EXCLUDED.seq,
         public_state = EXCLUDED.public_state,
         private_state = EXCLUDED.private_state,
         receipts = EXCLUDED.receipts,
         key_version = EXCLUDED.key_version,
         written_at = now()`,
      [row.gameId, row.seq, JSON.stringify(row.publicState), row.privateState, JSON.stringify(row.receipts), row.keyVersion],
    );
  }

  async readForRestore(gameId: string): Promise<CheckpointForRestore | null> {
    const { rows } = await this.readPool.query<Pick<CheckpointRow, "private_state" | "key_version">>(
      `SELECT private_state, key_version FROM checkpoints WHERE game_id = $1`,
      [gameId],
    );
    const row = rows[0];
    return row === undefined ? null : { privateState: row.private_state, keyVersion: row.key_version };
  }

  async deleteForGame(gameId: string): Promise<void> {
    await this.writePool.query(`DELETE FROM checkpoints WHERE game_id = $1`, [gameId]);
  }
}
