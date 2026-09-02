# Privacy Threat Model — Concealed Player Tiles

| | |
|---|---|
| **Project** | American Mahjong Dealer |
| **Document** | PRIVACY_THREAT_MODEL.md |
| **Status** | Normative — binding on all implementation |
| **Last Updated** | 2026-09-02 |
| **Role in SSOT** | Owns the `PT-##` threat analysis for concealed player tiles across every surface. Does **not** own the privacy model itself (`docs/14`), the general security threat model (`THREAT_MODEL.md`), or the controls' implementation. |

---

## 1. Scope and method

This model covers **one asset**: the contents of a player's concealed hand, and the wall order that
would reveal every hand at once.

It is separate from `THREAT_MODEL.md` because the adversary is different. General security threat
modelling assumes an attacker outside the system trying to get in. Here **the most likely adversary
is a legitimate player sitting at the table** — someone with a valid account, a valid session, a
valid seat, and a modified client. They are not trying to break in; they are already in, and they
want one specific thing they are not entitled to.

Method: enumerate every surface where concealed material could plausibly appear, name the threat,
state the control, and assess the residual. Twenty-four surfaces, derived from the policy matrix in
`docs/14 §7`.

**Likelihood**: 1 remote · 5 near-certain without the control. **Impact** for every threat in this
model is 4 or 5, because the asset is the one thing the product promises to protect.

---

## 2. The assets

| Asset | Why it matters |
|---|---|
| A seat's concealed tile faces | The hidden information the game is built on |
| A seat's rack order and gaps | Reveals intent — how a player is grouping their hand |
| A seat's selection and pass commitment | Reveals intent before the action |
| **The wall order** | The crown jewel. Combined with the public history it reconstructs **every** hand at **every** moment (`docs/08 §5.3`) |
| The commitment salt | Would permit deriving the wall order |

The wall order's status is worth restating: it is more sensitive than any single hand, because it
reveals all four plus the future.

---

## 3. Adversaries

| # | Adversary | Access | Most likely method |
|---|---|---|---|
| A1 | **A player at the table** | Valid session, valid seat, modifiable client | Inspect network traffic; craft frames; probe handles |
| A2 | A player elsewhere | Valid session, no seat here | Reach a table they were not invited to |
| A3 | An unauthenticated attacker | Network access only | Enumerate; attack credentials |
| A4 | A curious operator | Infrastructure access | Query the database; read logs |
| A5 | A compromised dependency | Code execution in the server or client | Read state; exfiltrate |
| A6 | A passive observer | Traffic observation | Analyse sizes and timing |

**A1 is the primary adversary**, which is unusual and shapes the whole model. Most of the controls
below defend against someone who is already legitimately inside the table.

---

## 4. Threat analysis

### 4.1 Wire surfaces

| ID | Threat | Adversary | L | I | Control | Residual |
|---|---|---|---|---|---|---|
| **PT-01** | A frame to seat X contains seat Y's concealed faces | A1 | 4 | 5 | Single **constructing** projector; output type has no field for it; `TC-P01` inspects every frame of ≥1000 games | **Low** |
| PT-02 | A backlog frame on resumption leaks | A1 | 3 | 5 | Backlog uses the **same** projector (`ADR-0011`); covered by `TC-P01` | Low |
| PT-03 | A snapshot leaks | A1 | 3 | 5 | Same projector; covered by `TC-P01` | Low |
| PT-04 | A player subscribes to another seat's stream | A1 | 4 | 5 | **No seat parameter exists**; the binding decides (`NR-601`); `TC-I01` | **Low** |
| PT-05 | A player binds to a table they hold no seat at | A2 | 3 | 5 | Ticket issued only to a seat occupant; uniform `404` | Low |
| PT-06 | Handle guessing yields another seat's tile | A1 | 3 | 4 | 128-bit random per-game handles; ownership checked independently; unknown and unowned reject identically (`TC-I02`) | Low |
| PT-07 | A rejection message reveals a tile | A1 | 2 | 3 | Closed code catalog; no message carries game content (`docs/21 §5.2`) | Low |
| PT-08 | A rejection reveals another seat's intent | A1 | 3 | 3 | Rejections are delivered **only** to the originating seat (`D-21-06`) | Low |

`PT-01` and `PT-04` are the model's two most important entries, and both are countered structurally
rather than by a check. The projector *constructs* a view, so a field is absent unless deliberately
added; and there is no seat parameter to tamper with.

### 4.2 The wall

