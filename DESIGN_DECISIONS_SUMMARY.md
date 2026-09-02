# Design Decisions Summary

| | |
|---|---|
| **Project** | American Mahjong Dealer |
| **Document** | DESIGN_DECISIONS_SUMMARY.md |
| **Status** | Index — the owning chapter or ADR is authoritative for every entry |
| **Last Updated** | 2026-09-02 |
| **Role in SSOT** | Owns nothing. Every decision listed here belongs to a chapter (`D-CC-##`) or an ADR, and the rationale, alternatives, and consequences live there. |

---

## 1. Purpose

Every architectural decision in this project is recorded where it was made. That is correct for
depth and poor for breadth: there is no single place to see the shape of the whole design, or to
check whether a proposal has already been decided.

This index is that place. **341 chapter decisions and 16 ADRs.** Each entry is a one-line statement;
the reasoning, the rejected alternatives, and the consequences are in the owning document.

If this index and an owning document disagree, **the owning document wins**.

---

## 2. The decisions that define the project

Ten decisions, from which most of the rest follow. If you read nothing else here, read these.

| Decision | Where | Consequence |
|---|---|---|
| **A table and a dealer, not a game** | `ADR-0001` | No rules engine, no scoring, no judging. The players play; the software moves tiles |
| **Absence is a specified, tested requirement** | `ADR-0002` | 62 negative requirements, a responsibility matrix, a validation boundary, and a CI suite that fails on drift |
| **No economic component of any kind** | `ADR-0003` | No points, wallets, ledgers, or prices. And no scoring, since scoring needs rules |
| **Exactly four humans, nobody else** | `ADR-0004` | No bots, no substitutes, no spectators — so the authorization question for table data is a single boolean |
| **Five mechanical validations, closed list** | `ADR-0005` | An added rule check must be written beside five that are obviously unlike it |
| **Three visibility classes, one constructing projector** | `ADR-0006` | The privacy audit has one subject; a new field is absent unless deliberately added |
| **A commitment, never revealed** | `ADR-0008` | Tamper-evidence without the reconstruction risk that a reveal would create |
| **Memory authoritative, encrypted short-lived checkpoints** | `ADR-0010` | Long-lived data is harmless; sensitive data is short-lived — the inverse of event sourcing |
| **No replay in v1** | `ADR-0012` | No artifact exists from which a concealed hand can be reconstructed |
| **Bounded unanimous rewind, with a wall reshuffle** | `ADR-0016` | A misclick no longer ends a game, and the one real leak is neutralized |

### 2.1 The pattern across them

Six of the ten are decisions **not to build something**. That is the design's central move: the
smallest system has the smallest attack surface, the smallest privacy surface, and the fewest ways to
stop being what it claims to be. Twenty-two of the 75 security requirements are satisfied by
absence (`SECURITY_REQUIREMENTS_MATRIX.md §12`), and seven whole threat categories have no vector
(`THREAT_MODEL.md §5.2`).

---

## 3. Architecture Decision Records

