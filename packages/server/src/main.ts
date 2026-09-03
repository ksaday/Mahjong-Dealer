// The real process entrypoint (docs/21_Error_Handling_and_Recovery.md §7:
// "verify configuration and secrets ... then verify schema version, then
// accept traffic" on startup; "stop accepting new connections; send
// notice; flush every checkpoint synchronously; close sockets with 1012;
// exit" on `SIGTERM`). Run with `pnpm --filter @mahjong-dealer/server run
// start`.
//
// Not exported from `index.ts` — that file is a pure library barrel (see
// its own header) — and not unit tested directly: everything it does is
// either already tested in isolation (`loadConfig`, `buildApp`,
// `TableGateway.notifyShuttingDown`, `TableManager.restoreLiveTables`/
// `flushAllCheckpointsSync`) or real I/O construction with nowhere left to
// delegate to. Every other file this session touched keeps exactly this
// split; this is the one place that can't.
//
// Two pools, deliberately (docs/17 §7.2, D-17-18): `pool` connects as the
// general `app` role; `checkpointReadPool` connects as
// `app_checkpoint_reader` (migration `0006`), the only role granted SELECT
// on `checkpoints.private_state` at all — used exclusively by
// `PostgresCheckpointRepository.readForRestore`.
//
// This machine's only Postgres instance belongs to a different, unrelated
// project and must not be touched — so this file, like every
// `Postgres*Repository`, is correct by construction but unverified
// against a live database.
import { Pool } from "pg";
import { PostgresAccountRepository, PostgresSessionRepository } from "./auth/postgres-repository.js";
import { PostgresAuditLogRepository } from "./audit/postgres-repository.js";
import { PostgresCheckpointRepository } from "./checkpoint/postgres-repository.js";
import { CheckpointWriter } from "./checkpoint/writer.js";
import { buildApp } from "./bootstrap/app.js";
import { loadConfig } from "./bootstrap/config.js";
import { attachMultiTableGateway } from "./gateway/multi-table-router.js";
import type { ReadinessResult } from "./health/readiness.js";
import { PostgresIdempotencyRepository } from "./idempotency/postgres-repository.js";
import { PostgresGamesRepository } from "./tables/postgres-games-repository.js";
import { PostgresTableRepository } from "./tables/postgres-repository.js";

async function main(): Promise<void> {
  const config = loadConfig();
  const pool = new Pool({ connectionString: config.databaseUrl });
  const checkpointReadPool = new Pool({ connectionString: config.checkpointReadDatabaseUrl });

  const checkDatabase = async (): Promise<ReadinessResult> => {
    try {
      const { rows } = await pool.query<{ id: string }>("SELECT id FROM schema_migrations ORDER BY applied_at DESC LIMIT 1");
      return { reachable: true, schemaVersion: rows[0]?.id ?? null };
    } catch {
      return { reachable: false, schemaVersion: null };
    }
  };

  const accounts = new PostgresAccountRepository(pool);
  const tables = new PostgresTableRepository(pool);
  const games = new PostgresGamesRepository(pool);
  const checkpoints = new PostgresCheckpointRepository(pool, checkpointReadPool);
  const checkpointWriter = new CheckpointWriter(checkpoints, games, config.checkpointEncryptionKey);

  const { app, manager } = buildApp({
    accounts,
    sessions: new PostgresSessionRepository(pool),
    tables,
    auditLog: new PostgresAuditLogRepository(pool),
    idempotency: new PostgresIdempotencyRepository(pool),
    checkpointWriter,
    allowedOrigins: config.allowedOrigins,
    checkDatabase,
  });

  // Verify schema version before accepting traffic (docs/21 §7).
  const readiness = await checkDatabase();
  if (!readiness.reachable) {
    throw new Error("database is unreachable at startup; refusing to accept traffic");
  }

  // Crash recovery (docs/29_Disaster_Recovery.md): every non-closed table
  // gets a live actor before traffic is accepted — restored from its
  // checkpoint where one exists, idle otherwise. A bad checkpoint for one
  // table is caught and logged without blocking the rest (D-21-02/03).
  await manager.restoreLiveTables({ tables, accounts, games, checkpointWriter });

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
      await manager.flushAllCheckpointsSync(); // D-21-11: synchronous, while the pool is still open
      await app.close(); // stop accepting new HTTP requests
      await pool.end();
      await checkpointReadPool.end();
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
