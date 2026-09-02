// Injected randomness (docs/03_System_Architecture.md §5; docs/08_Shuffle_and_Deal_Architecture.md
// §4.1, §4.4). `dealer-core` never generates randomness itself — it is pure —
// so every consumer of randomness takes an `Entropy` value supplied by the
// host. In production the host wires this to the platform's cryptographic
// source; in tests, to a seeded deterministic generator, which is what makes
// a shuffle exactly reproducible (§4.4).

export interface Entropy {
  /** The next uniformly-distributed unsigned 32-bit integer from the stream. */
  nextUint32(): number;
}

const UINT32_RANGE = 0x1_0000_0000;

/**
 * Rejection-sampled uniform integer in `[0, bound)` — never modulo reduction
 * (docs/08 §4.2, D-08-02). Modulo bias is small but real, and the shuffle's
 * entire claim in this system is fairness.
 */
export function uniformBelow(entropy: Entropy, bound: number): number {
  if (!Number.isInteger(bound) || bound <= 0) {
    throw new RangeError(`uniformBelow bound must be a positive integer, got ${bound}`);
  }
  if (bound > UINT32_RANGE) {
    throw new RangeError(`uniformBelow bound ${bound} exceeds the 32-bit entropy word range`);
  }
  // Largest multiple of `bound` that fits in the word range; draws landing at
  // or above it are biased toward the low end and are rejected and retried.
  const limit = UINT32_RANGE - (UINT32_RANGE % bound);
  let word = entropy.nextUint32();
  while (word >= limit) {
    word = entropy.nextUint32();
  }
  return word % bound;
}

/** 128 bits, as four drawn words, big-endian hex — enough for a tile handle (docs/07 §5.1). */
export function draw128BitHex(entropy: Entropy): string {
  let hex = "";
  for (let i = 0; i < 4; i += 1) {
    hex += entropy.nextUint32().toString(16).padStart(8, "0");
  }
  return hex;
}

/** 256 bits, as eight drawn words, big-endian hex — sized for the commitment salt (docs/08 §5.1). */
export function draw256BitHex(entropy: Entropy): string {
  let hex = "";
  for (let i = 0; i < 8; i += 1) {
    hex += entropy.nextUint32().toString(16).padStart(8, "0");
  }
  return hex;
}
