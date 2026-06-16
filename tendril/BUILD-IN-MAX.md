# TENDRIL — Build in Max (assembly guide)

This is the **thin-patcher** recipe: all the brains live in the text files in this folder; in Max you assemble a small shell and wire it up. Follow top-to-bottom. Do **P0 first** (one oscillator, hear it, measure CPU) before building the whole thing — that's the gate that de-risks everything.

> Conventions: `[ ]` = a Max object you create. "→" = a patch cord. All param names come from `tendril-params.js` — that file is the source of truth; if you change a name, change it there too.

---

## 0. Prerequisites
- **Live 12.1+ and Max 9** (needed for the ABL objects in §6; until then build FX in gen~ or skip them).
- Generate the wavetables once:
  ```
  cd tendril/data
  node gen-wavetables.js      # writes tendril_wt_a.wav + tendril_wt_b.wav
  ```
- Create a new **Max Instrument** device in Live (Max Instrument, not Audio Effect) and open the Max editor. Save it as `TENDRIL.amxd` somewhere in your User Library.

---

## P0 — Single-voice spike (DO THIS FIRST)

Goal: hear one TENDRIL oscillator and read the CPU meter. ~6 objects.

1. In the device, add `[buffer~ tendril_wt_a tendril_wt_a.wav]` and `[buffer~ tendril_wt_b tendril_wt_b.wav]`. (Put the .wav files next to the device or give full paths. Confirm they load: click the buffer, you should see waveforms.)
2. Add `[gen~]`. Double-click it, delete the default contents, add a `[codebox]`, and **paste all of `gen/tendril_voice.genexpr`** into it. Connect the codebox `out1` to the `[gen~]` outlet.
3. Feed it a test note. Quickest path:
   - `[midiin]`/`[notein]` → `[mtof]` is *not* needed (the genexpr does mtof); the genexpr wants **MIDI pitch on in1**. So: `[notein]` → (pitch) → `[sig~]` → `gen~` **inlet 1**.
   - gate: `[notein]` → (velocity) → `[> 0]` → `[sig~]` → `gen~` **inlet 2**.
   - env: `[adsr~ 5 80 0.7 200]` triggered by the gate → `gen~` **inlet 3**. (adsr~ does the amp envelope; gen~ just multiplies.)
