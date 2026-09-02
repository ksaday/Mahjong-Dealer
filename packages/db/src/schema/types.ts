// Row types mirroring the physical schema (docs/17_Database_Design.md §5).
// This module owns no decision of its own — every shape here is a
// TypeScript reading of a table already defined in
// `migrations/0001_initial_schema.sql`; if they disagree, the migration
// (and so the document it implements) wins.
import type { Seat } from "@mahjong-dealer/shared";

export type AccountRole = "player" | "administrator";
export type AccountStatus = "active" | "disabled";
export type TableStatusRow = "open" | "seated" | "abandoned" | "closed";
export type GameStateRow = "idle" | "dealing" | "in_play" | "concluding" | "concluded";
export type GameOutcomeRow = "declaration_accepted" | "ended_by_agreement" | "abandoned";

export interface AccountRow {
  readonly id: string;
  readonly email: string;
  readonly email_verified_at: Date | null;
  /** Argon2id, peppered before hashing (docs/15 §4.1). Secret. */
  readonly password_hash: string;
  readonly display_name: string;
  readonly role: AccountRole;
  readonly status: AccountStatus;
  readonly failed_logins: number;
  readonly locked_until: Date | null;
  readonly created_at: Date;
  readonly updated_at: Date;
}

export interface SessionRow {
  readonly id: string;
  readonly account_id: string;
  /** SHA-256 of the token; the token itself is never stored. Secret. */
  readonly token_hash: Buffer;
  readonly csrf_secret: string;
  readonly issued_at: Date;
  readonly last_seen_at: Date;
  readonly absolute_expires_at: Date;
  readonly revoked_at: Date | null;
  readonly ip: string | null;
  readonly user_agent: string | null;
}

export interface ConnectTicketRow {
  readonly id: string;
  readonly ticket_hash: Buffer;
  readonly account_id: string;
  readonly session_id: string;
  readonly table_id: string;
  readonly seat: Seat;
  readonly expires_at: Date;
  readonly redeemed_at: Date | null;
}

export interface TableRow {
  readonly id: string;
  /** Irreversible — a database read yields no usable codes (D-17-07). */
  readonly join_code_hash: Buffer;
  readonly host_account_id: string | null;
  readonly status: TableStatusRow;
  readonly owner_node: string;
  readonly deal_count_default: number;
  readonly deal_count_dealer: number;
  readonly created_at: Date;
  readonly closed_at: Date | null;
}

export interface TableSeatRow {
  readonly id: string;
  readonly table_id: string;
  readonly seat: Seat;
  readonly account_id: string | null;
  readonly is_ready: boolean;
  readonly occupied_at: Date | null;
}

export interface GameRow {
  readonly id: string;
  readonly table_id: string;
  readonly state: GameStateRow;
  readonly seq: bigint;
  readonly commitment: Buffer | null;
  readonly outcome: GameOutcomeRow | null;
  readonly outcome_seat: Seat | null;
  readonly started_at: Date | null;
  readonly concluded_at: Date | null;
  readonly purged_at: Date | null;
}

export interface CheckpointRow {
  readonly game_id: string;
  readonly seq: bigint;
  readonly public_state: unknown;
  /** AES-256-GCM ciphertext. Not selectable by `app` (docs/17 §7.2). Concealed. */
  readonly private_state: Buffer;
  readonly receipts: unknown;
  readonly key_version: number;
  readonly written_at: Date;
}

export interface CorrectionCheckpointRow {
  readonly id: string;
  readonly game_id: string;
  readonly seq: bigint;
  readonly public_state: unknown;
  readonly private_state: Buffer;
  readonly key_version: number;
  readonly written_at: Date;
}

export interface GameEventRow {
  readonly id: string;
  readonly game_id: string;
  readonly seq: bigint;
  readonly type: string;
  readonly seat: Seat | null;
  /** Public content only — no tile face that was not already public (docs/16 §6.1). */
  readonly payload: unknown;
  readonly occurred_at: Date;
}

export interface CommandReceiptRow {
  readonly game_id: string;
  readonly cmd_id: string;
  readonly seq: bigint;
  readonly applied_at: Date;
}

export interface AuditLogRow {
  readonly id: string;
  readonly actor_account_id: string | null;
  readonly action: string;
  readonly target_type: string | null;
  readonly target_id: string | null;
  readonly reason: string | null;
  readonly ip: string | null;
  readonly occurred_at: Date;
}
