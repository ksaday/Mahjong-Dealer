// The REST surface for accounts and sessions (docs/18_API_Design.md §4.1;
// docs/33_API/REST_Endpoint_Catalog.md §3) — 8 of that catalog's endpoints.
// Thin: every handler validates its own request shape, then delegates to
// `AuthService`. No table, admin, or health endpoint is implemented here
// (docs/18 §4.2, §4.3) — those need the table actor's REST-facing half
// (create/join/connect-ticket) and the administrative surface, neither
// built yet.
//
// Scope note: `POST /accounts/me/password`'s own durable per-account rate
// limit (docs/18 §6: 3/hour) is not implemented — there is no schema
// column for it yet (docs/17 §5.1 has none), unlike login's
// failed_logins/locked_until. Flagged rather than silently skipped.
import cookie from "@fastify/cookie";
import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { TokenBucket } from "../gateway/rate-limit.js";
import { verifyCsrf } from "./csrf.js";
import type { AuthenticatedSession, AuthService } from "./service.js";

const SESSION_COOKIE = "__Host-session";
const CSRF_COOKIE = "__Host-csrf";
const CSRF_HEADER = "x-csrf-token";

declare module "fastify" {
  interface FastifyRequest {
    authSession?: AuthenticatedSession;
  }
}

export interface AuthRoutesOptions {
  readonly authService: AuthService;
  /** 3/hour per address (docs/18 §6). */
  readonly registrationLimiterFactory?: () => TokenBucket;
  /** 20/min per address (docs/18 §6) — the durable 5/min-per-account limit lives in AuthService via lockout.ts. */
  readonly loginLimiterFactory?: () => TokenBucket;
}

function errorBody(code: string, message: string): { error: { code: string; message: string } } {
  return { error: { code, message } };
}

function clientIp(request: FastifyRequest): string {
  return request.ip;
}

