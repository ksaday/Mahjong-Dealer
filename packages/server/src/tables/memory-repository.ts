// In-memory `TableRepository`, the same role `auth/memory-repository.ts`
// plays for accounts and sessions: what `TableService`'s own tests
// actually exercise, with no database.
import { SEAT_ORDER, type Seat } from "@mahjong-dealer/shared";
import type { TableRow, TableSeatRow, TableStatusRow } from "@mahjong-dealer/db";
import type { NewTableRow, SeatAssignment, TableRepository } from "./repository.js";

export class InMemoryTableRepository implements TableRepository {
  private readonly tables = new Map<string, TableRow>();
  private readonly seats = new Map<string, TableSeatRow[]>();
  private seatRowCounter = 0;

  create(row: NewTableRow): Promise<TableRow> {
    const table: TableRow = {
      id: row.id,
      join_code_hash: row.joinCodeHash,
      host_account_id: row.hostAccountId,
      status: "open",
      owner_node: row.ownerNode,
      deal_count_default: 13,
      deal_count_dealer: 14,
      created_at: new Date(),
      closed_at: null,
    };
    this.tables.set(table.id, table);
    this.seats.set(
      table.id,
      SEAT_ORDER.map((seat) => this.emptySeatRow(table.id, seat)),
    );
    return Promise.resolve(table);
  }

  findById(id: string): Promise<TableRow | null> {
    return Promise.resolve(this.tables.get(id) ?? null);
  }

  findLiveByJoinCodeHash(hash: Buffer): Promise<TableRow | null> {
    for (const table of this.tables.values()) {
      if (table.status !== "closed" && table.join_code_hash.equals(hash)) return Promise.resolve(table);
    }
    return Promise.resolve(null);
  }

  setStatus(id: string, status: TableStatusRow, closedAt?: Date): Promise<void> {
    const table = this.tables.get(id);
    if (table === undefined) throw new Error(`unreachable: no table ${id}`);
    this.tables.set(id, { ...table, status, closed_at: closedAt ?? table.closed_at });
    return Promise.resolve();
  }

  syncSeats(tableId: string, seats: readonly SeatAssignment[]): Promise<void> {
    const existing = this.seats.get(tableId);
    if (existing === undefined) throw new Error(`unreachable: no table ${tableId}`);
    const bySeat = new Map(existing.map((row) => [row.seat, row]));
    this.seats.set(
      tableId,
      SEAT_ORDER.map((seat) => {
        const assignment = seats.find((s) => s.seat === seat);
        const previous = bySeat.get(seat) ?? this.emptySeatRow(tableId, seat);
        return assignment === undefined
          ? previous
          : {
              ...previous,
              account_id: assignment.accountId,
              is_ready: assignment.isReady,
              occupied_at: assignment.occupiedAt,
            };
      }),
    );
    return Promise.resolve();
  }

  seatsForTable(tableId: string): Promise<readonly TableSeatRow[]> {
    return Promise.resolve(this.seats.get(tableId) ?? []);
  }

  findSeatForAccountAnywhere(accountId: string): Promise<{ readonly tableId: string; readonly seat: Seat } | null> {
    for (const [tableId, rows] of this.seats) {
      const row = rows.find((r) => r.account_id === accountId);
      if (row !== undefined) return Promise.resolve({ tableId, seat: row.seat });
    }
    return Promise.resolve(null);
  }

  tablesForAccount(accountId: string): Promise<readonly { readonly table: TableRow; readonly seat: Seat }[]> {
    const result: { table: TableRow; seat: Seat }[] = [];
    for (const [tableId, rows] of this.seats) {
      const row = rows.find((r) => r.account_id === accountId);
      const table = this.tables.get(tableId);
      if (row !== undefined && table !== undefined) result.push({ table, seat: row.seat });
    }
    return Promise.resolve(result);
  }

  private emptySeatRow(tableId: string, seat: Seat): TableSeatRow {
    this.seatRowCounter += 1;
    return {
      id: `seat-${this.seatRowCounter}`,
      table_id: tableId,
      seat,
      account_id: null,
      is_ready: false,
      occupied_at: null,
    };
  }
}
