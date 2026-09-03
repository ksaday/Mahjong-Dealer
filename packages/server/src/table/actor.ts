// The table actor (docs/05_Game_Table_Architecture.md §6; docs/03
// §6.1): one serialized command queue plus one authoritative state per
// table. `submit` is a synchronous method — Node's single-threaded,
// run-to-completion event loop is what gives "one writer, no locks" for
// free (docs/03 §6.1, §11); an explicit queue data structure would only
// be needed if command handling itself awaited I/O mid-mutation, which it
// does not (checkpointing and the public event log are explicitly *off*
// this path — docs/05 §6.1, NFR-032).
//
// Sequencing note: this actor keeps its own `seq`, separate from
// `GameState.seq`. `GameState.seq` is scoped to one game and restarts at
// 1 on every `start_deal` (see dealer-core's `dealOpeningHands`); the wire
// `seq` must never reset for the life of a table (docs/33_API §6, docs/19
// §3.2). Every accepted command — table-level or game-level — advances
// this actor's `seq` by exactly one, and `CheckpointHistory` is keyed by
// it, not by `GameState.seq`. Where a dealer-core command needs a seq
// value (`propose_correction`'s `rewindTo`/`oldestAvailableSeq`), this
// actor translates: it resolves the client's actor-seq against its own
// `CheckpointHistory` to find the matching `GameState`, and passes that
// state's *own* internal seq to dealer-core, whose validation is entirely
// self-contained within one game. The reverse translation happens when
// relaying `CorrectionProposed`/`CorrectionApplied` back onto the wire.
//
// Scope note: `bind`/`resume`/`ping` (gateway, docs/12, Phase 5) are not
// commands this actor accepts — a caller submitting one is a host wiring
// defect. `ack`/`reject` frames are not built here — the gateway still owns
// the wire envelope (docs/33_API §3), since this actor has no concept of
// one. What this actor *does* track durably is `cmdId` idempotency itself
// (docs/13 §4, ADR-0009): `submit`'s optional `cmdId` is checked against
// `CommandReceipts` before dispatch, and a repeat returns the original
// `seq` without re-applying — the gateway's own in-memory frame cache
// (`TableGateway`'s `receipts` map) still owns the fast, same-process path
// and exact-frame replay including rejections; this actor's own tracking
// is the durable backstop that survives a restart, per `receipts.ts`.
import { randomUUID } from "node:crypto";
import {
  apply,
  checkpoint as coreCheckpoint,
  createIdleState,
  restore as coreRestore,
  type Command as CoreCommand,
  type DealerEvent,
  type Entropy,
  type GameState,
} from "@mahjong-dealer/dealer-core";
import {
  SEAT_ORDER,
  type CommandName,
  type CommandParamsMap,
  type RejectionCode,
  type Seat,
  type TableEvent,
  type WireSeatView,
} from "@mahjong-dealer/shared";
import { CheckpointHistory, type CheckpointEntry } from "./checkpoints.js";
import { CommandReceipts } from "./receipts.js";
import {
  allReady,
  closeTable,
  createTable,
  occupySeat as occupyTableSeat,
  setReady,
  vacateSeat as vacateTableSeat,
  type Table,
  type TableRejection,
} from "./table.js";
import { toWireEvent } from "./events.js";
import { projectTableView } from "./view.js";

export type ActorFrame =
  | { readonly kind: "event"; readonly seq: number; readonly ev: TableEvent; readonly view: WireSeatView }
  | { readonly kind: "reject"; readonly code: RejectionCode; readonly view?: WireSeatView };

export interface TableActorOptions {
  readonly id: string;
  readonly entropy: Entropy;
  readonly correctionWindow?: number;
}

export type SubmitOutcome = { readonly ok: true; readonly seq: number } | { readonly ok: false; readonly code: RejectionCode };

