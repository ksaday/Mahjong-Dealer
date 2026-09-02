// Unbiased shuffle (docs/08_Shuffle_and_Deal_Architecture.md §4.2, D-08-02).
import { uniformBelow, type Entropy } from "../entropy.js";

/**
 * Fisher–Yates, descending, with rejection sampling at every index — never
 * modulo reduction. Returns a new array; does not mutate `items`.
 */
export function shuffle<T>(items: readonly T[], entropy: Entropy): T[] {
  const result = items.slice();
  for (let i = result.length - 1; i > 0; i -= 1) {
    const j = uniformBelow(entropy, i + 1);
    const a = result[i];
    const b = result[j];
    if (a === undefined || b === undefined) {
      throw new Error("unreachable: index within array bounds");
    }
    result[i] = b;
    result[j] = a;
  }
  return result;
}
