# ADR-0011 — Reconnection: ticketed bind, sequence resume, auto-pause

| | |
|---|---|
| **Status** | Accepted |
| **Date** | 2026-09-02 |
| **Owning chapter** | 22_Disconnect_and_Reconnect.md |
| **Deciders** | Project owner |

## Context

Connections drop. A laptop sleeps, a train enters a tunnel, a browser tab is closed by accident. In
most applications this is an inconvenience; here it stalls three other people, because there are
exactly four players and no substitution (`ADR-0004`).

Three questions have to be answered. How does a connection prove which seat it is? What happens to
the table while a seat is gone? And how does a returning client catch up without receiving a
complete history it should not have?

The third question has a privacy dimension that is easy to miss. A naive "send everything since you
left" is a replay, and replays of this system's events include per-seat private content. Resumption
has to be per-seat, computed the same way live frames are.

## Options Considered

### Option A — Reconnect with a token in the URL

Advantages: simple; survives a page reload naturally.

Disadvantages: query strings land in proxy logs, server access logs, browser history, and referrer
headers. A credential in a URL is a credential in a log file.

### Option B — Reconnect by asserting a seat

Advantages: trivial client.

Disadvantages: the client names the seat, which is exactly the parameter `NR-601` forbids. Any
client could claim any seat.

### Option C — Full snapshot on every reconnection

Advantages: one code path; no backlog machinery.

Disadvantages: a brief interruption costs a full state transfer, and any client-visible animation of
intervening events is lost — the table appears to teleport.

### Option D — Single-use ticket, sequence-based resumption, automatic pause

Advantages: the credential never appears in a URL and cannot be replayed; the seat is derived
server-side from the session; a short absence resumes with a small backlog of per-seat frames; a
long absence falls back to a snapshot; and the table pauses meanwhile so nothing happens in the
player's absence.

Disadvantages: three mechanisms to build — ticket issuance and redemption, a bounded per-seat
backlog, and pause handling.

## Decision

**Option D.**

**Binding.** The client requests a single-use ticket over REST (authenticated by session), then
opens the socket and redeems the ticket in the **first frame**. The ticket is consumed atomically,
is valid for thirty seconds, and never appears in a URL. The seat is taken from the ticket's
server-side claims; there is no seat parameter on the wire.

**Resumption.** The client sends `resume { lastSeq }`. If the gap is within the retained backlog,
the server sends the missing events **projected for that seat** and then a `resumed` frame. If not,
it sends a full seat view.

**Pause.** A seat becoming absent during a game pauses the table automatically and publicly
(`FR-142`). It resumes automatically when the seat returns (`FR-146`). The remaining three may
unanimously abandon if the player does not come back (`FR-147`).

**One connection per seat.** A newer authenticated binding replaces an older one, which closes with
a documented code.

## Rationale

The ticket exists to keep a credential out of the URL, and the reason is mundane rather than exotic:
URLs are logged by default in more places than anyone remembers. Redeeming in the first frame also
gives a clean place to enforce a bind deadline and a rate limit before any table work is done.

Sequence-based resumption follows from having exactly one authoritative sequence (`ADR-0009`).
Because `seq` totally orders the table's history, "what did I miss" is a subtraction. The critical
detail is that backlog frames are **produced by the same per-seat projector as live frames**
(`ADR-0006`) — resumption is not a separate code path with its own privacy properties, which is what
makes it safe.

Automatic pause rather than a vote reflects the physical table: when someone stands up, play stops,
and nobody takes a poll. It also removes a difficult question — what happens to a turn-gated action
when the seat at the pointer is absent — by making the answer "nothing happens at all."

The one-connection rule prevents a player from holding two sockets on one seat, which would double
their view of nothing useful and complicate delivery guarantees.

Serves `OBJ-05`, `OBJ-06`, `OBJ-09`.

## Consequences

**Positive.** No credential in any URL. No client-supplied seat. A brief interruption is nearly
invisible. Resumption shares the live projection path, so it cannot leak differently. Nothing
happens while a player is away.

**Negative.** Ticket issuance and redemption to build. A bounded backlog to retain per table. A long
absence stalls the table until the others abandon.

**Follow-up obligations.** `22` must specify heartbeat interval, miss tolerance, grace period, and
backlog depth. `12` must specify the bind and resume frames and the close-code vocabulary. The E2E
suite must cover reconnection under real interruption, backlog resumption, snapshot fallback, and
crash recovery.

## Cross References

`22_Disconnect_and_Reconnect.md` · `12_Realtime_WebSocket_Architecture.md §4`, `§8` ·
`05_Game_Table_Architecture.md §10` · `15_Security_Architecture.md` ·
`ADR-0004` · `ADR-0006` · `ADR-0007` · `ADR-0009` · `NR-601`
