import { describe, expect, it } from "vitest";
import { createDeterministicEntropy } from "../testing/deterministic-entropy.js";
import { mintHandles } from "./handles.js";
import { buildTileSet } from "./tile.js";

describe("handle minting (docs/07_Tile_Model.md §5.1, §5.3; docs/06 DD-03)", () => {
  it("mints one handle per tile, all distinct", () => {
    const tiles = buildTileSet();
    const { handles, tileByHandle } = mintHandles(tiles, createDeterministicEntropy(5));
    expect(handles).toHaveLength(tiles.length);
    expect(new Set(handles).size).toBe(tiles.length);
    expect(tileByHandle.size).toBe(tiles.length);
  });

  it("maps each handle back to the tile it was minted for", () => {
    const tiles = buildTileSet();
    const { handles, tileByHandle } = mintHandles(tiles, createDeterministicEntropy(5));
    handles.forEach((handle, index) => {
      expect(tileByHandle.get(handle)).toEqual(tiles[index]);
    });
  });

  it("mints handles as 32 hex characters (128 bits)", () => {
    const tiles = buildTileSet().slice(0, 3);
    const { handles } = mintHandles(tiles, createDeterministicEntropy(5));
    for (const handle of handles) {
      expect(handle).toMatch(/^[0-9a-f]{32}$/u);
    }
  });

  it("mints different handles for the same tiles under a different seed", () => {
    const tiles = buildTileSet();
    const a = mintHandles(tiles, createDeterministicEntropy(1));
    const b = mintHandles(tiles, createDeterministicEntropy(2));
    expect(a.handles).not.toEqual(b.handles);
  });
});
