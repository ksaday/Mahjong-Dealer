// AuthService: the business logic behind docs/33_API/REST_Endpoint_Catalog.md
// §3 (accounts and sessions), independent of HTTP (http.ts is the thin
// Fastify wrapper). Depends only on the repository interfaces, so it is
// fully testable with the in-memory implementations.
import type { AccountRow, AccountRole, SessionRow } from "@mahjong-dealer/db";
import { uuidv7 } from "@mahjong-dealer/db";
import type { AuditLogRepository } from "../audit/repository.js";
import type { BreachChecker } from "./breach-checker.js";
import { computeLockoutMinutes, isLockedOut } from "./lockout.js";
import { checkPasswordChangeWindow } from "./password-change-limit.js";
import { checkPasswordPolicy, hashPassword, verifyPassword } from "./passwords.js";
import type { AccountRepository, SessionRepository } from "./repository.js";
import { generateCsrfSecret, generateSessionToken, hashToken } from "./tokens.js";

const PLAYER_SESSION_ABSOLUTE_DAYS = 30;
const PLAYER_SESSION_IDLE_DAYS = 7;
const ADMIN_SESSION_ABSOLUTE_HOURS = 8;
const ADMIN_SESSION_IDLE_MINUTES = 30;

export interface RequestContext {
  readonly ip: string | null;
  readonly userAgent: string | null;
}

export interface AuthServiceOptions {
  readonly accounts: AccountRepository;
  readonly sessions: SessionRepository;
  readonly breachChecker: BreachChecker;
  /**
   * Optional: when supplied, login outcomes are recorded (`GET
   * /admin/audit`'s "authentication ... events", docs/18 §4.3). `logout`
   * deliberately isn't audited here — a scope choice, not an oversight:
   * login attempts are the security-relevant signal (repeated failures,
   * lockouts), and adding a session lookup to every `logout()` call for a
   * routine, self-initiated action wasn't judged worth it alongside the
   * rest of `FR-160`–`166`'s scope. Revisit if audit review ever needs it.
   */
  readonly auditLog?: AuditLogRepository;
  readonly now?: () => Date;
  readonly env?: NodeJS.ProcessEnv;
}

export type RegisterResult =
  | { readonly ok: true; readonly accountId: string }
  | { readonly ok: false; readonly code: "PASSWORD_TOO_SHORT" | "PASSWORD_BREACHED" };

export interface IssuedSession {
  readonly session: SessionRow;
  readonly token: string;
}

export type LoginResult =
  | { readonly ok: true; readonly account: AccountRow; readonly issued: IssuedSession }
  | { readonly ok: false; readonly code: "INVALID_CREDENTIALS" }
  | { readonly ok: false; readonly code: "ACCOUNT_LOCKED"; readonly lockedUntil: Date }
  | { readonly ok: false; readonly code: "ACCOUNT_DISABLED" };

export type ChangePasswordResult =
  | { readonly ok: true }
  | { readonly ok: false; readonly code: "INVALID_CREDENTIALS" | "PASSWORD_TOO_SHORT" | "PASSWORD_BREACHED" }
  | { readonly ok: false; readonly code: "RATE_LIMITED"; readonly retryAfter: Date };

export interface AuthenticatedSession {
  readonly account: AccountRow;
  readonly session: SessionRow;
}

export class AuthService {
  private readonly accounts: AccountRepository;
  private readonly sessions: SessionRepository;
  private readonly breachChecker: BreachChecker;
  private readonly auditLog: AuditLogRepository | undefined;
  private readonly now: () => Date;
  private readonly env: NodeJS.ProcessEnv | undefined;

  constructor(options: AuthServiceOptions) {
    this.accounts = options.accounts;
    this.sessions = options.sessions;
    this.breachChecker = options.breachChecker;
    this.auditLog = options.auditLog;
    this.now = options.now ?? (() => new Date());
    this.env = options.env;
  }

  private async audit(action: string, actorAccountId: string | null, ip: string | null): Promise<void> {
    await this.auditLog?.record({
      id: uuidv7(),
      actorAccountId,
      action,
      targetType: null,
      targetId: null,
      reason: null,
      ip,
      occurredAt: this.now(),
    });
  }

