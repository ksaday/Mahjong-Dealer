import Fastify, { type FastifyInstance } from "fastify";
import { beforeEach, describe, expect, it } from "vitest";
import { NullBreachChecker } from "../auth/breach-checker.js";
import { registerAuthRoutes } from "../auth/http.js";
import { InMemoryAccountRepository, InMemorySessionRepository } from "../auth/memory-repository.js";
import { AuthService } from "../auth/service.js";
import { createDeterministicEntropy } from "../testing/deterministic-entropy.js";
import { registerTableRoutes } from "./http.js";
import { InMemoryTableRepository } from "./memory-repository.js";
import { TableManager } from "./manager.js";
import { TableService } from "./service.js";

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
let tableIdFactory: () => string;

beforeEach(async () => {
  app = Fastify();
  const accounts = new InMemoryAccountRepository();
  const authService = new AuthService({
    accounts,
    sessions: new InMemorySessionRepository(),
    breachChecker: new NullBreachChecker(),
    env: { PASSWORD_PEPPER: "test-pepper" },
  });
  const manager = new TableManager(createDeterministicEntropy(1));
  let nextId = 0;
  tableIdFactory = () => `table-${(nextId += 1)}`;
  const tableService = new TableService({
    accounts,
    tables: new InMemoryTableRepository(),
    manager,
    idFactory: () => tableIdFactory(),
  });
  registerAuthRoutes(app, { authService });
  registerTableRoutes(app, { authService, tableService });
  await app.ready();
});

async function registerAndLogin(email: string, displayName = "Player"): Promise<Record<string, string>> {
  await app.inject({
    method: "POST",
    url: "/api/v1/accounts",
    payload: { email, password: "correct horse battery", display_name: displayName },
  });
  const response = await app.inject({
    method: "POST",
    url: "/api/v1/sessions",
    payload: { email, password: "correct horse battery" },
  });
  return parseCookies(response.headers["set-cookie"]);
}

function authed(cookies: Record<string, string>) {
  return { cookie: cookieHeader(cookies), "x-csrf-token": cookies["__Host-csrf"]! };
}

describe("POST /api/v1/tables", () => {
  it("requires a session", async () => {
    const response = await app.inject({ method: "POST", url: "/api/v1/tables" });
    expect(response.statusCode).toBe(401);
  });

  it("creates a table and returns the join code once, with the creator seated east", async () => {
    const cookies = await registerAndLogin("alice@example.com", "Alice");
    const response = await app.inject({ method: "POST", url: "/api/v1/tables", headers: authed(cookies) });
    expect(response.statusCode).toBe(201);
    const body = response.json();
    expect(body.seat).toBe("east");
    expect(body.join_code).toHaveLength(6);
    expect(body.table_id).toBeTruthy();
  });

  it("returns 409 ALREADY_SEATED for a second table from the same account", async () => {
    const cookies = await registerAndLogin("bob@example.com", "Bob");
    await app.inject({ method: "POST", url: "/api/v1/tables", headers: authed(cookies) });
    const second = await app.inject({ method: "POST", url: "/api/v1/tables", headers: authed(cookies) });
    expect(second.statusCode).toBe(409);
    expect(second.json().error.code).toBe("ALREADY_SEATED");
  });

  describe("Idempotency-Key (docs/18 §7 D-18-10/D-18-11, docs/17 §5.12)", () => {
    it("replays the identical response, join_code included, for a repeated key", async () => {
      const cookies = await registerAndLogin("penny@example.com", "Penny");
      const headers = { ...authed(cookies), "idempotency-key": "penny-retry-1" };
      const first = await app.inject({ method: "POST", url: "/api/v1/tables", headers });
      const second = await app.inject({ method: "POST", url: "/api/v1/tables", headers });
      expect(first.statusCode).toBe(201);
      expect(second.statusCode).toBe(201);
      expect(second.json()).toEqual(first.json());
    });

    it("does not create a second table for a replayed key", async () => {
      const cookies = await registerAndLogin("quinn@example.com", "Quinn");
      const headers = { ...authed(cookies), "idempotency-key": "quinn-retry-1" };
      await app.inject({ method: "POST", url: "/api/v1/tables", headers });
      await app.inject({ method: "POST", url: "/api/v1/tables", headers });
      const mine = await app.inject({ method: "GET", url: "/api/v1/tables/mine", headers: authed(cookies) });
      expect(mine.json().tables).toHaveLength(1);
    });

    it("falls through to ALREADY_SEATED for a different key from the same account", async () => {
      const cookies = await registerAndLogin("ross@example.com", "Ross");
      await app.inject({
        method: "POST",
        url: "/api/v1/tables",
        headers: { ...authed(cookies), "idempotency-key": "ross-first" },
      });
      const second = await app.inject({
        method: "POST",
        url: "/api/v1/tables",
        headers: { ...authed(cookies), "idempotency-key": "ross-second" },
      });
      expect(second.statusCode).toBe(409);
      expect(second.json().error.code).toBe("ALREADY_SEATED");
    });

    it("rejects an oversized key with 400 MALFORMED", async () => {
      const cookies = await registerAndLogin("sam@example.com", "Sam");
      const response = await app.inject({
        method: "POST",
        url: "/api/v1/tables",
        headers: { ...authed(cookies), "idempotency-key": "x".repeat(256) },
      });
      expect(response.statusCode).toBe(400);
      expect(response.json().error.code).toBe("MALFORMED");
    });

    it("does not scope a key across accounts", async () => {
      const aliceCookies = await registerAndLogin("tara@example.com", "Tara");
      const bobCookies = await registerAndLogin("umar@example.com", "Umar");
      const key = "shared-key";
      const first = await app.inject({
        method: "POST",
        url: "/api/v1/tables",
        headers: { ...authed(aliceCookies), "idempotency-key": key },
      });
      const second = await app.inject({
        method: "POST",
        url: "/api/v1/tables",
        headers: { ...authed(bobCookies), "idempotency-key": key },
      });
      expect(first.statusCode).toBe(201);
      expect(second.statusCode).toBe(201);
      expect(second.json().table_id).not.toBe(first.json().table_id);
    });
  });
});

