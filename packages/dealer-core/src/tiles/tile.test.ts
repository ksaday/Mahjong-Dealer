import { describe, expect, it } from "vitest";
import { buildTileSet, compareTiles, tileKey } from "./tile.js";

describe("tile-set construction (docs/06 DD-01, docs/07 §3)", () => {
  it("constructs exactly 152 tiles", () => {
    expect(buildTileSet()).toHaveLength(152);
  });

  it("gives every tile a distinct (face, copy) identity (DD-02)", () => {
    const tiles = buildTileSet();
    const keys = new Set(tiles.map(tileKey));
    expect(keys.size).toBe(152);
  });

  it("gives each dot/bam/crak face exactly 4 copies", () => {
    const tiles = buildTileSet();
    const d5 = tiles.filter((t) => t.face === "D5");
    expect(d5).toHaveLength(4);
    expect(new Set(d5.map((t) => t.copy)).size).toBe(4);
  });

  it("gives each wind and dragon face exactly 4 copies (36+16+12 = 64 honor+suit... )", () => {
    const tiles = buildTileSet();
    expect(tiles.filter((t) => t.face === "We")).toHaveLength(4);
    expect(tiles.filter((t) => t.face === "Rred")).toHaveLength(4);
  });

  it("gives each flower exactly 1 copy, and the joker exactly 8 (docs/07 §3.2)", () => {
    const tiles = buildTileSet();
    expect(tiles.filter((t) => t.face === "F1")).toHaveLength(1);
    expect(tiles.filter((t) => t.face === "J")).toHaveLength(8);
    expect(new Set(tiles.filter((t) => t.face === "J").map((t) => t.copy)).size).toBe(8);
  });

  it("orders tiles totally (docs/07 §6, D-07-07)", () => {
    const tiles = buildTileSet();
    const sorted = tiles.slice().sort(compareTiles);
    for (let i = 1; i < sorted.length; i += 1) {
      const prev = sorted[i - 1];
      const cur = sorted[i];
      if (prev === undefined || cur === undefined) throw new Error("unreachable");
      expect(compareTiles(prev, cur)).toBeLessThan(0);
    }
  });
});
