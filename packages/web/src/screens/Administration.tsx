import { useCallback, useEffect, useState } from "react";
import { Navigate, useNavigate } from "react-router-dom";
import { ApiError } from "../api/client.js";
import { adminApi, type AdminAccountSummary, type AdminHealth, type AdminTableSummary, type AuditEntry } from "../api/admin.js";
import { useAuth } from "../auth/AuthContext.js";
import { useToast } from "../components/Toast.js";

// S-09 Administration (docs/32_UX/Screen_Inventory.md §3): accounts with
// disable, tables with force-close, health, and the audit log. Every
// mutation requires a reason (FR-166) — enforced here by disabling the
// action button until one is typed, and again server-side regardless.
//
// D-18-07/FR-164: this screen has no field, tab, or detail view anywhere
// that could show a seat's occupant identity in the tables section, or
// anything about a game. `AdminTableSummary` on the wire has no such
// field to render even by mistake.
export function Administration() {
  const { state } = useAuth();
  const { show } = useToast();
  const navigate = useNavigate();

  const [accounts, setAccounts] = useState<readonly AdminAccountSummary[] | null>(null);
  const [accountQuery, setAccountQuery] = useState("");
  const [accountReasons, setAccountReasons] = useState<Record<string, string>>({});
  const [accountBusy, setAccountBusy] = useState<string | null>(null);

  const [tables, setTables] = useState<readonly AdminTableSummary[] | null>(null);
  const [tableReasons, setTableReasons] = useState<Record<string, string>>({});
  const [tableBusy, setTableBusy] = useState<string | null>(null);

  const [health, setHealth] = useState<AdminHealth | null>(null);
  const [audit, setAudit] = useState<readonly AuditEntry[] | null>(null);

  const isAdmin = state.status === "authenticated" && state.account.role === "administrator";

  const loadAccounts = useCallback((query: string) => {
    adminApi
      .listAccounts({ query })
      .then((result) => setAccounts(result.accounts))
      .catch(() => setAccounts([]));
  }, []);

  const loadTables = useCallback(() => {
    adminApi
      .listTables()
      .then((result) => setTables(result.tables))
      .catch(() => setTables([]));
  }, []);

  const loadHealth = useCallback(() => {
    adminApi.health().then(setHealth).catch(() => setHealth(null));
  }, []);

  const loadAudit = useCallback(() => {
    adminApi
      .audit()
      .then((result) => setAudit(result.entries))
      .catch(() => setAudit([]));
  }, []);

  useEffect(() => {
    if (!isAdmin) return;
    loadAccounts("");
    loadTables();
    loadHealth();
    loadAudit();
  }, [isAdmin, loadAccounts, loadTables, loadHealth, loadAudit]);

  if (state.status === "loading") {
    return null;
  }
  if (state.status === "anonymous") {
    return <Navigate to="/" replace />;
  }
  if (!isAdmin) {
    return <Navigate to="/home" replace />;
  }

  async function handleToggleStatus(account: AdminAccountSummary): Promise<void> {
    const reason = (accountReasons[account.account_id] ?? "").trim();
    if (reason === "") return;
    const nextStatus = account.status === "active" ? "disabled" : "active";
    setAccountBusy(account.account_id);
    try {
      await adminApi.setAccountStatus(account.account_id, nextStatus, reason);
      setAccountReasons((prev) => ({ ...prev, [account.account_id]: "" }));
      loadAccounts(accountQuery);
      loadAudit();
    } catch (error) {
      show(error instanceof ApiError ? error.message : "Could not update that account.");
    } finally {
      setAccountBusy(null);
    }
  }

  async function handleForceClose(table: AdminTableSummary): Promise<void> {
    const reason = (tableReasons[table.table_id] ?? "").trim();
    if (reason === "") return;
    setTableBusy(table.table_id);
    try {
      await adminApi.forceCloseTable(table.table_id, reason);
      setTableReasons((prev) => ({ ...prev, [table.table_id]: "" }));
      loadTables();
      loadAudit();
    } catch (error) {
      show(error instanceof ApiError ? error.message : "Could not close that table.");
    } finally {
      setTableBusy(null);
    }
  }

  return (
    <main id="main" className="screen-wide">
      <h1>Administration</h1>

      <section aria-labelledby="accounts-heading">
        <h2 id="accounts-heading">Accounts</h2>
        <form
          onSubmit={(event) => {
            event.preventDefault();
            loadAccounts(accountQuery);
          }}
        >
          <input
            type="search"
            placeholder="Search by email or display name"
            value={accountQuery}
            onChange={(event) => setAccountQuery(event.target.value)}
          />
          <button type="submit" className="button-link">
            Search
          </button>
        </form>
        {accounts === null && <p>Loading…</p>}
        {accounts !== null && accounts.length === 0 && <p>No accounts match.</p>}
        {accounts !== null && accounts.length > 0 && (
          <table>
            <thead>
              <tr>
                <th>Email</th>
                <th>Display name</th>
                <th>Role</th>
                <th>Status</th>
                <th>Created</th>
                <th>Reason</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {accounts.map((account) => (
                <tr key={account.account_id}>
                  <td>{account.email}</td>
                  <td>{account.display_name}</td>
                  <td>{account.role}</td>
                  <td>{account.status}</td>
                  <td>{new Date(account.created_at).toLocaleDateString()}</td>
                  <td>
                    <input
                      type="text"
                      aria-label={`Reason for ${account.email}`}
                      value={accountReasons[account.account_id] ?? ""}
                      onChange={(event) =>
                        setAccountReasons((prev) => ({ ...prev, [account.account_id]: event.target.value }))
                      }
                    />
                  </td>
                  <td>
                    <button
                      type="button"
                      className="button-link"
                      disabled={accountBusy === account.account_id || (accountReasons[account.account_id] ?? "").trim() === ""}
                      onClick={() => void handleToggleStatus(account)}
                    >
                      {account.status === "active" ? "Disable" : "Enable"}
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>

      <section aria-labelledby="tables-heading">
        <h2 id="tables-heading">Tables</h2>
        {tables === null && <p>Loading…</p>}
        {tables !== null && tables.length === 0 && <p>No tables.</p>}
        {tables !== null && tables.length > 0 && (
          <table>
            <thead>
              <tr>
                <th>Table</th>
                <th>Status</th>
                <th>Occupied seats</th>
                <th>Created</th>
                <th>Reason</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {tables.map((table) => (
                <tr key={table.table_id}>
                  <td>{table.table_id}</td>
                  <td>{table.status}</td>
                  <td>{table.occupied_seats} / 4</td>
                  <td>{new Date(table.created_at).toLocaleDateString()}</td>
                  <td>
                    {table.status !== "closed" && (
                      <input
                        type="text"
                        aria-label={`Reason for closing table ${table.table_id}`}
                        value={tableReasons[table.table_id] ?? ""}
                        onChange={(event) => setTableReasons((prev) => ({ ...prev, [table.table_id]: event.target.value }))}
                      />
                    )}
                  </td>
                  <td>
                    {table.status !== "closed" && (
                      <button
                        type="button"
                        className="button-link"
                        disabled={tableBusy === table.table_id || (tableReasons[table.table_id] ?? "").trim() === ""}
                        onClick={() => void handleForceClose(table)}
                      >
                        Force-close
                      </button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>

      <section aria-labelledby="health-heading">
        <h2 id="health-heading">Health</h2>
        {health === null && <p>Loading…</p>}
        {health !== null && (
          <ul>
            <li>Uptime: {Math.floor(health.uptime_seconds)} s</li>
            <li>
              Tables: {health.tables.total} total, {health.tables.live_in_this_process} live in this process
            </li>
            <li>Connections: {health.connections}</li>
          </ul>
        )}
        <button type="button" className="button-link" onClick={loadHealth}>
          Refresh
        </button>
      </section>

      <section aria-labelledby="audit-heading">
        <h2 id="audit-heading">Audit log</h2>
        {audit === null && <p>Loading…</p>}
        {audit !== null && audit.length === 0 && <p>No entries yet.</p>}
        {audit !== null && audit.length > 0 && (
          <table>
            <thead>
              <tr>
                <th>When</th>
                <th>Actor</th>
                <th>Action</th>
                <th>Target</th>
                <th>Reason</th>
              </tr>
            </thead>
            <tbody>
              {audit.map((entry) => (
                <tr key={entry.id}>
                  <td>{new Date(entry.occurred_at).toLocaleString()}</td>
                  <td>{entry.actor_account_id ?? "—"}</td>
                  <td>{entry.action}</td>
                  <td>
                    {entry.target_type !== null ? `${entry.target_type}: ${entry.target_id}` : "—"}
                  </td>
                  <td>{entry.reason ?? "—"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>

      <p>
        <button type="button" className="button-link" onClick={() => navigate("/home")}>
          Back to home
        </button>
      </p>
    </main>
  );
}
