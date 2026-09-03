// S-06 Game table (docs/32_UX/Screen_Inventory.md §3,
// Table_Layout_and_Perspective.md, Tile_Component_Spec.md,
// Interaction_Patterns.md). The product.
//
// Scoped simplifications, flagged rather than silently narrowed (matching
// this codebase's own convention — see `screens/Table.tsx`'s header
// comment and `ws/useTableLive.ts`'s):
//   - Drag gestures for the *binding* acts (discard-by-drag, expose-by-
//     drag) are not implemented. Every binding act here goes through the
//     keyboard/click arm-and-confirm path Interaction_Patterns §2.2
//     already requires for those acts on non-pointer input, so nothing is
//     unreachable — dragging is simply not an additional path yet.
//   - Rack reorder (the one *free* act, docs/11 §5.1/§6, FR-100/FR-105) is
//     implemented: drag within the rack, or, matching docs/24_Accessibility
//     §5.2's `Alt+←/→` binding, select exactly one tile and press
//     `Alt+←`/`Alt+→`. That key binding is defined there against a
//     region-and-focus keyboard model this file doesn't otherwise build
//     (there is no separate rack "focus" independent of `selected`), so
//     it is adapted onto the single-selected tile rather than a focused
//     one — a narrower but still fully keyboard-reachable stand-in.
//     Applied locally first, then sent — `arrange_hand` broadcasts
//     nothing (docs/10 §5.7), so the server's own view of the order only
//     catches up on the next unrelated event.
//   - "Click elsewhere cancels" (§2.1) is not wired; Escape cancels an
//     armed act, and so does clicking Cancel.
//   - Mechanical disabling only accounts for game state, the turn
//     pointer, wall emptiness, and the three overlay flags for the
//     commands whose own validation list explicitly names them
//     (`draw_tile`, `discard_tile`, `open_pass_round` — docs/10). Other
//     commands are gated by state alone; a flag-blocked one still
//     surfaces the server's own rejection as a toast (docs/32_UX
//     Screen_Inventory.md §4) rather than being silently hidden, per
//     D-32-36's own "only for mechanical reasons" rule — a client that
//     is not sure which flags block a given command should not guess.
//   - Opponent racks always render every tile back rather than
//     compressing to a count at narrow widths (Table_Layout_and_
//     Perspective.md §4); the row scrolls instead.
import { useEffect, useRef, useState } from "react";
import type { Face, Seat, TableEvent, TileHandle, WireSeatView } from "@mahjong-dealer/shared";
import { SEAT_ORDER } from "@mahjong-dealer/shared";
import type { TableLiveState } from "../ws/useTableLive.js";
import { Tile, TileGap } from "../tiles/Tile.js";
import { faceAccessibleNameLower } from "../tiles/faceNames.js";
import { relativePosition, seatLabel, type RelativePosition } from "./seatLayout.js";
import { ChatPanel, type ChatMessage } from "./ChatPanel.js";
import { VoteBand } from "./VoteBand.js";
import { PassRoundPanel } from "./PassRoundPanel.js";

type Armed =
  | { readonly kind: "draw"; readonly end: "head" | "tail" }
  | { readonly kind: "discard"; readonly handle: TileHandle; readonly face: Face }
  | { readonly kind: "claim"; readonly handle: TileHandle; readonly face: Face }
  | { readonly kind: "expose"; readonly handles: readonly TileHandle[] }
  | { readonly kind: "retract"; readonly exposureId: string }
  | { readonly kind: "declare" }
  | { readonly kind: "reveal" }
  | { readonly kind: "commitPass"; readonly handles: readonly TileHandle[] }
  | { readonly kind: "correction"; readonly rewindTo: number };

export interface GameTableProps {
  readonly view: WireSeatView;
  readonly send: TableLiveState["send"];
  readonly lastEvent: TableLiveState["lastEvent"];
  readonly onReturnToLobby: () => void;
}

let chatKeySeq = 0;

function ownTileHandles(view: WireSeatView): readonly TileHandle[] {
  return view.ownHand.filter((e): e is { readonly handle: TileHandle; readonly tile: Face } => !("gap" in e)).map((e) => e.handle);
}

