# Scope Boundaries — What This System Is, and What It Must Never Become

| | |
|---|---|
| **Project** | American Mahjong Dealer |
| **Document** | SCOPE_BOUNDARIES.md |
| **Status** | Normative — binding on all implementation |
| **Last Updated** | 2026-09-02 |
| **Role in SSOT** | Owns the Physical vs Digital Responsibility Matrix and the complete `NR-###` negative-requirement catalog. Does **not** own the mechanical/rule validation boundary table (that is `docs/02 §5`), the privacy model (`docs/14`), or the positive requirement catalogs (`docs/01`). |

---

## 1. Executive Summary

This document draws the boundary of the system in three ways, from three directions.

**Positively** (§3), by naming what the software is responsible for. **By comparison** (§2), through
a matrix that sets each responsibility beside its counterpart at a physical table. And
**negatively** (§4), through a catalog of numbered requirements that describe things the system must
never contain.

The negative catalog is the unusual one, and it is the reason this document exists as a peer of the
requirements chapter rather than as a section inside it. Ordinary projects can leave unbuilt
features unwritten. This project cannot, because the features it excludes are exactly the features
that a competent engineer — or a capable AI coding agent — would consider obvious, helpful, and
natural to add. "It's a Mahjong app, so it should check whether the hand wins" is a reasonable
inference from the name and a fatal error against the design. Absence therefore has to be specified,
numbered, cross-referenced, and tested, in the same way presence is.

---

## 2. The Physical vs Digital Responsibility Matrix

This is the single most useful artifact in the documentation set for answering the recurring
question *"should the software do this?"*. Each row names a responsibility, identifies who holds it
at a physical table, and states whether the application takes it on.

The rule that generates the table: **the application inherits the responsibilities of the table and
the dealer, and none of the responsibilities of the players.**

| # | Responsibility | At a physical table | In the Dealer app |
|---|---|---|---|
| **Knowledge and judgment** ||||
| R-01 | Know the rules of American Mahjong | Players | **No** |
| R-02 | Know the current year's card / hand patterns | Players | **No** |
| R-03 | Decide whether a hand is a winning hand | Players | **No** |
| R-04 | Decide whether a discard was legal | Players | **No** |
| R-05 | Decide whether a call or claim was entitled | Players | **No** |
| R-06 | Decide whether an exposure is valid | Players | **No** |
| R-07 | Decide whether a joker was used legally | Players | **No** |
| R-08 | Decide whether a pass was correct | Players | **No** |
| R-09 | Decide how many tiles a hand should hold | Players | **No** |
| R-10 | Score, settle, or keep account of results | Players, or nobody | **No** |
| R-11 | Resolve a disagreement about the rules | Players, by discussion | **No** — it provides a channel for the discussion |
| **Equipment and mechanics** ||||
| R-12 | Hold a complete tile set | The tile case | **Yes** |
| R-13 | Ensure no tile is duplicated or missing | Physical reality | **Yes** — as an enforced invariant |
| R-14 | Shuffle the tiles | Dealer / players together | **Yes** |
| R-15 | Build the wall | Dealer / players together | **Yes** |
| R-16 | Deal the opening hands | Dealer | **Yes** |
| R-17 | Present the next wall tile when drawn | The wall | **Yes** |
| R-18 | Hold the discard pile in a visible, ordered state | The table surface | **Yes** |
| R-19 | Hold exposed tiles in front of the right player | The rack ledge | **Yes** |
| R-20 | Track which tile is where | The table itself | **Yes** |
| R-21 | Move tiles when a player performs an action | Player's hands | **Yes** — on the player's instruction |
| R-22 | Keep concealed tiles concealed from other players | The rack and physical sightlines | **Yes** |
| R-23 | Prevent a player from taking another player's tiles | Physical reach and social pressure | **Yes** — as an ownership check |
| R-24 | Track whose turn the table is at | Shared attention | **Yes** — as an advisory pointer |
| R-25 | Perform a simultaneous exchange of tiles | Players push tiles at once | **Yes** — as a neutral pass round |
| R-26 | Put things back when everyone agrees a mistake was made | Players, by agreement | **Yes** — as a unanimous, bounded rewind |
| **Player agency** ||||
| R-27 | Arrange one's own tiles on the rack | Player | **Player** — never the system |
| R-28 | Decide which tile to discard | Player | **Player** |
| R-29 | Decide whether to claim a discard | Player | **Player** |
| R-30 | Decide whether to expose tiles | Player | **Player** |
| R-31 | Decide when to declare Mahjong | Player | **Player** |
| R-32 | Decide whether to accept another player's declaration | Player | **Player** |
| **Social and environmental** ||||
| R-33 | Talk to the other players | Speech | **Yes** — an ephemeral table channel |
| R-34 | See who is present and paying attention | Eyesight | **Yes** — presence and connection state |
| R-35 | Wait for a player who has stepped away | Everyone waits | **Yes** — the table auto-pauses |
| R-36 | Play on behalf of an absent player | Nobody does this | **No** — no bots, no substitutes, ever |
| R-37 | Watch a game one is not playing in | Onlookers may exist | **No** — there is no spectator surface |

