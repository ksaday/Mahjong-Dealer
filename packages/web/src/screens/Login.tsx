import { useState } from "react";
import type { FormEvent } from "react";
import { Link, Navigate, useNavigate } from "react-router-dom";
import { ApiError, isLockedError, lockedUntil } from "../api/client.js";
import { useAuth } from "../auth/AuthContext.js";
import { useToast } from "../components/Toast.js";

// S-03 Log in (docs/32_UX/Screen_Inventory.md §3). The failure state never
// distinguishes a wrong password from an unknown account (FR-002); the
// locked state states its own expiry (D-32-04) rather than just "locked."
// An administrator goes to S-09a to verify a second factor, not straight
// to S-09 (docs/15 §8.1, ADR-0017; Screen_Inventory §2's flow diagram:
// "S-03 -->|administrator| S-09a").
export function Login() {
  const { state, login } = useAuth();
  const { show } = useToast();
  const navigate = useNavigate();

  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [failure, setFailure] = useState<string | null>(null);
  const [lockedUntilIso, setLockedUntilIso] = useState<string | null>(null);

  if (state.status === "mfa_pending") {
    return <Navigate to="/mfa" replace />;
  }
  if (state.status === "authenticated") {
    return <Navigate to={state.account.role === "administrator" ? "/admin" : "/home"} replace />;
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setFailure(null);
    setLockedUntilIso(null);
    setSubmitting(true);
    try {
      const result = await login(email, password);
      navigate(result.mfa_required === true ? "/mfa" : result.role === "administrator" ? "/admin" : "/home");
    } catch (error) {
      setSubmitting(false);
      if (isLockedError(error)) {
        setLockedUntilIso(lockedUntil(error));
        return;
      }
      if (error instanceof ApiError && error.code === "RATE_LIMITED") {
        show("Too many attempts. Wait a moment and try again.");
        return;
      }
      if (error instanceof ApiError && (error.status === 401 || error.status === 403)) {
        setFailure(error.message);
        return;
      }
      show(error instanceof ApiError ? error.message : "Log in failed. Try again.");
    }
  }

  return (
    <main id="main" className="screen">
      <h1>Log in</h1>
      {lockedUntilIso !== null && (
        <p className="field-error" role="alert">
          This account is temporarily locked, until {new Date(lockedUntilIso).toLocaleString()}.
        </p>
      )}
      <form onSubmit={(event) => void handleSubmit(event)} noValidate>
        <div className="field">
          <label htmlFor="email">Email</label>
          <input
            id="email"
            type="email"
            autoComplete="email"
            required
            value={email}
            onChange={(event) => setEmail(event.target.value)}
          />
        </div>
        <div className="field">
          <label htmlFor="password">Password</label>
          <input
            id="password"
            type="password"
            autoComplete="current-password"
            required
            value={password}
            onChange={(event) => setPassword(event.target.value)}
          />
          {failure !== null && (
            <p className="field-error" role="alert">
              {failure}
            </p>
          )}
        </div>
        <button type="submit" className="button-primary" disabled={submitting || lockedUntilIso !== null}>
          {submitting ? "Logging in…" : "Log in"}
        </button>
      </form>
      <p>
        Need an account? <Link to="/register">Create one</Link>
      </p>
    </main>
  );
}
