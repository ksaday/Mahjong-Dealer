// Data-access interface for `correction_checkpoints` (docs/17_Database_Design.md
// §5.8, docs/16_Data_Architecture.md §5, ADR-0016, D-17-19). Same shape and
// same "not a second source of truth" caveat as `repository.ts`'s own
// header comment — `TableActor`'s in-memory `CheckpointHistory` remains
// authoritative for a live table; this exists for crash recovery of the
// correction window specifically.
//
// `readForRestore` is the "dedicated decryption path" for this table too
// (docs/17 §7.2, migration `0007`) — backed by the same `app_checkpoint_reader`
// role `CheckpointRepository.readForRestore` uses, never the general `app`
// role, which has no SELECT on `private_state` here either.
export interface NewCorrectionCheckpointRow {
  readonly id: string;
  readonly gameId: string;
  /** `GameState.seq` at write time — same "informational/indexable, distinct from the actor's own never-resetting seq" split `writer.ts` documents for the primary `checkpoints.seq`. */
  readonly seq: number;
  readonly publicState: unknown;
  /** Already AES-256-GCM ciphertext (`checkpoint-encryption.ts`) — this repository never encrypts or decrypts. */
  readonly privateState: Buffer;
  readonly keyVersion: number;
}

export interface CorrectionCheckpointForRestore {
  readonly privateState: Buffer;
  readonly keyVersion: number;
}

export interface CorrectionCheckpointRepository {
  /**
   * Idempotent insert — `ON CONFLICT (game_id, seq) DO NOTHING` semantics,
   * a duplicate write for a seq already recorded is a no-op, not an error
   * — followed by trimming to the newest `retain` rows for this game
   * (docs/17 §5.8: "rows beyond the last ten public actions are deleted as
   * new ones are written", `D-17-11`: bounded by construction, not a
   * scheduled job).
   */
  record(row: NewCorrectionCheckpointRow, retain: number): Promise<void>;
  /** Up to `limit` rows for restore, ascending by `seq` (oldest first) — the order `CheckpointHistory.record`'s push/shift ring buffer expects to reconstruct the original window. */
  readForRestore(gameId: string, limit: number): Promise<readonly CorrectionCheckpointForRestore[]>;
  /** docs/16 §5.5's "delete every correction-window checkpoint" purge step. Hard delete, not a soft flag. */
  deleteForGame(gameId: string): Promise<void>;
}
