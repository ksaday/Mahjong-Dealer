// Postgres-backed `IdempotencyRepository`, written against
// packages/db/migrations/0003_idempotency_keys.sql's `idempotency_keys`
// table. Not exercised against a live database in this environment — same
// scope note as every other `postgres-repository.ts` in this codebase.
import type { Pool } from "pg";
import type { IdempotencyKeyRow } from "@mahjong-dealer/db";
import type { IdempotencyRepository, IdempotentResponse, NewIdempotencyRecord } from "./repository.js";

export class PostgresIdempotencyRepository implements IdempotencyRepository {
  constructor(private readonly pool: Pool) {}

  async find(accountId: string, endpoint: string, key: string): Promise<IdempotentResponse | null> {
    const { rows } = await this.pool.query<Pick<IdempotencyKeyRow, "response_status" | "response_body">>(
      `SELECT response_status, response_body FROM idempotency_keys
       WHERE account_id = $1 AND endpoint = $2 AND key = $3 AND expires_at > now()`,
      [accountId, endpoint, key],
    );
    const row = rows[0];
    return row === undefined ? null : { status: row.response_status, body: row.response_body };
  }

  async store(record: NewIdempotencyRecord): Promise<void> {
    await this.pool.query(
      `INSERT INTO idempotency_keys (account_id, endpoint, key, response_status, response_body, expires_at)
       VALUES ($1, $2, $3, $4, $5, $6)
       ON CONFLICT (account_id, endpoint, key) DO NOTHING`,
      [record.accountId, record.endpoint, record.key, record.status, JSON.stringify(record.body), record.expiresAt],
    );
  }
}
