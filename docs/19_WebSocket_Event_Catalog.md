# 19 — WebSocket Event Catalog

| | |
|---|---|
| **Project** | American Mahjong Dealer |
| **Document** | 19_WebSocket_Event_Catalog.md |
| **Status** | Ratified v0.1 — approved by the project owner, 2026-09-02 |
| **Last Updated** | 2026-09-02 |
| **Role in SSOT** | **Normative and machine-checkable.** Owns the complete wire vocabulary — every command, frame, event, and code — with the visibility class of every field, and the protocol naming law. Does **not** own the transport mechanics (`12`), command semantics (`10`), or the privacy model (`14`). |

---

## 1. Executive Summary

This is the wire contract. It exists as a separate document from `12` and `18` for one reason: **it
is compared against the implementation by a build step.** A catalog that drifts from the code is
worse than no catalog, so drift is made impossible rather than discouraged — CI diffs the names here
against the protocol definitions in `shared` and fails on any mismatch (`TC-P08`).

Two things make it more than a list.

Every field carries a **visibility class**. `PUB` reaches all four seats, `OWN` reaches exactly one.
No wire field is ever `SRV` — server-only data is not in the protocol at all, and that absence is
the strongest possible statement of it. A reviewer checking a new event only has to ask which class
each field belongs to, and the answer is written down.

And the catalog has a **Deliberate Absences** section (`§8`). The names that are *not* here — no
`declare_call`, no `charleston_pass`, no `confirm_win`, no `transfer` — are as normative as the names
that are. Their absence is enforced by `TC-A01` and `TC-A06`.

---

## 2. Objectives

Serves `OBJ-06` (every field's audience is declared), `OBJ-10` (rule vocabulary cannot enter the
protocol), and `NFR-063` (documentation and implementation cannot diverge).

---

## 3. The naming law

Machine-checked. A violation fails the build.

| Category | Convention | Examples |
|---|---|---|
| Client commands | `lower_snake_case` | `draw_tile`, `open_pass_round` |
| Server frame types | `lower_snake_case`, single word where possible | `bound`, `ack`, `reject`, `event` |
| Table events | `PascalCase` | `TileDiscarded`, `PassRoundExecuted` |
| Rejection codes | `SCREAMING_SNAKE_CASE` | `NOT_YOUR_TILE` |
| Close codes | `SCREAMING_SNAKE_CASE` with a numeric code | `4002 TICKET_INVALID` |
| Sequence numbers | Exactly one, named `seq` | — |

### 3.1 No rule-derived vocabulary

> **No identifier in the protocol — command, frame, event, field, or code — may be derived from a
> Mahjong rule concept.**

Forbidden as identifiers: `call`, `pung`, `kong`, `quint`, `charleston`, `courtesy`, `blind`,
`joker` as a behaviour (the *face* `J` is equipment, `07 §3`), `win`, `mahjong` other than in
`declare_mahjong` and `MahjongDeclared` where it names the word a player says, `dead`, `valid`,
`legal`, `score`, `value`, `points`.

The rule exists because vocabulary shapes implementation. A command named `declare_call` invites a
handler that asks *what kind of call*, and a handler that asks that needs the rules. Naming the same
mechanism `claim_discard` leaves nothing to ask.

`declare_mahjong` is the one deliberate borrowing, and it is admitted because it names a **speech
act**, not a rule: the player says a word, and the system records that they said it. `§8` records
this exception explicitly so it does not become a precedent.

### 3.2 Exactly one sequence number

`seq` — the table's authoritative counter — appears on every `event` and `ack`. `cseq` is a
per-connection input counter with a different lifetime and is not a sequence number in the sense
this law governs (`12 §5.3`). Introducing a second would guarantee that two eventually disagree.

---

## 4. Envelopes

### 4.1 Client to server

| Field | Type | Required | Notes |
|---|---|---|---|
| `t` | `"cmd"` | yes | |
| `cmd` | string | yes | From `§5` |
| `cmdId` | UUIDv7 | yes | Per **intent**, reused across retries (`13 §4.1`) |
| `cseq` | integer ≥ 1 | yes | Per-connection, contiguous |
| `d` | object | per command | Parameters |

