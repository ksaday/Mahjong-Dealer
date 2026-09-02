// Shared test fixtures: a freshly dealt in-play state, and a narrowing
// helper for asserting a lifecycle after an `apply` call.
import { apply, type Command } from "../commands/apply.js";
import type { ApplyResult } from "../commands/types.js";
import { createIdleState, type GameState, type GameLifecycle } from "../state/state.js";
import { createDeterministicEntropy } from "./deterministic-entropy.js";

export function dealtState(seed = 1) {
  const result = apply(createIdleState(), { type: "start_deal", seat: "east" }, createDeterministicEntropy(seed));
  if (!result.ok) throw new Error("unreachable: deal should always succeed from idle");
  return expectLifecycle(result.state, "in_play");
}

export function expectLifecycle<L extends GameLifecycle>(
  state: GameState,
  lifecycle: L,
): Extract<GameState, { lifecycle: L }> {
  if (state.lifecycle !== lifecycle) {
    throw new Error(`expected lifecycle ${lifecycle}, got ${state.lifecycle}`);
  }
  return state as Extract<GameState, { lifecycle: L }>;
}

export function assertOk(result: ApplyResult): GameState {
  if (!result.ok) throw new Error(`unreachable: expected an accepted command, got rejection ${result.code}`);
  return result.state;
}

export function applyOk(state: GameState, command: Command): GameState {
  return assertOk(apply(state, command));
}
