// The REST surface for administration (docs/18_API_Design.md §4.3,
// docs/33_API/REST_Endpoint_Catalog.md) — the 6 endpoints of that
// catalog's administrative surface. Thin: every handler validates its own
// request shape, then delegates to `AdminService`. Session/CSRF
// verification reuses `session-guard.ts`'s `requireAdmin`/`requireCsrf`,
// the same discipline `auth/http.ts` and `tables/http.ts` already follow.
//
// Every endpoint here requires "session + second factor" per docs/18
// §4.3 — enforced entirely inside `requireAdmin` (session, role, and
// `mfa_verified_at`, `ADR-0017`), so nothing below has to know about it.
import type { FastifyInstance } from "fastify";
import type { AccountStatus } from "@mahjong-dealer/db";
import type { AuthService } from "../auth/service.js";
import { errorBody, requireAdmin, requireCsrf } from "../auth/session-guard.js";
import type { AdminService } from "./service.js";

export interface AdminRoutesOptions {
  readonly authService: AuthService;
  readonly adminService: AdminService;
}

const ACCOUNT_STATUSES: readonly AccountStatus[] = ["active", "disabled"];

function parsePage(query: Record<string, unknown>): { readonly limit: number; readonly offset: number } {
  const limit = Number(query["limit"] ?? 50);
  const offset = Number(query["offset"] ?? 0);
  return {
    limit: Number.isInteger(limit) && limit > 0 && limit <= 200 ? limit : 50,
    offset: Number.isInteger(offset) && offset >= 0 ? offset : 0,
  };
}

export function registerAdminRoutes(app: FastifyInstance, options: AdminRoutesOptions): void {
  const { authService, adminService } = options;

  app.get("/api/v1/admin/accounts", async (request, reply) => {
    if (!(await requireAdmin(authService, request, reply))) return;
    const query = request.query as Record<string, unknown>;
    const status = typeof query["status"] === "string" && ACCOUNT_STATUSES.includes(query["status"] as AccountStatus)
      ? (query["status"] as AccountStatus)
      : undefined;
    const search = typeof query["query"] === "string" ? query["query"] : undefined;
    const page = await adminService.listAccounts({
      ...parsePage(query),
      ...(status !== undefined ? { status } : {}),
      ...(search !== undefined ? { query: search } : {}),
    });
    await reply.code(200).send({
      total: page.total,
      accounts: page.accounts.map((a) => ({
        account_id: a.id,
        email: a.email,
        display_name: a.display_name,
        role: a.role,
        status: a.status,
        created_at: a.created_at.toISOString(),
      })),
    });
  });

  app.patch<{ Params: { id: string } }>("/api/v1/admin/accounts/:id", async (request, reply) => {
    if (!(await requireAdmin(authService, request, reply))) return;
    if (!(await requireCsrf(request, reply))) return;
    const body = request.body as Partial<{ status: string; reason: string }>;
    if (
      typeof body.status !== "string" ||
      !ACCOUNT_STATUSES.includes(body.status as AccountStatus) ||
      typeof body.reason !== "string" ||
      body.reason.trim().length === 0
    ) {
      await reply.code(400).send(errorBody("MALFORMED", "status (active|disabled) and a non-empty reason are required."));
      return;
    }
    const result = await adminService.setAccountStatus(
      request.authSession!.account.id,
      request.params.id,
      body.status as AccountStatus,
      body.reason,
    );
    if (!result.ok) {
      await reply.code(404).send(errorBody("NOT_FOUND", "No such account."));
      return;
    }
    await reply.code(200).send({ status: body.status });
  });

  app.get("/api/v1/admin/tables", async (request, reply) => {
    if (!(await requireAdmin(authService, request, reply))) return;
    const query = request.query as Record<string, unknown>;
    const page = await adminService.listTables(parsePage(query));
    await reply.code(200).send({
      total: page.total,
      tables: page.tables.map((t) => ({
        table_id: t.tableId,
        status: t.status,
        occupied_seats: t.occupiedSeats,
        created_at: t.createdAt.toISOString(),
        closed_at: t.closedAt?.toISOString() ?? null,
      })),
    });
  });

  app.post<{ Params: { id: string } }>("/api/v1/admin/tables/:id/force-close", async (request, reply) => {
    if (!(await requireAdmin(authService, request, reply))) return;
    if (!(await requireCsrf(request, reply))) return;
    const body = request.body as Partial<{ reason: string }>;
    if (typeof body.reason !== "string" || body.reason.trim().length === 0) {
      await reply.code(400).send(errorBody("MALFORMED", "A non-empty reason is required."));
      return;
    }
    const result = await adminService.forceCloseTable(request.authSession!.account.id, request.params.id, body.reason);
    if (!result.ok) {
      await reply.code(404).send(errorBody("NOT_FOUND", "No such table."));
      return;
    }
    await reply.code(204).send();
  });

  app.get("/api/v1/admin/health", async (request, reply) => {
    if (!(await requireAdmin(authService, request, reply))) return;
    const health = await adminService.health();
    await reply.code(200).send({
      uptime_seconds: health.uptimeSeconds,
      tables: { total: health.tables.total, live_in_this_process: health.tables.liveInThisProcess },
      connections: health.connections,
    });
  });

  app.get("/api/v1/admin/audit", async (request, reply) => {
    if (!(await requireAdmin(authService, request, reply))) return;
    const query = request.query as Record<string, unknown>;
    const action = typeof query["action"] === "string" ? query["action"] : undefined;
    const actorAccountId = typeof query["actor_account_id"] === "string" ? query["actor_account_id"] : undefined;
    const page = await adminService.auditEntries({
      ...parsePage(query),
      ...(action !== undefined ? { action } : {}),
      ...(actorAccountId !== undefined ? { actorAccountId } : {}),
    });
    await reply.code(200).send({
      total: page.total,
      entries: page.entries.map((e) => ({
        id: e.id,
        actor_account_id: e.actor_account_id,
        action: e.action,
        target_type: e.target_type,
        target_id: e.target_id,
        reason: e.reason,
        ip: e.ip,
        occurred_at: e.occurred_at.toISOString(),
      })),
    });
  });
}
