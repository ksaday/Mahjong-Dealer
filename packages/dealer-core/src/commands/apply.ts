// The command dispatcher (docs/06_Digital_Dealer_Architecture.md §3;
// docs/10_Player_Action_Model.md). `apply` is total: every command produces
// either a new state or a typed rejection, never a partial mutation
// (docs/06 §3).
//
// Scope note: table-level commands — `set_ready`, `clear_ready`,
// `close_table` — belong to the table entity (docs/05), owned by the table
// actor (`server`, Phase 4) rather than this game-mechanics core; they are
// not implemented here (see `state/state.ts`'s header). The protocol
// commands `bind`/`resume`/`ping` (docs/10 §10) change no game state and
// are the gateway's concern (docs/12, Phase 5).
//
// Every validation across every command handler is drawn from the closed
// vocabulary in docs/02 §3.1 and named as such (docs/10 §3.1) — that naming
// discipline is what makes an added rule check visible in review
// (DEFINITION_OF_DONE.md §3.1).
import { SEAT_ORDER } from "@mahjong-dealer/shared";
import type { Entropy } from "../entropy.js";
import { dealOpeningHands } from "../wall/deal.js";
import type { GameState, InPlayGameState } from "../state/state.js";
import {
  applyArrangeHand,
  applyClaimDiscard,
  applyDiscardTile,
  applyDrawTile,
  applyExposeTiles,
  applyRetractExposure,
  applySwapExposedTile,
} from "./movement.js";
import {
  applyCancelPassRound,
  applyCommitPass,
  applyOpenPassRound,
  applyWithdrawPass,
} from "./passRound.js";
import {
  applyDeclareMahjong,
  applyProposeEndGame,
  applyRespondDeclaration,
  applyRespondEndGame,
  applyRevealHand,
  applyWithdrawDeclaration,
} from "./conclusion.js";
import { applyProposeCorrection, applyRespondCorrection } from "./correction.js";
import {
  applyRequestPause,
  applyRequestResume,
  applySendSignal,
  applySendTableMessage,
} from "./presence.js";
import { ok, reject, type ApplyResult, type Command, type DealerEvent } from "./types.js";

export type {
  ApplyOk,
  ApplyResult,
  Command,
  ConcludingProcess,
  DealerEvent,
  Rejection,
  RejectionCode,
} from "./types.js";

/**
 * `apply(state, command, entropy?, now?) -> { state', events[] } | Rejection`
 * (docs/06 §3). `entropy` is required for `start_deal` and — only when a
 * correction crosses a wall draw — `respond_correction`; every other
 * command consumes none. `now` is not yet threaded through: nothing in
 * this slice is time-sensitive (the correction/pass-round timeouts in
 * docs/05 §8.3 and docs/10 §6 are the table actor's clock, not the core's).
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
    case "expose_tiles":
      return applyExposeTiles(state, command);
    case "retract_exposure":
      return applyRetractExposure(state, command);
    case "swap_exposed_tile":
      return applySwapExposedTile(state, command);
    case "arrange_hand":
      return applyArrangeHand(state, command);
    case "open_pass_round":
      return applyOpenPassRound(state, command);
    case "commit_pass":
      return applyCommitPass(state, command);
    case "withdraw_pass":
      return applyWithdrawPass(state, command);
    case "cancel_pass_round":
      return applyCancelPassRound(state, command);
    case "declare_mahjong":
      return applyDeclareMahjong(state, command);
    case "reveal_hand":
      return applyRevealHand(state, command);
    case "respond_declaration":
      return applyRespondDeclaration(state, command);
    case "withdraw_declaration":
      return applyWithdrawDeclaration(state, command);
    case "propose_end_game":
      return applyProposeEndGame(state, command);
    case "respond_end_game":
      return applyRespondEndGame(state, command);
    case "propose_correction":
      return applyProposeCorrection(state, command);
    case "respond_correction":
      return applyRespondCorrection(state, command, entropy);
    case "request_pause":
      return applyRequestPause(state, command);
    case "request_resume":
      return applyRequestResume(state, command);
    case "send_table_message":
      return applySendTableMessage(state, command);
    case "send_signal":
      return applySendSignal(state, command);
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

  const handSizes = {} as Record<(typeof SEAT_ORDER)[number], number>;
  for (const seat of SEAT_ORDER) {
    handSizes[seat] = dealt.locations.hands[seat].length;
  }

  const events: DealerEvent[] = [
    { type: "WallBuilt", wallLength: dealt.locations.wall.length },
    { type: "DealCommitmentPublished", commitment: dealt.commitment },
    { type: "TilesDealt", handSizes, turn: dealt.turn },
  ];

  return ok(dealt, events);
}
