# Error Code Catalog

| | |
|---|---|
| **Project** | American Mahjong Dealer |
| **Document** | 33_API/Error_Code_Catalog.md |
| **Status** | Normative — machine-checkable. Ch. 21 remains authoritative for semantics |
| **Last Updated** | 2026-09-02 |
| **Role in SSOT** | Owns every error code, close code, and notice kind, with the client action for each. Does **not** own error semantics (`21`) or the name catalog (`19`). |

---

## 1. Rules

**The catalog is closed.** A code emitted by the implementation but absent here fails `TC-P08`.

**Clients branch on `code`, never on `message`.** Messages are for humans and will change.

**No code or message carries game content.** No tile face, no hand, no wall information — for privacy
(`20 §5`) and because the honest message is about the mechanism (`21 §5.2`).

**No message implies a rule.** There is no code meaning "that move is not allowed" in a rule sense,
because the system does not know (`NR-004`).

---

## 2. Command rejections

Delivered as `{ t: "reject", cmdId, code, message, view? }` — **only to the originating seat**
(`D-21-06`).

| Code | Cause | Player message | Client action |
|---|---|---|---|
| `NOT_BOUND` | A command before `bind` completed | — | Client defect; do not retry |
| `NOT_YOUR_TURN` | Turn gate failed — `draw_tile` only | "It's not your turn to draw." | Show; do not retry |
| `NOT_YOUR_TILE` | Ownership failed, **or the handle is unknown** | "You don't have that tile." | Reconcile view; show |
| `TILE_NOT_AVAILABLE` | The target moved or was superseded | "That tile was already taken." | Reconcile view; show |
| `NOT_IN_PHASE` | The command does not exist in this game state | "You can't do that right now." | Reconcile view |
| `TABLE_PAUSED` | A pause is in effect | "The table is paused — {seat} is disconnected." | Show; wait |
| `CORRECTION_PENDING` | A correction proposal is open | "Waiting on the correction vote." | Show; wait |
| `PASS_ROUND_OPEN` | A pass round is open | "A pass round is in progress." | Show; wait |
| `WALL_EMPTY` | No tiles remain to draw | "The wall is empty." | Show |
| `NO_CHECKPOINT` | Correction target outside the window | "That's too far back to undo." | Show |
| `DUPLICATE_COMMAND` | `cmdId` already applied | — | **Treat as success** (`CO-8`) |
| `STALE_STATE` | Acted on a superseded view | "The table changed — try again." | Replace view from the attached snapshot |
| `MALFORMED` | Schema validation failed | — | Client defect; do not retry |
| `RATE_LIMITED` | Throttled | "Slow down a moment." | Back off, then allow retry |
| `FORBIDDEN` | Authorization failed | — | Client defect or a revoked seat |
| `TABLE_CLOSED` | The table is terminal | "This table has closed." | Return to home |

Precedence when several apply: `TABLE_PAUSED`, then `CORRECTION_PENDING`, then `PASS_ROUND_OPEN`
(`09 §5.2`).

### 2.1 `NOT_YOUR_TILE` covers unknown handles deliberately

An unknown handle and a handle belonging to another seat produce the same code. Distinguishing them
would let a client probe which handles exist — a small oracle, and free to close (`D-13-08`).

### 2.2 `SEQ_GAP` is a close code, not a rejection

A `cseq` gap does not produce a rejection frame. It closes the connection, because a client that has
lost frames cannot be trusted to be coherent (`13 §5.1`).

---

## 3. Close codes

| Code | Name | Cause | Client action |
|---|---|---|---|
| 4001 | `BIND_REQUIRED` | First frame was not `bind`, or the 5 s deadline passed | Client defect; do not retry blindly |
| 4002 | `TICKET_INVALID` | Ticket unknown, expired, or already used | Mint a fresh ticket; retry **once** |
| 4003 | `REPLACED_BY_NEWER_BIND` | Another connection bound to this seat | **Do not reconnect.** Tell the player their seat was taken on another tab or device |
| 4004 | `SESSION_REVOKED` | The session became invalid | Return to login |
| 4008 | `PROTOCOL_VIOLATION` | Malformed frame, `cseq` gap, or a frame in the wrong state | Client defect; report; do not retry blindly |
| 4009 | `RATE_LIMITED` | 20 consecutive throttles | Back off substantially, then reconnect |
| 4010 | `SLOW_CONSUMER` | Backpressure threshold exceeded | Reconnect with backoff |
| 1012 | `SERVICE_RESTART` | Planned restart | Reconnect with backoff **and jitter** |
| — | Transport loss | Network | Reconnect with backoff and jitter |