### 2.1 How to use this matrix

When a proposed feature does not appear in this table, decide which side it belongs on by asking:
*is this something the table and the tiles do, or something the people do?* Then add the row, with
the answer, before implementing.

When a proposed feature would move a **No** to a **Yes** in rows R-01 to R-11, it is out of scope by
construction and requires an amendment to `ADR-0002` — which is to say, it requires becoming a
different project.

---

## 3. In scope

The system is responsible for the following, and this list is exhaustive at the v1 boundary.

**Identity and access.** Account registration and login; session management; creating a table;
joining a table by code; taking and leaving a seat; readiness signalling.

**The table.** Four fixed seats; seat occupancy and connection state; the table lifecycle from
creation to close; auto-pause when a seat is away; unanimous abandonment.

**The dealer.** Tile-set initialization; shuffling; wall construction; the opening deal; drawing
from either end of the wall; discarding; claiming the current discard; exposing tiles; retracting an
exposure; swapping a tile with one in an exposure; neutral simultaneous pass rounds; the turn
pointer; wall exhaustion.

**Concluding a game.** Recording a Mahjong declaration as a player action; optional voluntary hand
reveal; collecting the other seats' responses; recording the outcome as a neutral fact; unanimous
end-game by agreement.

**Correction.** A bounded, unanimous rewind to a recent checkpoint, with a wall reshuffle when it
crosses a wall draw.

**Communication.** An ephemeral table-scoped text channel and a small set of non-verbal signals.

**Infrastructure.** Real-time synchronization; per-seat information projection; disconnect
detection; reconnection and state recovery; crash recovery; error handling; observability that
carries no private data; administration limited to accounts, tables, and system health.

---

## 4. Negative Requirements (`NR-###`)

Each entry states a condition that must remain **false** of the system, phrased so that it can be
checked mechanically. `Verified by` names the test category in
[docs/34_Testing/Privacy_and_Absence_Suites.md](docs/34_Testing/Privacy_and_Absence_Suites.md) that
enforces it.

Severity is uniform: every negative requirement is **zero-tolerance**. There is no "minor" violation
of an `NR`, because each one marks a boundary that, once crossed, changes what the project is.

### 4.1 NR-0xx — No Mahjong rules

| ID | The system must not… | Verified by |
|---|---|---|
| NR-001 | Contain any module, function, table, or configuration that encodes the rules of American Mahjong | `TC-A01` symbol and module scan |
| NR-002 | Determine whether a hand is a winning hand | `TC-A02` absence of any win predicate |
| NR-003 | Determine whether a declaration of Mahjong is correct | `TC-A02` |
| NR-004 | Determine whether a discard is legal | `TC-A03` command-path audit: no rule branch in `discard` |
| NR-005 | Determine whether a claim of a discard is entitled | `TC-A03` |
| NR-006 | Determine whether an exposure is valid, well-formed, or of a legal size | `TC-A03` |
| NR-007 | Determine whether a joker is used legally, or restrict joker movement by rule | `TC-A03` |
| NR-008 | Determine whether a tile pass is correct in count, direction, or timing | `TC-A03` |
| NR-009 | Enforce a hand size at any point after the opening deal | `TC-A04` property test: arbitrary hand sizes accepted |
| NR-010 | Store, ship, embed, parse, or reference any rule book, card, or hand-pattern data | `TC-A01` file and dependency scan |
| NR-011 | Expose configuration in which a rule, hand pattern, or legality condition could be expressed | `TC-A05` schema strictness assertion |
| NR-012 | Declare a hand dead, invalid, or penalized | `TC-A02` |
| NR-013 | Compute a score, value, or ranking of any kind | `TC-A02` |

### 4.2 NR-1xx — No economic component

