// Session tokens (docs/15_Security_Architecture.md §4.2): 256 bits from a
// cryptographic source; only the SHA-256 hash is ever stored, so a
// database read yields no usable session.
import { createHash, randomBytes } from "node:crypto";

export function generateSessionToken(): string {
  return randomBytes(32).toString("base64url");
}

export function hashToken(token: string): Buffer {
  return createHash("sha256").update(token, "utf8").digest();
}

/** The double-submit anti-forgery secret (docs/15 §4.2): sent as both a cookie and a header. */
export function generateCsrfSecret(): string {
  return randomBytes(32).toString("base64url");
}
