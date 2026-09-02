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
[IMPLEMENTATION_READINESS_CHECKLIST.md §6](IMPLEMENTATION_READINESS_CHECKLIST.md). Phase 0
(repository, strict compiler configuration, dependency-law and purity lint) and the first slice of
Phase 1 (`shared`: the tile face codec, branded types, and the `NoConcealed<T>` guard with its proof
file) are in place. No database, server, or client code exists yet.
