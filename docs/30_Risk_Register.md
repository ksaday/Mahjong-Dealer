# 30 — Risk Register

| | |
|---|---|
| **Project** | American Mahjong Dealer |
| **Document** | 30_Risk_Register.md |
| **Status** | Ratified v0.1 — approved by the project owner, 2026-09-02 |
| **Last Updated** | 2026-09-02 |
| **Role in SSOT** | Owns the consolidated risk register and the risk process. Does **not** own the security threat model (`THREAT_MODEL.md`) or the privacy threat model (`PRIVACY_THREAT_MODEL.md`), which analyse adversarial threats rather than project risks. |

---

## 1. Executive Summary

The register's top entry is not a technical failure. It is **`RR-01`: the project becomes a rules
engine.**

That risk is first because it is the most likely to occur, the hardest to reverse once code depends
on it, and the most damaging to what the product is. It does not arrive as a decision to build a
rules engine; it arrives as a series of small, locally reasonable improvements, each of which
requires the system to know a little more than it should. And the likelihood is elevated beyond the
usual because implementation will be carried out substantially by AI coding agents, whose strongest
prior on a repository named "Mahjong" is a large body of Mahjong knowledge.

Nearly every structural feature of this documentation set — the negative-requirement catalog, the
responsibility matrix, the validation boundary table, the closed validation vocabulary, the protocol
naming law, the absence test suite — exists to mitigate `RR-01`. That is a lot of machinery for one
risk, and it is proportionate, because the risk is that the project quietly becomes a different and
worse product.

The second tier is privacy (`RR-02`, `RR-03`), where the impact is severe and the mitigations are
correspondingly structural. Everything below that is ordinary engineering risk.

---

## 2. Scales

**Likelihood** — 1 remote · 2 unlikely · 3 possible · 4 likely · 5 near-certain without mitigation.

**Impact** — 1 negligible · 2 minor · 3 moderate, users notice · 4 severe, the product's promises are
broken · 5 critical, the project is no longer what it claims to be.

Score is likelihood × impact. **Residual** is the assessed level after the stated mitigations.

---

## 3. Register

### 3.1 Product identity

| ID | Risk | L | I | Score | Mitigation | Trigger to watch | Residual |
|---|---|---|---|---|---|---|---|
| **RR-01** | **The system acquires rule knowledge** and becomes a rules engine | 4 | 5 | **20** | `NR-001`–`NR-013`; responsibility matrix (`SCOPE_BOUNDARIES.md §2`); validation boundary table (`02 §5`); closed validation vocabulary (`10 §3.1`); protocol naming law (`19 §3`); absence suite `TC-A01`–`TC-A11`; command-path audit `TC-A03` | Any pull request adding a branch on a tile face; any new state or event with rule vocabulary; any "helpful" validation | **Low** |
| RR-02 | Assistance features are added — sorting, hints, highlights | 4 | 4 | 16 | `NR-201`–`NR-211`, `NR-301`–`NR-306`; `TC-A07`, `TC-A09`; `11 §12` enumerates the temptations | Any auto-arrange, highlight, or count of anything meaningful | Low |
| RR-03 | A scoring or point system is introduced | 2 | 5 | 10 | `C-02`; `NR-101`–`NR-109`; `TC-A06`; `ADR-0003` records that scoring requires rules | Any persistent tally across games | Low |
| RR-04 | Players find the neutrality frustrating and abandon the product | 3 | 3 | 9 | Correction mechanism (`05 §8`); table chat (`05 §9`); in-product statement of what the system does and does not do | Support volume asking "why didn't it stop me" | Medium |
| RR-05 | Scope grows toward a general game platform | 2 | 3 | 6 | `02 §7`; every addition requires an amendment | Feature requests for lobbies, tournaments, rankings | Low |

`RR-04` retains a **medium** residual and is the register's most honest entry. The product's central
premise — that the software has no opinion — is genuinely not what some players will want, and no
mitigation removes that. The remedy is to be clear about what the product is rather than to soften
it, since softening it is `RR-01`.

