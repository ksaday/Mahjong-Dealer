import { describe, expect, it } from "vitest";
import { isSeat, nextSeat, SEAT_ORDER } from "./seat.js";

describe("seat order (docs/09_Game_State_Machine.md §6.2)", () => {
  it("has exactly four fixed seats", () => {
    expect(SEAT_ORDER).toEqual(["east", "south", "west", "north"]);
  });

  it("advances east -> south -> west -> north -> east", () => {
    expect(nextSeat("east")).toBe("south");
    expect(nextSeat("south")).toBe("west");
    expect(nextSeat("west")).toBe("north");
    expect(nextSeat("north")).toBe("east");
  });

  it("validates seat strings", () => {
    expect(isSeat("east")).toBe(true);
    expect(isSeat("center")).toBe(false);
  });
});
