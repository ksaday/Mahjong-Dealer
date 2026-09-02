# Privacy and Absence Suites

| | |
|---|---|
| **Project** | American Mahjong Dealer |
| **Document** | 34_Testing/Privacy_and_Absence_Suites.md |
| **Status** | Normative — zero-tolerance gates. Ch. 25 and Ch. 26 remain authoritative |
| **Last Updated** | 2026-09-02 |
| **Role in SSOT** | Owns the `TC-P*` and `TC-A*` specifications. Does **not** own the strategy (`25`), the harnesses (`26`), or the requirements being checked (`14`, `SCOPE_BOUNDARIES.md`). |

---

## 1. Why these are separate and zero-tolerance

A privacy leak or a forbidden capability is not a bug to be triaged and scheduled. It is a violation
of what the product claims to be. Both suites run as their own pipeline stage (`25 §7`) so that a
failure is unambiguous and so that shipping "with two known privacy failures" is not an available
option.

The absence suite is the unusual one. Most test suites verify that something works; this one verifies
that something **does not exist**. That is only possible because every negative requirement in
`SCOPE_BOUNDARIES.md §4` is phrased as a checkable condition — which is itself a design decision
(`ADR-0002`).

---

## 2. Privacy suite — `TC-P*`

### TC-P01 — Frame inspection

**The most important test in the system.**

| Aspect | Specification |
|---|---|
| Method | The generator (`26 §6`) plays complete randomized games through the TableHarness; the FrameInspector captures every frame to every seat |
| Coverage | Live frames, backlog frames on resumption, and full snapshots |
| Volume | ≥ 1000 games per run, each to conclusion |
| Asserts | No frame to seat X contains any concealed face belonging to a seat other than X |
| Asserts | No frame contains any wall order, in whole or in part |
| Asserts | No frame contains the commitment salt |
| Asserts | No frame contains another seat's rack order or selection |
| Asserts | Every field present is classified in `19 §6`, with a class permitting that recipient |
| **Unknown field** | **Fails.** Not ignored, not warned (`D-26-02`) |
| Failure output | Frame, seat, field path, `seq`, and the reproducing seed |

The unknown-field rule is what gives this test its value. If an unrecognized field were ignored, the
suite would verify only fields somebody had already considered — and the leak that matters is always
the field nobody considered.

### TC-P02 — REST and administrative surface

| Asserts |
|---|
| No REST response body contains a tile face, a hand, wall information, or the salt |
| **Every administrative endpoint** is included, with an administrator session |
| No route matching a state, hand, watch, or replay pattern is registered (`33_API/REST_Endpoint_Catalog.md §6`) |
| No development or debug endpoint is reachable in a production build |

Administrative endpoints are tested explicitly rather than assumed, because `NR-406` is the negative
requirement most likely to be eroded by a support request.

### TC-P03 — Log, metric, and trace scanning

| Aspect | Specification |
|---|---|
| Method | Capture the complete log, metric, and trace output of a full game, then scan |
| Searches | The `face#copy` pattern (`07 §5.2`); known private field names; base64 blobs of checkpoint size |
| **Planted control** | A deliberate violation the scanner **must** detect |
| **Honest control** | A line resembling a violation that it **must not** flag |
| Also asserts | No metric label contains a tile face, account identifier, or table identifier |
| Also asserts | Table chat text appears in no log line |
| Also asserts | No error report payload contains state |

Both controls run on every invocation. A scanner that has never fired is indistinguishable from one
that is broken, misconfigured, or scanning the wrong file; one that flags everything gets disabled
(`D-20-05`).

### TC-P04 — Storage inspection

| Asserts |
|---|
| `checkpoints.private_state` and `correction_checkpoints.private_state` are ciphertext — no plaintext face pattern |
| No `game_events.payload` contains a tile face that was not public at the time (`16 §6.1`) |
| After game conclusion, no checkpoint row exists for that game, within 60 s (`NFR-013`) |
| After table closure, the same |
| No table exists whose schema contains a column matching a concealed-data pattern outside the two encrypted columns |
| The `app` role has no `SELECT` grant on either `private_state` column (`17 §7.2`) |
| A restored backup contains no concealed material for any concluded game |

