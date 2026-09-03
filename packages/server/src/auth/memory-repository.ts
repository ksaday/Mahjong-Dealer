// In-memory repositories for testing `AuthService` without a database —
// the same role dealer-core's deterministic entropy and the table actor's
// TableHarness play elsewhere in this codebase.
import type { AccountRow, AccountStatus, SessionRow } from "@mahjong-dealer/db";
import type { AccountRepository, NewAccount, NewSession, SessionRepository } from "./repository.js";

export class InMemoryAccountRepository implements AccountRepository {
  private readonly byId = new Map<string, AccountRow>();

  create(account: NewAccount): Promise<AccountRow> {
    const now = new Date();
    const row: AccountRow = {
      id: account.id,
      email: account.email,
      email_verified_at: null,
      password_hash: account.passwordHash,
      display_name: account.displayName,
      role: "player",
      status: "active",
      failed_logins: 0,
      locked_until: null,
      created_at: now,
      updated_at: now,
    };
    this.byId.set(row.id, row);
    return Promise.resolve(row);
  }

  findByEmail(email: string): Promise<AccountRow | null> {
    const needle = email.toLowerCase();
    for (const row of this.byId.values()) {
      if (row.email.toLowerCase() === needle) return Promise.resolve(row);
    }
    return Promise.resolve(null);
  }

  findById(id: string): Promise<AccountRow | null> {
    return Promise.resolve(this.byId.get(id) ?? null);
  }

  updateDisplayName(id: string, displayName: string): Promise<void> {
    this.mutate(id, (row) => ({ ...row, display_name: displayName, updated_at: new Date() }));
    return Promise.resolve();
  }

  updatePasswordHash(id: string, passwordHash: string): Promise<void> {
    this.mutate(id, (row) => ({ ...row, password_hash: passwordHash, updated_at: new Date() }));
    return Promise.resolve();
  }

  setLoginFailure(id: string, failedLogins: number, lockedUntil: Date | null): Promise<void> {
    this.mutate(id, (row) => ({ ...row, failed_logins: failedLogins, locked_until: lockedUntil }));
    return Promise.resolve();
  }

  setStatus(id: string, status: AccountStatus): Promise<void> {
    this.mutate(id, (row) => ({ ...row, status, updated_at: new Date() }));
    return Promise.resolve();
  }

  private mutate(id: string, fn: (row: AccountRow) => AccountRow): void {
    const row = this.byId.get(id);
    if (row === undefined) throw new Error(`unreachable: no account ${id}`);
    this.byId.set(id, fn(row));
  }
}

export class InMemorySessionRepository implements SessionRepository {
  private readonly byId = new Map<string, SessionRow>();

  create(session: NewSession): Promise<SessionRow> {
    const row: SessionRow = {
      id: session.id,
      account_id: session.accountId,
      token_hash: session.tokenHash,
      csrf_secret: session.csrfSecret,
      issued_at: session.issuedAt,
      last_seen_at: session.issuedAt,
      absolute_expires_at: session.absoluteExpiresAt,
      revoked_at: null,
      ip: session.ip,
      user_agent: session.userAgent,
    };
    this.byId.set(row.id, row);
    return Promise.resolve(row);
  }

  findByTokenHash(tokenHash: Buffer): Promise<SessionRow | null> {
    for (const row of this.byId.values()) {
      if (row.token_hash.equals(tokenHash)) return Promise.resolve(row);
    }
    return Promise.resolve(null);
  }

  findById(id: string): Promise<SessionRow | null> {
    return Promise.resolve(this.byId.get(id) ?? null);
  }

  touch(id: string, lastSeenAt: Date): Promise<void> {
    const row = this.byId.get(id);
    if (row !== undefined) this.byId.set(id, { ...row, last_seen_at: lastSeenAt });
    return Promise.resolve();
  }

  revoke(id: string, revokedAt: Date): Promise<void> {
    const row = this.byId.get(id);
    if (row !== undefined) this.byId.set(id, { ...row, revoked_at: revokedAt });
    return Promise.resolve();
  }

  revokeAllForAccount(accountId: string, revokedAt: Date, exceptSessionId?: string): Promise<void> {
    for (const row of this.byId.values()) {
      if (row.account_id === accountId && row.id !== exceptSessionId && row.revoked_at === null) {
        this.byId.set(row.id, { ...row, revoked_at: revokedAt });
      }
    }
    return Promise.resolve();
  }

  listActiveForAccount(accountId: string): Promise<readonly SessionRow[]> {
    const now = Date.now();
    return Promise.resolve(
      [...this.byId.values()].filter(
        (row) => row.account_id === accountId && row.revoked_at === null && row.absolute_expires_at.getTime() > now,
      ),
    );
  }
}
