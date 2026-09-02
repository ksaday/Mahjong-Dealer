// The conservation invariant (docs/07_Tile_Model.md §7; docs/06 DD-04):
//   wall ⊎ hands ⊎ discards ⊎ exposures  ==  the game's tile set
// Rule-free and exhaustively checkable: it is pure bookkeeping over handles,
// with no reference to any tile's face.
import { SEAT_ORDER } from "@mahjong-dealer/shared";
import type { TileHandle } from "@mahjong-dealer/shared";
import type { GameState } from "./state.js";

export interface ConservationOk {
  readonly ok: true;
}

export interface ConservationViolation {
  readonly ok: false;
  readonly reason: "duplicate" | "count_mismatch";
  readonly detail: string;
}

export type ConservationResult = ConservationOk | ConservationViolation;

/**
 * Verifies every handle in this game's tile set appears in exactly one
 * location. A violation is fatal in production (D-07-09): continuing on
 * miscounted state could hand a player a tile that does not exist.
 */
export function invariants(state: GameState): ConservationResult {
  if (state.lifecycle === "idle") {
    return { ok: true };
  }

  const { wall, hands, discards, exposures } = state.locations;
  const seen = new Map<TileHandle, number>();
  const record = (handle: TileHandle): void => {
    seen.set(handle, (seen.get(handle) ?? 0) + 1);
  };

  for (const handle of wall) record(handle);
  for (const seat of SEAT_ORDER) {
    for (const handle of hands[seat]) record(handle);
    for (const handle of exposures[seat]) record(handle);
  }
  for (const handle of discards) record(handle);

  const duplicates = [...seen.entries()].filter(([, count]) => count > 1);
  if (duplicates.length > 0) {
    return {
      ok: false,
      reason: "duplicate",
      detail: `${duplicates.length} handle(s) appear in more than one location`,
    };
  }

  const expectedCount = state.tileByHandle.size;
  const actualCount = seen.size;
  if (actualCount !== expectedCount) {
    return {
      ok: false,
      reason: "count_mismatch",
      detail: `expected ${expectedCount} accounted-for tiles, found ${actualCount}`,
    };
  }

  for (const handle of seen.keys()) {
    if (!state.tileByHandle.has(handle)) {
      return { ok: false, reason: "count_mismatch", detail: `handle ${handle} is not in this game's tile set` };
    }
  }

  return { ok: true };
}
