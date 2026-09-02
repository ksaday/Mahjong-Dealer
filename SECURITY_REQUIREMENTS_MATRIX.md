# Security Requirements Matrix

| | |
|---|---|
| **Project** | American Mahjong Dealer |
| **Document** | SECURITY_REQUIREMENTS_MATRIX.md |
| **Status** | Normative — binding on all implementation |
| **Last Updated** | 2026-09-02 |
| **Role in SSOT** | Owns the `SEC-###` catalog: every security requirement, its control, its enforcement point, and its verification. Does **not** own the controls' design (`docs/15`) or the threat analyses (`THREAT_MODEL.md`, `PRIVACY_THREAT_MODEL.md`). |

---

## 1. How to read this matrix

Every row states a requirement, the control implementing it, **where** it is enforced, and **what
verifies it**. A requirement with no verification is not a requirement.

The **Type** column matters more than usual here:

| Type | Meaning |
|---|---|
| **Absence** | The capability does not exist. No failure mode |
| **Structural** | Enforced by architecture or the type system. Fails at build time |
| **Check** | Enforced at runtime by a validation. Can be wrong |
| **Operational** | Enforced by configuration or procedure |

The distinction is not cosmetic. Roughly a quarter of the rows below are **Absence**, and those are
the strongest security properties in the system — an attack against a capability that was never built
has nowhere to go (`THREAT_MODEL.md §5.2`).

---

## 2. Authentication — `SEC-0xx`

| ID | Requirement | Control | Enforced at | Type | Verified by |
|---|---|---|---|---|---|
| SEC-001 | Passwords stored irrecoverably | Argon2id, per-password salt | Registration, password change | Check | Code and schema audit |
| SEC-002 | A database compromise alone does not yield attackable hashes | Server-side pepper in the secret manager | Hash computation | Structural | Configuration audit |
| SEC-003 | Weak passwords rejected | 12-character minimum; breach-list check | Registration, password change | Check | `TC-S01` |
| SEC-004 | Authentication failures do not reveal account existence | Identical response and timing | Login | Check | `TC-S02` |
| SEC-005 | Repeated failures are throttled durably | Per-account lockout in **PostgreSQL** | Login | Check | `TC-S02`; survives restart |
| SEC-006 | Distributed attempts are throttled | Per-address limits | Login | Check | `TC-S04` |
| SEC-007 | Administrators require a second factor | TOTP or hardware authenticator | Every administrative endpoint | Check | `TC-S05` |
| SEC-008 | Administrator accounts are not self-created | Out-of-band provisioning only | Deployment | Absence | Route audit |

## 3. Sessions — `SEC-01x`

| ID | Requirement | Control | Enforced at | Type | Verified by |
|---|---|---|---|---|---|
| SEC-010 | Session tokens are unguessable | 256 bits from a cryptographic source | Issue | Check | Code audit |
| SEC-011 | A database read yields no usable sessions | SHA-256 hashed at rest | Storage | Structural | Schema audit |
| SEC-012 | Tokens are not reachable by script | `HttpOnly`, `Secure`, host-prefixed cookie | Response | Check | `TC-S06` |
| SEC-013 | Sessions expire | Idle and absolute limits, server-side | Every request | Check | `TC-S07` |
| SEC-014 | Revocation closes a live socket within 5 s | Periodic re-check of bound sessions | Socket gateway | Check | `TC-S03` |
| SEC-015 | Revocation cannot be deferred by a client | Opaque server-side tokens, not self-contained | Design | **Structural** | `TC-S03` |
| SEC-016 | Cross-site requests are rejected | Double-submit token on non-safe methods | REST | Check | `TC-S08` |
| SEC-017 | Password change invalidates other sessions | Bulk revocation | Password change | Check | `TC-S07` |

`SEC-015` is why sessions are opaque rather than self-contained (`D-15-02`): a bearer token cannot be
revoked before expiry, so "log out everywhere" would leave a table connection receiving a hand.

## 4. Table and seat isolation — `SEC-02x`

The most important group in the matrix.

| ID | Requirement | Control | Enforced at | Type | Verified by |
|---|---|---|---|---|---|
| **SEC-020** | A connection acts only on its own seat | **No seat parameter exists on the wire** | Protocol design | **Absence** | `TC-I01` |
| SEC-021 | Table existence is not discoverable | Uniform `404`; no listing; irreversible code storage | REST | Check | `TC-S09` |
| SEC-022 | Join codes cannot be brute-forced | Rate limits per account and per address; short validity | REST | Check | `TC-S04`; analysis in `docs/15 §7.2` |
| SEC-023 | A ticket is issued only to a seat occupant | Occupancy verified at issue | REST | Check | `TC-I01` |
| SEC-024 | A ticket cannot be replayed | Unique constraint; atomic redemption | Socket bind | **Structural** | `TC-S10` |
| SEC-025 | A ticket does not appear in a URL | Redeemed in the first frame | Protocol design | Absence | `TC-S10` |
| SEC-026 | One account holds at most one seat | Partial unique index | Database | **Structural** | `TC-S11` |
| SEC-027 | Only bound seats receive table frames | Delivery is per-binding | Socket gateway | Absence | `TC-A10`, `TC-P01` |
| SEC-028 | A departed player retains no access | Binding refused after vacating | Socket bind | Check | `TC-S12` |

