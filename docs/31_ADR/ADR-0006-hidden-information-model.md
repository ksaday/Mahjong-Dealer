# ADR-0006 — Hidden-information model and the three visibility classes

| | |
|---|---|
| **Status** | Accepted |
| **Date** | 2026-09-02 |
| **Owning chapter** | 14_Player_Privacy.md |
| **Deciders** | Project owner |

## Context

A Mahjong table is a hidden-information game, and the hiding is physical: tiles sit behind a rack
facing their owner, and the geometry does the work. Digitally, the geometry is gone. Every byte the
server holds is equally reachable by every code path, and a concealed hand is concealed only because
the software chose not to send it.

That choice has to be made correctly on every frame, in every code path, forever. Approaches that
depend on remembering to make it correctly will fail eventually — not dramatically, but in one
overlooked debug endpoint or one convenient broadcast helper added under time pressure.

There is also a second, sharper question. Some data is not merely private to one player but private
to nobody: the wall order is not "East's information," it is information no player is entitled to at
all. A two-class public/private model has no natural place for it, and putting it in the private
class invites the question "private to whom?"

## Options Considered

### Option A — Public and private, enforced by review

Advantages: simple to describe.

Disadvantages: relies on every author and reviewer applying it on every frame. Has no place for the
wall order. Fails silently.

### Option B — Public and private, with a filter applied before sending

Advantages: centralizes the decision.

Disadvantages: a filter is a *removal* step, so the default is to include and the failure mode is to
leak. A new field is exposed unless someone remembers to add it to the filter.

### Option C — Three classes, one projector, and type-level enforcement

Advantages: the wall order gets its own class with an unambiguous meaning; exactly one function
produces client-bound payloads, so there is one place to audit; and the projector *constructs* a
view rather than filtering a state, so a new field is absent unless someone deliberately adds it —
the default is to omit. Branded types make passing concealed material to a logger a compile error.

Disadvantages: three artifacts to maintain; the branded types add friction when writing new code
that legitimately handles concealed material.

## Decision

**Option C.** Three visibility classes:

| Class | Audience | Contents |
|---|---|---|
| `PUB` | all four seats | seats, presence, readiness, turn pointer, wall count, discard pile, exposures, hand counts, pass-round commit counts, declarations, corrections, pause state |
| `OWN` | one seat only | that seat's concealed faces, rack order, selection, pass commitment contents |
| `SRV` | the server process only | wall order, commitment salt, checkpoint private regions |

Enforced by three mechanisms: **one seat-view projector** that constructs (never filters) a view and
takes a seat as a parameter; **branded types** with a recursive `NoConcealed<T>` guard on every
logging, metrics, and tracing entry point; and **encryption plus role-level column denial** at rest.

`SRV` carries an explicit clause: *server-side possession is not human visibility*. The process may
hold the value; no person and no downstream system may receive or reconstruct it.

## Rationale

The three mechanisms are chosen to fail at different times, which is why all three exist. The type
system fails at compile time, the projector's construct-don't-filter shape fails at authoring time
(a forgotten field is simply absent), and the log scanner fails at test time. A leak has to defeat
all three.

**Construct rather than filter** is the most important detail. A filter's default is to include, so
its failure mode is disclosure. A constructor's default is to omit, so its failure mode is a missing
field — visible immediately, and harmless.

The third class earns its place by removing an ambiguity rather than adding a category. "The wall
order is private" prompts "to whom?", and any answer that names a principal is wrong. `SRV` says the
correct thing: to nobody.

Serves `OBJ-06` directly, and `C-03`.

## Consequences

**Positive.** The privacy claim reduces to auditing one function and one type, which is verifiable
rather than assertable. A new state field is invisible to clients until deliberately projected.
Leaking to a logger does not compile.

**Negative.** Every client-bound field must be added to the projector explicitly, which is slightly
more work than a filter. The branded types add friction in code that legitimately handles concealed
material.

**Follow-up obligations.** A CI check must assert exactly one projector exists (`TC-P07`). A
compile-time proof file must assert the branded types still reject the forbidden shapes, with the
assertions counted so the guard cannot be silently disabled (`TC-P06`). Frame inspection over
complete randomized games must assert no leak (`TC-P01`).

## Cross References

`14_Player_Privacy.md` · `07_Tile_Model.md §5.3` · `20_Logging_and_Observability.md` ·
`34_Testing/Privacy_and_Absence_Suites.md` · `ADR-0013` · `C-03` · `NR-501`–`NR-510`
