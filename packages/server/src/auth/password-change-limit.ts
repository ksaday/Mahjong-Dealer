// Durable per-account rate limit for `POST /accounts/me/password`
// (docs/15_Security_Architecture.md §7.1, docs/18_API_Design.md §6:
// "3/hour, PostgreSQL"). State lives in `accounts.password_change_count`/
// `password_change_window_started_at` (docs/17 §5.1), the same reasoning
// as the login lockout columns next to them (D-15-03): an in-memory limit
// vanishes on restart, which an attacker can simply wait out.
//
// A flat fixed window, not `lockout.ts`'s progressive curve — the
// endpoint's own limit (`18 §6`) is flat, so escalating it would invent a
// policy neither doc specifies (`docs/17 §9 D-17-14`).
const LIMIT = 3;
const WINDOW_MS = 60 * 60 * 1000;

export interface PasswordChangeWindow {
  readonly count: number;
  readonly windowStartedAt: Date | null;
}

export type PasswordChangeCheck =
  | { readonly allowed: true; readonly next: { readonly count: number; readonly windowStartedAt: Date } }
  | { readonly allowed: false; readonly retryAfter: Date };

/** Pure: does not read or write `accounts` — the caller persists `next` via `AccountRepository.setPasswordChangeAttempt`. */
export function checkPasswordChangeWindow(state: PasswordChangeWindow, now: Date): PasswordChangeCheck {
  const { windowStartedAt } = state;
  if (windowStartedAt === null || now.getTime() - windowStartedAt.getTime() >= WINDOW_MS) {
    return { allowed: true, next: { count: 1, windowStartedAt: now } };
  }
  if (state.count >= LIMIT) {
    return { allowed: false, retryAfter: new Date(windowStartedAt.getTime() + WINDOW_MS) };
  }
  return { allowed: true, next: { count: state.count + 1, windowStartedAt } };
}
