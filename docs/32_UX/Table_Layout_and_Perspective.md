# Table Layout and Perspective

| | |
|---|---|
| **Project** | American Mahjong Dealer |
| **Document** | 32_UX/Table_Layout_and_Perspective.md |
| **Status** | Detail for ratified chapters — Ch. 11 and Ch. 24 remain authoritative |
| **Last Updated** | 2026-09-02 |
| **Role in SSOT** | Owns the layout of `S-06`, the perspective model, and spatial arrangement. Does **not** own interaction (`11`), tile rendering (`Tile_Component_Spec.md`), or accessibility requirements (`24`). |

---

## 1. The perspective rule

> **Every client renders its own seat at the bottom, with the other three in true relative
> position.**

So East's client shows South on the right, West across, North on the left. South's client shows West
on the right, North across, East on the left.

This costs nothing to implement and matters a great deal. It is what a table looks like from a chair,
and it makes seat-relative reasoning — "the player to my left" — visually correct for all four
players simultaneously. A fixed compass layout would be correct for one player and disorienting for
three (`D-05-03`).

---

## 2. Layout

```
┌─────────────────────────────────────────────────────────────┐
│  connection banner (only when degraded)                     │
├─────────────────────────────────────────────────────────────┤
│                    ACROSS  ·  name · ● · 13                 │
│                    [exposures on the ledge]                 │
│                    ▪▪▪▪▪▪▪▪▪▪▪▪▪  (backs only)             │
│                                                             │
│  LEFT              ┌───────────────────┐            RIGHT   │
│  name ●            │  WALL   42 left   │            ● name  │
│  13                │  ┌──┐       ┌──┐  │              13    │
│  [exp]             │  │hd│       │tl│  │           [exp]    │
│  ▪                 │  └──┘       └──┘  │              ▪     │
│  ▪                 │                   │              ▪     │
│  ▪                 │   DISCARD PILE    │              ▪     │
│  ▪                 │   ▣ ▣ ▣ ▣ ▣ ▣ ▣  │              ▪     │
│                    │   (newest ringed)  │                    │
│                    └───────────────────┘                     │
│                                                             │
│  [my exposures on my ledge]                                 │
│  ┌───────────────────────────────────────────────────────┐  │
│  │  MY RACK — faces visible, my order, my gaps           │  │
│  │  🀇 🀈 🀉  🀊 🀋  🀌 🀍 🀎 🀏  🀐 🀑 🀒 🀓            │  │
│  └───────────────────────────────────────────────────────┘  │
│  [ Discard zone ]   [ action bar ]   [ chat ]               │
└─────────────────────────────────────────────────────────────┘
```

| Region | Contents | Visibility |
|---|---|---|
| Own rack | Tile faces, in the player's order, with gaps | `OWN` |
| Own exposure ledge | Face-up groups | `PUB` |
| Opponent racks | **Tile backs only**, count shown numerically | `PUB` count |
| Opponent exposure ledges | Face-up groups | `PUB` |
| Wall | Head and tail ends, count remaining | `PUB` count; order is `SRV` |
| Discard pile | All discards in order, newest ringed | `PUB` |
| Seat labels | Position, name, connection, readiness, hand size | `PUB` |
| Discard zone | Labelled drop target | — |
| Action bar | Available commands and armed state | — |
| Chat panel | Messages and signals | `PUB` to the four seats |

### 2.1 Opponent racks show backs

Rendering tile backs rather than a bare count is deliberate. A count is information; a rack of backs
is the *thing itself*, and seeing thirteen backs shorten to twelve when someone discards is how a
physical table communicates. The number is also shown, because at a glance a rack of thirteen and one
of fourteen are hard to distinguish and the count is public anyway (`14 §4.1`).

### 2.2 The newest discard is ringed

Only the current discard is claimable (`FR-068`), so it must be visually distinct. It is ringed and
slightly raised, and it is the only tile in the pile that responds to a pointer.

Older discards remain visible and in order — they are on the table, and players remember them — but
they are inert.

### 2.3 Both wall ends are targets

Head and tail are separately clickable (`FR-061`). The system attaches no meaning to the choice, so
neither is emphasized and neither is labelled with anything beyond its position.

---

## 3. Spatial reasoning

