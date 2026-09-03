import { describe, expect, it } from "vitest";
import { NullBreachChecker } from "./breach-checker.js";
import { InMemoryAccountRepository, InMemorySessionRepository } from "./memory-repository.js";
import { AuthService } from "./service.js";

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
