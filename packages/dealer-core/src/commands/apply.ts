// The command dispatcher (docs/06_Digital_Dealer_Architecture.md §3;
// docs/10_Player_Action_Model.md). `apply` is total: every command produces
// either a new state or a typed rejection, never a partial mutation
// (docs/06 §3).
//
// Scope note: this implements four of the catalog's twenty-six commands —
// `start_deal`, `draw_tile`, `discard_tile`, `claim_discard` — the minimum
// vertical slice that exercises tile-set construction, the shuffle, the
// deal, movement, and conservation end to end (IMPLEMENTATION_READINESS_CHECKLIST.md
// §6, Phase 2). Not yet implemented: `expose_tiles`, `retract_exposure`,
// `swap_exposed_tile`, `arrange_hand`, the pass-round family, declarations,
// end-game, correction, pause, and communication commands (docs/10 §5.4-§9),
// the `CONCLUDING`/`CONCLUDED` states and the overlay flags (docs/09 §5),
// and the host-side checks docs/10 assigns to `start_deal` beyond the game
// being `IDLE` — host identity, seating, and readiness are the table actor's
// concern (docs/03 §4.2, Phase 4), layered above this call.
//
// Every validation below is drawn from the closed vocabulary in docs/02
// §3.1 and named as such (docs/10 §3.1) — that naming discipline is what
// makes an added rule check visible in review (DEFINITION_OF_DONE.md §3.1).
import { SEAT_ORDER, nextSeat, type Seat, type TileHandle, type WallOrder } from "@mahjong-dealer/shared";
import type { Entropy } from "../entropy.js";
import { dealOpeningHands } from "../wall/deal.js";
import type { GameState, InPlayGameState, TileLocations } from "../state/state.js";

export type Command =
  | { readonly type: "start_deal"; readonly seat: Seat }
  | { readonly type: "draw_tile"; readonly seat: Seat; readonly end: "head" | "tail" }
  | { readonly type: "discard_tile"; readonly seat: Seat; readonly handle: TileHandle }
  | { readonly type: "claim_discard"; readonly seat: Seat; readonly handle: TileHandle };

/** Rejection codes this slice can produce, from the closed catalog in docs/10 §11. */
export type RejectionCode =
  | "NOT_IN_PHASE" // M-4
  | "NOT_YOUR_TURN" // M-4t — draw_tile only
  | "NOT_YOUR_TILE" // M-1 / M-2
  | "TILE_NOT_AVAILABLE" // M-1 / M-3
  | "WALL_EMPTY";

export interface Rejection {
  readonly ok: false;
  readonly code: RejectionCode;
}

export type DealerEvent =
  | { readonly type: "WallBuilt"; readonly wallLength: number }
  | { readonly type: "DealCommitmentPublished"; readonly commitment: string }
  | {
      readonly type: "TilesDealt";
      readonly handSizes: Readonly<Record<Seat, number>>;
      readonly turn: Seat;
    }
  | {
      readonly type: "TileDrawn";
      readonly seat: Seat;
      readonly end: "head" | "tail";
      readonly handle: TileHandle;
      readonly wallRemaining: number;
      readonly newHandSize: number;
    }
  | { readonly type: "WallExhausted" }
  | {
      readonly type: "TileDiscarded";
      readonly seat: Seat;
      readonly handle: TileHandle;
      readonly discardIndex: number;
      readonly newHandSize: number;
    }
  | {
      readonly type: "DiscardClaimed";
      readonly seat: Seat;
      readonly handle: TileHandle;
      readonly newHandSize: number;
      readonly turn: Seat;
    };

export interface ApplyOk {
  readonly ok: true;
  readonly state: GameState;
  readonly events: readonly DealerEvent[];
}

export type ApplyResult = ApplyOk | Rejection;

function reject(code: RejectionCode): Rejection {
  return { ok: false, code };
}

function withHand(
  locations: TileLocations,
  seat: Seat,
  hand: readonly TileHandle[],
): TileLocations {
  return { ...locations, hands: { ...locations.hands, [seat]: hand } };
}

/**
 * `apply(state, command, entropy?, now?) -> { state', events[] } | Rejection`
 * (docs/06 §3). `entropy` is required only for `start_deal` — the only
 * command that consumes randomness (docs/10 §4, `start_deal` Notes). `now`
 * is not yet threaded through: nothing in this slice is time-sensitive.
 */
export function apply(state: GameState, command: Command, entropy?: Entropy): ApplyResult {
  switch (command.type) {
    case "start_deal":
      return applyStartDeal(state, entropy);
    case "draw_tile":
      return applyDrawTile(state, command);
    case "discard_tile":
      return applyDiscardTile(state, command);
    case "claim_discard":
      return applyClaimDiscard(state, command);
  }
}