| ADR | Title | Owning chapter |
|---|---|---|
| [0001](docs/31_ADR/ADR-0001-project-scope.md) | Project scope — a table and a dealer, not a game | `00` |
| [0002](docs/31_ADR/ADR-0002-rule-agnostic-architecture.md) | Rule-agnostic architecture and the Absence Contract | `02` |
| [0003](docs/31_ADR/ADR-0003-no-point-system.md) | No point system and no economic component | `02` |
| [0004](docs/31_ADR/ADR-0004-four-seat-table.md) | Fixed four-seat table; no bots, substitutes, or spectators | `05` |
| [0005](docs/31_ADR/ADR-0005-server-authority.md) | Server authority and the mechanical/rule validation boundary | `02` |
| [0006](docs/31_ADR/ADR-0006-hidden-information-model.md) | Hidden-information model and the three visibility classes | `14` |
| [0007](docs/31_ADR/ADR-0007-realtime-communication.md) | Native WebSocket with a custom envelope | `12` |
| [0008](docs/31_ADR/ADR-0008-tile-randomization.md) | Tile randomization: commitment published, never revealed | `08` |
| [0009](docs/31_ADR/ADR-0009-input-integrity.md) | Input integrity: command identity, sequencing, single writer | `13` |
| [0010](docs/31_ADR/ADR-0010-persistence-strategy.md) | Persistence: in-memory authority with encrypted checkpoints | `16` |
| [0011](docs/31_ADR/ADR-0011-reconnection-strategy.md) | Reconnection: ticketed bind, sequence resume, auto-pause | `22` |
| [0012](docs/31_ADR/ADR-0012-replay-decision.md) | Replay excluded from v1 | `16` |
| [0013](docs/31_ADR/ADR-0013-logging-privacy.md) | Logging privacy: branded types, one serializer, log scanner | `20` |
| [0014](docs/31_ADR/ADR-0014-single-node-deployment.md) | Single-node v1; no Redis, and the trigger that would introduce it | `27` |
| [0015](docs/31_ADR/ADR-0015-typescript-and-fastify.md) | TypeScript end-to-end with Fastify | `03` |
| [0016](docs/31_ADR/ADR-0016-consent-based-rewind.md) | Bounded consent-based rewind, with wall reshuffle | `05` |

Decisions that merely *implement* an ADR are chapter decisions rather than ADRs. Opaque tile handles
(`D-07-03`) and the protocol naming law (`D-19-01`) are the notable examples: both consequential,
neither deciding anything independent of `ADR-0006` and `ADR-0002` respectively.

---

## 4. Chapter decisions

Statements only. Rationale, alternatives, and consequences are in the owning chapter's **Design
Decisions**, **Alternative Designs**, and **Trade-offs** sections.

### 00 — Project Overview

| ID | Decision |
|---|---|
| D-00-01 | Adopt "the software should disappear" as the governing experience principle |
| D-00-02 | State the exclusions as numbered, testable constraints rather than prose |
| D-00-03 | Make the documentation the specification, with a formal amendment process |
| D-00-04 | Require every chapter to declare what it does *not* own |
| D-00-05 | Number chapters in dependency order and never renumber |

### 01 — Product Requirements

| ID | Decision |
|---|---|
| D-01-01 | Annotate rule-adjacent requirements with the negative requirement that constrains them |
| D-01-02 | Require a measurement method on every non-functional requirement |
| D-01-03 | Write acceptance criteria as executable scenarios rather than statements of intent |
| D-01-04 | Keep negative requirements in `SCOPE_BOUNDARIES.md` rather than duplicating them here |
| D-01-05 | State privacy acceptance in terms of *frame inspection over a whole game* rather than spot checks |

### 02 — System Scope

| ID | Decision |
|---|---|
| D-02-01 | Express scope as three named contracts rather than a single list |
| D-02-02 | Close the mechanical validation list at five items |
| D-02-03 | State the boundary as a two-column table rather than prose |
| D-02-04 | Give the "never heard of Mahjong" test as the decision procedure |
| D-02-05 | Gate only wall draws by turn |
| D-02-06 | Resolve simultaneous claims by arrival order, with correction as the remedy |
| D-02-07 | Order the Fidelity Contract's principles and state the orderings that matter |

### 03 — System Architecture

| ID | Decision |
|---|---|
| D-03-01 | One actor per table, serialized |
| D-03-02 | Authoritative state in memory, durability by checkpoint |
| D-03-03 | `dealer-core` is pure, with entropy and time injected |
| D-03-04 | Lint-enforced dependency direction |
| D-03-05 | Fastify directly rather than a DI framework |
| D-03-06 | Native WebSocket with a custom envelope |
| D-03-07 | No Redis in v1 |
| D-03-08 | Carry an owner column from the first migration |
| D-03-09 | DOM-first table rendering |

### 04 — User Roles and Access

