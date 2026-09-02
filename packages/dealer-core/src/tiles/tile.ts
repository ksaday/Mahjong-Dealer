// Tile identity and tile-set construction (docs/07_Tile_Model.md §3, §5;
// docs/06_Digital_Dealer_Architecture.md DD-01, DD-02). Owned by dealer-core,
// not `shared` (docs/03_System_Architecture.md §4.2): the face codec is
// shared because `web` must render faces, but the equipment counts and the
// tile-as-object model are dealer-core's tile-set-construction duty.
import { allFaces, faceGroup, compareFaces, type Face, type FaceGroup } from "@mahjong-dealer/shared";

/** A physical tile: one face, one copy (docs/07 §5.1, D-07-02). */
export interface Tile {
  readonly face: Face;
  readonly copy: number;
}

/** Copies per face, by group (docs/07 §3). Equipment, not a rule (§3.1). */
const COPIES_BY_GROUP: Readonly<Record<FaceGroup, number>> = {
  dots: 4,
  bams: 4,
  craks: 4,
  winds: 4,
  dragons: 4,
  flowers: 1,
  jokers: 8,
};

/**
 * Constructs the complete 152-tile equipment set (DD-01). Distinguishable
 * objects, not counts (D-07-02) — the eight jokers are eight distinct `Tile`
 * values, not one value with a multiplicity of eight.
 */
export function buildTileSet(): readonly Tile[] {
  const tiles: Tile[] = [];
  for (const face of allFaces()) {
    const copies = COPIES_BY_GROUP[faceGroup(face)];
    for (let copy = 0; copy < copies; copy += 1) {
      tiles.push({ face, copy });
    }
  }
  return tiles;
}

/**
 * A total order over tiles: by face (docs/07 §6), then by copy index. Never
 * returns 0 for two distinct tiles (D-07-07), because face+copy is exactly
 * the tile's identity.
 */
export function compareTiles(a: Tile, b: Tile): number {
  const byFace = compareFaces(a.face, b.face);
  if (byFace !== 0) {
    return byFace;
  }
  return a.copy - b.copy;
}

/**
 * `face#copy` (docs/07 §5.2). **A privacy hazard by construction**: this
 * form must never reach a log, a metric, or any wire frame — it exists only
 * for the canonical commitment encoding (docs/08 §6) and checkpoint bytes
 * (docs/16 §5), both server-internal.
 */
export function tileKey(tile: Tile): string {
  return `${tile.face}#${tile.copy}`;
}
