import { describe, expect, it } from "vitest";
import { SEAT_ORDER, type Seat } from "@mahjong-dealer/shared";
import { createDeterministicEntropy } from "../testing/deterministic-entropy.js";
import { MockSocket } from "../testing/mock-socket.js";
import { TableActor } from "../table/actor.js";
import { type ConnectionHandle, TableGateway } from "./gateway.js";
import { TicketStore } from "./tickets.js";

const VALID_CMD_ID_PREFIX = "018f3a2b-1c3d-7e4f-8a12-";

function cmdId(n: number): string {
  return `${VALID_CMD_ID_PREFIX}${n.toString(16).padStart(12, "0")}`;
}

interface BoundSeat {
  readonly socket: MockSocket;
  readonly handle: ConnectionHandle;
  send(frame: Record<string, unknown>): void;
}

function setUp() {
  const actor = new TableActor({ id: "t1", entropy: createDeterministicEntropy(1) });
  const tickets = new TicketStore();
  const gateway = new TableGateway({ actor, tickets });
  for (const seat of SEAT_ORDER) {
    const result = actor.occupySeat(`player-${seat}`, seat);
    if (!result.ok) throw new Error("unreachable");
  }
  return { actor, tickets, gateway };
}

let nextCmdIdCounter = 1000;

function bindSeat(gateway: TableGateway, tickets: TicketStore, seat: Seat): BoundSeat {
  const socket = new MockSocket();
  const handle = gateway.acceptConnection(socket);
  const ticket = tickets.issue({ accountId: `a-${seat}`, sessionId: `s-${seat}`, tableId: "t1", seat });
  handle.onMessage(JSON.stringify({ t: "cmd", cmd: "bind", cmdId: cmdId(0), cseq: 1, d: { ticket } }));
  // bind used cseq 1, but connection.cseq stays 0 through the pre-bind
  // path (docs/13 §5's counter starts once a connection is bound) — so
  // the first post-bind frame must be cseq 1, not 2.
  let cseq = 0;
  return {
    socket,
    handle,
    send: (frame) => {
      cseq += 1;
      nextCmdIdCounter += 1;
      handle.onMessage(JSON.stringify({ cmdId: cmdId(nextCmdIdCounter), cseq, ...frame }));
    },
  };
}

/**
 * Binds all four seats and drives the table to `in_play`, entirely through
 * the gateway — every command here must go through `send`, never
 * `actor.submit` directly, or the gateway's per-connection delivery
 * cursors (which only advance inside the gateway's own pipeline) fall out
 * of sync with `actor.seqNumber`, producing false staleness later.
 */
function setUpDealtGame() {
  const { actor, tickets, gateway } = setUp();
  const seats: Record<Seat, BoundSeat> = {} as Record<Seat, BoundSeat>;
  for (const seat of SEAT_ORDER) {
    seats[seat] = bindSeat(gateway, tickets, seat);
  }
  for (const seat of SEAT_ORDER) {
    seats[seat].send({ t: "cmd", cmd: "set_ready" });
  }
  seats.east.send({ t: "cmd", cmd: "start_deal" });
  return { actor, tickets, gateway, seats };
}

