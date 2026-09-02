import { describe, expect, it } from "vitest";
import { SEAT_ORDER } from "@mahjong-dealer/shared";
import { apply } from "../commands/apply.js";
import { dealOpeningHands } from "../wall/deal.js";
import { createDeterministicEntropy } from "../testing/deterministic-entropy.js";
import { applyOk, dealtState, expectLifecycle } from "../testing/fixtures.js";
import { project } from "./project.js";

describe("the seat projector (docs/14_Player_Privacy.md §5; DD-31, DD-32)", () => {
  const state = dealOpeningHands(createDeterministicEntropy(77));

  it("shows a seat exactly its own hand size worth of own-hand tiles", () => {
    for (const seat of SEAT_ORDER) {
      const view = project(state, seat);
      expect(view.ownHand).toHaveLength(state.locations.hands[seat].length);
    }
  });

  it("never places another seat's tiles in ownHand", () => {
    const eastView = project(state, "east");
    const eastHandles = new Set(state.locations.hands.east);
    for (const tile of eastView.ownHand) {
      expect(eastHandles.has(tile.handle)).toBe(true);
    }
  });

  it("never references another seat's concealed handles anywhere in the view", () => {
    // Handles are unique 128-bit values (no two tiles share one), so their
    // absence is airtight in a way checking for a face string is not — most
    // faces have four copies, so two different seats legitimately hold
    // tiles with the same face (docs/07 §3).
    for (const viewer of SEAT_ORDER) {
      const view = project(state, viewer);
      const serialized = JSON.stringify(view);
      for (const other of SEAT_ORDER) {
        if (other === viewer) continue;
        for (const handle of state.locations.hands[other]) {
          expect(serialized.includes(handle)).toBe(false);
        }
      }
    }
  });

  it("has no property that could hold the wall order or the salt (construct, not filter — D-14-02)", () => {
    const view = project(state, "east");
    expect(Object.keys(view)).not.toContain("wall");
    expect(Object.keys(view)).not.toContain("wallOrder");
    expect(Object.keys(view)).not.toContain("salt");
  });

  it("exposes wall remaining as a count only", () => {
    const view = project(state, "east");
    expect(view.wallRemaining).toBe(state.locations.wall.length);
  });

  it("exposes hand sizes for every seat, without contents, as PUB data (docs/14 §4.1)", () => {
    const view = project(state, "east");
    for (const summary of view.seats) {
      expect(summary.handSize).toBe(state.locations.hands[summary.seat].length);
    }
  });

  it("shows a voluntarily revealed hand to every seat, not only the owner (docs/10 reveal_hand)", () => {
    const revealed = applyOk(state, { type: "reveal_hand", seat: "west" });
    const inPlay = expectLifecycle(revealed, "in_play");
    for (const viewer of SEAT_ORDER) {
      const view = project(inPlay, viewer);
      const westSummary = view.seats.find((s) => s.seat === "west")!;
      expect(westSummary.revealedHand).not.toBeNull();
      expect(westSummary.revealedHand).toHaveLength(inPlay.locations.hands.west.length);
    }
  });
});

describe("the projector at game close (docs/16 §5.5 — concealed material purged)", () => {
  it("purges the owner's own hand from ownHand once the game concludes", () => {
    const dealt = dealtState();
    const declared = expectLifecycle(applyOk(dealt, { type: "declare_mahjong", seat: "east" }), "concluding");
    let current = expectLifecycle(
      applyOk(declared, { type: "respond_declaration", seat: "south", response: "accept" }),
      "concluding",
    );
    current = expectLifecycle(
      applyOk(current, { type: "respond_declaration", seat: "west", response: "accept" }),
      "concluding",
    );
    const result = apply(current, { type: "respond_declaration", seat: "north", response: "accept" });
    if (!result.ok) throw new Error("unreachable");
    const concluded = expectLifecycle(result.state, "concluded");

    for (const seat of SEAT_ORDER) {
      const view = project(concluded, seat);
      expect(view.ownHand).toHaveLength(0); // purged even for the owner
      expect(view.outcome).toEqual({ kind: "declaration_accepted", declarer: "east" });
    }
  });
});