### 3.2 Privacy

| ID | Risk | L | I | Score | Mitigation | Trigger to watch | Residual |
|---|---|---|---|---|---|---|---|
| RR-10 | A concealed hand reaches another player | 3 | 5 | 15 | Three visibility classes; one constructing projector; branded types; `TC-P01` full-frame inspection | Any second serialization path; any broadcast helper | **Low** |
| RR-11 | Concealed material reaches a log, metric, or trace | 4 | 4 | 16 | `NoConcealed<T>` compile-time guard; redactor; scanner with planted control; `TC-P03` | A redaction event in production; any new logging sink | Low |
| RR-12 | The wall order leaks, revealing the whole game | 2 | 5 | 10 | `SRV` class; never in any frame; commitment never revealed (`ADR-0008`); encrypted at rest | Any request to reveal the salt "for verification" | Low |
| RR-13 | A replay or export is added and reconstructs hands | 2 | 5 | 10 | `ADR-0012` with explicit reconsideration conditions; `TC-A11` | Any proposal for game review or export | Low |
| RR-14 | A public event acquires a private field | 3 | 4 | 12 | `16 §6.1` invariant; per-event review; `TC-P04` | Any new event type | Low |
| RR-15 | Concealed material outlives its game in a backup | 2 | 4 | 8 | Purge before the backup window; quarterly verification step 5 (`29 §6.1`) | A purge failure alert | Low |
| RR-16 | An administrative path to game content is added | 2 | 5 | 10 | No such path exists (`04 §3.3`); `NR-406`; `TC-P02` | Any support request for game visibility | Low |

### 3.3 Correctness and integrity

| ID | Risk | L | I | Score | Mitigation | Trigger to watch | Residual |
|---|---|---|---|---|---|---|---|
| RR-20 | Tiles are duplicated or lost | 3 | 4 | 12 | Conservation invariant enforced by construction, asserted at boundaries, property-tested (`TC-M01`), verified on restore; fatal in production | A conservation alert | Low |
| RR-21 | A command applies twice | 3 | 4 | 12 | `cmdId` idempotency; receipts in checkpoints; `TC-I04` | Duplicate rejections rising | Low |
| RR-22 | A biased shuffle | 2 | 4 | 8 | Rejection sampling; chi-squared over 100 000 shuffles (`TC-R03`) | Any optimization of the shuffle path | Low |
| RR-23 | A client influences the shuffle | 1 | 5 | 5 | No client input path; static audit `TC-R05`; seed injection compiled out `TC-R06` | Any proposal to mix client entropy | Low |
| RR-24 | A stale action applies to the wrong target | 3 | 3 | 9 | Handle parameter on claims; staleness check on order-sensitive commands; `TC-I07` | Player reports of unexpected tile movement | Low |
| RR-25 | A rewind leaves inconsistent state | 2 | 4 | 8 | Restore from a verified checkpoint; conservation re-verified; wall reshuffle; `TC-M09`, `TC-R08` | Any correction-path change | Low |
| RR-26 | A rewind leaks a peeked wall tile | 3 | 3 | 9 | Reshuffle of the undrawn remainder (`05 §8.4`); per-action analysis | Any change to the reshuffle path | Low |

### 3.4 Availability and operations