describe("bind (docs/12 §4.2)", () => {
  it("succeeds with a valid ticket and returns bound with the current seq", () => {
    const { gateway, tickets } = setUp();
    const { socket } = bindSeat(gateway, tickets, "east");
    expect(socket.framesOfType("bound")).toEqual([{ t: "bound", seat: "east", protocolVersion: 1, seq: 0 }]);
  });

  it("closes 4001 when the first frame is not bind", () => {
    const { gateway } = setUp();
    const socket = new MockSocket();
    const handle = gateway.acceptConnection(socket);
    handle.onMessage(JSON.stringify({ t: "cmd", cmd: "ping", cmdId: cmdId(0), cseq: 1 }));
    expect(socket.closes).toEqual([{ code: 4001, reason: "BIND_REQUIRED" }]);
  });

  it("closes 4002 for an invalid ticket", () => {
    const { gateway } = setUp();
    const socket = new MockSocket();
    const handle = gateway.acceptConnection(socket);
    handle.onMessage(
      JSON.stringify({ t: "cmd", cmd: "bind", cmdId: cmdId(0), cseq: 1, d: { ticket: "not-real" } }),
    );
    expect(socket.closes).toEqual([{ code: 4002, reason: "TICKET_INVALID" }]);
  });

  it("closes 4002 for an already-redeemed ticket (single use)", () => {
    const { gateway, tickets } = setUp();
    const ticket = tickets.issue({ accountId: "a", sessionId: "s", tableId: "t1", seat: "east" });
    const first = gateway.acceptConnection(new MockSocket());
    first.onMessage(JSON.stringify({ t: "cmd", cmd: "bind", cmdId: cmdId(0), cseq: 1, d: { ticket } }));

    const secondSocket = new MockSocket();
    const second = gateway.acceptConnection(secondSocket);
    second.onMessage(JSON.stringify({ t: "cmd", cmd: "bind", cmdId: cmdId(1), cseq: 1, d: { ticket } }));
    expect(secondSocket.closes).toEqual([{ code: 4002, reason: "TICKET_INVALID" }]);
  });

  it("closes 4001 once the bind deadline has passed", () => {
    let now = 0;
    const actor = new TableActor({ id: "t1", entropy: createDeterministicEntropy(1) });
    const gateway = new TableGateway({ actor, tickets: new TicketStore(30_000, () => now), now: () => now });
    const socket = new MockSocket();
    const handle = gateway.acceptConnection(socket);
    now = 6000;
    handle.checkBindDeadline();
    expect(socket.closes).toEqual([{ code: 4001, reason: "BIND_REQUIRED" }]);
  });

  it("replaces an existing connection on the same seat, closing the old one (D-12-10)", () => {
    const { gateway, tickets } = setUp();
    const { socket: firstSocket } = bindSeat(gateway, tickets, "east");
    bindSeat(gateway, tickets, "east");
    expect(firstSocket.closes).toEqual([{ code: 4003, reason: "REPLACED_BY_NEWER_BIND" }]);
  });
});

describe("cseq sequencing (docs/13 §5)", () => {
  it("closes 4008 on a gap", () => {
    const { gateway, tickets } = setUp();
    const socket = new MockSocket();
    const handle = gateway.acceptConnection(socket);
    const ticket = tickets.issue({ accountId: "a", sessionId: "s", tableId: "t1", seat: "east" });
    handle.onMessage(JSON.stringify({ t: "cmd", cmd: "bind", cmdId: cmdId(0), cseq: 1, d: { ticket } }));
    handle.onMessage(JSON.stringify({ t: "cmd", cmd: "ping", cmdId: cmdId(1), cseq: 5 }));
    expect(socket.closes).toEqual([{ code: 4008, reason: "PROTOCOL_VIOLATION" }]);
  });

  it("accepts a contiguous sequence", () => {
    const { gateway, tickets } = setUp();
    const { socket, send } = bindSeat(gateway, tickets, "east");
    send({ t: "cmd", cmd: "ping" });
    send({ t: "cmd", cmd: "ping" });
    expect(socket.closes).toHaveLength(0);
    expect(socket.framesOfType("pong")).toHaveLength(2);
  });
});

describe("cmdId idempotency (docs/13 §4)", () => {
  it("a retried cmdId returns the original outcome without reapplying", () => {
    const { actor, seats } = setUpDealtGame();

    const state = actor.gameStateSnapshot;
    if (state.lifecycle !== "in_play") throw new Error("unreachable");
    const handle = state.locations.hands.east[0]!;

    const discardCmdId = cmdId(500);
    seats.east.send({ t: "cmd", cmd: "discard_tile", cmdId: discardCmdId, d: { handle } });
    const afterFirst = actor.gameStateSnapshot;
    if (afterFirst.lifecycle !== "in_play") throw new Error("unreachable");
    expect(afterFirst.locations.discards).toHaveLength(1);

    seats.east.send({ t: "cmd", cmd: "discard_tile", cmdId: discardCmdId, d: { handle } });
    const afterRetry = actor.gameStateSnapshot;
    if (afterRetry.lifecycle !== "in_play") throw new Error("unreachable");
    // Still exactly one discard: the retry did not re-apply the command.
    expect(afterRetry.locations.discards).toHaveLength(1);

    const acks = seats.east.socket.framesOfType("ack").filter((f) => f["cmdId"] === discardCmdId);
    expect(acks).toHaveLength(2);
    expect(acks[0]).toEqual(acks[1]);
  });
});

