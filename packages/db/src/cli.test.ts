// The migrate CLI's argv/env parsing and output, exercised with an
// injected stub `migrate` — no live database needed, same as
// `migrate.test.ts`'s own precedent.
import { describe, expect, it } from "vitest";
import { runMigrateCli } from "./cli.js";

describe("runMigrateCli", () => {
  it("passes a --database-url flag through to migrate()", async () => {
    const calls: string[] = [];
    const lines: string[] = [];
    await runMigrateCli(
      ["--database-url", "postgres://x/y"],
      {
        migrate: async (options) => {
          calls.push(options.connectionString);
          return ["0001_initial_schema.sql"];
        },
        stdout: (line) => lines.push(line),
      },
      {},
    );
    expect(calls).toEqual(["postgres://x/y"]);
    expect(lines.join("\n")).toContain("0001_initial_schema.sql");
  });

  it("falls back to DATABASE_URL from the environment", async () => {
    const calls: string[] = [];
    await runMigrateCli(
      [],
      {
        migrate: async (options) => {
          calls.push(options.connectionString);
          return [];
        },
      },
      { DATABASE_URL: "postgres://from-env/y" },
    );
    expect(calls).toEqual(["postgres://from-env/y"]);
  });

  it("reports when nothing new was applied", async () => {
    const lines: string[] = [];
    await runMigrateCli([], { migrate: async () => [], stdout: (line) => lines.push(line) }, { DATABASE_URL: "postgres://x/y" });
    expect(lines).toEqual(["No new migrations to apply."]);
  });

  it("throws with a usage message when no connection string is available", async () => {
    await expect(runMigrateCli([], { migrate: async () => [] }, {})).rejects.toThrow(/Usage/);
  });
});
