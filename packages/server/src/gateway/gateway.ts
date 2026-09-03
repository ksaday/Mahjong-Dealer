// The socket gateway (docs/12_Realtime_WebSocket_Architecture.md;
// docs/13_Input_Integrity.md §9's pipeline). Transport-agnostic — see
// `socket.ts` — so it is unit-testable the same way the table actor is:
// with no real network, only `SocketLike` test doubles (`MockSocket`).
//
// Scope note: this implements binding, framing, `cseq` sequencing, `cmdId`
// idempotency, schema validation, staleness checking, resumption,
// byte-based backpressure tracking, session-revocation polling
// (`checkSessionRevocation`, docs/12 §4.3, backed by `AuthService.
// isSessionActive` once auth was built), and auto-pause on disconnection
// (`autoPauseOnAbsence`/`autoResumeOnReturn`, docs/22 §5, correctly
// multi-holder since `PauseState.requestedBy` became a `ReadonlySet<Seat>`,
// and correctly labeled on the wire — `TableActor.submit`'s own
// `pauseReason` parameter overrides `TablePaused.reason` to
// `"seat_absent"` for this path specifically). Heartbeats (docs/12 §7) are
// a real WebSocket protocol ping/pong loop, entirely in `ws-server.ts`'s
// `startHeartbeat` — invisible to this transport-agnostic module, which
// only ever learns of a heartbeat-detected loss the same way it learns of
// any other disconnection: the resulting `close` event. Revocation
// polling and the bind deadline are exposed as callable checks a real
// timer would drive (`checkBindDeadline`, `checkSessionRevocation`), not
// implemented as internal `setInterval`s, so the logic stays testable
// with an injected clock/stub rather than real elapsed time.
import {
  COMMAND_SCHEMAS,
  SEAT_ORDER,
  type ClientFrame,
  type CommandName,
  type RejectionCode,
  type ServerFrame,
  type Seat,
} from "@mahjong-dealer/shared";
import type { ActorFrame, TableActor } from "../table/actor.js";
import type { TableRejection } from "../table/table.js";
import type { CheckpointWriter } from "../checkpoint/writer.js";
import { Connection } from "./connection.js";
import type { SocketLike } from "./socket.js";
import type { TicketStore } from "./tickets.js";

const BIND_DEADLINE_MS = 5_000; // docs/12 §4.2
const PROTOCOL_VERSION = 1;

/** Commands whose target could have moved since the client's last view (docs/13 §6.1). */
const STALENESS_CHECKED = new Set<CommandName>([
  "claim_discard",
  "swap_exposed_tile",
  "respond_correction",
  "respond_declaration",
  "respond_end_game",
]);

const REJECTION_MESSAGES: Readonly<Record<RejectionCode, string>> = {
  NOT_BOUND: "The connection has not completed bind.",
  NOT_YOUR_TURN: "It is not your turn.",
  NOT_YOUR_TILE: "You don't have that tile.",
  TILE_NOT_AVAILABLE: "That tile is no longer available.",
  NOT_IN_PHASE: "That command does not exist in the current state.",
  TABLE_PAUSED: "The table is paused.",
  CORRECTION_PENDING: "A correction proposal is open.",
  PASS_ROUND_OPEN: "A pass round is open.",
  WALL_EMPTY: "No tiles remain to draw.",
  NO_CHECKPOINT: "That point is outside the correction window.",
  DUPLICATE_COMMAND: "Already applied.",
  SEQ_GAP: "Sequence gap.",
  STALE_STATE: "That was decided against an out-of-date view.",
  MALFORMED: "That command was not well-formed.",
  RATE_LIMITED: "You are sending commands too quickly.",
  FORBIDDEN: "You are not authorized to do that.",
  TABLE_CLOSED: "This table is closed.",
};

