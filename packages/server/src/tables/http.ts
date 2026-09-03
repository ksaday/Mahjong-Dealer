// The REST surface for tables (docs/18_API_Design.md §4.2;
// docs/33_API/REST_Endpoint_Catalog.md §4) — 6 of that catalog's 22
// endpoints (FR-025's `DELETE /tables/{id}/me` is the latest), alongside
// `auth/http.ts`'s and `admin/http.ts`'s own shares. Thin: every
// handler validates its own request shape, then delegates to
// `TableService`. Session and CSRF verification are shared with
// `auth/http.ts` via `session-guard.ts` — the same double-submit check,
// not a second implementation of it.
//
// `Idempotency-Key` on `POST /tables` (docs/18 §4.1's table, D-18-10) is
// honoured via `IdempotencyRepository` (`../idempotency/`): a cache hit
// short-circuits before the rate limiter and before `TableService`, so a
// retry costs the client neither a create-table slot nor a second
// resource. See that module's `repository.ts` for why the cached response
// may hold a plaintext `join_code` despite D-18-05.
//
// Requires `@fastify/cookie` to already be registered on `app` for
// `request.cookies` to exist — `auth/http.ts`'s `registerAuthRoutes`
// does this; a caller that registers only this module must register the
// plugin itself.
import type { FastifyInstance } from "fastify";
import { TokenBucket } from "../gateway/rate-limit.js";
import type { AuthService } from "../auth/service.js";
import { clientIp, errorBody, requireCsrf, requireSession } from "../auth/session-guard.js";
import { InMemoryIdempotencyRepository } from "../idempotency/memory-repository.js";
import type { IdempotencyRepository } from "../idempotency/repository.js";
import type { TableService } from "./service.js";

/** Bounds the D-18-05 exception in `../idempotency/repository.ts` — long enough to cover a client's retry, short enough that a leaked cache row is nearly worthless. */
const IDEMPOTENCY_TTL_MS = 10 * 60 * 1000;
const CREATE_TABLE_ENDPOINT = "POST /tables";
const IDEMPOTENCY_KEY_HEADER = "idempotency-key";
const IDEMPOTENCY_KEY_MAX_LENGTH = 255;

export interface TableRoutesOptions {
  readonly authService: AuthService;
  readonly tableService: TableService;
  readonly idempotency?: IdempotencyRepository;
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
  const idempotency = options.idempotency ?? new InMemoryIdempotencyRepository();
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

    const rawKey = request.headers[IDEMPOTENCY_KEY_HEADER];
    const idempotencyKey = typeof rawKey === "string" ? rawKey : undefined;
    if (idempotencyKey !== undefined) {
      if (idempotencyKey.length > IDEMPOTENCY_KEY_MAX_LENGTH) {
        await reply.code(400).send(errorBody("MALFORMED", "Idempotency-Key is too long."));
        return;
      }
      const cached = await idempotency.find(account.id, CREATE_TABLE_ENDPOINT, idempotencyKey);
      if (cached !== null) {
        await reply.code(cached.status).send(cached.body);
        return;
      }
    }

    if (!limiterFor(createLimiters, account.id, makeCreateLimiter).tryConsume()) {
      await reply.header("Retry-After", "3600").code(429).send(errorBody("RATE_LIMITED", "Too many tables created."));
      return;
    }
    const result = await tableService.createTable(account.id, account.display_name);
    if (!result.ok) {
      await reply.code(409).send(errorBody("ALREADY_SEATED", "You already hold a seat at a table."));
      return;
    }
    const body = { table_id: result.tableId, join_code: result.joinCode, seat: result.seat };
    if (idempotencyKey !== undefined) {
      await idempotency.store({
        accountId: account.id,
        endpoint: CREATE_TABLE_ENDPOINT,
        key: idempotencyKey,
        status: 201,
        body,
        expiresAt: new Date(Date.now() + IDEMPOTENCY_TTL_MS),
      });
    }
    await reply.code(201).send(body);
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

  app.delete<{ Params: { id: string } }>("/api/v1/tables/:id/me", async (request, reply) => {
    if (!(await requireSession(authService, request, reply))) return;
    if (!(await requireCsrf(request, reply))) return;
    const result = await tableService.leaveSeat(request.authSession!.account.id, request.params.id);
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
