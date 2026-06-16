# STRIDE — UI Spec (Designer Handoff)

**Companion file:** `stride-ui-mockup.html` (open in any browser — static, not interactive).
**Product:** STRIDE — a **Sound Design Engine for Ableton Live**. A desktop app (Electron) where electronic-music producers load their own instrument racks, draw dynamic automation curves on a visual canvas, and apply them to clips.

> **Hard copy rule for any text you add:** This is **NOT** an "AI tool." Never mention AI, ML, or "generate music." Lead with *sound design*; MIDI is secondary. Producer language only: racks, patches, automation, Live, clips, bars, grooves. Confident, no hype.

What I want from you: this is a **reskin brief**, not a blank canvas. The layout, regions, tokens, sizes and tool inventory below are **fixed ground truth — match them.** Bring your craft to the *surface* (exact hues, gradients, weights, micro-spacing, iconography, motion polish) while keeping every element, its position, and its meaning intact. Where I genuinely want your judgment it's marked **[your call]**; everything else should map 1:1 to what's described.

---

## 1. Design tokens

### Color
| Role | Hex | Tailwind |
|------|-----|----------|
| App background (near-black) | `#09090b` | `zinc-950` |
| Panel / card surface | `#18181b` | `zinc-900` |
| Raised surface | `#27272a` | `zinc-800` |
| Primary text | `#e4e4e7` | `zinc-200` |
| Muted label | `#71717a` | `zinc-500/600` |
| **Brand gradient** (wordmark, CTAs) | `#f97316 → #ef4444` | orange-500 → red-600 |
| Accent — fuchsia (primary action / active) | `#e879f9` | fuchsia-400 |
| Accent — emerald (apply / commit / connected) | `#10b981` | emerald-500 |
| Sky (mirror / flip / stretch) | `#38bdf8` | sky-400 |
| Violet (copy / paste / shuffle) | `#a78bfa` | violet-400 |
| Amber (swing / lock) | `#fbbf24` | amber-400 |
| Cyan (Chaos) | `#06b6d4` | cyan-400 |
| Lime (Sample & Hold / success flash) | `#84cc16` | lime-500 |
| Rose (Presets) | `#f43f5e` | rose-400 |
| LED ring (fresh generation) | `#facc15 → #a3e635` | yellow → lime conic |

**The color system is functional, not decorative:** every tool *family* owns a hue. Producers learn "sky = symmetry ops, violet = clipboard ops, emerald = commit." Keep that mapping if you re-skin. Surfaces are flat near-black; color only appears on interactive/active elements (tints at 5–20% opacity, full saturation on hover/active).

