import { describe, expect, it } from "vitest";
import { InMemoryGamesRepository } from "./memory-games-repository.js";

describe("InMemoryGamesRepository", () => {
  it("starts a game as in_play with no outcome or purge", async () => {
    const repo = new InMemoryGamesRepository();
    await repo.startGame({ id: "game-1", tableId: "table-1" });
    const found = await repo.findLatestForTable("table-1");
    expect(found?.id).toBe("game-1");
    expect(found?.state).toBe("in_play");
    expect(found?.outcome).toBeNull();
    expect(found?.purged_at).toBeNull();
  });

  it("keeps games.seq current as the 'last durable authoritative sequence' (docs/17 §5.6)", async () => {
    const repo = new InMemoryGamesRepository();
    await repo.startGame({ id: "game-1", tableId: "table-1" });
    await repo.recordSeq("game-1", 42);
    const found = await repo.findLatestForTable("table-1");
    expect(found?.seq).toBe(42n);
  });

  it("records the conclusion outcome and seat", async () => {
    const repo = new InMemoryGamesRepository();
    await repo.startGame({ id: "game-1", tableId: "table-1" });
    await repo.markConcluded("game-1", "declaration_accepted", "east");
    const found = await repo.findLatestForTable("table-1");
    expect(found?.state).toBe("concluded");
    expect(found?.outcome).toBe("declaration_accepted");
    expect(found?.outcome_seat).toBe("east");
  });

  it("marks a game purged", async () => {
    const repo = new InMemoryGamesRepository();
    await repo.startGame({ id: "game-1", tableId: "table-1" });
    await repo.markPurged("game-1");
    const found = await repo.findLatestForTable("table-1");
    expect(found?.purged_at).not.toBeNull();
  });

  it("finds the most recently started game for a table among several", async () => {
    const repo = new InMemoryGamesRepository();
    await repo.startGame({ id: "game-1", tableId: "table-1" });
    await new Promise((resolve) => setTimeout(resolve, 2));
    await repo.startGame({ id: "game-2", tableId: "table-1" });
    const found = await repo.findLatestForTable("table-1");
    expect(found?.id).toBe("game-2");
  });

  it("returns null for a table with no games", async () => {
    const repo = new InMemoryGamesRepository();
    expect(await repo.findLatestForTable("no-such-table")).toBeNull();
  });
});
