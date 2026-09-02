# ADR-0015 — TypeScript end-to-end with Fastify

| | |
|---|---|
| **Status** | Accepted |
| **Date** | 2026-09-02 |
| **Owning chapter** | 03_System_Architecture.md |
| **Deciders** | Project owner |

## Context

The documentation must name a stack, because an unnamed stack is a decision deferred to whoever
implements first, and different agents implementing different parts would choose differently.

Two properties of this system constrain the choice more than the usual criteria do.

First, the privacy model depends on **type-level enforcement** (`ADR-0006`, `ADR-0013`). Branded
types and a recursive `NoConcealed<T>` guard are the primary control against leaking concealed
material into a log or a frame. That control requires a static type system expressive enough to
carry a phantom brand through a recursive mapped type — which is not a universal feature.

Second, the wire protocol is **normative and machine-checked** (`19`). A single language across the
client/server boundary makes the protocol a shared compiled artifact rather than two hand-maintained
descriptions that drift.

## Options Considered

### Language

**TypeScript.** Branded types and recursive mapped types are natural. One language across the wire
boundary. Large ecosystem. Weakness: types are erased at runtime, so schema validation is still
needed at the boundary — which the design requires anyway (`M-5`).

**Go.** Excellent concurrency and operational simplicity, but the type system cannot express the
`NoConcealed<T>` guard, so the primary privacy control would have to be replaced by convention and
review — a significant weakening.

**Rust.** Strong enough types and excellent guarantees, but a different language on the client, so
the protocol contract is duplicated; and the concurrency strengths address a problem the
single-writer actor already removes.

**Python.** Gradual typing is not load-bearing enough for a control the privacy model depends on.

### Server framework

**Fastify directly.** Roughly two dozen routes plus a socket gateway. Fast, small, first-class
schema validation at the boundary — which the design needs regardless.

**NestJS.** Modules, providers, dependency injection, decorators. Excellent for large team-scaled
services; here it would impose more structure than the application has, and its abstractions would
sit between the reader and roughly two dozen routes.

**Express.** Widely known, but no first-class schema validation and slower on the socket path.

### Client

**React.** Mature, well-understood, excellent for a DOM-first interactive surface.

**Svelte or Solid.** Smaller and faster, but the table's interactivity is a few dozen elements and
the bottleneck is network latency rather than framework overhead; the ecosystem advantage of React
is worth more here than the runtime difference.

## Decision

| Layer | Choice |
|---|---|
| Language | TypeScript, strict, everywhere |
| Client | React, DOM-first table rendering |
| Server | Node with Fastify |
| Core | `dealer-core` — a pure TypeScript package |
| Data | PostgreSQL |
| Realtime | Native WebSocket (`ADR-0007`) |

Strict configuration is part of the decision, not a detail: unchecked index access and exact
optional properties in particular are what make the branded types genuinely load-bearing rather than
advisory.

## Rationale

TypeScript is chosen for a specific capability rather than familiarity. The privacy model's primary
control is a type, and TypeScript expresses it. Go, which would otherwise be an excellent fit for a
single-process socket server, cannot — and replacing a compile-time guarantee with a review
convention would weaken the strongest claim in this documentation set.

One language across the boundary is the second reason. `shared` holds the protocol as compiled types
plus runtime validators, so the client and server cannot disagree about the wire format, and the CI
catalog check (`TC-P08`) compares the documentation against a single source rather than two.

Fastify over NestJS is a proportionality judgment (`OBJ-11`). NestJS's structure pays off when many
teams work on one service for years; this service is two dozen routes, one socket gateway, and a
table actor. Its schema validation also lands exactly where the design already needs it — at the
boundary, as part of `M-5`.

DOM-first rendering gives keyboard focus, accessible names, and text rendering without
reimplementation, all of which `24` requires and a canvas would have to rebuild.

## Consequences

**Positive.** The privacy guard is a compile error. The protocol has one definition. The server is
small enough to read. Accessibility comes largely from the platform.

**Negative.** Node's single-threaded model means CPU work blocks the event loop — acceptable, since
the heaviest operation is a shuffle over 152 elements. TypeScript's erasure means runtime validation
is still required at the boundary. React ships more bytes than a compile-time framework.

**Follow-up obligations.** The strict compiler configuration must be fixed and enforced in CI, since
the branded types depend on it. Lint rules must enforce the dependency law (`03 §4.1`) and the purity
of `dealer-core` (`03 §5`). Schema validators must exist for every inbound command.

## Cross References

`03_System_Architecture.md` · `14_Player_Privacy.md §6` · `19_WebSocket_Event_Catalog.md` ·
`24_Accessibility.md` · `ADR-0006` · `ADR-0007` · `ADR-0013` · `NFR-060`, `NFR-061`
