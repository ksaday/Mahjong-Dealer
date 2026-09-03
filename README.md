# American Mahjong Dealer

> **The Dealer moves the tiles. The Players play the game.**
>
> The system knows physical facts, not Mahjong judgments.

A design documentation package for a web application that recreates the experience of sitting at a
physical American Mahjong table with a human dealer — for four human players.

**This repository contains no application code.** It is the specification from which the
application will be built.

---

## Start here

### **→ [PROJECT_DESIGN_README.md](PROJECT_DESIGN_README.md)**

That is the real entry point: project purpose, architecture summary, the full documentation map,
implementation principles, and instructions for implementation agents. This file exists only
because GitHub renders `README.md` on the repository front page; it owns no part of the design.

---

## What the application is

A **digital table and dealer**. Its entire responsibility is the mechanical half of a Mahjong
game — the part a physical table and a physical dealer perform:

- hold a complete tile set and keep every tile accounted for
- shuffle, build the wall, deal
- let players draw, discard, expose, retract, swap, and pass tiles
- track whose turn the table is at
- keep concealed hands concealed
- keep four players synchronized, and survive disconnections

The players supply everything else. They bring the rule book, they know the rules, they decide what
is legal, they decide who won, and they resolve their own disputes.

## What it is not

Permanent architectural exclusions, each recorded as a numbered negative requirement in
[SCOPE_BOUNDARIES.md](SCOPE_BOUNDARIES.md) and enforced by a dedicated test category:

| Not a… | Meaning |
|---|---|
| Rules engine | The system does not know the rules of American Mahjong and must never learn them |
| Judge | It never decides whether a move, call, exposure, joker use, pass, or declaration is legal |
| Winning-hand validator | It never decides whether a hand wins |
| Scoring system | It computes no score, value, or result beyond "the players concluded the game" |
| Financial system | No points, wallets, ledgers, prices, purchases, transfers, or currency of any kind |
| Rule book | It neither ships, stores, interprets, nor enforces any rule book or card |
| Assistant | It never suggests, recommends, sorts, groups, arranges, or optimizes anything |
| Spectator platform | No observer role, no live viewer, no broadcast, no external viewing API |
| Replay system | No replay, because a faithful replay reconstructs concealed hands |

## Contents

| Group | Contents |
|---|---|
| Root | 10 cross-cutting artifacts: scope, decisions, traceability, matrices, threat models, definition of done, readiness |
| `docs/00`–`30` | 31 numbered chapters, Project Overview through Risk Register |
| `docs/31_ADR/` | 16 Architecture Decision Records, plus index and template |
| `docs/32_UX/` | Screen inventory, table layout, tile component spec, interaction patterns |
| `docs/33_API/` | REST endpoint catalog, wire protocol contract, error code catalog |
| `docs/34_Testing/` | Privacy and absence suites; integrity and randomization suites |

**69 files · 37 diagrams · 341 recorded design decisions · 303 traced requirements**

## Architecture at a glance

TypeScript end-to-end — React client, Node/Fastify server, PostgreSQL, native WebSocket, no Redis
in v1. Four packages with a lint-enforced dependency law: `shared` (wire contract, branded types),
`dealer-core` (pure mechanics — no clock, no randomness, no I/O), `server`, `web`. One in-process
actor owns each table and serializes its commands.

Three contracts govern the design:

- **The Mechanism Contract** closes the server's validations at exactly five — existence,
  ownership, availability, authorization, sequencing.
- **The Absence Contract** makes 62 numbered negative requirements binding and machine-checkable.
- **The Fidelity Contract** gives seven ordered principles for interface decisions.

## For implementers

Read [IMPLEMENTATION_READINESS_CHECKLIST.md](IMPLEMENTATION_READINESS_CHECKLIST.md) before writing
any code. The rule that matters most:

> You are building a Mahjong **table**, not a Mahjong **game**. When the documentation seems to be
> missing a rule, **its absence is the design.**

The test to apply: *could a person who has never heard of Mahjong, looking only at the tiles and
the table, determine the answer?* If yes, it may be mechanics. If no, it is a rule, and it does not
belong in this system at any layer.

## Status

Design complete. Implementation has begun, following the phase order in
[IMPLEMENTATION_READINESS_CHECKLIST.md §6](IMPLEMENTATION_READINESS_CHECKLIST.md). In place: Phase 0
(repository, strict compiler configuration, dependency-law and purity lint); Phase 1's foundations in
`shared` (the tile face codec, seat order, branded types, and the `NoConcealed<T>` guard with its
proof file); and Phase 2 in `dealer-core` — tile-set construction, the unbiased shuffle, the
commitment scheme, the opening deal, the conservation invariant, checkpoint round-tripping, the seat
projector, and the full mechanical command catalog: dealing, drawing, discarding, claiming, exposing,
retracting, swapping, hand arrangement, pass rounds, declarations, end-game agreement, bounded
consent-based correction (with the wall-draw reshuffle), pause, and the table channel. Deliberately
out of `dealer-core`'s scope: `set_ready`/`clear_ready`/`close_table` (table-actor commands, Phase 4)
and `bind`/`resume`/`ping` (gateway commands, Phase 5).

