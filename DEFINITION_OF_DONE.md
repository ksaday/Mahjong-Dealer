# Definition of Done

| | |
|---|---|
| **Project** | American Mahjong Dealer |
| **Document** | DEFINITION_OF_DONE.md |
| **Status** | Normative — binding on all implementation |
| **Last Updated** | 2026-09-02 |
| **Role in SSOT** | Owns the eight gates a feature must pass. Does **not** own the requirements (`docs/01`), the test strategy (`docs/25`), or the pipeline (`docs/27 §6`). |

---

## 1. The principle

> **A feature is not done because the code exists and works.**

Working code is one of eight gates. The other seven are the ones that decay quietly: a feature that
works but leaks, that works but is untraceable to a requirement, that works but cannot be diagnosed
when it stops working.

Eight gates, all required. There is no partial credit and no "done except for tests."

---

## 2. Gate 1 — Requirement

| Check | Evidence |
|---|---|
| The feature implements an identified requirement | The `FR-###`, `NFR-###`, or `SEC-###` is named in the change |
| The requirement is traced | A row exists in `REQUIREMENTS_TRACEABILITY_MATRIX.md` |
| Nothing beyond the requirement was built | Reviewer confirms scope |
| No forbidden capability was introduced | Checked against `SCOPE_BOUNDARIES.md §4` |

### 2.1 If no requirement applies

Stop. Either the requirement is missing from `docs/01` — in which case add it through the amendment
process (`docs/00 §12.3`) — or the feature is out of scope.

Code that no requirement calls for is the mechanism by which `RR-01` and `RR-02` occur. Every
instance of scope creep begins with a change nobody asked for that seemed obviously useful.

---

## 3. Gate 2 — Architecture

| Check | Evidence |
|---|---|
| Component placement follows `docs/03 §4.2` | Reviewer confirms |
| The dependency law is respected | Lint gate passes (`NFR-061`) |
| `dealer-core` purity is intact | Lint gate passes (`NFR-060`) |
| The client decides, judges, and authorizes nothing | Reviewer confirms against `C-06` |
| **Every new validation is one of the five in `docs/02 §3.1`** | Reviewer names which |
| **No new branch depends on which face a tile carries** | `TC-A03` passes |
| A new command declares its validations from the closed vocabulary | `docs/10 §3.1` format followed |
| A new wire name is in `docs/19` **before** the code | `TC-P08` passes |

### 3.1 The two checks that matter most

**"Which of the five validations is this?"** — asked of every new check. If the answer is "none of
them," the check is a rule and does not belong in this system (`docs/02 §5.1`).

**"Does this branch on a tile face?"** — the narrowest point at which rule creep is detectable, since
every rule must eventually ask what a tile is (`D-06-04`).

---

## 4. Gate 3 — Security

| Check | Evidence |
|---|---|
| Applicable `SEC-###` requirements are satisfied | Named in the change |
| No new endpoint or frame accepts a seat or player identifier | `TC-I01` passes |
| Authorization derives from the binding or session, never from a request | Reviewer confirms |
| A new endpoint appears in `docs/33_API/REST_Endpoint_Catalog.md` | `TC-A10` passes |
| A new inbound field has a schema validator | `TC-I06` passes |
| A new rate-limited operation has its limit specified | `docs/15 §7` updated |
| A security-critical limit is **durable** | Reviewer confirms it is in PostgreSQL |
| No new secret is in code, configuration, or an image | Repository scan passes |

---

## 5. Gate 4 — Privacy

**Zero tolerance.** No exceptions, no deferrals, no known failures.

