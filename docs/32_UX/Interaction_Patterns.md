# Interaction Patterns

| | |
|---|---|
| **Project** | American Mahjong Dealer |
| **Document** | 32_UX/Interaction_Patterns.md |
| **Status** | Detail for ratified chapters — Ch. 11 and Ch. 24 remain authoritative |
| **Last Updated** | 2026-09-02 |
| **Role in SSOT** | Owns the non-tile interaction patterns: confirmations, votes, banners, panels, and the action bar. Does **not** own tile gestures (`11`), tile rendering (`Tile_Component_Spec.md`), or layout (`Table_Layout_and_Perspective.md`). |

---

## 1. Scope

Tile interaction is `11`. This document covers everything around it: how a binding act is confirmed,
how a vote is presented, how connection state is surfaced, and how the action bar behaves.

One principle governs all of it, and it is the Fidelity Contract's `FC-2` and `FC-6` in practice:
**nothing in this interface acts on its own.** No dialog auto-dismisses into a decision, no vote
defaults to yes, no timer commits anything. The only thing a timeout ever does is **refuse**
(`NR-210`).

---

## 2. Confirmation

### 2.1 Arm and confirm, not a dialog

Binding acts use an **inline armed state** rather than a modal dialog (`11 §5.2`).

```
[ tile outlined ]  Discard five of dots?   [ Confirm ]  [ Cancel ]
```

| Property | Value |
|---|---|
| Placement | Inline in the action bar, adjacent to the affected tile |
| Escape | Cancels |
| Enter | Confirms |
| Click elsewhere | Cancels |
| **Auto-dismiss** | **Never** |
| Announced | `"Discard five of dots — press Enter to confirm"` |

A modal dialog would take focus, obscure the table, and — most importantly — put a default button
under the cursor where the player was already clicking. The inline pattern keeps the tile and the
table visible, which is what lets a player check they armed the right thing.

### 2.2 Which acts need confirmation

| Act | Guard |
|---|---|
| Discard by drag | The drag into the labelled zone **is** the deliberate gesture; no separate confirmation |
| Discard by keyboard or click | Arm and confirm |
| Claim the current discard | Arm and confirm — the pile is near the centre where a stray click is plausible |
| Expose by drag | The drag onto the ledge is the gesture |
| Retract an exposure | Arm and confirm |
| Draw from the wall | Arm and confirm |
| Declare Mahjong | Arm and confirm |
| **Reveal hand** | Arm and confirm, **with an explicit warning** |
| Commit a pass | Arm and confirm |
| Propose a correction | Arm and confirm, showing which actions will be undone |

### 2.3 Reveal warns once

`reveal_hand` is irreversible and shows every tile to all three opponents. Its confirmation states
exactly that:

> **Reveal your hand?** All three other players will see every tile. This cannot be undone.

This is the only warning in the interface, and it earns its place: it is the only binding act whose
consequence is not obvious from the gesture.

---

## 3. Votes

Three mechanisms require responses from other seats: corrections, declarations, and end-game
proposals. All three use one pattern.

```
┌─────────────────────────────────────────────────────────┐
│  East proposes undoing the last 2 actions:              │
│    · East discarded five of dots                        │
│    · South claimed five of dots                         │
│                                                         │
│  South  ✔ accepted     West  … waiting                  │
│  North  … waiting                                       │
│                                                         │
│              [ Accept ]        [ Reject ]               │
└─────────────────────────────────────────────────────────┘
```

| Property | Value |
|---|---|
| Placement | A band across the table centre; the table stays visible beneath |
| Content | Who proposed, what is proposed, in public terms |
| Progress | Each seat's response, or that it is still waiting |
| Timeout | 60 s for corrections; **none** for declarations |
| **On timeout** | **Rejected.** Never accepted, never defaulted (`D-10-10`) |
| While paused | The timeout suspends (`22 §5.1`) |
| Own response | Once given, shown as given; cannot be changed |

### 3.1 Silence is never consent

The timeout expiring as a rejection is the single most important property of this pattern. A vote
that defaulted to acceptance would let a network failure rewind a game, or let an inattentive player
be treated as agreeing that someone won.

The interface shows the remaining time and states what will happen: "expires in 0:34 — the correction
will be rejected."

### 3.2 Declarations have no timeout

A declaration waits indefinitely. There is no correct amount of time for three people to examine a
hand against a card, and expiring a declaration — in either direction — would be the system taking a
view. The declarer can withdraw (`FR-115`) and the players can talk.

---

## 4. Banners

