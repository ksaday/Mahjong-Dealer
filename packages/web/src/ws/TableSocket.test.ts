// @vitest-environment jsdom
import { describe, expect, it } from "vitest";
import { TableSocket, type TableSocketEvent, type WebSocketLike } from "./TableSocket.js";

const UUID_V7_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;

// A `WebSocketLike` test double — no real network, mirroring the
// discipline of the server's own `MockSocket` (server/src/testing/mock-socket.ts).
class MockWebSocket implements WebSocketLike {
  readonly sent: Record<string, unknown>[] = [];
  private openListener: (() => void) | null = null;
  private messageListener: ((event: { readonly data: unknown }) => void) | null = null;
  private closeListener: ((event: { readonly code: number; readonly reason: string }) => void) | null = null;

  addEventListener(type: string, listener: (...args: never[]) => void): void {
    if (type === "open") this.openListener = listener as () => void;
    if (type === "message") this.messageListener = listener as (event: { readonly data: unknown }) => void;
    if (type === "close") this.closeListener = listener as (event: { readonly code: number; readonly reason: string }) => void;
  }

  send(data: string): void {
    this.sent.push(JSON.parse(data) as Record<string, unknown>);
  }

  close(): void {
    // no-op for this double
  }

  simulateOpen(): void {
    this.openListener?.();
  }

  simulateMessage(frame: unknown): void {
    this.messageListener?.({ data: JSON.stringify(frame) });
  }

  simulateClose(code: number, reason: string): void {
    this.closeListener?.({ code, reason });
  }
}

function setUp() {
  const socket = new MockWebSocket();
  const events: TableSocketEvent[] = [];
  const tableSocket = new TableSocket("wss://example.test/ws", "the-ticket", (event) => events.push(event), {
    factory: () => socket,
  });
  return { socket, events, tableSocket };
}

describe("TableSocket (docs/12_Realtime_WebSocket_Architecture.md)", () => {
  it("sends bind with the ticket on open", () => {
    const { socket } = setUp();
    socket.simulateOpen();

    expect(socket.sent).toHaveLength(1);
    expect(socket.sent[0]).toMatchObject({ t: "cmd", cmd: "bind", d: { ticket: "the-ticket" } });
    expect(socket.sent[0]?.["cmdId"]).toMatch(UUID_V7_PATTERN);
  });

  it("sends resume with cseq 1 immediately after bound, and is ready only after resumed", () => {
    const { socket, events, tableSocket } = setUp();
    socket.simulateOpen();
    socket.simulateMessage({ t: "bound", seat: "east", protocolVersion: 1, seq: 42 });

    expect(socket.sent).toHaveLength(2);
    expect(socket.sent[1]).toMatchObject({ t: "cmd", cmd: "resume", cseq: 1, d: { lastSeq: 0 } });
    expect(events.map((e) => e.type)).toEqual(["bound"]);

    expect(() => tableSocket.send("ping")).toThrow();

    socket.simulateMessage({ t: "resumed", seq: 42 });
    expect(events.map((e) => e.type)).toEqual(["bound", "resumed"]);

    expect(() => tableSocket.send("ping")).not.toThrow();
  });

  it("continues cseq from 1 across commands sent after resumption", () => {
    const { socket, tableSocket } = setUp();
    socket.simulateOpen();
    socket.simulateMessage({ t: "bound", seat: "east", protocolVersion: 1, seq: 0 });
    socket.simulateMessage({ t: "resumed", seq: 0 });

    tableSocket.send("ping");
    tableSocket.send("set_ready");

    const pingFrame = socket.sent.find((f) => f["cmd"] === "ping");
    const readyFrame = socket.sent.find((f) => f["cmd"] === "set_ready");
    expect(pingFrame?.["cseq"]).toBe(2); // resume itself took cseq 1
    expect(readyFrame?.["cseq"]).toBe(3);
    expect(readyFrame?.["d"]).toBeUndefined();
  });

  it("reuses one cmdId per call, generating a fresh one only per send()", () => {
    const { tableSocket, socket } = setUp();
    socket.simulateOpen();
    socket.simulateMessage({ t: "bound", seat: "east", protocolVersion: 1, seq: 0 });
    socket.simulateMessage({ t: "resumed", seq: 0 });

    const cmdId = tableSocket.send("ping");
    expect(cmdId).toMatch(UUID_V7_PATTERN);
    expect(socket.sent.find((f) => f["cmd"] === "ping")?.["cmdId"]).toBe(cmdId);
  });

  it("dispatches event/ack/reject/notice frames as-is", () => {
    const { socket, events } = setUp();
    socket.simulateOpen();
    socket.simulateMessage({ t: "bound", seat: "east", protocolVersion: 1, seq: 0 });
    socket.simulateMessage({ t: "resumed", seq: 0 });

    socket.simulateMessage({ t: "ack", cmdId: "x", seq: 1 });
    socket.simulateMessage({ t: "reject", cmdId: "y", code: "NOT_YOUR_TURN", message: "not your turn" });
    socket.simulateMessage({ t: "notice", kind: "service_restarting", d: {} });
    socket.simulateMessage({ t: "pong" });

    expect(events.map((e) => e.type)).toEqual(["bound", "resumed", "ack", "reject", "notice", "pong"]);
  });

  it("surfaces a close as a closed event", () => {
    const { socket, events } = setUp();
    socket.simulateClose(4004, "SESSION_REVOKED");

    expect(events).toEqual([{ type: "closed", code: 4004, reason: "SESSION_REVOKED" }]);
  });
});
