// The container's readiness endpoint (docs/27_Deployment_Architecture.md
// §3.2: "A readiness endpoint reporting database reachability and schema
// version") — distinct from `GET /admin/health` (`admin/http.ts`, FR-162),
// which is authenticated, requires the administrator second factor, and
// reports operational metrics rather than answering "should traffic route
// here." `docs/33_API/REST_Endpoint_Catalog.md` never gave this one a
// path, so `GET /healthz` is picked here — the common convention for an
// orchestrator/load-balancer probe — and recorded there via the project's
// own amendment process (docs/00 §12.3).
//
// `checkDatabase` is injected so this stays testable without a live
// database, the same split every repository in this codebase keeps
// between its interface and its `Postgres*` implementation.
import type { FastifyInstance } from "fastify";

export interface ReadinessResult {
  readonly reachable: boolean;
  /** The most recently applied migration id, or `null` if the query itself failed. */
  readonly schemaVersion: string | null;
}

export interface ReadinessRouteOptions {
  readonly checkDatabase: () => Promise<ReadinessResult>;
}

export function registerReadinessRoute(app: FastifyInstance, options: ReadinessRouteOptions): void {
  app.get("/healthz", async (_request, reply) => {
    const result = await options.checkDatabase();
    // snake_case body, matching every other REST response (docs/18 §3's
    // naming convention) and `GET /admin/health`'s existing `database`/
    // `schema_version` vocabulary specifically (docs/33_API/REST_Endpoint_Catalog.md).
    await reply.code(result.reachable ? 200 : 503).send({
      status: result.reachable ? "ok" : "degraded",
      database: result.reachable ? "ok" : "unreachable",
      schema_version: result.schemaVersion,
    });
  });
}
