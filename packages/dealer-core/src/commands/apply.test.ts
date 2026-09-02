import { describe, expect, it } from "vitest";
import type { WallOrder } from "@mahjong-dealer/shared";
import type { TileHandle } from "@mahjong-dealer/shared";
import { invariants } from "../state/conservation.js";
import { createIdleState } from "../state/state.js";
import { createDeterministicEntropy } from "../testing/deterministic-entropy.js";
import { apply } from "./apply.js";

function dealtState() {
  const result = apply(createIdleState(), { type: "start_deal", seat: "east" }, createDeterministicEntropy(21));
  if (!result.ok) throw new Error("unreachable: deal should always succeed from idle");
  return result.state;
}

describe("apply — start_deal (docs/10 §4)", () => {
  it("transitions idle to in_play and deals the opening hands", () => {
    const result = apply(createIdleState(), { type: "start_deal", seat: "east" }, createDeterministicEntropy(1));
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.state.lifecycle).toBe("in_play");
      expect(result.events.map((e) => e.type)).toEqual([
        "WallBuilt",
        "DealCommitmentPublished",
        "TilesDealt",
      ]);
    }
  });

  it("rejects start_deal when not idle (M-4)", () => {
    const inPlay = dealtState();
    const result = apply(inPlay, { type: "start_deal", seat: "east" }, createDeterministicEntropy(1));
    expect(result).toEqual({ ok: false, code: "NOT_IN_PHASE" });
  });
});

describe("apply — draw_tile (docs/10 §5.1; the only turn-gated command)", () => {
  it("rejects a draw from a seat that is not the turn pointer (M-4t)", () => {
    const state = dealtState();
    expect(state.turn).toBe("east");
    const result = apply(state, { type: "draw_tile", seat: "south", end: "head" });
    expect(result).toEqual({ ok: false, code: "NOT_YOUR_TURN" });
  });

  it("draws from the head, grows the hand, shrinks the wall, and advances the turn", () => {
    const state = dealtState();
    const wallBefore = state.locations.wall.length;
    const handBefore = state.locations.hands.east.length;
    const result = apply(state, { type: "draw_tile", seat: "east", end: "head" });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.state.locations.hands.east).toHaveLength(handBefore + 1);
      expect(result.state.locations.wall).toHaveLength(wallBefore - 1);
      expect(result.state.turn).toBe("south");
      const drawn = result.events.find((e) => e.type === "TileDrawn");
      expect(drawn).toBeDefined();
    }
  });

  it("rejects a draw against an empty wall with WALL_EMPTY and emits WallExhausted once", () => {
    const state = dealtState();
    const emptied = {
      ...state,
      locations: { ...state.locations, wall: [] as unknown as WallOrder<TileHandle> },
    };
    const result = apply(emptied, { type: "draw_tile", seat: "east", end: "head" });
    expect(result).toEqual({ ok: false, code: "WALL_EMPTY" });
  });
});

describe("apply — discard_tile (docs/10 §5.2; not turn-gated)", () => {
  it("rejects discarding a tile the seat does not hold (M-2)", () => {
    const state = dealtState();
    const southsTile = state.locations.hands.south[0]!;
    const result = apply(state, { type: "discard_tile", seat: "east", handle: southsTile });
    expect(result).toEqual({ ok: false, code: "NOT_YOUR_TILE" });
  });

  it("moves the tile to the discard pile without moving the turn pointer", () => {
    const state = dealtState();
    const tile = state.locations.hands.east[0]!;
    const result = apply(state, { type: "discard_tile", seat: "east", handle: tile });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.state.locations.discards).toEqual([tile]);
      expect(result.state.locations.hands.east).not.toContain(tile);
      expect(result.state.turn).toBe(state.turn); // unchanged
    }
  });
});

describe("apply — claim_discard (docs/10 §5.3; moves the turn to the claimant)", () => {
  it("rejects claiming when the named handle is not the current discard (M-3)", () => {
    const state = dealtState();
    const notDiscarded = state.locations.hands.east[0]!;
    const result = apply(state, { type: "claim_discard", seat: "north", handle: notDiscarded });
    expect(result).toEqual({ ok: false, code: "TILE_NOT_AVAILABLE" });
  });

  it("lets any seat claim the current discard and moves the turn to the claimant (NR-005)", () => {
    const dealt = dealtState();
    const discardedTile = dealt.locations.hands.east[0]!;
    const afterDiscard = apply(dealt, { type: "discard_tile", seat: "east", handle: discardedTile });
    if (!afterDiscard.ok) throw new Error("unreachable");

    const result = apply(afterDiscard.state, {
      type: "claim_discard",
      seat: "north",
      handle: discardedTile,
    });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.state.turn).toBe("north");
      expect(result.state.locations.discards).toHaveLength(0);
      expect(result.state.locations.hands.north).toContain(discardedTile);
    }
  });
});

describe("apply — conservation across a sequence of commands", () => {
  it("keeps every tile accounted for through draw, discard, and claim", () => {
    let state = dealtState();

    const drawn = apply(state, { type: "draw_tile", seat: "east", end: "tail" });
    if (!drawn.ok) throw new Error("unreachable");
    state = drawn.state;
    expect(invariants(state)).toEqual({ ok: true });

    const tileToDiscard = state.locations.hands.east[0]!;
    const discarded = apply(state, { type: "discard_tile", seat: "east", handle: tileToDiscard });
    if (!discarded.ok) throw new Error("unreachable");
    state = discarded.state;
    expect(invariants(state)).toEqual({ ok: true });

    const claimed = apply(state, { type: "claim_discard", seat: "west", handle: tileToDiscard });
    if (!claimed.ok) throw new Error("unreachable");
    state = claimed.state;
    expect(invariants(state)).toEqual({ ok: true });
  });
});
