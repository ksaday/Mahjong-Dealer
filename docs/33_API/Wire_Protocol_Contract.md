# Wire Protocol Contract

| | |
|---|---|
| **Project** | American Mahjong Dealer |
| **Document** | 33_API/Wire_Protocol_Contract.md |
| **Status** | Normative — machine-checkable. Ch. 12 and Ch. 19 remain authoritative |
| **Last Updated** | 2026-09-02 |
| **Role in SSOT** | Owns the frame schemas, the seat-view schema, and the **client obligations**. Does **not** own the transport mechanics (`12`), the name catalog (`19`), or error codes (`Error_Code_Catalog.md`). |

---

## 1. Client obligations

Some protocol guarantees depend on the client behaving correctly. They are collected here first
because a client that gets them wrong harms itself in ways the server cannot detect or repair.

| # | Obligation | Consequence of getting it wrong |
|---|---|---|
| **CO-1** | Generate `cmdId` **once per intent**, and reuse it across every retry of that intent | Retries are treated as new intents; a discard could apply twice from the client's own resend (`13 §4.1`) |
| **CO-2** | Increment `cseq` by exactly 1 per frame sent, starting at 1 per connection | A gap closes the socket |
| **CO-3** | Reset `cseq` to 1 on every new connection | Same |
| **CO-4** | Send `bind` as the **first** frame after the socket opens | Closed with `4001` |
| **CO-5** | Replace the seat view wholesale on every `event`; never merge, never derive | Client state drifts from authoritative state |
| **CO-6** | Never assume a binding act succeeded before its `ack` | The player may see something that did not happen |
| **CO-7** | Reconnect with exponential backoff **and jitter** | Four clients reconnect in lockstep after a restart |
| **CO-8** | Treat `DUPLICATE_COMMAND` as success | A retried command is reported as an error to the player |
| **CO-9** | Send `resume { lastSeq }` immediately after `bound` | Missed events are not delivered |
| **CO-10** | Persist nothing concealed to browser storage | Concealed material outlives the session on the device (`NR-501`) |

**CO-1** is the one most easily got wrong, because the intuitive implementation — generate an
identifier when sending — silently defeats idempotency. The identifier belongs to the *player's
action*, not to the transmission.

---

## 2. Client to server

One shape.

```json
{
  "t": "cmd",
  "cmd": "discard_tile",
  "cmdId": "018f3a2b-...",
  "cseq": 42,
  "d": { "handle": "a9f3c1..." }
}
```

| Field | Type | Required | Constraints |
|---|---|---|---|
| `t` | `"cmd"` | yes | Literal |
| `cmd` | string | yes | A name from `19 §5` |
| `cmdId` | UUIDv7 string | yes | Per intent (**CO-1**) |
| `cseq` | integer | yes | ≥ 1, contiguous (**CO-2**) |
| `d` | object | per command | Per-command schema, `§4` |

**Absent by design**: `seat`, `table`, `player`, `timestamp`, `signature`. The seat and table come
from the binding (`NR-601`); a client's clock is not evidence of anything.

Maximum frame size: **16 KB**. Larger closes the connection.

---

## 3. Server to client

```json
{ "t": "bound",   "seat": "west", "protocolVersion": 1, "seq": 137 }
{ "t": "resumed", "seq": 137, "view": { ... } }
{ "t": "ack",     "cmdId": "018f...", "seq": 138 }
{ "t": "reject",  "cmdId": "018f...", "code": "NOT_YOUR_TILE",
                  "message": "You don't have that tile." }
{ "t": "event",   "seq": 139, "ev": { "type": "TileDiscarded", ... }, "view": { ... } }
{ "t": "notice",  "kind": "connection_degraded", "d": { ... } }
{ "t": "pong" }
```

| `t` | Fields | Notes |
|---|---|---|
| `bound` | `seat`, `protocolVersion`, `seq` | First frame after a successful bind |
| `resumed` | `seq`, `view?` | `view` present when a snapshot was sent rather than a backlog |
| `ack` | `cmdId`, `seq` | The command applied |
| `reject` | `cmdId`, `code`, `message`, `view?` | `view` present on `STALE_STATE` |
| `event` | `seq`, `ev`, `view` | **Always carries the complete seat view** (`D-12-05`) |
| `notice` | `kind`, `d` | Out of band; not part of the `seq` stream |
| `pong` | — | |

Every `event` carries a full view rather than a delta, so a client holds no derived state and cannot
drift (**CO-5**).

---

## 4. Command parameter schemas

