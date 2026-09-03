// Consolidates the wiring every `*/http.test.ts` file already
// hand-assembles per-test (see `admin/http.test.ts`'s `beforeEach`) into
// one reusable, fully dependency-injected constructor — the piece that
// was previously missing between "every module is built and tested" and
// "a process that actually runs." Takes repository *interfaces*, never
// concrete `Postgres*` classes, so it stays testable with in-memory
// implementations exactly like every other module in this codebase
// (`bootstrap/app.test.ts`); `main.ts` is the only caller that supplies
// real ones.
import Fastify, { type FastifyInstance } from "fastify";
import { uuidv7 } from "@mahjong-dealer/db";
import { registerAdminRoutes } from "../admin/http.js";
import { AdminService } from "../admin/service.js";
import type { AuditLogRepository } from "../audit/repository.js";
import { registerAuthRoutes } from "../auth/http.js";
import { NullBreachChecker, type BreachChecker } from "../auth/breach-checker.js";
import type { AccountRepository, SessionRepository } from "../auth/repository.js";
import { AuthService } from "../auth/service.js";
import { CryptoEntropy } from "../entropy.js";
import { applyCors } from "../http/cors.js";
import { applySecurityHeaders } from "../http/security-headers.js";
import { registerReadinessRoute, type ReadinessResult } from "../health/readiness.js";
import type { IdempotencyRepository } from "../idempotency/repository.js";
import { TableManager } from "../tables/manager.js";
import type { TableRepository } from "../tables/repository.js";
import { TableService } from "../tables/service.js";
import { registerTableRoutes } from "../tables/http.js";

export interface BuildAppOptions {
  readonly accounts: AccountRepository;
  readonly sessions: SessionRepository;
  readonly tables: TableRepository;
  readonly auditLog: AuditLogRepository;
  readonly idempotency?: IdempotencyRepository;
  /** Defaults to `NullBreachChecker` — the breach-list source is an explicitly unresolved item (IMPLEMENTATION_READINESS_CHECKLIST.md §4.2), not decided here. */
  readonly breachChecker?: BreachChecker;
  /** docs/15 §6: CORS and the WebSocket origin check share this allow-list. Defaults to empty — accept nothing cross-origin until configured. */
  readonly allowedOrigins?: readonly string[];
  readonly checkDatabase: () => Promise<ReadinessResult>;
  readonly env?: NodeJS.ProcessEnv;
  readonly now?: () => Date;
  readonly ownerNode?: string;
}

export interface BuiltApp {
  readonly app: FastifyInstance;
  /** Passed to `attachMultiTableGateway` (real wiring) or driven directly (tests). */
  readonly manager: TableManager;
}

export function buildApp(options: BuildAppOptions): BuiltApp {
  const authService = new AuthService({
    accounts: options.accounts,
    sessions: options.sessions,
    breachChecker: options.breachChecker ?? new NullBreachChecker(),
    auditLog: options.auditLog,
    ...(options.env !== undefined ? { env: options.env } : {}),
    ...(options.now !== undefined ? { now: options.now } : {}),
  });

  const manager = new TableManager(new CryptoEntropy(), (sessionId) => authService.isSessionActive(sessionId));

  const tableService = new TableService({
    tables: options.tables,
    accounts: options.accounts,
    manager,
    idFactory: uuidv7,
    ...(options.ownerNode !== undefined ? { ownerNode: options.ownerNode } : {}),
    ...(options.now !== undefined ? { now: options.now } : {}),
  });

  const adminService = new AdminService({
    accounts: options.accounts,
    sessions: options.sessions,
    tables: options.tables,
    manager,
    auditLog: options.auditLog,
    ...(options.now !== undefined ? { now: options.now } : {}),
  });

  const app = Fastify({ trustProxy: true });

  applySecurityHeaders(app);
  applyCors(app, options.allowedOrigins ?? []);

  registerAuthRoutes(app, { authService });
  registerTableRoutes(app, {
    authService,
    tableService,
    ...(options.idempotency !== undefined ? { idempotency: options.idempotency } : {}),
  });
  registerAdminRoutes(app, { authService, adminService });
  registerReadinessRoute(app, { checkDatabase: options.checkDatabase });

  return { app, manager };
}
