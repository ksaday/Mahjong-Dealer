# 14 — Player Privacy

| | |
|---|---|
| **Project** | American Mahjong Dealer |
| **Document** | 14_Player_Privacy.md |
| **Status** | Ratified v0.1 — approved by the project owner, 2026-09-02 |
| **Last Updated** | 2026-09-02 |
| **Role in SSOT** | Owns the visibility classification, the hidden-information policy matrix, the seat projector, the type-level guard, and the `SRV` boundary. Does **not** own the threat analysis (`PRIVACY_THREAT_MODEL.md`), logging mechanics (`20`), storage (`17`), or authentication (`15`). |

---

## 1. Executive Summary

At a physical table, hidden information is hidden by geometry. Tiles stand behind a rack facing their
owner; the angles do the work; nobody has to remember to conceal anything.

Digitally the geometry is gone. Every byte the server holds is equally reachable by every code path,
and a concealed hand is concealed only because software chose not to send it. That choice has to be
made correctly on every frame, in every path, forever — and approaches that depend on remembering to
make it correctly fail eventually, in one overlooked debug endpoint or one convenient helper added
under deadline.

So the model is built to make the choice **structural**. Three mechanisms, failing at three different
times: a **type system** that makes leaking to a logger a compile error, a **single projector** that
constructs each seat's view rather than filtering a shared one, and **runtime scanners** that check
real output against a planted control. A leak must defeat all three.

The classification has three classes, not two. `PUB` and `OWN` are the expected pair. The third,
`SRV`, exists for data no player is entitled to at all — principally the wall order, which is the
most sensitive object in the system because it plus the public history reconstructs every hand
(`08 §5.3`). Calling that "private" invites the question "to whom?", and every answer naming a
principal is wrong.

---

## 2. Objectives

Serves `OBJ-06` directly: a player's concealed hand is visible to that player and to no one else —
not another player, not an administrator, not a log, not a backup. Implements `C-03`.

---

## 3. The governing principle

> A player receives the minimum information required to operate the table.

Not "the interface does not display it." Received and hidden is a bug waiting to be discovered by
anyone who opens a browser's network inspector. The requirement is that **the unauthorized client
never receives it**.

This is why the model is expressed as what is *sent*, not what is *shown*, and why the frame
inspection suite (`TC-P01`) examines every emitted frame rather than the rendered interface.

---

## 4. Visibility classes

| Class | Audience | Contents |
|---|---|---|
| `PUB` | All four seats | Seat positions and occupancy; display names; connection state; readiness; turn pointer; wall count; the ordered discard pile with faces; all exposures with faces and owners; **hand sizes**; pass-round routing and per-seat commit counts; declarations and responses; correction proposals and outcomes; pause state; game state; commitment values; `seq` |
| `OWN` | Exactly one seat | That seat's concealed tile faces; its rack order and gaps; its selection state; the contents of its pass commitment before execution |
| `SRV` | The server process only | Wall order; commitment salt; checkpoint private regions; the handle-to-face map for tiles not visible to the requesting seat |

### 4.1 Why hand sizes are public

At a physical table you can see how many tiles are on someone's rack. Concealing the count would be
*more* than physical privacy, and it would break legitimate play — a player watching for someone's
hand to change size is doing something a real player does. What must not follow is any
*interpretation* of the count (`NR-205`).

### 4.2 Why pass-round commit counts are public

You can see three tiles pushed across a table. The count is public; the identities are not
(`FR-092`). The count also becomes visible anyway once the round executes and hand sizes change, so
concealing it would be theatre.

### 4.3 The `SRV` boundary

`SRV` needs its own statement, because "server-only" is ambiguous and the ambiguity is where leaks
live.

> **Server-side possession is not human visibility.**
>
> The server process may hold concealed state in order to operate the dealer. No *person* and no
> *downstream system* may receive or reconstruct it.

