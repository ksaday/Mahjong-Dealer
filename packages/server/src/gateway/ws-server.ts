// The real transport: a thin `ws` adapter over the transport-agnostic
// gateway logic in `gateway.ts`. Everything that decides *what happens* to
// a frame lives there and is unit-tested with `MockSocket`; this file only
// translates `ws`'s events into `SocketLike` calls, so a framing or
// sequencing bug is never a reason to doubt the transport (docs/26 §3.2's
// reasoning, applied to the boundary between the two).
//
// Scope note: origin checking (docs/12 §4.2) is implemented. The bind
// deadline (docs/12 §4.2) is enforced here with a real `setTimeout`,
// session revocation (docs/12 §4.3) with a real `setInterval`, and
// heartbeats (docs/12 §7) with a third real timer (`startHeartbeat`) —
// all three calling the gateway's own injected-clock-testable checks
// (`checkBindDeadline`, `checkSessionRevocation`) or, for heartbeats,
// acting directly on the raw `ws` socket, since a dead connection is a
// transport fact `gateway.ts`'s transport-agnostic logic has no need to
// see (it only ever finds out via the resulting `close` event, exactly
// as it would for any other disconnection).
import type { Server as HttpServer } from "node:http";
import { WebSocketServer, type WebSocket } from "ws";
import type { TableGateway } from "./gateway.js";
import type { SocketLike } from "./socket.js";

const BIND_DEADLINE_GRACE_MS = 5_200; // docs/12 §4.2's 5s deadline, plus scheduling slack
// docs/12 §4.3 requires the *outcome* — closed within 5s of revocation —
// without pinning a poll interval; 2s is an implementation default, the
// same kind of unpinned constant `auth/lockout.ts`'s curve already is.
const SESSION_REVOCATION_POLL_MS = 2_000;
const HEARTBEAT_INTERVAL_MS = 15_000; // docs/12 §7: "server ping interval: 15s"
const MISSED_PONGS_TOLERATED = 2; // docs/12 §7 / docs/22 §4: "misses before absent: 2"

export interface AttachGatewayOptions {
  readonly server: HttpServer;
  readonly gateway: TableGateway;
  readonly path?: string;
  /** Origin allow-list (docs/12 §4.2). Omit to accept any origin — do not do this in production. */
  readonly allowedOrigins?: readonly string[];
  /** Overrides `SESSION_REVOCATION_POLL_MS` — for tests that don't want to wait 2 real seconds. */
  readonly sessionRevocationPollMs?: number;
  /** Overrides `HEARTBEAT_INTERVAL_MS` — for tests that don't want to wait 15-30 real seconds. */
  readonly heartbeatIntervalMs?: number;
}

/** Attaches the gateway to a real HTTP server's WebSocket upgrade path. Returns the underlying `WebSocketServer` for lifecycle management (e.g. `.close()`). */
export function attachWebSocketGateway(options: AttachGatewayOptions): WebSocketServer {
  const wss = new WebSocketServer({ server: options.server, path: options.path ?? "/ws" });

  const revocationPoll = setInterval(() => {
    void options.gateway.checkSessionRevocation();
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

    const handle = options.gateway.acceptConnection(wsToSocketLike(ws));
    const bindTimer = setTimeout(() => handle.checkBindDeadline(), BIND_DEADLINE_GRACE_MS);
    const stopHeartbeat = startHeartbeat(ws, options.heartbeatIntervalMs ?? HEARTBEAT_INTERVAL_MS);

    ws.on("message", (data) => {
      handle.onMessage(data.toString());
    });
    ws.on("close", () => {
      clearTimeout(bindTimer);
      stopHeartbeat();
      handle.onClose();
    });
  });

  return wss;
}

/** The `ws`-to-`SocketLike` adapter, shared with `multi-table-router.ts` — one table's worth of framing decisions, not two. */
export function wsToSocketLike(ws: WebSocket): SocketLike {
  return {
    send(data, onFlushed) {
      ws.send(data, (error) => {
        if (error === undefined) onFlushed?.();
      });
    },
    close(code, reason) {
      ws.close(code, reason);
    },
  };
}

/**
 * Server-initiated heartbeats (docs/12 §7), shared with
 * `multi-table-router.ts`. WebSocket protocol ping/pong control frames,
 * not the JSON command envelope — invisible to `gateway.ts`, which never
 * sees a "ping" here (the client-initiated `ping` *command*, replied to
 * with a `pong` *frame*, is a separate, already-implemented mechanism at
 * the envelope level, docs/12 §5.2).
 *
 * A ping unanswered by the next tick counts as one miss; two consecutive
 * misses terminate the connection — `ws.terminate()`, not `.close()`,
 * because a connection this unresponsive cannot be trusted to complete a
 * graceful closing handshake. Termination fires the socket's own `close`
 * event exactly as any other disconnection does, which is what lets
 * `gateway.ts`'s existing `onClose` → `autoPauseOnAbsence` path handle it
 * with no heartbeat-specific code of its own.
 *
 * Detection is worst-case two full intervals (docs/12 §7's "~35s" for a
 * 15s interval is an approximation in the same spirit) — deliberately not
 * faster, per that section's own reasoning: a shorter timeout would mark
 * ordinary mobile network transitions as absences.
 *
 * Typed against this narrow slice of the real `ws.WebSocket` — which
 * satisfies it structurally, so both call sites pass one unchanged —
 * rather than the concrete class, so a test can drive it with a plain
 * fake instead of a real socket.
 */
export interface HeartbeatSocket {
  on(event: "pong", listener: () => void): unknown;
  ping(): void;
  terminate(): void;
}

export function startHeartbeat(ws: HeartbeatSocket, intervalMs: number): () => void {
  let awaitingPong = false;
  let misses = 0;

  ws.on("pong", () => {
    awaitingPong = false;
    misses = 0;
  });

  const timer = setInterval(() => {
    if (awaitingPong) {
      misses += 1;
      if (misses >= MISSED_PONGS_TOLERATED) {
        ws.terminate();
        return;
      }
    }
    awaitingPong = true;
    ws.ping();
  }, intervalMs);

  return () => clearInterval(timer);
}
