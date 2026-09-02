import { describe, expect, it } from "vitest";
import { invariants } from "../state/conservation.js";
import { applyOk, dealtState, expectLifecycle } from "../testing/fixtures.js";
import { apply } from "./apply.js";

describe("expose_tiles (docs/10 §5.4)", () => {
  it("moves listed handles from hand to a new exposure, in order, with no count check (NR-006)", () => {
    const state = dealtState();
    const handles = state.locations.hands.east.slice(0, 1);
    const after = expectLifecycle(applyOk(state, { type: "expose_tiles", seat: "east", handles }), "in_play");

    expect(after.locations.exposures.east).toHaveLength(1);
    expect(after.locations.exposures.east[0]!.handles).toEqual(handles);
    expect(after.locations.hands.east).toHaveLength(state.locations.hands.east.length - 1);
    expect(invariants(after)).toEqual({ ok: true });
  });

  it("rejects exposing a tile the seat does not hold (M-2)", () => {
    const state = dealtState();
    const southsTile = state.locations.hands.south[0]!;
    const result = apply(state, { type: "expose_tiles", seat: "east", handles: [southsTile] });
    expect(result).toEqual({ ok: false, code: "NOT_YOUR_TILE" });
  });
});

describe("retract_exposure (docs/10 §5.5)", () => {
  it("moves the exposure's tiles back to hand, appended at the end (NR-304)", () => {
    const dealt = dealtState();
    const handles = dealt.locations.hands.east.slice(0, 2);
    const exposed = expectLifecycle(
      applyOk(dealt, { type: "expose_tiles", seat: "east", handles }),
      "in_play",
    );
    const exposureId = exposed.locations.exposures.east[0]!.id;

    const after = expectLifecycle(
      applyOk(exposed, { type: "retract_exposure", seat: "east", exposureId }),
      "in_play",
    );
    expect(after.locations.exposures.east).toHaveLength(0);
    expect(after.locations.hands.east.slice(-2)).toEqual(handles);
    expect(invariants(after)).toEqual({ ok: true });
  });

  it("rejects retracting another seat's exposure (M-2)", () => {
    const dealt = dealtState();
    const handles = dealt.locations.hands.east.slice(0, 1);
    const exposed = expectLifecycle(
      applyOk(dealt, { type: "expose_tiles", seat: "east", handles }),
      "in_play",
    );
    const exposureId = exposed.locations.exposures.east[0]!.id;

    const result = apply(exposed, { type: "retract_exposure", seat: "south", exposureId });
    expect(result).toEqual({ ok: false, code: "NOT_YOUR_TILE" });
  });
});

describe("swap_exposed_tile (docs/10 §5.6 — the joker exchange, without knowing what a joker is)", () => {
  it("exchanges a hand tile for a tile in any exposure, including another seat's", () => {
    const dealt = dealtState();
    const exposedHandles = dealt.locations.hands.south.slice(0, 1);
    const withExposure = expectLifecycle(
      applyOk(dealt, { type: "expose_tiles", seat: "south", handles: exposedHandles }),
      "in_play",
    );
    const exposureId = withExposure.locations.exposures.south[0]!.id;
    const exposedHandle = exposedHandles[0]!;
    const myHandle = withExposure.locations.hands.east[0]!;

    const after = expectLifecycle(
      applyOk(withExposure, {
        type: "swap_exposed_tile",
        seat: "east",
        myHandle,
        exposureId,
        exposedHandle,
      }),
      "in_play",
    );

    expect(after.locations.exposures.south[0]!.handles).toEqual([myHandle]);
    expect(after.locations.hands.east).not.toContain(myHandle);
    expect(after.locations.hands.east).toContain(exposedHandle);
    expect(invariants(after)).toEqual({ ok: true });
  });

  it("rejects swapping a tile that is not in the named exposure (M-3)", () => {
    const dealt = dealtState();
    const exposedHandles = dealt.locations.hands.south.slice(0, 1);
    const withExposure = expectLifecycle(
      applyOk(dealt, { type: "expose_tiles", seat: "south", handles: exposedHandles }),
      "in_play",
    );
    const exposureId = withExposure.locations.exposures.south[0]!.id;
    const myHandle = withExposure.locations.hands.east[0]!;
    const wrongHandle = withExposure.locations.hands.west[0]!;

    const result = apply(withExposure, {
      type: "swap_exposed_tile",
      seat: "east",
      myHandle,
      exposureId,
      exposedHandle: wrongHandle,
    });
    expect(result).toEqual({ ok: false, code: "TILE_NOT_AVAILABLE" });
  });
});

describe("arrange_hand (docs/10 §5.7 — the only command that emits nothing public)", () => {
  it("accepts a permutation of the current hand and reorders it", () => {
    const state = dealtState();
    const reordered = state.locations.hands.east.slice().reverse();
    const after = expectLifecycle(
      applyOk(state, { type: "arrange_hand", seat: "east", handles: reordered }),
      "in_play",
    );
    expect(after.locations.hands.east).toEqual(reordered);
  });

  it("rejects a list that is not a permutation of the current hand", () => {
    const state = dealtState();
    const notAPermutation = state.locations.hands.east.slice(1);
    const result = apply(state, { type: "arrange_hand", seat: "east", handles: notAPermutation });
    expect(result).toEqual({ ok: false, code: "NOT_YOUR_TILE" });
  });
});
