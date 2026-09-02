// The migration runner (docs/17_Database_Design.md §3: "forward-only; an
// applied migration is immutable; corrections are new migrations").
//
// Deliberately plain SQL files plus this minimal runner rather than an
// ORM's migration DSL (docs/03's proportionality judgment, ADR-0015,
// applied here too): the schema's load-bearing detail — column-level
// `REVOKE`/`GRANT`, append-only triggers — is exactly the kind of DDL an
// ORM abstraction tends to make awkward to express precisely.
import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { Client } from "pg";

const DEFAULT_MIGRATIONS_DIR = fileURLToPath(new URL("../migrations", import.meta.url));

export interface MigrateOptions {
  readonly connectionString: string;
  readonly migrationsDir?: string;
}

/** Applies every migration not yet recorded in `schema_migrations`, in filename order. Returns the ids applied. */
export async function migrate(options: MigrateOptions): Promise<readonly string[]> {
  const dir = options.migrationsDir ?? DEFAULT_MIGRATIONS_DIR;
  const files = (await readdir(dir)).filter((name) => name.endsWith(".sql")).sort();

  const client = new Client({ connectionString: options.connectionString });
  await client.connect();
  try {
    await client.query(
      `CREATE TABLE IF NOT EXISTS schema_migrations (
         id text PRIMARY KEY,
         applied_at timestamptz NOT NULL DEFAULT now()
       )`,
    );
    const { rows } = await client.query<{ id: string }>("SELECT id FROM schema_migrations");
    const alreadyApplied = new Set(rows.map((row) => row.id));

    const applied: string[] = [];
    for (const file of files) {
      if (alreadyApplied.has(file)) continue;
      const sql = await readFile(path.join(dir, file), "utf8");
      await client.query("BEGIN");
      try {
        await client.query(sql);
        await client.query("INSERT INTO schema_migrations (id) VALUES ($1)", [file]);
        await client.query("COMMIT");
      } catch (error) {
        await client.query("ROLLBACK");
        throw error;
      }
      applied.push(file);
    }
    return applied;
  } finally {
    await client.end();
  }
}

/** Lists migration filenames in the order `migrate` would apply them, without touching a database. */
export async function listMigrations(migrationsDir: string = DEFAULT_MIGRATIONS_DIR): Promise<readonly string[]> {
  const files = await readdir(migrationsDir);
  return files.filter((name) => name.endsWith(".sql")).sort();
}
