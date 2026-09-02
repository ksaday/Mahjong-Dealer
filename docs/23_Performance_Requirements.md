# 23 — Performance Requirements

| | |
|---|---|
| **Project** | American Mahjong Dealer |
| **Document** | 23_Performance_Requirements.md |
| **Status** | Ratified v0.1 — approved by the project owner, 2026-09-02 |
| **Last Updated** | 2026-09-02 |
| **Role in SSOT** | Owns every performance target, its justification, and its measurement method. Does **not** own the interaction design (`11`), the transport (`12`), or capacity planning for scale (`27`). |

---

## 1. Executive Summary

Every target in this chapter carries a **justification** and a **measurement method**. Neither is
optional, and the reason is the failure mode this chapter exists to prevent: numbers invented to look
rigorous. A target with no basis gets missed and quietly abandoned; a target with no measurement
method cannot be missed at all, because nobody can tell.

The targets derive from three sources rather than from preference. **Human perception research**
gives the thresholds that matter: roughly 100ms for an action to feel instantaneous, roughly 1s
before a user notices a delay, roughly 10s before attention is lost. **Physical measurement** gives
the frame budget: 16.7ms at 60Hz. And **the actual workload** gives the server budgets, and it is
tiny — a shuffle over 152 elements, a projection of a few kilobytes, four connections per table.

The most important structural decision is the split between **free** and **binding** acts (`11 §5`).
A free act — rearranging a rack — is local and must never wait for a network, so its budget is a
frame budget and the network is irrelevant. A binding act must wait for the server, so its budget is
a round trip. Conflating them would either make rearranging feel remote or make a discard appear to
happen before it did.

All network figures are stated for **same-region play**, honestly. Four players spread across
continents will exceed them, and no client design repairs the speed of light. The design fails
gracefully: free acts stay instant regardless.

---

## 2. Objectives

Serves `OBJ-03` — interaction fast, precise, and predictable enough that players stop thinking about
the interface.

---

## 3. Reference conditions

Targets are meaningless without stated conditions.

| Condition | Value |
|---|---|
| Client device | A five-year-old laptop or mid-range tablet; 4× CPU throttling in automated measurement |
| Client browser | Current versions of the two most-used engines |
| Network, same region | 20–40ms round trip, 20Mbps |
| Network, cross-region | 150–250ms round trip — targets marked as exceeded |
| Table load | 4 connections; concurrent tables per the capacity model in `27` |
| Hand size | Up to 20 tiles typical; measured to 40, since hand size is unbounded (`NR-009`) |

---

## 4. Client-side targets

| ID | Target | Value | Justification | Measured as |
|---|---|---|---|---|
| NFR-001 | Free-act first paint | ≤ 50 ms | Well inside the ~100 ms "instantaneous" threshold, leaving headroom on a throttled device | Performance trace from pointer event to paint; p95 over 100 interactions |
| NFR-001a | Drag frame rate | 60 fps sustained, no frame > 32 ms | 16.7 ms is the 60 Hz budget; a single doubled frame is visible as a stutter during a drag | Frame timing during a scripted 3-second drag; worst frame recorded |
| NFR-002 | Free-act network round trips | **0** before the visual result | A player rearranging tiles while thinking must never wait (`FC-3`) | Static assertion on the code path plus a network-log check during reorder |
| NFR-003 | Binding-act pending feedback | ≤ 50 ms from pointer release | The player must know the action registered before the server can possibly answer | Performance trace to the pending state |
| NFR-051a | Time to interactive, cold | ≤ 3 s | Below the ~10 s attention threshold with wide margin; a table is entered deliberately | Lighthouse-equivalent on the reference profile |
| NFR-051b | Table render after a snapshot | ≤ 200 ms | A reconnecting player should see the table effectively immediately | Trace from snapshot receipt to paint complete |

### 4.1 Why the worst frame, not the average

A drag averaging 60 fps with one 50ms frame feels broken, because the stutter is precisely where the
pointer is. Averages hide the artifact that matters, so the target names the worst frame.

---

## 5. Server-side targets

