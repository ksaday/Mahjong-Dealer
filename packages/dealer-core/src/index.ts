// dealer-core's public surface (docs/06_Digital_Dealer_Architecture.md §3):
//   apply, project, checkpoint, restore, invariants
// plus the entropy contract the host must supply and the state/tile types
// needed to hold and construct a `GameState`.

export type { Entropy } from "./entropy.js";
export { draw128BitHex, draw256BitHex, uniformBelow } from "./entropy.js";

export type { Tile } from "./tiles/tile.js";
export { buildTileSet, compareTiles, tileKey } from "./tiles/tile.js";
export type { HandleMint } from "./tiles/handles.js";
export { handleTileKey, mintHandles } from "./tiles/handles.js";

export { shuffle } from "./wall/shuffle.js";
export { canonicalWallEncoding, computeCommitment } from "./wall/commitment.js";
export { dealOpeningHands, OPENING_HAND_COUNTS } from "./wall/deal.js";

export type {
  ConcludedGameState,
  ConcludingGameState,
  ConcludingProcess,
  CorrectionState,
  DeclarationProcess,
  EndGameProcess,
  Exposure,
  GameLifecycle,
  GameOutcome,
  GameState,
  IdleGameState,
  InPlayGameState,
  LiveGameState,
  PassRoundRouting,
  PassRoundState,
  PauseState,
  TileLocations,
} from "./state/state.js";
export { createIdleState } from "./state/state.js";
export type { ConservationOk, ConservationResult, ConservationViolation } from "./state/conservation.js";
export { invariants } from "./state/conservation.js";

export type { ApplyOk, ApplyResult, Command, DealerEvent, Rejection, RejectionCode } from "./commands/apply.js";
export { apply } from "./commands/apply.js";

export type {
  OwnTile,
  PublicConcludingProcess,
  PublicCorrection,
  PublicExposure,
  PublicPassRound,
  PublicTile,
  SeatSummary,
  SeatView,
} from "./projector/project.js";
export { project } from "./projector/project.js";

export { CheckpointRestoreError, checkpoint, restore } from "./checkpoint/checkpoint.js";