describe("schema validation (docs/13 §8.2 — structural only)", () => {
  it("rejects a malformed command without closing the connection", () => {
    const { gateway, tickets } = setUp();
    const { socket, send } = bindSeat(gateway, tickets, "east");
    send({ t: "cmd", cmd: "draw_tile", d: { end: "sideways" } });
    expect(socket.framesOfType("reject")).toEqual([expect.objectContaining({ code: "MALFORMED" })]);
    expect(socket.closes).toHaveLength(0);
  });

  it("rejects an unknown command name as MALFORMED", () => {
    const { gateway, tickets } = setUp();
    const { socket, send } = bindSeat(gateway, tickets, "east");
    send({ t: "cmd", cmd: "sort_hand" });
    expect(socket.framesOfType("reject")).toEqual([expect.objectContaining({ code: "MALFORMED" })]);
  });
});

describe("staleness (docs/13 §6) — the check itself, via direct cursor manipulation", () => {
  it("rejects a sensitive command whose connection has not been delivered the latest seq", () => {
    const { actor, gateway, seats } = setUpDealtGame();

    // Simulate a connection that has fallen behind the table's current seq
    // (docs/26 §3.1's "reach into state for assertions/injection" pattern —
    // in a real deployment this would arise from a slow or briefly-dropped
    // socket, which this synchronous test setup cannot otherwise produce).
    const connection = gateway.connectionFor("east");
    if (connection === undefined) throw new Error("unreachable");
    connection.lastDeliveredSeq -= 1;

    const state = actor.gameStateSnapshot;
    if (state.lifecycle !== "in_play") throw new Error("unreachable");
    seats.east.send({
      t: "cmd",
      cmd: "claim_discard",
      d: { handle: state.locations.hands.south[0]! },
    });

    expect(seats.east.socket.framesOfType("reject")).toEqual([
      expect.objectContaining({ code: "STALE_STATE" }),
    ]);
  });

  it("does not falsely flag every connection as stale after a silent command (arrange_hand)", () => {
    const { actor, seats } = setUpDealtGame();

    const state = actor.gameStateSnapshot;
    if (state.lifecycle !== "in_play") throw new Error("unreachable");
    const reordered = state.locations.hands.east.slice().reverse();
    seats.east.send({ t: "cmd", cmd: "arrange_hand", d: { handles: reordered } });

    const afterArrange = actor.gameStateSnapshot;
    if (afterArrange.lifecycle !== "in_play") throw new Error("unreachable");
    seats.east.send({
      t: "cmd",
      cmd: "claim_discard",
      d: { handle: afterArrange.locations.hands.south[0]! },
    });
    // Not stale: arrange_hand advanced seq but broadcast nothing, so
    // deliverNewFrames's fallback should have kept every cursor current.
    expect(
      seats.east.socket.framesOfType("reject").filter((f) => f["code"] === "STALE_STATE"),
    ).toHaveLength(0);
  });
});

describe("resumption (docs/12 §8)", () => {
  it("replays backlog events since lastSeq, then sends resumed", () => {
    const { actor, gateway, tickets, seats } = setUpDealtGame();
    const seqAfterDeal = actor.seqNumber;

    seats.east.send({ t: "cmd", cmd: "draw_tile", d: { end: "head" } });

    // A fresh connection for north, resuming from right after the deal.
    const socket = new MockSocket();
    const handle = gateway.acceptConnection(socket);
    const ticket = tickets.issue({ accountId: "a", sessionId: "s", tableId: "t1", seat: "north" });
    handle.onMessage(JSON.stringify({ t: "cmd", cmd: "bind", cmdId: cmdId(0), cseq: 1, d: { ticket } }));
    handle.onMessage(
      JSON.stringify({ t: "cmd", cmd: "resume", cmdId: cmdId(1), cseq: 1, d: { lastSeq: seqAfterDeal } }),
    );

    const events = socket.framesOfType("event");
    expect(events.length).toBeGreaterThan(0);
    expect(socket.framesOfType("resumed")).toHaveLength(1);
  });

  it("sends a full view once the gap exceeds the 200-event backlog (docs/12 §8)", () => {
    const { actor, gateway, tickets } = setUpDealtGame();
    const seqAfterDeal = actor.seqNumber;

    // Push well past the 200-event backlog depth. Direct actor.submit calls
    // (not seats.east.send) deliberately bypass the gateway's rate limiter
    // — correctly throttling 205 instantaneous sends is its own behavior
    // and would otherwise mean fewer than 200 of these ever land. Nothing
    // else in this test depends on any existing connection's cursor, so
    // bypassing the gateway for this bulk traffic is safe here (unlike the
    // staleness tests above, which is exactly why setUpDealtGame's own
    // helper insists on routing through the gateway instead).
    for (let i = 0; i < 205; i += 1) {
      actor.submit("east", "send_table_message", { text: "x" });
    }

    const socket = new MockSocket();
    const handle = gateway.acceptConnection(socket);
    const ticket = tickets.issue({ accountId: "a", sessionId: "s", tableId: "t1", seat: "north" });
    handle.onMessage(JSON.stringify({ t: "cmd", cmd: "bind", cmdId: cmdId(0), cseq: 1, d: { ticket } }));
    handle.onMessage(
      JSON.stringify({ t: "cmd", cmd: "resume", cmdId: cmdId(1), cseq: 1, d: { lastSeq: seqAfterDeal } }),
    );

    const resumed = socket.framesOfType("resumed");
    expect(resumed).toHaveLength(1);
    expect(resumed[0]).toHaveProperty("view");
    expect(socket.framesOfType("event")).toHaveLength(0); // no backlog replay, straight to a snapshot
  });
});

