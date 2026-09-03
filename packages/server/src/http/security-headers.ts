// Transport and browser security headers (docs/15_Security_Architecture.md
// §6; TC-S13, docs/25_Testing_Strategy.md). Hand-rolled rather than a
// framework plugin (e.g. `@fastify/helmet`) — the project already avoids
// infra beyond what a requirement motivates (ADR-0014, ADR-0015), and six
// static headers on an `onSend` hook is not enough surface to justify a
// new dependency. This server ships no HTML and no client script, so the
// CSP is maximally strict: nothing is ever expected to load.
import type { FastifyInstance } from "fastify";

const SECURITY_HEADERS: Readonly<Record<string, string>> = {
  "Content-Security-Policy": "default-src 'none'; frame-ancestors 'none'",
  "Strict-Transport-Security": "max-age=63072000; includeSubDomains",
  "X-Content-Type-Options": "nosniff",
  "Referrer-Policy": "no-referrer",
  "Permissions-Policy": "camera=(), microphone=(), geolocation=(), payment=()",
  "X-Frame-Options": "DENY",
};

export function applySecurityHeaders(app: FastifyInstance): void {
  app.addHook("onSend", async (_request, reply, payload) => {
    for (const [name, value] of Object.entries(SECURITY_HEADERS)) {
      reply.header(name, value);
    }
    return payload;
  });
}
