import { describe, expect, it } from "vitest";
import { SEAT_ORDER } from "@mahjong-dealer/shared";
import { InMemoryAccountRepository } from "../auth/memory-repository.js";
import type { AccountRow } from "../auth/repository.js";
import { createDeterministicEntropy } from "../testing/deterministic-entropy.js";
import { MockSocket } from "../testing/mock-socket.js";
import { InMemoryTableRepository } from "./memory-repository.js";
import { TableManager } from "./manager.js";
import { TableService } from "./service.js";

async function setUp() {
  const accounts = new InMemoryAccountRepository();
  const tables = new InMemoryTableRepository();
  const manager = new TableManager(createDeterministicEntropy(1));
  let nextId = 0;
  const service = new TableService({
    accounts,
    tables,
    manager,
    idFactory: () => `table-${(nextId += 1)}`,
    now: () => new Date("2026-09-02T00:00:00Z"),
  });

  function account(displayName: string): Promise<AccountRow> {
    return accounts.create({
      id: `acct-${displayName}`,
      email: `${displayName.toLowerCase()}@example.com`,
      passwordHash: "unused-hash",
      displayName,
    });
  }

  return { accounts, tables, manager, service, account };
}

describe("createTable (docs/33_API POST /tables)", () => {
  it("creates a table, seats the creator as host in east, and returns a join code", async () => {
    const { service, account } = await setUp();
    const alice = await account("Alice");
    const result = await service.createTable(alice.id, alice.display_name);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.seat).toBe("east");
    expect(result.joinCode).toHaveLength(6);
    expect(result.tableId).toBeTruthy();
  });

  it("persists a table row and a seated seat row", async () => {
    const { service, tables, account } = await setUp();
    const alice = await account("Alice");
    const result = await service.createTable(alice.id, alice.display_name);
    if (!result.ok) throw new Error("expected success");

    const row = await tables.findById(result.tableId);
    expect(row?.host_account_id).toBe(alice.id);
    expect(row?.status).toBe("open");

    const seats = await tables.seatsForTable(result.tableId);
    const east = seats.find((s) => s.seat === "east");
    expect(east?.account_id).toBe(alice.id);
  });

  it("refuses a second table for an account that already holds a seat (ALREADY_SEATED)", async () => {
    const { service, account } = await setUp();
    const alice = await account("Alice");
    await service.createTable(alice.id, alice.display_name);
    const second = await service.createTable(alice.id, alice.display_name);
    expect(second).toEqual({ ok: false, code: "ALREADY_SEATED" });
  });
});

