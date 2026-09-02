import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { listMigrations } from "./migrate.js";

const MIGRATIONS_DIR = fileURLToPath(new URL("../migrations", import.meta.url));

async function migrationText(file: string): Promise<string> {
  return readFile(`${MIGRATIONS_DIR}/${file}`, "utf8");
}

describe("listMigrations", () => {
  it("lists both migrations in filename order", async () => {
    expect(await listMigrations(MIGRATIONS_DIR)).toEqual([
      "0001_initial_schema.sql",
      "0002_roles_and_grants.sql",
    ]);
  });
});

// A schema smoke test: without a live database (none of the Postgres
// instances available in this environment belong to this project — see
// the session notes), this at least catches a typo or an accidentally
// dropped clause by checking the SQL text for what docs/17 requires.
describe("0001_initial_schema.sql — the eleven tables and the constraints from docs/17 §6", () => {
  it("creates all eleven tables", async () => {
    const sql = await migrationText("0001_initial_schema.sql");
    const tables = [
      "accounts",
      "sessions",
      "connect_tickets",
      "tables",
      "table_seats",
      "games",
      "checkpoints",
      "correction_checkpoints",
      "game_events",
      "command_receipts",
      "audit_log",
    ];
    for (const table of tables) {
      expect(sql).toMatch(new RegExp(`CREATE TABLE ${table} \\(`, "u"));
    }
  });

  it("declares the six native enumerations with their documented values", async () => {
    const sql = await migrationText("0001_initial_schema.sql");
    expect(sql).toContain("CREATE TYPE account_role AS ENUM ('player', 'administrator')");
    expect(sql).toContain("CREATE TYPE account_status AS ENUM ('active', 'disabled')");
    expect(sql).toContain("CREATE TYPE seat_position AS ENUM ('east', 'south', 'west', 'north')");
    expect(sql).toContain(
      "CREATE TYPE table_status AS ENUM ('open', 'seated', 'abandoned', 'closed')",
    );
    expect(sql).toContain(
      "CREATE TYPE game_state AS ENUM ('idle', 'dealing', 'in_play', 'concluding', 'concluded')",
    );
    expect(sql).toContain(
      "CREATE TYPE game_outcome AS ENUM ('declaration_accepted', 'ended_by_agreement', 'abandoned')",
    );
  });

  it("carries every constraint from the docs/17 §6 table", async () => {
    const sql = await migrationText("0001_initial_schema.sql");
    // One seat per account, platform-wide.
    expect(sql).toMatch(/UNIQUE INDEX table_seats_one_per_account_key ON table_seats \(account_id\)/u);
    // Exactly four seats, one occupant each.
    expect(sql).toContain("UNIQUE (table_id, seat)");
    // At most one live game per table.
    expect(sql).toMatch(/UNIQUE INDEX games_one_live_per_table_key ON games \(table_id\)/u);
    // Join codes unique among live tables, reusable after close.
    expect(sql).toMatch(/UNIQUE INDEX tables_join_code_hash_live_key ON tables \(join_code_hash\)/u);
    // Single-use tickets.
    expect(sql).toContain("ticket_hash bytea NOT NULL UNIQUE");
    // No duplicate sequence in the event log.
    expect(sql).toMatch(/UNIQUE \(game_id, seq\)/u);
    // Exactly-once command application.
    expect(sql).toContain("PRIMARY KEY (game_id, cmd_id)");
  });

  it("makes game_events and audit_log append-only by trigger", async () => {
    const sql = await migrationText("0001_initial_schema.sql");
    expect(sql).toContain("CREATE FUNCTION forbid_update_delete()");
    expect(sql).toMatch(/BEFORE UPDATE OR DELETE ON game_events/u);
    expect(sql).toMatch(/BEFORE UPDATE OR DELETE ON audit_log/u);
  });

  it("never mentions any economy or rule vocabulary (NR-1xx, NR-01x; TC-A06/TC-A01's spirit)", async () => {
    const sql = (await migrationText("0001_initial_schema.sql")).toLowerCase();
    const forbidden = [
      "balance",
      "wallet",
      "ledger",
      "posting",
      "price",
      "purchase",
      "penalty",
      "fee",
      "score",
      "points",
      "rule_version",
      "hand_pattern",
    ];
    for (const word of forbidden) {
      // Word-boundary match: "points" must not match inside "checkpoints".
      expect(sql).not.toMatch(new RegExp(`\\b${word}\\b`, "u"));
    }
  });
});

describe("0002_roles_and_grants.sql — column-level denial (docs/17 §7.2, D-17-03)", () => {
  it("revokes SELECT on the encrypted checkpoint tables from app before re-granting public columns", async () => {
    const sql = await migrationText("0002_roles_and_grants.sql");
    const revokeIndex = sql.indexOf("REVOKE SELECT ON checkpoints, correction_checkpoints FROM app");
    expect(revokeIndex).toBeGreaterThan(-1);
    expect(sql).not.toMatch(/GRANT SELECT ON (ALL TABLES IN SCHEMA public|checkpoints|correction_checkpoints) TO app;/u);
    // Every explicit re-grant of those two tables to `app` must be column-scoped.
    expect(sql).toMatch(/GRANT SELECT \([^)]*\) ON checkpoints TO app;/u);
    expect(sql).toMatch(/GRANT SELECT \([^)]*\) ON correction_checkpoints TO app;/u);
  });

  it("never grants app_readonly a whole-table SELECT on accounts or sessions", async () => {
    const sql = await migrationText("0002_roles_and_grants.sql");
    expect(sql).not.toMatch(/GRANT SELECT ON [^;]*\baccounts\b[^;]*TO app_readonly/u);
    expect(sql).not.toMatch(/GRANT SELECT ON [^;]*\bsessions\b[^;]*TO app_readonly/u);
    // password_hash, token_hash, and csrf_secret must not appear in any
    // app_readonly column grant.
    for (const secretColumn of ["password_hash", "token_hash", "csrf_secret"]) {
      expect(sql).not.toContain(secretColumn);
    }
  });

  it("creates the three documented roles", async () => {
    const sql = await migrationText("0002_roles_and_grants.sql");
    for (const role of ["app", "app_readonly", "migrator"]) {
      expect(sql).toContain(`CREATE ROLE ${role} LOGIN`);
    }
  });
});
