# 10 — Player Action Model

| | |
|---|---|
| **Project** | American Mahjong Dealer |
| **Document** | 10_Player_Action_Model.md |
| **Status** | Ratified v0.2 — approved by the project owner, 2026-09-03 |
| **Last Updated** | 2026-09-03 |
| **Role in SSOT** | Owns the complete command catalog: every action a player can take, its parameters, its validations, the events it emits, and the visibility of each. Does **not** own the wire encoding (`19`, `33_API`), the state machine (`09`), or the interaction design (`11`). |

---

## 1. Executive Summary

This chapter is the catalog of everything a player can ask the table to do. Twenty-six commands,
each one a physical act with an obvious counterpart at a real table.

The catalog is written in a fixed shape, and the shape carries the design's central discipline.
Every command lists its **validations**, and every validation is drawn from the closed set of five
mechanical checks in `02 §3.1`. If a command's validation list contains something that is not one of
those five, the command is out of contract. That single formatting rule is what makes rule creep
visible during review: an added check has nowhere to hide, because it must be written down next to
the five that are permitted.

Three commands deserve advance mention because they are where the design's unusual choices live.
`claim_discard` moves the turn pointer without asking whether the claim was entitled.
`swap_exposed_tile` is a general primitive that covers the joker exchange without knowing what a
joker is. And the pass-round family provides a simultaneous secret exchange without any concept of
how many tiles should move, in which direction, or how often.

---

## 2. Objectives

Serves `OBJ-04` (players retain complete agency) by ensuring every state change originates in an
explicit player command, and `OBJ-10` by giving every command a validation list drawn from a closed
set.

---

## 3. Command anatomy

Every command carries the same envelope (`19 §4`):

| Field | Purpose |
|---|---|
| `cmd` | The command name |
| `cmdId` | Client-generated UUIDv7 for idempotency (`13 §4`) |
| `cseq` | Per-connection monotonic counter (`13 §5`) |
| `d` | Command-specific parameters |

There is **no seat field**. The seat is derived from the socket binding, server-side (`NR-601`). The
single most common multiplayer authorization bug is therefore not defended against but absent.

### 3.1 The validation vocabulary

The only validations any command may declare:

| Code | Check |
|---|---|
| `M-1` | The referenced tile or object exists in this game |
| `M-2` | The acting seat owns or controls it |
| `M-3` | It is where the actor believes it is |
| `M-4` | The session is bound to this seat, and the state permits this command |
| `M-5` | Well-formed, in sequence, not already applied |
| `M-4t` | The turn pointer is at this seat — **`draw_tile` only** |

Nothing else. A validation that cannot be expressed in this vocabulary is a rule.

### 3.2 Event visibility

Each command's events are listed with the class of each field: `PUB` to all four seats, `OWN` to the
acting seat only. No event field is ever `SRV` — server-only data is not in events at all.

---

## 4. Table commands

### `set_ready` / `clear_ready`
Mark this seat ready to begin, or withdraw it.
**Parameters** none · **Validations** `M-4` (state `IDLE` or `CONCLUDED`), `M-5`
**Events** `SeatReady` / `SeatUnready` — `PUB`: seat
**Notes** Readiness clears when a game concludes (`09 §4`).

### `start_deal`
Begin a game.
**Parameters** none · **Validations** `M-4` (host; state `IDLE` or `CONCLUDED`, `09 §7`; four seats
occupied; all ready), `M-5`
**Events** `WallBuilt` — `PUB`: wall length · `DealCommitmentPublished` — `PUB`: commitment ·
`TilesDealt` — `PUB`: hand sizes, turn pointer; `OWN`: this seat's tiles
**Notes** Atomic (`08 §7.1`). The only command that consumes entropy. From `CONCLUDED`, folds the
diagram's own `CONCLUDED -> IDLE` edge ("table ready for another game," `09 §4`) into this same
command rather than requiring a separate one — see `D-10-14`.

