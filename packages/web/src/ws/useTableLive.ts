import { useCallback, useEffect, useRef, useState } from "react";
import type { NoticeKind, RejectFrame, TableEvent, WireSeatView } from "@mahjong-dealer/shared";
import { tablesApi } from "../api/tables.js";
import { TableSocket, type TableSocketEvent } from "./TableSocket.js";
import { tableGatewayUrl } from "./url.js";

// Wires `TableSocket` into a table screen: mint a connect ticket
// (docs/12 §4.1 — REST, session-authenticated, single use), open the
// socket, and expose the live seat view. Each frame's `view` (docs/12
// §5.4) replaces the previous one wholesale — this hook holds no derived
// state to drift, matching D-12-05.
//
// Reconnection here is manual, not the automatic exponential-backoff
// policy docs/12 §10.1 specifies for 4010/1012/transport loss — a real
// gap, flagged rather than silently narrowed. `reconnect()` re-mints a
// ticket and opens a fresh socket, which is the right recovery for every
// close code in that table, just not automatically triggered.
export type TableLivePhase = "minting" | "connecting" | "bound" | "ready" | "closed" | "error";

export interface TableLiveState {
  readonly phase: TableLivePhase;
  readonly view: WireSeatView | null;
  readonly lastReject: RejectFrame | null;
  readonly closeInfo: { readonly code: number; readonly reason: string } | null;
  readonly errorMessage: string | null;
  /**
   * The event carried by the most recent `event` frame, alongside its seq
   * so a consumer keyed on this value re-fires even when the same event
   * type repeats. `null` until the first one arrives, and not replayed on
   * `resumed` (docs/12 §5.4 sends a snapshot there, never a backlog) — the
   * source for anything the seat view itself doesn't retain: chat
   * (`FR-131`, session-only by design), signals, a pause's reason and
   * seat, and a conclusion's outcome.
   */
  readonly lastEvent: { readonly ev: TableEvent; readonly seq: number } | null;
  /**
   * The most recent `notice` frame (docs/19 §7.3) — `connection_degraded`,
   * `rate_limit_warning`, `service_restarting`. `id` is a local counter,
   * not a wire `seq` (notices carry none), so a consumer keyed on it
   * re-fires even when the same kind repeats back to back.
   */
  readonly lastNotice: { readonly kind: NoticeKind; readonly id: number } | null;
  /** Throws if the connection isn't `"ready"` yet — callers gate on `phase` first. */
  readonly send: TableSocket["send"];
  reconnect(): void;
}

/** `tableId === ""` means "not known yet" — the hook stays in `"minting"` without calling the server. */
export function useTableLive(tableId: string): TableLiveState {
  const [phase, setPhase] = useState<TableLivePhase>("minting");
  const [view, setView] = useState<WireSeatView | null>(null);
  const [lastReject, setLastReject] = useState<RejectFrame | null>(null);
  const [closeInfo, setCloseInfo] = useState<{ readonly code: number; readonly reason: string } | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [lastEvent, setLastEvent] = useState<{ readonly ev: TableEvent; readonly seq: number } | null>(null);
  const [lastNotice, setLastNotice] = useState<{ readonly kind: NoticeKind; readonly id: number } | null>(null);
  const [attempt, setAttempt] = useState(0);
  const socketRef = useRef<TableSocket | null>(null);
  const noticeSeq = useRef(0);

  useEffect(() => {
    if (tableId === "") return;
    let cancelled = false;
    setPhase("minting");
    setCloseInfo(null);
    setErrorMessage(null);

    tablesApi
      .connectTicket(tableId)
      .then((ticket) => {
        if (cancelled) return;
        setPhase("connecting");
        const socket = new TableSocket(tableGatewayUrl(), ticket.ticket, (event: TableSocketEvent) => {
          if (cancelled) return;
          if (event.type === "bound") setPhase("bound");
          else if (event.type === "resumed") {
            setPhase("ready");
            if (event.frame.view !== undefined) setView(event.frame.view);
          } else if (event.type === "event") {
            setView(event.frame.view);
            setLastEvent({ ev: event.frame.ev, seq: event.frame.seq });
          } else if (event.type === "reject") setLastReject(event.frame);
          else if (event.type === "notice") {
            noticeSeq.current += 1;
            setLastNotice({ kind: event.frame.kind, id: noticeSeq.current });
          } else if (event.type === "closed") {
            setPhase("closed");
            setCloseInfo({ code: event.code, reason: event.reason });
          }
        });
        socketRef.current = socket;
      })
      .catch((error: unknown) => {
        if (cancelled) return;
        setPhase("error");
        setErrorMessage(error instanceof Error ? error.message : "Could not connect to the table.");
      });

    return () => {
      cancelled = true;
      socketRef.current?.close();
      socketRef.current = null;
    };
  }, [tableId, attempt]);

  // Not memoized with useCallback: preserving TableSocket["send"]'s
  // generic signature through useCallback's own inference isn't worth
  // the type gymnastics for a closure this cheap to recreate.
  const send: TableSocket["send"] = (...args) => {
    const socket = socketRef.current;
    if (socket === null) {
      throw new Error("cannot send before the connection is established");
    }
    return socket.send(...args);
  };

  const reconnect = useCallback(() => setAttempt((n) => n + 1), []);

  return { phase, view, lastReject, closeInfo, errorMessage, lastEvent, lastNotice, send, reconnect };
}
