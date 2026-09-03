# 28 — Operations

| | |
|---|---|
| **Project** | American Mahjong Dealer |
| **Document** | 28_Operations.md |
| **Status** | Ratified v0.2 — approved by the project owner, 2026-09-03 |
| **Last Updated** | 2026-09-03 |
| **Role in SSOT** | Owns operational procedures: administration, monitoring response, runbooks, and the support model. Does **not** own the deployment topology (`27`), disaster recovery (`29`), or the observability surface (`20`). |

---

## 1. Executive Summary

Operations here is shaped by a constraint most services do not have: **the operator cannot look at
the thing users are doing.** There is no administrative view of a live table, no path to a concealed
hand, and no replay (`04 §3.3`, `ADR-0012`). An operator investigating a report can see that a table
exists, who is connected, what sequence it is at, and what public actions occurred — and nothing
else.

That is a deliberate trade, and this chapter is largely about making it workable. Two things make it
so. The **public event log** answers "what happened" for almost every real question without
containing anything private (`16 §6`). And the **deterministic core** means a mechanical defect is
reproducible from a unit test rather than from a production artifact (`20 §6.1`).

The support model follows from the same constraint and should be stated plainly to users: some
questions have no answer. "What tiles did I have last game?" cannot be answered by anyone, including
the operator, because the data no longer exists. That is the privacy guarantee working, not a gap in
support, and the interface says so rather than implying an answer might be found.

Two alerts in this chapter are unusual in being **privacy alerts at the highest severity**: a
conservation violation and a redaction event in production. Both mean the system is wrong in a way
that continuing would compound.

---

## 2. Objectives

Serves `OBJ-06` by ensuring operations creates no privileged path to player data, and `OBJ-05` by
making recovery routine.

---

## 3. Administration

Capabilities are exactly those in `04 §4`. The operational notes on each:

| Task | Procedure |
|---|---|
| Provision an administrator | Out of band, at deploy time; never self-registration. Requires a second factor before first use (`§3.1`) |
| Disable an account | `PATCH /admin/accounts/{id}` with a mandatory reason; revokes every session immediately |
| Investigate a report | Public event log by `tableId` and `seq`; account metadata; audit log. **No game content** |
| Force-close a stuck table | `POST /admin/tables/{id}/force-close` with a reason; participants notified; concealed material purged |
| Review the audit log | `GET /admin/audit`; authentication and administrative events only |
| Check health | `GET /admin/health` |

Every administrative action carries a **mandatory reason** and is audited (`FR-166`). The reason is
required by the endpoint rather than by policy, so an unexplained administrative action is not
possible rather than merely discouraged.

### 3.1 Provisioning an administrator (`15 §8.1`–`§8.2`, `ADR-0017`)

A provisioning script — not a REST endpoint, per `ADR-0017`'s decision that enrollment is
out-of-band, matching account creation itself — performs the whole procedure in one act:

1. Generate a 160-bit TOTP secret and create the account (`role: administrator`) with it, encrypted,
   in a single transaction. There is no window where the account exists without its second factor.
2. Display the secret once — as an `otpauth://` URI, a QR code, or both — to whoever is running the
   script. Nothing is written to a log, and the plaintext secret is never stored or transmitted again.
3. Hand the secret to the administrator through a separate out-of-band channel from the one used to
   tell them their account exists (the same discipline `04 §3.3` already applies to the account
   itself).

The administrator's first `POST /sessions` succeeds on password alone, as it does for anyone, but the
resulting session cannot reach `/admin/*` until `POST /sessions/mfa` is called with a code from the
authenticator app or device the secret was loaded into.

### 3.2 A lost TOTP device

There is no self-service recovery and no recovery codes (`ADR-0017`). Disable the account
(`PATCH /admin/accounts/{id}`, above) and provision a fresh one (`§3.1`). This is the same procedure
that handles a compromised account, applied for a different reason — not a new capability.

### 3.3 What an operator cannot do

Restated because it is the defining operational constraint: view a concealed hand, view a live
table's tiles, read table chat, occupy a seat, act at a table, impersonate a player, or recover a
concluded game's contents. None of these is a guarded capability — none exists (`§1`).

---

## 4. Monitoring

Metrics per `20 §8`. The dashboards an operator actually needs:

| Dashboard | Contents |
|---|---|
| **Service health** | Process liveness, database reachability, error rate, latency percentiles |
| **Table activity** | Live tables, live connections, actions per minute, resumption mode split |
| **Integrity** | **Conservation violations**, checkpoint failures, purge failures, restore failures |
| **Privacy** | **Redaction events**, scanner results from the last pipeline run |
| **Security** | Authentication failures, lockouts, rate-limit hits, bind failures |

