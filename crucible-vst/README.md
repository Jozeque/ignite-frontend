# CRUCIBLE — bass spectral-morph synth + character forge (VST3)

The JUCE/C++ port of the M4L gen~ prototype in `crucible/`, extended with the
multi-FX chain from `docs/crucible-multifx-spec.md` plus research additions.
Every gen~ module was translated 1:1 (same coefficients, same smoothing, same
curves) so the sound is the M4L device — then the forge was built around it.

## Signal architecture

```
8 voices: OSC A + OSC B (base wave sine/tri/square/saw as a
   harmonic bed under each anchored morph vector; per-osc vol +
   power; bipolar FM A↔B as per-partial phase modulation)
   → ADSR → modal bank                                       ── per voice
   └→ sum ── dry tap (MIX anchor, soft-bounded)
       → FILTER (Serum-style TPT SVF: LP12/LP24/BP/HP/Notch,
           visual + draggable response curve)               [new]
       → DRIVE v2 (6 shaper types + morph + mix; FOCUS
           filter drives only Low/Band/High, visual)        [reworked]
       → GRIND (3-band crush + band-OTTs)                   [M4L port]
       → METAL (keytracked comb bank, string↔bell)          [new]
       → [+ loop inject] → SWARM (parallel moving filters)  [new]
       → DELAY (sync: free ms or 1/1..1/32 dotted/triplet
           from host BPM, ping-pong, damped feedback)       [new]
       → SHIMMER VERB (8-line FDN, +octave in feedback)     [new]
       → OTT ×6 series chain (density)                      [M4L port]
       → loop tap → COLOR SVF (LP→BP→HP) → FREQ SHIFTER
           (±12 Hz barberpole) → bound → FB delay → inject  [new]
       → WIDTH (sub-mono Haas, LR2 @200 Hz, ≤47 ms)         [new]
       → TILT EQ → SOFT-CLIP → MIX → GAIN → out
```

DRIVE v2 types: Saturator (M4L tanh) · Overdrive · Downsample · Rectifier ·
Asym (M4L diode) · HardClip — arrows pick the type, MORPH blends continuously
into the next type on the circle. OSC adds FRACTAL: a second phase-locked rip
lattice (odd-multiple window count) on top of RIPS. The AMP envelope graph is
directly draggable (attack / decay+sustain / release handles).
SWARM replaced the tonal delay (the TonalDelay struct is parked in Fx.h,
still unit-tested, for an easy return): the dry path is never touched — four
moving filters add a panned parallel layer, killed entirely by MIX 0 or the
section power. A source snapshot of v1.0 lives in `_revert-v1.0/`.

Also inside: Lorenz-attractor **MOVE** (drifts morph, loop color, delay time,
verb mod) and a fixed cross-coupling matrix (input transients open the shaper;
reverb tail ducks delay feedback; loop energy darkens repeats; silence blooms
the shimmer; density leans on the output clip). Every loop is bounded:
saturator + damping + DC block + 120 Hz bass anchor (sub never loops).

72 host-automatable params (51 knobs + 6 choices + 9 stage toggles + 5 mode
bools + gain) — knobs are all 0..1 like the M4L live.dials, Stride-drivable. The OSC section adds two bin-domain manipulations beyond the
M4L: **DRIFT** (per-harmonic amplitude breathing — the spectrum evolves on its
own, fundamental exempt) and **STRETCH** (bipolar partial stretch, organ
cluster ↔ bell inharmonicity, exact harmonic lock at center).

## Layout

| Path | What |
|------|------|
| `src/dsp/` | Pure-std DSP (no JUCE): voice, morph table, FX chain |
| `src/PluginProcessor.*` | JUCE glue: synth voices, param registry, scope rings |
| `src/PluginEditor.*` | WebView2 editor: params + 30 Hz frame push (scopes/meters) |
| `ui/crucible_webui.html` | The entire UI (embedded via BinaryData, offline, Outfit font) |
| `test/Tests.cpp` | Headless suite — parity, bounds, soaks, state roundtrip |

## Build

```
cmake -S . -B build -G "Visual Studio 17 2022" -A x64 ^
  -DFETCHCONTENT_SOURCE_DIR_JUCE="<repo>/tendril/build/_deps/juce-src"
cmake --build build --config Release
build\CrucibleTests_artefacts\Release\CrucibleTests.exe   (exit 0 = green)
```

- JUCE 8.0.4 via FetchContent (the `-D` above reuses Tendril's checkout; omit
  it to clone fresh).
- WebView2 SDK is referenced from `../tendril/3rdparty/webview2`.
- Artifacts: `build/Crucible_artefacts/Release/VST3/Crucible.vst3` and
  `.../Standalone/Crucible.exe`.
- Install: copy `Crucible.vst3` into `C:\Program Files\Common Files\VST3`.

## UI notes

- The melt window's heat (ember → white-hot) tracks the real feedback-loop
  energy; the chain rail below it is the live architecture diagram.
- OUT / WAVE / BOTH chips switch the scope between the output trace and the
  1-cycle morph shape (the gen~ display-phasor trick, ported).
- Bottom of the melt: audition keys (click/drag, or A–L computer keys).
- The standalone opens every MIDI input automatically (rescans every ~2 s for
  hot-plugged keyboards); inside a DAW the host routes MIDI as usual.
- Open `ui/crucible_webui.html` in a browser to preview the UI with fake data;
  a rebuild embeds it (the exe will NOT pick up HTML edits without one).

## Identity (do not change once shipped)

`PRODUCT_NAME Crucible · PLUGIN_CODE Crcb · MANUFACTURER Ptby` — these form the
VST3 FUID; changing them orphans saved DAW projects.
