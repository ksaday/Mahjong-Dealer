// TableManager.restoreLiveTables / flushAllCheckpointsSync (docs/29_Disaster_
// Recovery.md, TC-F01's shape): a separate file from `manager.test.ts`, same
// split every other durability-adjacent test file in this session uses.
import { randomBytes } from "node:crypto";
import { describe, expect, it } from "vitest";
import { SEAT_ORDER, type Seat } from "@mahjong-dealer/shared";
import { createDeterministicEntropy } from "../testing/deterministic-entropy.js";
import { InMemoryAccountRepository } from "../auth/memory-repository.js";
import { CheckpointWriter } from "../checkpoint/writer.js";
import { InMemoryCheckpointRepository } from "../checkpoint/memory-repository.js";
import { InMemoryCorrectionCheckpointRepository } from "../checkpoint/correction-memory-repository.js";
import { InMemoryGamesRepository } from "./memory-games-repository.js";
import { InMemoryTableRepository } from "./memory-repository.js";
import { TableManager } from "./manager.js";
import type { SeatAssignment } from "./repository.js";

async function seedTableAndAccounts(tables: InMemoryTableRepository, accounts: InMemoryAccountRepository) {
  const accountBySeat: Record<Seat, string> = {} as Record<Seat, string>;
  for (const seat of SEAT_ORDER) {
    const account = await accounts.create({
      id: `account-${seat}`,
      email: `${seat}@example.com`,
      passwordHash: "irrelevant",
      displayName: `${seat[0]!.toUpperCase()}${seat.slice(1)} Player`,
    });
    accountBySeat[seat] = account.id;
  }
  await tables.create({
    id: "t1",
    joinCodeHash: Buffer.from("hash"),
    hostAccountId: accountBySeat.east,
    ownerNode: "single-node",
  });
  const assignments: SeatAssignment[] = SEAT_ORDER.map((seat) => ({
    seat,
    accountId: accountBySeat[seat],
    isReady: false,
    occupiedAt: new Date(),
  }));
  await tables.syncSeats("t1", assignments);
  return accountBySeat;
}

function readyAllAndDeal(manager: TableManager, accountBySeat: Record<Seat, string>): void {
  const live = manager.get("t1");
  if (live === undefined) throw new Error("unreachable");
  for (const seat of SEAT_ORDER) {
    const occupied = live.actor.occupySeat(accountBySeat[seat], seat);
    if (!occupied.ok) throw new Error(`unreachable: ${occupied.code}`);
  }
  for (const seat of SEAT_ORDER) live.actor.submit(seat, "set_ready", undefined);
  live.actor.submit("east", "start_deal", undefined);
}

