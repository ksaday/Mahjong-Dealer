// In-memory `CheckpointRepository` — what `writer.test.ts`, `gateway.test.ts`,
// and `manager.test.ts`'s restore tests actually exercise, the same role
// every other `memory-repository.ts` in this codebase plays.
import type { CheckpointForRestore, CheckpointRepository, NewCheckpointRow } from "./repository.js";

export class InMemoryCheckpointRepository implements CheckpointRepository {
  private readonly rows = new Map<string, NewCheckpointRow>();

  record(row: NewCheckpointRow): Promise<void> {
    this.rows.set(row.gameId, row);
    return Promise.resolve();
  }

  readForRestore(gameId: string): Promise<CheckpointForRestore | null> {
    const row = this.rows.get(gameId);
    return Promise.resolve(row === undefined ? null : { privateState: row.privateState, keyVersion: row.keyVersion });
  }

  deleteForGame(gameId: string): Promise<void> {
    this.rows.delete(gameId);
    return Promise.resolve();
  }

  /** Test-only inspection — asserts what would have been written, without a database. */
  peek(gameId: string): NewCheckpointRow | undefined {
    return this.rows.get(gameId);
  }
}
