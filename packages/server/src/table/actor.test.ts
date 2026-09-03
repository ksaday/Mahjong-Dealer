import { describe, expect, it } from "vitest";
import { SEAT_ORDER } from "@mahjong-dealer/shared";
import { TableHarness } from "../testing/table-harness.js";
import { TableActor } from "./actor.js";
import { createDeterministicEntropy } from "../testing/deterministic-entropy.js";

function readyAllAndDeal(harness: TableHarness): void {
  harness.seatAll();
  for (const seat of SEAT_ORDER) {
    harness.seat(seat).send("set_ready", undefined);
  }
  harness.seat("east").send("start_deal", undefined);
}

describe("set_ready / clear_ready (docs/10 §4: IDLE or CONCLUDED only)", () => {
  it("is refused once a game is in progress", () => {
    const harness = TableHarness.create({ seed: 1 });
    readyAllAndDeal(harness);
    harness.seat("east").send("clear_ready", undefined);
    expect(harness.frames("east").at(-1)).toEqual(
      expect.objectContaining({ kind: "reject", code: "NOT_IN_PHASE" }),
    );
  });

  it("succeeds while idle and is reflected in the table snapshot", () => {
    const harness = TableHarness.create({ seed: 1 });
    harness.seatAll();
    harness.seat("east").send("set_ready", undefined);
    expect(harness.table().seats.east.ready).toBe(true);
  });
});

describe("start_deal authorization (docs/10 §4 — the table actor's own M-4)", () => {
  it("rejects a non-host with FORBIDDEN", () => {
    const harness = TableHarness.create({ seed: 1 });
    harness.seatAll();
    for (const seat of SEAT_ORDER) harness.seat(seat).send("set_ready", undefined);
    harness.seat("south").send("start_deal", undefined);
    const frames = harness.frames("south");
    expect(frames.at(-1)).toEqual(expect.objectContaining({ kind: "reject", code: "FORBIDDEN" }));
  });

  it("rejects the host when not everyone is ready", () => {
    const harness = TableHarness.create({ seed: 1 });
    harness.seatAll();
    harness.seat("east").send("start_deal", undefined);
    expect(harness.frames("east").at(-1)).toEqual(
      expect.objectContaining({ kind: "reject", code: "NOT_IN_PHASE" }),
    );
  });

  it("succeeds for the host once all four are ready", () => {
    const harness = TableHarness.create({ seed: 1 });
    readyAllAndDeal(harness);
    expect(harness.state().lifecycle).toBe("in_play");
  });
});

describe("event distribution and privacy (docs/19 §6, docs/14 §5)", () => {
  it("broadcasts TilesDealt to every seat, each with only its own tiles", () => {
    const harness = TableHarness.create({ seed: 7 });
    readyAllAndDeal(harness);

    for (const viewer of SEAT_ORDER) {
      const dealt = harness
        .frames(viewer)
        .find((f) => f.kind === "event" && f.ev.type === "TilesDealt");
      expect(dealt).toBeDefined();
      if (dealt?.kind === "event" && dealt.ev.type === "TilesDealt") {
        const expectedSize = viewer === "east" ? 14 : 13;
        expect(dealt.ev.tiles).toHaveLength(expectedSize);
      }
    }
  });

  it("never lets a face belonging to another seat's concealed hand reach a different seat's frames", () => {
    const harness = TableHarness.create({ seed: 7 });
    readyAllAndDeal(harness);
    harness.seat("east").send("draw_tile", { end: "head" });

    const state = harness.state();
    if (state.lifecycle !== "in_play") throw new Error("unreachable");

    for (const viewer of SEAT_ORDER) {
      const serializedFrames = JSON.stringify(harness.frames(viewer));
      for (const other of SEAT_ORDER) {
        if (other === viewer) continue;
        for (const handle of state.locations.hands[other]) {
          expect(serializedFrames.includes(handle)).toBe(false);
        }
      }
    }
  });

  it("delivers a drawn tile's face only to the drawing seat's TileDrawn frame", () => {
    const harness = TableHarness.create({ seed: 7 });
    readyAllAndDeal(harness);
    harness.seat("east").send("draw_tile", { end: "head" });

    for (const viewer of SEAT_ORDER) {
      const drawn = harness.frames(viewer).find((f) => f.kind === "event" && f.ev.type === "TileDrawn");
      if (drawn?.kind === "event" && drawn.ev.type === "TileDrawn") {
        if (viewer === "east") {
          expect(drawn.ev.tile).toBeDefined();
        } else {
          expect(drawn.ev.tile).toBeUndefined();
        }
      }
    }
  });

  it("discarding then claiming produces the expected turn pointer and public tile face", () => {
    const harness = TableHarness.create({ seed: 7 });
    readyAllAndDeal(harness);
    const state = harness.state();
    if (state.lifecycle !== "in_play") throw new Error("unreachable");
    const tile = state.locations.hands.east[0]!;

    harness.seat("east").send("discard_tile", { handle: tile });
    harness.seat("north").send("claim_discard", { handle: tile });

    const claimed = harness
      .frames("south")
      .find((f) => f.kind === "event" && f.ev.type === "DiscardClaimed");
    expect(claimed?.kind === "event" && claimed.ev.type === "DiscardClaimed" && claimed.ev.turn).toBe(
      "north",
    );
  });
});

