// Administrator provisioning (docs/15_Security_Architecture.md §8.2,
// docs/28_Operations.md §3.1, ADR-0017): out of band, never a REST
// endpoint. This module is the pure, testable half — building the
// account row, an initial password, and the TOTP secret's `otpauth://`
// URI — the same split `migrate.ts`'s `migrate()` keeps from a real
// connection: `scripts/provision-admin.ts` is the CLI wrapper that wires
// this to a live `Pool`/`AccountRepository`, the same way
// `packages/db/src/cli.ts` wraps `migrate()`.
import { randomBytes } from "node:crypto";
import type { AccountRole } from "@mahjong-dealer/db";
import { hashPassword } from "./passwords.js";
import type { NewAccount } from "./repository.js";
import { CURRENT_KEY_VERSION, encryptTotpSecret } from "./totp-encryption.js";
import { getTotpEncryptionKey } from "./totp-key.js";
import { buildOtpauthUri, generateTotpSecret } from "./totp.js";

const ADMIN_ROLE: AccountRole = "administrator";

export interface ProvisionedAdministrator {
  /** Pass to `AccountRepository.create` — the account and its TOTP secret are provisioned together, atomically (docs/15 §8.2). */
  readonly newAccount: NewAccount;
  /** Shown once, out of band, alongside `otpauthUri` — never stored or logged (docs/15 §8.2). */
  readonly password: string;
  /** For a QR code or manual entry into an authenticator app — the plaintext secret this display is the only copy of. */
  readonly otpauthUri: string;
}

/** A random, high-entropy initial password — script-generated, not user-chosen, so length alone (well above the 12-character policy floor) is the relevant property; there is nothing to check against a breach list. */
function generateProvisioningPassword(): string {
  return randomBytes(24).toString("base64url");
}

export async function provisionAdministrator(
  email: string,
  displayName: string,
  idFactory: () => string,
  env?: NodeJS.ProcessEnv,
): Promise<ProvisionedAdministrator> {
  const password = generateProvisioningPassword();
  const [passwordHash, totpSecret] = await Promise.all([
    hashPassword(password, env),
    Promise.resolve(generateTotpSecret()),
  ]);

  return {
    newAccount: {
      id: idFactory(),
      email,
      passwordHash,
      displayName,
      role: ADMIN_ROLE,
      totpSecret: encryptTotpSecret(totpSecret, getTotpEncryptionKey(env)),
      totpSecretKeyVersion: CURRENT_KEY_VERSION,
    },
    password,
    otpauthUri: buildOtpauthUri(totpSecret, email),
  };
}
