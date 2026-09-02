# Requirements Traceability Matrix

| | |
|---|---|
| **Project** | American Mahjong Dealer |
| **Document** | REQUIREMENTS_TRACEABILITY_MATRIX.md |
| **Status** | Normative — binding on all implementation |
| **Last Updated** | 2026-09-02 |
| **Role in SSOT** | Owns the mapping from every requirement to its design document, component, and tests. Does **not** own the requirements themselves (`docs/01`, `SCOPE_BOUNDARIES.md`, `SECURITY_REQUIREMENTS_MATRIX.md`). |

---

## 1. Purpose

This matrix answers two questions, in both directions.

**Forward** — "I have a requirement. Where is it designed, what implements it, and what proves it
works?"

**Backward** — "I am looking at this code. What requirement does it implement?" An implementer who
cannot answer that for a module they are writing should stop and find out why.

Both directions are checked as part of the definition of done (`DEFINITION_OF_DONE.md §4`). A
requirement resolving to no component, or a component tracing to no requirement, is a defect in one
or the other.

### 1.1 Components

Short names used throughout:

| Name | Package | Contents |
|---|---|---|
| `shared` | `shared` | Protocol, branded types, tile codec, schemas |
| `core` | `dealer-core` | Pure table mechanics, projector, checkpoints |
| `auth` | `server` | Registration, login, sessions, tickets |
| `tables` | `server` | Table lifecycle, seating, codes |
| `actor` | `server` | The table actor and command pipeline |
| `gateway` | `server` | Socket binding, framing, backpressure, resumption |
| `persist` | `server` | Checkpoints, event log, purge |
| `admin` | `server` | Administrative endpoints |
| `obs` | `server` | Logging, metrics, tracing, redaction |
| `web` | `web` | Client rendering and input |
| `db` | `db` | Schema, constraints, migrations |
| `tools` | `tools` | Governance checks |

---

## 2. Functional requirements

| Req | Design | Component | Test | Acceptance |
|---|---|---|---|---|
| FR-001 – FR-008 | `docs/04 §3`, `docs/15 §4`, `docs/18 §4.1` | `auth`, `db` | `TC-S01`, `TC-S02`, `TC-S06`, `TC-S07` | AC-001 |
| FR-020 – FR-022 | `docs/05 §5`, `docs/18 §4.2` | `tables`, `db` | `TC-S09`, `TC-E02` | AC-002, AC-003 |
| FR-023 – FR-024 | `docs/05 §5`, `docs/17 §5.5` | `tables`, `db` | `TC-I01`, `TC-S11` | AC-002, AC-003 |
| FR-025 – FR-027 | `docs/05 §5.1`, `§5.2` | `tables`, `actor` | `TC-E04` | AC-004 |
| FR-028 – FR-029 | `docs/05 §4.1`, `docs/18 §4.2` | `tables` | `TC-P02` | AC-002 |
| FR-030 | `docs/05 §5.1`, `docs/18 §5` | — **absence** | `TC-A10` | AC-003 |
| FR-040 – FR-041 | `docs/07 §3`, `§5` | `core`, `shared` | `TC-M02` | AC-006 |
| FR-042 – FR-044 | `docs/08 §4`, `§5` | `core`, `actor` | `TC-R01`–`TC-R07` | AC-005 |
| FR-045 | `docs/07 §4`, `docs/08 §7.1` | `core` | `TC-M02`, `TC-E06` | AC-006 |
| FR-046 | `docs/07 §4` | — **absence** | `TC-A04` | AC-006 |
| FR-047 | `docs/14 §5` | `core` | `TC-P01` | AC-006, AC-010 |
| FR-048 – FR-049 | `docs/07 §8`, `docs/14 §4` | `core` | `TC-P01` | AC-006 |
| FR-050 | `docs/06 §4.4` | `core` | `TC-M04` | — |
| FR-060 – FR-062 | `docs/10 §5.1` | `core`, `actor` | `TC-M06`, `TC-P01` | AC-007 |
| FR-063 – FR-065 | `docs/10 §5.2` | `core`, `actor` | `TC-M04` | AC-008 |
| FR-064 | `docs/02 §5`, `docs/10 §5.2` | — **absence** | `TC-A03`, `TC-A04` | AC-008 |
| FR-066 – FR-069 | `docs/10 §5.3` | `core`, `actor` | `TC-I08`, `TC-M06` | AC-011 |
| FR-070 – FR-073 | `docs/10 §5.4`–`§5.6` | `core` | `TC-M04`, `TC-A04` | — |
| FR-074 | `docs/13 §7` | `actor` | `TC-I02` | AC-017 |
| FR-075 – FR-077 | `docs/09 §6`, `docs/10 §4` | `actor`, `core` | `TC-M06` | AC-011 |
| FR-090 – FR-098 | `docs/10 §6` | `core`, `actor` | `TC-M07`, `TC-A04` | — |
| FR-100 – FR-105 | `docs/10 §5.7`, `docs/11 §6` | `core`, `web` | `TC-A09`, `TC-PF02` | AC-009 |
| FR-103 | `docs/11 §12` | — **absence** | `TC-A09` | AC-009 |
| FR-110 – FR-118 | `docs/10 §7`, `docs/09 §4.3` | `core`, `actor`, `persist` | `TC-M04`, `TC-P04` | AC-015 |
| FR-120 – FR-127 | `docs/05 §8`, `docs/08 §7.2` | `core`, `actor`, `persist` | `TC-M09`, `TC-R08` | AC-016 |
| FR-126 | `docs/05 §8.3` | — **absence** | `TC-A08` | AC-016 |
| FR-130 – FR-135 | `docs/05 §9` | `actor`, `gateway`, `web` | `TC-P03`, `TC-P04` | — |
| FR-140 – FR-150 | `docs/22` | `gateway`, `actor`, `persist` | `TC-F01`–`TC-F07` | AC-012, AC-013, AC-014 |
| FR-148 | `docs/22 §8` | — **absence** | `TC-A08` | AC-012 |
| FR-160 – FR-166 | `docs/04 §3.3`, `docs/18 §4.3`, `docs/28 §3` | `admin` | `TC-S15` | AC-017 |
| FR-164 | `docs/04 §3.3` | — **absence** | `TC-P02` | AC-010 |

