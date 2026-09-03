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

/**
 * Multi-holder (docs/22 §5.2, `state.ts`'s `PauseState` doc comment): a
 * seat already holding a pause gets `NOT_IN_PHASE` for requesting again
 * (nothing changes), but a *different* seat may add its own hold to an
 * already-paused table — the table was already externally `TABLE_PAUSED`,
 * and this seat's own absence or request is still worth recording and
 * announcing (`TablePaused` fires for every seat that holds, not only the
 * first).
 */
export function applyRequestPause(state: GameState, command: Extracted<"request_pause">): ApplyResult {
  if (state.lifecycle !== "in_play" && state.lifecycle !== "concluding") return reject("NOT_IN_PHASE");
  if (state.paused !== null && state.paused.requestedBy.has(command.seat)) return reject("NOT_IN_PHASE"); // this seat already holds a pause

  const requestedBy = new Set(state.paused?.requestedBy);
  requestedBy.add(command.seat);
  return ok({ ...state, seq: state.seq + 1, paused: { requestedBy } }, [
    { type: "TablePaused", seat: command.seat },
  ]);
}

/** Only the requester releases their own hold (docs/05 §10); the table resumes only once every hold has cleared (docs/22 §5.2). */
export function applyRequestResume(state: GameState, command: Extracted<"request_resume">): ApplyResult {
  if (state.lifecycle !== "in_play" && state.lifecycle !== "concluding") return reject("NOT_IN_PHASE");
  if (state.paused === null || !state.paused.requestedBy.has(command.seat)) return reject("NOT_IN_PHASE"); // nothing to resume for this seat

  const requestedBy = new Set(state.paused.requestedBy);
  requestedBy.delete(command.seat);
  const paused = requestedBy.size === 0 ? null : { requestedBy };
  return ok({ ...state, seq: state.seq + 1, paused }, [
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
