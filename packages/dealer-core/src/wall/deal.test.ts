import { describe, expect, it } from "vitest";
import { SEAT_ORDER } from "@mahjong-dealer/shared";
import { invariants } from "../state/conservation.js";
import { createDeterministicEntropy } from "../testing/deterministic-entropy.js";
import { dealOpeningHands, OPENING_HAND_COUNTS } from "./deal.js";

describe("the opening deal (docs/08 §7.1; docs/07 §4)", () => {
  it("deals 14 to east and 13 to the other three seats", () => {
    const state = dealOpeningHands(createDeterministicEntropy(11));
    for (const seat of SEAT_ORDER) {
      expect(state.locations.hands[seat]).toHaveLength(OPENING_HAND_COUNTS[seat]);
    }
  });

  it("leaves 152 - 53 = 99 tiles in the wall", () => {
    const state = dealOpeningHands(createDeterministicEntropy(11));
    expect(state.locations.wall).toHaveLength(99);
  });

  it("starts in_play with the turn at east and an empty discard pile", () => {
    const state = dealOpeningHands(createDeterministicEntropy(11));
    expect(state.lifecycle).toBe("in_play");
    expect(state.turn).toBe("east");
    expect(state.locations.discards).toHaveLength(0);
  });

  it("publishes a commitment and retains a salt, both present", () => {
    const state = dealOpeningHands(createDeterministicEntropy(11));
    expect(state.commitment).toMatch(/^[0-9a-f]{64}$/u);
    expect(state.salt).toMatch(/^[0-9a-f]{64}$/u);
  });

  it("satisfies the conservation invariant immediately after dealing (DD-04)", () => {
    const state = dealOpeningHands(createDeterministicEntropy(11));
    expect(invariants(state)).toEqual({ ok: true });
  });

  it("is exactly reproducible from the same entropy seed", () => {
    const a = dealOpeningHands(createDeterministicEntropy(999));
    const b = dealOpeningHands(createDeterministicEntropy(999));
    expect(a.locations.hands).toEqual(b.locations.hands);
    expect(a.commitment).toBe(b.commitment);
  });
});
