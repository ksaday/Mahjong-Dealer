# Inheritance and Exclusion Analysis

| | |
|---|---|
| **Project** | American Mahjong Dealer |
| **Document** | INHERITANCE_AND_EXCLUSION_ANALYSIS.md |
| **Status** | Normative — records the relationship to the reference project |
| **Last Updated** | 2026-09-02 |
| **Role in SSOT** | Owns the record of what was and was not taken from the reference project, and why. Does **not** own any design decision; every "inherit" entry points at the chapter or ADR where the idea was independently re-derived for this project. |

---

## 1. Executive Summary

An existing and unrelated application, **American Mahjong Online**, was inspected read-only before
this project was designed. It is a mature, documentation-first monorepo: twenty-two numbered
chapters, eleven ADRs, a pure deterministic game engine, an event-sourced persistence spine, a
double-entry point ledger, a versioned rule-configuration system, and continuous integration that
mechanically enforces its own documentation.

**Nothing was copied.** No source file, schema, configuration, protocol definition, or business rule
from that project appears in this one. What was taken is a smaller and more durable category:
*patterns of thought*. How to organize a specification so that it stays consistent. How to make a
privacy boundary structural instead of aspirational. How to write a test that proves something does
not exist.

This document sorts everything considered into four buckets — **INHERIT**, **RE-DESIGN**,
**REMOVE**, **DO NOT USE** — and records the reasoning for each. It exists so that a future reader
who discovers a similarity between the two projects can tell immediately whether it was deliberate,
and so that a future reader who discovers a *dis*similarity can tell that it was a decision rather
than an oversight.

The single most important line in this document: the reference project is a **Mahjong game with a
deliberately minimal rule surface**. This project is a **Mahjong table with no rule surface at all**.
Those are different products, and the second is not a subset of the first.

---

## 2. Method

The reference project was examined along two axes: its documentation architecture, and its technical
architecture. For each artifact found, four questions were asked:

1. Does this solve a problem *this* project also has?
2. Is the solution independent of the reference project's business domain?
3. Would adopting it import any assumption this project rejects?
4. Is there a simpler solution adequate for four players at one table?

An artifact reaches **INHERIT** only when the answers are yes, yes, no, no. Anything that fails
question 4 reaches **RE-DESIGN**. Anything that fails question 3 reaches **REMOVE** or **DO NOT
USE**.

---

## 3. INHERIT — patterns adopted, independently re-derived

These are ideas, not implementations. Every one is re-specified from first principles in the chapter
named, and none carries a line of the reference project's code or content.

### 3.1 Documentation architecture

| Pattern | Why it earns its place | Re-derived in |
|---|---|---|
| **Numbered chapters in dependency order** | A stable, citable address for every architectural fact. `Ch. 14 §4` is a durable reference; "the privacy doc" is not. | `docs/00 §12`, whole `docs/` tree |
| **Fixed chapter skeleton** | Every chapter carries Design Decisions, Alternative Designs, Trade-offs, Risks, and Revision History in the same places, so a reader always knows where to look for *why*. | `docs/00 §12.4` |
| **"Role in SSOT" front-matter line** | Each document states what it owns **and what it does not own**. This is what prevents the same decision being made twice, differently, in two chapters. | Every chapter |
| **Namespaced identifier schemes** | `FR-###`, `NFR-###`, `D-CC-##`, `RR-##`. Globally unique IDs are what make a traceability matrix possible at all. | `docs/00 §12.2` |
| **Mandatory "Measured as" column on every NFR** | An unmeasurable non-functional requirement is a wish. Forcing the column at authoring time is what keeps the performance chapter honest. | `docs/23` |
| **ADR template with fixed headings** | Context / Options Considered / Decision / Rationale / Consequences / Cross References. Uniformity makes sixteen ADRs skimmable. | `docs/31_ADR/TEMPLATE.md` |
| **Explicit amendment process** | Completed chapters are never rewritten silently; a change requires an amendment, a revision-history row, and a check of dependent chapters. | `docs/00 §12.3` |
| **Reserved subdirectories created up front** | Expansion directories exist from day one with their intended contents documented, so later material has an obvious home. | `docs/32_UX`, `33_API`, `34_Testing` |
| **Documentation excluded from auto-formatting** | Every change to a specification should be a reviewed amendment, not a reflow. | `docs/00 §12.3` |

### 3.2 Privacy and information architecture

This is where the reference project is strongest, and where the inheritance is most valuable.