**Absent by design:** `seat`, `table`, `player`, `timestamp`, `signature`. The seat and table come
from the binding (`NR-601`); a client's clock is not evidence.

### 4.2 Server to client

| `t` | Fields | When |
|---|---|---|
| `bound` | `seat`, `protocolVersion`, `seq` | Binding succeeded |
| `resumed` | `seq`, `view?` | Resumption complete; `view` present if a snapshot was sent |
| `ack` | `cmdId`, `seq` | A command was applied |
| `reject` | `cmdId`, `code`, `message`, `view?` | Refused; `view` present on `STALE_STATE` |
| `event` | `seq`, `ev`, `view` | Something happened at the table |
| `notice` | `kind`, `d` | Out-of-band information |
| `pong` | — | Heartbeat response |

Every `event` carries this seat's complete view, not a delta (`12 §5.4`).

---

## 5. Command catalog

Semantics in `10`. `Turn` indicates whether the turn pointer is gated or moved.

| Command | Parameters | Turn | Emits |
|---|---|---|---|
| `bind` | `ticket` | — | `bound` |
| `resume` | `lastSeq` | — | events or `resumed` |
| `ping` | — | — | `pong` |
| `set_ready` | — | — | `SeatReady` |
| `clear_ready` | — | — | `SeatUnready` |
| `start_deal` | — | sets | `WallBuilt`, `DealCommitmentPublished`, `TilesDealt` |
| `close_table` | — | — | `TableClosed` |
| `draw_tile` | `end` | **gated**, advances | `TileDrawn` |
| `discard_tile` | `handle` | — | `TileDiscarded` |
| `claim_discard` | `handle` | **moves** | `DiscardClaimed` |
| `expose_tiles` | `handles[]` | — | `TilesExposed` |
| `retract_exposure` | `exposureId` | — | `ExposureRetracted` |
| `swap_exposed_tile` | `myHandle`, `exposureId`, `exposedHandle` | — | `ExposedTileSwapped` |
| `arrange_hand` | `handles[]` | — | *(none public)* |
| `open_pass_round` | `routing[]` | — | `PassRoundOpened` |
| `commit_pass` | `handles[]` | — | `PassCommitted`, then `PassRoundExecuted` |
| `withdraw_pass` | — | — | `PassWithdrawn` |
| `cancel_pass_round` | — | — | `PassRoundCancelled` |
| `declare_mahjong` | — | — | `MahjongDeclared` |
| `reveal_hand` | — | — | `HandRevealed` |
| `respond_declaration` | `response` | — | `DeclarationResponded`, then `GameConcluded` or `DeclarationDisputed` |
| `withdraw_declaration` | — | — | `DeclarationWithdrawn` |
| `propose_end_game` | — | — | `EndGameProposed` |
| `respond_end_game` | `response` | — | `EndGameResponded`, then `GameConcluded` |
| `propose_correction` | `rewindTo` | — | `CorrectionProposed` |
| `respond_correction` | `response` | — | `CorrectionResponded`, then `CorrectionApplied` or `CorrectionRejected` |
| `request_pause` | — | — | `TablePaused` |
| `request_resume` | — | — | `TableResumed` |
| `send_table_message` | `text` | — | `TableMessage` |
| `send_signal` | `signal` | — | `TableSignal` |

Thirty commands, including the three protocol commands.

---

## 6. Event catalog

**Every field's visibility class is declared.** `PUB` is delivered to all four seats; `OWN` only to
the named seat.

### 6.1 Seating and presence

| Event | `PUB` fields | `OWN` fields |
|---|---|---|
| `SeatOccupied` | `seat`, `displayName` | — |
| `SeatVacated` | `seat` | — |
| `SeatReady` / `SeatUnready` | `seat` | — |
| `SeatDisconnected` | `seat`, `reason` | — |
| `SeatReconnected` | `seat` | — |
| `TablePaused` | `seat`, `reason` | — |
| `TableResumed` | `seat` | — |
| `TableClosed` | `reason` | — |

### 6.2 Dealing

| Event | `PUB` fields | `OWN` fields |
|---|---|---|
| `WallBuilt` | `wallRemaining` | — |
| `DealCommitmentPublished` | `commitment` | — |
| `TilesDealt` | `handSizes`, `turn`, `wallRemaining` | `tiles[]` — this seat's dealt tiles |
| `ReshuffleCommitmentPublished` | `commitment`, `atSeq` | — |

