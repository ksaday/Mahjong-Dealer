# Integrity and Randomization Suites

| | |
|---|---|
| **Project** | American Mahjong Dealer |
| **Document** | 34_Testing/Integrity_and_Randomization_Suites.md |
| **Status** | Normative. Ch. 25 and Ch. 26 remain authoritative |
| **Last Updated** | 2026-09-02 |
| **Role in SSOT** | Owns the `TC-I*`, `TC-R*`, `TC-M*` and `TC-F*` specifications. Does **not** own the strategy (`25`), the harnesses (`26`), or the mechanisms being checked (`13`, `08`). |

---

## 1. Scope

Four suite families covering technical correctness: mechanics, input integrity, randomization, and
failure recovery. Between them they verify every property the system claims that is not a privacy
property.

Two of them test properties that are unusual to test at all. The **mechanics** suite verifies the
conservation invariant by fuzzing thousands of complete games — one property that catches a large
class of defect. And the **integrity** suite must construct input a well-behaved client never
produces: replayed frames, sequence gaps, stale commands. Those require the SocketHarness's ability
to inject hostile input deliberately (`26 §7`).

---

## 2. Mechanics — `TC-M*`

Pure, no infrastructure, fast enough to run on every commit.

### TC-M01 — Conservation invariant

**The highest-value single test in the suite.**

| Aspect | Specification |
|---|---|
| Method | Property test over randomized complete games |
| Volume | ≥ 5000 games per run |
| Asserts | After **every** action: `wall ⊎ hands ⊎ discards ⊎ exposures ⊎ inFlight == tileSet` |
| Covers | Deal, draw, discard, claim, expose, retract, swap, pass commit, pass execute, pass cancel, pass withdraw, **rewind**, **reshuffle**, checkpoint restore |
| Failure | Reports the seed and a **shrunk** minimal reproducing sequence |

One property, exhaustively fuzzed, catches double-spending a tile, losing one in a partially applied
transition, duplicating one across a rewind, dropping one in a cancelled pass round, and resurrecting
one after a reshuffle. The `inFlight` location exists specifically so this holds *during* a pass
round rather than only on either side of it (`06 §6`).

Shrinking is required, not optional: a conservation failure after 300 random actions is not a usable
bug report (`D-26-05`).

### TC-M02 — Tile set

| Asserts |
|---|
| Construction yields exactly 152 tiles |
| Group counts match `07 §3` exactly: 36 dots, 36 bams, 36 craks, 16 winds, 12 dragons, 8 flowers, 8 jokers |
| Every tile is uniquely identified by face plus copy |
| Flowers are eight distinct faces, one copy each (`07 §3.2`) |
| Every tile receives a distinct 128-bit handle |
| Handles differ between two games of the same table |

### TC-M03 — Total ordering

| Asserts |
|---|
| The comparator never returns equal for two distinct tiles |
| Sorting is stable across platforms and engine versions |
| Canonical encoding of the same wall yields identical bytes on every supported platform |

### TC-M04 — State transitions

Exhaustive from constructed states: every command in every state, asserting the resulting state,
emitted events, and rejection codes against `09 §7`.

### TC-M05 — Rack order

Covered operationally by `TC-A09`; asserted here at the core level for every transition.

### TC-M06 — Turn pointer

| Asserts |
|---|
| Advances to the next seat in fixed order on a wall draw |
| Moves to the claimant on a claim |
| Is **unchanged** by discard, expose, retract, swap, pass, declaration, chat, pause |
| Gates `draw_tile` and **nothing else** |

### TC-M07 — Pass round atomicity

| Asserts |
|---|
| No tile moves until every participant has committed |
| All tiles move in one transition |
| Under every interleaving of commit, withdraw, and cancel, no partial application occurs |
| Withdrawn and cancelled tiles return to the end of the originating seat's order |
| Conservation holds at every intermediate point |

### TC-M08 — Checkpoint round trip

| Asserts |
|---|
| Serialize then restore yields a byte-identical state |
| Conservation holds on the restored state |
| Flags, turn pointer, `seq`, and receipts are preserved |
| Rack orders and gaps are preserved for all four seats |

