# Stride VST3 — Host Automation (expose hosted params to Ableton + record modulation)

**Status:** SPEC (not built). 2026-07-01.
**Goal:** Let the user automate the hosted synth's knobs from *inside Ableton* — either by
drawing automation on them in Ableton, or by recording Stride's drawn modulation into an
Ableton automation lane so it's "printed" into the project.

---

## 1. Why it's not possible today

Stride hosts the synth INSIDE itself (a VST3 can't touch a sibling plugin in the DAW chain).
So the hosted params live inside Stride, invisible to Ableton. And `StrideWrapperProcessor`
currently declares **no parameters at all** (`getNumPrograms()==1`, zero `addParameter`).
Ableton therefore sees Stride as a plugin with nothing to automate.

Today's modulation path:
```
canvas curve -> live_curves -> setDriveCurves -> driveLanes
processBlock: for each driveLane -> hostedParam->setValue(interp(curve, playhead))   // direct, host-invisible
```

## 2. Core idea — a MACRO parameter layer

Stride publishes a **fixed pool of its own VST3 parameters** ("macros"). VST3 fixes the
parameter list at load, so it must be a fixed count, relabeled dynamically as params are
mapped. Ableton sees these macros, can show them (Configure mode), automate them, and
record onto them.

```
Ableton automation  <->  Stride MACRO param i  <->  hosted param (node, param)
```

- **Count:** `kMacroCount` = **32** (compile-time constant). Unassigned macros are inert +
  hidden in Ableton's Configure view. (Open question: 32 vs 64 — see §12.)
- **Stable IDs:** macros get fixed VST3 param IDs 0..31. Adding them does NOT change the
  plugin identity (FUID = PRODUCT_NAME/PLUGIN_CODE/mfr), so existing projects still load;
  it's an additive change.
- **`MacroParameter`** = a `juce::AudioProcessorParameter` subclass:
  - holds an atomic normalized value (0..1),
  - `getName()` returns the assigned label ("Serum: Cutoff") or "Stride 7" when free,
  - on (re)assignment, calls `updateHostDisplay(...withParameterInfoChanged())` so Ableton
    re-reads the name (VST3 kParamTitlesChanged). **RISK: validate Ableton picks up dynamic
    names live — some hosts cache; may need a device reload. Spike this first (§11).**

## 3. Mapping -> macro slot assignment

Mapping is unchanged for the user (touch a knob in learn mode). Internally, when a param is
mapped it **claims the next free macro slot**:

```
struct Macro { int node=-1, param=-1; Source source=Stride; };   // node<0 == free
std::array<Macro, kMacroCount> macros;
```
- On map (`mapParam`): find a free macro, set its {node,param}. Relabel + updateHostDisplay.
- On unmap (`removeMappedAt`): free the macro (node=-1). Its Ableton automation goes inert.
- If all 32 are taken, extra mapped params still work in Stride but are NOT exposed to
  Ableton (surface a "32/32 exposed — unmap one to expose more" note in the panel).
- Assignment is keyed by the stable (node, param), NOT the `mapped` index, so unmap-reindex
  (the per-lane x) doesn't shuffle Ableton's automation onto the wrong knob.

## 4. Modulation modes — the ONE real design decision

A drawn curve and Ableton automation can't both drive the same knob each block. So each
lane has a **source**:

- **`Stride`** (default = today's live behavior): `processBlock` applies the driveLane curve
  to the hosted param. The macro MIRRORS the value (`macro->setValue(v)`, no host-notify) so
  Ableton's display follows, but Ableton automation on that macro is IGNORED.
- **`Host`** (Ableton drives): `processBlock` reads the macro's current value (set by Ableton
  automation/manual) and forwards it to the hosted param. The driveLane curve is IGNORED for
  that param.

```
processBlock, per mapped param:
  if source == Stride:  v = interp(curve, playhead);  hosted->setValue(v);  macro->setValue(v)   // mirror
  if source == Host:    v = macro->getValue();         hosted->setValue(v)                        // Ableton drives
```

Granularity: **per-lane** toggle (flexible — bake some lanes, keep others live) with a global
"switch all" convenience. (Open question §12: per-lane vs a single global Live/Automation
switch.)

## 5. Record-to-Ableton (the "print the modulation" flow) — Phase 2

Turns a drawn curve into real Ableton automation:

1. User marks a lane (or all) to bake + arms Ableton's automation recording + presses Play.
2. While transport runs, Stride drives that macro via **`setValueNotifyingHost`** so Ableton
   captures the movement into the macro's automation lane.
3. On stop, the lane auto-flips to **`Host`** source. Now Ableton's recorded automation drives
   the macro -> hosted knob. The curve is "printed"; Stride no longer needs to drive it.

**Thread-safety (critical):** `setValueNotifyingHost` must NOT be called from the audio thread.
Drive the record from a **message-thread timer** (~60 Hz): it reads the current transport
beats (a shared `std::atomic<double>` written by processBlock), computes `interp(curve, beats)`,
and calls `macro->setValueNotifyingHost(v)`. processBlock keeps doing only plain `setValue`
for audio. Ableton records automation at its own rate; 60 Hz is plenty.

## 6. Persistence

Add to `getStateInformation` (XML `STRIDE_WRAP`), backward-compatible (missing = defaults):
- `MACROS`: per slot -> {node, param, source}. So assignments + modes survive save/reload.
- Ableton persists its OWN automation on the macros (in the project), independent of Stride.
- Bump a state `version` attribute now (pending TODO from the persistence memo) so future
  state changes migrate cleanly.

## 7. UI (canvas / panel)

- **Per-lane source toggle:** a small badge on each exposed lane — e.g. dim = `Stride` (live),
  lit `A` = `Host` (Ableton drives). Click to flip. (Sits alongside lock / focus / unmap-x.)
- **"Record to Ableton"** action: per-lane "-> Ableton" button (bakes that lane) and/or a global
  "Bake to Ableton" that arms all Stride-source lanes.
- **Exposure note** in the panel: "N/32 params exposed to Ableton. Click Configure on the
  Stride device in Ableton to automate them."
- Lanes that are `Host`-driven render read-only-ish (their curve is inert) with an "AUTO" tag.

## 8. Ableton-specific behavior + risks to validate (spike before building)

- **Seeing the params:** Ableton shows VST3 params via the device's **Configure** button (click
  Configure, then wiggle the macro to add it), or the generic param list. Confirm the macros
  appear with their relabeled names.
