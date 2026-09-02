import { describe, expect, it } from "vitest";
import { allFaces, compareFaces, faceGroup, isFace, parseFace } from "./face.js";

describe("face codec (docs/07_Tile_Model.md §5.2)", () => {
  it("recognizes exactly 43 distinct faces", () => {
    // 9 dots + 9 bams + 9 craks + 4 winds + 3 dragons + 8 flowers + 1 joker.
    expect(allFaces()).toHaveLength(43);
    expect(new Set(allFaces()).size).toBe(43);
  });

  it("round-trips every valid face through parseFace", () => {
    for (const face of allFaces()) {
      expect(parseFace(face)).toBe(face);
      expect(isFace(face)).toBe(true);
    }
  });

  it("rejects anything that is not a valid face code", () => {
    expect(isFace("D0")).toBe(false);
    expect(isFace("D10")).toBe(false);
    expect(isFace("Rblue")).toBe(false);
    expect(isFace("j")).toBe(false);
    expect(isFace("")).toBe(false);
    expect(() => parseFace("D10")).toThrow(TypeError);
  });

  it("assigns dragons the R prefix, never ambiguous with dots (docs/07 D-07-06)", () => {
    expect(isFace("Rred")).toBe(true);
    expect(faceGroup("Rred")).toBe("dragons");
  });

  it("models the eight flowers as eight distinct one-copy faces (docs/07 §3.2)", () => {
    const flowers = allFaces().filter((face) => faceGroup(face) === "flowers");
    expect(flowers).toHaveLength(8);
    expect(new Set(flowers).size).toBe(8);
  });

  it("orders faces totally: by group, then declared position (docs/07 §6, D-07-07)", () => {
    const faces = allFaces();
    for (let i = 0; i < faces.length; i += 1) {
      for (let j = 0; j < faces.length; j += 1) {
        const a = faces[i];
        const b = faces[j];
        if (a === undefined || b === undefined) {
          throw new Error("unreachable");
        }
        const cmp = compareFaces(a, b);
        if (i === j) {
          expect(cmp).toBe(0);
        } else {
          // Total: never "equal" for two distinct faces.
          expect(cmp).not.toBe(0);
          expect(Math.sign(cmp)).toBe(-Math.sign(compareFaces(b, a)));
        }
      }
    }
  });

  it("sorts dots before bams before craks before winds before dragons before flowers before jokers", () => {
    expect(compareFaces("D9", "B1")).toBeLessThan(0);
    expect(compareFaces("B9", "C1")).toBeLessThan(0);
    expect(compareFaces("C9", "We")).toBeLessThan(0);
    expect(compareFaces("Wn", "Rred")).toBeLessThan(0);
    expect(compareFaces("Rsoap", "F1")).toBeLessThan(0);
    expect(compareFaces("F8", "J")).toBeLessThan(0);
  });
});
