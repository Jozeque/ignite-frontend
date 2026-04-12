# Landing Page Spec — Stride M4L Device Launch

Source file: `mockup_landing_v2.html`

---

## 1. NAV BAR

### Remove
- "Log In" button (no accounts for local device)
- "Start Producing" button (replace with buy CTA)

### Add
- **"Buy Now — $49"** button (gradient orange, same style as current "Start Producing")
- Links to Gumroad/payment page
- Keep Instagram + Contact icons

---

## 2. HERO SECTION (lines 99-143)

### Badge
- Keep as-is: `Sound Design Engine for Ableton`

### Headline
- Keep as-is: `Sound Design Engine. / Your racks, reborn.`

### Subhead — REPLACE
Current:
> "Stride injects dynamic automations into your Ableton racks — creating sounds you've never heard from instruments you already own. **Plus production-ready MIDI, drag-and-drop into Live.**"

New:
> "A visual canvas to automate every parameter in your Ableton rack — at once. Draw, mutate, and shape sounds you've never heard from instruments you already own. **100% local. No internet. No account.**"

Why: Remove MIDI mention (not shipping yet). Add "local/no internet" — the #1 thing feedback says producers want.

### CTA Button — REPLACE
Current: `ENTER THE STUDIO`

New: `GET STRIDE — $49`

Subtext below button (new, small zinc-500 text):
> "One-time purchase. Max for Live device. Yours forever."

Optional launch variant:
> `GET STRIDE — $39` with strikethrough `$49` and small "Launch price — first 200 buyers" badge

### Video
- Keep the video player as-is
- Re-record when ready with a local-device-focused tutorial (current video may reference web app features)

---

## 3. SCROLLING PILLS STRIP (lines 145-200)

### Keep as-is
Good showcase of local features. All items (Mutate, Mirror, Chaos LFO, Swing, Quantize, Neuro, Freehand Draw, All Lanes, Paste To, Smooth, Groove Build) are real local features.

### Add pill
- **"Bezier Curves"** — it's a strong canvas feature, worth showing

---

## 4. POWER BANNER — "One canvas. Every parameter." (lines 202-258)

### Keep as-is
This entire section is about the local canvas. All three mini-cards (All Lanes, Mutate & Evolve, Chaos on Demand) are accurate local features. No changes needed.

---

## 5. THREE-COLUMN FEATURE CARDS (lines 261-286)

### Card 1: "Automation Injection" — KEEP, minor edit
Current copy mentions "generates" — soften to avoid AI implication.

New copy:
> "Drop Stride on your track. It scans your rack, maps every parameter, and gives you a full visual canvas to draw complex automation curves — LFO sweeps, pump patterns, glitch sequences — compiled directly into your Ableton clip."

### Card 2: "Your Rack, Your Sound" — KEEP AS-IS
Perfect. No changes.

### Card 3: "Production-Ready MIDI" — REPLACE
This feature isn't shipping. Replace with:

**Title:** "Zero Setup. Zero Cloud."
**Icon:** Lock/shield icon (security/local feel)
**Copy:**
> "No account. No internet. No data leaves your machine. Stride runs entirely inside Ableton via Max for Live. Buy it, drop it on a track, start designing. That's it."

---

## 6. "INSIDE THE ENGINE" 2x2 GRID (lines 288-352)

### REPLACE ALL FOUR CARDS
Current cards (Sound Design .ALC, Cosmic Mode, Studio Assistant, Seed Engine) are all cloud/AI features. None ship with the local device.

**New Card 1: The Canvas**
- Color: Orange
- Title: **"The Canvas"**
- Copy: "See every parameter in your rack laid out as lanes. Draw automation with point, freehand, and bezier tools. Zoom, pan, select regions. A full DAW-grade automation editor that writes directly to your Ableton clip."

**New Card 2: Templates**
- Color: Purple
- Title: **"Instant Templates"**
- Copy: "Start with Sine, Pump, Glitch, Neuro, Chaos LFO, or Groove Build — one click fills your canvas with production-ready curves. Then fine-tune with Smooth, Intensity, and Curve sliders."
- Bottom element: 6 small pills showing template names (like the scrolling strip but static)

**New Card 3: Mutate**
- Color: Red
- Title: **"Mutate"**
- Copy: "One button. Stride chops your curves into segments, shuffles them, flips sections, scales amplitudes, and reassembles into variations you'd never draw by hand. Keep hitting it until something clicks."
- Bottom element: Small visual showing curve → mutated curve (could be a simple SVG or screenshot later)

