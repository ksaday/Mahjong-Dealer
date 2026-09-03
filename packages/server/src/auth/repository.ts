// Data-access interfaces for accounts and sessions (docs/17_Database_Design.md
// §5.1, §5.2). `AuthService` (service.ts) depends only on these, so the
// business logic is testable with an in-memory implementation
// (memory-repository.ts) without a live database — the same discipline
// dealer-core's injected entropy and the table actor's TableHarness
// already follow. `postgres-repository.ts` is the real implementation,
// written against `db`'s schema but not exercised against a live database
// in this environment (see that file's module comment).
import type { AccountRole, AccountRow, AccountStatus, SessionRow } from "@mahjong-dealer/db";

export interface NewAccount {
  readonly id: string;
  readonly email: string;
  readonly passwordHash: string;
  readonly displayName: string;
  /**
   * Defaults to `player`. `AuthService.register()` — the only path a
   * self-service request reaches — never sets this; an administrator
   * account is provisioned out of band (docs/15 §8: "never by
   * self-registration"), which in practice means calling this method
   * directly (an ops script, or a test's seed) rather than through
   * `POST /accounts`.
   */
  readonly role?: AccountRole;
}

export interface AccountListQuery {
  readonly limit: number;
  readonly offset: number;
  /** Matches against email or display name, case-insensitively. */
  readonly query?: string;
  readonly status?: AccountStatus;
}

export interface AccountListPage {
  readonly accounts: readonly AccountRow[];
  readonly total: number;
}

export interface AccountRepository {
  create(account: NewAccount): Promise<AccountRow>;
  findByEmail(email: string): Promise<AccountRow | null>;
  findById(id: string): Promise<AccountRow | null>;
  updateDisplayName(id: string, displayName: string): Promise<void>;
  updatePasswordHash(id: string, passwordHash: string): Promise<void>;
  /** Durable lockout state (docs/15 §4.1, D-15-03) — never only in memory. */
  setLoginFailure(id: string, failedLogins: number, lockedUntil: Date | null): Promise<void>;
  /** Durable rate-limit state for `POST /accounts/me/password` (docs/15 §7.1, docs/18 §6) — same reasoning as `setLoginFailure`. */
  setPasswordChangeAttempt(id: string, count: number, windowStartedAt: Date): Promise<void>;
  setStatus(id: string, status: AccountStatus): Promise<void>;
  /** `GET /admin/accounts` (docs/18 §4.3, `FR-160`) — metadata only, which is everything `AccountRow` already is. */
  list(query: AccountListQuery): Promise<AccountListPage>;
}

export interface NewSession {
  readonly id: string;
  readonly accountId: string;
  readonly tokenHash: Buffer;
  readonly csrfSecret: string;
  /**
   * Supplied by the caller rather than defaulted inside the repository, so
   * a test's injected clock actually governs `issued_at`/`last_seen_at` —
   * a repository calling `new Date()` internally would silently ignore
   * `AuthService`'s own injected `now` and defeat idle-timeout tests.
   */
  readonly issuedAt: Date;
  readonly absoluteExpiresAt: Date;
  readonly ip: string | null;
  readonly userAgent: string | null;
}

export interface SessionRepository {
  create(session: NewSession): Promise<SessionRow>;
  findByTokenHash(tokenHash: Buffer): Promise<SessionRow | null>;
  findById(id: string): Promise<SessionRow | null>;
  touch(id: string, lastSeenAt: Date): Promise<void>;
  revoke(id: string, revokedAt: Date): Promise<void>;
  /** Every active session for an account, optionally excluding one (docs/33_API `POST /accounts/me/password`: "the initiating session survives"). */
  revokeAllForAccount(accountId: string, revokedAt: Date, exceptSessionId?: string): Promise<void>;
  listActiveForAccount(accountId: string): Promise<readonly SessionRow[]>;
}

export type { AccountRole, AccountRow, AccountStatus, SessionRow };
