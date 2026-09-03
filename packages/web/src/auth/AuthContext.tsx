import { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";
import type { ReactNode } from "react";
import { api, type Account, type LoginResult } from "../api/client.js";

type AuthState =
  | { readonly status: "loading" }
  | { readonly status: "anonymous" }
  | { readonly status: "authenticated"; readonly account: Pick<Account, "account_id" | "display_name" | "role"> }
  /**
   * An administrator whose session has not yet completed `POST
   * /sessions/mfa` (docs/15 §8.1, ADR-0017) — entered only right after
   * `login()` returns `mfa_required: true`. A page reload can't be
   * restored into this state (`GET /accounts/me` carries no such field
   * by design); a reloaded pending session instead lands as
   * `"authenticated"` and is redirected to `/mfa` reactively, the first
   * time an `/admin/*` call returns `401 MFA_REQUIRED` (`Administration.tsx`).
   */
  | { readonly status: "mfa_pending"; readonly account: Pick<Account, "account_id" | "display_name" | "role"> };

interface AuthContextValue {
  readonly state: AuthState;
  readonly login: (email: string, password: string) => Promise<LoginResult>;
  /** S-09's step-up screen — verifies the code and, on success, moves `"mfa_pending"` to `"authenticated"`. */
  readonly verifyMfa: (code: string) => Promise<void>;
  readonly logout: () => Promise<void>;
  /** Re-fetches the account and updates `state` — used after S-07 changes `display_name`. */
  readonly refresh: () => Promise<void>;
}

const AuthContext = createContext<AuthContextValue | null>(null);

export function AuthProvider({ children }: { readonly children: ReactNode }) {
  const [state, setState] = useState<AuthState>({ status: "loading" });

  useEffect(() => {
    let cancelled = false;
    api
      .me()
      .then((account) => {
        if (!cancelled) setState({ status: "authenticated", account });
      })
      .catch(() => {
        // A fresh visitor gets 401 NOT_AUTHENTICATED here — that is the
        // expected anonymous case, not a failure to surface. A network or
        // server error falls back to the same state: nothing on this
        // screen depends on distinguishing the two.
        if (!cancelled) setState({ status: "anonymous" });
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const login = useCallback(async (email: string, password: string) => {
    const result = await api.login(email, password);
    const account = { account_id: result.account_id, display_name: result.display_name, role: result.role };
    setState({ status: result.mfa_required === true ? "mfa_pending" : "authenticated", account });
    return result;
  }, []);

  const verifyMfa = useCallback(async (code: string) => {
    await api.verifyMfa(code);
    setState((prev) => (prev.status === "mfa_pending" ? { status: "authenticated", account: prev.account } : prev));
  }, []);

  const logout = useCallback(async () => {
    await api.logout();
    setState({ status: "anonymous" });
  }, []);

  const refresh = useCallback(async () => {
    const account = await api.me();
    setState({ status: "authenticated", account });
  }, []);

  const value = useMemo(
    () => ({ state, login, verifyMfa, logout, refresh }),
    [state, login, verifyMfa, logout, refresh],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthContextValue {
  const context = useContext(AuthContext);
  if (context === null) {
    throw new Error("useAuth must be used within an AuthProvider");
  }
  return context;
}
