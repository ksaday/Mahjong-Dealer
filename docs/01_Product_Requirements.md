# 01 — Product Requirements

| | |
|---|---|
| **Project** | American Mahjong Dealer |
| **Document** | 01_Product_Requirements.md |
| **Status** | Ratified v0.2 — approved by the project owner, 2026-09-03 |
| **Last Updated** | 2026-09-03 |
| **Role in SSOT** | Owns the functional requirement catalog (`FR-###`), the non-functional requirement catalog (`NFR-###`), and the acceptance criteria (`AC-###`). Does **not** own the negative requirements (`SCOPE_BOUNDARIES.md`), the performance measurement methods in depth (`23`), or any design detail — a requirement states *what*, never *how*. |

---

## 1. Executive Summary

This chapter is the catalog every other document answers to. It states what the system must do, how
well it must do it, and how anyone will know when it does.

Three conventions make it usable by an implementation agent. Every functional requirement carries an
acceptance note precise enough to be turned into a test without inventing anything. Every
non-functional requirement carries a **measurement method**, because an unmeasurable non-functional
requirement is a wish. And every requirement that could plausibly be read as licensing rule
knowledge is annotated with the negative requirement that forbids that reading — the catalog is
written defensively, on the assumption that a reasonable engineer will otherwise fill a gap with a
rule.

Priorities use MoSCoW. **Must** requirements define v1; the system is not shippable without them.
**Should** requirements are expected in v1 and may be deferred only with the owner's agreement.
**Could** requirements are genuinely optional.

---

## 2. Objectives

This chapter serves `OBJ-12` — that the documentation be sufficient for a competent implementer to
build the system correctly without consulting its authors — by making every obligation explicit,
identified, and traceable.

---

## 3. Feature families

| ID | Family | Range | Owning chapters |
|---|---|---|---|
| F-01 | Identity and session | FR-001 – FR-019 | `04`, `15` |
| F-02 | Table creation, joining, and seating | FR-020 – FR-039 | `05` |
| F-03 | Dealing | FR-040 – FR-059 | `07`, `08` |
| F-04 | Play actions | FR-060 – FR-089 | `10` |
| F-05 | Tile passing | FR-090 – FR-099 | `10` |
| F-06 | Hand arrangement | FR-100 – FR-109 | `10`, `11` |
| F-07 | Game conclusion | FR-110 – FR-119 | `10` |
| F-08 | Correction | FR-120 – FR-129 | `05` |
| F-09 | Table communication | FR-130 – FR-139 | `05` |
| F-10 | Presence and recovery | FR-140 – FR-159 | `22` |
| F-11 | Administration | FR-160 – FR-169 | `04`, `28` |

---

## 4. Functional requirements

### 4.1 F-01 — Identity and session

| ID | Requirement | Pri | Acceptance |
|---|---|---|---|
| FR-001 | A visitor can register an account with an email address and a password | Must | Account created; email stored case-insensitively and uniquely; password never stored in recoverable form |
| FR-002 | A visitor can authenticate with email and password and receive a session | Must | Session established on success; on failure the response does not reveal whether the account exists |
| FR-003 | A player can log out, ending the session immediately everywhere it is bound | Must | Session invalid for REST within one request; any bound socket closes within 5 seconds |
| FR-004 | A player can set and change a display name shown to the other three seats | Must | Name is the only profile attribute other seats receive |
| FR-005 | A player can change their password, which invalidates all other sessions | Should | Other sessions rejected on next use; the initiating session survives |
| FR-006 | Repeated failed authentication attempts against one account are progressively delayed and then locked | Must | Lock state is durable across a server restart (`SEC-014`) |
| FR-007 | A session expires after a bounded idle period and a bounded absolute lifetime | Must | Both enforced server-side; a client-held token cannot extend either |
| FR-008 | A player can see the sessions bound to their account and revoke any of them | Could | Revocation takes effect within 5 seconds |

### 4.2 F-02 — Table creation, joining, and seating

