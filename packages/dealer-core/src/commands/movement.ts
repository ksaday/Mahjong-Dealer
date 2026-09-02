// Play commands (docs/10_Player_Action_Model.md §5): draw, discard, claim,
// expose, retract, swap, arrange. Every validation is drawn from the closed
// M-1..M-5 vocabulary (docs/02 §3.1).
import { nextSeat, SEAT_ORDER, type Seat, type TileHandle, type WallOrder } from "@mahjong-dealer/shared";
import { removeFirst, withExposures, withHand } from "./helpers.js";
import { overlayBlocker } from "./overlay.js";
import { ok, reject, type ApplyResult, type Command, type DealerEvent } from "./types.js";
import type { Exposure, GameState, InPlayGameState } from "../state/state.js";

type Extracted<T extends Command["type"]> = Extract<Command, { type: T }>;

export function applyDrawTile(state: GameState, command: Extracted<"draw_tile">): ApplyResult {
  if (state.lifecycle !== "in_play") return reject("NOT_IN_PHASE");
  const blocker = overlayBlocker(state.paused, state.correction, state.passRound);
  if (blocker !== null) return reject(blocker);
  if (state.turn !== command.seat) return reject("NOT_YOUR_TURN"); // M-4t

  const { wall } = state.locations;
  if (wall.length === 0) return reject("WALL_EMPTY");

  const index = command.end === "head" ? 0 : wall.length - 1;
  const handle = wall[index];
  if (handle === undefined) throw new Error("unreachable: index within wall bounds");
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

  return ok(
    { ...state, seq: state.seq + 1, turn: nextSeat(command.seat), locations: newLocations },
    events,
  );
}

export function applyDiscardTile(state: GameState, command: Extracted<"discard_tile">): ApplyResult {
  if (state.lifecycle !== "in_play") return reject("NOT_IN_PHASE");
  const blocker = overlayBlocker(state.paused, state.correction, state.passRound);
  if (blocker !== null) return reject(blocker);
  if (!state.tileByHandle.has(command.handle)) return reject("NOT_YOUR_TILE"); // M-1

  const hand = state.locations.hands[command.seat];
  const newHand = removeFirst(hand, command.handle);
  if (newHand === null) return reject("NOT_YOUR_TILE"); // M-2

  const newDiscards = [...state.locations.discards, command.handle];
  const newLocations = withHand({ ...state.locations, discards: newDiscards }, command.seat, newHand);

  // Not turn-gated (docs/10 §5.2): a player may discard at any moment.
  const newState: InPlayGameState = { ...state, seq: state.seq + 1, locations: newLocations };
  return ok(newState, [
    {
      type: "TileDiscarded",
      seat: command.seat,
      handle: command.handle,
      discardIndex: newDiscards.length - 1,
      newHandSize: newHand.length,
    },
  ]);
}

export function applyClaimDiscard(state: GameState, command: Extracted<"claim_discard">): ApplyResult {
  if (state.lifecycle !== "in_play") return reject("NOT_IN_PHASE");
  const blocker = overlayBlocker(state.paused, state.correction, state.passRound);
  if (blocker !== null) return reject(blocker);
  if (!state.tileByHandle.has(command.handle)) return reject("TILE_NOT_AVAILABLE"); // M-1

  const { discards } = state.locations;
  const current = discards[discards.length - 1];
  if (current === undefined || current !== command.handle) return reject("TILE_NOT_AVAILABLE"); // M-3

  const newDiscards = discards.slice(0, -1);
  const newHand = [...state.locations.hands[command.seat], command.handle];
  const newLocations = withHand({ ...state.locations, discards: newDiscards }, command.seat, newHand);

  // Available to any seat, no entitlement check (NR-005). The pointer
  // follows the claim regardless of whose turn it was (docs/09 §6.2).
  const newState: InPlayGameState = {
    ...state,
    seq: state.seq + 1,
    turn: command.seat,
    locations: newLocations,
  };
  return ok(newState, [
    {
      type: "DiscardClaimed",
      seat: command.seat,
      handle: command.handle,
      newHandSize: newHand.length,
      turn: command.seat,
    },
  ]);
}

export function applyExposeTiles(state: GameState, command: Extracted<"expose_tiles">): ApplyResult {
  if (state.lifecycle !== "in_play" && state.lifecycle !== "concluding") return reject("NOT_IN_PHASE");
  const blocker = overlayBlocker(
    state.paused,
    state.correction,
    state.lifecycle === "in_play" ? state.passRound : null,
  );
  if (blocker !== null) return reject(blocker);

  let hand: readonly TileHandle[] = state.locations.hands[command.seat];
  for (const handle of command.handles) {
    if (!state.tileByHandle.has(handle)) return reject("NOT_YOUR_TILE"); // M-1
    const next = removeFirst(hand, handle);
    if (next === null) return reject("NOT_YOUR_TILE"); // M-2
    hand = next;
  }

  const exposureId = `exp-${String(state.nextExposureId)}`;
  const exposure: Exposure = { id: exposureId, handles: command.handles };
  const newExposures = [...state.locations.exposures[command.seat], exposure];
  const newLocations = withExposures(
    withHand(state.locations, command.seat, hand),
    command.seat,
    newExposures,
  );

  return ok({ ...state, seq: state.seq + 1, nextExposureId: state.nextExposureId + 1, locations: newLocations }, [
    {
      type: "TilesExposed",
      seat: command.seat,
      exposureId,
      handles: command.handles,
      newHandSize: hand.length,
    },
  ]);
}