function applyStartDeal(state: GameState, entropy: Entropy | undefined): ApplyResult {
  if (state.lifecycle !== "idle") {
    return reject("NOT_IN_PHASE");
  }
  if (entropy === undefined) {
    // A host wiring defect, not a player-facing rejection: dealer-core
    // cannot draw its own entropy (docs/03 §5), so the caller must supply
    // it for this command.
    throw new Error("start_deal requires injected entropy (docs/08 §4.1)");
  }

  const dealt: InPlayGameState = dealOpeningHands(entropy);

  const handSizes = {} as Record<Seat, number>;
  for (const seat of SEAT_ORDER) {
    handSizes[seat] = dealt.locations.hands[seat].length;
  }

  const events: DealerEvent[] = [
    { type: "WallBuilt", wallLength: dealt.locations.wall.length },
    { type: "DealCommitmentPublished", commitment: dealt.commitment },
    { type: "TilesDealt", handSizes, turn: dealt.turn },
  ];

  return { ok: true, state: dealt, events };
}

function applyDrawTile(
  state: GameState,
  command: Extract<Command, { type: "draw_tile" }>,
): ApplyResult {
  if (state.lifecycle !== "in_play") {
    return reject("NOT_IN_PHASE"); // M-4
  }
  if (state.turn !== command.seat) {
    return reject("NOT_YOUR_TURN"); // M-4t — the only turn-gated command (docs/02 §6)
  }
  const { wall } = state.locations;
  if (wall.length === 0) {
    return reject("WALL_EMPTY");
  }

  const index = command.end === "head" ? 0 : wall.length - 1;
  const handle = wall[index];
  if (handle === undefined) {
    throw new Error("unreachable: index within wall bounds");
  }
  const newWall = (
    command.end === "head" ? wall.slice(1) : wall.slice(0, -1)
  ) as unknown as WallOrder<TileHandle>;

  // Newly acquired tiles append at the end of the existing order — the
  // dealer never rearranges a rack (DD-20, NR-304).
  const newHand = [...state.locations.hands[command.seat], handle];
  const newLocations = withHand({ ...state.locations, wall: newWall }, command.seat, newHand);

  const events: DealerEvent[] = [
    {
      type: "TileDrawn",
      seat: command.seat,
      end: command.end,
      handle,
      wallRemaining: newWall.length,
      newHandSize: newHand.length,
    },
  ];
  if (newWall.length === 0) {
    // DD-24: an observable fact. What it means is for the players (NR-012).
    events.push({ type: "WallExhausted" });
  }

  const newState: InPlayGameState = {
    ...state,
    seq: state.seq + 1,
    turn: nextSeat(command.seat), // moves on a wall draw (docs/09 §6.2)
    locations: newLocations,
  };
  return { ok: true, state: newState, events };
}

function applyDiscardTile(
  state: GameState,
  command: Extract<Command, { type: "discard_tile" }>,
): ApplyResult {
  if (state.lifecycle !== "in_play") {
    return reject("NOT_IN_PHASE"); // M-4
  }
  if (!state.tileByHandle.has(command.handle)) {
    return reject("NOT_YOUR_TILE"); // M-1: not a real tile in this game
  }
  const hand = state.locations.hands[command.seat];
  const index = hand.indexOf(command.handle);
  if (index === -1) {
    return reject("NOT_YOUR_TILE"); // M-2: this seat does not hold it
  }

  const newHand = [...hand.slice(0, index), ...hand.slice(index + 1)];
  const newDiscards = [...state.locations.discards, command.handle];
  const newLocations = withHand(
    { ...state.locations, discards: newDiscards },
    command.seat,
    newHand,
  );

  // Not turn-gated (docs/10 §5.2): a player may discard at any moment.
  const newState: InPlayGameState = { ...state, seq: state.seq + 1, locations: newLocations };
  const events: DealerEvent[] = [
    {
      type: "TileDiscarded",
      seat: command.seat,
      handle: command.handle,
      discardIndex: newDiscards.length - 1,
      newHandSize: newHand.length,
    },
  ];
  return { ok: true, state: newState, events };
}

function applyClaimDiscard(
  state: GameState,
  command: Extract<Command, { type: "claim_discard" }>,
): ApplyResult {
  if (state.lifecycle !== "in_play") {
    return reject("NOT_IN_PHASE"); // M-4
  }
  if (!state.tileByHandle.has(command.handle)) {
    return reject("TILE_NOT_AVAILABLE"); // M-1
  }
  const { discards } = state.locations;
  const current = discards[discards.length - 1];
  if (current === undefined || current !== command.handle) {
    return reject("TILE_NOT_AVAILABLE"); // M-3: only the current discard is claimable
  }

  const newDiscards = discards.slice(0, -1);
  const newHand = [...state.locations.hands[command.seat], command.handle];
  const newLocations = withHand(
    { ...state.locations, discards: newDiscards },
    command.seat,
    newHand,
  );

  // Available to any seat, no entitlement check (NR-005). The pointer
  // follows the claim regardless of whose turn it was (docs/09 §6.2).
  const newState: InPlayGameState = {
    ...state,
    seq: state.seq + 1,
    turn: command.seat,
    locations: newLocations,
  };
  const events: DealerEvent[] = [
    {
      type: "DiscardClaimed",
      seat: command.seat,
      handle: command.handle,
      newHandSize: newHand.length,
      turn: command.seat,
    },
  ];
  return { ok: true, state: newState, events };
}
