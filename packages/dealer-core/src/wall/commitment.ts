// The shuffle commitment (docs/08_Shuffle_and_Deal_Architecture.md §5, §6).
// `createHash` is pure — a deterministic function of its input bytes, with
// no OS entropy or I/O involved — so it is not one of the "crypto's random
// sources" the purity contract bans (docs/03_System_Architecture.md §5).
import { createHash } from "node:crypto";
import type { Salt } from "@mahjong-dealer/shared";
import { tileKey, type Tile } from "../tiles/tile.js";

/** ASCII Unit Separator: a single byte, never produced by the face codec (docs/08 §6). */
const SEPARATOR = "";

/**
 * The deterministic byte encoding of a wall order that the commitment
 * hashes: `face#copy` per tile, head to tail, joined by a single-byte
 * separator, UTF-8, no whitespace, no version prefix (docs/08 §6).
 */
export function canonicalWallEncoding(wallOrder: readonly Tile[]): string {
  return wallOrder.map(tileKey).join(SEPARATOR);
}

/** `SHA-256(canonical(wallOrder) ‖ salt)` (docs/08 §5.1). */
export function computeCommitment(wallOrder: readonly Tile[], salt: Salt): string {
  const canonicalBytes = Buffer.from(canonicalWallEncoding(wallOrder), "utf8");
  const saltBytes = Buffer.from(salt, "hex");
  return createHash("sha256").update(canonicalBytes).update(saltBytes).digest("hex");
}
