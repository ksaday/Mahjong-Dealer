// Postgres-backed repositories, written against the schema in
// packages/db/migrations/0001_initial_schema.sql.
//
// Scope note: **not exercised against a live database in this
// environment.** The only Postgres instance available on this machine
// belongs to a different, unrelated project (see the project memory this
// session left about it) and was deliberately left untouched rather than
// connected to; standing up a new database container was likewise not
// done without being asked. This file is therefore the same kind of gap
// `db`'s own migrations carry: correct by construction against the
// schema and parameterized throughout, but unverified by an integration
// test. `memory-repository.ts` is what `service.test.ts` actually
// exercises.
import type { Pool } from "pg";
import type { AccountRow, AccountStatus, SessionRow } from "@mahjong-dealer/db";
import type {
  AccountListPage,
  AccountListQuery,
  AccountRepository,
  NewAccount,
  NewSession,
  SessionRepository,
} from "./repository.js";

export class PostgresAccountRepository implements AccountRepository {
  constructor(private readonly pool: Pool) {}

  async create(account: NewAccount): Promise<AccountRow> {
    const { rows } = await this.pool.query<AccountRow>(
      `INSERT INTO accounts (id, email, password_hash, display_name, role)
       VALUES ($1, $2, $3, $4, $5)
       RETURNING *`,
      [account.id, account.email, account.passwordHash, account.displayName, account.role ?? "player"],
    );
    return expectOne(rows);
  }

  async findByEmail(email: string): Promise<AccountRow | null> {
    const { rows } = await this.pool.query<AccountRow>("SELECT * FROM accounts WHERE email = $1", [email]);
    return rows[0] ?? null;
  }

  async findById(id: string): Promise<AccountRow | null> {
    const { rows } = await this.pool.query<AccountRow>("SELECT * FROM accounts WHERE id = $1", [id]);
    return rows[0] ?? null;
  }

  async updateDisplayName(id: string, displayName: string): Promise<void> {
    await this.pool.query("UPDATE accounts SET display_name = $2, updated_at = now() WHERE id = $1", [
      id,
      displayName,
    ]);
  }

  async updatePasswordHash(id: string, passwordHash: string): Promise<void> {
    await this.pool.query("UPDATE accounts SET password_hash = $2, updated_at = now() WHERE id = $1", [
      id,
      passwordHash,
    ]);
  }

  async setLoginFailure(id: string, failedLogins: number, lockedUntil: Date | null): Promise<void> {
    await this.pool.query("UPDATE accounts SET failed_logins = $2, locked_until = $3 WHERE id = $1", [
      id,
      failedLogins,
      lockedUntil,
    ]);
  }

  async setStatus(id: string, status: AccountStatus): Promise<void> {
    await this.pool.query("UPDATE accounts SET status = $2, updated_at = now() WHERE id = $1", [id, status]);
  }

  async list(query: AccountListQuery): Promise<AccountListPage> {
    const conditions: string[] = [];
    const params: unknown[] = [];
    if (query.status !== undefined) {
      params.push(query.status);
      conditions.push(`status = $${params.length}`);
    }
    if (query.query !== undefined) {
      params.push(`%${query.query}%`);
      conditions.push(`(email ILIKE $${params.length} OR display_name ILIKE $${params.length})`);
    }
    const where = conditions.length > 0 ? `WHERE ${conditions.join(" AND ")}` : "";

    const { rows: countRows } = await this.pool.query<{ count: string }>(
      `SELECT count(*) FROM accounts ${where}`,
      params,
    );
    params.push(query.limit, query.offset);
    const { rows } = await this.pool.query<AccountRow>(
      `SELECT * FROM accounts ${where} ORDER BY created_at LIMIT $${params.length - 1} OFFSET $${params.length}`,
      params,
    );
    return { accounts: rows, total: Number(countRows[0]?.count ?? 0) };
  }
}

export class PostgresSessionRepository implements SessionRepository {
  constructor(private readonly pool: Pool) {}

  async create(session: NewSession): Promise<SessionRow> {
    const { rows } = await this.pool.query<SessionRow>(
      `INSERT INTO sessions (id, account_id, token_hash, csrf_secret, issued_at, last_seen_at, absolute_expires_at, ip, user_agent)
       VALUES ($1, $2, $3, $4, $5, $5, $6, $7, $8)
       RETURNING *`,
      [
        session.id,
        session.accountId,
        session.tokenHash,
        session.csrfSecret,
        session.issuedAt,
        session.absoluteExpiresAt,
        session.ip,
        session.userAgent,
      ],
    );
    return expectOne(rows);
  }

  async findByTokenHash(tokenHash: Buffer): Promise<SessionRow | null> {
    const { rows } = await this.pool.query<SessionRow>("SELECT * FROM sessions WHERE token_hash = $1", [
      tokenHash,
    ]);
    return rows[0] ?? null;
  }

  async findById(id: string): Promise<SessionRow | null> {
    const { rows } = await this.pool.query<SessionRow>("SELECT * FROM sessions WHERE id = $1", [id]);
    return rows[0] ?? null;
  }

  async touch(id: string, lastSeenAt: Date): Promise<void> {
    await this.pool.query("UPDATE sessions SET last_seen_at = $2 WHERE id = $1", [id, lastSeenAt]);
  }

  async revoke(id: string, revokedAt: Date): Promise<void> {
    await this.pool.query("UPDATE sessions SET revoked_at = $2 WHERE id = $1", [id, revokedAt]);
  }

  async revokeAllForAccount(accountId: string, revokedAt: Date, exceptSessionId?: string): Promise<void> {
    await this.pool.query(
      "UPDATE sessions SET revoked_at = $2 WHERE account_id = $1 AND revoked_at IS NULL AND id IS DISTINCT FROM $3",
      [accountId, revokedAt, exceptSessionId ?? null],
    );
  }

  async listActiveForAccount(accountId: string): Promise<readonly SessionRow[]> {
    const { rows } = await this.pool.query<SessionRow>(
      "SELECT * FROM sessions WHERE account_id = $1 AND revoked_at IS NULL AND absolute_expires_at > now()",
      [accountId],
    );
    return rows;
  }
}

function expectOne<T>(rows: readonly T[]): T {
  const row = rows[0];
  if (row === undefined) {
    throw new Error("unreachable: INSERT ... RETURNING produced no row");
  }
  return row;
}
