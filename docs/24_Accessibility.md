# 24 — Accessibility

| | |
|---|---|
| **Project** | American Mahjong Dealer |
| **Document** | 24_Accessibility.md |
| **Status** | Ratified v0.1 — approved by the project owner, 2026-09-02 |
| **Last Updated** | 2026-09-02 |
| **Role in SSOT** | Owns the accessibility requirements: keyboard model, screen-reader semantics, contrast, motion, and zoom. Does **not** own tile interaction design (`11`), visual specification (`32_UX/`), or performance (`23`). |

---

## 1. Executive Summary

American Mahjong is played disproportionately by older adults, often in groups that have been playing
together for decades. Presbyopia, reduced fine motor control, and tremor are ordinary in that
population, not edge cases. Accessibility here is a core requirement rather than a compliance
exercise, and the target is **WCAG 2.2 AA** with several deliberate exceedances where the game's
demographics warrant it.

Two decisions have shaped the design more than the rest.

**Rendering is DOM-first** (`ADR-0015`). A canvas would have to reimplement focus management,
accessible names, text scaling, and high-contrast handling, and every one of those
reimplementations would be worse than the platform's. Choosing the DOM gets them largely for free.

**Full keyboard parity is required** (`NFR-050`) — every action available by pointer is available by
keyboard. This was adopted as an accessibility requirement and turned out to improve the interaction
design for everyone: forcing every action to have an unambiguous name and target is what produced
the arm-and-confirm pattern that also protects against accidental discards (`11 §11`).

There is one thing accessibility must not do here: **assist**. An accessible interface describes what
is present; it does not interpret. A screen reader announces "five of dots"; it never announces "five
of dots, matches two in your hand" (`NR-203`).

---

## 2. Objectives

Serves `OBJ-01` (a player who can play at a physical table can play here) and `OBJ-03` (interaction
that recedes), for players using assistive technology or with reduced vision or motor control.

---

## 3. Standard and exceedances

Target: **WCAG 2.2 Level AA**. Where the game's demographics warrant more, the requirement exceeds
it:

| Aspect | WCAG AA | Here | Why |
|---|---|---|---|
| Text contrast | 4.5:1 | **7:1** for tile faces and table text | Tile faces are dense small glyphs read for an hour at a stretch |
| Non-text contrast | 3:1 | **4.5:1** for tile borders, drop zones, focus rings | These carry the interaction's meaning |
| Target size | 24×24 CSS px | **44×44** minimum for every interactive element | Reduced fine motor control is common in the player population |
| Zoom | 200% without loss | **300%** without loss of function | Presbyopia |
| Focus visibility | Visible | **3:1 against adjacent colours, 2 px minimum, never colour alone** | Keyboard players must never hunt for focus |

---

## 4. Vision

### 4.1 Tile legibility

| Requirement | Value |
|---|---|
| Minimum rendered tile height | 56 px at default zoom |
| Face contrast against the tile | ≥ 7:1 |
| Tile edge contrast against the table | ≥ 4.5:1 |
| Suit distinction | **Shape and glyph, never colour alone** |
| Scaling | Tiles scale with browser text size and zoom |
| Face rendering | Vector, so scaling stays crisp |

Suit distinction not relying on colour matters specifically because red-green colour blindness
affects roughly 8% of men, and red and green dragons are exactly the pair such a player cannot
distinguish. The design carries a distinct glyph for each.

### 4.2 Colour independence

Nothing is conveyed by colour alone. Each state carries a second channel:

| State | Colour | Second channel |
|---|---|---|
| Selected tile | Outline tint | 4 px raise and a persistent border |
| Focused element | Focus ring | 2 px ring plus offset |
| Active drop zone | Fill tint | Dashed border and a text label |
| Turn indicator | Seat highlight | A caret and a text label |
| Connection state | Status colour | An icon and a text label |
| Pending action | Dimming | A spinner and text |

### 4.3 Zoom and reflow