| ID | Requirement | Pri | Acceptance |
|---|---|---|---|
| FR-020 | A player can create a table, becoming its host | Must | Table created with four empty seats and a status of `OPEN` |
| FR-021 | Creating a table produces a join code that is short enough to read aloud | Must | Six characters, from an alphabet excluding visually confusable glyphs |
| FR-022 | A player can join a table by entering its join code | Must | Code stored irreversibly; a wrong code is indistinguishable from a nonexistent one |
| FR-023 | A joining player takes a specific empty seat | Must | Seat assignment is server-decided; a client cannot request a seat by identifier (`NR-601`) |
| FR-024 | A seat can be occupied by at most one account, and an account can occupy at most one seat at a time | Must | Enforced by a database constraint, not application logic alone |
| FR-025 | A player can leave their seat before a game begins | Must | Seat returns to empty; the table returns to `OPEN` |
| FR-026 | Each player can mark themselves ready, and can withdraw it | Must | Readiness is public to the table |
| FR-027 | A game can begin only when all four seats are occupied and all four are ready | Must | Any other combination rejects `start_deal` |
| FR-028 | The host can close a table that has no game in progress | Must | Table becomes `CLOSED`; all bindings close cleanly |
| FR-029 | A player can list the tables they currently occupy a seat at | Should | Returns only the requester's own tables (`NR-402`) |
| FR-030 | There is no public listing, browser, directory, or search of tables | Must | Negative requirement; verified by route audit (`NR-403`) |

### 4.3 F-03 — Dealing

| ID | Requirement | Pri | Acceptance |
|---|---|---|---|
| FR-040 | The system holds a complete tile set as specified in `07 §3` | Must | Exactly 152 distinct tiles, each individually identified |
| FR-041 | Each tile is distinguishable from every other tile of the same face | Must | A face plus a copy index identifies one physical tile |
| FR-042 | The wall is shuffled server-side using a cryptographically secure source of randomness | Must | No client input reaches the shuffle (`NR-603`) |
| FR-043 | The shuffle is uniform and unbiased | Must | Fisher–Yates with rejection sampling; verified statistically by `TC-R03` |
| FR-044 | A commitment to the wall order is computed at deal time and published to all four seats | Must | `SHA-256(wall order ‖ salt)`; the salt and order are never sent to a client (`NR-503`) |
| FR-045 | The opening deal places the configured number of tiles into each seat's concealed hand | Must | Default 13 per seat, 14 to the East seat; a table setup value, not a rule (`07 §4`) |
| FR-046 | After the opening deal, no hand size is ever enforced or checked | Must | Property test accepts arbitrary hand sizes (`NR-009`) |
| FR-047 | Each seat receives only its own dealt tiles | Must | Verified by full-game frame inspection (`TC-P01`) |
| FR-048 | The count of tiles remaining in the wall is public at all times | Must | Present in every seat view |
| FR-049 | The order of tiles remaining in the wall is never disclosed to any client | Must | `SRV` class (`NR-502`) |
| FR-050 | When the wall is exhausted, the system records the fact and takes no further action | Must | `WallExhausted` emitted; the game does not end automatically (`NR-012`) |

### 4.4 F-04 — Play actions

| ID | Requirement | Pri | Acceptance |
|---|---|---|---|
| FR-060 | The seat the turn pointer indicates can draw the next tile from the wall | Must | Only that seat; only when the pointer is at it |
| FR-061 | A draw can be taken from either end of the wall, at the drawing player's choice | Must | `head` or `tail`; the system attaches no meaning to the choice |
| FR-062 | A drawn tile enters the drawing seat's concealed hand and is visible only to that seat | Must | `TC-P01` |
| FR-063 | A player can discard a tile they hold | Must | Ownership verified server-side; the tile becomes public |
| FR-064 | The system never evaluates whether a discard is legal, wise, or expected | Must | No rule branch on the discard path (`NR-004`) |
| FR-065 | Discards accumulate in a public, ordered pile visible to all four seats | Must | Order preserved and stable |
| FR-066 | Any player can claim the current discard | Must | No turn gate; no entitlement check (`NR-005`) |
| FR-067 | Claiming the current discard moves it into the claimant's concealed hand and moves the turn pointer to them | Must | Recorded as a performed action, not an entitled one |
| FR-068 | Only the most recent discard is claimable | Must | Older discards are reachable only through a correction (`FR-120`) |
| FR-069 | Simultaneous claims are resolved by server arrival order, first only | Must | Deterministic and recorded; a wrong outcome is remedied by correction, not arbitration |
| FR-070 | A player can place any tiles they hold face-up in front of their seat as an exposure | Must | No check of count, composition, or validity (`NR-006`) |
| FR-071 | Exposures are public: their tiles, their owner, and their order are visible to all seats | Must | |
| FR-072 | A player can retract their own exposure, returning its tiles to their concealed hand | Must | Recorded as a public event; the information already seen is not un-seen |
| FR-073 | A player can exchange a tile they hold for a tile in any exposure on the table | Must | Ownership and existence checked; legality never checked (`NR-007`) |
| FR-074 | A player can never take a tile from another seat's concealed hand | Must | Ownership check; verified by `TC-I02` |
| FR-075 | Every action is attributable to the seat that performed it and is recorded in order | Must | Monotonic table sequence |
| FR-076 | The turn pointer is visible to all four seats at all times | Must | |
| FR-077 | No action other than a wall draw is gated by the turn pointer | Must | `10 §4` |

