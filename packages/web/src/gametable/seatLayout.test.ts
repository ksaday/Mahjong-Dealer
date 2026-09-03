import { describe, expect, it } from "vitest";
import { relativePosition } from "./seatLayout.js";

describe("relativePosition (docs/32_UX/Table_Layout_and_Perspective.md §1)", () => {
  it("puts the viewer's own seat at the bottom", () => {
    expect(relativePosition("east", "east")).toBe("bottom");
    expect(relativePosition("south", "south")).toBe("bottom");
  });

  it("matches East's worked example: South right, West across, North left", () => {
    expect(relativePosition("east", "south")).toBe("right");
    expect(relativePosition("east", "west")).toBe("across");
    expect(relativePosition("east", "north")).toBe("left");
  });

  it("matches South's worked example: West right, North across, East left", () => {
    expect(relativePosition("south", "west")).toBe("right");
    expect(relativePosition("south", "north")).toBe("across");
    expect(relativePosition("south", "east")).toBe("left");
  });

  it("is consistent for West and North too", () => {
    expect(relativePosition("west", "north")).toBe("right");
    expect(relativePosition("west", "east")).toBe("across");
    expect(relativePosition("west", "south")).toBe("left");

    expect(relativePosition("north", "east")).toBe("right");
    expect(relativePosition("north", "south")).toBe("across");
    expect(relativePosition("north", "west")).toBe("left");
  });
});
