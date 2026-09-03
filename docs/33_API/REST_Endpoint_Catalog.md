# REST Endpoint Catalog

| | |
|---|---|
| **Project** | American Mahjong Dealer |
| **Document** | 33_API/REST_Endpoint_Catalog.md |
| **Status** | Normative — machine-checkable. Ch. 18 remains authoritative for conventions |
| **Last Updated** | 2026-09-03 |
| **Role in SSOT** | Owns the request and response schemas for every REST endpoint. Does **not** own conventions or rationale (`18`), error codes (`Error_Code_Catalog.md`), or authorization policy (`04`). |

---

## 1. The route inventory is closed

The twenty-one endpoints below are the **complete** REST surface. A registered route not listed here
fails `TC-A10`.

Closing the inventory matters because the surface's most important property is what it lacks: no
endpoint reads table state, no endpoint accepts a seat parameter, and no endpoint returns tile data
(`18 §5`).

---

## 2. Common

**Base** `/api/v1` · **Format** JSON, UTF-8 · **Authentication** session cookie
(`__Host-session`) · **Anti-forgery** `X-CSRF-Token` on every non-safe method.

**Error body**, always:

```json
{ "error": { "code": "TABLE_FULL", "message": "That table has no free seat." } }
```

---

## 3. Accounts and sessions

### `POST /accounts`
```
Auth: none    Rate: 3/hour per address
Request:   { "email": string, "password": string, "display_name": string }
Response:  201 { "account_id": uuid }
Errors:    400 MALFORMED · 422 PASSWORD_TOO_SHORT · 422 PASSWORD_BREACHED · 429 RATE_LIMITED
```
A duplicate email returns `201` with no account created and notifies the existing address
(`D-18-04`).

### `POST /sessions`
```
Auth: none    Rate: 5/min per account (durable lockout) · 20/min per address
Request:   { "email": string, "password": string }
Response:  200 { "account_id": uuid, "display_name": string, "role": "player"|"administrator",
                 "mfa_required": boolean? }
           + Set-Cookie: __Host-session, __Host-csrf
Errors:    401 INVALID_CREDENTIALS · 423 ACCOUNT_LOCKED { "locked_until": iso8601 }
           · 403 ACCOUNT_DISABLED · 429 RATE_LIMITED
```
`INVALID_CREDENTIALS` is returned identically, after equivalent work, for a wrong password and an
unknown account. `mfa_required` is present, and `true`, only for an administrator whose session has
not yet completed `POST /sessions/mfa` (`15 §8.1`, `ADR-0017`) — absent for a player, and absent for
an administrator session that already has (a re-login always starts unverified again, `D-17-17`).
The session cookie is issued regardless; it simply cannot reach `/admin/*` until step-up succeeds.

