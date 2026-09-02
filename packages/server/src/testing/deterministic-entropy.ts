// A seeded, deterministic stand-in for the host-injected `Entropy` stream
// (dealer-core's contract, docs/08_Shuffle_and_Deal_Architecture.md §4.4).
// Not cryptographic, and never used outside tests — in production the
// server wires `Entropy` to the platform's cryptographic source. Kept as
// its own small copy here rather than imported from dealer-core's
// equivalent test helper, which is intentionally not part of that
// package's public surface.
import type { Entropy } from "@mahjong-dealer/dealer-core";

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