describe("TableManager.restoreLiveTables", () => {
  it("reconstructs a live actor from a checkpoint, matching the pre-restart game state and seq", async () => {
    const tables = new InMemoryTableRepository();
    const accounts = new InMemoryAccountRepository();
    const games = new InMemoryGamesRepository();
    const checkpoints = new InMemoryCheckpointRepository();
    const correctionCheckpoints = new InMemoryCorrectionCheckpointRepository();
    const checkpointWriter = new CheckpointWriter(checkpoints, games, randomBytes(32), correctionCheckpoints);

    const accountBySeat = await seedTableAndAccounts(tables, accounts);

    const before = new TableManager(createDeterministicEntropy(1), undefined, checkpointWriter);
    before.create("t1");
    readyAllAndDeal(before, accountBySeat);
    const beforeLive = before.get("t1");
    if (beforeLive === undefined) throw new Error("unreachable");
    const gameId = beforeLive.actor.currentGameId;
    if (gameId === null) throw new Error("unreachable");
    await checkpointWriter.startGame(gameId, "t1");
    await checkpointWriter.flushSync(beforeLive.actor);

    const preRestartState = beforeLive.actor.gameStateSnapshot;
    const preRestartSeq = beforeLive.actor.seqNumber;

    const after = new TableManager(createDeterministicEntropy(99), undefined, checkpointWriter);
    await after.restoreLiveTables({ tables, accounts, games, checkpointWriter });

    const afterLive = after.get("t1");
    expect(afterLive).toBeDefined();
    expect(afterLive!.actor.gameStateSnapshot).toEqual(preRestartState);
    expect(afterLive!.actor.seqNumber).toBe(preRestartSeq);
    expect(afterLive!.actor.currentGameId).toBe(gameId);
    // Seat occupancy comes from TableRepository, not the (possibly stale) checkpoint:
    expect(afterLive!.actor.tableSnapshot.seats.east.occupant).toBe(accountBySeat.east);
    expect(afterLive!.actor.tableSnapshot.seats.east.displayName).toBe("East Player");
    expect(afterLive!.actor.tableSnapshot.host).toBe("east");
  });

  it("restores the correction window from durable storage, trimmed to the newest 10 entries (docs/17 §5.8, D-17-19)", async () => {
    const tables = new InMemoryTableRepository();
    const accounts = new InMemoryAccountRepository();
    const games = new InMemoryGamesRepository();
    const checkpoints = new InMemoryCheckpointRepository();
    const correctionCheckpoints = new InMemoryCorrectionCheckpointRepository();
    const checkpointWriter = new CheckpointWriter(checkpoints, games, randomBytes(32), correctionCheckpoints);

    const accountBySeat = await seedTableAndAccounts(tables, accounts);

    const before = new TableManager(createDeterministicEntropy(1), undefined, checkpointWriter);
    before.create("t1");
    readyAllAndDeal(before, accountBySeat);
    const beforeLive = before.get("t1");
    if (beforeLive === undefined) throw new Error("unreachable");
    const gameId = beforeLive.actor.currentGameId;
    if (gameId === null) throw new Error("unreachable");
    await checkpointWriter.startGame(gameId, "t1");

    // This test drives the actor directly (not through TableGateway.syncCheckpoint),
    // so it persists each correction-window entry itself: the deal is the
    // first entry, then 11 more draws — each `draw_tile` both advances the
    // turn and is core-dispatched (recordCheckpoint: true) — push the
    // window past its 10-entry retention bound.
    const persistLatest = async (): Promise<{ readonly seq: number }> => {
      const entry = beforeLive.actor.latestCorrectionCheckpoint;
      if (entry === null) throw new Error("unreachable");
      await checkpointWriter.flushCorrectionCheckpointSync(beforeLive.actor, entry);
      return entry;
    };
    const recordedEntries = [await persistLatest()];
    for (let i = 0; i < 11; i++) {
      const state = beforeLive.actor.gameStateSnapshot;
      if (state.lifecycle !== "in_play") throw new Error("unreachable");
      const seat = state.turn;
      if (seat === null) throw new Error("unreachable");
      const outcome = beforeLive.actor.submit(seat, "draw_tile", { end: "head" });
      if (!outcome.ok) throw new Error(`unreachable: ${outcome.code}`);
      recordedEntries.push(await persistLatest());
    }
    const trimmedAwaySeq = recordedEntries[0]!.seq; // the deal itself — now outside the restored window
    const stillWithinWindowSeq = recordedEntries.at(-10)!.seq; // the oldest entry that survives trimming to 10
    await checkpointWriter.flushSync(beforeLive.actor); // the primary checkpoint, reflecting the final post-draws state

    const after = new TableManager(createDeterministicEntropy(99), undefined, checkpointWriter);
    await after.restoreLiveTables({ tables, accounts, games, checkpointWriter });
    const afterLive = after.get("t1");
    if (afterLive === undefined) throw new Error("unreachable");

    const rejected = afterLive.actor.submit("east", "propose_correction", { rewindTo: trimmedAwaySeq });
    expect(rejected).toEqual({ ok: false, code: "NO_CHECKPOINT" });

    const accepted = afterLive.actor.submit("east", "propose_correction", { rewindTo: stillWithinWindowSeq });
    expect(accepted.ok).toBe(true);
  });

  it("starts idle, with correct seat occupancy, for a table that never had a checkpoint", async () => {
    const tables = new InMemoryTableRepository();
    const accounts = new InMemoryAccountRepository();
    const games = new InMemoryGamesRepository();
    const checkpoints = new InMemoryCheckpointRepository();
    const correctionCheckpoints = new InMemoryCorrectionCheckpointRepository();
    const checkpointWriter = new CheckpointWriter(checkpoints, games, randomBytes(32), correctionCheckpoints);
    await seedTableAndAccounts(tables, accounts);

    const manager = new TableManager(createDeterministicEntropy(1), undefined, checkpointWriter);
    await manager.restoreLiveTables({ tables, accounts, games, checkpointWriter });

    const live = manager.get("t1");
    expect(live).toBeDefined();
    expect(live!.actor.gameStateSnapshot.lifecycle).toBe("idle");
    expect(live!.actor.currentGameId).toBeNull();
    expect(live!.actor.tableSnapshot.seats.south.occupant).not.toBeNull();
  });

  it("does not restore a closed table", async () => {
    const tables = new InMemoryTableRepository();
    const accounts = new InMemoryAccountRepository();
    const games = new InMemoryGamesRepository();
    const checkpoints = new InMemoryCheckpointRepository();
    const correctionCheckpoints = new InMemoryCorrectionCheckpointRepository();
    const checkpointWriter = new CheckpointWriter(checkpoints, games, randomBytes(32), correctionCheckpoints);
    await seedTableAndAccounts(tables, accounts);
    await tables.setStatus("t1", "closed", new Date());

    const manager = new TableManager(createDeterministicEntropy(1), undefined, checkpointWriter);
    await manager.restoreLiveTables({ tables, accounts, games, checkpointWriter });

    expect(manager.get("t1")).toBeUndefined();
  });

  it("isolates a corrupt checkpoint to its own table, restoring every other table normally", async () => {
    const tables = new InMemoryTableRepository();
    const accounts = new InMemoryAccountRepository();
    const games = new InMemoryGamesRepository();
    const checkpoints = new InMemoryCheckpointRepository();
    const correctionCheckpoints = new InMemoryCorrectionCheckpointRepository();
    const checkpointWriter = new CheckpointWriter(checkpoints, games, randomBytes(32), correctionCheckpoints);

    await seedTableAndAccounts(tables, accounts); // "t1", healthy — never started, so no checkpoint

    // A second table with a checkpoint encrypted under a *different* key —
    // decryption will fail (GCM auth tag mismatch), simulating corruption.
    for (const seat of SEAT_ORDER) {
      await accounts.create({
        id: `t2-account-${seat}`,
        email: `t2-${seat}@example.com`,
        passwordHash: "irrelevant",
        displayName: `${seat} (t2)`,
      });
    }
    await tables.create({ id: "t2", joinCodeHash: Buffer.from("hash2"), hostAccountId: "t2-account-east", ownerNode: "single-node" });
    await tables.syncSeats(
      "t2",
      SEAT_ORDER.map((seat) => ({ seat, accountId: `t2-account-${seat}`, isReady: false, occupiedAt: new Date() })),
    );
    const wrongKeyWriter = new CheckpointWriter(checkpoints, games, randomBytes(32), new InMemoryCorrectionCheckpointRepository()); // different key than `checkpointWriter`
    const actorT2 = new TableManager(createDeterministicEntropy(2)).create("t2").actor;
    for (const seat of SEAT_ORDER) actorT2.occupySeat(`t2-account-${seat}`, seat);
    for (const seat of SEAT_ORDER) actorT2.submit(seat, "set_ready", undefined);
    actorT2.submit("east", "start_deal", undefined);
    const corruptGameId = actorT2.currentGameId;
    if (corruptGameId === null) throw new Error("unreachable");
    await games.startGame({ id: corruptGameId, tableId: "t2" });
    await wrongKeyWriter.flushSync(actorT2); // written under a key `checkpointWriter` below can't decrypt

    const errors: { readonly tableId: string; readonly error: unknown }[] = [];
    const manager = new TableManager(createDeterministicEntropy(3), undefined, checkpointWriter);
    await manager.restoreLiveTables({
      tables,
      accounts,
      games,
      checkpointWriter,
      onError: (tableId, error) => errors.push({ tableId, error }),
    });

    expect(errors).toHaveLength(1);
    expect(errors[0]!.tableId).toBe("t2");
    expect(manager.get("t2")).toBeUndefined(); // the corrupt table is simply not live
    expect(manager.get("t1")).toBeDefined(); // the healthy table restored normally
  });

  it("degrades gracefully when a correction-checkpoint row is corrupt — the table still restores, just with an empty correction window (D-17-19)", async () => {
    const tables = new InMemoryTableRepository();
    const accounts = new InMemoryAccountRepository();
    const games = new InMemoryGamesRepository();
    const checkpoints = new InMemoryCheckpointRepository();
    const correctionCheckpoints = new InMemoryCorrectionCheckpointRepository();
    const checkpointWriter = new CheckpointWriter(checkpoints, games, randomBytes(32), correctionCheckpoints);

    const accountBySeat = await seedTableAndAccounts(tables, accounts);

    const before = new TableManager(createDeterministicEntropy(1), undefined, checkpointWriter);
    before.create("t1");
    readyAllAndDeal(before, accountBySeat);
    const beforeLive = before.get("t1");
    if (beforeLive === undefined) throw new Error("unreachable");
    const gameId = beforeLive.actor.currentGameId;
    if (gameId === null) throw new Error("unreachable");
    await checkpointWriter.startGame(gameId, "t1");
    await checkpointWriter.flushSync(beforeLive.actor); // the primary checkpoint — healthy, decryptable

    // The correction-checkpoint row for the same entry, written under a
    // *different* key than `checkpointWriter`'s — decryption will fail,
    // simulating corruption of just this one row, independent of the
    // healthy primary checkpoint above.
    const wrongKeyCorrectionWriter = new CheckpointWriter(checkpoints, games, randomBytes(32), correctionCheckpoints);
    const entry = beforeLive.actor.latestCorrectionCheckpoint;
    if (entry === null) throw new Error("unreachable");
    await wrongKeyCorrectionWriter.flushCorrectionCheckpointSync(beforeLive.actor, entry);

    const errors: { readonly tableId: string; readonly error: unknown }[] = [];
    const after = new TableManager(createDeterministicEntropy(99), undefined, checkpointWriter);
    await after.restoreLiveTables({
      tables,
      accounts,
      games,
      checkpointWriter,
      onError: (tableId, error) => errors.push({ tableId, error }),
    });

    expect(errors).toHaveLength(0); // unlike a corrupt primary checkpoint, this does not fail the table's restore at all
    const afterLive = after.get("t1");
    expect(afterLive).toBeDefined();
    expect(afterLive!.actor.gameStateSnapshot.lifecycle).toBe("in_play"); // the game itself came back fine

    const rejected = afterLive!.actor.submit("east", "propose_correction", { rewindTo: entry.seq });
    expect(rejected).toEqual({ ok: false, code: "NO_CHECKPOINT" }); // the window is empty, not partially restored
  });
});

