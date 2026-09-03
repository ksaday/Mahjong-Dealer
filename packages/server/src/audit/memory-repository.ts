// In-memory `AuditLogRepository` — the same role every other
// `memory-repository.ts` in this codebase plays: what the service tests
// actually exercise, with no database.
import type { AuditLogRow } from "@mahjong-dealer/db";
import type { AuditLogPage, AuditLogQuery, AuditLogRepository, NewAuditEntry } from "./repository.js";

export class InMemoryAuditLogRepository implements AuditLogRepository {
  private readonly entries: AuditLogRow[] = [];

  record(entry: NewAuditEntry): Promise<void> {
    this.entries.push({
      id: entry.id,
      actor_account_id: entry.actorAccountId,
      action: entry.action,
      target_type: entry.targetType,
      target_id: entry.targetId,
      reason: entry.reason,
      ip: entry.ip,
      occurred_at: entry.occurredAt,
    });
    return Promise.resolve();
  }

  list(query: AuditLogQuery): Promise<AuditLogPage> {
    const filtered = this.entries
      .filter((e) => query.action === undefined || e.action === query.action)
      .filter((e) => query.actorAccountId === undefined || e.actor_account_id === query.actorAccountId)
      .sort((a, b) => b.occurred_at.getTime() - a.occurred_at.getTime());
    const page = filtered.slice(query.offset, query.offset + query.limit);
    return Promise.resolve({ entries: page, total: filtered.length });
  }
}
