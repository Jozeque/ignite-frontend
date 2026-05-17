# Stride — Logo Design Brief

A spec for redesigning the Stride mark. The wordmark (Outfit Black, gradient fill) stays. The current **flask icon** is the focus — what to replace it with, and what the new mark needs to embody.

---

## 1. What Stride is (in one paragraph)

Stride is a **Sound Design Engine for Ableton Live**. Producers drop a Max for Live device onto a track, Stride scans the instrument rack, and exposes every parameter as a lane on a visual canvas. From there they draw, mutate, and reshape automation across the whole rack at once — then one click compiles it into a clip. The whole product collapses what used to be hours of knob‑turning into minutes of canvas work. **Not a sample library. Not an "AI music generator". It's an engine that takes the racks producers already own and pulls infinite variations out of them.**

Tagline in current use: **"Sound Design Engine. Your racks, reborn."**

---

## 2. The soul of the product (what the mark must embody)

These are the values, in priority order. The mark doesn't have to depict any of them literally — it has to *feel* like them.

1. **Chaos → coherence, fast.** Stride's signature move: hit Chaos, get random curves everywhere, pick a favourite, hit Bloom, and the rest of the rack reshapes to complement it. Order pulled out of randomness in seconds.
2. **One instrument → infinite variations.** A single rack, mutated endlessly. The product's deepest promise.
3. **Parallel, not serial.** 100+ parameters moving at once. "All Lanes. One Click." Not knob‑by‑knob — everything together.
4. **Movement as a substance.** Stride doesn't make sounds; it makes static patches *come alive*. The mark should feel kinetic, not still.
5. **Producer‑owned.** Every sound comes from the user's own racks. The engine is a tool, not a content source. Confidence without showing off.
6. **Edge, not whimsy.** Audience is heavy electronic — psytrance, psy‑techno, neuro, glitch, bass. The tone is dark UI, hard gradients, sharp grids. Confident, slightly aggressive, never cute.

> User's own framing, verbatim:
> *"Great for reaching a whole sound design session real quick out of chaos of randomness. Can take 1 instrument and mutate it endlessly to get infinite variations."*

If the mark expresses **chaos → coherence** and **one → many**, the rest follows.

---

## 3. Audience & tone

- **Who's looking at this:** electronic music producers, mostly intermediate-to-advanced, working in Ableton Live. Heavier genres over‑indexed (psytrance, psy-techno, neuro bass, glitch, IDM, dark techno) but not exclusive.
- **Where they live visually:** Ableton's dark UI, Splice, Native Instruments, Output, Arturia, Outerverse, Vital, Phase Plant. Adjacent brands: Serum (sharp blue/cyan industrial), Vital (clean fuchsia/cyan), Pigments (Arturia's vivid spectrum), Bitwig (orange triangles). Producer-tool design has shifted hard toward **bold geometric marks, monograms, and abstract sigils** — and away from object icons (the lab beaker, the gear, the speaker).
- **Voice the mark should match:** "built by someone who actually produces." Confident, terse, no hype, no corporate. Closer to a hardware-brand wordmark than a SaaS logo.

---

## 4. The current mark — what's working, what's not

Two flask variants are in circulation:

| File | Where it lives | Shape |
|---|---|---|
| `Logos/Stride_STANDARD_*.svg` | Full lockup, brand-assets generator | Wide-bodied lab/potion flask, horizontal bands across the neck, wavy liquid line — filled with brand gradient |
| Favicon SVG embedded in `frontend/index.html` and `stride-vst/app/renderer/index.html` | Browser tab, app titlebar | Heroicons "beaker" outline — narrow triangular flask, stroked, gradient stroke |

**What works:**
- The orange→red gradient is strong, recognisable, and ladders cleanly into the wider Stride UI (which uses the same gradient on the wordmark, CTAs, and accent borders).
- Outfit Black wordmark with tight tracking is solid and doesn't need to change.
- Three color variants already exist as a system (STANDARD orange→red, NLP STUDIO cyan→blue, COSMIC purple→indigo) — the new mark should fit the same variant grid.

**What's not working:**
- **The flask reads as "lab / chemistry / alchemy."** That maps to "experimentation," which is *adjacent* to Stride's idea, but it isn't the idea. Stride isn't about brewing a potion slowly in a lab — it's about pulling order out of chaos at speed, across many parameters at once. A static container shape can't carry that.
- **Two different flask drawings are in use** (favicon vs lockup), which dilutes recognition. Whatever replaces it should be one shape, scaled across every size.
- **The flask doesn't tile with the product's own visual language.** The landing page already uses **5 lanes of automation curves** (sawtooth, neuro spikes, square wave, sine, pump) as the hero texture. The mark should feel native to *that* world, not parachuted in from a chemistry set.
- **It skews cute / approachable** in a space where the audience and competition skew sharp / edged. The user's instinct ("need some more edginess") is correct.
- The old tagline baked into the lockup, **"NEVER GET STUCK."**, has been retired in favour of **"Your racks, reborn."** Whatever lockup is delivered should drop the old tagline.

