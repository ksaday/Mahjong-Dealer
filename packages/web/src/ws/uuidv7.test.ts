// @vitest-environment jsdom
import { describe, expect, it } from "vitest";
import { uuidv7 } from "./uuidv7.js";

// Same pattern `shared`'s `cmdIdSchema` validates against (docs/33_API §2).
const UUID_V7_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;

describe("uuidv7", () => {
  it("matches the UUIDv7 shape shared's cmdIdSchema requires", () => {
    expect(uuidv7()).toMatch(UUID_V7_PATTERN);
  });

  it("never repeats across many calls", () => {
    const ids = new Set(Array.from({ length: 1000 }, () => uuidv7()));
    expect(ids.size).toBe(1000);
  });

  it("sorts lexicographically by generation order (time-ordered)", async () => {
    const first = uuidv7();
    await new Promise((resolve) => setTimeout(resolve, 5));
    const second = uuidv7();
    expect(first < second).toBe(true);
  });
});
