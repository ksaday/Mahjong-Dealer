// Maps dealer-core's internal `DealerEvent` (built in Phase 2, before the
// wire contract in docs/19 was transcribed into `shared`) onto the wire
// `TableEvent` catalog (docs/19_WebSocket_Event_Catalog.md §6). This is the
// second half of the reconciliation flagged when the wire protocol was
// built — `view.ts` handles state, this handles events — and, like `view.ts`,
// stays within the boundary the privacy model draws: it resolves a
// tile's face only from state the acting seat's own action already made
// visible to it, never by adding a second path that reads concealed
// material (`project` remains the only function that does that generally).
//
// `arrange_hand`'s `HandArranged` has no wire counterpart — docs/10 §5.7
// is explicit that command emits nothing public — so it maps to `null`
// and is filtered out.
import type { DealerEvent, GameState } from "@mahjong-dealer/dealer-core";
import { SEAT_ORDER, type Face, type Seat, type TableEvent, type TileHandle } from "@mahjong-dealer/shared";
import type { Table } from "./table.js";

function faceOf(handle: TileHandle, gameState: GameState): Face {
  if (gameState.lifecycle === "idle" || gameState.lifecycle === "concluded") {
    throw new Error("unreachable: face-carrying events never fire outside in_play/concluding");
  }
  const tile = gameState.tileByHandle.get(handle);
  if (tile === undefined) {
    throw new Error(`unreachable: handle ${handle} is not in this game's tile set`);
  }
  return tile.face;
}

function handSizeOf(seat: Seat, gameState: GameState): number {
  if (gameState.lifecycle === "idle" || gameState.lifecycle === "concluded") {
    throw new Error("unreachable: hand-size-carrying events never fire outside in_play/concluding");
  }
  return gameState.locations.hands[seat].length;
}

function allHandSizes(gameState: GameState): Readonly<Record<Seat, number>> {
  const sizes = {} as Record<Seat, number>;
  for (const seat of SEAT_ORDER) {
    sizes[seat] = handSizeOf(seat, gameState);
  }
  return sizes;
}

function capitalizeSeat(seat: Seat): string {
  return seat[0]!.toUpperCase() + seat.slice(1);
}

/**
 * One line, in public terms, for a wire event that a correction's rewind
 * would actually undo — docs/19 §6.6's `affectedActions[]`, "East
 * discarded, South claimed." `null` for anything a rewind wouldn't touch:
 * `Table` state (seat occupancy, connection, readiness) lives outside
 * `dealer-core`'s `GameState` and survives a correction untouched, and
 * chat/signals are never persisted into `GameState` at all (`FR-131`) —
 * describing either as "affected" would claim an undo that doesn't
 * happen. Takes the wire-shaped event (not the raw `DealerEvent`) so it
 * reads the same PUB fields a client already sees, never anything OWN.
 */
