// The table entity (docs/05_Game_Table_Architecture.md §3, §4). A table
// owns four fixed seats, at most one game at a time, one authoritative
// state, one command queue, and one communication channel.
//
// Scope note: `join_table`, connect tickets, and account identity are the
// REST/auth surface (docs/04, docs/12 §6.3, docs/15) — Phase 3 (db/auth)
// and Phase 5 (gateway), neither built yet. `occupySeat` here takes an
// already-known player id and does the *seat assignment* docs/05 §5
// describes, without a join code, a ticket, or a real account behind
// `playerId` (currently an opaque string).
import { nextSeat, SEAT_ORDER, type Seat } from "@mahjong-dealer/shared";

/** docs/05 §4. */
export const TABLE_STATUSES = ["open", "seated", "closed", "abandoned"] as const;
export type TableStatus = (typeof TABLE_STATUSES)[number];

/** docs/22_Disconnect_and_Reconnect.md §3 — the wire-facing three of that section's four states (`WireSeatSummary.connection`); `empty` is signaled separately via `occupant`/`displayName`, not folded in here. */
export type SeatConnection = "connected" | "away" | "absent";

export interface TableSeatState {
  readonly occupant: string | null;
  readonly displayName: string | null;
  readonly ready: boolean;
  readonly connection: SeatConnection;
}

export interface Table {
  readonly id: string;
  readonly host: Seat | null;
  readonly status: TableStatus;
  readonly seats: Readonly<Record<Seat, TableSeatState>>;
}

function emptySeat(): TableSeatState {
  return { occupant: null, displayName: null, ready: false, connection: "absent" };
}

export function createTable(id: string): Table {
  const seats = {} as Record<Seat, TableSeatState>;
  for (const seat of SEAT_ORDER) {
    seats[seat] = emptySeat();
  }
  return { id, host: null, status: "open", seats };
}

export type TableRejectionCode =
  | "TABLE_FULL"
  | "ALREADY_SEATED"
  | "TABLE_CLOSED"
  | "SEAT_EMPTY"
  | "NOT_HOST"
  | "GAME_IN_PROGRESS";

export interface TableRejection {
  readonly ok: false;
  readonly code: TableRejectionCode;
}

export interface OccupySeatResult {
  readonly ok: true;
  readonly table: Table;
  readonly seat: Seat;
}

/**
 * Assigns the lowest unoccupied seat in fixed order (D-05-04): predictable
 * for a group joining together, and there is no seat parameter on the wire
 * for the client to choose one (NR-601). The table's creator becomes host
 * by occupying the first seat.
 */
export function occupySeat(
  table: Table,
  playerId: string,
  displayName: string,
): OccupySeatResult | TableRejection {
  if (table.status === "closed") return { ok: false, code: "TABLE_CLOSED" };
  if (SEAT_ORDER.some((s) => table.seats[s].occupant === playerId)) {
    return { ok: false, code: "ALREADY_SEATED" };
  }
  const seat = SEAT_ORDER.find((s) => table.seats[s].occupant === null);
  if (seat === undefined) return { ok: false, code: "TABLE_FULL" };

  const seats = { ...table.seats, [seat]: { occupant: playerId, displayName, ready: false, connection: "absent" as const } };
  const occupiedCount = SEAT_ORDER.filter((s) => seats[s].occupant !== null).length;
  const status: TableStatus = occupiedCount === SEAT_ORDER.length ? "seated" : "open";
  const host = table.host ?? seat;

  return { ok: true, table: { ...table, seats, status, host }, seat };
}

export interface VacateSeatResult {
  readonly ok: true;
  readonly table: Table;
}

/**
 * A seat may be vacated only while no game is in progress (docs/05 §5.2, NR-202).
 * Deliberately doesn't decide whether an emptied table should close (docs/05
 * §4's "last seat vacated" edge) — that cascade lives one level up, in
 * `TableActor.vacateSeat`, which reuses `forceClose`'s existing machinery
 * rather than this pure function computing a third status alongside the
 * seated->open transition below.
 */
export function vacateSeat(
  table: Table,
  seat: Seat,
  gameInProgress: boolean,
): VacateSeatResult | TableRejection {
  if (table.status === "closed") return { ok: false, code: "TABLE_CLOSED" };
  if (table.seats[seat].occupant === null) return { ok: false, code: "SEAT_EMPTY" };
  if (gameInProgress) return { ok: false, code: "GAME_IN_PROGRESS" };

  const seats = { ...table.seats, [seat]: emptySeat() };
  const status: TableStatus = table.status === "seated" ? "open" : table.status;
  const host = table.host === seat ? nextOccupiedHost(seats, seat) : table.host;

  return { ok: true, table: { ...table, seats, status, host } };
}

function nextOccupiedHost(seats: Readonly<Record<Seat, TableSeatState>>, from: Seat): Seat | null {
  let seat = nextSeat(from);
  for (let i = 0; i < SEAT_ORDER.length - 1; i += 1) {
    if (seats[seat].occupant !== null) return seat;
    seat = nextSeat(seat);
  }
  return null;
}

export function setReady(table: Table, seat: Seat, ready: boolean): Table {
  return { ...table, seats: { ...table.seats, [seat]: { ...table.seats[seat], ready } } };
}

export function setConnection(table: Table, seat: Seat, connection: SeatConnection): Table {
  return { ...table, seats: { ...table.seats, [seat]: { ...table.seats[seat], connection } } };
}

export function allReady(table: Table): boolean {
  return SEAT_ORDER.every((seat) => table.seats[seat].occupant !== null && table.seats[seat].ready);
}

/** docs/05 §4: "last seat vacated" is one of the three ways an OPEN table becomes CLOSED — `TableActor.vacateSeat` uses this to decide when to cascade into `forceClose`. */
export function isEmpty(table: Table): boolean {
  return SEAT_ORDER.every((seat) => table.seats[seat].occupant === null);
}

export function closeTable(table: Table): Table {
  return { ...table, status: "closed" };
}