export interface ConnectionHandle {
  onMessage(raw: string): void;
  onClose(): void;
  /** A real timer should call this ~5s after the socket opens (docs/12 §4.2). No-op once bound. */
  checkBindDeadline(): void;
  /** A real heartbeat should call this once, on the *first* missed pong (docs/22 §4's `away`) — the second miss already reaches `onClose` via `ws.terminate()`. No-op if not yet bound. */
  onHeartbeatMiss(): void;
}

export class TableGateway {
  private readonly actor: TableActor;
  private readonly tickets: TicketStore;
  private readonly now: () => number;
  private readonly connections = new Map<Seat, Connection>();
  private readonly receipts = new Map<string, { readonly seat: Seat; readonly frame: ServerFrame }>();

  private readonly isSessionActive: ((sessionId: string) => Promise<boolean>) | undefined;
  private readonly checkpointWriter: CheckpointWriter | undefined;

  constructor(options: {
    readonly actor: TableActor;
    readonly tickets: TicketStore;
    readonly now?: () => number;
    /** docs/12 §4.3: consulted by `checkSessionRevocation`. Omit to leave revocation polling disabled — e.g. `TableHarness`-driven tests with no session layer at all. */
    readonly isSessionActive?: (sessionId: string) => Promise<boolean>;
    /** docs/16 §5.3/docs/29: omit to leave checkpoint durability disabled — e.g. `TableHarness`-driven tests with no database at all. */
    readonly checkpointWriter?: CheckpointWriter;
  }) {
    this.actor = options.actor;
    this.tickets = options.tickets;
    this.now = options.now ?? Date.now;
    this.isSessionActive = options.isSessionActive;
    this.checkpointWriter = options.checkpointWriter;
  }

  /** For assertions and deliberate fault injection only (docs/26 §3.1's `harness.state()` reasoning applies here too). */
  connectionFor(seat: Seat): Connection | undefined {
    return this.connections.get(seat);
  }

  /** Whether a seat currently has a bound connection — `GET /tables/mine`'s `connected` field (docs/33_API §4.2). */
  isConnected(seat: Seat): boolean {
    return this.connections.has(seat);
  }

  /** `GET /admin/health`'s connection count (docs/18 §4.3, `FR-162`) — a count only, never which account. */
  connectionCount(): number {
    return this.connections.size;
  }

  /**
   * Administrative force-close (docs/18 §4.3, `FR-161`): delivers the
   * `TableClosed` event to every connected seat, same as a host's own
   * `close_table`. Deliberately does not also drop the sockets — a
   * self-closed table doesn't either, and a client seeing `tableState:
   * "closed"` in the delivered view is the same signal either way; adding
   * a forced disconnect here would be a second, differently-behaved close
   * path for no benefit.
   */
  forceClose(reason: string): void {
    // Capture before forceClose (which nulls it) — a forced close purges
    // durably too (docs/16 §5.5's "or when a table closes or is
    // abandoned"), same as a natural conclusion, just without an outcome
    // to record (`NR-013`: not a conclusion the players reached).
    const gameId = this.actor.currentGameId;
    this.actor.forceClose(reason);
    this.deliverNewFrames();
    if (gameId !== null && this.checkpointWriter !== undefined) {
      void this.checkpointWriter.purge(gameId).catch(this.onCheckpointError);
    }
  }

  /**
   * FR-025's connection half: `TableActor.vacateSeat` alone empties the
   * seat but has no notion of a bound connection to evict. This is
   * deliberately unlike `forceClose` above, whose own doc comment reasons
   * that leaving sockets bound there is safe *because* a terminally
   * closed table will never re-occupy a seat with fresh concealed state —
   * a reasoning that does not hold here. A vacated seat can absolutely be
   * re-occupied, so a connection still bound to it must be evicted now,
   * the same way `checkSessionRevocation` already evicts a connection the
   * moment the server should no longer trust it — otherwise it would keep
   * receiving this seat's own broadcasts, including the next occupant's
   * concealed view once a new game deals.
   */
  vacateSeat(seat: Seat): { readonly ok: true } | TableRejection {
    const result = this.actor.vacateSeat(seat);
    if (!result.ok) return result;
    this.deliverNewFrames();
    const connection = this.connections.get(seat);
    if (connection !== undefined) {
      connection.close(4011, "SEAT_VACATED");
      this.connections.delete(seat);
    }
    return { ok: true };
  }