export interface ActorSnapshot {
  readonly table: Table;
  readonly seq: number;
  readonly gameStateBytes: string;
  /** The current game's durable row id (`games.id`), or `null` when idle/concluded — see `TableActor.currentGameId`. */
  readonly gameId: string | null;
  /** Durable `cmdId` idempotency (docs/13 §4, ADR-0009, `receipts.ts`) — cmdId/seq pairs, since a `Map` isn't JSON-serializable. */
  readonly receipts: readonly (readonly [string, number])[];
}

/**
 * `core` events come from dealer-core and still need `toWireEvent`
 * (per-viewer OWN fields, face lookups). `wire` events are already
 * wire-shaped — used by the three table-level commands dealer-core
 * doesn't implement (`SeatReady`/`SeatUnready`/`TableClosed`), none of
 * which carry anything OWN or concealed, so there is nothing to translate.
 */
type EventSource = { readonly kind: "core"; readonly event: DealerEvent } | { readonly kind: "wire"; readonly event: TableEvent };

interface DispatchOk {
  readonly ok: true;
  readonly state: GameState;
  readonly events: readonly EventSource[];
  readonly recordCheckpoint: boolean;
  readonly clearCheckpoints: boolean;
  /** The actor-seq to substitute into a CorrectionProposed/CorrectionApplied event's seq field, if either appears. */
  readonly correctionSeqOverride?: number;
}
interface DispatchRejection {
  readonly ok: false;
  readonly code: RejectionCode;
}
type DispatchResult = DispatchOk | DispatchRejection;

const BACKLOG_DEPTH = 200;

function wrapCore(events: readonly DealerEvent[]): readonly EventSource[] {
  return events.map((event) => ({ kind: "core" as const, event }));
}

function isGameInProgress(state: GameState): boolean {
  return state.lifecycle !== "idle" && state.lifecycle !== "concluded";
}

export class TableActor {
  private table: Table;
  private gameState: GameState;
  private seq = 0;
  /** The current game's durable row id (`games.id`, docs/17 §5.6) — minted fresh at each `start_deal`, cleared on force-close or once purged after conclusion (docs/16 §5.5). `null` means "nothing to checkpoint." */
  private gameId: string | null = null;
  private readonly checkpoints: CheckpointHistory;
  private readonly commandReceipts: CommandReceipts;
  private readonly frameLog: Record<Seat, ActorFrame[]>;

  constructor(private readonly options: TableActorOptions) {
    this.table = createTable(options.id);
    this.gameState = createIdleState();
    this.checkpoints = new CheckpointHistory(options.correctionWindow ?? 10);
    this.commandReceipts = new CommandReceipts();
    this.frameLog = {} as Record<Seat, ActorFrame[]>;
    for (const seat of SEAT_ORDER) {
      this.frameLog[seat] = [];
    }
  }

  get tableSnapshot(): Table {
    return this.table;
  }

  get gameStateSnapshot(): GameState {
    return this.gameState;
  }

  get seqNumber(): number {
    return this.seq;
  }

  get currentGameId(): string | null {
    return this.gameId;
  }

  /** The most recently recorded correction-window entry, if any — lets `TableGateway.syncCheckpoint` tell whether the just-accepted command actually added a new correction-checkpoint row (by comparing its `seq` to the submit outcome's) versus reusing a stale earlier one, without `CheckpointHistory` needing any new mutation surface. */
  get latestCorrectionCheckpoint(): CheckpointEntry | null {
    const entries = this.checkpoints.all();
    return entries.length === 0 ? null : entries[entries.length - 1]!;
  }

  /** Every `cmdId` durably applied in the current game — for `checkpoints.receipts`, the plaintext operational projection (docs/17 §5.7). Restore never reads this back; `ActorSnapshot.receipts` (cmdId + seq) is the restore-critical copy. */
  get acceptedCmdIds(): readonly string[] {
    return this.commandReceipts.keys();
  }

  /** Called once a caller has durably purged this game's checkpoint (`CheckpointWriter.purge`) after a natural conclusion — guards against re-purging on a later submit against the same concluded game. */
  clearCurrentGameId(): void {
    this.gameId = null;
  }

  framesFor(seat: Seat): readonly ActorFrame[] {
    return this.frameLog[seat];
  }

