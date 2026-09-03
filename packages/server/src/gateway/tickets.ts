// Connect tickets (docs/12_Realtime_WebSocket_Architecture.md §4.1;
// docs/17_Database_Design.md §5.3). Real issuance is a REST endpoint,
// authenticated by session, that verifies seat occupancy before minting
// one (docs/12 §4) — see `tables/service.ts`'s `issueConnectTicket` and
// `tables/http.ts`'s `POST /tables/{id}/connect-ticket`. This module is
// the gateway-facing half: single-use, time-limited, server-side claims
// the client never sees.
//
// Scope note: the real design stores `ticket_hash` in PostgreSQL, with
// single-use enforced by a unique constraint rather than an
// application check (docs/17 §5.3) — a redemption race is impossible by
// construction there. This in-memory store enforces single-use with a
// `redeemed` flag instead, which is sufficient for one process but is
// not the durable, constraint-backed guarantee the real design specifies.
import { randomBytes } from "node:crypto";
import type { Seat } from "@mahjong-dealer/shared";

export interface TicketClaims {
  readonly accountId: string;
  readonly sessionId: string;
  readonly tableId: string;
  readonly seat: Seat;
}

interface StoredTicket extends TicketClaims {
  readonly expiresAt: number;
  redeemed: boolean;
}

const DEFAULT_TTL_MS = 30_000; // docs/12 §4.1: "long enough to open a socket, short enough to be useless if captured"

export class TicketStore {
  private readonly tickets = new Map<string, StoredTicket>();

  constructor(
    readonly ttlMs: number = DEFAULT_TTL_MS,
    private readonly now: () => number = Date.now,
  ) {}

  issue(claims: TicketClaims): string {
    const ticket = randomBytes(32).toString("hex");
    this.tickets.set(ticket, { ...claims, expiresAt: this.now() + this.ttlMs, redeemed: false });
    return ticket;
  }

  /**
   * Redeems a ticket exactly once. A second redemption of the same value
   * — the replay this mechanism exists to prevent — returns `null`
   * exactly as an unknown or expired ticket does (docs/12 §4.1's "a
   * captured ticket cannot be replayed").
   */
  redeem(ticket: string): TicketClaims | null {
    const stored = this.tickets.get(ticket);
    if (stored === undefined || stored.redeemed || stored.expiresAt <= this.now()) {
      return null;
    }
    stored.redeemed = true;
    const { accountId, sessionId, tableId, seat } = stored;
    return { accountId, sessionId, tableId, seat };
  }

  /**
   * Reads a ticket's claims without consuming it — for the multi-table
   * router (`gateway/multi-table-router.ts`), which must learn a ticket's
   * `tableId` before it knows which table's `TicketStore` should perform
   * the real, consuming `redeem` inside that table's own `TableGateway`.
   * Same `null` cases as `redeem`: unknown, expired, or already redeemed.
   */
  peek(ticket: string): TicketClaims | null {
    const stored = this.tickets.get(ticket);
    if (stored === undefined || stored.redeemed || stored.expiresAt <= this.now()) {
      return null;
    }
    const { accountId, sessionId, tableId, seat } = stored;
    return { accountId, sessionId, tableId, seat };
  }
}
