import type { Brand } from "./brand.js";

/**
 * An opaque, per-game wire identifier for a tile (docs/07_Tile_Model.md
 * §5.1, §5.3): 128 bits of cryptographically random data, minted fresh per
 * tile per game. Not concealed material — a handle reveals nothing by
 * itself and is meant to be sent to every seat. Branded for nominal typing
 * only, so an arbitrary string cannot be substituted for a real handle.
 */
export type TileHandle = Brand<string, "TileHandle">;