| ID | Decision |
|---|---|
| D-04-01 | Three roles, with no support or auditor role |
| D-04-02 | Administrators have no path to game content — absent, not merely forbidden |
| D-04-03 | Accounts rather than guest seats |
| D-04-04 | Code-based private tables; no lobby or discovery |
| D-04-05 | The server assigns seats; no seat parameter exists on the wire |
| D-04-06 | The host is a player with two capabilities, not a role |
| D-04-07 | One seat per account, enforced in the database |
| D-04-08 | Uniform failure responses on table access |

### 05 — Game Table Architecture

| ID | Decision |
|---|---|
| D-05-01 | One serialized actor per table |
| D-05-02 | Fixed compass seats, no rotation |
| D-05-03 | Each client sees its own seat at the bottom |
| D-05-04 | Server assigns seats in fixed order |
| D-05-05 | Rewind requires unanimity among the other three |
| D-05-06 | Rewind depth bounded at 10 public actions |
| D-05-07 | A rewind crossing a wall draw reshuffles the undrawn remainder |
| D-05-08 | Table chat is ephemeral, with no history at all |
| D-05-09 | Signals carry no game meaning |
| D-05-10 | Auto-pause on absence rather than a vote |
| D-05-11 | Leaving a seat is forbidden mid-game |
| D-05-12 | Readiness clears when a game concludes |

### 06 — Digital Dealer Architecture

| ID | Decision |
|---|---|
| D-06-01 | Enumerate the duties exhaustively, each with a mechanics justification |
| D-06-02 | Name the declined duties as well as the accepted ones |
| D-06-03 | Five tile locations with `in flight` as a first-class location |
| D-06-04 | Never branch on tile face anywhere in the core |
| D-06-05 | Draws take an end parameter, `head` or `tail` |
| D-06-06 | Exposure retraction is permitted and public |
| D-06-07 | Swapping with an exposed tile is a general primitive |
| D-06-08 | Wall exhaustion is recorded and nothing follows |

### 07 — Tile Model

| ID | Decision |
|---|---|
| D-07-01 | Record the tile set as an owner-confirmed equipment specification with provenance |
| D-07-02 | Model tiles as distinguishable objects (face + copy) rather than counts |
| D-07-03 | Address tiles on the wire by opaque per-game random handles |
| D-07-04 | Mint handles per game, not globally |
| D-07-05 | Model the eight flowers as eight distinct faces |
| D-07-06 | Prefix dragons `R` so no code prefix is ambiguous |
| D-07-07 | Require a total tile comparator |
| D-07-08 | Treat opening deal counts as a procedure applied once, never enforced after |
| D-07-09 | Treat a conservation violation as fatal in production |
| D-07-10 | Classify wall order as `SRV`, stricter than `OWN` |

### 08 — Shuffle and Deal Architecture

| ID | Decision |
|---|---|
| D-08-01 | Server-only cryptographic entropy, no client contribution |
| D-08-02 | Rejection sampling rather than modulo reduction |
| D-08-03 | Publish a commitment, retain the salt, never reveal it |
| D-08-04 | Describe the commitment accurately as tamper-evidence, not player-verifiable proof |
| D-08-05 | Compile the seed-injection path out of production builds |
| D-08-06 | Domain-separated streams per randomness consumer |
| D-08-07 | Reshuffle only the undrawn remainder on a rewind |
| D-08-08 | Publish a fresh commitment after a reshuffle |
| D-08-09 | Deal as a single atomic transition |
| D-08-10 | Canonical encoding with no version prefix or whitespace |

### 09 — Game State Machine

| ID | Decision |
|---|---|
| D-09-01 | Two nested machines, table and game |
| D-09-02 | Five game states, none rule-derived |
| D-09-03 | Pause, pass round, and correction as flags rather than states |
| D-09-04 | Turn pointer as a field |
| D-09-05 | No draw/discard phase distinction |
| D-09-06 | `DEALING` atomic, no checkpoint |
| D-09-07 | `CONCLUDING` can return to `IN_PLAY` |
| D-09-08 | Deterministic flag precedence in rejections |
| D-09-09 | Chat available in every state |
| D-09-10 | Readiness clears at `CONCLUDED` |

### 10 — Player Action Model

