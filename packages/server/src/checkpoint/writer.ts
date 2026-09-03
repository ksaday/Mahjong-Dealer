// Wires `TableActor.snapshot()`/`fromSnapshot()` (already built, deliberately
// crash-recovery-shaped — see `table/actor.ts`) to durable storage
// (docs/16_Data_Architecture.md §5, docs/29_Disaster_Recovery.md).
//
// `private_state` is the *entire* `ActorSnapshot` — `table`, the actor's
// own never-resetting `seq`, and dealer-core's `gameStateBytes` — encrypted
// as one JSON envelope, not a field-by-field split of `GameState`. This is
// deliberate: dealer-core's own `checkpoint()` output already mixes public
// and private fields in one blob, and re-deriving a faithful public/private
// split from it risks silently dropping a field a future dealer-core change
// adds. `public-projection.ts` builds the informational-only `public_state`
// column separately, from `GameState` directly, and restore never reads it.
//
// `checkpoints.receipts` is always written as `'[]'` (its schema default):
// `TableActor` never tracks accepted `cmdId`s at all (its own header
// comment: "an idempotency/gateway concern this actor doesn't yet see"),
// even though docs/13 §4 says `cmdId` retention belongs "in the actor and
// in the checkpoint." That is a separate, pre-existing gap this session
// does not close — durable cmdId dedup across a restart still doesn't
// exist (only the gateway's in-memory ack cache does).
import type { GameOutcome } from "@mahjong-dealer/dealer-core";
import type { GameOutcomeRow } from "@mahjong-dealer/db";
import type { Seat } from "@mahjong-dealer/shared";
import type { TableActor, ActorSnapshot } from "../table/actor.js";
import { CURRENT_KEY_VERSION, decryptCheckpoint, encryptCheckpoint } from "./checkpoint-encryption.js";
import { publicCheckpointSummary } from "./public-projection.js";
import type { CheckpointRepository } from "./repository.js";
import type { GamesRepository } from "../tables/games-repository.js";

export class CheckpointWriter {
  constructor(
    private readonly checkpoints: CheckpointRepository,
    private readonly games: GamesRepository,
    private readonly encryptionKey: Buffer,
    /** Errors are logged, never thrown from the async path (D-21-05: "a checkpoint failure does not interrupt play"). */
    private readonly onWriteError: (error: unknown) => void = (error) => console.error("checkpoint write failed", error),
  ) {}

  /** Fire-and-forget — off the acknowledgement path (NFR-032, docs/16 §5.3). */
  writeAsync(actor: TableActor): void {
    void this.flushSync(actor).catch(this.onWriteError);
  }

  /** Awaited — used only for the synchronous shutdown flush (D-21-11). */
  async flushSync(actor: TableActor): Promise<void> {
    const gameId = actor.currentGameId;
    if (gameId === null) return; // idle/concluded: nothing live to checkpoint

    const snapshot = actor.snapshot();
    const plaintext = Buffer.from(JSON.stringify(snapshot), "utf8");
    const privateState = encryptCheckpoint(plaintext, this.encryptionKey);
    const publicState = publicCheckpointSummary(actor.gameStateSnapshot);

    await this.checkpoints.record({
      gameId,
      seq: actor.gameStateSnapshot.seq,
      publicState,
      privateState,
      keyVersion: CURRENT_KEY_VERSION,
    });
    await this.games.recordSeq(gameId, actor.gameStateSnapshot.seq);
  }

  /** docs/17 §7.3's purge steps, minus zeroing in-memory state — dealer-core's own `concluded` lifecycle and `TableActor.forceClose` already do that. */
  async purge(gameId: string): Promise<void> {
    await this.checkpoints.deleteForGame(gameId);
    await this.games.markPurged(gameId);
  }

  async startGame(gameId: string, tableId: string): Promise<void> {
    await this.games.startGame({ id: gameId, tableId });
  }

  /**
   * Called once `TableGateway` observes `gameStateSnapshot.lifecycle ===
   * "concluded"` after a successful submit: records the outcome, purges the
   * checkpoint (docs/17 §7.3), and clears the actor's own `currentGameId`
   * so a later submit against the same concluded game can't re-purge.
   */
  async concludeAndPurge(actor: TableActor): Promise<void> {
    const gameId = actor.currentGameId;
    const state = actor.gameStateSnapshot;
    if (gameId === null || state.lifecycle !== "concluded") return;
    const { outcome, outcomeSeat } = toGameOutcomeRow(state.outcome);
    await this.games.markConcluded(gameId, outcome, outcomeSeat);
    await this.purge(gameId);
    actor.clearCurrentGameId();
  }

  /**
   * docs/16 §5.4's restore flowchart, decrypt half: returns the game-state
   * portion of the stored `ActorSnapshot` only, deliberately **not**
   * `snapshot.table` — seat occupancy/readiness/host can have changed since
   * this checkpoint was written (a join, a leave, a ready-toggle never
   * itself triggers a checkpoint), so `TableRepository`'s seat rows, not
   * this stale embedded copy, are the right source for `Table`
   * reconstruction. `TableManager.restoreLiveTables` composes the two.
   * `TableActor.fromRestoredParts` still runs dealer-core's `restore()` —
   * and so still enforces the conservation invariant — once it's called
   * with this game-state portion; refusing on failure happens there, not
   * here.
   */
  async readGameState(gameId: string): Promise<Pick<ActorSnapshot, "seq" | "gameStateBytes" | "gameId"> | null> {
    const row = await this.checkpoints.readForRestore(gameId);
    if (row === null) return null;
    if (row.keyVersion !== CURRENT_KEY_VERSION) {
      throw new Error(`checkpoint for game ${gameId} was written under key version ${row.keyVersion}, no rotation path exists`);
    }
    const plaintext = decryptCheckpoint(row.privateState, this.encryptionKey);
    const snapshot = JSON.parse(plaintext.toString("utf8")) as ActorSnapshot;
    return { seq: snapshot.seq, gameStateBytes: snapshot.gameStateBytes, gameId: snapshot.gameId };
  }
}

function toGameOutcomeRow(outcome: GameOutcome): { readonly outcome: GameOutcomeRow; readonly outcomeSeat: Seat | null } {
  if (outcome.kind === "declaration_accepted") {
    return { outcome: "declaration_accepted", outcomeSeat: outcome.declarer };
  }
  return { outcome: "ended_by_agreement", outcomeSeat: null };
}