describe("TableManager.flushAllCheckpointsSync (docs/21 §7, D-21-11)", () => {
  it("awaits a checkpoint write for every live table with a current game", async () => {
    const tables = new InMemoryTableRepository();
    const accounts = new InMemoryAccountRepository();
    const games = new InMemoryGamesRepository();
    const checkpoints = new InMemoryCheckpointRepository();
    const correctionCheckpoints = new InMemoryCorrectionCheckpointRepository();
    const checkpointWriter = new CheckpointWriter(checkpoints, games, randomBytes(32), correctionCheckpoints);
    const accountBySeat = await seedTableAndAccounts(tables, accounts);

    const manager = new TableManager(createDeterministicEntropy(1), undefined, checkpointWriter);
    manager.create("t1");
    readyAllAndDeal(manager, accountBySeat);
    const live = manager.get("t1");
    if (live === undefined) throw new Error("unreachable");
    const gameId = live.actor.currentGameId;
    if (gameId === null) throw new Error("unreachable");
    await checkpointWriter.startGame(gameId, "t1");

    expect(await checkpoints.readForRestore(gameId)).toBeNull(); // nothing written yet
    await manager.flushAllCheckpointsSync();
    expect(await checkpoints.readForRestore(gameId)).not.toBeNull();
  });

  it("is a no-op with no checkpointWriter configured", async () => {
    const manager = new TableManager(createDeterministicEntropy(1));
    manager.create("t1");
    await expect(manager.flushAllCheckpointsSync()).resolves.toBeUndefined();
  });
});
