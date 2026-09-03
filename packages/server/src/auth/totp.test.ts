import { describe, expect, it } from "vitest";
import {
  base32Encode,
  buildOtpauthUri,
  computeTotpCode,
  generateTotpSecret,
  TOTP_SECRET_BYTES,
  totpStep,
  verifyTotpCode,
} from "./totp.js";

// RFC 6238 Appendix B's own test vectors: secret is the ASCII string
// "12345678901234567890" (20 bytes), SHA-1, 8-digit codes at T0=0,
// X=30s. This module produces 6-digit codes, so the expected values here
// are the RFC's own 8-digit outputs truncated the same way `computeTotpCode`
// truncates any digit count — mod 10^6 — not independently sourced.
const RFC_6238_SECRET = Buffer.from("12345678901234567890", "ascii");

describe("computeTotpCode (RFC 6238 Appendix B test vectors)", () => {
  it("matches the vector at T=59s (step 1)", () => {
    expect(computeTotpCode(RFC_6238_SECRET, 1n)).toBe("287082"); // 94287082 mod 1e6
  });

  it("matches the vector at T=1111111109s (step 37037036)", () => {
    expect(computeTotpCode(RFC_6238_SECRET, 37037036n)).toBe("081804"); // 07081804 mod 1e6
  });

  it("matches the vector at T=1111111111s (step 37037037)", () => {
    expect(computeTotpCode(RFC_6238_SECRET, 37037037n)).toBe("050471"); // 14050471 mod 1e6
  });

  it("matches the vector at T=1234567890s (step 41152263)", () => {
    expect(computeTotpCode(RFC_6238_SECRET, 41152263n)).toBe("005924"); // 89005924 mod 1e6
  });
});

describe("totpStep", () => {
  it("floors to the 30-second window", () => {
    expect(totpStep(new Date(59_000))).toBe(1n);
    expect(totpStep(new Date(60_000))).toBe(2n);
    expect(totpStep(new Date(89_000))).toBe(2n);
    expect(totpStep(new Date(90_000))).toBe(3n);
  });
});

describe("verifyTotpCode", () => {
  const secret = generateTotpSecret();
  const now = new Date("2026-01-01T00:00:00Z");
  const currentStep = totpStep(now);
  const currentCode = computeTotpCode(secret, currentStep);

  it("accepts the correct current-step code", () => {
    const result = verifyTotpCode({ secret, code: currentCode, lastUsedStep: null, now });
    expect(result).toEqual({ valid: true, step: currentStep });
  });

  it("accepts a code from one step of drift in either direction", () => {
    const prevCode = computeTotpCode(secret, currentStep - 1n);
    const nextCode = computeTotpCode(secret, currentStep + 1n);
    expect(verifyTotpCode({ secret, code: prevCode, lastUsedStep: null, now })).toEqual({
      valid: true,
      step: currentStep - 1n,
    });
    expect(verifyTotpCode({ secret, code: nextCode, lastUsedStep: null, now })).toEqual({
      valid: true,
      step: currentStep + 1n,
    });
  });

  it("rejects a code two steps out of drift tolerance", () => {
    const farCode = computeTotpCode(secret, currentStep + 2n);
    expect(verifyTotpCode({ secret, code: farCode, lastUsedStep: null, now })).toEqual({ valid: false });
  });

  it("rejects a wrong code", () => {
    const wrong = currentCode === "000000" ? "111111" : "000000";
    expect(verifyTotpCode({ secret, code: wrong, lastUsedStep: null, now })).toEqual({ valid: false });
  });

  it("rejects malformed input (not 6 digits)", () => {
    expect(verifyTotpCode({ secret, code: "12345", lastUsedStep: null, now })).toEqual({ valid: false });
    expect(verifyTotpCode({ secret, code: "abcdef", lastUsedStep: null, now })).toEqual({ valid: false });
  });

  it("rejects a replay of the exact step already recorded as used, even though the code is otherwise correct", () => {
    const result = verifyTotpCode({ secret, code: currentCode, lastUsedStep: currentStep, now });
    expect(result).toEqual({ valid: false });
  });

  it("rejects a code from a step before the last used one", () => {
    const olderCode = computeTotpCode(secret, currentStep - 1n);
    const result = verifyTotpCode({ secret, code: olderCode, lastUsedStep: currentStep, now });
    expect(result).toEqual({ valid: false });
  });

  it("accepts a step strictly after the last used one", () => {
    const nextCode = computeTotpCode(secret, currentStep + 1n);
    const result = verifyTotpCode({ secret, code: nextCode, lastUsedStep: currentStep, now });
    expect(result).toEqual({ valid: true, step: currentStep + 1n });
  });
});

describe("generateTotpSecret", () => {
  it("produces 160 random bits, different every call", () => {
    const a = generateTotpSecret();
    const b = generateTotpSecret();
    expect(a).toHaveLength(TOTP_SECRET_BYTES);
    expect(a.equals(b)).toBe(false);
  });
});

describe("base32Encode / buildOtpauthUri", () => {
  it("encodes without padding, uppercase RFC 4648 alphabet", () => {
    expect(base32Encode(Buffer.from("12345678901234567890", "ascii"))).toBe(
      "GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ",
    );
  });

  it("builds a valid otpauth:// URI carrying the base32 secret, issuer, and parameters", () => {
    const secret = Buffer.from("12345678901234567890", "ascii");
    const uri = buildOtpauthUri(secret, "admin@example.com");
    expect(uri).toContain("otpauth://totp/");
    expect(uri).toContain(encodeURIComponent("Mahjong Dealer:admin@example.com"));
    expect(uri).toContain("secret=GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ");
    expect(uri).toContain("algorithm=SHA1");
    expect(uri).toContain("digits=6");
    expect(uri).toContain("period=30");
  });
});