| ID | The system must not… | Verified by |
|---|---|---|
| NR-101 | Contain points, credits, chips, tokens, or any unit of account | `TC-A06` vocabulary scan |
| NR-102 | Contain a wallet, balance, or account holding a quantity of anything transferable | `TC-A06` schema scan |
| NR-103 | Contain a ledger, posting, transaction, or double-entry structure | `TC-A06` |
| NR-104 | Transfer any value between players, or between a player and the system | `TC-A06` |
| NR-105 | Contain pricing, purchasing, checkout, payment, or refund functionality | `TC-A06` dependency and route scan |
| NR-106 | Integrate any payment service provider | `TC-A06` |
| NR-107 | Record a penalty, fee, stake, buy-in, or forfeit | `TC-A06` |
| NR-108 | Produce a financial report, export, or reconciliation | `TC-A06` |
| NR-109 | Contain administrative functionality for issuing, adjusting, or revoking any quantity held by a user | `TC-A06` |

### 4.3 NR-2xx — No assistance, automation, or artificial players

| ID | The system must not… | Verified by |
|---|---|---|
| NR-201 | Contain an AI or algorithmic player, bot, or automated opponent | `TC-A07` |
| NR-202 | Substitute for, or act on behalf of, an absent or disconnected player | `TC-A07` |
| NR-203 | Recommend, suggest, rank, or highlight a move, tile, or action | `TC-A07` |
| NR-204 | Analyze a player's hand for any purpose whatsoever | `TC-A07` |
| NR-205 | Compute proximity to a winning hand, hand strength, or any similar metric | `TC-A07` |
| NR-206 | Contain a solver, search, or evaluation function over game state | `TC-A07` |
| NR-207 | Explain, summarize, or interpret Mahjong rules to a player | `TC-A07` |
| NR-208 | Detect cheating by analyzing the contents of a hand | `TC-A07` |
| NR-209 | Send any player's tile data to an external service, model, or API | `TC-P05` egress assertion |
| NR-210 | Automatically perform any binding action on a player's behalf, including on a timer | `TC-A08` |
| NR-211 | Automatically pass, discard, draw, claim, expose, or declare | `TC-A08` |

### 4.4 NR-3xx — No manipulation of a player's own hand

| ID | The system must not… | Verified by |
|---|---|---|
| NR-301 | Sort a player's tiles by suit, rank, or any other ordering | `TC-A09` |
| NR-302 | Group, cluster, or align a player's tiles by similarity | `TC-A09` |
| NR-303 | Group jokers, flowers, or any other category together | `TC-A09` |
| NR-304 | Reorder a player's rack after a draw, a pass, a claim, or a rewind | `TC-A09` order-preservation test |
| NR-305 | Offer a "best arrangement," "auto-arrange," or "tidy" affordance | `TC-A09` |
| NR-306 | Change a player's chosen tile order for any reason other than that player moving a tile | `TC-A09` |

> **Note on the strength of this family.** The player's rack order is *their* information and *their*
> workspace. A physical player arranges tiles by hand, in an order that often encodes their intent,
> and no dealer would reach over and rearrange them. The system preserves the chosen order across
> draws, passes, reconnections, and rewinds. The only actor that ever changes it is the owning
> player. See `docs/11 §6`.

### 4.5 NR-4xx — No observers

| ID | The system must not… | Verified by |
|---|---|---|
| NR-401 | Provide a spectator, observer, viewer, or audience role | `TC-A10` role enumeration |
| NR-402 | Deliver table state to any connection not bound to one of the four seats | `TC-P01` subscription authorization |
| NR-403 | Provide a public, shareable, or link-accessible view of a live game | `TC-A10` route scan |
| NR-404 | Provide an external API through which a game may be observed | `TC-A10` |
| NR-405 | Broadcast, stream, or syndicate game state to any third party | `TC-P05` |
| NR-406 | Allow an administrator to view a live table's concealed hands through any normal application surface | `TC-P02` |
| NR-407 | Allow support or operations personnel to view a concealed hand | `TC-P02` |

### 4.6 NR-5xx — No leakage of concealed information

| ID | The system must not… | Verified by |
|---|---|---|
| NR-501 | Send a seat's concealed tile faces to any other seat | `TC-P01` full-game frame inspection |
| NR-502 | Send the wall order, or any part of it, to any client | `TC-P01` |
| NR-503 | Send the shuffle salt to any client | `TC-P01` |
| NR-504 | Write a concealed tile face into any log, metric, trace, span, or crash report | `TC-P03` log scanner |
| NR-505 | Include tile data in an analytics event or product-telemetry payload | `TC-P05` |
| NR-506 | Persist concealed material in plaintext | `TC-P04` storage inspection |
| NR-507 | Retain concealed material after the game it belongs to has closed | `TC-P04` purge assertion |
| NR-508 | Provide a replay, export, or archive from which a concealed hand can be reconstructed | `TC-A11` |
| NR-509 | Expose a debug, development, or diagnostic endpoint that reveals concealed state | `TC-P02` |
| NR-510 | Reveal a seat's private rack ordering or selection state to any other seat | `TC-P01` |

