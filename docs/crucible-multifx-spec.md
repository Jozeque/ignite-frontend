# CRUCIBLE — 20-knob character monster (spec)

*Working name. Stride's mark is a flask: a crucible is where you melt something
down and reforge it into something better. Rename freely.*

## Vision
One device you drop on **any** sound that **always sounds like a banger**, and
where **a tiny move changes everything**. Not a surgical tool, a character
engine: parallel distortion, bounded feedback loops, tonal delays, reverb
crushed through OTT, all behind 20 high-level knobs that each fan out to a
*constellation* of parameters. Built to be **driven by Stride**, a small Stride
motion on a couple of knobs = huge, coordinated, evolving movement, because each
knob is wired to many things and the feedback/nonlinearities multiply it.

Two goals, treated as hard engineering constraints, not vibes:

1. **It can't sound bad** — every knob position, at every input, is musical.
2. **It's hyper-responsive** — small changes in the input signal *or* the knobs
   cascade into big timbral shifts.

These two pull against each other (sensitivity usually means you can blow it up).
The architecture is specifically designed to get both at once.

---

## Principle 1 — why it always sounds good (the guarantees)
Built-in safety nets, every one of them load-bearing:

- **A dry/parallel anchor that never leaves.** The clean signal is always present
  in parallel with the mangled branches, so there's always a musical core under
  the chaos. You can't fully destroy the source.
- **Saturation is harmonic enrichment, not just clipping.** Every distortion
  stage *adds* harmonics (fattening, presence) before it ever sounds harsh.
- **OTT/glue re-levels everything.** After the parallel mess + reverb, multiband
  up/down compression pulls it into one dense, cohesive, loud, "expensive" whole.
- **An output soft-clip limiter.** The last block before the wet/dry can never
  hard-clip, so the output always sounds *finished*, mastered, not broken.
- **Tuned macro ranges + curves.** Knobs don't expose raw params; they're mapped
  through ranges/curves that simply **never reach the ugly zones**. The bad 20%
  of every parameter's range is engineered out.
- **Bounded feedback.** A saturator sits inside every feedback loop, so runaway
  is impossible, the loop screams musically and then *clamps* instead of blowing
  up.
- **A final tilt EQ** keeps the overall spectral balance pleasing no matter what
  the dirt did.

## Principle 2 — why small tweaks explode (the sensitivity engines)
The same five mechanisms that make it *alive* under Stride also make it react
hugely to small input changes:

- **Feedback loops (highest gain).** Near the edge of self-oscillation, a tiny
  change in input level or a 1% knob nudge cascades through the loop into a big
  tonal shift. This is the headline engine.
- **Nonlinearities amplify difference.** Waveshaping/folding/crushing turn small
  amplitude differences into large harmonic differences.
- **Resonance near self-oscillation.** A filter parked near max resonance turns a
  small cutoff change into a dramatic timbral jump.
- **Cross-coupling.** Knobs fan out to many params, and the stages feed each
  other (delay→feedback→distortion→delay), so one small move ripples everywhere.
- **Upward compression surfaces detail.** OTT's upward stage lifts quiet tails,
  grit, and feedback artifacts into audibility, so subtle input changes become
  loud, obvious gestures.

---

## Signal architecture

```
 IN
  │
  ▼
 INPUT  ── DRIVE (gain into the dirt) · TILT (shape what gets distorted)
  │
  ▼
 ┌──────── PARALLEL DISTORTION ────────────────────────────┐
 │  DRY ───────────────────────────────────────────┐ (anchor)
 │  A: soft saturation  (pre-filt → shaper → post)  │
 │  B: wavefold / clip   (pre-filt → fold  → post)  │  blended
 │  C: bitcrush/decimate (pre-filt → crush → post)  │  by COLOR
 └──────────────── sum ◄───────────────────────────┘
  │
  ▼
 FEEDBACK NODE  ◄──────────────────────────────┐  (global loop injects here)
  │                                            │
  ▼                                            │
 TONAL DELAY  (tuned time · filtered+saturated feedback)
  │                                            │
  ▼                                            │
 REVERB  (size/decay · modulated · shimmer)    │
  │                                            │
  ▼                                            │
 OTT  (3-band up/down comp) ◄── reverb feeds straight in (density)
  │                                            │
  ├──── tap ──► FB GAIN ─► FB FILTER ─► FB SAT ─► short delay ─┘
  │            (FEEDBACK)   (FB TONE)  (bounding)   (FB TIME)
  ▼
 OUTPUT  ── TILT EQ ─► SOFT-CLIP LIMITER ─► DRY/WET ─► OUT
```

