# 20 — Logging and Observability

| | |
|---|---|
| **Project** | American Mahjong Dealer |
| **Document** | 20_Logging_and_Observability.md |
| **Status** | Ratified v0.1 — approved by the project owner, 2026-09-02 |
| **Last Updated** | 2026-09-02 |
| **Role in SSOT** | Owns what may and may not be logged, the metric and trace surface, and how a defect is diagnosed without private data. Does **not** own the privacy classification (`14`), error semantics (`21`), or operational procedures (`28`). |

---

## 1. Executive Summary

Observability is where privacy models usually fail, and the failure is always well-intentioned.
Someone debugging a hard problem writes `log.debug('state', state)`. It works, the problem is
solved, and the line survives review because it is obviously temporary. Months later it is running
in production, writing concealed hands into a log aggregator retained for ninety days and readable
by anyone with operations access.

The values this system most needs to hide — a concealed hand, the wall order — are exactly the values
a developer most wants to see when something is wrong. Any control that depends on a developer
choosing well at that moment will fail.

So the primary control is **not a policy**. It is a type: every logging, metrics, and tracing entry
point accepts `NoConcealed<T>`, and `log.debug('state', gameState)` does not compile
(`ADR-0013`). Two backstops sit behind it — a runtime redactor and a CI scanner proven against a
planted violation.

Because that closes off the obvious debugging technique, `§6` owes developers a workable alternative,
and provides one: identifiers to correlate, shapes and counts instead of contents, and a
deterministic core that reproduces any mechanical defect from a unit test without a real game.

---

## 2. Objectives

Serves `OBJ-06` — no concealed material in any log, metric, trace, or crash report (`NFR-011`) —
while keeping the system genuinely diagnosable.

---

## 3. Three layers

| Layer | Mechanism | Fails at | Catches |
|---|---|---|---|
| **Types** | `NoConcealed<T>` on every sink | Compile time | Static call sites passing branded values |
| **Redaction** | Pattern and field-name stripping at the logging boundary | Runtime | Values assembled dynamically that the types could not see |
| **Scanning** | CI scanner over real captured output | Build time | Anything that reached output regardless of how |

Each covers the previous layer's blind spot. Types cannot see a string built at runtime. Redaction
cannot recognize a shape it was not told about. A scanner sees only what was actually emitted. A leak
must defeat all three.

### 3.1 Redaction as a detector

A redaction event is **itself logged as an anomaly**. If redaction fires in production, a code path
is passing concealed material to a logger, and that is a defect report rather than a success. The
backstop doubles as a tripwire.

---

## 4. What may be logged

| Category | Examples |
|---|---|
| Identifiers | `tableId`, `gameId`, `cmdId`, `seq`, `sessionId`, `accountId` |
| Structural facts | Command name, event type, seat position, rejection code |
| Counts and shapes | Hand size, wall remaining, discard count, number of exposures |
| Timings | Processing duration, queue depth, round-trip latency |
| Lifecycle | Actor start and stop, checkpoint written, purge completed |
| Connection | Bind, resume, close code, heartbeat misses, backpressure |
| Security | Authentication attempts, lockouts, rate-limit hits, administrative actions |
| Errors | Code, message, stack, correlation identifier |

Note that seat *position* is loggable while a seat's *contents* are not. Knowing that East discarded
at sequence 41 is operationally useful and reveals nothing beyond what all four seats saw.

## 5. What must never be logged

| Never | Class |
|---|---|
| Any concealed tile face | Concealed |
| Any tile face at all, from any location | Concealed by default — see `§5.1` |
| The wall order, in whole or part | Concealed |
| The commitment salt | Concealed |
| A rack order or gap layout | Concealed |
| A selection or pass commitment | Concealed |
| Table chat text | Ephemeral (`FR-131`) |
| A password, in any form | Secret |
| A session token, ticket, or join code | Secret |
| An encryption key | Secret |
| An email address in a game-path log | Account |

### 5.1 Why no tile face at all, even a public one

A discarded tile is public: all four seats see it. Logging it would leak nothing to those four.

It is nonetheless forbidden, for two reasons. **The pattern must be unambiguous.** The scanner
searches for the `face#copy` form (`07 §5.2`), and a policy permitting some faces would require the
scanner to distinguish a discarded tile from a held one across an entire log corpus — which it cannot
reliably do. And **the branded type is uniform**: `TileFace` is branded wherever it appears, so
permitting public faces would require unbranding at the discard boundary, creating exactly the seam a
mistake would slip through.

