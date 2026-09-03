import { describe, expect, it } from "vitest";
import { InMemoryIdempotencyRepository } from "./memory-repository.js";

describe("InMemoryIdempotencyRepository", () => {
  it("returns null for an unknown key", async () => {
    const repo = new InMemoryIdempotencyRepository();
    expect(await repo.find("acct-1", "POST /tables", "unknown")).toBeNull();
  });

  it("returns the stored response for a known, unexpired key", async () => {
    const repo = new InMemoryIdempotencyRepository();
    await repo.store({
      accountId: "acct-1",
      endpoint: "POST /tables",
      key: "k1",
      status: 201,
      body: { table_id: "t1" },
      expiresAt: new Date(Date.now() + 60_000),
    });
    expect(await repo.find("acct-1", "POST /tables", "k1")).toEqual({ status: 201, body: { table_id: "t1" } });
  });

  it("scopes by account and endpoint, not just the key", async () => {
    const repo = new InMemoryIdempotencyRepository();
    await repo.store({
      accountId: "acct-1",
      endpoint: "POST /tables",
      key: "shared",
      status: 201,
      body: { table_id: "t1" },
      expiresAt: new Date(Date.now() + 60_000),
    });
    expect(await repo.find("acct-2", "POST /tables", "shared")).toBeNull();
    expect(await repo.find("acct-1", "POST /accounts", "shared")).toBeNull();
  });

  it("treats an expired record as absent", async () => {
    let now = new Date("2026-01-01T00:00:00Z");
    const repo = new InMemoryIdempotencyRepository(() => now);
    await repo.store({
      accountId: "acct-1",
      endpoint: "POST /tables",
      key: "k1",
      status: 201,
      body: { table_id: "t1" },
      expiresAt: new Date("2026-01-01T00:10:00Z"),
    });
    now = new Date("2026-01-01T00:10:01Z");
    expect(await repo.find("acct-1", "POST /tables", "k1")).toBeNull();
  });
});
