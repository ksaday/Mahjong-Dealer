// The provisioning script docs/28_Operations.md §3.1 specifies: "not a
// REST endpoint ... performs the whole procedure in one act" — generates
// the account and its TOTP secret together, atomically, and displays the
// secret once. `provisionAdministrator()` (`../auth/provisioning.js`) is
// the pure half that already does the generation and is already tested;
// this file is the thin, real-`AccountRepository` wrapper docs/28 §3.1
// calls for, split the same way `runProvisionAdmin`/`main` split in every
// other CLI in this codebase (see `packages/db/src/cli.ts`).
import { pathToFileURL } from "node:url";
import { Pool } from "pg";
import { uuidv7 } from "@mahjong-dealer/db";
import type { AccountRepository } from "../auth/repository.js";
import { provisionAdministrator } from "../auth/provisioning.js";
import { PostgresAccountRepository } from "../auth/postgres-repository.js";
import { loadConfig } from "../bootstrap/config.js";

export interface ProvisionAdminDeps {
  readonly accounts: AccountRepository;
  readonly idFactory?: () => string;
  readonly stdout?: (line: string) => void;
  readonly env?: NodeJS.ProcessEnv;
}

interface ParsedArgs {
  readonly email: string;
  readonly displayName: string;
}

function parseArgs(argv: readonly string[]): ParsedArgs {
  let email: string | undefined;
  let displayName: string | undefined;
  for (let i = 0; i < argv.length; i += 1) {
    const flag = argv[i];
    if (flag === "--email") {
      email = argv[i + 1];
      i += 1;
    } else if (flag === "--display-name") {
      displayName = argv[i + 1];
      i += 1;
    }
  }
  if (email === undefined || email.length === 0) {
    throw new Error("Usage: provision-admin --email <email> --display-name <name>");
  }
  if (displayName === undefined || displayName.length === 0) {
    throw new Error("Usage: provision-admin --email <email> --display-name <name>");
  }
  return { email, displayName };
}

/** Provisions one administrator account and prints its one-time credentials. Never logs or stores the plaintext password/secret anywhere but this single stdout write (docs/28 §3.1). */
export async function runProvisionAdmin(argv: readonly string[], deps: ProvisionAdminDeps): Promise<void> {
  const { email, displayName } = parseArgs(argv);
  const provisioned = await provisionAdministrator(email, displayName, deps.idFactory ?? uuidv7, deps.env);
  await deps.accounts.create(provisioned.newAccount);

  const print = deps.stdout ?? ((line: string) => console.log(line));
  print(`Administrator account created: ${email}`);
  print("Hand the following to the administrator through a separate out-of-band channel (docs/28 §3.1) — shown once, never stored:");
  print(`  Initial password: ${provisioned.password}`);
  print(`  TOTP enrollment URI: ${provisioned.otpauthUri}`);
}

// Real wiring, only when this file is run directly (`pnpm --filter
// @mahjong-dealer/server run provision:admin -- --email ... --display-name
// ...`) — not when `runProvisionAdmin` is imported for testing.
if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  const config = loadConfig();
  const pool = new Pool({ connectionString: config.databaseUrl });
  runProvisionAdmin(process.argv.slice(2), { accounts: new PostgresAccountRepository(pool) })
    .catch((error: unknown) => {
      console.error(error);
      process.exitCode = 1;
    })
    .finally(() => {
      void pool.end();
    });
}
