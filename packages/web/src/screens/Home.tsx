import { useCallback, useEffect, useState } from "react";
import type { FormEvent } from "react";
import { Navigate, useNavigate } from "react-router-dom";
import { ApiError } from "../api/client.js";
import { tablesApi, type MyTable } from "../api/tables.js";
import { useAuth } from "../auth/AuthContext.js";
import { rememberJoinCode } from "../tables/joinCodeStorage.js";
import { useToast } from "../components/Toast.js";

// S-04 Home (docs/32_UX/Screen_Inventory.md §3): create a table, join by
// code, and your seats. States: default, no seats, creating, joining, join
// failed.
export function Home() {
  const { state, logout } = useAuth();
  const { show } = useToast();
  const navigate = useNavigate();

  const [joinCode, setJoinCode] = useState("");
  const [creating, setCreating] = useState(false);
  const [joining, setJoining] = useState(false);
  const [joinFailed, setJoinFailed] = useState(false);

  const [mine, setMine] = useState<readonly MyTable[] | null>(null);

  const loadMine = useCallback(() => {
    tablesApi
      .mine()
      .then((result) => setMine(result.tables))
      .catch(() => setMine([]));
  }, []);

  useEffect(() => {
    if (state.status === "authenticated") {
      loadMine();
    }
  }, [state.status, loadMine]);

  if (state.status === "loading") {
    return null;
  }
  if (state.status === "anonymous") {
    return <Navigate to="/" replace />;
  }

  async function handleCreate() {
    setCreating(true);
    try {
      const result = await tablesApi.create();
      rememberJoinCode(result.table_id, result.join_code);
      navigate(`/tables/${result.table_id}`);
    } catch (error) {
      setCreating(false);
      if (error instanceof ApiError && error.code === "ALREADY_SEATED") {
        show("You already hold a seat at a table.");
        return;
      }
      show(error instanceof ApiError ? error.message : "Could not create a table.");
    }
  }

  async function handleJoin(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setJoinFailed(false);
    setJoining(true);
    try {
      const result = await tablesApi.join(joinCode);
      navigate(`/tables/${result.table_id}`);
    } catch (error) {
      setJoining(false);
      if (error instanceof ApiError && (error.code === "NOT_FOUND" || error.code === "ALREADY_SEATED")) {
        setJoinFailed(true);
        return;
      }
      show(error instanceof ApiError ? error.message : "Could not join that table.");
    }
  }

  return (
    <main id="main" className="screen">
      <h1>Signed in as {state.account.display_name}</h1>

      <section aria-labelledby="create-heading">
        <h2 id="create-heading">Create a table</h2>
        <button type="button" className="button-primary" onClick={() => void handleCreate()} disabled={creating}>
          {creating ? "Creating…" : "Create a table"}
        </button>
      </section>

      <section aria-labelledby="join-heading">
        <h2 id="join-heading">Join by code</h2>
        <form onSubmit={(event) => void handleJoin(event)} noValidate>
          <div className="field">
            <label htmlFor="join-code">Join code</label>
            <input
              id="join-code"
              type="text"
              inputMode="text"
              autoComplete="off"
              maxLength={6}
              required
              value={joinCode}
              onChange={(event) => setJoinCode(event.target.value.toUpperCase())}
            />
            {joinFailed && (
              <p className="field-error" role="alert">
                That code didn&rsquo;t work.
              </p>
            )}
          </div>
          <button type="submit" className="button-primary" disabled={joining || joinCode.length === 0}>
            {joining ? "Joining…" : "Join"}
          </button>
        </form>
      </section>

      <section aria-labelledby="seats-heading">
        <h2 id="seats-heading">Your seats</h2>
        {mine === null && <p>Loading…</p>}
        {mine !== null && mine.length === 0 && <p>You don&rsquo;t hold a seat at any table yet.</p>}
        {mine !== null && mine.length > 0 && (
          <ul>
            {mine.map((table) => (
              <li key={table.table_id}>
                {table.seat}, {table.status}
                {table.game_state !== null && ` — ${table.game_state}`}
                {" — "}
                <button type="button" className="button-link" onClick={() => navigate(`/tables/${table.table_id}`)}>
                  Resume
                </button>
              </li>
            ))}
          </ul>
        )}
      </section>

      <button
        type="button"
        className="button-primary"
        onClick={() => {
          void logout().then(() => navigate("/"));
        }}
      >
        Log out
      </button>
    </main>
  );
}
