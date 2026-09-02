// Shared command/event/rejection types (docs/10_Player_Action_Model.md).
//
// Scope note: `cmdId`/`cseq`/`seq`-staleness sequencing (M-5's wire half),
// schema validation ("well-formed" — docs/02 §5.2's `SHAPE` stage), and
// rate limiting are gateway concerns (docs/13, Phase 5), enforced before a
// command ever reaches `apply`. So are `DUPLICATE_COMMAND`, `SEQ_GAP`,
// `STALE_STATE`, `MALFORMED`, and `RATE_LIMITED` from the docs/10 §11
// catalog — `dealer-core` assumes it is being called with a well-formed,
// already-deduplicated, already-ordered command for the right table, and
// never produces those five codes itself.
import type { Seat, TileHandle } from "@mahjong-dealer/shared";
import type {
  ConcludingProcess,
  GameOutcome,
  GameState,
  PassRoundRouting,
} from "../state/state.js";

export type Command =
  | { readonly type: "start_deal"; readonly seat: Seat }
  | { readonly type: "draw_tile"; readonly seat: Seat; readonly end: "head" | "tail" }
  | { readonly type: "discard_tile"; readonly seat: Seat; readonly handle: TileHandle }
  | { readonly type: "claim_discard"; readonly seat: Seat; readonly handle: TileHandle }
  | { readonly type: "expose_tiles"; readonly seat: Seat; readonly handles: readonly TileHandle[] }
  | { readonly type: "retract_exposure"; readonly seat: Seat; readonly exposureId: string }
  | {
      readonly type: "swap_exposed_tile";
      readonly seat: Seat;
      readonly myHandle: TileHandle;
      readonly exposureId: string;
      readonly exposedHandle: TileHandle;
    }
  | { readonly type: "arrange_hand"; readonly seat: Seat; readonly handles: readonly TileHandle[] }
  | { readonly type: "open_pass_round"; readonly seat: Seat; readonly routing: readonly PassRoundRouting[] }
  | { readonly type: "commit_pass"; readonly seat: Seat; readonly handles: readonly TileHandle[] }
  | { readonly type: "withdraw_pass"; readonly seat: Seat }
  | { readonly type: "cancel_pass_round"; readonly seat: Seat }
  | { readonly type: "declare_mahjong"; readonly seat: Seat }
  | { readonly type: "reveal_hand"; readonly seat: Seat }
  | { readonly type: "respond_declaration"; readonly seat: Seat; readonly response: "accept" | "dispute" }
  | { readonly type: "withdraw_declaration"; readonly seat: Seat }
  | { readonly type: "propose_end_game"; readonly seat: Seat }
  | { readonly type: "respond_end_game"; readonly seat: Seat; readonly response: "accept" | "decline" }
  | {
      readonly type: "propose_correction";
      readonly seat: Seat;
      readonly rewindTo: number;
      /** Host-supplied: the oldest sequence number it still has a checkpoint for (docs/05 §8.3). */
      readonly oldestAvailableSeq: number;
    }
  | {
      readonly type: "respond_correction";
      readonly seat: Seat;
      readonly response: "accept" | "reject";
      /**
       * Host-supplied: the checkpoint at the pending proposal's `rewindTo`.
       * Only consulted if this response completes unanimity — dealer-core
       * has no persistence of its own (docs/03 §5), so the actor supplies
       * the state it already retains (docs/16 §5).
       */
      readonly restoreCandidate?: GameState;
    }
  | { readonly type: "request_pause"; readonly seat: Seat }
  | { readonly type: "request_resume"; readonly seat: Seat }
  | { readonly type: "send_table_message"; readonly seat: Seat; readonly text: string }
  | { readonly type: "send_signal"; readonly seat: Seat; readonly signal: "knock" | "wait" | "ack" };

/** Rejection codes this package can produce, from the closed catalog in docs/10 §11. */
export type RejectionCode =
  | "NOT_IN_PHASE" // M-4
  | "NOT_YOUR_TURN" // M-4t — draw_tile only
  | "NOT_YOUR_TILE" // M-1 / M-2
  | "TILE_NOT_AVAILABLE" // M-1 / M-3
  | "WALL_EMPTY"
  | "TABLE_PAUSED"
  | "CORRECTION_PENDING"
  | "PASS_ROUND_OPEN"
  | "NO_CHECKPOINT";