**Stages:**
- **Input** — drive into the distortion (this is where the harmonics are born) +
  a tilt to choose what frequency content gets mangled.
- **Parallel distortion** — three characters at once (soft warmth / hard fold /
  digital crush), each with its own pre-filter (so they chew different bands) and
  post-filter (to tame), plus the untouched **dry** in parallel. `COLOR` balances
  them. This is the core tone.
- **Global feedback node** — where the bounded feedback loop re-injects. Wrapping
  the distortion+delay in feedback is the chaos/sensitivity engine.
- **Tonal delay** — a delay with its time snapped to musical intervals so the
  repeats are *pitched/resonant*, and a **filter + saturator in the feedback
  path** so each repeat evolves (darker, grittier). This is where it gets alive.
- **Reverb** — size/decay/diffusion, lightly modulated, optional shimmer
  (pitched octave in the tail).
- **OTT** — the reverb feeds **straight into** a 3-band up/down compressor. This
  is the trick: a reverb wash through OTT becomes dense, pumping, huge, modern.
  Also the master glue for the whole parallel mess.
- **Output** — tilt EQ → soft-clip limiter (the "always finished" safety) →
  global dry/wet → out.
- **Feedback loop** — a tap (post-OTT) → `FEEDBACK` gain → `FB TONE` filter →
  bounding saturator → `FB TIME` short delay → back to the feedback node. In MSP
  this is realized with `send~`/`receive~` + `tapin~`/`tapout~` (a signal cycle
  needs at least a one-sample delay to break it).

---

## The 20 knobs

Each knob is a **character**, not a raw param, and fans out to several targets
with tuned curves. (Targets in parentheses are the constellation each one drives.)

**DIRT**
1. **DRIVE** — input gain into the parallel distortion. (input gain ↑, post-filters open slightly to stay bright, output safety tightens.)
2. **COLOR** — crossfade the three distortion characters. (soft ↔ fold ↔ crush blend; the "tone of the dirt".)
3. **BIAS** — waveshaper asymmetry. (even↔odd harmonic balance; *high-sensitivity*, small move = big timbre change.)
4. **FOCUS** — which band gets mangled. (pre-distortion filter sweep: low chew ↔ high sizzle.)
5. **CRUSH** — digital grit. (bitcrush/decimate depth + branch-C blend.)

**FEEDBACK**
6. **FEEDBACK** — the global loop gain. (the chaos; near max = edge of oscillation; lowers input slightly to make room + nudges OTT density to glue it.)
7. **FB TONE** — loop filter cutoff. (sets the resonant pitch/character of the feedback.)
8. **FB TIME** — loop delay. (metallic comb at short ↔ rhythmic chaos at long.)

**DELAY**
9. **DELAY** — delay send/mix.
10. **TUNE** — delay time, snapped to musical intervals. (tonal/pitched delay.)
11. **REPEATS** — delay feedback. (filtered+saturated loop = evolving repeats.)
12. **DECAY COLOR** — tone/sat of the repeats. (each pass darker + grittier.)

**SPACE**
13. **SPACE** — reverb size/decay + mix. (the wash; feeds the OTT harder as it grows.)
14. **SHIMMER** — reverb pitch/modulation. (octave shimmer + tail movement.)
15. **OTT** — multiband up/down depth. (density + glue + pump on the reverb→OTT path.)
16. **SQUEEZE** — OTT band tilt + makeup. (bright/dense ↔ dark/glued character.)

