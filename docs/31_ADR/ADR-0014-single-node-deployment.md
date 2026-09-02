# ADR-0014 — Single-node v1; no Redis, and the trigger that would introduce it

| | |
|---|---|
| **Status** | Accepted |
| **Date** | 2026-09-02 |
| **Owning chapter** | 27_Deployment_Architecture.md |
| **Deciders** | Project owner |

## Context

Multiplayer systems are conventionally built to scale horizontally from the start, and the
conventional toolkit is well known: several stateless gameplay nodes, a cache and pub/sub tier
(usually Redis), a directory mapping each live game to its owning node, ownership leases with
epochs, and a relay for connections that land on the wrong node.

That machinery exists to solve a real problem, and the question is whether this system has it.

The load is worth stating concretely. A table is four connections. A game generates on the order of
four hundred actions over an hour, and its complete state is a few tens of kilobytes. A single
modest process can hold thousands of such tables in memory and process their commands with the CPU
almost idle, because the heaviest operation in the core is a shuffle over 152 elements.

The initial stack proposal included Redis, on the general grounds that multiplayer systems use it.
That reasoning was examined during design review and did not survive.

## Options Considered

### Option A — Multi-node from the start, with Redis

Advantages: horizontal scale available immediately; no later migration.

Disadvantages: a node directory, ownership leases, epoch fencing, split-brain arbitration, and a
relay — all built, tested, and operated before there is any load to justify them. Every one is a
place where a table's state can be observed, duplicated, or lost, which makes it a privacy surface
as well as an availability one. Plus a second stateful service to run, secure, monitor, and back up.

### Option B — Single node, but with Redis for tickets, rate limits, and presence

Advantages: some of the eventual multi-node infrastructure exists already; a later move is smaller.

Disadvantages: with one process, Redis holds nothing that PostgreSQL cannot at this scale. Worse,
the security-critical rate limit — the login lockout curve — *should not* live in a cache at all: a
control that vanishes on restart is one an attacker waits out, so it belongs in durable storage
regardless of what else Redis is doing. That removes the strongest apparent reason to have it. What
remains is connect tickets, which are a row with a unique constraint and a short expiry, and
in-process throttles, which need no external store when there is one process.

### Option C — Single node, PostgreSQL only, with the multi-node design documented as a seam

Advantages: one stateful dependency; no directory, lease, epoch, or relay logic; a smaller privacy
surface; and the later move is a specified change rather than an unplanned rewrite.

Disadvantages: capacity is bounded by one process; a restart interrupts every live table
simultaneously.

## Decision

**Option C.** v1 runs a single gameplay process with PostgreSQL as its only stateful dependency.
There is no Redis.

| Concern | v1 | If multi-node |
|---|---|---|
| Connect tickets | A PostgreSQL row: unique, single-use, 30-second expiry | Redis with atomic get-and-delete |
| Login lockout | PostgreSQL — durable by design, whatever the topology | Unchanged; stays in PostgreSQL |
| Per-connection throttles | Process memory | Redis counters |
| Table ownership | Implicit; one process owns everything | Redis lease, arbitrated by PostgreSQL |
| Cross-node delivery | Not applicable | Redis pub/sub or a direct relay |

The database schema carries an owner column from the first migration, so the later move is a change
of logic rather than a migration on live data (`D-03-08`).

### The trigger

The seam is taken when **any** of these becomes true, and not before:

1. Sustained concurrent live tables exceed 60% of a single process's measured comfortable capacity.
2. Deployment interruption becomes unacceptable — that is, a restart that briefly pauses every live
   table is no longer tolerable to the users.
3. Availability requirements demand redundancy that a single process cannot provide.

Naming the trigger is part of the decision. "We will scale when we need to" is how a system arrives
at needing to scale during an incident.

## Rationale

The general argument is proportionality (`OBJ-11`): infrastructure carried without its motivating
requirement is pure cost, and in this system it is also privacy surface. Each node in a cluster is
another place a table's state exists, another authorization boundary, and another set of logs.

The specific argument against Option B is the one that actually decided it. Redis's most defensible
role here would be rate limiting, and the rate limit that matters most for security — the login
lockout curve — is precisely the one that must be durable. Once that is in PostgreSQL, what is left
is a ticket store and some counters, neither of which needs a second service at four connections per
table.

The counter-argument — that a later migration will be expensive — is answered by specifying the seam
now, while the design is fresh, rather than discovering it later. `27 §8` names what changes, and
the owner column means the schema does not.

Serves `OBJ-11`.

## Consequences

**Positive.** One stateful dependency to run, secure, monitor, and back up. No directory, lease,
epoch, or relay logic. A smaller privacy surface. Ownership is not a distributed problem, so the
single-writer property (`ADR-0009`) is trivially true.

**Negative.** Capacity is bounded by one process. A restart interrupts every live table at once —
recoverable from checkpoints (`ADR-0010`), but simultaneous. No redundancy within a region.

**Follow-up obligations.** `27 §8` must specify the seam concretely enough to be executed. Capacity
must be measured, not assumed, so trigger 1 is meaningful. `29` must state the availability
expectations this creates. The owner column must exist from the first migration.

## Cross References

`27_Deployment_Architecture.md §8` · `03_System_Architecture.md §6` · `29_Disaster_Recovery.md` ·
`15_Security_Architecture.md §7` · `ADR-0009` · `ADR-0010` · `OBJ-11`
