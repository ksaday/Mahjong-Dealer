// Opaque per-game tile handles (docs/07_Tile_Model.md §5.1, §5.3;
// docs/06_Digital_Dealer_Architecture.md DD-03).
import type { TileHandle } from "@mahjong-dealer/shared";
import { draw128BitHex, type Entropy } from "../entropy.js";
import type { Tile } from "./tile.js";
import { tileKey } from "./tile.js";

export interface HandleMint {
  /** Handles in the same order as the tiles passed to `mintHandles`. */
  readonly handles: readonly TileHandle[];
  readonly tileByHandle: ReadonlyMap<TileHandle, Tile>;
}

/**
 * Mints one fresh 128-bit random handle per tile (DD-03). Minted per game,
 * not globally (D-07-04): a handle from a concluded game carries no meaning
 * in this one.
 */
export function mintHandles(tiles: readonly Tile[], entropy: Entropy): HandleMint {
  const handles: TileHandle[] = [];
  const tileByHandle = new Map<TileHandle, Tile>();
  const seen = new Set<string>();

  for (const tile of tiles) {
    let handle: TileHandle;
    do {
      handle = draw128BitHex(entropy) as TileHandle;
      // A collision at 128 bits is astronomically unlikely; retrying keeps
      // the mint total and injective without ever assuming it can't happen.
    } while (seen.has(handle));
    seen.add(handle);
    handles.push(handle);
    tileByHandle.set(handle, tile);
  }

  if (tileByHandle.size !== tiles.length) {
    throw new Error(`unreachable: minted ${tileByHandle.size} handles for ${tiles.length} tiles`);
  }

  return { handles, tileByHandle };
}

/** `face#copy` for the tile a handle names — a privacy hazard; see `tileKey` (docs/07 §5.2). */
export function handleTileKey(handle: TileHandle, tileByHandle: ReadonlyMap<TileHandle, Tile>): string {
  const tile = tileByHandle.get(handle);
  if (tile === undefined) {
    throw new Error(`unreachable: handle ${handle} is not in this game's tile set`);
  }
  return tileKey(tile);
}