| Banner | Trigger | Behaviour |
|---|---|---|
| Connection degraded | Heartbeats slow | Amber; states what is happening |
| Reconnecting | Socket lost | Amber with progress; the table dims but stays visible |
| Table paused | A seat absent, or a pause request | Neutral; names the reason and the seat |
| Table unavailable | A consistency failure (`21 §3.4`) | Red; states that the table cannot continue and offers to leave |
| Service restarting | `notice { service_restarting }` | Neutral; states that play resumes shortly |

Banners occupy a reserved strip at the top and **never overlap the rack** (`D-32-14`). The reserved
strip means their appearance does not shift the layout, which would move a tile under a player's
pointer mid-gesture.

---

## 5. The action bar

Along the bottom, beneath the rack.

| Region | Contents |
|---|---|
| Available actions | Only actions the server would currently accept |
| Armed action | The inline confirmation (`§2.1`) |
| Turn indicator | Whose turn, in text |
| Pass round control | Open a round; commit; cancel |
| Table controls | Declare, propose end, propose correction, request pause |

### 5.1 Unavailable actions are shown as unavailable, and only for mechanical reasons

An action is disabled **only** when the server would genuinely refuse it — not your turn, wall empty,
table paused, correction pending. That is honest feedback about the system's own state.

An action is **never** disabled because it looks unwise, unusual, or illegal under any rule
(`02 §8`). A disabled discard would require rule knowledge, and there is none.

Disabled controls carry a reason on hover and in their accessible name: "Draw — not your turn."

---

## 6. Chat and signals

| Property | Value |
|---|---|
| Placement | Docked panel at wide widths; a drawer below (`Table_Layout_and_Perspective.md §4`) |
| Input | Single line, 512 characters, character count shown near the limit |
| Rendering | **Plain text always**; never markup, never a link preview (`15 §6`) |
| History | Session only; no backlog on reconnection (`FR-131`) |
| Unread | A count on the drawer trigger; never a modal interruption |
| Signals | Three buttons; the signal animates at the sending seat's label |
| Availability | Every state, including while paused and during `DEALING` (`D-09-09`) |

Chat never interrupts. A message arriving while a player is mid-drag must not steal focus, shift
layout, or open a panel — the count increments and that is all.

---

## 7. Empty and waiting states

| State | Presentation |
|---|---|
| Lobby, waiting for players | Empty seats shown as empty, with the join code prominent |
| Lobby, not all ready | Each seat's readiness; the deal control disabled with its reason |
| Dealing | A brief animation; no interaction available |
| Pass round, awaiting others | Own commitment shown; others' counts shown; no timer pressure displayed beyond the round's own long timeout |
| Concluded | The outcome stated neutrally; a control to return to the lobby |

The concluded state says "North declared Mahjong — all players accepted." Never "North wins," never a
score, never a rule reference (`D-32-17`, `NR-013`).

---

## 8. Design Decisions

| ID | Decision | Rationale |
|---|---|---|
| D-32-30 | Inline arm-and-confirm rather than modal dialogs | A modal takes focus, obscures the table, and puts a default button where the player was already clicking. |
| D-32-31 | Nothing auto-dismisses into a decision | `FC-2`, `FC-6`; `NR-210`. |
| D-32-32 | Vote timeouts expire as rejections, and say so | Silence is not consent; a network failure must not decide a vote. |
| D-32-33 | Declarations have no timeout | There is no correct time to examine a hand, and expiring one would be the system taking a view. |
| D-32-34 | Only `reveal_hand` carries a warning | The only binding act whose consequence is not obvious from the gesture. |
| D-32-35 | A reserved banner strip | Prevents layout shift moving a tile under the pointer. |
| D-32-36 | Actions disabled only for mechanical reasons, with the reason shown | Honest about the system's state; a rule-based disable would require rules. |
| D-32-37 | Chat never interrupts | A message must not steal focus or shift layout mid-gesture. |
| D-32-38 | Chat is always plain text | Removes injection from the only user-generated content. |
| D-32-39 | Votes show a public description of the affected actions | Players must vote on something specific. |

---

## 9. Cross References

`11_Tile_Interaction_UX.md` · `24_Accessibility.md` · `05_Game_Table_Architecture.md §8`, `§9` ·
`09_Game_State_Machine.md §5` · `Table_Layout_and_Perspective.md` · `Screen_Inventory.md`

## 10. Revision History

| Version | Date | Author | Changes |
|---|---|---|---|
| 0.1 | 2026-09-02 | Design (architect role) | Initial pattern specification |
