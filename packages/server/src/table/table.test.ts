import { describe, expect, it } from "vitest";
import { allReady, closeTable, createTable, occupySeat, setConnection, setReady, vacateSeat } from "./table.js";

describe("occupySeat (docs/05 §5, D-05-04)", () => {
  it("fills the lowest unoccupied seat in fixed order", () => {
    let table = createTable("t1");
    const first = occupySeat(table, "p1", "Alice");
    expect(first.ok).toBe(true);
    if (first.ok) {
      expect(first.seat).toBe("east");
      table = first.table;
    }
    const second = occupySeat(table, "p2", "Bob");
    if (second.ok) expect(second.seat).toBe("south");
  });

  it("makes the first occupant the host", () => {
    const result = occupySeat(createTable("t1"), "p1", "Alice");
    if (result.ok) expect(result.table.host).toBe("east");
  });

  it("starts a newly occupied seat as absent — connected only once its socket actually binds (docs/22 §3, FR-140)", () => {
    const result = occupySeat(createTable("t1"), "p1", "Alice");
    if (!result.ok) throw new Error("unreachable");
    expect(result.table.seats.east.connection).toBe("absent");
  });

  it("transitions to seated once the fourth seat is filled", () => {
    let table = createTable("t1");
    for (const [id, name] of [["p1", "A"], ["p2", "B"], ["p3", "C"]] as const) {
      const result = occupySeat(table, id, name);
      if (result.ok) table = result.table;
    }
    expect(table.status).toBe("open");
    const last = occupySeat(table, "p4", "D");
    if (last.ok) expect(last.table.status).toBe("seated");
  });

  it("rejects a player already seated at this table", () => {
    const first = occupySeat(createTable("t1"), "p1", "Alice");
    if (!first.ok) throw new Error("unreachable");
    const again = occupySeat(first.table, "p1", "Alice");
    expect(again).toEqual({ ok: false, code: "ALREADY_SEATED" });
  });

  it("rejects a fifth player with TABLE_FULL", () => {
    let table = createTable("t1");
    for (const id of ["p1", "p2", "p3", "p4"]) {
      const result = occupySeat(table, id, id);
      if (result.ok) table = result.table;
    }
    expect(occupySeat(table, "p5", "E")).toEqual({ ok: false, code: "TABLE_FULL" });
  });
});

describe("vacateSeat (docs/05 §5.2, NR-202)", () => {
  it("is forbidden while a game is in progress", () => {
    const occupied = occupySeat(createTable("t1"), "p1", "Alice");
    if (!occupied.ok) throw new Error("unreachable");
    expect(vacateSeat(occupied.table, "east", true)).toEqual({ ok: false, code: "GAME_IN_PROGRESS" });
  });

  it("returns the table to open when a seated table loses a seat", () => {
    let table = createTable("t1");
    for (const id of ["p1", "p2", "p3", "p4"]) {
      const result = occupySeat(table, id, id);
      if (result.ok) table = result.table;
    }
    expect(table.status).toBe("seated");
    const vacated = vacateSeat(table, "east", false);
    if (vacated.ok) expect(vacated.table.status).toBe("open");
  });

  it("reassigns the host when the host's seat is vacated", () => {
    let table = createTable("t1");
    for (const id of ["p1", "p2"]) {
      const result = occupySeat(table, id, id);
      if (result.ok) table = result.table;
    }
    expect(table.host).toBe("east");
    const vacated = vacateSeat(table, "east", false);
    if (vacated.ok) expect(vacated.table.host).toBe("south");
  });
});

describe("readiness and closing", () => {
  it("allReady is true only when all four seats are occupied and ready", () => {
    let table = createTable("t1");
    expect(allReady(table)).toBe(false);
    for (const id of ["p1", "p2", "p3", "p4"]) {
      const result = occupySeat(table, id, id);
      if (result.ok) table = result.table;
    }
    expect(allReady(table)).toBe(false);
    for (const seat of ["east", "south", "west", "north"] as const) {
      table = setReady(table, seat, true);
    }
    expect(allReady(table)).toBe(true);
  });

  it("closeTable is terminal", () => {
    const closed = closeTable(createTable("t1"));
    expect(closed.status).toBe("closed");
  });
});

describe("setConnection (docs/22 §3, FR-140)", () => {
  it("updates only the named seat's connection state", () => {
    let table = createTable("t1");
    for (const id of ["p1", "p2"]) {
      const result = occupySeat(table, id, id);
      if (result.ok) table = result.table;
    }
    table = setConnection(table, "east", "connected");
    expect(table.seats.east.connection).toBe("connected");
    expect(table.seats.south.connection).toBe("absent");
  });
});
