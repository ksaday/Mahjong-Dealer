// Bounded checkpoint retention for correction (docs/05_Game_Table_Architecture.md
// §8.3, D-05-06: "the last 10 public actions"). This is the actor's own
// history — `dealer-core` retains none of its own (it is pure, docs/03 §5).
//
// Keyed by the actor's own wire-facing `seq` (see `actor.ts`'s module
// comment for why that is a different number from `GameState.seq`), so a
// client's `rewindTo` — necessarily expressed in terms of `seq` values it
// has actually seen on the wire — resolves directly against this history.
import type { GameState } from "@mahjong-dealer/dealer-core";

export interface CheckpointEntry {
  readonly seq: number;
  readonly gameState: GameState;
}

export class CheckpointHistory {
  private entries: CheckpointEntry[] = [];

  constructor(private readonly capacity = 10) {}

  record(seq: number, gameState: GameState): void {
    this.entries.push({ seq, gameState });
    if (this.entries.length > this.capacity) {
      this.entries.shift();
    }
  }

  get oldestSeq(): number | null {
    return this.entries[0]?.seq ?? null;
  }

  at(seq: number): GameState | null {
    return this.entries.find((entry) => entry.seq === seq)?.gameState ?? null;
  }

  all(): readonly CheckpointEntry[] {
    return this.entries;
  }

  /** A new game starts a fresh window — the scope is the current game only (docs/05 §8.3). */
  clear(): void {
    this.entries = [];
  }
}
