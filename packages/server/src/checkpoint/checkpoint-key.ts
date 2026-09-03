// The checkpoint encryption key (docs/17_Database_Design.md §7.1;
// docs/29_Disaster_Recovery.md): distinct from the TOTP encryption key so
// rotating one never touches rows encrypted under the other (`totp-key.ts`'s
// own comment, D-17-15, already anticipates this). Same shape as
// `auth/pepper.ts`/`auth/totp-key.ts`: no secret manager integration yet, so
// this reads an environment variable — the interface a real secret manager
// would fill the same way (NFR-044).
const DEV_DEFAULT_KEY_HEX = "0".repeat(64); // 32 bytes of zeros — obviously not a real key

export function getCheckpointEncryptionKey(env: NodeJS.ProcessEnv = process.env): Buffer {
  const keyHex = env["CHECKPOINT_ENCRYPTION_KEY"];
  if (env["NODE_ENV"] === "production") {
    if (keyHex === undefined || keyHex.length === 0 || keyHex === DEV_DEFAULT_KEY_HEX) {
      throw new Error(
        "CHECKPOINT_ENCRYPTION_KEY is missing or is the development default; refusing to start in production (NFR-044)",
      );
    }
    return decodeKey(keyHex);
  }
  return decodeKey(keyHex ?? DEV_DEFAULT_KEY_HEX);
}

function decodeKey(keyHex: string): Buffer {
  const key = Buffer.from(keyHex, "hex");
  if (key.length !== 32) {
    throw new Error(`CHECKPOINT_ENCRYPTION_KEY must decode to 32 bytes (AES-256); got ${key.length}`);
  }
  return key;
}