  /**
   * Graceful shutdown (docs/21_Error_Handling_and_Recovery.md §7,
   * docs/19_WebSocket_Event_Catalog.md's `service_restarting` notice and
   * `1012 SERVICE_RESTART` close code): tells every connected seat a
   * planned restart is imminent, then closes its socket so the client's
   * own reconnect-with-jitter logic (docs/21 §7) takes over. `main.ts`
   * calls this, via `TableManager.shutdownAll`, on `SIGTERM`.
   *
   * Does **not** itself flush a checkpoint — docs/21 §7's "flush every
   * checkpoint synchronously" is orchestrated one level up, by
   * `TableManager.flushAllCheckpointsSync` (`main.ts`'s shutdown handler
   * awaits it between `shutdownAll` and closing the database pool), so
   * every live table's actor gets one synchronous flush regardless of
   * which gateway method is called on it.
   */
  notifyShuttingDown(): void {
    const notice: ServerFrame = { t: "notice", kind: "service_restarting", d: {} };
    for (const connection of this.connections.values()) {
      connection.send(JSON.stringify(notice));
      connection.close(1012, "SERVICE_RESTART");
    }
    this.connections.clear();
  }

  /**
   * A real timer should call this periodically (docs/12 §4.3): closes,
   * with `4004`, any bound connection whose session has since been
   * revoked or expired — "log out everywhere" must close an open table
   * connection, not just stop new requests from authenticating
   * (docs/15 §4). No-op if no `isSessionActive` checker was supplied
   * (e.g. `TableHarness`-driven tests with no session layer at all).
   *
   * Snapshots the connection list before awaiting anything: a bind or
   * close arriving mid-check must not be iterated over while it's
   * changing, and the identity check below (mirroring `handleBind`'s own
   * "a newer bind already replaced this one" guard) makes a since-replaced
   * connection a safe no-op rather than accidentally closing its successor.
   */
  async checkSessionRevocation(): Promise<void> {
    if (this.isSessionActive === undefined) return;
    const bound = [...this.connections];
    for (const [seat, connection] of bound) {
      const active = await this.isSessionActive(connection.sessionId);
      if (!active && this.connections.get(seat) === connection) {
        connection.close(4004, "SESSION_REVOKED");
        this.connections.delete(seat);
      }
    }
  }

  acceptConnection(socket: SocketLike): ConnectionHandle {
    const connectedAt = this.now();
    let connection: Connection | null = null;
    let bound = false;

    const onMessage = (raw: string): void => {
      if (!bound) {
        const result = this.handleBind(socket, connectedAt, raw);
        if (result !== null) {
          connection = result;
          bound = true;
        }
        return;
      }
      if (connection !== null) {
        this.handleBoundMessage(connection, raw);
      }
    };

    const onClose = (): void => {
      if (connection !== null && this.connections.get(connection.seat) === connection) {
        const seat = connection.seat;
        this.connections.delete(seat);
        // Unconditional, independent of autoPauseOnAbsence's own request_pause
        // outcome — that submit is a no-op outside in_play/concluding, which
        // would otherwise leave a lobby-phase disconnect invisible to the
        // other seats (docs/22 §3-§5, FR-140).
        this.actor.setSeatConnection(seat, "absent");
        this.deliverNewFrames();
        this.autoPauseOnAbsence(seat);
      }
    };

    const checkBindDeadline = (): void => {
      if (!bound && this.now() - connectedAt >= BIND_DEADLINE_MS) {
        socket.close(4001, "BIND_REQUIRED");
      }
    };

    const onHeartbeatMiss = (): void => {
      if (connection !== null && this.connections.get(connection.seat) === connection) {
        this.markSeatAway(connection.seat);
      }
    };

    return { onMessage, onClose, checkBindDeadline, onHeartbeatMiss };
  }

