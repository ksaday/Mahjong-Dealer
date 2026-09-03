import { describe, expect, it } from "vitest";
import { DenylistBreachChecker, NullBreachChecker } from "./breach-checker.js";
import { checkPasswordPolicy, hashPassword, verifyPassword } from "./passwords.js";

const env = { PASSWORD_PEPPER: "test-pepper-value" };

describe("hashPassword / verifyPassword (docs/15 §4.1)", () => {
  it("round-trips: the original password verifies against its own hash", async () => {
    const hash = await hashPassword("correct horse battery staple", env);
    expect(await verifyPassword(hash, "correct horse battery staple", env)).toBe(true);
  });

  it("rejects the wrong password", async () => {
    const hash = await hashPassword("correct horse battery staple", env);
    expect(await verifyPassword(hash, "wrong password entirely", env)).toBe(false);
  });

  it("is peppered: the same password under a different pepper does not verify", async () => {
    const hash = await hashPassword("correct horse battery staple", { PASSWORD_PEPPER: "pepper-a" });
    expect(await verifyPassword(hash, "correct horse battery staple", { PASSWORD_PEPPER: "pepper-b" })).toBe(
      false,
    );
  });

  it("produces an argon2id hash", async () => {
    const hash = await hashPassword("correct horse battery staple", env);
    expect(hash.startsWith("$argon2id$")).toBe(true);
  });

  it("does not throw on a malformed hash, and reports it as not verified", async () => {
    await expect(verifyPassword("not-a-real-hash", "anything", env)).resolves.toBe(false);
  });
});

describe("checkPasswordPolicy (docs/15 §4.1 — length plus a breach check, no composition rules)", () => {
  it("rejects passwords shorter than 12 characters", async () => {
    expect(await checkPasswordPolicy("short1234", new NullBreachChecker())).toBe("TOO_SHORT");
  });

  it("accepts a 12-character password with no composition requirement", async () => {
    expect(await checkPasswordPolicy("aaaaaaaaaaaa", new NullBreachChecker())).toBeNull();
  });

  it("rejects a password present in the breach list", async () => {
    const checker = new DenylistBreachChecker(["password123456"]);
    expect(await checkPasswordPolicy("password123456", checker)).toBe("BREACHED");
  });
});
