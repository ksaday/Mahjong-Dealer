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

function endByAgreement(harness: TableHarness): void {
  harness.seat("east").send("propose_end_game", undefined);
  harness.seat("south").send("respond_end_game", { response: "accept" });
  harness.seat("west").send("respond_end_game", { response: "accept" });
  harness.seat("north").send("respond_end_game", { response: "accept" });
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

  it("preserves cmdId idempotency across a crash and restart (docs/13 §4, ADR-0009)", () => {
    const harness = TableHarness.create({ seed: 3 });
    readyAllAndDeal(harness);
    const before = harness.actorForTest().submit("east", "draw_tile", { end: "head" }, { cmdId: "cmd-1" });
    expect(before.ok).toBe(true);

    harness.crash();
    harness.restart();

    const stateBeforeRetry = harness.state();
    const retry = harness.actorForTest().submit("east", "draw_tile", { end: "tail" }, { cmdId: "cmd-1" });

    expect(retry).toEqual(before); // the original seq, not re-applied
    expect(harness.state()).toEqual(stateBeforeRetry); // no second draw happened
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
      { seq: snapshot.seq, gameStateBytes: snapshot.gameStateBytes, gameId: snapshot.gameId, receipts: snapshot.receipts },
    );
    expect(actor.gameStateSnapshot).toEqual(harness.state());
    expect(actor.seqNumber).toBe(harness.seqNumber());
    expect(actor.currentGameId).toBe(snapshot.gameId);
  });

  it("replays correctionHistory into a fresh CheckpointHistory, oldest first, so a pre-restart target is still reachable (docs/17 §5.8, D-17-19)", () => {
    const harness = TableHarness.create({ seed: 6 });
    readyAllAndDeal(harness);
    const dealEntry = harness.actorForTest().latestCorrectionCheckpoint;
    if (dealEntry === null) throw new Error("unreachable");
    const dealBytes = harness.actorForTest().checkpointBytes();

    harness.seat("east").send("draw_tile", { end: "head" });
    const drawEntry = harness.actorForTest().latestCorrectionCheckpoint;
    if (drawEntry === null) throw new Error("unreachable");
    const snapshot = harness.snapshotForTest(); // current state, post-draw

    const actor = TableActor.fromRestoredParts(
      { id: "harness-table", entropy: createDeterministicEntropy(6) },
      harness.table(),
      { seq: snapshot.seq, gameStateBytes: snapshot.gameStateBytes, gameId: snapshot.gameId, receipts: snapshot.receipts },
      [
        { actorSeq: dealEntry.seq, gameStateBytes: dealBytes },
        { actorSeq: drawEntry.seq, gameStateBytes: snapshot.gameStateBytes },
      ],
    );

    expect(actor.latestCorrectionCheckpoint?.seq).toBe(drawEntry.seq);
    const outcome = actor.submit("south", "propose_correction", { rewindTo: dealEntry.seq });
    expect(outcome.ok).toBe(true);
  });

  it("defaults correctionHistory to empty — a restored table has no rewindable window until new entries accumulate", () => {
    const harness = TableHarness.create({ seed: 7 });
    readyAllAndDeal(harness);
    const snapshot = harness.snapshotForTest();

    const actor = TableActor.fromRestoredParts(
      { id: "harness-table", entropy: createDeterministicEntropy(7) },
      harness.table(),
      { seq: snapshot.seq, gameStateBytes: snapshot.gameStateBytes, gameId: snapshot.gameId, receipts: snapshot.receipts },
    );

    expect(actor.latestCorrectionCheckpoint).toBeNull();
    const rejected = actor.submit("south", "propose_correction", { rewindTo: snapshot.seq });
    expect(rejected).toEqual({ ok: false, code: "NO_CHECKPOINT" });
  });

  it("replays game.receipts, so a pre-restart cmdId retry still returns its original seq (docs/13 §4, ADR-0009)", () => {
    const harness = TableHarness.create({ seed: 8 });
    readyAllAndDeal(harness);
    const before = harness.actorForTest().submit("east", "draw_tile", { end: "head" }, { cmdId: "cmd-1" });
    expect(before.ok).toBe(true);
    const snapshot = harness.snapshotForTest();

    const actor = TableActor.fromRestoredParts(
      { id: "harness-table", entropy: createDeterministicEntropy(8) },
      harness.table(),
      { seq: snapshot.seq, gameStateBytes: snapshot.gameStateBytes, gameId: snapshot.gameId, receipts: snapshot.receipts },
    );

    expect(actor.acceptedCmdIds).toEqual(["cmd-1"]);
    const stateBeforeRetry = actor.gameStateSnapshot;
    const retry = actor.submit("east", "draw_tile", { end: "tail" }, { cmdId: "cmd-1" });
    expect(retry).toEqual(before);
    expect(actor.gameStateSnapshot).toEqual(stateBeforeRetry);
  });
});

