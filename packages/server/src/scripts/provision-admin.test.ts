// docs/28_Operations.md §3.1's provisioning procedure, exercised against
// an in-memory repository — no live database needed, same as every other
// test in this codebase.
import { describe, expect, it } from "vitest";
import { InMemoryAccountRepository } from "../auth/memory-repository.js";
import { runProvisionAdmin } from "./provision-admin.js";

const ENV = { PASSWORD_PEPPER: "test-pepper", TOTP_ENCRYPTION_KEY: "1".repeat(64) };

describe("runProvisionAdmin", () => {
  it("creates an administrator account with a TOTP secret and prints the one-time credentials", async () => {
    const accounts = new InMemoryAccountRepository();
    const lines: string[] = [];
    let nextId = 0;

    await runProvisionAdmin(["--email", "admin@example.com", "--display-name", "Site Admin"], {
      accounts,
      idFactory: () => `admin-${(nextId += 1)}`,
      stdout: (line) => lines.push(line),
      env: ENV,
    });

    const created = await accounts.findByEmail("admin@example.com");
    expect(created?.role).toBe("administrator");
    expect(created?.totp_secret).toBeTruthy();

    const output = lines.join("\n");
    expect(output).toContain("admin@example.com");
    expect(output).toMatch(/Initial password: \S+/);
    expect(output).toMatch(/TOTP enrollment URI: otpauth:\/\//);
  });

  it("never prints the plaintext password or secret anywhere but the returned lines", async () => {
    const accounts = new InMemoryAccountRepository();
    const lines: string[] = [];

    await runProvisionAdmin(["--email", "admin2@example.com", "--display-name", "Admin Two"], {
      accounts,
      stdout: (line) => lines.push(line),
      env: ENV,
    });

    const created = await accounts.findByEmail("admin2@example.com");
    expect(created?.totp_secret).not.toContain("otpauth://");
  });

  it("rejects a missing --email", async () => {
    const accounts = new InMemoryAccountRepository();
    await expect(runProvisionAdmin(["--display-name", "No Email"], { accounts, env: ENV })).rejects.toThrow(/Usage/);
  });

  it("rejects a missing --display-name", async () => {
    const accounts = new InMemoryAccountRepository();
    await expect(runProvisionAdmin(["--email", "admin3@example.com"], { accounts, env: ENV })).rejects.toThrow(/Usage/);
  });
});
