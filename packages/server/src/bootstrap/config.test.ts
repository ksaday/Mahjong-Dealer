// TC-S16 (docs/25_Testing_Strategy.md §... , NFR-044): "A production
// build refuses to start with each required secret in turn absent or set
// to a development default." This is the first test in the codebase to
// actually exercise that refusal — `getPasswordPepper`/`getTotpEncryptionKey`
// implement the check but were previously only reachable lazily, from a
// real login/enrollment call.
import { describe, expect, it } from "vitest";
import { loadConfig } from "./config.js";

const VALID_PEPPER = "a-real-production-pepper-value";
const VALID_TOTP_KEY = "1".repeat(64);
const VALID_DATABASE_URL = "postgres://real-user:real-pass@db.internal:5432/mahjong_dealer";

function validEnv(overrides: Partial<NodeJS.ProcessEnv> = {}): NodeJS.ProcessEnv {
  return {
    NODE_ENV: "production",
    PASSWORD_PEPPER: VALID_PEPPER,
    TOTP_ENCRYPTION_KEY: VALID_TOTP_KEY,
    DATABASE_URL: VALID_DATABASE_URL,
    ...overrides,
  };
}

describe("loadConfig in production", () => {
  it("succeeds when every required secret is a real value", () => {
    const config = loadConfig(validEnv());
    expect(config.passwordPepper).toBe(VALID_PEPPER);
    expect(config.totpEncryptionKey.toString("hex")).toBe(VALID_TOTP_KEY);
    expect(config.databaseUrl).toBe(VALID_DATABASE_URL);
  });

  it("refuses to start when PASSWORD_PEPPER is absent", () => {
    expect(() => loadConfig(validEnv({ PASSWORD_PEPPER: undefined }))).toThrow(/PASSWORD_PEPPER/);
  });

  it("refuses to start when PASSWORD_PEPPER is the development default", () => {
    expect(() => loadConfig(validEnv({ PASSWORD_PEPPER: "insecure-development-pepper-do-not-use-in-production" }))).toThrow(
      /PASSWORD_PEPPER/,
    );
  });

  it("refuses to start when TOTP_ENCRYPTION_KEY is absent", () => {
    expect(() => loadConfig(validEnv({ TOTP_ENCRYPTION_KEY: undefined }))).toThrow(/TOTP_ENCRYPTION_KEY/);
  });

  it("refuses to start when TOTP_ENCRYPTION_KEY is the development default", () => {
    expect(() => loadConfig(validEnv({ TOTP_ENCRYPTION_KEY: "0".repeat(64) }))).toThrow(/TOTP_ENCRYPTION_KEY/);
  });

  it("refuses to start when DATABASE_URL is absent", () => {
    expect(() => loadConfig(validEnv({ DATABASE_URL: undefined }))).toThrow(/DATABASE_URL/);
  });

  it("refuses to start when DATABASE_URL is the development default", () => {
    expect(() =>
      loadConfig(validEnv({ DATABASE_URL: "postgres://mahjong_dealer_dev:insecure-dev-password@localhost:5432/mahjong_dealer_dev" })),
    ).toThrow(/DATABASE_URL/);
  });
});

describe("loadConfig outside production", () => {
  it("fills in development defaults for every secret and connection string", () => {
    const config = loadConfig({ NODE_ENV: "development" });
    expect(config.passwordPepper.length).toBeGreaterThan(0);
    expect(config.totpEncryptionKey).toHaveLength(32);
    expect(config.databaseUrl).toContain("mahjong_dealer_dev");
  });

  it("honors an explicit real value even outside production", () => {
    const config = loadConfig({ NODE_ENV: "development", PASSWORD_PEPPER: VALID_PEPPER, DATABASE_URL: VALID_DATABASE_URL });
    expect(config.passwordPepper).toBe(VALID_PEPPER);
    expect(config.databaseUrl).toBe(VALID_DATABASE_URL);
  });
});

describe("loadConfig's non-secret fields", () => {
  it("defaults the port to 3000, matching web's dev proxy target", () => {
    expect(loadConfig({ NODE_ENV: "development" }).port).toBe(3000);
  });

  it("reads an explicit PORT", () => {
    expect(loadConfig({ NODE_ENV: "development", PORT: "8080" }).port).toBe(8080);
  });

  it("falls back to the default port on a malformed PORT", () => {
    expect(loadConfig({ NODE_ENV: "development", PORT: "not-a-number" }).port).toBe(3000);
  });

  it("defaults allowedOrigins to empty", () => {
    expect(loadConfig({ NODE_ENV: "development" }).allowedOrigins).toEqual([]);
  });

  it("parses a comma-separated ALLOWED_ORIGINS, trimming whitespace", () => {
    const config = loadConfig({ NODE_ENV: "development", ALLOWED_ORIGINS: "https://a.example, https://b.example" });
    expect(config.allowedOrigins).toEqual(["https://a.example", "https://b.example"]);
  });
});
