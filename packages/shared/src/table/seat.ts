// Seat identity (docs/04_User_Roles_and_Access.md, docs/09_Game_State_Machine.md §6).
// Lives in `shared` because both `dealer-core` (the turn pointer) and `web`
// (rendering seat positions) need it, and `web` may not import `dealer-core`
// (docs/03_System_Architecture.md §4.1).

export const SEAT_ORDER = ["east", "south", "west", "north"] as const;

export type Seat = (typeof SEAT_ORDER)[number];

export function isSeat(value: string): value is Seat {
  return (SEAT_ORDER as readonly string[]).includes(value);
}

/** The seat after `seat` in turn order: east -> south -> west -> north -> east (docs/09 §6.2). */
export function nextSeat(seat: Seat): Seat {
  const index = SEAT_ORDER.indexOf(seat);
  const next = SEAT_ORDER[(index + 1) % SEAT_ORDER.length];
  if (next === undefined) {
    throw new Error("unreachable: SEAT_ORDER is non-empty");
  }
  return next;
}
