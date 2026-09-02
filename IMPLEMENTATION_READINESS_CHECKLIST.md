# Implementation Readiness Checklist

| | |
|---|---|
| **Project** | American Mahjong Dealer |
| **Document** | IMPLEMENTATION_READINESS_CHECKLIST.md |
| **Status** | Normative — the entry point for implementation |
| **Last Updated** | 2026-09-02 |
| **Role in SSOT** | Owns the readiness assessment and the questions an implementer must be able to answer. Does **not** own any design; every answer below is a pointer to the document that owns it. |

---

## 1. How to use this

Work through `§3` **before writing code**. Each question has an answer in the documentation. If you
cannot find one, that is a **documentation defect** — report it rather than inventing an answer,
because an invented answer to one of these is how the project stops being what it is.

`§4` assesses whether the design is ready. `§5` lists the questions the design deliberately leaves
open, so an implementer can distinguish a gap from a decision.

---

## 2. Read this first

The single most important thing to understand before implementing:

> You are building a Mahjong **table**, not a Mahjong **game**.
>
> Your training data and your instincts are full of Mahjong rules. None of it belongs in this
> codebase. When the documentation seems to be missing a rule, **its absence is the design.**

The test to apply, from `docs/02 §5.1`:

> Could a person who has never heard of Mahjong, looking only at the tiles and the table, determine
> the answer?

Yes → it may be mechanics. No → it is a rule, and it does not belong here at any layer, including the
client.

---

## 3. Questions you must be able to answer

### 3.1 Scope

| # | Question | Where |
|---|---|---|
| 1 | What does the system do? | `PROJECT_DESIGN_README.md §2` |
| 2 | What does it never do, and how is that enforced? | `SCOPE_BOUNDARIES.md §4` |
| 3 | Which responsibilities belong to the software and which to the players? | `SCOPE_BOUNDARIES.md §2` |
| 4 | What are the exactly five validations the server performs? | `docs/02 §3.1` |
| 5 | Where is the line between mechanical and rule validation? | `docs/02 §5` |
| 6 | What do you do when a mechanical behaviour seems unspecified? | `PROJECT_DESIGN_README.md §9.3` |

### 3.2 Architecture

| # | Question | Where |
|---|---|---|
| 7 | What are the packages and which may import which? | `docs/03 §4` |
| 8 | What may `dealer-core` not contain, and why? | `docs/03 §5` |
| 9 | How is a table's state owned and mutated? | `docs/05 §6` |
| 10 | Why is there no Redis, and what would introduce it? | `ADR-0014`, `docs/27 §8` |
| 11 | Where does REST end and the socket begin? | `docs/12 §3` |
| 12 | Why can the client not contain game logic? | `docs/03 §4.1`, `C-06` |

### 3.3 The dealer

| # | Question | Where |
|---|---|---|
| 13 | What are the thirty-two mechanical duties? | `docs/06 §4` |
| 14 | What does a human dealer do that this one declines? | `docs/06 §5` |
| 15 | What is in the tile set, and how do you know? | `docs/07 §3` — owner-confirmed |
| 16 | How is a tile identified, and what is a handle? | `docs/07 §5` |
| 17 | What is the conservation invariant and where is it checked? | `docs/07 §7` |
| 18 | Why does the deal count matter once and never again? | `docs/07 §4` |
| 19 | How does the shuffle work, and why rejection sampling? | `docs/08 §4` |
| 20 | What is the commitment, and why is it never revealed? | `docs/08 §5` |

### 3.4 Privacy — answer these before writing any projection code

| # | Question | Where |
|---|---|---|
| 21 | What are the three visibility classes? | `docs/14 §4` |
| 22 | Why is there a third class, and what is in it? | `docs/14 §4.3` |
| 23 | Why does the projector **construct** rather than filter? | `docs/14 §5.1` |
| 24 | How many functions may produce a client-bound payload? | `docs/14 §5` — **one** |
| 25 | Why does logging a hand not compile? | `docs/14 §6` |
| 26 | Why are hand sizes public? | `docs/14 §4.1` |
| 27 | What happens to concealed material at game close? | `docs/16 §5.5` |
| 28 | Why is there no replay? | `ADR-0012` |

### 3.5 Protocol and integrity

| # | Question | Where |
|---|---|---|
| 29 | What is the frame envelope, and what is **absent** from it? | `docs/19 §4` |
| 30 | What is the naming law, and what vocabulary is forbidden? | `docs/19 §3` |
| 31 | Why is there no seat field on the wire? | `docs/13 §7`, `NR-601` |
| 32 | What is `cmdId` for, and when is it generated? | `docs/13 §4` — **per intent** |
| 33 | What is `cseq` for, and what happens on a gap? | `docs/13 §5` |
| 34 | How many sequence numbers does the protocol have? | `docs/19 §3.2` — **one** |
| 35 | Which commands are staleness-checked, and why only those? | `docs/13 §6.1` |
| 36 | What does the system **not** guarantee about client input? | `docs/13 §3.1` |

### 3.6 Mechanics

