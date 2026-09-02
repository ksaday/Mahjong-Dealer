// Conclusion commands (docs/10_Player_Action_Model.md §7). The machine
// (docs/09 §4.3) must be structurally unable to express "the declaration
// was correct" — it can only express "everybody agreed" — so both paths
// (a Mahjong declaration and a plain end-game proposal) fall into the same
// `concluding` lifecycle and the same purge-on-conclude behavior.
import { SEAT_ORDER, type Seat, type TileHandle } from "@mahjong-dealer/shared";
import type { Tile } from "../tiles/tile.js";
import type {
  ConcludedGameState,
  ConcludingGameState,
  Exposure,
  GameOutcome,
  GameState,
  InPlayGameState,
  LiveGameState,
} from "../state/state.js";
import { otherSeats } from "./helpers.js";
import { ok, reject, type ApplyResult, type Command, type DealerEvent } from "./types.js";

type Extracted<T extends Command["type"]> = Extract<Command, { type: T }>;

export function applyDeclareMahjong(
  state: GameState,
  command: Extracted<"declare_mahjong">,
): ApplyResult {
  if (state.lifecycle !== "in_play") return reject("NOT_IN_PHASE");

  const newState: ConcludingGameState = {
    ...state,
    lifecycle: "concluding",
    seq: state.seq + 1,
    process: { kind: "declaration", declarer: command.seat, responses: {} },
  };
  return ok(newState, [{ type: "MahjongDeclared", seat: command.seat }]);
}

export function applyRevealHand(state: GameState, command: Extracted<"reveal_hand">): ApplyResult {
  if (state.lifecycle !== "in_play" && state.lifecycle !== "concluding") return reject("NOT_IN_PHASE");

  const handles = state.locations.hands[command.seat];
  const newState = { ...state, seq: state.seq + 1, revealedHands: new Set(state.revealedHands).add(command.seat) };
  return ok(newState, [{ type: "HandRevealed", seat: command.seat, handles }]);
}

export function applyRespondDeclaration(
  state: GameState,
  command: Extracted<"respond_declaration">,
): ApplyResult {
  if (state.lifecycle !== "concluding" || state.process.kind !== "declaration") {
    return reject("NOT_IN_PHASE");
  }
  const { process } = state;
  if (command.seat === process.declarer) return reject("NOT_IN_PHASE"); // M-4: not the declarer
  if (process.responses[command.seat] !== undefined) return reject("NOT_IN_PHASE"); // M-4: not already responded

  const events: DealerEvent[] = [
    { type: "DeclarationResponded", seat: command.seat, response: command.response },
  ];

  if (command.response === "dispute") {
    const { lifecycle: _lifecycle, process: _process, ...rest } = state;
    const backToPlay: InPlayGameState = { ...rest, lifecycle: "in_play", seq: state.seq + 1, passRound: null };
    events.push({ type: "DeclarationDisputed", seat: command.seat });
    return ok(backToPlay, events);
  }

  const newResponses = { ...process.responses, [command.seat]: "accept" as const };
  const unanimous = otherSeats(process.declarer).every((seat) => newResponses[seat] === "accept");

  if (!unanimous) {
    const newState: ConcludingGameState = {
      ...state,
      seq: state.seq + 1,
      process: { ...process, responses: newResponses },
    };
    return ok(newState, events);
  }

  const outcome: GameOutcome = { kind: "declaration_accepted", declarer: process.declarer };
  const concluded = concludeGame(state, outcome);
  events.push({ type: "GameConcluded", outcome });
  return ok(concluded, events);
}

export function applyWithdrawDeclaration(
  state: GameState,
  command: Extracted<"withdraw_declaration">,
): ApplyResult {
  if (state.lifecycle !== "concluding" || state.process.kind !== "declaration") {
    return reject("NOT_IN_PHASE");
  }
  if (state.process.declarer !== command.seat) return reject("NOT_IN_PHASE"); // M-4: only the declarer

  const { lifecycle: _lifecycle, process: _process, ...rest } = state;
  const backToPlay: InPlayGameState = { ...rest, lifecycle: "in_play", seq: state.seq + 1, passRound: null };
  return ok(backToPlay, [{ type: "DeclarationWithdrawn", seat: command.seat }]);
}