  viewFor(seat: Seat): WireSeatView {
    return projectTableView(this.table, this.gameState, seat, this.seq);
  }

  /** Not a wire command — table setup (docs/05 §5) ahead of the REST/ticket flow this slice doesn't build. */
  occupySeat(playerId: string, displayName: string): { readonly ok: true; readonly seat: Seat } | TableRejection {
    const result = occupyTableSeat(this.table, playerId, displayName);
    if (!result.ok) return result;
    this.table = result.table;
    return { ok: true, seat: result.seat };
  }

  vacateSeat(seat: Seat): { readonly ok: true } | TableRejection {
    const result = vacateTableSeat(this.table, seat, isGameInProgress(this.gameState));
    if (!result.ok) return result;
    this.table = result.table;
    return { ok: true };
  }

  /**
   * Administrative force-close (docs/18 §4.3 `POST /admin/tables/{id}/
   * force-close`, `FR-161`) — not a wire command and not `dispatchCloseTable`
   * reused, because an administrator has no seat and this must work
   * regardless of game phase, unlike a host's own `close_table` (`M-4`:
   * `IDLE`/`SEATED` only). Purges concealed material by discarding
   * `gameState` outright — a fresh `IDLE` state carries none — rather than
   * running it through `CONCLUDED` first, since a forced close is
   * definitionally not a conclusion the players reached (`NR-013`).
   */
  forceClose(reason: string): void {
    this.table = closeTable(this.table);
    this.gameState = createIdleState();
    this.checkpoints.clear();
    // Bypasses submit()/dispatch() entirely, so the clearCheckpoints branch
    // never runs for this path — clear commandReceipts here too, same
    // "for the life of the game" scope docs/13 §4 gives it.
    this.commandReceipts.clear();
    this.gameId = null;
    this.seq += 1;
    const event: TableEvent = { type: "TableClosed", reason };
    for (const viewer of SEAT_ORDER) {
      this.pushFrame(viewer, { kind: "event", seq: this.seq, ev: event, view: this.viewFor(viewer) });
    }
  }

  /** Crash-recovery/correction primitive (DD-29, DD-30): bytes from `coreCheckpoint`. */
  checkpointBytes(): string {
    return coreCheckpoint(this.gameState);
  }

  restoreFromBytes(bytes: string): void {
    this.gameState = coreRestore(bytes);
  }

  /**
   * A full actor snapshot for crash recovery (docs/29_Disaster_Recovery.md).
   * Deliberately excludes the correction checkpoint history from *this*
   * snapshot shape specifically: `snapshot()`/`fromSnapshot()` back
   * `TableHarness.crash()/restart()` only (an in-memory test double), not
   * the real process-restart path. Real correction-window durability goes
   * through a separate table (`correction_checkpoints`, `D-17-19`) and a
   * separate restore path — `fromRestoredParts`'s `correctionHistory`
   * parameter below, fed by `CheckpointWriter.readCorrectionHistory`.
   */
  snapshot(): ActorSnapshot {
    return {
      table: this.table,
      seq: this.seq,
      gameStateBytes: this.checkpointBytes(),
      gameId: this.gameId,
      receipts: this.commandReceipts.entries(),
    };
  }

  static fromSnapshot(options: TableActorOptions, snapshot: ActorSnapshot): TableActor {
    const actor = new TableActor(options);
    actor.table = snapshot.table;
    actor.seq = snapshot.seq;
    actor.gameState = coreRestore(snapshot.gameStateBytes);
    actor.gameId = snapshot.gameId;
    for (const [cmdId, seq] of snapshot.receipts) {
      actor.commandReceipts.record(cmdId, seq);
    }
    return actor;
  }