A blanket prohibition costs almost nothing — a discard is loggable as `seat=east discardIndex=7`,
which is what diagnosis actually needs — and buys an unambiguous rule that a machine can enforce.

---

## 6. How to debug without private data

The obligation `§5` creates. These are the techniques, in the order to reach for them.

### 6.1 Reproduce in the core

`dealer-core` is pure and deterministic (`03 §5`). Any mechanical defect — a tile in the wrong place,
a broken invariant, an incorrect turn transition — reproduces from a constructed state and a command,
in a unit test, with no server, no database, and no real game. **This is the primary technique, and it
is usually sufficient**, because mechanical defects are where mechanical bugs live.

### 6.2 Correlate by identifier

Every command carries `cmdId`; every event carries `seq`. A report of "my discard did not work"
resolves to a `cmdId`, which resolves to a rejection code and a sequence, which resolves to the
surrounding public events. That chain answers *what happened* without any contents.

### 6.3 Read the public event log

The retained log records the ordered sequence of public actions (`16 §6`). For "the table got into a
strange state," the sequence of actions is usually the whole answer.

### 6.4 Log shapes, not contents

| Instead of | Log |
|---|---|
| The hand | `handSize=13` |
| The wall | `wallRemaining=42` |
| The tile | `seat=east` and the action |
| The pass commitment | `count=3` |
| The rack order | `handSize=13 gaps=2` |

### 6.5 In development only

A build-time flag enables verbose state logging, and it is **compiled out of production builds** with
a startup assertion that the path is unreachable (`§8`). A development-only capability that merely is
not called is one an attacker can try to call.

---

## 7. The scanner

| Aspect | Design |
|---|---|
| Runs | In CI, over the complete log, metric, and trace output of a full captured game |
| Searches | The `face#copy` pattern; known private field names; base64-shaped blobs of checkpoint size |
| Planted control | A deliberate violation the scanner **must** detect |
| Honest control | A line resembling a violation that it **must not** flag |
| Failure | Build fails; zero tolerance (`TC-P03`) |

### 7.1 Why both controls

A scanner that has never fired is indistinguishable from one that is broken, misconfigured, or
scanning the wrong file. The planted violation proves it still detects. The honest line proves it has
not been made so broad that it flags everything and will be ignored.

Requiring both on every run is what makes the scanner evidence rather than decoration.

---

## 8. Metrics and traces

| Metric | Type | Labels |
|---|---|---|
| Commands processed | counter | `cmd`, `outcome` |
| Command duration | histogram | `cmd` |
| Rejections | counter | `code` |
| Live tables | gauge | — |
| Live connections | gauge | — |
| Events emitted | counter | `type` |
| Checkpoint write duration | histogram | — |
| Checkpoint failures | counter | — |
| Purge completions and failures | counter | — |
| Conservation violations | counter | — |
| Bind attempts | counter | `outcome` |
| Heartbeat misses | counter | — |
| Backpressure closes | counter | — |
| Rate-limit hits | counter | `scope` |
| Authentication attempts | counter | `outcome` |
| Resumption mode | counter | `backlog` \| `snapshot` |

**No metric label carries a tile face, a hand, a table identifier, or an account identifier.** Beyond
privacy, identifiers as labels would produce unbounded cardinality — a metrics system's own failure
mode — so the two concerns agree.

Traces span the request or command lifecycle with the same type guard on span attributes. A trace
records that `discard_tile` took 3ms and was accepted, never which tile.

### 8.1 Alerts

| Condition | Severity |
|---|---|
| **Conservation violation** | Critical — indicates corrupt state |
| **Redaction fired in production** | Critical — a code path is leaking |
| Checkpoint write failures rising | High — recovery is degrading |
| Purge failure | High — concealed material is being retained |
| Command rejection rate abnormal | Medium |
| Authentication failure rate abnormal | Medium |
| Backpressure closes rising | Medium |

The first two are the distinctive ones, and both are privacy alerts rather than availability alerts.

---

## 9. Error reporting

Crash and error reports carry **identifiers and structure only**: error code, message, stack,
`cmdId`, `tableId`, `seq`, build version, and a correlation identifier.

They never carry state. The reporting interface takes no state parameter, so attaching a game state
to a report is not something a developer can do under pressure and regret later (`21 §6`).

---

## 10. Retention

