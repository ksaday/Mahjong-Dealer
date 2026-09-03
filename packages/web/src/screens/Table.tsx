import { useCallback, useEffect, useState } from "react";
import { Navigate, useNavigate, useParams } from "react-router-dom";
import type { NoticeKind } from "@mahjong-dealer/shared";
import { ApiError } from "../api/client.js";
import { tablesApi, type MyTable } from "../api/tables.js";
import { useAuth } from "../auth/AuthContext.js";
import { useToast } from "../components/Toast.js";
import { GameTable } from "../gametable/GameTable.js";
import { recallJoinCode } from "../tables/joinCodeStorage.js";
import { useTableLive } from "../ws/useTableLive.js";

// S-05 Table lobby (docs/32_UX/Screen_Inventory.md §3), simplified: a
// plain seat list rather than the four compass positions
// Table_Layout_and_Perspective.md specifies — that spatial layout now
// exists (`gametable/GameTable.tsx`) for S-06, but porting the lobby's own
// seat list onto it is a follow-up, not folded in silently here.
//
// A concluded game returns to this lobby, not home (D-32-02) — but the
// game itself stays server-side `CONCLUDED` (not `IDLE`) until the host
// deals again (docs/09 §4's `start_deal` is `✔` from both), so which body
// renders is client-side: `GameTable` shows its own concluded band with a
// "Return to the lobby" control, and this screen just stops treating
// `CONCLUDED` as game-shaped once that control is pressed. A fresh game
// beginning (`gameState` leaving `CONCLUDED`) resets the flag.
//
// Known wire-contract gap, surfaced rather than worked around: nothing on
// the wire (`WireSeatView`/`WireSeatSummary`) or in `GET /tables/mine`
// says which seat is host, even though `Table.host` exists server-side
// (server/src/table/table.ts) and `start_deal`/`close_table` are host-only.
// So "Start dealing" is shown to every seat once the table qualifies, and
// a non-host click surfaces the server's own FORBIDDEN rejection as a
// toast rather than being hidden client-side — the same shape of
// ambiguity `DELETE /tables/{id}` already accepts for `close_table`.
export function Table() {
  const { tableId } = useParams<{ tableId: string }>();
  const { state } = useAuth();
  const { show } = useToast();
  const navigate = useNavigate();

  const [table, setTable] = useState<MyTable | null | undefined>(undefined);
  const [closing, setClosing] = useState(false);
  const [leaving, setLeaving] = useState(false);
  const [ackConcluded, setAckConcluded] = useState(false);

  const load = useCallback(() => {
    if (tableId === undefined) return;
    tablesApi
      .mine()
      .then((result) => setTable(result.tables.find((t) => t.table_id === tableId) ?? null))
      .catch(() => setTable(null));
  }, [tableId]);

  useEffect(() => {
    if (state.status === "authenticated") {
      load();
    }
  }, [state.status, load]);

  const live = useTableLive(table != null && tableId !== undefined ? tableId : "");

  useEffect(() => {
    if (live.lastReject !== null) {
      show(live.lastReject.message);
    }
  }, [live.lastReject, show]);

  useEffect(() => {
    if (live.lastNotice !== null) {
      show(noticeMessage(live.lastNotice.kind));
    }
  }, [live.lastNotice, show]);

  const gameState = live.view?.gameState;
  useEffect(() => {
    if (gameState !== undefined && gameState !== "concluded") setAckConcluded(false);
  }, [gameState]);

  if (state.status === "loading" || table === undefined) {
    return (
      <main id="main" className="screen">
        <p>Loading…</p>
      </main>
    );
  }
  if (state.status === "anonymous") {
    return <Navigate to="/" replace />;
  }
  if (table === null || tableId === undefined) {
    return (
      <main id="main" className="screen">
        <h1>Table not found</h1>
        <p>You don&rsquo;t hold a seat there, or it no longer exists.</p>
        <button type="button" className="button-primary" onClick={() => navigate("/home")}>
          Back to home
        </button>
      </main>
    );
  }

  const confirmedTableId = tableId;
  const joinCode = recallJoinCode(confirmedTableId);

  async function handleClose() {
    setClosing(true);
    try {
      await tablesApi.close(confirmedTableId);
      navigate("/home");
    } catch (error) {
      setClosing(false);
      show(error instanceof ApiError ? error.message : "Could not close the table.");
    }
  }

  async function handleLeave() {
    setLeaving(true);
    try {
      await tablesApi.leave(confirmedTableId);
      navigate("/home");
    } catch (error) {
      setLeaving(false);
      show(error instanceof ApiError ? error.message : "Could not leave the table.");
    }
  }

  const ownSeat = live.view?.seats.find((s) => s.seat === live.view?.seat) ?? null;
  const allReady = live.view !== null && live.view.seats.every((s) => s.ready);
  const canStartDeal =
    live.view !== null &&
    live.view.tableState === "seated" &&
    (live.view.gameState === "idle" || live.view.gameState === "concluded") &&
    allReady;

  const gameActive =
    live.view !== null && live.view.gameState !== "idle" && !(live.view.gameState === "concluded" && ackConcluded);

  if (live.phase === "ready" && live.view !== null && gameActive) {
    return (
      <main id="main" className="screen-wide">
        <GameTable view={live.view} send={live.send} lastEvent={live.lastEvent} onReturnToLobby={() => setAckConcluded(true)} />
      </main>
    );
  }

  return (
    <main id="main" className="screen">
      <h1>Table</h1>
      <p>
        Status: {table.status}
        {table.game_state !== null && ` — ${table.game_state}`}
      </p>
      <p>Your seat: {table.seat}</p>
      {joinCode !== null && (
        <p>
          Join code: <strong>{joinCode}</strong>
        </p>
      )}

      <section aria-labelledby="live-heading">
        <h2 id="live-heading">Lobby</h2>

        {live.phase === "minting" || live.phase === "connecting" || live.phase === "bound" ? (
          <p>Connecting…</p>
        ) : null}

        {live.phase === "error" && (
          <p role="alert">
            {live.errorMessage} <button type="button" className="button-link" onClick={live.reconnect}>Retry</button>
          </p>
        )}

        {live.phase === "closed" && (
          <p role="alert">
            Disconnected ({live.closeInfo?.reason}).{" "}
            <button type="button" className="button-link" onClick={live.reconnect}>
              Reconnect
            </button>
          </p>
        )}

        {live.phase === "ready" && live.view !== null && (
          <>
            <ul>
              {live.view.seats.map((seat) => (
                <li key={seat.seat}>
                  {seat.seat}: {seat.displayName ?? "empty"}
                  {seat.displayName !== null && ` (${seat.connection}, ${seat.ready ? "ready" : "not ready"})`}
                </li>
              ))}
            </ul>

            {ownSeat !== null && (
              <button
                type="button"
                className="button-primary"
                onClick={() => live.send(ownSeat.ready ? "clear_ready" : "set_ready")}
              >
                {ownSeat.ready ? "Not ready" : "Ready"}
              </button>
            )}

            {canStartDeal && (
              <button type="button" className="button-primary" onClick={() => live.send("start_deal")}>
                Start dealing
              </button>
            )}
          </>
        )}
      </section>

      <button type="button" className="button-primary" onClick={() => void handleLeave()} disabled={leaving}>
        {leaving ? "Leaving…" : "Leave table"}
      </button>
      <button type="button" className="button-primary" onClick={() => void handleClose()} disabled={closing}>
        {closing ? "Closing…" : "Close table"}
      </button>
      <p>
        <button type="button" className="button-link" onClick={() => navigate("/home")}>
          Back to home
        </button>
      </p>
    </main>
  );
}

/** docs/19 §7.3 — the three out-of-band notice kinds, in user-facing terms. */
function noticeMessage(kind: NoticeKind): string {
  switch (kind) {
    case "connection_degraded":
      return "Your connection looks unsteady — you may be disconnected soon.";
    case "rate_limit_warning":
      return "You're sending commands too quickly.";
    case "service_restarting":
      return "The server is restarting shortly — you'll be reconnected automatically.";
  }
}
