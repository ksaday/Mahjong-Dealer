// docs/27_Deployment_Architecture.md §3.2's readiness endpoint.
import Fastify, { type FastifyInstance } from "fastify";
import { afterEach, describe, expect, it } from "vitest";
import { registerReadinessRoute } from "./readiness.js";

let app: FastifyInstance;

afterEach(async () => {
  await app.close();
});

describe("GET /healthz", () => {
  it("returns 200 and the schema version when the database is reachable", async () => {
    app = Fastify();
    registerReadinessRoute(app, {
      checkDatabase: async () => ({ reachable: true, schemaVersion: "0005_admin_totp_step_up.sql" }),
    });
    await app.ready();

    const response = await app.inject({ method: "GET", url: "/healthz" });
    expect(response.statusCode).toBe(200);
    const body = response.json();
    expect(body).toEqual({ status: "ok", database: "ok", schema_version: "0005_admin_totp_step_up.sql" });
  });

  it("returns 503 when the database is unreachable", async () => {
    app = Fastify();
    registerReadinessRoute(app, { checkDatabase: async () => ({ reachable: false, schemaVersion: null }) });
    await app.ready();

    const response = await app.inject({ method: "GET", url: "/healthz" });
    expect(response.statusCode).toBe(503);
    const body = response.json();
    expect(body).toEqual({ status: "degraded", database: "unreachable", schema_version: null });
  });

  it("never carries player-identifying or tile data (only reachability and a filename)", async () => {
    app = Fastify();
    registerReadinessRoute(app, { checkDatabase: async () => ({ reachable: true, schemaVersion: "0001_initial_schema.sql" }) });
    await app.ready();

    const response = await app.inject({ method: "GET", url: "/healthz" });
    expect(Object.keys(response.json())).toEqual(["status", "database", "schema_version"]);
  });
});