Rows marked **absence** in the Component column are requirements satisfied by something not being
built. They still have designs, tests, and acceptance criteria.

---

## 3. Non-functional requirements

| Req | Design | Component | Test |
|---|---|---|---|
| NFR-001 – NFR-003 | `docs/11 §10`, `docs/23 §4` | `web` | `TC-PF01` |
| NFR-002 | `docs/11 §5.2`, `docs/23 §4` | `web` | `TC-PF02` |
| NFR-004 – NFR-005 | `docs/23 §5` | `actor`, `gateway`, `web` | `TC-PF04` |
| NFR-006 – NFR-007 | `docs/23 §5` | `core` | `TC-PF03` |
| NFR-008 | `docs/22 §7`, `docs/23 §5` | `gateway`, `web` | `TC-F03` |
| NFR-010 | `docs/14 §4`, `§5` | `core` | `TC-P01` |
| NFR-011 | `docs/20 §5` | `obs` | `TC-P03` |
| NFR-012 – NFR-013 | `docs/16 §5`, `docs/17 §7` | `persist`, `db` | `TC-P04` |
| NFR-014 | `docs/14 §6` | `shared`, `obs` | `TC-P06` |
| NFR-020 | `docs/12 §7`, `docs/22 §4` | `gateway` | `TC-F02` |
| NFR-021 – NFR-023 | `docs/13 §4`–`§8` | `actor`, `gateway` | `TC-I04`–`TC-I06` |
| NFR-024 | `docs/07 §7` | `core` | `TC-M01` |
| NFR-025 | `docs/08 §4.2` | `core` | `TC-R03` |
| NFR-026 | `docs/12 §4.3`, `docs/15 §4.2` | `gateway`, `auth` | `TC-S03` |
| NFR-030 – NFR-032 | `docs/16 §5` | `persist`, `actor` | `TC-F01` |
| NFR-040 – NFR-044 | `docs/15 §6`, `§9` | Deployment | `TC-S13`, `TC-S16` |
| NFR-042 | `docs/13 §7` | — **absence** | `TC-I01` |
| NFR-050 – NFR-053 | `docs/24` | `web` | `TC-X01`–`TC-X08` |
| NFR-060 – NFR-061 | `docs/03 §4.1`, `§5` | `tools` | Lint gate |
| NFR-062 | `docs/14 §5` | `tools` | `TC-P07` |
| NFR-063 | `docs/19 §9` | `tools` | `TC-P08` |
| NFR-070 – NFR-073 | `docs/23 §6` | — | `TC-PF05` |