The Integrity and Privacy dashboards exist because those failures are silent by nature. A latency
regression is felt by users; a purge failure is felt by nobody until it matters.

---

## 5. Alerts and response

| Alert | Severity | First response |
|---|---|---|
| **Conservation violation** | Critical, page | The table is frozen (`21 §3.4`). Do **not** restart. Capture state, then restore an earlier verified checkpoint or abandon the game |
| **Redaction fired in production** | Critical, page | A code path is leaking. Identify it from the anomaly context, patch, and assess what reached the log store |
| Purge failure | High, page | Concealed material is being retained. Retry manually; verify; if persistent, disable new games until resolved |
| Process down | High, page | Restart. Tables restore from checkpoints. Confirm all four clients of affected tables reconnect |
| Checkpoint failure rate rising | High | Play continues (`21 §3.3`) but the loss window is growing. Investigate database health |
| Database unreachable | High, page | Live play continues; new games and logins fail. Restore connectivity |
| Restore verification failure | High | One table unavailable. Investigate the checkpoint; the game may need abandoning |
| Authentication failure spike | Medium | Assess whether it is credential stuffing; lockouts are already engaged |
| Rejection rate abnormal | Medium | Likely a client defect; correlate by `cmd` and `code` |
| Backpressure closes rising | Medium | Network conditions or a slow client; check for a pattern by account |

### 5.1 Do not restart on a conservation violation

The instinct is to restart, and it is wrong here. The table is frozen precisely so the corrupt state
can be examined, and the checkpoint has deliberately not been overwritten (`D-21-04`). A restart
would either discard the evidence or reload the corruption.

### 5.2 A privacy incident is an incident

A redaction event in production means concealed material reached a logging boundary. Even though it
was redacted, the code path exists, and the response includes assessing what may have reached the log
store before the redactor's pattern covered it. Treating it as a routine warning is how a leak
becomes a long-standing one.

---

## 6. Runbooks

### 6.1 A player reports "the table is stuck"

1. Confirm the table's status and each seat's presence via `GET /admin/tables`.
2. If a seat is `absent`, the table is paused as designed (`22 §5`) — explain, and note that the
   other three can unanimously abandon.
3. If all four are connected and the sequence is not advancing, check for a frozen actor
   (conservation violation) and for an open correction or declaration vote.
4. If genuinely stuck, force-close with a reason. The game is lost; the table survives.

### 6.2 A player reports "I lost my tiles" / "my hand is wrong"

1. Establish the `tableId` and approximate time.
2. Read the public event log for the sequence of actions.
3. **The hand contents cannot be checked** — by anyone. Say so plainly.
4. If the public sequence shows a mechanical error, reproduce it in a core unit test from the
   observed sequence (`20 §6.1`). That is the diagnostic path.

### 6.3 A player cannot log in

1. Check `locked_until` on the account.
2. If locked, explain the lockout and its expiry; it clears on its own.
3. If disabled, check the audit log for the reason.
4. Never reset a password on a caller's request without verified email ownership.

### 6.4 A deploy needs rolling back

1. Redeploy the previous image (`27 §7`).
2. Do **not** roll back the schema; migrations are backward-compatible by requirement.
3. Confirm tables restore and clients reconnect.

### 6.5 Suspected credential attack

1. Confirm the pattern from the security dashboard.
2. Per-account lockouts and per-address limits are already engaged.
3. If a single address dominates, block it at the terminator.
4. Notify affected accounts if any authentication succeeded from an unexpected address.

---

## 7. Support model

| Question | Answer |
|---|---|
| "Can you see my hand?" | No. Nobody can |
| "What did I have last game?" | Nobody knows; the data no longer exists |
| "Can you prove the shuffle was fair?" | An operator can verify the wall was not altered mid-game (`08 §5.2`). The wall itself is never disclosed |
| "Can you undo what happened?" | No. Only the four players, unanimously, during the game (`05 §8`) |
| "Was that move legal?" | The system does not know. That is for the players |
| "Can I watch my friend's game?" | No. There are no spectators |
| "Can you replay our game?" | No. There is no replay |

Seven of the most likely support questions have "no" as the honest answer, and the reason is the same
in each case. The interface should set this expectation before a player needs support — a help page
stating what the system does not retain is cheaper than explaining it one player at a time, and it is
also the product's most distinctive claim.

---

## 8. Routine tasks

