import { describe, expect, it } from "vitest";
import { InMemoryAuditLogRepository } from "../audit/memory-repository.js";
import { NullBreachChecker } from "./breach-checker.js";
import { InMemoryAccountRepository, InMemorySessionRepository } from "./memory-repository.js";
import { AuthService } from "./service.js";
import { encryptTotpSecret } from "./totp-encryption.js";
import { getTotpEncryptionKey } from "./totp-key.js";
import { computeTotpCode, generateTotpSecret, totpStep } from "./totp.js";

const ENV = { PASSWORD_PEPPER: "test-pepper" };
const CONTEXT = { ip: "127.0.0.1", userAgent: "test-agent" };

function setUp(now?: () => Date) {
  const accounts = new InMemoryAccountRepository();
  const sessions = new InMemorySessionRepository();
  const service = new AuthService({
    accounts,
    sessions,
    breachChecker: new NullBreachChecker(),
    env: ENV,
    ...(now !== undefined ? { now } : {}),
  });
  return { accounts, sessions, service };
}

describe("register (docs/33_API POST /accounts)", () => {
  it("creates an account and returns its id", async () => {
    const { service, accounts } = setUp();
    const result = await service.register("alice@example.com", "correct horse battery", "Alice");
    expect(result.ok).toBe(true);
    if (result.ok) {
      const account = await accounts.findById(result.accountId);
      expect(account?.email).toBe("alice@example.com");
      expect(account?.password_hash).not.toContain("correct horse battery");
    }
  });

  it("rejects a password shorter than 12 characters", async () => {
    const { service } = setUp();
    const result = await service.register("bob@example.com", "short", "Bob");
    expect(result).toEqual({ ok: false, code: "PASSWORD_TOO_SHORT" });
  });

  it("returns ok for a duplicate email without creating a second account (D-18-04)", async () => {
    const { service, accounts } = setUp();
    await service.register("carol@example.com", "correct horse battery", "Carol");
    const before = await accounts.findByEmail("carol@example.com");

    const result = await service.register("carol@example.com", "a different password entirely", "Someone Else");
    expect(result.ok).toBe(true);

    const after = await accounts.findByEmail("carol@example.com");
    expect(after?.display_name).toBe(before?.display_name); // unchanged — no account was actually created/altered
  });
});

describe("login (docs/33_API POST /sessions)", () => {
  it("succeeds with correct credentials and issues a session", async () => {
    const { service } = setUp();
    await service.register("dana@example.com", "correct horse battery", "Dana");
    const result = await service.login("dana@example.com", "correct horse battery", CONTEXT);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.issued.token).toBeTruthy();
      expect(result.issued.session.account_id).toBe(result.account.id);
    }
  });

  it("rejects a wrong password identically to an unknown account (D-15-05)", async () => {
    const { service } = setUp();
    await service.register("erin@example.com", "correct horse battery", "Erin");
    const wrongPassword = await service.login("erin@example.com", "totally wrong password", CONTEXT);
    const unknownAccount = await service.login("nobody@example.com", "totally wrong password", CONTEXT);
    expect(wrongPassword).toEqual({ ok: false, code: "INVALID_CREDENTIALS" });
    expect(unknownAccount).toEqual({ ok: false, code: "INVALID_CREDENTIALS" });
  });

  it("locks the account after repeated failures and rejects further attempts with ACCOUNT_LOCKED", async () => {
    const { service } = setUp();
    await service.register("frank@example.com", "correct horse battery", "Frank");
    for (let i = 0; i < 5; i += 1) {
      await service.login("frank@example.com", "wrong password", CONTEXT);
    }
    const result = await service.login("frank@example.com", "correct horse battery", CONTEXT);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.code).toBe("ACCOUNT_LOCKED");
  });

  it("resets the failure count on a successful login", async () => {
    const { service, accounts } = setUp();
    const registered = await service.register("grace@example.com", "correct horse battery", "Grace");
    if (!registered.ok) throw new Error("unreachable");
    await service.login("grace@example.com", "wrong password", CONTEXT);
    await service.login("grace@example.com", "wrong password", CONTEXT);
    await service.login("grace@example.com", "correct horse battery", CONTEXT);
    const account = await accounts.findById(registered.accountId);
    expect(account?.failed_logins).toBe(0);
  });

  it("rejects login for a disabled account", async () => {
    const { service, accounts } = setUp();
    const registered = await service.register("heidi@example.com", "correct horse battery", "Heidi");
    if (!registered.ok) throw new Error("unreachable");
    await accounts.setStatus(registered.accountId, "disabled");
    const result = await service.login("heidi@example.com", "correct horse battery", CONTEXT);
    expect(result).toEqual({ ok: false, code: "ACCOUNT_DISABLED" });
  });
});

