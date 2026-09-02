// The wire seat-view schema (docs/33_API/Wire_Protocol_Contract.md §5;
// docs/14_Player_Privacy.md §5.2). This is the only thing a client ever
// receives about a table — produced by the single seat projector (docs/14
// §5) and accompanying every `event`, `resumed`, and (implicitly) `reject`
// frame.
//
// Composition note: `tableState` comes from the table entity (docs/05 §4),
// owned by the table actor (`server`, Phase 4) — not yet built. Everything
// else here corresponds to fields `dealer-core`'s `project()` already
// produces (packages/dealer-core/src/projector/project.ts), though that
// function's *internal* `SeatView` type predates this wire contract and
// does not yet match it field-for-field (see that file's module comment
// for the reconciliation this leaves as follow-up work: composing a
// table's `tableState` with a game's projected fields into this shape is
// the table actor's job, not dealer-core's).
import type { Face } from "../tiles/face.js";
import type { TileHandle } from "../privacy/handle.js";
import type { Seat } from "../table/seat.js";

/** docs/05_Game_Table_Architecture.md §4. Lowercase on the wire, per the docs/33_API §5 example. */
export const TABLE_STATES = ["open", "seated", "closed", "abandoned"] as const;
export type TableState = (typeof TABLE_STATES)[number];

/** docs/09_Game_State_Machine.md §4. */
export const GAME_STATES = ["idle", "dealing", "in_play", "concluding", "concluded"] as const;
export type WireGameState = (typeof GAME_STATES)[number];

export interface WireFlags {
  readonly paused: boolean;
  readonly passRoundOpen: boolean;
  readonly correctionPending: boolean;
}

export interface WireDiscardEntry {
  readonly handle: TileHandle;
  readonly tile: Face;
  readonly index: number;
  /** Only the last entry is ever `true` — the only tile `claim_discard` may take (docs/10 §5.3). */
  readonly current: boolean;
}

/**
 * A face-up group in front of a seat. The docs/33_API §5 illustrative
 * example shows exposure tiles as bare faces (`"tiles": ["D5","D5","D5"]`),
 * but `swap_exposed_tile`'s `exposedHandle` parameter (docs/33_API §4) has
 * no other source once the tile is not in the viewer's own hand — so this
 * type carries handles here too, matching how `discards[]` already does.
 * Worth raising as a documentation gap rather than silently resolving it
 * one way in code and another in prose.
 */
export interface WireExposure {
  readonly exposureId: string;
  readonly tiles: readonly { readonly handle: TileHandle; readonly tile: Face }[];
}

export interface WireSeatSummary {
  readonly seat: Seat;
  readonly displayName: string;
  readonly connection: "connected" | "away" | "absent";
  readonly ready: boolean;
  readonly handSize: number;
  readonly exposures: readonly WireExposure[];
  /** Present only once this seat has voluntarily revealed (docs/10 `reveal_hand`). */
  readonly revealedHand?: readonly { readonly handle: TileHandle; readonly tile: Face }[];
}

/** An `ownHand` entry: a tile, or a gap the player deliberately left (docs/33_API §5.2, FR-101). */
export type OwnHandEntry = { readonly handle: TileHandle; readonly tile: Face } | { readonly gap: true };

export interface WirePassRound {
  readonly routing: readonly { readonly from: Seat; readonly to: Seat }[];
  /** PUB: counts only (docs/14 §4.2). */
  readonly committedCounts: Readonly<Partial<Record<Seat, number>>>;
  /** OWN: this seat's own committed handles, before execution. */
  readonly ownCommitment?: readonly TileHandle[];
}

export interface WireCorrection {
  readonly proposer: Seat;
  readonly rewindTo: number;
  readonly responses: Readonly<Partial<Record<Seat, "accept" | "reject">>>;
}

export interface WireDeclaration {
  readonly declarer: Seat;
  readonly responses: Readonly<Partial<Record<Seat, "accept" | "dispute">>>;
}

/**
 * Not named in the docs/33_API §5 illustrative example (which shows only
 * `declaration: null`), but `propose_end_game`/`respond_end_game` is a
 * distinct PUB process from a Mahjong declaration (docs/10 §7, docs/09
 * §4.3) and needs its own field for the same reason `declaration` has one.
 * Added for completeness; worth confirming against the SSOT rather than
 * treated as settled.
 */
export interface WireEndGame {
  readonly proposer: Seat;
  readonly responses: Readonly<Partial<Record<Seat, "accept" | "decline">>>;
}

export interface WireSeatView {
  readonly seat: Seat;
  readonly seq: number;
  readonly tableState: TableState;
  readonly gameState: WireGameState;
  readonly flags: WireFlags;
  readonly turn: Seat | null;
  readonly wallRemaining: number;
  readonly commitment: string | null;
  /** No hand contents for any seat, including this one (docs/33_API §5.1, D-14-09). */
  readonly seats: readonly WireSeatSummary[];
  readonly discards: readonly WireDiscardEntry[];
  readonly ownHand: readonly OwnHandEntry[];
  readonly ownSelection: readonly TileHandle[];
  readonly passRound: WirePassRound | null;
  readonly correction: WireCorrection | null;
  readonly declaration: WireDeclaration | null;
  readonly endGame: WireEndGame | null;
}