The server budgets are small because the work is small. Stating why prevents them being loosened
later on the assumption they were arbitrary.

| ID | Target | Value | Justification | Measured as |
|---|---|---|---|---|
| NFR-006 | `dealer-core` command processing | p95 ≤ 5 ms | Array manipulation over ≤ 152 elements with no I/O. 5 ms is generous and makes core time negligible against any network | Microbenchmark in CI on a fixed runner |
| NFR-007 | Shuffle + deal + four projections | p95 ≤ 20 ms | A 152-element shuffle, a hash, and four small projections. The heaviest single operation in the system | Same |
| NFR-004 | Binding-act acknowledgement | p95 ≤ 150 ms, p99 ≤ 300 ms, same region | 40 ms network + 5 ms core + framing overhead ≈ 60 ms expected; 150 ms allows 2.5× for variance | Server span from frame receipt to acknowledgement, plus synthetic client round-trip |
| NFR-005 | Event propagation to all four clients | p95 ≤ 250 ms to the **last** client | The slowest client determines when the table looks consistent | Four-client synthetic table; timestamp at each client's paint |
| NFR-008 | Reconnection to playable | p95 ≤ 2 s | Ticket round trip + socket handshake + snapshot + render ≈ 700 ms expected; 2 s absorbs a retry | Synthetic reconnection in the E2E suite |
| NFR-032 | Checkpoint write added latency | 0 ms at p95 | Asynchronous by design; any measurable addition means it has entered the critical path | Compare `NFR-004` with checkpointing disabled |
| NFR-030a | Actor restore from checkpoint | p95 ≤ 500 ms | Decrypt, deserialize, verify conservation. Bounds the pause after a restart | Kill-and-restore timing (`TC-F01`) |

### 5.1 Propagation is measured at the last client

A table is only consistent when all four clients agree. Measuring the mean would hide the case where
one player is a second behind — which is exactly the case that produces a mis-click on a stale view.

---

## 6. Capacity

| ID | Target | Value | Justification | Measured as |
|---|---|---|---|---|
| NFR-070 | Concurrent tables per process | ≥ 500 with all targets met | Each table is 4 connections and a few tens of kilobytes; the constraint is connections and memory, not CPU | Load test ramping tables until a target degrades |
| NFR-071 | Memory per live table | ≤ 500 KB | State plus a 200-event backlog | Heap sampling under load |
| NFR-072 | Actions per table per hour | ~400 typical, 1000 upper bound | A one-hour game of four players at observed pace | Instrumented from real play |
| NFR-073 | Database writes per table per hour | ≤ 2000 | One checkpoint and one event per public action, plus purges | Query metrics under load |

`NFR-070` is deliberately measured rather than assumed, because it is the input to the multi-node
trigger in `ADR-0014`. A trigger set at 60% of a guessed capacity is not a trigger.

---

## 7. Privacy and integrity have no performance exemption

Stated explicitly because it is the trade-off most likely to be proposed under deadline.

| Control | Cost | Stance |
|---|---|---|
| Four separate projections per event | 4× serialization of a few kilobytes | **Never** replaced by a shared payload (`D-12-01`) |
| Conservation check per transition | A multiset comparison over 152 elements | **Never** disabled in production (`D-07-09`) |
| Checkpoint encryption | One symmetric operation off the critical path | **Never** skipped |
| Unbiased rejection sampling | Expected < 2 retries per draw | **Never** replaced by modulo (`D-08-02`) |
| Full view per event rather than deltas | A few kilobytes per event | **Never** replaced by client-side derivation (`D-12-05`) |

Each cost is negligible at this scale, which is what makes the stance easy to hold. If any becomes
material, the answer is to reduce load elsewhere, not to weaken the control.

---

## 8. Degradation

| Condition | Behaviour |
|---|---|
| Network slow but stable | Free acts unaffected; binding acts show pending longer; a waiting indicator after 1 s |
| Acknowledgement > 5 s | Connection banner; the tile stays in its pending position, never speculatively moved |
| Connection lost | Reconnection with backoff; the table pauses for the other three (`22 §5`) |
| Server under load | Rate limits throttle before latency degrades; `notice { rate_limit_warning }` |
| Cross-region play | Targets exceeded and stated as such; the interface remains correct, just slower |