describe("rate limiting (docs/13 §10)", () => {
  it("throttles beyond the token bucket, then closes after the consecutive-throttle limit", () => {
    let now = 0;
    const actor = new TableActor({ id: "t1", entropy: createDeterministicEntropy(1) });
    const tickets = new TicketStore(30_000, () => now);
    const gateway = new TableGateway({ actor, tickets, now: () => now });
    for (const seat of SEAT_ORDER) actor.occupySeat(`p-${seat}`, seat);

    const socket = new MockSocket();
    const handle = gateway.acceptConnection(socket);
    const ticket = tickets.issue({ accountId: "a", sessionId: "s", tableId: "t1", seat: "east" });
    handle.onMessage(JSON.stringify({ t: "cmd", cmd: "bind", cmdId: cmdId(0), cseq: 1, d: { ticket } }));

    // Burst capacity is 10; sending 40 with no elapsed time exhausts it
    // and should eventually close after 20 consecutive throttled attempts.
    for (let i = 1; i <= 40 && !socket.isClosed; i += 1) {
      handle.onMessage(JSON.stringify({ t: "cmd", cmd: "ping", cmdId: cmdId(i), cseq: i }));
    }
    expect(socket.closes).toEqual([{ code: 4009, reason: "RATE_LIMITED" }]);
  });
});

describe("checkSessionRevocation (docs/12 §4.3)", () => {
  it("closes a bound connection with 4004 once its session is no longer active", async () => {
    const actor = new TableActor({ id: "t1", entropy: createDeterministicEntropy(1) });
    const tickets = new TicketStore();
    const sessionActive = new Map<string, boolean>([["s-active", true], ["s-revoked", false]]);
    const gateway = new TableGateway({
      actor,
      tickets,
      isSessionActive: (sessionId) => Promise.resolve(sessionActive.get(sessionId) ?? false),
    });
    for (const seat of SEAT_ORDER) actor.occupySeat(`p-${seat}`, seat);

    const staying = new MockSocket();
    gateway.acceptConnection(staying).onMessage(
      JSON.stringify({
        t: "cmd",
        cmd: "bind",
        cmdId: cmdId(0),
        cseq: 1,
        d: { ticket: tickets.issue({ accountId: "a", sessionId: "s-active", tableId: "t1", seat: "east" }) },
      }),
    );
    const leaving = new MockSocket();
    gateway.acceptConnection(leaving).onMessage(
      JSON.stringify({
        t: "cmd",
        cmd: "bind",
        cmdId: cmdId(1),
        cseq: 1,
        d: { ticket: tickets.issue({ accountId: "b", sessionId: "s-revoked", tableId: "t1", seat: "south" }) },
      }),
    );

    await gateway.checkSessionRevocation();

    expect(leaving.closes).toEqual([{ code: 4004, reason: "SESSION_REVOKED" }]);
    expect(staying.isClosed).toBe(false);
    expect(gateway.isConnected("south")).toBe(false);
    expect(gateway.isConnected("east")).toBe(true);
  });

  it("is a no-op with no isSessionActive checker configured", async () => {
    const { tickets, gateway } = setUp();
    const bound = bindSeat(gateway, tickets, "east");
    await gateway.checkSessionRevocation();
    expect(bound.socket.isClosed).toBe(false);
  });

  it("a mid-flight rebind is not wrongly evicted by a stale, still-pending check", async () => {
    const actor = new TableActor({ id: "t1", entropy: createDeterministicEntropy(1) });
    const tickets = new TicketStore();
    let resolveCheck: (active: boolean) => void = () => {
      throw new Error("unreachable");
    };
    const gateway = new TableGateway({
      actor,
      tickets,
      isSessionActive: () => new Promise<boolean>((resolve) => (resolveCheck = resolve)),
    });
    actor.occupySeat("p-east", "east");

    const first = new MockSocket();
    gateway.acceptConnection(first).onMessage(
      JSON.stringify({
        t: "cmd",
        cmd: "bind",
        cmdId: cmdId(0),
        cseq: 1,
        d: { ticket: tickets.issue({ accountId: "a", sessionId: "s1", tableId: "t1", seat: "east" }) },
      }),
    );

    const pending = gateway.checkSessionRevocation(); // begins awaiting isSessionActive("s1")

    // While that check is still in flight, a newer bind replaces "east".
    const second = new MockSocket();
    gateway.acceptConnection(second).onMessage(
      JSON.stringify({
        t: "cmd",
        cmd: "bind",
        cmdId: cmdId(1),
        cseq: 1,
        d: { ticket: tickets.issue({ accountId: "a", sessionId: "s2", tableId: "t1", seat: "east" }) },
      }),
    );
    expect(first.closes).toEqual([{ code: 4003, reason: "REPLACED_BY_NEWER_BIND" }]);

    resolveCheck(false); // the stale check for the *old* connection resolves "inactive"
    await pending;

    // The stale check must not evict the replacement: connections.get("east")
    // no longer points at `first`, so the identity guard must skip it.
    expect(gateway.isConnected("east")).toBe(true);
    expect(second.closes).toHaveLength(0);
  });
});

