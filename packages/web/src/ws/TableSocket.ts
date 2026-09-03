// The socket client (docs/12_Realtime_WebSocket_Architecture.md): connect,
// bind with a one-time ticket, resume, then send commands and dispatch
// server frames. Written against a small `WebSocketLike` seam — mirroring
// `server/src/gateway/socket.ts`'s own `SocketLike` — so the state machine
// is testable with a mock transport instead of a real network socket.
//
// `cmdId` is minted once per player intent, not per transmission (docs/13
// §4.1): callers of `send()` are responsible for reusing the returned
// `cmdId` on their own retries rather than calling `send()` again, which
// would mint a fresh one and defeat idempotency.
//
// `cseq` starts fresh at 1 for the first frame *after* `bound` (the
// server's own `Connection` object, and its `cseq` counter, don't exist
// until the bind succeeds — server/src/gateway/gateway.ts's `handleBind`
// parses the bind frame by hand and never checks its `cseq` at all).
import type { CommandName, CommandParamsMap, ServerFrame } from "@mahjong-dealer/shared";
import { uuidv7 } from "./uuidv7.js";

export interface WebSocketLike {
  send(data: string): void;
  close(code?: number, reason?: string): void;
  addEventListener(type: "open", listener: () => void): void;
  addEventListener(type: "message", listener: (event: { readonly data: unknown }) => void): void;
  addEventListener(type: "close", listener: (event: { readonly code: number; readonly reason: string }) => void): void;
  addEventListener(type: "error", listener: () => void): void;
}

export type WebSocketFactory = (url: string) => WebSocketLike;

const defaultFactory: WebSocketFactory = (url) => new WebSocket(url);

export type TableSocketEvent =
  | { readonly type: "bound"; readonly frame: Extract<ServerFrame, { t: "bound" }> }
  | { readonly type: "resumed"; readonly frame: Extract<ServerFrame, { t: "resumed" }> }
  | { readonly type: "ack"; readonly frame: Extract<ServerFrame, { t: "ack" }> }
  | { readonly type: "reject"; readonly frame: Extract<ServerFrame, { t: "reject" }> }
  | { readonly type: "event"; readonly frame: Extract<ServerFrame, { t: "event" }> }
  | { readonly type: "notice"; readonly frame: Extract<ServerFrame, { t: "notice" }> }
  | { readonly type: "pong" }
  | { readonly type: "closed"; readonly code: number; readonly reason: string };

type Phase = "connecting" | "binding" | "resuming" | "ready" | "closed";

/** `undefined` means the command carries no `d` at all (docs/33_API §4). */
type CommandArg<N extends CommandName> = CommandParamsMap[N] extends undefined ? [] : [d: CommandParamsMap[N]];

export class TableSocket {
  private readonly socket: WebSocketLike;
  private readonly listener: (event: TableSocketEvent) => void;
  private phase: Phase = "connecting";
  private cseq = 0;

  constructor(
    url: string,
    ticket: string,
    listener: (event: TableSocketEvent) => void,
    options: { readonly resumeFromSeq?: number; readonly factory?: WebSocketFactory } = {},
  ) {
    this.listener = listener;
    const factory = options.factory ?? defaultFactory;
    this.socket = factory(url);

    this.socket.addEventListener("open", () => {
      this.phase = "binding";
      // Unchecked by the server (see module comment) — sent for
      // structural completeness, not because a value here matters.
      this.socket.send(JSON.stringify({ t: "cmd", cmd: "bind", cmdId: uuidv7(), cseq: 1, d: { ticket } }));
    });

    this.socket.addEventListener("message", (event) => {
      const frame = parseServerFrame(event.data);
      if (frame === null) return;
      this.handleFrame(frame, options.resumeFromSeq ?? 0);
    });

    this.socket.addEventListener("close", (event) => {
      this.phase = "closed";
      this.listener({ type: "closed", code: event.code, reason: event.reason });
    });
  }

  private handleFrame(frame: ServerFrame, resumeFromSeq: number): void {
    if (frame.t === "bound") {
      this.phase = "resuming";
      this.listener({ type: "bound", frame });
      this.socket.send(
        JSON.stringify({ t: "cmd", cmd: "resume", cmdId: uuidv7(), cseq: this.nextCseq(), d: { lastSeq: resumeFromSeq } }),
      );
      return;
    }
    if (frame.t === "resumed") {
      this.phase = "ready";
      this.listener({ type: "resumed", frame });
      return;
    }
    if (frame.t === "pong") {
      this.listener({ type: "pong" });
      return;
    }
    this.listener({ type: frame.t, frame } as TableSocketEvent);
  }

  private nextCseq(): number {
    this.cseq += 1;
    return this.cseq;
  }

  /** Mints a fresh `cmdId` and sends the command. Returns the `cmdId` so the caller can match it against an `ack`/`reject` and reuse it on retry. */
  send<N extends CommandName>(cmd: N, ...args: CommandArg<N>): string {
    if (this.phase !== "ready") {
      throw new Error(`cannot send "${cmd}" before the connection is ready (phase: ${this.phase})`);
    }
    const cmdId = uuidv7();
    const d = args[0];
    const frame = d === undefined ? { t: "cmd", cmd, cmdId, cseq: this.nextCseq() } : { t: "cmd", cmd, cmdId, cseq: this.nextCseq(), d };
    this.socket.send(JSON.stringify(frame));
    return cmdId;
  }

  close(): void {
    this.socket.close();
  }
}

function parseServerFrame(data: unknown): ServerFrame | null {
  if (typeof data !== "string") return null;
  try {
    const parsed: unknown = JSON.parse(data);
    if (parsed === null || typeof parsed !== "object" || !("t" in parsed)) return null;
    return parsed as ServerFrame;
  } catch {
    return null;
  }
}