describe("joinTable (docs/33_API POST /tables/join)", () => {
  it("seats a second account in the next open seat", async () => {
    const { service, account } = await setUp();
    const alice = await account("Alice");
    const bob = await account("Bob");
    const created = await service.createTable(alice.id, alice.display_name);
    if (!created.ok) throw new Error("expected success");

    const joined = await service.joinTable(bob.id, bob.display_name, created.joinCode);
    expect(joined).toEqual({ ok: true, tableId: created.tableId, seat: "south" });
  });

  it("an already-connected seat sees a live SeatOccupied when a second player joins (FR-140, docs/19 §6.1)", async () => {
    const { service, manager, account } = await setUp();
    const alice = await account("Alice");
    const bob = await account("Bob");
    const created = await service.createTable(alice.id, alice.display_name);
    if (!created.ok) throw new Error("expected success");

    const live = manager.get(created.tableId);
    if (live === undefined) throw new Error("unreachable");
    const socket = new MockSocket();
    const handle = live.gateway.acceptConnection(socket);
    const ticket = live.tickets.issue({ accountId: alice.id, sessionId: "s1", tableId: created.tableId, seat: "east" });
    handle.onMessage(
      JSON.stringify({ t: "cmd", cmd: "bind", cmdId: "018f3a2b-1c3d-7e4f-8a12-000000000000", cseq: 1, d: { ticket } }),
    );

    await service.joinTable(bob.id, bob.display_name, created.joinCode);

    const occupied = socket
      .framesOfType("event")
      .find((f) => (f["ev"] as Record<string, unknown>)["type"] === "SeatOccupied");
    expect(occupied).toEqual(
      expect.objectContaining({ ev: { type: "SeatOccupied", seat: "south", displayName: "Bob" } }),
    );
  });

  it("returns NOT_FOUND for a wrong join code", async () => {
    const { service, account } = await setUp();
    const alice = await account("Alice");
    await service.createTable(alice.id, alice.display_name);
    const bob = await account("Bob");
    const joined = await service.joinTable(bob.id, bob.display_name, "ZZZZZZ");
    expect(joined).toEqual({ ok: false, code: "NOT_FOUND" });
  });

  it("returns NOT_FOUND, not TABLE_FULL, once all four seats are taken (docs/18 §4.2: uniform failure)", async () => {
    const { service, account } = await setUp();
    const [alice, bob, carol, dave, erin] = await Promise.all(
      ["Alice", "Bob", "Carol", "Dave", "Erin"].map(account),
    );
    const created = await service.createTable(alice!.id, alice!.display_name);
    if (!created.ok) throw new Error("expected success");
    await service.joinTable(bob!.id, bob!.display_name, created.joinCode);
    await service.joinTable(carol!.id, carol!.display_name, created.joinCode);
    await service.joinTable(dave!.id, dave!.display_name, created.joinCode);

    const fifth = await service.joinTable(erin!.id, erin!.display_name, created.joinCode);
    expect(fifth).toEqual({ ok: false, code: "NOT_FOUND" });
  });

  it("marks the table row seated once the fourth seat fills", async () => {
    const { service, tables, account } = await setUp();
    const [alice, bob, carol, dave] = await Promise.all(["Alice", "Bob", "Carol", "Dave"].map(account));
    const created = await service.createTable(alice!.id, alice!.display_name);
    if (!created.ok) throw new Error("expected success");
    await service.joinTable(bob!.id, bob!.display_name, created.joinCode);
    await service.joinTable(carol!.id, carol!.display_name, created.joinCode);
    await service.joinTable(dave!.id, dave!.display_name, created.joinCode);

    const row = await tables.findById(created.tableId);
    expect(row?.status).toBe("seated");
  });

  it("refuses a second seat for an account that already holds one anywhere (ALREADY_SEATED)", async () => {
    const { service, account } = await setUp();
    const alice = await account("Alice");
    const bob = await account("Bob");
    const created = await service.createTable(alice.id, alice.display_name);
    if (!created.ok) throw new Error("expected success");
    await service.createTable(bob.id, bob.display_name);

    const rejoin = await service.joinTable(bob.id, bob.display_name, created.joinCode);
    expect(rejoin).toEqual({ ok: false, code: "ALREADY_SEATED" });
  });
});

describe("listMine (docs/33_API GET /tables/mine)", () => {
  it("returns only tables the account holds a seat at, with seat display names and no game state beyond the lifecycle name", async () => {
    const { service, account } = await setUp();
    const alice = await account("Alice");
    const bob = await account("Bob");
    const created = await service.createTable(alice.id, alice.display_name);
    if (!created.ok) throw new Error("expected success");
    await service.joinTable(bob.id, bob.display_name, created.joinCode);

    const aliceMine = await service.listMine(alice.id);
    expect(aliceMine).toHaveLength(1);
    expect(aliceMine[0]!.tableId).toBe(created.tableId);
    expect(aliceMine[0]!.seat).toBe("east");
    expect(aliceMine[0]!.gameState).toBe("idle");
    const south = aliceMine[0]!.seats.find((s) => s.seat === "south");
    expect(south?.displayName).toBe("Bob");
    expect(south?.connected).toBe(false);

    const carol = await account("Carol");
    expect(await service.listMine(carol.id)).toEqual([]);
  });
});

describe("closeTable (docs/33_API DELETE /tables/{id})", () => {
  it("closes a table for its host", async () => {
    const { service, tables, account } = await setUp();
    const alice = await account("Alice");
    const created = await service.createTable(alice.id, alice.display_name);
    if (!created.ok) throw new Error("expected success");

    const result = await service.closeTable(alice.id, created.tableId);
    expect(result).toEqual({ ok: true });
    const row = await tables.findById(created.tableId);
    expect(row?.status).toBe("closed");
  });

  it("returns NOT_FOUND for a non-host, without revealing whether the table exists (D-18-03)", async () => {
    const { service, account } = await setUp();
    const alice = await account("Alice");
    const bob = await account("Bob");
    const created = await service.createTable(alice.id, alice.display_name);
    if (!created.ok) throw new Error("expected success");

    const result = await service.closeTable(bob.id, created.tableId);
    expect(result).toEqual({ ok: false, code: "NOT_FOUND" });
  });

  it("returns GAME_IN_PROGRESS while a game is dealing/in_play/concluding", async () => {
    const { service, manager, account } = await setUp();
    const accounts = await Promise.all(["Alice", "Bob", "Carol", "Dave"].map(account));
    const created = await service.createTable(accounts[0]!.id, accounts[0]!.display_name);
    if (!created.ok) throw new Error("expected success");
    for (const a of accounts.slice(1)) {
      await service.joinTable(a.id, a.display_name, created.joinCode);
    }
    const live = manager.get(created.tableId)!;
    for (const seat of SEAT_ORDER) live.actor.submit(seat, "set_ready", undefined);
    live.actor.submit("east", "start_deal", undefined);

    const result = await service.closeTable(accounts[0]!.id, created.tableId);
    expect(result).toEqual({ ok: false, code: "GAME_IN_PROGRESS" });
  });
});

