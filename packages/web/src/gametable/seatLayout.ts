// The perspective rule (docs/32_UX/Table_Layout_and_Perspective.md §1):
// every client renders its own seat at the bottom, with the other three in
// true relative position. East's client shows South on the right, West
// across, North on the left.
import { SEAT_ORDER, type Seat } from "@mahjong-dealer/shared";

export const RELATIVE_POSITIONS = ["bottom", "right", "across", "left"] as const;
export type RelativePosition = (typeof RELATIVE_POSITIONS)[number];

/** Where `other` sits relative to a player seated at `own` (§1's worked examples). */
export function relativePosition(own: Seat, other: Seat): RelativePosition {
  const ownIndex = SEAT_ORDER.indexOf(own);
  const otherIndex = SEAT_ORDER.indexOf(other);
  const offset = (otherIndex - ownIndex + SEAT_ORDER.length) % SEAT_ORDER.length;
  const position = RELATIVE_POSITIONS[offset];
  if (position === undefined) {
    throw new Error("unreachable: offset is always 0-3");
  }
  return position;
}

const WIND_LABELS: Readonly<Record<Seat, string>> = { east: "East", south: "South", west: "West", north: "North" };

export function seatLabel(seat: Seat): string {
  return WIND_LABELS[seat];
}