### `close_table`
Close a table with no game in progress.
**Parameters** none · **Validations** `M-4` (host; no game in `DEALING`, `IN_PLAY`, or `CONCLUDING`), `M-5`
**Events** `TableClosed` — `PUB`: reason
**Notes** Terminal. Purges concealed material; closes all bindings.

---

## 5. Play commands

### 5.1 `draw_tile`

Take the next tile from the wall.

| | |
|---|---|
| **Parameters** | `end`: `head` \| `tail` |
| **Validations** | `M-4` (state `IN_PLAY`; no blocking flag), **`M-4t`**, `M-5`, wall non-empty |
| **Events** | `TileDrawn` — `PUB`: seat, end, wall remaining, new hand size; `OWN`: the drawn tile |
| **Turn** | Advances to the next seat in fixed order |

The **only** turn-gated command, for the reason in `02 §6`: the wall is a single shared resource
whose next tile can go to exactly one seat, and two clients drawing at once is a mechanical race.

`end` exists because both ends of a physical wall are reachable. The system attaches no meaning to
the choice and records it only so the other seats can see what happened.

If the wall is empty the command is refused with `WALL_EMPTY` and `WallExhausted` is emitted once.
Nothing else follows: whether an empty wall ends the game is a rule (`NR-012`).

### 5.2 `discard_tile`

Place a tile from the concealed hand face-up on the table.

| | |
|---|---|
| **Parameters** | `handle` |
| **Validations** | `M-1`, `M-2`, `M-4` (state `IN_PLAY`; no blocking flag), `M-5` |
| **Events** | `TileDiscarded` — `PUB`: seat, tile face, discard index, new hand size |
| **Turn** | Unchanged |

**Not turn-gated.** A player may discard at any moment. Requiring a draw first, or requiring it to be
their turn, would presume the structure of a turn — a rule (`NR-004`).

The tile becomes public the instant this succeeds. It is the archetypal **binding act** (`11 §5`),
and `11` specifies the deliberate gesture required to perform one.

### 5.3 `claim_discard`

Take the current discard.

| | |
|---|---|
| **Parameters** | `handle` — the current discard, supplied so a stale click cannot claim a newer tile |
| **Validations** | `M-1`, `M-3` (this handle is still the current discard), `M-4`, `M-5` |
| **Events** | `DiscardClaimed` — `PUB`: claiming seat, tile face, new hand size, new turn pointer |
| **Turn** | **Moves to the claimant** |

Available to **any** seat including the discarder, at any time, with no entitlement check
(`NR-005`). Under the rules a claim frequently moves play out of order, and this is how the pointer
follows without the system knowing why.

Only the current discard is claimable (`FR-068`) — a model of physical reach, not a rule. An older
discard is retrieved by correction.

**Simultaneous claims** resolve by server arrival order; the first to reach the actor's queue wins
and the others are refused with `TILE_NOT_AVAILABLE`. Any other resolution would need priority
rules. If the outcome is wrong under the rules, the players rewind (`05 §8`).

The `handle` parameter matters: without it, a click sent while a new discard was landing could claim
a tile the player never saw.

### 5.4 `expose_tiles`

Place tiles from the concealed hand face-up in front of this seat.

| | |
|---|---|
| **Parameters** | `handles[]` — one or more, in the order to display |
| **Validations** | `M-1`, `M-2` (all of them), `M-4`, `M-5` |
| **Events** | `TilesExposed` — `PUB`: seat, exposure id, tile faces in order, new hand size |
| **Turn** | Unchanged |

No check of count, composition, or validity (`NR-006`). One tile is an exposure; so is nine. The
system records an ordered list of tiles belonging to a seat and attaches no meaning to it.

### 5.5 `retract_exposure`

Take an exposure back into the concealed hand.

| | |
|---|---|
| **Parameters** | `exposureId` |
| **Validations** | `M-1`, `M-2` (this seat owns it), `M-4`, `M-5` |
| **Events** | `ExposureRetracted` — `PUB`: seat, exposure id, tile faces |
| **Turn** | Unchanged |

