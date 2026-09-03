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
// defect. `ack` frames are not modeled here: they require a client
// `cmdId` (docs/33_API §3), which is an idempotency/gateway concern
// (docs/13) this actor doesn't yet see. The `event` frame delivered to
// the acting seat (every accepted command still broadcasts to all four
// seats, itself included) stands in for confirmation in this slice.
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
import { CheckpointHistory } from "./checkpoints.js";
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
  private readonly checkpoints: CheckpointHistory;
  private readonly frameLog: Record<Seat, ActorFrame[]>;

  constructor(private readonly options: TableActorOptions) {
    this.table = createTable(options.id);
    this.gameState = createIdleState();
    this.checkpoints = new CheckpointHistory(options.correctionWindow ?? 10);
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
   * Deliberately excludes the correction checkpoint history: that window
   * is a live, in-memory convenience (docs/05 §8.3), not a durability
   * guarantee, so a crash reasonably narrows it to nothing rather than
   * needing its own persistence path.
   */
  snapshot(): ActorSnapshot {
    return { table: this.table, seq: this.seq, gameStateBytes: this.checkpointBytes() };
  }

  static fromSnapshot(options: TableActorOptions, snapshot: ActorSnapshot): TableActor {
    const actor = new TableActor(options);
    actor.table = snapshot.table;
    actor.seq = snapshot.seq;
    actor.gameState = coreRestore(snapshot.gameStateBytes);
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
   * `pauseReason` is not a wire parameter — `request_pause` carries none
   * (docs/19 `request_pause | — | — | TablePaused`) — it is this actor's
   * own out-of-band context for `gateway.ts`'s `autoPauseOnAbsence`,
   * which is the one caller with presence knowledge dealer-core
   * deliberately doesn't have (`state.ts`'s module comment). A genuine
   * client `request_pause` frame never carries one, so `toWireEvent`'s
   * own default (`"requested"`, `table/events.ts`) is what every
   * player-initiated pause still gets; only this actor overrides it,
   * the same "override the event after the fact" shape `applyOverrides`
   * already uses for `CorrectionProposed`/`CorrectionApplied`/
   * `ReshuffleCommitmentPublished`'s own seq fields.
   */
  submit<N extends CommandName>(
    seat: Seat,
    cmd: N,
    params: CommandParamsMap[N],
    pauseReason?: "seat_absent",
  ): SubmitOutcome {
    const result = this.dispatch(seat, cmd, params);

    if (!result.ok) {
      this.pushFrame(seat, { kind: "reject", code: result.code, view: this.viewFor(seat) });
      return { ok: false, code: result.code };
    }

    this.seq += 1;
    this.gameState = result.state;
    if (result.clearCheckpoints) {
      this.checkpoints.clear();
    }
    if (result.recordCheckpoint) {
      this.checkpoints.record(this.seq, this.gameState);
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
          ev: this.applyOverrides(wireEvent, result, pauseReason),
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
    const result = apply(this.gameState, { type: "start_deal", seat }, this.options.entropy);
    if (!result.ok) return result;
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
