import Fastify, { type FastifyInstance } from "fastify";
import { beforeEach, describe, expect, it } from "vitest";
import { InMemoryAuditLogRepository } from "../audit/memory-repository.js";
import { NullBreachChecker } from "../auth/breach-checker.js";
import { hashPassword } from "../auth/passwords.js";
import { registerAuthRoutes } from "../auth/http.js";
import { InMemoryAccountRepository, InMemorySessionRepository } from "../auth/memory-repository.js";
import { AuthService } from "../auth/service.js";
import { createDeterministicEntropy } from "../testing/deterministic-entropy.js";
import { InMemoryTableRepository } from "../tables/memory-repository.js";
import { TableManager } from "../tables/manager.js";
import { TableService } from "../tables/service.js";
import { registerTableRoutes } from "../tables/http.js";
import { registerAdminRoutes } from "./http.js";
import { AdminService } from "./service.js";

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
let accounts: InMemoryAccountRepository;
let tableService: TableService;
let auditLog: InMemoryAuditLogRepository;

const PASSWORD = "correct horse battery";

beforeEach(async () => {
  app = Fastify();
  accounts = new InMemoryAccountRepository();
  const sessions = new InMemorySessionRepository();
  auditLog = new InMemoryAuditLogRepository();
  const authService = new AuthService({
    accounts,
    sessions,
    breachChecker: new NullBreachChecker(),
    env: { PASSWORD_PEPPER: "test-pepper" },
  });
  const manager = new TableManager(createDeterministicEntropy(1));
  const tables = new InMemoryTableRepository();
  let nextTableId = 0;
  tableService = new TableService({ accounts, tables, manager, idFactory: () => `table-${(nextTableId += 1)}` });
  let nextAuditId = 0;
  const adminService = new AdminService({ accounts, sessions, tables, manager, auditLog, idFactory: () => `audit-${(nextAuditId += 1)}` });

  registerAuthRoutes(app, { authService });
  registerTableRoutes(app, { authService, tableService });
  registerAdminRoutes(app, { authService, adminService });
  await app.ready();
});

/** Administrator accounts are provisioned out of band (docs/15 §8) — never through `POST /accounts` — so tests seed the repository directly. */
async function seedAdmin(email: string): Promise<void> {
  await accounts.create({
    id: `admin-${email}`,
    email,
    passwordHash: await hashPassword(PASSWORD, { PASSWORD_PEPPER: "test-pepper" }),
    displayName: "Admin",
    role: "administrator",
  });
}

async function login(email: string): Promise<Record<string, string>> {
  const response = await app.inject({ method: "POST", url: "/api/v1/sessions", payload: { email, password: PASSWORD } });
  return parseCookies(response.headers["set-cookie"]);
}

async function registerAndLogin(email: string, displayName = "Player"): Promise<Record<string, string>> {
  await app.inject({ method: "POST", url: "/api/v1/accounts", payload: { email, password: PASSWORD, display_name: displayName } });
  return login(email);
}

function authed(cookies: Record<string, string>) {
  return { cookie: cookieHeader(cookies), "x-csrf-token": cookies["__Host-csrf"]! };
}

describe("admin route authorization (docs/18 §4.3: session + second factor -> administrator)", () => {
  it("rejects an anonymous request with 401", async () => {
    const response = await app.inject({ method: "GET", url: "/api/v1/admin/accounts" });
    expect(response.statusCode).toBe(401);
  });

  it("rejects a player session with 403", async () => {
    const cookies = await registerAndLogin("alice@example.com", "Alice");
    const response = await app.inject({ method: "GET", url: "/api/v1/admin/accounts", headers: authed(cookies) });
    expect(response.statusCode).toBe(403);
    expect(response.json().error.code).toBe("FORBIDDEN");
  });

  it("admits an administrator session", async () => {
    await seedAdmin("root@example.com");
    const cookies = await login("root@example.com");
    const response = await app.inject({ method: "GET", url: "/api/v1/admin/accounts", headers: authed(cookies) });
    expect(response.statusCode).toBe(200);
  });
});

describe("GET /api/v1/admin/accounts (FR-160)", () => {
  it("lists accounts with metadata only", async () => {
    await seedAdmin("root@example.com");
    const adminCookies = await login("root@example.com");
    await registerAndLogin("alice@example.com", "Alice");

    const response = await app.inject({ method: "GET", url: "/api/v1/admin/accounts", headers: authed(adminCookies) });
    const body = response.json();
    expect(body.total).toBe(2);
    const alice = body.accounts.find((a: { email: string }) => a.email === "alice@example.com");
    expect(alice).toMatchObject({ display_name: "Alice", role: "player", status: "active" });
    expect(alice.password_hash).toBeUndefined();
  });
});

