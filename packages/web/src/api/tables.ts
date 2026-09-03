// The table surface (docs/18_API_Design.md §4.2; docs/33_API/REST_Endpoint_Catalog.md §4) —
// the 5 endpoints alongside `client.ts`'s 8 accounts/sessions ones. Reuses
// `request`/`ApiError` rather than a second HTTP implementation.
//
// Scope note: `Idempotency-Key` on `POST /tables` (D-18-10) is not sent
// here — the server doesn't honour it yet either (flagged gap in
// `server/src/tables/http.ts`), so sending one would claim a guarantee
// that doesn't exist.
import { request } from "./client.js";

export type Seat = "east" | "south" | "west" | "north";

export interface CreateTableResult {
  readonly table_id: string;
  /** Returned exactly once (D-18-05) — never obtainable again by any endpoint. */
  readonly join_code: string;
  readonly seat: Seat;
}

export interface JoinTableResult {
  readonly table_id: string;
  readonly seat: Seat;
}

export interface TableSeatSummary {
  readonly seat: Seat;
  readonly display_name: string | null;
  readonly connected: boolean;
}

export interface MyTable {
  readonly table_id: string;
  readonly status: string;
  readonly seat: Seat;
  readonly seats: readonly TableSeatSummary[];
  readonly game_state: string | null;
}

export interface ConnectTicket {
  readonly ticket: string;
  readonly expires_at: string;
}

export const tablesApi = {
  create(): Promise<CreateTableResult> {
    return request("/tables", { method: "POST" });
  },
  join(joinCode: string): Promise<JoinTableResult> {
    return request("/tables/join", { method: "POST", body: { join_code: joinCode } });
  },
  mine(): Promise<{ tables: readonly MyTable[] }> {
    return request("/tables/mine");
  },
  close(tableId: string): Promise<void> {
    return request(`/tables/${tableId}`, { method: "DELETE" });
  },
  connectTicket(tableId: string): Promise<ConnectTicket> {
    return request(`/tables/${tableId}/connect-ticket`, { method: "POST" });
  },
};
