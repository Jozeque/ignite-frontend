# TENDRIL — Scenes Section UX Redesign Spec

**File under redesign:** `tendril/ui/tendril_webui.html` (the JUCE WebView UI)
**Scope:** the SYNTH view's oscillator row (`.oscrow`, lines ~32–158) — specifically the overloaded left column.
**Direction (locked 2026-06-14):** *Hybrid* — Scenes get a canvas-anchored filmstrip + Morph axis; a slim left rail holds only Gesture + Rules.
**Status:** **Phase 1 implemented** 2026-06-14 in `tendril/ui/tendril_webui.html` (UI-only, no engine change — every existing `emit()` preserved; syntax-checked + headless-render verified, no scroll). Phase 2/3 (below) pending.

**Revision 2026-06-15** (user feedback, all implemented + headless-verified):
- **Morph is a KNOB, not a slider** (user preference). Same `scene_morph` param, same WaveScan semantics (integer scene / fractional crossfade), arm LED, and `smooth|step` toggle. Step snaps via a new `quant` hook on `mkKnob`. Position readout stays in the Scenes header. (Supersedes the "horizontal slider" language in §4/§5B below.)
- **Gesture panel filled** — added a motion-display canvas (`#gestViz`, gridlined timeline + recorded-length bar + sweeping playhead; the playhead **moved off the main oscillator canvas** to here) and a **Clear gesture** button (`emit('gesture',{op:'clear'})`). Uses `gFrames` from the spectrum message.
- **FX rack is now instance-based** — Lane A & B each have a **`＋ Add`** selector (duplicates allowed: two Drives, two Filters…), every card has an **✕ remove**, lanes run in parallel. New engine contract: `routingChanged` now sends `{a:[{type,id}],b:[{type,id}]}` and **per-instance params are namespaced `base@instId`** (e.g. `fx_drive@drive_2`). Engine-provided instance ids are preserved on `init` routing.
- **Live oscilloscope** — an `output wave` scope panel (`#scope`) sits between the harmonic canvas and the Scenes bar, showing the time-domain output (makes it feel like a synth, not just a spectrum editor). Draws engine output samples if the spectrum message includes **`d.wave`** (true post-FX scope, optional Phase-2 add); otherwise **reconstructs the single-cycle waveform client-side** from the sounding spectrum (`masterArr` if the engine is feeding it, else the drawn `sceneArr`) — so it's live in preview as you draw. Throttled to ~30 fps.

---

## 1. Problem

The left `.col` of `.oscrow` (190px, `overflow-y:auto`) crams **three unrelated subsystems** plus help paragraphs into one fixed-height rail:

1. **Scenes + Morph** — 5 plain `1 2 3 4 5` buttons + a detached "Morph" knob
2. **Gesture** — Rec/Loop, frames, Amount/Rate, + a 2-line instructional paragraph
3. **Inter-harmonic Rules** — dropdown + Amount

In a fixed plugin window (`body{overflow:hidden}`) the column can't be tall enough, so blocks 2–3 fall below the fold → **scroll to reach primary controls** (the reported pain). Secondary issues: Scenes is under-built (can't see what each scene *is*), the Morph control is spatially divorced from the spectrum it morphs, and there's no visual hierarchy across the three blocks.

## 2. Research basis (why this design)

- **Scenes → canvas-anchored filmstrip + single morph axis** is the dominant pattern (Serum sub-table strip, Vital keyframe timeline — both mounted under the draw canvas), not discrete buttons + a detached knob.
- **Hydrasynth "WaveScan"** (ASM manual p.34) is the closest analog to a 5-snapshot model: one control where **integers snap to a slot, fractional values crossfade the two adjacent slots** (1.5 = halfway), with **per-slot audition**.
- **Each thumbnail renders its own spectrum** → self-labeling; editing stays on the central canvas (Vital/Harmor).
- **Smooth↔step toggle** mirrors Pigments' Morph ON/OFF. **No XY/vector pad** — clean for 4 corners only; 5 forces awkward interpolation.
- **Gesture** = Vital draw-LFO + Ableton Shaper Loop: arm on canvas, then Loop + Rate + Amount inline, with a **visible playhead** (Korg Wavestate vector-envelope style).
- **Fixed-window IA** (NN/g + flagship practice): instrument plugins never scroll; independent blocks favor spatial regrouping / segmented over accordion; **always-on paragraphs → hover tooltips / one info popover** (Ableton Info View, Serum mouseover help, Pigments lightbulb tips).