---

## 5. Brand attributes for the new mark

Pick five adjectives to design against. In order of weight:

1. **Kinetic** — implies motion, not stillness
2. **Generative** — one seed → many outputs; recursion, multiplication, branching
3. **Sharp** — hard edges over soft curves; geometric, not organic
4. **Confident** — heavy weight, no thin strokes; reads at 16px favicon and 200px hero
5. **Producer‑native** — feels at home next to a Push controller, an Outerverse rack, an Ableton clip

Adjectives to *avoid*: cute, playful, scientific, scholarly, retro, hand-drawn, watercolour, sticker-style, mascot.

---

## 6. Directions worth exploring

These are *starting points*, not prescriptions — the user wants to ideate from here. Each one is a different angle on the same soul.

**A. Curve‑as‑form.** A single bezier or waveform path that is itself the mark — a glyph cut from the same vocabulary as the canvas the product runs on. Could be a stylised "S" built from a curve, a peak‑and‑valley silhouette, or a single‑stroke sigil that reads as both letterform and waveform.

**B. Multiplicity / echo.** One shape that *ghosts into many* — the same form repeated and mutated. Three or four copies of a glyph, each slightly offset, slightly warped, suggesting "one rack, infinite variations" at a glance. The mark literally is the mutation.

**C. Lanes / stack.** A short stack of horizontal lanes (3–5), each a different curve type. Reads as a tiny waveform stack, mirrors the product's "All Lanes" core feature. Strong shape at favicon size.

**D. Stride / step.** The name means *step forward, with intent.* A geometric mark that suggests forward motion — slanted, leaning, propelling. Could be a chevron, an arrow-glyph, a leaning monogram. Speaks to speed and the "one click, done" promise.

**E. Chaos node.** A central sharp point with curves radiating, branching, or fracturing outward — chaos pinned and shaped. Heavier, more graphic, would fit psy/neuro audiences well.

**F. Pure monogram S.** Geometric "S" treatment with a kinked or offset stroke — small, ownable, scales infinitely. Lowest-risk, highest-utility direction if the abstract ideas above feel too conceptual.

The strongest brief‑fit answers are likely **A**, **B**, or a hybrid (e.g., a monogram **F** that's structurally built from **A**'s curve language). **B** is the most expressive of Stride's actual value prop and worth pushing on hardest.

---

## 7. Hard constraints

**Must:**
- Read clearly at **16×16 px** (favicon, taskbar) — no internal detail that disappears below 24px
- Work in **monochrome** (single white on dark, single black on light) and **gradient** (the existing orange→red brand gradient)
- Slot into the **three‑variant system** already in use: Standard (orange→red), NLP Studio (cyan→blue), Cosmic (purple→indigo). Whatever shape is chosen has to look right in all three.
- Pair with the **Outfit Black** wordmark — the typeface stays. The mark should sit beside or above "STRIDE" without clashing in weight or rhythm. Test the lockup at multiple sizes.
- Survive on **dark backgrounds** (`#040406` to `#09090b` are the canonical Stride dark tones). Make it work there first; light‑mode is a fallback.
- Be deliverable as **clean SVG** — no embedded raster, no gradient meshes the brand-asset generator can't reproduce.

**Must not:**
- Look like a flask, beaker, lab equipment, droplet, or chemistry symbol
- Look like a gear, knob, fader, EQ curve, speaker, headphone, or play button — every audio brand uses these and Stride is not "another audio app"
- Mention or imply AI, neural networks, brains, sparkles, magic wands. Stride is not an AI product in messaging; the mark must not betray that.
- Use thin strokes (≤1.5 stroke‑width at 24px viewbox) — the wordmark is heavy, the mark needs equal weight
- Use a circle/rounded badge container unless the container is doing real work — Stride's UI is square/rounded‑rectangle, not pill‑shaped
- Copy a Bitwig triangle, a Serum diamond, an Output A, or any other recognisable competitor mark

---

## 8. Where the mark has to live

Designer should mock each of these as part of the deliverable. The mark fails if it falls apart in any one of them.

| Context | Size | Notes |
|---|---|---|
| **Browser favicon** | 16, 32, 48 px | The smallest, harshest test. Most important single context. |
| **macOS app icon** | 1024 px master, rendered to 16–1024 | Rounded‑square iOS/macOS conventions apply for the *container*, mark sits inside. |
| **Windows .ico** | 16, 24, 32, 48, 256 | Multi‑resolution embedded |
| **Ableton M4L device thumbnail** | ~88×38 px effective area, dark grey background | Shown inside Live's device chain. Has to read at a glance with Ableton chrome around it. |
| **Landing‑page nav** | wordmark only, current usage — but the mark sits beside it on hero / blog / OG cards | Mark + "STRIDE" lockup, horizontal |
| **Stride app titlebar** | Small mark + "STRIDE" wordmark | Currently wordmark only; the new mark will be added here |
| **OG / Twitter share card** | 1200×630 | Mark + wordmark + tagline lockup |
| **Outerverse × Stride collab cards** | Variable | Has to coexist with the Outerverse logo on a fuchsia gradient — see `frontend/blog/outerverse.html` for the current pairing |
| **Stride brand‑assets generator** | `Logos/logo_assets.html` (currently auto‑generates the three variants from a single SVG path constant) | New mark needs to drop into this generator cleanly — a single path or path‑set that takes gradient stops as variables |