### 3.1 Reconnection policy

```
delay = min(30s, 1s × 2^attempt) × (0.5 + random × 0.5)
```

Jitter is not optional (`CO-7`): a restart disconnects four clients simultaneously, and without
jitter they reconnect in lockstep and do it again on the next failure.

`4003` is the one code that must **not** trigger a reconnection. Reconnecting would displace the
connection that displaced this one, and two tabs would fight indefinitely.

---

## 4. REST error codes

| HTTP | Code | Cause |
|---|---|---|
| 400 | `MALFORMED` | Schema-invalid request |
| 400 | `REASON_REQUIRED` | An administrative mutation without a reason |
| 401 | `INVALID_CREDENTIALS` | Wrong password **or unknown account** |
| 401 | `NO_SESSION` | Missing or invalid session |
| 403 | `ACCOUNT_DISABLED` | The account is disabled |
| 403 | `CSRF_INVALID` | Anti-forgery token missing or wrong |
| 403 | `FORBIDDEN` | Authenticated but not permitted |
| 404 | `NOT_FOUND` | Not found, **or found and not permitted** |
| 409 | `ALREADY_SEATED` | The account holds a seat elsewhere |
| 409 | `GAME_IN_PROGRESS` | The operation requires no live game |
| 409 | `TABLE_FULL` | No free seat |
| 422 | `PASSWORD_TOO_SHORT` | Below 12 characters |
| 422 | `PASSWORD_BREACHED` | Present in a known-compromised list |
| 422 | `DISPLAY_NAME_INVALID` | Fails validation |
| 423 | `ACCOUNT_LOCKED` | Lockout in effect; carries `locked_until` |
| 429 | `RATE_LIMITED` | Carries `Retry-After` |
| 500 | `INTERNAL` | Carries a correlation identifier and nothing else |

### 4.1 Codes that are deliberately indistinguishable

| Situation | Returned | Why |
|---|---|---|
| Wrong password vs unknown account | `401 INVALID_CREDENTIALS` | Prevents account enumeration |
| Wrong join code vs unknown table vs full table | `404 NOT_FOUND` | Prevents table enumeration (`15 §5.2`) |
| Table exists but the requester is not the host | `404 NOT_FOUND` | `403` would confirm existence |
| Duplicate registration email | `201`, as a success | Prevents enumeration; the existing address is notified (`D-18-04`) |

Each is a deliberate loss of diagnostic precision in exchange for closing an enumeration oracle. All
four are equivalent in response time as well as in content.

---

## 5. Notice kinds

Out of band; not part of the `seq` stream.

| Kind | Meaning | Client action |
|---|---|---|
| `connection_degraded` | Heartbeats are slow | Show a banner |
| `rate_limit_warning` | Approaching a limit | Throttle voluntarily |
| `service_restarting` | A planned restart is imminent | Show a banner; expect `1012` |

---

## 6. Absent codes

Machine-checked. A code matching any of these fails `TC-A01` or `TC-A06`.

| Would-be code | Why absent |
|---|---|
| `ILLEGAL_MOVE`, `INVALID_PLAY`, `NOT_ALLOWED_BY_RULES` | The system does not know the rules (`NR-004`) |
| `INVALID_EXPOSURE`, `INVALID_GROUP` | `NR-006` |
| `INVALID_JOKER_USE` | `NR-007` |
| `INVALID_PASS`, `WRONG_PASS_COUNT` | `NR-008` |
| `HAND_TOO_LARGE`, `HAND_TOO_SMALL` | `NR-009` |
| `INVALID_MAHJONG`, `HAND_DOES_NOT_WIN` | `NR-003` |
| `HAND_DEAD` | `NR-012` |
| `INSUFFICIENT_POINTS`, `PAYMENT_REQUIRED` | `NR-101`–`NR-109` |
| `NOT_A_SPECTATOR`, `SPECTATOR_LIMIT` | `NR-401` |

The absent list is more informative than most of the catalog. Nine plausible error codes that a
reasonable Mahjong application would have, and the system has none of them, because it never makes
any of those judgments.

---

## 7. Cross References

`21_Error_Handling_and_Recovery.md` · `19_WebSocket_Event_Catalog.md §7` ·
`Wire_Protocol_Contract.md` · `REST_Endpoint_Catalog.md` · `15_Security_Architecture.md`

## 8. Revision History

| Version | Date | Author | Changes |
|---|---|---|---|
| 0.1 | 2026-09-02 | Design (architect role) | Initial catalog: 16 rejections, 8 close codes, 17 REST codes, 9 absence patterns |
