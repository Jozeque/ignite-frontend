# Stride 1.1.11 — Features & Adjustments Spec

**Status:** DRAFT v2 — updated after Yossi's review (palette count, color UX, ×2 labels + mockups,
undo/redo icons, floor/ceiling mechanics). Nothing built yet. Spec → approve → build.
**Train base:** `a60c1e2` (1.1.10 — Mac keyboard fix, CI green both platforms, field-validated).
**Also queued for this train (not specced here):** license-gate self-heal (Bojan case, specced
2026-07-23) · Bitwig-Mac crash fix if Sylvain's `.ips` names one · LS swap (store serves 1.1.7).

All features live in shared `stride-vst/app/renderer/canvas.js` (wrapper embeds it — rebuild to
see changes) except: F1 touches the wrapper engine (C++), F4 touches both `index.html` files.

---

## F1 — Per-lane colors

### Today
`sdLaneRGB(paramIdx)` (canvas.js:428): the Patch skin's 5-color array indexed by **lane
position** (`paramIdx % 5`); every other skin = one accent for all lanes. Positional (unmap
shifts every color below), no user control.

### Palette — 12 swatches
FACT: the patchbay palette is **5** colors, not 6 — `198,113,43` (burnt orange), `47,116,142`
(petrol), `91,123,85` (moss), `163,78,82` (brick), `84,75,109` (dusk violet). Requirement said
"patchbay ×2 = 12 total"; resolved as **12 = the 5 existing patch hues + 7 new**, curated for
distinctness on the dark canvas at the renderer's alphas (0.08 fill / 0.30–0.95 stroke):

| # | Source | RGB | Name |
|---|--------|-----|------|
| 1–5 | existing patch | (the 5 above) | — |
| 6 | new | `227,169,64`  | amber |
| 7 | new | `196,90,172`  | fuchsia |
| 8 | new | `72,182,164`  | teal |
| 9 | new | `126,166,232` | sky |
| 10 | new | `164,196,84` | lime |
| 11 | new | `214,120,96` | coral |
| 12 | new | `226,226,232`| bone (white-ish) |

Exact values tunable at build time against all 6 skins; the CONTRACT is: 12 fixed swatches,
first 5 identical to the patch rotation so AUTO colors are "pinnable" as-is. Patch skin itself
stays 5-wide — existing projects' auto-colors don't shift.

### UX (per Yossi)
- **Left-click** the lane's color target opens a small popup with the 12 swatches + AUTO chip.
- **Paint one or paint few:** if the clicked lane is part of the current selection, the chosen
  color applies to EVERY selected (unlocked) lane; no selection → just that lane. Popup closes
  on pick; canvas repaints.
- The color target is the lane's color bar/dot in the header (see F2 mockups — M3 makes the
  whole left color bar the click target; M1/M2 use the dot).
- **Invariant (acceptance test):** applying ANY motion tool (templates, Mutate, Bloom, Storm,
  Smooth, Stretch…), re-pushes, rescans, project reopen — the lane keeps its set color. Colors
  may only change via the popup or unmap.

### Persistence
- **Desktop:** `colorIdx` rides the lane object in per-rack canvas state, keyed by `_path`.
- **Wrapper: ENGINE-OWNED (non-negotiable).** `wrap:<i>` paths are positional and every
  `rack_scanned` re-push rebuilds lanes — client-only colors would wipe/misroute (the 1.1.5
  ranges lesson, field report 2026-07-16). Carbon copy of the range pattern:
  `MapRef` gains `int8 colorIdx = -1` · `set_color {id, c}` message · `rack_scanned` echoes it ·
  state schema v2→v3 (old projects load as AUTO) · unmap/move carry it inside MapRef for free.
- Engine writes respect `isEditLocked()` like ranges (one code path, no cosmetic exception).

### Touched / estimate
canvas.js (sdLaneRGB override, popup, paint-selection), PluginEditor.cpp (set_color + echo),
PluginProcessor.h/.cpp (MapRef + state v3). **1–2 days.** The motion-tool invariant is free by
construction (colors live outside `points`), but the acceptance test stays in the checklist.

