// The administrative surface (docs/18_API_Design.md §4.3;
// docs/33_API/REST_Endpoint_Catalog.md). Reuses `request`/`ApiError`
// rather than a second HTTP implementation.
//
// Known gap, inherited from the server side (`server/src/auth/
// session-guard.ts`'s `requireAdmin`): docs/15 §8 requires a second
// factor on every one of these calls, and none of the session cookies
// this client already sends carries one — there is nothing for this
// module to add on the wire that isn't already invented server-side.
import { request } from "./client.js";

export interface AdminAccountSummary {
  readonly account_id: string;
  readonly email: string;
  readonly display_name: string;
  readonly role: "player" | "administrator";
  readonly status: "active" | "disabled";
  readonly created_at: string;
}

export interface AdminTableSummary {
  readonly table_id: string;
  readonly status: string;
  readonly occupied_seats: number;
  readonly created_at: string;
  readonly closed_at: string | null;
}

export interface AdminHealth {
  readonly uptime_seconds: number;
  readonly tables: { readonly total: number; readonly live_in_this_process: number };
  readonly connections: number;
}

export interface AuditEntry {
  readonly id: string;
  readonly actor_account_id: string | null;
  readonly action: string;
  readonly target_type: string | null;
  readonly target_id: string | null;
  readonly reason: string | null;
  readonly ip: string | null;
  readonly occurred_at: string;
}

export const adminApi = {
  listAccounts(params: { readonly query?: string; readonly status?: string } = {}): Promise<{ total: number; accounts: readonly AdminAccountSummary[] }> {
    const search = new URLSearchParams();
    if (params.query !== undefined && params.query !== "") search.set("query", params.query);
    if (params.status !== undefined && params.status !== "") search.set("status", params.status);
    const qs = search.toString();
    return request(`/admin/accounts${qs === "" ? "" : `?${qs}`}`);
  },
  setAccountStatus(accountId: string, status: "active" | "disabled", reason: string): Promise<{ status: string }> {
    return request(`/admin/accounts/${encodeURIComponent(accountId)}`, { method: "PATCH", body: { status, reason } });
  },
  listTables(): Promise<{ total: number; tables: readonly AdminTableSummary[] }> {
    return request("/admin/tables");
  },
  forceCloseTable(tableId: string, reason: string): Promise<void> {
    return request(`/admin/tables/${encodeURIComponent(tableId)}/force-close`, { method: "POST", body: { reason } });
  },
  health(): Promise<AdminHealth> {
    return request("/admin/health");
  },
  audit(): Promise<{ total: number; entries: readonly AuditEntry[] }> {
    return request("/admin/audit");
  },
};
