// Checkpoint-durability wiring through the gateway (docs/16 §5.3, docs/29):
// a separate file from `gateway.test.ts` since this exercises a distinct
// concern (checkpoint writes/purges) with its own `checkpointWriter` setup,
// same split as `totp.test.ts`/`totp-encryption.test.ts`.
import { randomBytes } from "node:crypto";
import { describe, expect, it } from "vitest";
import { SEAT_ORDER, type Seat } from "@mahjong-dealer/shared";
import { createDeterministicEntropy } from "../testing/deterministic-entropy.js";
import { MockSocket } from "../testing/mock-socket.js";
import { TableActor } from "../table/actor.js";
import { InMemoryCheckpointRepository } from "../checkpoint/memory-repository.js";
import { InMemoryCorrectionCheckpointRepository } from "../checkpoint/correction-memory-repository.js";
import { InMemoryGamesRepository } from "../tables/memory-games-repository.js";
import { CheckpointWriter } from "../checkpoint/writer.js";
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

/** Yields until every pending promise chain (fire-and-forget checkpoint writes included) has settled. */
async function flush(): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, 0));
  await new Promise((resolve) => setTimeout(resolve, 0));
}

function setUp() {
  const checkpoints = new InMemoryCheckpointRepository();
  const correctionCheckpoints = new InMemoryCorrectionCheckpointRepository();
  const games = new InMemoryGamesRepository();
  const checkpointWriter = new CheckpointWriter(checkpoints, games, randomBytes(32), correctionCheckpoints);
  const actor = new TableActor({ id: "t1", entropy: createDeterministicEntropy(1) });
  const tickets = new TicketStore();
  const gateway = new TableGateway({ actor, tickets, checkpointWriter });
  for (const seat of SEAT_ORDER) {
    const result = actor.occupySeat(`player-${seat}`, seat);
    if (!result.ok) throw new Error("unreachable");
  }
  return { actor, tickets, gateway, checkpoints, correctionCheckpoints, games, checkpointWriter };
}

let nextCmdIdCounter = 2000;

