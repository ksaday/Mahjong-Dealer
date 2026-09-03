// A `SocketLike` test double — the socket-layer equivalent of dealer-core's
// `createDeterministicEntropy` and the table actor's `TableHarness`: real
// gateway logic, no real network (docs/26 §3.2's reasoning applies here
// too — a framing bug should fail for a framing reason).
import type { SocketLike } from "../gateway/socket.js";

export class MockSocket implements SocketLike {
  readonly sent: unknown[] = [];
  readonly closes: { readonly code: number; readonly reason: string }[] = [];

  send(data: string, onFlushed?: () => void): void {
    this.sent.push(JSON.parse(data));
    onFlushed?.(); // flushes synchronously; a real socket would do so asynchronously
  }

  close(code: number, reason: string): void {
    this.closes.push({ code, reason });
  }

  get isClosed(): boolean {
    return this.closes.length > 0;
  }

  framesOfType(t: string): readonly Record<string, unknown>[] {
    return this.sent.filter(
      (frame): frame is Record<string, unknown> =>
        typeof frame === "object" && frame !== null && (frame as Record<string, unknown>)["t"] === t,
    );
  }
}
