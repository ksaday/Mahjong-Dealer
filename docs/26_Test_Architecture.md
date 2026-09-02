# 26 — Test Architecture

| | |
|---|---|
| **Project** | American Mahjong Dealer |
| **Document** | 26_Test_Architecture.md |
| **Status** | Ratified v0.1 — approved by the project owner, 2026-09-02 |
| **Last Updated** | 2026-09-02 |
| **Role in SSOT** | Owns the test harnesses, fixture design, and the machinery each suite depends on. Does **not** own what is tested (`25`) or the detailed suite specifications (`34_Testing/`). |

---

## 1. Executive Summary

Three harnesses carry almost the entire suite, and each exists because a category of test would
otherwise be impractical.

The **TableHarness** drives four synthetic seats against a real table actor with no network and no
browser. It is what makes complete randomized games cheap enough to run thousands of, which is what
makes the conservation property test and the frame inspection suite possible at all.

The **FrameInspector** captures every frame emitted to every seat and asserts the visibility class of
every field against the catalog in `19 §6`. This is the mechanism behind the privacy suite, and its
design decides whether the suite is meaningful: it must fail on a **field it does not recognize**,
not merely on a field it knows to be private. A new leaking field must fail, and it will only do so
if the default for an unknown field is failure.

The **StaticAuditor** performs the absence checks — symbol scans, dependency scans, command-path
analysis. It is the machinery that makes a negative requirement testable.

The fourth component is the **randomized game generator**, which produces games including
deliberately rule-violating play. It is the fixture strategy for a system with no rules: instead of
scripted scenarios encoding correct play, generated games exercise everything mechanically possible.

---

## 2. Objectives

Serves `OBJ-10` and `OBJ-12` by making every property in `25` executable, and by keeping the
machinery simple enough that a future implementer builds it rather than working around it.

---

## 3. TableHarness

Drives four seats against a real table actor, in process.

| Property | Design |
|---|---|
| Actor | The real one — not a mock |
| Core | The real `dealer-core` |
| Transport | None; commands are submitted directly to the actor's queue |
| Persistence | In-memory adapter by default; a real database when the test needs one |
| Entropy | Injected and seeded, so a run is exactly reproducible |
| Clock | Injected, so timeouts are tested without waiting |
| Output | Every frame the projector produced, per seat, in order |

### 3.1 Interface

```
harness = TableHarness.create({ seed, persistence })
harness.seat('east').send('draw_tile', { end: 'head' })
harness.frames('south')        // every frame South received, in order
harness.state()                // authoritative state, for assertions only
harness.advanceClock(60_000)   // fire timeouts without waiting
harness.crash(); harness.restart()   // recovery testing
```

`harness.state()` reaches into authoritative state deliberately, and only tests may use it. It is
how an assertion distinguishes "the projection is wrong" from "the state is wrong" — a distinction no
test could make from frames alone.

### 3.2 Why no transport

A test of the mechanics should fail for a mechanical reason. Routing through a socket would make
every mechanics test also a test of framing, serialization, and connection state, and a failure would
be ambiguous. The transport has its own suite (`§7`).

### 3.3 Injected clock

Every timeout in the system — the 60-second correction vote, the 10-minute pass round, the 30-second
ticket — is testable in microseconds. A suite that waited would either be slow or would skip the
timeout paths, and timeout paths are where `NR-210` compliance lives (`TC-A08`).

---

## 4. FrameInspector

The privacy suite's mechanism.

| Property | Design |
|---|---|
| Captures | Every frame, to every seat, with the emitting seat recorded |
| Checks | Every field against the visibility catalog in `19 §6` |
| **Unknown field** | **Fails.** Not ignored, not warned |
| Concealed detection | Recognizes the branded shapes and the `face#copy` pattern structurally |
| Cross-seat check | A field classed `OWN` must appear only in frames to its owning seat |
| Reporting | Names the frame, the seat, the field, and the sequence number |

### 4.1 Why an unknown field must fail

This is the design decision that determines whether the suite has value.

If an unrecognized field were ignored, the suite would verify only fields somebody had already
thought about — and the leak that matters is always the field nobody thought about. Failing on
unknown fields means a newly added leaking field fails immediately, and the fix is to classify it in
`19 §6`, which is the review step that would have caught it anyway.

The cost is that adding any field to the projector requires updating `19 §6` first. That is the
amendment process working (`00 §12.3`), not friction to be removed.

### 4.2 Structural detection

Concealed material is recognized by structure — the branded type shape, the `face#copy` form — rather
than by field name. A leak in a field named `debugInfo` is caught exactly as one in a field named
`hand`.

---

