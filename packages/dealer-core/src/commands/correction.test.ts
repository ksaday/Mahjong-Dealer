import { describe, expect, it } from "vitest";
import { invariants } from "../state/conservation.js";
import { createDeterministicEntropy } from "../testing/deterministic-entropy.js";
import { applyOk, dealtState, expectLifecycle } from "../testing/fixtures.js";
import { apply } from "./apply.js";

describe("propose_correction (docs/05 §8.2, §8.3)", () => {
  it("rejects a target outside the retained window with NO_CHECKPOINT", () => {
    const state = dealtState();
    const result = apply(state, {
      type: "propose_correction",
      seat: "south",
      rewindTo: 0,
      oldestAvailableSeq: 1,
    });
    expect(result).toEqual({ ok: false, code: "NO_CHECKPOINT" });
  });

  it("rejects proposing while a pass round is open (docs/09 §5.2)", () => {
    const dealt = dealtState();
    const opened = expectLifecycle(
      applyOk(dealt, {
        type: "open_pass_round",
        seat: "east",
        routing: [{ from: "east", to: "south" }],
      }),
      "in_play",
    );
    const result = apply(opened, {
      type: "propose_correction",
      seat: "south",
      rewindTo: 0,
      oldestAvailableSeq: 0,
    });
    expect(result).toEqual({ ok: false, code: "PASS_ROUND_OPEN" });
  });
});

describe("respond_correction (docs/05 §8.2, §8.4; ADR-0016)", () => {
  it("TABLE_PAUSED does not block a correction response (docs/05 §10)", () => {
    const dealt = dealtState();
    // A harmless action so `dealt.seq` becomes a genuinely prior action to
    // rewind to (propose_correction requires rewindTo < the current seq).
    const advanced = expectLifecycle(
      applyOk(dealt, { type: "send_table_message", seat: "east", text: "ready" }),
      "in_play",
    );
    const proposed = expectLifecycle(
      applyOk(advanced, {
        type: "propose_correction",
        seat: "south",
        rewindTo: dealt.seq,
        oldestAvailableSeq: 0,
      }),
      "in_play",
    );
    const paused = expectLifecycle(
      applyOk(proposed, { type: "request_pause", seat: "east" }),
      "in_play",
    );
    const result = apply(paused, { type: "respond_correction", seat: "east", response: "reject" });
    expect(result.ok).toBe(true);
  });

  it("a single rejection clears the proposal and returns CorrectionRejected", () => {
    const dealt = dealtState();
    const advanced = expectLifecycle(
      applyOk(dealt, { type: "send_table_message", seat: "east", text: "ready" }),
      "in_play",
    );
    const proposed = expectLifecycle(
      applyOk(advanced, {
        type: "propose_correction",
        seat: "south",
        rewindTo: dealt.seq,
        oldestAvailableSeq: 0,
      }),
      "in_play",
    );
    const result = apply(proposed, { type: "respond_correction", seat: "east", response: "reject" });
    expect(result.ok).toBe(true);
    if (result.ok) {
      const after = expectLifecycle(result.state, "in_play");
      expect(after.correction).toBeNull();
      expect(result.events.map((e) => e.type)).toContain("CorrectionRejected");
    }
  });

  it("no reshuffle when the rewind does not cross a wall draw", () => {
    const checkpoint = dealtState(); // seq 1, wall length 99
    const discarded = expectLifecycle(
      applyOk(checkpoint, {
        type: "discard_tile",
        seat: "east",
        handle: checkpoint.locations.hands.east[0]!,
      }),
      "in_play",
    ); // seq 2, no wall draw since

    const proposed = expectLifecycle(
      applyOk(discarded, {
        type: "propose_correction",
        seat: "south",
        rewindTo: checkpoint.seq,
        oldestAvailableSeq: 0,
      }),
      "in_play",
    );
    let current = expectLifecycle(
      applyOk(proposed, { type: "respond_correction", seat: "east", response: "accept" }),
      "in_play",
    );
    current = expectLifecycle(
      applyOk(current, { type: "respond_correction", seat: "west", response: "accept" }),
      "in_play",
    );

    // No entropy supplied — must not be required, since nothing was drawn.
    const result = apply(current, {
      type: "respond_correction",
      seat: "north",
      response: "accept",
      restoreCandidate: checkpoint,
    });
    expect(result.ok).toBe(true);
    if (result.ok) {
      const restored = expectLifecycle(result.state, "in_play");
      expect(restored.commitment).toBe(checkpoint.commitment);
      expect(restored.locations.wall).toEqual(checkpoint.locations.wall);
      expect(restored.locations.discards).toHaveLength(0); // the discard was undone
      expect(result.events.map((e) => e.type)).toContain("CorrectionApplied");
      expect(result.events).not.toContainEqual(
        expect.objectContaining({ type: "ReshuffleCommitmentPublished" }),
      );
    }
  });

  it("reshuffles the undrawn remainder when the rewind crosses a wall draw (docs/05 §8.4, D-08-07)", () => {
    const checkpoint = dealtState(); // seq 1, wall length 99
    const drawnHandle = checkpoint.locations.wall[0]!;
    const drawn = expectLifecycle(
      applyOk(checkpoint, { type: "draw_tile", seat: "east", end: "head" }),
      "in_play",
    ); // seq 2, wall length 98

    const proposed = expectLifecycle(
      applyOk(drawn, {
        type: "propose_correction",
        seat: "south",
        rewindTo: checkpoint.seq,
        oldestAvailableSeq: 0,
      }),
      "in_play",
    );
    let current = expectLifecycle(
      applyOk(proposed, { type: "respond_correction", seat: "east", response: "accept" }),
      "in_play",
    );
    current = expectLifecycle(
      applyOk(current, { type: "respond_correction", seat: "west", response: "accept" }),
      "in_play",
    );

    const result = apply(
      current,
      { type: "respond_correction", seat: "north", response: "accept", restoreCandidate: checkpoint },
      createDeterministicEntropy(2024),
    );
    expect(result.ok).toBe(true);
    if (result.ok) {
      const restored = expectLifecycle(result.state, "in_play");
      expect(restored.locations.wall).toHaveLength(99); // the drawn tile is back
      expect(restored.commitment).not.toBe(checkpoint.commitment); // a fresh commitment
      // The tile East saw is no longer at a predictable position (docs/05 §8.4).
      expect(restored.locations.wall[0]).not.toBe(drawnHandle);
      expect(restored.locations.hands.east).toEqual(checkpoint.locations.hands.east);
      expect(result.events.map((e) => e.type)).toContain("ReshuffleCommitmentPublished");
      expect(invariants(restored)).toEqual({ ok: true });
    }
  });

  it("throws if unanimity is reached with no restoreCandidate (host wiring defect, not a rejection)", () => {
    const dealt = dealtState();
    const advanced = expectLifecycle(
      applyOk(dealt, { type: "send_table_message", seat: "east", text: "ready" }),
      "in_play",
    );
    const proposed = expectLifecycle(
      applyOk(advanced, {
        type: "propose_correction",
        seat: "south",
        rewindTo: dealt.seq,
        oldestAvailableSeq: 0,
      }),
      "in_play",
    );
    let current = expectLifecycle(
      applyOk(proposed, { type: "respond_correction", seat: "east", response: "accept" }),
      "in_play",
    );
    current = expectLifecycle(
      applyOk(current, { type: "respond_correction", seat: "west", response: "accept" }),
      "in_play",
    );
    expect(() =>
      apply(current, { type: "respond_correction", seat: "north", response: "accept" }),
    ).toThrow();
  });
});
