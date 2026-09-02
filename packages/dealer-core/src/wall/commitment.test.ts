import { describe, expect, it } from "vitest";
import type { Salt } from "@mahjong-dealer/shared";
import { buildTileSet } from "../tiles/tile.js";
import { canonicalWallEncoding, computeCommitment } from "./commitment.js";

const SALT_A = "aa".repeat(32) as Salt;
const SALT_B = "bb".repeat(32) as Salt;

describe("the shuffle commitment (docs/08_Shuffle_and_Deal_Architecture.md §5, §6)", () => {
  it("is reproducible from the same wall and salt (TC-R07)", () => {
    const wall = buildTileSet();
    expect(computeCommitment(wall, SALT_A)).toBe(computeCommitment(wall, SALT_A));
  });

  it("changes if the wall order changes", () => {
    const wall = buildTileSet();
    const reordered = [...wall.slice(1), wall[0]!];
    expect(computeCommitment(wall, SALT_A)).not.toBe(computeCommitment(reordered, SALT_A));
  });

  it("changes if the salt changes", () => {
    const wall = buildTileSet();
    expect(computeCommitment(wall, SALT_A)).not.toBe(computeCommitment(wall, SALT_B));
  });

  it("produces a 64-character hex SHA-256 digest", () => {
    const wall = buildTileSet();
    expect(computeCommitment(wall, SALT_A)).toMatch(/^[0-9a-f]{64}$/u);
  });

  it("encodes the canonical wall with no whitespace or version prefix (docs/08 §6)", () => {
    const wall = buildTileSet().slice(0, 3);
    const encoded = canonicalWallEncoding(wall);
    expect(encoded).not.toMatch(/\s/u);
    expect(encoded.startsWith("v")).toBe(false);
  });
});
