import Fastify, { type FastifyInstance } from "fastify";
import { beforeEach, describe, expect, it } from "vitest";
import { NullBreachChecker } from "./breach-checker.js";
import { registerAuthRoutes } from "./http.js";
import { InMemoryAccountRepository, InMemorySessionRepository } from "./memory-repository.js";
import { AuthService } from "./service.js";

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

let app: FastifyInstance;

beforeEach(async () => {
  app = Fastify();
  const service = new AuthService({
    accounts: new InMemoryAccountRepository(),
    sessions: new InMemorySessionRepository(),
    breachChecker: new NullBreachChecker(),
    env: { PASSWORD_PEPPER: "test-pepper" },
  });
  registerAuthRoutes(app, { authService: service });
  await app.ready();
});

async function register(email: string, password = "correct horse battery"): Promise<void> {
  await app.inject({
    method: "POST",
    url: "/api/v1/accounts",
    payload: { email, password, display_name: "Test User" },
  });
}

async function login(email: string, password = "correct horse battery") {
  const response = await app.inject({ method: "POST", url: "/api/v1/sessions", payload: { email, password } });
  const cookies = parseCookies(response.headers["set-cookie"]);
  return { response, cookies };
}

describe("POST /api/v1/accounts", () => {
  it("registers and returns 201 with an account id", async () => {
    const response = await app.inject({
      method: "POST",
      url: "/api/v1/accounts",
      payload: { email: "alice@example.com", password: "correct horse battery", display_name: "Alice" },
    });
    expect(response.statusCode).toBe(201);
    expect(response.json()).toHaveProperty("account_id");
  });

  it("rejects a short password with 422", async () => {
    const response = await app.inject({
      method: "POST",
      url: "/api/v1/accounts",
      payload: { email: "bob@example.com", password: "short", display_name: "Bob" },
    });
    expect(response.statusCode).toBe(422);
    expect(response.json().error.code).toBe("PASSWORD_TOO_SHORT");
  });

  it("rejects a malformed body with 400", async () => {
    const response = await app.inject({ method: "POST", url: "/api/v1/accounts", payload: { email: "x@example.com" } });
    expect(response.statusCode).toBe(400);
  });
});

describe("POST /api/v1/sessions", () => {
  it("logs in and sets session and CSRF cookies", async () => {
    await register("carol@example.com");
    const { response, cookies } = await login("carol@example.com");
    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({ display_name: "Test User", role: "player" });
    expect(cookies["__Host-session"]).toBeTruthy();
    expect(cookies["__Host-csrf"]).toBeTruthy();
  });

  it("rejects a wrong password with 401", async () => {
    await register("dana@example.com");
    const { response } = await login("dana@example.com", "wrong password");
    expect(response.statusCode).toBe(401);
    expect(response.json().error.code).toBe("INVALID_CREDENTIALS");
  });
});

describe("authenticated routes", () => {
  it("GET /accounts/me requires a session", async () => {
    const response = await app.inject({ method: "GET", url: "/api/v1/accounts/me" });
    expect(response.statusCode).toBe(401);
  });

  it("GET /accounts/me returns the profile with a valid session cookie", async () => {
    await register("erin@example.com");
    const { cookies } = await login("erin@example.com");
    const response = await app.inject({
      method: "GET",
      url: "/api/v1/accounts/me",
      headers: { cookie: cookieHeader(cookies) },
    });
    expect(response.statusCode).toBe(200);
    expect(response.json().email).toBe("erin@example.com");
  });

  it("rejects a state-changing request with a valid session but no CSRF header", async () => {
    await register("frank@example.com");
    const { cookies } = await login("frank@example.com");
    const response = await app.inject({
      method: "PATCH",
      url: "/api/v1/accounts/me",
      headers: { cookie: cookieHeader(cookies) },
      payload: { display_name: "New Name" },
    });
    expect(response.statusCode).toBe(403);
    expect(response.json().error.code).toBe("CSRF_INVALID");
  });

  it("accepts a state-changing request with a matching CSRF header", async () => {
    await register("grace@example.com");
    const { cookies } = await login("grace@example.com");
    const response = await app.inject({
      method: "PATCH",
      url: "/api/v1/accounts/me",
      headers: { cookie: cookieHeader(cookies), "x-csrf-token": cookies["__Host-csrf"]! },
      payload: { display_name: "New Name" },
    });
    expect(response.statusCode).toBe(200);
    expect(response.json().display_name).toBe("New Name");
  });

  it("logout revokes the session, and it no longer authenticates", async () => {
    await register("heidi@example.com");
    const { cookies } = await login("heidi@example.com");
    const logoutResponse = await app.inject({
      method: "DELETE",
      url: "/api/v1/sessions/current",
      headers: { cookie: cookieHeader(cookies), "x-csrf-token": cookies["__Host-csrf"]! },
    });
    expect(logoutResponse.statusCode).toBe(204);

    const profileResponse = await app.inject({
      method: "GET",
      url: "/api/v1/accounts/me",
      headers: { cookie: cookieHeader(cookies) },
    });
    expect(profileResponse.statusCode).toBe(401);
  });
});

describe("POST /api/v1/accounts/me/password (docs/18 §6: 3/hour, durable)", () => {
  it("returns 429 with Retry-After once the durable per-account limit is exhausted", async () => {
    let now = new Date("2026-01-01T00:00:00Z");
    const rateLimitedApp = Fastify();
    const service = new AuthService({
      accounts: new InMemoryAccountRepository(),
      sessions: new InMemorySessionRepository(),
      breachChecker: new NullBreachChecker(),
      env: { PASSWORD_PEPPER: "test-pepper" },
      now: () => now,
    });
    registerAuthRoutes(rateLimitedApp, { authService: service });
    await rateLimitedApp.ready();

    await rateLimitedApp.inject({
      method: "POST",
      url: "/api/v1/accounts",
      payload: { email: "penny@example.com", password: "correct horse battery", display_name: "Penny" },
    });
    const loginResponse = await rateLimitedApp.inject({
      method: "POST",
      url: "/api/v1/sessions",
      payload: { email: "penny@example.com", password: "correct horse battery" },
    });
    const cookies = parseCookies(loginResponse.headers["set-cookie"]);
    const headers = { cookie: cookieHeader(cookies), "x-csrf-token": cookies["__Host-csrf"]! };

    for (let i = 0; i < 3; i += 1) {
      const response = await rateLimitedApp.inject({
        method: "POST",
        url: "/api/v1/accounts/me/password",
        headers,
        payload: { current_password: "wrong current password", new_password: "a brand new password" },
      });
      expect(response.statusCode).toBe(401); // wrong current_password every time, but still consumes the window
    }

    const fourth = await rateLimitedApp.inject({
      method: "POST",
      url: "/api/v1/accounts/me/password",
      headers,
      payload: { current_password: "wrong current password", new_password: "a brand new password" },
    });
    expect(fourth.statusCode).toBe(429);
    expect(fourth.json().error.code).toBe("RATE_LIMITED");
    expect(Number(fourth.headers["retry-after"])).toBeGreaterThan(0);
  });
});