  /** docs/22 §4's first missed heartbeat — a quieter signal than `onClose`'s `absent`, but still public (FR-140). */
  private markSeatAway(seat: Seat): void {
    this.actor.setSeatConnection(seat, "away");
    this.deliverNewFrames();
    // docs/19 §7.3's `connection_degraded` — "heartbeats are slow; a
    // disconnection may follow" — self-only: it tells this connection
    // about its own missed heartbeat, unlike the `SeatDisconnected`/`away`
    // state `deliverNewFrames` just broadcast to every seat's view.
    const connection = this.connections.get(seat);
    connection?.send(JSON.stringify({ t: "notice", kind: "connection_degraded", d: {} } satisfies ServerFrame));
  }

  private handleBind(socket: SocketLike, connectedAt: number, raw: string): Connection | null {
    if (this.now() - connectedAt >= BIND_DEADLINE_MS) {
      socket.close(4001, "BIND_REQUIRED");
      return null;
    }

    const frame = parseJson(raw);
    if (frame === null || !isRecord(frame) || frame["t"] !== "cmd" || frame["cmd"] !== "bind") {
      socket.close(4001, "BIND_REQUIRED");
      return null;
    }
    const ticket = isRecord(frame["d"]) ? frame["d"]["ticket"] : undefined;
    if (typeof ticket !== "string") {
      socket.close(4002, "TICKET_INVALID");
      return null;
    }
    const claims = this.tickets.redeem(ticket);
    if (claims === null) {
      socket.close(4002, "TICKET_INVALID");
      return null;
    }

    // One connection per seat; a newer authenticated bind replaces the older (D-12-10).
    const existing = this.connections.get(claims.seat);
    if (existing !== undefined) {
      existing.close(4003, "REPLACED_BY_NEWER_BIND");
    }

    const connection = new Connection(claims.seat, claims.sessionId, socket, this.now);
    this.connections.set(claims.seat, connection);

    const boundFrame: ServerFrame = {
      t: "bound",
      seat: claims.seat,
      protocolVersion: PROTOCOL_VERSION,
      seq: this.actor.seqNumber,
    };
    connection.lastDeliveredSeq = this.actor.seqNumber;
    connection.send(JSON.stringify(boundFrame));
    // Unconditional, independent of autoResumeOnReturn's own request_resume
    // outcome — covers both a genuine reconnect and a seat's very first-ever
    // bind, neither of which broadcast anything without this (docs/22 §5,
    // FR-140).
    this.actor.setSeatConnection(claims.seat, "connected");
    this.deliverNewFrames();
    this.autoResumeOnReturn(claims.seat);
    return connection;
  }

  /**
   * Auto-pause on presence loss (docs/22_Disconnect_and_Reconnect.md §5):
   * "the host issues the same `request_pause` [dealer-core] implements
   * once it detects an absence" (dealer-core's own `state.ts` module
   * comment). Blind by design — `applyRequestPause` already rejects
   * outside `in_play`/`concluding` and when this seat already holds a
   * pause, so this gateway needs no lifecycle check of its own; a
   * rejection here is a silent no-op, not an error, since nothing asked
   * for confirmation.
   *
   * Correctly multi-holder (docs/22 §5.2's "if both hold, stays paused
   * until both clear"): `PauseState.requestedBy` is a `ReadonlySet<Seat>`
   * (`state.ts`'s own doc comment), so if seat A is already auto-paused
   * and seat B also goes absent, B's own `request_pause` succeeds and
   * adds its own hold — the table only actually resumes once every
   * holder, A's and B's alike, has called `request_resume` (A returning
   * does not silently clear B's still-live absence).
   *
   * Correctly labeled on the wire too (docs/22 §5's `TablePaused { seat,
   * reason: 'seat_absent' }`): dealer-core's own `request_pause` command
   * and event carry no reason at all — the same client command this
   * gateway reuses for auto-pause looks identical to dealer-core either
   * way — so the distinction is made here, the one call site with
   * presence knowledge, via `TableActor.submit`'s `pauseReason` parameter,
   * which overrides `TablePaused.reason` after `toWireEvent` has already
   * built the event (the "actor overrides the event after the fact"
   * option, not a new command parameter — dealer-core's own wire-facing
   * types are untouched).
   */
  private autoPauseOnAbsence(seat: Seat): void {
    const beforeGameId = this.actor.currentGameId;
    const outcome = this.actor.submit(seat, "request_pause", undefined, { pauseReason: "seat_absent" });
    if (outcome.ok) {
      this.deliverNewFrames();
      this.syncCheckpoint(beforeGameId, outcome.seq);
    }
  }