**SHAPE**
17. **TILT** — global tone. (dark ↔ bright master tilt EQ.)
18. **MOVE** — internal LFO depth. (subtle animation of filters/delay so it's alive even *without* Stride; Stride then amplifies it.)
19. **MIX** — global dry/wet. (**the safety anchor** — always keep the source.)
20. **OUTPUT** — level + soft-clip drive. (louder/squashed/"finished" the harder you push.)

## Cross-coupling (the "alive" wiring)
- **FEEDBACK + FB TONE + FB TIME** near max = the device on the edge; this is
  where tiny *input* changes become huge. Park here for evolving textures.
- **DRIVE** raising also opens post-filters and tightens output safety, so it
  never just gets muddy/loud, it gets *brighter and tighter* as it dirties.
- **SPACE** feeding **OTT** harder as it grows = the wash always densifies into a
  banger instead of washing out.
- A single Stride lane on **DRIVE**, **FEEDBACK**, and **TUNE** at once =
  explosive, coordinated motion, because each fans out and the feedback multiplies.

---

## Implementation

The architecture above is platform-agnostic. Three ways to realize it, with an
honest recommendation.

### A) MSP / Max objects — fast architecture prototype
- **Distortion:** `overdrive~`, `clip~`, `degrade~`, waveshaping via `lookup~` + `buffer~` (custom transfer curve for the fold/asymmetry).
- **Filters:** `lores~`, `reson~`, `biquad~`/`cascade~` (multimode, `filtergraph~` for curves), `comb~`.
- **Parallel:** native — fan a signal to N branches, `*~` per-branch gain, `+~` to sum. `COLOR` is just crossfade gains.
- **Delay:** `tapin~`/`tapout~` (tuned taps + feedback loop with a filter + `overdrive~` inside).
- **Reverb:** `freeverb~` or `gigaverb~` (or a hand-built FDN for more control).
- **OTT:** built from primitives, 3-band split (filters) → per band: envelope follower (`average~`/`slide~` on the rectified signal) → gain computer (threshold/ratio math, up + down) → `*~`. The most "from parts" piece.
- **Feedback loops:** `send~`/`receive~` + a `tapin~`/`tapout~` (≥1 sample) to legally break the cycle; the bounding saturator lives in the loop.
- **20 macros:** `live.dial` ×20 → a scaling/mapping layer (`scale`/`zmap` per target, or a small JS that holds the curve tables) → the DSP params.
- **Reality:** fully buildable, **no compile** (I author the `.maxpat`, you load
  it), but it's a *large* patch and `freeverb~`/`overdrive~` are "fine," not
  boutique. Great for nailing the **architecture + macro feel** quickly.

### B) `gen~` — for the gnarly core
The feedback loop, the waveshapers, and the OTT are cleaner and better-sounding
written sample-level in `gen~`. Downside: it compiles only inside Max, so every
tweak needs you to test it for me — a slow loop (this is exactly why Tendril left
gen~).

### C) JUCE / VST3 — recommended for the keeper
This is a **monster**, and DSP quality is the whole point of "always a banger."
In JUCE I get a real reverb/limiter/compressor, *and* I compile + test myself
(fast iteration), *and* it ships to every DAW, not just Ableton. The architecture
ports 1:1, and you already have the Tendril build pipeline. **Recommendation:**
prototype the architecture + macro feel in **MSP** (fast, validates the "banger +
sensitive" concept), then build the real thing in **JUCE** reusing Tendril's
setup.

---

## Stride synergy (the reason this is *yours*)
The device is the instrument; **Stride is the performance.** Because every knob
fans out to a constellation and the feedback/nonlinearities multiply, Stride's
Chaos/Neuro/Prism curves on just a few knobs produce massive, coordinated,
evolving character that would take dozens of automation lanes by hand. The
device + Stride is the pitch: *one rack, one Stride pass, an entire sound design
session's worth of movement.*

## Build plan
- **P0 — MSP architecture prototype:** the signal chain + 4-5 of the 20 knobs,
  to feel the "banger + tiny-tweak-explodes" character. Validate fast.
- **P1 — Full 20-knob macro tuning:** the constellations + ranges/curves; this is
  where "always sounds good" is actually won or lost.
- **P2 — Decide platform:** if it's a keeper, port to JUCE (quality + iteration +
  every-DAW); otherwise polish in MSP.
- **P3 — Stride presets:** ship Stride curve presets tuned to the device's knobs.
