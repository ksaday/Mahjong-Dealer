// Overlay-flag blocking, in the fixed precedence from docs/09_Game_State_Machine.md
// §5.2: PAUSED, then CORRECTION_PENDING, then PASS_ROUND_OPEN.
//
// Scope note: docs/09 §5.2 draws its flag-interaction rules narrowly per
// command family (e.g. `arrange_hand` is private and untouched by a pass
// round; `respond_correction` naturally requires `CORRECTION_PENDING`
// rather than being blocked by it). This module is the single
// uniformly-applied version used by every "movement" and "process" command
// in this slice; each call site below documents where it diverges from a
// bespoke per-command rule the full docs/10 catalog might draw more finely.
import type { CorrectionState, PassRoundState, PauseState } from "../state/state.js";
import type { RejectionCode } from "./types.js";

export function overlayBlocker(
  paused: PauseState | null,
  correction: CorrectionState | null,
  passRound: PassRoundState | null | undefined,
): RejectionCode | null {
  if (paused !== null) return "TABLE_PAUSED";
  if (correction !== null) return "CORRECTION_PENDING";
  if (passRound !== null && passRound !== undefined) return "PASS_ROUND_OPEN";
  return null;
}
