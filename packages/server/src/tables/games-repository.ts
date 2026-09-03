// Data-access interface for `games` rows (docs/17_Database_Design.md §5.6).
// A prerequisite this repository fills for the first time: `checkpoints.
// game_id` FKs to `games.id`, but until checkpoint durability
// (docs/29_Disaster_Recovery.md) needed a row to attach to, nothing ever
// wrote one — `games.purged_at` existed in the schema since migration
// `0001` entirely unused.
//
// Scoped narrowly to what checkpoint durability needs: minting a row per
// deal (`start_deal`, docs/09), recording its conclusion, and marking the
// purge docs/17 §7.3 requires. It is not a general `games` CRUD surface —
// there is no `list`/`findById` here because nothing yet needs one.
import type { GameOutcomeRow, GameRow } from "@mahjong-dealer/db";
import type { Seat } from "@mahjong-dealer/shared";

export interface NewGameRow {
  readonly id: string;
  readonly tableId: string;
}

export interface GamesRepository {
  /** One row per deal (docs/05 §8.2's "a new game starts a fresh window" boundary) — `state: 'in_play'`, `started_at: now`. */
  startGame(row: NewGameRow): Promise<void>;
  /** `games.seq`, docs/17 §5.6: "last durable authoritative sequence" — kept current alongside every `checkpoints` write (`CheckpointWriter.flushSync`), not just at start/conclusion. */
  recordSeq(gameId: string, seq: number): Promise<void>;
  markConcluded(gameId: string, outcome: GameOutcomeRow, outcomeSeat: Seat | null): Promise<void>;
  /** docs/17 §7.3's third purge step. */
  markPurged(gameId: string): Promise<void>;
  /** The most recent game for a table, purged or not — the lookup crash-recovery restore needs to find a checkpoint to try. */
  findLatestForTable(tableId: string): Promise<GameRow | null>;
}