### 4.5 F-05 — Tile passing

| ID | Requirement | Pri | Acceptance |
|---|---|---|---|
| FR-090 | Any player can open a pass round, specifying a routing from each participating seat to a target seat | Must | Routing chosen by the player; the system does not validate it (`NR-008`) |
| FR-091 | Each participating seat privately selects the tiles it will pass and commits them | Must | Selection is `OWN` until execution |
| FR-092 | The number of tiles a seat has committed is public; their identities are not | Must | Mirrors visibly pushed tiles at a physical table |
| FR-093 | Seats may commit different numbers of tiles, and the system does not object | Must | `NR-008` |
| FR-094 | Tiles move only when every participating seat has committed, and then all at once | Must | Atomic; no seat learns another's tiles early |
| FR-095 | A committed seat can withdraw its commitment before the round executes | Must | |
| FR-096 | Any participating seat can cancel the round before it executes, returning all selections | Must | |
| FR-097 | Received tiles enter the concealed hand at the end of the receiving seat's existing order | Must | The system never reorders the rack (`NR-304`) |
| FR-098 | A pass round has no concept of phase, sequence, repetition, or correctness | Must | `NR-008` |

### 4.6 F-06 — Hand arrangement

| ID | Requirement | Pri | Acceptance |
|---|---|---|---|
| FR-100 | A player can reorder the tiles in their own concealed hand freely | Must | Any position to any position |
| FR-101 | A player's chosen order is preserved across draws, discards, claims, passes, reconnection, and rewind | Must | `TC-A09` order-preservation test |
| FR-102 | A player's chosen order is never disclosed to another seat | Must | `OWN` class (`NR-510`) |
| FR-103 | The system never sorts, groups, aligns, or rearranges a player's tiles | Must | `NR-301` – `NR-306` |
| FR-104 | A player can select one or more of their own tiles, and the selection is private | Must | Used by exposure, discard, and pass commitment |
| FR-105 | Rearranging and selecting are free acts: no server round trip is required for the visual result | Must | The order is persisted, but the interaction is not blocked on it (`NFR-002`) |

### 4.7 F-07 — Game conclusion

| ID | Requirement | Pri | Acceptance |
|---|---|---|---|
| FR-110 | A player can declare Mahjong, which is recorded as an action taken by that player | Must | No evaluation of correctness (`NR-003`) |
| FR-111 | A declaring player can choose to reveal their concealed hand to the table | Must | Voluntary; a declaration without reveal is permitted |
| FR-112 | Each other seat can respond to a declaration with acceptance or dispute | Must | Silence is not a response |
| FR-113 | If all three other seats accept, the game concludes with a neutral recorded outcome | Must | Outcome names the declaring seat and the fact of acceptance; no score, value, or justification (`NR-013`) |
| FR-114 | If any seat disputes, the game does not conclude and the table returns to play | Must | The dispute is recorded as a fact |
| FR-115 | A declaring player can withdraw an undecided declaration | Should | |
| FR-116 | Any player can propose ending the game without a declaration; unanimous agreement ends it | Must | Records that the players ended the game |
| FR-117 | A concluded game leaves the table intact so the same four players can play again | Must | Seats retained; a new game returns the table to `IDLE` |
| FR-118 | Concluding a game purges all concealed material for that game from durable storage | Must | `NR-507`, verified by `TC-P04` |

### 4.8 F-08 — Correction

