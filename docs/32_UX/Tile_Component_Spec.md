# Tile Component Specification

| | |
|---|---|
| **Project** | American Mahjong Dealer |
| **Document** | 32_UX/Tile_Component_Spec.md |
| **Status** | Detail for ratified chapters — Ch. 11 and Ch. 24 remain authoritative |
| **Last Updated** | 2026-09-02 |
| **Role in SSOT** | Owns the tile component: dimensions, rendering, states, and accessible semantics. Does **not** own interaction gestures (`11`), layout (`Table_Layout_and_Perspective.md`), or the tile model (`07`). |

---

## 1. The component's one hard rule

> **A tile component renders a face only when its seat view supplied one.**

The component receives either `{ handle, face }` or `{ handle }`. Given a bare handle, it renders a
back. There is no code path in which it could obtain a face it was not given — no lookup table, no
inference from position, no cache from a previous game (`07 §5.3`).

This makes the client incapable of displaying a tile it was not told about, which is the last line
behind the projector (`14 §5`).

---

## 2. Dimensions

| Property | Value | Basis |
|---|---|---|
| Aspect ratio | 3:4 | Approximates a physical American Mahjong tile |
| Default height | 72 px | Comfortable at typical viewing distance |
| **Minimum height** | **56 px** | `24 §4.1` legibility floor |
| Minimum interactive area | 44 × 44 px | `24 §7` motor accessibility |
| Corner radius | 4 px at default height, scaling proportionally | |
| Face inset | 8% of height | Margin so the glyph is not crowded by the edge |
| Rack spacing | 2 px between adjacent tiles | Distinct without wasting width |
| Gap width | One tile width | A player's gap must read as a gap (`11 §6.2`) |

A tile scales between 56 px and 96 px depending on available width and hand size. Below 56 px the
rack scrolls rather than shrinking further.

---

## 3. Rendering

| Layer | Content |
|---|---|
| Body | Light face colour, subtle vertical gradient suggesting a bevel |
| Edge | 1 px border, ≥ 4.5:1 against the table surface |
| Face | Vector glyph, ≥ 7:1 against the body |
| Back | A uniform pattern, clearly distinct from any face, no gradient |

### 3.1 Faces

| Group | Rendering |
|---|---|
| Dots | 1–9 circles in the traditional arrangement |
| Bams | 1–9 bamboo glyphs; the 1 Bam is its traditional bird |
| Craks | The traditional character plus its numeral |
| Winds | E / S / W / N as a large single glyph |
| Dragons | **A distinct glyph per dragon, not merely a colour** |
| Flowers | Eight distinct flower illustrations (`07 §3.2`) |
| Joker | A distinct glyph unlike any suit or honour tile |

### 3.2 Dragons must differ by glyph

Red and green dragons distinguished only by colour are indistinguishable to a player with
red-green colour blindness, which affects roughly 8% of men — and the player population for this
game skews older, where acquired colour vision changes are also common.

So each dragon carries a distinct glyph shape, and colour is a redundant secondary channel. The
same principle applies to the soap: it is a distinct glyph, not an empty tile, so it cannot be
confused with a blank or a rendering failure (`D-24-09`).

### 3.3 Vector rendering

Faces are vector artwork so they stay crisp from 56 px to 96 px and at 300% browser zoom. Raster
faces would need multiple assets and would still soften at the zoom levels `24 §4.3` requires.

---

## 4. States

| State | Presentation | Class |
|---|---|---|
| `idle` | Base rendering | — |
| `hover` | Full opacity, 2 px lift | Free |
| `focus` | 2 px focus ring, offset, ≥ 3:1 | — |
| `pressed` | 1 px depression | Free |
| `selected` | 4 px raise, persistent 2 px outline | Free |
| `dragging` | Scale 1.06, shadow, follows the pointer; origin shows a gap | Free |
| `settling` | 140 ms spring into position | Free |
| `returning` | 120 ms return to origin | Free |
| `pending` | 60% opacity plus a small spinner | Binding |
| `armed` | Outline plus the action verb adjacent | Binding |
| `inert` | Base rendering, no pointer response | — |
| `back` | Back pattern; no face | — |

Every state combines at least two channels — position, opacity, outline, or shape — so none depends
on colour alone (`24 §4.2`).

### 4.1 `armed` is a first-class state

The armed state exists because binding acts are two-step (`11 §5.2`, `24 §5.3`). It shows the tile
outlined with the pending verb beside it — "Discard" — and it is announced to assistive technology.

It is the component's contribution to preventing accidental discards: a player can see, before
confirming, exactly which tile and exactly what action.

### 4.2 `inert` for older discards

Discards other than the current one render normally but do not respond to a pointer and are not
focusable (`D-32-12`). They are visible because players remember the pile; they are inert because
only the current discard is claimable.

---

## 5. Accessible semantics

| Property | Value |
|---|---|
| Role | `button` when interactive; `img` with a label when inert |
| Accessible name | `"Five of dots"` |
| Position context | `"position 3 of 13"` in the rack; `"discard 7"` in the pile |
| A back | `"Concealed tile"` |
| State | Communicated via `aria-pressed` for selection and `aria-disabled` for inert |
| Armed state | Announced: `"Discard five of dots — press Enter to confirm"` |

Names are **descriptive, never interpretive**. `"Five of dots"` — never `"five of dots, you have two
more"` (`D-24-04`, `NR-203`). A screen-reader user gets the same information a sighted player gets,
and no more.

---

## 6. Motion

| Transition | Duration | Easing |
|---|---|---|
| Hover in / out | 80 ms | ease-out |
| Press | 40 ms | linear |
| Select / deselect | 100 ms | ease-out |
| Drag lift | 100 ms | ease-out |
| Settle | 140 ms | spring, minimal overshoot |
| Return | 120 ms | ease-in-out |
| Another seat's tile moving | 200 ms | ease-in-out |

Under `prefers-reduced-motion` every duration becomes 0 ms. State changes still occur and are still
visible — only the interpolation is removed (`24 §8`).

Another seat's tile animates over 200 ms rather than appearing instantly because the movement is
information: seeing a tile travel from a rack to the discard pile communicates who discarded without
reading a label.

---

## 7. Design Decisions

| ID | Decision | Rationale |
|---|---|---|
| D-32-20 | The component renders a face only when supplied one | Makes the client incapable of showing a tile it was not told about. |
| D-32-21 | 56 px minimum height; scroll rather than shrink further | Below this, faces are not legible for the player population. |
| D-32-22 | Each dragon has a distinct glyph, colour redundant | Colour-only dragons are indistinguishable to ~8% of men. |
| D-32-23 | The soap is a distinct glyph, not a blank | Prevents confusion with a rendering failure. |
| D-32-24 | Vector faces | Crisp from 56 px to 300% zoom without multiple assets. |
| D-32-25 | `armed` is a first-class state with the verb shown | The component's contribution to preventing accidental discards. |
| D-32-26 | Older discards are `inert` but fully rendered | Visible because remembered; inert because unclaimable. |
| D-32-27 | Every state uses at least two channels | No state depends on colour alone. |
| D-32-28 | Another seat's tile movement animates | The movement itself is information. |
| D-32-29 | Accessible names describe, never interpret | Parity of information, not of assistance. |

---

## 8. Cross References

`07_Tile_Model.md` · `11_Tile_Interaction_UX.md` · `24_Accessibility.md` ·
`Table_Layout_and_Perspective.md` · `14_Player_Privacy.md`

## 9. Revision History

| Version | Date | Author | Changes |
|---|---|---|---|
| 0.1 | 2026-09-02 | Design (architect role) | Initial component specification |
