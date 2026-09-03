// TableService: the business logic behind
// docs/33_API/REST_Endpoint_Catalog.md §4 (the five table endpoints),
// independent of HTTP (http.ts is the thin Fastify wrapper) — the same
// split as `auth/service.ts`/`auth/http.ts`.
//
// Every mutation here follows one order: mutate the live `TableActor`
// first (the authoritative in-memory state, docs/05 §6), then mirror the
// result into `TableRepository` (durable bookkeeping). If the actor
// rejects, nothing is written to the repository. This is the same
// direction dealer-core's own checkpointing follows — the durable copy
// is always taken *from* the authoritative state, never constructed
// independently of it.
//
// Wiring note: the `accounts` repository passed here must be the *same*
// instance (same underlying database, in production) as the one
// `AuthService` uses — `listMine`'s display-name lookups resolve
// against it, and two separate in-memory repositories that never see
// each other's writes is exactly the bug this note exists to prevent.
import type { AccountRow } from "@mahjong-dealer/db";
import type { Seat } from "@mahjong-dealer/shared";
import type { AccountRepository } from "../auth/repository.js";
import type { Table } from "../table/table.js";
import { hashJoinCode, generateJoinCode } from "./codes.js";
import type { TableManager } from "./manager.js";
import type { SeatAssignment, TableRepository, TableRow } from "./repository.js";

export interface TableServiceOptions {
  readonly tables: TableRepository;
  readonly accounts: AccountRepository;
  readonly manager: TableManager;
  readonly idFactory: () => string;
  readonly ownerNode?: string;
  readonly now?: () => Date;
}

export type CreateTableResult =
  | { readonly ok: true; readonly tableId: string; readonly joinCode: string; readonly seat: Seat }
  | { readonly ok: false; readonly code: "ALREADY_SEATED" };

export type JoinTableResult =
  | { readonly ok: true; readonly tableId: string; readonly seat: Seat }
  | { readonly ok: false; readonly code: "NOT_FOUND" | "ALREADY_SEATED" };

export interface MineSeatSummary {
  readonly seat: Seat;
  readonly displayName: string | null;
  readonly connected: boolean;
}

export interface MineTableSummary {
  readonly tableId: string;
  readonly status: TableRow["status"];
  readonly seat: Seat;
  readonly seats: readonly MineSeatSummary[];
  readonly gameState: string | null;
}

export type CloseTableResult = { readonly ok: true } | { readonly ok: false; readonly code: "NOT_FOUND" | "GAME_IN_PROGRESS" };

export type ConnectTicketResult =
  | { readonly ok: true; readonly ticket: string; readonly expiresAt: Date }
  | { readonly ok: false; readonly code: "NOT_FOUND" };

export class TableService {
  private readonly tables: TableRepository;
  private readonly accounts: AccountRepository;
  private readonly manager: TableManager;
  private readonly idFactory: () => string;
  private readonly ownerNode: string;
  private readonly now: () => Date;

  constructor(options: TableServiceOptions) {
    this.tables = options.tables;
    this.accounts = options.accounts;
    this.manager = options.manager;
    this.idFactory = options.idFactory;
    this.ownerNode = options.ownerNode ?? "single-node";
    this.now = options.now ?? (() => new Date());
  }

  async createTable(accountId: string, displayName: string): Promise<CreateTableResult> {
    const existing = await this.tables.findSeatForAccountAnywhere(accountId);
    if (existing !== null) return { ok: false, code: "ALREADY_SEATED" };

    const id = this.idFactory();
    const joinCode = generateJoinCode();
    const live = this.manager.create(id);

    const occupied = live.actor.occupySeat(accountId, displayName);
    if (!occupied.ok) {
      throw new Error(`unreachable: occupying the first seat of a freshly created table failed (${occupied.code})`);
    }

    await this.tables.create({
      id,
      joinCodeHash: hashJoinCode(joinCode),
      hostAccountId: accountId,
      ownerNode: this.ownerNode,
    });
    await this.syncSeatsFromActor(id, live.actor.tableSnapshot);

    return { ok: true, tableId: id, joinCode, seat: occupied.seat };
  }