## 3. Design principles

1. **Nothing scrolls** at default window size (hard requirement).
2. **Scenes is the hero** — it earns canvas-adjacent real estate; the other two are support.
3. **Re-home by relationship:** Scenes + Morph + Gesture all act on the drawn spectrum → they belong near the canvas. Rules is a draw-assist preference → least prominent.
4. **Self-labeling over text** — thumbnails + live readouts instead of explanatory paragraphs.
5. **Preserve the message contract** — keep every existing `emit()` event; UI-first, engine changes optional/phased.
6. **Keep Morph a Stride lane** — it stays a continuous, bounded, armable param so Stride/Motion can sweep across snapshots (modulation-safe by construction, per PRD §9).

## 4. Target layout

```
 LEFT RAIL (~170px)     CENTER (canvas, widened)              RIGHT (~190px)
┌─────────────────┐ ┌──────────────────────────────────┐ ┌──────────────┐
│ GESTURE         │ │ OSCILLATOR · Harmonic Canvas      │ │ MACRO SHAPERS│
│  ● Rec   ▶ Loop │ │ ┌──────────────────────────────┐ │ │ ◦Tilt ◦Spread│
│  36 fr · 1.2s   │ │ │   ▓▒▓░▒▓  draw partials       │ │ │ ◦Skew ◦Dens  │
│  ◦ Amount       │ │ │   ·· playhead on Loop ··      │ │ │ ◦Comb        │
│  ◦ Rate         │ │ └──────────────────────────────┘ │ │ VOICE        │
│ ─────────────── │ │ SCENES                            │ │ ◦Lvl ◦Glide  │
│ RULES           │ │ [▓▓░][░▓▓][▓░▓][ + ][ + ]  ⧉  ▸  │ │ ◦Sub ◦Fold   │
│  Spread      ▾  │ │ Morph ◀─●─╎─╎─╎─╎─▶ [smooth|step] │ │ ◦Warp        │
│  ◦ Amount       │ │        1  2  3  4  5              │ │              │
└─────────────────┘ └──────────────────────────────────┘ └──────────────┘
```

**Grid:** `.oscrow{grid-template-columns: 168px 1fr 190px}` (left rail trimmed from 190 → ~168).
**Center column** (`.center`) stacks: canvas (`.wtwrap`, flex:1) → Scenes filmstrip (~46px) → Morph row (~28px). Canvas shrinks ~74px but stays the hero.

## 5. Component specs

### 5A. Scenes filmstrip (center, under canvas)
- Horizontal flex row, 5 equal cells, gap 4px, height ~46px, mounted directly below `.wtwrap` inside `.center`.
- **Each cell = a mini `<canvas>`** drawing that scene's 80-partial array as faint copper bars (reuse the bar routine at reduced scale).
  - Active/edit slot: copper border + glow (mirror `.sbtn.on`).
  - Empty slot (all zeros): dashed border + centered faint `+`.
  - Slot number 1–5 in a corner, `--ink3`, 8px.
