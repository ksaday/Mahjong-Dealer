// The pass-round overlay (docs/10_Player_Action_Model.md §6,
// docs/32_UX/Table_Layout_and_Perspective.md §6 "Pass round open"): a
// neutral, simultaneous, secret exchange the system does not attach any
// rule meaning to. Opening one means naming an arbitrary routing —
// `{ from, to }` pairs the players agreed among themselves — so the
// opener picks each seat's destination directly rather than choosing
// among named rule concepts the system has none of (NR-008).
import { useState } from "react";
import { SEAT_ORDER, type Seat, type TileHandle, type WirePassRound } from "@mahjong-dealer/shared";
import { seatLabel } from "./seatLayout.js";

export interface PassRoundPanelProps {
  readonly passRound: WirePassRound | null;
  readonly ownSeat: Seat;
  readonly selectedHandles: readonly TileHandle[];
  readonly canAct: boolean;
  readonly onOpen: (routing: readonly { readonly from: Seat; readonly to: Seat }[]) => void;
  readonly onRequestCommit: (handles: readonly TileHandle[]) => void;
  readonly onWithdraw: () => void;
  readonly onCancel: () => void;
}

const NONE = "__none__";

export function PassRoundPanel({ passRound, ownSeat, selectedHandles, canAct, onOpen, onRequestCommit, onWithdraw, onCancel }: PassRoundPanelProps) {
  const [routingDraft, setRoutingDraft] = useState<Record<Seat, string>>({
    east: NONE,
    south: NONE,
    west: NONE,
    north: NONE,
  });
  const [building, setBuilding] = useState(false);

  if (passRound !== null) {
    const ownCommitted = passRound.ownCommitment !== undefined;
    return (
      <div className="pass-round-panel" role="status">
        <p>
          Pass round open:{" "}
          {passRound.routing.map((r) => `${seatLabel(r.from)} → ${seatLabel(r.to)}`).join(", ")}
        </p>
        <ul className="pass-round-counts">
          {SEAT_ORDER.map((seat) => (
            <li key={seat}>
              {seatLabel(seat)}: {passRound.committedCounts[seat] ?? 0} committed
            </li>
          ))}
        </ul>
        {!ownCommitted && canAct && (
          <button
            type="button"
            className="button-primary"
            disabled={selectedHandles.length === 0}
            onClick={() => onRequestCommit(selectedHandles)}
          >
            Commit {selectedHandles.length} selected tile{selectedHandles.length === 1 ? "" : "s"}
          </button>
        )}
        {ownCommitted && canAct && (
          <button type="button" className="button-link" onClick={onWithdraw}>
            Withdraw my commitment
          </button>
        )}
        {canAct && (
          <button type="button" className="button-link" onClick={onCancel}>
            Cancel the round
          </button>
        )}
      </div>
    );
  }

  if (!building) {
    return (
      <button type="button" className="button-link" disabled={!canAct} onClick={() => setBuilding(true)}>
        Open a pass round
      </button>
    );
  }

  function submit(): void {
    const routing = SEAT_ORDER.flatMap((from) => {
      const to = routingDraft[from];
      return to === NONE ? [] : [{ from, to: to as Seat }];
    });
    if (routing.length > 0) onOpen(routing);
    setBuilding(false);
  }

  return (
    <div className="pass-round-builder">
      <p>Who sends to whom?</p>
      {SEAT_ORDER.map((seat) => (
        <label key={seat} className="pass-round-row">
          {seatLabel(seat)}
          {seat === ownSeat ? " (you)" : ""} sends to{" "}
          <select
            value={routingDraft[seat]}
            onChange={(e) => setRoutingDraft((prev) => ({ ...prev, [seat]: e.target.value }))}
          >
            <option value={NONE}>nobody</option>
            {SEAT_ORDER.filter((other) => other !== seat).map((other) => (
              <option key={other} value={other}>
                {seatLabel(other)}
              </option>
            ))}
          </select>
        </label>
      ))}
      <button type="button" className="button-primary" onClick={submit}>
        Open round
      </button>
      <button type="button" className="button-link" onClick={() => setBuilding(false)}>
        Cancel
      </button>
    </div>
  );
}
