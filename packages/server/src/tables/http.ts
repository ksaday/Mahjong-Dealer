// The REST surface for tables (docs/18_API_Design.md §4.2;
// docs/33_API/REST_Endpoint_Catalog.md §4) — the remaining 5 of that
// catalog's 14 endpoints, alongside `auth/http.ts`'s 8. Thin: every
// handler validates its own request shape, then delegates to
// `TableService`. Session and CSRF verification are shared with
// `auth/http.ts` via `session-guard.ts` — the same double-submit check,
// not a second implementation of it.
//
// Scope note: `Idempotency-Key` on `POST /tables` (docs/18 §4.1's table,
// D-18-10) is not implemented — there is no idempotency-key store here,
// unlike a wire command's `cmdId` (docs/13 §4), which the gateway already
// tracks. Flagged rather than silently skipped, the same discipline
// `auth/http.ts` applies to its own known gap.
//
// Requires `@fastify/cookie` to already be registered on `app` for
// `request.cookies` to exist — `auth/http.ts`'s `registerAuthRoutes`
// does this; a caller that registers only this module must register the
// plugin itself.
import type { FastifyInstance } from "fastify";
import { TokenBucket } from "../gateway/rate-limit.js";
import type { AuthService } from "../auth/service.js";
import { clientIp, errorBody, requireCsrf, requireSession } from "../auth/session-guard.js";
import type { TableService } from "./service.js";

export interface TableRoutesOptions {
  readonly authService: AuthService;
  readonly tableService: TableService;
  /** 10/hour per account (docs/18 §6). */
  readonly createLimiterFactory?: () => TokenBucket;
  /** 10/min per account (docs/18 §6). */
  readonly joinLimiterFactory?: () => TokenBucket;
  /** 30/min per address (docs/18 §6). */
  readonly joinAddressLimiterFactory?: () => TokenBucket;
  /** 10/min per session (docs/18 §6). */
  readonly connectTicketLimiterFactory?: () => TokenBucket;
}

export function registerTableRoutes(app: FastifyInstance, options: TableRoutesOptions): void {
  const { authService, tableService } = options;
  const createLimiters = new Map<string, TokenBucket>();
  const joinAccountLimiters = new Map<string, TokenBucket>();
  const joinAddressLimiters = new Map<string, TokenBucket>();
  const connectTicketLimiters = new Map<string, TokenBucket>();
  const makeCreateLimiter = options.createLimiterFactory ?? (() => new TokenBucket(10, 10 / 3600));
  const makeJoinLimiter = options.joinLimiterFactory ?? (() => new TokenBucket(10, 10 / 60));
  const makeJoinAddressLimiter = options.joinAddressLimiterFactory ?? (() => new TokenBucket(30, 30 / 60));
  const makeConnectTicketLimiter = options.connectTicketLimiterFactory ?? (() => new TokenBucket(10, 10 / 60));

  function limiterFor(map: Map<string, TokenBucket>, key: string, factory: () => TokenBucket): TokenBucket {
    let limiter = map.get(key);
    if (limiter === undefined) {
      limiter = factory();
      map.set(key, limiter);
    }
    return limiter;
  }

  app.post("/api/v1/tables", async (request, reply) => {
    if (!(await requireSession(authService, request, reply))) return;
    if (!(await requireCsrf(request, reply))) return;
    const { account } = request.authSession!;
    if (!limiterFor(createLimiters, account.id, makeCreateLimiter).tryConsume()) {
      await reply.header("Retry-After", "3600").code(429).send(errorBody("RATE_LIMITED", "Too many tables created."));
      return;
    }
    const result = await tableService.createTable(account.id, account.display_name);
    if (!result.ok) {
      await reply.code(409).send(errorBody("ALREADY_SEATED", "You already hold a seat at a table."));
      return;
    }
    await reply.code(201).send({ table_id: result.tableId, join_code: result.joinCode, seat: result.seat });
  });

  app.post("/api/v1/tables/join", async (request, reply) => {
    if (!(await requireSession(authService, request, reply))) return;
    if (!(await requireCsrf(request, reply))) return;
    const { account } = request.authSession!;
    const ip = clientIp(request);
    if (
      !limiterFor(joinAccountLimiters, account.id, makeJoinLimiter).tryConsume() ||
      !limiterFor(joinAddressLimiters, ip, makeJoinAddressLimiter).tryConsume()
    ) {
      await reply.header("Retry-After", "60").code(429).send(errorBody("RATE_LIMITED", "Too many join attempts."));
      return;
    }
    const body = request.body as Partial<{ join_code: string }>;
    if (typeof body.join_code !== "string") {
      await reply.code(400).send(errorBody("MALFORMED", "join_code is required."));
      return;
    }
    const result = await tableService.joinTable(account.id, account.display_name, body.join_code);
    if (!result.ok) {
      const status = result.code === "ALREADY_SEATED" ? 409 : 404;
      const message = result.code === "ALREADY_SEATED" ? "You already hold a seat at a table." : "No such table.";
      await reply.code(status).send(errorBody(result.code, message));
      return;
    }
    await reply.code(200).send({ table_id: result.tableId, seat: result.seat });
  });

  app.get("/api/v1/tables/mine", async (request, reply) => {
    if (!(await requireSession(authService, request, reply))) return;
    const tables = await tableService.listMine(request.authSession!.account.id);
    await reply.code(200).send({
      tables: tables.map((t) => ({
        table_id: t.tableId,
        status: t.status,
        seat: t.seat,
        seats: t.seats.map((s) => ({ seat: s.seat, display_name: s.displayName, connected: s.connected })),
        game_state: t.gameState,
      })),
    });
  });

  app.delete<{ Params: { id: string } }>("/api/v1/tables/:id", async (request, reply) => {
    if (!(await requireSession(authService, request, reply))) return;
    if (!(await requireCsrf(request, reply))) return;
    const result = await tableService.closeTable(request.authSession!.account.id, request.params.id);
    if (!result.ok) {
      const status = result.code === "GAME_IN_PROGRESS" ? 409 : 404;
      const message = result.code === "GAME_IN_PROGRESS" ? "A game is in progress." : "No such table.";
      await reply.code(status).send(errorBody(result.code, message));
      return;
    }
    await reply.code(204).send();
  });

  app.post<{ Params: { id: string } }>("/api/v1/tables/:id/connect-ticket", async (request, reply) => {
    if (!(await requireSession(authService, request, reply))) return;
    if (!(await requireCsrf(request, reply))) return;
    const session = request.authSession!;
    if (!limiterFor(connectTicketLimiters, session.session.id, makeConnectTicketLimiter).tryConsume()) {
      await reply.header("Retry-After", "60").code(429).send(errorBody("RATE_LIMITED", "Too many ticket requests."));
      return;
    }
    const result = await tableService.issueConnectTicket(session.account.id, session.session.id, request.params.id);
    if (!result.ok) {
      await reply.code(404).send(errorBody("NOT_FOUND", "No such table, or you hold no seat here."));
      return;
    }
    await reply.code(201).send({ ticket: result.ticket, expires_at: result.expiresAt.toISOString() });
  });
}
