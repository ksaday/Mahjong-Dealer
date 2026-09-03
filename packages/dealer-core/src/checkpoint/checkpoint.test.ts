import { describe, expect, it } from "vitest";
import { invariants } from "../state/conservation.js";
import { createIdleState } from "../state/state.js";
import { applyOk } from "../testing/fixtures.js";
import { createDeterministicEntropy } from "../testing/deterministic-entropy.js";
import { dealOpeningHands } from "../wall/deal.js";
import { checkpoint, CheckpointRestoreError, restore } from "./checkpoint.js";

describe("checkpoint / restore (docs/06 DD-29, DD-30; docs/16 §5)", () => {
  it("round-trips the idle state", () => {
    const state = createIdleState();
    const restored = restore(checkpoint(state));
    expect(restored).toEqual(state);
  });

  it("round-trips a dealt, in-play state exactly", () => {
    const state = dealOpeningHands(createDeterministicEntropy(55));
    const restored = restore(checkpoint(state));
    expect(restored.lifecycle).toBe("in_play");
    expect(restored).toEqual(state);
  });

  it("produces bytes containing no structural version prefix beyond plain JSON", () => {
    const state = dealOpeningHands(createDeterministicEntropy(55));
    expect(() => JSON.parse(checkpoint(state))).not.toThrow();
  });

  it("satisfies the conservation invariant on the restored state", () => {
    const state = dealOpeningHands(createDeterministicEntropy(55));
    const restored = restore(checkpoint(state));
    expect(invariants(restored)).toEqual({ ok: true });
  });

  it("round-trips a multi-holder pause as a Set, not just a single Seat (docs/22 §5.2)", () => {
    const dealt = dealOpeningHands(createDeterministicEntropy(55));
    const onePause = applyOk(dealt, { type: "request_pause", seat: "south" });
    const state = applyOk(onePause, { type: "request_pause", seat: "east" });

    const restored = restore(checkpoint(state));
    expect(restored.lifecycle === "in_play" || restored.lifecycle === "concluding").toBe(true);
    if (restored.lifecycle !== "in_play" && restored.lifecycle !== "concluding") throw new Error("unreachable");
    expect(restored.paused).toEqual({ requestedBy: new Set(["south", "east"]) });
    expect(restored.paused?.requestedBy).toBeInstanceOf(Set);
  });

  it("rejects a checkpoint that fails conservation (docs/07 §7.1)", () => {
    const state = dealOpeningHands(createDeterministicEntropy(55));
    const bytes = checkpoint(state);
    const corrupted = JSON.parse(bytes) as {
      live: { locations: { discards: string[]; hands: { east: string[] } } };
    };
    // Duplicate a handle that's already in East's hand into the discard pile.
    corrupted.live.locations.discards = [corrupted.live.locations.hands.east[0]!];
    expect(() => restore(JSON.stringify(corrupted))).toThrow(CheckpointRestoreError);
  });
});
