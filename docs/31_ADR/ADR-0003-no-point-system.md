# ADR-0003 — No point system and no economic component

| | |
|---|---|
| **Status** | Accepted |
| **Date** | 2026-09-02 |
| **Owning chapter** | 02_System_Scope.md |
| **Deciders** | Project owner |

## Context

Multiplayer game platforms accumulate economies. A score becomes a running total, a total becomes a
balance, a balance invites transfer, transfer invites purchase, and purchase brings a payment
processor, a ledger, reconciliation, chargebacks, refunds, tax questions, and — depending on
jurisdiction and how the thing is framed — gambling regulation.

The reference project inspected during design contains a complete instance of this: a chart of
accounts, materialized balances, balanced double-entry transactions, versioned pricing, payment
integration with webhook verification, chargeback clawback, an adjustments workflow, table fees,
player-to-player transfers, abandonment penalties, reconciliation, and auditor exports. It is
competently built and it is a very large amount of machinery.

The question is whether this project should have any of it, in any form, including the smallest one
— a simple score kept across games.

## Options Considered

### Option A — A full economy

Advantages: matches platform conventions; enables monetization.

Disadvantages: every cost above. Also requires scoring, which requires the rules, which `ADR-0001`
excludes. The economy is not merely large; it is *unreachable* without reversing a prior decision.

### Option B — Points as a non-monetary score only

Advantages: sounds harmless; players might like a running tally.

Disadvantages: computing a score requires knowing who won and by what, which is rule knowledge
(`NR-003`, `NR-013`). A tally also changes the product's character — it introduces stakes, and
stakes change how a disagreement between friends feels. And a number that accumulates is one small
step from a number that transfers.

### Option C — No economic component of any kind

Advantages: removes an entire subsystem and its regulatory, security, and operational surface;
removes the strongest remaining pull toward rule knowledge; keeps the product what `ADR-0001` says
it is.

Disadvantages: no monetization path within the product; players who want to keep score must do it
themselves, as they would at a physical table.

## Decision

**Option C.** The system contains no points, credits, chips, tokens, wallets, balances, ledgers,
transactions, prices, purchases, transfers, penalties, or any other unit of account. Recorded as
constraint `C-02` and enforced by negative requirements `NR-101` through `NR-109`.

The exclusion is architectural, not configurational. There is no disabled economy, no feature flag,
and no schema awaiting activation.

## Rationale

The decisive argument is not the regulatory surface, large though it is. It is that **an economy
requires scoring, and scoring requires the rules.** Option B looks like a modest feature and is in
fact a request to reverse `ADR-0001`. Recognizing that early is what makes this decision easy.

The second argument is about what the product is for. Four people at a private table are playing a
social game. Introducing a persistent tally introduces stakes, and stakes are exactly the thing that
turns a friendly disagreement about a rule into an argument with something riding on it. A neutral
table has no view about who is ahead, which is one fewer thing for it to be wrong about.

The third is proportionality (`OBJ-11`): the economy in the reference project is comparable in size
to this project's entire scope.

Players who want to keep score are not prevented from doing so. They do it the way they do at a
table — on paper, or in their heads.

## Consequences

**Positive.** No payment integration, no ledger, no reconciliation, no financial audit trail, no
chargeback handling, no pricing, no gambling-adjacent regulatory analysis. The database is
dramatically smaller. The administrative role loses its main reason to exist and shrinks
accordingly (`04 §3.3`). The strongest remaining pull toward rule knowledge is removed.

**Negative.** No in-product monetization. No cross-game continuity of any kind. Some players will
expect a score.

**Follow-up obligations.** The absence suite must scan for economic vocabulary in schema, routes,
and symbols (`TC-A06`). `INHERITANCE_AND_EXCLUSION_ANALYSIS.md §5.1` must retain the precise
inventory of what was excluded, so that a future contributor comparing the two projects can see the
removal was deliberate.

## Cross References

`02_System_Scope.md` · `SCOPE_BOUNDARIES.md §4.2` · `INHERITANCE_AND_EXCLUSION_ANALYSIS.md §5.1` ·
`ADR-0001` · `C-02` · `NR-101`–`NR-109`