  /** The other half of `autoPauseOnAbsence`: a seat rebinding auto-clears the pause it caused, if any — `applyRequestResume` rejects for anyone else's pause or when nothing is paused, so this is likewise safe to call unconditionally. */
  private autoResumeOnReturn(seat: Seat): void {
    const beforeGameId = this.actor.currentGameId;
    const outcome = this.actor.submit(seat, "request_resume", undefined);
    if (outcome.ok) {
      this.deliverNewFrames();
      this.syncCheckpoint(beforeGameId, outcome.seq);
    }
  }

  // `cseq` and the rate limit apply to *every* frame a bound connection
  // sends — ping and resume included, since both carry the full envelope
  // (docs/33_API §2) and both are frames a hostile client could flood.
  // Only after these two common, cheap checks does dispatch branch by
  // command name.
  private handleBoundMessage(connection: Connection, raw: string): void {
    const frame = parseJson(raw);
    if (
      frame === null ||
      !isRecord(frame) ||
      frame["t"] !== "cmd" ||
      typeof frame["cmd"] !== "string" ||
      typeof frame["cmdId"] !== "string" ||
      typeof frame["cseq"] !== "number" ||
      !Number.isInteger(frame["cseq"])
    ) {
      connection.close(4008, "PROTOCOL_VIOLATION");
      return;
    }
    const cmd = frame["cmd"];
    const cmdId = frame["cmdId"] as string;
    const cseq = frame["cseq"] as number;

    // cseq sequencing (docs/13 §5): contiguous, or an exact repeat of the
    // last value (a retransmission of the same frame) — anything else,
    // including a regression, is a gap.
    const isExactRepeat = cseq === connection.cseq;
    if (!isExactRepeat && cseq !== connection.cseq + 1) {
      connection.close(4008, "PROTOCOL_VIOLATION");
      return;
    }
    if (!isExactRepeat) {
      connection.cseq = cseq;
    }

    if (!connection.rateLimiter.tryConsume()) {
      connection.throttleStreak += 1;
      if (connection.hasExceededThrottleLimit) {
        connection.close(4009, "RATE_LIMITED");
        return;
      }
      // docs/19 §7.3's `rate_limit_warning` — "approaching a limit" — sent
      // alongside every throttled reject up to `hasExceededThrottleLimit`'s
      // own close, since that close is the limit being approached.
      connection.send(JSON.stringify({ t: "notice", kind: "rate_limit_warning", d: {} } satisfies ServerFrame));
      this.rejectAndRecord(connection, cmdId, "RATE_LIMITED");
      return;
    }
    connection.throttleStreak = 0;

    if (cmd === "ping") {
      connection.send(JSON.stringify({ t: "pong" } satisfies ServerFrame));
      return;
    }
    if (cmd === "resume") {
      this.handleResume(connection, frame);
      return;
    }
    if (cmd === "bind") {
      connection.close(4008, "PROTOCOL_VIOLATION"); // already bound; bind is a one-time first frame
      return;
    }

    this.handleCommand(connection, cmd, cmdId, frame);
  }

