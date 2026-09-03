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
// `checkpoints.receipts` (docs/17 §5.7: "Applied `cmdId` values |
// Operational") is a plaintext projection of `TableActor.acceptedCmdIds`,
// same "public projection alongside the encrypted blob" pattern
// `public-projection.ts` builds `public_state` with. The restore-critical
// copy — cmdId *and* the seq each one produced — lives inside the
// encrypted `private_state` envelope instead (`ActorSnapshot.receipts`),
// alongside everything else `snapshot()`/`fromRestoredParts` already
// round-trip; `readGameState` below returns it unchanged, same as `seq`/
// `gameStateBytes`/`gameId`. docs/17 §5.10's separate `command_receipts`
// table is superseded by this — see that section's own note, `D-17-20`.
//
// Correction-checkpoint durability (docs/17 §5.8, D-17-19) reuses this same
// class rather than a second injected one, since it shares the encryption
// key, the error-handling convention, and the purge lifecycle. Its private
// envelope is deliberately smaller than the primary checkpoint's: just
// `{ actorSeq, gameStateBytes }`, not a full `ActorSnapshot` — the
// correction window only ever needs to reconstruct a `GameState` keyed by
// the actor's own wire-seq (`table/checkpoints.ts`'s `CheckpointHistory`),
// never `table` or `gameId`, both of which the primary envelope carries for
// crash recovery's different purpose.
import { checkpoint as coreCheckpoint, type GameOutcome } from "@mahjong-dealer/dealer-core";
import type { GameOutcomeRow } from "@mahjong-dealer/db";
import { uuidv7 } from "@mahjong-dealer/db";
import type { Seat } from "@mahjong-dealer/shared";
import type { TableActor, ActorSnapshot } from "../table/actor.js";
import type { CheckpointEntry } from "../table/checkpoints.js";
import { CURRENT_KEY_VERSION, decryptCheckpoint, encryptCheckpoint } from "./checkpoint-encryption.js";
import { publicCheckpointSummary } from "./public-projection.js";
import type { CheckpointRepository } from "./repository.js";
import type { CorrectionCheckpointRepository } from "./correction-repository.js";
import type { GamesRepository } from "../tables/games-repository.js";

/** docs/17 §5.8 / `D-05-06` — the correction window's bound. Hardcoded rather than threaded from `TableActorOptions.correctionWindow`: only tests override that option today, and none combine a non-default window with a real `CheckpointWriter`. If that combination is ever needed, the DB-durable window and the in-memory window could silently disagree after a restart. */
const CORRECTION_CHECKPOINT_RETENTION = 10;

interface CorrectionCheckpointEnvelope {
  readonly actorSeq: number;
  readonly gameStateBytes: string;
}

export class CheckpointWriter {
  constructor(
    private readonly checkpoints: CheckpointRepository,
    private readonly games: GamesRepository,
    private readonly encryptionKey: Buffer,
    private readonly correctionCheckpoints: CorrectionCheckpointRepository,
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
      receipts: actor.acceptedCmdIds,
      keyVersion: CURRENT_KEY_VERSION,
    });
    await this.games.recordSeq(gameId, actor.gameStateSnapshot.seq);
  }

  /** docs/17 §7.3's purge steps, minus zeroing in-memory state — dealer-core's own `concluded` lifecycle and `TableActor.forceClose` already do that. Also satisfies docs/16 §5.5's "delete every correction-window checkpoint" step (`D-17-19`). */
  async purge(gameId: string): Promise<void> {
    await this.checkpoints.deleteForGame(gameId);
    await this.correctionCheckpoints.deleteForGame(gameId);
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
  async readGameState(gameId: string): Promise<Pick<ActorSnapshot, "seq" | "gameStateBytes" | "gameId" | "receipts"> | null> {
    const row = await this.checkpoints.readForRestore(gameId);
    if (row === null) return null;
    if (row.keyVersion !== CURRENT_KEY_VERSION) {
      throw new Error(`checkpoint for game ${gameId} was written under key version ${row.keyVersion}, no rotation path exists`);
    }
    const plaintext = decryptCheckpoint(row.privateState, this.encryptionKey);
    const snapshot = JSON.parse(plaintext.toString("utf8")) as ActorSnapshot;
    return { seq: snapshot.seq, gameStateBytes: snapshot.gameStateBytes, gameId: snapshot.gameId, receipts: snapshot.receipts };
  }

  /** Fire-and-forget — off the acknowledgement path (NFR-032, docs/16 §5.3), same as `writeAsync`. `entry` is `TableActor.latestCorrectionCheckpoint` — the caller (`TableGateway.syncCheckpoint`) is responsible for only calling this when that entry is actually new. */
  writeCorrectionCheckpointAsync(actor: TableActor, entry: CheckpointEntry): void {
    void this.flushCorrectionCheckpointSync(actor, entry).catch(this.onWriteError);
  }

  async flushCorrectionCheckpointSync(actor: TableActor, entry: CheckpointEntry): Promise<void> {
    const gameId = actor.currentGameId;
    if (gameId === null) return; // idle/concluded: nothing live to checkpoint

    const envelope: CorrectionCheckpointEnvelope = { actorSeq: entry.seq, gameStateBytes: coreCheckpoint(entry.gameState) };
    const plaintext = Buffer.from(JSON.stringify(envelope), "utf8");
    const privateState = encryptCheckpoint(plaintext, this.encryptionKey);
    const publicState = publicCheckpointSummary(entry.gameState);

    await this.correctionCheckpoints.record(
      { id: uuidv7(), gameId, seq: entry.gameState.seq, publicState, privateState, keyVersion: CURRENT_KEY_VERSION },
      CORRECTION_CHECKPOINT_RETENTION,
    );
  }

  /**
   * The correction-window equivalent of `readGameState`: up to
   * `CORRECTION_CHECKPOINT_RETENTION` rows, ascending by the actor's own
   * wire-seq, ready to replay straight into a fresh `CheckpointHistory` via
   * `TableActor.fromRestoredParts`'s `correctionHistory` parameter.
   *
   * Unlike `readGameState`, a single bad row does not fail the whole call:
   * the correction window is a convenience (whether a rewind is possible),
   * not correctness-critical the way the primary checkpoint's game state
   * is, and losing one entry degrades to exactly what happened before this
   * durability existed — an emptier window, never a wrong one (`D-21-05`'s
   * "a checkpoint failure does not interrupt play", extended to restore).
   */
  async readCorrectionHistory(gameId: string): Promise<readonly CorrectionCheckpointEnvelope[]> {
    const rows = await this.correctionCheckpoints.readForRestore(gameId, CORRECTION_CHECKPOINT_RETENTION);
    const entries: CorrectionCheckpointEnvelope[] = [];
    for (const row of rows) {
      try {
        if (row.keyVersion !== CURRENT_KEY_VERSION) {
          throw new Error(`correction checkpoint for game ${gameId} was written under key version ${row.keyVersion}, no rotation path exists`);
        }
        const plaintext = decryptCheckpoint(row.privateState, this.encryptionKey);
        entries.push(JSON.parse(plaintext.toString("utf8")) as CorrectionCheckpointEnvelope);
      } catch (error) {
        this.onWriteError(error);
      }
    }
    return entries;
  }
}

function toGameOutcomeRow(outcome: GameOutcome): { readonly outcome: GameOutcomeRow; readonly outcomeSeat: Seat | null } {
  if (outcome.kind === "declaration_accepted") {
    return { outcome: "declaration_accepted", outcomeSeat: outcome.declarer };
  }
  return { outcome: "ended_by_agreement", outcomeSeat: null };
}
