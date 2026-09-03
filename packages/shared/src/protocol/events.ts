// The table event catalog (docs/19_WebSocket_Event_Catalog.md §6).
// `PascalCase` per the naming law (§3) — checked in events.test.ts.
//
// Every event field is either PUB (delivered to all four seats, in every
// copy of the event) or OWN (delivered only to the named seat). Rather than
// two payload shapes per event, OWN fields are modeled as optional
// properties on one type: present in the copy sent to the entitled seat,
// absent from the other three (docs/19 §6, "one event, four different
// payloads").
//
// A tile-identifying field here (`tile`, `tiles`, `tileIn`, `tileOut`,
// `received`) is always a bare face (docs/07 §5.2 codec), never a
// `{ handle, tile }` pair — even where the tile is new to the receiving
// seat (`TilesDealt`, `PassRoundExecuted`'s `received`). The handle for any
// such tile is available from the seat view that accompanies every event
// (docs/33_API §3, CO-5): events describe what happened, the view is the
// addressable source of truth.
import type { Face } from "../tiles/face.js";
import type { Seat } from "../table/seat.js";

// --- Seating and presence (docs/19 §6.1) ---

export interface SeatOccupiedEvent {
  readonly type: "SeatOccupied";
  readonly seat: Seat;
  readonly displayName: string;
}
export interface SeatVacatedEvent {
  readonly type: "SeatVacated";
  readonly seat: Seat;
}
export interface SeatReadyEvent {
  readonly type: "SeatReady";
  readonly seat: Seat;
}
export interface SeatUnreadyEvent {
  readonly type: "SeatUnready";
  readonly seat: Seat;
}
export interface SeatDisconnectedEvent {
  readonly type: "SeatDisconnected";
  readonly seat: Seat;
  /** The presence state the seat just moved *to* (docs/22 §3-§4) — fires for both `away` (first missed heartbeat) and `absent` (second miss, or a clean close, which skips `away` entirely). */
  readonly reason: "away" | "absent";
}
export interface SeatReconnectedEvent {
  readonly type: "SeatReconnected";
  readonly seat: Seat;
}
export interface TablePausedEvent {
  readonly type: "TablePaused";
  readonly seat: Seat;
  /** `"requested"`: an explicit `request_pause`. `"seat_absent"`: auto-pause on disconnection (docs/22 §5). */
  readonly reason: "requested" | "seat_absent";
}
export interface TableResumedEvent {
  readonly type: "TableResumed";
  readonly seat: Seat;
}
export interface TableClosedEvent {
  readonly type: "TableClosed";
  readonly reason: string;
}

// --- Dealing (docs/19 §6.2) ---

export interface WallBuiltEvent {
  readonly type: "WallBuilt";
  readonly wallRemaining: number;
}
export interface DealCommitmentPublishedEvent {
  readonly type: "DealCommitmentPublished";
  readonly commitment: string;
}
export interface TilesDealtEvent {
  readonly type: "TilesDealt";
  readonly handSizes: Readonly<Record<Seat, number>>;
  readonly turn: Seat;
  readonly wallRemaining: number;
  /** OWN: this seat's dealt tiles, in deal order. */
  readonly tiles?: readonly Face[];
}
export interface ReshuffleCommitmentPublishedEvent {
  readonly type: "ReshuffleCommitmentPublished";
  readonly commitment: string;
  readonly atSeq: number;
}

// --- Play (docs/19 §6.3) ---

