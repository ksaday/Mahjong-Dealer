import { randomBytes } from "node:crypto";
import { describe, expect, it } from "vitest";
import { decryptTotpSecret, encryptTotpSecret } from "./totp-encryption.js";
import { generateTotpSecret } from "./totp.js";

describe("encryptTotpSecret / decryptTotpSecret", () => {
  it("round-trips a secret exactly", () => {
    const key = randomBytes(32);
    const secret = generateTotpSecret();
    const decrypted = decryptTotpSecret(encryptTotpSecret(secret, key), key);
    expect(decrypted.equals(secret)).toBe(true);
  });

  it("produces a different ciphertext each call (random iv), same plaintext either way", () => {
    const key = randomBytes(32);
    const secret = generateTotpSecret();
    const a = encryptTotpSecret(secret, key);
    const b = encryptTotpSecret(secret, key);
    expect(a.equals(b)).toBe(false);
    expect(decryptTotpSecret(a, key).equals(secret)).toBe(true);
    expect(decryptTotpSecret(b, key).equals(secret)).toBe(true);
  });

  it("fails to decrypt with the wrong key", () => {
    const key = randomBytes(32);
    const wrongKey = randomBytes(32);
    const stored = encryptTotpSecret(generateTotpSecret(), key);
    expect(() => decryptTotpSecret(stored, wrongKey)).toThrow();
  });

  it("fails to decrypt tampered ciphertext (GCM auth tag catches it)", () => {
    const key = randomBytes(32);
    const stored = encryptTotpSecret(generateTotpSecret(), key);
    const tampered = Buffer.from(stored);
    tampered[tampered.length - 1] = tampered[tampered.length - 1]! ^ 0xff;
    expect(() => decryptTotpSecret(tampered, key)).toThrow();
  });
});