`TilesDealt` is the clearest illustration of the model: one event, four different payloads. Every
seat learns every hand *size*; each learns only its own *faces*.

### 6.3 Play

| Event | `PUB` fields | `OWN` fields |
|---|---|---|
| `TileDrawn` | `seat`, `end`, `wallRemaining`, `handSize` | `tile` — only to the drawing seat |
| `TileDiscarded` | `seat`, `tile`, `discardIndex`, `handSize` | — |
| `DiscardClaimed` | `seat`, `tile`, `handSize`, `turn` | — |
| `TilesExposed` | `seat`, `exposureId`, `tiles[]`, `handSize` | — |
| `ExposureRetracted` | `seat`, `exposureId`, `tiles[]`, `handSize` | — |
| `ExposedTileSwapped` | `seat`, `exposureId`, `exposureOwner`, `tileIn`, `tileOut`, `handSize` | — |
| `WallExhausted` | — | — |

`tile` is `PUB` on a discard because a discarded tile is face-up on the table. It is `OWN` on a draw
because a drawn tile goes behind a rack. The same field name, two classes, decided by where the tile
went — which is why the class is declared per event rather than per field name.

`ExposureRetracted` carries the faces publicly: everyone watched them go back, and the event records
reality rather than pretending the information was un-seen (`D-10-13`).

### 6.4 Pass rounds

| Event | `PUB` fields | `OWN` fields |
|---|---|---|
| `PassRoundOpened` | `openedBy`, `routing[]`, `participants[]` | — |
| `PassCommitted` | `seat`, `count` | — |
| `PassWithdrawn` | `seat` | — |
| `PassRoundCancelled` | `cancelledBy` | — |
| `PassRoundExecuted` | `routing[]`, `counts`, `handSizes` | `received[]` — only what this seat received |

`PassCommitted` carries a count and no faces (`FR-092`). `PassRoundExecuted` is the atomic moment:
no seat learns another's tiles before it, and afterwards each learns only what arrived at its own
rack.

### 6.5 Conclusion

| Event | `PUB` fields | `OWN` fields |
|---|---|---|
| `MahjongDeclared` | `seat` | — |
| `HandRevealed` | `seat`, `tiles[]` | — |
| `DeclarationResponded` | `seat`, `response` | — |
| `DeclarationDisputed` | `seat` | — |
| `DeclarationWithdrawn` | `seat` | — |
| `EndGameProposed` | `seat` | — |
| `EndGameResponded` | `seat`, `response` | — |
| `GameConcluded` | `outcome`, `outcomeSeat?` | — |

`GameConcluded` carries an outcome enumeration and, where applicable, a seat. **There is no score,
value, or justification field, and no field into which one could be added without amending this
catalog** (`NR-013`).

### 6.6 Correction

| Event | `PUB` fields | `OWN` fields |
|---|---|---|
| `CorrectionProposed` | `seat`, `rewindTo`, `affectedActions[]` | — |
| `CorrectionResponded` | `seat`, `response` | — |
| `CorrectionApplied` | `restoredSeq`, `reshuffled` | — |
| `CorrectionRejected` | `reason` | — |

`affectedActions[]` describes the actions to be undone in public terms — "East discarded, South
claimed" — so the other three seats can vote on something specific.

### 6.7 Communication

| Event | `PUB` fields | Notes |
|---|---|---|
| `TableMessage` | `seat`, `displayName`, `text` | **Never persisted or logged** (`FR-131`) |
| `TableSignal` | `seat`, `signal` | `knock` \| `wait` \| `ack` |

---

## 7. Codes

### 7.1 Rejection codes