  /**
   * Process-restart recovery (docs/29_Disaster_Recovery.md,
   * `TableManager.restoreLiveTables`): composes a fresh `table` — built by
   * the caller from `TableRepository`'s durable seat rows, since seat
   * occupancy can have changed since the last checkpoint was written — with
   * the game-state portion of a checkpoint, if one exists. Deliberately
   * distinct from `fromSnapshot`, which trusts `snapshot.table` wholesale;
   * that shape only suits a caller that knows its snapshot's `table` is
   * still current (there is no such caller yet).
   *
   * `correctionHistory` (docs/17 §5.8, `D-17-19`) replays durable
   * correction-window entries back into a fresh `CheckpointHistory`, oldest
   * first — the order `CheckpointWriter.readCorrectionHistory` already
   * returns them in, matching `CheckpointHistory.record`'s own push/shift
   * ring-buffer order. Empty by default: a table with no game, or whose
   * correction window couldn't be read, restores exactly as it did before
   * this durability existed — an empty window, not a failure.
   *
   * `game.receipts` (docs/13 §4, ADR-0009) replays durable `cmdId`
   * idempotency the same way — a retried command whose `cmdId` was
   * recorded before a crash still returns its original `seq` after
   * restart, without being re-applied.
   */
  static fromRestoredParts(
    options: TableActorOptions,
    table: Table,
    game: {
      readonly seq: number;
      readonly gameStateBytes: string;
      readonly gameId: string | null;
      readonly receipts: readonly (readonly [string, number])[];
    } | null,
    correctionHistory: readonly { readonly actorSeq: number; readonly gameStateBytes: string }[] = [],
  ): TableActor {
    const actor = new TableActor(options);
    actor.table = table;
    if (game !== null) {
      actor.seq = game.seq;
      actor.gameState = coreRestore(game.gameStateBytes);
      actor.gameId = game.gameId;
      for (const [cmdId, seq] of game.receipts) {
        actor.commandReceipts.record(cmdId, seq);
      }
    }
    for (const entry of correctionHistory) {
      actor.checkpoints.record(entry.actorSeq, coreRestore(entry.gameStateBytes));
    }
    return actor;
  }

