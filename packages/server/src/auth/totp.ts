// TOTP (RFC 6238, on top of RFC 4226's HOTP) for administrator step-up
// (docs/15_Security_Architecture.md §8.1, ADR-0017). HMAC-SHA1, 6 digits,
// 30-second period — the parameters ADR-0017 names for universal
// authenticator-app compatibility, not the strongest theoretically
// available (SHA-256/512 would be, but authenticator apps overwhelmingly
// only implement SHA-1).
//
// Pure: no I/O, no storage, no encryption. `totp-key.ts` and the
// `AccountRepository`/`AuthService` layers own the secret's lifecycle;
// this module only computes and verifies codes against bytes it's handed.
import { createHmac, randomBytes } from "node:crypto";

const PERIOD_SECONDS = 30;
const DIGITS = 6;
const DRIFT_STEPS = 1; // accepts the previous, current, or next 30-second window

export const TOTP_SECRET_BYTES = 20; // 160 bits — RFC 4226 §4's recommended HMAC-SHA1 key size

export function generateTotpSecret(): Buffer {
  return randomBytes(TOTP_SECRET_BYTES);
}

export function totpStep(now: Date, periodSeconds: number = PERIOD_SECONDS): bigint {
  return BigInt(Math.floor(now.getTime() / 1000 / periodSeconds));
}

/** RFC 4226 §5.3's dynamic truncation, applied to the HMAC-SHA1 of `step` as an 8-byte big-endian counter. */
export function computeTotpCode(secret: Buffer, step: bigint, digits: number = DIGITS): string {
  const counter = Buffer.alloc(8);
  counter.writeBigUInt64BE(step);
  const digest = createHmac("sha1", secret).update(counter).digest();

  const offset = digest[digest.length - 1]! & 0x0f;
  const binCode =
    ((digest[offset]! & 0x7f) << 24) |
    ((digest[offset + 1]! & 0xff) << 16) |
    ((digest[offset + 2]! & 0xff) << 8) |
    (digest[offset + 3]! & 0xff);

  const modulus = 10 ** digits;
  return String(binCode % modulus).padStart(digits, "0");
}

export interface TotpVerification {
  readonly secret: Buffer;
  readonly code: string;
  /** The account's durable replay guard (`accounts.totp_last_used_step`) — `null` if never verified. A step at or before this is rejected even if the code is otherwise correct. */
  readonly lastUsedStep: bigint | null;
  readonly now: Date;
}

export type TotpVerifyResult = { readonly valid: true; readonly step: bigint } | { readonly valid: false };

/**
 * Checks `code` against every step in `[current - DRIFT_STEPS, current + DRIFT_STEPS]`,
 * preferring the most recent candidate a match could belong to, and
 * rejects any step at or before `lastUsedStep` — replay prevention that
 * holds even for a code re-submitted within its own still-valid window
 * (docs/15 §8.1).
 */
export function verifyTotpCode({ secret, code, lastUsedStep, now }: TotpVerification): TotpVerifyResult {
  if (!/^\d{6}$/.test(code)) return { valid: false };

  const current = totpStep(now);
  for (let delta = DRIFT_STEPS; delta >= -DRIFT_STEPS; delta -= 1) {
    const step = current + BigInt(delta);
    if (lastUsedStep !== null && step <= lastUsedStep) continue;
    if (computeTotpCode(secret, step) === code) {
      return { valid: true, step };
    }
  }
  return { valid: false };
}

const BASE32_ALPHABET = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";

/** RFC 4648 base32, no padding — the form authenticator apps expect in an `otpauth://` URI. */
export function base32Encode(bytes: Buffer): string {
  let bits = 0;
  let value = 0;
  let output = "";
  for (const byte of bytes) {
    value = (value << 8) | byte;
    bits += 8;
    while (bits >= 5) {
      output += BASE32_ALPHABET[(value >>> (bits - 5)) & 0x1f];
      bits -= 5;
    }
  }
  if (bits > 0) {
    output += BASE32_ALPHABET[(value << (5 - bits)) & 0x1f];
  }
  return output;
}

/** `otpauth://` URI (Google Authenticator's key-URI format) for the provisioning script's one-time QR/text display. */
export function buildOtpauthUri(secret: Buffer, accountEmail: string, issuer = "Mahjong Dealer"): string {
  const label = encodeURIComponent(`${issuer}:${accountEmail}`);
  const params = new URLSearchParams({
    secret: base32Encode(secret),
    issuer,
    algorithm: "SHA1",
    digits: String(DIGITS),
    period: String(PERIOD_SECONDS),
  });
  return `otpauth://totp/${label}?${params.toString()}`;
}
