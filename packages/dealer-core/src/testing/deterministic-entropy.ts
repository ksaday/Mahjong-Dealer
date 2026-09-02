// A seeded, deterministic stand-in for the host-injected `Entropy` stream
// (docs/08_Shuffle_and_Deal_Architecture.md §4.4): not cryptographic, and
// never used outside tests. In production the host wires `Entropy` to the
// platform's cryptographic source instead — dealer-core cannot tell the
// difference, which is exactly the point of taking it as a parameter.
import type { Entropy } from "../entropy.js";

/** mulberry32 — small, fast, and good enough to make test fixtures reproducible. */
export function createDeterministicEntropy(seed: number): Entropy {
  let state = seed >>> 0;
  return {
    nextUint32(): number {
      state = (state + 0x6d2b79f5) | 0;
      let t = state;
      t = Math.imul(t ^ (t >>> 15), t | 1);
      t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
      return (t ^ (t >>> 14)) >>> 0;
    },
  };
}