  /**
   * Returns a summary (success + resulting seq, or the rejection code) so
   * the gateway (docs/12, docs/13 §4) can build a wire `ack`/`reject`
   * frame carrying the client's `cmdId` — which this actor, having no
   * concept of the wire envelope, does not itself produce. The resulting
   * `event`/`reject` frames for every seat are still available via
   * `framesFor`, as before.
   *
   * `options.pauseReason` is not a wire parameter — `request_pause`
   * carries none (docs/19 `request_pause | — | — | TablePaused`) — it is
   * this actor's own out-of-band context for `gateway.ts`'s
   * `autoPauseOnAbsence`, which is the one caller with presence knowledge
   * dealer-core deliberately doesn't have (`state.ts`'s module comment). A
   * genuine client `request_pause` frame never carries one, so
   * `toWireEvent`'s own default (`"requested"`, `table/events.ts`) is what
   * every player-initiated pause still gets; only this actor overrides it,
   * the same "override the event after the fact" shape `applyOverrides`
   * already uses for `CorrectionProposed`/`CorrectionApplied`/
   * `ReshuffleCommitmentPublished`'s own seq fields.
   *
   * `options.cmdId` (docs/13 §4, ADR-0009), when given, is checked against
   * `CommandReceipts` *before* dispatch: a `cmdId` already recorded
   * returns its original `seq` immediately, with no re-validation,
   * re-application, or new frames — durable across a restart via
   * `ActorSnapshot.receipts`. Not every caller has one: system-initiated
   * submits (`gateway.ts`'s `autoPauseOnAbsence`/`autoResumeOnReturn`)
   * carry no client `cmdId` at all and always dispatch normally.
   *
   * `CommandReceipts` is cleared per game, same points `CheckpointHistory`
   * is (below) — "for the life of the game" (docs/13 §4), matching a
   * checkpoint's own "complete, self-sufficient state" scope (docs/16
   * §5.2). One narrow, non-exploitable consequence, flagged rather than
   * hidden: the check runs *before* dispatch, so if a client reused
   * `start_deal`'s own `cmdId` for a later game's `start_deal` (never a
   * legitimate case — a real client mints a fresh `cmdId` per intent, and
   * "start a new game" is always a new intent), the clear that reuse would
   * have triggered never runs, and the stale prior-game `seq` keeps being
   * returned. No double-application results either way — worst case is a
   * confusing `seq` for a cmdId no well-behaved client would ever resend.
   */
  submit<N extends CommandName>(
    seat: Seat,
    cmd: N,
    params: CommandParamsMap[N],
    options?: { readonly pauseReason?: "seat_absent"; readonly cmdId?: string },
  ): SubmitOutcome {
    const cmdId = options?.cmdId;
    if (cmdId !== undefined) {
      const existingSeq = this.commandReceipts.get(cmdId);
      if (existingSeq !== undefined) {
        return { ok: true, seq: existingSeq };
      }
    }

    const result = this.dispatch(seat, cmd, params);

    if (!result.ok) {
      this.pushFrame(seat, { kind: "reject", code: result.code, view: this.viewFor(seat) });
      return { ok: false, code: result.code };
    }

    this.seq += 1;
    const previousLifecycle: GameState["lifecycle"] = this.gameState.lifecycle;
    this.gameState = result.state;
    // docs/05 §5.1, docs/09 §9 D-09-10: readiness clears when a game
    // concludes, so each new game requires deliberate agreement. Guarded on
    // the *previous* lifecycle, not just the current one — dispatchReadiness
    // and dispatchCloseTable both return `state: this.gameState` unchanged
    // (no apply() call), so without this guard every set_ready sent after
    // conclusion (while readying up for the next game) would see
    // lifecycle === "concluded" again and wipe out the very toggle just
    // made. previousLifecycle is already "concluded" for those pass-through
    // calls, so this only ever fires once, at the real transition.
    if (previousLifecycle !== "concluded" && this.gameState.lifecycle === "concluded") {
      for (const clearedSeat of SEAT_ORDER) {
        this.table = setReady(this.table, clearedSeat, false);
      }
    }
    if (result.clearCheckpoints) {
      this.checkpoints.clear();
      this.commandReceipts.clear();
    }
    if (result.recordCheckpoint) {
      this.checkpoints.record(this.seq, this.gameState);
    }
    // After the clear above, not before — so a game-starting command's own
    // cmdId (start_deal both clears the window and is the first thing
    // recorded in it) survives into the fresh window it just created.
    if (cmdId !== undefined) {
      this.commandReceipts.record(cmdId, this.seq);
    }

    for (const viewer of SEAT_ORDER) {
      const view = this.viewFor(viewer);
      for (const source of result.events) {
        const wireEvent =
          source.kind === "wire" ? source.event : toWireEvent(source.event, viewer, this.gameState, this.table);
        if (wireEvent === null) continue; // e.g. HandArranged: no wire counterpart (docs/10 §5.7)
        this.pushFrame(viewer, {
          kind: "event",
          seq: this.seq,
          ev: this.applyOverrides(wireEvent, result, options?.pauseReason),
          view,
        });
      }
    }

    return { ok: true, seq: this.seq };
  }

  private applyOverrides(event: TableEvent, result: DispatchOk, pauseReason: "seat_absent" | undefined): TableEvent {
    if (event.type === "TablePaused" && pauseReason !== undefined) {
      return { ...event, reason: pauseReason };
    }
    if (event.type === "CorrectionProposed" && result.correctionSeqOverride !== undefined) {
      return { ...event, rewindTo: result.correctionSeqOverride };
    }
    if (event.type === "CorrectionApplied" && result.correctionSeqOverride !== undefined) {
      return { ...event, restoredSeq: result.correctionSeqOverride };
    }
    if (event.type === "ReshuffleCommitmentPublished") {
      return { ...event, atSeq: this.seq };
    }
    return event;
  }

  private pushFrame(seat: Seat, frame: ActorFrame): void {
    const log = this.frameLog[seat];
    log.push(frame);
    // Backlog depth: 200 events per table, in memory (docs/12 §8). Beyond
    // that, resumption falls back to a full seat view rather than backlog
    // replay — cheaper anyway once the gap is that large.
    if (log.length > BACKLOG_DEPTH) {
      log.splice(0, log.length - BACKLOG_DEPTH);
    }
  }