| Rule | Reason |
|---|---|
| Own rack is always the bottom edge, full width | The most-interacted region, closest to the hand |
| The discard zone is adjacent to the rack but distinct | Reachable by a short drag; far enough that a stray release misses it (`11 §9`) |
| The centre holds shared objects only | Wall and discards belong to nobody |
| Exposures sit between a rack and the centre | The rack ledge, as at a physical table |
| The turn indicator is on the seat label | Attached to the seat it describes, not floating |
| Nothing overlaps the rack | The rack is never occluded by a banner, toast, or panel |

The last rule is worth stating: a notification covering part of a player's hand while they are
choosing a discard would be both annoying and, briefly, misleading.

---

## 4. Responsive behaviour

| Width | Layout |
|---|---|
| Wide (≥ 1200 px) | As illustrated; chat panel docked right |
| Medium (768–1199 px) | Table scales; chat becomes a collapsible drawer |
| Narrow (< 768 px) | Table scales to fit; opponent racks compress to a label plus count plus a compact back stack; rack scrolls horizontally; chat is a drawer |
| Any width, 300% zoom | Rack scales to its floor then scrolls; **never wraps** (`24 §4.3`) |

The rack never wrapping is a firm constraint rather than a preference: a player's arrangement encodes
their intent by position, and wrapping the row destroys that meaning.

---

## 5. Visual language

| Aspect | Decision |
|---|---|
| Table surface | A muted, low-saturation ground; tiles must be the brightest thing on screen |
| Tiles | Light face, dark glyph; ≥ 7:1 face contrast, ≥ 4.5:1 edge contrast (`24 §4.1`) |
| Typography | System sans for the interface; tile glyphs are vector artwork, not text |
| Colour | Carries no unique meaning; every state has a second channel (`24 §4.2`) |
| Depth | Slight shadow for a lifted or dragged tile only; no ambient depth |
| Motion | 120–200 ms transitions; disabled entirely under reduced-motion |

The muted surface is a functional decision, not an aesthetic one: the player looks at tiles for an
hour, and anything competing with them for attention is a cost.

---

## 6. State presentation

| State | Presentation |
|---|---|
| Own turn to draw | Wall ends highlighted; seat label carries the caret; action bar shows draw |
| Another seat's turn | That seat's label carries the caret; wall ends inert |
| Pass round open | A band across the centre showing routing and per-seat commit counts; own commitment shown in the rack |
| Correction pending | A modal band naming the proposer and the actions to be undone, with accept and reject |
| Declaration pending | A band naming the declarer; a reveal control for the declarer; accept and dispute for the others |
| Paused | A dimmed table with a banner naming the reason and the seat |
| Concluded | The outcome stated neutrally; a control to return to the lobby |
| Disconnected | A banner with reconnection progress; the table dims but stays visible |

The concluded state says "North declared Mahjong and the table accepted" — never "North won." The
distinction is the whole product (`NR-013`).

---

## 7. Design Decisions

| ID | Decision | Rationale |
|---|---|---|
| D-32-10 | Own seat always at the bottom, others in true relative position | What a table looks like from a chair; makes seat-relative reasoning correct for all four at once. |
| D-32-11 | Opponent racks render tile backs, plus a numeric count | The backs are the physical thing; the number is legible at a glance and is public anyway. |
| D-32-12 | Only the newest discard is interactive, and it is ringed | Only it is claimable; the others are on the table but out of reach. |
| D-32-13 | Both wall ends are equally presented | The system attaches no meaning to the choice. |
| D-32-14 | Nothing ever overlaps the rack | Occluding a hand mid-decision is annoying and briefly misleading. |
| D-32-15 | The rack never wraps | Position encodes the player's intent. |
| D-32-16 | A muted table surface | Tiles are looked at for an hour; competition for attention is a cost. |
| D-32-17 | The concluded state states the outcome neutrally | "Declared and accepted," never "won" (`NR-013`). |

---

## 8. Cross References

`11_Tile_Interaction_UX.md` · `24_Accessibility.md` · `Tile_Component_Spec.md` ·
`Screen_Inventory.md` · `14_Player_Privacy.md §4`

## 9. Revision History

| Version | Date | Author | Changes |
|---|---|---|---|
| 0.1 | 2026-09-02 | Design (architect role) | Initial layout specification |
