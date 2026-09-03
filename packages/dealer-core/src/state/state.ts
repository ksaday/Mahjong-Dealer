// Authoritative game state (docs/09_Game_State_Machine.md §4, §5; docs/07_Tile_Model.md §9).
//
// Scope note: table lifecycle (OPEN/SEATED/CLOSED, seating, host identity,
// readiness) is a different entity (docs/05) owned by the table actor
// (`server`, Phase 4), not by this `GameState`. `set_ready`, `clear_ready`,
// and `close_table` are table-actor commands, layered above `dealer-core`;
// they are not implemented here. Auto-pause on presence loss (docs/22 §5)
// is likewise a gateway concern — the host issues the same `request_pause`
// this module implements once it detects an absence.
import type { Salt, Seat, TileHandle, WallOrder } from "@mahjong-dealer/shared";
import { SEAT_ORDER } from "@mahjong-dealer/shared";
import type { Tile } from "../tiles/tile.js";

export type GameLifecycle = "idle" | "in_play" | "concluding" | "concluded";

/** A face-up group in front of a seat (docs/10 §5.4). Identified so it can be retracted or targeted by a swap. */
export interface Exposure {
  readonly id: string;
  readonly handles: readonly TileHandle[];
}

/**
 * The five tile locations from docs/06 §6, `inFlight` keyed by the
 * committing ("from") seat so a committed-but-unexecuted pass keeps its
 * tiles unambiguously accounted for (docs/06 D-06-03).
 */
export interface TileLocations {
  readonly wall: WallOrder<TileHandle>;
  readonly hands: Readonly<Record<Seat, readonly TileHandle[]>>;
  readonly discards: readonly TileHandle[];
  readonly exposures: Readonly<Record<Seat, readonly Exposure[]>>;
  readonly inFlight: Readonly<Record<Seat, readonly TileHandle[]>>;
}

/** A neutral, simultaneous, secret exchange (docs/10 §6). */
export interface PassRoundRouting {
  readonly from: Seat;
  readonly to: Seat;
}

export interface PassRoundState {
  readonly routing: readonly PassRoundRouting[];
  /** Present once a "from" seat has committed (docs/10 `commit_pass`). */
  readonly committed: Readonly<Partial<Record<Seat, readonly TileHandle[]>>>;
}

/** A pending, unanimous-consent rewind (docs/05 §8). */
export interface CorrectionState {
  readonly proposer: Seat;
  readonly rewindTo: number;
  readonly responses: Readonly<Partial<Record<Seat, "accept" | "reject">>>;
}

/**
 * Multi-holder (docs/22 §5.2): an explicit `request_pause` and an
 * auto-pause-on-absence are "separate" holds that can coexist for
 * different seats — "if both hold, the table stays paused until both
 * clear." Each seat in `requestedBy` clears only its own hold via its own
 * `request_resume`; the table resumes once the set is empty. A single
 * `Seat` here would let one seat's return silently clear another seat's
 * still-live hold, which is exactly the bug this shape prevents.
 */
export interface PauseState {
  readonly requestedBy: ReadonlySet<Seat>;
}

export interface DeclarationProcess {
  readonly kind: "declaration";
  readonly declarer: Seat;
  readonly responses: Readonly<Partial<Record<Seat, "accept" | "dispute">>>;
}

export interface EndGameProcess {
  readonly kind: "end_game";
  readonly proposer: Seat;
  readonly responses: Readonly<Partial<Record<Seat, "accept" | "decline">>>;
}

export type ConcludingProcess = DeclarationProcess | EndGameProcess;

export type GameOutcome =
  | { readonly kind: "declaration_accepted"; readonly declarer: Seat }
  | { readonly kind: "ended_by_agreement" };

interface BaseGameState {
  /** The one authoritative sequence number (docs/19 §3.2). */
  readonly seq: number;
}

export interface IdleGameState extends BaseGameState {
  readonly lifecycle: "idle";
}

/** Shared shape of the two "tiles still exist" states: `in_play` and `concluding`. */
export interface LiveGameState extends BaseGameState {
  readonly turn: Seat;
  readonly tileByHandle: ReadonlyMap<TileHandle, Tile>;
  readonly locations: TileLocations;
  readonly salt: Salt;
  readonly commitment: string;
  /** Seats that have voluntarily revealed their hand (docs/10 `reveal_hand`). Irreversible. */
  readonly revealedHands: ReadonlySet<Seat>;
  readonly nextExposureId: number;
  readonly paused: PauseState | null;
  readonly correction: CorrectionState | null;
}

export interface InPlayGameState extends LiveGameState {
  readonly lifecycle: "in_play";
  readonly passRound: PassRoundState | null;
}

export interface ConcludingGameState extends LiveGameState {
  readonly lifecycle: "concluding";
  readonly process: ConcludingProcess;
}

/**
 * Concealed material purged (docs/16 §5.5, docs/14 §4.3): no wall, no
 * hands, no salt, no full `tileByHandle`. Only what was already public
 * survives — discards, exposures, voluntarily revealed hands, and final
 * hand sizes (a count, not contents).
 */
export interface ConcludedGameState extends BaseGameState {
  readonly lifecycle: "concluded";
  readonly outcome: GameOutcome;
  readonly finalHandSizes: Readonly<Record<Seat, number>>;
  readonly discards: readonly TileHandle[];
  readonly exposures: Readonly<Record<Seat, readonly Exposure[]>>;
  readonly revealedHands: Readonly<Partial<Record<Seat, readonly TileHandle[]>>>;
  /** Faces for exactly the handles above — discards, exposures, revealed hands. Nothing else. */
  readonly publicTileByHandle: ReadonlyMap<TileHandle, Tile>;
}

export type GameState = IdleGameState | InPlayGameState | ConcludingGameState | ConcludedGameState;

export function emptyPerSeat<T>(fill: () => T): Record<Seat, T> {
  const result = {} as Record<Seat, T>;
  for (const seat of SEAT_ORDER) {
    result[seat] = fill();
  }
  return result;
}

export function createIdleState(): IdleGameState {
  return { lifecycle: "idle", seq: 0 };
}