---

## 4. Negative requirements

The `NR-###` catalog in `SCOPE_BOUNDARIES.md §4`, traced. **Every row's Component is deliberately
empty** — that is what a negative requirement means.

| Req | Design | Test |
|---|---|---|
| NR-001 – NR-013 | `docs/02 §3.2`, `§5`; `ADR-0002` | `TC-A01`–`TC-A05` |
| NR-009 | `docs/07 §4` | `TC-A04` |
| NR-011 | `docs/05 §7` | `TC-A05` |
| NR-101 – NR-109 | `ADR-0003`; `docs/17 §8` | `TC-A06` |
| NR-201 – NR-211 | `docs/11 §12`; `ADR-0004` | `TC-A07`, `TC-A08` |
| NR-301 – NR-306 | `docs/11 §6`, `§12` | `TC-A09` |
| NR-401 – NR-407 | `docs/04 §3.4`; `ADR-0004` | `TC-A10`, `TC-P02` |
| NR-501 – NR-510 | `docs/14`; `ADR-0006`, `ADR-0013` | `TC-P01`–`TC-P06` |
| NR-508 | `ADR-0012` | `TC-A11` |
| NR-601 – NR-606 | `docs/12 §4.2`, `docs/13 §7` | `TC-I01`–`TC-I03`, `TC-R01`, `TC-R02` |

---

## 5. Security requirements

The `SEC-###` catalog in `SECURITY_REQUIREMENTS_MATRIX.md` carries its own enforcement point and
verification per row. Summarized by group:

| Group | Design | Component | Test |
|---|---|---|---|
| SEC-0xx authentication | `docs/15 §4.1` | `auth`, `db` | `TC-S01`–`TC-S05` |
| SEC-01x sessions | `docs/15 §4.2` | `auth`, `gateway` | `TC-S03`, `TC-S06`–`TC-S08` |
| SEC-02x isolation | `docs/15 §5` | `gateway`, `tables`, `db` | `TC-I01`, `TC-S09`–`TC-S12` |
| SEC-03x hand privacy | `docs/14` | `core`, `persist` | `TC-P01`–`TC-P07` |
| SEC-04x input integrity | `docs/13` | `actor`, `gateway` | `TC-I02`–`TC-I08` |
| SEC-05x randomization | `docs/08` | `core`, `actor` | `TC-R01`–`TC-R08` |
| SEC-06x transport | `docs/15 §6` | Deployment, `web` | `TC-S13`, `TC-S14`, `TC-P05` |
| SEC-07x logging privacy | `docs/20` | `shared`, `obs` | `TC-P03`, `TC-P06` |
| SEC-08x administration | `docs/04 §3.3` | `admin` | `TC-P02`, `TC-S15` |
| SEC-09x secrets and supply chain | `docs/15 §9`, `§10` | Deployment, `tools` | `TC-S16`, pipeline |

---

## 6. Reverse index — component to requirement

The backward direction. If a component is doing something not listed here, ask why.

| Component | Implements |
|---|---|
| `shared` | Protocol (`NFR-063`); branded types (`NFR-014`, `SEC-070`); tile codec (`FR-041`); schemas (`NFR-023`) |
| `core` | Tile set (`FR-040`–`FR-041`); shuffle and deal (`FR-042`–`FR-047`); movement (`FR-060`–`FR-098`); order preservation (`FR-101`, `NR-301`–`NR-306`); projection (`FR-047`, `NFR-010`); conservation (`NFR-024`); checkpoints (`NFR-030`); rewind (`FR-122`–`FR-124`) |
| `auth` | `FR-001`–`FR-008`; `SEC-0xx`, `SEC-01x` |
| `tables` | `FR-020`–`FR-030`; `SEC-021`–`SEC-023` |
| `actor` | Command pipeline (`FR-075`, `NFR-021`–`NFR-023`); turn (`FR-076`–`FR-077`); pass rounds (`FR-090`–`FR-098`); conclusion (`FR-110`–`FR-118`); correction (`FR-120`–`FR-127`); pause (`FR-142`, `FR-146`); `SEC-04x` |
| `gateway` | Binding (`SEC-024`–`SEC-028`); framing (`NFR-022`); backpressure; heartbeats (`NFR-020`); resumption (`FR-145`, `NFR-008`); revocation (`NFR-026`) |
| `persist` | Checkpoints (`NFR-030`–`NFR-032`); event log (`FR-125`); purge (`FR-118`, `NFR-013`); encryption (`NFR-012`) |
| `admin` | `FR-160`–`FR-166`; `SEC-08x` |
| `obs` | `NFR-011`; `SEC-07x` |
| `web` | Interaction (`FR-100`–`FR-105`, `NFR-001`–`NFR-003`); rendering; accessibility (`NFR-050`–`NFR-053`) |
| `db` | Constraints (`FR-024`, `SEC-026`); encryption (`NFR-012`); privilege (`SEC-035`); append-only (`SEC-082`) |
| `tools` | `NFR-060`–`NFR-063`; `TC-A*` static checks; `TC-P07`, `TC-P08` |

