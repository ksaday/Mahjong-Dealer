import { describe, expect, it } from "vitest";
import { applyOk, dealtState, expectLifecycle } from "../testing/fixtures.js";
import { apply } from "./apply.js";

describe("declare_mahjong / respond_declaration (docs/10 §7)", () => {
  it("moves to concluding, and unanimous acceptance concludes with no rule content (NR-003, NR-013)", () => {
    const state = dealtState();
    const declared = expectLifecycle(
      applyOk(state, { type: "declare_mahjong", seat: "east" }),
      "concluding",
    );
    expect(declared.process).toEqual({ kind: "declaration", declarer: "east", responses: {} });

    let current = expectLifecycle(
      applyOk(declared, { type: "respond_declaration", seat: "south", response: "accept" }),
      "concluding",
    );
    current = expectLifecycle(
      applyOk(current, { type: "respond_declaration", seat: "west", response: "accept" }),
      "concluding",
    );

    const result = apply(current, { type: "respond_declaration", seat: "north", response: "accept" });
    expect(result.ok).toBe(true);
    if (result.ok) {
      const concluded = expectLifecycle(result.state, "concluded");
      expect(concluded.outcome).toEqual({ kind: "declaration_accepted", declarer: "east" });
      // No score, no justification — just the neutral fact (NR-013).
      expect(Object.keys(concluded.outcome)).toEqual(["kind", "declarer"]);
    }
  });

  it("a single dispute returns the game to in_play with no evaluation of the dispute (NR-003)", () => {
    const state = dealtState();
    const declared = expectLifecycle(
      applyOk(state, { type: "declare_mahjong", seat: "east" }),
      "concluding",
    );
    const disputed = apply(declared, { type: "respond_declaration", seat: "south", response: "dispute" });
    expect(disputed.ok).toBe(true);
    if (disputed.ok) {
      expect(disputed.state.lifecycle).toBe("in_play");
    }
  });

  it("rejects a response from the declarer (M-4)", () => {
    const state = dealtState();
    const declared = expectLifecycle(
      applyOk(state, { type: "declare_mahjong", seat: "east" }),
      "concluding",
    );
    const result = apply(declared, { type: "respond_declaration", seat: "east", response: "accept" });
    expect(result).toEqual({ ok: false, code: "NOT_IN_PHASE" });
  });

  it("withdraw_declaration returns to in_play, only for the declarer", () => {
    const state = dealtState();
    const declared = expectLifecycle(
      applyOk(state, { type: "declare_mahjong", seat: "east" }),
      "concluding",
    );
    expect(apply(declared, { type: "withdraw_declaration", seat: "south" })).toEqual({
      ok: false,
      code: "NOT_IN_PHASE",
    });
    const withdrawn = apply(declared, { type: "withdraw_declaration", seat: "east" });
    expect(withdrawn.ok).toBe(true);
    if (withdrawn.ok) expect(withdrawn.state.lifecycle).toBe("in_play");
  });
});

describe("propose_end_game / respond_end_game (docs/10 §7)", () => {
  it("a single decline returns to in_play; unanimous acceptance concludes", () => {
    const state = dealtState();
    const proposed = expectLifecycle(
      applyOk(state, { type: "propose_end_game", seat: "east" }),
      "concluding",
    );

    const declined = apply(proposed, { type: "respond_end_game", seat: "south", response: "decline" });
    expect(declined.ok).toBe(true);
    if (declined.ok) expect(declined.state.lifecycle).toBe("in_play");

    let current = expectLifecycle(
      applyOk(proposed, { type: "respond_end_game", seat: "south", response: "accept" }),
      "concluding",
    );
    current = expectLifecycle(
      applyOk(current, { type: "respond_end_game", seat: "west", response: "accept" }),
      "concluding",
    );
    const result = apply(current, { type: "respond_end_game", seat: "north", response: "accept" });
    expect(result.ok).toBe(true);
    if (result.ok) {
      const concluded = expectLifecycle(result.state, "concluded");
      expect(concluded.outcome).toEqual({ kind: "ended_by_agreement" });
    }
  });
});

describe("reveal_hand (docs/10 §5 — voluntary and irreversible)", () => {
  it("publishes the seat's current hand and is reflected at game close", () => {
    const state = dealtState();
    const revealed = applyOk(state, { type: "reveal_hand", seat: "east" });
    if (revealed.lifecycle === "idle" || revealed.lifecycle === "concluded") throw new Error("unreachable");
    expect(revealed.revealedHands.has("east")).toBe(true);

    const declared = expectLifecycle(
      applyOk(revealed, { type: "declare_mahjong", seat: "east" }),
      "concluding",
    );
    let current = expectLifecycle(
      applyOk(declared, { type: "respond_declaration", seat: "south", response: "accept" }),
      "concluding",
    );
    current = expectLifecycle(
      applyOk(current, { type: "respond_declaration", seat: "west", response: "accept" }),
      "concluding",
    );
    const result = apply(current, { type: "respond_declaration", seat: "north", response: "accept" });
    expect(result.ok).toBe(true);
    if (result.ok) {
      const concluded = expectLifecycle(result.state, "concluded");
      expect(concluded.revealedHands.east).toBeDefined();
    }
  });
});