| Data | Retention |
|---|---|
| Application logs | 30 days |
| Security and audit logs | 2 years (`17 §5.11`) |
| Metrics | 13 months, downsampled |
| Traces | 7 days |
| Error reports | 90 days |

Log retention is deliberately shorter than audit retention: application logs are for diagnosis over
days, and a longer window is exposure without benefit.

---

## 11. Design Decisions

| ID | Decision | Rationale |
|---|---|---|
| D-20-01 | Type-level prohibition as the primary control | The leak happens at the moment a developer most wants the data; a control depending on their judgment then will fail. |
| D-20-02 | Three layers failing at three different times | Types cannot see dynamic construction; redaction cannot see unknown shapes; a scanner sees only real output. |
| D-20-03 | A redaction event is itself an anomaly alert | Turns the backstop into a tripwire. |
| D-20-04 | No tile face logged, even a public one | Keeps the scanner pattern unambiguous and the brand uniform; costs nothing diagnostically. |
| D-20-05 | Both a planted and an honest control on every scanner run | A never-firing scanner is indistinguishable from a broken one; an over-broad one gets ignored. |
| D-20-06 | Provide the debugging alternatives explicitly | A prohibition without an alternative gets circumvented. |
| D-20-07 | Verbose logging compiled out of production | A path that is merely not called can be called. |
| D-20-08 | No identifiers as metric labels | Privacy and cardinality agree. |
| D-20-09 | The error reporter takes no state parameter | Removes the possibility rather than the temptation. |
| D-20-10 | Conservation violations and production redactions are critical alerts | Both indicate the system is wrong in a way that continuing would compound. |

---

## 12. Alternative Designs

| Alternative | Why rejected |
|---|---|
| Policy and code review only | Fails for the reason in `§1`; the violating line looks like diligence. |
| Redaction as the primary control | A filter: default-emit, and blind to shapes it was not told about. |
| A separate secured log for private data | A second concealed-material store with its own access control and retention — the thing the design exists to avoid (`16 §10`). |
| Permitting public tile faces in logs | Makes the scanner pattern ambiguous and requires unbranding at a boundary. |
| Sampling logs to reduce exposure | Reduces the probability of a leak rather than preventing it. |
| Structured state dumps behind an operator role | An administrative path to concealed material (`NR-406`). |

---

## 13. Trade-offs

**Developers cannot log the values they most want to see.** Accepted, with `§6` as the compensation:
in practice the deterministic core makes mechanical defects reproducible without a real game, which
is a better technique than reading a log anyway.

**Three layers means three things to maintain.** Accepted: two are essentially static, and the
scanner's maintenance is tuning its patterns.

**Blanket face prohibition is stricter than privacy requires.** Accepted deliberately: an
unambiguous rule a machine can enforce beats a nuanced one it cannot.

**Short log retention limits historical analysis.** Accepted: security and audit data is retained
much longer, and application logs older than a month are rarely diagnostic.

---

## 14. Risks

| Risk | Mitigation |
|---|---|
| A debug line leaks a hand | Compile error; redactor; scanner (`§3`) |
| The scanner is silently broken | Planted control must fire on every run (`§7.1`) |
| The types are weakened | Proof file with counted assertions (`TC-P06`) |
| Verbose logging reaches production | Compiled out; startup assertion; `TC-P02` |
| An identifier is added as a metric label | Cardinality alert; metric definitions reviewed |
| An error report gains a state attachment | The reporter's signature accepts none |

---

## 15. Future Considerations

Not committed: a synthetic table that continuously exercises the system in production so behaviour is
observable without touching a real game; a privacy dashboard tracking redaction events and scanner
results over time.

---

## 16. Cross References

| Document | Focus |
|---|---|
| `14_Player_Privacy.md §6` | The branded types and the guard |
| `07_Tile_Model.md §5.2` | The `face#copy` pattern the scanner searches for |
| `21_Error_Handling_and_Recovery.md` | Error taxonomy and reporting |
| `16_Data_Architecture.md §6` | The public event log |
| `28_Operations.md` | Alert response |
| `34_Testing/Privacy_and_Absence_Suites.md` | `TC-P03`, `TC-P06` |
| `ADR-0013` | The decision this chapter elaborates |

---

## 17. Revision History

| Version | Date | Author | Changes |
|---|---|---|---|
| 0.1 | 2026-09-02 | Design (architect role), owner-approved | Initial chapter |