| Check | Evidence |
|---|---|
| Every new field is classified `PUB`, `OWN`, or `SRV` | Present in `docs/19 §6` |
| A new client-bound field is added to the projector deliberately | `TC-P01` passes |
| **`TC-P01` frame inspection passes** | Zero leaks across ≥1000 games |
| No new logging, metric, or trace sink accepts unguarded data | `TC-P06` passes |
| **`TC-P03` log scanning passes, including both controls** | Planted violation fires; honest line does not |
| A new event satisfies the public-log invariant | `TC-P04` passes (`docs/16 §6.1`) |
| A new stored field has a stated retention and purge | `docs/16 §6.3` updated |
| No new concealed-material store was created | Reviewer confirms; a new one requires an ADR |
| A new privacy threat is added to `PRIVACY_THREAT_MODEL.md` if one exists | Reviewer confirms |

### 5.1 The new-event check

Adding an event is the most likely way to introduce a leak, because the leak takes the form of a
plausible-looking field. Three things must happen, in order: classify the field in `docs/19 §6`,
confirm the public-log invariant, then implement.

The FrameInspector fails on unrecognized fields (`D-26-02`), so skipping the first step produces a
test failure rather than a silent leak. That is the mechanism working; do not work around it by
adding the field to an allow-list.

---

## 6. Gate 5 — Testing

| Check | Evidence |
|---|---|
| Unit tests cover the mechanics | `TC-M*` extended; core branch coverage 100% |
| Integration tests cover the boundary | `TC-I*` extended where applicable |
| A new invariant has a property test | Reviewer confirms |
| A new negative requirement has an absence check | `TC-A*` extended |
| A new acceptance criterion has an E2E scenario | `TC-E*` extended |
| **No test asserts Mahjong rule correctness** | `TC-A01` passes (`docs/25 §3`) |
| No fixture encodes a rule, pattern, or winning hand | `TC-A01` passes |
| All gate stages pass | Pipeline green |

---

## 7. Gate 6 — Documentation

| Check | Evidence |
|---|---|
| The owning chapter is updated | Reviewer confirms |
| A design decision is recorded as `D-CC-##` | Present in the chapter |
| An architectural decision has an ADR | Present in `docs/31_ADR/` |
| A rejected alternative is recorded | Present in the chapter's Alternative Designs |
| The revision history has a row | Present |
| Cross references in dependent chapters are checked | Reviewer confirms (`docs/00 §12.3` step 3) |
| The traceability matrix is updated | `REQUIREMENTS_TRACEABILITY_MATRIX.md` |
| A wire change updates `docs/19` **first** | `TC-P08` passes |

### 7.1 Recording rejected alternatives

The Alternative Designs table is not ceremony. Six months later, someone will propose the thing that
was rejected, and the table is what prevents the discussion being had again from scratch — or worse,
resolved differently by someone with less context.

---

## 8. Gate 7 — Observability

| Check | Evidence |
|---|---|
| A new failure mode emits a metric | Reviewer confirms |
| A new failure mode that needs response has an alert | `docs/20 §8.1` updated |
| A new alert has a runbook entry | `docs/28 §6` updated |
| Logging is sufficient to diagnose a failure **without private data** | Reviewer confirms against `docs/20 §6` |
| No new metric label carries an identifier or a tile | `TC-P03` passes |
| A new latency-sensitive path has a target and a measurement method | `docs/23` updated |

### 8.1 Diagnosable without private data

The check that requires actual thought. "How would I debug this at 2am, given that I cannot log the
state?" If the answer is "I could not," the feature needs identifiers, counts, or a reproducible
core path before it is done (`docs/20 §6`).

---

## 9. Gate 8 — Error handling

| Check | Evidence |
|---|---|
| Every failure path is classified into `docs/21 §3` | Reviewer confirms |
| A new rejection code is in `docs/33_API/Error_Code_Catalog.md` | `TC-P08` passes |
| A rejection mutates no state | Test confirms |
| A rejection reveals nothing to other seats | `TC-P01` passes |
| The player-facing message names a mechanism, never a rule | Reviewer confirms (`docs/21 §5.2`) |
| A new timeout expires as a **refusal**, never an acceptance | `TC-A08` passes |
| A new fail-safe decision is recorded in `docs/21 §4` | Present |
| The client contract for a new failure is specified | `docs/21 §5` updated |

---

## 10. Checklist