| Pattern | Why it earns its place | Re-derived in |
|---|---|---|
| **Type-level privacy branding** | Branded `Concealed*` types plus a recursive `NoConcealed<T>` mapped type, applied to the logger's parameter, turn "we must remember not to log hands" into "logging a hand does not compile." A discipline that depends on memory will eventually fail; a discipline enforced by the type checker will not. | `docs/14 §6`, `ADR-0013` |
| **A single seat-view serializer** | Exactly one function converts authoritative state into a client-bound payload, and it takes a seat as a parameter. Every leak must pass through one place, so one place can be audited, tested, and CI-guarded. | `docs/14 §5`, `ADR-0006` |
| **Per-seat frames, never a broadcast** | Four different payloads are computed and sent for every event. There is no code path that sends "the state" to everyone, so there is no code path that can accidentally include a hand. | `docs/12 §7` |
| **A compile-time proof file** | A file of deliberate type errors asserting that the forbidden shapes are rejected, with CI counting the assertions. It proves the type-level guard is still load-bearing rather than accidentally disabled. | `docs/34_Testing/Privacy_and_Absence_Suites.md` |
| **A log scanner exercised against a planted signature** | The scanner must fire on a poisoned line and stay silent on an honest one. A privacy control that is never tested against a real violation is not known to work. | `docs/20 §7`, `TC-P03` |
| **Encryption plus role-level column denial at rest** | Two independent barriers, so a mistake in either does not expose data by itself. | `docs/17 §7` |

### 3.3 Engine and correctness discipline

| Pattern | Why it earns its place | Re-derived in |
|---|---|---|
| **A pure core with an impure host** | The core decides *what*; the host decides *when*. Purity is lint-enforced by banning `Math.random`, `Date`, timers, and `process` inside the core package. This is what makes deterministic testing possible. | `docs/03 §5`, `docs/06 §3` |
| **Enforced package dependency direction** | `shared` imports nothing internal; the core imports only `shared`; the client imports only `shared`. Lint-enforced, so the seam cannot erode. | `docs/03 §4` |
| **Unbiased Fisher–Yates with rejection sampling** | Modulo reduction of a random integer biases the shuffle. Rejection sampling does not. For a system whose entire trustworthiness rests on the deal, this is not a detail. | `docs/08 §4` |
| **Domain-separated random streams** | Deriving independent streams by hashing the seed with a label, so one consumer of randomness cannot predict another's. | `docs/08 §4` |
| **A total tile comparator** | A comparator that never returns zero for two distinct tiles, so sorting cannot depend on the runtime's sort stability. Determinism that survives an engine upgrade. | `docs/07 §6` |
| **Canonical serialization for hashing** | Sorted keys, rejected non-finite numbers. A hash that varies by key order is not a hash of the state. | `docs/08 §6` |
| **The conservation invariant as a property test** | The tile multiset always equals the full set. One property, exhaustively fuzzed, catches an enormous class of mechanical bugs. | `docs/07 §7` |
| **One codec, in the shared package** | The reference project records that its tile codec was once duplicated and drifted. The lesson transfers directly. | `docs/07 §5` |

### 3.4 Protocol and input integrity

| Pattern | Why it earns its place | Re-derived in |
|---|---|---|
| **Ticketed WebSocket bind** | A single-use ticket redeemed in the first frame, never in the URL — query strings land in proxy logs, access logs, and browser history. | `docs/12 §4`, `ADR-0011` |
| **No seat parameter on the wire** | The socket binding determines the seat, server-side. There is no field for a client to lie in, which is what structurally eliminates the cross-seat IDOR rather than merely checking for it. | `docs/12 §4`, `NR-601` |
| **Client idempotency key plus per-connection counter** | The key makes retries safe; the counter makes gaps and reordering detectable. Together they cover the realistic failure modes of a flaky network. | `docs/13 §4`, `ADR-0009` |
| **Exactly one sequence number** | Multiple sequence numbers in one protocol guarantee that two of them will eventually disagree. | `docs/19 §4` |
| **A protocol naming law, machine-checked** | Commands, frames, events and error codes each have a fixed lexical convention, and CI diffs the documented catalog against the implementation. The catalog cannot silently drift from the code. | `docs/19 §3`, `D-19-01` |
| **Backpressure measured as bytes handed to the socket** | The obvious metric stays at zero until the kernel buffer fills, which is far too late. | `docs/12 §9` |
| **A close-code catalog** | Named, documented close codes make disconnection debuggable without a packet capture. | `docs/33_API/Error_Code_Catalog.md` |
| **Serialized command handling per table** | One operation at a time per table removes an entire category of race condition instead of defending against it. | `docs/05 §6` |

