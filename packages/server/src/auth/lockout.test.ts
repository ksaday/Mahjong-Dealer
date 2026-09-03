import { describe, expect, it } from "vitest";
import { computeLockoutMinutes, isLockedOut } from "./lockout.js";

describe("computeLockoutMinutes (docs/15 §7.1, D-15-03 — durable, progressive)", () => {
  it("does not lock below the threshold", () => {
    expect(computeLockoutMinutes(0)).toBeNull();
    expect(computeLockoutMinutes(4)).toBeNull();
  });

  it("locks at the threshold and grows with repeated failure", () => {
    const at5 = computeLockoutMinutes(5);
    const at10 = computeLockoutMinutes(10);
    const at15 = computeLockoutMinutes(15);
    expect(at5).not.toBeNull();
    expect(at10).toBeGreaterThan(at5!);
    expect(at15).toBeGreaterThan(at10!);
  });

  it("caps at a maximum rather than growing unbounded", () => {
    expect(computeLockoutMinutes(1000)).toBeLessThanOrEqual(60);
  });
});

describe("isLockedOut", () => {
  it("is false for a null lockout", () => {
    expect(isLockedOut(null, new Date())).toBe(false);
  });

  it("is true while the lockout is in the future, false once it has passed", () => {
    const now = new Date("2026-01-01T00:00:00Z");
    expect(isLockedOut(new Date("2026-01-01T00:05:00Z"), now)).toBe(true);
    expect(isLockedOut(new Date("2025-12-31T23:55:00Z"), now)).toBe(false);
  });
});