  /**
   * `docs/18 §4.1`'s D-18-04: a duplicate email still returns success with
   * no account created — the caller is responsible for the "notify the
   * existing address" half, which is out-of-band email delivery this
   * service does not perform. Distinguishing the two cases here, even
   * internally, is deliberately avoided so nothing downstream can leak it.
   */
  async register(email: string, password: string, displayName: string): Promise<RegisterResult> {
    const violation = await checkPasswordPolicy(password, this.breachChecker);
    if (violation === "TOO_SHORT") return { ok: false, code: "PASSWORD_TOO_SHORT" };
    if (violation === "BREACHED") return { ok: false, code: "PASSWORD_BREACHED" };

    const existing = await this.accounts.findByEmail(email);
    if (existing !== null) {
      // D-18-04: report success, create nothing. The account ID returned
      // in this branch names no real account and must never be dereferenced.
      return { ok: true, accountId: existing.id };
    }

    const passwordHash = await hashPassword(password, this.env);
    const account = await this.accounts.create({ id: uuidv7(), email, passwordHash, displayName });
    return { ok: true, accountId: account.id };
  }

  /**
   * Identical response and equivalent work for a wrong password and an
   * unknown account (docs/15 §4.1, D-15-05) — this function always hashes
   * something, even when no account exists, so timing does not
   * distinguish the two cases.
   */
  async login(email: string, password: string, context: RequestContext): Promise<LoginResult> {
    const account = await this.accounts.findByEmail(email);
    const now = this.now();

    if (account === null) {
      // Equivalent work, with no real account to charge it to (D-15-05):
      // a genuine Argon2id verification against a real hash, not a
      // fixed delay, so the timing profile matches the real path exactly.
      await verifyPassword(await getTimingEqualizerHash(this.env), password, this.env);
      await this.audit("login_failed", null, context.ip);
      return { ok: false, code: "INVALID_CREDENTIALS" };
    }

    const lockedUntil = account.locked_until;
    if (lockedUntil !== null && isLockedOut(lockedUntil, now)) {
      await this.audit("login_blocked_locked", account.id, context.ip);
      return { ok: false, code: "ACCOUNT_LOCKED", lockedUntil };
    }
    if (account.status === "disabled") {
      await this.audit("login_blocked_disabled", account.id, context.ip);
      return { ok: false, code: "ACCOUNT_DISABLED" };
    }

    const valid = await verifyPassword(account.password_hash, password, this.env);
    if (!valid) {
      const failedLogins = account.failed_logins + 1;
      const lockoutMinutes = computeLockoutMinutes(failedLogins);
      const lockedUntil = lockoutMinutes === null ? null : new Date(now.getTime() + lockoutMinutes * 60_000);
      await this.accounts.setLoginFailure(account.id, failedLogins, lockedUntil);
      await this.audit("login_failed", account.id, context.ip);
      return { ok: false, code: "INVALID_CREDENTIALS" };
    }

    await this.accounts.setLoginFailure(account.id, 0, null);
    const issued = await this.issueSession(account, context);
    await this.audit("login_succeeded", account.id, context.ip);
    return { ok: true, account, issued };
  }

  private async issueSession(account: AccountRow, context: RequestContext): Promise<IssuedSession> {
    const now = this.now();
    const token = generateSessionToken();
    const absoluteExpiresAt =
      account.role === "administrator"
        ? new Date(now.getTime() + ADMIN_SESSION_ABSOLUTE_HOURS * 3_600_000)
        : new Date(now.getTime() + PLAYER_SESSION_ABSOLUTE_DAYS * 86_400_000);

    const session = await this.sessions.create({
      id: uuidv7(),
      accountId: account.id,
      tokenHash: hashToken(token),
      csrfSecret: generateCsrfSecret(),
      issuedAt: now,
      absoluteExpiresAt,
      ip: context.ip,
      userAgent: context.userAgent,
    });
    return { session, token };
  }

  /** Resolves a raw session token to its account, enforcing absolute and idle expiry (docs/15 §4.2) plus revocation. */
  async validateSession(token: string): Promise<AuthenticatedSession | null> {
    const session = await this.sessions.findByTokenHash(hashToken(token));
    if (session === null || session.revoked_at !== null) return null;

    const now = this.now();
    if (session.absolute_expires_at.getTime() <= now.getTime()) return null;

    const account = await this.accounts.findById(session.account_id);
    if (account === null || account.status === "disabled") return null;

    const idleLimitMs =
      (account.role === "administrator" ? ADMIN_SESSION_IDLE_MINUTES * 60 : PLAYER_SESSION_IDLE_DAYS * 86_400) * 1000;
    if (now.getTime() - session.last_seen_at.getTime() > idleLimitMs) return null;

    await this.sessions.touch(session.id, now);
    return { account, session };
  }

