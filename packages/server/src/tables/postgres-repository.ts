// Postgres-backed `TableRepository`, written against
// packages/db/migrations/0001_initial_schema.sql. Not exercised against a
// live database in this environment — same scope note as
// `auth/postgres-repository.ts`: correct by construction and
// parameterized throughout, but unverified by an integration test.
// `memory-repository.ts` is what `service.test.ts` actually exercises.
import type { Pool, PoolClient } from "pg";
import { SEAT_ORDER, type Seat } from "@mahjong-dealer/shared";
import type { TableRow, TableSeatRow, TableStatusRow } from "@mahjong-dealer/db";
import type { NewTableRow, SeatAssignment, TableListPage, TableListQuery, TableRepository } from "./repository.js";

export class PostgresTableRepository implements TableRepository {
  constructor(private readonly pool: Pool) {}

  async create(row: NewTableRow): Promise<TableRow> {
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");
      const { rows } = await client.query<TableRow>(
        `INSERT INTO tables (id, join_code_hash, host_account_id, owner_node)
         VALUES ($1, $2, $3, $4)
         RETURNING *`,
        [row.id, row.joinCodeHash, row.hostAccountId, row.ownerNode],
      );
      const table = expectOne(rows);
      for (const seat of SEAT_ORDER) {
        await client.query(
          `INSERT INTO table_seats (id, table_id, seat) VALUES (gen_random_uuid(), $1, $2)`,
          [table.id, seat],
        );
      }
      await client.query("COMMIT");
      return table;
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
  }

  async findById(id: string): Promise<TableRow | null> {
    const { rows } = await this.pool.query<TableRow>("SELECT * FROM tables WHERE id = $1", [id]);
    return rows[0] ?? null;
  }

  async findLiveByJoinCodeHash(hash: Buffer): Promise<TableRow | null> {
    const { rows } = await this.pool.query<TableRow>(
      "SELECT * FROM tables WHERE join_code_hash = $1 AND status <> 'closed'",
      [hash],
    );
    return rows[0] ?? null;
  }

  async setStatus(id: string, status: TableStatusRow, closedAt?: Date): Promise<void> {
    await this.pool.query("UPDATE tables SET status = $2, closed_at = COALESCE($3, closed_at) WHERE id = $1", [
      id,
      status,
      closedAt ?? null,
    ]);
  }

  async syncSeats(tableId: string, seats: readonly SeatAssignment[]): Promise<void> {
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");
      for (const assignment of seats) {
        await this.upsertSeat(client, tableId, assignment);
      }
      await client.query("COMMIT");
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
  }

  private async upsertSeat(client: PoolClient, tableId: string, assignment: SeatAssignment): Promise<void> {
    await client.query(
      `UPDATE table_seats SET account_id = $3, is_ready = $4, occupied_at = $5
       WHERE table_id = $1 AND seat = $2`,
      [tableId, assignment.seat, assignment.accountId, assignment.isReady, assignment.occupiedAt],
    );
  }

  async seatsForTable(tableId: string): Promise<readonly TableSeatRow[]> {
    const { rows } = await this.pool.query<TableSeatRow>(
      "SELECT * FROM table_seats WHERE table_id = $1 ORDER BY seat",
      [tableId],
    );
    return rows;
  }

  async findSeatForAccountAnywhere(accountId: string): Promise<{ readonly tableId: string; readonly seat: Seat } | null> {
    const { rows } = await this.pool.query<{ table_id: string; seat: Seat }>(
      "SELECT table_id, seat FROM table_seats WHERE account_id = $1 LIMIT 1",
      [accountId],
    );
    const row = rows[0];
    return row === undefined ? null : { tableId: row.table_id, seat: row.seat };
  }

  async tablesForAccount(accountId: string): Promise<readonly { readonly table: TableRow; readonly seat: Seat }[]> {
    const { rows } = await this.pool.query<TableRow & { seat: Seat }>(
      `SELECT t.*, ts.seat AS seat
       FROM table_seats ts
       JOIN tables t ON t.id = ts.table_id
       WHERE ts.account_id = $1`,
      [accountId],
    );
    return rows.map(({ seat, ...table }) => ({ table, seat }));
  }

  async list(query: TableListQuery): Promise<TableListPage> {
    const { rows: countRows } = await this.pool.query<{ count: string }>("SELECT count(*) FROM tables");
    const { rows } = await this.pool.query<TableRow>(
      "SELECT * FROM tables ORDER BY created_at DESC LIMIT $1 OFFSET $2",
      [query.limit, query.offset],
    );
    return { tables: rows, total: Number(countRows[0]?.count ?? 0) };
  }
}

function expectOne<T>(rows: readonly T[]): T {
  const row = rows[0];
  if (row === undefined) {
    throw new Error("unreachable: INSERT ... RETURNING produced no row");
  }
  return row;
}
