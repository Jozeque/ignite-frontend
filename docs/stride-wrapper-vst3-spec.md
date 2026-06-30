# Stride Wrapper Plugin (VST3/AU) — Engineering Research & Architecture Spec

**Date:** 2026-06-29
**Author:** CTO research brief (verified against JUCE 8 docs, VST3 SDK, Apple entitlement docs, and shipping prior art)
**Status:** Research / pre-spec. Nothing built. Decisions flagged in §16 before any code.
**Companion docs:** `docs/stride-cross-daw-vst3-research.md` (why "same code" can't be a normal VST3; this doc is the wrapper answer).

---

## 0. Verdict (TL;DR)

**Feasible, and it's a known shipping pattern.** A JUCE plugin that hosts the user's synth inside itself, reads its parameters, and modulates them from drawn curves is exactly what Blue Cat PatchWork, DDMF Metaplugin, Plogue Bidule, PluginGuru Unify, and Kushview Element already do across every target DAW. No DAW or OS fundamentally blocks it.

**The differentiator is wide open.** None of those products offer **hand-drawn automation curves driving a hosted synth's parameters**. Unify is closest (macros + fixed-shape LFOs, no curve editor); Bitwig is the UX gold standard but is permanently DAW-locked. A cross-DAW wrapper powered by Stride's curve engine is genuinely uncontested territory.

**Your UI is reusable as-is.** JUCE 8's `WebBrowserComponent` serves your existing HTML5-canvas `canvas.js` from bundled binary data with no web server and no internet — and **you already ship this architecture in Tendril** (`tendril_webui.html`). The drawing engine is "same code"; only the transport bridge (today's `ws-client.js`/`preload.js`) gets swapped for a JUCE bridge.

**The work is real but bounded.** The core engine is well-trodden JUCE. The time sink is *not* the concept — it's cross-platform code-signing/notarization and per-DAW QA. Plan accordingly.

