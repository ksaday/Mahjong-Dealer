// The host's real `Entropy` source (dealer-core/src/entropy.ts): the
// platform's cryptographic RNG, one 32-bit word at a time. dealer-core
// itself stays pure and never imports `node:crypto` — this is the wiring
// the module comment there describes as "in production the host wires
// this to the platform's cryptographic source". Test code uses a seeded
// deterministic generator instead (dealer-core's own test helpers); this
// class exists for the real table registry (`tables/manager.ts`).
import { randomBytes } from "node:crypto";
import type { Entropy } from "@mahjong-dealer/dealer-core";

export class CryptoEntropy implements Entropy {
  nextUint32(): number {
    return randomBytes(4).readUInt32BE(0);
  }
}