export interface TileDrawnEvent {
  readonly type: "TileDrawn";
  readonly seat: Seat;
  readonly end: "head" | "tail";
  readonly wallRemaining: number;
  readonly handSize: number;
  /** OWN: only the drawing seat learns the face. */
  readonly tile?: Face;
}
export interface TileDiscardedEvent {
  readonly type: "TileDiscarded";
  readonly seat: Seat;
  readonly tile: Face;
  readonly discardIndex: number;
  readonly handSize: number;
}
export interface DiscardClaimedEvent {
  readonly type: "DiscardClaimed";
  readonly seat: Seat;
  readonly tile: Face;
  readonly handSize: number;
  readonly turn: Seat;
}
export interface TilesExposedEvent {
  readonly type: "TilesExposed";
  readonly seat: Seat;
  readonly exposureId: string;
  readonly tiles: readonly Face[];
  readonly handSize: number;
}
export interface ExposureRetractedEvent {
  readonly type: "ExposureRetracted";
  readonly seat: Seat;
  readonly exposureId: string;
  readonly tiles: readonly Face[];
  readonly handSize: number;
}
export interface ExposedTileSwappedEvent {
  readonly type: "ExposedTileSwapped";
  readonly seat: Seat;
  readonly exposureId: string;
  readonly exposureOwner: Seat;
  readonly tileIn: Face;
  readonly tileOut: Face;
  readonly handSize: number;
}
export interface WallExhaustedEvent {
  readonly type: "WallExhausted";
}

// --- Pass rounds (docs/19 §6.4) ---

export interface PassRoundOpenedEvent {
  readonly type: "PassRoundOpened";
  readonly openedBy: Seat;
  readonly routing: readonly { readonly from: Seat; readonly to: Seat }[];
  readonly participants: readonly Seat[];
}
export interface PassCommittedEvent {
  readonly type: "PassCommitted";
  readonly seat: Seat;
  readonly count: number;
}
export interface PassWithdrawnEvent {
  readonly type: "PassWithdrawn";
  readonly seat: Seat;
}
export interface PassRoundCancelledEvent {
  readonly type: "PassRoundCancelled";
  readonly cancelledBy: Seat;
}
export interface PassRoundExecutedEvent {
  readonly type: "PassRoundExecuted";
  readonly routing: readonly { readonly from: Seat; readonly to: Seat }[];
  readonly counts: Readonly<Partial<Record<Seat, number>>>;
  readonly handSizes: Readonly<Record<Seat, number>>;
  /** OWN: only what this seat received. */
  readonly received?: readonly Face[];
}

// --- Conclusion (docs/19 §6.5) ---

export interface MahjongDeclaredEvent {
  readonly type: "MahjongDeclared";
  readonly seat: Seat;
}
export interface HandRevealedEvent {
  readonly type: "HandRevealed";
  readonly seat: Seat;
  readonly tiles: readonly Face[];
}
export interface DeclarationRespondedEvent {
  readonly type: "DeclarationResponded";
  readonly seat: Seat;
  readonly response: "accept" | "dispute";
}
export interface DeclarationDisputedEvent {
  readonly type: "DeclarationDisputed";
  readonly seat: Seat;
}
export interface DeclarationWithdrawnEvent {
  readonly type: "DeclarationWithdrawn";
  readonly seat: Seat;
}
export interface EndGameProposedEvent {
  readonly type: "EndGameProposed";
  readonly seat: Seat;
}
export interface EndGameRespondedEvent {
  readonly type: "EndGameResponded";
  readonly seat: Seat;
  readonly response: "accept" | "decline";
}
/**
 * No score, value, or justification field, and none into which one could
 * be added without amending this catalog (NR-013). `outcomeSeat` names the
 * declarer for `declaration_accepted`; absent for `ended_by_agreement`.
 */
export interface GameConcludedEvent {
  readonly type: "GameConcluded";
  readonly outcome: "declaration_accepted" | "ended_by_agreement";
  readonly outcomeSeat?: Seat;
}

// --- Correction (docs/19 §6.6) ---