| ID | Requirement | Pri | Acceptance |
|---|---|---|---|
| FR-120 | Any seat can propose rewinding the table to an earlier point within the correction window | Must | Window defined in `05 §8` |
| FR-121 | A rewind takes effect only if all three other seats accept | Must | Any rejection or timeout ends the proposal |
| FR-122 | A rewind restores complete table state — hands, wall, discards, exposures, turn pointer — as it was | Must | From an encrypted checkpoint |
| FR-123 | A rewind that crosses a wall draw reshuffles the undrawn remainder of the wall and publishes a new commitment | Must | `ADR-0016`; neutralizes the only real information leak |
| FR-124 | A rewind cannot cross a deal boundary or leave the current game | Must | |
| FR-125 | The occurrence of a rewind is public and permanently recorded | Must | Present in the public event log |
| FR-126 | The system never proposes, recommends, or initiates a rewind | Must | `NR-210` |
| FR-127 | Only one correction proposal can be open at a time | Must | |

### 4.9 F-09 — Table communication

| ID | Requirement | Pri | Acceptance |
|---|---|---|---|
| FR-130 | A player can send a short text message to the other three seats | Must | Delivered over the existing table connection |
| FR-131 | Table messages are never persisted, logged, snapshotted, or included in any export | Must | `TC-P03`, `TC-P04` |
| FR-132 | Table messages are dropped entirely when the table closes | Must | |
| FR-133 | A player can send a small set of non-verbal signals to the table | Should | Knock, wait, acknowledge |
| FR-134 | Message length is capped and message rate is limited | Must | `18 §6` |
| FR-135 | Messages are delivered only to the four bound seats | Must | `NR-402` |

### 4.10 F-10 — Presence and recovery

| ID | Requirement | Pri | Acceptance |
|---|---|---|---|
| FR-140 | Each seat's connection state is public to the table | Must | Connected, away, or absent |
| FR-141 | A lost connection is detected within a bounded interval | Must | `NFR-020` |
| FR-142 | When a seat becomes absent during a game, the table pauses automatically | Must | Public, with the reason stated |
| FR-143 | A player can reconnect to the seat they left and resume play | Must | Identity re-established from the session, never from a client claim |
| FR-144 | Reconnection restores complete seat state including the private rack order | Must | |
| FR-145 | A reconnecting client that has missed events receives them in order, or a full snapshot if it has fallen too far behind | Must | `12 §8` |
| FR-146 | The table resumes automatically when the absent seat returns | Must | |
| FR-147 | The three present seats can unanimously abandon a game whose fourth seat has not returned | Must | Recorded neutrally; concealed material purged |
| FR-148 | The system never plays on behalf of an absent seat | Must | `NR-202` |
| FR-149 | An in-progress table survives a server restart | Must | Restored from the latest checkpoint (`TC-F01`) |
| FR-150 | At most one live connection exists per seat; a newer authenticated binding replaces an older one | Must | The displaced connection closes with a documented code |

### 4.11 F-11 — Administration

| ID | Requirement | Pri | Acceptance |
|---|---|---|---|
| FR-160 | An administrator can list, disable, and re-enable accounts | Must | |
| FR-161 | An administrator can force-close a table | Must | Concealed material purged; participants notified |
| FR-162 | An administrator can view system health and operational metrics | Must | No metric carries player-identifying or tile data (`NR-505`) |
| FR-163 | An administrator can review the security audit log | Must | Authentication and administrative events only |
| FR-164 | An administrator has no interface, endpoint, or capability that reveals a concealed hand | Must | `NR-406`, verified by `TC-P02` |
| FR-165 | An administrator cannot occupy a seat, act at a table, or alter game state other than by closing a table | Must | |
| FR-166 | Every administrative action is recorded with actor, target, time, and reason | Must | |
| FR-167 | An administrator must satisfy a second factor before any administrative action | Must | `SEC-007`, `SEC-087`–`SEC-089`; TOTP, `ADR-0017` |

---

## 5. Requirements of absence

The negative requirements in [SCOPE_BOUNDARIES.md §4](../SCOPE_BOUNDARIES.md) are part of this
catalog and carry equal weight. They are maintained there rather than duplicated here so that there
is exactly one authoritative list.

---

## 6. Non-functional requirements

Every row carries a measurement method. Depth and justification for the performance figures are in
[23_Performance_Requirements.md](23_Performance_Requirements.md).

### 6.1 Responsiveness

