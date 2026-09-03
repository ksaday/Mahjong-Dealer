// The seat projector (docs/14_Player_Privacy.md §5): the single function in
// the whole system that converts authoritative state into something a
// client may receive (D-14-03). It **constructs** the view from named
// parts rather than filtering a copy of state (D-14-02, docs/14 §5.1): a
// field is absent unless deliberately added here, so `SeatView` has no
// property another seat's hand, the wall order, or the salt could occupy
// (DD-31, DD-32).
import type { ConcealedFace, Face, Seat, TileHandle } from "@mahjong-dealer/shared";
import { SEAT_ORDER } from "@mahjong-dealer/shared";
import type {
  ConcludingProcess,
  Exposure,
  GameLifecycle,
  GameOutcome,
  GameState,
  PassRoundRouting,
} from "../state/state.js";

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

export interface PublicExposure {
  readonly id: string;
  readonly tiles: readonly PublicTile[];
}

export interface SeatSummary {
  readonly seat: Seat;
  /** PUB (docs/14 §4.1): visible at a physical table; carries no interpretation. */
  readonly handSize: number;
  readonly exposures: readonly PublicExposure[];
  /** Present only for a seat that has voluntarily revealed (docs/10 `reveal_hand`). */
  readonly revealedHand: readonly PublicTile[] | null;
}

/** PUB routing; counts only for what each seat committed (docs/14 §4.2 — identities stay OWN until execution). */
export interface PublicPassRound {
  readonly routing: readonly PassRoundRouting[];
  readonly committedCounts: Readonly<Partial<Record<Seat, number>>>;
}

export interface PublicCorrection {
  readonly proposer: Seat;
  readonly rewindTo: number;
  readonly responses: Readonly<Partial<Record<Seat, "accept" | "reject">>>;
}

export interface PublicConcludingProcess {
  readonly kind: ConcludingProcess["kind"];
  readonly initiator: Seat;
  readonly responses: Readonly<Partial<Record<Seat, string>>>;
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
  readonly outcome: GameOutcome | null;
  /** `requestedBy` is an array, not the live `ReadonlySet<Seat>` (`state.ts`'s `PauseState`) — `SeatView` is JSON-bound eventually, and a Set doesn't survive that. */
  readonly paused: { readonly requestedBy: readonly Seat[] } | null;
  readonly passRound: PublicPassRound | null;
  readonly correction: PublicCorrection | null;
  readonly concludingProcess: PublicConcludingProcess | null;
}

export function project(state: GameState, seat: Seat): SeatView {
  switch (state.lifecycle) {
    case "idle":
      return projectIdle(state, seat);
    case "concluded":
      return projectConcluded(state, seat);
    case "in_play":
    case "concluding":
      return projectLive(state, seat);
  }
}

function projectIdle(state: Extract<GameState, { lifecycle: "idle" }>, seat: Seat): SeatView {
  return {
    seat,
    seq: state.seq,
    lifecycle: "idle",
    turn: null,
    wallRemaining: 0,
    discards: [],
    seats: SEAT_ORDER.map((s) => ({ seat: s, handSize: 0, exposures: [], revealedHand: null })),
    ownHand: [],
    commitment: null,
    outcome: null,
    paused: null,
    passRound: null,
    correction: null,
    concludingProcess: null,
  };
}

function projectConcluded(state: Extract<GameState, { lifecycle: "concluded" }>, seat: Seat): SeatView {
  const faceOf = (handle: TileHandle): Face => lookupFace(handle, state.publicTileByHandle);

  const seats: SeatSummary[] = SEAT_ORDER.map((s) => {
    const revealed = state.revealedHands[s];
    return {
      seat: s,
      handSize: state.finalHandSizes[s],
      exposures: state.exposures[s].map((exposure) => toPublicExposure(exposure, faceOf)),
      revealedHand: revealed === undefined ? null : revealed.map((handle) => ({ handle, face: faceOf(handle) })),
    };
  });

  return {
    seat,
    seq: state.seq,
    lifecycle: "concluded",
    turn: null,
    wallRemaining: 0,
    discards: state.discards.map((handle) => ({ handle, face: faceOf(handle) })),
    seats,
    ownHand: [], // purged (docs/16 §5.5) — even the owner's own concealed tiles are gone
    commitment: null,
    outcome: state.outcome,
    paused: null,
    passRound: null,
    correction: null,
    concludingProcess: null,
  };
}

function projectLive(
  state: Extract<GameState, { lifecycle: "in_play" | "concluding" }>,
  seat: Seat,
): SeatView {
  const faceOf = (handle: TileHandle): Face => lookupFace(handle, state.tileByHandle);

  const seats: SeatSummary[] = SEAT_ORDER.map((s) => {
    const revealed = state.revealedHands.has(s) ? state.locations.hands[s] : null;
    return {
      seat: s,
      handSize: state.locations.hands[s].length,
      exposures: state.locations.exposures[s].map((exposure) => toPublicExposure(exposure, faceOf)),
      revealedHand: revealed === null ? null : revealed.map((handle) => ({ handle, face: faceOf(handle) })),
    };
  });

  const ownHand: OwnTile[] = state.locations.hands[seat].map((handle) => ({
    handle,
    face: faceOf(handle) as ConcealedFace,
  }));

  const discards: PublicTile[] = state.locations.discards.map((handle) => ({
    handle,
    face: faceOf(handle),
  }));

  const passRound =
    state.lifecycle === "in_play" && state.passRound !== null
      ? {
          routing: state.passRound.routing,
          committedCounts: mapValues(state.passRound.committed, (handles) => handles.length),
        }
      : null;

  const correction =
    state.correction === null
      ? null
      : {
          proposer: state.correction.proposer,
          rewindTo: state.correction.rewindTo,
          responses: state.correction.responses,
        };

  const concludingProcess =
    state.lifecycle === "concluding"
      ? {
          kind: state.process.kind,
          initiator: state.process.kind === "declaration" ? state.process.declarer : state.process.proposer,
          responses: state.process.responses,
        }
      : null;

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
    outcome: null,
    paused: state.paused === null ? null : { requestedBy: [...state.paused.requestedBy] },
    passRound,
    correction,
    concludingProcess,
  };
}

function toPublicExposure(exposure: Exposure, faceOf: (handle: TileHandle) => Face): PublicExposure {
  return { id: exposure.id, tiles: exposure.handles.map((handle) => ({ handle, face: faceOf(handle) })) };
}

function lookupFace(handle: TileHandle, tileByHandle: ReadonlyMap<TileHandle, { readonly face: Face }>): Face {
  const tile = tileByHandle.get(handle);
  if (tile === undefined) {
    throw new Error(`unreachable: handle ${handle} is not in this game's tile set`);
  }
  return tile.face;
}

function mapValues<K extends string, V, R>(
  record: Readonly<Partial<Record<K, V>>>,
  fn: (value: V) => R,
): Partial<Record<K, R>> {
  const result: Partial<Record<K, R>> = {};
  for (const key of Object.keys(record) as K[]) {
    const value = record[key];
    if (value !== undefined) result[key] = fn(value);
  }
  return result;
}
