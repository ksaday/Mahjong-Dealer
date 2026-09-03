import { randomBytes } from "node:crypto";
import { describe, expect, it } from "vitest";
import { SEAT_ORDER } from "@mahjong-dealer/shared";
import { TableHarness } from "../testing/table-harness.js";
import { InMemoryGamesRepository } from "../tables/memory-games-repository.js";
import { InMemoryCheckpointRepository } from "./memory-repository.js";
import { InMemoryCorrectionCheckpointRepository } from "./correction-memory-repository.js";
import { CheckpointWriter } from "./writer.js";

function readyAllAndDeal(harness: TableHarness): void {
  harness.seatAll();
  for (const seat of SEAT_ORDER) {
    harness.seat(seat).send("set_ready", undefined);
  }
  harness.seat("east").send("start_deal", undefined);
}

function endByAgreement(harness: TableHarness): void {
  harness.seat("east").send("propose_end_game", undefined);
  harness.seat("south").send("respond_end_game", { response: "accept" });
  harness.seat("west").send("respond_end_game", { response: "accept" });
  harness.seat("north").send("respond_end_game", { response: "accept" });
}

function setUp() {
  const checkpoints = new InMemoryCheckpointRepository();
  const games = new InMemoryGamesRepository();
  const correctionCheckpoints = new InMemoryCorrectionCheckpointRepository();
  const key = randomBytes(32);
  const writer = new CheckpointWriter(checkpoints, games, key, correctionCheckpoints);
  return { checkpoints, games, correctionCheckpoints, writer };
}

describe("CheckpointWriter", () => {
  it("flushSync is a no-op when the actor has no current game", async () => {
    const { checkpoints, writer } = setUp();
    const harness = TableHarness.create({ seed: 1 });
    harness.seatAll();
    await writer.flushSync(harness.actorForTest());
    expect(await checkpoints.readForRestore("anything")).toBeNull();
  });

  it("startGame then flushSync records a checkpoint for the current game", async () => {
    const { checkpoints, games, writer } = setUp();
    const harness = TableHarness.create({ seed: 2 });
    readyAllAndDeal(harness);
    const gameId = harness.currentGameId();
    if (gameId === null) throw new Error("unreachable");

    await writer.startGame(gameId, "harness-table");
    await writer.flushSync(harness.actorForTest());

    expect((await games.findLatestForTable("harness-table"))?.id).toBe(gameId);
    const row = await checkpoints.readForRestore(gameId);
    expect(row).not.toBeNull();
  });

  it("round-trips through readGameState after a flush", async () => {
    const { writer } = setUp();
    const harness = TableHarness.create({ seed: 3 });
    readyAllAndDeal(harness);
    const gameId = harness.currentGameId();
    if (gameId === null) throw new Error("unreachable");

    await writer.startGame(gameId, "harness-table");
    await writer.flushSync(harness.actorForTest());

    const restored = await writer.readGameState(gameId);
    expect(restored?.gameId).toBe(gameId);
    expect(restored?.seq).toBe(harness.seqNumber()); // the actor's own seq, distinct from GameState.seq
  });

  it("purge deletes the checkpoint and marks the game purged", async () => {
    const { checkpoints, games, writer } = setUp();
    const harness = TableHarness.create({ seed: 4 });
    readyAllAndDeal(harness);
    const gameId = harness.currentGameId();
    if (gameId === null) throw new Error("unreachable");
    await writer.startGame(gameId, "harness-table");
    await writer.flushSync(harness.actorForTest());

    await writer.purge(gameId);

    expect(await checkpoints.readForRestore(gameId)).toBeNull();
    expect((await games.findLatestForTable("harness-table"))?.purged_at).not.toBeNull();
  });

  it("concludeAndPurge records the outcome, purges, and clears the actor's currentGameId", async () => {
    const { checkpoints, games, writer } = setUp();
    const harness = TableHarness.create({ seed: 5 });
    readyAllAndDeal(harness);
    const gameId = harness.currentGameId();
    if (gameId === null) throw new Error("unreachable");
    await writer.startGame(gameId, "harness-table");

    endByAgreement(harness);
    expect(harness.state().lifecycle).toBe("concluded");

    await writer.concludeAndPurge(harness.actorForTest());

    const game = await games.findLatestForTable("harness-table");
    expect(game?.state).toBe("concluded");
    expect(game?.outcome).toBe("ended_by_agreement");
    expect(game?.purged_at).not.toBeNull();
    expect(await checkpoints.readForRestore(gameId)).toBeNull();
    expect(harness.currentGameId()).toBeNull();
  });

  it("concludeAndPurge is a no-op when there is no current game", async () => {
    const { writer } = setUp();
    const harness = TableHarness.create({ seed: 6 });
    harness.seatAll();
    await expect(writer.concludeAndPurge(harness.actorForTest())).resolves.toBeUndefined();
  });
});

describe("CheckpointWriter — correction-checkpoint durability (docs/17 §5.8, D-17-19)", () => {
  it("flushCorrectionCheckpointSync records a row, round-tripping through readCorrectionHistory", async () => {
    const { correctionCheckpoints, writer } = setUp();
    const harness = TableHarness.create({ seed: 7 });
    readyAllAndDeal(harness); // start_deal both records and clears the window — one entry afterward
    const gameId = harness.currentGameId();
    if (gameId === null) throw new Error("unreachable");
    const entry = harness.actorForTest().latestCorrectionCheckpoint;
    if (entry === null) throw new Error("unreachable");

    await writer.flushCorrectionCheckpointSync(harness.actorForTest(), entry);

    expect(correctionCheckpoints.peek(gameId)).toHaveLength(1);
    const history = await writer.readCorrectionHistory(gameId);
    expect(history).toEqual([{ actorSeq: entry.seq, gameStateBytes: expect.any(String) }]);
  });

  it("flushCorrectionCheckpointSync is a no-op when the actor has no current game", async () => {
    const { correctionCheckpoints, writer } = setUp();
    const harness = TableHarness.create({ seed: 8 });
    harness.seatAll();
    const fakeEntry = { seq: 1, gameState: harness.state() };
    await writer.flushCorrectionCheckpointSync(harness.actorForTest(), fakeEntry);
    expect(correctionCheckpoints.peek("anything")).toHaveLength(0);
  });

  it("purge also empties the correction-checkpoint window for that game", async () => {
    const { correctionCheckpoints, writer } = setUp();
    const harness = TableHarness.create({ seed: 9 });
    readyAllAndDeal(harness);
    const gameId = harness.currentGameId();
    if (gameId === null) throw new Error("unreachable");
    const entry = harness.actorForTest().latestCorrectionCheckpoint;
    if (entry === null) throw new Error("unreachable");
    await writer.startGame(gameId, "harness-table");
    await writer.flushCorrectionCheckpointSync(harness.actorForTest(), entry);
    expect(correctionCheckpoints.peek(gameId)).toHaveLength(1);

    await writer.purge(gameId);

    expect(correctionCheckpoints.peek(gameId)).toHaveLength(0);
  });

  it("readCorrectionHistory degrades gracefully — a corrupt row is skipped, not thrown", async () => {
    const { correctionCheckpoints, writer } = setUp();
    await correctionCheckpoints.record(
      { id: "bad-row", gameId: "g1", seq: 1, publicState: {}, privateState: Buffer.from("not real ciphertext"), keyVersion: 1 },
      10,
    );
    await expect(writer.readCorrectionHistory("g1")).resolves.toEqual([]);
  });
});