The last row tests a privacy property **through the backup path**, which is the surface most likely to
retain material the live system has purged (`29 §6.1`).

### TC-P05 — Egress and client surface

| Asserts |
|---|
| No outbound network request from the server carries game data |
| No third-party script is loaded by the client |
| The production client bundle contains no server state and no source map |
| No concealed material is written to `localStorage`, `sessionStorage`, or IndexedDB |
| No analytics or telemetry call is present in the game path |

### TC-P06 — Type-level proof

| Aspect | Specification |
|---|---|
| Method | A file of deliberate type errors asserting `NoConcealed<T>` rejects each forbidden shape |
| Shapes | A hand; a wall order; a salt; a `TileFace`; an object containing any; an array of any; a deeply nested occurrence |
| **Assertion count** | **Compared against an expected number** |
| Failure | Either the file compiles where it should not, or the count differs |

The count comparison is essential (`D-25-05`). Without it, a change making `NoConcealed<T>`
permissive would let the proof file compile cleanly — and a silently-satisfied proof looks exactly
like a passing test.

### TC-P07 — Single serializer

| Asserts |
|---|
| Exactly one function in the codebase produces a client-bound payload |
| No other code path calls a socket write with anything but that function's output type |
| The projector's parameter list includes a seat |
| Live, backlog, and snapshot paths all call it |

### TC-P08 — Catalog agreement

| Asserts |
|---|
| Every command, frame type, event, rejection code, close code, and notice kind in `19` exists in `shared` |
| Every such name in `shared` appears in `19` — **both directions** |
| Every identifier matches its category's naming convention (`19 §3`) |
| No identifier matches the forbidden-vocabulary list (`19 §3.1`, `19 §8`) |
| Exactly one field named `seq` exists across the frame types |
| Every field in the projector's output type appears in `19 §6` with a visibility class |

Bidirectionality matters: a one-way check would let the implementation grow names the documentation
never mentions.

---

## 3. Absence suite — `TC-A*`

### TC-A01 — No rules

| Asserts |
|---|
| No module, file, or directory name matches a rule-concept pattern |
| No exported symbol matches a rule-concept pattern |
| No dependency in the manifest or lockfile is a Mahjong rules library |
| No data file contains hand-pattern, card, or winning-hand data |
| **No test file asserts rule correctness** (`25 §3`) |
| No identifier in the protocol matches the forbidden vocabulary (`19 §8`) |

### TC-A02 — No win determination or scoring

| Asserts |
|---|
| No function returns a boolean or score from a hand |
| No symbol matching a win, score, value, or evaluation pattern exists |
| `GameConcluded` carries no score, value, or justification field |
| `games` has no score, value, or delta column |

### TC-A03 — Command-path audit

**The sharpest check in either suite.**

| Aspect | Specification |
|---|---|
| Method | Control-flow analysis from each command handler through the reachable call graph |
| Asserts | **No branch has a condition depending on which face a tile carries** |
| Permitted | Branching on whether a tile is *present*, on ownership, on location, on count |
| Allow-list | Explicit, with a **written justification per entry**, reviewed as an amendment |

Every Mahjong rule must eventually ask what a tile is. A rule check therefore requires a
face-dependent branch reachable from a handler, and this is the narrowest point at which to catch
it (`D-06-04`).

The allow-list will have entries, and that is expected. Recording why a branch is legitimate is
better than tuning the check until it passes (`D-26-07`).

### TC-A04 — Rule-violating play succeeds

The positive form of the absence contract, and the most direct expression of what the product is.