The tile never moves speculatively. A player must never see a discard that has not happened
(`D-11-09`), whatever the latency.

---

## 9. Design Decisions

| ID | Decision | Rationale |
|---|---|---|
| D-23-01 | Every target has a justification and a measurement method | An unjustified target gets abandoned; an unmeasurable one cannot be missed. |
| D-23-02 | Separate budgets for free and binding acts | Conflating them makes rearranging feel remote or a discard appear premature. |
| D-23-03 | Free acts have a target of zero network round trips | Stronger and more checkable than a latency figure. |
| D-23-04 | Drag measured by worst frame, not average | The stutter is where the pointer is; averages hide it. |
| D-23-05 | Propagation measured at the last of four clients | A table is consistent only when all four agree. |
| D-23-06 | Targets stated for same-region play, with the limitation named | Honest, and it makes cross-region expectations explicit rather than a surprise. |
| D-23-07 | Capacity measured, not assumed | It is the input to the multi-node trigger (`ADR-0014`). |
| D-23-08 | Privacy and integrity controls have no performance exemption | Each cost is negligible; naming the stance forestalls the deadline argument. |
| D-23-09 | Measurement on a throttled reference device | Targets met only on a developer's machine are not met. |
| D-23-10 | Hand-size measurement to 40 tiles | Hand size is unbounded (`NR-009`), so the rack must be tested beyond the typical. |

---

## 10. Alternative Designs

| Alternative | Why rejected |
|---|---|
| Round percentage targets (99.9% under 100 ms) | Precision without basis; the figures here derive from perception thresholds and measured work. |
| Averages rather than percentiles | Hide the outliers players actually notice. |
| Targets on developer hardware | Not representative. |
| Global latency targets | Would either be unachievably tight or meaninglessly loose. |
| Optimistic binding acts to hide latency | Shows a public act that may not have happened. |
| Deltas to reduce bandwidth | Bandwidth is not the constraint; client-side derivation is a correctness risk. |
| Disabling conservation checks in production | The check catches exactly the corruption that matters most. |

---

## 11. Trade-offs

**Binding acts are network-bound and will feel slower than free acts.** Accepted and made explicit
in the interaction design: the pending state tells the player the action registered.

**Same-region targets mean geographically dispersed groups get a worse experience.** Accepted and
documented rather than hidden.

**Measuring on throttled hardware makes targets harder to meet.** Accepted: that is the point.

**500 tables per process is modest.** Accepted: it is the honest single-process figure, and `27 §8`
specifies the seam.

---

## 12. Risks

| Risk | Mitigation |
|---|---|
| A target is loosened without revisiting its justification | Each target names its basis; a change is an amendment |
| A privacy control is traded for latency | `§7`; the definition of done requires the controls |
| Free acts acquire a network dependency | `NFR-002` is a static assertion, not a latency measurement |
| Measured capacity is never established | `NFR-070` is a required load test before release (`IMPLEMENTATION_READINESS_CHECKLIST.md`) |
| Cross-region play is reported as a defect | Documented limitation; the interface degrades gracefully |

---

## 13. Future Considerations

Not committed: regional deployment to reduce cross-region latency; a client-side latency indicator so
players can see when the network rather than the table is slow; binary framing if message size ever
becomes material.

---

## 14. Cross References

| Document | Focus |
|---|---|
| `11_Tile_Interaction_UX.md §10` | Latency and feedback in the interaction design |
| `12_Realtime_WebSocket_Architecture.md` | Transport and backpressure |
| `01_Product_Requirements.md §6.1` | The `NFR-###` catalog |
| `27_Deployment_Architecture.md §8` | Capacity and the multi-node seam |
| `26_Test_Architecture.md` | The measurement harness |
| `ADR-0014` | Why capacity matters to the topology decision |

---

## 15. Revision History

| Version | Date | Author | Changes |
|---|---|---|---|
| 0.1 | 2026-09-02 | Design (architect role), owner-approved | Initial chapter |
