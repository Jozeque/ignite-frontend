# Stride: Motions Library + Param Link (UX spec)

Status: **spec only, nothing built.** Date: 2026-08-17.
Interactive mockup: `docs/mockup-motions-library.html` (same file published as a private artifact, link in chat).

Two features, one data model. Part 1 is the library for saving and reloading lane curves. Part 2 is the port-and-cable link between parameters. Part 1 is pure UI + prefs. Part 2 touches engine state. They ship separately, Part 1 first.

---

## Part 1: Motions Library

### 1.1 What exists today, and why it under-delivers

The wrapper already has user curve presets (canvas.js ~9560-9772):

- Toolbar ROW 1 "Save Lane" opens a modal that demands a name, then scope (Active Lane / All Lanes).
- Saved presets render as text chips in the "Saved:" strip; overflow goes to a plain list modal.
- Storage is **localStorage only** (`PRESET_STORAGE_KEY`).

Four problems:

1. **Durability.** localStorage-only violates our own 1.1.3 rule (user data never localStorage-only), and it is the same shared-WebView storage class that produced the 1.2.x lane-lock leak. A cleared WebView cache silently deletes every preset a user ever saved.
2. **Name-first friction.** The modal interrupts the exact moment worth capturing: you just rolled a motion you love, mid-groove, and the app asks you to type. Capture must be one click; naming is a later, optional act.
3. **Recall.** A curve is remembered visually. Text chips with no preview make the library write-only in practice.
4. **Fragmentation.** Curve content lives on four surfaces: the "Shapes:" strip (generators), the factory Preset Bank modal, the "Saved:" chips, and the All Presets modal. One browser should own recall.

### 1.2 Naming

"Patterns" is taken (the MIDI Pattern Library overlay). "Shapes" is taken (the one-click generator strip). "Presets" is taken twice (factory bank, and chain presets in spirit).

**Recommendation: Motions.** It is already the brand verb (Motion tools, "Draw the motion"), it covers single-lane and multi-lane saves equally, and the strapline writes itself: *your moves, saved.* Export extension: `.stridemotion`. Fallback candidate if Motions feels crowded next to the Motion tools row: "Moves". Decision needed before build.

### 1.3 How they save: three paths, one principle

Principle: **saving never interrupts the groove.** No modal, no typing, ever, at capture time.

1. **On-lane save (primary).** Hovering a lane's label column reveals a bookmark glyph at the **top-right of the label column** (the mid-height icon zone keeps Speed / Range / Focus / Lock untouched, exact positions preserved). Click: saved instantly. Auto-name `Param · Device` ("Cutoff · Serum"); bars and date go in the meta, not the name. Toast: `Saved to Motions` with inline **Rename** and **Undo**. The glyph fills for ~2s. Rows under ~34px: glyph hidden, use path 2.
2. **Toolbar save, scope-aware.** "Save Lane" becomes **Save ▾**. Click = selected lanes if a selection exists, else the active lane (mirrors the filtered Select All mental model). The ▾ opens: Active lane / Selected lanes / All lanes. Same instant save + toast. The name-first modal is retired.
3. **From the browser.** First cell of the Mine tab is `+ Save current motion` (same smart scope).

Multi-lane saves store per-lane origin (param name + device) for smart re-apply (1.6).

### 1.4 Where they load

- **ROW 0 center**, where the rose "Presets" button sits today, becomes **Motions**. Same position, same muscle memory, opens the browser. The factory Preset Bank folds in as the **Factory** tab (Phase 2), which ends the four-surface fragmentation with zero lost content.
- The "Saved:" chip strip is retired and replaced by **Pinned**: heart a motion in the browser and it appears in the strip as a micro-sparkline chip (cap 6). One click applies it to the active lane. The strip changes meaning from "most recently saved, whatever those are" to "your go-to moves, one click away."

### 1.5 The browser: a right-side drawer, not a modal

A ~360px drawer sliding from the right, over the inject rail. Reason: **apply and preview need the lanes visible.** A centered modal (the current Preset Bank) covers the exact thing you are targeting. The drawer keeps every lane on screen, which is what makes ghost preview (below) possible.

