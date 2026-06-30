# Stride Wrapper — M0 / M1 spike

Milestones M0 + M1 from `docs/stride-wrapper-vst3-spec.md`. A JUCE VST3 that
**hosts another synth inside itself** and modulates one of its parameters from a curve.

> **M0** proved the hosting engine with a native panel. **M1** swaps the UI for a **JUCE WebView**
> (the "same UI code" path — the exact pattern Tendril ships), driven over the raw
> `window.__JUCE__` bridge, reusing Tendril's vendored WebView2 SDK. The page (`ui/index.html`)
> is a minimal self-contained UI that proves the WebView + bidirectional bridge end-to-end;
> the full `canvas.js` port is **M1b**. The engine underneath is unchanged from M0.

## What it proves
1. A JUCE VST3 can host another VST3 (e.g. Serum) **inside a real DAW**.
2. We can enumerate the hosted synth's parameters (names + count).
3. We can drive **one** of those params from a curve — here a **bar-synced sine LFO** (proves we read the host transport).
4. We can open the hosted synth's **own GUI**.

If Serum's cutoff knob wiggles in time in Ableton, the wrapper thesis holds and we proceed to M1.

## What it intentionally is NOT (later milestones)
- **M1:** the real UI — reuse `canvas.js` in a JUCE WebView. (M0 uses a crude native panel.)
- **M2:** out-of-process plugin scanner, project state save/restore, the fixed macro bank for "bake to DAW automation", smoothing + block-splitting.
- **M3:** AUv2 (Logic), macOS signing/notarization, cross-DAW/synth QA.

## Prerequisites
- Windows + **Visual Studio 2022** ("Desktop development with C++" workload).
- **CMake 3.22+** (you already have it for Tendril — `C:\Program Files\CMake\bin`).
- Internet for the **first** build only (FetchContent pulls **JUCE 8.0.13**, shallow).
- An **x64 VST3 synth** installed (e.g. Serum at `C:\Program Files\Common Files\VST3\`).
  > Arch must match: this builds **x64**, so load an **x64** synth. (Arm/Intel mismatch handling is a later decision — spec §16.)

## Build
```sh
cd stride-wrapper/m0-spike
cmake -S . -B build -G "Visual Studio 17 2022" -A x64
cmake --build build --config Release
```
Artefacts:
- `build/StrideWrapperM0_artefacts/Release/Standalone/Stride Wrapper M0.exe`
- `build/StrideWrapperM0_artefacts/Release/VST3/Stride Wrapper M0.vst3`

> JUCE pin is newer than Tendril's 8.0.4 **on purpose** — VST3-hosting-VST3 only links
> after a ~Oct-2025 fix. Override with `-DSTRIDE_JUCE_TAG=<tag>` if ever needed.

## Test

**Quick (standalone, no DAW):**
1. Run `Stride Wrapper M0.exe`.
2. **Load Synth** → pick your synth's `.vst3` (e.g. `…\Common Files\VST3\Serum.vst3`).
3. The synth name + its parameter list appear. Pick a param (e.g. *Cutoff*).
4. Tick **Modulate**, click **Open Synth UI** → the chosen knob should sweep (free-running LFO; no MIDI needed to *see* it move). The on-panel "LFO:" readout confirms the engine is running.

**Real proof (Ableton, bar-synced):**
1. Point Ableton at the build's `VST3` folder (Preferences → Plug-Ins → add the folder to VST3 search paths) or copy the `.vst3` into `C:\Program Files\Common Files\VST3\`, then rescan.
2. Add **Stride Wrapper M0** to a MIDI track; **Load Synth** → Serum; pick *Cutoff*; tick **Modulate**.
3. Drop a MIDI clip, press play → the cutoff sweeps **one cycle per bar**, locked to the transport. Open **Synth UI** to watch the knob.
4. (Optional) A/B the sweep against today's M4L inject for fidelity.

## Notes / known M0 rough edges
- `COPY_PLUGIN_AFTER_BUILD` is **off** (a DAW holding the `.vst3` would fail the copy) — point the DAW at the build folder instead.
- The `.vst3` you load may be a **folder bundle** on Windows; the file picker allows selecting folders.
- If a synth fails to load, check the debug log (`DBG` line "Stride M0: load failed"). Most failures are arch mismatch or a non-instrument plugin.
- Native UI here means the WebView keyboard-focus caveat (spec §5/§14) does **not** apply yet — that surfaces in M1.
