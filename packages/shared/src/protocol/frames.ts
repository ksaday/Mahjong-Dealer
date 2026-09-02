// Server-to-client frames (docs/19_WebSocket_Event_Catalog.md §4.2;
// docs/33_API/Wire_Protocol_Contract.md §3). `lower_snake_case`, single
// word where possible, per the naming law (docs/19 §3).
import type { RejectionCode } from "./codes.js";
import type { NoticeKind } from "./codes.js";
import type { TableEvent } from "./events.js";
import type { WireSeatView } from "./seat-view.js";
import type { Seat } from "../table/seat.js";

export interface BoundFrame {
  readonly t: "bound";
  readonly seat: Seat;
  readonly protocolVersion: number;
  readonly seq: number;
}

export interface ResumedFrame {
  readonly t: "resumed";
  readonly seq: number;
  /** Present when a snapshot was sent rather than a backlog of events. */
  readonly view?: WireSeatView;
}

export interface AckFrame {
  readonly t: "ack";
  readonly cmdId: string;
  readonly seq: number;
}

export interface RejectFrame {
  readonly t: "reject";
  readonly cmdId: string;
  readonly code: RejectionCode;
  readonly message: string;
  /** Present on `STALE_STATE` (docs/19 §7.1) so the client can resync immediately. */
  readonly view?: WireSeatView;
}

export interface EventFrame {
  readonly t: "event";
  readonly seq: number;
  readonly ev: TableEvent;
  /** Always the complete seat view, never a delta (D-12-05, CO-5). */
  readonly view: WireSeatView;
}

export interface NoticeFrame {
  readonly t: "notice";
  readonly kind: NoticeKind;
  readonly d: Readonly<Record<string, unknown>>;
}

export interface PongFrame {
  readonly t: "pong";
}

export type ServerFrame =
  | BoundFrame
  | ResumedFrame
  | AckFrame
  | RejectFrame
  | EventFrame
  | NoticeFrame
  | PongFrame;
