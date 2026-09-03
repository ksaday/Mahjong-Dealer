// The real transport: a thin `ws` adapter over the transport-agnostic
// gateway logic in `gateway.ts`. Everything that decides *what happens* to
// a frame lives there and is unit-tested with `MockSocket`; this file only
// translates `ws`'s events into `SocketLike` calls, so a framing or
// sequencing bug is never a reason to doubt the transport (docs/26 §3.2's
// reasoning, applied to the boundary between the two).
//
// Scope note: origin checking (docs/12 §4.2) is implemented; heartbeats
// (docs/12 §7) and session-revocation polling (docs/12 §4.3) are not —
// see gateway.ts's module comment for why. The bind deadline (docs/12
// §4.2) is enforced here with a real `setTimeout`, calling the gateway's
// injected-clock-testable `checkBindDeadline`.
import type { Server as HttpServer } from "node:http";
import { WebSocketServer, type WebSocket } from "ws";
import type { TableGateway } from "./gateway.js";
import type { SocketLike } from "./socket.js";

const BIND_DEADLINE_GRACE_MS = 5_200; // docs/12 §4.2's 5s deadline, plus scheduling slack

export interface AttachGatewayOptions {
  readonly server: HttpServer;
  readonly gateway: TableGateway;
  readonly path?: string;
  /** Origin allow-list (docs/12 §4.2). Omit to accept any origin — do not do this in production. */
  readonly allowedOrigins?: readonly string[];
}

/** Attaches the gateway to a real HTTP server's WebSocket upgrade path. Returns the underlying `WebSocketServer` for lifecycle management (e.g. `.close()`). */
export function attachWebSocketGateway(options: AttachGatewayOptions): WebSocketServer {
  const wss = new WebSocketServer({ server: options.server, path: options.path ?? "/ws" });

  wss.on("connection", (ws: WebSocket, request) => {
    if (options.allowedOrigins !== undefined) {
      const origin = request.headers.origin;
      if (origin === undefined || !options.allowedOrigins.includes(origin)) {
        ws.close(4008, "PROTOCOL_VIOLATION");
        return;
      }
    }

    const socket: SocketLike = {
      send(data, onFlushed) {
        ws.send(data, (error) => {
          if (error === undefined) onFlushed?.();
        });
      },
      close(code, reason) {
        ws.close(code, reason);
      },
    };

    const handle = options.gateway.acceptConnection(socket);
    const bindTimer = setTimeout(() => handle.checkBindDeadline(), BIND_DEADLINE_GRACE_MS);

    ws.on("message", (data) => {
      handle.onMessage(data.toString());
    });
    ws.on("close", () => {
      clearTimeout(bindTimer);
      handle.onClose();
    });
  });

  return wss;
}
