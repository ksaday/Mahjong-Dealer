// Join codes (docs/15_Security_Architecture.md §7.2; docs/17_Database_Design.md
// §5.4): "a 32-character alphabet excluding visually confusable glyphs,
// over six positions" — Crockford's base32 alphabet, which drops I, L, O,
// and U for exactly that reason. Generated with the platform's
// cryptographic RNG (`node:crypto`, not dealer-core's injected `Entropy` —
// a join code is a REST/security concern, not a game-fairness one) and,
// like a session token (`auth/tokens.ts`), only its SHA-256 hash is ever
// stored (D-17-07): a database read yields no usable codes.
import { createHash, randomInt } from "node:crypto";

const ALPHABET = "0123456789ABCDEFGHJKMNPQRSTVWXYZ"; // 32 characters, Crockford base32
const LENGTH = 6;

export function generateJoinCode(): string {
  let code = "";
  for (let i = 0; i < LENGTH; i += 1) {
    code += ALPHABET[randomInt(ALPHABET.length)];
  }
  return code;
}

/** Not a documented decision either way — a mechanical convenience, not a rule: normalized to uppercase before hashing so a lowercase paste still matches. */
export function hashJoinCode(code: string): Buffer {
  return createHash("sha256").update(code.trim().toUpperCase(), "utf8").digest();
}