## 5. StaticAuditor

The absence suite's mechanism. Static analysis over source, dependencies, and build output.

| Check | Method | Cases |
|---|---|---|
| Forbidden symbols | Identifier scan against the `§8`/`19` and `SCOPE_BOUNDARIES.md` lists | `TC-A01`, `TC-A02`, `TC-A06`, `TC-A07` |
| Forbidden dependencies | Manifest and lockfile scan | `TC-A01` |
| **Command-path audit** | Control-flow analysis: no branch reachable from a command handler has a condition depending on a tile face | `TC-A03` |
| Route inventory | Every registered route against the permitted list | `TC-A10`, `TC-A11` |
| Schema vocabulary | Column and enum names against the forbidden lists | `TC-A06` |
| Serializer count | Exactly one function produces client-bound payloads | `TC-P07` |
| Catalog agreement | `19` names against `shared` protocol definitions, both directions | `TC-P08` |
| Naming law | Every identifier against its category convention | `TC-P08` |
| Purity | No banned import or global in `dealer-core` | `NFR-060` |
| Dependency direction | Package imports against the dependency law | `NFR-061` |

### 5.1 The command-path audit

The sharpest check in the suite and the one worth building carefully.

Every Mahjong rule must eventually ask what a tile is. A rule check therefore requires a branch whose
condition depends on a tile face, somewhere reachable from a command handler. The audit walks the
call graph from each handler and reports any such branch.

It will produce false positives — a legitimate branch on whether a face is *present* rather than
*which* face — and those are handled by an explicit allow-list with a written justification per
entry, reviewed as an amendment. An allow-list with reasons is far better than a check tuned until it
passes.

### 5.2 Honest controls

Every scanner carries both a **planted violation** it must detect and an **honest line** it must not
flag. A scanner that has never fired is indistinguishable from one that is broken; a scanner that
flags everything gets disabled (`20 §7.1`).

---

## 6. The randomized game generator

The fixture strategy for a system with no rules.

| Property | Design |
|---|---|
| Produces | Complete games from deal to conclusion |
| Action selection | Uniform over the mechanically available commands for each seat |
| **Includes rule-violating play** | Unequal passes, single-tile exposures, out-of-turn discards, hand sizes from 4 to 40 |
| Includes edge paths | Pass rounds, corrections with and without reshuffle, disconnections, wall exhaustion |
| Reproducible | Seeded; a failure reports the seed |
| Shrinking | On failure, reduces to a minimal reproducing sequence |

### 6.1 Why generated rather than scripted

Scripted scenarios encode what the author thought of. For a system whose correctness properties are
universal — conservation always holds, no frame ever leaks — generated play covers vastly more of the
space, and the failures it finds are the ones nobody anticipated.

It also avoids the fixture trap in `25 §6`: a generator that selects uniformly over available
commands cannot encode a rule, because it has no concept of one. A scripted "typical game" fixture
would inevitably encode correct play, which is rule data in a test file.

### 6.2 Shrinking

A conservation failure after 300 random actions is nearly useless as a bug report. Shrinking to a
three-action sequence makes it diagnosable. This is the difference between a property test that finds
bugs and one that finds bugs nobody can fix.

---

## 7. Other harnesses

| Harness | Covers | Notes |
|---|---|---|
| **SocketHarness** | Real WebSocket against a real gateway | Binding, sequencing, backpressure, close codes, resumption. Can inject malformed frames, gaps, replays, and slow consumers |
| **PersistenceHarness** | Real database | Checkpoint round trip, encryption, purge verification, constraint enforcement, migration idempotence. Also carries the `TC-S*` cases that need durable state — lockout across a restart, ticket single-use under concurrency |
| **BrowserHarness** | Four real browser contexts, one table | The E2E scenarios, plus keyboard-only traversal and accessibility audit |
| **LoadHarness** | Many synthetic tables | Capacity measurement (`TC-PF05`), the input to the multi-node trigger |

The SocketHarness's ability to inject hostile input is what makes the integrity suite meaningful: a
`cseq` gap and a replayed frame have to be produced deliberately, because a well-behaved client never
produces them.

---

## 8. Layout

```
tests/
  core/          unit and property, no infrastructure          TC-M*
  integrity/     idempotency, sequencing, staleness, hostile   TC-I*
  security/      auth, sessions, isolation, headers, secrets   TC-S*
  randomization/ distribution, isolation, commitment           TC-R*
  privacy/       frame inspection, log scanning, storage       TC-P*
  absence/       static audit                                  TC-A*
  recovery/      crash, reconnect, restore                     TC-F*
  e2e/           four browsers, accessibility                  TC-E*, TC-X*
  performance/   budgets and load                              TC-PF*
  harness/       TableHarness, FrameInspector, StaticAuditor,
                 generator, socket, persistence, browser, load
```

