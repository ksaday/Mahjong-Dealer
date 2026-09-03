// Per-connection state (docs/12_Realtime_WebSocket_Architecture.md §4.2,
// §9; docs/13_Input_Integrity.md §5). One connection is bound to exactly
// one seat (D-12-10); this object is that binding plus the bookkeeping
// the gateway needs to enforce sequencing, staleness, and backpressure.
import type { Seat } from "@mahjong-dealer/shared";
import { createCommandRateLimiter, type TokenBucket } from "./rate-limit.js";
import type { SocketLike } from "./socket.js";

const BACKPRESSURE_THRESHOLD_BYTES = 1_000_000; // 1 MB (docs/12 §9)
const MAX_CONSECUTIVE_THROTTLES = 20; // docs/13 §10

export class Connection {
  readonly seat: Seat;
  /** The session this connection's ticket was minted for (docs/12 §4.3) — the key `checkSessionRevocation` polls against. */
  readonly sessionId: string;
  readonly socket: SocketLike;
  readonly rateLimiter: TokenBucket;
  readonly boundAt: number;

  /** Last `cseq` accepted from this connection; 0 means none yet (docs/13 §5). */
  cseq = 0;
  /**
   * The highest wire `seq` this connection has actually been sent —
   * updated on every frame delivered. Doubles as the staleness cursor
   * (docs/13 §6) and the resumption baseline (docs/12 §8): if it lags the
   * actor's current `seq` when a sensitive command arrives, that command
   * was decided against a view that is now out of date.
   */
  lastDeliveredSeq = 0;
  throttleStreak = 0;
  private pendingBytes = 0;

  constructor(seat: Seat, sessionId: string, socket: SocketLike, now: () => number = Date.now) {
    this.seat = seat;
    this.sessionId = sessionId;
    this.socket = socket;
    this.rateLimiter = createCommandRateLimiter(now);
    this.boundAt = now();
  }

  /** True once accepting more would exceed the backpressure threshold (docs/12 §9). */
  get isSlowConsumer(): boolean {
    return this.pendingBytes > BACKPRESSURE_THRESHOLD_BYTES;
  }

  get hasExceededThrottleLimit(): boolean {
    return this.throttleStreak >= MAX_CONSECUTIVE_THROTTLES;
  }

  send(data: string): void {
    this.pendingBytes += Buffer.byteLength(data);
    this.socket.send(data, () => {
      this.pendingBytes -= Buffer.byteLength(data);
    });
  }

  close(code: number, reason: string): void {
    this.socket.close(code, reason);
  }
}
