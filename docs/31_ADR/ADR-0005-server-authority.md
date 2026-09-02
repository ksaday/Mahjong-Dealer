# ADR-0005 — Server authority and the mechanical/rule validation boundary

| | |
|---|---|
| **Status** | Accepted |
| **Date** | 2026-09-02 |
| **Owning chapter** | 02_System_Scope.md |
| **Deciders** | Project owner |

## Context

Two questions have to be settled before any command can be designed: **where does authority live**,
and **what does the authority check**.

The first is standard for multiplayer systems and has a well-known answer. The second is unusual
here, because the normal answer — "the server validates that the move is legal" — is exactly what
this system must not do. A server that validates nothing is trivially exploitable; a server that
validates legality is a rules engine. The design needs a precise middle position, and "precise" is
the operative word: an approximate boundary drifts.

## Options Considered

### Option A — Client-authoritative, server as relay

Advantages: trivial server; no synchronization design.

Disadvantages: any client can claim any state. A player could assert possession of a tile they never
held, or report a shuffle result of their choosing. Fails `C-05` outright.

### Option B — Server-authoritative with full rule validation

Advantages: the conventional shape; catches illegal moves.

Disadvantages: requires the rules (`ADR-0001`, `ADR-0002`).

### Option C — Server-authoritative over mechanics, with a closed validation set

Advantages: the client cannot fabricate state; the server holds every tile and every position; and
the validations are enumerated in a closed list, so adding a rule check requires visibly extending
a list that says it is closed.

Disadvantages: the boundary has to be specified carefully and maintained; illegal-but-mechanically-
possible actions succeed.

## Decision

**Option C.** The server is authoritative for all table state (`C-05`), and the client renders and
accepts input without deciding, judging, authorizing, or predicting (`C-06`).

The server performs exactly five validations, and the list is **closed**:

| | Check |
|---|---|
| `M-1` | Existence — is this a real tile in this game? |
| `M-2` | Ownership — does this seat hold or control it? |
| `M-3` | Availability — is it where the actor believes it is? |
| `M-4` | Authorization — is this session bound to this seat, and does the state permit this command? |
| `M-5` | Sequencing — well-formed, in order, not already applied? |

Turn is a special case of `M-4` applying to exactly one command, `draw_tile` (`02 §6`).

Every command in `10` declares its validations from this vocabulary. A validation that cannot be
expressed in it is a rule.

## Rationale

Closing the list is the whole decision. An open-ended instruction to "validate mechanics but not
rules" requires every contributor to draw the line the same way, and they will not — "is this a
legal exposure?" feels mechanical to someone thinking about tile counts.

A closed list of five, cited in every command specification, changes the failure mode. A contributor
adding a rule check cannot do it quietly: they must write the check into a list whose header says it
is closed, next to five items that are obviously not like theirs. Review then has something concrete
to react to.

The decision procedure for genuinely novel cases is stated separately and needs no reference to this
document: *could a person who has never heard of Mahjong, looking only at the tiles and the table,
determine the answer?* (`02 §5.1`).

Client non-authority is enforced structurally rather than by policy: the dependency law prevents
`web` from importing `dealer-core` (`03 §4.1`), so the client physically cannot contain the
mechanics.

Serves `OBJ-09`, `OBJ-10`.

## Consequences

**Positive.** No client can fabricate state. The boundary is enumerable, citable, and auditable. An
added rule check is visible in review and detectable by the command-path audit (`TC-A03`).

**Negative.** The server permits actions that are illegal under the rules. Extending the validation
list requires an amendment even when the extension is genuinely mechanical.

**Follow-up obligations.** Every command specification must declare its validations from the closed
vocabulary. `TC-A03` must audit command paths for branches that inspect tile faces. `TC-I01` must
assert that no interface accepts a client-supplied seat.

## Cross References

`02_System_Scope.md §3.1`, `§5` · `10_Player_Action_Model.md §3.1` · `03_System_Architecture.md §4.1` ·
`13_Input_Integrity.md` · `ADR-0002` · `ADR-0009` · `C-05`, `C-06`