- **Dynamic names:** confirm `updateHostDisplay` makes Ableton re-read a macro's name when it's
  (re)assigned, without a full device reload. **Highest-risk item — spike first.**
- **Recording:** standard Ableton automation-arm + Play; verify `setValueNotifyingHost` from the
  timer lands in the lane, and that there's no write/read feedback loop (Stride writes during
  record; Ableton writes during playback; never both on the same lane at once — the mode
  guarantees this).
- **Param count:** 32 extra params is fine for Ableton; unused hidden via Configure.

## 9. What each phase delivers

- **Phase 1 — Expose + automate** (macros + assignment + relabel + Host mode + per-lane toggle):
  you can draw/automate the hosted knobs *in Ableton* and Ableton drives them. Answers "show
  them as configured parameters so the user can automate them."
- **Phase 2 — Record/bake** (host-notify timer + auto-flip to Host): captures Stride's drawn
  modulation into an Ableton automation lane. Answers "record that modulation into a lane."

Phase 1 is independently useful and lower-risk; Phase 2 builds on it.

## 10. Files to touch

- `stride-wrapper/m0-spike/src/PluginProcessor.h/.cpp` — `MacroParameter` class + pool,
  assign/free on map/unmap, `source` per macro, processBlock branch (mirror vs read), the
  record timer + shared transport-beats atomic, MACROS persistence.
- `stride-wrapper/m0-spike/src/PluginEditor.cpp` — push source/macro state to the canvas in
  `rack_scanned`; handle `setLaneSource` / `recordLaneToHost` events; trigger relabels.
- `stride-vst/app/renderer/canvas.js` + `ui/shim.js` — per-lane source badge/toggle, the
  "-> Ableton" / "Bake" buttons, the exposure note, "AUTO" tag on Host lanes.

## 11. Recommended first step — a 1-day spike

Before the full build, prove the two riskiest unknowns in a throwaway branch:
1. Add ONE hardcoded macro param, assign it to a mapped knob, `setValue` it from Stride's
   curve — confirm it shows in Ableton's Configure and its name updates on assignment.
2. From a message-thread timer, `setValueNotifyingHost` it while Ableton records — confirm the
   automation lands in a lane and plays back correctly.
If both pass, the rest is mechanical (scale to a pool + wire the modes + UI).

## 12. Open questions (need your call)

1. **Pool size:** 32 (default) or 64 (headroom for big chains)? Fixed at compile.
2. **Scope now:** Phase 1 only (automate in Ableton), or Phase 1 + 2 (incl. record/bake)?
3. **Mode granularity:** per-lane source toggle (flexible) or a single global
   Live/Automation switch (simpler)?
4. **Record UX:** per-lane "-> Ableton" buttons, or one global "Bake to Ableton" that works
   with Ableton's record-arm?
5. **Naming in Ableton:** show the real mapped name ("Serum: Cutoff", recommended) or generic
   "Stride Macro N"?
