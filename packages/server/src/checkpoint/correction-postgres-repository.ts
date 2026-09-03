// Postgres-backed `CorrectionCheckpointRepository`, written against
// packages/db/migrations/0001_initial_schema.sql's `correction_checkpoints`
// table and migration `0007`'s extension of `app_checkpoint_reader`. Not
// exercised against a live database in this environment — same scope note
// as every other `postgres-repository.ts` in this codebase.
//
// Two pools, deliberately, same split as `PostgresCheckpointRepository`:
// `writePool` (the app's normal role — `record`/`deleteForGame`, both
// already granted) and `readPool` (connected as `app_checkpoint_reader`) —
// used *only* inside `readForRestore`. Never widen `writePool`'s role to
// cover reads.
//
// `record` is insert-then-trim as two statements, not one transaction —
// no other repository in this codebase wraps its writes in an explicit
// transaction either. A crash between the two leaves at most one row
// beyond the retention count, which self-heals on the next write (the
// following `record` call's own trim deletes it).
import type { Pool } from "pg";
import type { CorrectionCheckpointRow } from "@mahjong-dealer/db";
import type {
  CorrectionCheckpointForRestore,
  CorrectionCheckpointRepository,
  NewCorrectionCheckpointRow,
} from "./correction-repository.js";

export class PostgresCorrectionCheckpointRepository implements CorrectionCheckpointRepository {
  constructor(
    private readonly writePool: Pool,
    private readonly readPool: Pool,
  ) {}

  async record(row: NewCorrectionCheckpointRow, retain: number): Promise<void> {
    await this.writePool.query(
      `INSERT INTO correction_checkpoints (id, game_id, seq, public_state, private_state, key_version)
       VALUES ($1, $2, $3, $4, $5, $6)
       ON CONFLICT (game_id, seq) DO NOTHING`,
      [row.id, row.gameId, row.seq, JSON.stringify(row.publicState), row.privateState, row.keyVersion],
    );
    await this.writePool.query(
      `DELETE FROM correction_checkpoints
       WHERE game_id = $1 AND seq NOT IN (
         SELECT seq FROM correction_checkpoints WHERE game_id = $1 ORDER BY seq DESC LIMIT $2
       )`,
      [row.gameId, retain],
    );
  }

  async readForRestore(gameId: string, limit: number): Promise<readonly CorrectionCheckpointForRestore[]> {
    const { rows } = await this.readPool.query<Pick<CorrectionCheckpointRow, "private_state" | "key_version">>(
      `SELECT private_state, key_version FROM (
         SELECT private_state, key_version, seq FROM correction_checkpoints
         WHERE game_id = $1 ORDER BY seq DESC LIMIT $2
       ) sub ORDER BY seq ASC`,
      [gameId, limit],
    );
    return rows.map((row) => ({ privateState: row.private_state, keyVersion: row.key_version }));
  }

  async deleteForGame(gameId: string): Promise<void> {
    await this.writePool.query(`DELETE FROM correction_checkpoints WHERE game_id = $1`, [gameId]);
  }
}
