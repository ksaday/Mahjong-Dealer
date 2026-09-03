// Composes a table's entity state with dealer-core's projected game state
// into the wire `WireSeatView` (docs/33_API/Wire_Protocol_Contract.md §5).
//
// This is the reconciliation flagged as follow-up when the wire protocol
// was transcribed into `shared` (docs/14_Player_Privacy.md §5's projector
// produces `dealer-core`'s own `SeatView`, which predates and does not
// match the wire shape field-for-field): the table actor is where a
// table's `tableState` — which `dealer-core` has no concept of — and a
// game's projected fields are assembled into the one thing a client
// receives. `project` (dealer-core's seat projector) remains the *only*
// function that reads concealed material out of `GameState`; this module
// only ever reshapes its already-public-or-owned output.
import { project, type GameState } from "@mahjong-dealer/dealer-core";
import { SEAT_ORDER, type Seat } from "@mahjong-dealer/shared";
import type {
  OwnHandEntry,
  WireDeclaration,
  WireEndGame,
  WireGameState,
  WirePassRound,
  WireSeatSummary,
  WireSeatView,
} from "@mahjong-dealer/shared";
import type { Table } from "./table.js";

const LIFECYCLE_TO_WIRE_GAME_STATE: Readonly<Record<GameState["lifecycle"], WireGameState>> = {
  idle: "idle",
  in_play: "in_play",
  concluding: "concluding",
  concluded: "concluded",
};

/**
 * Builds the seat view for `seat` at wire-facing sequence `seq` (the
 * actor's own, per `actor.ts` — never `gameState.seq`).
 */
export function projectTableView(table: Table, gameState: GameState, seat: Seat, seq: number): WireSeatView {
  const dealerView = project(gameState, seat);

  const seats: WireSeatSummary[] = SEAT_ORDER.map((s) => {
    const tableSeat = table.seats[s];
    const dealerSummary = dealerView.seats.find((entry) => entry.seat === s);
    return {
      seat: s,
      displayName: tableSeat.displayName,
      connection: tableSeat.connection,
      ready: tableSeat.ready,
      handSize: dealerSummary?.handSize ?? 0,
      exposures: (dealerSummary?.exposures ?? []).map((exposure) => ({
        exposureId: exposure.id,
        tiles: exposure.tiles.map((t) => ({ handle: t.handle, tile: t.face })),
      })),
      ...(dealerSummary?.revealedHand !== null && dealerSummary?.revealedHand !== undefined
        ? { revealedHand: dealerSummary.revealedHand.map((t) => ({ handle: t.handle, tile: t.face })) }
        : {}),
    };
  });

  const discards = dealerView.discards.map((entry, index) => ({
    handle: entry.handle,
    tile: entry.face,
    index,
    current: index === dealerView.discards.length - 1,
  }));

  const ownHand: OwnHandEntry[] = dealerView.ownHand.map((tile) => ({ handle: tile.handle, tile: tile.face }));

  const passRound: WirePassRound | null =
    dealerView.passRound === null
      ? null
      : {
          routing: dealerView.passRound.routing,
          committedCounts: dealerView.passRound.committedCounts,
          // OWN: this seat's own committed handles, read directly off
          // authoritative state — dealer-core's projector reports counts
          // only (docs/14 §4.2), so the viewer's own identities are
          // resolved here rather than by a second serializer (D-14-04
          // still holds: `project` is the only function that reads a
          // *face* out of concealed state; this reads handles the viewer
          // already committed themselves).
          ...(gameState.lifecycle === "in_play" && gameState.locations.inFlight[seat].length > 0
            ? { ownCommitment: gameState.locations.inFlight[seat] }
            : {}),
        };

  const declaration: WireDeclaration | null =
    dealerView.concludingProcess?.kind === "declaration"
      ? {
          declarer: dealerView.concludingProcess.initiator,
          responses: dealerView.concludingProcess.responses as WireDeclaration["responses"],
        }
      : null;

  const endGame: WireEndGame | null =
    dealerView.concludingProcess?.kind === "end_game"
      ? {
          proposer: dealerView.concludingProcess.initiator,
          responses: dealerView.concludingProcess.responses as WireEndGame["responses"],
        }
      : null;

  return {
    seat,
    seq,
    tableState: table.status,
    gameState: LIFECYCLE_TO_WIRE_GAME_STATE[dealerView.lifecycle],
    flags: {
      paused: dealerView.paused !== null,
      passRoundOpen: dealerView.passRound !== null,
      correctionPending: dealerView.correction !== null,
    },
    turn: dealerView.turn,
    wallRemaining: dealerView.wallRemaining,
    commitment: dealerView.commitment,
    seats,
    discards,
    ownHand,
    // No command in the catalog sets a server-tracked selection (docs/10);
    // if it is ever server-authoritative rather than client-local UI
    // state, it belongs here.
    ownSelection: [],
    passRound,
    correction: dealerView.correction,
    declaration,
    endGame,
  };
}