describe("validateSession (docs/15 §4.2 — absolute and idle expiry, revocation)", () => {
  it("resolves a freshly issued session", async () => {
    const { service } = setUp();
    await service.register("ivan@example.com", "correct horse battery", "Ivan");
    const login = await service.login("ivan@example.com", "correct horse battery", CONTEXT);
    if (!login.ok) throw new Error("unreachable");
    const resolved = await service.validateSession(login.issued.token);
    expect(resolved?.account.email).toBe("ivan@example.com");
  });

  it("rejects a revoked session", async () => {
    const { service } = setUp();
    await service.register("judy@example.com", "correct horse battery", "Judy");
    const login = await service.login("judy@example.com", "correct horse battery", CONTEXT);
    if (!login.ok) throw new Error("unreachable");
    await service.logout(login.issued.session.id);
    expect(await service.validateSession(login.issued.token)).toBeNull();
  });

  it("rejects a session past its absolute expiry", async () => {
    let now = new Date("2026-01-01T00:00:00Z");
    const { service } = setUp(() => now);
    await service.register("kevin@example.com", "correct horse battery", "Kevin");
    const login = await service.login("kevin@example.com", "correct horse battery", CONTEXT);
    if (!login.ok) throw new Error("unreachable");

    now = new Date("2026-02-15T00:00:00Z"); // 45 days later, past the 30-day player absolute lifetime
    expect(await service.validateSession(login.issued.token)).toBeNull();
  });

  it("rejects an idle session even within its absolute lifetime", async () => {
    let now = new Date("2026-01-01T00:00:00Z");
    const { service } = setUp(() => now);
    await service.register("laura@example.com", "correct horse battery", "Laura");
    const login = await service.login("laura@example.com", "correct horse battery", CONTEXT);
    if (!login.ok) throw new Error("unreachable");

    now = new Date("2026-01-10T00:00:00Z"); // 9 days idle, past the 7-day player idle limit
    expect(await service.validateSession(login.issued.token)).toBeNull();
  });

  it("rejects an unknown token", async () => {
    const { service } = setUp();
    expect(await service.validateSession("not-a-real-token")).toBeNull();
  });
});

describe("isSessionActive (docs/12 §4.3 — TableGateway.checkSessionRevocation's own check)", () => {
  it("is true for a freshly issued session, by id rather than token", async () => {
    const { service } = setUp();
    await service.register("oscar@example.com", "correct horse battery", "Oscar");
    const login = await service.login("oscar@example.com", "correct horse battery", CONTEXT);
    if (!login.ok) throw new Error("unreachable");
    expect(await service.isSessionActive(login.issued.session.id)).toBe(true);
  });

  it("is false once the session is revoked (logout)", async () => {
    const { service } = setUp();
    await service.register("peggy@example.com", "correct horse battery", "Peggy");
    const login = await service.login("peggy@example.com", "correct horse battery", CONTEXT);
    if (!login.ok) throw new Error("unreachable");
    await service.logout(login.issued.session.id);
    expect(await service.isSessionActive(login.issued.session.id)).toBe(false);
  });

  it("is false past absolute expiry", async () => {
    let now = new Date("2026-01-01T00:00:00Z");
    const { service } = setUp(() => now);
    await service.register("quentin@example.com", "correct horse battery", "Quentin");
    const login = await service.login("quentin@example.com", "correct horse battery", CONTEXT);
    if (!login.ok) throw new Error("unreachable");

    now = new Date("2026-02-15T00:00:00Z"); // past the 30-day player absolute lifetime
    expect(await service.isSessionActive(login.issued.session.id)).toBe(false);
  });

  it("does not extend idle expiry the way validateSession's touch() does", async () => {
    let now = new Date("2026-01-01T00:00:00Z");
    const { service } = setUp(() => now);
    await service.register("rupert@example.com", "correct horse battery", "Rupert");
    const login = await service.login("rupert@example.com", "correct horse battery", CONTEXT);
    if (!login.ok) throw new Error("unreachable");

    now = new Date("2026-01-05T00:00:00Z"); // within idle limit; isSessionActive must not touch()
    expect(await service.isSessionActive(login.issued.session.id)).toBe(true);

    now = new Date("2026-01-10T00:00:00Z"); // 9 days after issuance, past the 7-day idle limit
    expect(await service.isSessionActive(login.issued.session.id)).toBe(true); // this check itself ignores idle expiry
    expect(await service.validateSession(login.issued.token)).toBeNull(); // but validateSession still enforces it
  });

  it("is false for an unknown session id", async () => {
    const { service } = setUp();
    expect(await service.isSessionActive("not-a-real-session-id")).toBe(false);
  });
});