  async joinTable(accountId: string, displayName: string, joinCode: string): Promise<JoinTableResult> {
    const existing = await this.tables.findSeatForAccountAnywhere(accountId);
    if (existing !== null) return { ok: false, code: "ALREADY_SEATED" };

    const row = await this.tables.findLiveByJoinCodeHash(hashJoinCode(joinCode));
    if (row === null) return { ok: false, code: "NOT_FOUND" };

    const live = this.manager.get(row.id);
    if (live === undefined) return { ok: false, code: "NOT_FOUND" };

    const occupied = live.actor.occupySeat(accountId, displayName);
    if (!occupied.ok) {
      // A full, closed, or (redundantly) already-seated table: docs/18 §4.2
      // groups a full table with "wrong code"/"unknown table" under a
      // uniform 404 — there is deliberately no distinct TABLE_FULL response.
      return occupied.code === "ALREADY_SEATED" ? { ok: false, code: "ALREADY_SEATED" } : { ok: false, code: "NOT_FOUND" };
    }

    await this.tables.setStatus(row.id, live.actor.tableSnapshot.status);
    await this.syncSeatsFromActor(row.id, live.actor.tableSnapshot);

    return { ok: true, tableId: row.id, seat: occupied.seat };
  }

  async listMine(accountId: string): Promise<readonly MineTableSummary[]> {
    const entries = await this.tables.tablesForAccount(accountId);
    const summaries: MineTableSummary[] = [];
    for (const { table, seat } of entries) {
      const live = this.manager.get(table.id);
      const seatRows = await this.tables.seatsForTable(table.id);
      const seats = await Promise.all(
        seatRows.map(async (seatRow): Promise<MineSeatSummary> => {
          const account: AccountRow | null =
            seatRow.account_id === null ? null : await this.accounts.findById(seatRow.account_id);
          return {
            seat: seatRow.seat,
            displayName: account?.display_name ?? null,
            connected: live?.gateway.isConnected(seatRow.seat) ?? false,
          };
        }),
      );
      summaries.push({
        tableId: table.id,
        status: table.status,
        seat,
        seats,
        gameState: live?.actor.gameStateSnapshot.lifecycle ?? null,
      });
    }
    return summaries;
  }

  async closeTable(accountId: string, tableId: string): Promise<CloseTableResult> {
    const row = await this.tables.findById(tableId);
    if (row === null || row.host_account_id !== accountId) return { ok: false, code: "NOT_FOUND" };

    const live = this.manager.get(tableId);
    if (live === undefined) return { ok: false, code: "NOT_FOUND" };

    const hostSeat = live.actor.tableSnapshot.host;
    if (hostSeat === null) return { ok: false, code: "NOT_FOUND" };

    const outcome = live.actor.submit(hostSeat, "close_table", undefined);
    if (!outcome.ok) {
      return outcome.code === "NOT_IN_PHASE" ? { ok: false, code: "GAME_IN_PROGRESS" } : { ok: false, code: "NOT_FOUND" };
    }

    await this.tables.setStatus(tableId, "closed", this.now());
    return { ok: true };
  }

  async issueConnectTicket(accountId: string, sessionId: string, tableId: string): Promise<ConnectTicketResult> {
    const live = this.manager.get(tableId);
    if (live === undefined) return { ok: false, code: "NOT_FOUND" };

    const seat = seatFor(live.actor.tableSnapshot, accountId);
    if (seat === null) return { ok: false, code: "NOT_FOUND" };

    const ticket = live.tickets.issue({ accountId, sessionId, tableId, seat });
    return { ok: true, ticket, expiresAt: new Date(this.now().getTime() + live.tickets.ttlMs) };
  }

  private async syncSeatsFromActor(tableId: string, table: Table): Promise<void> {
    const now = this.now();
    const assignments: SeatAssignment[] = Object.entries(table.seats).map(([seat, state]) => ({
      seat: seat as Seat,
      accountId: state.occupant,
      isReady: state.ready,
      occupiedAt: state.occupant === null ? null : now,
    }));
    await this.tables.syncSeats(tableId, assignments);
  }
}

function seatFor(table: Table, accountId: string): Seat | null {
  for (const [seat, state] of Object.entries(table.seats)) {
    if (state.occupant === accountId) return seat as Seat;
  }
  return null;
}
