// Correction — bounded, unanimous-consent rewind (docs/05_Game_Table_Architecture.md
// §8; ADR-0016). Notably, `TABLE_PAUSED` does **not** block either command
// here (docs/05 §10, docs/09 §5.2): "a paused table still accepts
// correction responses, because a pause is often exactly when the players
// are working out what went wrong."
//
// Scope note: `dealer-core` retains no history of its own (docs/03 §5) —
// the actor is what keeps checkpoints (docs/16 §5). So this module cannot,
// by itself, verify that `rewindTo` is within the retained window or fetch
// the state to restore; both are supplied by the host, the same way
// `start_deal` is supplied entropy. See `types.ts` for the two host-only
// fields this adds to the wire-facing command shape.
import type { Salt, TileHandle, WallOrder } from "@mahjong-dealer/shared";
import type { Entropy } from "../entropy.js";
import { draw256BitHex } from "../entropy.js";
import { computeCommitment } from "../wall/commitment.js";
import { shuffle } from "../wall/shuffle.js";
import type { Tile } from "../tiles/tile.js";
import type { GameState, InPlayGameState } from "../state/state.js";
import { otherSeats } from "./helpers.js";
import { ok, reject, type ApplyResult, type Command, type DealerEvent } from "./types.js";

type Extracted<T extends Command["type"]> = Extract<Command, { type: T }>;

export function applyProposeCorrection(
  state: GameState,
  command: Extracted<"propose_correction">,
): ApplyResult {
  if (state.lifecycle !== "in_play") return reject("NOT_IN_PHASE");
  if (state.passRound !== null) return reject("PASS_ROUND_OPEN"); // docs/09 §5.2
  if (state.correction !== null) return reject("CORRECTION_PENDING"); // M-4: one proposal at a time

  const targetIsPriorAction = command.rewindTo >= 0 && command.rewindTo < state.seq;
  const withinWindow = command.rewindTo >= command.oldestAvailableSeq;
  if (!targetIsPriorAction || !withinWindow) return reject("NO_CHECKPOINT");

  const newState: InPlayGameState = {
    ...state,
    seq: state.seq + 1,
    correction: { proposer: command.seat, rewindTo: command.rewindTo, responses: {} },
  };
  return ok(newState, [
    { type: "CorrectionProposed", seat: command.seat, rewindTo: command.rewindTo },
  ]);
}

export function applyRespondCorrection(
  state: GameState,
  command: Extracted<"respond_correction">,
  entropy?: Entropy,
): ApplyResult {
  if (state.lifecycle !== "in_play") return reject("NOT_IN_PHASE");
  const correction = state.correction;
  if (correction === null) return reject("NOT_IN_PHASE"); // M-4: nothing pending
  if (command.seat === correction.proposer) return reject("NOT_IN_PHASE"); // M-4: not the proposer
  if (correction.responses[command.seat] !== undefined) return reject("NOT_IN_PHASE"); // M-4: not already responded

  if (command.response === "reject") {
    const newState: InPlayGameState = { ...state, seq: state.seq + 1, correction: null };
    return ok(newState, [
      { type: "CorrectionResponded", seat: command.seat, response: "reject" },
      { type: "CorrectionRejected", reason: "rejected" },
    ]);
  }

  const newResponses = { ...correction.responses, [command.seat]: "accept" as const };
  const unanimous = otherSeats(correction.proposer).every((seat) => newResponses[seat] === "accept");

  if (!unanimous) {
    const newState: InPlayGameState = {
      ...state,
      seq: state.seq + 1,
      correction: { ...correction, responses: newResponses },
    };
    return ok(newState, [{ type: "CorrectionResponded", seat: command.seat, response: "accept" }]);
  }

  // Unanimity among the other three (D-05-05) — perform the rewind.
  if (command.restoreCandidate === undefined) {
    throw new Error(
      "respond_correction reached unanimity but no restoreCandidate was supplied (host wiring defect)",
    );
  }
  const restored = command.restoreCandidate;
  if (restored.lifecycle !== "in_play") {
    throw new Error("a correction's restoreCandidate must be an in-play checkpoint");
  }

  const events: DealerEvent[] = [
    { type: "CorrectionResponded", seat: command.seat, response: "accept" },
  ];

  // A rewind crossing a wall draw is the only case that leaks anything
  // (docs/05 §8.4): the wall was longer before those draws happened, so a
  // shorter current wall than the restored one is exactly that crossing.
  const crossesWallDraw = restored.locations.wall.length > state.locations.wall.length;

  let wall = restored.locations.wall;
  let salt = restored.salt;
  let commitment = restored.commitment;

  if (crossesWallDraw) {
    if (entropy === undefined) {
      throw new Error(
        "a correction crossing a wall draw requires injected entropy for the reshuffle (docs/08 §7.2)",
      );
    }
    // Only the undrawn remainder is re-randomized — every tile a player
    // legitimately holds, every discard, and every exposure is left exactly
    // as restored (docs/08 §7.2, D-08-07).
    const reshuffledHandles = shuffle(restored.locations.wall, entropy);
    salt = draw256BitHex(entropy) as Salt;
    const reshuffledTiles = reshuffledHandles.map((handle) => lookup(handle, restored.tileByHandle));
    commitment = computeCommitment(reshuffledTiles, salt);
    wall = reshuffledHandles as unknown as WallOrder<TileHandle>;
    events.push({ type: "ReshuffleCommitmentPublished", commitment });
  }

  const newState: InPlayGameState = {
    ...restored,
    locations: { ...restored.locations, wall },
    salt,
    commitment,
    paused: state.paused, // a live connectivity condition, not part of the game's history
    correction: null,
    seq: state.seq + 1,
  };
  events.push({
    type: "CorrectionApplied",
    restoredSeq: correction.rewindTo,
    reshuffled: crossesWallDraw,
  });
  return ok(newState, events);
}

function lookup(handle: TileHandle, tileByHandle: ReadonlyMap<TileHandle, Tile>): Tile {
  const tile = tileByHandle.get(handle);
  if (tile === undefined) throw new Error(`unreachable: handle ${handle} is not in this game's tile set`);
  return tile;
}