**Three strategic constraints, decide up front (§16):**
1. Ship **VST3 + AUv2** on desktop — **never AUv3** (an AUv3 app-extension can't host other plugins).
2. **macOS needs one mandatory entitlement** (`disable-library-validation`) or hosting silently fails.
3. **Live-only modulation is the default** (like LFO Tool/Bitwig). "Bake into DAW automation" is an optional, lower-fidelity secondary feature — don't build the product around it.

---

## 1. What we're building

**Stride Wrapper** = a VST3/AU **instrument** plugin. The user loads it on a track, loads their synth *inside* it, and Stride's canvas modulates the synth's parameters live, locked to the host transport.

### User flow (identical in every DAW)
1. Add **Stride** to an instrument track in the DAW.
2. Inside Stride, click **Load** → pick a synth (Serum, Vital, Diva…). Stride now hosts it; the synth's own GUI opens in its own window on demand.
3. The synth's real parameters appear in Stride's UI automatically — **no template, no scan button, no per-synth setup.**
4. Assign params to canvas lanes, draw curves / pick motions (the existing canvas, unchanged).
5. **Press play.** Stride modulates the synth in real time, transport-synced. Editable forever, nothing to "inject."
6. *(Optional)* "Commit to automation" or "Export MIDI CC" for users who want it baked into the DAW's own lanes.

### What this keeps vs. the Ableton product
- **Keeps:** the canvas, the scan-and-draw identity, the curve engine, motions/templates — now cross-DAW and template-free.
- **Changes:** the synth lives *inside Stride* (not as a separate track device), and motion **plays live** instead of being injected into a clip. The "inject curves into your clip, zero MIDI" workflow stays an **Ableton (+ Reaper) exclusive** — a fair differentiator for those platforms.

---

## 2. Reference architecture

```
 ┌──────────────────────────── Stride Wrapper (one JUCE AudioProcessor) ────────────────────────────┐
 │                                                                                                   │
 │   WebView UI (canvas.js, reused)            Modulation engine            Hosted synth             │
 │   ┌───────────────────────┐   native fns    ┌────────────────────┐      ┌──────────────────┐     │
 │   │ HTML5 canvas + tools   │ ◄────────────► │ curve eval per block │ ───► │ AudioPluginInstance│   │
 │   │ (BinaryData, no server)│   emitEvent     │ + SmoothedValue      │ set  │  (Serum, etc.)    │   │
 │   └───────────────────────┘                 │ → hostedParam.setValue│ Value└──────────────────┘   │
 │            ▲                                  └────────────────────┘            │  ▲               │
 │            │ param list / live values                ▲                          │  │ audio+MIDI    │
 │            └──────────────────────────────────────────┘                         ▼  │               │
 │   Fixed bank of N "macro" params (only for optional "bake to DAW automation")   audio out          │
 └────────────────────────────────────────────────────┬──────────────────────────────────────────────┘
   DAW MIDI in ─────────────────────────────────────────┘                              ──► DAW audio out
   (out-of-process signed scanner exe ── builds KnownPluginList cache)
```

**Components:**
- **Hosting core** — one hosted `AudioPluginInstance`, created via `AudioPluginFormatManager::createPluginInstanceAsync()`.
- **Modulation engine** — in `processBlock`, evaluate each lane's curve at the transport position, smooth it, and `setValue()` the hosted param (RT-safe by contract).
- **WebView UI** — `canvas.js` served from `BinaryData` via `withResourceProvider`.
- **Macro bank** — a fixed set of N automatable params, used *only* for the optional bake feature.
- **Out-of-process scanner** — a separate signed executable that builds the plugin list so a bad synth can't crash the DAW.

---

## 3. The hosting core

**Instantiate** (message thread, async):
- `AudioPluginFormatManager` + non-member `addDefaultFormatsToManager()` *(the member `addDefaultFormats()` was removed in JUCE 8.0.9 — pin to current JUCE)*. Enable `JUCE_PLUGINHOST_VST3=1`, `JUCE_PLUGINHOST_AU=1`.
- `createPluginInstanceAsync(description, sampleRate, blockSize, cb)` → callback delivers `std::unique_ptr<AudioPluginInstance>` on the message thread. A hosted synth *is* an `AudioProcessor`, so `prepareToPlay`/`processBlock`/`getParameters`/`getStateInformation`/`createEditorAndMakeActive` all just work.

**Per-block modulation + passthrough** (`processBlock`):
1. Read transport via `AudioPlayHead` (`ppqPosition`) → compute each lane's curve value.
2. Feed through `juce::SmoothedValue` → `hostedParam->setValue(normalised01)`.
   - `setValue()` is documented callable **"during the audio processing callback"** — this is the intended path. **Do NOT** call `setValueNotifyingHost()` / `beginChangeGesture()` from the audio thread (some hosts allocate/post messages).
3. Forward MIDI + audio: `hostedInstance->processBlock(buffer, midi)`.
4. Propagate latency: `setLatencySamples(hostedInstance->getLatencySamples())`.

**Resolution caveat:** JUCE parameter writes are **per-block, not sample-accurate**. For fast curves, split the block into sub-blocks and re-call `processBlock` at each boundary. MIDI is already sample-accurate. (Serum also smooths internally — tune to avoid double-smoothing sluggishness.)

**Identity:** key every curve target on the hosted param's **`getParameterID()`** (stable across plugin versions), never the array index. Note: a generic hosted param exposes only normalised 0–1 + `getNumSteps()` + the `getText()`/`getValueForText()` text round-trip — there is **no numeric min/max/skew** for a third-party hosted param, so display the synth's own value text rather than computing engineering units.

**Single instance vs graph:** for one hosted synth, manual forwarding is lighter than `AudioProcessorGraph`. Use the graph later if you support multi-device chains.

---

## 4. Parameter & modulation model — two layers (this is the key design)

The constraint (verified across VST3 SDK, AU, and JUCE): **a plugin's host-facing parameter list is fixed at construction.** VST3 forbids changing the automatable set; AU hosts mostly ignore dynamic parameter trees; JUCE can't add/remove params after construction. So you cannot mirror an arbitrary synth's parameters to the DAW dynamically. The universal answer is two separate layers:

**Layer 1 — the hosted synth's own parameters (the product).**
Driven *internally* by the curve engine every block. **These never need to be exposed to the outer DAW.** Their real names are read from the hosted instance for *your* UI. This is the live modulation, and it works everywhere with zero setup and full resolution. **The live product needs zero exposed slots.**

**Layer 2 — a fixed bank of N generic "macro" params on the wrapper (only for the optional bake feature).**
Declared once at construction (`"macro01".."macroN"`, `isAutomatable(true)`, stable IDs via the `HostedAudioProcessorParameter`/`versionHint` mechanism). The user maps "Macro k → synth param X" in Stride's UI. The DAW sees stable, automatable "Macro k" controls it can record.

**How many slots (N)?** Reference points: PatchWork 40 (users complain it's too few), Metaplugin 100, Unify 32 macros, Bidule 512, **AAX default ceiling 64** (raisable only at compile time). Recommendation: **default N = 32, compile-time-tunable up to 64** (the AAX cap if Pro Tools matters). The clutter cost (all N always show in the DAW's param list) only affects bake users — live modulation is unaffected. *(See §16 — your call.)*

---

## 5. UI: reuse `canvas.js` via JUCE WebView — the "same code" win

**You've already proven this pattern.** Tendril renders `tendril_webui.html` embedded via `juce_add_binary_data` inside a JUCE plugin. Stride's wrapper uses the identical approach for `canvas.js`.

**How it works (JUCE 8):**
- Compile `canvas.js` + HTML/CSS into `BinaryData`; serve with `WebBrowserComponent::Options::withResourceProvider` over the built-in custom scheme — **no web server, no internet**. Load via `goToURL(getResourceProviderRoot())`.
- **C++ ↔ JS bridge:** `withNativeFunction` (JS→C++, returns a Promise) and `emitEventIfBrowserIsVisible()` / `evaluateJavascript()` (C++→JS). This *replaces* today's two bridges: the `window.stride` Electron IPC (`preload.js`) and the `window.strideLink` WebSocket to M4L (`ws-client.js`).

**What's reused vs. rewritten:**
| Layer | Today | In the wrapper | Effort |
|---|---|---|---|
| Drawing engine, tools, motions, curve math (`canvas.js`, ~2,200 lines) | Electron Chromium | WebView (WKWebView/WebView2) | **Reused ~as-is** |
| UI shell (`index.html`) | Electron | WebView | Reused; bundle assets locally |
| Transport bridge (`ws-client.js` ~158, `preload.js` ~69) | WS to M4L + IPC | JUCE native functions | **Replaced** (small shim) |
| Param scan / inject | M4L LOM / `.alc` | C++ hosting engine | **New (the real build)** |

**Two small porting tasks:** today the UI loads **Tailwind and the Outfit font via CDN** (per CLAUDE.md). The resource provider has no internet, so **bundle Tailwind (compiled, not CDN) and the font locally**. Mechanical, but required.

**Engine note:** macOS WebView = **WKWebView** (Safari engine), Windows = **WebView2** (Chromium). Your canvas is HTML5 Canvas 2D — well supported in both — but test on WKWebView since it isn't Chromium.

**The one real WebView risk (open JUCE bug):** when the WebView has focus, the **host's spacebar transport / computer-keyboard MIDI can be swallowed**. JUCE acknowledged it (Oct 2024), no official fix; there's a community macOS `keyDown:` forwarding workaround. Validate early on your target DAWs; keep a native-JUCE-UI fallback in your back pocket. Also budget: Windows WebView2 needs a **per-instance user-data folder** (a DAW can't write its install dir), and HiDPI quirks at non-100% scaling.

---

## 6. State, persistence, missing-plugin handling

- `getStateInformation` writes a `ValueTree`/XML chunk containing: (1) `PluginDescription::createXml()` of the hosted synth, (2) the hosted instance's own `getStateInformation()` bytes (base64), (3) Stride's curve/mapping data. Wrap with `copyXmlToBinary()`.
- On reload: recreate the instance **async from the description**, then apply `setStateInformation` **inside the creation callback** (not after the call returns — creation is async).
- **Missing/uninstalled synth:** no dedicated JUCE API — handle at app level. Keep the saved description + state bytes, show a "plugin missing — relink" placeholder, apply the retained state once relinked. Match by `createIdentifierString()` (path-independent).
- **Engineer for the documented failure modes** (from prior art): bulletproof state save/restore *during preset recall* (the exact Serum-in-PatchWork bug was a save triggered mid-recall), and persist plugin file paths across vendor updates (the Waves/WaveShell breakage).

---

## 7. Plugin discovery — crash-safe, out-of-process

A bad synth must never crash the DAW during a scan. JUCE's in-process `PluginDirectoryScanner` won't do.

- Ship a **separate, code-signed scanner executable**; the wrapper launches it via `juce::ChildProcess`. Use the `KnownPluginList::CustomScanner` + `ChildProcessCoordinator`/`ChildProcessWorker` pattern from JUCE's `AudioPluginHost` example (coordinator detects a crashed/hung worker via ping; blacklists the offender).
- Cache `KnownPluginList` to disk (`createXml()`/`recreateFromXml()`) so scanning is rare. Use the dead-man's-pedal blacklist.
- **macOS gotcha:** the scanner *also* needs `disable-library-validation`, and you must **not** pass `codesign --options ...,library` (the `library` flag re-enables validation).

---

## 8. Format & platform strategy

| Target | Ship? | Notes |
|---|---|---|
| **VST3 (Win + Mac)** | **Yes — primary** | Covers Ableton, Cubase, FL, Studio One, Reaper, Bitwig. **Pin JUCE to a post-Oct-2025 tag** — a VST3-hosting-VST3 link fix landed then. |
| **AUv2 (Mac)** | **Yes** | Required for Logic. Loads in-process (not an app-extension) → can host other plugins. |
| **AUv3** | **No** | App-extension; out-of-process on Apple-Silicon Logic → **cannot host other plugins**. Avoid for hosting. |
| **AAX (Pro Tools)** | **Defer past launch** | Works (PatchWork/Metaplugin prove it) but = Avid SDK + iLok + PACE signing bureaucracy. Can't host other AAX plugins; hosted VSTs must not appear in PT's menu. |
| **GarageBand** | **No** | Strict App Sandbox blocks arbitrary plugin scanning/loading. Don't promise it. |
| **iOS** | **No** | AUv3-only → hosting blocked. |

---

## 9. Code-signing, notarization, entitlements

**macOS (Developer-ID + notarized; not App Store):**

| Entitlement | Set? | Why |
|---|---|---|
| `com.apple.security.cs.disable-library-validation` | **MANDATORY** | The only way a hardened process can load synths signed by *other* developers. Without it, every third-party load fails — sometimes as an untrappable signal-9 crash. Set on **plugin AND scanner**. |
| `com.apple.security.cs.allow-jit` | Recommended | Covers in-process JIT (some synths, your JS engine). Harmless. |
| `com.apple.security.cs.allow-unsigned-executable-memory` | Only if forced | Some iLok/DRM synths crash without it; broader hole, add only if needed. |
| `allow-dyld-environment-variables` | Only if you use `DYLD_*` | Path-based `dlopen` doesn't need it. |
| App Sandbox | **None** | A sandboxed bundle can't scan/load arbitrary plugins. |

- **You can still notarize** with library validation disabled (notarization requires the hardened runtime, not library validation). Gatekeeper just runs extra checks.
- Plugin folders (`/Library/Audio/Plug-Ins`) are **not TCC-protected** → no file-access prompt to scan. (A freshly-downloaded *hosted* synth carrying quarantine can still be Gatekeeper-blocked at load — your notarization doesn't cover it; expect a few support tickets.)

**Windows:** no runtime signing restriction (`LoadLibrary` of any synth just works). Sign the **installer** (SmartScreen). Ship the **WebView2 Evergreen bootstrapper** as fallback (preinstalled on Win11, most Win10, but not all — detect and offer the ~2 MB installer).

---

## 10. Getting motion into the DAW (ranked)

| Rank | Option | Verdict |
|---|---|---|
| **1 — default** | **Live-only modulation** | Curve replays every pass, transport-synced. Cleanest, most reliable, cross-DAW, zero setup, full resolution. Exactly what LFO Tool / ShaperBox / Bitwig modulators do. **Make this the default.** |
| **2 — optional** | **Macro slot + DAW automation-write** | User maps a macro, arms the DAW's Write/Latch, plays; DAW records the macro moves. Genuinely works (Logic/Cubase/Reaper/Ableton), but: block-rate stair-stepping, lands on a generic "Macro" not the synth's named param, and driving an exposed param so the host records it is fiddly (must report gestures off the audio thread — likely a timer-driven write, like today's Ableton arrangement-record). Offer as an explicit "Commit to automation," clearly labeled lower-fidelity. |
| **3 — niche** | **MIDI CC export** | `LegacyMIDICCOutEvent` is 7-bit, inconsistently supported across hosts, needs routing to a second track. Only as a dedicated "export to MIDI" mode (à la MidiShaper). Never the default. |

---

## 11. Competitive positioning

| Product | Hosts plugins? | Drawn curves on hosted params? | Cross-DAW? |
|---|---|---|---|
| Bitwig modulators | n/a (it's the DAW) | curve/segment modulators ✅ | ❌ DAW-locked |
| PluginGuru Unify | ✅ | ❌ (fixed-shape LFOs only) | ✅ |
| Blue Cat PatchWork | ✅ | ❌ (chainer; no modulators) | ✅ |
| DDMF Metaplugin | ✅ | ❌ | ✅ |
| **Stride Wrapper** | ✅ | ✅ **drawn curves** | ✅ |

**The gap is real:** the "modulate any hosted param with hand-drawn curves" + "cross-DAW" combination is unoccupied. Stride's existing curve engine maps directly onto the hosted-param model.

---

## 12. Licensing & cost

- **JUCE commercial license required.** JUCE 8's free tier is **AGPLv3** — unusable for a closed-source commercial plugin. Budget a paid JUCE license. (You presumably already have this sorted for Tendril — confirm it covers Stride.)
- **Do NOT fork Element or Carla.** Both are strong-copyleft GPL (Element GPL-3.0, Carla GPL-2.0) → linking their code forces open-sourcing Stride. Study them as reference designs only; build the engine fresh.
- **Protected synths authorize fine when hosted** (machine-level, host-agnostic) — no whitelist failures documented for major synths. Two real risks: first-run auth needs the synth's GUI opened (Omnisphere challenge/response), and iLok Cloud needs a constant connection.
- **AAX/PACE** (if/when Pro Tools): Avid AAX SDK (now bundled with JUCE 8) + iLok + PACE Eden/cloud signing. Pure overhead — defer.

---

## 13. Reuse from Tendril (big derisk)

You are *not* starting cold. Tendril already gives you:
- **The JUCE + CMake + web-UI-in-`BinaryData` build pipeline, proven on your machine** (`cmake --build … --target …`, embedded `tendril_webui.html`). The wrapper's UI architecture is the *same pattern you already ship*.
- **DSP idioms you already use** — `juce::SmoothedValue` (the exact tool for modulation ramps), oversampling, the generator/prepare patterns.
- **Modulation-viz DNA** — Tendril's Serum-style cyan range-arc + moving-dot (`modviz` emitted from the editor) is directly the visual language for showing Stride's live modulation on the hosted synth's params.
- **Autonomous compile loop** — the whole reason Tendril pivoted to JUCE was so you/Claude can compile and iterate locally. Same loop applies here.

Net: the *novel* surface is the hosting engine + the param-mapping UI + cross-platform signing. The build system, UI-embedding approach, and DSP smoothing are reuse.

---

## 14. Risk register (ranked)

1. **Apple-Silicon arch matching** *(highest real-world hit rate)* — an arm64 Stride loads only arm64 synths; Intel-only/legacy plugins won't load without an internal process-bridge (Metaplugin does this; most don't). → Decide: build an arch-bridge, or ship native + document the limit. Will drive support tickets either way.
2. **No crash isolation in target DAWs** — a bad *hosted* synth crashes the whole DAW and you get blamed. → Out-of-process scanner + defensive loading + (later, maybe) an out-of-process hosting option (adds latency).
3. **WebView keyboard-focus-to-host bug (open)** — spacebar transport / keyboard MIDI swallowed when the UI has focus. → Validate early; apply the community `keyDown:` workaround; keep a native-UI fallback.
4. **macOS entitlement invisible until it bites** — without `disable-library-validation`, *nothing* third-party loads, possibly as signal-9. → Set it on plugin + scanner day one; test notarized builds early.
5. **JUCE version pinning** — VST3-in-VST3 only links post-Oct-2025; `addDefaultFormats()`/`createEditor()` changed at 8.0.9/8.0.13; WebView relay APIs shifted across 8.0.x. → Pin a recent JUCE 8 tag; treat any tutorial older than mid-2024 as API-stale.

*Honorable mentions:* hosted-editor resize/HiDPI/focus quirks (use the `AudioPluginHost` `PluginWindow` pattern, one window per editor); per-block modulation granularity (block-split + smooth); state-save-during-preset-recall; quarantine on user-downloaded synths.

---

## 15. Build roadmap (milestones)

**M0 — Spike (days–~2 weeks): prove the core in Ableton, Windows VST3.**
Host Serum inside a bare JUCE VST3; enumerate its params; drive ONE param from a hardcoded sine curve in `processBlock`, transport-synced; open Serum's editor in its own window. *Goal: prove hosting + modulation + editor in a real DAW.* (Cross-check the curve output against today's M4L inject for fidelity.)

**M1 — UI reuse: drop `canvas.js` into a WebView.**
Bundle the canvas as `BinaryData` (Tailwind + font local); wire the JS↔C++ bridge; render the synth's real param list; map lanes → hosted params. *Goal: the existing canvas drives the hosted synth.* Resolve the keyboard-focus issue here.

**M2 — Productionize the engine.**
Out-of-process signed scanner + `KnownPluginList` cache; state save/restore (incl. missing-plugin relink); the fixed macro bank + mapping UI; block-splitting + smoothing; latency propagation.

**M3 — Cross-DAW + cross-format.**
AUv2 build for Logic; QA across Ableton/Cubase/FL/Studio One/Reaper (Win+Mac); macOS entitlements + notarization; Windows installer + WebView2 fallback. QA the top ~20 synths.

**M4 — Optional.**
"Commit to automation" (macro bake) and "Export MIDI CC". Later: AAX/Pro Tools; multi-device chains via `AudioProcessorGraph`; arch-bridge for Intel plugins.

**Where time actually goes:** M0–M1 are fast (the fun part). **M3 (signing/notarization + per-DAW/per-synth QA) is the long tail** — budget the majority of calendar time there, not on the engine.

---

## 16. Open decisions for you

1. **Macro slot count N** — 32 (less DAW clutter) vs 64 (AAX ceiling, more bake headroom)? Affects only the optional bake feature. *Recommend: 32, compile-tunable.*
2. **Intel-plugin support** — build an internal arch-bridge for Intel-only synths, or ship arm64-native and document the limit? *Recommend: native first, bridge only if support demand is high.*
3. **Pro Tools at launch?** — adds AAX/PACE/iLok overhead. *Recommend: defer to post-launch.*
4. **Native-UI fallback** — commit to WebView (reuse `canvas.js`) with the focus-bug workaround, or hedge with a native-JUCE UI path? *Recommend: WebView (you already ship it in Tendril); keep native as contingency only.*
5. **Relationship to the Ableton product** — wrapper *replaces* the M4L product cross-DAW, or *coexists* (M4L stays the deep Ableton/Reaper experience, wrapper covers everyone else)? *Recommend: coexist — keep "inject into clips" as the Ableton/Reaper exclusive.*

---

## 17. Key sources

**JUCE hosting & WebView**
- AudioPluginFormatManager / AudioPluginInstance / KnownPluginList / PluginDescription — https://docs.juce.com/master/classjuce_1_1AudioPluginFormatManager.html · https://docs.juce.com/master/classjuce_1_1AudioPluginInstance.html
- AudioProcessorParameter (`setValue` callable during audio callback; normalised 0–1) — https://docs.juce.com/master/classAudioProcessorParameter.html
- BREAKING_CHANGES (addDefaultFormats removed 8.0.9; createEditor private 8.0.13) — https://github.com/juce-framework/JUCE/blob/master/BREAKING_CHANGES.md
- VST3-hosting-VST3 link fix (pin post-Oct-2025) — https://forum.juce.com/t/cant-build-a-vst3-plugin-that-hosts-vst3-plugins-since/67270
- JUCE 8 WebView UIs (resource provider, native functions) — https://juce.com/blog/juce-8-feature-overview-webview-uis/
- WebView keyboard-focus-to-host bug — https://forum.juce.com/t/webview-and-keyboard-input-propagation-issue-to-the-host/62439
- AudioPluginHost example (PluginWindow, out-of-process scanner) — https://github.com/juce-framework/JUCE/tree/master/extras/AudioPluginHost

**Parameter/automation constraints**
- VST3 Parameters & Automation (fixed param set; restartComponent) — https://steinbergmedia.github.io/vst3_dev_portal/pages/Technical+Documentation/Parameters+Automation/Index.html
- JUCE HostedAudioProcessorParameter (ID stability) — https://docs.juce.com/master/structjuce_1_1HostedAudioProcessorParameter.html

**Code-signing / sandbox**
- Disable Library Validation entitlement — https://developer.apple.com/documentation/bundleresources/entitlements/com.apple.security.cs.disable-library-validation
- JUCE: VST hosting + hardened runtime — https://forum.juce.com/t/vst-plugin-hosting-not-working-with-hardened-runtime/65463
- Logic AUHostingService (crash isolation, not file jail) — https://forums.macrumors.com/threads/native-m1-plugins-are-not-handled-natively-in-logic-pro-auhostingservice.2326554/
- WebView2 distribution — https://learn.microsoft.com/en-us/microsoft-edge/webview2/concepts/distribution

**Prior art**
- Blue Cat PatchWork — https://www.bluecataudio.com/Products/Product_PatchWork/
- DDMF Metaplugin — https://ddmf.eu/metaplugin-chainer-vst-au-rtas-aax-wrapper/
- PluginGuru Unify — https://pluginguru.com/products/unify2/
- Kushview Element (GPL-3.0) — https://github.com/kushview/element
