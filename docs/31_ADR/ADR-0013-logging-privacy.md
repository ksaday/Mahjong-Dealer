# ADR-0013 — Logging privacy: branded types, one serializer, log scanner

| | |
|---|---|
| **Status** | Accepted |
| **Date** | 2026-09-02 |
| **Owning chapter** | 20_Logging_and_Observability.md |
| **Deciders** | Project owner |

## Context

The privacy model (`ADR-0006`) governs what reaches a client. It says nothing about what reaches a
log file, a metrics label, a trace span, or a crash report — and those are, empirically, where
private data ends up.

The mechanism is always the same and always innocent. Someone debugging a hard problem adds
`log.debug('state', state)` to see what is happening. It works, the problem is solved, and the line
survives review because it is obviously temporary. Six months later that line is running in
production, writing concealed hands into a log aggregator that is retained for ninety days and
readable by anyone with operations access.

The system's most sensitive values — a concealed hand, the wall order — are exactly the values a
developer most wants to see when something is wrong. Any control that relies on developers choosing
not to log them at the moment they most want to is going to fail.

## Options Considered

### Option A — A logging policy and code review

Advantages: no machinery.

Disadvantages: fails for the reason above. The violating line looks like diligence, not
carelessness.

### Option B — Runtime redaction in the logger

Advantages: catches whatever reaches the logger regardless of the call site.

Disadvantages: redaction must recognize the shape of what it is removing, so a value in an
unanticipated shape — a hand embedded in an error message, a tile code inside a string — passes
through. It is a filter, so its default is to emit.

### Option C — Type-level prohibition, plus redaction, plus a scanner

Advantages: the primary control fails at compile time, so the offending line never reaches a branch;
redaction catches dynamically-constructed values the types could not see; and the scanner catches
what both missed, in CI, against real captured output.

Disadvantages: three mechanisms; the branded types add friction; the scanner needs tuning to avoid
false positives.

## Decision

**Option C.** Three layers, failing at three different times.

**Compile time — the primary control.** Concealed material carries branded types (`ConcealedHand`,
`WallOrder`, `Salt`, `TileFace`). A recursive `NoConcealed<T>` mapped type renders any
concealed-carrying property unusable. Every logging, metrics, and tracing entry point takes
`NoConcealed<T>`. Passing a hand to a logger **does not compile** (`NFR-014`).

**Runtime — the backstop.** A redactor at the logging boundary strips values matching the `face#copy`
pattern (`07 §5.2`) and known private field names, replacing them with a marker that is itself
logged as an anomaly — a redaction firing in production is a defect report.

**CI — the proof.** A scanner runs over the complete log, metric, and trace output of a full
captured game and fails the build on any tile-face pattern. It is exercised against a **planted
signature** that it must detect and an honest line it must ignore, so the scanner is proven to work
rather than assumed to (`TC-P03`).

**Error reporting** carries identifiers only — `cmdId`, `tableId`, `seq`, error code, stack — and
never state.

## Rationale

The layering is the decision, and each layer covers the previous layer's blind spot.

Types cannot see a value assembled at runtime from strings. Redaction cannot recognize a shape it
was not told about. A scanner can only find what was actually emitted during the run. Together they
cover static call sites, dynamic construction, and everything that actually appeared in output — and
a leak has to defeat all three.

The **planted-signature control** is the part most often omitted and most worth keeping. A privacy
scanner that has never fired is indistinguishable from a scanner that is broken, misconfigured, or
scanning the wrong file. Requiring it to detect a deliberate violation on every run proves it is
still doing its job.

Making a redaction event **itself a logged anomaly** turns the backstop into a detector. If
redaction fires in production, a code path is passing concealed material to a logger and someone
should know.

Serves `OBJ-06`, and `C-03`.

## Consequences

**Positive.** The most likely leak path is closed at compile time. Two independent backstops cover
what types cannot. The scanner is proven functional on every run. Debugging conventions that would
leak fail immediately rather than in production.

**Negative.** Developers cannot log the values they most want to see, and must use the alternatives
in `20 §6` — identifiers, shapes, counts, and the deterministic core's testability. The branded types
add friction. The scanner will occasionally need tuning.

**Follow-up obligations.** `20` must specify what may be logged and give developers a workable
debugging method that does not involve dumping state. A compile-time proof file with counted
assertions must prevent the branded types from being silently disabled (`TC-P06`). The scanner must
run against real captured output, not synthetic input.

## Cross References

`20_Logging_and_Observability.md` · `14_Player_Privacy.md §6` · `07_Tile_Model.md §5.2` ·
`34_Testing/Privacy_and_Absence_Suites.md` · `ADR-0006` · `C-03` · `NR-504`, `NR-505`, `NFR-011`, `NFR-014`
