// Data-access interface for `Idempotency-Key` replay caching
// (docs/18_API_Design.md §3, D-18-10; docs/17_Database_Design.md §5.12).
// Scoped to `POST /tables` today (`tables/http.ts`) — the interface takes
// an `endpoint` so a second idempotent-eligible endpoint can share the
// table without a key collision, but nothing here assumes a second
// caller exists yet.
//
// A record's `body` deliberately holds whatever the original response
// held, `join_code` included — a narrow, time-bounded exception to
// D-18-05's "stored irreversibly" that exists to serve the client D-18-10
// was written for: one that created a table but never received the
// response. `find` must treat an expired record as absent; nothing here
// enforces the TTL itself, which is the caller's `expiresAt` at write
// time.
export interface IdempotentResponse {
  readonly status: number;
  readonly body: unknown;
}

export interface NewIdempotencyRecord extends IdempotentResponse {
  readonly accountId: string;
  readonly endpoint: string;
  readonly key: string;
  readonly expiresAt: Date;
}

export interface IdempotencyRepository {
  find(accountId: string, endpoint: string, key: string): Promise<IdempotentResponse | null>;
  store(record: NewIdempotencyRecord): Promise<void>;
}
