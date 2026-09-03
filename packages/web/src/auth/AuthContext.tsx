import { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";
import type { ReactNode } from "react";
import { api, type Account, type LoginResult } from "../api/client.js";

type AuthState =
  | { readonly status: "loading" }
  | { readonly status: "anonymous" }
  | { readonly status: "authenticated"; readonly account: Pick<Account, "account_id" | "display_name" | "role"> };

interface AuthContextValue {
  readonly state: AuthState;
  readonly login: (email: string, password: string) => Promise<LoginResult>;
  readonly logout: () => Promise<void>;
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
    setState({
      status: "authenticated",
      account: { account_id: result.account_id, display_name: result.display_name, role: result.role },
    });
    return result;
  }, []);

  const logout = useCallback(async () => {
    await api.logout();
    setState({ status: "anonymous" });
  }, []);

  const value = useMemo(() => ({ state, login, logout }), [state, login, logout]);

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthContextValue {
  const context = useContext(AuthContext);
  if (context === null) {
    throw new Error("useAuth must be used within an AuthProvider");
  }
  return context;
}
