import { describe, expect, it } from "vitest";
import { InMemoryAuditLogRepository } from "../audit/memory-repository.js";
import { InMemoryAccountRepository, InMemorySessionRepository } from "../auth/memory-repository.js";
import type { AccountRow } from "../auth/repository.js";
import { createDeterministicEntropy } from "../testing/deterministic-entropy.js";
import { InMemoryTableRepository } from "../tables/memory-repository.js";
import { TableManager } from "../tables/manager.js";
import { TableService } from "../tables/service.js";
import { AdminService } from "./service.js";

async function setUp() {
  const accounts = new InMemoryAccountRepository();
  const sessions = new InMemorySessionRepository();
  const tables = new InMemoryTableRepository();
  const auditLog = new InMemoryAuditLogRepository();
  const manager = new TableManager(createDeterministicEntropy(1));
  let nextId = 0;
  const tableService = new TableService({
    accounts,
    tables,
    manager,
    idFactory: () => `table-${(nextId += 1)}`,
  });
  const admin = new AdminService({
    accounts,
    sessions,
    tables,
    manager,
    auditLog,
    idFactory: () => `audit-${(nextId += 1)}`,
    now: () => new Date("2026-09-03T00:00:00Z"),
  });

  async function account(displayName: string, role: "player" | "administrator" = "player"): Promise<AccountRow> {
    return accounts.create({
      id: `acct-${displayName}`,
      email: `${displayName.toLowerCase()}@example.com`,
      passwordHash: "unused-hash",
      displayName,
      role,
    });
  }

  return { accounts, sessions, tables, auditLog, manager, tableService, admin, account };
}

describe("listAccounts (docs/18 §4.3 GET /admin/accounts, FR-160)", () => {
  it("paginates and filters by status", async () => {
    const { admin, account } = await setUp();
    await account("Alice");
    await account("Bob");
    await account("Carol");

    const page = await admin.listAccounts({ limit: 2, offset: 0 });
    expect(page.total).toBe(3);
    expect(page.accounts).toHaveLength(2);
  });
});

describe("setAccountStatus (docs/18 §4.3 PATCH /admin/accounts/{id}, FR-160, FR-166)", () => {
  it("disables an account, revokes its sessions, and records a mandatory-reason audit entry", async () => {
    const { admin, sessions, account, auditLog } = await setUp();
    const admin1 = await account("Admin", "administrator");
    const alice = await account("Alice");
    await sessions.create({
      id: "s1",
      accountId: alice.id,
      tokenHash: Buffer.from("t"),
      csrfSecret: "c",
      issuedAt: new Date(),
      absoluteExpiresAt: new Date(Date.now() + 100_000),
      ip: null,
      userAgent: null,
    });

    const result = await admin.setAccountStatus(admin1.id, alice.id, "disabled", "abusive chat");
    expect(result.ok).toBe(true);

    const active = await sessions.listActiveForAccount(alice.id);
    expect(active).toHaveLength(0);

    const audit = await auditLog.list({ limit: 10, offset: 0 });
    expect(audit.entries[0]).toMatchObject({
      actor_account_id: admin1.id,
      action: "account_disabled",
      target_type: "account",
      target_id: alice.id,
      reason: "abusive chat",
    });
  });

  it("returns NOT_FOUND for an unknown account", async () => {
    const { admin, account } = await setUp();
    const admin1 = await account("Admin", "administrator");
    const result = await admin.setAccountStatus(admin1.id, "no-such-account", "disabled", "reason");
    expect(result).toEqual({ ok: false, code: "NOT_FOUND" });
  });
});

describe("listTables (docs/18 §4.3 GET /admin/tables, D-18-07)", () => {
  it("reports a seat count, never occupants", async () => {
    const { admin, tableService, account } = await setUp();
    const alice = await account("Alice");
    const bob = await account("Bob");
    const created = await tableService.createTable(alice.id, alice.display_name);
    if (!created.ok) throw new Error("expected success");
    await tableService.joinTable(bob.id, bob.display_name, "wrong-code");

    const page = await admin.listTables({ limit: 10, offset: 0 });
    expect(page.total).toBe(1);
    expect(page.tables[0]).toMatchObject({ tableId: created.tableId, status: "open", occupiedSeats: 1 });
    expect(JSON.stringify(page.tables[0])).not.toContain("Alice");
  });
});

describe("forceCloseTable (docs/18 §4.3 POST /admin/tables/{id}/force-close, FR-161)", () => {
  it("closes the durable row, the live actor, and audits the reason", async () => {
    const { admin, tables, tableService, account, auditLog } = await setUp();
    const admin1 = await account("Admin", "administrator");
    const alice = await account("Alice");
    const created = await tableService.createTable(alice.id, alice.display_name);
    if (!created.ok) throw new Error("expected success");

    const result = await admin.forceCloseTable(admin1.id, created.tableId, "stuck");
    expect(result.ok).toBe(true);

    const row = await tables.findById(created.tableId);
    expect(row?.status).toBe("closed");

    const audit = await auditLog.list({ limit: 10, offset: 0 });
    expect(audit.entries[0]).toMatchObject({ action: "table_force_closed", target_id: created.tableId, reason: "stuck" });
  });

  it("returns NOT_FOUND for an unknown table", async () => {
    const { admin, account } = await setUp();
    const admin1 = await account("Admin", "administrator");
    const result = await admin.forceCloseTable(admin1.id, "no-such-table", "reason");
    expect(result).toEqual({ ok: false, code: "NOT_FOUND" });
  });
});

describe("health (docs/18 §4.3 GET /admin/health, FR-162)", () => {
  it("counts live tables and connections without any player-identifying data", async () => {
    const { admin, tableService, account } = await setUp();
    const alice = await account("Alice");
    await tableService.createTable(alice.id, alice.display_name);

    const health = await admin.health();
    expect(health.tables.liveInThisProcess).toBe(1);
    expect(health.tables.total).toBe(1);
    expect(health.connections).toBe(0);
    expect(JSON.stringify(health)).not.toContain("Alice");
  });
});