### 3.5 Testing and governance

| Pattern | Why it earns its place | Re-derived in |
|---|---|---|
| **The absence suite** | Tests that assert forbidden surfaces do *not* exist. The reference project uses it for spectators, solvers and cash-out. This project needs it far more, because its excluded surface is far larger. This is the most valuable single idea taken from the reference project. | `docs/34_Testing/Privacy_and_Absence_Suites.md` |
| **Zero-tolerance CI gates for privacy and absence** | Some suites cannot be "mostly passing." | `docs/25 §7` |
| **Invariants pushed into the database** | Partial unique indexes and triggers enforce what application code merely intends. | `docs/17 §6` |
| **Governance tooling as build steps** | Catalog-versus-code drift checks and log scanners run in CI, so the documentation is compiled rather than merely read. | `docs/27 §6` |
| **Invented rather than real fixture data** | Test fixtures must not embed real rule content. Here it goes further: fixtures cannot embed rules at all, because none exist. | `docs/26 §5` |

---

## 4. RE-DESIGN — same problem, different answer

These are areas where the reference project solved a real problem, but its solution is sized for a
different system. This project serves four people at one table; that fact should be visible in the
architecture.

| Area | Reference approach | This project | Why |
|---|---|---|---|
| **The game core** | Twenty sub-engines, several encoding rule concepts (calls, jokers, Charleston, validation, scoring, settlement) | One `dealer-core` of pure mechanics | Most of those sub-engines exist to interpret rules. Without rules there is nothing for them to do. `docs/06` |
| **Persistence** | Full event sourcing with a hash-chained append-only spine and replay-as-recovery | Authoritative in memory, encrypted checkpoints, public-only event log | Event sourcing is superb for auditability, but a complete event stream necessarily contains concealed material forever. Checkpoints that are purged at game close carry far less standing risk. `ADR-0010` |
| **Multi-node gameplay** | Redis node directory, ownership epochs, cross-node relay, database-trigger split-brain arbitration | A single gameplay node; the database is the ownership arbiter; the multi-node design is documented as a seam | Four players at one table do not need a cluster. The seam is specified precisely so the later move is cheap. `ADR-0014`, `docs/27 §8` |
| **Cache and coordination tier** | Redis for tickets, rate limits, presence, pub/sub | No Redis in v1; tickets and lockout counters in PostgreSQL, throttles in process memory | With one node, Redis holds nothing that PostgreSQL cannot at this scale — and a rate limit that vanishes on restart is one an attacker waits out. `ADR-0014` |
| **Backend framework** | NestJS on Fastify, with modules, providers and dependency injection | Fastify directly, with a small module convention | The endpoint surface here is roughly two dozen routes. The framework's structure would exceed the structure of the application. `ADR-0015` |
| **Roles** | Player, super user, support, auditor, plus delegated time-boxed access | Player and administrator | Support and auditor roles exist in the reference project largely to investigate financial disputes. There is nothing here to dispute. `docs/04` |
| **Administrator authentication** | Mandatory WebAuthn, step-up tokens, split-share break-glass credentials | Standard authentication with a short session and a second factor | The administrative surface cannot reach a concealed hand or move anything of value, so the ceremony is disproportionate. `docs/15 §8` |
| **Rules configuration** | A versioned, validated, ratified `RuleConfig` with a lifecycle and an evidence table | A small **table setup**: tile set and opening deal procedure | This is the sharpest divergence. The reference project's configuration surface *is* its rule surface. This project has none. `docs/07 §3`, `NR-011` |
| **Winning workflow** | A validation engine checking entitlement and declared value, then a confirmation state machine | A declaration recorded as an action, an optional voluntary reveal, three responses, a neutral outcome | Even entitlement and value bounds are rule judgments. `docs/10 §7` |
| **Correction of mistakes** | Dispute records and a void/abandon path | A bounded, unanimous rewind with a wall reshuffle | Without any referee, a misclick would otherwise end a game. `ADR-0016` |
| **Deployment** | Kubernetes, Terraform, multi-AZ database, compliance-mode object lock | Containers on a managed platform, managed PostgreSQL, point-in-time restore | There is no regulated data and nothing of value at stake. `docs/27` |
| **Tile interaction** | A pointer specification with a tile state machine and latency budget | Rebuilt around **free acts versus binding acts** | A rule-free table makes some mistakes unrecoverable except by unanimous rewind, which raises the cost of an accidental click and changes the interaction design. `docs/11 §5` |

