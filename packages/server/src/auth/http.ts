// The REST surface for accounts and sessions (docs/18_API_Design.md §4.1;
// docs/33_API/REST_Endpoint_Catalog.md §3) — 9 of that catalog's
// endpoints. Thin: every handler validates its own request shape, then
// delegates to `AuthService`. The five table endpoints are `tables/http.ts`
// (docs/18 §4.2); the administrative surface (docs/18 §4.3) is `admin/`.
// Session/CSRF verification is shared with those modules via
// `session-guard.ts`.
//
// `POST /accounts/me/password`'s own durable per-account rate limit
// (docs/18 §6: 3/hour) is enforced inside `AuthService.changePassword`
// via `password-change-limit.ts`, against `accounts.password_change_count`/
// `password_change_window_started_at` (docs/17 §5.1) — this handler only
// translates the `RATE_LIMITED` result to `429`. `POST /sessions/mfa`'s
// own durable lockout (docs/15 §8.1, `D-17-16`) lives the same way,
// inside `AuthService.verifyMfa`.
import cookie from "@fastify/cookie";
import type { FastifyInstance, FastifyReply } from "fastify";
import { TokenBucket } from "../gateway/rate-limit.js";
import {
  clientIp,
  CSRF_COOKIE,
  errorBody,
  requireCsrf,
  requireSession,
  SESSION_COOKIE,
} from "./session-guard.js";
import type { AuthService } from "./service.js";

export interface AuthRoutesOptions {
  readonly authService: AuthService;
  /** 3/hour per address (docs/18 §6). */
  readonly registrationLimiterFactory?: () => TokenBucket;
  /** 20/min per address (docs/18 §6) — the durable 5/min-per-account limit lives in AuthService via lockout.ts. */
  readonly loginLimiterFactory?: () => TokenBucket;
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
      // Present, and true, only for an administrator — every fresh admin
      // session starts unverified (docs/15 §8.1, D-17-17); a player has
      // nothing to step up. The cookie is issued regardless: it just
      // can't reach /admin/* yet (session-guard.ts's requireAdmin).
      ...(result.account.role === "administrator" ? { mfa_required: true } : {}),
    });
  });

  app.post("/api/v1/sessions/mfa", async (request, reply) => {
    if (!(await requireSession(authService, request, reply))) return;
    if (!(await requireCsrf(request, reply))) return;
    const body = request.body as Partial<{ code: string }>;
    if (typeof body.code !== "string") {
      await reply.code(400).send(errorBody("MALFORMED", "code is required."));
      return;
    }
    const session = request.authSession!;
    const result = await authService.verifyMfa(session.account.id, session.session.id, body.code);
    if (!result.ok) {
      if (result.code === "MFA_LOCKED") {
        await reply.code(423).send({
          error: { code: "MFA_LOCKED", message: "Too many failed codes; try again later." },
          locked_until: result.lockedUntil.toISOString(),
        });
        return;
      }
      const status = result.code === "FORBIDDEN" ? 403 : 401;
      await reply.code(status).send(errorBody(result.code, result.code === "FORBIDDEN" ? "Nothing to verify." : "Invalid or expired code."));
      return;
    }
    await reply.code(204).send();
  });

  app.delete("/api/v1/sessions/current", async (request, reply) => {
    if (!(await requireSession(authService, request, reply))) return;
    if (!(await requireCsrf(request, reply))) return;
    await authService.logout(request.authSession!.session.id);
    clearSessionCookies(reply);
    await reply.code(204).send();
  });

  app.get("/api/v1/accounts/me", async (request, reply) => {
    if (!(await requireSession(authService, request, reply))) return;
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
    if (!(await requireSession(authService, request, reply))) return;
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
    if (!(await requireSession(authService, request, reply))) return;
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
      if (result.code === "RATE_LIMITED") {
        const retryAfterSeconds = Math.max(1, Math.ceil((result.retryAfter.getTime() - Date.now()) / 1000));
        await reply.header("Retry-After", String(retryAfterSeconds)).code(429).send(errorBody("RATE_LIMITED", "Too many password changes."));
        return;
      }
      const status = result.code === "INVALID_CREDENTIALS" ? 401 : 422;
      await reply.code(status).send(errorBody(result.code, "Could not change password."));
      return;
    }
    await reply.code(204).send();
  });

  app.get("/api/v1/accounts/me/sessions", async (request, reply) => {
    if (!(await requireSession(authService, request, reply))) return;
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
    if (!(await requireSession(authService, request, reply))) return;
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