| ID | Requirement | Target | Measured as |
|---|---|---|---|
| NFR-001 | A free act produces a visual response without perceptible delay | First paint ≤ 50 ms; sustained 60 fps during a drag | Client performance trace on the reference device profile; `TC-PF01` |
| NFR-002 | A free act is never blocked on the network | 0 network round trips before the visual result | Code path assertion; `TC-PF02` |
| NFR-003 | A binding act shows local pending feedback immediately | ≤ 50 ms from pointer release | Client trace |
| NFR-004 | A binding act is acknowledged by the server promptly | p95 ≤ 150 ms, p99 ≤ 300 ms, same region | Server-side span from frame receipt to acknowledgement, plus synthetic client measurement |
| NFR-005 | A table event reaches all four clients promptly | p95 ≤ 250 ms from server decision to last client render, same region | Four-client synthetic table in the load harness |
| NFR-006 | Command processing in `dealer-core` is negligible against network time | p95 ≤ 5 ms, excluding I/O | Microbenchmark in CI on a fixed runner |
| NFR-007 | A full shuffle, deal, and four seat projections complete quickly | p95 ≤ 20 ms server-side | Same |
| NFR-008 | Reconnection restores a playable seat quickly | p95 ≤ 2 s from socket open to first usable seat view | Synthetic reconnect in the E2E suite |

### 6.2 Privacy

| ID | Requirement | Target | Measured as |
|---|---|---|---|
| NFR-010 | No concealed tile face reaches a seat other than its owner | Zero occurrences | Full-game frame inspection over randomized play; `TC-P01` |
| NFR-011 | No concealed tile face, wall order, or salt appears in any log, metric, trace, or crash report | Zero occurrences | Log scanner over a complete captured game, plus a planted-signature control; `TC-P03` |
| NFR-012 | Concealed material at rest is encrypted at the application layer | 100% of checkpoint private regions | Storage inspection; `TC-P04` |
| NFR-013 | Concealed material does not outlive its game | Purged within 60 s of game close | Storage inspection after close; `TC-P04` |
| NFR-014 | A leak of concealed data through the logger is impossible to write | Compile error | Type-level proof file with counted assertions; `TC-P06` |

### 6.3 Integrity

| ID | Requirement | Target | Measured as |
|---|---|---|---|
| NFR-020 | A dead connection is detected quickly | ≤ 35 s worst case | Heartbeat interval and miss tolerance; `TC-F02` |
| NFR-021 | A duplicate command is applied at most once | 100% | Idempotency suite with deliberate replays; `TC-I04` |
| NFR-022 | Out-of-order or gapped commands are detected, never applied | 100% | Sequencing suite; `TC-I05` |
| NFR-023 | Malformed commands are rejected without affecting state | 100% | Schema fuzzing; `TC-I06` |
| NFR-024 | The tile conservation invariant holds after every action | 100% | Property test over randomized play; `TC-M01` |
| NFR-025 | The shuffle is statistically indistinguishable from uniform | No significant deviation at α = 0.001 over 100 000 shuffles | Chi-squared over face-by-position frequency; `TC-R03` |
| NFR-026 | Session revocation kills a live socket promptly | ≤ 5 s | Revocation suite; `TC-S03` |

### 6.4 Availability and recovery

| ID | Requirement | Target | Measured as |
|---|---|---|---|
| NFR-030 | An in-progress table survives an unclean server restart | 100% of tables restored to their last checkpoint | Kill-and-restore test; `TC-F01` |
| NFR-031 | At most one public action is lost to an unclean restart | ≤ 1 action | Checkpoint boundary definition; `TC-F01` |
| NFR-032 | A checkpoint write is off the critical path | 0 ms added to acknowledgement latency at p95 | Latency comparison with checkpointing disabled |

### 6.5 Security

| ID | Requirement | Target | Measured as |
|---|---|---|---|
| NFR-040 | All transport is encrypted | 100%; HSTS enabled | Configuration audit |
| NFR-041 | Authentication secrets are stored using a memory-hard function with a server-side pepper | 100% | Code and configuration audit |
| NFR-042 | No endpoint or frame accepts a client-supplied seat or player identifier | Zero such parameters | Interface audit; `TC-I01` |
| NFR-043 | Authentication, table, and message operations are rate limited | Per the table in `15 §7` | Rate-limit suite; `TC-S04` |
| NFR-044 | A production deployment refuses to start without its required secrets | 100% | Startup test with each secret removed |

