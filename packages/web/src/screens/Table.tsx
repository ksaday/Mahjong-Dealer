import { useCallback, useEffect, useState } from "react";
import { Navigate, useNavigate, useParams } from "react-router-dom";
import { ApiError } from "../api/client.js";
import { tablesApi, type MyTable } from "../api/tables.js";
import { useAuth } from "../auth/AuthContext.js";
import { useToast } from "../components/Toast.js";
import { recallJoinCode } from "../tables/joinCodeStorage.js";
import { useTableLive } from "../ws/useTableLive.js";

// S-05 Table lobby (docs/32_UX/Screen_Inventory.md §3), simplified: a
// plain seat list rather than the four compass positions
// Table_Layout_and_Perspective.md specifies. That spatial layout is
// shared visual infrastructure with S-06's own rendering and deserves its
// own pass once tile rendering exists — tracked as a simplification, not
// silently treated as the finished design.
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

  const ownSeat = live.view?.seats.find((s) => s.seat === live.view?.seat) ?? null;
  const allReady = live.view !== null && live.view.seats.every((s) => s.ready);
  const canStartDeal = live.view !== null && live.view.tableState === "seated" && live.view.gameState === "idle" && allReady;

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

            {live.view.gameState === "idle" && ownSeat !== null && (
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

            {live.view.gameState !== "idle" && <p>A game is in progress. The game table isn&rsquo;t built yet.</p>}
          </>
        )}
      </section>

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