export function registerAuthRoutes(app: FastifyInstance, options: AuthRoutesOptions): void {
  const { authService } = options;
  const registrationLimiters = new Map<string, TokenBucket>();
  const loginLimiters = new Map<string, TokenBucket>();
  const makeRegistrationLimiter = options.registrationLimiterFactory ?? (() => new TokenBucket(3, 3 / 3600));
  const makeLoginLimiter = options.loginLimiterFactory ?? (() => new TokenBucket(20, 20 / 60));

  function limiterFor(map: Map<string, TokenBucket>, key: string, factory: () => TokenBucket): TokenBucket {
    let limiter = map.get(key);
    if (limiter === undefined) {
      limiter = factory();
      map.set(key, limiter);
    }
    return limiter;
  }

  app.register(cookie);

  async function requireSession(request: FastifyRequest, reply: FastifyReply): Promise<boolean> {
    const token = request.cookies[SESSION_COOKIE];
    if (token === undefined) {
      await reply.code(401).send(errorBody("NOT_AUTHENTICATED", "No valid session."));
      return false;
    }
    const authenticated = await authService.validateSession(token);
    if (authenticated === null) {
      await reply.code(401).send(errorBody("NOT_AUTHENTICATED", "No valid session."));
      return false;
    }
    request.authSession = authenticated;
    return true;
  }

  /** CSRF applies only to authenticated, state-changing requests (docs/15 §4.2) — nothing to protect before a session exists. */
  async function requireCsrf(request: FastifyRequest, reply: FastifyReply): Promise<boolean> {
    const session = request.authSession;
    if (session === undefined) {
      await reply.code(401).send(errorBody("NOT_AUTHENTICATED", "No valid session."));
      return false;
    }
    if (!verifyCsrf(session.session.csrf_secret, request.headers[CSRF_HEADER])) {
      await reply.code(403).send(errorBody("CSRF_INVALID", "Missing or invalid anti-forgery token."));
      return false;
    }
    return true;
  }

  app.post("/api/v1/accounts", async (request, reply) => {
    const ip = clientIp(request);
    if (!limiterFor(registrationLimiters, ip, makeRegistrationLimiter).tryConsume()) {
      await reply.header("Retry-After", "3600").code(429).send(errorBody("RATE_LIMITED", "Too many registrations."));
      return;
    }
    const body = request.body as Partial<{ email: string; password: string; display_name: string }>;
    if (typeof body.email !== "string" || typeof body.password !== "string" || typeof body.display_name !== "string") {
      await reply.code(400).send(errorBody("MALFORMED", "email, password, and display_name are required."));
      return;
    }
    const result = await authService.register(body.email, body.password, body.display_name);
    if (!result.ok) {
      await reply.code(422).send(errorBody(result.code, result.code === "PASSWORD_TOO_SHORT" ? "Password too short." : "Password appears in a known breach."));
      return;
    }
    await reply.code(201).send({ account_id: result.accountId });
  });

  app.post("/api/v1/sessions", async (request, reply) => {
    const ip = clientIp(request);
    if (!limiterFor(loginLimiters, ip, makeLoginLimiter).tryConsume()) {
      await reply.header("Retry-After", "60").code(429).send(errorBody("RATE_LIMITED", "Too many login attempts."));
      return;
    }
    const body = request.body as Partial<{ email: string; password: string }>;
    if (typeof body.email !== "string" || typeof body.password !== "string") {
      await reply.code(400).send(errorBody("MALFORMED", "email and password are required."));
      return;
    }

    const result = await authService.login(body.email, body.password, {
      ip,
      userAgent: request.headers["user-agent"] ?? null,
    });

    if (!result.ok) {
      if (result.code === "ACCOUNT_LOCKED") {
        await reply.code(423).send({
          error: { code: "ACCOUNT_LOCKED", message: "This account is temporarily locked." },
          locked_until: result.lockedUntil.toISOString(),
        });
        return;
      }
      const status = result.code === "ACCOUNT_DISABLED" ? 403 : 401;
      await reply.code(status).send(errorBody(result.code, "Invalid email or password."));
      return;
    }

    setSessionCookies(reply, result.issued.token, result.issued.session.csrf_secret, result.issued.session.absolute_expires_at);
    await reply.code(200).send({
      account_id: result.account.id,
      display_name: result.account.display_name,
      role: result.account.role,
    });
  });

  app.delete("/api/v1/sessions/current", async (request, reply) => {
    if (!(await requireSession(request, reply))) return;
    if (!(await requireCsrf(request, reply))) return;
    await authService.logout(request.authSession!.session.id);
    clearSessionCookies(reply);
    await reply.code(204).send();
  });

  app.get("/api/v1/accounts/me", async (request, reply) => {
    if (!(await requireSession(request, reply))) return;
    const { account } = request.authSession!;
    await reply.code(200).send({
      account_id: account.id,
      email: account.email,
      display_name: account.display_name,
      role: account.role,
      created_at: account.created_at.toISOString(),
    });
  });

  app.patch("/api/v1/accounts/me", async (request, reply) => {
    if (!(await requireSession(request, reply))) return;
    if (!(await requireCsrf(request, reply))) return;
    const body = request.body as Partial<{ display_name: string }>;
    if (body.display_name !== undefined) {
      if (typeof body.display_name !== "string" || body.display_name.trim().length === 0 || body.display_name.length > 50) {
        await reply.code(422).send(errorBody("DISPLAY_NAME_INVALID", "display_name must be 1-50 characters."));
        return;
      }
      await authService.updateDisplayName(request.authSession!.account.id, body.display_name);
    }
    await reply.code(200).send({ display_name: body.display_name ?? request.authSession!.account.display_name });
  });

  app.post("/api/v1/accounts/me/password", async (request, reply) => {
    if (!(await requireSession(request, reply))) return;
    if (!(await requireCsrf(request, reply))) return;
    const body = request.body as Partial<{ current_password: string; new_password: string }>;
    if (typeof body.current_password !== "string" || typeof body.new_password !== "string") {
      await reply.code(400).send(errorBody("MALFORMED", "current_password and new_password are required."));
      return;
    }
    const session = request.authSession!;
    const result = await authService.changePassword(
      session.account.id,
      body.current_password,
      body.new_password,
      session.session.id,
    );
    if (!result.ok) {
      const status = result.code === "INVALID_CREDENTIALS" ? 401 : 422;
      await reply.code(status).send(errorBody(result.code, "Could not change password."));
      return;
    }
    await reply.code(204).send();
  });

  app.get("/api/v1/accounts/me/sessions", async (request, reply) => {
    if (!(await requireSession(request, reply))) return;
    const session = request.authSession!;
    const sessions = await authService.listSessions(session.account.id);
    await reply.code(200).send({
      sessions: sessions.map((s) => ({
        id: s.id,
        issued_at: s.issued_at.toISOString(),
        last_seen_at: s.last_seen_at.toISOString(),
        ip: s.ip,
        user_agent: s.user_agent,
        current: s.id === session.session.id,
      })),
    });
  });

  app.delete<{ Params: { id: string } }>("/api/v1/accounts/me/sessions/:id", async (request, reply) => {
    if (!(await requireSession(request, reply))) return;
    if (!(await requireCsrf(request, reply))) return;
    const revoked = await authService.revokeOwnSession(request.authSession!.account.id, request.params.id);
    if (!revoked) {
      await reply.code(404).send(errorBody("NOT_FOUND", "No such session."));
      return;
    }
    await reply.code(204).send();
  });
}

function setSessionCookies(reply: FastifyReply, token: string, csrfSecret: string, expiresAt: Date): void {
  const cookieOptions = {
    path: "/",
    secure: true,
    httpOnly: true,
    sameSite: "lax" as const,
    expires: expiresAt,
  };
  void reply.setCookie(SESSION_COOKIE, token, cookieOptions);
  // The CSRF cookie is deliberately not HttpOnly: the client page reads it
  // to set the X-CSRF-Token header (that's the whole double-submit
  // mechanism) — HttpOnly here would make the pattern unusable.
  void reply.setCookie(CSRF_COOKIE, csrfSecret, { ...cookieOptions, httpOnly: false });
}

function clearSessionCookies(reply: FastifyReply): void {
  void reply.clearCookie(SESSION_COOKIE, { path: "/" });
  void reply.clearCookie(CSRF_COOKIE, { path: "/" });
}