### 6.6 Accessibility

| ID | Requirement | Target | Measured as |
|---|---|---|---|
| NFR-050 | Every action available by pointer is available by keyboard | 100% of commands | Keyboard-only traversal of the E2E scenarios; `TC-X01` |
| NFR-051 | Text and essential UI meet WCAG 2.2 AA contrast | 100% | Automated audit plus manual check of tile faces on the table surface |
| NFR-052 | The interface is usable at 200% zoom without loss of function | 100% | Manual and automated viewport tests |
| NFR-053 | Motion respects the reduced-motion preference | 100% of animations | Client audit; `TC-X02` |

### 6.7 Maintainability

| ID | Requirement | Target | Measured as |
|---|---|---|---|
| NFR-060 | `dealer-core` contains no I/O, clock, randomness, or environment access | Zero occurrences | Lint rule failing the build |
| NFR-061 | Package dependency direction is enforced, not merely intended | Zero violations | Lint rule |
| NFR-062 | Exactly one function produces client-bound payloads | Exactly one | CI check; `TC-P07` |
| NFR-063 | The documented wire catalog and the implemented protocol agree | Zero drift | CI catalog diff; `TC-P08` |

---

## 7. Acceptance criteria

These are end-to-end statements of done for the areas an implementation is judged on. Each is
written so it can be executed as a scenario.

| ID | Area | Criterion |
|---|---|---|
| AC-001 | Registration and login | A new visitor registers, logs in, logs out, and logs in again. A wrong password yields a response indistinguishable from a nonexistent account. Six rapid failures produce a lock that survives a server restart. |
| AC-002 | Four-player table | A host creates a table and receives a six-character code. Three others join with it. The table shows four occupied seats to all four clients within the propagation budget. A fifth attempt to join is refused. |
| AC-003 | Table joining | An incorrect code and a nonexistent code produce identical responses. A player already seated elsewhere cannot take a second seat. |
| AC-004 | Ready state | Each of the four marks ready; readiness is visible to all. Withdrawal is visible to all. `start_deal` is refused until all four are ready and rejected for a fifth time after dealing begins. |
| AC-005 | Shuffle | Over 100 000 shuffles no face-by-position frequency deviates significantly from uniform. No client input path reaches the shuffle. Two shuffles with identical inputs differ. In a test build with an injected seed, two shuffles are identical. |
| AC-006 | Deal | Each seat receives its configured count. Frame inspection over the entire deal shows no seat receiving another's tiles, the wall order, or the salt. All four seats receive the same commitment value. The conservation invariant holds. |
| AC-007 | Draw | Only the seat at the turn pointer can draw. A draw by any other seat is rejected with `NOT_YOUR_TURN`. The drawn tile appears only in the drawing seat's view; the other three see the wall count decrease and nothing else. |
| AC-008 | Discard | A player discards a tile they hold; it becomes public in order to all four seats. A discard of a tile they do not hold is rejected with `NOT_YOUR_TILE`. No discard is ever rejected for being illegal under any rule. |
| AC-009 | Tile movement | A player reorders their rack with no network round trip, and the order survives a discard, a claim, a pass, a full reconnection, and a rewind. No system action ever changes the order. |
| AC-010 | Tile privacy | Across a complete randomized game, every frame sent to every seat is inspected; no concealed face belonging to another seat, no wall order, and no salt appears in any of them. The same holds for every log line, metric, and trace emitted during that game. |
| AC-011 | Turn synchronization | All four clients agree on the turn pointer at every observation point. Claiming the current discard moves the pointer to the claimant and all four clients reflect it within the propagation budget. |
| AC-012 | Disconnect | Killing a client's connection marks that seat absent to the other three within the detection budget and pauses the table. No action proceeds on the absent seat's behalf. |
| AC-013 | Reconnect | The disconnected player reconnects, resumes the same seat, and receives a seat view identical to the authoritative state, including private rack order, within the reconnection budget. The table resumes automatically. |
| AC-014 | Crash recovery | The server is killed uncleanly mid-game and restarted. All four clients reconnect and observe a consistent table no more than one public action behind. |
| AC-015 | Game completion | A player declares Mahjong, optionally reveals, and the other three accept; the game concludes with a neutral outcome carrying no score or justification. A dispute by any seat returns the table to play. Concealed material is purged within the retention budget. |
| AC-016 | Correction | A seat proposes a rewind within the window; the other three accept; state is restored exactly. A single rejection cancels it. A rewind crossing a wall draw reshuffles the remainder and publishes a new commitment. A rewind beyond the window or across a deal is refused. |
| AC-017 | Security | Every attempt to act on a seat other than one's own — by REST, by socket frame, by manipulated identifier — is refused. Attempting to bind to another player's table produces the same response as binding to a nonexistent one. |
| AC-018 | Input integrity | A replayed command applies once. A gapped sequence closes the socket. A stale order-sensitive command is refused with a resynchronization rather than applied. A malformed frame is refused without touching state. |