---

## 5. REMOVE — present in the reference project, absent here by decision

Everything in this section exists in the reference project and is **entirely excluded** here. Each
row names the negative requirement that makes the exclusion binding and testable.

### 5.1 The economic system

The reference project contains a complete double-entry economy: a chart of accounts, materialized
balances, balanced transactions with signed postings, versioned pricing, payment-provider
integration with webhook verification and chargeback handling, an adjustments workflow, table fees,
player-to-player transfers, abandonment penalties, reconciliation, and auditor exports.

**All of it is removed.** Not reduced, not disabled, not feature-flagged — architecturally absent.

| Removed | Binding `NR` |
|---|---|
| Accounts, balances, wallets | `NR-101`, `NR-102` |
| Ledger transactions and postings | `NR-103` |
| Player-to-player transfer | `NR-104` |
| Pricing, purchases, checkout, refunds | `NR-105` |
| Payment-provider integration and webhooks | `NR-106` |
| Table fees, minimums, penalties, forfeiture | `NR-107` |
| Reconciliation and auditor export | `NR-108` |
| Administrative issuance and adjustment | `NR-109` |
| Per-seat result deltas on game records | `NR-101` |

A useful observation for anyone comparing the two projects: the reference project's *game engine*
is already free of money — its settlement component computes no payments, and its own header notes
that the name survives a design that no longer exists. The economy lives entirely in the
application layer around it. That means this exclusion is clean rather than surgical, and it also
means the absence of an economy is not what distinguishes the two projects. The absence of rules is.

### 5.2 The rule system

| Removed | Binding `NR` |
|---|---|
| The `RuleConfig` schema and everything it configures | `NR-001`, `NR-011` |
| Rule version lifecycle: draft, validate, activate, retire, roll back | `NR-010` |
| The rule validation gate and its scenario simulation pack | `NR-001` |
| Call arbitration by configured priority and tie-break | `NR-005` |
| Exposure group-size validation | `NR-006` |
| Joker legality: minimum group size, exchange conditions, turn restrictions | `NR-007` |
| Charleston phase planning, blind passes, courtesy negotiation, consent votes | `NR-008` |
| Declared-value bounds checking | `NR-013` |
| Dead-hand, false-declaration and wall-game policies | `NR-012` |
| Deal counts as *ratified configuration* rather than table setup | `NR-011` |

Note carefully: the reference project contains **no card or hand-pattern data anywhere**, and its
configuration schema is strict enough that a hand pattern has no field to live in. That is a
deliberate and well-executed containment decision on their part. This project does not need it,
because it has no configuration surface that could hold a rule in the first place.

### 5.3 Other removals

| Removed | Reason | Binding `NR` |
|---|---|---|
| Replay engine and replay viewer | A faithful replay reconstructs concealed hands | `NR-508`, `ADR-0012` |
| Auditor role and read-only audit database connection | Nothing to audit without an economy | `NR-108` |
| Support console reading player accounts | Nothing to support without an economy; and no path to a hand | `NR-407` |
| Delegated time-boxed administrative access | The administrative surface no longer justifies it | — |
| Fraud detection | An economy concept | `NR-109` |
| Intellectual-property containment programme for rule content | No rule content exists to contain | `NR-010` |
| Legal chapter on rule-book licensing | Same | `NR-010` |

---

## 6. DO NOT USE — inspected, and deliberately not carried over

A distinct category from **REMOVE**: these are artifacts a future implementer might be tempted to
consult *as a reference*, and should not.

| Artifact | Why not |
|---|---|
| Any source file from the reference project | This is an independent implementation. Copying code would import assumptions that are invisible at the copy site. |
| Its database schema | Its shape is driven by an event-sourced spine and a double-entry ledger. Neither exists here. |
| Its `RuleConfig` schema | Every field is a rule. There is no subset of it that is safe to adopt. |
| Its protocol definition | Its command and event names encode rule concepts — calls, Charleston phases, confirmation votes, joker exchanges, transfers. `docs/19 §3` forbids rule-derived vocabulary on the wire. |
| Its game phase enumeration | Phases such as call window, exposure resolution and confirmation are rule constructs. `docs/09` derives states from table mechanics instead. |
| Its ADR-0007 (player-verification winning model) as a decision | Its *conclusion* — that players verify wins, not the system — is exactly right and is independently reached here in `ADR-0001`. But it was reached there to contain a copyright risk while retaining a rules engine. Here it follows from the project's definition. Same destination, different road; citing theirs would misrepresent the reasoning. |
| Its ADR-0008 (player-directed economy) | Contradicts `NR-1xx` outright. |
| Its test fixtures | They configure rules. |
| Its CHANGELOG and roadmap | They describe a different product's history. |

