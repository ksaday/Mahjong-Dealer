# ADR-0009 — Input integrity: command identity, sequencing, single writer

| | |
|---|---|
| **Status** | Accepted |
| **Date** | 2026-09-02 |
| **Owning chapter** | 13_Input_Integrity.md |
| **Deciders** | Project owner |

## Context

Between a player's click and the server's state change lies a network. Networks retry, reorder,
duplicate, stall, and drop. A client may resend a command it is unsure landed; a socket may deliver
frames out of order after a reconnection; a stale client may act on a view superseded seconds ago;
and a hostile client may deliberately replay a captured frame.

The requirement is to distinguish **player intent** from **client-reported state**. A player intends
to discard one specific tile once. The client's report of that intent may arrive twice, late, or
after the tile has already moved. The server must honour the intent when it is still coherent and
refuse it when it is not — and it must never apply it twice.

Two further complications are specific to this system. Because there is no rules engine, an
incorrectly applied command cannot be caught by a legality check downstream; the integrity layer is
the only defence. And because a discard is public and effectively irreversible (`ADR-0016`), a
double-applied discard is not a cosmetic bug — it costs a tile.

## Options Considered

### Option A — Best-effort: apply what arrives

Advantages: no machinery.

Disadvantages: a retried discard discards twice. Unacceptable given the above.

### Option B — Idempotency keys only

Advantages: solves duplication.

Disadvantages: does not detect reordering or gaps, and does not detect a stale client acting on an
old view — a click on a discard that has already been claimed would apply against the wrong tile.

### Option C — Sequence numbers only

Advantages: detects reordering and gaps.

Disadvantages: does not make a retry safe, because a retried frame carries the same sequence number
and cannot be distinguished from a duplicate delivery of a frame that already applied.

### Option D — Command identity, per-connection sequencing, one authoritative sequence, and a single writer

Advantages: each mechanism covers a distinct failure mode, and together they cover the realistic
set. A single-writer actor makes ordering a property of the architecture rather than a locking
discipline.

Disadvantages: four concepts to specify, implement, and test; clients must generate identifiers and
maintain a counter.

## Decision

**Option D.** Four mechanisms:

| Mechanism | Covers |
|---|---|
| `cmdId` — a client-generated UUIDv7 per command | Retries and duplicate delivery. A repeat returns the original result without re-applying. |
| `cseq` — a per-connection monotonic counter | Gaps and reordering. A non-contiguous value closes the socket, because a client that has lost frames cannot be trusted to be coherent. |
| `seq` — one authoritative table sequence | Staleness. An order-sensitive command carrying a superseded view is refused with `STALE_STATE` and a resynchronization. |
| A single-threaded table actor | Ordering and atomicity, by construction rather than by locking. |

There is exactly **one** sequence number in the protocol (`19 §4`). Multiple sequence numbers in one
protocol guarantee that two of them will eventually disagree.

## Rationale

Each mechanism is present because it covers something the others do not, and the combination was
arrived at by enumerating the failure modes rather than by adopting a pattern.

The **socket-closing response to a `cseq` gap** deserves note. It is deliberately severe: a client
that has lost frames has a view that may differ from the server's in ways neither can enumerate.
Closing the socket forces a clean resumption from a known sequence, which is cheap (`22 §7`) and
leaves no possibility of acting on a partially-updated view.

The **staleness check applies only to order-sensitive commands** — those where the target could have
moved. `claim_discard` is the clearest case, and it additionally names the tile handle
(`D-10-04`) so that a stale click cannot claim a tile the player never saw. `arrange_hand` is not
order-sensitive: it carries a full permutation, so a late arrival is self-correcting.

The **single writer** is what makes the rest simple. With one actor per table processing commands to
completion in arrival order, there is no interleaving to reason about, no lock ordering, and no
read-modify-write race on a hand.

Serves `OBJ-09`, and `C-05`.

## Consequences

**Positive.** Retries are safe. Reordering is detected. Stale actions are refused rather than applied
to the wrong target. Ordering is architectural. An entire class of multiplayer defect is designed
out.

**Negative.** Clients must generate identifiers and maintain a counter. A `cseq` gap costs a
reconnection. Command receipts must be retained for the life of a game.

**Follow-up obligations.** `13` must specify the retention of command receipts and the resync
protocol. The integrity suite must cover deliberate replays, gaps, reordering, staleness, and
malformed frames (`TC-I04`–`TC-I06`). `33_API/Error_Code_Catalog.md` must document every rejection
and close code.

## Cross References

`13_Input_Integrity.md` · `12_Realtime_WebSocket_Architecture.md` · `05_Game_Table_Architecture.md §6` ·
`10_Player_Action_Model.md §11` · `34_Testing/Integrity_and_Randomization_Suites.md` ·
`ADR-0005` · `ADR-0007` · `OBJ-09`
