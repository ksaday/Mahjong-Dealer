# 29 — Disaster Recovery

| | |
|---|---|
| **Project** | American Mahjong Dealer |
| **Document** | 29_Disaster_Recovery.md |
| **Status** | Ratified v0.1 — approved by the project owner, 2026-09-02 |
| **Last Updated** | 2026-09-02 |
| **Role in SSOT** | Owns recovery objectives, failure scenarios, backup and restore, and verification. Does **not** own routine operations (`28`), the deployment topology (`27`), or checkpoint design (`16`). |

---

## 1. Executive Summary

Disaster recovery objectives should reflect what is actually at stake, and here that is unusually
modest: **an in-progress game of Mahjong**. There is no money (`ADR-0003`), no transaction that
cannot be repeated, no regulatory obligation, and no data whose loss causes lasting harm. The worst
realistic outcome is that four people lose an hour and have to deal again — genuinely annoying, and
categorically different from a payment system losing a record.

Stating that plainly is what makes the objectives honest rather than aspirational. A four-nines
target and a five-minute recovery time would be theatre for a service of this kind.

The chapter also contains an unusual inversion. **The most sensitive data has the weakest durability
requirement, on purpose.** Concealed hands live in encrypted checkpoints that are purged when a game
closes (`ADR-0010`), so a regional loss destroys in-flight games — and that is an acceptable outcome
rather than a failure to design around. The durable data is accounts, tables, and a public event log
containing nothing private. Losing a game costs an hour; losing accounts costs the service.

---

## 2. Objectives

Serves `OBJ-05` by making the common failures uneventful, while stating honestly what the uncommon
ones cost.

---

## 3. Recovery objectives

| Scope | RPO — data loss | RTO — restoration | Basis |
|---|---|---|---|
| **Accounts, tables, public log** | ≤ 5 minutes | ≤ 1 hour | Continuous archiving; managed restore |
| **A live game, process restart** | ≤ 1 public action | ≤ 60 seconds | Checkpoints (`NFR-031`); automatic reconnection |
| **A live game, database loss** | The whole game | Not recoverable | Checkpoints are in the lost database |
| **A live game, regional loss** | The whole game | Not recoverable | Accepted (`§5.4`) |
| **The service, regional loss** | ≤ 5 minutes of account data | ≤ 4 hours | Manual restore into another region |

### 3.1 Why in-flight games are expendable

The design chooses this deliberately rather than accepting it reluctantly.

Making a live game survive a regional loss would require replicating checkpoints — the encrypted
private regions containing every concealed hand and the wall order — across regions continuously.
That means concealed material in more places, for longer, crossing more boundaries, to protect
against an event whose cost is that four friends re-deal.

The privacy consideration and the proportionality consideration point the same way, which is why the
answer is easy: keep concealed material in one place with a short life, and accept that a regional
loss ends the games in progress.

---

## 4. What is durable and what is not

| Data | Durability | Loss impact |
|---|---|---|
| Accounts | Continuous archiving, cross-region backup copies | **Severe** — the service's identity layer |
| Tables and seats | Same | Minor — tables are recreated in seconds |
| Public event log | Same | Minor — operational history only |
| Audit log | Same | Moderate — a compliance and security record |
| **Checkpoints** | **In-region only, purged at game close** | An in-flight game is lost |
| Sessions | In-region only | Players log in again |
| Connect tickets | Not backed up | 30-second lifetime |
| Table chat | **Never stored** | Nothing to lose (`FR-131`) |

The inversion is visible in this table: the row with the strongest privacy protection has the
weakest durability, and the row with the strongest durability requirement contains nothing private.

---

## 5. Failure scenarios

### 5.1 Process crash

| Aspect | Detail |
|---|---|
| Detection | Health check, within seconds |
| Response | Automatic restart |
| Player experience | Sockets drop; clients reconnect with backoff; tables restore from checkpoints |
| Loss | At most one public action per table (`NFR-031`) |
| Recovery time | Under 60 seconds |
| Verified by | `TC-F01` |