| ID | Risk | L | I | Score | Mitigation | Trigger to watch | Residual |
|---|---|---|---|---|---|---|---|
| RR-30 | The single process is a point of failure | 4 | 3 | 12 | Checkpoints; automatic restart; lossless graceful deploy; documented seam (`27 §8`) | Restart frequency; capacity approaching the trigger | Medium |
| RR-31 | A deploy interrupts every live table at once | 4 | 2 | 8 | Graceful shutdown loses nothing; automatic reconnection; trigger 2 in `27 §8.3` | Player complaints about deploy timing | Medium |
| RR-32 | A table stalls with nobody able to end it | 3 | 3 | 9 | Unanimous abandonment (`FR-147`); administrative force-close | Force-close frequency | Low |
| RR-33 | A disconnected player blocks three others | 4 | 2 | 8 | Auto-pause; 10-minute grace; unanimous abandonment | Abandonment frequency | Medium |
| RR-34 | Capacity is never measured, so the seam trigger is meaningless | 3 | 3 | 9 | `NFR-070` load test is a release requirement | Absence of a measured figure at release | Low |
| RR-35 | Corruption on one table affects others | 1 | 4 | 4 | One actor per table; per-table freeze (`29 §5.6`) | — | Low |

`RR-30`, `RR-31` and `RR-33` retain **medium** residuals, and all three are consequences of accepted
decisions (`ADR-0014`, `ADR-0004`) rather than unmitigated oversights. They are recorded at medium
because the honest assessment is that they will be felt occasionally.

### 3.5 Security

| ID | Risk | L | I | Score | Mitigation | Trigger to watch | Residual |
|---|---|---|---|---|---|---|---|
| RR-40 | Credential stuffing | 4 | 3 | 12 | Argon2id with a pepper; durable per-account lockout; per-address limits; breach-list rejection | Authentication failure spikes | Low |
| RR-41 | Cross-seat access | 2 | 5 | 10 | No seat parameter exists anywhere (`NR-601`); `TC-I01` | Any proposal to add a seat parameter | **Low** |
| RR-42 | Join codes brute-forced | 2 | 3 | 6 | Rate limits; uniform failures; short validity; analysis in `15 §7.2` | Join failure rate spikes | Low |
| RR-43 | A session outlives its revocation on a live socket | 2 | 4 | 8 | Opaque server-side sessions; 5-second revocation sweep (`NFR-026`) | Any proposal for self-contained tokens | Low |
| RR-44 | A compromised dependency reads hands | 2 | 5 | 10 | Minimized client dependencies; scanning; denied install scripts; reviewed updates | A critical advisory in a runtime dependency | Medium |
| RR-45 | Secrets committed or logged | 2 | 4 | 8 | Secret manager; startup refusal on defaults; log scanner | — | Low |

`RR-44` is **medium** because the mitigations reduce but cannot eliminate it: any dependency in the
server process can read authoritative state, and that is inherent to running code.

### 3.6 Delivery

| ID | Risk | L | I | Score | Mitigation | Trigger to watch | Residual |
|---|---|---|---|---|---|---|---|
| RR-50 | An implementer builds a rules engine because the documentation seemed incomplete | 3 | 5 | 15 | `PROJECT_DESIGN_README.md §9.3` states that a missing rule *is* the design; `02 §8` worked examples; `IMPLEMENTATION_READINESS_CHECKLIST.md` | Questions of the form "what should happen when…" about rule situations | Low |
| RR-51 | Documentation drifts from the implementation | 3 | 3 | 9 | Amendment process (`00 §12.3`); machine-checked catalog (`TC-P08`); traceability matrix regenerated | Any protocol change without a catalog amendment | Low |
| RR-52 | Zero-tolerance gates are relaxed to unblock a release | 2 | 5 | 10 | Separate gate stage; relaxing requires an amendment and owner approval | Any proposal to skip T3 | Low |
| RR-53 | Accessibility regresses as features are added | 3 | 3 | 9 | Keyboard-only E2E traversal on every scenario; automated contrast and axe audits | Any new interaction added without keyboard support | Low |
| RR-54 | Tile interaction is imprecise enough to frustrate players | 3 | 4 | 12 | `11` pointer specification; free/binding distinction; cross-browser E2E; accidental-action guards | Reports of accidental discards | Medium |

`RR-54` is **medium** because interaction quality is the product's entire surface and cannot be fully
verified by automated tests. It is the risk most likely to require iteration after real play.

---

## 4. Heat summary

