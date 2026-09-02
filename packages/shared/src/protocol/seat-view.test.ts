import { describe, expect, it } from "vitest";
import { GAME_STATES, TABLE_STATES } from "./seat-view.js";

describe("wire state enumerations", () => {
  it("has the four table states (docs/05 §4)", () => {
    expect(TABLE_STATES).toEqual(["open", "seated", "closed", "abandoned"]);
  });

  it("has the five game states (docs/09 §4)", () => {
    expect(GAME_STATES).toEqual(["idle", "dealing", "in_play", "concluding", "concluded"]);
  });
});
