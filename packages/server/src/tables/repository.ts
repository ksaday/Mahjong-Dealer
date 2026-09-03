// Data-access interface for tables and seats (docs/17_Database_Design.md
// §5.4, §5.5). The same discipline as `auth/repository.ts`: `TableService`
// depends only on this, so it is testable with an in-memory implementation
// (memory-repository.ts) without a live database.
//
// This repository is deliberately a *mirror*, not the authority: the
// `TableActor` (table/actor.ts, held live in `TableManager`) is the
// authoritative in-memory state for a table's seats, exactly as it is for
// game state. `TableService` writes here only after an actor mutation has
// already succeeded, so these rows exist for durability and for the one
// query the actor's in-memory map cannot answer — "which tables does this
// account hold a seat at" (`GET /tables/mine`), which needs an index by
// account rather than by table.
import type { Seat } from "@mahjong-dealer/shared";
import type { TableRow, TableSeatRow, TableStatusRow } from "@mahjong-dealer/db";

export interface NewTableRow {
  readonly id: string;
  /** Irreversible (D-17-07) — the plaintext code is never stored, only handed back once at creation. */
  readonly joinCodeHash: Buffer;
  readonly hostAccountId: string;
  readonly ownerNode: string;
}

export interface SeatAssignment {
  readonly seat: Seat;
  readonly accountId: string | null;
  readonly isReady: boolean;
  readonly occupiedAt: Date | null;
}

export interface TableListQuery {
  readonly limit: number;
  readonly offset: number;
}

export interface TableListPage {
  readonly tables: readonly TableRow[];
  readonly total: number;
}

export interface TableRepository {
  /** Creates the table row and its four (initially empty) seat rows. */
  create(row: NewTableRow): Promise<TableRow>;
  findById(id: string): Promise<TableRow | null>;
  /** Only among live (non-`closed`) tables — a closed table's code is reusable (docs/17 §5.4). */
  findLiveByJoinCodeHash(hash: Buffer): Promise<TableRow | null>;
  setStatus(id: string, status: TableStatusRow, closedAt?: Date): Promise<void>;
  /** Replaces all four seat rows to match the table actor's current seat state, the source of truth. */
  syncSeats(tableId: string, seats: readonly SeatAssignment[]): Promise<void>;
  seatsForTable(tableId: string): Promise<readonly TableSeatRow[]>;
  /** One seat per account, platform-wide (docs/17 §6) — the check behind `ALREADY_SEATED`. */
  findSeatForAccountAnywhere(accountId: string): Promise<{ readonly tableId: string; readonly seat: Seat } | null>;
  /** Every table (any status) where this account currently holds a seat row — `GET /tables/mine`. */
  tablesForAccount(accountId: string): Promise<readonly { readonly table: TableRow; readonly seat: Seat }[]>;
  /** `GET /admin/tables` (docs/18 §4.3, `FR-160`): every table, newest first. Occupant identity is deliberately not part of this row — `AdminService` adds only a seat *count* (`D-18-07`). */
  list(query: TableListQuery): Promise<TableListPage>;
}

export type { TableRow, TableSeatRow, TableStatusRow };