export function applyProposeEndGame(
  state: GameState,
  command: Extracted<"propose_end_game">,
): ApplyResult {
  if (state.lifecycle !== "in_play") return reject("NOT_IN_PHASE");

  const newState: ConcludingGameState = {
    ...state,
    lifecycle: "concluding",
    seq: state.seq + 1,
    process: { kind: "end_game", proposer: command.seat, responses: {} },
  };
  return ok(newState, [{ type: "EndGameProposed", seat: command.seat }]);
}

export function applyRespondEndGame(
  state: GameState,
  command: Extracted<"respond_end_game">,
): ApplyResult {
  if (state.lifecycle !== "concluding" || state.process.kind !== "end_game") {
    return reject("NOT_IN_PHASE");
  }
  const { process } = state;
  if (command.seat === process.proposer) return reject("NOT_IN_PHASE");
  if (process.responses[command.seat] !== undefined) return reject("NOT_IN_PHASE");

  const events: DealerEvent[] = [
    { type: "EndGameResponded", seat: command.seat, response: command.response },
  ];

  if (command.response === "decline") {
    const { lifecycle: _lifecycle, process: _process, ...rest } = state;
    const backToPlay: InPlayGameState = { ...rest, lifecycle: "in_play", seq: state.seq + 1, passRound: null };
    return ok(backToPlay, events);
  }

  const newResponses = { ...process.responses, [command.seat]: "accept" as const };
  const unanimous = otherSeats(process.proposer).every((seat) => newResponses[seat] === "accept");

  if (!unanimous) {
    const newState: ConcludingGameState = {
      ...state,
      seq: state.seq + 1,
      process: { ...process, responses: newResponses },
    };
    return ok(newState, events);
  }

  const outcome: GameOutcome = { kind: "ended_by_agreement" };
  const concluded = concludeGame(state, outcome);
  events.push({ type: "GameConcluded", outcome });
  return ok(concluded, events);
}

/**
 * Concealed material purged (docs/16 §5.5, docs/14 §4.3): only what was
 * already public survives — discards, exposures, voluntarily revealed
 * hands, and final hand sizes as a count.
 */
function concludeGame(state: LiveGameState, outcome: GameOutcome): ConcludedGameState {
  const finalHandSizes = {} as Record<Seat, number>;
  for (const seat of SEAT_ORDER) {
    finalHandSizes[seat] = state.locations.hands[seat].length;
  }

  const revealedHands = {} as Partial<Record<Seat, readonly TileHandle[]>>;
  for (const seat of state.revealedHands) {
    revealedHands[seat] = state.locations.hands[seat];
  }

  const publicHandles = new Set<TileHandle>(state.locations.discards);
  for (const seat of SEAT_ORDER) {
    for (const exposure of state.locations.exposures[seat] as readonly Exposure[]) {
      for (const handle of exposure.handles) publicHandles.add(handle);
    }
    const revealed = revealedHands[seat];
    if (revealed !== undefined) {
      for (const handle of revealed) publicHandles.add(handle);
    }
  }

  const publicTileByHandle = new Map<TileHandle, Tile>();
  for (const handle of publicHandles) {
    const tile = state.tileByHandle.get(handle);
    if (tile === undefined) throw new Error(`unreachable: handle ${handle} is not in this game's tile set`);
    publicTileByHandle.set(handle, tile);
  }

  return {
    lifecycle: "concluded",
    seq: state.seq + 1,
    outcome,
    finalHandSizes,
    discards: state.locations.discards,
    exposures: state.locations.exposures,
    revealedHands,
    publicTileByHandle,
  };
}
