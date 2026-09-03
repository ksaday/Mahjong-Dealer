import { useCallback, useEffect, useState } from "react";
import type { FormEvent } from "react";
import { Navigate, useNavigate } from "react-router-dom";
import { ApiError, api, type Account as AccountModel, type SessionSummary } from "../api/client.js";
import { useAuth } from "../auth/AuthContext.js";
import { useToast } from "../components/Toast.js";

// S-07 Account (docs/32_UX/Screen_Inventory.md §3): display name, password
// change, session list with revoke. Email is shown but not editable in v1
// (docs/18_API_Design.md §11) — there is no endpoint for it.
export function Account() {
  const { state, refresh } = useAuth();
  const { show } = useToast();
  const navigate = useNavigate();

  const [account, setAccount] = useState<AccountModel | null>(null);

  const [displayName, setDisplayName] = useState("");
  const [savingName, setSavingName] = useState(false);

  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [passwordError, setPasswordError] = useState<string | null>(null);
  const [changingPassword, setChangingPassword] = useState(false);
  const [passwordChanged, setPasswordChanged] = useState(false);

  const [sessions, setSessions] = useState<readonly SessionSummary[] | null>(null);
  const [revokingId, setRevokingId] = useState<string | null>(null);

  const loadSessions = useCallback(() => {
    api
      .listSessions()
      .then((result) => setSessions(result.sessions))
      .catch(() => setSessions([]));
  }, []);

  useEffect(() => {
    if (state.status !== "authenticated") return;
    api.me().then((acc) => {
      setAccount(acc);
      setDisplayName(acc.display_name);
    });
    loadSessions();
  }, [state.status, loadSessions]);

  if (state.status === "loading") {
    return null;
  }
  if (state.status === "anonymous") {
    return <Navigate to="/" replace />;
  }

  async function handleSaveName(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setSavingName(true);
    try {
      await api.updateDisplayName(displayName);
      await refresh();
      setAccount((prev) => (prev === null ? prev : { ...prev, display_name: displayName }));
      show("Display name updated.");
    } catch (error) {
      show(error instanceof ApiError ? error.message : "Could not update your display name.");
    } finally {
      setSavingName(false);
    }
  }

  async function handleChangePassword(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setPasswordError(null);
    setChangingPassword(true);
    try {
      await api.changePassword(currentPassword, newPassword);
      setCurrentPassword("");
      setNewPassword("");
      setPasswordChanged(true);
      loadSessions();
    } catch (error) {
      if (error instanceof ApiError && (error.code === "PASSWORD_TOO_SHORT" || error.code === "PASSWORD_BREACHED" || error.code === "INVALID_CREDENTIALS")) {
        setPasswordError(error.code === "INVALID_CREDENTIALS" ? "Current password is incorrect." : error.message);
        return;
      }
      show(error instanceof ApiError ? error.message : "Could not change your password.");
    } finally {
      setChangingPassword(false);
    }
  }

  async function handleRevoke(id: string) {
    setRevokingId(id);
    try {
      await api.revokeSession(id);
      setSessions((prev) => (prev === null ? prev : prev.filter((s) => s.id !== id)));
    } catch (error) {
      show(error instanceof ApiError ? error.message : "Could not revoke that session.");
    } finally {
      setRevokingId(null);
    }
  }

  return (
    <main id="main" className="screen">
      <h1>Account</h1>

      <section aria-labelledby="email-heading">
        <h2 id="email-heading">Email</h2>
        <p>{account?.email ?? "Loading…"}</p>
      </section>

      <section aria-labelledby="name-heading">
        <h2 id="name-heading">Display name</h2>
        <form onSubmit={(event) => void handleSaveName(event)} noValidate>
          <div className="field">
            <label htmlFor="display-name">Display name</label>
            <input
              id="display-name"
              type="text"
              autoComplete="nickname"
              required
              maxLength={50}
              value={displayName}
              onChange={(event) => setDisplayName(event.target.value)}
            />
          </div>
          <button type="submit" className="button-primary" disabled={savingName || displayName.trim().length === 0}>
            {savingName ? "Saving…" : "Save display name"}
          </button>
        </form>
      </section>

      <section aria-labelledby="password-heading">
        <h2 id="password-heading">Change password</h2>
        <p className="field-hint">Changing your password signs out every other session; this one stays signed in.</p>
        <form onSubmit={(event) => void handleChangePassword(event)} noValidate>
          <div className="field">
            <label htmlFor="current-password">Current password</label>
            <input
              id="current-password"
              type="password"
              autoComplete="current-password"
              required
              value={currentPassword}
              onChange={(event) => setCurrentPassword(event.target.value)}
            />
          </div>
          <div className="field">
            <label htmlFor="new-password">New password</label>
            <p className="field-hint" id="new-password-requirements">
              At least 12 characters. No other requirement — but a password that appears in a known
              breach list will be rejected.
            </p>
            <input
              id="new-password"
              type="password"
              autoComplete="new-password"
              required
              minLength={12}
              aria-describedby="new-password-requirements"
              value={newPassword}
              onChange={(event) => setNewPassword(event.target.value)}
            />
            {passwordError !== null && (
              <p className="field-error" role="alert">
                {passwordError}
              </p>
            )}
            {passwordChanged && (
              <p className="field-hint" role="status">
                Password changed.
              </p>
            )}
          </div>
          <button type="submit" className="button-primary" disabled={changingPassword}>
            {changingPassword ? "Changing…" : "Change password"}
          </button>
        </form>
      </section>

      <section aria-labelledby="sessions-heading">
        <h2 id="sessions-heading">Sessions</h2>
        {sessions === null && <p>Loading…</p>}
        {sessions !== null && sessions.length === 0 && <p>No active sessions.</p>}
        {sessions !== null && sessions.length > 0 && (
          <ul>
            {sessions.map((s) => (
              <li key={s.id}>
                {s.ip}
                {s.user_agent !== null && ` · ${s.user_agent}`} · last seen {new Date(s.last_seen_at).toLocaleString()}
                {s.current && " (this session)"}
                {!s.current && (
                  <>
                    {" — "}
                    <button
                      type="button"
                      className="button-link"
                      disabled={revokingId === s.id}
                      onClick={() => void handleRevoke(s.id)}
                    >
                      {revokingId === s.id ? "Revoking…" : "Revoke"}
                    </button>
                  </>
                )}
              </li>
            ))}
          </ul>
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
