import { describe, expect, it } from "vitest";
import { CLOSE_CODES, NOTICE_KINDS, REJECTION_CODES } from "./codes.js";

describe("rejection codes (docs/19 §7.1)", () => {
  it("has exactly seventeen codes", () => {
    expect(REJECTION_CODES).toHaveLength(17);
  });

  it("follows the naming law: SCREAMING_SNAKE_CASE (docs/19 §3)", () => {
    for (const code of REJECTION_CODES) {
      expect(code).toMatch(/^[A-Z][A-Z0-9]*(_[A-Z0-9]+)*$/u);
    }
  });
});

describe("close codes (docs/19 §7.2)", () => {
  it("has exactly nine codes, each a valid WebSocket close code with a SCREAMING_SNAKE_CASE name", () => {
    expect(CLOSE_CODES).toHaveLength(9);
    for (const { code, name } of CLOSE_CODES) {
      expect(Number.isInteger(code)).toBe(true);
      expect(name).toMatch(/^[A-Z][A-Z0-9]*(_[A-Z0-9]+)*$/u);
    }
  });

  it("has no duplicate numeric codes", () => {
    const codes = CLOSE_CODES.map((c) => c.code);
    expect(new Set(codes).size).toBe(codes.length);
  });
});

describe("notice kinds (docs/19 §7.3)", () => {
  it("has exactly three kinds, lower_snake_case", () => {
    expect(NOTICE_KINDS).toHaveLength(3);
    for (const kind of NOTICE_KINDS) {
      expect(kind).toMatch(/^[a-z][a-z0-9]*(_[a-z0-9]+)*$/u);
    }
  });
});
