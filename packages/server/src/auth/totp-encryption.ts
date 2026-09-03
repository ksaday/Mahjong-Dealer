// Application-layer AES-256-GCM for `accounts.totp_secret`
// (docs/17_Database_Design.md §7.1, D-17-15; ADR-0017) — the same
// algorithm docs/17 §7.1 specifies for checkpoint `private_state`, keyed
// separately (`totp-key.ts`).
//
// Stored form: `iv (12 bytes) || authTag (16 bytes) || ciphertext`, one
// bytea column. `CURRENT_KEY_VERSION` is written into
// `accounts.totp_secret_key_version` alongside it — unused for anything
// but recording provenance until a rotation path exists, the same
// placeholder role `checkpoints.key_version` already plays in this schema
// (D-17-05) ahead of checkpoint encryption itself being built.
import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";

export const CURRENT_KEY_VERSION = 1;

const IV_BYTES = 12;
const AUTH_TAG_BYTES = 16;

export function encryptTotpSecret(secret: Buffer, key: Buffer): Buffer {
  const iv = randomBytes(IV_BYTES);
  const cipher = createCipheriv("aes-256-gcm", key, iv);
  const ciphertext = Buffer.concat([cipher.update(secret), cipher.final()]);
  const authTag = cipher.getAuthTag();
  return Buffer.concat([iv, authTag, ciphertext]);
}

export function decryptTotpSecret(stored: Buffer, key: Buffer): Buffer {
  if (stored.length < IV_BYTES + AUTH_TAG_BYTES) {
    throw new Error("stored TOTP secret is shorter than iv + authTag — corrupt or wrong format");
  }
  const iv = stored.subarray(0, IV_BYTES);
  const authTag = stored.subarray(IV_BYTES, IV_BYTES + AUTH_TAG_BYTES);
  const ciphertext = stored.subarray(IV_BYTES + AUTH_TAG_BYTES);
  const decipher = createDecipheriv("aes-256-gcm", key, iv);
  decipher.setAuthTag(authTag);
  return Buffer.concat([decipher.update(ciphertext), decipher.final()]);
}