| Residual | Risks |
|---|---|
| **Medium** | `RR-04` neutrality frustrates · `RR-30` single process · `RR-31` deploy interruption · `RR-33` disconnection blocks others · `RR-44` dependency compromise · `RR-54` interaction quality |
| **Low** | Everything else |

Six medium residuals, and none is an unmitigated oversight: four are accepted consequences of
documented decisions, one is inherent to running third-party code, and one is a quality risk that
only real play will resolve.

The most heavily mitigated risk, `RR-01`, is also the highest-scoring before mitigation. That
distribution is intentional: the effort went where the project's identity was at stake.

---

## 5. Design Decisions

| ID | Decision | Rationale |
|---|---|---|
| D-30-01 | Rank `RR-01` — becoming a rules engine — as the top risk, above every technical one | It is the most likely to occur, the hardest to reverse once code depends on it, and the only one that changes what the product is. Ranking it below a technical risk would misdirect the mitigation effort. |
| D-30-02 | Elevate `RR-01`'s likelihood specifically because AI agents will implement this | An agent's strongest prior on a repository named "Mahjong" is Mahjong knowledge. That is a real and unusual likelihood multiplier, and pretending otherwise would understate the risk. |
| D-30-03 | Keep project risks separate from the adversarial threat models | A risk is something that may go wrong; a threat is someone trying to make it. They have different scales, owners, and mitigations, and merging them makes both harder to read. |
| D-30-04 | Record a **trigger to watch** for every row, not just a mitigation | A mitigation without an observable trigger is untestable in practice — nobody knows when to act on it. |
| D-30-05 | Leave six residuals at medium rather than mitigating them to low on paper | Four are accepted consequences of documented decisions, one is inherent to running third-party code, and one only real play will resolve. Recording them as low would be dishonest. |
| D-30-06 | Make adding a risk frictionless and changing an assessment require approval | Understating a risk is the failure mode that matters; over-reporting is harmless. |

## 6. Alternative Designs

| Alternative | Why rejected |
|---|---|
| A single register combining risks and threats | Different scales and mitigations; merging makes both harder to use. |
| Mitigating every residual to low | Would require either fictional mitigations or reversing accepted decisions such as `ADR-0014` and `ADR-0004`. |
| Ranking by score alone, without residual | A high-scoring, well-mitigated risk would outrank a low-scoring unmitigated one, which inverts where attention should go. |
| Omitting `RR-04` — that players find the neutrality frustrating | It is the product's central premise and its central product risk. Leaving it out would make the register a technical document rather than an honest one. |
| Requiring approval to add a risk | Adds friction to exactly the behaviour that should be encouraged. |

## 7. Process

| Activity | Cadence |
|---|---|
| Review the register | At each release |
| Add a risk | Whenever one is identified; no approval needed to add |
| Change a residual assessment | Requires the owner's agreement |
| Retire a risk | Requires the owner's agreement; the row is struck through, never deleted |
| Escalate | Any risk reaching a residual of High is raised immediately |

Adding a risk is deliberately frictionless and changing an assessment is not: understating a risk is
the failure mode that matters.

---

## 8. Cross References

| Document | Focus |
|---|---|
| `SCOPE_BOUNDARIES.md` | The negative requirements mitigating `RR-01`–`RR-03` |
| `THREAT_MODEL.md` | `T-##` adversarial security threats |
| `PRIVACY_THREAT_MODEL.md` | `PT-##` concealed-tile threats |
| `02_System_Scope.md` | The contracts and validation boundary |
| `25_Testing_Strategy.md` | The suites that mitigate most of this register |
| `27_Deployment_Architecture.md §8` | The seam mitigating `RR-30`, `RR-31` |
| `PROJECT_DESIGN_README.md §9` | Guidance mitigating `RR-50` |

---

## 9. Revision History

| Version | Date | Author | Changes |
|---|---|---|---|
| 0.1 | 2026-09-02 | Design (architect role), owner-approved | Initial register: 33 risks across six categories |