| Principal or system | May receive `OWN` for another seat, or `SRV`? | Enforced by |
|---|---|---|
| The owning player | `OWN` for their own seat only | The projector takes a seat |
| Another player | **No** | The projector has no field for it |
| An administrator | **No** | No administrative path reaches table state (`04 §3.3`) |
| Support or operations personnel | **No** | The role does not exist (`04 §3.4`) |
| Application logs | **No** | Branded types; redactor; scanner (`20`) |
| Metrics and traces | **No** | Same entry-point type guard |
| Crash and error reports | **No** | Identifiers only, never state (`21 §6`) |
| Analytics | **No** | No analytics receives game data (`NR-505`) |
| Database, at rest | Encrypted only, in checkpoints | Application-layer encryption plus column privilege (`17 §7`) |
| Backups | Encrypted only, and usually absent | Purged at game close (`NFR-013`) |
| Replay | **Does not exist** | `ADR-0012` |
| Any external service | **No** | No egress carries game data (`NR-209`) |

The final column is the point: each row is enforced by a mechanism, not by a policy.

---

## 5. The seat projector

Exactly one function in the entire system converts authoritative state into something a client may
receive.

```
project(state, seat) -> SeatView
```

| Property | Consequence |
|---|---|
| It is the only producer of client-bound payloads | The privacy audit has one subject, not a codebase |
| It takes a seat | There is no seat-agnostic output |
| It **constructs**, never filters | A field is absent unless deliberately added |
| Its output type has no field for another seat's faces, the wall order, or the salt | Leaking them is a type error, not a review failure |
| The socket write interface accepts only its output | A broadcast helper has nothing to call (`12 §6`) |
| Live frames, backlog frames, and snapshots all use it | Resumption cannot leak differently (`ADR-0011`) |

### 5.1 Construct, do not filter

This is the most important detail in the chapter.

A **filter** takes a full state and removes what should not be sent. Its default is to include, so
its failure mode is **disclosure**: a newly added field is exposed until someone remembers to add it
to the filter.

A **constructor** builds a view from named parts. Its default is to omit, so its failure mode is a
**missing field** — noticed immediately, harmless when it happens.

Given that state will grow and that not every future contributor will be thinking about privacy when
they add a field, the difference in failure mode is decisive.

### 5.2 The seat view

| Field | Class | Notes |
|---|---|---|
| `seat` | — | Which seat this view is for |
| `seq` | `PUB` | Authoritative sequence |
| `tableState`, `gameState`, `flags` | `PUB` | |
| `seats[]` | `PUB` | Position, display name, connection, readiness, hand size, exposures |
| `turn` | `PUB` | |
| `wallRemaining` | `PUB` | Count only |
| `discards[]` | `PUB` | Ordered, with faces |
| `ownHand[]` | `OWN` | `{ handle, face }` in the player's order, with gaps |
| `ownSelection[]` | `OWN` | Handles |
| `passRound?` | `PUB` routing and counts; `OWN` own commitment | |
| `correction?` | `PUB` | Proposal, responses |
| `declaration?` | `PUB` | Declarer, responses, revealed hands |
| `commitment` | `PUB` | Current wall commitment |

`seats[]` carries no hand contents for any seat — including the viewer's own, which lives in
`ownHand`. That asymmetry is deliberate: there is no array position where another seat's tiles could
be accidentally populated, because the structure has no such position.

---

## 6. Type-level enforcement

### 6.1 Branded types

Concealed material carries phantom brands in `shared`:

| Type | Wraps |
|---|---|
| `ConcealedHand` | A seat's concealed tiles |
| `WallOrder` | The ordered wall |
| `Salt` | The commitment salt |
| `TileFace` | A single face, wherever it is not already public |

A brand is a compile-time marker with no runtime cost. Its purpose is to make these values
structurally distinct from ordinary data so that the type system can refuse them where they do not
belong.

### 6.2 The guard

`NoConcealed<T>` is a recursive mapped type that renders any property carrying a branded type
unusable. Every logging, metrics, and tracing entry point takes `NoConcealed<T>`.

```
log.info(msg: string, payload: NoConcealed<T>): void
```

The consequence: `log.debug('state', gameState)` **does not compile** (`NFR-014`). The developer who
adds it while chasing a hard bug discovers the boundary immediately, at the moment they are most
inclined to cross it — which is exactly when the prohibition needs to be enforced by something other
than their judgment.

### 6.3 The proof file

A dedicated file asserts, via deliberate type errors, that the forbidden shapes are rejected — a
hand, a wall order, a salt, a nested object containing any of them, an array of them. The number of
assertions is counted in CI (`TC-P06`).

Counting matters. Without it, a change that accidentally makes `NoConcealed<T>` permissive would
cause the proof file to compile cleanly, and a silently-satisfied proof looks exactly like a passing
test.

