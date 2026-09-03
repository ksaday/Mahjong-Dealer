import { describe, expect, it } from "vitest";
import { generateCsrfSecret, generateSessionToken, hashToken } from "./tokens.js";

describe("session tokens (docs/15 §4.2 — 256 bits, only the hash is stored)", () => {
  it("generates distinct tokens", () => {
    const tokens = new Set(Array.from({ length: 1000 }, () => generateSessionToken()));
    expect(tokens.size).toBe(1000);
  });

  it("hashToken is deterministic and produces a 32-byte SHA-256 digest", () => {
    const token = generateSessionToken();
    const a = hashToken(token);
    const b = hashToken(token);
    expect(a.equals(b)).toBe(true);
    expect(a).toHaveLength(32);
  });

  it("different tokens hash differently", () => {
    const a = hashToken(generateSessionToken());
    const b = hashToken(generateSessionToken());
    expect(a.equals(b)).toBe(false);
  });

  it("generateCsrfSecret produces distinct values", () => {
    const secrets = new Set(Array.from({ length: 100 }, () => generateCsrfSecret()));
    expect(secrets.size).toBe(100);
  });
});