describe("leaveSeat (FR-025, docs/33_API DELETE /tables/{id}/me)", () => {
  it("leaves a seat while other seats remain occupied — the table stays open, closed_at untouched", async () => {
    const { service, tables, account } = await setUp();
    const alice = await account("Alice");
    const bob = await account("Bob");
    const created = await service.createTable(alice.id, alice.display_name);
    if (!created.ok) throw new Error("expected success");
    await service.joinTable(bob.id, bob.display_name, created.joinCode);

    const result = await service.leaveSeat(bob.id, created.tableId);

    expect(result).toEqual({ ok: true });
    const row = await tables.findById(created.tableId);
    expect(row?.status).toBe("open");
    expect(row?.closed_at).toBeNull();
  });

  it("closes the table when the last occupant leaves (docs/05 §4)", async () => {
    const { service, tables, account } = await setUp();
    const alice = await account("Alice");
    const created = await service.createTable(alice.id, alice.display_name);
    if (!created.ok) throw new Error("expected success");

    const result = await service.leaveSeat(alice.id, created.tableId);

    expect(result).toEqual({ ok: true });
    const row = await tables.findById(created.tableId);
    expect(row?.status).toBe("closed");
    expect(row?.closed_at).not.toBeNull();
  });

  it("returns NOT_FOUND for an account holding no seat at the table", async () => {
    const { service, account } = await setUp();
    const alice = await account("Alice");
    const bob = await account("Bob");
    const created = await service.createTable(alice.id, alice.display_name);
    if (!created.ok) throw new Error("expected success");

    const result = await service.leaveSeat(bob.id, created.tableId);
    expect(result).toEqual({ ok: false, code: "NOT_FOUND" });
  });

  it("returns GAME_IN_PROGRESS while a game is dealing/in_play/concluding", async () => {
    const { service, manager, account } = await setUp();
    const accounts = await Promise.all(["Alice", "Bob", "Carol", "Dave"].map(account));
    const created = await service.createTable(accounts[0]!.id, accounts[0]!.display_name);
    if (!created.ok) throw new Error("expected success");
    for (const a of accounts.slice(1)) {
      await service.joinTable(a.id, a.display_name, created.joinCode);
    }
    const live = manager.get(created.tableId)!;
    for (const seat of SEAT_ORDER) live.actor.submit(seat, "set_ready", undefined);
    live.actor.submit("east", "start_deal", undefined);

    const result = await service.leaveSeat(accounts[0]!.id, created.tableId);
    expect(result).toEqual({ ok: false, code: "GAME_IN_PROGRESS" });
  });
});

describe("issueConnectTicket (docs/33_API POST /tables/{id}/connect-ticket)", () => {
  it("issues a ticket for an occupant with a 30-second expiry", async () => {
    const { service, account } = await setUp();
    const alice = await account("Alice");
    const created = await service.createTable(alice.id, alice.display_name);
    if (!created.ok) throw new Error("expected success");

    const result = await service.issueConnectTicket(alice.id, "session-1", created.tableId);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.ticket).toBeTruthy();
    expect(result.expiresAt.getTime() - Date.parse("2026-09-02T00:00:00Z")).toBe(30_000);
  });

  it("returns NOT_FOUND when the requester holds no seat at the table", async () => {
    const { service, account } = await setUp();
    const alice = await account("Alice");
    const bob = await account("Bob");
    const created = await service.createTable(alice.id, alice.display_name);
    if (!created.ok) throw new Error("expected success");

    const result = await service.issueConnectTicket(bob.id, "session-2", created.tableId);
    expect(result).toEqual({ ok: false, code: "NOT_FOUND" });
  });

  it("returns NOT_FOUND for an unknown table", async () => {
    const { service, account } = await setUp();
    const alice = await account("Alice");
    const result = await service.issueConnectTicket(alice.id, "session-1", "no-such-table");
    expect(result).toEqual({ ok: false, code: "NOT_FOUND" });
  });
});