describe("close_table (docs/05 §4.1)", () => {
  it("is host-only", () => {
    const harness = TableHarness.create({ seed: 1 });
    harness.seatAll();
    harness.seat("south").send("close_table", undefined);
    expect(harness.frames("south").at(-1)).toEqual(
      expect.objectContaining({ kind: "reject", code: "FORBIDDEN" }),
    );
  });

  it("is refused while a game is in progress", () => {
    const harness = TableHarness.create({ seed: 1 });
    readyAllAndDeal(harness);
    harness.seat("east").send("close_table", undefined);
    expect(harness.frames("east").at(-1)).toEqual(
      expect.objectContaining({ kind: "reject", code: "NOT_IN_PHASE" }),
    );
  });

  it("succeeds for the host when idle", () => {
    const harness = TableHarness.create({ seed: 1 });
    harness.seatAll();
    harness.seat("east").send("close_table", undefined);
    expect(harness.table().status).toBe("closed");
  });
});

describe("forceClose (docs/18 §4.3 POST /admin/tables/{id}/force-close, FR-161)", () => {
  it("closes the table and purges the game even mid-play, unlike host close_table's own NOT_IN_PHASE guard", () => {
    const harness = TableHarness.create({ seed: 1 });
    readyAllAndDeal(harness);

    harness.forceClose("stuck table");

    expect(harness.table().status).toBe("closed");
    expect(harness.state().lifecycle).toBe("idle");
  });

  it("delivers TableClosed with the given reason to every seat", () => {
    const harness = TableHarness.create({ seed: 1 });
    harness.seatAll();

    harness.forceClose("policy violation");

    for (const seat of SEAT_ORDER) {
      expect(harness.frames(seat).at(-1)).toEqual(
        expect.objectContaining({ kind: "event", ev: { type: "TableClosed", reason: "policy violation" } }),
      );
    }
  });
});