At 300%: the rack scales down to its floor then scrolls horizontally (never wraps — a wrapped rack
loses the positional meaning of a player's arrangement); the table view scales proportionally; and
controls reflow to a single column. No horizontal page scrolling at any zoom level.

---

## 5. Keyboard

Full parity is required (`NFR-050`). Tile-specific bindings are in `11 §11`; this is the whole model.

### 5.1 Regions

`Tab` moves between regions; arrow keys move within one. Regions: rack, table centre, discard pile,
each opponent seat, action bar, chat, dialogs.

Region navigation rather than a flat tab order matters because a rack of twenty tiles would otherwise
require twenty `Tab` presses to leave.

### 5.2 Bindings

| Key | Action |
|---|---|
| `Tab` / `Shift+Tab` | Next / previous region |
| `←` `→` | Move within the current region |
| `Home` / `End` | First / last item |
| `Space` | Toggle selection |
| `Shift` + `←` `→` | Extend selection |
| `Alt` + `←` `→` | Move the focused tile within the rack — a free act |
| `D` | Arm discard of the focused tile |
| `E` | Arm exposure of the selection |
| `W` then `H` / `T` | Arm a wall draw from head / tail |
| `C` | Arm a claim of the current discard |
| `Enter` | Confirm the armed action |
| `Escape` | Cancel anything armed, selected, or dragging |
| `?` | Keyboard help |
| `M` | Focus chat |
| `1`–`4` | Focus a seat |

### 5.3 Arm and confirm

Every binding act is armed, then confirmed by `Enter`. This mirrors the pointer's two-step
requirement (`11 §5.2`) — parity of *safety*, not merely of capability. A keyboard player must not
be one keystroke from an irreversible discard when a pointer player is two deliberate gestures away.

The armed state is announced and shown visually: "Discard five of dots — press Enter to confirm."

### 5.4 No keyboard traps

Every region is exitable by `Tab` and `Escape`. Dialogs trap focus while open and restore it to the
triggering element on close.

---

## 6. Screen readers

### 6.1 Structure

The table is a landmark region containing labelled regions for the rack, discard pile, and each seat.
Headings are hierarchical and skip nothing.

### 6.2 Names

| Element | Accessible name |
|---|---|
| A tile in the rack | "Five of dots, position 3 of 13" |
| A discarded tile | "Five of dots, discard 7" |
| An exposure | "South's exposure: five of dots, five of dots, five of bams" |
| A wall end | "Wall, head end, 42 tiles remaining" |
| A seat | "East, Kim, connected, ready, 13 tiles" |
| The turn indicator | "South's turn to draw" |

Names are **descriptive, never interpretive**. "Five of dots" — never "five of dots, you have two
more" (`NR-203`, `NR-205`). This is the boundary that matters most in this chapter, and it is the
same boundary the whole system observes: describe what is present, interpret nothing.

### 6.3 Live announcements

| Event | Politeness | Announcement |
|---|---|---|
| Another seat's action | polite | "West discarded three of bams" |
| Turn change | polite | "Your turn to draw" |
| Own action acknowledged | polite | "Discarded five of dots" |
| Own action rejected | **assertive** | "You don't have that tile" |
| Seat disconnected | assertive | "South disconnected — the table is paused" |
| Seat reconnected | polite | "South reconnected — resumed" |
| Correction proposed | **assertive** | "East proposes undoing the last two actions" |
| Declaration | **assertive** | "North declared Mahjong" |
| Chat | polite | "Kim: your turn I think" |
| Signal | polite | "South knocked" |

Assertive is reserved for events requiring a response or interrupting play. Everything else is polite,
because a table generates a steady stream of actions and interrupting on each would make the
interface unusable with a screen reader.

### 6.4 Reading own hand

`R` reads the rack in order. Because the order is the player's own and is never changed by the system
(`NR-304`), the reading is stable between actions — which is what makes a screen reader usable here at
all. A system that re-sorted the rack would make every reading different from the last.

---

## 7. Motor accessibility

| Requirement | Value |
|---|---|
| Minimum target | 44×44 CSS px |
| Spacing between binding targets | ≥ 8 px |
| Drag threshold | 6 px, and a click-based alternative always exists |
| No timing requirement | **No action anywhere requires speed** (`NR-210`) |
| No double-click | Excluded entirely (`D-11-03`) |
| No sustained hold | No action requires holding a button |
| No multi-pointer gesture | No pinch or two-finger requirement |
| Tremor tolerance | Click suppressed after a 6 px drag, so a shaky click is still a click |

The absence of any timing requirement is worth naming as an accessibility property. Because nothing
in this system acts on a timer (`NR-210`), a player who needs a minute to decide is never
disadvantaged — which is not true of most games and is a direct consequence of the no-automation
requirement.

---

## 8. Motion

| Preference | Behaviour |
|---|---|
| `prefers-reduced-motion` | Tile movements become instant; no springs, no easing, no incidental animation |
| Always | No flashing, no strobing, no parallax |
| Always | No animation is required to understand state — every animated transition also has a static representation |

Reduced motion changes only *how* a change is presented, never *whether* it is presented
(`NFR-053`).

---

## 9. Verification

| Aspect | Method | Case |
|---|---|---|
| Keyboard parity | Every E2E scenario executed keyboard-only | `TC-X01` |
| Contrast | Automated audit plus manual check of tile faces on the table surface | `TC-X03` |
| Screen reader | Manual walkthrough with two screen readers on two platforms | `TC-X04` |
| Zoom | Automated viewport tests at 200% and 300% | `TC-X05` |
| Reduced motion | Automated assertion that no transition exceeds 0 ms | `TC-X02` |
| Target size | Automated measurement of every interactive element | `TC-X06` |
| Colour independence | Grayscale rendering of every state | `TC-X07` |
| Axe audit | Every screen, zero violations | `TC-X08` |

Manual screen-reader testing is required rather than optional: automated tools verify that names
exist, not that they are comprehensible.

---

## 10. Design Decisions

| ID | Decision | Rationale |
|---|---|---|
| D-24-01 | DOM-first rendering | Focus, names, text scaling, and high-contrast come from the platform; a canvas would reimplement all four, worse. |
| D-24-02 | Exceed AA where demographics warrant | The player population skews older; presbyopia and reduced fine motor control are ordinary here. |
| D-24-03 | Full keyboard parity, including arm-and-confirm | Parity of safety, not just capability. It also produced the pointer design (`11 §11`). |
| D-24-04 | Accessible names describe, never interpret | The same boundary the whole system observes (`NR-203`). |
| D-24-05 | Region-based navigation | A flat tab order would take twenty presses to leave a rack. |
| D-24-06 | Assertive announcements reserved for events needing a response | A table generates constant actions; interrupting on each is unusable. |
| D-24-07 | The rack never wraps at high zoom | Wrapping destroys the positional meaning of a player's arrangement. |
| D-24-08 | 44 px targets, exceeding the AA minimum | Reduced fine motor control is common in the player population. |
| D-24-09 | Shape and glyph distinguish suits, never colour | Red and green dragons are exactly the pair a colour-blind player cannot distinguish. |
| D-24-10 | Manual screen-reader testing is required | Automation verifies names exist, not that they make sense. |
| D-24-11 | Name the absence of timing requirements as an accessibility property | It follows from `NR-210` and is a genuine advantage worth recording. |

---

## 11. Alternative Designs

| Alternative | Why rejected |
|---|---|
| Canvas rendering with an accessibility layer | A parallel implementation of what the DOM already provides, and it drifts. |
| AA compliance without exceedance | Technically sufficient, materially inadequate for this player population. |
| Keyboard shortcuts without arm-and-confirm | Would make a keyboard player one keystroke from an irreversible discard. |
| A separate accessible mode | Two interfaces, one of which receives less testing. |
| Announcing every event assertively | Unusable — a table generates a constant stream. |
| Colour-only suit distinction | Excludes colour-blind players from telling two dragons apart. |
| Wrapping the rack at high zoom | Destroys positional meaning. |
| Interpretive announcements as an accessibility accommodation | Would be assistance (`NR-203`), and would give screen-reader users information sighted players do not have. |

---

## 12. Trade-offs

**7:1 contrast and 44 px targets constrain the visual design.** Accepted: legibility over elegance
for a game read for an hour at a time.

**Keyboard parity constrains the interaction design.** Accepted, and it improved it.

**Non-interpretive announcements mean a screen-reader user must hold more in memory.** Accepted, and
unavoidable: interpreting would be assistance, and it would give one group of players an advantage.
The stable rack order (`§6.4`) is the mitigation.

**Manual screen-reader testing cannot be automated in CI.** Accepted: it is a release-gate activity
rather than a per-commit one.

---

## 13. Risks

| Risk | Mitigation |
|---|---|
| Keyboard parity erodes as features are added | `NFR-050`; keyboard-only E2E traversal on every scenario (`TC-X01`) |
| Contrast regresses with a visual refresh | Automated audit in CI (`TC-X03`) |
| An announcement becomes interpretive | `D-24-04`; reviewed against `NR-203` in the definition of done |
| Reduced motion is missed on a new animation | Automated assertion that transitions are 0 ms under the preference (`TC-X02`) |
| Tile faces are legible in isolation but not on the table | Manual check specifically of faces against the table surface |

---

## 14. Future Considerations

Not committed: a high-contrast tile theme beyond the 7:1 baseline; adjustable tile size independent
of browser zoom; a configurable drag threshold for tremor; audio cues for turn changes as an option.

---

## 15. Cross References

| Document | Focus |
|---|---|
| `11_Tile_Interaction_UX.md` | Interaction design and keyboard bindings |
| `32_UX/Tile_Component_Spec.md` | Tile rendering and contrast |
| `32_UX/Table_Layout_and_Perspective.md` | Layout and reflow |
| `01_Product_Requirements.md §6.6` | `NFR-050`–`NFR-053` |
| `SCOPE_BOUNDARIES.md §4.3` | `NR-203`, `NR-205` — why announcements do not interpret |
| `ADR-0015` | DOM-first rendering |

---

## 16. Revision History

| Version | Date | Author | Changes |
|---|---|---|---|
| 0.1 | 2026-09-02 | Design (architect role), owner-approved | Initial chapter |