---

## 7. The hidden-information policy matrix

Every surface where concealed material could plausibly appear, with its policy, its mechanism, and
what verifies it.

| # | Surface | Policy | Mechanism | Verified by |
|---|---|---|---|---|
| 1 | WebSocket frames to a seat | `OWN` for that seat only | Seat projector | `TC-P01` |
| 2 | WebSocket frames to other seats | No concealed material | Projector output type | `TC-P01` |
| 3 | Backlog frames on resumption | Same as live | Same projector | `TC-P01` |
| 4 | Full snapshots | Same as live | Same projector | `TC-P01` |
| 5 | REST responses | Never carry table state | No route reads table state | `TC-P02` |
| 6 | Server memory | May hold; never exported | `SRV` class; no export path | Design property |
| 7 | Application logs | Never | Branded types, redactor, scanner | `TC-P03` |
| 8 | Metrics and labels | Never | Entry-point type guard | `TC-P03` |
| 9 | Traces and spans | Never | Entry-point type guard | `TC-P03` |
| 10 | Crash and error reports | Identifiers only | Reporter takes no state | `TC-P03` |
| 11 | Analytics | No game data at all | No analytics in the game path | `TC-P05` |
| 12 | Database, checkpoint private regions | Encrypted; purged at close | App-layer encryption; purge job | `TC-P04` |
| 13 | Database, public event log | No non-public face | Event schema review | `TC-P04` |
| 14 | Database replicas | Same as primary | Encrypted at rest | `TC-P04` |
| 15 | Backups | Encrypted; usually absent | Purge before backup window | `TC-P04` |
| 16 | Administrative interfaces | No path exists | Absent capability (`04 §3.3`) | `TC-P02` |
| 17 | Support tooling | Role does not exist | — | `TC-A10` |
| 18 | Replay and export | Do not exist | `ADR-0012` | `TC-A11` |
| 19 | Development and debug endpoints | Must not exist in production | Build assertion | `TC-P02` |
| 20 | Client bundle and source maps | No server state | Build output audit | `TC-P05` |
| 21 | Browser storage | No concealed material persisted | Client audit | `TC-P05` |
| 22 | External services | No egress carries game data | Egress audit | `TC-P05` |
| 23 | Correction and rewind | Restores only what was already seen | Per-action analysis + wall reshuffle | `05 §8.4`, `TC-R08` |
| 24 | Shuffle commitment | Never revealed | Salt is `SRV` | `TC-R07` |
| 25 | Table chat | Never persisted or logged | No storage path | `TC-P03`, `TC-P04` |
| 26 | Message timing and size | No inference channel | See `§8` | `TC-P05` |

---

## 8. Side channels

Two deserve explicit treatment because they are not addressed by any of the mechanisms above.

**Message size.** A frame carrying a seat's own hand is larger for a larger hand. This leaks nothing:
hand sizes are already `PUB` (`§4.1`), so an observer learns something they were told directly. No
padding is required. This is worth recording because "pad the frames" is a reflexive
recommendation, and here it would be cost without benefit.

**Timing.** Command processing time does not depend on tile faces, because no code path branches on
a face (`D-06-04`). It does depend on hand size — a permutation over more tiles takes marginally
longer — which again is public. There is no timing channel that reveals `OWN` or `SRV` data, and the
reason is a property the architecture already has for a different reason.

---

## 9. Correction and privacy

Analysed in full in `05 §8.4`; summarized here because the matrix references it.

A rewind restores state some seats have already seen. Enumerated per action type, only one case
leaks: rewinding past a **wall draw**, where the drawing seat saw a tile that may now go elsewhere.
Discards, claims, exposures, passes, and arrangements leak nothing, because in each case the restored
information was already known to everyone who will see it again.

The one leaking case is neutralized by reshuffling the undrawn remainder of the wall (`08 §7.2`),
which is also what physical players do.

---

## 10. Design Decisions