  private handleResume(connection: Connection, frame: Record<string, unknown>): void {
    const lastSeq = isRecord(frame["d"]) ? frame["d"]["lastSeq"] : undefined;
    if (typeof lastSeq !== "number" || !Number.isInteger(lastSeq) || lastSeq < 0) {
      connection.close(4008, "PROTOCOL_VIOLATION");
      return;
    }

    const backlog = this.actor
      .framesFor(connection.seat)
      .filter((f): f is Extract<ActorFrame, { kind: "event" }> => f.kind === "event" && f.seq > lastSeq);

    const gapBeyondBacklog =
      backlog.length === 0
        ? lastSeq < this.actor.seqNumber
        : backlog[0]!.seq !== lastSeq + 1;

    if (gapBeyondBacklog) {
      const view = this.actor.viewFor(connection.seat);
      connection.send(JSON.stringify({ t: "resumed", seq: this.actor.seqNumber, view } satisfies ServerFrame));
    } else {
      for (const item of backlog) {
        connection.send(JSON.stringify({ t: "event", seq: item.seq, ev: item.ev, view: item.view } satisfies ServerFrame));
      }
      connection.send(JSON.stringify({ t: "resumed", seq: this.actor.seqNumber } satisfies ServerFrame));
    }
    connection.lastDeliveredSeq = this.actor.seqNumber;
  }

  // `cseq` and the rate limit were already checked in handleBoundMessage,
  // which is what makes this "cheap checks before expensive ones" (D-13-10):
  // schema validation and the cmdId lookup, next, are still cheaper than
  // touching the actor, and only a fully-validated, non-duplicate,
  // non-stale command ever reaches `actor.submit`.
  private handleCommand(connection: Connection, cmd: string, cmdId: string, frame: Record<string, unknown>): void {
    if (cmd === "bind" || cmd === "resume" || cmd === "ping" || !(cmd in COMMAND_SCHEMAS)) {
      this.rejectAndRecord(connection, cmdId, "MALFORMED");
      return;
    }
    const commandName = cmd as CommandName;
    const parsed = COMMAND_SCHEMAS[commandName].safeParse(frame["d"]);
    if (!parsed.success) {
      this.rejectAndRecord(connection, cmdId, "MALFORMED");
      return;
    }

    // cmdId idempotency (docs/13 §4): a previously-seen intent returns its
    // original outcome without touching the actor again.
    const receipt = this.receipts.get(cmdId);
    if (receipt !== undefined) {
      if (receipt.seat === connection.seat) {
        connection.send(JSON.stringify(receipt.frame));
      }
      return;
    }

    if (STALENESS_CHECKED.has(commandName) && connection.lastDeliveredSeq < this.actor.seqNumber) {
      this.rejectAndRecord(connection, cmdId, "STALE_STATE");
      return;
    }

    const beforeGameId = this.actor.currentGameId;
    const outcome = this.actor.submit(connection.seat, commandName, parsed.data as never, { cmdId });

    if (!outcome.ok) {
      this.rejectAndRecord(connection, cmdId, outcome.code);
      return;
    }

    const ackFrame: ServerFrame = { t: "ack", cmdId, seq: outcome.seq };
    connection.send(JSON.stringify(ackFrame));
    this.receipts.set(cmdId, { seat: connection.seat, frame: ackFrame });
    this.deliverNewFrames();
    this.syncCheckpoint(beforeGameId, outcome.seq);
  }

