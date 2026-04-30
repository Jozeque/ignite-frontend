# StrideQuick POC — half-day recipe

The math layer is locked and tested (45/45 green in `test/test-stridequick-poc.js`). What's left for the POC is to wire up a single-voice Max for Live patcher and verify:

1. `live.remote~` receives audio-rate samples from a `buffer~` and modulates a real Live parameter
2. Modulation sounds **identical** to a `.alc` playback of the same preset
3. `phasor~ @lock 1` cleanly resets at bar 1.1.1 across stop/start
4. No CPU spikes, no transport drift across loop boundaries

If any of these fail, the StrideQuick architecture is dead and we go back to the drawing board. **Don't proceed to Phase 1 until all four pass.**

## Setup before opening Max

```bash
cd stride-vst
node m4l-quick/node/emit-poc-buffer.js sine 4 120
```

This writes `stride-vst/m4l-quick/stride_q_poc.wav` — a Float32 mono 44.1 kHz file containing 4 bars of sine modulation log-scaled to filter cutoff range (20–20000 Hz).

In Ableton:

1. Create a new MIDI track
2. Add Operator (or any synth) → add a stock **Auto Filter** after it
3. Drop a 4-bar MIDI clip with a sustained note (or run a simple bassline loop)
4. Set tempo to 120 BPM (matches the WAV we generated)

## Build the device

1. Create a new M4L Audio Effect device on the same track as Auto Filter (any track works — `live.remote~` targets by id, not by track).
2. Open in Max editor.

### Objects to wire (in this order)

```
[buffer~ stride_q_buf 4 1 @file stride_q_poc.wav]
   ↑ buffer named stride_q_buf, 4 sec capacity, mono, preloaded with our WAV

[phasor~ @lock 1 @rate 1n]                    ← syncs to Ableton transport, period = 1 bar
[*~ <bars-as-samples>]                        ← scales 0..1 phasor to 0..bufferLength samples
[play~ stride_q_buf]                          ← reads buffer at audio rate
[live.remote~]                                ← writes signal to a Live parameter

[live.path]                                   ← captures user-clicked param's id
[live.text "Map" @mode toggle]                ← Map button — toggles capture
```

### Wiring

```
phasor~ @lock 1 @rate 1n   (1-bar phasor synced to transport — for 4-bar loop set @rate 4n)
       ↓
[*~ 176400]                (buffer length in samples = 4 sec * 44100; for 4 bars at 120 = 8 sec * 44100 = 352800)
       ↓
[play~ stride_q_buf 1]
       ↓
[live.remote~]   ← right inlet receives id from live.path
       (no outputs needed — modulation goes directly to the param)


[live.text Map] → toggles ON →
   [live.path live_set view selected_parameter]
       ↓ id <n> on right outlet
   → right inlet of [live.remote~]
   → also display the param name on a [live.text] for visual confirm
```

### Critical inspector settings

- `phasor~ @lock 1`: enable "Sync to Live Transport"
- `live.remote~`: set "Use Persistent Mapping" in the inspector
- Audio Status (Live preferences): turn ON "Scheduler in Overdrive" and "in Audio Interrupt" for tight timing

## Test sequence

### Test 1 — basic chain
1. Press Map button in your device
2. Click the **Cutoff** knob on Auto Filter (the device should show "Cutoff" or similar)
3. Press Map again to lock the binding
4. Press Play in Ableton

**Expected:** Cutoff sweeps in a sine pattern, completing one full cycle per bar (so 4 cycles over the 4-bar loop). The .wav has 4 cycles; with `phasor~ @rate 1n` doing one full cycle per bar, you'll hear 1 sine cycle per bar.

If you don't hear modulation, the buffer~ isn't loaded or the live.remote~ isn't bound. Use `print` boxes on outputs to debug.

### Test 2 — fidelity vs .alc
1. In the canvas app, draw a Sine preset on the same Cutoff param. 4 bars. Apply → drag the .alc into the clip
2. Hit Play → record the audio output (e.g. resample track)
3. Now disable the .alc clip's automation envelope (so the cutoff is back to manual control)
4. Re-enable StrideQuick (the POC device)
5. Hit Play → record the audio output

**Expected:** The two recordings sound audibly identical. If they don't, the rasterizer or scaling has drift — debug before proceeding.

A spectrogram comparison is the gold standard. Even just A/B blind ear test is sufficient to validate.

### Test 3 — transport reset behavior
1. Press Stop in Ableton mid-loop
2. Press Play

**Expected:** Phasor immediately resumes at bar 1.1.1 (start of buffer), not where it left off. If it drifts, `phasor~ @lock 1` isn't configured correctly.

### Test 4 — CPU + drift
1. Open Live's CPU meter
2. Loop the 4-bar clip for 30 seconds
3. Watch for CPU spikes or audible drift

**Expected:** Steady CPU baseline (one `live.remote~` should be <1% on any modern machine). No drift across loops — should stay phase-locked indefinitely.

## What to report back

After running through all four tests, paste me:
- Test 1: "modulates / doesn't modulate"
- Test 2: "sounds identical / sounds different — describe difference"
- Test 3: "resets cleanly / drifts"
- Test 4: "steady / spikes / drifts" + CPU % observed

If all four pass, we proceed to Phase 1: full StrideQuick.amxd build with `poly~` voices, auto-mapping from rack scan, full preset menu, and edit sliders.

## Rebuild the WAV with different presets

The `emit-poc-buffer.js` script accepts other presets:

```bash
node m4l-quick/node/emit-poc-buffer.js pump 4 120
node m4l-quick/node/emit-poc-buffer.js sine 8 100
```

For now only `sine` and `pump` are implemented in `shared/generators.js` — the others (Chaos, Bloom, Weave, Mutate, Glitch, Groove Build, Chaos LFO, Neuro) land in Phase 1. Sine is enough to prove the chain works.

## Common gotchas

- **buffer~ shows zero waveform after [replace]** — make sure the WAV path is absolute, or that Max's working directory contains it. Drag-and-drop into the buffer~ inspector is the most reliable.
- **live.path emits two ids when targeting an M4L param** — known quirk. Take the second id. (Not relevant when targeting Auto Filter Cutoff, which is a stock device.)
- **Frozen tracks suspend the device** — modulation pauses. Unfreeze to test.
- **Testing with USB audio interface buffer >256** — adds latency to the modulation; not a correctness issue, just less responsive feel.
- **Param doesn't auto-bind on first Play** — toggle Map off and back on, or save & reload the device.
