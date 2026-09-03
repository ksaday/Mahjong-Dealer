import { useState } from "react";
import type { FormEvent } from "react";
import { Link, Navigate, useNavigate } from "react-router-dom";
import { ApiError, api } from "../api/client.js";
import { useAuth } from "../auth/AuthContext.js";
import { useToast } from "../components/Toast.js";

// S-02 Register (docs/32_UX/Screen_Inventory.md §3). Password requirements
// are stated before entry, not after failure (D-32-05). Registration does
// not establish a session (docs/33_API §3: only POST /sessions sets
// cookies), so success leads to the log-in screen rather than home.
export function Register() {
  const { state } = useAuth();
  const { show } = useToast();
  const navigate = useNavigate();

  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [displayName, setDisplayName] = useState("");
  const [phase, setPhase] = useState<"default" | "submitting" | "submitted">("default");
  const [passwordError, setPasswordError] = useState<string | null>(null);

  if (state.status === "authenticated") {
    return <Navigate to="/home" replace />;
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setPasswordError(null);
    setPhase("submitting");
    try {
      await api.register(email, password, displayName);
      setPhase("submitted");
    } catch (error) {
      setPhase("default");
      if (error instanceof ApiError && (error.code === "PASSWORD_TOO_SHORT" || error.code === "PASSWORD_BREACHED")) {
        setPasswordError(error.message);
        return;
      }
      if (error instanceof ApiError && error.code === "RATE_LIMITED") {
        show("Too many registration attempts. Try again later.");
        return;
      }
      show(error instanceof ApiError ? error.message : "Registration failed. Try again.");
    }
  }

  if (phase === "submitted") {
    return (
      <main id="main" className="screen">
        <h1>Account created</h1>
        <p>You can now log in.</p>
        <button type="button" className="button-primary" onClick={() => navigate("/login")}>
          Continue to log in
        </button>
      </main>
    );
  }

  return (
    <main id="main" className="screen">
      <h1>Create an account</h1>
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
        <div className="field">
          <label htmlFor="password">Password</label>
          <p className="field-hint" id="password-requirements">
            At least 12 characters. No other requirement — but a password that appears in a known
            breach list will be rejected.
          </p>
          <input
            id="password"
            type="password"
            autoComplete="new-password"
            required
            minLength={12}
            aria-describedby="password-requirements"
            value={password}
            onChange={(event) => setPassword(event.target.value)}
          />
          {passwordError !== null && (
            <p className="field-error" role="alert">
              {passwordError}
            </p>
          )}
        </div>
        <button type="submit" className="button-primary" disabled={phase === "submitting"}>
          {phase === "submitting" ? "Creating account…" : "Create account"}
        </button>
      </form>
      <p>
        Already have an account? <Link to="/login">Log in</Link>
      </p>
    </main>
  );
}
