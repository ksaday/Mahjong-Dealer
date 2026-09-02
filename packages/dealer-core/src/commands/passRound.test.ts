import { describe, expect, it } from "vitest";
import { invariants } from "../state/conservation.js";
import { applyOk, dealtState, expectLifecycle } from "../testing/fixtures.js";
import { apply } from "./apply.js";

const ROUTING = [
  { from: "east" as const, to: "south" as const },
  { from: "south" as const, to: "east" as const },
];

describe("open_pass_round / commit_pass (docs/10 §6)", () => {
  it("opens with PASS_ROUND_OPEN set, and blocks movement commands while open", () => {
    const state = dealtState();
    const opened = expectLifecycle(
      applyOk(state, { type: "open_pass_round", seat: "east", routing: ROUTING }),
      "in_play",
    );
    expect(opened.passRound?.routing).toEqual(ROUTING);

    const blocked = apply(opened, { type: "discard_tile", seat: "east", handle: opened.locations.hands.east[0]! });
    expect(blocked).toEqual({ ok: false, code: "PASS_ROUND_OPEN" });
  });

  it("rejects opening a second round while one is open (M-4)", () => {
    const state = dealtState();
    const opened = expectLifecycle(
      applyOk(state, { type: "open_pass_round", seat: "east", routing: ROUTING }),
      "in_play",
    );
    const result = apply(opened, { type: "open_pass_round", seat: "west", routing: ROUTING });
    expect(result).toEqual({ ok: false, code: "PASS_ROUND_OPEN" });
  });

  it("executes atomically the moment the last participant commits, with no seat learning early", () => {
    const state = dealtState();
    const opened = expectLifecycle(
      applyOk(state, { type: "open_pass_round", seat: "east", routing: ROUTING }),
      "in_play",
    );

    const eastSends = opened.locations.hands.east.slice(0, 3);
    const afterEast = expectLifecycle(
      applyOk(opened, { type: "commit_pass", seat: "east", handles: eastSends }),
      "in_play",
    );
    // Still open: not every participant has committed.
    expect(afterEast.passRound).not.toBeNull();
    expect(afterEast.locations.inFlight.east).toEqual(eastSends);

    const southSends = afterEast.locations.hands.south.slice(0, 3);
    const result = apply(afterEast, { type: "commit_pass", seat: "south", handles: southSends });
    expect(result.ok).toBe(true);
    const executed = expectLifecycle(result.ok ? result.state : never(), "in_play");

    expect(executed.passRound).toBeNull();
    expect(executed.locations.inFlight.east).toHaveLength(0);
    expect(executed.locations.inFlight.south).toHaveLength(0);
    for (const handle of eastSends) expect(executed.locations.hands.south).toContain(handle);
    for (const handle of southSends) expect(executed.locations.hands.east).toContain(handle);
    if (result.ok) {
      expect(result.events.map((e) => e.type)).toContain("PassRoundExecuted");
    }
    expect(invariants(executed)).toEqual({ ok: true });
  });

  it("rejects an unequal, uncounted pass without complaint about the count (FR-093)", () => {
    // No constraint on count at all — a 1-tile commit against a 3-tile
    // commit is mechanically fine; the system has no opinion.
    const state = dealtState();
    const opened = expectLifecycle(
      applyOk(state, { type: "open_pass_round", seat: "east", routing: ROUTING }),
      "in_play",
    );
    const result = apply(opened, {
      type: "commit_pass",
      seat: "east",
      handles: opened.locations.hands.east.slice(0, 1),
    });
    expect(result.ok).toBe(true);
  });
});

describe("withdraw_pass / cancel_pass_round (docs/10 §6)", () => {
  it("withdraw_pass returns committed tiles to the hand and the round stays open", () => {
    const state = dealtState();
    const opened = expectLifecycle(
      applyOk(state, { type: "open_pass_round", seat: "east", routing: ROUTING }),
      "in_play",
    );
    const sent = opened.locations.hands.east.slice(0, 2);
    const committed = expectLifecycle(
      applyOk(opened, { type: "commit_pass", seat: "east", handles: sent }),
      "in_play",
    );

    const withdrawn = expectLifecycle(
      applyOk(committed, { type: "withdraw_pass", seat: "east" }),
      "in_play",
    );
    expect(withdrawn.locations.inFlight.east).toHaveLength(0);
    for (const handle of sent) expect(withdrawn.locations.hands.east).toContain(handle);
    expect(withdrawn.passRound).not.toBeNull();
  });

  it("cancel_pass_round returns every commitment and clears the flag", () => {
    const state = dealtState();
    const opened = expectLifecycle(
      applyOk(state, { type: "open_pass_round", seat: "east", routing: ROUTING }),
      "in_play",
    );
    const sent = opened.locations.hands.east.slice(0, 2);
    const committed = expectLifecycle(
      applyOk(opened, { type: "commit_pass", seat: "east", handles: sent }),
      "in_play",
    );

    const cancelled = expectLifecycle(
      applyOk(committed, { type: "cancel_pass_round", seat: "south" }),
      "in_play",
    );
    expect(cancelled.passRound).toBeNull();
    for (const handle of sent) expect(cancelled.locations.hands.east).toContain(handle);
    expect(invariants(cancelled)).toEqual({ ok: true });
  });
});

function never(): never {
  throw new Error("unreachable");
}