function sameHandleSet(a: readonly TileHandle[], b: readonly TileHandle[]): boolean {
  if (a.length !== b.length) return false;
  const bSet = new Set(b);
  return a.every((h) => bSet.has(h));
}

export function GameTable({ view, send, lastEvent, onReturnToLobby }: GameTableProps) {
  const [selected, setSelected] = useState<ReadonlySet<TileHandle>>(new Set());
  const [armed, setArmed] = useState<Armed | null>(null);
  const [chatLog, setChatLog] = useState<readonly ChatMessage[]>([]);
  const [signalFlash, setSignalFlash] = useState<Readonly<Partial<Record<Seat, string>>>>({});
  const [lastPause, setLastPause] = useState<{ readonly seat: Seat; readonly reason: string } | null>(null);
  const [concludedOutcome, setConcludedOutcome] = useState<string | null>(null);
  const [correctionInput, setCorrectionInput] = useState("");
  const [handOrder, setHandOrder] = useState<readonly TileHandle[]>(() => ownTileHandles(view));
  const [draggingHandle, setDraggingHandle] = useState<TileHandle | null>(null);
  const seenSeq = useRef<number>(-1);

  useEffect(() => {
    if (lastEvent === null || lastEvent.seq === seenSeq.current) return;
    seenSeq.current = lastEvent.seq;
    handleEvent(lastEvent.ev);
    // `handleEvent` closes over setters only (all stable), so `lastEvent`
    // is the one dependency that matters — an exhaustive-deps lint isn't
    // configured in this project to require spelling that out further.
  }, [lastEvent]);

  useEffect(() => {
    if (armed === null) return;
    function onKeyDown(e: KeyboardEvent): void {
      if (e.key === "Escape") setArmed(null);
    }
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [armed]);

  // Adopt the server's own order only once the *set* of held handles
  // changes (a draw, discard, claim, expose, retract, or pass) — never on
  // an unrelated broadcast, and never by re-adopting our own unacknowledged
  // rearrangement once `arrange_hand`'s silent round trip catches up
  // (docs/10 §5.7; the reconciled set is identical either way, so there is
  // nothing to adopt).
  useEffect(() => {
    const serverHandles = ownTileHandles(view);
    setHandOrder((prev) => (sameHandleSet(prev, serverHandles) ? prev : serverHandles));
  }, [view]);

  // The one free act (docs/11 §5.2, FR-105): applied to local state before
  // the command is even sent, and never blocked by `armed`.
  useEffect(() => {
    function onKeyDown(e: KeyboardEvent): void {
      if (!e.altKey || (e.key !== "ArrowLeft" && e.key !== "ArrowRight")) return;
      if (selected.size !== 1) return;
      const handle = [...selected][0];
      if (handle === undefined) return;
      const from = handOrder.indexOf(handle);
      if (from === -1) return;
      const to = e.key === "ArrowLeft" ? from - 1 : from + 1;
      if (to < 0 || to >= handOrder.length) return;
      e.preventDefault();
      reorderHand(from, to);
    }
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [selected, handOrder]);

  function reorderHand(from: number, to: number): void {
    if (from === to) return;
    const next = [...handOrder];
    const [moved] = next.splice(from, 1);
    if (moved === undefined) return;
    next.splice(to, 0, moved);
    setHandOrder(next);
    send("arrange_hand", { handles: next });
  }

  function handleEvent(ev: TableEvent): void {
    if (ev.type === "TableMessage") {
      chatKeySeq += 1;
      setChatLog((prev) => [...prev, { key: `c${chatKeySeq}`, seat: ev.seat, displayName: ev.displayName, text: ev.text }].slice(-200));
    } else if (ev.type === "TableSignal") {
      const seat = ev.seat;
      setSignalFlash((prev) => ({ ...prev, [seat]: ev.signal }));
      setTimeout(() => setSignalFlash((prev) => (prev[seat] === ev.signal ? { ...prev, [seat]: undefined } : prev)), 2500);
    } else if (ev.type === "TablePaused") {
      setLastPause({ seat: ev.seat, reason: ev.reason });
    } else if (ev.type === "TableResumed") {
      setLastPause(null);
    } else if (ev.type === "GameConcluded") {
      setConcludedOutcome(
        ev.outcome === "declaration_accepted" && ev.outcomeSeat !== undefined
          ? `${seatLabel(ev.outcomeSeat)} declared Mahjong — all players accepted.`
          : "The players agreed to end the game.",
      );
    }
  }

  const ownSeat = view.seat;
  const ownSummary = view.seats.find((s) => s.seat === ownSeat) ?? null;
  const blockingReason = view.flags.paused ? "Table paused" : view.flags.correctionPending ? "Correction pending" : view.flags.passRoundOpen ? "Pass round open" : null;
  const inPlay = view.gameState === "in_play";
  const concluding = view.gameState === "concluding";
  const ownTurn = view.turn === ownSeat;
  const currentDiscard = view.discards.find((d) => d.current) ?? null;

  const canDraw = inPlay && ownTurn && blockingReason === null && view.wallRemaining > 0 && armed === null;
  const canDiscard = inPlay && blockingReason === null && armed === null;
  const canClaim = inPlay && currentDiscard !== null && armed === null;
  const canExpose = (inPlay || concluding) && armed === null;
  const canDeclare = inPlay && blockingReason === null && armed === null;
  const canReveal = (inPlay || concluding) && armed === null;
  const canOpenPassRound = inPlay && blockingReason === null && view.passRound === null && armed === null;
  const canProposeCorrection = inPlay && view.correction === null && armed === null;

  function toggleSelected(handle: TileHandle): void {
    if (armed !== null) return;
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(handle)) next.delete(handle);
      else next.add(handle);
      return next;
    });
  }

  function confirmArmed(): void {
    if (armed === null) return;
    switch (armed.kind) {
      case "draw":
        send("draw_tile", { end: armed.end });
        break;
      case "discard":
        send("discard_tile", { handle: armed.handle });
        setSelected(new Set());
        break;
      case "claim":
        send("claim_discard", { handle: armed.handle });
        break;
      case "expose":
        send("expose_tiles", { handles: armed.handles });
        setSelected(new Set());
        break;
      case "retract":
        send("retract_exposure", { exposureId: armed.exposureId });
        break;
      case "declare":
        send("declare_mahjong");
        break;
      case "reveal":
        send("reveal_hand");
        break;
      case "commitPass":
        send("commit_pass", { handles: armed.handles });
        setSelected(new Set());
        break;
      case "correction":
        send("propose_correction", { rewindTo: armed.rewindTo });
        setCorrectionInput("");
        break;
    }
    setArmed(null);
  }

  const armedDescription = (() => {
    if (armed === null) return null;
    switch (armed.kind) {
      case "draw":
        return `Draw from the ${armed.end}?`;
      case "discard":
        return `Discard ${faceAccessibleNameLower(armed.face)}?`;
      case "claim":
        return `Claim ${faceAccessibleNameLower(armed.face)}?`;
      case "expose":
        return `Expose ${armed.handles.length} tile${armed.handles.length === 1 ? "" : "s"}?`;
      case "retract":
        return "Retract this exposure?";
      case "declare":
        return "Declare Mahjong?";
      case "reveal":
        return "Reveal your hand? All three other players will see every tile. This cannot be undone.";
      case "commitPass":
        return `Commit ${armed.handles.length} tile${armed.handles.length === 1 ? "" : "s"} to the pass?`;
      case "correction":
        return `Propose undoing back to sequence ${armed.rewindTo}?`;
    }
  })();

  const opponentSeats = SEAT_ORDER.filter((s) => s !== ownSeat);
  const byPosition = new Map<RelativePosition, Seat>(opponentSeats.map((s) => [relativePosition(ownSeat, s), s]));

  return (
    <div className="game-table">
      {blockingReason !== null && (
        <div className="banner banner-neutral" role="status">
          {blockingReason}
          {lastPause !== null && blockingReason === "Table paused" && ` — ${seatLabel(lastPause.seat)}: ${lastPause.reason}`}
        </div>
      )}

      {view.correction !== null && (
        <VoteBand
          headline={`${seatLabel(view.correction.proposer)} proposes undoing back to sequence ${view.correction.rewindTo}.`}
          proposer={view.correction.proposer}
          responses={view.correction.responses}
          responseLabels={{ accept: "accepted", reject: "rejected" }}
          ownSeat={ownSeat}
          ownResponded={view.correction.responses[ownSeat] !== undefined || view.correction.proposer === ownSeat}
          actions={
            view.correction.proposer === ownSeat
              ? []
              : [
                  { label: "Accept", primary: true, onClick: () => send("respond_correction", { response: "accept" }) },
                  { label: "Reject", onClick: () => send("respond_correction", { response: "reject" }) },
                ]
          }
          note="Expires in 60s — a timeout rejects the correction."
        />
      )}

      {view.declaration !== null && (
        <VoteBand
          headline={`${seatLabel(view.declaration.declarer)} declares Mahjong.`}
          proposer={view.declaration.declarer}
          responses={view.declaration.responses}
          responseLabels={{ accept: "accepted", dispute: "disputed" }}
          ownSeat={ownSeat}
          ownResponded={view.declaration.responses[ownSeat] !== undefined || view.declaration.declarer === ownSeat}
          actions={
            view.declaration.declarer === ownSeat
              ? [{ label: "Withdraw", onClick: () => send("withdraw_declaration") }]
              : [
                  { label: "Accept", primary: true, onClick: () => send("respond_declaration", { response: "accept" }) },
                  { label: "Dispute", onClick: () => send("respond_declaration", { response: "dispute" }) },
                ]
          }
          note="No timeout — the table waits."
        />
      )}

      {view.endGame !== null && (
        <VoteBand
          headline={`${seatLabel(view.endGame.proposer)} proposes ending the game.`}
          proposer={view.endGame.proposer}
          responses={view.endGame.responses}
          responseLabels={{ accept: "accepted", decline: "declined" }}
          ownSeat={ownSeat}
          ownResponded={view.endGame.responses[ownSeat] !== undefined || view.endGame.proposer === ownSeat}
          actions={
            view.endGame.proposer === ownSeat
              ? []
              : [
                  { label: "Accept", primary: true, onClick: () => send("respond_end_game", { response: "accept" }) },
                  { label: "Decline", onClick: () => send("respond_end_game", { response: "decline" }) },
                ]
          }
        />
      )}

      {view.gameState === "concluded" && (
        <div className="banner banner-neutral" role="status">
          <p>{concludedOutcome ?? "The game has concluded."}</p>
          <button type="button" className="button-primary" onClick={onReturnToLobby}>
            Return to the lobby
          </button>
        </div>
      )}

      <div className="table-across">
        {renderOpponent(byPosition.get("across"))}
      </div>

      <div className="table-middle">
        <div className="table-side table-side-left">{renderOpponent(byPosition.get("left"))}</div>

        <div className="table-center">
          <div className="wall">
            <p className="wall-count">{view.wallRemaining} left</p>
            <div className="wall-ends">
              <button
                type="button"
                className="wall-end"
                disabled={!canDraw}
                aria-label={canDraw ? "Draw from the head — press to arm" : "Draw — not your turn or the wall is empty"}
                onClick={() => setArmed({ kind: "draw", end: "head" })}
              >
                hd
              </button>
              <button
                type="button"
                className="wall-end"
                disabled={!canDraw}
                aria-label={canDraw ? "Draw from the tail — press to arm" : "Draw — not your turn or the wall is empty"}
                onClick={() => setArmed({ kind: "draw", end: "tail" })}
              >
                tl
              </button>
            </div>
          </div>

          <div className="discard-pile" role="list" aria-label="Discard pile">
            {view.discards.map((d) => (
              <Tile
                key={d.handle}
                face={d.tile}
                inert={!d.current}
                interactive={d.current && canClaim}
                positionLabel={`discard ${d.index + 1}`}
                onActivate={d.current ? () => setArmed({ kind: "claim", handle: d.handle, face: d.tile }) : undefined}
                armedVerb={armed?.kind === "claim" && armed.handle === d.handle ? "Claim" : undefined}
              />
            ))}
          </div>
        </div>

        <div className="table-side table-side-right">{renderOpponent(byPosition.get("right"))}</div>
      </div>

      <div className="own-exposures">
        {ownSummary?.exposures.map((exp) => (
          <div className="exposure-group" key={exp.exposureId}>
            {exp.tiles.map((t) => (
              <Tile key={t.handle} face={t.tile} interactive={false} />
            ))}
            <button
              type="button"
              className="button-link"
              disabled={armed !== null || !(inPlay || concluding)}
              onClick={() => setArmed({ kind: "retract", exposureId: exp.exposureId })}
            >
              Retract
            </button>
          </div>
        ))}
      </div>

      <div className="own-rack-row">
        <p className="seat-caption">
          {seatLabel(ownSeat)} (you){ownTurn && <span className="turn-caret" aria-hidden="true"> ▲</span>}
          {ownTurn && <span className="visually-hidden">, your turn</span>}
        </p>
        <div className="own-rack" role="list" aria-label="Your hand">
          {(() => {
            // `handOrder` carries only tiles (the drag/keyboard reorder
            // target — `arrange_hand`'s `handles` has no room for a gap,
            // §5.7's own permutation check would reject one). Gaps, on the
            // rare frame `view.ownHand` actually carries one, stay pinned
            // at the slot the server placed them in; tiles fill the
            // remaining slots in `handOrder`'s order.
            const faceByHandle = new Map(view.ownHand.filter((e): e is { readonly handle: TileHandle; readonly tile: Face } => !("gap" in e)).map((e) => [e.handle, e.tile]));
            let tileIndex = 0;
            return view.ownHand.map((slot, i) => {
              if ("gap" in slot) return <TileGap key={`gap-${i}`} />;
              const handle = handOrder[tileIndex] ?? slot.handle;
              const face = faceByHandle.get(handle);
              const myTileIndex = tileIndex;
              tileIndex += 1;
              if (face === undefined) return null; // mid-resync: the next `view` will drop this handle from `handOrder` too
              return (
                <div
                  key={handle}
                  className={draggingHandle === handle ? "tile-drag-wrap tile-dragging" : "tile-drag-wrap"}
                  draggable={armed === null}
                  onDragStart={() => setDraggingHandle(handle)}
                  onDragEnd={() => setDraggingHandle(null)}
                  onDragOver={(e) => {
                    if (draggingHandle !== null) e.preventDefault();
                  }}
                  onDrop={(e) => {
                    e.preventDefault();
                    if (draggingHandle === null || draggingHandle === handle) return;
                    reorderHand(handOrder.indexOf(draggingHandle), myTileIndex);
                    setDraggingHandle(null);
                  }}
                >
                  <Tile
                    face={face}
                    selected={selected.has(handle)}
                    interactive={armed === null}
                    positionLabel={`position ${i + 1} of ${view.ownHand.length}`}
                    onActivate={() => toggleSelected(handle)}
                  />
                </div>
              );
            });
          })()}
        </div>
      </div>

      <div className="table-controls">
        {armed !== null && armedDescription !== null && (
          <div className="armed-bar" role="alertdialog" aria-label="Confirm action">
            <p>{armedDescription}</p>
            <button type="button" className="button-primary" onClick={confirmArmed}>
              Confirm
            </button>
            <button type="button" className="button-link" onClick={() => setArmed(null)}>
              Cancel
            </button>
          </div>
        )}

        {armed === null && (
          <div className="action-bar">
            <p className="turn-indicator">{view.turn !== null ? `${seatLabel(view.turn)}'s turn` : "No turn in progress"}</p>

            <button
              type="button"
              className="button-primary"
              disabled={selected.size !== 1 || !canDiscard}
              title={!canDiscard ? "Discard — the game isn't in play, or a flag is blocking play" : selected.size !== 1 ? "Select exactly one tile" : undefined}
              onClick={() => {
                const handle = [...selected][0];
                const entry = view.ownHand.find((e) => !("gap" in e) && e.handle === handle) as { readonly handle: TileHandle; readonly tile: Face } | undefined;
                if (entry !== undefined) setArmed({ kind: "discard", handle: entry.handle, face: entry.tile });
              }}
            >
              Discard
            </button>

            <button
              type="button"
              className="button-primary"
              disabled={selected.size === 0 || !canExpose}
              title={!canExpose ? "Expose — the game isn't in play or concluding" : selected.size === 0 ? "Select at least one tile" : undefined}
              onClick={() => setArmed({ kind: "expose", handles: [...selected] })}
            >
              Expose {selected.size > 0 ? `(${selected.size})` : ""}
            </button>

            <button type="button" className="button-primary" disabled={!canDeclare} title={!canDeclare ? "Declare — not available right now" : undefined} onClick={() => setArmed({ kind: "declare" })}>
              Declare Mahjong
            </button>

            <button type="button" className="button-link" disabled={!canReveal} title={!canReveal ? "Reveal — not available right now" : undefined} onClick={() => setArmed({ kind: "reveal" })}>
              Reveal hand
            </button>

            {view.gameState !== "concluded" && (
              <>
                {view.endGame === null && (inPlay || concluding) && (
                  <button type="button" className="button-link" onClick={() => send("propose_end_game")}>
                    Propose ending the game
                  </button>
                )}
                <button
                  type="button"
                  className="button-link"
                  onClick={() => send(view.flags.paused ? "request_resume" : "request_pause")}
                >
                  {view.flags.paused ? "Request resume" : "Request pause"}
                </button>
              </>
            )}

            <PassRoundPanel
              passRound={view.passRound}
              ownSeat={ownSeat}
              selectedHandles={[...selected]}
              canAct={canOpenPassRound || view.passRound !== null}
              onOpen={(routing) => send("open_pass_round", { routing })}
              onRequestCommit={(handles) => setArmed({ kind: "commitPass", handles })}
              onWithdraw={() => send("withdraw_pass")}
              onCancel={() => send("cancel_pass_round")}
            />

            <div className="correction-builder">
              <label>
                Rewind to sequence{" "}
                <input
                  type="number"
                  value={correctionInput}
                  disabled={!canProposeCorrection}
                  onChange={(e) => setCorrectionInput(e.target.value)}
                  style={{ width: "5rem" }}
                />
              </label>
              <button
                type="button"
                className="button-link"
                disabled={!canProposeCorrection || correctionInput.trim() === ""}
                onClick={() => {
                  const n = Number(correctionInput);
                  if (Number.isInteger(n)) setArmed({ kind: "correction", rewindTo: n });
                }}
              >
                Propose correction
              </button>
            </div>
          </div>
        )}
      </div>

      <ChatPanel messages={chatLog} onSend={(text) => send("send_table_message", { text })} onSignal={(signal) => send("send_signal", { signal })} />
    </div>
  );

  function renderOpponent(seat: Seat | undefined) {
    if (seat === undefined) return null;
    const summary = view.seats.find((s) => s.seat === seat) ?? null;
    const isTurn = view.turn === seat;
    const flash = signalFlash[seat];
    return (
      <div className="seat-panel">
        <p className="seat-caption">
          {seatLabel(seat)} · {summary?.displayName ?? "empty"}
          {summary !== null && ` · ${summary.connection}`}
          {isTurn && <span className="turn-caret" aria-hidden="true"> ▲</span>}
          {isTurn && <span className="visually-hidden">, {seatLabel(seat)}'s turn</span>}
          {flash !== undefined && <span className="signal-flash"> [{flash}]</span>}
        </p>
        <div className="exposure-row">
          {summary?.exposures.map((exp) => (
            <div className="exposure-group" key={exp.exposureId}>
              {exp.tiles.map((t) => (
                <Tile key={t.handle} face={t.tile} interactive={false} heightPx={56} />
              ))}
            </div>
          ))}
        </div>
        <div className="opponent-rack" role="list" aria-label={`${seatLabel(seat)}'s hand`}>
          {Array.from({ length: summary?.handSize ?? 0 }).map((_, i) => (
            <Tile key={i} interactive={false} heightPx={56} />
          ))}
        </div>
        <p className="hand-count">{summary?.handSize ?? 0} tiles</p>
      </div>
    );
  }
}
