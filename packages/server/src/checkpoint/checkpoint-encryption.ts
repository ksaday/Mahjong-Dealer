// Application-layer AES-256-GCM for `checkpoints.private_state`
// (docs/17_Database_Design.md §7.1, D-17-05) — the same algorithm
// `auth/totp-encryption.ts` uses for `accounts.totp_secret`, keyed
// separately (`checkpoint-key.ts`), so rotating one key never touches rows
// encrypted under the other (D-17-15).
//
// Stored form: `iv (12 bytes) || authTag (16 bytes) || ciphertext`, one
// bytea column — identical wire shape to `totp-encryption.ts`.
// `CURRENT_KEY_VERSION` is written into `checkpoints.key_version` alongside
// it, the same provenance-only role `accounts.totp_secret_key_version`
// plays until a rotation path exists.
import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";

export const CURRENT_KEY_VERSION = 1;

const IV_BYTES = 12;
const AUTH_TAG_BYTES = 16;

export function encryptCheckpoint(plaintext: Buffer, key: Buffer): Buffer {
  const iv = randomBytes(IV_BYTES);
  const cipher = createCipheriv("aes-256-gcm", key, iv);
  const ciphertext = Buffer.concat([cipher.update(plaintext), cipher.final()]);
  const authTag = cipher.getAuthTag();
  return Buffer.concat([iv, authTag, ciphertext]);
}

export function decryptCheckpoint(stored: Buffer, key: Buffer): Buffer {
  if (stored.length < IV_BYTES + AUTH_TAG_BYTES) {
    throw new Error("stored checkpoint is shorter than iv + authTag — corrupt or wrong format");
  }
  const iv = stored.subarray(0, IV_BYTES);
  const authTag = stored.subarray(IV_BYTES, IV_BYTES + AUTH_TAG_BYTES);
  const ciphertext = stored.subarray(IV_BYTES + AUTH_TAG_BYTES);
  const decipher = createDecipheriv("aes-256-gcm", key, iv);
  decipher.setAuthTag(authTag);
  return Buffer.concat([decipher.update(ciphertext), decipher.final()]);
}
