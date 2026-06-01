# Prism — Feature Brief

*A creative-mode feature for Stride: draw one curve, watch the rack respond as a coordinated spectrum of variants.*

## In one sentence

Click **Prism**. Pick a lane. Start drawing. **Every other unlocked lane in your rack responds in real time** — with the same per-bar peaks and valleys as your source curve, but with wildly different paths between them.

## The mental model

Think of a band hitting the downbeat together. Every musician lands the kick at the same beat, but each one fills the space between with their own voice — the bass plays a slide, the synth stutters, the pad swells. Same rhythmic skeleton, eight different personalities.

In Prism Mode, the **anchors are the downbeats**: the highest and lowest point of your source curve in each bar. Every variant lane shares those exact anchors, in the same X/Y position. The **paths between** are what change per lane — different shapes, different motion, different personality.

Result: the rack breathes together (everything peaks at the same beat), but every parameter takes a unique journey to get there.

## How it feels to use

```
You drag a slow ramp upward across 4 bars on the Filter Cutoff lane.

What happens in real time on the other 13 lanes:

  Reverb Send:    inverts your ramp — fades down as you fade up
  Delay Feedback: same ramp but stuttered — glitchy steps to the same peak
  Drive:          drifts — random walk that lands on your peaks at the
                  right moments but wanders unpredictably between
  Pan:            steps — hard hops to the same anchor values, no smooth
  Wavefolder:     smooth super-curve — same anchors, ultra-glassy bezier
  Chorus Depth:   mirror + mutate — chaotic counterpoint
  ...etc, each with its own personality
```

You release the mouse. Hit **Reroll** if you want a different mix of personalities. Hit **Commit** to save it. Hit **Cancel** to revert the variants and keep the source you drew.

## Why this is the move

Every Stride producer hits the same wall: "I have 14 mapped parameters and I want all of them to be doing something. But I don't want to draw 14 different curves manually."

Today's tools cover edges:
- **Chaos** fills every lane with random shapes — too random, no coordination
- **Bloom** spreads one curve across lanes with subtle variations — coordinated but predictable
- **Manual drawing** — full control but slow and laborious

Prism hits the sweet spot: **coordinated chaos**. The peaks land together (musical coherence). The paths diverge (sonic interest). One gesture from you produces a rack-wide motion that would take 20 minutes to draw lane-by-lane.

## The 8 personalities

Each variant lane gets one personality at random when you enter the mode. Reroll re-shuffles them.

| Personality | Vibe |
|---|---|
| **Mirror** | Counterpoint — when source goes up, variant goes down |
| **Mutate** | Generative variations — random subdivisions, smooth interpolation |
| **Mutate + Mirror** | Chaotic counterpoint |
| **Stutter** | Glitch automation — micro-steps between anchors |
| **Smooth** | Pad-style swell — ultra-smooth bezier between anchors |
| **Step** | Sample-and-hold — hard jumps, no interpolation |
| **Drift** | Organic, "human hand" feel — random walk between anchors |
| **Chase** | Time-shifted — variant peaks slightly off the beat from source |

For racks with more than 8 lanes, personalities cycle. For ≤8 lanes, each gets a unique personality.

## Diversity slider

A single knob that controls the personality intensity:

- **0%** — variants are subtle modifications of the source. Mutates barely mutate. Stutters are gentle. Smooth + Drift are minimal.
- **50%** (default) — full personality differentiation, but proportions feel musical.
- **100%** — maximum chaos. Variants barely resemble the source between anchors. For FX-heavy sound design.

## Sound-design parallels (for the modular synth crowd)

For producers who think in modular terms, the mechanic maps cleanly to existing patches:

| Modular concept | Prism analog |
|---|---|
| Multiple LFOs at the same rate, different waveforms | Same anchors, different personalities per lane |
| Polyphonic voice fanout with per-voice CV processing | One source CV, per-voice modulation |
| Quantizer + sample-and-hold chain | Anchors are the quantized steps; in-between is the random hold |
| Voltage-controlled envelopes triggered together | Same triggers, different shape parameters per lane |
| Multitap delay with modulated taps | Source = dry signal; variants = differently-modulated wet copies |

## Use cases

**Pad design.** Source = volume swell. Variants = filter cutoff + delay feedback + reverb send + chorus depth. All swell together, but each takes a unique path. Result: a pad that breathes coherently but feels alive in 5 different dimensions.

**Bass design.** Source = filter cutoff sweep. Variants = resonance + drive + sub amount. All hit the bass drop at the same beat, but each parameter ramps in its own way.

**FX chain motion.** Source = dry/wet macro. Variants = decay + diffusion + feedback + pre-delay. All FX peak together at the chorus, but each takes a different ramp shape.

**Drum bus design.** Source = tape stop curve. Variants = pitch + grain + HP filter + bit-crush. Crash together at the drop, with wildly different paths.

## What this replaces

Prism **replaces Weave** in Stride's GENERATIVE section (Chaos / Bloom / Prism). Weave's chase + fill metaphor never connected with how producers think about multi-lane motion. Prism does.

## Headline copy

When this lands:

- **Tagline:** "Draw one. Watch the rack respond."
- **Hero pitch:** "Your filter peaks. Your reverb responds. Your delay drifts. Your pan stutters. All from one curve."
- **30-second YouTube short:** record one ramp being drawn, watch the rack respond live. The visual + sonic synchronization will be the wow moment that sells the product to producers who haven't considered Stride yet.

## Status

Phase 1 shipped 2026-05-04 — all 8 personalities + live-draw mode + UI + 55 unit tests passing.

---

*Stride — sound design engine for Ableton Live.*
*[stridehub.io](https://stridehub.io)*
