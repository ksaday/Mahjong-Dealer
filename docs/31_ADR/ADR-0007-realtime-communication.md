# ADR-0007 — Native WebSocket with a custom envelope

| | |
|---|---|
| **Status** | Accepted |
| **Date** | 2026-09-02 |
| **Owning chapter** | 12_Realtime_WebSocket_Architecture.md |
| **Deciders** | Project owner |

## Context

Four clients must stay synchronized with a server-authoritative table, with latency low enough that
moving a tile feels immediate. The transport has to carry ordered, bidirectional messages and
survive ordinary network interruptions.

The constraint that distinguishes this system from a typical realtime application is that **every
event is sent four times, differently**. There is no state that all four clients share in full, and
therefore no legitimate use for a broadcast primitive. A transport whose central abstraction is
"send this to the room" is offering exactly the operation this design must not perform.

## Options Considered

### Option A — HTTP polling

Advantages: trivial; no connection state.

Disadvantages: latency is bounded below by the poll interval; four clients polling a table generates
constant load for mostly-empty responses; and there is no natural way to detect a disconnection.

### Option B — Server-Sent Events plus REST for commands

Advantages: simple server push; automatic reconnection in the browser.

Disadvantages: unidirectional, so commands take a separate path with no ordering relationship to the
event stream — the exact problem `03 §6.3` avoids by splitting responsibilities cleanly. Per-seat
streams are awkward, and there is no clean close-code vocabulary.

### Option C — A realtime library (Socket.IO or similar)

Advantages: reconnection, fallbacks, rooms, and acknowledgements out of the box; less code.

Disadvantages: the room abstraction is a broadcast primitive, and its presence invites its use — one
convenient `to(room).emit(...)` is a four-seat leak. Its envelope is fixed, so the visibility class
of each field is not something the design controls. It adds a protocol layer that has to be
understood when debugging. And its reconnection semantics are generic, where this system needs
sequence-based resumption tied to the table's `seq`.

### Option D — Native WebSocket with a custom envelope

Advantages: full control of the frame shape, so every field has a documented visibility class; no
broadcast primitive exists to be misused; the resumption protocol can be built on the table sequence
directly; close codes are ours to define; and the wire format is small enough to specify completely
in `19` and check against the implementation in CI.

Disadvantages: reconnection, heartbeats, backpressure, and sequencing must all be written and
tested.

## Decision

**Option D.** Native WebSocket with a custom envelope, specified normatively in
`19_WebSocket_Event_Catalog.md`.

REST handles everything outside a live table — registration, login, table creation, joining by code,
and minting a single-use connect ticket. The socket handles the table, beginning with a `bind` frame
that redeems the ticket.

## Rationale

The deciding argument is the broadcast primitive. In most realtime applications, rooms are the
useful abstraction; here they are a hazard, because the correct operation is always "compute four
different payloads and send each to one connection." A library that makes the wrong thing easy and
the right thing awkward is working against the design.

Control of the envelope is the second argument. Because the frame shape is ours, `19` can be a
normative catalog listing every field with its visibility class, and CI can diff that catalog
against the implementation (`TC-P08`). With a library's envelope, the catalog would describe only
the payload, and the surrounding structure would be outside the audit.

The work Option D creates — reconnection, heartbeats, backpressure — is work that would have needed
customizing anyway. Sequence-based resumption has to be built on the table's `seq` regardless of
transport, and the backpressure policy has to reflect what a stalled table means, which no library
knows.

The ticket handshake is worth stating explicitly: the ticket is redeemed in the first frame, never
placed in the URL, because query strings land in proxy logs, access logs, and browser history.

Serves `OBJ-05`, `OBJ-06`, `OBJ-09`.

## Consequences

**Positive.** No broadcast primitive exists. Every frame's shape and visibility class is documented
and CI-checked. Resumption is built on the authoritative sequence. Close codes are meaningful and
documented.

**Negative.** Reconnection, heartbeats, backpressure, and sequencing are ours to write and test. No
transport fallback for networks that block WebSocket.

**Follow-up obligations.** `19` must be complete and machine-checkable. `12` must specify heartbeat
intervals, backpressure thresholds, and resumption in full. `22` must specify grace periods and
auto-pause. The E2E suite must cover reconnection and resumption under real network interruption.

## Cross References

`12_Realtime_WebSocket_Architecture.md` · `19_WebSocket_Event_Catalog.md` ·
`22_Disconnect_and_Reconnect.md` · `33_API/Wire_Protocol_Contract.md` · `ADR-0011` · `ADR-0006`
