import { describe, expect, it } from "vitest";
import { applyOk, dealtState, expectLifecycle } from "../testing/fixtures.js";
import { apply } from "./apply.js";

describe("request_pause / request_resume (docs/05 §10)", () => {
  it("blocks game commands with TABLE_PAUSED while paused", () => {
    const state = dealtState();
    const paused = expectLifecycle(applyOk(state, { type: "request_pause", seat: "south" }), "in_play");
    const result = apply(paused, { type: "draw_tile", seat: "east", end: "head" });
    expect(result).toEqual({ ok: false, code: "TABLE_PAUSED" });
  });

  it("only the requester may release their own pause (docs/05 §10)", () => {
    const state = dealtState();
    const paused = expectLifecycle(applyOk(state, { type: "request_pause", seat: "south" }), "in_play");
    expect(apply(paused, { type: "request_resume", seat: "east" })).toEqual({
      ok: false,
      code: "NOT_IN_PHASE",
    });
    const resumed = apply(paused, { type: "request_resume", seat: "south" });
    expect(resumed.ok).toBe(true);
    if (resumed.ok) {
      const after = expectLifecycle(resumed.state, "in_play");
      expect(after.paused).toBeNull();
    }
  });

  it("leaves chat and correction available while paused (docs/05 §10)", () => {
    const state = dealtState();
    const paused = expectLifecycle(applyOk(state, { type: "request_pause", seat: "south" }), "in_play");
    const chatResult = apply(paused, { type: "send_table_message", seat: "east", text: "hang on" });
    expect(chatResult.ok).toBe(true);
  });

  it("rejects the same seat requesting a pause it already holds", () => {
    const state = dealtState();
    const paused = expectLifecycle(applyOk(state, { type: "request_pause", seat: "south" }), "in_play");
    expect(apply(paused, { type: "request_pause", seat: "south" })).toEqual({ ok: false, code: "NOT_IN_PHASE" });
  });

  it("a second seat may add its own hold to an already-paused table (docs/22 §5.2: 'if both hold')", () => {
    const state = dealtState();
    const oneHeld = expectLifecycle(applyOk(state, { type: "request_pause", seat: "south" }), "in_play");

    const result = apply(oneHeld, { type: "request_pause", seat: "east" });
    expect(result.ok).toBe(true);
    if (result.ok) {
      const after = expectLifecycle(result.state, "in_play");
      expect(after.paused).toEqual({ requestedBy: new Set(["south", "east"]) });
      expect(result.events).toEqual([{ type: "TablePaused", seat: "east" }]);
    }
  });

  it("stays paused until every holder has resumed, and each resume affects only its own seat", () => {
    const state = dealtState();
    const oneHeld = expectLifecycle(applyOk(state, { type: "request_pause", seat: "south" }), "in_play");
    const twoHeld = expectLifecycle(applyOk(oneHeld, { type: "request_pause", seat: "east" }), "in_play");

    // Neither seat may release the other's hold.
    expect(apply(twoHeld, { type: "request_resume", seat: "west" })).toEqual({ ok: false, code: "NOT_IN_PHASE" });

    const eastResumed = applyOk(twoHeld, { type: "request_resume", seat: "east" });
    const afterEast = expectLifecycle(eastResumed, "in_play");
    expect(afterEast.paused).toEqual({ requestedBy: new Set(["south"]) }); // south's hold is untouched
    expect(apply(afterEast, { type: "draw_tile", seat: "east", end: "head" })).toEqual({
      ok: false,
      code: "TABLE_PAUSED",
    }); // still paused — one holder remains

    const southResumed = applyOk(afterEast, { type: "request_resume", seat: "south" });
    const afterBoth = expectLifecycle(southResumed, "in_play");
    expect(afterBoth.paused).toBeNull(); // now genuinely resumed
  });
});

describe("send_table_message / send_signal (docs/05 §9)", () => {
  it("never mutates locations, and works in every lifecycle including idle", () => {
    const state = dealtState();
    const result = apply(state, { type: "send_table_message", seat: "east", text: "hi" });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.events).toEqual([{ type: "TableMessage", seat: "east", text: "hi" }]);
    }
  });

  it("carries no game meaning for a signal (docs/05 §9.3)", () => {
    const state = dealtState();
    const result = apply(state, { type: "send_signal", seat: "west", signal: "knock" });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.events).toEqual([{ type: "TableSignal", seat: "west", signal: "knock" }]);
    }
  });
});
