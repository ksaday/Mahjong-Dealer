import { describe, expect, it } from "vitest";
import { InMemoryCorrectionCheckpointRepository } from "./correction-memory-repository.js";
import type { NewCorrectionCheckpointRow } from "./correction-repository.js";

function row(seq: number, id = `row-${seq}`): NewCorrectionCheckpointRow {
  return { id, gameId: "game-1", seq, publicState: {}, privateState: Buffer.from(`entry-${seq}`), keyVersion: 1 };
}

describe("InMemoryCorrectionCheckpointRepository", () => {
  it("returns no rows for a game with nothing recorded", async () => {
    const repo = new InMemoryCorrectionCheckpointRepository();
    expect(await repo.readForRestore("no-such-game", 10)).toEqual([]);
  });

  it("records and reads back rows ascending by seq, regardless of write order", async () => {
    const repo = new InMemoryCorrectionCheckpointRepository();
    await repo.record(row(3), 10);
    await repo.record(row(1), 10);
    await repo.record(row(2), 10);
    const found = await repo.readForRestore("game-1", 10);
    expect(found.map((r) => r.privateState.toString())).toEqual(["entry-1", "entry-2", "entry-3"]);
  });

  it("a duplicate write for a seq already recorded is a no-op (idempotent, docs/17 §5.8)", async () => {
    const repo = new InMemoryCorrectionCheckpointRepository();
    await repo.record(row(1), 10);
    await repo.record({ ...row(1), id: "row-1-again", privateState: Buffer.from("different-payload") }, 10);
    const found = await repo.readForRestore("game-1", 10);
    expect(found).toHaveLength(1);
    expect(found[0]?.privateState.toString()).toBe("entry-1"); // the first write wins, not overwritten
  });

  it("trims to the newest `retain` rows as new ones are written (D-17-11: bounded by construction)", async () => {
    const repo = new InMemoryCorrectionCheckpointRepository();
    for (let seq = 1; seq <= 11; seq++) {
      await repo.record(row(seq), 10);
    }
    const found = await repo.readForRestore("game-1", 10);
    expect(found).toHaveLength(10);
    expect(found.map((r) => r.privateState.toString())).toEqual(
      Array.from({ length: 10 }, (_, i) => `entry-${i + 2}`), // 2..11 — seq 1 was trimmed
    );
  });

  it("readForRestore's own `limit` also caps the window, independent of what was retained", async () => {
    const repo = new InMemoryCorrectionCheckpointRepository();
    for (let seq = 1; seq <= 5; seq++) {
      await repo.record(row(seq), 10);
    }
    const found = await repo.readForRestore("game-1", 3);
    expect(found.map((r) => r.privateState.toString())).toEqual(["entry-3", "entry-4", "entry-5"]);
  });

  it("deletes every row for a game", async () => {
    const repo = new InMemoryCorrectionCheckpointRepository();
    await repo.record(row(1), 10);
    await repo.record(row(2), 10);
    await repo.deleteForGame("game-1");
    expect(await repo.readForRestore("game-1", 10)).toEqual([]);
  });

  it("scopes retention/deletion per game — one game's window doesn't affect another's", async () => {
    const repo = new InMemoryCorrectionCheckpointRepository();
    await repo.record({ ...row(1), gameId: "game-1" }, 10);
    await repo.record({ ...row(1), gameId: "game-2" }, 10);
    await repo.deleteForGame("game-1");
    expect(await repo.readForRestore("game-1", 10)).toEqual([]);
    expect(await repo.readForRestore("game-2", 10)).toHaveLength(1);
  });
});
