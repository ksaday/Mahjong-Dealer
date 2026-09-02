// Wall construction and the opening deal (docs/08_Shuffle_and_Deal_Architecture.md
// §7.1; docs/06_Digital_Dealer_Architecture.md DD-06 to DD-10; docs/07_Tile_Model.md
// §4). A single atomic transition (D-08-09, docs/09 §4.2): there is no
// intermediate state in which some seats hold tiles and others do not.
import type { Salt, Seat, TileHandle, WallOrder } from "@mahjong-dealer/shared";
import { SEAT_ORDER } from "@mahjong-dealer/shared";
import { draw256BitHex, type Entropy } from "../entropy.js";
import { mintHandles } from "../tiles/handles.js";
import { buildTileSet, compareTiles, type Tile } from "../tiles/tile.js";
import type { InPlayGameState, TileLocations } from "../state/state.js";
import { computeCommitment } from "./commitment.js";
import { shuffle } from "./shuffle.js";

/** Opening counts (docs/07 §4): a dealing procedure applied once, never enforced again. */
export const OPENING_HAND_COUNTS: Readonly<Record<Seat, number>> = {
  east: 14,
  south: 13,
  west: 13,
  north: 13,
};

/**
 * Builds the tile set, shuffles it, publishes a commitment, and deals the
 * opening hands, in one pass.
 *
 * The initial turn is set to `east`: docs/09 does not assign an opening
 * turn explicitly, but `east` deals fourteen tiles and therefore discards
 * first under the physical convention this system reproduces (docs/07 §4).
 * This is an implementation default, not a rule the core enforces — nothing
 * downstream depends on `east` being a "dealer" seat in any further sense.
 */
export function dealOpeningHands(entropy: Entropy): InPlayGameState {
  // A fixed, deterministic minting order. It has no bearing on security —
  // handle values are independently random regardless of minting order —
  // only on making the mint itself reproducible under a fixed entropy
  // stream, the same way the shuffle is (docs/08 §4.4).
  const sortedTiles = buildTileSet().slice().sort(compareTiles);
  const { handles, tileByHandle } = mintHandles(sortedTiles, entropy);

  const wallOrder = shuffle(handles, entropy);
  const salt = draw256BitHex(entropy) as Salt;
  const wallTilesInOrder = wallOrder.map((handle) => lookupTile(handle, tileByHandle));
  const commitment = computeCommitment(wallTilesInOrder, salt);

  let cursor = 0;
  const hands: Record<Seat, readonly TileHandle[]> = {} as Record<Seat, readonly TileHandle[]>;
  for (const seat of SEAT_ORDER) {
    const count = OPENING_HAND_COUNTS[seat];
    hands[seat] = wallOrder.slice(cursor, cursor + count);
    cursor += count;
  }
  const remainingWall = wallOrder.slice(cursor);

  const emptyExposures: Record<Seat, readonly TileHandle[]> = {} as Record<Seat, readonly TileHandle[]>;
  for (const seat of SEAT_ORDER) {
    emptyExposures[seat] = [];
  }

  const locations: TileLocations = {
    wall: remainingWall as unknown as WallOrder<TileHandle>,
    hands,
    discards: [],
    exposures: emptyExposures,
  };

  return {
    lifecycle: "in_play",
    seq: 1,
    turn: "east",
    tileByHandle,
    locations,
    salt,
    commitment,
  };
}

function lookupTile(handle: TileHandle, tileByHandle: ReadonlyMap<TileHandle, Tile>): Tile {
  const tile = tileByHandle.get(handle);
  if (tile === undefined) {
    throw new Error(`unreachable: handle ${handle} was just minted for this game`);
  }
  return tile;
}
