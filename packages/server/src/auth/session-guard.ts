// Shared session/CSRF verification for every authenticated Fastify route
// (docs/15_Security_Architecture.md §4.2). Factored out of `http.ts` so a
// second route module — `tables/http.ts` — authenticates state-changing
// requests the same way rather than re-implementing the double-submit
// check: a security-critical comparison is one place, not two that could
// drift.
import type { FastifyReply, FastifyRequest } from "fastify";
import { verifyCsrf } from "./csrf.js";
import type { AuthenticatedSession, AuthService } from "./service.js";

export const SESSION_COOKIE = "__Host-session";
export const CSRF_COOKIE = "__Host-csrf";
export const CSRF_HEADER = "x-csrf-token";

declare module "fastify" {
  interface FastifyRequest {
    authSession?: AuthenticatedSession;
  }
}

export function errorBody(code: string, message: string): { error: { code: string; message: string } } {
  return { error: { code, message } };
}

export function clientIp(request: FastifyRequest): string {
  return request.ip;
}

export async function requireSession(
  authService: AuthService,
  request: FastifyRequest,
  reply: FastifyReply,
): Promise<boolean> {
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

/**
 * `docs/18 §4.3`'s "session + second factor → administrator" guard for
 * every `/admin/*` route: session validity, `role`, and — the TOTP
 * step-up protocol `ADR-0017` specifies (`docs/15 §8.1`, `POST
 * /sessions/mfa`) — `sessions.mfa_verified_at` **on this session**. A
 * valid administrator session that hasn't stepped up gets
 * `401 MFA_REQUIRED`, distinct from `NOT_AUTHENTICATED` (no session at
 * all) and `FORBIDDEN` (a real session, wrong role): the client needs to
 * know which of the three to do next — log in, step up, or neither.
 */
export async function requireAdmin(
  authService: AuthService,
  request: FastifyRequest,
  reply: FastifyReply,
): Promise<boolean> {
  if (!(await requireSession(authService, request, reply))) return false;
  const { account, session } = request.authSession!;
  if (account.role !== "administrator") {
    await reply.code(403).send(errorBody("FORBIDDEN", "Administrator access required."));
    return false;
  }
  if (session.mfa_verified_at === null) {
    await reply.code(401).send(errorBody("MFA_REQUIRED", "Complete second-factor verification first."));
    return false;
  }
  return true;
}

/** CSRF applies only to authenticated, state-changing requests (docs/15 §4.2) — nothing to protect before a session exists. */
export async function requireCsrf(request: FastifyRequest, reply: FastifyReply): Promise<boolean> {
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