describe("cmdId idempotency (docs/13 §4, ADR-0009)", () => {
  it("a duplicate cmdId returns the original seq without re-dispatching or pushing new frames", () => {
    const harness = TableHarness.create({ seed: 10 });
    readyAllAndDeal(harness);
    const actor = harness.actorForTest();
    const before = actor.gameStateSnapshot;
    if (before.lifecycle !== "in_play") throw new Error("unreachable");
    const handBefore = before.locations.hands.east.length;

    const first = actor.submit("east", "draw_tile", { end: "head" }, { cmdId: "cmd-1" });
    expect(first.ok).toBe(true);
    const framesBefore = SEAT_ORDER.map((seat) => actor.framesFor(seat).length);

    // Different params on the retry — proves the short-circuit precedes any re-validation entirely.
    const second = actor.submit("east", "draw_tile", { end: "tail" }, { cmdId: "cmd-1" });

    expect(second).toEqual(first);
    expect(SEAT_ORDER.map((seat) => actor.framesFor(seat).length)).toEqual(framesBefore);
    const after = actor.gameStateSnapshot;
    if (after.lifecycle !== "in_play") throw new Error("unreachable");
    expect(after.locations.hands.east).toHaveLength(handBefore + 1); // drawn exactly once
  });

  it("a fresh cmdId is applied normally, distinct from a duplicate of a different one", () => {
    const harness = TableHarness.create({ seed: 10 });
    readyAllAndDeal(harness);
    const actor = harness.actorForTest();

    const first = actor.submit("east", "draw_tile", { end: "head" }, { cmdId: "cmd-1" });
    const second = actor.submit("south", "draw_tile", { end: "head" }, { cmdId: "cmd-2" });

    expect(second.ok).toBe(true);
    if (first.ok && second.ok) expect(second.seq).toBe(first.seq + 1);
  });

  it("a rejected command's cmdId is not remembered — a later retry re-validates rather than replaying the rejection", () => {
    const harness = TableHarness.create({ seed: 11 });
    harness.seatAll();
    const actor = harness.actorForTest();

    const rejected = actor.submit("south", "close_table", undefined, { cmdId: "cmd-y" }); // FORBIDDEN: south isn't host
    expect(rejected).toEqual({ ok: false, code: "FORBIDDEN" });

    const accepted = actor.submit("east", "close_table", undefined, { cmdId: "cmd-y" }); // same cmdId, the host this time
    expect(accepted.ok).toBe(true);
  });

  it("clears on start_deal — pre-deal receipts (e.g. set_ready) don't survive into the game's own window", () => {
    const harness = TableHarness.create({ seed: 12 });
    harness.seatAll();
    const actor = harness.actorForTest();
    actor.submit("east", "set_ready", undefined, { cmdId: "ready-cmd" });
    expect(actor.acceptedCmdIds).toContain("ready-cmd");
    for (const seat of SEAT_ORDER) {
      if (seat !== "east") actor.submit(seat, "set_ready", undefined);
    }

    actor.submit("east", "start_deal", undefined);

    expect(actor.acceptedCmdIds).toEqual([]);
  });

  it("clears on close_table", () => {
    const harness = TableHarness.create({ seed: 13 });
    harness.seatAll();
    const actor = harness.actorForTest();
    actor.submit("east", "set_ready", undefined, { cmdId: "ready-cmd" });
    expect(actor.acceptedCmdIds).toContain("ready-cmd");

    actor.submit("east", "close_table", undefined);
    expect(actor.acceptedCmdIds).toEqual([]);
  });

  it("clears on forceClose, which bypasses submit()/dispatch() entirely", () => {
    const harness = TableHarness.create({ seed: 14 });
    readyAllAndDeal(harness);
    const actor = harness.actorForTest();
    actor.submit("east", "draw_tile", { end: "head" }, { cmdId: "draw-cmd" });
    expect(actor.acceptedCmdIds).toContain("draw-cmd");

    harness.forceClose("administrative action");
    expect(actor.acceptedCmdIds).toEqual([]);
  });
});

