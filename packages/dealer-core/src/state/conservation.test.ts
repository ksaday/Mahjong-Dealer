import { describe, expect, it } from "vitest";
import { dealOpeningHands } from "../wall/deal.js";
import { createDeterministicEntropy } from "../testing/deterministic-entropy.js";
import { createIdleState } from "./state.js";
import { invariants } from "./conservation.js";

describe("the conservation invariant (docs/07_Tile_Model.md §7; DD-04, DD-05)", () => {
  it("holds trivially for the idle state", () => {
    expect(invariants(createIdleState())).toEqual({ ok: true });
  });

  it("holds immediately after a deal", () => {
    const state = dealOpeningHands(createDeterministicEntropy(3));
    expect(invariants(state)).toEqual({ ok: true });
  });

  it("detects a duplicated handle across two locations", () => {
    const state = dealOpeningHands(createDeterministicEntropy(3));
    const duplicatedHandle = state.locations.hands.east[0]!;
    const corrupted = {
      ...state,
      locations: {
        ...state.locations,
        // The same handle now sits in both East's hand and the discard pile.
        discards: [duplicatedHandle],
      },
    };
    const result = invariants(corrupted);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.reason).toBe("duplicate");
    }
  });

  it("detects a lost handle (present in the tile set, absent from every location)", () => {
    const state = dealOpeningHands(createDeterministicEntropy(3));
    const [, ...rest] = state.locations.hands.east;
    const corrupted = {
      ...state,
      locations: {
        ...state.locations,
        hands: { ...state.locations.hands, east: rest },
      },
    };
    const result = invariants(corrupted);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.reason).toBe("count_mismatch");
    }
  });
});
