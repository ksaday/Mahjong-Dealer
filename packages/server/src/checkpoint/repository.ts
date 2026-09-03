// Data-access interface for `checkpoints` (docs/17_Database_Design.md §5.7,
// docs/16_Data_Architecture.md §5, ADR-0010). `TableActor`/`TableGateway`
// remain the authoritative in-memory state, exactly as `tables/repository.ts`
// is a mirror of `Table` — this exists for crash recovery, not as a second
// source of truth for a live table.
//
// `readForRestore` is deliberately the *only* method that can see
// `private_state` plaintext-adjacent bytes: it is the "dedicated decryption
// path" docs/17 §7.2 requires, backed by a distinct, narrowly-granted DB
// role (`app_checkpoint_reader`, migration `0006`) rather than the app's
// general role, which has no SELECT on that column at all.
export interface NewCheckpointRow {
  readonly gameId: string;
  /** `GameState.seq` at write time — informational/indexable, distinct from the actor's own never-resetting seq, which travels inside the encrypted envelope (see `writer.ts`). */
  readonly seq: number;
  readonly publicState: unknown;
  /** Already AES-256-GCM ciphertext (`checkpoint-encryption.ts`) — this repository never encrypts or decrypts. */
  readonly privateState: Buffer;
  readonly keyVersion: number;
}

export interface CheckpointForRestore {
  readonly privateState: Buffer;
  readonly keyVersion: number;
}

export interface CheckpointRepository {
  /** Upsert — `checkpoints` is one row per game, overwritten in place (docs/17 §5.7). */
  record(row: NewCheckpointRow): Promise<void>;
  readForRestore(gameId: string): Promise<CheckpointForRestore | null>;
  /** docs/17 §7.3's first purge step. Hard delete, not a soft flag (docs/16 §5.5). */
  deleteForGame(gameId: string): Promise<void>;
}
