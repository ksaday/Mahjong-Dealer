// Backpressure enforcement (docs/12_Realtime_WebSocket_Architecture.md §9):
// a slow consumer — bytes handed to the socket and not yet flushed past
// the 1 MB threshold — gets closed 4010, not left to accumulate unbounded
// server memory.
import { describe, expect, it } from "vitest";
import { MockSocket } from "../testing/mock-socket.js";
import { Connection } from "./connection.js";

function bigFrame(padLength: number): string {
  return JSON.stringify({ t: "event", pad: "x".repeat(padLength) });
}

describe("Connection backpressure (docs/12 §9)", () => {
  it("closes 4010 once unflushed bytes exceed the 1 MB threshold", () => {
    const socket = new MockSocket(/* stalled */ true);
    const connection = new Connection("east", "session-1", socket);

    connection.send(JSON.stringify({ t: "pong" }));
    expect(socket.isClosed).toBe(false);

    connection.send(bigFrame(1_000_001));

    expect(socket.closes).toEqual([{ code: 4010, reason: "SLOW_CONSUMER" }]);
  });

  it("never trips the threshold when the socket flushes immediately, no matter the volume", () => {
    const socket = new MockSocket();
    const connection = new Connection("east", "session-1", socket);

    for (let i = 0; i < 10; i += 1) {
      connection.send(bigFrame(500_000));
    }

    expect(socket.isClosed).toBe(false);
  });

  it("stops being a slow consumer once the backlog actually flushes", () => {
    const socket = new MockSocket(/* stalled */ true);
    const connection = new Connection("east", "session-1", socket);

    connection.send(bigFrame(600_000));
    expect(connection.isSlowConsumer).toBe(false);

    socket.flushAll();
    connection.send(bigFrame(600_000));
    expect(connection.isSlowConsumer).toBe(false);
    expect(socket.isClosed).toBe(false);
  });
});