describe("a second game on the same table (FR-117, docs/09 §7, D-09-10, D-10-14)", () => {
  it("readiness clears automatically the moment the game concludes, with nobody explicitly clearing it", () => {
    const harness = TableHarness.create({ seed: 20 });
    readyAllAndDeal(harness);
    const actor = harness.actorForTest();
    for (const seat of SEAT_ORDER) {
      expect(actor.tableSnapshot.seats[seat].ready).toBe(true);
    }

    endByAgreement(harness);

    expect(actor.gameStateSnapshot.lifecycle).toBe("concluded");
    for (const seat of SEAT_ORDER) {
      expect(actor.tableSnapshot.seats[seat].ready).toBe(false);
    }
  });

  it("a stale pre-conclusion ready:true does not let a second start_deal succeed without fresh set_ready (D-09-10)", () => {
    const harness = TableHarness.create({ seed: 21 });
    readyAllAndDeal(harness);
    endByAgreement(harness);

    // No one has re-readied since the clear — start_deal must still be refused.
    const rejected = harness.actorForTest().submit("east", "start_deal", undefined);
    expect(rejected).toEqual({ ok: false, code: "NOT_IN_PHASE" });
  });

  it("start_deal succeeds a second time once all four seats re-ready, dealing a genuinely new game", () => {
    const harness = TableHarness.create({ seed: 22 });
    readyAllAndDeal(harness);
    const actor = harness.actorForTest();
    const firstGameId = harness.currentGameId();
    expect(firstGameId).not.toBeNull();

    endByAgreement(harness);
    expect(actor.gameStateSnapshot.lifecycle).toBe("concluded");

    for (const seat of SEAT_ORDER) {
      harness.seat(seat).send("set_ready", undefined);
    }
    const outcome = actor.submit("east", "start_deal", undefined);

    expect(outcome.ok).toBe(true);
    expect(actor.gameStateSnapshot.lifecycle).toBe("in_play");
    expect(harness.currentGameId()).not.toBeNull();
    expect(harness.currentGameId()).not.toBe(firstGameId);
  });

  it("re-readying one seat after conclusion doesn't disturb the other seats' already-cleared readiness", () => {
    const harness = TableHarness.create({ seed: 23 });
    readyAllAndDeal(harness);
    const actor = harness.actorForTest();
    endByAgreement(harness);
    for (const seat of SEAT_ORDER) {
      expect(actor.tableSnapshot.seats[seat].ready).toBe(false);
    }

    harness.seat("south").send("set_ready", undefined);

    expect(actor.tableSnapshot.seats.south.ready).toBe(true);
    for (const seat of SEAT_ORDER) {
      if (seat === "south") continue;
      expect(actor.tableSnapshot.seats[seat].ready).toBe(false);
    }

    // The same toggle repeated (a duplicate submit, no cmdId involved here)
    // must not spuriously re-clear anyone either — the guard is keyed on the
    // *previous* lifecycle, which is already "concluded" for every command
    // sent in this whole window, not on "is a set_ready command".
    harness.seat("west").send("set_ready", undefined);
    expect(actor.tableSnapshot.seats.south.ready).toBe(true);
    expect(actor.tableSnapshot.seats.west.ready).toBe(true);
  });
});