describe("correction — actor-seq translation (docs/05 §8; the reconciliation actor.ts documents)", () => {
  it("propose_correction and CorrectionApplied use the client's actor-seq, not dealer-core's internal seq", () => {
    const harness = TableHarness.create({ seed: 42 });
    readyAllAndDeal(harness);
    const rewindTarget = harness.seqNumber(); // the actor-seq right after the deal

    harness.seat("east").send("draw_tile", { end: "head" }); // advances both actor-seq and dealer-core's seq
    harness
      .seat("south")
      .send("propose_correction", { rewindTo: rewindTarget });

    const proposed = harness
      .frames("south")
      .find((f) => f.kind === "event" && f.ev.type === "CorrectionProposed");
    expect(proposed?.kind === "event" && proposed.ev.type === "CorrectionProposed" && proposed.ev.rewindTo).toBe(
      rewindTarget,
    );

    harness.seat("east").send("respond_correction", { response: "accept" });
    harness.seat("west").send("respond_correction", { response: "accept" });
    harness.seat("north").send("respond_correction", { response: "accept" });

    const applied = harness
      .frames("north")
      .find((f) => f.kind === "event" && f.ev.type === "CorrectionApplied");
    expect(
      applied?.kind === "event" && applied.ev.type === "CorrectionApplied" && applied.ev.restoredSeq,
    ).toBe(rewindTarget);

    const state = harness.state();
    if (state.lifecycle !== "in_play") throw new Error("unreachable");
    expect(state.locations.wall).toHaveLength(99); // the draw was undone
  });

  it("rejects a rewindTo with no matching checkpoint", () => {
    const harness = TableHarness.create({ seed: 1 });
    readyAllAndDeal(harness);
    harness.seat("south").send("propose_correction", { rewindTo: 99999 });
    expect(harness.frames("south").at(-1)).toEqual(
      expect.objectContaining({ kind: "reject", code: "NO_CHECKPOINT" }),
    );
  });
});

describe("crash / restart (docs/29_Disaster_Recovery.md; DD-29, DD-30)", () => {
  it("preserves game state across a crash and restart", () => {
    const harness = TableHarness.create({ seed: 3 });
    readyAllAndDeal(harness);
    const before = harness.state();

    harness.crash();
    harness.restart();

    const after = harness.state();
    expect(after).toEqual(before);
  });

  it("continues to accept commands after restart", () => {
    const harness = TableHarness.create({ seed: 3 });
    readyAllAndDeal(harness);
    harness.crash();
    harness.restart();

    harness.seat("east").send("draw_tile", { end: "head" });
    const state = harness.state();
    if (state.lifecycle !== "in_play") throw new Error("unreachable");
    expect(state.locations.hands.east).toHaveLength(15);
  });

  it("preserves currentGameId across a crash and restart, minted fresh at start_deal", () => {
    const harness = TableHarness.create({ seed: 3 });
    expect(harness.currentGameId()).toBeNull(); // idle: nothing to checkpoint yet
    readyAllAndDeal(harness);
    const gameId = harness.currentGameId();
    expect(gameId).not.toBeNull();

    harness.crash();
    harness.restart();
    expect(harness.currentGameId()).toBe(gameId);
  });
});

describe("TableActor.fromRestoredParts (docs/29_Disaster_Recovery.md, process-restart recovery)", () => {
  it("starts idle with a caller-supplied table when no checkpoint exists", () => {
    const harness = TableHarness.create({ seed: 4 });
    harness.seatAll();
    const table = harness.table();

    const actor = TableActor.fromRestoredParts({ id: "harness-table", entropy: createDeterministicEntropy(4) }, table, null);
    expect(actor.tableSnapshot).toEqual(table);
    expect(actor.gameStateSnapshot.lifecycle).toBe("idle");
    expect(actor.currentGameId).toBeNull();
  });

  it("composes a caller-supplied table with a checkpoint's game-state portion", () => {
    const harness = TableHarness.create({ seed: 5 });
    readyAllAndDeal(harness);
    const snapshot = harness.snapshotForTest();
    const freshTable = harness.table(); // stands in for a TableRepository-sourced Table

    const actor = TableActor.fromRestoredParts(
      { id: "harness-table", entropy: createDeterministicEntropy(5) },
      freshTable,
      { seq: snapshot.seq, gameStateBytes: snapshot.gameStateBytes, gameId: snapshot.gameId },
    );
    expect(actor.gameStateSnapshot).toEqual(harness.state());
    expect(actor.seqNumber).toBe(harness.seqNumber());
    expect(actor.currentGameId).toBe(snapshot.gameId);
  });
});
