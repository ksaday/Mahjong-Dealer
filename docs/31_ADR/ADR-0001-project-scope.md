# ADR-0001 — Project scope: a table and a dealer, not a game

| | |
|---|---|
| **Status** | Accepted |
| **Date** | 2026-09-02 |
| **Owning chapter** | 00_Project_Overview.md |
| **Deciders** | Project owner |

## Context

The project begins with an ambiguity that has to be resolved before anything else can be designed.
"An American Mahjong web application" can mean at least two products, and they differ in almost
every particular.

One is a **game**: it knows the rules, validates moves, recognizes winning hands, keeps score, and
manages a competitive structure. The other is a **table**: it holds the tiles, shuffles, deals,
moves tiles when told to, keeps hidden things hidden, and has no opinion about what any of it means.

The difference is not a matter of feature count. It determines whether there is a rules engine, and
therefore whether there is configuration, versioning, validation, scoring, dispute machinery,
copyright exposure over hand patterns, and an ongoing obligation to track rule changes. It also
determines what the players do: in the first product they are supervised, in the second they are in
charge.

Constraints that apply from the outset: this is a new independent project (`C-10`), and the players
are assumed to know the rules and to own a rule book the system will never see.

## Options Considered

### Option A — A rules-aware game

Advantages: familiar product shape; prevents illegal moves; can score and rank; players need not
adjudicate.

Disadvantages: requires encoding a rule set the project has no licence to and no authority over;
requires annual maintenance as rule cards change; makes the software an arbiter in disagreements
between players who may be using a different edition; substitutes supervision for the social
activity that playing at a table largely consists of; and creates a large surface — validation,
scoring, dispute records — that has to be built, tested, and defended.

### Option B — A rules-aware game with enforcement optional

Advantages: appears to offer both products.

Disadvantages: the rules must exist in the codebase regardless of whether they are switched on, so
every cost of Option A is incurred; and an optional check is a permanent invitation to make it
mandatory "just this once."

### Option C — A neutral table and dealer

Advantages: no rule set to encode, licence, version, or defend; the players remain the authority on
their own game; a dramatically smaller system; a clean and testable scope boundary; and a faithful
reproduction of the physical experience, in which the dealer moves tiles and the players play.

Disadvantages: the software will faithfully execute mistakes; players must pay attention and
adjudicate for themselves; and some users will expect the conveniences a rules-aware product offers.

## Decision

**Option C.** The product is a digital Mahjong table with a digital dealer. It reproduces the
mechanical duties of a table and a dealer and knows nothing about the rules of Mahjong.

The one-sentence definition, adopted as the project's governing statement:

> A neutral table that moves tiles when players tell it to, keeps hidden things hidden, and never
> has an opinion about the game.

## Rationale

The decision follows from what the players actually bring to the table. They already know the rules
and already own a rule book; the system would be duplicating knowledge they have, in a version that
might not match theirs, in order to supervise them at an activity they are competent at.

It also follows from what a physical table *is*. The watching, challenging, and agreeing that
players do is not overhead around the game — it is a substantial part of the game. Software that
takes those duties over does not produce a better table; it produces a different activity.

The engineering consequences are decisive on their own. Option C removes the largest and most
uncertain component of Option A — a rules engine with a maintenance obligation and a copyright
exposure — and replaces it with nothing. What remains is small enough to specify completely and
defend properly, which is what makes the privacy and integrity guarantees in this documentation set
achievable rather than aspirational.

Serves `OBJ-01`, `OBJ-02`, `OBJ-04`, and `OBJ-11`.

## Consequences

**Positive.** No rules engine, no rule configuration, no scoring, no hand-pattern data, and no
licensing exposure. A far smaller system, in which effort concentrates on the things that genuinely
require software: randomization, hidden information, synchronization, and recovery. Players retain
complete agency.

**Negative.** Mistakes go through. Players must attend to the game. Some users will want the
conveniences and will not find them.

**Follow-up obligations.** A correction mechanism is required, because a neutral table makes a
misclick unrecoverable without one (`ADR-0016`). A communication channel is required, because
players who adjudicate must be able to talk (`05 §9`). The scope boundary must be testable, not
merely stated (`ADR-0002`).

## Cross References

`00_Project_Overview.md` · `02_System_Scope.md` · `SCOPE_BOUNDARIES.md` ·
`ADR-0002` · `ADR-0003` · `ADR-0016` · `C-01`, `C-02`, `C-04`