  private dispatch<N extends CommandName>(seat: Seat, cmd: N, params: CommandParamsMap[N]): DispatchResult {
    switch (cmd) {
      case "bind":
      case "resume":
      case "ping":
        throw new Error(`${cmd} is a gateway command (docs/12, Phase 5) — never submitted to the actor`);

      case "set_ready":
      case "clear_ready":
        return this.dispatchReadiness(seat, cmd === "set_ready");

      case "close_table":
        return this.dispatchCloseTable(seat);

      case "start_deal":
        return this.dispatchStartDeal(seat);

      case "propose_correction":
        return this.dispatchProposeCorrection(seat, params as CommandParamsMap["propose_correction"]);

      case "respond_correction":
        return this.dispatchRespondCorrection(seat, params as CommandParamsMap["respond_correction"]);

      default:
        return this.dispatchToCore(this.buildCoreCommand(seat, cmd, params));
    }
  }

  private dispatchReadiness(seat: Seat, ready: boolean): DispatchResult {
    if (this.gameState.lifecycle !== "idle" && this.gameState.lifecycle !== "concluded") {
      return { ok: false, code: "NOT_IN_PHASE" }; // docs/10 §4: IDLE or CONCLUDED only
    }
    this.table = setReady(this.table, seat, ready);
    // Not a dealer-core command: readiness is table-level state that
    // doesn't touch GameState, so no core apply() call and no checkpoint.
    const event: TableEvent = ready ? { type: "SeatReady", seat } : { type: "SeatUnready", seat };
    return {
      ok: true,
      state: this.gameState,
      events: [{ kind: "wire", event }],
      recordCheckpoint: false,
      clearCheckpoints: false,
    };
  }

  private dispatchCloseTable(seat: Seat): DispatchResult {
    if (this.table.host !== seat) return { ok: false, code: "FORBIDDEN" };
    if (
      this.gameState.lifecycle === "in_play" ||
      this.gameState.lifecycle === "concluding"
    ) {
      return { ok: false, code: "NOT_IN_PHASE" }; // docs/05 §4.1: not while a game is in progress
    }
    this.table = closeTable(this.table);
    const event: TableEvent = { type: "TableClosed", reason: "host closed the table" };
    return {
      ok: true,
      state: this.gameState,
      events: [{ kind: "wire", event }],
      recordCheckpoint: false,
      clearCheckpoints: true,
    };
  }

  private dispatchStartDeal(seat: Seat): DispatchResult {
    if (this.table.host !== seat) return { ok: false, code: "FORBIDDEN" };
    if (this.table.status !== "seated" || !allReady(this.table)) {
      return { ok: false, code: "NOT_IN_PHASE" }; // docs/10 §4: four seats occupied, all ready
    }
    // docs/09 §7's matrix: start_deal succeeds from CONCLUDED too (FR-117,
    // D-09-10, D-10-14) — the diagram's own separate, unlabeled
    // CONCLUDED -> IDLE edge ("table ready for another game"), folded here
    // rather than into dealer-core's own apply(), which stays strictly
    // idle-only (docs/10 §4's literal contract). Safe because
    // dealOpeningHands(entropy) never reads the incoming state at all — a
    // concluded state and a fresh idle one produce an identical deal.
    const effectiveState = this.gameState.lifecycle === "concluded" ? createIdleState() : this.gameState;
    const result = apply(effectiveState, { type: "start_deal", seat }, this.options.entropy);
    if (!result.ok) return result;
    this.gameId = randomUUID(); // a fresh durable row per deal (docs/17 §5.6) — the checkpoint's game_id
    return {
      ok: true,
      state: result.state,
      events: wrapCore(result.events),
      recordCheckpoint: true, // "right after the deal, before anything else" is a valid rewind target
      clearCheckpoints: true, // docs/05 §8.3: scope is the current game only — clear before recording the new game's first checkpoint
    };
  }