Suites are separated by *gate stage* rather than by feature, so a stage runs a directory. It also
makes the zero-tolerance stages visibly distinct — `privacy/` and `absence/` are their own
directories, and a change to either is conspicuous in review.

---

## 9. Design Decisions

| ID | Decision | Rationale |
|---|---|---|
| D-26-01 | TableHarness uses the real actor and core, with no transport | A mechanics failure should have a mechanical cause; routing through a socket makes every failure ambiguous. |
| D-26-02 | The FrameInspector **fails on unknown fields** | The leak that matters is the field nobody thought about. Ignoring unknowns would verify only what was already considered. |
| D-26-03 | Concealed material detected structurally, not by field name | A leak in `debugInfo` is caught like one in `hand`. |
| D-26-04 | Generated games rather than scripted scenarios | Covers the space; and a generator cannot encode a rule, whereas a "typical game" fixture inevitably would. |
| D-26-05 | Shrinking is required, not optional | A 300-action failure is not a usable bug report. |
| D-26-06 | Injected clock and entropy | Makes every timeout path testable in microseconds, and every run reproducible. |
| D-26-07 | Command-path audit allow-list with written justifications | Better to record why a branch is legitimate than to tune the check until it passes. |
| D-26-08 | Every scanner carries a planted and an honest control | Proves it detects and proves it is not over-broad. |
| D-26-09 | Suites organized by gate stage | A stage runs a directory, and the zero-tolerance directories are conspicuous. |
| D-26-10 | `harness.state()` exposes authoritative state to tests only | Distinguishes a projection defect from a state defect, which frames alone cannot. |

---

## 10. Alternative Designs

| Alternative | Why rejected |
|---|---|
| Mock the core in actor tests | The core is pure and fast; mocking it would test the mock. |
| Route mechanics tests through a socket | Every failure becomes ambiguous. |
| FrameInspector allow-list of private fields | Verifies only fields already considered; the leak is the one nobody considered. |
| Field-name-based leak detection | Defeated by any renaming. |
| Scripted "typical game" fixtures | Encode correct play, which is rule data in a test file (`NR-010`). |
| Property tests without shrinking | Find bugs nobody can diagnose. |
| Real timers in tests | Slow, flaky, and the timeout paths get skipped. |
| Suites organized by feature | Gate stages would span directories, making zero-tolerance changes inconspicuous. |

---

## 11. Trade-offs

**Failing on unknown fields means adding a projected field requires updating `19 §6` first.**
Accepted: that is the amendment process, and it is the review step that catches leaks.

**The command-path audit will need an allow-list.** Accepted, with justifications required per entry.

**Generated games are less readable than scripted ones.** Accepted: shrinking plus the reported seed
makes any failure reproducible and minimal, which is what readability is for.

**Four harnesses are real infrastructure to build and maintain.** Accepted: they are the difference
between a suite that can express the properties in `25` and one that cannot.

---

## 12. Risks

| Risk | Mitigation |
|---|---|
| The FrameInspector is relaxed to ignore unknown fields | `D-26-02`; a change requires an amendment |
| The command-path allow-list grows without scrutiny | Written justification per entry, reviewed as an amendment |
| The generator never reaches an edge path | Coverage of command types asserted; edge paths seeded deliberately |
| Harness complexity exceeds the system's | Four harnesses, each with one job; reviewed against `§7` |
| A scanner is tuned until it passes | Honest and planted controls make over-broad and never-firing both detectable |

---

## 13. Future Considerations

Not committed: mutation testing on the core; continuous protocol fuzzing; a soak harness playing
thousands of unattended games; recording generated failures as permanent regression fixtures.

---

## 14. Cross References

| Document | Focus |
|---|---|
| `25_Testing_Strategy.md` | What is tested and the gates |
| `34_Testing/Privacy_and_Absence_Suites.md` | `TC-P*`, `TC-A*` |
| `34_Testing/Integrity_and_Randomization_Suites.md` | `TC-I*`, `TC-R*` |
| `19_WebSocket_Event_Catalog.md §6` | The visibility catalog the inspector checks against |
| `03_System_Architecture.md §5` | Core purity, which makes the harness possible |
| `23_Performance_Requirements.md` | The budgets the performance harness measures |

---

## 15. Revision History

| Version | Date | Author | Changes |
|---|---|---|---|
| 0.1 | 2026-09-02 | Design (architect role), owner-approved | Initial architecture: four primary harnesses |
