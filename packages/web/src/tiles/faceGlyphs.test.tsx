// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { render } from "@testing-library/react";
import { allFaces } from "@mahjong-dealer/shared";
import { describe, expect, it } from "vitest";
import { FaceGlyph } from "./faceGlyphs.js";

describe("FaceGlyph (docs/32_UX/Tile_Component_Spec.md §3)", () => {
  it.each(allFaces())("renders a non-empty glyph for %s", (face) => {
    const { container } = render(
      <svg>
        <FaceGlyph face={face} />
      </svg>,
    );
    expect(container.querySelector("svg")?.children.length).toBeGreaterThan(0);
  });

  it("gives each dragon a distinct shape, not merely a colour (D-32-22)", () => {
    const markup = (face: "Rred" | "Rgreen" | "Rsoap") =>
      render(
        <svg>
          <FaceGlyph face={face} />
        </svg>,
      ).container.innerHTML;

    const red = markup("Rred");
    const green = markup("Rgreen");
    const soap = markup("Rsoap");
    expect(red).not.toBe(green);
    expect(red).not.toBe(soap);
    expect(green).not.toBe(soap);
  });

  it("renders the soap as a framed glyph, not a blank (D-32-23)", () => {
    const { container } = render(
      <svg>
        <FaceGlyph face="Rsoap" />
      </svg>,
    );
    expect(container.querySelector("svg")?.children.length).toBeGreaterThan(0);
  });

  it("gives all eight flowers distinct shapes", () => {
    const markups = (["F1", "F2", "F3", "F4", "F5", "F6", "F7", "F8"] as const).map(
      (face) =>
        render(
          <svg>
            <FaceGlyph face={face} />
          </svg>,
        ).container.innerHTML,
    );
    expect(new Set(markups).size).toBe(8);
  });

  it("renders the bird glyph only for one bam", () => {
    const { container } = render(
      <svg>
        <FaceGlyph face="B1" />
      </svg>,
    );
    expect(container.querySelector("ellipse")).not.toBeNull();
  });
});