The rest of Phase 1 is now also in place, in `shared`: the wire protocol — 30 client commands with
runtime schema validators, the 7 server frame types, the 39-event table catalog with PUB/OWN fields
declared per event, the rejection/close/notice code catalogs, and the wire seat-view schema — each
checked against `docs/19_WebSocket_Event_Catalog.md`'s tables for naming law, forbidden vocabulary,
and exhaustive coverage.

Phase 4's table actor is now in `server`: table lifecycle and seating (`docs/05`), a synchronous
`TableActor.submit` command pipeline (Node's own run-to-completion event loop giving "one writer, no
locks" for free), the three table-level commands `dealer-core` deliberately doesn't implement
(`set_ready`/`clear_ready`/`close_table`), a bounded checkpoint history for correction, and the
composition of a table's status with `dealer-core`'s projected game state into the wire
`WireSeatView`/`TableEvent` shapes — the reconciliation flagged as follow-up when the wire protocol
was built. A `TableHarness` (`docs/26` §3) drives it in tests with no transport.

Phase 3's schema is in `db`: two forward-only SQL migrations implementing all eleven tables from
`docs/17_Database_Design.md` — native enums, every constraint in `docs/17 §6` (one seat per account
platform-wide, at most one live game per table, single-use tickets, exactly-once command receipts),
append-only triggers on the event and audit logs, and column-level `REVOKE`/`GRANT` denying the
general application role `SELECT` on either encrypted `private_state` column — plus a UUIDv7
generator and a minimal migration runner (plain SQL rather than an ORM, so that DDL stays exact).
Registration, login, and session issuance — the rest of Phase 3 — are `server`'s job against this
schema; see below.

Phase 5's gateway is in `server`: binding (single-use connect tickets, one connection per seat, bind
deadline), the full `docs/13_Input_Integrity.md §9` command pipeline (`cseq` sequencing, rate
limiting, structural schema validation, `cmdId` idempotency, staleness checking on the five
order-sensitive commands), resumption with a 200-event backlog and a full-view fallback beyond it,
and byte-based backpressure tracking — all written against a transport-agnostic `SocketLike`
interface and unit-tested with no real network, then wired to a real `ws`-based WebSocket server and
proven against an actual socket in a smoke test.

The rest of Phase 3 — registration, login, sessions — is now in `server/src/auth/`: Argon2id password
hashing with a server-side pepper, durable per-account lockout (`accounts.failed_logins`/
`locked_until`), opaque SHA-256-hashed session tokens with absolute-and-idle expiry, double-submit
CSRF, and 8 of the 14 REST endpoints in `docs/33_API/REST_Endpoint_Catalog.md §3` (accounts and
sessions), wired up with Fastify and tested both as pure business logic (an in-memory repository) and
end-to-end over real HTTP (Fastify's `inject()`). Not built: heartbeat scheduling on the gateway side
(needs a real timer loop this slice doesn't add) — session-revocation polling was added once the
session store existed, see below — and, like `db`'s own migrations, the Postgres-backed repository is
written but not exercised against a live database.

The table half of that same REST catalog is now in `server/src/tables/`: the remaining 5 endpoints —
create, join, list mine, close, and connect-ticket — backed by a `TableManager` that holds one live
`TableActor` per table in a plain `Map` (one process owns a table, per `owner_node`, `docs/17 §5.4`)
and a `TableRepository` that mirrors the actor's own seat state into `tables`/`table_seats` only
after the actor itself accepts a seating change, never independently of it. Join codes use the
32-character unambiguous alphabet `docs/15 §7.2` specifies and are stored only as a SHA-256 hash,
like a session token; a full table on `POST /tables/join` gets the same uniform `404` as a wrong
code, per `docs/18 §4.2`, not a distinguishable rejection. The CSRF/session check `auth/http.ts` used
privately is now `auth/session-guard.ts`, shared by both route modules rather than duplicated. Not
built: reconstructing a table's live actor from its checkpoint after a restart (the in-memory
registry only knows about tables created during its own process's lifetime), `Idempotency-Key` on
table creation, the admin REST endpoints, and, again, a live-database exercise of the Postgres
repository.

A real deployment has many live tables, but `attachWebSocketGateway` only ever served one
`TableGateway`. `gateway/multi-table-router.ts` fixes that: it peeks the `tableId` a connect ticket
already carries (via a new non-consuming `TicketStore.peek`, alongside the existing consuming
`redeem`) to route each socket to its own table's gateway before that gateway ever sees it, then
replays the same bind frame so the real redemption still happens inside the destination gateway,
against the same ticket store. `gateway.ts` itself only changed by exporting two small frame-parsing
helpers both modules share.

Session revocation (docs/12 §4.3) is now built too: a bound socket whose session is revoked or
expired closes with `4004` within a few seconds, not just at its next REST request. `TableGateway`
gained `checkSessionRevocation`, a callable check (the same pattern as the existing bind-deadline
check) polled by a real `setInterval` in both `ws-server.ts` and `multi-table-router.ts` — the latter
across every live table on one shared interval. It's backed by a new, deliberately light
`AuthService.isSessionActive`: unlike `validateSession`, it takes a session id rather than a raw
token (the gateway only ever has the id, from a connect ticket's own server-side claims) and never
calls `touch()`, so a live socket doesn't silently reset its own idle timer just by existing. Still
not built: heartbeats (docs/12 §7) and the admin REST endpoints. 280 tests passing overall. Still
nothing in `web`.