export function applyRetractExposure(
  state: GameState,
  command: Extracted<"retract_exposure">,
): ApplyResult {
  if (state.lifecycle !== "in_play" && state.lifecycle !== "concluding") return reject("NOT_IN_PHASE");
  const blocker = overlayBlocker(
    state.paused,
    state.correction,
    state.lifecycle === "in_play" ? state.passRound : null,
  );
  if (blocker !== null) return reject(blocker);

  const ownExposures = state.locations.exposures[command.seat];
  const exposure = ownExposures.find((e) => e.id === command.exposureId);
  if (exposure === undefined) return reject("NOT_YOUR_TILE"); // M-1 / M-2

  const remaining = ownExposures.filter((e) => e.id !== command.exposureId);
  // Retracted tiles append at the end of the existing rack order (NR-304).
  const newHand = [...state.locations.hands[command.seat], ...exposure.handles];
  const newLocations = withExposures(
    withHand(state.locations, command.seat, newHand),
    command.seat,
    remaining,
  );

  return ok({ ...state, seq: state.seq + 1, locations: newLocations }, [
    {
      type: "ExposureRetracted",
      seat: command.seat,
      exposureId: exposure.id,
      handles: exposure.handles,
    },
  ]);
}

export function applySwapExposedTile(
  state: GameState,
  command: Extracted<"swap_exposed_tile">,
): ApplyResult {
  if (state.lifecycle !== "in_play") return reject("NOT_IN_PHASE");
  const blocker = overlayBlocker(state.paused, state.correction, state.passRound);
  if (blocker !== null) return reject(blocker);

  if (!state.tileByHandle.has(command.myHandle) || !state.tileByHandle.has(command.exposedHandle)) {
    return reject("NOT_YOUR_TILE"); // M-1
  }
  const hand = state.locations.hands[command.seat];
  const newHand = removeFirst(hand, command.myHandle);
  if (newHand === null) return reject("NOT_YOUR_TILE"); // M-2

  const owner = findExposureOwner(state, command.exposureId);
  if (owner === null) return reject("TILE_NOT_AVAILABLE"); // M-1: exposure doesn't exist
  const exposure = state.locations.exposures[owner].find((e) => e.id === command.exposureId);
  if (exposure === undefined) throw new Error("unreachable");
  const exposedIndex = exposure.handles.indexOf(command.exposedHandle);
  if (exposedIndex === -1) return reject("TILE_NOT_AVAILABLE"); // M-3

  const newExposureHandles = exposure.handles.slice();
  newExposureHandles[exposedIndex] = command.myHandle;
  const newOwnerExposures = state.locations.exposures[owner].map((e) =>
    e.id === command.exposureId ? { ...e, handles: newExposureHandles } : e,
  );

  // The received tile joins the hand like any newly acquired tile (end of order).
  const handAfterReceiving = [...newHand, command.exposedHandle];
  const newLocations = withExposures(
    withHand(state.locations, command.seat, handAfterReceiving),
    owner,
    newOwnerExposures,
  );

  return ok({ ...state, seq: state.seq + 1, locations: newLocations }, [
    {
      type: "ExposedTileSwapped",
      seat: command.seat,
      exposureId: command.exposureId,
      exposureOwner: owner,
      givenHandle: command.myHandle,
      takenHandle: command.exposedHandle,
      newHandSize: handAfterReceiving.length,
    },
  ]);
}

export function applyArrangeHand(state: GameState, command: Extracted<"arrange_hand">): ApplyResult {
  if (state.lifecycle !== "in_play" && state.lifecycle !== "concluding") return reject("NOT_IN_PHASE");
  // Private and changes nothing another seat can see, so — unlike the other
  // movement commands — not blocked by an open pass round (docs/10 §5.7).
  const blocker = overlayBlocker(state.paused, state.correction, null);
  if (blocker !== null) return reject(blocker);

  const current = state.locations.hands[command.seat];
  const isPermutation =
    current.length === command.handles.length &&
    [...current].sort().join(",") === [...command.handles].sort().join(",");
  if (!isPermutation) return reject("NOT_YOUR_TILE");

  const newLocations = withHand(state.locations, command.seat, command.handles);
  // No public event (docs/10 §5.7): the only command that emits nothing to
  // the other seats, because it changes nothing they can see.
  return ok({ ...state, seq: state.seq + 1, locations: newLocations }, [
    { type: "HandArranged", seat: command.seat },
  ]);
}

function findExposureOwner(state: InPlayGameState, exposureId: string): Seat | null {
  for (const seat of SEAT_ORDER) {
    if (state.locations.exposures[seat].some((e) => e.id === exposureId)) return seat;
  }
  return null;
}