`SEC-020` is the single most valuable row in this document. The classic multiplayer authorization bug
— change an identifier to act as someone else — has **no vector**, because there is no identifier to
change.

## 5. Hand privacy — `SEC-03x`

Full analysis in `PRIVACY_THREAT_MODEL.md`.

| ID | Requirement | Control | Enforced at | Type | Verified by |
|---|---|---|---|---|---|
| SEC-030 | Concealed faces reach only their owner | One constructing projector, taking a seat | Projection | **Structural** | `TC-P01` |
| SEC-031 | Exactly one path produces client payloads | CI-enforced serializer count | Build | Structural | `TC-P07` |
| SEC-032 | The wall order reaches no client | `SRV` class; not in the protocol | Protocol design | **Absence** | `TC-P01`, `TC-P08` |
| SEC-033 | The salt is never revealed | No reveal path exists | Design | **Absence** | `TC-P01` |
| SEC-034 | Concealed material at rest is encrypted | AES-256-GCM, application layer | Persistence | Check | `TC-P04` |
| SEC-035 | The application role cannot read private regions | No column `SELECT` grant | Database | **Structural** | `TC-P04` |
| SEC-036 | Concealed material does not outlive its game | Hard purge within 60 s | Game conclusion | Check | `TC-P04` |
| SEC-037 | No administrative path to a hand | The capability does not exist | Design | **Absence** | `TC-P02` |
| SEC-038 | No replay reconstructs a hand | No replay exists | Design | **Absence** | `TC-A11` |
| SEC-039 | Tile handles reveal nothing | 128-bit random, per game | Tile model | Structural | `TC-M02` |

## 6. Input integrity — `SEC-04x`

| ID | Requirement | Control | Enforced at | Type | Verified by |
|---|---|---|---|---|---|
| SEC-040 | Client-reported state is never trusted | Server-authoritative; five mechanical validations | Command pipeline | Structural | `TC-I02`, `TC-I03` |
| SEC-041 | An action applies at most once | `cmdId` idempotency with receipts | Command pipeline | Check | `TC-I04` |
| SEC-042 | Reordering is detected | `cseq` contiguity; gap closes the socket | Socket gateway | Check | `TC-I05` |
| SEC-043 | Stale actions do not hit the wrong target | Handle parameter plus staleness check | Command pipeline | Check | `TC-I07` |
| SEC-044 | Malformed input changes no state | Schema validation before dispatch | Command pipeline | Check | `TC-I06` |
| SEC-045 | Validation is structural, never semantic | Shape only; no rule checks | Command pipeline | Absence | `TC-A03` |
| SEC-046 | Every accepted action is attributable | Bound seat plus ordered event log | Command pipeline | Structural | `TC-I03` |
| SEC-047 | One writer per table | Single serialized actor | Architecture | **Structural** | `TC-I03`, `TC-I08` |

## 7. Randomization integrity — `SEC-05x`

| ID | Requirement | Control | Enforced at | Type | Verified by |
|---|---|---|---|---|---|
| SEC-050 | Entropy is cryptographic | Platform CSPRNG, 256 bits | Deal | Check | Code audit |
| SEC-051 | No client value reaches the shuffle | No input path | Design | **Absence** | `TC-R05` |
| SEC-052 | The shuffle is unbiased | Rejection sampling, never modulo | Shuffle | Check | `TC-R03` |
| SEC-053 | A client cannot choose its tile | No command names a tile to draw | Protocol design | **Absence** | `TC-R02` |
| SEC-054 | Seed injection is absent in production | Compiled out; startup assertion | Build | **Structural** | `TC-R06` |
| SEC-055 | The wall is tamper-evident | Commitment published before play | Deal | Check | `TC-R07` |
| SEC-056 | A reshuffle preserves restored state | Only the undrawn remainder changes | Correction | Check | `TC-R08` |

## 8. Transport and browser — `SEC-06x`

| ID | Requirement | Control | Enforced at | Type | Verified by |
|---|---|---|---|---|---|
| SEC-060 | All traffic is encrypted | TLS; HSTS with a long max-age | Edge | Operational | Configuration audit |
| SEC-061 | Script injection is prevented | Strict CSP; no inline script; no `eval` | Response headers | Check | `TC-S13` |
| SEC-062 | Chat cannot inject script | **Plain text always**, never markup | Client rendering | Structural | `TC-I06` |
| SEC-063 | The application cannot be framed | `frame-ancestors 'none'` | Response headers | Check | `TC-S13` |
| SEC-064 | Cross-origin access is restricted | CORS allow-list; socket Origin check | Edge, gateway | Check | `TC-S14` |
| SEC-065 | No source maps in production | Build configuration | Build | Absence | `TC-P05` |
| SEC-066 | No third-party script loads | No external scripts | Client | **Absence** | `TC-P05` |

