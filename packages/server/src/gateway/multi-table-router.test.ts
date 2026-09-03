// A real end-to-end smoke test, the same discipline as ws-server.test.ts:
// an actual HTTP server, an actual WebSocketServer, and actual `ws`
// clients — proving that a ticket for table B is never handed to table
// A's gateway, and vice versa.
import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import WebSocket from "ws";
import { createDeterministicEntropy } from "../testing/deterministic-entropy.js";
import { TableManager } from "../tables/manager.js";
import { attachMultiTableGateway } from "./multi-table-router.js";

let httpServer: ReturnType<typeof createServer>;
let url: string;
let manager: TableManager;

beforeEach(async () => {
  httpServer = createServer();
  await new Promise<void>((resolve) => httpServer.listen(0, resolve));
  const { port } = httpServer.address() as AddressInfo;
  url = `ws://127.0.0.1:${port}/ws`;
  manager = new TableManager(createDeterministicEntropy(1));
});

afterEach(async () => {
  await new Promise<void>((resolve) => httpServer.close(() => resolve()));
});

function bindAndAwaitFirstFrame(ticket: string): Promise<Record<string, unknown>> {
  const client = new WebSocket(url);
  return new Promise<Record<string, unknown>>((resolve, reject) => {
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
    client.on("message", (data) => {
      resolve(JSON.parse(data.toString()));
      client.close();
    });
    client.on("error", reject);
  });
}

describe("attachMultiTableGateway — real socket routing", () => {
  it("routes a ticket to its own table's gateway, not another table's", async () => {
    const tableA = manager.create("table-a");
    const tableB = manager.create("table-b");
    tableA.actor.occupySeat("p-east-a", "East A");
    tableB.actor.occupySeat("p-east-b", "East B");
    attachMultiTableGateway({ server: httpServer, manager });

    const ticketA = tableA.tickets.issue({ accountId: "a", sessionId: "s1", tableId: "table-a", seat: "east" });
    const ticketB = tableB.tickets.issue({ accountId: "b", sessionId: "s2", tableId: "table-b", seat: "east" });

    const [boundA, boundB] = await Promise.all([bindAndAwaitFirstFrame(ticketA), bindAndAwaitFirstFrame(ticketB)]);

    expect(boundA).toEqual({ t: "bound", seat: "east", protocolVersion: 1, seq: 0 });
    expect(boundB).toEqual({ t: "bound", seat: "east", protocolVersion: 1, seq: 0 });
    expect(tableA.gateway.isConnected("east")).toBe(true);
    expect(tableB.gateway.isConnected("east")).toBe(true);
  });

  it("closes with 4002 TICKET_INVALID for a ticket naming no live table", async () => {
    attachMultiTableGateway({ server: httpServer, manager });
    const client = new WebSocket(url);
    const closeCode = await new Promise<number>((resolve) => {
      client.on("open", () => {
        client.send(JSON.stringify({ t: "cmd", cmd: "bind", cmdId: "x", cseq: 1, d: { ticket: "no-such-ticket" } }));
      });
      client.on("close", (code) => resolve(code));
    });
    expect(closeCode).toBe(4002);
  });

  it("closes with 4002 for a non-bind first frame (no ticket to resolve)", async () => {
    attachMultiTableGateway({ server: httpServer, manager });
    const client = new WebSocket(url);
    const closeCode = await new Promise<number>((resolve) => {
      client.on("open", () => {
        client.send(JSON.stringify({ t: "cmd", cmd: "ping", cmdId: "x", cseq: 1 }));
      });
      client.on("close", (code) => resolve(code));
    });
    expect(closeCode).toBe(4002);
  });

  it("closes with 4008 when the origin is not allowed", async () => {
    attachMultiTableGateway({ server: httpServer, manager, allowedOrigins: ["https://allowed.example"] });
    const client = new WebSocket(url, { headers: { Origin: "https://evil.example" } });
    const closeCode = await new Promise<number>((resolve) => {
      client.on("close", (code) => resolve(code));
    });
    expect(closeCode).toBe(4008);
  });
});