  /**
   * Durable checkpoint sync after any accepted command (docs/16 §5.3: "after
   * every accepted command that changes public state"), off the
   * acknowledgement path (NFR-032) — every call here is fire-and-forget.
   * A concluded game is purged rather than checkpointed (nothing left worth
   * restoring, and writing then immediately deleting would race). A brand
   * new game (`currentGameId` just changed) must have its durable `games`
   * row exist before the checkpoint referencing it — via `game_id`'s FK —
   * is written, so that one path awaits `startGame` first.
   */
  private syncCheckpoint(beforeGameId: string | null, seq: number): void {
    const writer = this.checkpointWriter;
    if (writer === undefined) return;

    const state = this.actor.gameStateSnapshot;
    if (state.lifecycle === "concluded") {
      // `concludeAndPurge` -> `purge` already deletes every correction-window
      // row for this game (docs/16 §5.5, D-17-19), and a concluded game never
      // records a new correction entry, so no correction-checkpoint write
      // belongs on this branch.
      void writer.concludeAndPurge(this.actor).catch(this.onCheckpointError);
      return;
    }

    const afterGameId = this.actor.currentGameId;
    if (afterGameId === null) return; // idle: nothing to checkpoint

    if (afterGameId !== beforeGameId) {
      void writer
        .startGame(afterGameId, this.actor.tableSnapshot.id)
        .then(() => writer.flushSync(this.actor))
        .then(() => this.persistCorrectionCheckpoint(writer, seq))
        .catch(this.onCheckpointError);
      return;
    }
    writer.writeAsync(this.actor);
    this.persistCorrectionCheckpoint(writer, seq);
  }

  /**
   * Only when the just-accepted command actually added a new
   * correction-window entry (`TableActor.latestCorrectionCheckpoint.seq`
   * equal to the outcome's own `seq` — `set_ready`/`clear_ready`/
   * `close_table` never do) — avoids a wasted or duplicate write on every
   * other accepted command (docs/17 §5.8, D-17-19).
   */
  private persistCorrectionCheckpoint(writer: CheckpointWriter, seq: number): void {
    const latest = this.actor.latestCorrectionCheckpoint;
    if (latest !== null && latest.seq === seq) {
      writer.writeCorrectionCheckpointAsync(this.actor, latest);
    }
  }

  private readonly onCheckpointError = (error: unknown): void => {
    console.error("checkpoint sync failed", error);
  };

  private rejectAndRecord(connection: Connection, cmdId: string, code: RejectionCode): void {
    const frame: ServerFrame = { t: "reject", cmdId, code, message: REJECTION_MESSAGES[code] };
    connection.send(JSON.stringify(frame));
    this.receipts.set(cmdId, { seat: connection.seat, frame });
  }

  /**
   * Public wrapper around `deliverNewFrames` for callers that mutate the
   * actor directly, outside this gateway's own command pipeline —
   * `TableService.createTable`/`joinTable` call `actor.occupySeat` straight
   * on the live actor (docs/05 §5, ahead of any bound socket), then this to
   * flush the `SeatOccupied` broadcast to whichever other seats are already
   * connected.
   */
  deliverPendingFrames(): void {
    this.deliverNewFrames();
  }

  /** Flushes every frame produced since each connected seat's cursor, in order. */
  private deliverNewFrames(): void {
    let delivered = false;
    for (const seat of SEAT_ORDER) {
      const connection = this.connections.get(seat);
      if (connection === undefined) continue;
      const all = this.actor.framesFor(seat);
      for (const item of all) {
        if (item.kind !== "event" || item.seq <= connection.lastDeliveredSeq) continue;
        connection.send(JSON.stringify({ t: "event", seq: item.seq, ev: item.ev, view: item.view } satisfies ServerFrame));
        connection.lastDeliveredSeq = item.seq;
        delivered = true;
      }
    }
    // A command that advances `seq` but broadcasts nothing (arrange_hand —
    // docs/10 §5.7, "the only command that emits nothing public") must not
    // make every connection look stale on its next sensitive command: with
    // nothing observable to have missed, nobody actually fell behind.
    if (!delivered) {
      for (const connection of this.connections.values()) {
        connection.lastDeliveredSeq = this.actor.seqNumber;
      }
    }
  }
}

/** Exported for `multi-table-router.ts`, which parses the same bind frame shape to peek a ticket's `tableId` before this gateway ever sees the connection. */
export function parseJson(raw: string): unknown {
  try {
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export type { ClientFrame };
