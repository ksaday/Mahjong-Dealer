# 18 — API Design

| | |
|---|---|
| **Project** | American Mahjong Dealer |
| **Document** | 18_API_Design.md |
| **Status** | Ratified v0.1 — approved by the project owner, 2026-09-02 |
| **Last Updated** | 2026-09-02 |
| **Role in SSOT** | Owns REST conventions, the endpoint catalog, and the REST security contract. Does **not** own the WebSocket protocol (`12`, `19`), authentication mechanics (`15`), or the error code catalog in detail (`33_API/Error_Code_Catalog.md`). |

---

## 1. Executive Summary

The REST surface is deliberately thin: **fourteen endpoints**, and none of them touches a live table.

The division is strict. REST handles what is independent and request-shaped — registering, logging
in, creating a table, joining by code, minting the credential that opens a socket. Everything that
belongs to a table's ordered stream goes over the socket (`12 §3`). There is no endpoint that reads
a hand, a wall, a discard pile, or a turn pointer, and adding one would create a second path to
table state with no defined ordering relative to the first.

That constraint has a privacy consequence worth stating plainly: **no REST response ever contains
table state.** The privacy audit therefore does not have to consider REST at all, beyond confirming
the absence. `TC-P02` asserts it.

The endpoint list is short enough that the whole surface fits on one page, which is itself a design
goal — a small API is one whose authorization can be reasoned about completely.

---

## 2. Objectives

Serves `OBJ-06` by keeping table state off the REST surface entirely, and `OBJ-11` by keeping the
surface as small as the product requires.

---

## 3. Conventions

| Aspect | Convention |
|---|---|
| Base path | `/api/v1` |
| Format | JSON, UTF-8 |
| Naming | `snake_case` in bodies; plural resource collections |
| Authentication | Session cookie; host-prefixed, `Secure`, `HttpOnly`, `SameSite=Lax` |
| Anti-forgery | `X-CSRF-Token` header matching the session cookie's secret, on every non-safe method |
| Idempotency | `Idempotency-Key` header honoured on `POST /tables` and `POST /accounts` |
| Versioning | Path-based; a breaking change means `/api/v2` |
| Time | ISO 8601 UTC |
| Identifiers | UUIDv7, opaque to clients |

### 3.1 Errors

One shape, always:

```json
{ "error": { "code": "TABLE_FULL", "message": "That table has no free seat." } }
```

| Status | Used for |
|---|---|
| 400 | Malformed or schema-invalid request |
| 401 | No valid session |
| 403 | Authenticated but not permitted |
| 404 | Not found, **or found and not permitted where existence is sensitive** |
| 409 | Conflict with current state |
| 422 | Well-formed but semantically rejected |
| 429 | Rate limited; `Retry-After` present |
| 500 | Unexpected; carries a correlation identifier and nothing else |

`code` values come from a closed catalog (`33_API/Error_Code_Catalog.md`). `message` is for humans
and may change; clients branch on `code`.

### 3.2 Why 404 where existence is sensitive

For a table identifier or a join code, `403` would confirm the resource exists. `404` for both cases
prevents enumeration (`15 §5.2`). The endpoints where this applies are marked in the catalog.

---

## 4. Endpoint catalog

Format: **purpose · authentication → authorization · request → response · notable behaviour**.

### 4.1 Accounts and sessions

| Endpoint | Specification |
|---|---|
| `POST /accounts` | Register · none · `{ email, password, display_name }` → `201 { account_id }` · Password checked against a breach list; minimum 12 characters. Rate limited per address. A duplicate email returns `201` with no account created and sends a notification to the existing address — enumeration is prevented by not distinguishing the cases. (`FR-001`) |
| `POST /sessions` | Log in · none · `{ email, password }` → `200 { account_id, display_name, role }` + session cookie · Identical response and timing for a wrong password and an unknown account. Durable per-account lockout after five failures. (`FR-002`, `FR-006`) |
| `DELETE /sessions/current` | Log out · session · — → `204` · Revokes the session; any bound socket closes within 5 s. (`FR-003`) |
| `GET /accounts/me` | Own profile · session · — → `200 { account_id, email, display_name, role }` · Own account only. (`FR-004`) |
| `PATCH /accounts/me` | Update own profile · session · `{ display_name? }` → `200` · Display name only; email changes require verification and are out of v1 scope. (`FR-004`) |
| `POST /accounts/me/password` | Change password · session · `{ current_password, new_password }` → `204` · Revokes every other session; the initiating session survives. (`FR-005`) |
| `GET /accounts/me/sessions` | List own sessions · session · — → `200 { sessions[] }` · Issue time, last seen, address, user agent. `Could` priority. (`FR-008`) |
| `DELETE /accounts/me/sessions/{id}` | Revoke a session · session → own session · — → `204` · Effective within 5 s. (`FR-008`) |

