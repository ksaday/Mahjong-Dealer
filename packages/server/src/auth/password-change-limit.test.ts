import { describe, expect, it } from "vitest";
import { checkPasswordChangeWindow } from "./password-change-limit.js";

describe("checkPasswordChangeWindow (docs/15 §7.1, docs/18 §6 — flat 3/hour)", () => {
  it("starts a fresh window on the first attempt", () => {
    const result = checkPasswordChangeWindow({ count: 0, windowStartedAt: null }, new Date("2026-01-01T00:00:00Z"));
    expect(result).toEqual({
      allowed: true,
      next: { count: 1, windowStartedAt: new Date("2026-01-01T00:00:00Z") },
    });
  });

  it("allows the second and third attempts within the same window", () => {
    const windowStartedAt = new Date("2026-01-01T00:00:00Z");
    const second = checkPasswordChangeWindow({ count: 1, windowStartedAt }, new Date("2026-01-01T00:10:00Z"));
    expect(second).toEqual({ allowed: true, next: { count: 2, windowStartedAt } });

    const third = checkPasswordChangeWindow({ count: 2, windowStartedAt }, new Date("2026-01-01T00:20:00Z"));
    expect(third).toEqual({ allowed: true, next: { count: 3, windowStartedAt } });
  });

  it("rejects a fourth attempt within the hour, with retryAfter at the window's end", () => {
    const windowStartedAt = new Date("2026-01-01T00:00:00Z");
    const result = checkPasswordChangeWindow({ count: 3, windowStartedAt }, new Date("2026-01-01T00:30:00Z"));
    expect(result).toEqual({ allowed: false, retryAfter: new Date("2026-01-01T01:00:00Z") });
  });

  it("starts a new window once the hour has fully elapsed", () => {
    const windowStartedAt = new Date("2026-01-01T00:00:00Z");
    const now = new Date("2026-01-01T01:00:00Z");
    const result = checkPasswordChangeWindow({ count: 3, windowStartedAt }, now);
    expect(result).toEqual({ allowed: true, next: { count: 1, windowStartedAt: now } });
  });
});