---

## 8. Design Decisions

| ID | Decision | Rationale |
|---|---|---|
| D-01-01 | Annotate rule-adjacent requirements with the negative requirement that constrains them | The catalog's most likely failure is a reasonable engineer reading a permissive requirement as licence for a rule check. The annotation closes the reading. |
| D-01-02 | Require a measurement method on every non-functional requirement | Without one, a target is unfalsifiable and will be quietly abandoned. |
| D-01-03 | Write acceptance criteria as executable scenarios rather than statements of intent | They become the E2E suite directly, so the specification and the tests cannot drift. |
| D-01-04 | Keep negative requirements in `SCOPE_BOUNDARIES.md` rather than duplicating them here | Two copies of a list become two different lists. |
| D-01-05 | State privacy acceptance in terms of *frame inspection over a whole game* rather than spot checks | A leak is a property of the worst frame, not the average one. |

---

## 9. Alternative Designs

| Alternative | Why rejected |
|---|---|
| User stories instead of numbered requirements | Stories carry intent well and traceability poorly. The traceability matrix needs stable identifiers. |
| Merging functional and non-functional catalogs | They are consumed by different audiences at different times and have different verification shapes. |
| Deferring acceptance criteria to the testing chapter | They are product statements. Placing them beside the requirements keeps them honest and keeps the testing chapter about method. |
| Priorities beyond Must and Should | With a v1 this tightly scoped, finer gradation would be false precision. |

---

## 10. Trade-offs

**A catalog this explicit is more work to amend.** Accepted: the amendment cost is the mechanism
that keeps the specification and the system aligned.

**Latency targets are stated for same-region play.** Accepted and stated plainly rather than hidden:
four players on three continents will exceed them, and no client-side design can repair the speed of
light. The design fails gracefully — free acts stay instant regardless.

**Requiring keyboard parity for every command constrains the interaction design.** Accepted: a
pointer-only table would exclude players unnecessarily, and the constraint has shaped `11` for the
better by forcing every action to have an unambiguous name and target.

---

## 11. Risks

| Risk | Mitigation |
|---|---|
| A requirement is read as permitting a rule check | `D-01-01` annotations; the validation boundary table in `02 §5` |
| Non-functional targets are treated as aspirations | Every target has a measurement method and a test case identifier |
| The catalog drifts from the implementation | The traceability matrix is regenerated and checked as part of the definition of done |
| Acceptance criteria are satisfied narrowly rather than genuinely | They are written as whole-game scenarios, not unit assertions |

---

## 12. Future Considerations

Deferred, with no commitment: session listing and revocation for players (`FR-008` is `Could`);
richer non-verbal signals; a per-table preference for the opening deal counts; internationalization
of the interface.

---

## 13. Cross References

| Document | Focus |
|---|---|
| `00_Project_Overview.md` | Objectives and constraints these requirements serve |
| `SCOPE_BOUNDARIES.md` | The negative requirements this catalog incorporates |
| `02_System_Scope.md` | The validation boundary that governs how these are implemented |
| `23_Performance_Requirements.md` | Justification for every latency figure above |
| `25_Testing_Strategy.md` | How the acceptance criteria become suites |
| `REQUIREMENTS_TRACEABILITY_MATRIX.md` | Where each identifier is traced to design and test |

---

## 14. Revision History

| Version | Date | Author | Changes |
|---|---|---|---|
| 0.1 | 2026-09-02 | Design (architect role), owner-approved | Initial catalog: 96 functional, 34 non-functional, 18 acceptance criteria |
| 0.2 | 2026-09-03 | Design (architect role), owner-approved | Added `FR-167` (administrator second factor, `ADR-0017`), within `F-11`'s already-reserved range |