/** `paused` only exists on `InPlayGameState`/`ConcludingGameState` — narrows the discriminated union for the assertions below. */
function pausedBy(actor: TableActor): Seat | null {
  const state = actor.gameStateSnapshot;
  if (state.lifecycle !== "in_play" && state.lifecycle !== "concluding") return null;
  return state.paused?.requestedBy ?? null;
}

describe("auto-pause on disconnection (docs/22 §5)", () => {
  it("pauses the table when a bound seat's connection closes during play", () => {
    const { actor, seats } = setUpDealtGame();
    seats.east.handle.onClose();

    expect(pausedBy(actor)).toBe("east");
    const paused = seats.south.socket.framesOfType("event").find(
      (f) => (f["ev"] as Record<string, unknown>)["type"] === "TablePaused",
    );
    // reason is "requested", not docs/22 §5's "seat_absent" — a known,
    // separately-flagged gap (see autoPauseOnAbsence's own doc comment):
    // dealer-core's request_pause carries no reason to distinguish the two.
    expect(paused).toEqual(
      expect.objectContaining({ ev: { type: "TablePaused", seat: "east", reason: "requested" } }),
    );
  });

  it("clears the pause when the same seat rebinds, and does not touch an unrelated pause", () => {
    const { actor, tickets, gateway, seats } = setUpDealtGame();
    seats.east.handle.onClose();
    expect(pausedBy(actor)).toBe("east");

    bindSeat(gateway, tickets, "east"); // reconnect
    expect(pausedBy(actor)).toBeNull();

    const resumed = seats.south.socket.framesOfType("event").find(
      (f) => (f["ev"] as Record<string, unknown>)["type"] === "TableResumed",
    );
    expect(resumed).toEqual(
      expect.objectContaining({ ev: { type: "TableResumed", seat: "east" } }),
    );
  });

  it("does not let a returning seat clear a different seat's own pause", () => {
    const { actor, tickets, gateway, seats } = setUpDealtGame();
    seats.south.send({ t: "cmd", cmd: "request_pause" }); // south pauses deliberately, while still connected
    expect(pausedBy(actor)).toBe("south");

    seats.east.handle.onClose(); // east's own auto-pause is rejected — already paused by south
    bindSeat(gateway, tickets, "east"); // east's own auto-resume is rejected too — not east's pause to clear

    expect(pausedBy(actor)).toBe("south");
  });

  it("is a harmless no-op outside in_play/concluding (no game started)", () => {
    const { actor, tickets, gateway } = setUp();
    const east = bindSeat(gateway, tickets, "east");
    expect(() => east.handle.onClose()).not.toThrow();
    expect(actor.gameStateSnapshot.lifecycle).toBe("idle");
  });
});
