// Data-access interface for the audit log (docs/17_Database_Design.md
// §5.11): authentication and administrative events only, never game
// content (`FR-164`) — the schema comment on `audit_log` says so and this
// interface has no field through which one could smuggle any in.
//
// Append-only at the database layer already (the `audit_log_append_only`
// trigger), so this interface has no update or delete — `record` is the
// only write.
import type { AuditLogRow } from "@mahjong-dealer/db";

export interface NewAuditEntry {
  readonly id: string;
  /** `null` for an event with no authenticated actor (e.g. a failed login against an unknown email). */
  readonly actorAccountId: string | null;
  readonly action: string;
  readonly targetType: string | null;
  readonly targetId: string | null;
  /** Mandatory for administrative actions (`FR-166`) — an application-layer rule `AdminService` enforces, not this repository. */
  readonly reason: string | null;
  readonly ip: string | null;
  readonly occurredAt: Date;
}

export interface AuditLogQuery {
  readonly limit: number;
  readonly offset: number;
  readonly action?: string;
  readonly actorAccountId?: string;
}

export interface AuditLogPage {
  readonly entries: readonly AuditLogRow[];
  readonly total: number;
}

export interface AuditLogRepository {
  record(entry: NewAuditEntry): Promise<void>;
  list(query: AuditLogQuery): Promise<AuditLogPage>;
}
