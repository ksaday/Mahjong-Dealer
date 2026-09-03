// TC-S13 (docs/25_Testing_Strategy.md): "Response headers carry the
// strict CSP, HSTS, frame protection, and no-sniff settings."
import Fastify, { type FastifyInstance } from "fastify";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { applySecurityHeaders } from "./security-headers.js";

let app: FastifyInstance;

beforeEach(async () => {
  app = Fastify();
  applySecurityHeaders(app);
  app.get("/probe", async () => ({ ok: true }));
  await app.ready();
});

afterEach(async () => {
  await app.close();
});

describe("applySecurityHeaders", () => {
  it("sets a strict, no-script CSP", async () => {
    const response = await app.inject({ method: "GET", url: "/probe" });
    expect(response.headers["content-security-policy"]).toBe("default-src 'none'; frame-ancestors 'none'");
  });

  it("sets a long-lived HSTS header", async () => {
    const response = await app.inject({ method: "GET", url: "/probe" });
    expect(response.headers["strict-transport-security"]).toBe("max-age=63072000; includeSubDomains");
  });

  it("sets frame protection on both headers", async () => {
    const response = await app.inject({ method: "GET", url: "/probe" });
    expect(response.headers["x-frame-options"]).toBe("DENY");
    expect(response.headers["content-security-policy"]).toContain("frame-ancestors 'none'");
  });

  it("sets no-sniff", async () => {
    const response = await app.inject({ method: "GET", url: "/probe" });
    expect(response.headers["x-content-type-options"]).toBe("nosniff");
  });

  it("sets a no-referrer policy and a restrictive permissions policy", async () => {
    const response = await app.inject({ method: "GET", url: "/probe" });
    expect(response.headers["referrer-policy"]).toBe("no-referrer");
    expect(response.headers["permissions-policy"]).toContain("camera=()");
  });
});
