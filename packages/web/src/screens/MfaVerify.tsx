import { useState } from "react";
import type { FormEvent } from "react";
import { Navigate } from "react-router-dom";
import { ApiError, isMfaLockedError } from "../api/client.js";
import { useAuth } from "../auth/AuthContext.js";
import { useToast } from "../components/Toast.js";

// S-09a MFA verification (docs/32_UX/Screen_Inventory.md §3; docs/15
// §8.1; ADR-0017). Not one of the nine screens (D-32-01) — a narrow gate
// reachable only right after an administrator's own POST /sessions
// returns mfa_required: true (AuthContext's "mfa_pending" state), never
// linked from anywhere else.
//
// No "forgot your code" link and no recovery flow, deliberately: a lost
// device is an out-of-band operational procedure (docs/28 §3.2), and a
// self-service path here would be exactly the recovery-code subsystem
// ADR-0017 decided against.
export function MfaVerify() {
  const { state, verifyMfa } = useAuth();
  const { show } = useToast();

  const [code, setCode] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [failure, setFailure] = useState<string | null>(null);
  const [lockedUntilIso, setLockedUntilIso] = useState<string | null>(null);

  // A successful verifyMfa() below moves state to "authenticated" —
  // handled here, declaratively, the same way Login.tsx's own guard
  // reacts to its state, rather than also navigating imperatively on
  // success and risking the two disagreeing about where "done" goes.
  if (state.status === "authenticated") {
    return <Navigate to={state.account.role === "administrator" ? "/admin" : "/home"} replace />;
  }
  if (state.status !== "mfa_pending") {
    // Reached directly (a bookmark, a reload) rather than via a fresh
    // administrator login — nothing to verify here.
    return <Navigate to="/" replace />;
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setFailure(null);
    setLockedUntilIso(null);
    setSubmitting(true);
    try {
      await verifyMfa(code);
    } catch (error) {
      setSubmitting(false);
      if (isMfaLockedError(error)) {
        setLockedUntilIso(error.locked_until);
        return;
      }
      if (error instanceof ApiError && error.code === "RATE_LIMITED") {
        show("Too many attempts. Wait a moment and try again.");
        return;
      }
      if (error instanceof ApiError && error.code === "MFA_INVALID") {
        setFailure("That code didn't work. Try again.");
        setCode("");
        return;
      }
      show(error instanceof ApiError ? error.message : "Verification failed. Try again.");
    }
  }

  return (
    <main id="main" className="screen">
      <h1>Verify it's you</h1>
      <p>Enter the 6-digit code from your authenticator app.</p>
      {lockedUntilIso !== null && (
        <p className="field-error" role="alert">
          Too many failed codes. Try again after {new Date(lockedUntilIso).toLocaleString()}.
        </p>
      )}
      <form onSubmit={(event) => void handleSubmit(event)} noValidate>
        <div className="field">
          <label htmlFor="code">Code</label>
          <input
            id="code"
            type="text"
            inputMode="numeric"
            autoComplete="one-time-code"
            pattern="[0-9]{6}"
            maxLength={6}
            required
            value={code}
            onChange={(event) => setCode(event.target.value.replace(/\D/g, ""))}
          />
          {failure !== null && (
            <p className="field-error" role="alert">
              {failure}
            </p>
          )}
        </div>
        <button
          type="submit"
          className="button-primary"
          disabled={submitting || code.length !== 6 || lockedUntilIso !== null}
        >
          {submitting ? "Verifying…" : "Verify"}
        </button>
      </form>
    </main>
  );
}
