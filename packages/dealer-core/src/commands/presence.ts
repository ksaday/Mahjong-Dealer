// Pause and the ephemeral table channel (docs/05_Game_Table_Architecture.md
// §9, §10; docs/10_Player_Action_Model.md §9).
//
// Scope note: docs/09 §7's command matrix allows `request_pause`/
// `request_resume` in every lifecycle including `idle` and `concluded`.
// This slice only models pause on `in_play`/`concluding` — the two states
// with any live command to actually block — since `IdleGameState` and
// `ConcludedGameState` carry no field for it and there is nothing
// meaningful to pause there. Chat and signals are genuinely
// lifecycle-agnostic (they mutate no game state, and are never persisted —
// docs/05 §9.2, FR-131) and are implemented for every `GameState` variant.
import { ok, reject, type ApplyResult, type Command } from "./types.js";
import type { GameState } from "../state/state.js";

type Extracted<T extends Command["type"]> = Extract<Command, { type: T }>;

export function applyRequestPause(state: GameState, command: Extracted<"request_pause">): ApplyResult {
  if (state.lifecycle !== "in_play" && state.lifecycle !== "concluding") return reject("NOT_IN_PHASE");
  if (state.paused !== null) return reject("NOT_IN_PHASE"); // already paused

  return ok({ ...state, seq: state.seq + 1, paused: { requestedBy: command.seat } }, [
    { type: "TablePaused", seat: command.seat },
  ]);
}

export function applyRequestResume(state: GameState, command: Extracted<"request_resume">): ApplyResult {
  if (state.lifecycle !== "in_play" && state.lifecycle !== "concluding") return reject("NOT_IN_PHASE");
  if (state.paused === null) return reject("NOT_IN_PHASE"); // nothing to resume
  // Only the requester releases their own pause (docs/05 §10).
  if (state.paused.requestedBy !== command.seat) return reject("NOT_IN_PHASE");

  return ok({ ...state, seq: state.seq + 1, paused: null }, [
    { type: "TableResumed", seat: command.seat },
  ]);
}

export function applySendTableMessage(
  state: GameState,
  command: Extracted<"send_table_message">,
): ApplyResult {
  // Never persisted, logged, checkpointed, or exported (FR-131) — nothing
  // above stores this event; it is handed to the gateway for delivery only.
  return ok({ ...state, seq: state.seq + 1 }, [
    { type: "TableMessage", seat: command.seat, text: command.text },
  ]);
}

export function applySendSignal(state: GameState, command: Extracted<"send_signal">): ApplyResult {
  // No signal carries game meaning (docs/05 §9.3).
  return ok({ ...state, seq: state.seq + 1 }, [
    { type: "TableSignal", seat: command.seat, signal: command.signal },
  ]);
}
