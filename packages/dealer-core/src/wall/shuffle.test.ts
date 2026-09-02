import { describe, expect, it } from "vitest";
import { createDeterministicEntropy } from "../testing/deterministic-entropy.js";
import { shuffle } from "./shuffle.js";

describe("shuffle (docs/08_Shuffle_and_Deal_Architecture.md §4.2)", () => {
  it("is a permutation: same multiset, in a different order", () => {
    const items = Array.from({ length: 152 }, (_, i) => i);
    const shuffled = shuffle(items, createDeterministicEntropy(42));
    expect(shuffled).toHaveLength(items.length);
    expect(shuffled.slice().sort((a, b) => a - b)).toEqual(items);
    expect(shuffled).not.toEqual(items);
  });

  it("does not mutate the input array", () => {
    const items = [1, 2, 3, 4, 5];
    const copy = items.slice();
    shuffle(items, createDeterministicEntropy(7));
    expect(items).toEqual(copy);
  });

  it("is exactly reproducible from the same entropy seed (docs/08 §4.4)", () => {
    const items = Array.from({ length: 152 }, (_, i) => i);
    const a = shuffle(items, createDeterministicEntropy(1234));
    const b = shuffle(items, createDeterministicEntropy(1234));
    expect(a).toEqual(b);
  });

  it("produces different orders from different seeds", () => {
    const items = Array.from({ length: 152 }, (_, i) => i);
    const a = shuffle(items, createDeterministicEntropy(1));
    const b = shuffle(items, createDeterministicEntropy(2));
    expect(a).not.toEqual(b);
  });

  it("handles trivial arrays without error", () => {
    const entropy = createDeterministicEntropy(9);
    expect(shuffle([], entropy)).toEqual([]);
    expect(shuffle([1], entropy)).toEqual([1]);
  });
});
