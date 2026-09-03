// A thin CLI wrapper around `migrate()` (docs/27_Deployment_Architecture.md
// §5: "Migrations run before the application"). `migrate()` itself
// already separates its logic from a real connection (`MigrateOptions`);
// this file is the missing "and a CLI" half — previously nothing invoked
// it at all outside a test. Split into a testable `runMigrateCli` (the
// migration function is injected, so this is exercisable without a live
// database) and a `main()` guard that only runs on direct invocation.
import { pathToFileURL } from "node:url";
import { migrate, type MigrateOptions } from "./migrate.js";

export interface MigrateCliDeps {
  readonly migrate: (options: MigrateOptions) => Promise<readonly string[]>;
  readonly stdout?: (line: string) => void;
}

function parseConnectionString(argv: readonly string[], env: NodeJS.ProcessEnv): string {
  for (let i = 0; i < argv.length; i += 1) {
    if (argv[i] === "--database-url") {
      const value = argv[i + 1];
      if (value !== undefined) return value;
    }
  }
  const url = env["DATABASE_URL"];
  if (url === undefined || url.length === 0) {
    throw new Error("Usage: migrate --database-url <connection-string> (or set DATABASE_URL)");
  }
  return url;
}

export async function runMigrateCli(argv: readonly string[], deps: MigrateCliDeps, env: NodeJS.ProcessEnv = process.env): Promise<void> {
  const connectionString = parseConnectionString(argv, env);
  const applied = await deps.migrate({ connectionString });

  const print = deps.stdout ?? ((line: string) => console.log(line));
  if (applied.length === 0) {
    print("No new migrations to apply.");
  } else {
    print(`Applied ${applied.length} migration(s):`);
    for (const id of applied) print(`  ${id}`);
  }
}

// Real wiring, only when this file is run directly
// (`pnpm --filter @mahjong-dealer/db run migrate`) — not when
// `runMigrateCli` is imported for testing.
if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  runMigrateCli(process.argv.slice(2), { migrate }).catch((error: unknown) => {
    console.error(error);
    process.exitCode = 1;
  });
}