| Code | Meaning |
|---|---|
| `NOT_BOUND` | The connection has not completed `bind` |
| `NOT_YOUR_TURN` | Turn gate failed — `draw_tile` only |
| `NOT_YOUR_TILE` | Ownership failed, **or the handle is unknown** (`13 §8.1`) |
| `TILE_NOT_AVAILABLE` | The target has moved or been superseded |
| `NOT_IN_PHASE` | The command does not exist in this game state |
| `TABLE_PAUSED` | A pause is in effect |
| `CORRECTION_PENDING` | A correction proposal is open |
| `PASS_ROUND_OPEN` | A pass round is open |
| `WALL_EMPTY` | No tiles remain to draw |
| `NO_CHECKPOINT` | Correction target outside the window |
| `DUPLICATE_COMMAND` | Already applied; the original outcome is returned |
| `SEQ_GAP` | `cseq` non-contiguous — the socket closes |
| `STALE_STATE` | Acted on a superseded view; a view accompanies the rejection |
| `MALFORMED` | Schema validation failed |
| `RATE_LIMITED` | Throttled |
| `FORBIDDEN` | Authorization failed |
| `TABLE_CLOSED` | The table is terminal |

Precedence when several apply: `TABLE_PAUSED`, `CORRECTION_PENDING`, `PASS_ROUND_OPEN` (`09 §5.2`).

### 7.2 Close codes

| Code | Name |
|---|---|
| 4001 | `BIND_REQUIRED` |
| 4002 | `TICKET_INVALID` |
| 4003 | `REPLACED_BY_NEWER_BIND` |
| 4004 | `SESSION_REVOKED` |
| 4008 | `PROTOCOL_VIOLATION` |
| 4009 | `RATE_LIMITED` |
| 4010 | `SLOW_CONSUMER` |
| 4011 | `SEAT_VACATED` |
| 1012 | `SERVICE_RESTART` |

Client guidance per code in `33_API/Error_Code_Catalog.md`.

### 7.3 Notice kinds

| Kind | Meaning |
|---|---|
| `connection_degraded` | Heartbeats are slow; a disconnection may follow |
| `rate_limit_warning` | Approaching a limit |
| `service_restarting` | A planned restart is imminent |

---

## 8. Deliberate absences

**As normative as the catalog above.** Each name is absent because its presence would import a
concept the system does not have.

| Absent name | Why | Enforced by |
|---|---|---|
| `declare_call`, `CallDeclared`, `CallWindowOpened`, `CallResolved` | A "call" has kinds, and kinds are rules. `claim_discard` leaves nothing to ask | `NR-005`, `TC-A01` |
| `charleston_pass`, `CharlestonPhaseOpened`, `courtesy_pass`, `blind_pass` | Every one is a rule concept. The mechanism is `open_pass_round` | `NR-008`, `TC-A01` |
| `exchange_joker`, `JokerExchanged` | Would require recognizing a joker. The mechanism is `swap_exposed_tile` | `NR-007`, `TC-A01` |
| `confirm_win`, `WinConfirmed`, `validate_hand` | The system does not know whether anyone won | `NR-003`, `TC-A01` |
| `HandDeclaredDead`, `declare_dead` | A rule outcome | `NR-012`, `TC-A01` |
| `score`, `value`, `GameScored`, any `points` field | No scoring | `NR-013`, `TC-A06` |
| `transfer_points`, `wallet_updated`, `fee_collected`, `penalty_executed` | No economy | `NR-101`–`NR-109`, `TC-A06` |
| `subscribe`, `spectate`, `observe`, `watch_table` | No spectators | `NR-401`, `TC-A10` |
| `replay`, `export_game` | No replay | `NR-508`, `TC-A11` |
| `suggest_move`, `hint`, `sort_hand`, `auto_arrange` | No assistance or automation | `NR-203`, `NR-301`, `TC-A07`, `TC-A09` |
| A `seat` field on any client frame | The binding decides | `NR-601`, `TC-I01` |
| A second sequence number | `§3.2` | `TC-P08` |

### 8.1 The one admitted borrowing

`declare_mahjong` and `MahjongDeclared` contain a rule concept's name. They are admitted because
they name a **speech act**: the player says a word, and the system records that they said it. No
handler asks what the word means, and no code branches on it.

Recorded here explicitly so it is understood as an exception with a stated basis rather than a
precedent. Any further borrowing requires an amendment to this section.

---

## 9. Machine checking

| Check | What it does | Case |
|---|---|---|
| Name inventory | Every command, frame, event, and code here exists in `shared`, and vice versa | `TC-P08` |
| Naming law | Every identifier matches its category's convention (`§3`) | `TC-P08` |
| Forbidden vocabulary | No identifier matches the `§8` absence list | `TC-A01`, `TC-A06` |
| Visibility classes | Every field in the projector's output appears in `§6` with a class | `TC-P01` |
| Single sequence | Exactly one field named `seq` in the frame types | `TC-P08` |