  private dispatchProposeCorrection(
    seat: Seat,
    params: CommandParamsMap["propose_correction"],
  ): DispatchResult {
    const target = this.checkpoints.at(params.rewindTo);
    if (target === null) return { ok: false, code: "NO_CHECKPOINT" };
    const oldest = this.checkpoints.oldestSeq;
    if (oldest === null || target.lifecycle === "idle" || target.lifecycle === "concluded") {
      return { ok: false, code: "NO_CHECKPOINT" };
    }
    const oldestState = this.checkpoints.at(oldest);
    if (oldestState === null || oldestState.lifecycle === "idle" || oldestState.lifecycle === "concluded") {
      return { ok: false, code: "NO_CHECKPOINT" };
    }

    const result = apply(this.gameState, {
      type: "propose_correction",
      seat,
      rewindTo: target.seq, // dealer-core's own seq for that exact snapshot
      oldestAvailableSeq: oldestState.seq,
    });
    if (!result.ok) return result;
    return {
      ok: true,
      state: result.state,
      events: wrapCore(result.events),
      recordCheckpoint: true,
      clearCheckpoints: false,
      correctionSeqOverride: params.rewindTo, // the actor-seq the client actually sent
    };
  }

  private dispatchRespondCorrection(
    seat: Seat,
    params: CommandParamsMap["respond_correction"],
  ): DispatchResult {
    if (this.gameState.lifecycle !== "in_play" || this.gameState.correction === null) {
      return { ok: false, code: "NOT_IN_PHASE" };
    }
    const correction = this.gameState.correction;
    const willCompleteUnanimity =
      params.response === "accept" &&
      SEAT_ORDER.filter((s) => s !== correction.proposer && s !== seat).every(
        (s) => correction.responses[s] === "accept",
      );

    let restoreCandidate: GameState | undefined;
    let actorSeqOfTarget: number | undefined;
    if (willCompleteUnanimity) {
      // dealer-core's own rewindTo is already in its own seq space (set
      // when this correction was proposed); find the actor-seq that maps
      // to it so the wire event can be translated back afterward.
      const found = this.findActorSeqForGameSeq(correction.rewindTo);
      if (found === null) {
        throw new Error("unreachable: a proposed correction's target must still be in the checkpoint window");
      }
      actorSeqOfTarget = found.actorSeq;
      restoreCandidate = found.gameState;
    }

    const result = apply(
      this.gameState,
      {
        type: "respond_correction",
        seat,
        response: params.response,
        ...(restoreCandidate !== undefined ? { restoreCandidate } : {}),
      },
      this.options.entropy,
    );
    if (!result.ok) return result;
    return {
      ok: true,
      state: result.state,
      events: wrapCore(result.events),
      recordCheckpoint: false,
      clearCheckpoints: false,
      ...(actorSeqOfTarget !== undefined ? { correctionSeqOverride: actorSeqOfTarget } : {}),
    };
  }

  private findActorSeqForGameSeq(gameSeq: number): { readonly actorSeq: number; readonly gameState: GameState } | null {
    for (const entry of this.checkpoints.all()) {
      if (entry.gameState.lifecycle === "idle" || entry.gameState.lifecycle === "concluded") continue;
      if (entry.gameState.seq === gameSeq) {
        return { actorSeq: entry.seq, gameState: entry.gameState };
      }
    }
    return null;
  }

  private dispatchToCore(command: CoreCommand): DispatchResult {
    const result = apply(this.gameState, command, this.options.entropy);
    if (!result.ok) return result;
    return {
      ok: true,
      state: result.state,
      events: wrapCore(result.events),
      recordCheckpoint: true,
      clearCheckpoints: false,
    };
  }

  private buildCoreCommand<N extends CommandName>(seat: Seat, cmd: N, params: CommandParamsMap[N]): CoreCommand {
    // Every remaining command's wire `d` shape (docs/33_API §4) already
    // matches dealer-core's own parameter names 1:1 — only `seat` is added,
    // consistent with it never appearing on the wire (NR-601).
    return { type: cmd, seat, ...(params ?? {}) } as CoreCommand;
  }
}
