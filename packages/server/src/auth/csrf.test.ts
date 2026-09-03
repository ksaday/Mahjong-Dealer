import { describe, expect, it } from "vitest";
import { verifyCsrf } from "./csrf.js";

describe("verifyCsrf (docs/15 §4.2 — double-submit)", () => {
  it("passes when the header matches the session secret", () => {
    expect(verifyCsrf("secret-value", "secret-value")).toBe(true);
  });

  it("fails when the header does not match", () => {
    expect(verifyCsrf("secret-value", "wrong-value")).toBe(false);
  });

  it("fails when the header is missing", () => {
    expect(verifyCsrf("secret-value", undefined)).toBe(false);
  });

  it("fails when the header is an array (repeated header)", () => {
    expect(verifyCsrf("secret-value", ["secret-value", "secret-value"])).toBe(false);
  });

  it("fails on an empty header", () => {
    expect(verifyCsrf("secret-value", "")).toBe(false);
  });
});
