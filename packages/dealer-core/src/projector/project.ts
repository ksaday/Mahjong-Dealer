// The seat projector (docs/14_Player_Privacy.md §5): the single function in
// the whole system that converts authoritative state into something a
// client may receive (D-14-03). It **constructs** the view from named
// parts rather than filtering a copy of state (D-14-02, docs/14 §5.1): a
// field is absent unless deliberately added here, so `SeatView` has no
// property another seat's hand, the wall order, or the salt could occupy
// (DD-31, DD-32).
//
// Scope note: this projects the fields this slice's `GameState` actually
// carries (docs/06 DD-31/32). Pass rounds, declarations, corrections, and
// presence/readiness are not yet modeled (see `commands/apply.ts`), so
// their `SeatView` fields (docs/14 §5.2: `passRound`, `correction`,
// `declaration`) do not exist yet either.
import type { ConcealedFace, Face, Seat, TileHandle } from "@mahjong-dealer/shared";
import { SEAT_ORDER } from "@mahjong-dealer/shared";
import type { GameLifecycle, GameState } from "../state/state.js";

/** PUB: a discard or exposure entry — already public, so the plain, unbranded face. */
export interface PublicTile {
  readonly handle: TileHandle;
  readonly face: Face;
}

/**
 * OWN: a tile in the viewing seat's own concealed hand. `face` is branded
 * `ConcealedFace` even in the one view that legitimately carries it, so
 * that passing a `SeatView` to a `NoConcealed<T>`-guarded sink (a logger, a
 * metric, a trace — docs/14 §6.2) is still a compile error. Only the
 * dedicated socket-write path may accept a bare `SeatView` (D-14-04).
 */
export interface OwnTile {
  readonly handle: TileHandle;
  readonly face: ConcealedFace;
}

export interface SeatSummary {
  readonly seat: Seat;
  /** PUB (docs/14 §4.1): visible at a physical table; carries no interpretation. */
  readonly handSize: number;
  readonly exposures: readonly PublicTile[];
}

export interface SeatView {
  readonly seat: Seat;
  readonly seq: number;
  readonly lifecycle: GameLifecycle;
  readonly turn: Seat | null;
  /** PUB: count only. The wall's order never appears here (docs/07 §8). */
  readonly wallRemaining: number;
  readonly discards: readonly PublicTile[];
  /** No array position here can hold another seat's hand contents (D-14-09). */
  readonly seats: readonly SeatSummary[];
  /** OWN, this seat only. Lives outside `seats[]` for the same reason (D-14-09). */
  readonly ownHand: readonly OwnTile[];
  readonly commitment: string | null;
}

export function project(state: GameState, seat: Seat): SeatView {
  const faceOf = (handle: TileHandle): Face => {
    const tile = state.tileByHandle.get(handle);
    if (tile === undefined) {
      throw new Error(`unreachable: handle ${handle} is not in this game's tile set`);
    }
    return tile.face;
  };

  const seats: SeatSummary[] = SEAT_ORDER.map((s) => ({
    seat: s,
    handSize: state.locations.hands[s].length,
    exposures: state.locations.exposures[s].map((handle) => ({ handle, face: faceOf(handle) })),
  }));

  const ownHand: OwnTile[] = state.locations.hands[seat].map((handle) => ({
    handle,
    face: faceOf(handle) as ConcealedFace,
  }));

  const discards: PublicTile[] = state.locations.discards.map((handle) => ({
    handle,
    face: faceOf(handle),
  }));

  return {
    seat,
    seq: state.seq,
    lifecycle: state.lifecycle,
    turn: state.turn,
    wallRemaining: state.locations.wall.length,
    discards,
    seats,
    ownHand,
    commitment: state.commitment,
  };
}
