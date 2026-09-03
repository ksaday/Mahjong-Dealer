// A real end-to-end smoke test: an actual HTTP server, an actual
// WebSocketServer, and an actual `ws` client — proving the adapter wiring
// itself works, not just the transport-agnostic logic `gateway.test.ts`
// already covers with `MockSocket`.
import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { SEAT_ORDER } from "@mahjong-dealer/shared";
import WebSocket from "ws";
import { createDeterministicEntropy } from "../testing/deterministic-entropy.js";
import { TableActor } from "../table/actor.js";
import { TableGateway } from "./gateway.js";
import { TicketStore } from "./tickets.js";
import { attachWebSocketGateway } from "./ws-server.js";

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

    expect(bound).toEqual({ t: "bound", seat: "east", protocolVersion: 1, seq: 0 });
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