  /** Effective within 5 seconds including live sockets, per `TableGateway.checkSessionRevocation` (docs/15 §4.2, NFR-026), which polls `isSessionActive` below. */
  async logout(sessionId: string): Promise<void> {
    await this.sessions.revoke(sessionId, this.now());
  }

  /**
   * The check `TableGateway.checkSessionRevocation` (docs/12 §4.3) polls
   * on a live socket's `sessionId`. Deliberately lighter than
   * `validateSession`: it neither takes nor needs a raw token (the
   * `sessionId` came from server-side connect-ticket claims minted after
   * the token was already verified once, at REST time — docs/12 §4.1),
   * and it never calls `touch()`. Touching here would mean a live socket
   * silently resets its own idle timer just by existing, which is not a
   * behavior docs/15 §4.2 specifies either way; this method enforces only
   * the two invariants docs/12 §4.3 unambiguously requires — revocation
   * and the account still being real and enabled — and leaves idle expiry
   * to REST activity, as it already is.
   */
  async isSessionActive(sessionId: string): Promise<boolean> {
    const session = await this.sessions.findById(sessionId);
    if (session === null || session.revoked_at !== null) return false;
    if (session.absolute_expires_at.getTime() <= this.now().getTime()) return false;

    const account = await this.accounts.findById(session.account_id);
    return account !== null && account.status !== "disabled";
  }

  async updateDisplayName(accountId: string, displayName: string): Promise<void> {
    await this.accounts.updateDisplayName(accountId, displayName);
  }

  /**
   * Revokes every other session for the account; the initiating session
   * survives (docs/33_API `POST /accounts/me/password`).
   *
   * The durable 3/hour rate limit (docs/15 §7.1, docs/18 §6) is checked
   * and consumed here, before verifying `currentPassword` — every call
   * that reaches this point counts against the window regardless of
   * outcome, the same attempt-based accounting `tables/http.ts` uses for
   * `POST /tables`, not `lockout.ts`'s failure-only counting: this
   * endpoint's own limit is flat, not progressive.
   */
  async changePassword(
    accountId: string,
    currentPassword: string,
    newPassword: string,
    currentSessionId: string,
  ): Promise<ChangePasswordResult> {
    const account = await this.accounts.findById(accountId);
    if (account === null) return { ok: false, code: "INVALID_CREDENTIALS" };

    const check = checkPasswordChangeWindow(
      { count: account.password_change_count, windowStartedAt: account.password_change_window_started_at },
      this.now(),
    );
    if (!check.allowed) return { ok: false, code: "RATE_LIMITED", retryAfter: check.retryAfter };
    await this.accounts.setPasswordChangeAttempt(accountId, check.next.count, check.next.windowStartedAt);

    const valid = await verifyPassword(account.password_hash, currentPassword, this.env);
    if (!valid) return { ok: false, code: "INVALID_CREDENTIALS" };

    const violation = await checkPasswordPolicy(newPassword, this.breachChecker);
    if (violation === "TOO_SHORT") return { ok: false, code: "PASSWORD_TOO_SHORT" };
    if (violation === "BREACHED") return { ok: false, code: "PASSWORD_BREACHED" };

    const passwordHash = await hashPassword(newPassword, this.env);
    await this.accounts.updatePasswordHash(accountId, passwordHash);
    await this.sessions.revokeAllForAccount(accountId, this.now(), currentSessionId);
    return { ok: true };
  }

  async listSessions(accountId: string): Promise<readonly SessionRow[]> {
    return this.sessions.listActiveForAccount(accountId);
  }

  /** `null` return means "not found or not this account's session" — both surface as 404 (docs/33_API). */
  async revokeOwnSession(accountId: string, sessionId: string): Promise<boolean> {
    const session = await this.sessions.findById(sessionId);
    if (session === null || session.account_id !== accountId) return false;
    await this.sessions.revoke(sessionId, this.now());
    return true;
  }
}

/**
 * A real Argon2id hash with no corresponding account, computed once (not
 * hand-written — a fabricated-looking hash string would parse differently
 * from a real one and defeat the timing equalization it exists for) and
 * memoized, so `verifyPassword` has genuine equivalent work to charge to
 * when no account exists (D-15-05).
 */
let timingEqualizerHash: Promise<string> | undefined;
function getTimingEqualizerHash(env: NodeJS.ProcessEnv | undefined): Promise<string> {
  timingEqualizerHash ??= hashPassword("no-account-has-this-password-000000", env);
  return timingEqualizerHash;
}

export type { AccountRole };
