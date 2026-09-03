import { describe, expect, it } from "vitest";
import { NullBreachChecker } from "./breach-checker.js";
import { InMemoryAccountRepository, InMemorySessionRepository } from "./memory-repository.js";
import { provisionAdministrator } from "./provisioning.js";
import { AuthService } from "./service.js";
import { decryptTotpSecret } from "./totp-encryption.js";
import { getTotpEncryptionKey } from "./totp-key.js";
import { computeTotpCode, totpStep } from "./totp.js";

const ENV = { PASSWORD_PEPPER: "test-pepper" };

describe("provisionAdministrator (docs/15 §8.2, docs/28 §3.1, ADR-0017)", () => {
  it("produces an account that logs in with the generated password and steps up with the enrolled secret", async () => {
    let nextId = 0;
    const provisioned = await provisionAdministrator("root@example.com", "Root", () => `admin-${(nextId += 1)}`, ENV);

    const accounts = new InMemoryAccountRepository();
    const sessions = new InMemorySessionRepository();
    const account = await accounts.create(provisioned.newAccount);
    expect(account.role).toBe("administrator");
    expect(account.totp_secret).not.toBeNull();

    const service = new AuthService({ accounts, sessions, breachChecker: new NullBreachChecker(), env: ENV });
    const login = await service.login("root@example.com", provisioned.password, { ip: null, userAgent: null });
    if (!login.ok) throw new Error(`unreachable: ${login.code}`);

    // The otpauth:// URI embeds the same secret AccountRepository stored (encrypted) — recovering it
    // the way the account row does, not by re-parsing the URI, since that's the client's job, not this test's.
    const secret = decryptTotpSecret(account.totp_secret!, getTotpEncryptionKey(ENV));
    const code = computeTotpCode(secret, totpStep(new Date()));
    const mfa = await service.verifyMfa(login.account.id, login.issued.session.id, code);
    expect(mfa).toEqual({ ok: true });
  });

  it("produces a password meeting the 12-character policy floor by construction", async () => {
    const provisioned = await provisionAdministrator("a@example.com", "A", () => "id-1", ENV);
    expect(provisioned.password.length).toBeGreaterThanOrEqual(12);
  });

  it("builds an otpauth:// URI carrying the account's own email", async () => {
    const provisioned = await provisionAdministrator("ops@example.com", "Ops", () => "id-2", ENV);
    expect(provisioned.otpauthUri).toContain("otpauth://totp/");
    expect(provisioned.otpauthUri).toContain(encodeURIComponent("ops@example.com"));
  });

  it("generates a different secret and password on every call", async () => {
    const a = await provisionAdministrator("x@example.com", "X", () => "id-a", ENV);
    const b = await provisionAdministrator("x@example.com", "X", () => "id-b", ENV);
    expect(a.password).not.toBe(b.password);
    expect(a.otpauthUri).not.toBe(b.otpauthUri);
    expect(a.newAccount.totpSecret!.equals(b.newAccount.totpSecret!)).toBe(false);
  });
});