| ID | Decision |
|---|---|
| D-10-01 | Declare validations from a closed vocabulary in every command entry |
| D-10-02 | Only `draw_tile` is turn-gated |
| D-10-03 | `claim_discard` moves the turn pointer with no entitlement check |
| D-10-04 | `claim_discard` names the tile handle |
| D-10-05 | Simultaneous claims resolve by arrival order |
| D-10-06 | `swap_exposed_tile` as a general primitive |
| D-10-07 | `arrange_hand` takes a full permutation |
| D-10-08 | Pass-round commitment count is public; identities are not |
| D-10-09 | Any seat may open or cancel a pass round |
| D-10-10 | Timeouts expire as refusals, never as acceptances |
| D-10-11 | `reveal_hand` is separate from `declare_mahjong` and voluntary |
| D-10-12 | Rejections are private to the actor |
| D-10-13 | `retract_exposure` is permitted, and its event carries the faces |

### 11 — Tile Interaction UX

| ID | Decision |
|---|---|
| D-11-01 | Free versus binding as the organising distinction |
| D-11-02 | Binding acts never triggered by a single click on a rack tile |
| D-11-03 | No double-click shortcut for discard |
| D-11-04 | 6px drag threshold with click suppression |
| D-11-05 | Release over nothing does nothing |
| D-11-06 | New tiles append to the end of the rack |
| D-11-07 | Gaps in the rack are supported and private |
| D-11-08 | Free acts never block on the network |
| D-11-09 | No optimistic application of binding acts |
| D-11-10 | Hover never changes meaning and never reveals |
| D-11-11 | Drop targets highlight only during a compatible drag |
| D-11-12 | Keyboard binding acts are armed then confirmed |
| D-11-13 | Pointer Events for all input |

### 12 — Realtime WebSocket Architecture

| ID | Decision |
|---|---|
| D-12-01 | No broadcast primitive; the write interface accepts only projector output |
| D-12-02 | Ticket redeemed in the first frame, never in a URL |
| D-12-03 | No seat field in any client frame |
| D-12-04 | Exactly one sequence number |
| D-12-05 | Full view per event, no deltas |
| D-12-06 | Backlog frames use the live projector |
| D-12-07 | Backpressure measured as bytes handed off |
| D-12-08 | `cseq` gap closes the socket |
| D-12-09 | 15s heartbeat, 2 misses |
| D-12-10 | One connection per seat, newest wins |
| D-12-11 | Rejections go only to the originating seat |
| D-12-12 | Opaque server-side sessions rather than self-contained tokens |

### 13 — Input Integrity

| ID | Decision |
|---|---|
| D-13-01 | State the guarantee as server acceptance, not input authenticity |
| D-13-02 | `cmdId` per intent, not per transmission |
| D-13-03 | Duplicate returns the original outcome |
| D-13-04 | A `cseq` gap closes the socket |
| D-13-05 | Staleness checked only on order-sensitive commands |
| D-13-06 | `claim_discard` names the tile handle **and** is staleness-checked |
| D-13-07 | `arrange_hand` carries a full permutation |
| D-13-08 | Unknown and unowned handles reject identically |
| D-13-09 | Schema validation is structural only |
| D-13-10 | Cheap checks before expensive ones, one entry point |
| D-13-11 | Rate limits above any human rate |

### 14 — Player Privacy

| ID | Decision |
|---|---|
| D-14-01 | Three visibility classes, not two |
| D-14-02 | The projector constructs rather than filters |
| D-14-03 | Exactly one projector, enforced in CI |
| D-14-04 | The socket write interface accepts only projector output |
| D-14-05 | Live, backlog, and snapshot frames share the projector |
| D-14-06 | Branded types on every telemetry entry point |
| D-14-07 | Count the proof-file assertions in CI |
| D-14-08 | Hand sizes and pass commit counts are `PUB` |
| D-14-09 | The viewer's own hand is a separate field from the seat array |
| D-14-10 | State the `SRV` clause as principals and systems, each with a mechanism |
| D-14-11 | No frame padding |

### 15 — Security Architecture

