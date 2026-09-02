import { describe, expect, it } from "vitest";
import { COMMAND_NAMES, COMMAND_PARAMS_MAP_KEYS_MATCH } from "./commands.js";

describe("the command catalog (docs/19_WebSocket_Event_Catalog.md §5)", () => {
  it("has exactly thirty commands, including the three protocol commands", () => {
    expect(COMMAND_NAMES).toHaveLength(30);
  });

  it("has no duplicate names", () => {
    expect(new Set(COMMAND_NAMES).size).toBe(COMMAND_NAMES.length);
  });

  it("follows the naming law: lower_snake_case (docs/19 §3)", () => {
    for (const name of COMMAND_NAMES) {
      expect(name).toMatch(/^[a-z][a-z0-9]*(_[a-z0-9]+)*$/u);
    }
  });

  it("contains none of the forbidden, rule-derived vocabulary (docs/19 §3.1, §8)", () => {
    const forbidden = [
      "call",
      "pung",
      "kong",
      "quint",
      "charleston",
      "courtesy",
      "blind",
      "win",
      "dead",
      "valid",
      "legal",
      "score",
      "value",
      "points",
    ];
    for (const name of COMMAND_NAMES) {
      for (const word of forbidden) {
        // declare_mahjong is the one admitted exception (docs/19 §8.1) and
        // contains none of these forbidden words itself.
        expect(name.split("_")).not.toContain(word);
      }
    }
  });

  it("CommandParamsMap's keys exactly match CommandName (compile-time; asserted here too)", () => {
    expect(COMMAND_PARAMS_MAP_KEYS_MATCH).toBe(true);
  });
});