Physically possible, so permitted. The information already seen stays seen — the event carries the
faces precisely because everyone watched them go back. Forbidding retraction would require knowing
that an exposure is binding, which is a rule.

Retracted tiles append at the end of the seat's existing rack order (`NR-304`).

### 5.6 `swap_exposed_tile`

Exchange a tile in hand for a tile in any exposure on the table.

| | |
|---|---|
| **Parameters** | `myHandle`, `exposureId`, `exposedHandle` |
| **Validations** | `M-1` (both tiles), `M-2` (`myHandle` is this seat's), `M-3` (`exposedHandle` is in that exposure), `M-4`, `M-5` |
| **Events** | `ExposedTileSwapped` — `PUB`: acting seat, exposure id and its owner, both tile faces, new hand size |
| **Turn** | Unchanged |

This is the joker exchange, expressed without knowing what a joker is. The system checks that both
tiles exist, that one belongs to the actor, and that the other is in the named exposure. Whether the
exchange is *permitted* is a rule (`NR-007`); whether it is *possible* is not.

Any exposure may be targeted, including this seat's own.

### 5.7 `arrange_hand`

Set the order of tiles in this seat's concealed hand.

| | |
|---|---|
| **Parameters** | `handles[]` — the complete hand, in the desired order |
| **Validations** | `M-1`, `M-2`, `M-5`; the list must be a permutation of the current hand |
| **Events** | **None public.** Acknowledged to the acting seat only |
| **Turn** | Unchanged |

The only command that emits nothing to the other seats, because it changes nothing they can see.

Requiring the full permutation rather than a move instruction makes the command idempotent and
self-correcting: a replay produces the same order, and a client whose view has drifted is corrected
by its own next arrangement rather than compounding the drift.

This is a **free act** (`11 §5`): the client reorders instantly and sends the update without waiting
(`FR-105`). The server stores the order so it survives reconnection (`FR-101`) and **never changes
it for any reason** (`NR-301`–`NR-306`).

---

## 6. Pass-round commands

A neutral, simultaneous, secret, atomic exchange. Deliberately not named after any rule concept
(`19 §3`).

```mermaid
sequenceDiagram
    participant A as Opening seat
    participant S as Table actor
    participant B as Other participating seats

    A->>S: open_pass_round { routing }
    S-->>A: PassRoundOpened (PUB: routing, participants)
    S-->>B: PassRoundOpened
    Note over A,B: each seat selects privately
    A->>S: commit_pass { handles[] }
    S-->>B: PassCommitted (PUB: seat + count only)
    B->>S: commit_pass { handles[] }
    S-->>A: PassCommitted (PUB: seat + count only)
    Note over S: all participants committed
    S->>S: move every tile at once
    S-->>A: PassRoundExecuted (PUB: routing, counts; OWN: tiles received)
    S-->>B: PassRoundExecuted
```

### `open_pass_round`
**Parameters** `routing`: a list of `{ from: seat, to: seat }` naming the participating seats
**Validations** `M-4` (state `IN_PLAY`; no round open; no blocking flag), `M-5`; routing must name
distinct existing seats
**Events** `PassRoundOpened` — `PUB`: opener, routing, participants
**Notes** Any seat may open one. The routing is whatever the players agreed; the system does not
check direction, symmetry, or that all four seats participate (`NR-008`). Sets `PASS_ROUND_OPEN`.

### `commit_pass`
**Parameters** `handles[]`
**Validations** `M-1`, `M-2`, `M-4` (round open; this seat participates; not already committed), `M-5`
**Events** `PassCommitted` — `PUB`: seat, **count only**
**Notes** No constraint on the count (`FR-093`). Committed tiles move to the `in flight` location
(`06 §6`), so hand counts are correct during the round. The count is public because pushed tiles are
visible at a physical table; the identities are not.

### `withdraw_pass`
**Parameters** none · **Validations** `M-4` (committed, round not executed), `M-5`
**Events** `PassWithdrawn` — `PUB`: seat
**Notes** Tiles return to the hand at the end of the existing order.

### `cancel_pass_round`
**Parameters** none · **Validations** `M-4` (round open; this seat participates), `M-5`
**Events** `PassRoundCancelled` — `PUB`: cancelling seat
**Notes** Any participant may cancel. All commitments return. Clears `PASS_ROUND_OPEN`.

### Execution
Not a command. When the last participant commits, the actor moves every tile at once, emits
`PassRoundExecuted` (`PUB`: routing and counts; `OWN`: the tiles this seat received), and clears the
flag. No seat learns another's tiles before the atomic moment.

An open round that receives no commitment for 10 minutes is cancelled automatically. This is not a
binding action (`NR-210`) — it *refuses* to complete, returning every tile to where it came from.

---

## 7. Conclusion commands

### `declare_mahjong`
**Parameters** none · **Validations** `M-4` (state `IN_PLAY`), `M-5`
**Events** `MahjongDeclared` — `PUB`: declaring seat
**Notes** Records that a player said a word. No evaluation whatsoever (`NR-003`). Enters `CONCLUDING`.

### `reveal_hand`
**Parameters** none · **Validations** `M-4` (state `IN_PLAY` or `CONCLUDING`), `M-5`
**Events** `HandRevealed` — `PUB`: seat, all tile faces in the player's own order
**Notes** Voluntary and irreversible — the digital act of laying your tiles down. A declaration
without a reveal is permitted; the other players may simply be trusted, or may ask.

### `respond_declaration`
**Parameters** `response`: `accept` \| `dispute`
**Validations** `M-4` (state `CONCLUDING`; this seat is not the declarer; not already responded), `M-5`
**Events** `DeclarationResponded` — `PUB`: seat, response · then either
`GameConcluded` — `PUB`: outcome `declaration_accepted`, declaring seat, or
`DeclarationDisputed` — `PUB`: disputing seat, returning to `IN_PLAY`
**Notes** Silence is never a response, and there is no timeout that accepts on a player's behalf
(`NR-210`). The recorded outcome carries **no score, value, or rule justification** (`NR-013`) — it
records that a player declared and the others agreed.

### `withdraw_declaration`
**Parameters** none · **Validations** `M-4` (state `CONCLUDING`; this seat declared), `M-5`
**Events** `DeclarationWithdrawn` — `PUB`: seat. Returns to `IN_PLAY`.

### `propose_end_game` / `respond_end_game`
**Parameters** none / `response`: `accept` \| `decline`
**Validations** `M-4` (state `IN_PLAY` / `CONCLUDING`), `M-5`
**Events** `EndGameProposed` — `PUB`: seat · `EndGameResponded` — `PUB`: seat, response · then
`GameConcluded` — `PUB`: outcome `ended_by_agreement`, or return to `IN_PLAY`
**Notes** The neutral ending: the players decided to stop. Used after wall exhaustion, or whenever
they choose.

---

## 8. Correction commands

### `propose_correction`
**Parameters** `rewindTo`: a table sequence number
**Validations** `M-4` (state `IN_PLAY`; no proposal open; no pass round open), `M-5`; the target must
be within the correction window (`05 §8.3`) and inside the current game
**Events** `CorrectionProposed` — `PUB`: proposing seat, target sequence, a description of the
actions to be undone
**Notes** Sets `CORRECTION_PENDING`. Refused with `NO_CHECKPOINT` if the target is out of window.

### `respond_correction`
**Parameters** `response`: `accept` \| `reject`
**Validations** `M-4` (proposal open; this seat is not the proposer; not already responded), `M-5`
**Events** `CorrectionResponded` — `PUB`: seat, response · then either
`CorrectionApplied` — `PUB`: restored sequence, whether a reshuffle occurred, and, if so,
`ReshuffleCommitmentPublished` — `PUB`: new commitment; plus fresh per-seat views, or
`CorrectionRejected` — `PUB`: reason
**Notes** Unanimous acceptance among the other three, or nothing. A 60-second timeout expires as a
**rejection**.

---

## 9. Presence and communication commands

### `request_pause` / `request_resume`
**Parameters** none · **Validations** `M-4`, `M-5`
**Events** `TablePaused` / `TableResumed` — `PUB`: seat, reason
**Notes** Any seat may pause; only the requester releases their own pause. Absence-triggered pause
clears automatically on return (`22 §5`).

### `send_table_message`
**Parameters** `text` (≤ 512 characters)
**Validations** `M-4`, `M-5`, rate limit
**Events** `TableMessage` — `PUB`: seat, display name, text
**Notes** Never persisted, logged, checkpointed, or exported (`FR-131`). Rendered as plain text.

### `send_signal`
**Parameters** `signal`: `knock` \| `wait` \| `ack`
**Validations** `M-4`, `M-5`, rate limit
**Events** `TableSignal` — `PUB`: seat, signal
**Notes** No signal carries game meaning (`05 §9.3`).

---

## 10. Protocol commands

`bind`, `resume`, `ping` — specified in `12 §4` and `12 §8`. Listed here for completeness only; they
change no game state.

---

## 11. Rejection codes

| Code | Meaning |
|---|---|
| `NOT_BOUND` | The connection has not completed `bind` |
| `NOT_YOUR_TURN` | `M-4t` failed — `draw_tile` only |
| `NOT_YOUR_TILE` | `M-2` failed |
| `TILE_NOT_AVAILABLE` | `M-3` failed — claimed, moved, or superseded |
| `NOT_IN_PHASE` | `M-4` failed on game state |
| `TABLE_PAUSED` / `CORRECTION_PENDING` / `PASS_ROUND_OPEN` | A blocking flag, in the precedence of `09 §5.2` |
| `WALL_EMPTY` | No tiles remain to draw |
| `NO_CHECKPOINT` | Correction target outside the window |
| `DUPLICATE_COMMAND` | `cmdId` already applied — the prior result is returned |
| `SEQ_GAP` | `cseq` non-contiguous — the socket closes |
| `STALE_STATE` | An order-sensitive command against a superseded view; a resync follows |
| `MALFORMED` | Schema validation failed |
| `RATE_LIMITED` | Throttled |
| `FORBIDDEN` | Authorization failed |
| `TABLE_CLOSED` | The table is terminal |

A rejection goes **only to the originating seat** (`05 §6.1`) and never mutates state.

---

## 12. Design Decisions

| ID | Decision | Rationale |
|---|---|---|
| D-10-01 | Declare validations from a closed vocabulary in every command entry | Makes an added rule check impossible to hide: it must be written beside the five permitted checks. |
| D-10-02 | Only `draw_tile` is turn-gated | The wall is the sole contended resource. Gating anything else needs to know why the turn moves. |
| D-10-03 | `claim_discard` moves the turn pointer with no entitlement check | How the pointer legitimately jumps out of order without rule knowledge. |
| D-10-04 | `claim_discard` names the tile handle | Prevents a stale click from claiming a tile the player never saw. |
| D-10-05 | Simultaneous claims resolve by arrival order | The only rule-free resolution. Correction is the remedy for a wrong outcome. |
| D-10-06 | `swap_exposed_tile` as a general primitive | Covers the joker exchange without knowing what a joker is. |
| D-10-07 | `arrange_hand` takes a full permutation | Idempotent, self-correcting under replay, and cheap at 152 tiles. |
| D-10-08 | Pass-round commitment count is public; identities are not | Mirrors visibly pushed tiles at a physical table. |
| D-10-09 | Any seat may open or cancel a pass round | No seat has special authority; the players agree among themselves. |
| D-10-10 | Timeouts expire as refusals, never as acceptances | `NR-210`: the system never performs a binding action. Refusing is not acting. |
| D-10-11 | `reveal_hand` is separate from `declare_mahjong` and voluntary | Declaring and showing are distinct physical acts, and players may simply be trusted. |
| D-10-12 | Rejections are private to the actor | A rejection reveals intent; other seats should not learn of a failed attempt. |
| D-10-13 | `retract_exposure` is permitted, and its event carries the faces | Physically possible; the information was already seen, and the event records reality. |
| D-10-14 | `start_deal` from `CONCLUDED` folds `09 §7`'s own `CONCLUDED -> IDLE` edge into one command, rather than the wire protocol exposing a separate transition | The engine's own `apply()` stays strictly `IDLE`-only — a lower-risk, unchanged contract for the pure state machine — while the table actor treats a concluded state as equivalent fresh input for a new deal, since dealing never reads the prior state at all (`08 §4`). FR-117. |

---

## 13. Alternative Designs

| Alternative | Why rejected |
|---|---|
| Turn-gate discards as well as draws | Presumes a discard follows a draw — a rule. |
| An arbitration window for simultaneous claims | Choosing among claimants requires priority rules. |
| Claimable older discards | Physical reach makes the current discard the reachable one; correction covers the rest. |
| A typed exposure (`pung`, `kong`, …) | Rule vocabulary on the wire (`19 §3`). |
| A dedicated joker-exchange command | Would require recognizing a joker. |
| Pass rounds with a fixed count or direction | Rule content (`NR-008`). |
| A `pass_tile` primitive with no round concept | Loses simultaneity and secrecy — the two properties that make a physical exchange what it is. |
| `arrange_hand` as a move instruction | Not idempotent; drift compounds under replay. |
| Declaration accepted by timeout | Silence is not consent, and a disconnected player would be treated as agreeing. |
| Public rejections | Leak intent. |

---

## 14. Trade-offs

**The catalog is permissive to the point of allowing nonsense** — exposing a single tile, passing
seven tiles to one seat, discarding on someone else's turn. Accepted: every one of those is
physically possible at a table, and forbidding them requires rules.

**Simultaneous claims are decided by network latency.** Accepted, and honest: the alternative needs
priority rules. Correction is the remedy, and the physical equivalent — two hands reaching at once —
is resolved socially too.

**`arrange_hand` sends the full hand on every reorder.** Accepted: at most 152 handles, on a
connection already carrying full seat views, and the idempotence is worth more than the bytes.

**A tile revealed and then retracted stays known.** Accepted: it is what happens at a table, and the
event records it honestly rather than pretending otherwise.

---

## 15. Risks

| Risk | Mitigation |
|---|---|
| A validation outside the closed vocabulary is added | `D-10-01` format; `TC-A03` command-path audit |
| A seat parameter is added for convenience | `NR-601`; `TC-I01` interface audit |
| A timeout is made to accept rather than refuse | `D-10-10`; `NR-210`; `TC-A08` |
| Pass rounds acquire a count or direction constraint | `NR-008`; `TC-A03` |
| Commands proliferate as conveniences are added | Every new command needs an amendment and a validation list from the closed set |
| A claim resolves against a tile the player never saw | `D-10-04` handle parameter; `M-3` |

---

## 16. Future Considerations

Not committed: a `return_current_discard` primitive as a lighter alternative to a full rewind for the
most common mistake; a pass round that permits a seat to opt out mid-round rather than cancelling
the whole thing.

---

## 17. Cross References

| Document | Focus |
|---|---|
| `02_System_Scope.md` | The closed validation vocabulary |
| `06_Digital_Dealer_Architecture.md` | The duties these commands invoke |
| `09_Game_State_Machine.md` | Command availability by state |
| `11_Tile_Interaction_UX.md` | Free versus binding acts and their gestures |
| `13_Input_Integrity.md` | `cmdId`, `cseq`, staleness |
| `19_WebSocket_Event_Catalog.md` | The normative wire catalog |
| `33_API/Error_Code_Catalog.md` | Every rejection and close code |

---

## 18. Revision History

| Version | Date | Author | Changes |
|---|---|---|---|
| 0.1 | 2026-09-02 | Design (architect role), owner-approved | Initial catalog: 26 commands, closed validation vocabulary, full rejection list |
| 0.2 | 2026-09-03 | Design (architect role), owner-approved | `start_deal`'s `§4` row clarified to include `CONCLUDED` (`09 §7`), matching the matrix; `D-10-14` |