| Command | `d` |
|---|---|
| `bind` | `{ ticket: string }` |
| `resume` | `{ lastSeq: integer }` |
| `ping` | — |
| `set_ready`, `clear_ready`, `start_deal`, `close_table` | — |
| `draw_tile` | `{ end: "head" \| "tail" }` |
| `discard_tile` | `{ handle: string }` |
| `claim_discard` | `{ handle: string }` |
| `expose_tiles` | `{ handles: string[] }` — 1 to 20, unique |
| `retract_exposure` | `{ exposureId: string }` |
| `swap_exposed_tile` | `{ myHandle: string, exposureId: string, exposedHandle: string }` |
| `arrange_hand` | `{ handles: string[] }` — a complete permutation of the current hand |
| `open_pass_round` | `{ routing: { from: seat, to: seat }[] }` — 2 to 4 entries, distinct `from` |
| `commit_pass` | `{ handles: string[] }` — 1 to 20, unique |
| `withdraw_pass`, `cancel_pass_round` | — |
| `declare_mahjong`, `reveal_hand`, `withdraw_declaration` | — |
| `respond_declaration` | `{ response: "accept" \| "dispute" }` |
| `propose_end_game` | — |
| `respond_end_game` | `{ response: "accept" \| "decline" }` |
| `propose_correction` | `{ rewindTo: integer }` |
| `respond_correction` | `{ response: "accept" \| "reject" }` |
| `request_pause`, `request_resume` | — |
| `send_table_message` | `{ text: string }` — 1 to 512 characters |
| `send_signal` | `{ signal: "knock" \| "wait" \| "ack" }` |

### 4.1 Validation is structural only

Schema validation checks presence, type, length, enumerated values, and array bounds. It **never**
checks meaning (`13 §8.2`).

The array bounds are deliberately loose — an exposure of up to twenty tiles, a pass of up to twenty —
because a tighter bound would encode a rule about how many tiles belong in a group (`NR-006`,
`NR-008`). The bound exists only to reject a frame designed to exhaust memory.

---

## 5. Seat view schema

The only thing a client ever receives about a table. Produced by the single projector (`14 §5`).

```json
{
  "seat": "west",
  "seq": 139,
  "tableState": "seated",
  "gameState": "in_play",
  "flags": { "paused": false, "passRoundOpen": false, "correctionPending": false },
  "turn": "north",
  "wallRemaining": 42,
  "commitment": "b3a1...",
  "seats": [
    { "seat": "east",  "displayName": "Kim", "connection": "connected",
      "ready": true, "handSize": 13,
      "exposures": [ { "exposureId": "e1", "tiles": ["D5","D5","D5"] } ] }
  ],
  "discards": [ { "handle": "c4d2...", "tile": "B3", "index": 7, "current": true } ],
  "ownHand": [ { "handle": "a9f3...", "tile": "D5" }, { "gap": true } ],
  "ownSelection": ["a9f3..."],
  "passRound": null,
  "correction": null,
  "declaration": null
}
```

| Field | Class | Notes |
|---|---|---|
| `seat`, `seq`, `tableState`, `gameState`, `flags`, `turn`, `wallRemaining`, `commitment` | `PUB` | |
| `seats[]` | `PUB` | **No hand contents for any seat, including this one** |
| `discards[]` | `PUB` | Ordered; `current` marks the only claimable one |
| `ownHand[]` | `OWN` | In the player's order, with `gap` entries |
| `ownSelection[]` | `OWN` | Handles |
| `passRound` | `PUB` routing and counts; `OWN` own commitment | |
| `correction`, `declaration` | `PUB` | |

### 5.1 Own hand is a separate field from the seat array

`seats[]` carries no hand contents at all — not even the viewer's own, which lives in `ownHand`.

There is therefore **no array position where another seat's tiles could be populated**, by accident
or by a future refactor. The structure makes the leak unrepresentable rather than merely absent
(`D-14-09`).

### 5.2 Gaps in `ownHand`

A player's deliberate spacing is represented as `{ gap: true }` entries in the ordered array. Gaps
are `OWN` and are preserved across every transition and reconnection (`FR-101`).

---

## 6. Sequencing summary

| Number | Scope | Resets | Purpose |
|---|---|---|---|
| `seq` | The table | Never | The authoritative order; anchors resumption and correction |
| `cseq` | One connection | Every connection | Detects client-side loss and reordering |

**Exactly one sequence number** in the sense the naming law governs (`19 §3.2`). `cseq` orders what a
client sent; `seq` orders what the table did.

---

## 7. Version negotiation

`bound` carries `protocolVersion`. A client receiving a version it does not support must stop and
tell the player to reload, not attempt to interoperate.

There is one version. Any breaking change increments it; additive changes — a new optional field, a
new event type — do not, and clients must ignore unrecognized event types and fields rather than
failing.

---

## 8. Cross References

`12_Realtime_WebSocket_Architecture.md` · `19_WebSocket_Event_Catalog.md` ·
`Error_Code_Catalog.md` · `13_Input_Integrity.md` · `14_Player_Privacy.md §5`

## 9. Revision History

| Version | Date | Author | Changes |
|---|---|---|---|
| 0.1 | 2026-09-02 | Design (architect role) | Initial contract: 10 client obligations, full schemas |