---

## F2 — Device + parameter names ×2 (lane header redesign)

### Today (canvas.js:3636–3662)
Device `bold 10px` / param `9px` stacked at `midY−8`/`midY+6`; lock/range icons right of the
label zone; pts counter `10px`. ×2 target: device ~20px, param ~18px — at those sizes the
current layout collides, so the header box gets redesigned ("make the space useful").

### Three mockups (pick one)

**M1 — Stacked Bold** (closest to today, both lines big):
```
┌──────────────────────────────────────┐
│ ● SERUM 2                            │  ← device, bold 18px CAPS, truncates
│   WT POS A                 🔒 24 pts │  ← param 16px; meta right-aligned 9px
└──────────────────────────────────────┘
```
+ Familiar. − Device (the less useful line) gets top billing; needs ~44px lane height.

**M2 — Single Line, param dominant** (best for short lanes):
```
┌──────────────────────────────────────┐
│ ● [SRM2] WT POS A          🔒 24 pts │  ← param bold 18px; device 4-char chip 10px dim
└──────────────────────────────────────┘
```
+ Works at every lane height, one rule everywhere. − Device abbreviations can collide
(SRM2/SRM2…) with two instances of the same synth.

**M3 — Param-First Flip + color bar** (RECOMMENDED):
```
┌──────────────────────────────────────┐
│▌ WT POS A                            │  ← param bold 18px (what you're hunting for)
│▌ Serum 2 · 24 pts · 🔒               │  ← device+meta consolidated, 10px dim
└──────────────────────────────────────┘
```
`▌` = 3–4px full-height color bar in the lane's color — doubles as F1's always-visible color
identity AND the left-click paint target (fat, unmissable). Param name first because that's
what users scan for; device demoted to metadata where it belongs.

**Adaptive rule (applies to whichever wins):** lanes shorter than ~30px collapse to the M2
single-line form automatically — big text never clips.

### Touched / estimate
canvas.js render block only. **~2h including visual pass** at compact wrapper width (680px),
long names ("Arturia Delay Eternity: Feedback Amount"), 1-lane and 12-lane layouts.

---

## F3 — Triplet grid lock (motion tools follow it)

*(unchanged from v1 except: swing decision resolved = disabled under lock)*

- Grid ladder + triplet flag + snap + visual grid ALREADY SHIPPED (canvas.js:85–190), hidden
  behind Ctrl+1/2/3/5, unpersisted; `sdGridToggleAdaptive` clears triplet.
- Naming: "1/3, 1/6, 1/12" = `1/2T, 1/4T, 1/8T`; next rung `1/16T` (=1/24 bar). Existing ×2/3
  math covers the whole series — no new math.
