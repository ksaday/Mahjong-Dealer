# ADR-0008 — Tile randomization: commitment published, never revealed

| | |
|---|---|
| **Status** | Accepted |
| **Date** | 2026-09-02 |
| **Owning chapter** | 08_Shuffle_and_Deal_Architecture.md |
| **Deciders** | Project owner |

## Context

At a physical table the shuffle is not trusted — it is witnessed. Four people push the tiles around
face-down and everyone watches. Digitally that witnessing disappears entirely: tiles are shuffled
invisibly, by software the players did not write, on a machine they do not control.

Something has to replace it. The obvious candidate is a commit-and-reveal scheme of the kind used
for provably fair gaming: publish a hash of the shuffle before play, reveal the input afterwards,
and let anyone verify. The question is whether that scheme is appropriate here, and if so, in which
of its several forms.

The correctness of the shuffle itself is not in question and is settled separately: cryptographic
entropy, unbiased Fisher–Yates with rejection sampling, no client input path (`08 §4`). This record
is about what, if anything, is published.

## Options Considered

### Option A — CSPRNG only, no commitment

Advantages: nothing to build; nothing to retain; no risk of any kind from published material.

Disadvantages: gives up the ability to demonstrate that the wall was fixed before play and not
reordered during it. Players and operators alike have only the assertion.

### Option B — Publish a commitment, retain the salt, never reveal

Advantages: the wall provably existed in its final order before the first action; an operator can
recompute and verify in an audit; costs a hash and one event; nothing that could reconstruct a hand
is ever released.

Disadvantages: players cannot verify anything themselves — the property is operator-facing.

### Option C — Publish a commitment, reveal the salt after the game on unanimous consent

Advantages: players who want verification can obtain it; the unanimity gate means no single player
can force disclosure.

Disadvantages: **the reveal reconstructs every concealed hand.** The deal is a known procedure over
the wall, every draw is a public event, and every discard, claim, exposure and pass is already
public — so wall order plus public history yields every seat's hand at every moment, including hands
that were never shown. The unanimity gate narrows the exposure but does not remove it: consent can
be given under social pressure or without understanding what is being disclosed. And the capability
requires retaining the salt in a releasable form permanently, which is a standing liability.

## Decision

**Option B.** At deal time the server computes `commitment = SHA-256(canonical(wallOrder) ‖ salt)`
and publishes the commitment to all four seats. The salt and the wall order are retained server-side
and **never revealed to any client, under any condition**.

A rewind that crosses a wall draw reshuffles the undrawn remainder and publishes a fresh commitment,
so the tamper-evidence chain remains unbroken across a correction (`08 §7.2`).

The documentation describes the scheme accurately as **tamper-evidence**, not as player-verifiable
proof (`08 §5.2`), and the interface copy is written to match.

## Rationale

The reconstruction argument decides it. Option C's benefit is that a player could check the deal was
fair; its cost is that exercising the benefit publishes the hands of everyone at the table,
including hands their owners deliberately never revealed. That is a poor trade for a game with no
stakes, and it is a strange one to offer players — the choice reads as "verify the shuffle" and
means "disclose everyone's hand."

The unanimity gate does not repair this. A player who does not understand the implication will
consent, and three players wanting verification will pressure the fourth. A capability whose safe
use depends on every participant understanding a subtle inference is not safe.

Option A was the alternative genuinely considered. It was rejected because the commitment costs
almost nothing — a hash and one event — and buys a real operational property: if a player ever
alleges the wall was altered mid-game, that allegation can be answered by recomputation rather than
by assertion. Keeping the property while declining the reveal takes the whole benefit and none of
the risk.

A note on convergence: the reference project examined during design reached the same conclusion
independently, from the same reconstruction argument (`INHERITANCE_AND_EXCLUSION_ANALYSIS.md
§7 D-IE-05`). Two independent derivations landing on B is reasonable evidence that B is right.

Serves `OBJ-07`, and protects `OBJ-06`.

## Consequences

**Positive.** Tamper-evidence retained. No reconstruction path exists at all. No consent flow, no
reveal endpoint, no releasable-salt retention policy. Roughly ten lines of code.

**Negative.** Players cannot independently verify their deal. The system asks for trust in the
operator on this one point, and says so plainly rather than obscuring it in cryptographic
vocabulary.

**Follow-up obligations.** `08 §5.2` must be kept accurate about what the commitment does and does
not prove, and `32_UX` copy must match it. Commitment reproducibility must be tested (`TC-R07`). The
reshuffle path must publish a new commitment and must leave hands, discards, and exposures
byte-identical (`TC-R08`).

## Cross References

`08_Shuffle_and_Deal_Architecture.md §5` · `05_Game_Table_Architecture.md §8.4` ·
`14_Player_Privacy.md` · `PRIVACY_THREAT_MODEL.md` · `ADR-0016` · `OBJ-07` · `NR-502`, `NR-503`
