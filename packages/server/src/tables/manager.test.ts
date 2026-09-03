import { describe, expect, it } from "vitest";
import { createDeterministicEntropy } from "../testing/deterministic-entropy.js";
import { MockSocket } from "../testing/mock-socket.js";
import { TableManager } from "./manager.js";

describe("TableManager.shutdownAll (docs/21 §7 graceful shutdown)", () => {
  it("notifies every live table's connected seats and closes their sockets", () => {
    const manager = new TableManager(createDeterministicEntropy(1));
    const one = manager.create("t1");
    const two = manager.create("t2");
    one.actor.occupySeat("player-1", "east");
    two.actor.occupySeat("player-2", "east");

    const socketOne = new MockSocket();
    const handleOne = one.gateway.acceptConnection(socketOne);
    const ticketOne = one.tickets.issue({ accountId: "a1", sessionId: "s1", tableId: "t1", seat: "east" });
    handleOne.onMessage(JSON.stringify({ t: "cmd", cmd: "bind", cmdId: "018f3a2b-1c3d-7e4f-8a12-000000000001", cseq: 1, d: { ticket: ticketOne } }));

    const socketTwo = new MockSocket();
    const handleTwo = two.gateway.acceptConnection(socketTwo);
    const ticketTwo = two.tickets.issue({ accountId: "a2", sessionId: "s2", tableId: "t2", seat: "east" });
    handleTwo.onMessage(JSON.stringify({ t: "cmd", cmd: "bind", cmdId: "018f3a2b-1c3d-7e4f-8a12-000000000002", cseq: 1, d: { ticket: ticketTwo } }));

    manager.shutdownAll();

    for (const socket of [socketOne, socketTwo]) {
      expect(socket.framesOfType("notice")).toEqual([{ t: "notice", kind: "service_restarting", d: {} }]);
      expect(socket.closes).toEqual([{ code: 1012, reason: "SERVICE_RESTART" }]);
    }
  });

  it("is a no-op with no live tables", () => {
    const manager = new TableManager(createDeterministicEntropy(1));
    expect(() => manager.shutdownAll()).not.toThrow();
  });
});
