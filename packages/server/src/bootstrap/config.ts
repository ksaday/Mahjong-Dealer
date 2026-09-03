// Startup configuration and secrets validation (docs/15_Security_Architecture.md
// §9, NFR-044; docs/21_Error_Handling_and_Recovery.md §7's "verify
// configuration and secrets" step; docs/27_Deployment_Architecture.md
// §4.2's "Production refuses to start on a missing or default secret").
//
// `getPasswordPepper` and `getTotpEncryptionKey` (`../auth/pepper.js`,
// `../auth/totp-key.js`) already implement the per-secret refuse-in-
// production check — this module's job is only to call every such check
// *eagerly*, at process startup (`main.ts`), rather than lazily on first
// use, so a bad deploy fails before it ever accepts traffic rather than
// on whichever request happens to touch that secret first. `DATABASE_URL`
// gets the identical treatment here since nothing else validates it.
import { getPasswordPepper } from "../auth/pepper.js";
import { getTotpEncryptionKey } from "../auth/totp-key.js";

const DEV_DEFAULT_DATABASE_URL = "postgres://mahjong_dealer_dev:insecure-dev-password@localhost:5432/mahjong_dealer_dev";
const DEFAULT_PORT = 3000; // matches packages/web/vite.config.ts's dev proxy target placeholder
const DEFAULT_HOST = "0.0.0.0";

export interface ServerConfig {
  readonly nodeEnv: string;
  readonly port: number;
  readonly host: string;
  readonly databaseUrl: string;
  readonly allowedOrigins: readonly string[];
  /** Not consumed here — validated eagerly so a bad value throws at startup, then read again where it's actually used. */
  readonly passwordPepper: string;
  readonly totpEncryptionKey: Buffer;
}

function getDatabaseUrl(env: NodeJS.ProcessEnv): string {
  const url = env["DATABASE_URL"];
  if (env["NODE_ENV"] === "production") {
    if (url === undefined || url.length === 0 || url === DEV_DEFAULT_DATABASE_URL) {
      throw new Error("DATABASE_URL is missing or is the development default; refusing to start in production (NFR-044)");
    }
    return url;
  }
  return url ?? DEV_DEFAULT_DATABASE_URL;
}

function getAllowedOrigins(env: NodeJS.ProcessEnv): readonly string[] {
  const raw = env["ALLOWED_ORIGINS"];
  if (raw === undefined || raw.trim().length === 0) return [];
  return raw
    .split(",")
    .map((origin) => origin.trim())
    .filter((origin) => origin.length > 0);
}

function getPort(env: NodeJS.ProcessEnv): number {
  const raw = env["PORT"];
  if (raw === undefined) return DEFAULT_PORT;
  const port = Number(raw);
  return Number.isInteger(port) && port > 0 ? port : DEFAULT_PORT;
}

/** Verifies every required secret up front (NFR-044) and assembles the rest of startup configuration. Throws in production on any missing or default secret — never starts on a placeholder. */
export function loadConfig(env: NodeJS.ProcessEnv = process.env): ServerConfig {
  return {
    nodeEnv: env["NODE_ENV"] ?? "development",
    port: getPort(env),
    host: env["HOST"] ?? DEFAULT_HOST,
    databaseUrl: getDatabaseUrl(env),
    allowedOrigins: getAllowedOrigins(env),
    passwordPepper: getPasswordPepper(env),
    totpEncryptionKey: getTotpEncryptionKey(env),
  };
}
