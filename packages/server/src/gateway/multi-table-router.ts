// Multi-table WebSocket routing. `ws-server.ts`'s `attachWebSocketGateway`
// serves exactly one `TableGateway` — fine for a smoke test, but a real
// deployment has many live tables (`tables/manager.ts`'s `TableManager`),
// each with its own actor and its own `TicketStore`. A connect ticket
// already carries its `tableId` (`gateway/tickets.ts`'s `TicketClaims`),
// so this module peeks that claim — without consuming it — to find the
// right `TableGateway` before that gateway ever sees the socket. Once
// found, everything after this point is exactly `attachWebSocketGateway`'s
// own logic, reused rather than reimplemented: the first message (the
// bind frame itself) is replayed into the destination gateway's own
// `acceptConnection`/`handleBind`, which performs the real, consuming
// `redeem` against that same `TicketStore` instance.
//
// This keeps `gateway.ts` and its existing test suite untouched — the
// only change there is exporting the two small parsing helpers this
// module also needs, so a bind frame is recognized the same way in both
// places rather than by a second, possibly-drifting parser.
//
// Design note: once a connection resolves to a table, the destination
// gateway's own `acceptConnection` records its *own* `connectedAt` at
// that (slightly later) moment, so its internal 5-second bind-deadline
// check is trivially satisfied — that check was written for the
// single-table server, where `acceptConnection` runs immediately on
// `connection`. Here, the deadline that actually matters — bounding how
// long a client may hold the socket open before sending a recognizable
// bind frame at all — is enforced by this module's own `preResolveTimer`
// instead, measured from the real connection time.
//
// Session revocation (docs/12 §4.3) polls every live table's gateway on
// one shared interval, rather than one interval per table — cheap at the
// table-count scale a single process owns, and it means a table created
// after this function runs is covered on the very next tick without
// this module needing to know about it.
//
// Heartbeats (docs/12 §7) reuse `ws-server.ts`'s `startHeartbeat` as-is,
// one per connection exactly as the single-table server runs it — a dead
// connection is a transport fact independent of which table it will turn
// out to belong to, so there's nothing multi-table-specific about it.
import type { Server as HttpServer } from "node:http";
import { WebSocketServer, type WebSocket } from "ws";
import type { TableManager } from "../tables/manager.js";
import { isRecord, parseJson, type ConnectionHandle } from "./gateway.js";
import { startHeartbeat, wsToSocketLike } from "./ws-server.js";

const BIND_DEADLINE_GRACE_MS = 5_200; // docs/12 §4.2's 5s deadline, plus scheduling slack
const SESSION_REVOCATION_POLL_MS = 2_000; // see ws-server.ts's own constant of the same name
const HEARTBEAT_INTERVAL_MS = 15_000; // see ws-server.ts's own constant of the same name

export interface AttachMultiTableGatewayOptions {
  readonly server: HttpServer;
  readonly manager: TableManager;
  readonly path?: string;
  /** Origin allow-list (docs/12 §4.2). Omit to accept any origin — do not do this in production. */
  readonly allowedOrigins?: readonly string[];
  /** Overrides `SESSION_REVOCATION_POLL_MS` — for tests that don't want to wait 2 real seconds. */
  readonly sessionRevocationPollMs?: number;
  /** Overrides `HEARTBEAT_INTERVAL_MS` — for tests that don't want to wait 15-30 real seconds. */
  readonly heartbeatIntervalMs?: number;
}

/** Attaches every live table's gateway to one WebSocket upgrade path, routed per connection by the bind frame's ticket. */
export function attachMultiTableGateway(options: AttachMultiTableGatewayOptions): WebSocketServer {
  const wss = new WebSocketServer({ server: options.server, path: options.path ?? "/ws" });

  // One poll per tick across every live table, not one interval per table
  // — `TableManager.all()` is read fresh on each tick, so a table created
  // after this call is covered without re-registering anything.
  const revocationPoll = setInterval(() => {
    for (const live of options.manager.all()) {
      void live.gateway.checkSessionRevocation();
    }
  }, options.sessionRevocationPollMs ?? SESSION_REVOCATION_POLL_MS);
  wss.on("close", () => clearInterval(revocationPoll));

  wss.on("connection", (ws: WebSocket, request) => {
    if (options.allowedOrigins !== undefined) {
      const origin = request.headers.origin;
      if (origin === undefined || !options.allowedOrigins.includes(origin)) {
        ws.close(4008, "PROTOCOL_VIOLATION");
        return;
      }
    }

    const connectedAt = Date.now();
    let handle: ConnectionHandle | null = null;
    let postResolveTimer: ReturnType<typeof setTimeout> | undefined;
    const preResolveTimer = setTimeout(() => {
      if (handle === null) ws.close(4001, "BIND_REQUIRED");
    }, BIND_DEADLINE_GRACE_MS);
    const stopHeartbeat = startHeartbeat(ws, options.heartbeatIntervalMs ?? HEARTBEAT_INTERVAL_MS);

    ws.on("message", (data) => {
      const raw = data.toString();
      if (handle !== null) {
        handle.onMessage(raw);
        return;
      }

      const ticket = extractBindTicket(raw);
      const owner = ticket === null ? null : options.manager.findTicketOwner(ticket);
      if (owner === null) {
        ws.close(4002, "TICKET_INVALID");
        return;
      }

      clearTimeout(preResolveTimer);
      handle = owner.live.gateway.acceptConnection(wsToSocketLike(ws));
      const remaining = Math.max(0, BIND_DEADLINE_GRACE_MS - (Date.now() - connectedAt));
      postResolveTimer = setTimeout(() => handle!.checkBindDeadline(), remaining);
      handle.onMessage(raw); // replays the bind frame so the destination gateway performs the real redeem
    });

    ws.on("close", () => {
      clearTimeout(preResolveTimer);
      clearTimeout(postResolveTimer);
      stopHeartbeat();
      handle?.onClose();
    });
  });

  return wss;
}

function extractBindTicket(raw: string): string | null {
  const frame = parseJson(raw);
  if (frame === null || !isRecord(frame) || frame["t"] !== "cmd" || frame["cmd"] !== "bind") return null;
  const data = frame["d"];
  const ticket = isRecord(data) ? data["ticket"] : undefined;
  return typeof ticket === "string" ? ticket : null;
}