| ID | Decision |
|---|---|
| D-15-01 | Prefer security by absence over security by check |
| D-15-02 | Opaque server-side sessions rather than self-contained tokens |
| D-15-03 | Security-critical rate limits in durable storage |
| D-15-04 | A server-side pepper in addition to per-password salts |
| D-15-05 | Uniform failure responses on authentication and table access |
| D-15-06 | Long player sessions, short administrator sessions |
| D-15-07 | No break-glass path to game content |
| D-15-08 | Record the join-code analysis explicitly |
| D-15-09 | Refuse to start without required secrets |
| D-15-10 | Chat rendered as plain text, never as markup |

### 16 — Data Architecture

| ID | Decision |
|---|---|
| D-16-01 | Memory authoritative; durability by checkpoint |
| D-16-02 | Long-lived data is harmless; sensitive data is short-lived |
| D-16-03 | The private region is one encrypted blob, not four |
| D-16-04 | Checkpoints asynchronous |
| D-16-05 | Conservation verified on every restore, refusing on failure |
| D-16-06 | The backlog is not persisted |
| D-16-07 | Purge is a hard delete |
| D-16-08 | The public log has an invariant, checked per event |
| D-16-09 | Chat has no storage tier at all |
| D-16-10 | State the backup exposure accurately |

### 17 — Database Design

| ID | Decision |
|---|---|
| D-17-01 | Push invariants into constraints |
| D-17-02 | One seat per account as a partial unique index |
| D-17-03 | No `SELECT` grant on `private_state` for the general role |
| D-17-04 | Application-layer encryption in addition to platform encryption |
| D-17-05 | `key_version` on encrypted rows |
| D-17-06 | Append-only triggers on the event and audit logs |
| D-17-07 | Join codes stored irreversibly |
| D-17-08 | `owner_node` from the first migration |
| D-17-09 | Hard deletes for concealed material |
| D-17-10 | `game_outcome` as an enumeration with no value column |
| D-17-11 | Correction checkpoints bounded by deletion on write |
| D-17-12 | UUIDv7 primary keys |

### 18 — API Design

| ID | Decision |
|---|---|
| D-18-01 | No REST endpoint touches live table state |
| D-18-02 | Fourteen endpoints, and the surface fits on a page |
| D-18-03 | `404` where existence is sensitive |
| D-18-04 | Registration returns `201` for a duplicate email and notifies the existing address |
| D-18-05 | Join code returned exactly once, stored irreversibly |
| D-18-06 | Server assigns the seat on join |
| D-18-07 | `GET /admin/tables` returns a seat count, not occupants |
| D-18-08 | Second factor required on every administrative endpoint |
| D-18-09 | Closed error-code catalog; clients branch on `code`, never on `message` |
| D-18-10 | `Idempotency-Key` only where a duplicate would create a resource |

### 19 — WebSocket Event Catalog

| ID | Decision |
|---|---|
| D-19-01 | A machine-checked naming law |
| D-19-02 | No rule-derived vocabulary anywhere in the protocol |
| D-19-03 | Declare a visibility class per event field, not per field name |
| D-19-04 | No wire field is ever `SRV` |
| D-19-05 | A Deliberate Absences section, machine-checked |
| D-19-06 | Admit `declare_mahjong` explicitly, with a stated basis |
| D-19-07 | Keep this catalog separate from `12` and `18` |
| D-19-08 | Exactly one sequence number |

### 20 — Logging and Observability

| ID | Decision |
|---|---|
| D-20-01 | Type-level prohibition as the primary control |
| D-20-02 | Three layers failing at three different times |
| D-20-03 | A redaction event is itself an anomaly alert |
| D-20-04 | No tile face logged, even a public one |
| D-20-05 | Both a planted and an honest control on every scanner run |
| D-20-06 | Provide the debugging alternatives explicitly |
| D-20-07 | Verbose logging compiled out of production |
| D-20-08 | No identifiers as metric labels |
| D-20-09 | The error reporter takes no state parameter |
| D-20-10 | Conservation violations and production redactions are critical alerts |

### 21 — Error Handling and Recovery

