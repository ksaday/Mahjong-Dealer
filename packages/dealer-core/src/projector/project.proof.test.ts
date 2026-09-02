import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const PROOF_FILE_PATH = fileURLToPath(new URL("./project.proof.ts", import.meta.url));
const REQUIRED_ASSERTIONS = 1;

describe("the SeatView proof file (docs/14 §6.2, §6.3, TC-P06)", () => {
  it("still carries its rejection assertion", () => {
    const source = readFileSync(PROOF_FILE_PATH, "utf8");
    const assertionCount = (source.match(/^\/\/ @ts-expect-error/gmu) ?? []).length;
    expect(assertionCount).toBe(REQUIRED_ASSERTIONS);
  });
});
