# Architecture Decision Records

| | |
|---|---|
| **Project** | American Mahjong Dealer |
| **Document** | 31_ADR/README.md |
| **Status** | Index — normative content lives in the individual records |
| **Last Updated** | 2026-09-03 |
| **Role in SSOT** | Index of architecture decisions. Owns no decision itself. |

An ADR records a decision that shapes the architecture: one that was genuinely contested, that
future readers will want the reasoning for, or that a future contributor might otherwise reverse
without realising what it was protecting.

Decisions that merely *implement* an ADR are recorded as chapter design decisions (`D-CC-##`) in the
owning chapter, not as ADRs. Opaque tile handles (`D-07-03`) and the protocol naming law
(`D-19-01`) are examples: both are consequential, but each follows from `ADR-0006` and `ADR-0002`
respectively rather than deciding anything independent.

## Conventions

- Filename: `ADR-NNNN-kebab-case-slug.md`
- Numbers are sequential and never reused, including after a record is superseded
- Every record follows [TEMPLATE.md](TEMPLATE.md) exactly — six headings, in order
- A superseded record is left in place with its status updated; it is never deleted or rewritten

## Index

| ADR | Title | Status | Owning chapter |
|---|---|---|---|
| [0001](ADR-0001-project-scope.md) | Project scope — a table and a dealer, not a game | Accepted | `00` |
| [0002](ADR-0002-rule-agnostic-architecture.md) | Rule-agnostic architecture and the Absence Contract | Accepted | `02` |
| [0003](ADR-0003-no-point-system.md) | No point system and no economic component | Accepted | `02` |
| [0004](ADR-0004-four-seat-table.md) | Fixed four-seat table; no bots, substitutes, or spectators | Accepted | `05` |
| [0005](ADR-0005-server-authority.md) | Server authority and the mechanical/rule validation boundary | Accepted | `02` |
| [0006](ADR-0006-hidden-information-model.md) | Hidden-information model and the three visibility classes | Accepted | `14` |
| [0007](ADR-0007-realtime-communication.md) | Native WebSocket with a custom envelope | Accepted | `12` |
| [0008](ADR-0008-tile-randomization.md) | Tile randomization: commitment published, never revealed | Accepted | `08` |
| [0009](ADR-0009-input-integrity.md) | Input integrity: command identity, sequencing, single writer | Accepted | `13` |
| [0010](ADR-0010-persistence-strategy.md) | Persistence: in-memory authority with encrypted checkpoints | Accepted | `16` |
| [0011](ADR-0011-reconnection-strategy.md) | Reconnection: ticketed bind, sequence resume, auto-pause | Accepted | `22` |
| [0012](ADR-0012-replay-decision.md) | Replay excluded from v1 | Accepted | `16` |
| [0013](ADR-0013-logging-privacy.md) | Logging privacy: branded types, one serializer, log scanner | Accepted | `20` |
| [0014](ADR-0014-single-node-deployment.md) | Single-node v1; no Redis, and the trigger that would introduce it | Accepted | `27` |
| [0015](ADR-0015-typescript-and-fastify.md) | TypeScript end-to-end with Fastify | Accepted | `03` |
| [0016](ADR-0016-consent-based-rewind.md) | Bounded consent-based rewind, with wall reshuffle | Accepted | `05` |
| [0017](ADR-0017-admin-totp-step-up.md) | TOTP step-up authentication for administrators | Accepted | `15` |
