# Stride FX — audio-effect variant of the wrapper (SHIPPED)

**Status: BUILT 2026-08-31.** Backlogged 2026-08-26, then pulled forward by a field
request (Malek) that named the exact gap. Built as specced below, with two decisions
taken on the day:

- **VST3 only.** The AU effect identity (aufx + a new frozen code) needs its own auval
  gate on both slices, so it is a follow-up rather than a rider on the first ship. Live,
  Bitwig, Reaper, Cubase are served on Win and Mac today; Logic FX is the known gap and
  the shipped README says so.
- **In the SAME zip, no extra charge** (Yossi). One license, one download, two plugins.
  license.json is a shared path and nothing is plugin-code bound, so the key and the 24h
  Discovery Pass both carry across with no backend change.

Verified on the built bundles, not just in source: Stride FX declares Sub Category "Fx"
with UID ...53774678, Stride still declares "Instrument","Synth" with ...53774D30.
Pinned by `stride-vst/test/test-stride-fx.js`.

The original feasibility notes follow, unchanged, because they are why this was cheap.

## The ask (Yossi's framing)

Stride VST is a VST3 *instrument*, so on a MIDI track it occupies the instrument slot:
Stride and Operator replace each other. Audio-effect VST3s (FabFilter etc.) sit *after*
Operator instead. Wanted: the same Stride as a proper audio-effect unit that can live in
a chain WITH Operator — hosting VST3 effects, and (via StrideBridge) modulating the
native devices around it. "An addition for Ableton freaks." Nothing that ships changes.

## Findings (verified in source, 2026-08-26)

1. **Zero `isSynth` dependencies in the code.** `grep JucePlugin_IsSynth|isSynth src/` = empty.
2. **The bus layout is already effect-shaped**: `strideBuses()` = stereo "Audio In" +
   stereo "Output", unconditional on every format since 1.3.4 (PluginProcessor.cpp:79).
3. **processBlock already IS an effect**: the hosted chain processes the I/O buffer IN
   PLACE (chain[i].inst->processBlock(buffer, ...), node 0 gets the MIDI); the 1.2.0
   comment states it verbatim: *"an EMPTY Stride behaves as unity gain — a routed guitar
   stays audible while the user builds the FX chain."* Empty chain = clean passthrough.
   The only `buffer.clear()` fires when a host disables the input bus outright.

**Conclusion: the FX variant is a pure CMake change.** A second `juce_add_plugin` target
sharing every source file:

```cmake
juce_add_plugin(StrideWrapperFx
    PRODUCT_NAME  "Stride FX"                 # separate .vst3 filename, separate browser entry
    COMPANY_NAME  "Stride"
    BUNDLE_ID     io.stridehub.wrapper.fx
    PLUGIN_MANUFACTURER_CODE Strd
    PLUGIN_CODE   SwFx                        # NEW code — never touch the frozen SwM0
    FORMATS       VST3                        # v1: VST3-only; AU later = aufx + its OWN frozen triple
    IS_SYNTH      FALSE                       # -> VST3 category Fx -> Live lists it under Audio Effects
    NEEDS_MIDI_INPUT TRUE                     # keyswitches / Notes mode via Live's MIDI-To routing
    ... rest identical to StrideWrapperM0 ...
)
```
plus duplicated `target_sources` / `target_compile_definitions` / `target_link_libraries`
(link the SAME `StrideWrapperM0Data`), `target_include_directories` monocypher.

## Open items for the build day

- **Identity rule**: SwM0/Strd/aumu stays frozen; SwFx is a NEW frozen-once-shipped triple.
  Mac AU variant = `AU_MAIN_TYPE kAudioUnitType_Effect` (aufx) — decide before first Mac ship.
- Title bar / UI says "Stride" (shared BinaryData) — cosmetic; optional tiny gate later.
- License: product-scoped Ed25519 "vst" entitlement + machine device-hash — nothing
  plugin-code-bound was found; expected to Just Work. Verify demo pass shares cleanly.
- CI: second target in the workflow; zip naming per the LS rule (updater matches
  VST3+platform tokens — think before naming, see project_ls_download_naming_confusion).
- StrideBridge coexistence: both variants connect :9102 as separate clients; lane
  ownership is already owner-scoped, nothing to do.
- Test: struct test asserting the target block exists + IS_SYNTH FALSE + code SwFx.

Est: ~half a day including CI + install script, given the findings above.