| ID | Decision | Rationale |
|---|---|---|
| D-14-01 | Three visibility classes, not two | The wall order is not private *to* anyone; `SRV` says the correct thing and removes an ambiguity that would otherwise be resolved case by case. |
| D-14-02 | The projector constructs rather than filters | A filter's failure mode is disclosure; a constructor's is a missing field. State will grow, and not every author will be thinking about privacy. |
| D-14-03 | Exactly one projector, enforced in CI | Reduces the privacy audit to one function and one type. |
| D-14-04 | The socket write interface accepts only projector output | A broadcast helper has nothing to call. |
| D-14-05 | Live, backlog, and snapshot frames share the projector | Resumption cannot acquire different privacy properties. |
| D-14-06 | Branded types on every telemetry entry point | Closes the most likely leak path — debug logging — at compile time, at the moment a developer most wants to cross it. |
| D-14-07 | Count the proof-file assertions in CI | A silently-satisfied proof is indistinguishable from a passing test. |
| D-14-08 | Hand sizes and pass commit counts are `PUB` | Both are visible at a physical table; concealing them would exceed physical privacy and break legitimate play. |
| D-14-09 | The viewer's own hand is a separate field from the seat array | There is no array position where another seat's tiles could be populated. |
| D-14-10 | State the `SRV` clause as principals and systems, each with a mechanism | "Server-only" is ambiguous; the table makes each case a checkable claim. |
| D-14-11 | No frame padding | Sizes correlate with hand size, which is public. Padding would be cost without benefit. |

---

## 11. Alternative Designs

| Alternative | Why rejected |
|---|---|
| Two classes, public and private | No home for the wall order; invites "private to whom?" |
| Filtering a full state before sending | Default-include; a new field leaks until someone remembers it. |
| Per-seat filtering at the socket layer | Multiple filter sites, multiple things to audit. |
| Runtime redaction as the primary control | A filter, with a filter's failure mode; retained as a backstop only. |
| Encrypting hands so only the owner can decrypt | The server must move tiles between hands, so it must be able to read them. Client-side keys would make the dealer impossible. |
| Concealing hand sizes | Exceeds physical privacy and breaks legitimate observation. |
| Padding frames to a fixed size | Guards a channel that reveals only public information. |
| Trusting the interface not to display received data | Received is received; a network inspector defeats it. |

---

## 12. Trade-offs

**Every client-bound field must be added to the projector explicitly.** Accepted: this is the
mechanism, not a cost of it.

**Branded types add friction in code that legitimately handles concealed material.** Accepted: that
code is a small, deliberate part of the system, and friction there is appropriate.

**The server can read every hand.** Unavoidable — a dealer that moves tiles must know what they are.
Mitigated by mechanism rather than by claim: nothing normal reads it, no person can reach it, it is
encrypted at rest, and it is purged at game close.

**No replay means less debuggability.** Accepted, and mitigated by a deterministic core that is
exhaustively testable without a recorded game (`ADR-0012`).

---

## 13. Risks

| Risk | Mitigation |
|---|---|
| A second serialization path appears | `TC-P07`; the socket write type; `NFR-062` |
| A new state field is projected without thought | Construct-not-filter means it is absent by default |
| Debug logging leaks a hand | Compile error; redactor; scanner with a planted control |
| A public event acquires a private field | Event schema review is part of the definition of done; `TC-P04` |
| A future replay or export is added | `ADR-0012` conditions; `TC-A11` |
| The proof file is silently weakened | Assertion count checked in CI (`TC-P06`) |
| An administrative read path is added | `NR-406`; `TC-P02` asserts no administrative response carries tile data |

---

## 14. Future Considerations

Not committed: per-game encryption keys so that purging a game's key is itself a purge of its
material; a formal information-flow analysis of the projector, should the state model grow
substantially.

---

## 15. Cross References

| Document | Focus |
|---|---|
| `PRIVACY_THREAT_MODEL.md` | The `PT-##` threats this model defends against |
| `07_Tile_Model.md §5.3` | Opaque handles |
| `12_Realtime_WebSocket_Architecture.md §6` | Delivery and the absent broadcast |
| `17_Database_Design.md §7` | Encryption and column privilege |
| `20_Logging_and_Observability.md` | Redaction and the scanner |
| `34_Testing/Privacy_and_Absence_Suites.md` | `TC-P*` |
| `ADR-0006`, `ADR-0012`, `ADR-0013` | Decisions this chapter implements |

---

## 16. Revision History

| Version | Date | Author | Changes |
|---|---|---|---|
| 0.1 | 2026-09-02 | Design (architect role), owner-approved | Initial chapter: three classes, 26-surface policy matrix |