| # | Question | Where |
|---|---|---|
| 37 | What are the states, and why are pause and pass rounds not states? | `docs/09 §4`, `§5` |
| 38 | What gates the turn pointer, and what moves it? | `docs/09 §6` |
| 39 | Why is claiming a discard not turn-gated? | `docs/02 §6`, `docs/10 §5.3` |
| 40 | How does a pass round work without knowing what a Charleston is? | `docs/10 §6` |
| 41 | How does a joker exchange work without knowing what a joker is? | `docs/10 §5.6` |
| 42 | How does a game conclude, and what is recorded? | `docs/10 §7` |
| 43 | How does correction work, and what are its bounds? | `docs/05 §8` |
| 44 | Why does a rewind reshuffle the wall? | `docs/05 §8.4`, `ADR-0016` |

### 3.7 Interaction

| # | Question | Where |
|---|---|---|
| 45 | What is the difference between a free and a binding act? | `docs/11 §5` |
| 46 | Why is there no double-click shortcut? | `D-11-03` |
| 47 | Where does a newly acquired tile go in the rack, and why? | `docs/11 §6.1` |
| 48 | What may the interface never do? | `docs/11 §12` |
| 49 | Which actions may be shown as unavailable, and which never? | `docs/02 §8`, `docs/32_UX/Interaction_Patterns.md §5.1` |
| 50 | Why must every action be keyboard-accessible with arm-and-confirm? | `docs/24 §5.3` |

### 3.8 Data and operations

| # | Question | Where |
|---|---|---|
| 51 | What is stored durably and what only in memory? | `docs/16 §3` |
| 52 | What is in a checkpoint, and why is it encrypted? | `docs/16 §5` |
| 53 | What invariant governs the public event log? | `docs/16 §6.1` |
| 54 | Which invariants live in the database rather than in code? | `docs/17 §6` |
| 55 | What may never be logged, and how do you debug instead? | `docs/20 §5`, `§6` |
| 56 | What happens on a conservation violation? | `docs/21 §3.4` |
| 57 | What can an administrator not do? | `docs/04 §3.3` |
| 58 | What support questions have no answer? | `docs/28 §7` |

### 3.9 Verification

| # | Question | Where |
|---|---|---|
| 59 | What is deliberately **not** tested, and why? | `docs/25 §3` |
| 60 | Why must the FrameInspector fail on unknown fields? | `D-26-02` |
| 61 | Why does every scanner need both a planted and an honest control? | `docs/26 §5.2` |
| 62 | What is the command-path audit, and why is it the sharpest check? | `docs/26 §5.1` |
| 63 | Which gates are zero-tolerance? | `docs/25 §7` |
| 64 | What are the eight gates a feature must pass? | `DEFINITION_OF_DONE.md` |

---

## 4. Readiness assessment

### 4.1 Ready

| Area | Assessment |
|---|---|
| Scope and boundaries | **Ready.** 62 negative requirements, each checkable; responsibility matrix; validation boundary table |
| Architecture | **Ready.** Packages, dependency law, purity contract, topology, and the multi-node seam all specified |
| Tile model and dealer | **Ready.** Owner-confirmed equipment spec; 32 duties, each justified; conservation invariant |
| Randomization | **Ready.** Entropy, algorithm, commitment, and the leak analysis that decided it |
| State machine | **Ready.** Two machines, three flags, full command availability matrix |
| Command catalog | **Ready.** 26 commands, each with validations from the closed vocabulary |
| Privacy | **Ready.** Three classes, one projector, type-level guard, 26-surface policy matrix, 34 threats |
| Protocol | **Ready.** Machine-checkable catalog; envelope; naming law; deliberate absences |
| Input integrity | **Ready.** Idempotency, sequencing, staleness, hostile input; the guarantee stated honestly |
| Security | **Ready.** 75 requirements with enforcement points; 37 threats |
| Data and database | **Ready.** 11 tables, constraints, encryption, privilege, purge |
| Interaction and accessibility | **Ready.** Pointer model, free/binding distinction, full keyboard model, WCAG AA plus exceedances |
| Testing | **Ready.** 8 suite families, harness design, gates |
| Deployment and operations | **Ready.** Topology, environments, pipeline, runbooks, recovery objectives |

### 4.2 Requires action before or during implementation

| # | Item | Why | When |
|---|---|---|---|
| 1 | **Measure single-process capacity** (`NFR-070`) | The multi-node trigger is 60% of a measured figure; a guess makes it meaningless | Before first release |
| 2 | **Choose and pin exact library versions** | `ADR-0015` names the stack, not versions | At project setup |
| 3 | **Produce or license tile artwork** | `docs/32_UX/Tile_Component_Spec.md` specifies rendering requirements, not assets. Must be original or appropriately licensed, and must satisfy `§3.2` glyph distinctness | Before the client is usable |
| 4 | **Select the breach-password list source** | `SEC-003` requires one; the source is not named | Before registration ships |
| 5 | **Select the hosting platform** | `docs/27` specifies requirements, not a vendor | Before staging |
| 6 | **Fix Argon2id parameters** | `docs/15 §4.1` requires them reviewed against current guidance at implementation time | At project setup |
| 7 | **Build the harnesses early** | `docs/26`'s four harnesses are prerequisites for the zero-tolerance suites, not later additions | First sprint |

