# ADR-0004 — Fixed four-seat table; no bots, substitutes, or spectators

| | |
|---|---|
| **Status** | Accepted |
| **Date** | 2026-09-02 |
| **Owning chapter** | 05_Game_Table_Architecture.md |
| **Deciders** | Project owner |

## Context

A table needs a shape. Three questions have to be answered together, because the answers interact:
how many seats, whether the system can fill an empty one, and who besides the occupants may see what
happens.

Each has an obvious "flexible" answer — variable seat counts, a bot to cover a dropout, a spectator
mode for onlookers — and each of those answers has consequences that reach much further than they
first appear.

## Options Considered

### Option A — Flexible seating with bots and spectators

Advantages: a game can start with fewer people and continue when someone leaves; onlookers can
watch; the product feels more accommodating.

Disadvantages: a bot must decide what to discard, which requires the rules (`NR-201`, `ADR-0001`) —
so a bot is not merely out of scope, it is unbuildable within this architecture. Variable seat counts
make every seat-relative mechanic and the entire table layout conditional. And a spectator is a
principal who receives table information without occupying a seat, which is the single largest hole
that could be made in the privacy model: the moment the system can deliver a view to a non-seat, the
question becomes *which* view, and every answer is a policy that can be got wrong.

### Option B — Four seats, no bots, spectators permitted

Advantages: avoids the bot problem; onlookers can watch.

Disadvantages: retains the spectator hole. It also creates a mismatch with the correction and
declaration mechanisms, which assume exactly four principals whose unanimous agreement means
something.

### Option C — Exactly four human players, nobody else

Advantages: every seat-relative mechanic is fixed; the layout is fixed; unanimity has a precise and
constant meaning; the privacy model has exactly four recipients and no policy question about
partial views; and no component ever needs to decide what a non-player may see.

Disadvantages: a game cannot start without four people; a dropout stalls the table; onlookers cannot
watch.

## Decision

**Option C.** Exactly four human players occupy a table. There are no artificial players, no
substitution for an absent player, and no spectator, observer, or viewer role of any kind. Recorded
as constraint `C-04` and enforced by `NR-201`, `NR-202`, and `NR-401` through `NR-407`.

Seats are fixed compass positions — East, South, West, North — permanent for the life of a table.

## Rationale

The bot question resolves itself: an artificial player must choose discards, and choosing well
requires the rules. There is no version of a bot compatible with `ADR-0001`, so this is not a
trade-off but a consequence.

The spectator question is the substantive one, and it turns on a structural property rather than a
policy preference. If the only principals who can receive table information are the four bound
seats, then the authorization rule is *"is this connection bound to a seat at this table?"* — a
single boolean with no gradations. Introduce a spectator and the rule becomes *"what may this
principal see?"*, which is a policy, and policies have edge cases, defaults, and bugs. The privacy
model in `14` is strong precisely because it never has to answer that question.

Fixing the seat count at four buys a smaller but real simplification: every seat-relative
description in the documentation, every layout decision, and every unanimity rule has one meaning
rather than a family of meanings parameterized by table size.

The cost — a dropout stalls the table — is handled by auto-pause and reconnection (`22`), and by the
option for the remaining three to unanimously abandon (`FR-147`). At a physical table, when someone
leaves, play stops. The digital table behaves the same way.

Serves `OBJ-02`, `OBJ-04`, `OBJ-06`.

## Consequences

**Positive.** The authorization question for table information is a single boolean. Seat-relative
mechanics and layout are fixed. Unanimity has a constant meaning across correction, declaration, and
abandonment. No component ever computes a partial or anonymized view.

**Negative.** Four people are required to play. A disconnection stalls the table until the player
returns or the others abandon. Onlookers cannot watch a friend's game.

**Follow-up obligations.** Auto-pause and reconnection must be good enough that an ordinary
disconnection is uneventful (`22`). The absence suite must assert that no role enumeration contains
a spectator and that no route delivers table state to an unbound connection (`TC-A10`, `TC-P01`).

## Cross References

`05_Game_Table_Architecture.md` · `04_User_Roles_and_Access.md` · `14_Player_Privacy.md` ·
`22_Disconnect_and_Reconnect.md` · `ADR-0001` · `ADR-0006` · `C-04` · `NR-201`, `NR-202`, `NR-401`