## 9. Logging privacy — `SEC-07x`

| ID | Requirement | Control | Enforced at | Type | Verified by |
|---|---|---|---|---|---|
| **SEC-070** | Concealed material cannot be logged | `NoConcealed<T>` on every sink — **compile error** | Type system | **Structural** | `TC-P06` |
| SEC-071 | Dynamically-constructed leaks are caught | Redactor at the logging boundary | Runtime | Check | `TC-P03` |
| SEC-072 | Leaks that reach output are caught | CI scanner with a planted control | Build | Check | `TC-P03` |
| SEC-073 | A redaction in production is an incident | Redaction emits a critical alert | Runtime | Operational | `docs/28 §5` |
| SEC-074 | No identifiers as metric labels | Type guard; metric definitions reviewed | Metrics | Check | `TC-P03` |
| SEC-075 | Crash reports carry no state | The reporter accepts no state parameter | Design | **Absence** | `TC-P03` |
| SEC-076 | Chat is never logged or stored | No storage path | Design | **Absence** | `TC-P03`, `TC-P04` |

`SEC-070` is the response to the highest-likelihood threat in either model (`PT-19`, likelihood 5).
A control at compile time is the only kind that works against a developer who is debugging.

## 10. Administrative security — `SEC-08x`

| ID | Requirement | Control | Enforced at | Type | Verified by |
|---|---|---|---|---|---|
| SEC-080 | Administrators cannot reach game content | The capability does not exist | Design | **Absence** | `TC-P02` |
| SEC-081 | Administrators cannot act at a table | No seat binding available to the role | Design | **Absence** | `TC-A10` |
| SEC-082 | Every administrative action is audited | Append-only log, trigger-enforced | Database | Structural | `TC-S15` |
| SEC-083 | Every administrative mutation carries a reason | Mandatory field, endpoint-enforced | REST | Check | `TC-S15` |
| SEC-084 | Administrative sessions are short | 8 h absolute, 30 min idle | Session | Check | `TC-S07` |
| SEC-085 | No impersonation capability exists | Not implemented | Design | **Absence** | Route audit |
| SEC-086 | No break-glass path to game content | Not implemented | Design | **Absence** | `TC-P02` |

## 11. Secrets and supply chain — `SEC-09x`

| ID | Requirement | Control | Enforced at | Type | Verified by |
|---|---|---|---|---|---|
| SEC-090 | Secrets are not in the repository or images | Secret manager only | Deployment | Operational | Repository scan |
| SEC-091 | Production refuses to start on a missing or default secret | Startup validation | Startup | Check | `TC-S16` |
| SEC-092 | Keys are rotatable without rewriting data | `key_version` on encrypted rows | Persistence | Structural | Schema audit |
| SEC-093 | Dependencies are scanned every build | Advisory check; build fails on high severity | Build | Check | Pipeline |
| SEC-094 | Install-time scripts are denied | Deny by default; exceptions reviewed | Build | Operational | Configuration audit |
| SEC-095 | Client dependencies are minimized | Reviewed per addition | Design | Operational | Dependency review |

---

## 12. Summary by type

| Type | Count | Note |
|---|---|---|
| **Absence** | 22 | No failure mode. The strongest rows |
| **Structural** | 15 | Fails at build or by architecture |
| **Check** | 44 | Runtime validation; can be wrong |
| **Operational** | 8 | Configuration or procedure |

Twenty-two absences. Each corresponds to a capability that was considered and not built — a seat
parameter, a spectator role, an administrative game view, a replay, a reveal path, an impersonation
mechanism — and each is a threat with nowhere to go rather than a threat under guard.

### 12.1 The absence rows

`SEC-008` · `SEC-020` · `SEC-025` · `SEC-027` · `SEC-032` · `SEC-033` · `SEC-037` · `SEC-038` ·
`SEC-045` · `SEC-051` · `SEC-053` · `SEC-065` · `SEC-066` · `SEC-075` · `SEC-076` · `SEC-080` ·
`SEC-081` · `SEC-085` · `SEC-086`, plus `SEC-015`, `SEC-024`, `SEC-026`, `SEC-035`, `SEC-047` and
`SEC-070` which are structural in a way that makes the failure impossible to express.

---

## 13. Cross References

| Document | Focus |
|---|---|
| `docs/15_Security_Architecture.md` | The controls' design |
| `THREAT_MODEL.md` | The `T-##` threats these controls mitigate |
| `PRIVACY_THREAT_MODEL.md` | The `PT-##` threats to concealed tiles |
| `docs/04_User_Roles_and_Access.md` | The privilege model |
| `docs/34_Testing/` | The `TC-*` suites |
| `REQUIREMENTS_TRACEABILITY_MATRIX.md` | Full traceability including these rows |

## 14. Revision History

| Version | Date | Author | Changes |
|---|---|---|---|
| 0.1 | 2026-09-02 | Design (architect role), owner-approved | Initial matrix: 75 requirements across 10 groups |
