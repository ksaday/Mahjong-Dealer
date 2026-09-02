# ADR-0016 — Bounded consent-based rewind, with wall reshuffle

| | |
|---|---|
| **Status** | Accepted |
| **Date** | 2026-09-02 |
| **Owning chapter** | 05_Game_Table_Architecture.md |
| **Deciders** | Project owner |

## Context

A rules-enforcing game does not need a correction mechanism: it prevents the illegal action. A
neutral table (`ADR-0001`) has no such protection, and it will faithfully execute mistakes — a
misclicked discard, a claim nobody was entitled to, a draw taken out of turn.

At a physical table these are trivial. Someone says "hold on, that wasn't your turn," everyone looks,
everyone agrees, and the tiles go back. The whole exchange takes ten seconds and nobody thinks of it
as a feature.

Digitally, if nothing corresponds to it, a single misclick ends the game. That is a much worse
outcome than any complexity a correction mechanism costs, and it would happen regularly.

The design question is what shape the mechanism takes, and in particular whether restoring an
earlier state creates a privacy problem — since players will have seen things in the state being
discarded.

## Options Considered

### Option A — No correction mechanism

Advantages: nothing to build; no rewind semantics to reason about.

Disadvantages: a misclick ends a game. The only remedy is abandoning and re-dealing, which discards
an hour of play over a single click.

### Option B — Manual fix-up primitives

Give players raw commands to put things back: move a tile from the discard pile to a seat, hand a
tile to another seat, return a tile to the wall.

Advantages: no checkpoint machinery; each primitive is simple.

Disadvantages: fiddly precisely when players are already flustered, and multi-step so it can be got
half-right, leaving a state nobody intended. Worse for privacy than a rewind, not better: an ad-hoc
"give tile Y to seat 3" is a novel information flow with no physical analogue, whereas a rewind
restores a state that already existed. And each primitive is a new command with its own ownership
and authorization surface.

### Option C — Unbounded rewind

Advantages: any mistake, however old, is correctable.

Disadvantages: checkpoint retention grows without limit; players' memory of a state twenty actions
back is unreliable, so unanimity becomes uninformed; and rewinding across a deal would resurrect
material purged at game close (`ADR-0010`).

### Option D — Bounded, unanimous rewind with a wall reshuffle

Advantages: covers real mistakes, which are noticed within a turn or two; bounded retention;
unanimity while everyone still remembers the state; and the one genuine information leak is
neutralized by re-randomizing the undrawn wall.

Disadvantages: a vote protocol, an overlay state, and a reshuffle path to build; an uncooperative
player can block a correction.

## Decision

**Option D.** Any seat may propose rewinding to an earlier sequence; the other three must all
accept; the actor then restores the encrypted checkpoint at that sequence.

| Bound | Value |
|---|---|
| Scope | The current game only, never across a deal |
| Depth | The last 10 public actions |
| Concurrency | One open proposal at a time |
| Consent | Unanimous among the other three; no default, no timeout-accept |
| Timeout | 60 seconds, expiring as a **rejection** |
| Initiation | Players only; the system never proposes one (`NR-210`) |
| Visibility | Public and permanently recorded |

**A rewind that crosses a wall draw reshuffles the undrawn remainder of the wall and publishes a
fresh commitment** (`08 §7.2`).

## Rationale

### Why unanimity

A rewind rolls back other people's actions. A majority rule would let three players overrule a
fourth's legitimate move, which is a griefing tool rather than a correction mechanism. Requiring the
timeout to expire as a *rejection* follows from the same principle: silence is not consent, and a
disconnected player must never be treated as agreeing.

### Why bounded

Depth ten covers the realistic case. Mistakes at a table are noticed within a turn or two, because
the players are watching. Beyond that, the shared memory that makes unanimity meaningful degrades —
players would be voting on a state they no longer remember clearly. Bounded depth also keeps
checkpoint retention small and prevents a rewind reaching a purged game.

### The information analysis

This is the part that decides the mechanism is safe, and it was worked through per action type
rather than settled by intuition (`05 §8.4`).

| Rewound action | Information leaked |
|---|---|
| Discard | **None.** The tile was public when discarded. |
| Claim | **None.** Public throughout. |
| Exposure | **None new.** Seen when exposed; retraction is a normal action with the same property. |
| Pass round | **None.** Each seat sees only what it sent and received, as before. |
| Hand arrangement | **None.** Private throughout. |
| **Wall draw** | **Real.** The drawing seat saw a tile that may now go to someone else. |

One row out of six. The objection that rewind is broadly privacy-hostile does not survive the
enumeration — five of the six cases restore state whose contents were already known to everyone who
will see them again.

### Why the reshuffle answers the sixth

Re-randomizing the undrawn remainder means the tile the player saw is no longer in a predictable
position. Hands, discards, and exposures are left exactly as restored — a rewind must restore the
past, not invent a new one — and only the future is re-randomized.

This is also what physical players do when a tile is accidentally exposed, so the fix is the
faithful answer as well as the private one. That convergence is a good sign.

The alternative considered was forbidding rewinds that cross a wall draw. It was rejected because
drawing out of turn is one of the most common table mistakes, and a correction mechanism that cannot
correct it is useless in the case it is most needed.

### Cost

Checkpoints already exist for crash recovery (`ADR-0010`), so the marginal cost of this feature is
the vote protocol and the reshuffle — not the persistence machinery.

Serves `OBJ-04`, `OBJ-05`, and follows from `ADR-0001`.

## Consequences

**Positive.** A misclick no longer ends a game. The remedy matches the physical one. The system takes
no view on whether a correction is warranted, so it stays neutral. Checkpoints serve two features.

**Negative.** A vote protocol, an overlay state, and a reshuffle path to build and test. An
uncooperative player can block every correction. A rewind changes the future, and players must be
told a reshuffle occurred.

**Follow-up obligations.** `05 §8` must specify the protocol and bounds. `08 §7.2` must specify the
reshuffle. `TC-R08` must assert that a reshuffle leaves hands, discards, and exposures
byte-identical. The correction path must verify the conservation invariant after every restore.

## Cross References

`05_Game_Table_Architecture.md §8` · `08_Shuffle_and_Deal_Architecture.md §7.2` ·
`09_Game_State_Machine.md §5` · `16_Data_Architecture.md §5` ·
`ADR-0001` · `ADR-0008` · `ADR-0010` · `FR-120`–`FR-127`