export function describePublicAction(event: TableEvent): string | null {
  switch (event.type) {
    case "SeatOccupied":
    case "SeatVacated":
    case "SeatReady":
    case "SeatUnready":
    case "SeatDisconnected":
    case "SeatReconnected":
    case "TableClosed":
    case "TableMessage":
    case "TableSignal":
      return null;
    case "WallBuilt":
      return "The wall was built";
    case "DealCommitmentPublished":
      return "The deal commitment was published";
    case "TilesDealt":
      return "Tiles were dealt";
    case "ReshuffleCommitmentPublished":
      return "The wall was reshuffled";
    case "TileDrawn":
      return `${capitalizeSeat(event.seat)} drew a tile`;
    case "TileDiscarded":
      return `${capitalizeSeat(event.seat)} discarded`;
    case "DiscardClaimed":
      return `${capitalizeSeat(event.seat)} claimed the discard`;
    case "TilesExposed":
      return `${capitalizeSeat(event.seat)} exposed tiles`;
    case "ExposureRetracted":
      return `${capitalizeSeat(event.seat)} retracted an exposure`;
    case "ExposedTileSwapped":
      return `${capitalizeSeat(event.seat)} swapped an exposed tile`;
    case "WallExhausted":
      return "The wall was exhausted";
    case "PassRoundOpened":
      return `${capitalizeSeat(event.openedBy)} opened a pass round`;
    case "PassCommitted":
      return `${capitalizeSeat(event.seat)} committed to the pass`;
    case "PassWithdrawn":
      return `${capitalizeSeat(event.seat)} withdrew from the pass`;
    case "PassRoundCancelled":
      return `${capitalizeSeat(event.cancelledBy)} cancelled the pass round`;
    case "PassRoundExecuted":
      return "The pass round executed";
    case "MahjongDeclared":
      return `${capitalizeSeat(event.seat)} declared Mahjong`;
    case "HandRevealed":
      return `${capitalizeSeat(event.seat)} revealed their hand`;
    case "DeclarationResponded":
      return `${capitalizeSeat(event.seat)} responded to the declaration`;
    case "DeclarationDisputed":
      return `${capitalizeSeat(event.seat)} disputed the declaration`;
    case "DeclarationWithdrawn":
      return `${capitalizeSeat(event.seat)} withdrew their declaration`;
    case "EndGameProposed":
      return `${capitalizeSeat(event.seat)} proposed ending the game`;
    case "EndGameResponded":
      return `${capitalizeSeat(event.seat)} responded to end the game`;
    case "GameConcluded":
      return "The game concluded";
    case "CorrectionProposed":
      return `${capitalizeSeat(event.seat)} proposed a correction`;
    case "CorrectionResponded":
      return `${capitalizeSeat(event.seat)} responded to a correction`;
    case "CorrectionApplied":
      return "A correction was applied";
    case "CorrectionRejected":
      return "A correction was rejected";
    case "TablePaused":
      return `${capitalizeSeat(event.seat)} paused the table`;
    case "TableResumed":
      return `${capitalizeSeat(event.seat)} resumed the table`;
  }
}

/**
 * `gameState` is the state *after* the event, so face and hand-size lookups
 * always resolve against current, correct data. `viewerSeat` decides which
 * OWN fields are populated (docs/19 §6, "one event, four payloads").
 */
