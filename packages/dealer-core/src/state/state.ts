// Authoritative game state (docs/09_Game_State_Machine.md §4; docs/07_Tile_Model.md §9).
//
// This is a deliberately partial slice of the full machine: `lifecycle`
// covers only IDLE and IN_PLAY (docs/09 §4) — DEALING is represented as the
// atomic transition in `wall/deal.ts` rather than as an observable state
// (docs/09 §4.2), and CONCLUDING/CONCLUDED, the overlay flags (§5), pass
// rounds, and corrections are not yet implemented. See the module
// doc-comment in `commands/apply.ts`.
import type { Salt, Seat, TileHandle, WallOrder } from "@mahjong-dealer/shared";
import { SEAT_ORDER } from "@mahjong-dealer/shared";
import type { Tile } from "../tiles/tile.js";

/**
 * The five tile locations from docs/06 §6, minus `inFlight` (pass rounds are
 * not yet implemented). Every handle in the game is in exactly one of these
 * at every moment — that totality is the conservation invariant
 * (`conservation.ts`).
 */
export interface TileLocations {
  /**
   * Ordered, head at index 0. Branded `WallOrder` (SRV, docs/07 §8): even
   * though a bare handle reveals nothing by itself, the *order* of handles
   * is what a rewind must protect (docs/08 §7.2), so it is branded at the
   * point it is stored, not only where faces are attached.
   */
  readonly wall: WallOrder<TileHandle>;
  /** Ordered per seat, in the seat's own arrangement (DD-20). Faces are OWN. */
  readonly hands: Readonly<Record<Seat, readonly TileHandle[]>>;
  /** Ordered; the last element is the current discard (DD-14). Faces are PUB. */
  readonly discards: readonly TileHandle[];
  /** Flat per-seat exposed tiles (DD-16). Faces are PUB. */
  readonly exposures: Readonly<Record<Seat, readonly TileHandle[]>>;
}

export type GameLifecycle = "idle" | "in_play";

interface BaseGameState {
  /** The one authoritative sequence number (docs/19 §3.2). */
  readonly seq: number;
  /**
   * Every tile this game was constructed with, by handle. Held by the server
   * only; nothing outside `project` ever reads a face from here for a seat
   * not entitled to it (docs/14 §5).
   */
  readonly tileByHandle: ReadonlyMap<TileHandle, Tile>;
  readonly locations: TileLocations;
}

export interface IdleGameState extends BaseGameState {
  readonly lifecycle: "idle";
  readonly turn: null;
  readonly salt: null;
  readonly commitment: null;
}

export interface InPlayGameState extends BaseGameState {
  readonly lifecycle: "in_play";
  /** The turn pointer (docs/09 §6) — a field, not a state. */
  readonly turn: Seat;
  /** SRV, never revealed (docs/08 §5.3). */
  readonly salt: Salt;
  /** PUB once published (docs/08 §5.1). */
  readonly commitment: string;
}

export type GameState = IdleGameState | InPlayGameState;

function emptyPerSeat(): Record<Seat, readonly TileHandle[]> {
  const result = {} as Record<Seat, readonly TileHandle[]>;
  for (const seat of SEAT_ORDER) {
    result[seat] = [];
  }
  return result;
}

export function createIdleState(): IdleGameState {
  return {
    lifecycle: "idle",
    seq: 0,
    turn: null,
    tileByHandle: new Map(),
    locations: {
      wall: [] as unknown as WallOrder<TileHandle>,
      hands: emptyPerSeat(),
      discards: [],
      exposures: emptyPerSeat(),
    },
    salt: null,
    commitment: null,
  };
}