| Method | Play a complete game of deliberately rule-violating but mechanically valid actions |
|---|---|
| Includes | Hand sizes from 4 to 40; single-tile exposures; exposures of 9 tiles; unequal pass counts; a two-seat pass round; discarding without drawing; discarding out of turn; claiming one's own discard; swapping a non-joker for a non-joker; declaring Mahjong with 3 tiles |
| Asserts | **Every action succeeds** |
| Asserts | The conservation invariant holds throughout |
| Asserts | No rejection carries a rule-based code |

### TC-A05 — Configuration surface

| Asserts |
|---|
| The table setup surface admits exactly the three values in `05 §7` |
| No configuration schema field could express a rule, priority, pattern, or legality condition |
| No configuration is loaded from a file, environment variable, or database at game time |

### TC-A06 — No economy

| Asserts |
|---|
| No schema column, table, enum, index, or constraint matches an economic vocabulary pattern |
| No route matches an economic pattern (`33_API/REST_Endpoint_Catalog.md §6`) |
| No protocol identifier matches an economic pattern (`19 §8`) |
| No exported symbol matches an economic pattern |
| No dependency is a payment or ledger library |

### TC-A07 — No assistance

| Asserts |
|---|
| No symbol matching a suggest, hint, recommend, solve, evaluate, analyze, or probability pattern |
| No client component computes anything from more than one tile of a hand |
| No dependency is a solver, search, or machine-learning library |

The middle assertion is the operative one: a hint requires reasoning across tiles, so a component
that only ever handles one tile at a time cannot produce one.

### TC-A08 — No automatic binding actions

| Asserts |
|---|
| No timer, interval, or scheduled task invokes a state-changing command |
| Every timeout in the system resolves as a **refusal**, never an acceptance |
| Specifically: correction timeout rejects; pass-round timeout cancels and returns tiles; declarations have **no** timeout |
| No default response is submitted on any seat's behalf |

### TC-A09 — Order preservation

| Aspect | Specification |
|---|---|
| Method | Randomized games; capture each seat's rack order after every event |
| Asserts | The order changes **only** as a result of that seat's own `arrange_hand` |
| Covers | Draw, discard, claim, expose, retract, swap, pass execution, reconnection, snapshot, **and rewind** |
| Asserts | Arriving tiles append at the end (`FR-097`) |
| Asserts | Gaps are preserved |
| Asserts | No symbol matching a sort, group, or arrange pattern exists in the client or core |

Rewind is included because it is the transition most likely to reorder a hand as a side effect of
restoration.

### TC-A10 — No observers

| Asserts |
|---|
| The role enumeration contains exactly `player` and `administrator` |
| No route matching a spectate, observe, or watch pattern is registered |
| **No frame is delivered to a connection not bound to a seat at that table** |
| A socket that binds and then has its seat vacated receives nothing further |

### TC-A11 — No replay

| Asserts |
|---|
| No route, symbol, or file matching a replay or export pattern |
| No stored artifact permits reconstructing a concealed hand: given the public event log plus all durable rows for a concluded game, no hand is derivable |
| No checkpoint survives game conclusion |

The middle assertion is the substantive one and is checked constructively: the test attempts the
reconstruction and asserts it fails for lack of the wall order and the private faces.

---

## 4. Suite properties

| Property | Value |
|---|---|
| Gate stage | T3, its own stage (`25 §7`) |
| Tolerance | **Zero.** No skips, no allowances, no known failures |
| Runtime budget | ≤ 10 minutes for both suites |
| Reproducibility | Every failure reports a seed and a minimal shrunk case |
| Weakening | Requires an amendment and the project owner's approval |

---

## 5. Cross References

`25_Testing_Strategy.md` · `26_Test_Architecture.md` · `SCOPE_BOUNDARIES.md §4` ·
`14_Player_Privacy.md` · `19_WebSocket_Event_Catalog.md §6`, `§8` · `20_Logging_and_Observability.md`

## 6. Revision History

| Version | Date | Author | Changes |
|---|---|---|---|
| 0.1 | 2026-09-02 | Design (architect role) | Initial specification: 8 privacy cases, 11 absence cases |