describe("seat presence (docs/19 §6.1, docs/22, FR-140)", () => {
  function newActor(seed: number): TableActor {
    return new TableActor({ id: "t1", entropy: createDeterministicEntropy(seed) });
  }

  it("occupySeat broadcasts SeatOccupied to every seat, including itself", () => {
    const actor = newActor(1);
    const before = actor.seqNumber;
    const result = actor.occupySeat("p1", "Alice");
    if (!result.ok) throw new Error("unreachable");

    expect(actor.seqNumber).toBe(before + 1);
    for (const seat of SEAT_ORDER) {
      expect(actor.framesFor(seat).at(-1)).toEqual(
        expect.objectContaining({ kind: "event", ev: { type: "SeatOccupied", seat: "east", displayName: "Alice" } }),
      );
    }
  });

  it("vacateSeat broadcasts SeatVacated to every seat", () => {
    const actor = newActor(2);
    const occupied = actor.occupySeat("p1", "Alice");
    if (!occupied.ok) throw new Error("unreachable");
    const before = actor.seqNumber;

    actor.vacateSeat("east");

    expect(actor.seqNumber).toBe(before + 1);
    for (const seat of SEAT_ORDER) {
      expect(actor.framesFor(seat).at(-1)).toEqual(
        expect.objectContaining({ kind: "event", ev: { type: "SeatVacated", seat: "east" } }),
      );
    }
  });

  it("setSeatConnection: connected -> away fires SeatDisconnected{reason:'away'} (docs/22 §4's first miss)", () => {
    const actor = newActor(3);
    actor.occupySeat("p1", "Alice");
    actor.setSeatConnection("east", "connected");
    const before = actor.seqNumber;

    actor.setSeatConnection("east", "away");

    expect(actor.seqNumber).toBe(before + 1);
    expect(actor.tableSnapshot.seats.east.connection).toBe("away");
    expect(actor.framesFor("south").at(-1)).toEqual(
      expect.objectContaining({ kind: "event", ev: { type: "SeatDisconnected", seat: "east", reason: "away" } }),
    );
  });

  it("setSeatConnection: away -> absent fires a second SeatDisconnected{reason:'absent'} (docs/22 §4's second miss)", () => {
    const actor = newActor(4);
    actor.occupySeat("p1", "Alice");
    actor.setSeatConnection("east", "connected");
    actor.setSeatConnection("east", "away");
    const before = actor.seqNumber;

    actor.setSeatConnection("east", "absent");

    expect(actor.seqNumber).toBe(before + 1);
    expect(actor.framesFor("south").at(-1)).toEqual(
      expect.objectContaining({ kind: "event", ev: { type: "SeatDisconnected", seat: "east", reason: "absent" } }),
    );
  });

  it("setSeatConnection: a clean connected -> absent skips away and still fires SeatDisconnected once", () => {
    const actor = newActor(5);
    actor.occupySeat("p1", "Alice");
    actor.setSeatConnection("east", "connected");
    const before = actor.seqNumber;

    actor.setSeatConnection("east", "absent");

    expect(actor.seqNumber).toBe(before + 1);
    expect(actor.framesFor("south").at(-1)).toEqual(
      expect.objectContaining({ kind: "event", ev: { type: "SeatDisconnected", seat: "east", reason: "absent" } }),
    );
  });

  it("setSeatConnection: any path back to connected fires SeatReconnected", () => {
    const actor = newActor(6);
    actor.occupySeat("p1", "Alice");
    actor.setSeatConnection("east", "absent");
    const before = actor.seqNumber;

    actor.setSeatConnection("east", "connected");

    expect(actor.seqNumber).toBe(before + 1);
    expect(actor.framesFor("south").at(-1)).toEqual(
      expect.objectContaining({ kind: "event", ev: { type: "SeatReconnected", seat: "east" } }),
    );
  });

  it("setSeatConnection is a no-op when the value is unchanged — no spurious re-broadcast", () => {
    const actor = newActor(7);
    actor.occupySeat("p1", "Alice");
    actor.setSeatConnection("east", "connected");
    const before = actor.seqNumber;
    const framesBefore = actor.framesFor("south").length;

    actor.setSeatConnection("east", "connected");

    expect(actor.seqNumber).toBe(before);
    expect(actor.framesFor("south")).toHaveLength(framesBefore);
  });

  it("viewFor reflects the real connection state — not a hardcoded default (closes the view.ts gap)", () => {
    const actor = newActor(8);
    actor.occupySeat("p1", "Alice");
    actor.setSeatConnection("east", "away");

    const summary = actor.viewFor("east").seats.find((s) => s.seat === "east");

    expect(summary?.connection).toBe("away");
  });
});