The most likely scenario and the best-handled. It is also the scenario a planned deploy exercises, so
it is tested continuously in practice as well as in CI.

### 5.2 Database unavailable, briefly

| Aspect | Detail |
|---|---|
| Live play | **Continues** — memory is authoritative (`21 §3.3`) |
| Degraded | Checkpoint writes fail and retry; the loss window grows |
| Unavailable | Login, table creation, joining, ticket minting |
| Response | Restore connectivity; checkpoints resume |

That live play continues through a database outage is a direct consequence of `ADR-0010` and worth
noting as a benefit that was not the primary motivation for it.

### 5.3 Database lost

| Aspect | Detail |
|---|---|
| Response | Restore from continuous archiving to the latest point |
| Loss | Up to 5 minutes of accounts, tables, and public log |
| **In-flight games** | **Lost** — their checkpoints were in the database |
| Player experience | Reconnection fails; the table is gone; sessions may be invalid |
| Recovery time | Under 1 hour |

### 5.4 Region lost

| Aspect | Detail |
|---|---|
| Response | Manual restore into another region from cross-region backup copies |
| Loss | Up to 5 minutes of durable data; **all in-flight games** |
| Recovery time | Under 4 hours |
| Communication | A status page; the four players of each lost game see their table gone |

Manual rather than automatic failover is deliberate. Automatic cross-region failover for a service
whose worst-case loss is an hour of leisure would be complexity and standing cost — including
continuously replicated concealed material — out of all proportion to the risk (`OBJ-11`).

### 5.5 Encryption key lost

| Aspect | Detail |
|---|---|
| Impact | Existing checkpoints are undecryptable; **in-flight games are lost** |
| Not impacted | Accounts, tables, public log — none of it is encrypted with this key |
| Response | Provision a new key version; new games proceed normally |
| Prevention | Versioned keys in the secret manager, with the platform's own durability |

Losing the key destroys exactly the data that is already expendable, which is a fortunate alignment
rather than a designed one — but it does mean key loss is not a service-level disaster.

### 5.6 Data corruption

| Aspect | Detail |
|---|---|
| Detection | Conservation checked at every boundary and on restore (`07 §7.1`) |
| Response | The affected table freezes (`21 §3.4`); other tables are unaffected |
| Recovery | Restore an earlier verified checkpoint, or abandon the game |
| Scope | **One table.** Corruption does not propagate |

Per-table isolation of corruption is a consequence of one actor per table (`05 §6`), and it is the
reason a consistency failure is survivable at all.

---

## 6. Backup and verification

| Property | Design |
|---|---|
| Method | Continuous archiving with point-in-time recovery |
| Retention | 30 days of point-in-time; 90 days of daily snapshots |
| Location | In-region, plus cross-region copies of daily snapshots |
| Encryption | At rest by the platform; private regions additionally encrypted by the application |
| Concealed material | **Usually absent** — purge precedes the backup window (`16 §7`) |

### 6.1 Verification, quarterly

A backup nobody has restored is a hypothesis. The quarterly drill:

1. Restore the most recent daily snapshot into an isolated environment.
2. Confirm the schema version matches the application.
3. Confirm account and table rows are present and consistent.
4. **Start a table actor from a restored checkpoint and confirm the conservation invariant holds.**
5. Confirm no concealed material exists for any concluded game — verifying the purge policy survived
   the backup and restore path.
6. Record the result and the elapsed time; compare against the RTO.

Step 4 is what distinguishes this from a restore that merely completes: it confirms the restored data
is *usable by the application*, not merely present. Step 5 verifies a privacy property through the
backup path, which is the surface most likely to retain material the live system has purged.

---

## 7. Communication

