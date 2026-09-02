import { describe, expect, it } from "vitest";
import { EVENT_NAMES } from "./events.js";

describe("the table event catalog (docs/19_WebSocket_Event_Catalog.md §6)", () => {
  it("has no duplicate names", () => {
    expect(new Set(EVENT_NAMES).size).toBe(EVENT_NAMES.length);
  });

  // The doc's own revision history (§16) says "38 events"; a careful,
  // row-by-row transcription of §6.1-§6.7 gives 39 (this suite would fail
  // if a row were dropped to force the count down). Recorded as a probable
  // one-off error in the document's own summary line rather than silently
  // reconciled — worth confirming against the SSOT.
  it("has 39 events, by direct count of docs/19 §6.1-§6.7's rows", () => {
    expect(EVENT_NAMES).toHaveLength(39);
  });

  it("follows the naming law: PascalCase (docs/19 §3)", () => {
    for (const name of EVENT_NAMES) {
      expect(name).toMatch(/^[A-Z][a-zA-Z0-9]*$/u);
    }
  });

  it("contains none of the forbidden, rule-derived vocabulary (docs/19 §3.1, §8)", () => {
    const forbidden = ["Call", "Charleston", "Joker", "Win", "Dead", "Score", "Value"];
    for (const name of EVENT_NAMES) {
      for (const word of forbidden) {
        expect(name).not.toContain(word);
      }
    }
  });

  it("admits declare_mahjong's pair, MahjongDeclared, as the one stated exception (docs/19 §8.1)", () => {
    expect(EVENT_NAMES).toContain("MahjongDeclared");
  });
});
