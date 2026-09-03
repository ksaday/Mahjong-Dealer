// CORS (docs/15_Security_Architecture.md §6: "Explicit allow-list;
// credentials permitted only for known origins") — hand-rolled for the
// same reason `security-headers.ts` is: one allow-list check and a
// preflight short-circuit isn't enough surface to justify `@fastify/cors`.
// Mirrors `gateway/multi-table-router.ts`'s own `allowedOrigins` check for
// the WebSocket upgrade (docs/15 §6's "same allow-list" for both).
import type { FastifyInstance } from "fastify";
import { CSRF_HEADER } from "../auth/session-guard.js";

const ALLOWED_METHODS = "GET, POST, PATCH, DELETE, OPTIONS";
const ALLOWED_HEADERS = ["content-type", "idempotency-key", CSRF_HEADER].join(", ");

export function applyCors(app: FastifyInstance, allowedOrigins: readonly string[]): void {
  app.addHook("onRequest", async (request, reply) => {
    const origin = request.headers.origin;
    const allowed = origin !== undefined && allowedOrigins.includes(origin);

    reply.header("Vary", "Origin");
    if (allowed) {
      reply.header("Access-Control-Allow-Origin", origin);
      reply.header("Access-Control-Allow-Credentials", "true");
    }

    if (request.method === "OPTIONS" && request.headers["access-control-request-method"] !== undefined) {
      if (allowed) {
        reply.header("Access-Control-Allow-Methods", ALLOWED_METHODS);
        reply.header("Access-Control-Allow-Headers", ALLOWED_HEADERS);
      }
      await reply.code(204).send();
    }
  });
}
