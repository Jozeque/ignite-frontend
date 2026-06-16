# PRD — TENDRIL: The Instrument Built to Be Modulated

> **Name:** TENDRIL *(chosen 2026-06-11)*
> **Status:** Draft v0.1 — spec for review, no code yet (per Working Rule #1)
> **Author role:** CTO / DSP engineer / sound designer
> **Date:** 2026-06-11
> **Companion to:** Stride (Sound Design Engine for Ableton Live)

---

## 0. TL;DR

A premium **wavetable + spectral synthesizer**, built as a **Max for Live device with its DSP core in `gen~`**, whose entire reason for existing is that **every single parameter sounds musical across its full range** — so when Stride injects dozens of automation lanes at once, the result is *always* a usable, evolving sound instead of scrambled garbage.

It ships as **one device**: a polyphonic morphing synth engine *plus* a built-in, modulatable effect rack (Corpus-style resonance, distortion, bitcrush, OTT-style multiband dynamics, feedback, multiband saturation). Sold as a **premium paid companion** to Stride.

The defining promise: **"The synth you can't make sound bad. Modulate everything."**

---

## 0.5 — FOCUS v1 (build-first scope) — locked 2026-06-11

The full PRD below stays the north star. But we **build this focused ~20-knob core first** (every knob makes a big difference), then expand. Implemented in **JUCE/C++** (pivoted from M4L+gen~ — see §11/§14).

**Three priorities:**
1. **Two oscillators** with the modulative dual-cube wavetable + spectral morph (as specced §5).
2. **Reorderable, parallel FX chain** with the same effects — **plus Character knobs on Filter and Distortion**.
3. **Tuned "Note Delay"** — a short delay whose time is **quantized to musical notes** and **displays the note**. Physics: a short feedback delay resonates at `f = 1000 / delay-ms`, so each delay time IS a pitch. Range **C0–C2** (≈61–15 ms = "first 2 octaves", user-locked), snaps to semitones, shows e.g. `C1`/`F#1`. Not a casual 100–200 ms echo — a *pitched resonance*. Automatable (Stride can arpeggiate it).

**~20-knob layout:** OSC: A Tone/Body/Air, B Tone/Body/Air, FM, Detune (8) · FILTER: Cutoff, Reso, Character + Type switch (3) · DISTORTION: Drive, Character + Type switch (2) · CRUSH (1) · TUNED DELAY: Note, Feedback, Mix (3) · REVERB: Size, Mix (2) · Output (1).

**Build order:** [done] dual-osc + spectral voice → [done] move filter into FX chain → [in progress] FX modules (Filter+Char, Distortion+Char, Crush, Tuned Delay, Reverb) in a fixed chain → [next] reorder + parallel routing → [next] custom web UI (surfaces just these ~20). The full 49-param contract (§7) stays underneath, append-only.

---

## 1. The Problem & The Insight

### The problem (in your words)
> "Stride injects dozens of unique automation lanes in a click. But on generic synths, outputs come scrambled if you just shoot in the dark."

This is correct and it is **not a Stride bug — it's a synth-design mismatch.** Off-the-shelf synths are built to be played and tweaked by a human who *avoids the bad-sounding zones*. Their parameter ranges contain:
- **Silent zones** (filter fully closed, oscillator level at 0, mix at dry).
- **Harsh/painful zones** (resonance screaming, distortion clipping into noise, feedback runaway).
- **Out-of-tune / inharmonic zones** (detune, FM index, pitch params with no quantization).
- **Discontinuities** (a knob that's musical from 0–60% and useless from 60–100%).

When Stride sweeps all of those at once, it inevitably lands in dead/harsh/detuned combinations. A human would never automate into those — Stride, by design, explores the *whole* space.

### The insight (the product thesis)
> **Don't make Stride smarter. Make an instrument with no bad values.**

If *every* exposed parameter is a **curated, musical continuum** — where 0% and 100% and everything between are all intentional, in-tune, audible, and self-limiting — then random/automated modulation can't fail. This is a known, proven design philosophy (Mutable Instruments builds entire modules this way — see §12), it has just **never been packaged as a synth purpose-built for an external automation engine.**

That gap is the product. No existing synth is designed *for* being machine-modulated. TENDRIL is.

### Why this is defensible
- It makes Stride dramatically better *and* sells a second product.
- The "modulation-safe" engineering is genuinely hard and genuinely differentiated — it's not a skin on a stock synth.
- It deepens lock-in: TENDRIL + Stride is a workflow no competitor can replicate without both halves.

---

## 2. Goals & Non-Goals

### Goals
1. **Zero-bad-values guarantee.** Any parameter, anywhere in its range, alone or combined with any others, yields a musical result.
2. **Stride-native integration.** A fixed, stably-ordered, human-named macro parameter list that Stride scans and automates with zero misrouting (see §10).
3. **Serum-class fun.** A rich, large, fluid custom UI inside M4L — not the cramped stock-Max-object look.
4. **One device, synth + evolving FX**, both fully modulatable.
5. **Live-modulatable wavetable shape** — fix the Operator limitation (you can draw but not modulate) and the Serum limitation (editing-as-you-go is cumbersome).
6. **Premium feel** worthy of a paid price ($49–$99).

### Non-Goals (v1)
- Not a Serum replacement for *manual* sound design depth (no per-point wavetable drawing, no giant mod matrix). TENDRIL is opinionated and curated, not infinite.
- Not a native VST3 (decided: hybrid M4L + `gen~`). Revisit only if M4L hits a hard wall.
- No user-importable wavetables in v1 (curated tables only — this is *how* we guarantee musicality). Roadmap item.
- **No AI mentions, ever** (per project rule). TENDRIL is a sound design instrument. Full stop.

---

## 3. Target User & Positioning

**Who:** Electronic producers in Ableton who already use (or buy) Stride. They want *unexpected-but-usable* sounds fast, from instruments they own, without becoming sound designers.

**Positioning:** TENDRIL is the **reference instrument for Stride** — the synth that proves what Stride can do, and the one where Stride feels like magic. Sold as a premium companion / bundle upsell.

**Tagline candidates** (sound-design-led, no AI, producer language):
- "Modulate everything. It always sounds good."
- "The instrument built to be automated."
- "Every knob is a good knob."
- "Draw motion. TENDRIL answers."

---

## 4. Product Principle: *Modulation-Safe by Design*

This is the spine of the whole product. Every feature decision is judged against it.

**Rule:** A parameter is only exposed to the user (and to Stride) if it is *modulation-safe*: continuous, musical end-to-end, self-limiting, and combinable with all others without producing silence, pain, or detuning.

How we achieve it (engineering techniques in §12). The user-facing consequence: **TENDRIL has fewer knobs than Serum, and every one of them is a "macro" that scans a curated path through the underlying DSP.** One macro might internally move five DSP targets along a hand-tuned curve. The user (and Stride) sees one clean 0–100% control that always sounds intentional.

This directly mirrors Mutable Instruments' Marbles, which the research **verified**: its STEPS control uses a *progressive quantizer* and its SPREAD control *scans a continuum of probability distributions* so "every position stays musically coherent." *(Source: official Mutable docs — verified 3-0.)* We apply that philosophy to a synth.

---

## 5. Synthesis Architecture

### 5.1 The core: a morphing wavetable "cube" (VERIFIED feasible)

The research **confirmed** (3-0, official Cycling '74 *Wavetank* tutorial) that `gen~`'s built-in `wave` operator reads single-cycle waveforms laid end-to-end and interpolates between them, and that a **3×3×3 cube of 27 waveforms can be trilinearly morphed across three independent X/Y/Z axes** using 8 wavetable readers (the cube corners). This is *exactly* the architecture we want.

**Each TENDRIL oscillator = a Wavetank cube:**
- **4×4×4 = 64 curated single-cycle waveforms** arranged in a cube (upgraded from 27 — see §5.1b for why). Curation guarantees *every interior point* is a musical timbre (no dead corners). Trilinear morph still needs only 8 wavetable readers (the cube corners), so the frame-count increase is nearly free CPU-wise.
- Three macros — **TONE (X), BODY (Y), AIR (Z)** — morph continuously through the cube. Every position is a valid, full-bodied waveform.
- Optional 4th **BANK/CHARACTER** axis swaps among curated cubes (Analog / Digital / Vocal / Metallic) via crossfade → hundreds of base shapes without losing the "every position is musical" guarantee.
- Because it's *interpolated morphing*, not switching, sweeping these is glitch-free and always musical → **modulation-safe by construction.**

This already solves the user's two stated frustrations:
- *Operator:* you can draw harmonics but can't modulate the drawing. → TENDRIL's "drawing" (the cube position) **is** a modulatable parameter.
- *Serum:* wavetables are pre-built, editing-as-you-go is cumbersome. → TENDRIL edits the spectrum *continuously* via the spectral stage (§5.2), in real time, modulatable.

### 5.1b Dual oscillator + cross-modulation (DECIDED — full depth)

> A single morphing cube is **not** Serum-class on its own. Serum/Vital get their richness from *interaction*, not raw frame count. So TENDRIL ships **two full oscillators with cross-modulation** (locked decision 2026-06-11).

- **OSC A + OSC B** — two independent 4×4×4 Wavetank cubes (each with its own TONE/BODY/AIR + optional BANK), plus per-osc **Level, Octave, Fine, Pan**.
- **Cross-modulation A↔B**, each a bounded, keytracked, modulation-safe macro:
  - **FM Amount** — B modulates A's phase. Index is *bounded and keytracked* so it adds harmonics richly but never detunes or goes harsh across its full range.
  - **Ring Amount** — A×B ring modulation, blended (equal-power) so it's metallic-but-musical end to end.
  - **Sync** — hard-sync depth of A to B's pitch; bounded so the edge is aggressive but never aliased garbage.
- **SUB** — sine/triangle sub oscillator (−1/−2 oct), always-musical low-end anchor.
- **NOISE** — colored/filtered noise layer (white→pink→tuned), bounded level.

This is where complexity *explodes* musically — FM + ring + sync between two morphing wavetables is a vast, alive timbral space — while every control remains a curated continuum Stride can sweep safely. **Cost (honest):** ~2× per-voice CPU vs single osc, and a longer macro list (more Stride lanes — a feature, not a bug). This makes the **P0 voice-count spike (§15) the gating milestone.**

### 5.2 The spectral stage: add/remove frequencies on the *same* table

This is the user's #1 ask: *"few knobs that manipulate the same wavetable, adding and removing frequencies for unexpected results."*

After the cube produces a base waveform, a **spectral shaping stage** adds/removes harmonic content from that same source. Proposed macros, each a curated continuum:

| Macro | What it does (perceptually) | DSP technique |
|---|---|---|
| **DENSITY** | adds/removes upper harmonics — from pure to rich | spectral tilt + harmonic emphasis |
| **COMB** | rakes harmonics in/out rhythmically | comb filtering / spectral notching |
| **FOLD** | adds new harmonics by wavefolding | bounded wavefolder (self-limiting) |
| **TILT** | dark↔bright spectral balance | one-knob spectral tilt EQ |
| **FORMANT** | vowel-like resonant peaks that move | movable formant filters |
| **WARP** | phase-distortion / sync-style edge | phase warp on the read pointer |

**Implementation decision (needs prototyping — see §11 & open questions):** two candidate paths for the spectral stage:
- **(A) Additive / IFFT resynthesis** (`ioscbank~`, `pfft~`): rebuild the wavetable from a live harmonic spectrum each frame. Most flexible "add/remove frequency" model. **The research could NOT verify concrete real-time `pfft~`/`ioscbank~` resynthesis details** — flagged as an open question; must be prototyped before committing.
- **(B) Time-domain shaping in `gen~`** (wavefolding, phase distortion, comb, tilt EQ, formant filters all per-sample in `gen~`). Lower risk, fully inside the verified `gen~` capability set, lower CPU. **Recommended for v1.**

> **Engineering call:** Ship v1 with **path B** (time-domain `gen~` spectral shaping — proven, cheap, sounds great, fully modulation-safe). Prototype **path A** (true additive/IFFT) as a v2 "spectral mode" once we've benchmarked CPU. This de-risks the schedule while still delivering the "add/remove frequencies live" experience.

### 5.3 Polyphony (VERIFIED feasible)

Research **confirmed** two valid approaches:
- **`poly~`**: instantiates N copies of the voice subpatch, auto-allocates voices by scanning for a non-busy instance on each note. *(verified 3-0)*
- **MC-based**: single patcher, MC wrapper objects with channel count = voice count, busy-map disables idle voices to save CPU. *(verified 3-0)*

> **Engineering call:** Build the voice (cube + spectral + amp/filter envelopes) as a `gen~` patch, wrap in **`poly~` (8 voices, expandable)**. It's the documented, well-trodden path and gives clean per-voice modulation. Evaluate MC only if CPU profiling demands it. *(Real-world proof: k-devices TERRA is an 8-voice wavetable synth shipping entirely as M4L — verified, medium confidence; note TERRA is Max 7 / not gen~-based, so it proves M4L feasibility, not the gen~ path specifically.)*

### 5.4 Per-voice "humanization" (free musicality)
Subtle, bounded per-voice randomization (phase, micro-detune within ±cents, filter spread) makes the synth sound alive and makes *any* static parameter set sound intentional. All bounded → still modulation-safe.

### 5.5 Signal flow

```
        ┌──────────────────────────── per voice (poly~ × 8) ────────────────────────────┐
        │  OSC A (4³ cube,gen~) ┐                                                         │
 MIDI ─▶│      TONE/BODY/AIR    ├─ FM / Ring / Sync ─▶ Spectral stage ─▶ Amp/Filter      │─┐
        │  OSC B (4³ cube,gen~) ┘   (bounded,keytrk)   DENSITY/COMB/      env + zero-bad  │ │
        │  + SUB + NOISE                               FOLD/TILT/         filter          │ │
        │                                              FORMANT/WARP                       │ │
        └───────────────────────────────────────────────────────────────────────────────┘ │
                                                                                            ▼
              ┌──────────────── modular FX builder — §6 (matrix~ routing) ─────────────────┐
              │  reorderable slots · 2 parallel lanes (A/B) · feedback w/ self-limiter      │
              │  e.g.  MOTION(fb) ─▶ DRIVE ─▶ ╭ lane A: CRUSH ─▶ GLUE ╮─▶ SPACE ─▶ out      │
              │                              ╰ lane B: RESONATE ──────╯  (equal-power blend) │
              └────────────────────────────────────────────────────────────────────────────┘
                                              ▲
                                              │  every continuous macro = a fixed-order,
                                     STRIDE ──┘  named, modulation-safe live.* parameter
```

---

## 6. The Modular FX Builder (reorderable · parallel · feedback)

> **Upgraded from a fixed rack to a modular builder (locked 2026-06-11).** The user must be able to: **reorder** the chain, **split into parallel lanes** (double-chain), and **patch feedback** (e.g. *feedback → distortion*). This is a hands-on sound-design surface — *and it must not break the modulation-safe promise or Stride's fixed param contract.* §6.4 explains how we keep both.

### 6.1 The six FX modules
Your go-to chain — *Corpus, distortion, bitcrush, OTT, reverb, feedback, multiband saturation* — as six modules, each one or two curated, modulation-safe macros:

| Module | Macro(s) | Inspiration | Modulation-safe design |
|---|---|---|---|
| **RESONATE** | Amount, Tune | Corpus / modal resonator | resonator bank, keytracked so it's *always in key*; bounded Q so it can't scream |
| **DRIVE** | Drive, Character | distortion / multiband saturation | drive curve with **auto makeup-gain** → louder in ≠ louder out; soft-clip ceiling so it never goes to noise |
| **CRUSH** | Crush, Rate | bitcrush / SRR | bit depth & sample-rate as *perceptual* curves; floor prevents fully-destroyed silence |
| **MOTION** | Feedback, Time | feedback delay network | **feedback hard-capped <1.0** + internal limiter; time tempo-quantized |
| **GLUE** | Amount | OTT-style multiband up+down comp | single "amount" morphs threshold/ratio along a tuned path; auto-makeup keeps level constant |
| **SPACE** | Size, Mix | reverb | equal-power mix so "dry" is never silent-ish and "wet" never washes out |

### 6.2 Routing: reorder + parallel + feedback
- **Slot rack:** modules live in **drag-to-reorder slots**. Order is fully user-definable (e.g. MOTION before DRIVE so *feedback flows into distortion* — the user's exact example).
- **Two parallel lanes (A / B):** any module can be assigned to lane A or B. A **split point** sends the signal down both lanes; an **equal-power Parallel Blend** macro mixes them back (loudness-stable → modulation-safe).
- **Feedback send:** tap the output (or any post-slot point) back into a pre-slot sum node, through a **self-limiter** (see §6.4). A **Feedback Amount** macro controls depth.
- **Per-slot Mix (dry/wet)** and **Bypass** on every module.

Mental model: **Kilohearts Snap Heap / FabFilter Saturn 2** — beloved, proven modular-FX UX. TENDRIL's twist: every slot's continuous macros are also **Stride-automatable**.

### 6.3 How it's built (extends the gen~ plan, no rewrite)
- Each module = its own **`gen~` object**.
- **`matrix~`-based router at the Max level** does reorder + parallel splits with ramped gains — *reordering is a routing change, not a `gen~` recompile.* (matrix~ is the standard Max any-to-any signal router.)
- **Feedback** is summed pre-router; tight feedback wrapped in `gen~` (single-sample, via `history`). ⚠ **Caveat:** a Max-level feedback path incurs one signal-vector delay (~64 samples). For delay/feedback-style FX that's musically fine; P0 must confirm the latency is acceptable, else move the whole feedback loop inside one `gen~`.
- **Head start (VERIFIED):** Max 9.0.0 ships **10 Ableton Device Objects** (Compressor, Limiter, Reverb, Roar, Drift…) + **55 DSP objects** usable in patches *(verified 3-0)* — prototype GLUE/SPACE/DRIVE on these, move hot paths to `gen~`.

### 6.4 Keeping the promise under arbitrary routing
The flexibility creates two risks; both are handled:
1. **Feedback runaway** (feedback→distortion→resonance can scream / blow to DC). → **Self-limiter baked into the feedback loop**: soft saturator + hard gain cap (<1). At max feedback into max drive it collapses into a *musical drone*, never a screech. The "no bad values" promise survives even a feedback patch.
2. **Stride's fixed param order** (positional injection). → **Structure is hand-built; the param *list* never reshuffles.** `Drive` is always param index N regardless of where it sits in the audio path. Routing is encoded as its own dedicated, fixed params (slot order, lane assignment, split point) — *appended, never inserted.*

> **Sub-decision (flag if you disagree):** **routing structure is hand-set, not a Stride automation lane** — you can't smoothly automate "swap slot 2 and 4." But **Parallel Blend, Feedback Amount, per-slot Mix** *are* Stride lanes. So Stride morphs the *continuous* character of whatever chain you built. (A "morphable routing" mode is a possible v2.)

**"Evolves to something unique":** a Stride preset slowly sweeping Feedback Amount → Drive → Parallel Blend → Space over 8 bars transforms the sound continuously without ever breaking. That's the headline demo.

### 6.5 FX engine: Ableton native (ABL objects) + gen~ — hybrid (DECIDED 2026-06-11)

Max 9 ships **ABL objects** — patchable versions of Live Suite's real devices. The 12 `abl.device` objects map almost 1:1 onto our modules, so we use Ableton's actual engines where it already nails the sound:

| Module | ABL object engine |
|---|---|
| RESONATE | **Spectral Resonator** (modern Corpus-class) |
| DRIVE | **Roar** (multiband saturation/distortion, many modes) |
| CRUSH | **Redux** (bitcrush / downsample) |
| MOTION | **Echo** (feedback delay) |
| GLUE | **Compressor + Limiter** |
| SPACE | **Reverb** |

**Hybrid rule:** ABL objects for the "Ableton already nailed it" modules above; **`gen~` for the safety-critical DSP** — the voice filter, the self-limited feedback loop, the wavefolder — where the "can't blow up" guarantee and custom behavior must be ours. **Every ABL module is wrapped behind our curated macros** — the macro drives the native device along a tamed, auto-makeup'd path; *Stride never sees a raw Ableton param.*

**Caveats (verified — affect distribution):**
- ⚠ **Min Live version.** ABL objects exist only in the Max bundled with recent Live (Max 9 era) → TENDRIL likely requires **Live 12.1+** (narrower than Stride's "Live 11+"). Lock the floor before committing.
- ABL objects ship with the Max that comes with M4L, which every TENDRIL customer already has — so it's a *version* floor, not an extra *edition* cost.
- ⚠ **`mc.` (multichannel) ABL variants are NOT licensed for M4L distribution** — use standard ABL objects only.
- ABL params are not modulation-safe by default → the curated-macro wrapper is mandatory, not optional.
- *(TENDRIL is also a normal Live device, so users can always chain their own Ableton FX after it.)*

### 6.6 Filter & distortion types (selectable)

Both are **curated type selectors**, with the continuous amount knobs as the Stride-automatable, modulation-safe macros:

- **Filter types** (one multimode filter, built in `gen~` for safety — bounded resonance, tamed self-oscillation, keytracked):
  `LP 12 · LP 24 (Ladder) · HP · BP · Notch · Peak · Comb · Formant · SVF · Phaser`
- **Distortion types** (DRIVE module — each bounded + auto-makeup + soft-clip ceiling):
  `Tube · Tape · Diode · Wavefold · Foldback · Hard Clip · Sine · Asym · Roar Multiband`
  *(Roar mode exposes several of these via the ABL object's own modes.)*

**Modulation-safety + Stride rule (consistent with routing §6.4):** the **Type** is a discrete selector → **hand-set, Hidden from Stride**. The **continuous** controls (Cutoff, Reso, Drive, Character) *are* Stride lanes. A continuous *morph-between-types* mode is a possible v2 if type itself should be automatable.

---

## 7. The Macro Parameter Surface (the Stride contract)

This is the **most important integration artifact.** Stride targets parameters by **`envelope_index` = their position in the param list** (`alc-generator.js:228`; the v1.2.0 misroute regression proves ordering is load-bearing). So TENDRIL must expose a **fixed, never-reordered, human-named** parameter list.

**Proposed v1 macro list (fixed order — this IS the API).** Grown to cover dual osc + cross-mod + modular-FX continuous controls. Order is frozen; new params append only.

```
 GLOBAL            OSC A              OSC B              CROSS-MOD
  0 Pitch           4 A Tone(X)       11 B Tone(X)       18 FM Amount
  1 Glide           5 A Body(Y)       12 B Body(Y)       19 Ring Amount
  2 Filter Cutoff   6 A Air(Z)        13 B Air(Z)        20 Sync
  3 Filter Reso     7 A Bank          14 B Bank          21 Sub Level
                    8 A Level         15 B Level         22 Noise Level
                    9 A Octave        16 B Octave
                   10 A Fine          17 B Fine

 SPECTRAL          FX MODULE MACROS              FX ROUTING (continuous)   META
 23 Density        29 Resonate    35 Glue Amt    41 Parallel Blend         45 Macro 1
 24 Comb           30 Reson Tune  36 Space Size  42 Feedback Amount        46 Macro 2
 25 Fold           31 Drive       37 Space Mix   43 ── reserved ──         47 Macro 3
 26 Tilt           32 Drive Char  38 Motion Fb   44 ── reserved ──         48 Macro 4
 27 Formant        33 Crush       39 Motion Time
 28 Warp           34 Crush Rate  40 Amp Env Mod
```

> **Structural / selector params** — slot order, lane A/B assignment, split point, per-slot bypass, **Filter Type** (§6.6), **Distortion Type** (§6.6) — are **separate, hand-set, and Hidden from Stride** (discrete, not smoothly automatable). They live after index 48, append-only. Stride sees only the ~49 **continuous, modulation-safe** macros above. *(Note: Osc A/B **Bank** is a continuous crossfade morph axis (indices 7/14), so it stays a Stride lane — not a hidden selector.)*

**Rules for the contract:**
- **Stable order forever.** New params append at the end, never insert. (Protects Stride's positional injection.)
- **Reserved slots** so future features don't reshuffle indices.
- Each param sets correct **min/max** and **`is_log`** (Stride reads these — `scanner_max.js`), with log-scaling on frequency-type params (Cutoff, Tune, Time).
- Clean **Long Names** (Stride displays these), unique within the device. Research **verified**: Live identifies params by unique Long Name; both Long Name and Scripting Name must be unique. *(3-0.)*
- **Macro 1–4** are user-assignable meta-macros (each maps to a curated bundle of DSP targets) — these are the *most* fun Stride targets: one lane transforms the whole patch.
- Internal modulation params Live doesn't need automated → set to **"Hidden"** state to avoid undo-history flooding (research **verified** the three states: Automated&Stored / Stored Only / Hidden). Only the curated ~28 macros are **Automated & Stored** → exactly the clean list Stride's "Scan Mapped" flow wants.

> This makes TENDRIL's "Scan Mapped" result in Stride a perfect, curated, ~28-lane palette — no junk params, no misrouting, every lane musical.

---

## 8. UI / UX — Serum-class, inside M4L

You called M4L UIs "small and not so intuitive." We fix that.

### 8.0 The size constraint and how we beat it (VERIFIED)
- **In Ableton's device strip, every device is locked to 169px tall.** Width is free; height is not. *(verified — Cycling '74 M4L UI docs / production guidelines.)* This is the "small/unintuitive" trap.
- **M4L can open a separate floating, resizable window of any size** (up to near-fullscreen). It **must be set to floating mode**, or opening it kicks Live out of fullscreen. *(verified — Cycling '74 M4L UI docs.)*

> **Engineering call — two-tier UI:**
> | Tier | Where | Contents |
> |---|---|---|
> | **Compact** | 169px device strip | shrunk cube viz + ~28 macro knobs (wide layout) + **"Open"** button; fully usable; this is what Stride's glow-sync animates |
> | **Full** | floating resizable window (near-fullscreen) | the Serum experience — big animated cube, macro rings, Macro 1–4 assign, spacious FX rack |
>
> Because the UI is **one HTML5/jweb canvas, it renders responsively in both tiers** — build once, reflow for the size. (A native-Max-object UI would force two hand-built layouts; the web-UI path is the decisive advantage here.)

**VERIFIED options:**
- **Max 9 `v8`/`v8ui`** — modern ES6+ JavaScript via the V8 engine, with multitouch/pen support, for custom drawn UI. *(verified 3-0; caveat: multitouch/pen currently Windows-only.)*
- **Embedded HTML/web UI via `jweb`** — bidirectional (Max→page via `executejavascript`; page→Max via `window.max.outlet()` / `window.max.bindInlet()`). *(verified 3-0.)*
- **Known caveat (VERIFIED):** HTML files **cannot load into `jweb` in a *frozen* M4L device**, even in Max 9 — requires the `executejavascript`-injection workaround after `onloadend` (the `h1data/M4L-jweb-injection` pattern). *(verified 3-0.)*

> **Engineering call:** Build the UI as an **embedded HTML5 canvas web UI via `jweb`** — for three reasons: (1) it gives us true Serum-class visuals and animation; (2) **we already have deep in-house HTML5-canvas expertise** — Stride's entire `canvas.js` drawing engine (2,187 lines) and skin system are exactly this stack; (3) it lets TENDRIL **share Stride's Patchbay visual language** (vintage charcoal #161616 + copper/amber, the `data-skin="patch"` skin). Plan for the frozen-device injection workaround from day one (it's a known, solved pattern).

**UI concept — "the Tendril core":**
- **Center:** a large, living visualization of the wavetable cube — a glowing 3D-ish blob/filament that morphs in real time as TONE/BODY/AIR and the spectral macros move. *This is the "fun like Serum" centerpiece* and it makes Stride modulation **visible** — you watch the sound evolve.
- **Ring of macros** around the core (synth on top, FX on bottom), big copper knobs, each labeled, each glowing brighter as it's modulated.
- **Stride-aware glow:** when Stride is automating a parameter, its knob pulses with the lane color — so the UI *shows* the injected motion. Strong cross-product magic, low effort.
- **Macro 1–4 assignment** via simple drag, like Ableton macros.

---

## 9. Why "every knob is good" actually works under Stride

Walk the failure modes from §1 and how TENDRIL closes each:

| Generic-synth failure | TENDRIL's guarantee |
|---|---|
| Silent zones | Cube morph & equal-power FX mixes never reach silence; oscillator always full-bodied |
| Harsh/painful zones | Bounded Q, soft-clip ceilings, hard-capped feedback, auto makeup gain |
| Detuned/inharmonic | Pitch/resonator keytracked & quantized; humanization bounded to cents |
| Discontinuities | Every macro is a *curated continuous curve* through DSP space (the Marbles model) |
| Level explosions | Per-stage loudness compensation → modulating brightness/density/drive holds perceived level |
| Zipper noise on fast lanes | All macros slew-smoothed in `gen~` (per-sample) |

Result: **Stride "shooting in the dark" lands somewhere good every time.** That's the demo that sells both products.

---

## 10. Stride Integration (deep)

TENDRIL is a *first-class Stride citizen*, reusing the existing protocol (`shared/message-types.js`):
- **Scan:** Stride's `request_scan` / `scan_mapped` → TENDRIL's fixed ~49-macro list returns clean (id, name, min, max, value, is_log). No junk, no reshuffle.
- **Inject:** Stride's `apply_inject` (StrideInject direct-inject, Stride 2.0's headline) writes curves straight onto TENDRIL's params in the selected clip. Because params are stable-ordered, **no misrouting**.
- **Visual feedback loop (new, optional):** TENDRIL could subscribe to the same WS bus (`localhost:9100`) so its UI glows in sync with the lanes Stride drew. Lightweight, huge "wow."
- **Curated Stride presets that ship with TENDRIL:** factory `.stride`/session files that demonstrate evolving 8/16-bar transformations — instant gratification, and a marketing asset.

**Parameter-count practicality:** research could not verify a hard upper bound on automatable `live.*` params per device, but ~49 curated continuous macros is comfortably within normal M4L practice. Stride's "Scan Mapped" can return all of them, and its UI can group by section (Global / Osc A / Osc B / Cross-mod / Spectral / FX) so the lane list stays navigable.

---

## 11. Technical Architecture (recommended)

```
TENDRIL.amxd  (Max for Live instrument device)
│
├─ UI layer ............ jweb → HTML5 canvas (shares Stride's skin/engine)
│                        ↕ window.max.outlet / bindInlet  (frozen-device JS injection)
│
├─ Param layer ......... ~49 live.* continuous macros, fixed order, Automated&Stored
│                        structural/routing params → Hidden; smoothing in gen~
│
├─ Voice engine ........ poly~ (8 voices) → each voice = voice.gen~
│     voice.gen~:        OSC A (wave op, 4×4×4) ┐
│                        OSC B (wave op, 4×4×4) ┼ → FM/Ring/Sync → spectral stage
│                        + Sub + Noise          ┘   (fold/comb/tilt/formant/warp) →
│                        zero-bad filter + amp env
│
├─ FX builder .......... 6 gen~ modules routed by matrix~ (reorder + 2 parallel
│                        lanes + feedback w/ self-limiter); Max 9 ABL/DSP objects
│                        for prototyping. RESONATE/DRIVE/CRUSH/MOTION/GLUE/SPACE
│
└─ Bridge (optional) ... WS client → localhost:9100 for UI glow sync with Stride
```

**Stack decisions:**
- **DSP core:** `gen~` (verified: per-sample feedback via `history`/Z⁻¹ is the foundation for oscillators/filters/resonators — impossible in vector MSP without C++). *(3-0.)*
- **Polyphony:** `poly~` × 8 (verified path), MC as fallback.
- **Spectral:** time-domain `gen~` (path B) for v1; additive/IFFT (path A) as v2 mode after CPU benchmarking.
- **FX:** hybrid — Max 9 **ABL objects** (Roar/Redux/Echo/Reverb/Spectral Resonator/Comp+Limiter) as the engine for those modules, **`gen~`** for the filter, feedback self-limiter, and wavefolder. All wrapped behind curated macros. Filter & distortion **type selectors** (§6.6).
- **UI:** `jweb` HTML5 canvas, Patchbay skin, frozen-device injection pattern.
- **Build/release:** mirror Stride's pipeline — Win local build, Mac via CI from a `v*` tag (per `feedback_mac_win_build_parity`).

---

## 12. Modulation-Safety Engineering Playbook

*(The "how." Items marked ⚠ are engineering best-practice from my experience — the research explicitly could NOT verify the general parameter-design literature beyond the Mutable/Marbles model, so treat these as proposals to validate in prototyping, not cited facts.)*

1. **Curated continua, not raw params** *(verified model: Marbles).* Each macro = a hand-tuned curve through multi-target DSP space. No exposed raw DSP value.
2. **Perceptual scaling** ⚠ — frequency params log/exponential (`is_log`), amplitude in dB, time tempo-synced. A linear 0–1 lane maps to a *perceptually even* sweep.
3. **Equal-power / equal-loudness crossfades** ⚠ — all mix/morph blends; loudness-compensate brightness/density/drive so modulation never changes level.
4. **Bounded everything** ⚠ — Q ceilings, feedback < 1.0 + internal limiter, soft-clip output ceiling, detune in cents. No range reaches pain or silence.
5. **Keytracking & quantization** ⚠ — resonator/formant/pitch track the played note and snap to scale where musical → never out of key.
6. **Per-sample smoothing/slew in `gen~`** ⚠ — kills zipper noise on fast Stride lanes (`gen~` is the right place; per-sample).
7. **Progressive quantization for discrete params** *(verified model: Marbles STEPS)* — anything stepped (crush bits, rhythmic comb) eases between values instead of hard-switching.
8. **Bounded humanization** ⚠ — subtle per-voice variance so even static settings feel intentional.
9. **Self-stabilizing feedback** ⚠ — the FX feedback loop (§6.4) contains a soft saturator + hard gain cap (<1) so *any* user routing — even feedback→distortion→resonance — collapses into a musical drone instead of a screech or DC blow-up. This is what lets us keep "no bad values" while still giving the user free, reorderable, parallel, feedback routing.
10. **Bounded cross-modulation** ⚠ — FM index, ring depth, and sync are all keytracked and range-limited so the dual-osc interaction stays harmonically rich but never detunes or aliases into garbage.

> Net: the *instrument* enforces musicality so Stride never has to — even when the user hand-builds an aggressive feedback chain.

---

## 13. Naming

**Name: TENDRIL** (chosen 2026-06-11). An organic, mythic, "living-and-evolving" word that captures the instrument's character — a sound that reaches, grows, and responds as Stride modulates it. Soft/archaic (Tolkien-register) feel that's distinctive and ownable, and pairs cleanly with Stride in copy ("Stride + Tendril"). Chosen over earlier candidates "Ember" (not a synth name) and "Spectra" (already used by several audio products).

**Availability:** quick web search (2026-06-11) found **no existing synth / VST / Max for Live device named Tendril** — clear in the music-software space (an unrelated energy/IoT company and a band side-project exist, but nothing in plugins). ⚠ A formal trademark search is still recommended before any storefront/marketing commit.

---

## 14. Risks & Open Questions

**From the research caveats (honest gaps):**
- ⚠ **Spectral resynthesis unverified.** No source confirmed concrete real-time `pfft~`/`ioscbank~` IFFT resynthesis details. → De-risked by shipping time-domain path B in v1; prototype path A separately.
- ⚠ **No CPU benchmark survived verification + the engine just got heavier.** The dual-osc + FM/Ring/Sync decision roughly doubles per-voice cost, and the `matrix~` FX router + parallel lanes + feedback add more. gen~+poly~ voice cost in M4L on Live 12 is qualitative only. → **First milestone must be a CPU spike test** of the *full* voice (2 osc + xmod + spectral) at 8 voices, plus the FX router, before committing to voice count / MC vs poly~. This is now the #1 schedule risk.
- ⚠ **Max-level feedback latency.** The reorderable/parallel FX router introduces a ~64-sample vector delay on Max-level feedback paths. Musically fine for delay/feedback FX; P0 must confirm, else the feedback loop moves entirely inside one `gen~`.
- ⚠ **Param-design literature unverified** beyond Marbles. The §12 playbook is engineering judgment → validate by ear in prototype.
- ⚠ **Frozen-device `jweb` injection** is a real, known friction (verified). → Build the injection pattern in from day one; budget time for it.
- ⚠ **Max 9 dependency.** v8ui multitouch is Windows-only today; `jweb` web UI is cross-platform and the safer base.

**Product risks:**
- ⚠ **ABL-objects raise the min Live version to ~12.1+** (vs Stride's Live 11+). Smaller addressable base. → Acceptable for a premium companion, but confirm the exact Max-bundled-with-Live version that includes the ABL objects we use, and state the requirement clearly on the store page. Fallback: build those modules in `gen~` to drop the floor (more DSP work).
- Scope creep toward "Serum competitor." → Hold the line: TENDRIL is *curated*, not infinite. Fewer knobs is the feature.
- Two-product support burden. → Reuse Stride's UI engine, skin, build pipeline, and WS bus to minimize net-new surface.

---

## 15. Phased Roadmap

| Phase | Deliverable | Gate |
|---|---|---|
| **P0 — Spike** | full gen~ voice (2 osc + FM/Ring/Sync + spectral) + CPU benchmark at 8 voices in M4L on Live 12; quick matrix~ feedback-latency test | CPU headroom acceptable? choose poly~ vs MC; confirm feedback path |
| **P1 — Core synth** | 8-voice dual-osc + cross-mod + path-B spectral + zero-bad filter/amp; osc/spectral macros exposed, fixed order | sounds musical across *full* range of every macro |
| **P2 — Stride loop** | Scan Mapped returns clean list; StrideInject writes curves with zero misroute; factory Stride preset evolves over 8 bars | the "modulate everything, always good" demo works end-to-end |
| **P3 — Modular FX** | 6 gen~ modules + matrix~ router (reorder + 2 parallel lanes + self-limited feedback); all modulation-safe & loudness-compensated | full ~49-macro surface; feedback→distortion patch stays musical |
| **P4 — UI** | jweb HTML5 canvas, Patchbay skin, living cube viz, Stride-sync glow | "fun like Serum" bar met |
| **P5 — Polish/ship** | presets, install flow (reuse Stride installer), Win build + Mac CI tag, store page | premium feel; bundle/pricing live |
| **v2 (later)** | additive/IFFT spectral mode (path A), user wavetables, more macros (appended) | — |

---

## 16. Success Metrics

- **Musicality:** ≥95% of random full-range Stride injections rated "usable/musical" in blind internal testing (the core promise — measure it).
- **No misroutes:** 100% correct param targeting across multi-macro Stride presets (the v1.2.0 regression must never recur).
- **CPU:** 8 voices + full FX under a defined budget on a mid-tier machine (set number after P0 spike).
- **Commercial:** attach rate of TENDRIL to Stride buyers; bundle conversion.

---

## Appendix A — Verified research foundation (citations)

All claims below survived 3-0 adversarial verification against primary sources.

- **gen~ is the right DSP core** — per-sample design + single-sample feedback via `history`/Z⁻¹, otherwise needs C++. *(Cycling '74 gen~ overview; Wakefield interview; C74 filtering tutorial.)*
- **Modulatable multi-axis wavetable morph is feasible in gen~** — `wave` operator + 3×3×3 cube, trilinear morph via 8 readers. *(Cycling '74 "Winter's Day gen~: The Wavetank".)*
- **Polyphony** — `poly~` (copies + auto voice-alloc) and MC (single patcher + busy-map CPU savings). *(Cycling '74 poly~ / MC docs.)*
- **Modulation-safe design precedent** — Marbles STEPS progressive quantizer + SPREAD distribution continuum. *(Mutable Instruments docs.)*
- **Max 9.0.0 (~Oct 30 2024)** — 10 Ableton Device Objects + 55 DSP objects for the FX rack. *(Cycling '74 release notes; CDM; KVR.)*
- **Serum-class UI** — Max 9 v8/v8ui (ES6+), and jweb bidirectional web UI; frozen-device HTML must be JS-injected after onloadend. *(Cycling '74 release notes / v8ui / jweb docs; h1data/M4L-jweb-injection.)*
- **Parameter exposure** — `live.*` params identified by unique Long Name; three visibility states (Automated&Stored / Stored Only / Hidden); Bipolar mode for Float, Absolute for Int; modulation off by default. *(Ableton M4L production guidelines; Cycling '74 Live Parameters docs.)*
- **Shipping proof** — k-devices TERRA: 8-voice wavetable synth as M4L using additive-generated interpolated wavetables (medium confidence; Max 7, not gen~). *(k-devices; Ableton blog.)*

## Appendix B — Open questions to resolve in prototyping
1. Measured CPU/voice limits for gen~ cube+spectral+FX in M4L on Live 12 (poly~ vs MC). *(P0 gate.)*
2. Real-time additive/IFFT resynthesis viability (`pfft~`/`ioscbank~`) for the path-A v2 spectral mode.
3. By-ear validation of the §12 modulation-safety playbook beyond the Marbles model.
4. Practical upper bound on automatable `live.*` params per device that Stride should respect.
