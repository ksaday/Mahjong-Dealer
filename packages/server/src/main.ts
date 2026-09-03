// The real process entrypoint (docs/21_Error_Handling_and_Recovery.md §7:
// "verify configuration and secrets ... then verify schema version, then
// accept traffic" on startup; "stop accepting new connections; send
// notice; ...; close sockets with 1012; exit" on `SIGTERM`). Run with
// `pnpm --filter @mahjong-dealer/server run start`.
//
// Not exported from `index.ts` — that file is a pure library barrel (see
// its own header) — and not unit tested directly: everything it does is
// either already tested in isolation (`loadConfig`, `buildApp`,
// `TableGateway.notifyShuttingDown`) or real I/O construction with
// nowhere left to delegate to. Every other file this session touched
// keeps exactly this split; this is the one place that can't.
//
// Deliberately skips the "flush every checkpoint synchronously" step of
// graceful shutdown — see `gateway/gateway.ts`'s `notifyShuttingDown` doc
// comment: no checkpoint-persistence subsystem exists yet anywhere in
// this codebase (a real, separate gap, not decided here).
//
// This machine's only Postgres instance belongs to a different, unrelated
// project and must not be touched — so this file, like every
// `Postgres*Repository`, is correct by construction but unverified
// against a live database.
import { Pool } from "pg";
import { PostgresAccountRepository, PostgresSessionRepository } from "./auth/postgres-repository.js";
import { PostgresAuditLogRepository } from "./audit/postgres-repository.js";
import { buildApp } from "./bootstrap/app.js";
import { loadConfig } from "./bootstrap/config.js";
import { attachMultiTableGateway } from "./gateway/multi-table-router.js";
import type { ReadinessResult } from "./health/readiness.js";
import { PostgresIdempotencyRepository } from "./idempotency/postgres-repository.js";
import { PostgresTableRepository } from "./tables/postgres-repository.js";

async function main(): Promise<void> {
  const config = loadConfig();
  const pool = new Pool({ connectionString: config.databaseUrl });

  const checkDatabase = async (): Promise<ReadinessResult> => {
    try {
      const { rows } = await pool.query<{ id: string }>("SELECT id FROM schema_migrations ORDER BY applied_at DESC LIMIT 1");
      return { reachable: true, schemaVersion: rows[0]?.id ?? null };
    } catch {
      return { reachable: false, schemaVersion: null };
    }
  };

  const { app, manager } = buildApp({
    accounts: new PostgresAccountRepository(pool),
    sessions: new PostgresSessionRepository(pool),
    tables: new PostgresTableRepository(pool),
    auditLog: new PostgresAuditLogRepository(pool),
    idempotency: new PostgresIdempotencyRepository(pool),
    allowedOrigins: config.allowedOrigins,
    checkDatabase,
  });

  // Verify schema version before accepting traffic (docs/21 §7).
  const readiness = await checkDatabase();
  if (!readiness.reachable) {
    throw new Error("database is unreachable at startup; refusing to accept traffic");
  }

  await app.ready();
  const wss = attachMultiTableGateway({ server: app.server, manager, allowedOrigins: config.allowedOrigins });

  let shuttingDown = false;
  const shutdown = (signal: string): void => {
    if (shuttingDown) return;
    shuttingDown = true;
    app.log.info(`${signal} received; shutting down gracefully`);

    wss.close(); // stop accepting new WebSocket upgrades
    manager.shutdownAll(); // notice { service_restarting } + close 1012 to every connected seat

    void (async () => {
      await app.close(); // stop accepting new HTTP requests
      await pool.end();
      process.exit(0);
    })();
  };
  process.on("SIGTERM", () => {
    shutdown("SIGTERM");
  });
  process.on("SIGINT", () => {
    shutdown("SIGINT");
  });

  await app.listen({ port: config.port, host: config.host });
}

main().catch((error: unknown) => {
  console.error(error);
  process.exit(1);
});