### Typography
- **Font:** Outfit (Google Fonts), weights 300/400/500/700/**900**.
- UI is tiny and dense by design: labels are **9–11px**, `font-black` (900), `UPPERCASE`, wide tracking (`0.1–0.3em`).
- Titles/headlines use the brand gradient on `font-black`.
- Numeric readouts use a monospace fallback.

### Shape & spacing
- Radii: `rounded` (6px) buttons, `rounded-lg` (8px) inputs/cards, `rounded-xl/2xl` modals.
- Borders: `1px white/5–10%` hairlines everywhere; colored borders at 20–50% for accented buttons.
- Dense toolbars, generous canvas. No drop shadows except on floating overlays (then deep + colored glow).

---

## 2. Window layout (the main screen)

A single frameless Electron window, 5 stacked regions:

```
┌──────────────────────────────────────────────────────────┐
│ TITLEBAR  STRIDE · Sound Design Engine    ● Connected  Acct │  40px, drag region
├───────────┬──────────────────────────────────────────────┤
│ SIDEBAR   │ TOOLBAR ROW 0  Loop 2/4/8/16/32  Multi  Presets│
│ 224px     ├──────────────────────────────────────────────┤
│           │ TOOLBAR ROW 1  Point/Free · Shapes · Save/Clear│
│ Params    ├──────────────────────────────────────────────┤
│ Actions   │ TOOLBAR ROW 2  Mirror…Lock All (transforms)   │
│ Generative├──────────────────────────────────────────────┤
│ Edit      │ RULER (bars)                                  │
│           │ ┌──────────────────────────────────────────┐ │
│           │ │ MULTI-LANE CANVAS (the heart of the app) │ │
│           │ │  lane label │ automation curve …          │ │
│           │ └──────────────────────────────────────────┘ │
│           ├──────────────────────────────────────────────┤
│           │ GENERATIONS DOCK  Recent · [cards] · status   │  80px
└───────────┴──────────────────────────────────────────────┘
```

### A. Titlebar (40px, draggable)
- Left: **STRIDE** wordmark (brand gradient) + "Sound Design Engine" eyebrow.
- Right: **Connection pill** — 2px dot (emerald + glow = Connected / red pulsing = Disconnected) with uppercase label; clicking opens a troubleshooting popover. Account button (shows credit balance). Help `?`.
- Exact states: **Connected** = 2px emerald dot (`#34d399`) with soft glow + "CONNECTED" in emerald-300; **Disconnected** = 2px red dot (`#ef4444`) pulsing + "DISCONNECTED" in zinc-400. Pill height 24px, 10px uppercase label, `0.16em` tracking. Keep both states exactly; **[your call]** only on the glow/pulse polish.

### B. Left sidebar (224px) — *"what & where"*
1. **Parameters** header + mapped-count + rack info card (rack name in fuchsia, track, "● Template matched").
2. **Primary actions** (full-width stacked buttons, color = meaning):
   - `Scan Mapped` (fuchsia) — pulls every Ableton-mapped param into the canvas as a lane. **This is the main entry point.**
   - Clip-name input (emerald focus).
   - Optional **armed pattern chip** (orange) when a library pattern is loaded.
   - `Apply to Clip` (emerald) — writes a `.alc` file to drag into Live.
   - `Direct Inject · BETA` (sky) — writes automation straight into the selected Session clip.
   - `Save` / `Load` session (sky, half-width pair).
3. **Generative** — 6 engines as a 2-col grid, each its own hue: **Neuro** (fuchsia), **Chaos** (cyan), **Bloom** (amber), **Prism** (violet), **Sample & Hold** (lime, full-width), **Reflector** (sky, full-width). These act across *all unlocked lanes at once*.
4. **Edit** — non-destructive shaping sliders (zinc): Smooth, Depth 0–200%, Curve, Floor, Ceiling.

### C. Toolbar (3 rows above canvas)
- **Row 0:** Loop-length segmented control `2 / 4 / 8 / 16 / 32` bars (fuchsia, framed) · **Multi/Focus** view toggle · **Presets** (rose).
- **Row 1 — Draw + Shapes:** `Point` / `Free` draw tools (fuchsia active) · label "SHAPES:" · template buttons `Sine · Pump · Glitch · Groove · Chaos · Neuro` (Neuro tinted orange = "complex") · right side `Save Lane` / `Clear Lane`.
- **Row 2 — Transforms (color-coded, divider-separated groups):**
  - sky: `Mirror` `Flip`
  - violet: `Copy` `Paste` `Inv` `Paste To ▾`
  - amber: `Swing`
  - emerald `Mutate` · violet `Shuffle` · sky **Stretch** `2× / ½×`
  - right: `Select All` (zinc) · `Lock All` (amber, lock icon)
- Keep all three rows, every button, the divider groupings, and the color-family assignment exactly as listed. Button spec: 10px uppercase `font-bold`, `0.05em` tracking, `px-2.5 py-1`, `rounded` (6px). Active state = solid 20% tint + full-saturation text; idle = `bg-white/5` + zinc-400 text. This is a 1:1 reskin, not a re-layout.

### D. Canvas — multi-lane automation editor *(the product)*
- A **bar ruler** sits on top.
- Two view modes:
  - **Multi** (default): every lane stacked, **64px tall each**, **120px label column** on the left (param name + state).
  - **Focus**: the active lane fills the height for precision drawing.
- Per-lane state: **active** (fuchsia tint + dot), **unlocked**, or **locked** (amber tint, 🔒, dimmed — generative tools skip it).
- Curves are drawn in the lane's relevant accent color over a subtle bar grid.
- Interactions: click/drag to draw points, freehand, bezier-bend; Ctrl+click / Ctrl+drag to multi-select lanes.
- Fixed specs: lane height **64px**, label column **120px**, curve stroke **2px** in the lane's accent hue, anchor points = 3px filled dots in the same hue, bar grid = `white/5` verticals at every bar + `fuchsia/10` at the loop boundary. Active/locked/unlocked must stay visually distinct as described. **[your call]** on the *finish* of these (stroke feel, point-handle styling, hover scrub readout) — but the measurements and states are fixed.

### E. Apply / success feedback (NO overlay)
- **There is no floating "ready to drop" card.** Earlier builds had one (`#sd-apply-reveal`, still dead markup in the file) but it was deliberately retired as "too loud after every generation" and is never shown.
- On a successful Apply the feedback is deliberately quiet and lives in the **generations dock** (region F):
  1. A small **fly-to-dock orb** animates from the canvas (where the loading spinner was) down into the dock.
  2. The new card lands as the **leftmost** dock card, gets a **lime flash** (`gen-card-flash`) on impact, and wears the spinning **LED ring** for ~15s.
  3. A short status string (e.g. "Applied 6 params to clip", or a yellow/red warning on template mismatch) appears briefly in the dock's status pill, then clears after ~4s.
- The canvas itself is never covered. Producers drag the actual **dock card** into Ableton — that is the drag source, not an overlay.

### F. Generations dock (80px, bottom)
- Left block (border-r): "Recent / Generations" label + folder button (opens All Generations) + Clear button.
- Horizontal scroll of **draggable `.alc` cards**, each **~224px wide** (`w-56`), filling the dock height. A card is a horizontal tile: a **112px thumbnail** (`w-28`) on the left that is a **PNG snapshot of the whole multi-lane canvas** at generation time — so it reads as a tiny stack of all the lane curves, not a single curve — then **filename** (e.g. `Growl Bass A_142037`, truncated) over **timestamp** (`14:20`) + a small drag-handle icon. The freshest card wears a **travelling LED ring** (`gen-card-led`, yellow→lime conic, ~2.2s loop) and flashes lime green (`gen-card-flash`) the instant it lands, then the ring fades after ~15s. The same card markup is reused in the All-Generations modal.
- Right block (border-l): a status pill (M4L connection / lane count) and, on wide screens (≥1280px), a keyboard-hints pill (`Ctrl+Wheel · Space+Drag · Alt+Drag`).

---

## 3. Secondary screens (in mockup, bottom row)

- **Activation gate** — full-screen, centered STRIDE wordmark + "Sound Design Engine" eyebrow, license-key input, brand-gradient `Activate` button, "Get Stride →" link. First thing a new user sees — sets the tone.
- **All Generations modal** — grid of every `.alc` made this session (name, time, lane count), all draggable.
- **Pattern Library overlay** — slide-in takeover: left category rail (All / Bass / Leads / Chords / Melodic / Drums / Ambient / Sequences / ★Favorites / ◷Recent), filter row (Bars / Style / Root / Scale / Energy / Search), responsive card grid (3→6 cols). Selecting a pattern "arms" it (the orange chip in the sidebar).
- **Not drawn but exist:** Save/Load Session, Save/Load Preset, Preset Bank (category-tabbed), Welcome overlay, "Install to Ableton" one-time setup overlay, in-app Guide ("Getting Started — your racks, reborn, in 7 steps"), Account panel (license + credits).

---

## 4. Motion & feel (current vocabulary)
- Travelling conic-gradient LED ring on the newest generation card.
- Lime impact-flash + scale pulse when a generation lands in the dock.
- Pulsing dots (disconnected status, apply-arrow).
- Emerald glow ring on the apply card.
- Otherwise restrained — hover tints, 150–200ms transitions.
- Preserve all of the above motifs. **[your call]** is limited to *polishing* them and to the one motion gap worth filling: the generative engines paint every unlocked lane at once — that signature moment can carry more visual reinforcement. Propose, don't replace.

---

## 5. Three things that must survive any redesign
1. **Color = tool family** (functional, learnable).
2. **Multi-lane canvas is the hero** — everything else is chrome around it.
3. **Tone:** built by a producer, for producers. Dark, precise, confident. Never an "AI" or consumer-toy aesthetic.

---

## 6. Brand alignment — Patchbay vintage direction

See **`stride-ui-mockup-patchbay.html`** for the visual. This is the brand-aligned proposal: the *same* UI, re-skinned to match the landing page's dark + warm feel.

### The gap (today)
| Surface | Base | Accent | Tool colors |
|---|---|---|---|
| **Landing page** (`frontend/index.html`) | near-black `#040406` | **orange→red** (`#f97316`→`#dc2626`), warm glows | none — restrained, warm, premium |
| **App default** (`:root` "Midnight") | `#09090b` | orange→red brand | full **neon rainbow** (fuchsia, cyan, lime, sky, violet, rose, emerald) |

The mismatch is the **rainbow**. The landing reads warm/vintage/premium; the app's neon tool palette reads techy/playful. They don't feel like the same product.

### Why this is mostly a palette decision, not an engineering one
The app **already ships a skin engine**: `tailwind.config` maps every palette (`zinc/orange/fuchsia/emerald/amber/sky/violet/rose`) to CSS variables, and `<html data-skin="…">` swaps the whole UI in one attribute. Skins already defined: `:root` (Midnight), `copper`, `steel`, `brass`, `teal`, `patch` (**Patchbay**). Source: `stride-vst/app/renderer/index.html` head; tokens generated from `docs/mockup-stride2-vintage.html`.

### Patchbay palette (the proposal)
Matte, low-glow, vintage-modular:
| Token | Value | Role |
|---|---|---|
| Base / canvas | `#161616` | charcoal screen |
| Panel | `#313434` (or `zinc-900` → `#2b2d2d`) | slate panel body |
| Button face | `#2a2c2c` | raised control |
| Text | `#D1D5D6` / `#9a9d9e` / `#73797a` | metallic silver (3 tiers) |
| **Warm accent** | copper `#C6712B`, amber `#D9822B` | active states, primary actions, CTA, brand wordmark |
| **Cool controls** | silver `#9a9d9e` | secondary tools |
| Connected status | muted sage `#6f8f68` | not green-neon |

**The skin collapses the rainbow into two tones:** warm family (fuchsia/emerald/amber) → copper; cool family (sky/violet/rose) → silver. "Color = tool family" (rule #1) survives, just in muted vintage hues.

**Where color still lives — the lanes.** The "Patchbay" signature is per-lane **muted patch-cable colors**: copper `#C6712B`, teal `#2F748E`, sage `#5B7B55`, rose `#A34E52`, violet `#544B6D` (+ lavender `#a99fc2`). Each automation lane = a different cable. This is the "subtle vintage colors" ask — color carries *meaning* (lane identity), not decoration.

### Two known gaps to fix when this ships in the real app
1. The shipping `patch` skin **doesn't remap `cyan` or `lime`** (no `--cy`/`--li` vars), so the **Chaos** (cyan) and **S&H** (lime) buttons stay neon against the vintage chrome. The mockup adds muted-teal/muted-sage ramps for them — port these into the real skin.
2. The canvas curves are drawn in `canvas.js` (not CSS), so the per-lane cable palette must be wired there, not just in the skin tokens.

### Recommendation
Make **Patchbay the app's default** (`<html data-skin="patch">`) and keep the landing's orange as the shared warm anchor (copper `#C6712B` and orange `#f97316` are close cousins — or warm the landing slightly toward copper for an exact match). One warm-on-charcoal brand across landing + app.