A build that fails any of these does not ship. This is what makes the document normative rather than
descriptive.

---

## 10. Design Decisions

| ID | Decision | Rationale |
|---|---|---|
| D-19-01 | A machine-checked naming law | Vocabulary shapes implementation: `declare_call` invites a handler that asks what kind. Checking mechanically means the law survives contributor turnover. |
| D-19-02 | No rule-derived vocabulary anywhere in the protocol | The protocol is the most durable artifact in the system; a rule concept there propagates into every layer. |
| D-19-03 | Declare a visibility class per event field, not per field name | The same name can be `PUB` or `OWN` depending on where the tile went — a drawn tile versus a discarded one. |
| D-19-04 | No wire field is ever `SRV` | Server-only data is absent from the protocol, which is stronger than marking it. |
| D-19-05 | A Deliberate Absences section, machine-checked | The names not present are as normative as those present, and absence is otherwise invisible to a reader and a linter alike. |
| D-19-06 | Admit `declare_mahjong` explicitly, with a stated basis | It names a speech act. Recording the exception prevents it becoming a precedent. |
| D-19-07 | Keep this catalog separate from `12` and `18` | It is a checked artifact; embedding it in prose would make the check meaningless. |
| D-19-08 | Exactly one sequence number | Two eventually disagree. |

---

## 11. Alternative Designs

| Alternative | Why rejected |
|---|---|
| Catalog embedded in the architecture chapter | Cannot be diffed against code as a unit. |
| Generating the catalog from code | Then it documents what was built rather than specifying what should be. The check runs in the specifying direction. |
| A schema language instead of tables | Less readable for the visibility classes, which are the point, and a schema cannot express a deliberate absence. |
| Domain-accurate names such as `declare_call` | `D-19-02`. |
| A generic `action` command with a type field | Moves dispatch into a payload, defeating both schema validation and the naming law. |
| Marking server-only fields `SRV` in the catalog | They are not in the protocol; listing them would suggest they could be. |

---

## 12. Trade-offs

**The naming law makes some names less natural to a Mahjong player.** Accepted, and the point:
`claim_discard` is exactly as expressive as the mechanism actually is.

**Per-event visibility declarations are verbose.** Accepted: verbosity is what makes review
mechanical.

**Machine checking means adding an event requires updating this document first.** Accepted: that is
the amendment process working (`00 §12.3`).

**The absence list will grow as new temptations appear.** Accepted and expected; it is cheap to
extend.

---

## 13. Risks

| Risk | Mitigation |
|---|---|
| Rule vocabulary enters via a new event | `§3.1`; `TC-A01`; the catalog must be amended before code |
| Documentation drifts from implementation | `TC-P08` name inventory in both directions |
| A field is added to the projector without a class | `TC-P01` requires every projected field to appear in `§6` |
| The `declare_mahjong` exception becomes a precedent | `§8.1` states the basis; further borrowing requires an amendment |
| A score field is added to `GameConcluded` | `NR-013`; `TC-A06`; no such field exists to extend |

---

## 14. Future Considerations

Not committed: a machine-readable form of this catalog generated *from* the document, so the check
becomes a comparison of two generated artifacts; protocol version negotiation, should a breaking
change ever be needed.

---

## 15. Cross References

| Document | Focus |
|---|---|
| `12_Realtime_WebSocket_Architecture.md` | Transport, envelopes, delivery |
| `10_Player_Action_Model.md` | Command semantics and validations |
| `14_Player_Privacy.md` | The visibility classes |
| `33_API/Wire_Protocol_Contract.md` | Client obligations and full schemas |
| `33_API/Error_Code_Catalog.md` | Codes with client guidance |
| `34_Testing/Privacy_and_Absence_Suites.md` | `TC-P08`, `TC-A01`, `TC-A06` |

---

## 16. Revision History

| Version | Date | Author | Changes |
|---|---|---|---|
| 0.1 | 2026-09-02 | Design (architect role), owner-approved | Initial catalog: 30 commands, 7 frame types, 38 events, 17 rejection codes, 8 close codes, 12 absence families |
