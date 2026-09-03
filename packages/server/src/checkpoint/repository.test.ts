import { describe, expect, it } from "vitest";
import { InMemoryCheckpointRepository } from "./memory-repository.js";

describe("InMemoryCheckpointRepository", () => {
  it("returns null for a game with no checkpoint", async () => {
    const repo = new InMemoryCheckpointRepository();
    expect(await repo.readForRestore("no-such-game")).toBeNull();
  });

  it("records and reads back the private_state/key_version pair", async () => {
    const repo = new InMemoryCheckpointRepository();
    await repo.record({
      gameId: "game-1",
      seq: 3,
      publicState: { lifecycle: "in_play" },
      privateState: Buffer.from("ciphertext"),
      keyVersion: 1,
    });
    const found = await repo.readForRestore("game-1");
    expect(found?.privateState.toString()).toBe("ciphertext");
    expect(found?.keyVersion).toBe(1);
  });

  it("overwrites in place — one row per game (docs/17 §5.7)", async () => {
    const repo = new InMemoryCheckpointRepository();
    await repo.record({ gameId: "game-1", seq: 1, publicState: {}, privateState: Buffer.from("a"), keyVersion: 1 });
    await repo.record({ gameId: "game-1", seq: 2, publicState: {}, privateState: Buffer.from("b"), keyVersion: 1 });
    const found = await repo.readForRestore("game-1");
    expect(found?.privateState.toString()).toBe("b");
  });

  it("deletes the row for a game", async () => {
    const repo = new InMemoryCheckpointRepository();
    await repo.record({ gameId: "game-1", seq: 1, publicState: {}, privateState: Buffer.from("a"), keyVersion: 1 });
    await repo.deleteForGame("game-1");
    expect(await repo.readForRestore("game-1")).toBeNull();
  });
});