4. `[gen~]` → `[live.gain~]` → device audio out (`plugout~` / the device's output).
5. Add a few `[live.dial]`s, name them (see §4) for `a_tone`, `a_body`, `a_air`, `cutoff`, `reso`, and send them into the matching `gen~` params (Parameter Mode + scripting name does this automatically — see §4).
6. **Play a note.** You should hear a morphing wavetable tone; turn Tone/Body/Air/Cutoff and confirm it's musical everywhere.
7. **Measure CPU:** turn on Live's CPU meter, then jump to §3 to wrap this in `[poly~]` at 8 voices and watch the number. **This is the gate** — if 8 voices (eventually × dual-osc, which this already is) is affordable, proceed; if not, we switch poly~→MC or trim.

> If something is silent: check the buffers loaded, that `in1` carries MIDI pitch (~60), and that `in3` (env) is > 0 while a note is held.

---

## 1. Folder / file map
```
tendril/
  tendril-params.js              source of truth for the param surface
  data/gen-wavetables.js         -> tendril_wt_a.wav, tendril_wt_b.wav
  gen/tendril_voice.genexpr      voice DSP (codebox in gen~)
  gen/tendril_fx_feedback.genexpr feedback self-limiter (codebox in gen~)
  ui/tendril-ui.html             jweb UI (auto-builds knobs, Max bridge)
  node/tendril-bridge.js         optional Stride glow bridge (node.script)
  BUILD-IN-MAX.md                this file
```

---

## 2. Voice patcher
Make the voice reusable for `[poly~]`:
1. New patcher saved as `tendril_voice.maxpat` (this is the per-voice unit).
2. Inside it: `[in 1]` (pitch), `[in 2]` (gate), the `[gen~]`+codebox from P0, `[adsr~]`, and `[out 1]`.
3. Voice allocation: `[thispoly~]` + the gen~; use `[poly~]`'s standard note routing. Mute idle voices via `[thispoly~]` busy flag for CPU.
4. Parameters: the `[live.*]` dials live in the **top-level device**, not the voice — send their values into every voice with `[poly~ ... ]` `target 0, <message>` (broadcast to all voices), or expose params through `pattrstorage`/`parameter` and read in the voice. Simplest start: put the param dials at top level and patch them to `[poly~]` via `[prepend <scriptingname>]` → all voices.

## 3. Polyphony
1. Top level: `[poly~ tendril_voice 8]`.
2. `[midiin]`/`[notein]` → `[poly~]` (note/velocity → voice alloc).
3. `[poly~]` → `[live.gain~]` → output.
4. Watch CPU at 8 voices (the P0 gate). If heavy: try `[poly~ tendril_voice 8 @vs 64]`, reduce partials in the wavetable, or move to MC.

## 4. Parameters → Live & Stride (the contract)
For **every** `stride:true` row in `tendril-params.js`, make one control (a `[live.dial]` is fine) and:
1. Open its inspector. Set **Parameter Mode Enable = on**.
2. **Long Name** = the row's `longName` (this is what Live automation + Stride display).
3. **Scripting Name** = the row's `scripting` (must be unique; matches the `Param` in the genexpr). Tip: turn on **"Link to Scripting Name"** so all three names unify.
4. **Range/Enum** = `min`..`max`, **Type = Float**, **Unit Style** to taste.
5. For `log:true` rows, set the dial **Exponent** so motion is perceptual (e.g. ~3 for cutoff/time). TENDRIL should also report `is_log:true` for these when answering a scan.
6. **Modulation Mode:** Bipolar for Floats, Absolute for Ints (per Ableton's M4L guidelines).
7. **Parameter Visibility = "Automated and Stored"** for all `stride:true` params. This is what makes Stride's `Scan Mapped` return a clean list.
8. **ORDER MATTERS:** Live orders parameters by creation/scripting order. Create them in the **exact index order** of `tendril-params.js` (0,1,2,…) so Stride's positional injection (`envelope_index`) hits the right target. Use the **Parameters** sidebar to verify/reorder. Never insert in the middle later — append only.
9. Selectors (`stride:false`, `ftype`/`dtype`): use `[live.menu]`, set Visibility = **"Stored Only"** (hidden from automation), wire to the gen~ `ftype` / the distortion module.

> Sanity check with Stride: launch Stride, hit **Scan Mapped**, and confirm you get exactly the ~49 named lanes in order, no junk.

## 5. Filter & distortion types
- **Filter type** (`ftype`): the `[live.menu]` value goes to gen~ `ftype` (0..5). The SVF in the voice already switches LP24/LP12/HP/BP/Notch/Peak. (Ladder/Comb/Formant/SVF/Phaser additions = append later.)
- **Distortion type** (`dtype`): drives the DRIVE module (see §6). For the ABL-Roar engine, map `dtype` to Roar's mode; for gen~ distortion, branch the waveshaper by `dtype`.

## 6. FX builder (reorder · parallel · feedback)
Engines: **ABL objects** where Ableton nails it, **gen~** for safety-critical bits.

1. Drop the ABL modules (Max 9): `[abl.device.roar~]` (DRIVE), `[abl.device.redux~]` (CRUSH), `[abl.device.echo~]` (MOTION), `[abl.device.reverb~]` (SPACE), `[abl.device.spectralresonator~]` (RESONATE), `[abl.device.compressor~]`+`[abl.device.limiter~]` (GLUE). *(Use the exact object names your Max version exposes — check the abl.device list. Use standard, NOT `mc.`, variants — those aren't licensed for M4L distribution.)*
2. **Wrap each behind our macro:** the `[live.dial]` for e.g. `fx_drive` drives a curated path into Roar's params (+ auto makeup). Never expose Roar's raw params to Live/Stride.
3. **Reorder + parallel:** route the 6 modules through a `[matrix~]` (inputs = module outs, outputs = module ins) with ramped gains. Slot order = which matrix cells are on. Two parallel lanes = send the split point to two chains, recombine with an **equal-power** crossfade driven by `fx_blend`.
4. **Feedback:** `[gen~]` + codebox from `gen/tendril_fx_feedback.genexpr`. Tap a post-slot point → its `in1`; its `out1` sums back into a pre-slot node. Driven by `fx_fbamt`/`fx_motiontime`. The self-limiter guarantees it can't blow up.
5. Final `[limiter~]`/`tanh` safety on the master out.

## 7. UI (jweb)
1. Add `[jweb @file ui/tendril-ui.html]` sized to the device, **Presentation Mode** on, in the device's presentation rectangle.
2. **page → Max:** the UI calls `window.max.outlet(scripting, value01)`. Route `[jweb]`'s outlet → `[route <scripting> ...]` (or a `[zl]`/`[dict]`-based dispatcher) → scale 0..1 to each param range → the matching `[live.dial]` (use `set $1` to avoid feedback loops).
3. **Max → page:** to echo a param to the UI, send `[jweb]` a message `executejavascript "window.max.... "` — simplest is to use the supported `window.max.bindInlet('set', ...)` already wired in the UI: send `set <scripting> <value01>` into `[jweb]`.
4. **Stride glow:** route `node.script tendril-bridge.js` outlets (`glow`/`glowoff`) into `[jweb]` (the UI listens on the `glow` inlet).
5. **Two-tier:** the strip view (169px) shows a compact subset; the floating window is opened with a `[thispatcher]` "open" message (set the window **floating**, per the UI doc, so it doesn't break Live fullscreen).
6. **Freeze caveat:** when you freeze the device for distribution, jweb can't load HTML directly — use the `executejavascript`-after-`onloadend` injection pattern (search `h1data/M4L-jweb-injection`). Build it unfrozen first; add the injection step before shipping.

## 8. Optional Stride glow bridge
`[node.script tendril-bridge.js]` → connects to `localhost:9100`, lights UI knobs while Stride injects. Requires `ws` available to node.script. Pure cosmetics; safe to skip for P0.

## 9. Ship checklist (later)
- Param order verified against `tendril-params.js` via Stride Scan Mapped.
- CPU acceptable at target voice count.
- Feedback patch (feedback→distortion at max) confirmed it stays musical.
- jweb injection working when frozen.
- Win build local / Mac via CI from a `v*` tag (mirror Stride's pipeline).

---

## What's a scaffold vs solid (so you know where to expect iteration)
- **Solid / should-just-work:** dual cube morph, FM, ring, sub, noise, warp, fold, tilt, SVF filter, the feedback self-limiter, the param contract, the wavetable generator, the UI + bridge.
- **Scaffold / tune-by-ear in Max (tagged `ITER:` / `VERIFY:` in the code):** hard-sync depth, density exciter, comb (`delay()` signature), formant (currently disabled), LP24 cascade, the ABL-macro wrapping curves. These are exactly the things we want to dial in together once you can hear them.