describe("changePassword (docs/33_API POST /accounts/me/password)", () => {
  it("rejects the wrong current password", async () => {
    const { service } = setUp();
    const registered = await service.register("mallory@example.com", "correct horse battery", "Mallory");
    if (!registered.ok) throw new Error("unreachable");
    const login = await service.login("mallory@example.com", "correct horse battery", CONTEXT);
    if (!login.ok) throw new Error("unreachable");

    const result = await service.changePassword(
      registered.accountId,
      "wrong current password",
      "a brand new password",
      login.issued.session.id,
    );
    expect(result).toEqual({ ok: false, code: "INVALID_CREDENTIALS" });
  });

  it("succeeds and revokes every other session but not the initiating one", async () => {
    const { service } = setUp();
    const registered = await service.register("nathan@example.com", "correct horse battery", "Nathan");
    if (!registered.ok) throw new Error("unreachable");
    const sessionA = await service.login("nathan@example.com", "correct horse battery", CONTEXT);
    const sessionB = await service.login("nathan@example.com", "correct horse battery", CONTEXT);
    if (!sessionA.ok || !sessionB.ok) throw new Error("unreachable");

    const result = await service.changePassword(
      registered.accountId,
      "correct horse battery",
      "a brand new password here",
      sessionA.issued.session.id,
    );
    expect(result).toEqual({ ok: true });

    expect(await service.validateSession(sessionA.issued.token)).not.toBeNull();
    expect(await service.validateSession(sessionB.issued.token)).toBeNull();

    // The new password now works; the old one does not.
    const reLogin = await service.login("nathan@example.com", "a brand new password here", CONTEXT);
    expect(reLogin.ok).toBe(true);
  });

  it("rate-limits at 3/hour, durably (docs/15 §7.1, docs/18 §6), regardless of outcome", async () => {
    let now = new Date("2026-01-01T00:00:00Z");
    const { service } = setUp(() => now);
    const registered = await service.register("olivia@example.com", "correct horse battery", "Olivia");
    if (!registered.ok) throw new Error("unreachable");
    const login = await service.login("olivia@example.com", "correct horse battery", CONTEXT);
    if (!login.ok) throw new Error("unreachable");

    // First attempt wrong (still consumes the window), second and third succeed.
    now = new Date("2026-01-01T00:05:00Z");
    expect(
      await service.changePassword(registered.accountId, "wrong password", "a brand new password", login.issued.session.id),
    ).toEqual({ ok: false, code: "INVALID_CREDENTIALS" });

    now = new Date("2026-01-01T00:10:00Z");
    expect(
      await service.changePassword(registered.accountId, "correct horse battery", "a brand new password 2", login.issued.session.id),
    ).toEqual({ ok: true });

    now = new Date("2026-01-01T00:15:00Z");
    expect(
      await service.changePassword(registered.accountId, "a brand new password 2", "a brand new password 3", login.issued.session.id),
    ).toEqual({ ok: true });

    // Fourth attempt within the same hour is rejected before the password is even checked.
    now = new Date("2026-01-01T00:20:00Z");
    const fourth = await service.changePassword(
      registered.accountId,
      "wrong on purpose",
      "a brand new password 4",
      login.issued.session.id,
    );
    expect(fourth).toEqual({ ok: false, code: "RATE_LIMITED", retryAfter: new Date("2026-01-01T01:05:00Z") });

    // A new window opens once the first attempt's hour has fully elapsed.
    now = new Date("2026-01-01T01:05:01Z");
    expect(
      await service.changePassword(registered.accountId, "a brand new password 3", "a brand new password 5", login.issued.session.id),
    ).toEqual({ ok: true });
  });
});

