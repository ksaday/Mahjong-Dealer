// The closed code catalogs (docs/19_WebSocket_Event_Catalog.md §7).
// `SCREAMING_SNAKE_CASE` per the naming law (§3) — checked in codes.test.ts.

/** docs/19 §7.1. Precedence when several apply: TABLE_PAUSED, CORRECTION_PENDING, PASS_ROUND_OPEN (docs/09 §5.2). */
export const REJECTION_CODES = [
  "NOT_BOUND",
  "NOT_YOUR_TURN",
  "NOT_YOUR_TILE",
  "TILE_NOT_AVAILABLE",
  "NOT_IN_PHASE",
  "TABLE_PAUSED",
  "CORRECTION_PENDING",
  "PASS_ROUND_OPEN",
  "WALL_EMPTY",
  "NO_CHECKPOINT",
  "DUPLICATE_COMMAND",
  "SEQ_GAP",
  "STALE_STATE",
  "MALFORMED",
  "RATE_LIMITED",
  "FORBIDDEN",
  "TABLE_CLOSED",
] as const;
export type RejectionCode = (typeof REJECTION_CODES)[number];

/** docs/19 §7.2. Numeric code paired with its name; client guidance lives in `33_API/Error_Code_Catalog.md`. */
export const CLOSE_CODES = [
  { code: 4001, name: "BIND_REQUIRED" },
  { code: 4002, name: "TICKET_INVALID" },
  { code: 4003, name: "REPLACED_BY_NEWER_BIND" },
  { code: 4004, name: "SESSION_REVOKED" },
  { code: 4008, name: "PROTOCOL_VIOLATION" },
  { code: 4009, name: "RATE_LIMITED" },
  { code: 4010, name: "SLOW_CONSUMER" },
  { code: 1012, name: "SERVICE_RESTART" },
] as const;
export type CloseCodeName = (typeof CLOSE_CODES)[number]["name"];
export type CloseCodeNumber = (typeof CLOSE_CODES)[number]["code"];

/** docs/19 §7.3. */
export const NOTICE_KINDS = [
  "connection_degraded",
  "rate_limit_warning",
  "service_restarting",
] as const;
export type NoticeKind = (typeof NOTICE_KINDS)[number];
