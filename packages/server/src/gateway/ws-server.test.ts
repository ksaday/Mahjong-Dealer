// A real end-to-end smoke test: an actual HTTP server, an actual
// WebSocketServer, and an actual `ws` client — proving the adapter wiring
// itself works, not just the transport-agnostic logic `gateway.test.ts`
// already covers with `MockSocket`.
import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { SEAT_ORDER } from "@mahjong-dealer/shared";
import WebSocket from "ws";
import { createDeterministicEntropy } from "../testing/deterministic-entropy.js";
import { TableActor } from "../table/actor.js";
import { TableGateway } from "./gateway.js";
import { TicketStore } from "./tickets.js";
import { attachWebSocketGateway, startHeartbeat, type HeartbeatSocket } from "./ws-server.js";

let httpServer: ReturnType<typeof createServer>;
let url: string;

beforeEach(async () => {
  httpServer = createServer();
  await new Promise<void>((resolve) => httpServer.listen(0, resolve));
  const { port } = httpServer.address() as AddressInfo;
  url = `ws://127.0.0.1:${port}/ws`;
});

afterEach(async () => {
  await new Promise<void>((resolve) => httpServer.close(() => resolve()));
});

describe("attachWebSocketGateway — real socket smoke test", () => {
  it("binds over a real WebSocket and receives a bound frame", async () => {
    const actor = new TableActor({ id: "t1", entropy: createDeterministicEntropy(1) });
    for (const seat of SEAT_ORDER) actor.occupySeat(`p-${seat}`, seat);
    const tickets = new TicketStore();
    const gateway = new TableGateway({ actor, tickets });
    attachWebSocketGateway({ server: httpServer, gateway });

    const ticket = tickets.issue({ accountId: "a", sessionId: "s", tableId: "t1", seat: "east" });
    const client = new WebSocket(url);

    const bound = await new Promise<Record<string, unknown>>((resolve, reject) => {
      client.on("open", () => {
        client.send(
          JSON.stringify({
            t: "cmd",
            cmd: "bind",
            cmdId: "018f3a2b-1c3d-7e4f-8a12-000000000000",
            cseq: 1,
            d: { ticket },
          }),
        );
      });
      client.on("message", (data) => resolve(JSON.parse(data.toString())));
      client.on("error", reject);
    });

    // seq is 4, not 0: the shared gateway occupies all four seats before this
    // test binds, and occupySeat now broadcasts SeatOccupied (docs/19 §6.1, FR-140).
    expect(bound).toEqual({ t: "bound", seat: "east", protocolVersion: 1, seq: 4 });
    client.close();
  });

  it("closes with 4008 when the origin is not allowed", async () => {
    const actor = new TableActor({ id: "t1", entropy: createDeterministicEntropy(1) });
    const tickets = new TicketStore();
    const gateway = new TableGateway({ actor, tickets });
    attachWebSocketGateway({ server: httpServer, gateway, allowedOrigins: ["https://allowed.example"] });

    const client = new WebSocket(url, { headers: { Origin: "https://evil.example" } });
    const closeCode = await new Promise<number>((resolve) => {
      client.on("close", (code) => resolve(code));
    });
    expect(closeCode).toBe(4008);
  });
});

describe("session-revocation polling (docs/12 §4.3)", () => {
  it("closes a bound real socket with 4004 once its session is reported inactive", async () => {
    const actor = new TableActor({ id: "t1", entropy: createDeterministicEntropy(1) });
    for (const seat of SEAT_ORDER) actor.occupySeat(`p-${seat}`, seat);
    const tickets = new TicketStore();
    let active = true;
    const gateway = new TableGateway({ actor, tickets, isSessionActive: () => Promise.resolve(active) });
    attachWebSocketGateway({ server: httpServer, gateway, sessionRevocationPollMs: 20 });

    const ticket = tickets.issue({ accountId: "a", sessionId: "s", tableId: "t1", seat: "east" });
    const client = new WebSocket(url);
    await new Promise<void>((resolve, reject) => {
      client.on("open", () => {
        client.send(
          JSON.stringify({
            t: "cmd",
            cmd: "bind",
            cmdId: "018f3a2b-1c3d-7e4f-8a12-000000000001",
            cseq: 1,
            d: { ticket },
          }),
        );
      });
      client.on("message", () => resolve()); // the "bound" frame
      client.on("error", reject);
    });

    active = false;
    const closeCode = await new Promise<number>((resolve) => {
      client.on("close", (code) => resolve(code));
    });
    expect(closeCode).toBe(4004);
  });
});

