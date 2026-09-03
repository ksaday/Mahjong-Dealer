// Postgres-backed `AuditLogRepository`, written against
// packages/db/migrations/0001_initial_schema.sql's `audit_log` table. Not
// exercised against a live database in this environment — same scope note
// as every other `postgres-repository.ts` in this codebase.
import type { Pool } from "pg";
import type { AuditLogRow } from "@mahjong-dealer/db";
import type { AuditLogPage, AuditLogQuery, AuditLogRepository, NewAuditEntry } from "./repository.js";

export class PostgresAuditLogRepository implements AuditLogRepository {
  constructor(private readonly pool: Pool) {}

  async record(entry: NewAuditEntry): Promise<void> {
    await this.pool.query(
      `INSERT INTO audit_log (id, actor_account_id, action, target_type, target_id, reason, ip, occurred_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
      [entry.id, entry.actorAccountId, entry.action, entry.targetType, entry.targetId, entry.reason, entry.ip, entry.occurredAt],
    );
  }

  async list(query: AuditLogQuery): Promise<AuditLogPage> {
    const conditions: string[] = [];
    const params: unknown[] = [];
    if (query.action !== undefined) {
      params.push(query.action);
      conditions.push(`action = $${params.length}`);
    }
    if (query.actorAccountId !== undefined) {
      params.push(query.actorAccountId);
      conditions.push(`actor_account_id = $${params.length}`);
    }
    const where = conditions.length > 0 ? `WHERE ${conditions.join(" AND ")}` : "";

    const { rows: countRows } = await this.pool.query<{ count: string }>(
      `SELECT count(*) FROM audit_log ${where}`,
      params,
    );
    params.push(query.limit, query.offset);
    const { rows } = await this.pool.query<AuditLogRow>(
      `SELECT * FROM audit_log ${where} ORDER BY occurred_at DESC LIMIT $${params.length - 1} OFFSET $${params.length}`,
      params,
    );
    return { entries: rows, total: Number(countRows[0]?.count ?? 0) };
  }
}
