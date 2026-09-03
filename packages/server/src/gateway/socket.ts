// A transport-agnostic socket abstraction. The gateway logic (bind,
// framing, delivery, resumption, backpressure — docs/12) is written
// against this interface and tested with a `MockSocket`, the same way the
// table actor is tested with no transport at all (docs/26 §3.2 applies
// here too: a framing bug should fail for a framing reason). A real
// WebSocket adapter (`ws`) implements it in `ws-server.ts`.
export interface SocketLike {
  /**
   * Sends one frame. `onFlushed` fires once the platform has actually
   * written the bytes — the callback is what lets backpressure be
   * measured as "bytes handed off and not yet confirmed written"
   * (docs/12 §9), rather than a buffered-amount metric that stays at zero
   * until the kernel buffer is already full (docs/12 §9.1).
   */
  send(data: string, onFlushed?: () => void): void;
  close(code: number, reason: string): void;
}