describe("POST /api/v1/tables/join", () => {
  it("seats a second account with no seat parameter accepted (NR-601)", async () => {
    const hostCookies = await registerAndLogin("carol@example.com", "Carol");
    const created = await app.inject({ method: "POST", url: "/api/v1/tables", headers: authed(hostCookies) });
    const { join_code: joinCode } = created.json();

    const guestCookies = await registerAndLogin("dave@example.com", "Dave");
    const response = await app.inject({
      method: "POST",
      url: "/api/v1/tables/join",
      headers: authed(guestCookies),
      payload: { join_code: joinCode },
    });
    expect(response.statusCode).toBe(200);
    expect(response.json().seat).toBe("south");
  });

  it("returns 404 for an unknown join code (uniform failure, docs/18 §4.2)", async () => {
    const cookies = await registerAndLogin("erin@example.com", "Erin");
    const response = await app.inject({
      method: "POST",
      url: "/api/v1/tables/join",
      headers: authed(cookies),
      payload: { join_code: "ZZZZZZ" },
    });
    expect(response.statusCode).toBe(404);
    expect(response.json().error.code).toBe("NOT_FOUND");
  });

  it("returns 400 MALFORMED when join_code is missing", async () => {
    const cookies = await registerAndLogin("frank@example.com", "Frank");
    const response = await app.inject({ method: "POST", url: "/api/v1/tables/join", headers: authed(cookies), payload: {} });
    expect(response.statusCode).toBe(400);
  });
});

describe("GET /api/v1/tables/mine", () => {
  it("lists only tables the requester holds a seat at, with no game-internal fields", async () => {
    const hostCookies = await registerAndLogin("grace@example.com", "Grace");
    const created = await app.inject({ method: "POST", url: "/api/v1/tables", headers: authed(hostCookies) });
    const { join_code: joinCode, table_id: tableId } = created.json();

    const guestCookies = await registerAndLogin("heidi@example.com", "Heidi");
    await app.inject({ method: "POST", url: "/api/v1/tables/join", headers: authed(guestCookies), payload: { join_code: joinCode } });

    const response = await app.inject({ method: "GET", url: "/api/v1/tables/mine", headers: authed(hostCookies) });
    expect(response.statusCode).toBe(200);
    const { tables } = response.json();
    expect(tables).toHaveLength(1);
    expect(tables[0].table_id).toBe(tableId);
    expect(tables[0].game_state).toBe("idle");
    expect(tables[0].seats.find((s: { seat: string }) => s.seat === "south").display_name).toBe("Heidi");

    const strangerCookies = await registerAndLogin("ivan@example.com", "Ivan");
    const strangerResponse = await app.inject({ method: "GET", url: "/api/v1/tables/mine", headers: authed(strangerCookies) });
    expect(strangerResponse.json().tables).toEqual([]);
  });
});

describe("DELETE /api/v1/tables/{id}", () => {
  it("closes a table for its host", async () => {
    const cookies = await registerAndLogin("judy@example.com", "Judy");
    const created = await app.inject({ method: "POST", url: "/api/v1/tables", headers: authed(cookies) });
    const { table_id: tableId } = created.json();

    const response = await app.inject({ method: "DELETE", url: `/api/v1/tables/${tableId}`, headers: authed(cookies) });
    expect(response.statusCode).toBe(204);
  });

  it("returns 404 for a non-host", async () => {
    const hostCookies = await registerAndLogin("kevin@example.com", "Kevin");
    const created = await app.inject({ method: "POST", url: "/api/v1/tables", headers: authed(hostCookies) });
    const { table_id: tableId } = created.json();

    const otherCookies = await registerAndLogin("laura@example.com", "Laura");
    const response = await app.inject({ method: "DELETE", url: `/api/v1/tables/${tableId}`, headers: authed(otherCookies) });
    expect(response.statusCode).toBe(404);
  });
});

describe("POST /api/v1/tables/{id}/connect-ticket", () => {
  it("mints a single-use ticket for an occupant", async () => {
    const cookies = await registerAndLogin("mallory@example.com", "Mallory");
    const created = await app.inject({ method: "POST", url: "/api/v1/tables", headers: authed(cookies) });
    const { table_id: tableId } = created.json();

    const response = await app.inject({
      method: "POST",
      url: `/api/v1/tables/${tableId}/connect-ticket`,
      headers: authed(cookies),
    });
    expect(response.statusCode).toBe(201);
    const body = response.json();
    expect(body.ticket).toBeTruthy();
    expect(new Date(body.expires_at).getTime()).toBeGreaterThan(Date.now());
  });

  it("returns 404 for an account holding no seat at the table", async () => {
    const hostCookies = await registerAndLogin("nathan@example.com", "Nathan");
    const created = await app.inject({ method: "POST", url: "/api/v1/tables", headers: authed(hostCookies) });
    const { table_id: tableId } = created.json();

    const outsiderCookies = await registerAndLogin("olivia@example.com", "Olivia");
    const response = await app.inject({
      method: "POST",
      url: `/api/v1/tables/${tableId}/connect-ticket`,
      headers: authed(outsiderCookies),
    });
    expect(response.statusCode).toBe(404);
  });
});