- **Interactions:**
  - Click cell → set active, `emit('scene',{op:'select',i})` (identical to today's buttons).
  - Shift-click → `emit('scene',{op:'copy',i})` (existing) — surface a `⧉` glyph on hover with tooltip "shift-click: copy current here".
  - Hover `▸` (top-right) → audition slot (Phase 2; press-hold or click).

### 5B. Morph axis (center, under filmstrip)
- Horizontal slider spanning the filmstrip width, **tick marks aligned to the 5 cell centers**. Bound to existing param **`scene_morph`** (keep the id, the `paramChanged` emits, and the arm LED).
- **WaveScan semantics:** value 0..1 → position 1..5; integer = pure snapshot, between = equal-power crossfade of the two adjacent. Numeric readout (e.g., `2 ▸ 3 · 40%`).
- **`smooth | step` toggle** (2-segment): drives new param `scene_morph_mode` (0 smooth / 1 step). Step snaps to nearest slot (hard switch). *Optional — Phase 2; Phase 1 UI maps step to nearest-integer client-side.*
- Double-click → reset to nearest slot. Arm LED retained so Motion/Stride can sweep Morph as a lane.

### 5C. Gesture block (left rail, top)
- Relocated as-is: subhead "Gesture" + Rec/Loop buttons + frames readout + Amount/Rate knobs. **No control changes**, just moved and de-paragraphed.
- The 2-line `arminfo` paragraph (line 142) → **tooltip** on Rec: *"Record your drawing motion, then Loop to replay it. Amount = how far it bends the live spectrum · Rate = replay speed."*
- **Playhead:** when looping, draw a vertical sweep line on the main canvas at `x = gpos·W`. Needs `d.gpos` from engine (Phase 2); Phase 1 fallback = client-side approximation from Rate (pattern already used in the Motion-curve preview).

### 5D. Rules block (left rail, bottom)
- Relocated as-is: subhead + `rmodeSel` dropdown + Amount knob. Hairline divider above it.
- Optional copy nudge (open question): rename "Inter-harmonic rules" → punchier ("Neighbor" / "Draw Link").

### 5E. Help / tooltips
- Remove `arminfo` paragraphs from the rail.
- Add `title=` tooltips to: Rec, Loop, Morph, each scene cell, Rules dropdown.
- Optional `i`/lightbulb per block header toggling a one-line hint (Pigments style) — Phase 3.

## 6. Message-contract changes

| Change | Need | Phase | Fallback if deferred |
|---|---|---|---|
| `spectrum` msg adds `d.scenes: number[5][80]` (all five scene arrays) | **Required for live thumbnails** | 2 | UI caches each scene array as the user visits/edits it; unvisited slots render empty |
| `d.gpos` (0..1 gesture playback position) | Playhead accuracy | 2 | Client-side sweep approximated from Rate |
| `scene_morph_mode` param (0 smooth / 1 step) | True step morph | 2 | UI snaps to nearest integer slot |

Everything else is **unchanged**: `scene` select/copy ops, `paint`, `gesture` rec/play, `paramChanged`, `rmode`, `rules_amt`. **Phase 1 is pure HTML/CSS/JS — zero engine risk.**

## 7. No-scroll budget (sanity check)

- **Left rail @ full oscrow height (flex 1.35):** Gesture (~106px: subhead 12 + buttons 26 + frames 12 + 2 knobs 56) + divider + Rules (~92px) ≈ **~210px** in a full-height column → fits with margin. If a user shrinks the window below the threshold where both fit, fall back to a 2-segment `Gesture | Rules` toggle in the rail.
- **Center:** `.wtwrap` flex:1 (min 120) + filmstrip 46 + morph 28 → canvas stays hero, no overflow.

## 8. Implementation plan

**Phase 1 — UI only, ships immediately (no engine change):**
1. Grid: left col 190 → 168; remove `overflow-y:auto` from rail (no longer needed).
2. Delete Scenes block + Morph knob from left col (lines ~135–137, 204 entry); delete `arminfo` paragraph (142).
3. Build filmstrip + Morph slider under `.wtwrap`; wire to existing `scene`/`scene_morph` contract; client-cache scene arrays for thumbnails.
4. Convert `scene_morph` from knob → horizontal slider w/ ticks; keep arm LED.
5. Move Gesture + Rules into the slim rail; paragraphs → tooltips.
6. `smooth|step` as nearest-slot client logic; playhead as client approximation.

**Phase 2 — engine contract:** emit `d.scenes` (live thumbnails) + `d.gpos` (true playhead) + honor `scene_morph_mode` (real step); per-slot audition.

**Phase 3 — polish:** hover audition, info/lightbulb popovers, copy-affordance animation.

## 9. Acceptance criteria

- No vertical scrollbar in the SYNTH oscrow at default size (and down to min size, via the 2-segment rail fallback).
- All Scenes / Gesture / Rules controls visible at once.
- Each scene slot shows a recognizable thumbnail of its spectrum; empty slots read as empty.
- Morph drags continuously, ticks at 1–5, shows position, is armable for Motion, drives `scene_morph`.
- Gesture Rec/Loop/Amount/Rate behave as before; playhead visible during loop.
- Every existing `emit()` message preserved.

## 10. Open questions

1. Ship Phase 1 with **client-cached thumbnails** before the `d.scenes` engine change, or wait for full live thumbnails?
2. **Per-slot audition** in v1, or defer to Phase 2?
3. Keep the **smooth/step** toggle (adds one param), or always-smooth?
4. Rename **"Inter-harmonic rules"** to something punchier?