### 4.2 Tables

| Endpoint | Specification |
|---|---|
| `POST /tables` | Create a table · session → player · — → `201 { table_id, join_code, seat }` · Creator becomes host and takes a seat. `join_code` is returned **once** and stored irreversibly. Honours `Idempotency-Key`. (`FR-020`, `FR-021`) |
| `POST /tables/join` | Join by code · session → player · `{ join_code }` → `200 { table_id, seat }` · Server assigns the seat; **no seat parameter accepted** (`NR-601`). A wrong code, an unknown table, and a full table all return `404` after equivalent work. Rate limited per account and per address. (`FR-022`–`FR-024`) |
| `GET /tables/mine` | Own tables · session → player · — → `200 { tables[] }` · Identifier, status, seat, and the other seats' display names. **No game state.** Returns only tables where the requester holds a seat. (`FR-029`) |
| `DELETE /tables/{id}` | Close a table · session → host of this table · — → `204` · `409` if a game is in `dealing`, `in_play`, or `concluding`. Bindings close; concealed material purged. `404` if not the host. (`FR-028`) |
| `POST /tables/{id}/connect-ticket` | Mint a socket credential · session → occupant of a seat at this table · — → `201 { ticket }` · Single-use, 30-second expiry. Claims — account, session, table, seat — are held server-side; the client receives an opaque value. Rate limited per session. `404` if the requester holds no seat here. (`12 §4.1`) |

`GET /tables/mine` deserves note: it is the only endpoint that mentions a table's other occupants,
and it returns display names only. There is no field in its response for anything a game contains.

### 4.3 Administration

| Endpoint | Specification |
|---|---|
| `GET /admin/accounts` | List accounts · session + second factor → administrator · `?query`, `?status`, pagination → `200 { accounts[] }` · Metadata only: identifier, email, display name, role, status, timestamps. (`FR-160`) |
| `PATCH /admin/accounts/{id}` | Enable or disable · session + second factor → administrator · `{ status, reason }` → `200` · `reason` mandatory; audited. Disabling revokes every session. (`FR-160`) |
| `GET /admin/tables` | List tables · session + second factor → administrator · pagination → `200 { tables[] }` · Identifier, status, occupied seat count, timestamps. **No seat occupants, no game state, no tiles.** (`FR-160`) |
| `POST /admin/tables/{id}/force-close` | Force-close · session + second factor → administrator · `{ reason }` → `204` · The only administrative action that affects a game. Participants notified; concealed material purged; audited. (`FR-161`) |
| `GET /admin/health` | Health and metrics · session + second factor → administrator · — → `200 { … }` · Process, database, table and connection counts, error rates. No player-identifying or tile data. (`FR-162`) |
| `GET /admin/audit` | Audit log · session + second factor → administrator · filters, pagination → `200 { entries[] }` · Authentication and administrative events only. (`FR-163`) |

**No administrative endpoint returns table state.** `GET /admin/tables` returns a seat *count*, not
occupants, because an administrator has no need to know who is playing and every field is a field
that could later be extended (`FR-164`, `NR-406`).

---

## 5. What the API deliberately does not have

| Absent endpoint | Why |
|---|---|
| `GET /tables/{id}/state` | Table state belongs to the socket. A second path with no ordering relationship (`12 §3`) |
| `GET /tables/{id}/hand` | No REST response carries concealed material (`NR-501`) |
| `GET /tables` (public listing) | No discovery; the code is the capability (`FR-030`, `NR-403`) |
| `GET /games/{id}/replay` | No replay (`ADR-0012`, `NR-508`) |
| Any economic endpoint | No economy (`NR-101`–`NR-109`) |
| Any rule or configuration endpoint | No rules (`NR-001`, `NR-011`) |
| `GET /admin/tables/{id}/state` | No administrative path to a game (`NR-406`) |
| A public game-viewing API | No spectators (`NR-404`) |
| Any endpoint accepting a seat parameter | Seats come from bindings (`NR-601`) |

`TC-A10` asserts no route matching a discovery or spectator pattern exists; `TC-P02` asserts no
response body contains tile data.

---

## 6. Rate limits

