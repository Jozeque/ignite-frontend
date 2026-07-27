# Stride 1.2.0 — MIDI Keyswitches + Audio Input (decision spec)

Two "playful" features, shipped together as 1.2.0. Revert point: tag `pre-1.2.0` (= e9f39a8,
the 1.1.12 tester build).

## 1 · MIDI keyswitches — play the tools

**What.** Kontakt-style keyswitch octave: with **KEYS** on, MIDI notes 0–7 fire the one-click
tools; the whole bottom octave (0–11) is consumed so the instrument never hears it.

| MIDI | Live label | Action | JS entry |
|------|-----------|--------|----------|
| 0 | C-2  | Chaos     | `sdApplyGlobalChaos()` |
| 1 | C#-2 | Neuro     | `sdApplyGlobalNeuro()` |
| 2 | D-2  | Reflector | `sdApplyGlobalReflector()` |
| 3 | D#-2 | S&H       | `sdApplyGlobalSampleHold()` |
| 4 | E-2  | Prism     | `sdApplyGlobalPrism()` |
| 5 | F-2  | Bloom     | `sdApplyBloom()` |
| 6 | F#-2 | Mutate    | `sdMutate()` |
| 7 | G-2  | Shuffle   | `sdShuffleLanes()` |
| 8–11 | G#-2..B-2 | reserved (consumed, no action) | — |

**Why fixed notes, not user-mapped (the researched decision).**
- Zero-setup and Kontakt-familiar; 8 chromatic notes = one pad row on Push/Maschine.
- Notes live in clips → the performance is **recordable and replayable** — that's the playful
  part (a clip that re-rolls Chaos every 8 bars is now just… notes).
- A knob/CC can't "press" a momentary action naturally (threshold retriggering); values are
  already covered by the 32 host-automation macros. Buttons are note-shaped.
- **Switch octave is selectable** (pulled forward from phase 2 on Yossi's reachability
  question): C-2 (default — below every physical keyboard's last key, zero collision risk;
  pads/clips reach it), C-1, or C0 (hand-reachable on any keyboard, overlaps real bass — the
  user's informed trade since the whole mode is opt-in). Engine `keysBase` attr {0,12,24},
  picker in the KEYS pill's ▾ popover; the legend re-renders from the active base.
- **Phase 2 (deliberate deferral): per-action MIDI-learn remap** for pad users who want a
  custom scatter. The engine protocol (bitmask per offset) already supports it.
- OFF by default, per-project persisted (`keysOn` attr): an existing project with a bassline
  in C-2 can never fire tools uninvited.

**How.** Audio thread filters the instrument's MidiBuffer (allocation-free swap with a scratch
buffer), latches note-on bits in an atomic mask; the editor timer drains at 30Hz and the shim
fires the same JS functions as the toolbar. Triggers while the editor is closed are dropped on
next open (curves are UI-generated; stale replays would be wrong). Drain is gated on the soft
lock (expired pass ≠ free curve generation). Typed QWERTY notes can't collide — their octave
base floors at MIDI 12.

## 2 · Audio input — guitar into the chain

**What.** Stride gains a stereo **Audio In** bus. Build an FX-only chain (skip the instrument)
and Stride is a modulated pedalboard: guitar → hosted VST3 FX chain → every knob modulatable
by drawn curves. With an instrument first in the chain, the input is overwritten — synth
behavior byte-identical.

**Routing per host (the researched part):**
- **Bitwig / Reaper**: track audio flows into an instrument's input natively — put Stride
  after the audio source, done.
- **Ableton Live**: route the guitar track's "Audio To ▸ [Stride track] ▸ Stride" (the same
  routing chooser sidechains use).
- **Standalone**: mic/line input, auto-muted by JUCE until enabled (feedback-safe).
- **Logic (AU): excluded for now.** The aumu identity (`aumu/SwM0/Strd`) is frozen and
  auval-validated; an instrument growing an input changes the validated surface. Audio-in on
  AU ships later behind its own auval-gated pass — `strideBuses()` checks
  `PluginHostType::getPluginLoadedAs()` at construction.

**Semantics.** Empty chain + live input = unity pass-through (a routed guitar stays audible
while you build the chain; synth-only users see silence exactly as before, since nothing is
routed). Hosted-FX main input buses were already enabled by `configureHostedBuses`; the
work-buffer path already carries input channels. Layouts: out = stereo required; in = stereo
or disabled (hosts upmix mono routes).

**Compat risk review.** Bus config is not part of VST3 identity — hosts re-query on load, old
projects reload with the input silent → unchanged sound. AU untouched entirely. The one
behavioral delta: lock-miss/empty blocks pass dry input instead of silence — only audible if
someone routed audio in, which was impossible before 1.2.0.