| ID | Decision |
|---|---|
| D-21-01 | Classify errors by required response, not by origin |
| D-21-02 | Consistency failures freeze rather than degrade |
| D-21-03 | Freeze rather than crash |
| D-21-04 | Do not overwrite the checkpoint after a consistency failure |
| D-21-05 | A checkpoint failure does not interrupt play |
| D-21-06 | Rejections are private to the actor |
| D-21-07 | No automatic retry of rejections |
| D-21-08 | Fail closed on security-critical limits, open on convenience limits |
| D-21-09 | The error reporter accepts no state parameter |
| D-21-10 | Messages name mechanisms, never rules |
| D-21-11 | Synchronous checkpoint flush on graceful shutdown |

### 22 — Disconnect and Reconnect

| ID | Decision |
|---|---|
| D-22-01 | Auto-pause on absence, no vote |
| D-22-02 | Auto-resume on return, no acknowledgement |
| D-22-03 | An `away` state between connected and absent |
| D-22-04 | 15 s heartbeat, 2 misses |
| D-22-05 | A clean close is immediate |
| D-22-06 | Chat and correction remain available while paused |
| D-22-07 | Timeouts suspend while paused |
| D-22-08 | The seat is never reassigned automatically |
| D-22-09 | 10-minute grace, 5-minute actor retirement |
| D-22-10 | Rack order restored exactly |
| D-22-11 | Abandonment is unanimous and only while absent |
| D-22-12 | Abandonment attributes no fault |
| D-22-13 | Crash recovery uses the ordinary reconnection path |

### 23 — Performance Requirements

| ID | Decision |
|---|---|
| D-23-01 | Every target has a justification and a measurement method |
| D-23-02 | Separate budgets for free and binding acts |
| D-23-03 | Free acts have a target of zero network round trips |
| D-23-04 | Drag measured by worst frame, not average |
| D-23-05 | Propagation measured at the last of four clients |
| D-23-06 | Targets stated for same-region play, with the limitation named |
| D-23-07 | Capacity measured, not assumed |
| D-23-08 | Privacy and integrity controls have no performance exemption |
| D-23-09 | Measurement on a throttled reference device |
| D-23-10 | Hand-size measurement to 40 tiles |

### 24 — Accessibility

| ID | Decision |
|---|---|
| D-24-01 | DOM-first rendering |
| D-24-02 | Exceed AA where demographics warrant |
| D-24-03 | Full keyboard parity, including arm-and-confirm |
| D-24-04 | Accessible names describe, never interpret |
| D-24-05 | Region-based navigation |
| D-24-06 | Assertive announcements reserved for events needing a response |
| D-24-07 | The rack never wraps at high zoom |
| D-24-08 | 44 px targets, exceeding the AA minimum |
| D-24-09 | Shape and glyph distinguish suits, never colour |
| D-24-10 | Manual screen-reader testing is required |
| D-24-11 | Name the absence of timing requirements as an accessibility property |

### 25 — Testing Strategy

| ID | Decision |
|---|---|
| D-25-01 | No rule-correctness tests; test that rule-violating play is accepted instead |
| D-25-02 | Privacy and absence as separate zero-tolerance gates |
| D-25-03 | Frame inspection over complete games, not spot checks |
| D-25-04 | The log scanner requires both a planted and an honest control |
| D-25-05 | Count the type-proof assertions |
| D-25-06 | 100% branch coverage on the core only |
| D-25-07 | Conservation as a property test over randomized play |
| D-25-08 | Acceptance criteria map one-to-one to E2E scenarios |
| D-25-09 | No fixture encodes a rule or hand pattern |
| D-25-10 | Static command-path audit for face-inspecting branches |

### 26 — Test Architecture

| ID | Decision |
|---|---|
| D-26-01 | TableHarness uses the real actor and core, with no transport |
| D-26-02 | The FrameInspector **fails on unknown fields** |
| D-26-03 | Concealed material detected structurally, not by field name |
| D-26-04 | Generated games rather than scripted scenarios |
| D-26-05 | Shrinking is required, not optional |
| D-26-06 | Injected clock and entropy |
| D-26-07 | Command-path audit allow-list with written justifications |
| D-26-08 | Every scanner carries a planted and an honest control |
| D-26-09 | Suites organized by gate stage |
| D-26-10 | `harness.state()` exposes authoritative state to tests only |