| ID | Threat | Adversary | L | I | Control | Residual |
|---|---|---|---|---|---|---|
| **PT-09** | The wall order reaches a client | A1 | 2 | 5 | `SRV` class; in no frame at all; `TC-P01` | **Low** |
| PT-10 | The salt is revealed, permitting reconstruction | A1 | 2 | 5 | **Never revealed to anyone** (`ADR-0008`); no reveal path exists | Low |
| PT-11 | A player predicts the wall from observed randomness | A1 | 1 | 5 | Cryptographic entropy; no client contribution; domain-separated streams | Low |
| PT-12 | A player replays a known seed | A1 | 1 | 5 | Seed injection **compiled out** of production (`TC-R06`) | Low |

`PT-10` is where the design's most consequential privacy decision sits. A commit-and-reveal scheme
would have created this threat deliberately, in exchange for player-verifiable fairness. The analysis
in `docs/08 §5.3` rejected it, so the threat has no vector rather than a mitigated one.

### 4.3 Server-side and storage

| ID | Threat | Adversary | L | I | Control | Residual |
|---|---|---|---|---|---|---|
| PT-13 | A REST response carries table state | A1 | 2 | 5 | **No endpoint reads table state** (`docs/18 §5`); `TC-P02` | Low |
| PT-14 | An operator queries hands from the database | A4 | 3 | 5 | Application-layer AES-256-GCM; **no `SELECT` grant** on `private_state` for the app role (`docs/17 §7.2`) | Low |
| PT-15 | A public event carries a private face | A1 | 3 | 4 | `docs/16 §6.1` invariant; per-event review; `TC-P04` | Low |
| PT-16 | Concealed material outlives its game | A4 | 3 | 4 | Hard purge within 60 s of close; `TC-P04` | Low |
| PT-17 | A backup retains hands from a concluded game | A4 | 2 | 4 | Purge precedes the backup window; verified through the restore path (`docs/29 §6.1` step 5) | Low |
| PT-18 | A replica or read-only role exposes hands | A4 | 2 | 4 | Encrypted at rest; `app_readonly` has no grant on `private_state` | Low |

`PT-14` deserves note: the control is *two* independent barriers. Encryption means a dump yields
ciphertext; the missing column grant means a mistaken or injected query cannot return the column at
all.

### 4.4 Observability

| ID | Threat | Adversary | L | I | Control | Residual |
|---|---|---|---|---|---|---|
| **PT-19** | A debug log line writes a hand | A4 | **5** | 4 | `NoConcealed<T>` — **does not compile**; redactor; scanner with planted control (`ADR-0013`) | **Low** |
| PT-20 | A metric label carries a tile or identifier | A4 | 3 | 3 | Type guard on span and metric attributes; no identifiers as labels; `TC-P03` | Low |
| PT-21 | A crash report attaches state | A4 | 3 | 4 | The reporter **accepts no state parameter** (`docs/20 §9`) | Low |
| PT-22 | Table chat is logged or persisted | A4 | 3 | 3 | No storage tier at all; `TC-P03`, `TC-P04` | Low |

`PT-19` carries the highest likelihood in the entire model — **5, near-certain without the control**
— because the leak is not carelessness but diligence: a developer debugging a hard problem writes
exactly this line, and it works. It is the only threat here whose likelihood is that high, and it is
why the primary control is a compile error rather than a policy.

### 4.5 Client surfaces

| ID | Threat | Adversary | L | I | Control | Residual |
|---|---|---|---|---|---|---|
| PT-23 | A third-party script reads the DOM or state | A5 | 2 | 5 | No third-party scripts; strict CSP; minimized dependencies; `TC-P05` | Medium |
| PT-24 | Concealed material persists in browser storage | A1 | 2 | 3 | Nothing concealed is persisted; `TC-P05`; `CO-10` | Low |
| PT-25 | Source maps expose server-derived data | A1 | 2 | 2 | No source maps in production | Low |
| PT-26 | Analytics carry game data | A5 | 1 | 5 | No analytics in the game path (`NR-209`) | Low |

`PT-23` retains a **medium** residual and is honest about it: any code running in the client can read
what the client received. The controls reduce the likelihood of such code existing; they cannot make
it harmless if it does.

### 4.6 Mechanisms specific to this design