export function toWireEvent(
  event: DealerEvent,
  viewerSeat: Seat,
  gameState: GameState,
  table: Table,
): TableEvent | null {
  switch (event.type) {
    case "WallBuilt":
      return { type: "WallBuilt", wallRemaining: event.wallLength };
    case "DealCommitmentPublished":
      return { type: "DealCommitmentPublished", commitment: event.commitment };
    case "TilesDealt":
      return {
        type: "TilesDealt",
        handSizes: event.handSizes,
        turn: event.turn,
        wallRemaining: gameState.lifecycle === "in_play" ? gameState.locations.wall.length : 0,
        ...(gameState.lifecycle === "in_play"
          ? { tiles: gameState.locations.hands[viewerSeat].map((h) => faceOf(h, gameState)) }
          : {}),
      };
    case "TileDrawn":
      return {
        type: "TileDrawn",
        seat: event.seat,
        end: event.end,
        wallRemaining: event.wallRemaining,
        handSize: event.newHandSize,
        ...(viewerSeat === event.seat ? { tile: faceOf(event.handle, gameState) } : {}),
      };
    case "WallExhausted":
      return { type: "WallExhausted" };
    case "TileDiscarded":
      return {
        type: "TileDiscarded",
        seat: event.seat,
        tile: faceOf(event.handle, gameState),
        discardIndex: event.discardIndex,
        handSize: event.newHandSize,
      };
    case "DiscardClaimed":
      return {
        type: "DiscardClaimed",
        seat: event.seat,
        tile: faceOf(event.handle, gameState),
        handSize: event.newHandSize,
        turn: event.turn,
      };
    case "TilesExposed":
      return {
        type: "TilesExposed",
        seat: event.seat,
        exposureId: event.exposureId,
        tiles: event.handles.map((h) => faceOf(h, gameState)),
        handSize: event.newHandSize,
      };
    case "ExposureRetracted":
      return {
        type: "ExposureRetracted",
        seat: event.seat,
        exposureId: event.exposureId,
        tiles: event.handles.map((h) => faceOf(h, gameState)),
        handSize: handSizeOf(event.seat, gameState),
      };
    case "ExposedTileSwapped":
      return {
        type: "ExposedTileSwapped",
        seat: event.seat,
        exposureId: event.exposureId,
        exposureOwner: event.exposureOwner,
        tileIn: faceOf(event.givenHandle, gameState),
        tileOut: faceOf(event.takenHandle, gameState),
        handSize: event.newHandSize,
      };
    case "HandArranged":
      return null;
    case "PassRoundOpened":
      return {
        type: "PassRoundOpened",
        openedBy: event.opener,
        routing: event.routing,
        participants: [...new Set(event.routing.map((r) => r.from))],
      };
    case "PassCommitted":
      return { type: "PassCommitted", seat: event.seat, count: event.count };
    case "PassWithdrawn":
      return { type: "PassWithdrawn", seat: event.seat };
    case "PassRoundCancelled":
      return { type: "PassRoundCancelled", cancelledBy: event.seat };
    case "PassRoundExecuted":
      // `received` is left unpopulated: dealer-core's event carries counts
      // per sender, not which handles went to which recipient, so it
      // cannot be reconstructed here without assuming routing shape.
      // Follow-up: dealer-core's PassRoundExecuted should carry a
      // per-recipient handle map directly.
      return {
        type: "PassRoundExecuted",
        routing: event.routing,
        counts: event.counts,
        handSizes: allHandSizes(gameState),
      };
    case "MahjongDeclared":
      return { type: "MahjongDeclared", seat: event.seat };
    case "HandRevealed":
      return {
        type: "HandRevealed",
        seat: event.seat,
        tiles: event.handles.map((h) => faceOf(h, gameState)),
      };
    case "DeclarationResponded":
      return { type: "DeclarationResponded", seat: event.seat, response: event.response };
    case "DeclarationDisputed":
      return { type: "DeclarationDisputed", seat: event.seat };
    case "DeclarationWithdrawn":
      return { type: "DeclarationWithdrawn", seat: event.seat };
    case "EndGameProposed":
      return { type: "EndGameProposed", seat: event.seat };
    case "EndGameResponded":
      return { type: "EndGameResponded", seat: event.seat, response: event.response };
    case "GameConcluded":
      return {
        type: "GameConcluded",
        outcome: event.outcome.kind,
        ...(event.outcome.kind === "declaration_accepted" ? { outcomeSeat: event.outcome.declarer } : {}),
      };
    case "CorrectionProposed":
      // `rewindTo` here is dealer-core's internal seq, and `affectedActions`
      // is empty; `actor.ts` overrides both with the client-facing (actor)
      // seq and the frame log it, not this function, has access to before
      // this frame ships.
      return { type: "CorrectionProposed", seat: event.seat, rewindTo: event.rewindTo, affectedActions: [] };
    case "CorrectionResponded":
      return { type: "CorrectionResponded", seat: event.seat, response: event.response };
    case "CorrectionApplied":
      // Same seq caveat as CorrectionProposed — see actor.ts.
      return { type: "CorrectionApplied", restoredSeq: event.restoredSeq, reshuffled: event.reshuffled };
    case "ReshuffleCommitmentPublished":
      // `atSeq` is filled in by actor.ts, which knows the post-command seq.
      return { type: "ReshuffleCommitmentPublished", commitment: event.commitment, atSeq: 0 };
    case "CorrectionRejected":
      return { type: "CorrectionRejected", reason: event.reason };
    case "TablePaused":
      // "requested" is the default; actor.ts overrides it to "seat_absent"
      // for auto-pause, via submit()'s own pauseReason parameter — dealer-core's
      // request_pause command and event carry no reason to distinguish the two.
      return { type: "TablePaused", seat: event.seat, reason: "requested" };
    case "TableResumed":
      return { type: "TableResumed", seat: event.seat };
    case "TableMessage":
      return {
        type: "TableMessage",
        seat: event.seat,
        displayName: table.seats[event.seat].displayName ?? "",
        text: event.text,
      };
    case "TableSignal":
      return { type: "TableSignal", seat: event.seat, signal: event.signal };
  }
}
