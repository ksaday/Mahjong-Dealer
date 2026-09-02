import type { Face } from "../tiles/face.js";
import type { Brand } from "./brand.js";

/**
 * A face value living in a context that is not itself public — inside a
 * seat's own concealed hand, or inside the wall. Called `TileFace` in
 * docs/14_Player_Privacy.md §6.1; named `ConcealedFace` here to keep it
 * distinct from the plain, unbranded `Face` codec type used where a face is
 * already public (discards, exposures — docs/14 §4).
 */
export type ConcealedFace = Brand<Face, "ConcealedFace">;

/** A seat's concealed tiles (docs/14 §6.1). */
export type ConcealedHand = Brand<readonly ConcealedFace[], "ConcealedHand">;

/**
 * The ordered, undealt wall. Generic over the host's tile representation
 * because the wall's concrete shape is owned by dealer-core
 * (docs/03_System_Architecture.md §4.2, docs/07_Tile_Model.md §8) — what
 * matters here is only the brand: no instantiation of this type may reach a
 * telemetry sink, because knowing the order is knowing the future
 * (docs/07 §8, NR-502).
 */
export type WallOrder<TTile = unknown> = Brand<readonly TTile[], "WallOrder">;

/**
 * The commitment salt for a shuffle (docs/08_Shuffle_and_Deal_Architecture.md
 * §5). Never revealed, at any time, to any principal.
 */
export type Salt = Brand<string, "Salt">;

/** The complete union of shapes `NoConcealed<T>` must render unusable. */
export type ConcealedMaterial = ConcealedFace | ConcealedHand | WallOrder<unknown> | Salt;
