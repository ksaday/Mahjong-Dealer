// The pass-round family (docs/10_Player_Action_Model.md §6): a neutral,
// simultaneous, secret, atomic exchange, deliberately not named after any
// rule concept. The system does not check direction, symmetry, or that all
// four seats participate (NR-008).
import { SEAT_ORDER, type Seat, type TileHandle } from "@mahjong-dealer/shared";
import { removeFirst, withHand, withInFlight } from "./helpers.js";
import { overlayBlocker } from "./overlay.js";
import { ok, reject, type ApplyResult, type Command, type DealerEvent } from "./types.js";
import type { GameState, InPlayGameState, PassRoundState, TileLocations } from "../state/state.js";

type Extracted<T extends Command["type"]> = Extract<Command, { type: T }>;

function participants(routing: PassRoundState["routing"]): readonly Seat[] {
  return routing.map((r) => r.from);
}

export function applyOpenPassRound(
  state: GameState,
  command: Extracted<"open_pass_round">,
): ApplyResult {
  if (state.lifecycle !== "in_play") return reject("NOT_IN_PHASE");
  // A correction cannot be proposed while a pass round is open (docs/09
  // §5.2) — read the other way, a round cannot open while a correction is
  // pending, which the shared precedence already gives us. It can also
  // never open while one is already open, which is the M-4 check below.
  const blocker = overlayBlocker(state.paused, state.correction, undefined);
  if (blocker !== null) return reject(blocker);
  if (state.passRound !== null) return reject("PASS_ROUND_OPEN"); // M-4: no round open

  const froms = participants(command.routing);
  const distinctFroms = new Set(froms);
  if (distinctFroms.size !== froms.length) {
    // Well-formedness (M-5): a seat cannot be asked to commit twice in one round.
    return reject("NOT_YOUR_TILE");
  }

  const newState: InPlayGameState = {
    ...state,
    seq: state.seq + 1,
    passRound: { routing: command.routing, committed: {} },
  };
  return ok(newState, [
    { type: "PassRoundOpened", opener: command.seat, routing: command.routing },
  ]);
}

export function applyCommitPass(state: GameState, command: Extracted<"commit_pass">): ApplyResult {
  if (state.lifecycle !== "in_play") return reject("NOT_IN_PHASE");
  if (state.paused !== null) return reject("TABLE_PAUSED");
  const round = state.passRound;
  if (round === null) return reject("PASS_ROUND_OPEN"); // M-4: round must be open
  if (!participants(round.routing).includes(command.seat)) return reject("NOT_IN_PHASE"); // M-4: this seat participates
  if (round.committed[command.seat] !== undefined) return reject("NOT_IN_PHASE"); // M-4: not already committed

  let hand: readonly TileHandle[] = state.locations.hands[command.seat];
  for (const handle of command.handles) {
    if (!state.tileByHandle.has(handle)) return reject("NOT_YOUR_TILE"); // M-1
    const next = removeFirst(hand, handle);
    if (next === null) return reject("NOT_YOUR_TILE"); // M-2
    hand = next;
  }

  const newLocations = withInFlight(
    withHand(state.locations, command.seat, hand),
    command.seat,
    command.handles,
  );
  const newRound: PassRoundState = {
    routing: round.routing,
    committed: { ...round.committed, [command.seat]: command.handles },
  };

  const events: DealerEvent[] = [
    { type: "PassCommitted", seat: command.seat, count: command.handles.length },
  ];

  const allCommitted = participants(round.routing).every(
    (seat) => newRound.committed[seat] !== undefined,
  );
  if (!allCommitted) {
    return ok({ ...state, seq: state.seq + 1, locations: newLocations, passRound: newRound }, events);
  }

  // The last participant just committed — execute atomically (docs/10 §6,
  // "Execution"): no seat learns another's tiles before this moment.
  const { locations: executedLocations, counts } = executePassRound(newLocations, newRound);
  events.push({ type: "PassRoundExecuted", routing: round.routing, counts });

  return ok(
    { ...state, seq: state.seq + 1, locations: executedLocations, passRound: null },
    events,
  );
}

function executePassRound(
  locations: TileLocations,
  round: PassRoundState,
): { locations: TileLocations; counts: Partial<Record<Seat, number>> } {
  let result = locations;
  const counts: Partial<Record<Seat, number>> = {};
  for (const { from, to } of round.routing) {
    const handles = round.committed[from];
    if (handles === undefined) throw new Error("unreachable: every participant has committed");
    counts[from] = handles.length;
    result = withInFlight(result, from, []);
    result = withHand(result, to, [...result.hands[to], ...handles]);
  }
  return { locations: result, counts };
}

export function applyWithdrawPass(state: GameState, command: Extracted<"withdraw_pass">): ApplyResult {
  if (state.lifecycle !== "in_play") return reject("NOT_IN_PHASE");
  const round = state.passRound;
  if (round === null) return reject("PASS_ROUND_OPEN");
  const committed = round.committed[command.seat];
  if (committed === undefined) return reject("NOT_IN_PHASE"); // M-4: must have committed

  const newHand = [...state.locations.hands[command.seat], ...committed];
  const newLocations = withInFlight(
    withHand(state.locations, command.seat, newHand),
    command.seat,
    [],
  );
  const { [command.seat]: _removed, ...rest } = round.committed;
  const newRound: PassRoundState = { routing: round.routing, committed: rest };

  return ok(
    { ...state, seq: state.seq + 1, locations: newLocations, passRound: newRound },
    [{ type: "PassWithdrawn", seat: command.seat }],
  );
}

export function applyCancelPassRound(
  state: GameState,
  command: Extracted<"cancel_pass_round">,
): ApplyResult {
  if (state.lifecycle !== "in_play") return reject("NOT_IN_PHASE");
  const round = state.passRound;
  if (round === null) return reject("PASS_ROUND_OPEN");
  if (!participants(round.routing).includes(command.seat)) return reject("NOT_IN_PHASE"); // M-4

  // All commitments return to their senders (docs/10 §6, `cancel_pass_round`).
  let locations = state.locations;
  for (const seat of SEAT_ORDER) {
    const committed = round.committed[seat];
    if (committed === undefined) continue;
    locations = withInFlight(withHand(locations, seat, [...locations.hands[seat], ...committed]), seat, []);
  }

  return ok({ ...state, seq: state.seq + 1, locations, passRound: null }, [
    { type: "PassRoundCancelled", seat: command.seat },
  ]);
}