---

## 7. Acceptance criteria coverage

Every `AC-###` in `docs/01 §7` maps to an E2E scenario one-to-one (`docs/25 §5.9`).

| AC | Scenario | Also verified by |
|---|---|---|
| AC-001 registration and login | `TC-E01` | `TC-S01`, `TC-S02` |
| AC-002 four-player table | `TC-E02` | `TC-S11` |
| AC-003 table joining | `TC-E03` | `TC-S09`, `TC-A10` |
| AC-004 ready state | `TC-E04` | `TC-M04` |
| AC-005 shuffle | `TC-E05` | `TC-R01`–`TC-R07` |
| AC-006 deal | `TC-E06` | `TC-M02`, `TC-P01` |
| AC-007 draw | `TC-E07` | `TC-M06`, `TC-P01` |
| AC-008 discard | `TC-E08` | `TC-A03`, `TC-A04` |
| AC-009 tile movement | `TC-E09` | `TC-A09`, `TC-PF02` |
| AC-010 tile privacy | `TC-E10` | `TC-P01`–`TC-P05` |
| AC-011 turn synchronization | `TC-E11` | `TC-M06`, `TC-I08` |
| AC-012 disconnect | `TC-E12` | `TC-F02` |
| AC-013 reconnect | `TC-E13` | `TC-F03`, `TC-F04` |
| AC-014 crash recovery | `TC-E14` | `TC-F01` |
| AC-015 game completion | `TC-E15` | `TC-P04` |
| AC-016 correction | `TC-E16` | `TC-M09`, `TC-R08` |
| AC-017 security | `TC-E17` | `TC-I01`, `TC-I02` |
| AC-018 input integrity | `TC-E18` | `TC-I04`–`TC-I07` |

---

## 8. Coverage summary

| Category | Count | Traced | Untraced |
|---|---|---|---|
| Functional (`FR`) | 104 | 104 | 0 |
| Non-functional (`NFR`) | 44 | 44 | 0 |
| Negative (`NR`) | 62 | 62 | 0 |
| Security (`SEC`) | 75 | 75 | 0 |
| Acceptance (`AC`) | 18 | 18 | 0 |

Every requirement resolves to at least one design section and at least one test case. This
completeness is a **release gate**: the matrix is regenerated and checked before release, and any
untraced requirement blocks it (`DEFINITION_OF_DONE.md §4`).

---

## 9. Maintenance

| When | Do |
|---|---|
| A requirement is added | Add its row before implementing |
| A requirement changes | Update the row and re-verify its tests |
| A requirement is retired | Strike through; never delete |
| A component is added | Add it to `§1.1` and `§6` |
| Before every release | Regenerate and check both directions |

---

## 10. Cross References

| Document | Focus |
|---|---|
| `docs/01_Product_Requirements.md` | `FR`, `NFR`, `AC` |
| `SCOPE_BOUNDARIES.md §4` | `NR` |
| `SECURITY_REQUIREMENTS_MATRIX.md` | `SEC` with enforcement points |
| `docs/25_Testing_Strategy.md` | The suite catalog |
| `DEFINITION_OF_DONE.md` | Where this matrix is a gate |

## 11. Revision History

| Version | Date | Author | Changes |
|---|---|---|---|
| 0.1 | 2026-09-02 | Design (architect role), owner-approved | Initial matrix: 303 requirements traced, both directions |
