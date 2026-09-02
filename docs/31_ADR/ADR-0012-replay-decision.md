# ADR-0012 — Replay excluded from v1

| | |
|---|---|
| **Status** | Accepted |
| **Date** | 2026-09-02 |
| **Owning chapter** | 16_Data_Architecture.md |
| **Deciders** | Project owner |

## Context

Replay is a natural feature to propose. Players might like to review a game; developers would like
to reproduce a defect; support would like to see what happened. The system already records events in
order, so replay looks like a small addition to work already done.

It is not, and the reason is the same argument that governs `ADR-0008`. **An artifact rich enough to
replay a game faithfully reconstructs every concealed hand.** The deal is a known procedure over the
wall; every draw is a public event; every discard, claim, exposure and pass is already public. A
record sufficient to reproduce the game reproduces what everyone was holding, including hands that
were never shown.

That makes replay not a feature with a privacy consideration but a **privacy decision wearing a
feature's clothes**.

## Options Considered

### Option A — Full replay for participants

Advantages: the most useful version; players review their own game.

Disadvantages: shows each participant every other participant's concealed hand for the whole game.
Players who deliberately never revealed a hand have it revealed retroactively. A player could also
share the artifact with anyone.

### Option B — Replay showing only what each viewer saw at the time

Advantages: no new information disclosed.

Disadvantages: requires storing a per-seat history, which quadruples the concealed material at rest;
and the reconstruction risk returns the moment two participants compare their versions, which four
friends will certainly do. The engineering cost is substantial and the protection is defeated by an
obvious behaviour.

### Option C — Replay for operators and developers only

Advantages: helps debugging.

Disadvantages: creates exactly the administrative window into concealed hands that `NR-406` and
`ADR-0004` exist to prevent. The artifact would have to be retained, protected, and access-audited
permanently.

### Option D — No replay in v1; retain a public-only event log

Advantages: no artifact from which a hand can be reconstructed exists at all; the retained log is
safe to keep, back up, and read during an incident because it contains no face that was not already
public; the concealed-material lifetime stays short and bounded.

Disadvantages: players cannot review a game; a defect cannot be diagnosed by replaying a past game;
support cannot reconstruct what happened.

## Decision

**Option D.** No replay in v1. The retained public event log contains only events whose contents
were already public at the time they occurred. Concealed material lives only in encrypted
checkpoints and is purged at game close (`ADR-0010`).

Enforced by `NR-508` and verified by `TC-A11`.

### Conditions for reconsideration

Recorded so the decision can be revisited deliberately rather than drifted into. A future replay
would have to satisfy **all** of:

1. Contain no concealed tile face belonging to any seat other than the viewer, at any point.
2. Not permit reconstruction of a concealed hand by combining artifacts held by two or more
   participants.
3. Be produced only with the explicit, informed consent of all four seats, with the disclosure stated
   plainly rather than implied.
4. Be delivered only to the four participants, with a defined expiry.
5. Be reachable by no administrative or operational role.
6. Be covered by a privacy suite that inspects the artifact itself, not merely the code that
   produces it.

Condition 2 is the hard one, and no design meeting it has been identified.

## Rationale

The feature is attractive because the events are already there. The correct response is that the
*public* events are already there, and the difference between a public event log and a replay is
precisely the concealed material — which is to say, the entire privacy question.

Option B is worth dwelling on because it is the sophisticated answer and it fails for a social
reason rather than a technical one. Four friends who have just finished a game and each hold a
personalized replay will compare them. Combining two seats' views yields more than either alone, and
combining all four yields nearly everything. A protection defeated by the most likely use of the
feature is not a protection.

Option C is rejected on the same ground as `ADR-0004`'s rejection of spectators: the value of the
privacy model comes from there being **no** path to a concealed hand for anyone but its owner. A
path that exists for operators is a path.

The debugging loss is real and is accepted with mitigations: the mechanics live in a pure,
deterministic core that is exhaustively testable without any recorded game (`03 §5`), the public
event log records the sequence of what happened, and the conservation invariant catches the class of
defect a replay would most likely be used to chase.

Serves `OBJ-06`, and `C-03`.

## Consequences

**Positive.** No artifact exists from which a concealed hand can be reconstructed. The retained log
is safe to keep, back up, and read. No consent flow, no expiry policy, no access audit for replay
artifacts.

**Negative.** No game review for players. No post-hoc reproduction of a defect from a real game. No
support reconstruction of a disputed sequence.

**Follow-up obligations.** `TC-A11` must assert no replay artifact or endpoint exists. `20` must
specify how a defect is diagnosed without one. The public event log's schema must be reviewed
against `NR-508` whenever a new event is added — the risk is not a replay feature, it is a public
event that quietly acquires a private field.

## Cross References

`16_Data_Architecture.md` · `20_Logging_and_Observability.md` · `14_Player_Privacy.md` ·
`PRIVACY_THREAT_MODEL.md` · `ADR-0008` · `ADR-0010` · `NR-508`
