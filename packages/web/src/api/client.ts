// REST client core, plus the accounts/sessions surface
// (docs/33_API/REST_Endpoint_Catalog.md §3). Every request carries the
// session cookie automatically (`credentials: "include"`); every non-safe
// method attaches the CSRF header read from the non-HttpOnly `__Host-csrf`
// cookie (docs/15_Security_Architecture.md §4.2). The five table endpoints
// (`18 §4.2`) are `tables.ts`, which reuses `request`/`ApiError` from here
// rather than a second HTTP implementation.

const CSRF_COOKIE = "__Host-csrf";
const CSRF_HEADER = "X-CSRF-Token";
const SAFE_METHODS = new Set(["GET", "HEAD", "OPTIONS"]);

export class ApiError extends Error {
  readonly status: number;
  readonly code: string;
  readonly retryAfterSeconds: number | null;
  readonly body: unknown;

  constructor(status: number, code: string, message: string, retryAfterSeconds: number | null, body: unknown) {
    super(message);
    this.name = "ApiError";
    this.status = status;
    this.code = code;
    this.retryAfterSeconds = retryAfterSeconds;
    this.body = body;
  }
}

function readCookie(name: string): string | null {
  const prefix = `${name}=`;
  for (const part of document.cookie.split(";")) {
    const trimmed = part.trim();
    if (trimmed.startsWith(prefix)) {
      return decodeURIComponent(trimmed.slice(prefix.length));
    }
  }
  return null;
}

interface RequestOptions {
  readonly method?: string;
  readonly body?: unknown;
  readonly headers?: Readonly<Record<string, string>>;
}

export async function request<T>(path: string, options: RequestOptions = {}): Promise<T> {
  const method = options.method ?? "GET";
  const headers: Record<string, string> = { ...options.headers };
  if (options.body !== undefined) {
    headers["Content-Type"] = "application/json";
  }
  if (!SAFE_METHODS.has(method)) {
    const csrf = readCookie(CSRF_COOKIE);
    if (csrf !== null) {
      headers[CSRF_HEADER] = csrf;
    }
  }

  const response = await fetch(`/api/v1${path}`, {
    method,
    headers,
    credentials: "include",
    body: options.body === undefined ? null : JSON.stringify(options.body),
  });

  if (response.status === 204) {
    return undefined as T;
  }

  const contentType = response.headers.get("content-type") ?? "";
  const payload: unknown = contentType.includes("application/json") ? await response.json() : undefined;

  if (!response.ok) {
    const retryAfterHeader = response.headers.get("Retry-After");
    const errorPayload =
      payload !== null && typeof payload === "object" && "error" in payload
        ? (payload as { error: { code?: unknown; message?: unknown } }).error
        : undefined;
    const code = typeof errorPayload?.code === "string" ? errorPayload.code : "UNKNOWN";
    const message = typeof errorPayload?.message === "string" ? errorPayload.message : "Something went wrong.";
    throw new ApiError(
      response.status,
      code,
      message,
      retryAfterHeader === null ? null : Number(retryAfterHeader),
      payload,
    );
  }

  return payload as T;
}

export interface Account {
  readonly account_id: string;
  readonly email: string;
  readonly display_name: string;
  readonly role: "player" | "administrator";
  readonly created_at: string;
}

export interface LoginResult {
  readonly account_id: string;
  readonly display_name: string;
  readonly role: "player" | "administrator";
  /** Present, and `true`, only for an administrator whose session hasn't completed `POST /sessions/mfa` yet (docs/15 §8.1, ADR-0017). */
  readonly mfa_required?: boolean;
}

export interface LockedError {
  readonly locked_until: string;
}

export function isLockedError(error: unknown): error is ApiError & LockedError {
  return error instanceof ApiError && error.code === "ACCOUNT_LOCKED";
}

/** `POST /sessions/mfa`'s own durable lockout (docs/15 §8.1) — same shape as `isLockedError`, a distinct code. */
export function isMfaLockedError(error: unknown): error is ApiError & LockedError {
  return error instanceof ApiError && error.code === "MFA_LOCKED";
}

export function lockedUntil(error: ApiError): string | null {
  const body = error.body;
  if (body !== null && typeof body === "object" && "locked_until" in body) {
    const value = (body as { locked_until: unknown }).locked_until;
    return typeof value === "string" ? value : null;
  }
  return null;
}

export interface SessionSummary {
  readonly id: string;
  readonly issued_at: string;
  readonly last_seen_at: string;
  readonly ip: string;
  readonly user_agent: string | null;
  readonly current: boolean;
}

export const api = {
  register(email: string, password: string, displayName: string): Promise<{ account_id: string }> {
    return request("/accounts", { method: "POST", body: { email, password, display_name: displayName } });
  },
  login(email: string, password: string): Promise<LoginResult> {
    return request("/sessions", { method: "POST", body: { email, password } });
  },
  /** S-09's step-up screen (docs/15 §8.1, ADR-0017) — verifies a TOTP code against the current session. */
  verifyMfa(code: string): Promise<void> {
    return request("/sessions/mfa", { method: "POST", body: { code } });
  },
  logout(): Promise<void> {
    return request("/sessions/current", { method: "DELETE" });
  },
  me(): Promise<Account> {
    return request("/accounts/me");
  },
  // S-07 Account (docs/32_UX/Screen_Inventory.md §3; docs/18_API_Design.md §4.1).
  updateDisplayName(displayName: string): Promise<{ display_name: string }> {
    return request("/accounts/me", { method: "PATCH", body: { display_name: displayName } });
  },
  /** Success revokes every other session for the account; this one survives (docs/33_API `POST /accounts/me/password`). */
  changePassword(currentPassword: string, newPassword: string): Promise<void> {
    return request("/accounts/me/password", { method: "POST", body: { current_password: currentPassword, new_password: newPassword } });
  },
  listSessions(): Promise<{ sessions: readonly SessionSummary[] }> {
    return request("/accounts/me/sessions");
  },
  revokeSession(id: string): Promise<void> {
    return request(`/accounts/me/sessions/${encodeURIComponent(id)}`, { method: "DELETE" });
  },
};
