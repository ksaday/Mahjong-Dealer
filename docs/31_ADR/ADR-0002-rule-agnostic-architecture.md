# ADR-0002 — Rule-agnostic architecture and the Absence Contract

| | |
|---|---|
| **Status** | Accepted |
| **Date** | 2026-09-02 |
| **Owning chapter** | 02_System_Scope.md |
| **Deciders** | Project owner |

## Context

`ADR-0001` decided that the system does not know the rules of Mahjong. That decision is easy to
state and hard to keep.

The difficulty is that rule knowledge does not arrive as a proposal to build a rules engine. It
arrives as small, locally reasonable improvements. Graying out a discard that cannot be legal.
Warning a player who is holding the wrong number of tiles. Recognizing a completed hand so the
players do not have to click. Sorting a rack, because the tiles are obviously easier to read that
way. Each is a few lines, each looks helpful, and each requires the system to know something it has
decided not to know.

The risk is materially higher than usual here because implementation will be carried out
substantially by AI coding agents. The strongest prior any capable model brings to a repository
named "Mahjong" is a large body of Mahjong knowledge, and that prior surfaces as helpfulness at
precisely the moments a rule would be most convenient.

A prose instruction — "do not implement the rules" — is a weak defence against a strong prior held
by many contributors over a long period.

## Options Considered

### Option A — Documented prohibition only

Advantages: no machinery.

Disadvantages: relies on every contributor reading and remembering the prohibition, and on every
reviewer recognizing a violation. Fails silently and gradually, which is the worst failure shape.

### Option B — Prohibition plus code review discipline

Advantages: catches obvious violations; no build machinery.

Disadvantages: reviewers must hold the boundary in their heads and apply it consistently; a
plausible-looking check will pass review because it looks like a bug fix.

### Option C — A numbered, testable negative-requirement catalog with a CI absence suite

Advantages: the boundary is written down as identifiers that documents can cite and tests can
enforce; a violation fails the build rather than passing unnoticed; new contributors and agents
encounter the boundary mechanically rather than by osmosis; and the catalog gives reviewers a
concrete artifact to check against instead of a principle to interpret.

Disadvantages: the catalog must be maintained; every entry must be phrased so a test can actually
check it, which takes more care than prose; and the absence suite has a maintenance cost of its own.

## Decision

**Option C.** Rule-agnosticism is enforced by an **Absence Contract** with three clauses:

1. **Absence is binding.** A negative requirement (`NR-###`) has the same force as a functional
   requirement. Adding a forbidden capability is a defect.
2. **Absence is testable.** Every negative requirement is phrased as a checkable condition. "Do not
   add a rules engine" is replaced by "no module, function, table, or configuration encodes the
   rules of American Mahjong, verified by symbol and dependency scan."
3. **Absence is defended in CI.** The absence and privacy suites are zero-tolerance gates.

The catalog lives in `SCOPE_BOUNDARIES.md §4` and currently holds 62 entries across six
families. It is supported by three further artifacts: the Physical vs Digital Responsibility Matrix
(`SCOPE_BOUNDARIES.md §2`), the mechanical-versus-rule validation boundary table (`02 §5`), and the
closed validation vocabulary that every command entry must declare from (`10 §3.1`).

## Rationale

The four artifacts work at different moments, which is why all four exist.

The **responsibility matrix** answers "should the software do this?" when a feature is being
considered. The **validation boundary table** answers "may I add this check?" when code is being
written. The **closed validation vocabulary** makes an added check visible in review, because it
must be written down next to the five checks that are permitted. And the **absence suite** catches
what the first three missed, at build time, without relying on anyone's attention.

The most important property is that the boundary is *findable*. A contributor who wonders whether
something is allowed does not have to infer it from the spirit of the project; they look it up. A
boundary that must be inferred will be inferred differently by different people.

Serves `OBJ-10` directly.

## Consequences

**Positive.** Drift is detectable at build time. The boundary is citable, so design discussions
reference identifiers rather than impressions. New contributors and agents meet the boundary
mechanically. Reviewers have an artifact rather than a principle.

**Negative.** The catalog is maintenance. Some entries are awkward to phrase checkably. The absence
suite will occasionally produce a false positive on innocent vocabulary, and will need tuning.

**Follow-up obligations.** `SCOPE_BOUNDARIES.md` must stay current as the system grows. Every new
command must declare validations from the closed vocabulary. The absence suite
(`34_Testing/Privacy_and_Absence_Suites.md`) must be built early — it is not a late-stage addition,
because its value is in catching drift from the first commit.

## Cross References

`02_System_Scope.md` · `SCOPE_BOUNDARIES.md` · `10_Player_Action_Model.md §3.1` ·
`34_Testing/Privacy_and_Absence_Suites.md` · `ADR-0001` · `ADR-0005` · `C-01`