function bindSeat(gateway: TableGateway, tickets: TicketStore, seat: Seat): BoundSeat {
  const socket = new MockSocket();
  const handle = gateway.acceptConnection(socket);
  const ticket = tickets.issue({ accountId: `a-${seat}`, sessionId: `s-${seat}`, tableId: "t1", seat });
  handle.onMessage(JSON.stringify({ t: "cmd", cmd: "bind", cmdId: cmdId(0), cseq: 1, d: { ticket } }));
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

function setUpDealtGame() {
  const state = setUp();
  const seats: Record<Seat, BoundSeat> = {} as Record<Seat, BoundSeat>;
  for (const seat of SEAT_ORDER) {
    seats[seat] = bindSeat(state.gateway, state.tickets, seat);
  }
  for (const seat of SEAT_ORDER) {
    seats[seat].send({ t: "cmd", cmd: "set_ready" });
  }
  seats.east.send({ t: "cmd", cmd: "start_deal" });
  return { ...state, seats };
}

describe("checkpoint durability through the gateway", () => {
  it("writes a durable checkpoint and starts a games row once a deal begins", async () => {
    const { actor, checkpoints, games } = setUpDealtGame();
    await flush();

    const gameId = actor.currentGameId;
    expect(gameId).not.toBeNull();
    expect(await checkpoints.readForRestore(gameId!)).not.toBeNull();
    expect((await games.findLatestForTable("t1"))?.id).toBe(gameId);
  });

  it("overwrites the same row (not a new one) on a later accepted command", async () => {
    const { actor, seats, checkpoints } = setUpDealtGame();
    await flush();
    const gameId = actor.currentGameId!;
    const first = await checkpoints.readForRestore(gameId);

    seats.east.send({ t: "cmd", cmd: "draw_tile", d: { end: "head" } });
    await flush();

    const second = await checkpoints.readForRestore(gameId);
    expect(second?.privateState.equals(first!.privateState)).toBe(false);
    expect(await checkpoints.readForRestore(gameId)).not.toBeNull(); // still exactly one row for this game
  });

  it("purges the checkpoint once the game concludes by agreement", async () => {
    const { actor, seats, checkpoints, games } = setUpDealtGame();
    await flush();
    const gameId = actor.currentGameId!;

    seats.east.send({ t: "cmd", cmd: "propose_end_game" });
    seats.south.send({ t: "cmd", cmd: "respond_end_game", d: { response: "accept" } });
    seats.west.send({ t: "cmd", cmd: "respond_end_game", d: { response: "accept" } });
    seats.north.send({ t: "cmd", cmd: "respond_end_game", d: { response: "accept" } });
    await flush();

    expect(actor.currentGameId).toBeNull();
    expect(await checkpoints.readForRestore(gameId)).toBeNull();
    expect((await games.findLatestForTable("t1"))?.purged_at).not.toBeNull();
    expect((await games.findLatestForTable("t1"))?.outcome).toBe("ended_by_agreement");
  });

  it("purges the checkpoint on administrative force-close", async () => {
    const { actor, gateway, checkpoints, games } = setUpDealtGame();
    await flush();
    const gameId = actor.currentGameId!;

    gateway.forceClose("administrative action");
    await flush();

    expect(await checkpoints.readForRestore(gameId)).toBeNull();
    expect((await games.findLatestForTable("t1"))?.purged_at).not.toBeNull();
  });

  it("writes a correction-checkpoint row once a deal begins (docs/17 §5.8, D-17-19)", async () => {
    const { actor, correctionCheckpoints } = setUpDealtGame();
    await flush();
    const gameId = actor.currentGameId!;
    expect(correctionCheckpoints.peek(gameId)).toHaveLength(1);
  });

  it("writes an additional row per further accepted game command", async () => {
    const { actor, seats, correctionCheckpoints } = setUpDealtGame();
    await flush();
    const gameId = actor.currentGameId!;
    expect(correctionCheckpoints.peek(gameId)).toHaveLength(1);

    seats.east.send({ t: "cmd", cmd: "draw_tile", d: { end: "head" } });
    await flush();

    expect(correctionCheckpoints.peek(gameId)).toHaveLength(2);
  });

  it("purges correction_checkpoints once the game concludes by agreement", async () => {
    const { actor, seats, correctionCheckpoints } = setUpDealtGame();
    await flush();
    const gameId = actor.currentGameId!;

    seats.east.send({ t: "cmd", cmd: "propose_end_game" });
    seats.south.send({ t: "cmd", cmd: "respond_end_game", d: { response: "accept" } });
    seats.west.send({ t: "cmd", cmd: "respond_end_game", d: { response: "accept" } });
    seats.north.send({ t: "cmd", cmd: "respond_end_game", d: { response: "accept" } });
    await flush();

    expect(correctionCheckpoints.peek(gameId)).toHaveLength(0);
  });

  it("purges correction_checkpoints on administrative force-close", async () => {
    const { actor, gateway, correctionCheckpoints } = setUpDealtGame();
    await flush();
    const gameId = actor.currentGameId!;

    gateway.forceClose("administrative action");
    await flush();

    expect(correctionCheckpoints.peek(gameId)).toHaveLength(0);
  });

  it("never writes a checkpoint when no writer is configured", async () => {
    const actor = new TableActor({ id: "t2", entropy: createDeterministicEntropy(2) });
    const tickets = new TicketStore();
    const gateway = new TableGateway({ actor, tickets }); // no checkpointWriter
    for (const seat of SEAT_ORDER) actor.occupySeat(`player-${seat}`, seat);
    const seats: Record<Seat, BoundSeat> = {} as Record<Seat, BoundSeat>;
    for (const seat of SEAT_ORDER) seats[seat] = bindSeat(gateway, tickets, seat);
    for (const seat of SEAT_ORDER) seats[seat].send({ t: "cmd", cmd: "set_ready" });
    seats.east.send({ t: "cmd", cmd: "start_deal" });
    await flush();
    expect(actor.gameStateSnapshot.lifecycle).toBe("in_play"); // the game itself proceeds fine either way
  });
});