**New Card 4: All Lanes**
- Color: Green
- Title: **"All Lanes. One Click."**
- Copy: "Toggle All Lanes and every tool — draw, mutate, mirror, quantize, smooth — hits every parameter in your rack simultaneously. 100 parameters automated in the time it takes to do one."
- Bottom element: Counter-style text: `100+ parameters / 1 click / 0 repetition`

---

## 7. NEW SECTION: "How It Works" (add BEFORE feature cards)

Insert between Power Banner and 3-column cards.

### Layout: 3 steps, horizontal on desktop, stacked on mobile

**Step 1:**
- Number: `01`
- Title: "Drop Stride on your track"
- Description: "Add the Max for Live device to any track with an instrument rack. Stride scans your rack and loads every parameter."
- Visual placeholder: Screenshot of M4L device on Ableton track

**Step 2:**
- Number: `02`
- Title: "Shape your sound"
- Description: "Draw curves, apply templates, hit Mutate. Use Smooth, Quantize, and Swing to dial it in. Copy and paste across lanes."
- Visual placeholder: Screenshot of canvas with curves

**Step 3:**
- Number: `03`
- Title: "Apply to clip"
- Description: "One click writes all automation directly into your Ableton clip. Remove Stride — the automation stays. It's yours."
- Visual placeholder: Screenshot of Ableton clip with automation lanes

---

## 8. NEW SECTION: "Works With" (add AFTER feature cards)

### Layout: Single row of synth names/logos, centered

> "Works with any Ableton instrument rack"

List (as text pills or logos if available):
`Serum` `Vital` `Operator` `Wavetable` `Pigments` `Phase Plant` `Diva` `Massive X` `Analog` `Omnisphere` `any plugin`

---

## 9. NEW SECTION: "Pricing" (add BEFORE bottom CTA)

### Layout: Single centered card, glass-panel style

**Title:** `$49`  (large, bold, gradient)
**Subtitle:** `One time. Yours forever.`
**Bullet points:**
- Max for Live device
- All canvas tools + templates
- Mutate engine
- All future updates included
- No subscription. No credits. No cloud.

**CTA Button:** `GET STRIDE`
**Subtext:** "Instant download. Works with Ableton Live 11+ Suite or Standard + Max for Live."

**Launch variant:** Show `$39` with `$49` crossed out, small orange badge: "Launch price — limited"

---

## 10. AUDIO PREVIEWS SECTION (lines 354-388)

### Option A (recommended): REWORK as Before/After
- Rename heading: **"Before & After"**
- Subhead: "Same rack. Same patch. Just Stride."
- Two rows, each with two audio players:
  - Left: "Serum Pad — flat" (no automation)
  - Right: "Same pad — after Stride" (with automation)
- Requires actual audio files (record when ready)

### Option B: REMOVE entirely
Better to have nothing than placeholder cards with no audio. Currently the section is non-functional.

---

## 11. BOTTOM CTA (lines 390-400)

### Headline — KEEP: "Your instruments. Infinite variations."

### Subtext — EDIT
Current: "Upload a rack. Get back something you've never heard before. That's the loop."

New: "Drop Stride on a track. Shape your sound. Apply to clip. That's the loop."

### Button — EDIT
Current: `Launch Stride`

New: `GET STRIDE — $49`

---

## 12. FOOTER (lines 404-412)

### Keep as-is
Privacy, Terms, copyright line all fine.

---

## SUMMARY OF REMOVALS

| Item | Reason |
|------|--------|
| "Log In" nav button | No accounts |
| "Start Producing" nav button | Replace with buy CTA |
| MIDI mention in hero subhead | Not shipping |
| "Production-Ready MIDI" feature card | Not shipping |
| "Sound Design (.ALC)" engine card | Cloud feature |
| "Cosmic Mode" engine card | Cloud feature |
| "Studio Assistant" engine card | Cloud feature |
| "Seed Engine" engine card | Cloud feature |
| "Hear the Engine in Action" (if no audio) | Non-functional |

## SUMMARY OF ADDITIONS

| Item | Purpose |
|------|---------|
| Buy CTA in nav ($49) | Convert from any scroll position |
| "100% local" messaging in hero | Address #1 feedback point |
| "How It Works" 3-step section | Reduce confusion about workflow |
| "Works With" synth strip | Answer "does it work with MY synth?" |
| Pricing section | Remove friction — show cost upfront |
| "Before & After" audio (when ready) | The ears sell the product |
| "Zero Setup. Zero Cloud." feature card | Trust signal |