| Scenario | Message |
|---|---|
| Process restart | None needed; reconnection is automatic |
| Database degraded | An in-product notice: new games and logins unavailable |
| Database lost | Status page; in-flight games lost and stated as such |
| Region lost | Status page with an estimated restoration time |
| Corruption on one table | That table's four players see it is unavailable |

The design principle: say what happened and what it cost, including when a game is gone. Players who
lose a game to an outage should be told, not left reconnecting to a table that no longer exists.

---

## 8. Design Decisions

| ID | Decision | Rationale |
|---|---|---|
| D-29-01 | Set objectives against what is actually at stake — an hour of leisure | Four-nines targets for a service with no financial exposure are theatre. |
| D-29-02 | In-flight games are not protected against regional loss | Protecting them means replicating concealed material continuously, to guard against a re-deal. Privacy and proportionality agree. |
| D-29-03 | The most sensitive data has the weakest durability requirement | The inversion is the design: short-lived sensitive data, durable harmless data. |
| D-29-04 | Manual cross-region failover | Automatic failover is standing complexity and cost out of proportion to the risk. |
| D-29-05 | Verification includes starting an actor from a restored checkpoint | A restore that completes is not a restore that works. |
| D-29-06 | Verification includes confirming purge survived the backup path | Backups are the surface most likely to retain purged material. |
| D-29-07 | Corruption is isolated per table | Follows from one actor per table; makes a consistency failure survivable. |
| D-29-08 | Tell players when a game is lost | Better than leaving them reconnecting to nothing. |

---

## 9. Alternative Designs

| Alternative | Why rejected |
|---|---|
| Cross-region checkpoint replication | Continuously replicated concealed hands to guard against a re-deal. |
| Automatic cross-region failover | Complexity and standing cost far exceeding the risk. |
| Synchronous multi-region writes | Latency on every checkpoint for the same non-benefit. |
| Retaining checkpoints after a game concludes | Would improve nothing recoverable and retain concealed material indefinitely. |
| Annual restore verification | Too infrequent to catch a broken backup before it is needed. |
| Restore verification that only checks completion | A completed restore of unusable data is a false assurance. |

---

## 10. Trade-offs

**Regional loss destroys in-flight games.** Accepted, chosen, and communicated.

**Manual failover means a four-hour RTO.** Accepted for a leisure service.

**Concealed material may exist in a backup taken mid-game.** Accepted, encrypted, bounded to the life
of a game, and stated honestly rather than claimed away (`16 §7`).

**Quarterly verification could miss a backup that broke last month.** Accepted, and mitigated by the
verification being substantive when it runs.

---

## 11. Risks

| Risk | Mitigation |
|---|---|
| Backups are not restorable | Quarterly drill with actor start and invariant check |
| Backup retention outlives the purge policy | Retention aligned with the log window; verified in step 5 of the drill |
| The encryption key is lost | Versioned keys in the secret manager; impact limited to in-flight games |
| Recovery procedures are stale | The drill exercises them quarterly; `28 §6` runbooks reviewed with each drill |
| Players are surprised by a lost game | Communicated per `§7`; the in-product help states what is not retained (`D-28-06`) |

---

## 12. Future Considerations

Not committed: a warm standby in a second region if availability expectations rise; automated restore
verification on every daily snapshot rather than quarterly; a status page fed by health checks
automatically.

---

## 13. Cross References

| Document | Focus |
|---|---|
| `16_Data_Architecture.md` | Checkpoints, retention, purge, backups |
| `17_Database_Design.md §7` | Encryption and keys |
| `21_Error_Handling_and_Recovery.md` | The freeze behaviour on corruption |
| `27_Deployment_Architecture.md` | Topology and environments |
| `28_Operations.md` | Runbooks and routine tasks |
| `ADR-0010` | Persistence, and why checkpoints are short-lived |

---

## 14. Revision History

| Version | Date | Author | Changes |
|---|---|---|---|
| 0.1 | 2026-09-02 | Design (architect role), owner-approved | Initial chapter |
