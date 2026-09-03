// docs/15_Security_Architecture.md §6: "CORS ... explicit allow-list;
// credentials permitted only for known origins."
import Fastify, { type FastifyInstance } from "fastify";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { applyCors } from "./cors.js";

const ALLOWED = "https://app.example";
const DISALLOWED = "https://evil.example";

let app: FastifyInstance;

beforeEach(async () => {
  app = Fastify();
  applyCors(app, [ALLOWED]);
  app.get("/probe", async () => ({ ok: true }));
  await app.ready();
});

afterEach(async () => {
  await app.close();
});

describe("applyCors", () => {
  it("reflects an allow-listed origin with credentials permitted", async () => {
    const response = await app.inject({ method: "GET", url: "/probe", headers: { origin: ALLOWED } });
    expect(response.headers["access-control-allow-origin"]).toBe(ALLOWED);
    expect(response.headers["access-control-allow-credentials"]).toBe("true");
  });

  it("does not reflect an origin outside the allow-list", async () => {
    const response = await app.inject({ method: "GET", url: "/probe", headers: { origin: DISALLOWED } });
    expect(response.headers["access-control-allow-origin"]).toBeUndefined();
    expect(response.headers["access-control-allow-credentials"]).toBeUndefined();
  });

  it("sets Vary: Origin regardless of allow-list outcome", async () => {
    const response = await app.inject({ method: "GET", url: "/probe", headers: { origin: DISALLOWED } });
    expect(response.headers["vary"]).toBe("Origin");
  });

  it("answers an allowed preflight with 204 and the allowed methods/headers", async () => {
    const response = await app.inject({
      method: "OPTIONS",
      url: "/probe",
      headers: { origin: ALLOWED, "access-control-request-method": "POST" },
    });
    expect(response.statusCode).toBe(204);
    expect(response.headers["access-control-allow-methods"]).toContain("POST");
    expect(response.headers["access-control-allow-headers"]).toContain("idempotency-key");
  });

  it("answers a disallowed preflight with 204 but no CORS headers", async () => {
    const response = await app.inject({
      method: "OPTIONS",
      url: "/probe",
      headers: { origin: DISALLOWED, "access-control-request-method": "POST" },
    });
    expect(response.statusCode).toBe(204);
    expect(response.headers["access-control-allow-methods"]).toBeUndefined();
  });

  it("leaves a request with no Origin header alone", async () => {
    const response = await app.inject({ method: "GET", url: "/probe" });
    expect(response.statusCode).toBe(200);
    expect(response.headers["access-control-allow-origin"]).toBeUndefined();
  });
});