---

## 9. Brand system the mark plays inside

- **Typeface:** Outfit, weights 300/400/500/700/900. **Outfit Black** (900) is used everywhere for headlines and the wordmark. Tight tracking (`-0.05em` to `-0.025em`).
- **Primary gradient:** `#f97316` (orange‑500) → `#ef4444` (red‑500), left to right.
- **Variant gradients:**
  - NLP Studio — `#06b6d4` (cyan‑500) → `#3b82f6` (blue‑500)
  - Cosmic — `#a855f7` (purple‑500) → `#6366f1` (indigo‑500)
- **Accent color:** `#d946ef` (fuchsia‑500). Used sparingly for cosmic / collab / generative moments.
- **Surface colors:** `#040406` (background), `#09090b` (panel base), `#18181b` with `rgba(255,255,255,0.06)` borders for glass.
- **Vocabulary the product uses on itself** (for inspiration, not depiction): Canvas, Lanes, Bloom, Mutate, Prism, Chaos LFO, Neuro, Pump, Glitch, Sine, Swing, Quantize, Smooth, Mirror, Flip, All Lanes, Paste To. The mark should feel like it belongs to *this* vocabulary.

---

## 10. Deliverables expected

1. **3–5 concept directions** as small black‑on‑white sketches first, before any gradient or polish. Mark only — no wordmark — so the form is judged on its own.
2. **For the chosen direction, 2–3 refinements:**
   - Monochrome master SVG (square viewBox, recommended 100×100 or 24×24)
   - Gradient variant SVG for each of the three engine colors (Standard / NLP Studio / Cosmic)
   - Horizontal lockup with the Outfit Black "STRIDE" wordmark — spacing, x‑height alignment, baseline
   - Stacked lockup (mark above wordmark) for square contexts
3. **Sizing sheet:** the chosen mark rendered at 16, 24, 32, 48, 96, 256, 1024 px on a dark background, side‑by‑side, no other treatment. This is the truth test.
4. **Mock‑in‑context:** favicon in a browser tab strip, macOS dock icon, Ableton M4L device thumb, landing nav.
5. **The single SVG path / path‑set** that can drop into `Logos/logo_assets.html`'s `FLASK_PATH` constant slot, with the gradient applied via a `linearGradient` whose stops are parameterised by the three variants (the existing generator pattern). This is the practical handoff — once the path is in place, all three variants and PNG exports regenerate automatically.

---

## 11. References worth looking at (for vibe, not copying)

- **Bitwig Studio** — geometric triangles, sharp, producer‑native
- **Splice** — bold monogram, scales hard
- **Output (the audio company)** — single hard glyph, very confident
- **Native Instruments Maschine** — geometric, kinetic
- **Arturia Pigments** — vivid gradient, abstract glyph rather than instrument depiction
- **Stride's own canvas hero curves** (`frontend/index.html` lines 142–151) — the 5‑lane SVG waveform pattern is a real reference for the visual language Stride lives in

Avoid: Headspace / Calm‑style soft circles. SaaS startup blob marks. Anything that ends up looking like a Spotify equaliser.

---

## 12. The one‑sentence brief

> Design a mark that, on its own, conveys **"one instrument, infinite variations — chaos resolved into a finished sound design session in minutes"** — kinetic, sharp, producer‑native, paired with the existing Outfit Black STRIDE wordmark and the orange→red brand gradient.

---

## Appendix — files & paths the designer will want

| What | Path |
|---|---|
| Current full‑logo SVGs (three variants) | `Logos/Stride_STANDARD_Full_Logo.svg`, `Stride_NLP_STUDIO_Full_Logo.svg`, `Stride_COSMIC_Full_Logo.svg` |
| Current icon‑only SVGs | `Logos/Stride_STANDARD_Icon.svg` + two variants |
| Brand‑assets generator (single‑path → all variants + HD PNG) | `Logos/logo_assets.html` |
| Current favicon (Heroicons beaker) | inline `<link rel="icon">` in `frontend/index.html` and `stride-vst/app/renderer/index.html` |
| Landing page (product voice, hero curves, gradients) | `frontend/index.html` |
| Blog article showing mark in collab context | `frontend/blog/outerverse.html` |
| Live UI showing wordmark usage in the app | `stride-vst/app/renderer/index.html` |