### TC-M09 — Rewind

| Asserts |
|---|
| Restores exactly the state at the target sequence |
| Conservation holds after restoration |
| Refuses a target beyond the window with `NO_CHECKPOINT` |
| Refuses a target in a previous game |
| Triggers a reshuffle if and only if the range crosses a wall draw |

### TC-M10 — Canonical encoding

Cross-platform: the same wall produces the same commitment on every supported operating system and
runtime version.

---

## 3. Input integrity — `TC-I*`

Requires the SocketHarness, since a correct client never produces this input.

### TC-I01 — No client-supplied identity

| Asserts |
|---|
| No REST endpoint accepts a `seat` parameter in a path, query, or body |
| No socket command schema contains a `seat`, `player`, or `account` field |
| A frame carrying an **extra** `seat` field is rejected as `MALFORMED`, and the field is ignored rather than honoured |
| The seat used by every handler derives from the binding |

The third assertion matters: a schema that merely ignores an unexpected field would be safe, but one
that silently accepted it would not, and the test distinguishes them.

### TC-I02 — Cross-seat isolation

| Asserts |
|---|
| Referencing a handle belonging to another seat yields `NOT_YOUR_TILE` |
| Referencing an unknown handle yields the **same** code (`D-13-08`) |
| Discarding, exposing, and swapping another seat's tile all fail |
| Brute-forcing handles yields no information: response and timing are indistinguishable |

### TC-I03 — Single writer

| Asserts |
|---|
| Every state change is attributable to a command processed by the table actor |
| No code path mutates authoritative state outside the actor |
| Concurrent commands from four seats produce a single total order |

### TC-I04 — Idempotency

| Asserts |
|---|
| A replayed `cmdId` is not applied twice |
| The replay returns `DUPLICATE_COMMAND` **with the original outcome** |
| Applies across a reconnection, since receipts are in checkpoints |
| Applies across a server restart |
| Under 100 randomized replay injections per game, the state matches a no-replay run exactly |

### TC-I05 — Sequencing

| Asserts |
|---|
| A `cseq` gap closes the socket with `PROTOCOL_VIOLATION` |
| An exact repeat of the last `cseq` is treated as a retry |
| A regression with an unseen `cmdId` closes the socket |
| `cseq` resets to 1 on a new connection |

### TC-I06 — Malformed input

| Asserts |
|---|
| Malformed JSON closes the connection |
| Schema violations are rejected as `MALFORMED` with **no state change** |
| Unknown command names are rejected |
| Oversized frames close the connection |
| Fuzzing every command schema produces no crash, hang, or state change |
| Chat text containing markup is stored and rendered as plain text |

### TC-I07 — Staleness

| Asserts |
|---|
| A `claim_discard` naming a superseded tile yields `TILE_NOT_AVAILABLE` |
| An order-sensitive command against a stale view yields `STALE_STATE` **with a snapshot attached** |
| `arrange_hand` is never stale — a late arrival applies as a permutation |
| `draw_tile` is never stale — the target is "next from the wall" |

### TC-I08 — Concurrent claims

| Asserts |
|---|
| With four seats claiming the same discard simultaneously, **exactly one** succeeds |
| The other three receive `TILE_NOT_AVAILABLE` |
| The winner is the first to reach the actor's queue |
| Conservation holds |
| Repeated 1000 times, exactly one winner every time |

---

## 4. Randomization — `TC-R*`

### TC-R01 — Set preservation

Every shuffle over 10 000 runs yields a permutation of exactly the 152 tiles — no duplicates, no
omissions, no substitutions.

### TC-R02 — No tile selection

| Asserts |
|---|
| No command schema permits naming a tile to be drawn |
| `draw_tile` accepts only `head` or `tail` |
| The drawn tile is determined solely by wall position |

### TC-R03 — Distribution

| Aspect | Specification |
|---|---|
| Volume | 100 000 shuffles |
| Test | Chi-squared over face-by-position frequency |
| Threshold | No significant deviation at α = 0.001 |
| Also | Each individual tile's position distribution tested against uniform |
| Also | Adjacent-pair frequencies tested for independence |

