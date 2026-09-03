import { describe, expect, it } from "vitest";
import { InMemoryAuditLogRepository } from "./memory-repository.js";

function entry(overrides: Partial<Parameters<InMemoryAuditLogRepository["record"]>[0]> = {}) {
  return {
    id: "e1",
    actorAccountId: "admin-1",
    action: "account_disabled",
    targetType: "account",
    targetId: "acct-1",
    reason: "fraud",
    ip: null,
    occurredAt: new Date("2026-09-03T00:00:00Z"),
    ...overrides,
  };
}

describe("InMemoryAuditLogRepository (docs/17 §5.11)", () => {
  it("lists newest first", async () => {
    const repo = new InMemoryAuditLogRepository();
    await repo.record(entry({ id: "e1", occurredAt: new Date("2026-09-01T00:00:00Z") }));
    await repo.record(entry({ id: "e2", occurredAt: new Date("2026-09-02T00:00:00Z") }));

    const page = await repo.list({ limit: 10, offset: 0 });
    expect(page.entries.map((e) => e.id)).toEqual(["e2", "e1"]);
    expect(page.total).toBe(2);
  });

  it("filters by action and actor", async () => {
    const repo = new InMemoryAuditLogRepository();
    await repo.record(entry({ id: "e1", action: "login_failed", actorAccountId: null }));
    await repo.record(entry({ id: "e2", action: "account_disabled", actorAccountId: "admin-1" }));

    const byAction = await repo.list({ limit: 10, offset: 0, action: "account_disabled" });
    expect(byAction.entries.map((e) => e.id)).toEqual(["e2"]);

    const byActor = await repo.list({ limit: 10, offset: 0, actorAccountId: "admin-1" });
    expect(byActor.entries.map((e) => e.id)).toEqual(["e2"]);
  });

  it("paginates", async () => {
    const repo = new InMemoryAuditLogRepository();
    for (let i = 0; i < 5; i += 1) {
      await repo.record(entry({ id: `e${i}`, occurredAt: new Date(2026, 8, i + 1) }));
    }
    const page = await repo.list({ limit: 2, offset: 2 });
    expect(page.entries).toHaveLength(2);
    expect(page.total).toBe(5);
  });
});