describe("listSessions / revokeOwnSession", () => {
  it("lists only this account's active sessions and marks the current one", async () => {
    const { service } = setUp();
    const registered = await service.register("olivia@example.com", "correct horse battery", "Olivia");
    if (!registered.ok) throw new Error("unreachable");
    const login = await service.login("olivia@example.com", "correct horse battery", CONTEXT);
    if (!login.ok) throw new Error("unreachable");

    const sessions = await service.listSessions(registered.accountId);
    expect(sessions).toHaveLength(1);
    expect(sessions[0]!.id).toBe(login.issued.session.id);
  });

  it("refuses to revoke another account's session", async () => {
    const { service } = setUp();
    const a = await service.register("pat@example.com", "correct horse battery", "Pat");
    const b = await service.register("quinn@example.com", "correct horse battery", "Quinn");
    if (!a.ok || !b.ok) throw new Error("unreachable");
    const loginB = await service.login("quinn@example.com", "correct horse battery", CONTEXT);
    if (!loginB.ok) throw new Error("unreachable");

    const revoked = await service.revokeOwnSession(a.accountId, loginB.issued.session.id);
    expect(revoked).toBe(false);
    expect(await service.validateSession(loginB.issued.token)).not.toBeNull();
  });
});

describe("audit logging (docs/18 §4.3 GET /admin/audit's 'authentication ... events')", () => {
  it("records a successful login against the account, and a failed one against nobody for an unknown email", async () => {
    const accounts = new InMemoryAccountRepository();
    const sessions = new InMemorySessionRepository();
    const auditLog = new InMemoryAuditLogRepository();
    const service = new AuthService({ accounts, sessions, breachChecker: new NullBreachChecker(), env: ENV, auditLog });

    const registered = await service.register("rae@example.com", "correct horse battery", "Rae");
    if (!registered.ok) throw new Error("unreachable");
    await service.login("rae@example.com", "correct horse battery", CONTEXT);
    await service.login("nobody@example.com", "whatever whatever whatever", CONTEXT);

    const page = await auditLog.list({ limit: 10, offset: 0 });
    expect(page.entries).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ action: "login_succeeded", actor_account_id: registered.accountId }),
        expect.objectContaining({ action: "login_failed", actor_account_id: null }),
      ]),
    );
  });

  it("is a no-op when no audit log is configured", async () => {
    const { service } = setUp();
    await expect(service.login("nobody@example.com", "whatever whatever", CONTEXT)).resolves.toEqual({
      ok: false,
      code: "INVALID_CREDENTIALS",
    });
  });
});