---

## 7. Design Decisions

| ID | Decision | Rationale |
|---|---|---|
| D-IE-01 | Inherit patterns; copy nothing | A pattern re-derived in a new context is understood; a fragment copied is a liability nobody can explain. Rejected: adapting the reference codebase, which would import its rule and economy assumptions structurally. |
| D-IE-02 | Record the exclusions with binding `NR` identifiers rather than as prose | Prose exclusions are forgotten within a quarter. Numbered, tested exclusions are not. |
| D-IE-03 | Treat the absence suite as the highest-value inheritance | It is the only mechanism found that defends a *negative* specification, which is the specification this project mostly consists of. |
| D-IE-04 | Simplify aggressively where the reference project scaled | It solves for many concurrent tables and a regulated economy. Neither applies. Complexity carried without its motivating requirement is pure cost. |
| D-IE-05 | Re-derive the shuffle-commitment decision independently, and land in the same place | The reference project publishes a commitment and never reveals the seed, because revealing it would reconstruct every unseen hand. That analysis was reproduced here from the wall-order leak argument and reached the same conclusion. Convergence from independent reasoning is evidence the conclusion is right. `ADR-0008`. |

---

## 8. Alternative Designs

| Alternative | Why rejected |
|---|---|
| Fork the reference project and delete the economy and rules | The two systems' architectures diverge at the foundation — persistence model, engine decomposition, protocol vocabulary, role model. What survives deletion would be a project shaped by requirements it no longer has. |
| Extract a shared library across both projects | Creates a coupling between an independent project and one whose direction it does not control, for a small amount of genuinely common code. |
| Ignore the reference project entirely | Wasteful. Its privacy architecture and absence-testing discipline are hard-won and directly applicable. |
| Inherit the event-sourced spine as-is | Its auditability is real, but a permanent record containing every concealed hand is precisely the liability this project's privacy model is built to avoid. |

---

## 9. Trade-offs

**Independent re-derivation costs time and risks reinventing a subtly worse wheel.** Accepted: the
alternative is a codebase whose decisions nobody present can defend. Every inherited pattern is
recorded here with its reasoning, so the derivation is reviewable.

**Simplifying away the multi-node architecture means a later scaling change will not be free.**
Accepted, and mitigated: `docs/27 §8` specifies the seam — what Redis would take over, what would
have to change, and the concrete trigger.

**Rejecting event sourcing gives up perfect auditability of gameplay.** Accepted deliberately. There
is nothing of value at stake in a game, no dispute a record could settle that the players cannot
settle themselves, and a permanent record of concealed hands is a standing liability with no
offsetting benefit.

---

## 10. Risks

| Risk | Mitigation |
|---|---|
| A future contributor familiar with the reference project reintroduces one of its concepts by habit | The absence suite fails the build; `NR` identifiers make the intent unambiguous |
| The two projects' documentation is confused for one another | Every document carries a `Project` line in its front matter; this document exists to disambiguate |
| An implementer consults the reference codebase "for guidance" and absorbs a rule assumption | `§6` names this explicitly; `docs/00 §4` restates it as a constraint |
| Simplifications made here are later mistaken for oversights | Every one is recorded in `§4` with its reasoning |

---

## 11. Cross References

| Document | Focus |
|---|---|
| `SCOPE_BOUNDARIES.md` | The `NR-###` catalog these exclusions are enforced through |
| `docs/00_Project_Overview.md` | Constraints and documentation governance |
| `docs/03_System_Architecture.md` | Where the inherited structural patterns are re-specified |
| `docs/14_Player_Privacy.md` | Where the inherited privacy patterns are re-specified |
| `docs/27_Deployment_Architecture.md` | The multi-node seam left open by the simplification |
| `docs/31_ADR/` | Every decision referenced above |

---

## 12. Revision History

| Version | Date | Author | Changes |
|---|---|---|---|
| 0.1 | 2026-09-02 | Design (architect role), owner-approved | Initial analysis following read-only inspection of the reference project |
