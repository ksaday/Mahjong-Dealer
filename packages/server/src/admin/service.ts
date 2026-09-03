// AdminService: the business logic behind docs/18_API_Design.md §4.3 (the
// five administrative endpoints, `FR-160`–`FR-166`), independent of HTTP
// (http.ts is the thin Fastify wrapper) — the same split as
// `auth/service.ts`/`auth/http.ts` and `tables/service.ts`/`tables/http.ts`.
//
// FR-165 ("an administrator cannot occupy a seat, act at a table, or
// alter game state other than by closing a table") is enforced by this
// service's own shape: the only table-touching method here is
// `forceCloseTable`, and it never reads seat occupants, hand contents, or
// any dealer-core state — `listTables` returns a seat *count* (D-18-07),
// never who.
import type { AccountRow, AccountStatus } from "@mahjong-dealer/db";
import { uuidv7 } from "@mahjong-dealer/db";
import type { AuditLogPage, AuditLogQuery, AuditLogRepository } from "../audit/repository.js";
import type { AccountListPage, AccountListQuery, AccountRepository } from "../auth/repository.js";
import type { SessionRepository } from "../auth/repository.js";
import type { TableListQuery, TableRepository } from "../tables/repository.js";
import type { TableManager } from "../tables/manager.js";

export interface AdminServiceOptions {
  readonly accounts: AccountRepository;
  readonly sessions: SessionRepository;
  readonly tables: TableRepository;
  readonly manager: TableManager;
  readonly auditLog: AuditLogRepository;
  readonly now?: () => Date;
  readonly idFactory?: () => string;
}

export type SetAccountStatusResult = { readonly ok: true } | { readonly ok: false; readonly code: "NOT_FOUND" };
export type ForceCloseTableResult = { readonly ok: true } | { readonly ok: false; readonly code: "NOT_FOUND" };

export interface AdminTableSummary {
  readonly tableId: string;
  readonly status: string;
  /** A count, never occupants (D-18-07, FR-164). */
  readonly occupiedSeats: number;
  readonly createdAt: Date;
  readonly closedAt: Date | null;
}

export interface AdminTablePage {
  readonly tables: readonly AdminTableSummary[];
  readonly total: number;
}

/**
 * Deliberately narrower than `FR-162`'s full "process, database, table and
 * connection counts, error rates": there is no metrics pipeline anywhere
 * in this codebase to source an error rate from, and no health-check hook
 * into whichever `Pool`/repository a deployment wires up (`AdminService`
 * depends on the repository interfaces, not a concrete database client,
 * the same discipline as everywhere else here — see `auth/repository.ts`'s
 * module comment). Flagged rather than fabricated: `database` and
 * `error_rate` fields are not included instead of being filled with a
 * number that would look real and mean nothing.
 */
export interface AdminHealth {
  readonly uptimeSeconds: number;
  readonly tables: { readonly total: number; readonly liveInThisProcess: number };
  readonly connections: number;
}

export class AdminService {
  private readonly accounts: AccountRepository;
  private readonly sessions: SessionRepository;
  private readonly tables: TableRepository;
  private readonly manager: TableManager;
  private readonly auditLog: AuditLogRepository;
  private readonly now: () => Date;
  private readonly idFactory: () => string;

  constructor(options: AdminServiceOptions) {
    this.accounts = options.accounts;
    this.sessions = options.sessions;
    this.tables = options.tables;
    this.manager = options.manager;
    this.auditLog = options.auditLog;
    this.now = options.now ?? (() => new Date());
    this.idFactory = options.idFactory ?? uuidv7;
  }

  /** `GET /admin/accounts` (`FR-160`). */
  async listAccounts(query: AccountListQuery): Promise<AccountListPage> {
    return this.accounts.list(query);
  }

  /**
   * `PATCH /admin/accounts/{id}` (`FR-160`). Disabling revokes every
   * session for the account (docs/18 §4.3) — a disabled account should
   * not still be able to act through a socket it opened before being
   * disabled.
   */
  async setAccountStatus(
    actorAccountId: string,
    targetAccountId: string,
    status: AccountStatus,
    reason: string,
  ): Promise<SetAccountStatusResult> {
    const account: AccountRow | null = await this.accounts.findById(targetAccountId);
    if (account === null) return { ok: false, code: "NOT_FOUND" };

    await this.accounts.setStatus(targetAccountId, status);
    if (status === "disabled") {
      await this.sessions.revokeAllForAccount(targetAccountId, this.now());
    }
    await this.recordAudit(actorAccountId, status === "disabled" ? "account_disabled" : "account_enabled", "account", targetAccountId, reason);
    return { ok: true };
  }

  /** `GET /admin/tables` (`FR-160`) — no seat occupants, no game state, no tiles (D-18-07). */
  async listTables(query: TableListQuery): Promise<AdminTablePage> {
    const page = await this.tables.list(query);
    const tables = await Promise.all(
      page.tables.map(async (row): Promise<AdminTableSummary> => {
        const seats = await this.tables.seatsForTable(row.id);
        return {
          tableId: row.id,
          status: row.status,
          occupiedSeats: seats.filter((s) => s.account_id !== null).length,
          createdAt: row.created_at,
          closedAt: row.closed_at,
        };
      }),
    );
    return { tables, total: page.total };
  }

  /**
   * `POST /admin/tables/{id}/force-close` (`FR-161`) — the only
   * administrative action that touches a game. Closes the durable row
   * regardless of whether a live `TableActor` exists in this process (one
   * may not: `main.ts` restores every non-closed table's actor at startup,
   * docs/29, but a single table's own restore can still fail — a corrupt
   * checkpoint marks only that table unavailable, `tables/manager.ts`'s
   * `restoreLiveTables`); when one does, its gateway delivers `TableClosed`
   * to every connected seat and its concealed material is discarded
   * (`TableActor.forceClose`).
   */
  async forceCloseTable(actorAccountId: string, tableId: string, reason: string): Promise<ForceCloseTableResult> {
    const row = await this.tables.findById(tableId);
    if (row === null) return { ok: false, code: "NOT_FOUND" };

    const live = this.manager.get(tableId);
    if (live !== undefined) {
      live.gateway.forceClose(reason);
    }
    await this.tables.setStatus(tableId, "closed", this.now());
    await this.recordAudit(actorAccountId, "table_force_closed", "table", tableId, reason);
    return { ok: true };
  }

  /** `GET /admin/health` (`FR-162`) — see `AdminHealth`'s own doc comment for what's deliberately not here. */
  async health(): Promise<AdminHealth> {
    let liveInThisProcess = 0;
    let connections = 0;
    for (const live of this.manager.all()) {
      liveInThisProcess += 1;
      connections += live.gateway.connectionCount();
    }
    const { total } = await this.tables.list({ limit: 0, offset: 0 });
    return {
      uptimeSeconds: process.uptime(),
      tables: { total, liveInThisProcess },
      connections,
    };
  }

  /** `GET /admin/audit` (`FR-163`). */
  async auditEntries(query: AuditLogQuery): Promise<AuditLogPage> {
    return this.auditLog.list(query);
  }

  private async recordAudit(actorAccountId: string, action: string, targetType: string, targetId: string, reason: string): Promise<void> {
    await this.auditLog.record({
      id: this.idFactory(),
      actorAccountId,
      action,
      targetType,
      targetId,
      reason,
      ip: null,
      occurredAt: this.now(),
    });
  }
}