For attaching to a change:

```
Requirement
  [ ] Implements a named FR / NFR / SEC
  [ ] Traced in the matrix
  [ ] Nothing beyond the requirement
  [ ] Checked against SCOPE_BOUNDARIES.md §4

Architecture
  [ ] Placement, dependency law, core purity
  [ ] Client decides nothing
  [ ] Every new validation is one of the five — which: ______
  [ ] No branch on a tile face
  [ ] Wire names in docs/19 first

Security
  [ ] SEC requirements satisfied
  [ ] No seat or player identifier accepted
  [ ] Schema validator for every new field
  [ ] Security-critical limits durable

Privacy  ·  ZERO TOLERANCE
  [ ] Every new field classified in docs/19 §6
  [ ] TC-P01 frame inspection passes
  [ ] TC-P03 log scanning passes, both controls
  [ ] Public-log invariant holds
  [ ] Retention and purge stated
  [ ] No new concealed-material store

Testing
  [ ] Unit, integration, property, absence, E2E as applicable
  [ ] No rule-correctness test; no rule-bearing fixture
  [ ] All gate stages green

Documentation
  [ ] Owning chapter, D-CC-## / ADR, alternatives, revision history
  [ ] Dependent chapters checked
  [ ] Traceability matrix updated

Observability
  [ ] Metric, alert, runbook as applicable
  [ ] Diagnosable without private data
  [ ] No identifier or tile in a metric label

Error handling
  [ ] Failure paths classified
  [ ] Codes catalogued; rejections mutate nothing and leak nothing
  [ ] Messages name mechanisms, not rules
  [ ] Timeouts refuse, never accept
```

---

## 11. Release gates

Beyond per-feature done, a release additionally requires:

| Check | Reference |
|---|---|
| All pipeline stages green, including T3 | `docs/27 §6` |
| Traceability complete in **both** directions | `REQUIREMENTS_TRACEABILITY_MATRIX.md §8` |
| Performance targets met on the reference profile | `docs/23` |
| **Measured** capacity recorded | `NFR-070`, `TC-PF05` |
| Manual screen-reader walkthrough completed | `docs/24 §9` |
| Backup restore verified within the last quarter | `docs/29 §6.1` |
| Risk register reviewed | `docs/30 §5` |
| No `NR-###` violation anywhere | `TC-A*` |

---

## 12. What this document does not permit

| Not permitted | Because |
|---|---|
| "Tests to follow" | Gate 5 is not optional |
| "Privacy check deferred" | Zero tolerance; no known failures |
| "Documentation later" | The documentation is the specification (`C-11`) |
| "Temporary rule check, to be removed" | `NR-001`; there is no temporary violation of a constitutional constraint |
| "Debug logging, to be removed before release" | It will not compile (`SEC-070`) |
| "Skip T3 to unblock" | Requires an amendment and the owner's approval (`RR-52`) |

The last two are worth noting as design successes: neither is a rule that must be enforced, because
neither is possible. Debug logging of a hand does not compile, and there is no configuration that
skips a pipeline stage.

---

## 13. Cross References

| Document | Focus |
|---|---|
| `docs/01_Product_Requirements.md` | The requirements Gate 1 refers to |
| `docs/02_System_Scope.md §3.1`, `§5` | The five validations Gate 2 refers to |
| `SCOPE_BOUNDARIES.md §4` | The negative requirements every gate checks against |
| `docs/25_Testing_Strategy.md` | Gate 5's suites |
| `docs/00_Project_Overview.md §12.3` | The amendment process Gate 6 refers to |
| `REQUIREMENTS_TRACEABILITY_MATRIX.md` | Traceability for Gates 1 and 6 |
| `IMPLEMENTATION_READINESS_CHECKLIST.md` | What must be true before any of this begins |

## 14. Revision History

| Version | Date | Author | Changes |
|---|---|---|---|
| 0.1 | 2026-09-02 | Design (architect role), owner-approved | Initial definition: 8 gates |
