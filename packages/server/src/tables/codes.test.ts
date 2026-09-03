import { describe, expect, it } from "vitest";
import { generateJoinCode, hashJoinCode } from "./codes.js";

describe("generateJoinCode (docs/15 §7.2)", () => {
  it("produces six characters from the 32-character Crockford alphabet", () => {
    for (let i = 0; i < 50; i += 1) {
      const code = generateJoinCode();
      expect(code).toHaveLength(6);
      expect(code).toMatch(/^[0-9A-HJKMNP-TV-Z]{6}$/);
    }
  });

  it("is not deterministic across calls", () => {
    const codes = new Set(Array.from({ length: 20 }, () => generateJoinCode()));
    expect(codes.size).toBeGreaterThan(1);
  });
});

describe("hashJoinCode (D-17-07: irreversible)", () => {
  it("hashes the same code to the same value", () => {
    expect(hashJoinCode("ABCDEF")).toEqual(hashJoinCode("ABCDEF"));
  });

  it("is case-insensitive at the edge", () => {
    expect(hashJoinCode("abcdef")).toEqual(hashJoinCode("ABCDEF"));
  });

  it("hashes different codes to different values", () => {
    expect(hashJoinCode("ABCDEF")).not.toEqual(hashJoinCode("ABCDEG"));
  });
});