### `POST /sessions/mfa`
```
Auth: session    Rate: 5/min per account (durable lockout)
Request:   { "code": string }
Response:  204
Errors:    400 MALFORMED · 401 MFA_INVALID · 403 FORBIDDEN · 423 MFA_LOCKED { "locked_until": iso8601 }
           · 429 RATE_LIMITED
```
`code` is a 6-digit TOTP code (RFC 6238, HMAC-SHA1, 30-second period, ±1 step drift tolerance).
Verifies against the calling session's own account and, on success, sets that **session's**
`mfa_verified_at` — every other session for the account, and any future login, is unaffected.
`403 FORBIDDEN` for a non-administrator account: there is nothing to step up. Replayed codes are
rejected even within their valid window (`17 §5.1`'s `totp_last_used_step`). Failures are tracked in
`accounts.mfa_failed_attempts`/`mfa_locked_until`, a durable counter separate from password lockout
(`D-17-16`).

### `DELETE /sessions/current`
```
Auth: session
Response:  204
```
Any bound socket closes with `4004` within 5 seconds.

### `GET /accounts/me`
```
Auth: session
Response:  200 { "account_id": uuid, "email": string, "display_name": string, "role": string,
                 "created_at": iso8601 }
```

### `PATCH /accounts/me`
```
Auth: session
Request:   { "display_name"?: string }
Response:  200 { "display_name": string }
Errors:    400 MALFORMED · 422 DISPLAY_NAME_INVALID
```

### `POST /accounts/me/password`
```
Auth: session    Rate: 3/hour per account (durable)
Request:   { "current_password": string, "new_password": string }
Response:  204
Errors:    401 INVALID_CREDENTIALS · 422 PASSWORD_TOO_SHORT · 422 PASSWORD_BREACHED · 429 RATE_LIMITED
```
Revokes every other session; the initiating session survives. The rate limit is consumed by every
attempt reaching this endpoint, successful or not (`17 §5.1`, `D-17-14`).

### `GET /accounts/me/sessions`
```
Auth: session
Response:  200 { "sessions": [ { "id": uuid, "issued_at": iso8601, "last_seen_at": iso8601,
                                 "ip": string|null, "user_agent": string|null,
                                 "current": boolean } ] }
```

### `DELETE /accounts/me/sessions/{id}`
```
Auth: session → own session
Response:  204
Errors:    404 NOT_FOUND
```

---

## 4. Tables

### `POST /tables`
```
Auth: session → player    Rate: 10/hour per account    Idempotency-Key honoured
Response:  201 { "table_id": uuid, "join_code": string(6), "seat": "east"|"south"|"west"|"north" }
Errors:    409 ALREADY_SEATED · 429 RATE_LIMITED
```
`join_code` is returned **once** per successful creation. It is stored irreversibly and is never
returned by any other endpoint. The sole exception is a replayed `Idempotency-Key` request within its
10-minute window (`18 §7`, `D-18-11`; `17 §5.12`), which returns the identical response — a client
retrying because it never received the first response is not the audience `D-18-05` protects against.

### `POST /tables/join`
```
Auth: session → player    Rate: 10/min per account · 30/min per address
Request:   { "join_code": string(6) }
Response:  200 { "table_id": uuid, "seat": "east"|"south"|"west"|"north" }
Errors:    404 NOT_FOUND · 409 ALREADY_SEATED · 429 RATE_LIMITED
```
**No seat parameter is accepted** (`NR-601`). A wrong code, an unknown table, and a full table all
return `404 NOT_FOUND` after equivalent work.

### `GET /tables/mine`
```
Auth: session → player
Response:  200 { "tables": [ { "table_id": uuid, "status": string, "seat": string,
                               "seats": [ { "seat": string, "display_name": string|null,
                                            "connected": boolean } ],
                               "game_state": string|null } ] }
```
Returns only tables where the requester holds a seat. `game_state` is the machine state name
(`09 §4`) and **nothing else** — no tiles, no counts, no turn.

### `DELETE /tables/{id}`
```
Auth: session → host of this table
Response:  204
Errors:    404 NOT_FOUND (also when not the host) · 409 GAME_IN_PROGRESS
```

### `POST /tables/{id}/connect-ticket`
```
Auth: session → occupant of a seat at this table    Rate: 10/min per session
Response:  201 { "ticket": string, "expires_at": iso8601 }
Errors:    404 NOT_FOUND · 429 RATE_LIMITED
```
Single-use, 30-second expiry. Claims — account, session, table, seat — are held server-side; the
client receives an opaque value. Redeemed in the socket's first frame, **never in a URL**
(`12 §4.1`).

---

## 5. Administration

Every endpoint requires an administrator session with a satisfied second factor: `401 NO_SESSION`
for no session, `403 FORBIDDEN` for a player session, `401 MFA_REQUIRED` for an administrator session
that has not yet called `POST /sessions/mfa` (`§3`, `15 §8.1`, `ADR-0017`).

### `GET /admin/accounts`
```
Query:     ?query, ?status, ?limit, ?cursor
Response:  200 { "accounts": [ { "account_id": uuid, "email": string, "display_name": string,
                                 "role": string, "status": string, "created_at": iso8601,
                                 "locked_until": iso8601|null } ],
                 "next_cursor": string|null }
```

### `PATCH /admin/accounts/{id}`
```
Request:   { "status": "active"|"disabled", "reason": string }
Response:  200 { "account_id": uuid, "status": string }
Errors:    400 REASON_REQUIRED · 404 NOT_FOUND
```
`reason` is mandatory and audited. Disabling revokes every session.

### `GET /admin/tables`
```
Query:     ?status, ?limit, ?cursor
Response:  200 { "tables": [ { "table_id": uuid, "status": string, "occupied_seats": 0..4,
                               "game_state": string|null, "created_at": iso8601 } ],
                 "next_cursor": string|null }
```
**A seat count, not occupants** (`D-18-07`). No tiles, no names, no turn, no sequence.

### `POST /admin/tables/{id}/force-close`
```
Request:   { "reason": string }
Response:  204
Errors:    400 REASON_REQUIRED · 404 NOT_FOUND
```
Participants notified; concealed material purged; audited.

### `GET /admin/health`
```
Response:  200 { "status": "ok"|"degraded", "database": "ok"|"unreachable",
                 "schema_version": string, "live_tables": int, "live_connections": int,
                 "error_rate_5m": number, "latency_p95_ms": number }
```

### `GET /admin/audit`
```
Query:     ?actor, ?action, ?from, ?to, ?limit, ?cursor
Response:  200 { "entries": [ { "id": uuid, "actor_account_id": uuid|null, "action": string,
                                "target_type": string|null, "target_id": uuid|null,
                                "reason": string|null, "ip": string|null,
                                "occurred_at": iso8601 } ],
                 "next_cursor": string|null }
```
Authentication and administrative events only. **No game content, ever** (`17 §5.11`).

---

## 6. Operational

### `GET /healthz`

Deliberately outside `/api/v1` and unauthenticated — the container orchestrator's readiness probe
(`27_Deployment_Architecture.md §3.2`), which cannot hold a session cookie or complete the
administrator second factor, so it cannot be `GET /admin/health` (`§5`, above) under a different
path. Reports only reachability and a schema filename — never operational metrics, and never
player-identifying or tile data.

```
Response:  200 { "status": "ok", "database": "ok", "schema_version": string } |
           503 { "status": "degraded", "database": "unreachable", "schema_version": string|null }
```

---

## 7. Absent routes

Machine-checked by `TC-A10`. A registered route matching any pattern below fails the build.

| Pattern | Why absent |
|---|---|
| `GET /tables/{id}/state`, `/hand`, `/wall`, `/discards` | Table state belongs to the socket (`18 §5`) |
| `GET /tables` — a public listing | No discovery; the code is the capability (`NR-403`) |
| `/games/{id}/replay`, `/export` | No replay (`NR-508`) |
| `/admin/tables/{id}/state`, `/hands`, `/watch` | No administrative path to a game (`NR-406`) |
| `/spectate`, `/observe`, `/watch` | No spectators (`NR-401`) |
| `/wallet`, `/points`, `/purchases`, `/pricing`, `/transfer`, `/webhooks/psp` | No economy (`NR-101`–`NR-109`) |
| `/rules`, `/rule-versions`, `/card`, `/patterns`, `/validate` | No rules (`NR-001`, `NR-010`, `NR-011`) |
| `/hint`, `/suggest`, `/analyze`, `/solve` | No assistance (`NR-203`) |
| Any route with a `seat` path or query parameter | Seats come from bindings (`NR-601`) |

---

## 8. Cross References

`18_API_Design.md` · `Error_Code_Catalog.md` · `Wire_Protocol_Contract.md` ·
`04_User_Roles_and_Access.md §4` · `15_Security_Architecture.md`

## 9. Revision History

| Version | Date | Author | Changes |
|---|---|---|---|
| 0.1 | 2026-09-02 | Design (architect role) | Initial catalog: 14 endpoints, 9 absence patterns |
| 0.2 | 2026-09-03 | Design (architect role), owner-approved | Noted the `Idempotency-Key` replay exception on `POST /tables`'s join-code note |
| 0.3 | 2026-09-03 | Design (architect role), owner-approved | Added `429 RATE_LIMITED` to `POST /accounts/me/password`'s error list, now that its durable limit is implemented |
| 0.4 | 2026-09-03 | Design (architect role), owner-approved | `ADR-0017`: added `POST /sessions/mfa`; `mfa_required` on `POST /sessions`; corrected the route count from 14 to 20 (`§1`) |
| 0.5 | 2026-09-03 | Design (architect role), owner-approved | Added `GET /healthz` (new `§6 Operational`) — the container readiness probe `27 §3.2` requires, previously unbuilt and unpathed; corrected the route count from 20 to 21 (`§1`); renumbered old `§6`–`§8` to `§7`–`§9` |
