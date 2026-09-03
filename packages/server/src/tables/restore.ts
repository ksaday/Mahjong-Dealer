// Reconstructs a `Table` (seat occupancy, readiness, host, status) from
// its durable rows (`TableRepository`) — the half of process-restart
// recovery that has nothing to do with a checkpoint. `table_seats` carries
// no display name (`TableService.listMine`'s own pattern resolves it from
// `AccountRepository`), so this needs the same lookup.
import type { TableRow, TableSeatRow } from "@mahjong-dealer/db";
import { SEAT_ORDER, type Seat } from "@mahjong-dealer/shared";
import type { AccountRepository } from "../auth/repository.js";
import type { Table, TableSeatState } from "../table/table.js";

export async function buildTableFromRepository(
  row: TableRow,
  seatRows: readonly TableSeatRow[],
  accounts: AccountRepository,
): Promise<Table> {
  const seats = {} as Record<Seat, TableSeatState>;
  let host: Seat | null = null;
  for (const seat of SEAT_ORDER) {
    const seatRow = seatRows.find((s) => s.seat === seat);
    if (seatRow === undefined || seatRow.account_id === null) {
      seats[seat] = { occupant: null, displayName: null, ready: false, connection: "absent" };
      continue;
    }
    const account = await accounts.findById(seatRow.account_id);
    seats[seat] = {
      occupant: seatRow.account_id,
      displayName: account?.display_name ?? null,
      ready: seatRow.is_ready,
      // Connection state is transient/gateway-owned (docs/16 §3), never persisted — every seat
      // restores as absent until its client actually reconnects and binds.
      connection: "absent",
    };
    if (seatRow.account_id === row.host_account_id) host = seat;
  }
  return { id: row.id, host, status: row.status, seats };
}
