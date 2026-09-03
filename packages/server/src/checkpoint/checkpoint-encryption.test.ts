import { randomBytes } from "node:crypto";
import { describe, expect, it } from "vitest";
import { decryptCheckpoint, encryptCheckpoint } from "./checkpoint-encryption.js";

describe("encryptCheckpoint / decryptCheckpoint", () => {
  it("round-trips a plaintext exactly", () => {
    const key = randomBytes(32);
    const plaintext = Buffer.from(JSON.stringify({ hands: ["a", "b"], salt: "s3cr3t" }), "utf8");
    const decrypted = decryptCheckpoint(encryptCheckpoint(plaintext, key), key);
    expect(decrypted.equals(plaintext)).toBe(true);
  });

  it("produces a different ciphertext each call (random iv), same plaintext either way", () => {
    const key = randomBytes(32);
    const plaintext = Buffer.from("some checkpoint bytes", "utf8");
    const a = encryptCheckpoint(plaintext, key);
    const b = encryptCheckpoint(plaintext, key);
    expect(a.equals(b)).toBe(false);
    expect(decryptCheckpoint(a, key).equals(plaintext)).toBe(true);
    expect(decryptCheckpoint(b, key).equals(plaintext)).toBe(true);
  });

  it("fails to decrypt with the wrong key", () => {
    const key = randomBytes(32);
    const wrongKey = randomBytes(32);
    const stored = encryptCheckpoint(Buffer.from("checkpoint bytes", "utf8"), key);
    expect(() => decryptCheckpoint(stored, wrongKey)).toThrow();
  });

  it("fails to decrypt tampered ciphertext (GCM auth tag catches it)", () => {
    const key = randomBytes(32);
    const stored = encryptCheckpoint(Buffer.from("checkpoint bytes", "utf8"), key);
    const tampered = Buffer.from(stored);
    tampered[tampered.length - 1] = tampered[tampered.length - 1]! ^ 0xff;
    expect(() => decryptCheckpoint(tampered, key)).toThrow();
  });
});
