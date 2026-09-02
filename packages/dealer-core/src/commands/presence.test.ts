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
