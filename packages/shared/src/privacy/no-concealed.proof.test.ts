import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const PROOF_FILE_PATH = fileURLToPath(new URL("./no-concealed.proof.ts", import.meta.url));
const REQUIRED_ASSERTIONS = 7;

describe("the NoConcealed proof file (docs/14 §6.3, TC-P06)", () => {
  it("still carries every required rejection assertion", () => {
    const source = readFileSync(PROOF_FILE_PATH, "utf8");
    const assertionCount = (source.match(/^\/\/ @ts-expect-error/gmu) ?? []).length;

    // A weakened NoConcealed<T> would make these `@ts-expect-error` comments
    // themselves fail to compile (an unused directive is a TypeScript
    // error), so `tsc` already guards the type-level claim. This count
    // guards the second way the proof could quietly lose its value: someone
    // deleting assertions outright rather than weakening the type.
    expect(assertionCount).toBe(REQUIRED_ASSERTIONS);
  });
});