The adjacency test would catch a subtly broken swap loop that the marginal distribution test alone
could pass.

### TC-R04 — Independence between games

Successive shuffles show no correlation; knowing one wall gives no information about the next.

### TC-R05 — No client influence

Static analysis: no value derived from a request, a client field, a player identifier, a table
identifier, or a clock reaches the entropy source or the shuffle.

### TC-R06 — Seed injection absent in production

| Asserts |
|---|
| A production build contains no seed-injection code path |
| The startup assertion that the path is unreachable is present and passes |
| Attempting to supply a seed in a production build has no effect |

### TC-R07 — Commitment

| Asserts |
|---|
| The commitment recomputes exactly from the retained wall order and salt |
| The same wall and salt always produce the same commitment |
| A single-tile change to the wall changes the commitment |
| The salt appears in no frame, log, metric, or trace |
| A fresh commitment is published after every reshuffle |

### TC-R08 — Reshuffle preserves non-wall state

| Asserts |
|---|
| After a rewind reshuffle, every seat's hand is **byte-identical** to the restored state |
| Discards are byte-identical |
| Exposures are byte-identical |
| **Only** the undrawn wall remainder differs |
| Conservation holds |
| A new commitment is published |

This is the test that verifies `ADR-0016`'s central claim: that a reshuffle re-randomizes the future
without altering the restored past.

---

## 5. Failure recovery — `TC-F*`

### TC-F01 — Crash and restore

| Aspect | Specification |
|---|---|
| Method | Kill the process uncleanly mid-game, at randomized points; restart |
| Asserts | Every table restores from its checkpoint |
| Asserts | Conservation holds on every restored state |
| Asserts | All four clients reconnect and receive consistent views |
| Asserts | At most **one** public action is lost (`NFR-031`) |
| Asserts | Rack orders and gaps are preserved |
| Volume | ≥ 100 kill points across randomized games |

### TC-F02 — Disconnection detection

Detected within 35 seconds; the table pauses; the pause is public; no action proceeds on the absent
seat's behalf.

### TC-F03 — Reconnection

Full seat view restored, including rack order, gaps, selection, and any open pass commitment.

### TC-F04 — Resumption modes

| Asserts |
|---|
| A gap within the backlog delivers exactly the missed events, projected for that seat |
| A gap beyond the backlog delivers a full snapshot |
| A gap spanning a restart delivers a snapshot |
| Both paths produce identical resulting client state |

### TC-F05 — Corrupt checkpoint refused

A checkpoint failing conservation verification is refused; the table becomes unavailable rather than
serving corrupt state; the checkpoint is **not** overwritten (`D-21-04`); other tables are unaffected.

### TC-F06 — Database unavailable

Live play continues; checkpoint writes fail and retry; login and table creation fail cleanly; play
resumes checkpointing when the database returns.

### TC-F07 — Graceful shutdown

| Asserts |
|---|
| Checkpoints flush synchronously |
| Sockets close with `1012` |
| **Nothing is lost** |
| Clients reconnect with jitter and resume |

---

## 6. Suite properties

| Suite | Gate stage | Runtime budget |
|---|---|---|
| `TC-M*` | T1 | ≤ 5 min |
| `TC-I*` | T2 | ≤ 5 min |
| `TC-R*` | T4 | ≤ 10 min (`TC-R03` dominates) |
| `TC-F*` | T2 | ≤ 10 min |

Every property test reports a seed and a shrunk minimal case on failure.

---

## 7. Cross References

`25_Testing_Strategy.md` · `26_Test_Architecture.md` · `07_Tile_Model.md §7` ·
`08_Shuffle_and_Deal_Architecture.md §8` · `13_Input_Integrity.md` · `16_Data_Architecture.md §5` ·
`Privacy_and_Absence_Suites.md`

## 8. Revision History

| Version | Date | Author | Changes |
|---|---|---|---|
| 0.1 | 2026-09-02 | Design (architect role) | Initial specification: 10 mechanics, 8 integrity, 8 randomization, 7 recovery cases |