| ID | Threat | Adversary | L | I | Control | Residual |
|---|---|---|---|---|---|---|
| **PT-27** | A rewind lets a player exploit a wall tile they peeked at | A1 | 3 | 3 | **Reshuffle of the undrawn remainder** (`docs/05 §8.4`); per-action leak analysis; `TC-R08` | **Low** |
| PT-28 | A rewind restores state a seat should not now know | A1 | 2 | 2 | Per-action analysis shows five of six cases leak nothing; the sixth is `PT-27` | Low |
| PT-29 | A pass round reveals committed tiles before execution | A1 | 3 | 4 | `in flight` location; only counts are public; the move is atomic (`TC-M07`) | Low |
| PT-30 | Retraction is used to probe reactions | A1 | 2 | 1 | Physically possible at a table; the event records the faces honestly | Accepted |
| PT-31 | An administrator views a live table | A4 | 3 | 5 | **No such path exists** (`docs/04 §3.3`); `TC-P02` | Low |
| PT-32 | A replay artifact reconstructs hands | A4 | 2 | 5 | **No replay exists** (`ADR-0012`); `TC-A11` verifies reconstruction fails | Low |

`PT-27` is the threat this design created for itself by adding a correction mechanism, and it is the
reason the reshuffle exists. Worth noting that the analysis narrowed it to one of six rewind cases
before mitigating it, rather than treating rewind as uniformly hazardous.

`PT-30` is **accepted** rather than mitigated, and it is the only such entry. A player can expose
tiles, watch reactions, and retract. That is exactly what a physical table permits, and forbidding it
would require knowing that an exposure is binding — which is a rule (`NR-006`).

### 4.7 Side channels

| ID | Threat | Adversary | L | I | Control | Residual |
|---|---|---|---|---|---|---|
| PT-33 | Frame size reveals hand contents | A6 | 2 | 1 | Size correlates with hand **size**, which is already `PUB` (`docs/14 §8`) | Accepted |
| PT-34 | Response timing reveals tile identity | A6 | 1 | 2 | **No code path branches on a tile face** (`D-06-04`), so no timing dependency exists | Low |

`PT-34`'s control is a property the architecture already has for a different reason. The
rule-agnosticism requirement — never branch on what a tile is — happens to eliminate the timing
channel as a side effect.

`PT-33` is accepted with no mitigation, and `docs/14 §8` records why padding was considered and
rejected: it would guard a channel that reveals only public information.

---

## 5. Summary

| Residual | Threats |
|---|---|
| **Medium** | `PT-23` third-party or compromised client code |
| **Accepted** | `PT-30` retraction as probing · `PT-33` frame size |
| **Low** | The remaining 31 |

### 5.1 Threats with no vector rather than a mitigation

The strongest entries in this model are the ones where the attack has nowhere to go:

| Threat | Why there is no vector |
|---|---|
| `PT-04` subscribe to another seat | No seat parameter exists anywhere on the wire |
| `PT-10` salt revealed | No reveal path was ever built |
| `PT-13` REST leaks table state | No endpoint reads table state |
| `PT-31` administrator views a table | No administrative read path exists |
| `PT-32` replay reconstructs hands | No replay artifact exists |
| `PT-34` timing channel | No branch depends on a tile face |

Six of the thirty-four threats are countered by absence. That is the model's central lesson: **an
absent capability has no failure mode, and a guarded one fails when the guard does.**

### 5.2 What the model does not claim

The server can read every hand. This is unavoidable — a dealer that moves tiles must know what they
are — and it is not treated as a mitigated threat but as a stated property. What is controlled is
that no *person* and no *downstream system* can reach it (`docs/14 §4.3`).

Client-side code can read what the client received. `PT-23` records this honestly at medium residual.

---

## 6. Cross References

| Document | Focus |
|---|---|
| `docs/14_Player_Privacy.md` | The privacy model and the policy matrix |
| `docs/08_Shuffle_and_Deal_Architecture.md §5.3` | The wall-order reconstruction argument |
| `docs/05_Game_Table_Architecture.md §8.4` | The rewind leak analysis |
| `docs/20_Logging_and_Observability.md` | Controls for `PT-19`–`PT-22` |
| `docs/17_Database_Design.md §7` | Controls for `PT-14`–`PT-18` |
| `docs/34_Testing/Privacy_and_Absence_Suites.md` | The `TC-P*` suite |
| `THREAT_MODEL.md` | General security threats |
| `SECURITY_REQUIREMENTS_MATRIX.md` | `SEC-###` controls |

## 7. Revision History

| Version | Date | Author | Changes |
|---|---|---|---|
| 0.1 | 2026-09-02 | Design (architect role), owner-approved | Initial model: 34 threats across 7 surface groups |