### 27 — Deployment Architecture

| ID | Decision |
|---|---|
| D-27-01 | One process, one database, nothing else |
| D-27-02 | Do not split REST from the gateway |
| D-27-03 | No production data outside production; concealed hands cannot be anonymized |
| D-27-04 | Development paths compiled out, not runtime-gated |
| D-27-05 | One artifact promoted unchanged |
| D-27-06 | Forward-only, backward-compatible migrations |
| D-27-07 | Read-only filesystem, non-root, no capabilities |
| D-27-08 | Specify the multi-node seam before it is needed |
| D-27-09 | State the simultaneous-interruption cost plainly |
| D-27-10 | No source maps in production |

### 28 — Operations

| ID | Decision |
|---|---|
| D-28-01 | Operations has no privileged path to player data |
| D-28-02 | A mandatory reason enforced by the endpoint, not by policy |
| D-28-03 | Do not restart on a conservation violation |
| D-28-04 | Treat a production redaction event as an incident |
| D-28-05 | Dedicated integrity and privacy dashboards |
| D-28-06 | Publish what the system cannot answer, in the product |
| D-28-07 | The diagnostic path is reproduce-in-core, not inspect-production |
| D-28-08 | A monthly query for orphaned concealed material |

### 29 — Disaster Recovery

| ID | Decision |
|---|---|
| D-29-01 | Set objectives against what is actually at stake — an hour of leisure |
| D-29-02 | In-flight games are not protected against regional loss |
| D-29-03 | The most sensitive data has the weakest durability requirement |
| D-29-04 | Manual cross-region failover |
| D-29-05 | Verification includes starting an actor from a restored checkpoint |
| D-29-06 | Verification includes confirming purge survived the backup path |
| D-29-07 | Corruption is isolated per table |
| D-29-08 | Tell players when a game is lost |

### 30 — Risk Register

| ID | Decision |
|---|---|
| D-30-01 | Rank `RR-01` — becoming a rules engine — as the top risk, above every technical one |
| D-30-02 | Elevate `RR-01`'s likelihood specifically because AI agents will implement this |
| D-30-03 | Keep project risks separate from the adversarial threat models |
| D-30-04 | Record a **trigger to watch** for every row, not just a mitigation |
| D-30-05 | Leave six residuals at medium rather than mitigating them to low on paper |
| D-30-06 | Make adding a risk frictionless and changing an assessment require approval |

### 32_UX — screens, layout, tiles, patterns

| ID | Decision |
|---|---|
| D-32-01 | Nine screens; the table is one of them |
| D-32-02 | A concluded game returns to the lobby, not home |
| D-32-03 | The join code is visible for the table's open life |
| D-32-04 | The lock state states its expiry |
| D-32-05 | Password requirements stated before entry |
| D-32-06 | Help states what the system does **not** do, prominently |
| D-32-07 | No administrative screen shows game content |
| D-32-10 | Own seat always at the bottom, others in true relative position |
| D-32-11 | Opponent racks render tile backs, plus a numeric count |
| D-32-12 | Only the newest discard is interactive, and it is ringed |
| D-32-13 | Both wall ends are equally presented |
| D-32-14 | Nothing ever overlaps the rack |
| D-32-15 | The rack never wraps |
| D-32-16 | A muted table surface |
| D-32-17 | The concluded state states the outcome neutrally |
| D-32-20 | The component renders a face only when supplied one |
| D-32-21 | 56 px minimum height; scroll rather than shrink further |
| D-32-22 | Each dragon has a distinct glyph, colour redundant |
| D-32-23 | The soap is a distinct glyph, not a blank |
| D-32-24 | Vector faces |
| D-32-25 | `armed` is a first-class state with the verb shown |
| D-32-26 | Older discards are `inert` but fully rendered |
| D-32-27 | Every state uses at least two channels |
| D-32-28 | Another seat's tile movement animates |
| D-32-29 | Accessible names describe, never interpret |
| D-32-30 | Inline arm-and-confirm rather than modal dialogs |
| D-32-31 | Nothing auto-dismisses into a decision |
| D-32-32 | Vote timeouts expire as rejections, and say so |
| D-32-33 | Declarations have no timeout |
| D-32-34 | Only `reveal_hand` carries a warning |
| D-32-35 | A reserved banner strip |
| D-32-36 | Actions disabled only for mechanical reasons, with the reason shown |
| D-32-37 | Chat never interrupts |
| D-32-38 | Chat is always plain text |
| D-32-39 | Votes show a public description of the affected actions |

