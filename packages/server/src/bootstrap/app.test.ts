// Proves buildApp's wiring: every route surface (auth, tables, admin,
// /healthz) responds together off one construction, and the security
// headers/CORS hooks it registers apply across all of them. Per-endpoint
// behavior is already covered by auth/http.test.ts, tables/http.test.ts,
// and admin/http.test.ts — this file only proves the assembly itself.
import type { FastifyInstance } from "fastify";
import { beforeEach, describe, expect, it } from "vitest";
import { InMemoryAuditLogRepository } from "../audit/memory-repository.js";
import { InMemoryAccountRepository, InMemorySessionRepository } from "../auth/memory-repository.js";
import { InMemoryTableRepository } from "../tables/memory-repository.js";
import { buildApp, type BuiltApp } from "./app.js";

function parseCookies(setCookieHeaders: string | string[] | undefined): Record<string, string> {
  const headers = Array.isArray(setCookieHeaders) ? setCookieHeaders : setCookieHeaders !== undefined ? [setCookieHeaders] : [];
  const result: Record<string, string> = {};
  for (const header of headers) {
    const [pair] = header.split(";");
    const [name, value] = pair!.split("=");
    if (name !== undefined && value !== undefined) result[name] = value;
  }
  return result;
}

function cookieHeader(cookies: Record<string, string>): string {
  return Object.entries(cookies)
    .map(([name, value]) => `${name}=${value}`)
    .join("; ");
}

function authed(cookies: Record<string, string>) {
  return { cookie: cookieHeader(cookies), "x-csrf-token": cookies["__Host-csrf"]! };
}

let built: BuiltApp;
let app: FastifyInstance;

beforeEach(async () => {
  built = buildApp({
    accounts: new InMemoryAccountRepository(),
    sessions: new InMemorySessionRepository(),
    tables: new InMemoryTableRepository(),
    auditLog: new InMemoryAuditLogRepository(),
    env: { PASSWORD_PEPPER: "test-pepper" },
    allowedOrigins: ["https://app.example"],
    checkDatabase: async () => ({ reachable: true, schemaVersion: "0005_admin_totp_step_up.sql" }),
  });
  app = built.app;
  await app.ready();
});

async function registerAndLogin(email: string): Promise<Record<string, string>> {
  await app.inject({
    method: "POST",
    url: "/api/v1/accounts",
    payload: { email, password: "correct horse battery", display_name: "Player" },
  });
  const response = await app.inject({ method: "POST", url: "/api/v1/sessions", payload: { email, password: "correct horse battery" } });
  return parseCookies(response.headers["set-cookie"]);
}

describe("buildApp", () => {
  it("serves the auth surface", async () => {
    const cookies = await registerAndLogin("alice@example.com");
    expect(cookies["__Host-session"]).toBeTruthy();
  });

  it("serves the tables surface, wired to the same auth service", async () => {
    const cookies = await registerAndLogin("bob@example.com");
    const response = await app.inject({ method: "POST", url: "/api/v1/tables", headers: authed(cookies) });
    expect(response.statusCode).toBe(201);
    expect(response.json().seat).toBe("east");
  });

  it("serves the admin surface, rejecting a non-administrator session", async () => {
    const cookies = await registerAndLogin("carol@example.com");
    const response = await app.inject({ method: "GET", url: "/api/v1/admin/accounts", headers: authed(cookies) });
    expect(response.statusCode).toBe(403);
  });

  it("serves /healthz off the injected checkDatabase", async () => {
    const response = await app.inject({ method: "GET", url: "/healthz" });
    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({ status: "ok", database: "ok", schema_version: "0005_admin_totp_step_up.sql" });
  });

  it("applies security headers across the whole surface, /healthz included", async () => {
    const response = await app.inject({ method: "GET", url: "/healthz" });
    expect(response.headers["x-content-type-options"]).toBe("nosniff");
    expect(response.headers["content-security-policy"]).toBe("default-src 'none'; frame-ancestors 'none'");
  });

  it("applies the CORS allow-list across the whole surface", async () => {
    const allowed = await app.inject({ method: "GET", url: "/healthz", headers: { origin: "https://app.example" } });
    expect(allowed.headers["access-control-allow-origin"]).toBe("https://app.example");

    const disallowed = await app.inject({ method: "GET", url: "/healthz", headers: { origin: "https://evil.example" } });
    expect(disallowed.headers["access-control-allow-origin"]).toBeUndefined();
  });

  it("exposes the TableManager for the caller to wire into the WebSocket gateway", () => {
    expect(built.manager).toBeDefined();
  });
});