### 4.7 NR-6xx — No client authority

| ID | The system must not… | Verified by |
|---|---|---|
| NR-601 | Accept a client-supplied seat identifier on any table operation | `TC-I01` |
| NR-602 | Accept a client's assertion about the contents of any hand, the wall, or the discard pile | `TC-I02` |
| NR-603 | Allow a client to influence, seed, reorder, or observe the shuffle | `TC-R01` |
| NR-604 | Allow a client to select which tile it draws | `TC-R02` |
| NR-605 | Apply a state change that originated anywhere other than the authoritative table actor | `TC-I03` |
| NR-606 | Trust a client-supplied sequence number, timestamp, or identity claim | `TC-I01` |

---

## 5. Boundary cases and their resolutions

Several design questions sit close enough to the boundary that reasonable people place them on
different sides. Each is resolved here so the resolution is not re-litigated during implementation.

| Question | Resolution | Why |
|---|---|---|
| Is the 152-tile set a rule? | **No — it is equipment.** | What is in the tile case is a property of the physical set, like a deck having 52 cards. It is recorded as an owner-confirmed equipment specification in `docs/07 §3`, not derived from rules. |
| Is dealing 13 tiles (14 to East) a rule? | **It is a dealing procedure, applied once.** | The dealer performs an opening procedure; that is mechanics. Critically, the count is *not* enforced afterwards (`NR-009`), which is where the rule would actually live. |
| Is the turn pointer a rule? | **No — it is shared attention, made explicit.** | The pointer records where the table believes play is. It gates only wall draws. Any player may take the current discard and move the pointer, and the system never asks whether they should have. See `docs/09 §6`. |
| Is "only the most recent discard is claimable" a rule? | **No — it is physical reach.** | The current discard sits where a hand can reach it; older discards are in the pile. Retrieving an older one is a correction, not a claim. `docs/10 §5.4`. |
| Is a pass round a Charleston? | **The system does not know what a Charleston is.** | It provides a simultaneous, secret, atomic exchange with a routing chosen by the players. Count, direction, repetition, and legality are entirely theirs. `docs/10 §6`. |
| Is wall exhaustion an ending rule? | **No — it is a physical fact.** | The wall runs out; that is observable without knowing any rules. What it *means* is for the players. The system records `WallExhausted` and lets them decide. |
| Is the ephemeral chat in scope? | **Yes, and it is load-bearing.** | A table whose players adjudicate for themselves must be able to talk. Without a channel the design does not function. It is ephemeral precisely to keep the privacy surface minimal. `docs/05 §9`. |
| May the UI show a tile count? | **Yes — counts are public.** | At a physical table you can see how many tiles are on someone's rack. Counts are `PUB`; faces are `OWN`. `docs/14 §4`. |
| May the UI show which tiles a player has selected? | **Only to that player.** | Selection state is `OWN`. During a pass round the *number* committed is public, mirroring visible pushed tiles; the identities are not. |

---

## 6. Amendment

An `NR-###` entry may be removed or weakened only through the amendment process in
`docs/00 §12`, which requires an ADR and the project owner's approval. Adding a new `NR-###` is
encouraged and requires only that it be checkable and cross-referenced.

Two entries are additionally marked **constitutional**: `NR-001` (no rules engine) and `NR-101` (no
unit of account). Amending either does not modify this project; it starts a different one.

---

## 7. Cross References

| Document | Focus |
|---|---|
| `docs/00_Project_Overview.md` | Constraints `C-##` and the amendment process |
| `docs/01_Product_Requirements.md` | The positive `FR-###` / `NFR-###` catalogs |
| `docs/02_System_Scope.md` | The three contracts and the mechanical/rule validation boundary |
| `docs/14_Player_Privacy.md` | The visibility model that `NR-5xx` protects |
| `docs/34_Testing/Privacy_and_Absence_Suites.md` | The `TC-A*` and `TC-P*` suites that enforce this catalog |
| `docs/31_ADR/ADR-0002-rule-agnostic-architecture.md` | The decision this document elaborates |
| `docs/31_ADR/ADR-0003-no-point-system.md` | The decision `NR-1xx` elaborates |
| `REQUIREMENTS_TRACEABILITY_MATRIX.md` | Where every `NR-###` is traced to its test |

---

## 8. Revision History

| Version | Date | Author | Changes |
|---|---|---|---|
| 0.1 | 2026-09-02 | Design (architect role), owner-approved | Initial catalog: 62 negative requirements across six families, responsibility matrix, boundary-case resolutions |