### Inheritance analysis

| ID | Decision |
|---|---|
| D-IE-01 | Inherit patterns; copy nothing |
| D-IE-02 | Record the exclusions with binding `NR` identifiers rather than as prose |
| D-IE-03 | Treat the absence suite as the highest-value inheritance |
| D-IE-04 | Simplify aggressively where the reference project scaled |
| D-IE-05 | Re-derive the shuffle-commitment decision independently, and land in the same place |

---

## 5. Decisions most likely to be questioned

Each of these has been challenged during design review, or is the kind of choice a newcomer
reasonably queries. The answer is in the owning document; this is a pointer, not a restatement.

| Question | Answer | Where |
|---|---|---|
| Why not reveal the shuffle so players can verify it? | The wall order plus the public history reconstructs every unrevealed hand | `docs/08 §5.3` |
| Isn't a rewind a privacy hazard? | Five of six rewind cases leak nothing; the sixth is neutralized by reshuffling the undrawn wall | `docs/05 §8.4` |
| Why keep encrypted checkpoints at all? | Crash recovery needs them regardless of rewind, and any recovery artifact must contain concealed material | `ADR-0010` |
| Why no Redis? | With one process it holds nothing PostgreSQL cannot, and the security-critical rate limit must be durable anyway | `ADR-0014` |
| Isn't a six-character join code too short? | Entropy is not the binding constraint; rate limits and short validity are | `docs/15 §7.2` |
| Why can't an administrator help a player who lost a game? | The data no longer exists, for anyone | `docs/28 §7` |
| Why does the system permit obviously illegal play? | It does not know the rules; that is the product | `docs/02 §8` |
| Why no double-click to discard? | Indistinguishable from an impatient click on a tile being selected, with an irreversible consequence | `D-11-03` |
| Why does the frame inspector fail on fields it does not recognize? | The leak that matters is the field nobody thought about | `D-26-02` |
| Why is the table's configuration surface only three values? | Any larger surface is somewhere a rule could live | `docs/05 §7`, `NR-011` |

---

## 6. Maintenance

| When | Do |
|---|---|
| A decision is made | Record it in the owning chapter first, then add a line here |
| An architectural decision is made | Write the ADR, then add it to `§3` and to `docs/31_ADR/README.md` |
| A decision is reversed | Amend the owning chapter; supersede the ADR; update this index |
| A decision is retired | Strike through in the owning chapter; never delete |

This index is derived from the owning documents. If it falls out of step with them, the owning
documents are right and this file is stale.

---

## 7. Cross References

| Document | Focus |
|---|---|
| `docs/31_ADR/README.md` | The ADR index and conventions |
| `docs/00_Project_Overview.md §12` | Documentation governance and the amendment process |
| `SCOPE_BOUNDARIES.md` | The negative requirements many of these decisions produce |
| `INHERITANCE_AND_EXCLUSION_ANALYSIS.md` | Which decisions were inherited in concept and re-derived |
| `IMPLEMENTATION_READINESS_CHECKLIST.md §5` | The eight decisions deliberately left open |

## 8. Revision History

| Version | Date | Author | Changes |
|---|---|---|---|
| 0.1 | 2026-09-02 | Design (architect role), owner-approved | Initial index: 341 chapter decisions, 16 ADRs |