| Task | Cadence |
|---|---|
| Review integrity and privacy dashboards | Daily |
| Review the audit log | Weekly |
| Verify a backup by restoring it (`29 §6`) | Quarterly |
| Review dependency advisories | Weekly, plus on any critical advisory |
| Review Argon2id parameters against current guidance | Annually |
| Rotate database credentials | Quarterly |
| Rotate the checkpoint encryption key | Annually; `key_version` makes it non-disruptive |
| Confirm no orphaned concealed material exists | Monthly, by query for non-purged concluded games |

The last task is a deliberate belt-and-braces check on the purge path: purge failures alert, but a
periodic query confirms that nothing slipped through unalerted.

---

## 9. Design Decisions

| ID | Decision | Rationale |
|---|---|---|
| D-28-01 | Operations has no privileged path to player data | An absent path has no failure mode; a guarded one fails when the guard does. |
| D-28-02 | A mandatory reason enforced by the endpoint, not by policy | An unexplained administrative action becomes impossible rather than discouraged. |
| D-28-03 | Do not restart on a conservation violation | The freeze preserves evidence and the checkpoint is deliberately unoverwritten. |
| D-28-04 | Treat a production redaction event as an incident | The redaction worked, but the leaking code path exists. |
| D-28-05 | Dedicated integrity and privacy dashboards | These failures are silent; nobody feels a purge failure until it matters. |
| D-28-06 | Publish what the system cannot answer, in the product | Cheaper than per-player explanation, and it is the product's most distinctive claim. |
| D-28-07 | The diagnostic path is reproduce-in-core, not inspect-production | Follows from the deterministic core and the privacy constraint. |
| D-28-08 | A monthly query for orphaned concealed material | Belt and braces on the purge path, which alerts but could fail to alert. |

---

## 10. Alternative Designs

| Alternative | Why rejected |
|---|---|
| An audited operator view of live tables | The audit records the access; it does not undo it. |
| A time-boxed break-glass into game content | Requires the capability to exist (`04 §3.3`). |
| Retaining game data for support | A permanent concealed-material store (`16 §10`). |
| Automatic restart on a conservation violation | Discards evidence and may reload the corruption. |
| Treating redaction events as warnings | Turns a leaking code path into a long-standing one. |
| A support role separate from administration | Nothing to support that a smaller role cannot reach. |

---

## 11. Trade-offs

**Some support questions are unanswerable.** Accepted, and published rather than apologized for.

**Diagnosis is slower without production inspection.** Accepted: the deterministic core makes
mechanical defects reproducible, which is a better technique than reading production state anyway.

**Forcing a table closed loses the game.** Accepted: it is the last resort for a genuinely stuck
table, and it is preferable to a table nobody can leave.

**Quarterly restore verification is infrequent.** Accepted for a service with no financial exposure,
and `29 §6` makes the verification substantive.

---

## 12. Risks

| Risk | Mitigation |
|---|---|
| An administrative capability creeps toward game content | `NR-406`; `TC-P02`; every endpoint reviewed against `04 §4` |
| A silent failure — purge, checkpoint — goes unnoticed | Dedicated dashboards, alerts, plus a monthly orphan query |
| An operator restarts a frozen table and loses evidence | `§5.1`; the runbook states it first |
| Support pressure creates a data-retention exception | `16 §10`; any new store requires an ADR |
| Users are surprised by what cannot be answered | Published in-product (`D-28-06`) |

---

## 13. Future Considerations

Not committed: a synthetic table exercising the system continuously in production, so behaviour is
observable without touching a real game; an operator-facing integrity report showing commitment
verification results.

---

## 14. Cross References

| Document | Focus |
|---|---|
| `04_User_Roles_and_Access.md §3.3` | Administrative capabilities and their absences |
| `18_API_Design.md §4.3` | The administrative endpoints |
| `20_Logging_and_Observability.md` | Metrics and alerts |
| `21_Error_Handling_and_Recovery.md` | The freeze behaviour |
| `27_Deployment_Architecture.md` | Deploy and rollback |
| `29_Disaster_Recovery.md` | Backup verification |

---

## 15. Revision History

| Version | Date | Author | Changes |
|---|---|---|---|
| 0.1 | 2026-09-02 | Design (architect role), owner-approved | Initial chapter |
| 0.2 | 2026-09-03 | Design (architect role), owner-approved | `ADR-0017`: `§3.1` provisioning-with-TOTP procedure, `§3.2` lost-device recovery; renumbered old `§3.1` to `§3.3` |
