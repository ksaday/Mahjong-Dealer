// The TableHarness (docs/26_Test_Architecture.md §3): drives four seats
// against a real table actor, with no transport and no browser. This is
// the harness that makes complete games cheap to test — the mechanics
// test failing here should fail for a mechanical reason, not a framing or
// serialization one (docs/26 §3.2).
//
// Scope note: entropy is injected and reproducible (docs/26 §3), but the
// injected *clock* docs/26 §3.3 describes (`harness.advanceClock`) has no
// counterpart yet — the actor doesn't implement the correction/pass-round
// timeouts it would drive (docs/05 §8.3, docs/10 §6), since those are the
// table actor's own timers (Phase 5 territory: the gateway is what would
// actually schedule them). `crash`/`restart` are real, via `ActorSnapshot`.
import { type CommandName, type CommandParamsMap, SEAT_ORDER, type Seat } from "@mahjong-dealer/shared";
import type { Entropy, GameState } from "@mahjong-dealer/dealer-core";
import { TableActor, type ActorFrame, type ActorSnapshot } from "../table/actor.js";
import type { Table } from "../table/table.js";
import { createDeterministicEntropy } from "./deterministic-entropy.js";

export interface TableHarnessSeatHandle {
  send<N extends CommandName>(cmd: N, params: CommandParamsMap[N]): void;
}

export interface TableHarnessOptions {
  readonly seed: number;
  readonly correctionWindow?: number;
}

const DEFAULT_DISPLAY_NAMES: Readonly<Record<Seat, string>> = {
  east: "East Player",
  south: "South Player",
  west: "West Player",
  north: "North Player",
};

export class TableHarness {
  private actor: TableActor;
  private entropySeed: number;
  private crashedSnapshot: ActorSnapshot | null = null;

  private constructor(seed: number, correctionWindow: number | undefined) {
    this.entropySeed = seed;
    this.actor = new TableActor({
      id: "harness-table",
      entropy: this.entropy(),
      ...(correctionWindow !== undefined ? { correctionWindow } : {}),
    });
  }

  static create(options: TableHarnessOptions): TableHarness {
    return new TableHarness(options.seed, options.correctionWindow);
  }

  private entropy(): Entropy {
    return createDeterministicEntropy(this.entropySeed);
  }

  /** Occupies all four seats with predictable player ids, so tests can start from a seated table. */
  seatAll(displayNames: Readonly<Record<Seat, string>> = DEFAULT_DISPLAY_NAMES): void {
    for (const seat of SEAT_ORDER) {
      const result = this.actor.occupySeat(`player-${seat}`, displayNames[seat]);
      if (!result.ok) {
        throw new Error(`unreachable: seatAll() failed at ${seat}: ${result.code}`);
      }
    }
  }

  seat(seat: Seat): TableHarnessSeatHandle {
    return {
      send: (cmd, params) => {
        this.actor.submit(seat, cmd, params);
      },
    };
  }

  /** Every frame this seat has received, in order (docs/26 §3). */
  frames(seat: Seat): readonly ActorFrame[] {
    return this.actor.framesFor(seat);
  }

  /** Authoritative state, for assertions only (docs/26 §3.1) — distinguishes a projection bug from a state bug. */
  state(): GameState {
    return this.actor.gameStateSnapshot;
  }

  table(): Table {
    return this.actor.tableSnapshot;
  }

  seqNumber(): number {
    return this.actor.seqNumber;
  }

  currentGameId(): string | null {
    return this.actor.currentGameId;
  }

  /** For tests exercising `TableActor.fromRestoredParts` directly — the same bytes `crash()` captures, without going through `restart()`. */
  snapshotForTest(): ActorSnapshot {
    return this.actor.snapshot();
  }

  /** For tests that need the live actor itself — e.g. `CheckpointWriter`, which takes a `TableActor` directly. */
  actorForTest(): TableActor {
    return this.actor;
  }

  /** Administrative force-close (docs/18 §4.3) — not a wire command, so it bypasses `seat()`. */
  forceClose(reason: string): void {
    this.actor.forceClose(reason);
  }

  /** Snapshots the actor, as if the process died right after the last accepted command. */
  crash(): void {
    this.crashedSnapshot = this.actor.snapshot();
  }

  /**
   * Rebuilds the actor from the last `crash()` snapshot. Entropy resumes
   * from a fresh stream (a real process cannot resume mid-CSPRNG-output
   * either), and the correction checkpoint history starts empty — see
   * `ActorSnapshot`'s doc comment on `TableActor.snapshot`.
   */
  restart(): void {
    if (this.crashedSnapshot === null) {
      throw new Error("restart() called before crash()");
    }
    this.entropySeed += 1; // a genuinely different stream, not a replay
    this.actor = TableActor.fromSnapshot({ id: "harness-table", entropy: this.entropy() }, this.crashedSnapshot);
  }
}
