// In-memory `CorrectionCheckpointRepository` — what `writer.test.ts`,
// `gateway.checkpoint.test.ts`, and `manager.restore.test.ts`'s restore
// tests actually exercise, the same role `InMemoryCheckpointRepository`
// plays for the primary table.
import type {
  CorrectionCheckpointForRestore,
  CorrectionCheckpointRepository,
  NewCorrectionCheckpointRow,
} from "./correction-repository.js";

export class InMemoryCorrectionCheckpointRepository implements CorrectionCheckpointRepository {
  private readonly rowsByGame = new Map<string, NewCorrectionCheckpointRow[]>();

  record(row: NewCorrectionCheckpointRow, retain: number): Promise<void> {
    const rows = this.rowsByGame.get(row.gameId) ?? [];
    if (!rows.some((existing) => existing.seq === row.seq)) {
      rows.push(row);
      rows.sort((a, b) => a.seq - b.seq);
    }
    const trimmed = rows.length > retain ? rows.slice(rows.length - retain) : rows;
    this.rowsByGame.set(row.gameId, trimmed);
    return Promise.resolve();
  }

  readForRestore(gameId: string, limit: number): Promise<readonly CorrectionCheckpointForRestore[]> {
    const rows = this.rowsByGame.get(gameId) ?? [];
    const windowed = rows.length > limit ? rows.slice(rows.length - limit) : rows;
    return Promise.resolve(windowed.map((row) => ({ privateState: row.privateState, keyVersion: row.keyVersion })));
  }

  deleteForGame(gameId: string): Promise<void> {
    this.rowsByGame.delete(gameId);
    return Promise.resolve();
  }

  /** Test-only inspection — asserts what would have been written, without a database. */
  peek(gameId: string): readonly NewCorrectionCheckpointRow[] {
    return this.rowsByGame.get(gameId) ?? [];
  }
}