Anatomy, top to bottom:

1. **Header:** MOTIONS + count, close ×. Search field.
2. **Tabs:** Mine / Factory / All. Filter chips: ♥ favorites, bars (4 / 8 / 16 / 32), Lane / Multi. Sort: Recent / Name / Most used.
3. **Card grid (2-up).** Each card: sparkline thumbnail rendered live from the stored points in the lane color, name, meta line (`8 bars · Lane · Serum`), heart, ⋯ menu (Rename / Export .stridemotion / Apply at native length / Delete). Multi-lane cards stack up to 3 mini-curves plus "+n".
4. **Footer:** `+ Save current` · `Import`.

Interactions:

- **Hover a card ≥150ms: ghost preview.** The curve overlays the target lane, dashed, ~50% opacity. Leaving clears it. Browsing becomes auditioning; this is the detail that makes the library feel alive.
- **Click: apply** to the active lane (or selected lanes). Undoable. Drawer stays open, so A/B between two candidates is two clicks.
- **Drag a card onto a specific lane:** applies to that lane (explicit targeting when the active lane is not the one you mean).
- Esc or outside click closes.

### 1.6 Apply semantics

- Points stay normalized (`t` 0..1, `v` 0..1, `curve`), identical to today's preset format, so **any motion fits any parameter**. The lane's own engine-owned Range does the scaling; nothing double-scales.
- Default: **fit to current loop** (today's behavior: shape stretches to Bars).
- **Apply at native length** (card ⋯ menu): sets that lane's loop boundary to the motion's native bars instead.
- Multi-lane apply: match lanes **by param + device name first**, remaining by order (fixes today's index-order fragility). Status line reports the result: `Loaded Full Kit · matched 3 of 4 lanes`.
- Locked lanes are never written (consistent with Motion tools).

### 1.7 Persistence and migration

- Store: `stride-data/motions.json` through the prefs channel, using the exact dual-write + adopt-native-on-boot pattern the synth favorites already use (shim.js `favSet` / `prefsState`). localStorage remains a warm cache only.
- **Migration:** first boot with the new build imports every existing `PRESET_STORAGE_KEY` preset into `motions.json`. Nobody loses a saved preset.
- Export / Import: one motion per `.stridemotion` JSON file through the native chooser (same flow as `.stridechain`). This quietly enables user-to-user motion packs later.
- Thumbnails render from points at draw time. No image files, no thumbnail cache.

### 1.8 Phasing

- **Phase 1:** motions.json + migration, on-lane save, Save ▾, drawer with Mine tab, ghost preview, click/drag apply, Pinned strip.
- **Phase 2:** Factory tab (Preset Bank folds in), Most used sort, import/export, multi-lane smart matching UI polish.

---

## Part 2: Link (param-to-param)

### 2.1 Verdict

**Build it.** The case:

1. The product already trained users to think cross-lane: Copy, Paste To, Shuffle, and the global Motion tools all exist because people want one move on several params. **Paste To is the static version of this feature.** Link is Paste To made live: one shape, many params, always in sync.
2. It is visually native. The inject rail already speaks patch cables and metal jacks; Link extends an existing metaphor instead of introducing one.
3. It is engine-cheap. Lanes are normalized 0..1 and each lane's engine-owned Range maps to the real parameter range, so "the exact same pattern even if their ranges are a little different" is how the engine already thinks. Link is a write-fanout, not new DSP.
4. It unlocks the classic sound-design move: cutoff rises while reverb ducks (one member inverted). Push-pull from one drawn curve.

Honest costs: the 148px label column is dense (port placement must dodge the color bar, unmap ×, and range fields); link groups must be engine-owned state (the lock-leak lesson: never localStorage); and undo / lock / shuffle interplay needs explicit rules (2.5). None of these are hard. They are rules to write down before code, which is what this section does.

### 2.2 Mental model: linked lanes are one curve shown twice

Link mirrors **everything that writes the curve**: drawing, edit sliders, tools, Motion tools, loading a motion. Generation rolls **once per group**; every member receives the same roll.

A generation-only link (mirror rolls but not edits) is rejected: lanes that look linked would drift the moment you draw, and the UI would be lying. One rule, no exceptions, easy to trust.

- **Invert** is the one per-member modifier (member receives `1 - v`). It is the modifier that earns its complexity: filter up, reverb down.
- **Lane-local stays lane-local:** Speed and per-lane loop boundary. Both at 1x (the default) = byte-identical motion, which is what the user asked for. Deliberately different speeds = phased echoes of the same move. That is a feature, and the copy should own it: *"Link shares the shape. Lane speed stays yours."*

### 2.3 The port

- **Placement:** bottom-left of the label column, as proposed. A 12px jack, center at x≈18, 6px above the row's bottom edge. The color-bar click zone (x 0..10, full height) narrows to x 0..8 beside the port. When Range is on, the min/max fields start at x=25 on the same bottom line; the port coexists to their left. Rows under 34px: port hidden (the chip, once linked, still shows and acts as the port).
- **Visual:** the exact inject-rail jack recipe (dark socket, grey collar, light center pin), 40% opacity idle, full opacity + soft lane-color halo on hover. It must read as "plug in here" with zero explanation.
- **Drag:** press the port, drag a cable (dark casing under a lane-color core, the inject-rail recipe). Compatible ports light up; the nearest port within ~14px snaps. Release on a port: linked. Click-click works too (click port, click target port); Esc cancels; releasing over empty canvas cancels. **Direction rule: the source lane's curve wins.** You grab the move you love and hand it to the other lane; the target adopts it (undoable, and the drag hover ghost-previews the adoption before you drop).

### 2.4 After linking: chips, cables on demand

Persistent cables across the lane stack would cover the curves, the one thing users are there to see. So cables are **on demand**:

- Each linked lane shows a **link chip** at the port position: filled jack + group index (L1, L2) in the group tint.
- Hover any chip (or hold **L**): the group's cables draw between ports, same rendering as the inject-rail cables. Cables also show while dragging and for ~1.2s after a link lands.
- Inverted member: chip carries a ± mark; its cable core draws dashed while visible.
- Right-click chip: Invert / Unlink this lane / Dissolve group. Alt+click chip: quick unlink.

### 2.5 Group rules

| Event | Rule |
|---|---|
| Link A→B | Group {A,B}; B adopts A's curve (source wins), one undo step |
| Link B→C later | Group extends to {A,B,C}; C adopts the group curve |
| Any member edited / tool applied | All members receive it (inverted members get `1 - v`) |
| Motion tools (all-lane) | One roll **per group**, not per lane; S&H reroll included |
| Paste To onto a member | Writes the group curve (mirrors to all) |
| Load a motion onto a member | Whole group updates (it is one curve) |
| Save a motion from a member | Saves the shared curve, nothing special |
| Locked member | Frozen: receives nothing (consistent with Motion tools skipping locked lanes); chip dims |
| Unlock a member | Re-syncs to the group curve, one undo step |
| Shuffle | A group occupies **one** shuffle slot; membership never changes |
| Unmap a member | Leaves the group; group of one dissolves |

### 2.6 Engine notes

- Link groups are **engine-owned state** (state v7, `links`: groups + per-member invert flags), exactly like locks (v5) and speed (v6). Persists with the DAW project and inside `.stridechain`. Never localStorage (lock-leak lesson).
- Per instance only; no cross-instance linking.
- Undo: group operations are single undo steps (link, adopt, roll, unlock-resync).

### 2.7 Phasing

Link ships **after** Motions (independent features; Motions derisks the drawer + save surfaces first).

- **Phase 1:** groups of 2+, invert, chips, on-demand cables, the rules table above.
- **Phase 2 candidates:** per-member depth (link strength %), per-member phase offset.

---

## Open questions for Yossi

1. Name: **Motions** or **Moves**? (Mockup says Motions.)
2. Factory Preset Bank folding into the browser as the Factory tab: Phase 2, or keep it separate forever?
3. Pinned strip cap (6?) and behavior under the collapsed-toolbar mode.
4. Port on short rows: hidden (spec'd) or always visible with the speed glyph yielding?
