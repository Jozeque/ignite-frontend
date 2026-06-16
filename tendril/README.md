# TENDRIL

A premium wavetable + spectral synthesizer built as a **Max for Live device (DSP core in `gen~`)**, purpose-built to be modulated by **Stride** — every parameter is a curated, modulation-safe continuum, so injecting dozens of automation lanes never scrambles the sound.

**Companion to Stride. Not an AI tool — a sound design instrument.** (No AI/ML mentions in any UI or copy, per project rule.)

- **Spec:** [`../docs/prd-stride-instrument.md`](../docs/prd-stride-instrument.md)
- **UI design ref:** [`../docs/tendril-ui-mockup.html`](../docs/tendril-ui-mockup.html)
- **Build it (visual):** [`BUILD-GUIDE.html`](BUILD-GUIDE.html) ← **start here** — open in a browser; Max-style patch diagrams + A→Z steps, do **P0** first
- **Build it (text reference):** [`BUILD-IN-MAX.md`](BUILD-IN-MAX.md) — same recipe in markdown

## What's in this folder (all the code you need *before* opening Max)
| File | What it is | State |
|---|---|---|
| `tendril-params.js` | The ~49-macro parameter contract — source of truth for the `live.*` objects and the UI. **Order is the Stride API; append only.** | done |
| `data/gen-wavetables.js` | Node script → `tendril_wt_a.wav` + `tendril_wt_b.wav` (two 64-frame 4×4×4 cubes). | done, runs |
| `gen/tendril_voice.genexpr` | Per-voice DSP: dual cube morph, FM/Ring/Sync, sub/noise, spectral stage, multimode SVF filter. Paste into a `codebox` in `gen~`. | core solid; some bits tagged `ITER:` |
| `gen/tendril_fx_feedback.genexpr` | Self-limited feedback loop so "feedback → distortion" can't blow up. | done |
| `ui/tendril-ui.html` | jweb UI — auto-builds knobs from the contract, animated wavetable, Max bridge (`window.max`). Opens in a browser too for design. | done |
| `node/tendril-bridge.js` | Optional Node-for-Max client → Stride (`localhost:9100`) to glow knobs while Stride injects. | done, optional |
| `BUILD-GUIDE.html` | **Visual** A→Z assembly guide — Max-style patch diagrams (objects, inlets/outlets, audio vs control cords), inspector callouts. Open in a browser. | done |
| `BUILD-IN-MAX.md` | Thin-patcher assembly recipe + P0 spike (text version of the visual guide). | done |

## How the build works
Think of it like Stride itself: the **brains are text files** (GenExpr DSP, JS, HTML) I/you can edit freely; the **`.amxd` is a thin shell you assemble once in Max** from `BUILD-IN-MAX.md`, then we iterate by editing the text and reloading. The only thing that *must* happen in the Max editor is wiring the patcher (audio DSP can't run in `node.script`).

## Quick start
```
cd tendril/data && node gen-wavetables.js     # 1. make the wavetables
# 2. open Max, follow BUILD-IN-MAX.md → P0 (single voice, hear it, check CPU)
# 3. expand to dual-osc poly, params, FX, UI — iterating on the genexpr by ear
```

## Status
Spec + full code scaffold complete. **No Max device built yet** — that's the next step (P0 gate = CPU at 8 voices). Everything here is meant to be auditioned and tuned in Max; the `ITER:`/`VERIFY:` tags mark exactly where.