export interface CorrectionProposedEvent {
  readonly type: "CorrectionProposed";
  readonly seat: Seat;
  readonly rewindTo: number;
  /** Public-terms description of what would be undone — "East discarded, South claimed". */
  readonly affectedActions: readonly string[];
}
export interface CorrectionRespondedEvent {
  readonly type: "CorrectionResponded";
  readonly seat: Seat;
  readonly response: "accept" | "reject";
}
export interface CorrectionAppliedEvent {
  readonly type: "CorrectionApplied";
  readonly restoredSeq: number;
  readonly reshuffled: boolean;
}
export interface CorrectionRejectedEvent {
  readonly type: "CorrectionRejected";
  readonly reason: "rejected" | "timeout";
}

// --- Communication (docs/19 §6.7) ---

export interface TableMessageEvent {
  readonly type: "TableMessage";
  readonly seat: Seat;
  readonly displayName: string;
  readonly text: string;
}
export interface TableSignalEvent {
  readonly type: "TableSignal";
  readonly seat: Seat;
  readonly signal: "knock" | "wait" | "ack";
}

export type TableEvent =
  | SeatOccupiedEvent
  | SeatVacatedEvent
  | SeatReadyEvent
  | SeatUnreadyEvent
  | SeatDisconnectedEvent
  | SeatReconnectedEvent
  | TablePausedEvent
  | TableResumedEvent
  | TableClosedEvent
  | WallBuiltEvent
  | DealCommitmentPublishedEvent
  | TilesDealtEvent
  | ReshuffleCommitmentPublishedEvent
  | TileDrawnEvent
  | TileDiscardedEvent
  | DiscardClaimedEvent
  | TilesExposedEvent
  | ExposureRetractedEvent
  | ExposedTileSwappedEvent
  | WallExhaustedEvent
  | PassRoundOpenedEvent
  | PassCommittedEvent
  | PassWithdrawnEvent
  | PassRoundCancelledEvent
  | PassRoundExecutedEvent
  | MahjongDeclaredEvent
  | HandRevealedEvent
  | DeclarationRespondedEvent
  | DeclarationDisputedEvent
  | DeclarationWithdrawnEvent
  | EndGameProposedEvent
  | EndGameRespondedEvent
  | GameConcludedEvent
  | CorrectionProposedEvent
  | CorrectionRespondedEvent
  | CorrectionAppliedEvent
  | CorrectionRejectedEvent
  | TableMessageEvent
  | TableSignalEvent;

// Compile-time exhaustiveness: every member of the `TableEvent` union must
// have a key here, and no other key is allowed — a missing, extra, or
// misspelled event name fails the build rather than silently drifting from
// the union (docs/19 §9's "name inventory" check, TC-P08, done for real
// rather than by convention).
const EVENT_TYPE_WITNESS: Record<TableEvent["type"], true> = {
  SeatOccupied: true,
  SeatVacated: true,
  SeatReady: true,
  SeatUnready: true,
  SeatDisconnected: true,
  SeatReconnected: true,
  TablePaused: true,
  TableResumed: true,
  TableClosed: true,
  WallBuilt: true,
  DealCommitmentPublished: true,
  TilesDealt: true,
  ReshuffleCommitmentPublished: true,
  TileDrawn: true,
  TileDiscarded: true,
  DiscardClaimed: true,
  TilesExposed: true,
  ExposureRetracted: true,
  ExposedTileSwapped: true,
  WallExhausted: true,
  PassRoundOpened: true,
  PassCommitted: true,
  PassWithdrawn: true,
  PassRoundCancelled: true,
  PassRoundExecuted: true,
  MahjongDeclared: true,
  HandRevealed: true,
  DeclarationResponded: true,
  DeclarationDisputed: true,
  DeclarationWithdrawn: true,
  EndGameProposed: true,
  EndGameResponded: true,
  GameConcluded: true,
  CorrectionProposed: true,
  CorrectionResponded: true,
  CorrectionApplied: true,
  CorrectionRejected: true,
  TableMessage: true,
  TableSignal: true,
};

/** Every event name, derived from — and so always in sync with — the `TableEvent` union. */
export const EVENT_NAMES = Object.keys(EVENT_TYPE_WITNESS) as readonly TableEvent["type"][];