describe("PATCH /api/v1/admin/accounts/{id} (FR-160, FR-166)", () => {
  it("requires a non-empty reason", async () => {
    await seedAdmin("root@example.com");
    const adminCookies = await login("root@example.com");
    const response = await app.inject({
      method: "PATCH",
      url: "/api/v1/admin/accounts/whatever",
      headers: authed(adminCookies),
      payload: { status: "disabled" },
    });
    expect(response.statusCode).toBe(400);
  });

  it("disables an account and its next login is refused", async () => {
    await seedAdmin("root@example.com");
    const adminCookies = await login("root@example.com");
    await registerAndLogin("bob@example.com", "Bob");
    const bob = await accounts.findByEmail("bob@example.com");

    const response = await app.inject({
      method: "PATCH",
      url: `/api/v1/admin/accounts/${bob!.id}`,
      headers: authed(adminCookies),
      payload: { status: "disabled", reason: "fraud report" },
    });
    expect(response.statusCode).toBe(200);

    const loginAttempt = await app.inject({ method: "POST", url: "/api/v1/sessions", payload: { email: "bob@example.com", password: PASSWORD } });
    expect(loginAttempt.statusCode).toBe(403);
    expect(loginAttempt.json().error.code).toBe("ACCOUNT_DISABLED");
  });
});

describe("GET /api/v1/admin/tables and POST .../force-close (FR-160, FR-161, D-18-07)", () => {
  it("lists a table with a seat count and no occupant names", async () => {
    await seedAdmin("root@example.com");
    const adminCookies = await login("root@example.com");
    const playerCookies = await registerAndLogin("carol@example.com", "Carol");
    await app.inject({ method: "POST", url: "/api/v1/tables", headers: authed(playerCookies) });

    const response = await app.inject({ method: "GET", url: "/api/v1/admin/tables", headers: authed(adminCookies) });
    const body = response.json();
    expect(body.total).toBe(1);
    expect(body.tables[0]).toMatchObject({ status: "open", occupied_seats: 1 });
    expect(JSON.stringify(body)).not.toContain("Carol");
  });

  it("force-closes a table with a mandatory reason", async () => {
    await seedAdmin("root@example.com");
    const adminCookies = await login("root@example.com");
    const playerCookies = await registerAndLogin("dan@example.com", "Dan");
    const created = await app.inject({ method: "POST", url: "/api/v1/tables", headers: authed(playerCookies) });
    const tableId = created.json().table_id;

    const missingReason = await app.inject({
      method: "POST",
      url: `/api/v1/admin/tables/${tableId}/force-close`,
      headers: authed(adminCookies),
      payload: {},
    });
    expect(missingReason.statusCode).toBe(400);

    const response = await app.inject({
      method: "POST",
      url: `/api/v1/admin/tables/${tableId}/force-close`,
      headers: authed(adminCookies),
      payload: { reason: "abuse" },
    });
    expect(response.statusCode).toBe(204);

    const list = await app.inject({ method: "GET", url: "/api/v1/admin/tables", headers: authed(adminCookies) });
    expect(list.json().tables[0]).toMatchObject({ table_id: tableId, status: "closed" });
  });
});

describe("GET /api/v1/admin/health (FR-162)", () => {
  it("returns counts with no player-identifying data", async () => {
    await seedAdmin("root@example.com");
    const adminCookies = await login("root@example.com");
    const response = await app.inject({ method: "GET", url: "/api/v1/admin/health", headers: authed(adminCookies) });
    expect(response.statusCode).toBe(200);
    const body = response.json();
    expect(body).toMatchObject({ tables: { total: 0, live_in_this_process: 0 }, connections: 0 });
    expect(typeof body.uptime_seconds).toBe("number");
  });
});

describe("GET /api/v1/admin/audit (FR-163)", () => {
  it("lists administrative actions with actor, target, and reason", async () => {
    await seedAdmin("root@example.com");
    const adminCookies = await login("root@example.com");
    const playerCookies = await registerAndLogin("erin@example.com", "Erin");
    const erin = await accounts.findByEmail("erin@example.com");
    await app.inject({
      method: "PATCH",
      url: `/api/v1/admin/accounts/${erin!.id}`,
      headers: authed(adminCookies),
      payload: { status: "disabled", reason: "spam" },
    });
    void playerCookies;

    const response = await app.inject({ method: "GET", url: "/api/v1/admin/audit", headers: authed(adminCookies) });
    const body = response.json();
    expect(body.entries[0]).toMatchObject({ action: "account_disabled", target_id: erin!.id, reason: "spam" });
  });
});