- Design: visible `T` pill next to the BARS pills (lit = locked; Ctrl+3 stays as shortcut) ·
  persisted per rack/project in canvas state · triplet lock forces fixed grid (seeds from
  adaptive) · `sdMotionStep(s) = s × (locked ? 2/3 : 1)` threaded through `sine`/`glitch`/
  gate/syncopated/pump/groove template steps · Chaos/Mutate RATES filtered to the triplet
  family {2, 1, 4/6, 2/6, 1/6} under lock · **Swing disabled under lock** (tooltip: "Swing is a
  straight-grid feel") · Mirror/Flip/Smooth/Intensity/Curve/Stretch/Bloom untouched ·
  `sdQuantizeLane` stays orphaned.
- Drawing already snaps to triplets when the flag is on — ships free.
- **Half a day** + music-check pass (every template at 1/8T against a Live triplet groove).

---

## F4 — Undo / Redo toolbar icons  *(new)*

**Why:** field feedback — users don't know Ctrl+Z/Ctrl+Y exist; the canvas looks like a
one-way street.

**Design:** two small icon buttons `↶` `↷` at the LEFT edge of the motion-tools row (before
PEAKS/MIRROR), tooltips "Undo (Ctrl+Z)" / "Redo (Ctrl+Y / Ctrl+Shift+Z)". Wire directly to the
existing `sdUndo()` / `sdRedo()`. Same ghost-button styling as neighbors. Always enabled in v1
(no-op on empty stack — matching the shortcuts' behavior); stack-aware greying is a later nicety.

**Touched:** BOTH markup files — `stride-vst/app/renderer/index.html` (desktop toolbar) and
`stride-wrapper/m0-spike/ui/index.html` (compact toolbar) — plus wrapper rebuild. canvas.js
untouched. **~1h.**

---

## F5 — Floor/Ceiling: honest stateful mechanics  *(new — bug fix by redesign)*

### The bug (verified in code, canvas.js:5290–5390)
Floor/Ceiling BAKE into the points via a snapshot keyed by the target-lane set. On selection
change: snapshot discarded + sliders force-reset to 0/100 (`sdResetSliderSnapshots`) — but the
points keep the old compression. Repro (Yossi's): Select All → floor up to 30% → select one
lane → its slider reads 0% while the curve's real floor is 30% → dragging "down" from 0 is
impossible. The transform is a stateful dial with baseline amnesia.

### Design — continuous rebase (recommended)
Key insight: the transform `v' = floor + v × (ceil − floor)` is LINEAR AND INVERTIBLE (its
output can't leave [0,1], so the clamp never destroys information). Therefore the dial can
always "pick up where the lane actually is":

1. On target-set change, DON'T reset floor/ceil to 0/100. Instead **detect the new target's
   actual bounds**: `floorInit = min(values)`, `ceilInit = max(values)`; set the sliders there.
2. Snapshot stores the points **normalized** through those bounds:
   `norm = (v − floorInit) / (ceilInit − floorInit)`.
3. Dragging maps the normalized baseline through the CURRENT slider values — so floor can go
   DOWN below the inherited 30% (expanding the shape back toward 0), up, anywhere, losslessly.
4. Multi-select: init from min-of-mins / max-of-maxes; per-lane normalized baselines; the dial
   writes the same absolute bounds to all targets (matches today's select-all semantics).

Edge cases:
- **Flat lane** (`max − min < 0.01`): normalized baseline = flat 0.5; dragging bounds moves the
  flatline inside [floor,ceil] — defined, no divide-by-zero.
- **Undo:** first touch per snapshot still `pushUndo()` (unchanged).
- **Deliberate partial shapes:** a curve drawn between 0.2–0.7 now shows floor 20 / ceil 70 on
  selection — TRUE information, and pulling floor to 0 expands it to touch 0, which is exactly
  what "floor at 0" means. This is the intended semantic, worth one line in the changelog.
- Smooth/Intensity/Curve keep their existing reset behavior — only floor/ceil rebase (they're
  the only bounds-dials).

**Touched:** canvas.js only (`_ensureFloorCeilSnapshot`, `_applyFloorCeil`,
`sdResetSliderSnapshots` floor/ceil branch, slider init on target change — sidebar `sd-*` AND
compact `qpc-*` strips). **Half a day incl. the multi-select matrix test.**

---

## Decisions

| # | Question | Status |
|---|----------|--------|
| 1 | Palette = 12 (5 patch + 7 new), Patch skin untouched | **resolved** (flagged: patch is 5, not 6) |
| 2 | Color UX: left-click popup, paints selection-or-one | **resolved** (Yossi) |
| 3 | Motion tools must never touch colors | **resolved** (invariant + test) |
| 4 | Swing under triplet lock: disabled + tooltip | **resolved** (recommendation stands) |
| 5 | Triplet persistence: per project | **resolved** (recommendation stands) |
| 6 | F2 mockup: **M3 — Param-first + color bar** | **resolved** (Yossi, 2026-07-26) |
| 7 | Build order: F2 → F4 → F5 → F3 → F1 (cheap→expensive; F1 has the only state-schema change, lands with max soak before LS swap) | proposed |

M3 consequence, locked in: the color bar IS the F1 click target (one gesture, no separate dot),
and the F2 header ships with a neutral bar until F1 lands (bar shows the AUTO color from day one
— sdLaneRGB already provides it, so nothing looks unfinished mid-train).
