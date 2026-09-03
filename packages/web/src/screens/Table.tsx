import { useCallback, useEffect, useState } from "react";
import { Navigate, useNavigate, useParams } from "react-router-dom";
import { ApiError } from "../api/client.js";
import { tablesApi, type MyTable } from "../api/tables.js";
import { useAuth } from "../auth/AuthContext.js";
import { useToast } from "../components/Toast.js";
import { recallJoinCode } from "../tables/joinCodeStorage.js";

// Placeholder landing spot for a created/joined/resumed table. S-05 Table
// lobby (seat compass positions, live readiness, the host's deal control —
// docs/32_UX/Screen_Inventory.md §3) needs the WebSocket client (ticket
// binding, `table_state`, `set_ready`/`clear_ready`), which is a later
// slice; this only proves create/join/resume land somewhere real, using
// the REST snapshot from `GET /tables/mine`.
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

  if (state.status === "loading" || table === undefined) {
    return null;
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

  const joinCode = recallJoinCode(tableId);

  async function handleClose() {
    if (tableId === undefined) return;
    setClosing(true);
    try {
      await tablesApi.close(tableId);
      navigate("/home");
    } catch (error) {
      setClosing(false);
      show(error instanceof ApiError ? error.message : "Could not close the table.");
    }
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
      <ul>
        {table.seats.map((seat) => (
          <li key={seat.seat}>
            {seat.seat}: {seat.display_name ?? "empty"}
            {seat.display_name !== null && (seat.connected ? " (connected)" : " (disconnected)")}
          </li>
        ))}
      </ul>
      <p>The live lobby — readiness, dealing, and the game itself — is not built yet.</p>
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