describe("verifyMfa (docs/33_API POST /sessions/mfa, docs/15 §8.1, ADR-0017)", () => {
  async function setUpAdmin(now?: () => Date) {
    const accounts = new InMemoryAccountRepository();
    const sessions = new InMemorySessionRepository();
    const service = new AuthService({
      accounts,
      sessions,
      breachChecker: new NullBreachChecker(),
      env: ENV,
      ...(now !== undefined ? { now } : {}),
    });
    const secret = generateTotpSecret();
    const admin = await accounts.create({
      id: "admin-1",
      email: "root@example.com",
      passwordHash: "irrelevant-for-these-tests",
      displayName: "Root",
      role: "administrator",
      totpSecret: encryptTotpSecret(secret, getTotpEncryptionKey(ENV)),
      totpSecretKeyVersion: 1,
    });
    const session = await sessions.create({
      id: "session-1",
      accountId: admin.id,
      tokenHash: Buffer.from("token-hash"),
      csrfSecret: "csrf",
      issuedAt: new Date(),
      absoluteExpiresAt: new Date(Date.now() + 3_600_000),
      ip: null,
      userAgent: null,
    });
    return { accounts, sessions, service, admin, session, secret };
  }

  function codeAt(secret: Buffer, now: Date): string {
    return computeTotpCode(secret, totpStep(now));
  }

  it("rejects a non-administrator account with FORBIDDEN", async () => {
    const { service, accounts, sessions } = await setUpAdmin();
    const player = await accounts.create({
      id: "player-1",
      email: "alice@example.com",
      passwordHash: "irrelevant",
      displayName: "Alice",
    });
    const session = await sessions.create({
      id: "session-2",
      accountId: player.id,
      tokenHash: Buffer.from("th2"),
      csrfSecret: "csrf2",
      issuedAt: new Date(),
      absoluteExpiresAt: new Date(Date.now() + 3_600_000),
      ip: null,
      userAgent: null,
    });
    const result = await service.verifyMfa(player.id, session.id, "000000");
    expect(result).toEqual({ ok: false, code: "FORBIDDEN" });
  });

  it("rejects an unknown account with FORBIDDEN", async () => {
    const { service, session } = await setUpAdmin();
    expect(await service.verifyMfa("no-such-account", session.id, "000000")).toEqual({ ok: false, code: "FORBIDDEN" });
  });

  it("accepts a valid code and verifies only the calling session", async () => {
    const now = new Date("2026-01-01T00:00:00Z");
    const { service, sessions, admin, session, secret } = await setUpAdmin(() => now);
    const otherSession = await sessions.create({
      id: "session-other",
      accountId: admin.id,
      tokenHash: Buffer.from("th3"),
      csrfSecret: "csrf3",
      issuedAt: now,
      absoluteExpiresAt: new Date(now.getTime() + 3_600_000),
      ip: null,
      userAgent: null,
    });

    const result = await service.verifyMfa(admin.id, session.id, codeAt(secret, now));
    expect(result).toEqual({ ok: true });

    expect((await sessions.findById(session.id))?.mfa_verified_at).toEqual(now);
    expect((await sessions.findById(otherSession.id))?.mfa_verified_at).toBeNull();
  });

  it("rejects a wrong code with MFA_INVALID and records the failure durably", async () => {
    const now = new Date("2026-01-01T00:00:00Z");
    const { service, accounts, admin, session } = await setUpAdmin(() => now);
    const result = await service.verifyMfa(admin.id, session.id, "000000");
    expect(result).toEqual({ ok: false, code: "MFA_INVALID" });
    expect((await accounts.findById(admin.id))?.mfa_failed_attempts).toBe(1);
  });

  it("rejects a replayed code — the same step cannot verify twice", async () => {
    const now = new Date("2026-01-01T00:00:00Z");
    const { service, session, admin, secret } = await setUpAdmin(() => now);
    const code = codeAt(secret, now);
    expect(await service.verifyMfa(admin.id, session.id, code)).toEqual({ ok: true });
    expect(await service.verifyMfa(admin.id, session.id, code)).toEqual({ ok: false, code: "MFA_INVALID" });
  });

  it("locks out durably after repeated failures, and a correct code is rejected while locked", async () => {
    let now = new Date("2026-01-01T00:00:00Z");
    const { service, admin, session, secret } = await setUpAdmin(() => now);

    for (let i = 0; i < 5; i += 1) {
      now = new Date(now.getTime() + 1000);
      const result = await service.verifyMfa(admin.id, session.id, "000000");
      expect(result).toEqual({ ok: false, code: "MFA_INVALID" });
    }

    now = new Date(now.getTime() + 1000);
    const locked = await service.verifyMfa(admin.id, session.id, codeAt(secret, now));
    expect(locked).toEqual({ ok: false, code: "MFA_LOCKED", lockedUntil: expect.any(Date) });
  });

  it("fails closed (MFA_INVALID) for an administrator with no TOTP secret provisioned", async () => {
    const now = new Date("2026-01-01T00:00:00Z");
    const { service, accounts, sessions } = await setUpAdmin(() => now);
    const bare = await accounts.create({
      id: "admin-bare",
      email: "bare@example.com",
      passwordHash: "irrelevant",
      displayName: "Bare",
      role: "administrator",
    });
    const bareSession = await sessions.create({
      id: "session-bare",
      accountId: bare.id,
      tokenHash: Buffer.from("th-bare"),
      csrfSecret: "csrf-bare",
      issuedAt: now,
      absoluteExpiresAt: new Date(now.getTime() + 3_600_000),
      ip: null,
      userAgent: null,
    });
    expect(await service.verifyMfa(bare.id, bareSession.id, "123456")).toEqual({ ok: false, code: "MFA_INVALID" });
  });
});