Item 3 is the only one that is not purely a technical choice. Tile artwork must be original or
properly licensed — the system embeds no rule content (`NR-010`), and its imagery should be equally
unencumbered.

Item 7 deserves emphasis. The absence suite's value is in catching drift **from the first commit**.
Building it after the features it is meant to constrain would mean it first runs against a codebase
that has already drifted.

---

## 5. Open design questions

Deliberately unresolved. Each is recorded so an implementer knows it is a decision awaiting a
decider, not an omission.

| # | Question | Current position | Decide by |
|---|---|---|---|
| 1 | Should the correction window be exactly 10 actions? | 10, chosen as "a turn or two" (`D-05-06`) | After real play |
| 2 | Should the reconnection grace be exactly 10 minutes? | 10 minutes (`docs/22 §6`) | After real play |
| 3 | Should a lighter "return the current discard" primitive exist alongside full rewind? | Not in v1 (`docs/10 §16`) | After real play |
| 4 | Should table setup allow deal counts other than 13/14? | No; noted as a future consideration (`docs/07 §14`) | On request |
| 5 | Should tile-set profiles be configurable? | No; `DD-01` is the only duty that would change | On request |
| 6 | Should players get optional second-factor authentication? | Not in v1 (`docs/15 §15`) | Before wider release |
| 7 | Should there be a long-absence `SUSPENDED` table condition? | Not in v1; would be a fourth flag (`docs/09 §13`) | After real play |
| 8 | Is 500 concurrent tables per process the right assumption? | To be measured, not assumed (`§4.2` item 1) | Before first release |

Five of the eight are marked "after real play," and that is honest rather than evasive: they are
tuning parameters whose correct values depend on watching four people use the thing. Each has a
defensible starting value and a documented basis.

---

## 6. What to build first

A suggested order, derived from the dependency structure rather than from feature priority.

| Phase | Contents | Why first |
|---|---|---|
| **0** | Repository, strict compiler configuration, dependency-law lint, purity lint, **the four harnesses** | The lint gates and harnesses must exist before the code they constrain |
| **1** | `shared`: protocol types, branded types, `NoConcealed<T>`, the proof file, tile codec, schemas | Everything depends on the contract; the privacy guard must exist before anything can leak |
| **2** | `dealer-core`: tile set, wall, shuffle, deal, movement, projector, checkpoints, conservation. Plus `TC-M*` and `TC-A03` | Pure, testable without infrastructure, and the absence audit starts here |
| **3** | `db` and `auth`: schema, constraints, registration, login, sessions | The identity layer the rest sits on |
| **4** | `tables` and `actor`: lifecycle, seating, command pipeline. Plus `TC-I*` | The table becomes real |
| **5** | `gateway`: binding, framing, delivery, resumption, backpressure. Plus `TC-P01` | The privacy suite becomes runnable end to end |
| **6** | `web`: rendering and interaction. Plus `TC-X*`, `TC-E*` | The product becomes usable |
| **7** | `persist`, `obs`, `admin`: checkpoint durability, observability, administration. Plus `TC-F*`, `TC-P03` | Operational readiness |
| **8** | Performance measurement, capacity measurement, release gates | `NFR-070` and the release checklist |

Phase 0 is the one most likely to be skipped and least advisable to skip. The absence suite, the
purity lint, and the dependency lint are cheap to add on day one and expensive to add on day ninety —
by which point they fail on code that has to be rewritten rather than on code that was never written.

---

## 7. Assessment

> **The design is ready for implementation.**

Every architectural decision is recorded with its rationale and its rejected alternatives. Every
requirement is traced to a design section and a test. Every boundary the project depends on is
expressed as a checkable condition. The seven items in `§4.2` are project-setup and measurement
tasks rather than design gaps, and the eight questions in `§5` have defensible current positions.

The largest risk to a correct implementation is not a missing specification. It is `RR-50`: an
implementer filling a perceived gap with a rule, because software named "Mahjong" is expected to know
how Mahjong works. Everything in `§2` exists to counter that, and the absence suite exists to catch
it when the reading fails.

---

## 8. Cross References

| Document | Focus |
|---|---|
| `PROJECT_DESIGN_README.md` | Entry point and agent guidance |
| `SCOPE_BOUNDARIES.md` | The boundary every question above returns to |
| `DEFINITION_OF_DONE.md` | The eight gates each change must pass |
| `REQUIREMENTS_TRACEABILITY_MATRIX.md` | Requirement to component to test |
| `docs/26_Test_Architecture.md` | The harnesses to build in phase 0 |
| `docs/30_Risk_Register.md` | `RR-50` and the rest |

## 9. Revision History

| Version | Date | Author | Changes |
|---|---|---|---|
| 0.1 | 2026-09-02 | Design (architect role), owner-approved | Initial checklist: 64 questions, 7 action items, 8 open questions |
