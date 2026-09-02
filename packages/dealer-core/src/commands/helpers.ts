// Small immutable-update helpers shared by the command handlers.
import { SEAT_ORDER, type Seat, type TileHandle } from "@mahjong-dealer/shared";
import type { TileLocations } from "../state/state.js";

export function otherSeats(seat: Seat): readonly Seat[] {
  return SEAT_ORDER.filter((s) => s !== seat);
}

export function withHand(
  locations: TileLocations,
  seat: Seat,
  hand: readonly TileHandle[],
): TileLocations {
  return { ...locations, hands: { ...locations.hands, [seat]: hand } };
}

export function withExposures(
  locations: TileLocations,
  seat: Seat,
  exposures: TileLocations["exposures"][Seat],
): TileLocations {
  return { ...locations, exposures: { ...locations.exposures, [seat]: exposures } };
}

export function withInFlight(
  locations: TileLocations,
  seat: Seat,
  handles: readonly TileHandle[],
): TileLocations {
  return { ...locations, inFlight: { ...locations.inFlight, [seat]: handles } };
}

export function removeFirst<T>(items: readonly T[], value: T): readonly T[] | null {
  const index = items.indexOf(value);
  if (index === -1) return null;
  return [...items.slice(0, index), ...items.slice(index + 1)];
}