| Endpoint | Limit | Storage |
|---|---|---|
| `POST /sessions`, per account | 5/minute, then progressive lockout | **PostgreSQL** |
| `POST /sessions`, per address | 20/minute | Memory |
| `POST /accounts`, per address | 3/hour | Memory |
| `POST /accounts/me/password`, per account | 3/hour | PostgreSQL |
| `POST /tables/join`, per account | 10/minute | Memory |
| `POST /tables/join`, per address | 30/minute | Memory |
| `POST /tables`, per account | 10/hour | Memory |
| `POST /tables/{id}/connect-ticket`, per session | 10/minute | Memory |
| `/admin/*` mutations | 30/minute | PostgreSQL |

Security-critical limits are durable (`15 §7`). A `429` carries `Retry-After`.

---

## 7. Design Decisions

| ID | Decision | Rationale |
|---|---|---|
| D-18-01 | No REST endpoint touches live table state | Removes REST from the privacy audit and avoids a second path to state with no ordering guarantee. |
| D-18-02 | Fourteen endpoints, and the surface fits on a page | A small API is one whose authorization can be reasoned about completely. |
| D-18-03 | `404` where existence is sensitive | `403` confirms existence; uniform `404` prevents enumeration. |
| D-18-04 | Registration returns `201` for a duplicate email and notifies the existing address | Prevents account enumeration while still informing the real owner. |
| D-18-05 | Join code returned exactly once, stored irreversibly | A database read yields no usable codes. |
| D-18-06 | Server assigns the seat on join | No seat parameter anywhere (`NR-601`). |
| D-18-07 | `GET /admin/tables` returns a seat count, not occupants | An administrator has no need for occupants, and an existing field invites extension. |
| D-18-08 | Second factor required on every administrative endpoint | The role is small but its actions are irreversible. |
| D-18-09 | Closed error-code catalog; clients branch on `code`, never on `message` | Messages are for humans and will change. |
| D-18-10 | `Idempotency-Key` only where a duplicate would create a resource | Table and account creation; everywhere else the operation is naturally idempotent. |

---

## 8. Alternative Designs

| Alternative | Why rejected |
|---|---|
| REST for game commands, sockets for events only | Two paths to state with no ordering between them. |
| A REST state endpoint as a socket fallback | A second serialization path with its own privacy properties — the thing `14 §5` exists to prevent. |
| GraphQL | A flexible query surface over data whose access rules are per-seat and per-field; the flexibility is the risk. |
| Bearer tokens in an `Authorization` header | Cookies with host prefixes and `SameSite` are stronger against theft in a browser client; the socket credential is a separate single-use ticket anyway. |
| `403` for forbidden tables | Confirms existence. |
| Distinguishing duplicate-email at registration | Account enumeration. |
| A public table listing with filters | Discovery the product does not need, and an enumeration surface. |

---

## 9. Trade-offs

**Two transports mean two client code paths.** Accepted: the split is clean — REST before a table,
sockets at a table — and the alternative is a second path to state.

**Uniform `404` responses make legitimate mistakes harder to diagnose.** Accepted: the client can say
"that code did not work" without knowing why, which is what a player needs.

**Returning `201` for a duplicate registration is mildly dishonest.** Accepted as the standard
resolution: the alternative leaks which addresses have accounts, and the real owner is notified.

**No REST state endpoint means a client with a blocked WebSocket cannot play at all.** Accepted: a
fallback would be a second privacy-relevant serialization path, and such networks are rare.

---

## 10. Risks

| Risk | Mitigation |
|---|---|
| A convenience state endpoint is added | `D-18-01`; `TC-P02` asserts no response carries tile data |
| An administrative endpoint is extended toward game content | `FR-164`, `NR-406`; `TC-P02` |
| A seat parameter is added to join | `NR-601`; `TC-I01` |
| Join codes brute-forced | Rate limits, uniform `404`, short validity (`15 §7.2`) |
| Error messages leak internal detail | `500` carries a correlation identifier only; codes come from a closed catalog |

---

## 11. Future Considerations

Not committed: email change with verification; account deletion with immediate purge; per-table
invitations as an alternative to a shared code; an operator-only capacity report.

---

## 12. Cross References

| Document | Focus |
|---|---|
| `12_Realtime_WebSocket_Architecture.md` | The socket half, including ticket redemption |
| `15_Security_Architecture.md` | Sessions, anti-forgery, rate limits |
| `04_User_Roles_and_Access.md` | The permission matrix these endpoints implement |
| `33_API/REST_Endpoint_Catalog.md` | Request and response schemas in full |
| `33_API/Error_Code_Catalog.md` | Every error code |
| `01_Product_Requirements.md` | The `FR-###` each endpoint serves |

---

## 13. Revision History

| Version | Date | Author | Changes |
|---|---|---|---|
| 0.1 | 2026-09-02 | Design (architect role), owner-approved | Initial catalog: 14 endpoints |