describe("heartbeats (docs/12 §7)", () => {
  it("a real, responsive connection survives several heartbeat intervals", async () => {
    const actor = new TableActor({ id: "t1", entropy: createDeterministicEntropy(1) });
    for (const seat of SEAT_ORDER) actor.occupySeat(`p-${seat}`, seat);
    const tickets = new TicketStore();
    const gateway = new TableGateway({ actor, tickets });
    attachWebSocketGateway({ server: httpServer, gateway, heartbeatIntervalMs: 20 });

    const ticket = tickets.issue({ accountId: "a", sessionId: "s", tableId: "t1", seat: "east" });
    const client = new WebSocket(url);
    await new Promise<void>((resolve, reject) => {
      client.on("open", () => {
        client.send(
          JSON.stringify({
            t: "cmd",
            cmd: "bind",
            cmdId: "018f3a2b-1c3d-7e4f-8a12-000000000002",
            cseq: 1,
            d: { ticket },
          }),
        );
      });
      client.on("message", () => resolve()); // the "bound" frame
      client.on("error", reject);
    });

    let closed = false;
    client.on("close", () => (closed = true));
    // `ws` clients answer protocol-level pings automatically; several
    // intervals' worth of real elapsed time should never trip termination.
    await new Promise((resolve) => setTimeout(resolve, 120));
    expect(closed).toBe(false);
    client.close();
  });
});

describe("startHeartbeat (unit — docs/12 §7)", () => {
  function fakeSocket() {
    const pings: number[] = [];
    let terminated = false;
    let pongListener: (() => void) | null = null;
    const socket: HeartbeatSocket = {
      on(event, listener) {
        if (event === "pong") pongListener = listener;
        return socket;
      },
      ping() {
        pings.push(pings.length);
      },
      terminate() {
        terminated = true;
      },
    };
    return {
      socket,
      pingCount: () => pings.length,
      isTerminated: () => terminated,
      sendPong: () => pongListener?.(),
    };
  }

  it("terminates after two consecutive missed pongs, not after one", async () => {
    const { socket, isTerminated } = fakeSocket();
    const stop = startHeartbeat(socket, 10);
    try {
      await new Promise((resolve) => setTimeout(resolve, 15)); // 1st ping sent, no pong
      expect(isTerminated()).toBe(false);
      await new Promise((resolve) => setTimeout(resolve, 10)); // 2nd tick: 1 miss recorded, 2nd ping sent
      expect(isTerminated()).toBe(false);
      await new Promise((resolve) => setTimeout(resolve, 10)); // 3rd tick: 2nd miss recorded -> terminate
      expect(isTerminated()).toBe(true);
    } finally {
      stop();
    }
  });

  it("a pong resets the miss count, so an intermittently-responsive connection is never terminated", async () => {
    const { socket, isTerminated, sendPong } = fakeSocket();
    const stop = startHeartbeat(socket, 10);
    try {
      await new Promise((resolve) => setTimeout(resolve, 15));
      sendPong(); // answers before the next tick counts a miss
      await new Promise((resolve) => setTimeout(resolve, 10));
      expect(isTerminated()).toBe(false);
      sendPong();
      await new Promise((resolve) => setTimeout(resolve, 10));
      expect(isTerminated()).toBe(false);
    } finally {
      stop();
    }
  });

  it("stop() clears the timer so no further pings or terminations occur", async () => {
    const { socket, pingCount, isTerminated } = fakeSocket();
    const stop = startHeartbeat(socket, 10);
    await new Promise((resolve) => setTimeout(resolve, 15));
    stop();
    const countAtStop = pingCount();
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(pingCount()).toBe(countAtStop);
    expect(isTerminated()).toBe(false);
  });

  it("onMiss fires exactly once, on the first missed pong — not the second (docs/22 §4's away vs absent)", async () => {
    const { socket, isTerminated } = fakeSocket();
    const onMiss = vi.fn();
    const stop = startHeartbeat(socket, 10, onMiss);
    try {
      await new Promise((resolve) => setTimeout(resolve, 15)); // 1st ping sent, no pong
      expect(onMiss).not.toHaveBeenCalled();
      await new Promise((resolve) => setTimeout(resolve, 10)); // 2nd tick: 1st miss recorded -> onMiss
      expect(onMiss).toHaveBeenCalledTimes(1);
      await new Promise((resolve) => setTimeout(resolve, 10)); // 3rd tick: 2nd miss -> terminate, not onMiss again
      expect(isTerminated()).toBe(true);
      expect(onMiss).toHaveBeenCalledTimes(1);
    } finally {
      stop();
    }
  });

  it("onMiss never fires when every pong arrives in time", async () => {
    const { socket, sendPong } = fakeSocket();
    const onMiss = vi.fn();
    const stop = startHeartbeat(socket, 10, onMiss);
    try {
      await new Promise((resolve) => setTimeout(resolve, 15));
      sendPong();
      await new Promise((resolve) => setTimeout(resolve, 10));
      sendPong();
      await new Promise((resolve) => setTimeout(resolve, 10));
      expect(onMiss).not.toHaveBeenCalled();
    } finally {
      stop();
    }
  });
});
