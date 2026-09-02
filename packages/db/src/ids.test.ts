import { describe, expect, it } from "vitest";
import { uuidv7 } from "./ids.js";

const UUID_V7_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;

describe("uuidv7 (docs/17_Database_Design.md §3, D-17-12)", () => {
  it("produces a well-formed UUIDv7: correct version and variant nibbles", () => {
    for (let i = 0; i < 50; i += 1) {
      expect(uuidv7()).toMatch(UUID_V7_PATTERN);
    }
  });

  it("produces distinct values", () => {
    const ids = new Set(Array.from({ length: 1000 }, () => uuidv7()));
    expect(ids.size).toBe(1000);
  });

  it("sorts lexicographically in time order (index locality)", async () => {
    const first = uuidv7();
    await new Promise((resolve) => setTimeout(resolve, 5));
    const second = uuidv7();
    expect(first < second).toBe(true);
  });
});