export interface Rejection {
  readonly ok: false;
  readonly code: RejectionCode;
}

export function reject(code: RejectionCode): Rejection {
  return { ok: false, code };
}

export type DealerEvent =
  | { readonly type: "WallBuilt"; readonly wallLength: number }
  | { readonly type: "DealCommitmentPublished"; readonly commitment: string }
  | { readonly type: "TilesDealt"; readonly handSizes: Readonly<Record<Seat, number>>; readonly turn: Seat }
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
    }
  | {
      readonly type: "TilesExposed";
      readonly seat: Seat;
      readonly exposureId: string;
      readonly handles: readonly TileHandle[];
      readonly newHandSize: number;
    }
  | {
      readonly type: "ExposureRetracted";
      readonly seat: Seat;
      readonly exposureId: string;
      readonly handles: readonly TileHandle[];
    }
  | {
      readonly type: "ExposedTileSwapped";
      readonly seat: Seat;
      readonly exposureId: string;
      readonly exposureOwner: Seat;
      readonly givenHandle: TileHandle;
      readonly takenHandle: TileHandle;
      readonly newHandSize: number;
    }
  | { readonly type: "HandArranged"; readonly seat: Seat }
  | {
      readonly type: "PassRoundOpened";
      readonly opener: Seat;
      readonly routing: readonly PassRoundRouting[];
    }
  | { readonly type: "PassCommitted"; readonly seat: Seat; readonly count: number }
  | { readonly type: "PassWithdrawn"; readonly seat: Seat }
  | { readonly type: "PassRoundCancelled"; readonly seat: Seat }
  | {
      readonly type: "PassRoundExecuted";
      readonly routing: readonly PassRoundRouting[];
      readonly counts: Readonly<Partial<Record<Seat, number>>>;
    }
  | { readonly type: "MahjongDeclared"; readonly seat: Seat }
  | { readonly type: "HandRevealed"; readonly seat: Seat; readonly handles: readonly TileHandle[] }
  | {
      readonly type: "DeclarationResponded";
      readonly seat: Seat;
      readonly response: "accept" | "dispute";
    }
  | { readonly type: "DeclarationDisputed"; readonly seat: Seat }
  | { readonly type: "DeclarationWithdrawn"; readonly seat: Seat }
  | { readonly type: "EndGameProposed"; readonly seat: Seat }
  | { readonly type: "EndGameResponded"; readonly seat: Seat; readonly response: "accept" | "decline" }
  | { readonly type: "GameConcluded"; readonly outcome: GameOutcome }
  | {
      readonly type: "CorrectionProposed";
      readonly seat: Seat;
      readonly rewindTo: number;
    }
  | {
      readonly type: "CorrectionResponded";
      readonly seat: Seat;
      readonly response: "accept" | "reject";
    }
  | {
      readonly type: "CorrectionApplied";
      readonly restoredSeq: number;
      readonly reshuffled: boolean;
    }
  | { readonly type: "ReshuffleCommitmentPublished"; readonly commitment: string }
  | { readonly type: "CorrectionRejected"; readonly reason: "rejected" | "timeout" }
  | { readonly type: "TablePaused"; readonly seat: Seat }
  | { readonly type: "TableResumed"; readonly seat: Seat }
  | { readonly type: "TableMessage"; readonly seat: Seat; readonly text: string }
  | { readonly type: "TableSignal"; readonly seat: Seat; readonly signal: "knock" | "wait" | "ack" };

export interface ApplyOk {
  readonly ok: true;
  readonly state: GameState;
  readonly events: readonly DealerEvent[];
}

export type ApplyResult = ApplyOk | Rejection;

export function ok(state: GameState, events: readonly DealerEvent[]): ApplyOk {
  return { ok: true, state, events };
}

/** Re-exported so command modules don't each import both files. */
export type { ConcludingProcess };
