# Stride AU (Logic Pro) — spec, research findings, build log

**Date:** 2026-07-13 · **Status:** CODE COMPLETE on `stride-vst3-wrapper` (Windows build + 1385-test suite green; Mac CI + hardware QA pending) · **Ships as:** Stride 1.1.0

---

## 1. Why

Logic Pro is the biggest Mac-native producer DAW and the one host family Stride VST could not reach — Logic loads **Audio Units only**, no VST3. Until now the in-zip README literally said "(NOT Logic or Pro Tools yet)".

- **One product, zero new SKU.** Stride.component ships inside the existing Mac zip; existing customers get Logic support as a free 1.1.0 update. GarageBand is a free bonus funnel (best-effort, not marketed).
- The wrapper spec always planned this: M3 in `docs/stride-wrapper-vst3-spec.md`.

## 2. What ships in 1.1.0

| Piece | Detail |
|---|---|
| **Stride.component** | AUv2 instrument — identity `aumu / SwM0 / Strd` (derived from the frozen PLUGIN_CODE/manufacturer; **now frozen too**, changing it orphans Logic projects) |
| **AU hosting on macOS** | Stride (in ANY Mac host, VST3 or AU build) now hosts the user's **AU plugins as well as VST3** — Logic users' libraries are often AU-first |
| Browser + favorites | + Add lists both formats with small VST3/AU chips (chips only appear when a list mixes formats — Windows renders unchanged); AU favorites get an "(AU)" label |
| Load-failure toast | A device that fails to load now shows an actionable toast (top real-world cause on Mac: Intel-only bundle in an arm64 host process). Was a silent `DBG`. |
| License sharing in Logic | Confirmed working by architecture (see §3.3) + a defensive sandbox resolver for sandboxed in-process hosts (GarageBand-class) |
| CI auval gate | Mac CI now builds/signs/notarizes BOTH bundles and **fails the build if `auval -strict` fails** — the same validation Logic runs on customers' machines |

## 3. Research findings (July 2026, two independent web passes; full citations in the research transcripts)

### 3.1 Logic + AUv2 status — GREEN
- Current: **Logic Pro 12.3** (June 2026), macOS 15.6+. AUv2 (.component) fully supported; **no deprecation** anywhere in Apple docs or Logic 11/12 release notes. AUv3 is parallel tech, not a mandate — and AUv3's app-extension sandbox would kill Stride's whole hosting premise. **AUv2 is the correct call.**

### 3.2 The big architectural fact: out-of-process hosting
- On Apple Silicon, Logic (and GarageBand/MainStage) load **all third-party AUs out-of-process** into `AUHostingServiceXPC_arrow` (arm64) / `AUHostingCompatibilityService` (Rosetta bridge for Intel-only AUs).
- That service is **NOT App-Sandboxed and has library-validation disabled** (entitlement dumps: `com.apple.security.cs.disable-library-validation`, `temporary-exception.audio-unit-host`) — which is exactly why plugins-hosting-plugins work in Logic.
- **Precedents (all ship AUv2 hosting third-party plugins in Logic):** PlugInGuru Unify, Blue Cat PatchWork, DDMF Metaplugin, Kushview Element (JUCE, open source), NI Komplete Kontrol/Maschine (VST3-only inside), Waves StudioRack (any-brand VST3 since V14). Hosting **VST3 inside** is the industry-proven route; we ship VST3 + AU hosting both.
- **Blast radius:** a hosted-plugin crash takes down AUHostingService = every third-party AU UI in the session (not Logic itself). Logic blames "an Audio Unit". Same trade-off every product above accepts.

### 3.3 Licensing / file paths — works in Logic, defended for GarageBand
- Because the AU hosting service is unsandboxed, plugin file I/O in Logic hits **real paths** — `license.json` under the real `~/Library` is read/written exactly like in Live/Bitwig. **A license activated in Live unlocks Stride in Logic automatically, and vice versa.**
- **GarageBand IS App-Sandboxed** (Apple DTS-confirmed). If Stride ever runs inside a sandboxed process (Intel-era in-process hosting, future host changes), `~` resolves into the host **container** and the shared license would be invisible → double activation. Defense implemented in `License.h::dataDir()`: detect a container home (`/Library/Containers/` marker) → prefer the **real** per-user path (from `getpwuid`, which the sandbox doesn't rewrite) when it's actually readable/writable → else fall back to the container path (worst case = per-host activation, today's behavior). **No-op everywhere else — unsandboxed hosts return the exact legacy path.**

### 3.4 Keyboard / spacebar — structurally different in Logic
- Our Live/Bitwig Mac trick (re-post a synthetic Space to a DAW window) **cannot work in Logic**: the plugin runs in a different process; there is no Logic window to post into. CGEventPost needs Accessibility permission granted to *Apple's* hosting service — fragile, alarming, rejected.
- Worse: a synthetic re-post could **double-toggle** if the unconsumed key also falls through Logic's own key handling. **Decision: suppress both synthetic key paths under Logic/GarageBand** (`strideMacKeyForward_setSuppressed`, host-detected via `PluginHostType`). If natural fall-through works, space works; if not, space-in-Stride doesn't toggle transport in Logic v1 — same as most plugins, documented. Verify on hardware (QA #6).

### 3.5 Architecture (CPU) constraints
- An arm64 host process **cannot load Intel-only VST3/AU bundles**, and Logic's Rosetta bridging never extends to plugins *we* host. Rosetta itself sunsets after macOS 26.
- Mitigation shipped: the load-failure toast names the likely cause ("Intel-only … Apple Silicon-native host"). Unify-style greyed-out entries (lipo-probing every bundle) = future polish.

### 3.6 auval / AU cache facts that shape the release
- Logic auto-runs auval on new/updated components; failures land in Plug-in Manager. Our CI now runs **`auval -strict -v aumu SwM0 Strd`** (arm64 gate; x86_64 slice via Rosetta — real validation failures fail the build, a missing-Rosetta runner only warns).
- AU 32-bit version = `(major<<16)+(minor<<8)+patch` → **minor/patch must stay ≤ 255**; 3-part versions only.
- Logic caches plugin I/O config **keyed by version** → any future bus/layout change REQUIRES a version bump.
- Support KB (for "update not showing"): quit Logic → delete `~/Library/Caches/AudioUnitCache/com.apple.audiounits.cache` (+ `.sandboxed` variant) → `killall -9 AudioComponentRegistrar` → restart → Plug-in Manager → Full Audio Unit Reset.

### 3.7 JUCE 8 WebView in Logic — works, with a known macOS bug
- JUCE 8 WebView AUs run in Logic (bridged NSView + WKWebView's own XPC). Known **macOS view-bridging bug: keyboard focus can be lost permanently after resizing** a plugin window in Logic on Apple Silicon (reportedly improved ~macOS 14.2; current status unverified). Stride is mouse-first; the risk surface is **typing** (license key entry, browser search).
- **Contingency if Logic typing is broken on current macOS:** ship the already-building Standalone app as an activation helper (activates the shared license.json outside Logic). Not shipped by default.

### 3.8 Parameters / state under AU
- The 32 macro slots are **legacy index-ID parameters** (fixed count, fixed order, labels relabel live) → AU parameter IDs are stable indices. Rule stays: **never remove/reorder macro slots**; only append (and then with versionHints).
- Saved projects store hosted-plugin **paths**; restore resolves the format by which registered format claims the file — old VST3-only saves round-trip byte-identically; Logic saves with .component paths restore the same way.
- Multi-out hosted plugins stay constrained to main-stereo (same as the VST3 side; JUCE's AU hosting is weak on multi-bus anyway — steer Kontakt-class users to the VST3 build of that plugin).

## 4. Implementation (all on branch `stride-vst3-wrapper`)

| File | Change |
|---|---|
| `CMakeLists.txt` | VERSION 1.1.0; `FORMATS AU VST3 Standalone` (AU auto-skipped off-Apple); explicit `AU_MAIN_TYPE kAudioUnitType_MusicDevice`; `PLUGINHOST_AU TRUE` (defines JUCE_PLUGINHOST_AU=1 + links AudioUnit/CoreAudioKit); dropped `JUCE_PLUGINHOST_AU=0` |
| `src/PluginProcessor.{h,cpp}` | `AudioUnitPluginFormat` registered (mac-guarded); shared `findPluginTypesForFile()` resolver replaces the two hardcoded VST3 resolutions (`loadPlugin`, `restoreNextDevice`); `onLoadFailed` callback (both failure paths) |
| `src/PluginEditor.cpp` | Mac chooser filter `*.vst3;*.component`; scan adds the two Components folders (fmt tags "VST3"/"AU"); sandbox-aware re-add of REAL per-user VST3/Components dirs; loadFailed → WebView toast wiring (+ dtor reset); Logic/GB synthetic-key suppression |
| `src/License.h` | `hostIsSandboxed()` + `realUserHome()` + sandbox-aware `dataDir()` (container-safe license sharing; exact legacy path otherwise) |
| `src/MacKeyForward.{h,mm}` | `strideMacKeyForward_setSuppressed()` — single gate at the delivery point covers both forward paths |
| `ui/shim.js` | favorites strip `.component`, "(AU)" labels, format chips (only when mixed), neutral copy, load-failure toast |
| `ui/index.html` | Guide step 1: "pick an instrument (VST3, or AU on Mac)" |
| `ci/build-mac-vst3.sh` | Builds `StrideWrapperM0_AU`; signs BOTH; **auval -strict gate (arm64 + best-effort x86_64)**; notarizes both in one submission; staples both; zip now ships `Stride.vst3` + `Stride.component` + README |
| `ci/README.txt` | Customer copy: Logic/GarageBand row, Components install path, Logic first-launch validation note |
| `.github/workflows/build-vst3.yml` | Comment/name updates only (mac job: "macOS VST3 + AU") |
| `stride-vst/test/test-vst3-au.js` | NEW: 74 assertions (behavioral replicas + cross-file consistency, incl. "auval triple must equal the CMake identity") |

**Deliberately unchanged:** plugin identity (Stride / SwM0 / Strd), VST3 behavior on all platforms, Windows code paths (byte-identical), state schema, entitlements, the workflow's job graph, zip name `Stride-VST3-Mac.zip` (LS continuity — the AU rides inside).

## 5. Verification so far

- **Windows:** full cmake Release build of the VST3 target green (proves shared-code changes compile; AU code is mac-guarded).
- **Test suite:** 1385 passed / 0 real failures across 49 files, including the new `test-vst3-au.js` (74) and every existing `test-vst3-*` file. (`test-drag-select.js` shows as "CRASHED" in the runner — pre-existing summary-line format mismatch, passes 30/0 standalone, unrelated.)
- **Mac:** requires CI (push/tag) — the new auval gate is the machine check. Then hardware QA below.

## 6. Manual QA checklist (Logic 12, Apple Silicon — the ship gate)

1. Install both bundles; launch Logic → Stride appears under AU Instruments (Plug-in Manager: "successfully validated").
2. Insert on a Software Instrument track → UI opens, correct size, reopen-after-close works.
3. **Typing probe:** click the license field and type BEFORE any resize; resize the window; type again (macOS focus-loss bug probe). Paste (Cmd-V) both times too.
4. On a Mac already activated in Live: Stride in Logic is **already activated** (shared license.json). On a fresh Mac: activate inside Logic, then check Live sees it.
5. + Add: browser lists VST3 + AU with chips; add a VST3 synth; add an AU-only device; Map by touch; draw curves; play — modulation locked to Logic's transport; bar-length changes track.
6. **Spacebar:** with Stride UI focused, press Space — record whether Logic toggles transport (fall-through) or nothing happens. Either is acceptable; double-toggle is NOT (would mean suppression failed).
7. Save project → quit → reopen: chain, patches, curves, macro assignments all restore.
8. Automation mode: exposed "Stride N" macros automatable from Logic lanes; Live-mode mirroring doesn't record.
9. Offline bounce (entitled) is clean; Discovery Pass gate flows work in Logic.
10. Intel-only plugin add → toast appears with the arch hint (no silent nothing).
11. Hosted synth windows float/minimize/restore correctly over Logic.
12. GarageBand (best-effort): Enable Audio Units → is Stride listed? (`AU_SANDBOX_SAFE` is FALSE — if GB hides Stride, that's the accepted v1 trade-off; note it.)
13. Regression on Live/Bitwig Mac: transport keys still work (suppression is Logic/GB-only); browser now shows AU entries there too — both load.
14. pluginval strictness 10 on BOTH formats (manual, as with 1.0.x).

## 7. Rollout

1. Push branch → CI (`workflow_dispatch` first; tag `vst3-v1.1.0` when green) → auval-gated, notarized `Stride-VST3-Mac.zip` (both formats) + `Stride-VST3-Windows.zip`.
2. Hardware QA (§6) on an Apple Silicon Mac with Logic 12 — the Mac tester run.
3. Lemon Squeezy: replace the Mac zip (same product/file slot). Windows zip re-ships from the same commit (unchanged behavior, same version string).
4. Site/LS copy: "VST3 + AU — works in Ableton Live, Logic Pro, Cubase, FL, Bitwig, Reaper…". Landing + setup-guide get a Logic install row (Components folder + first-launch validation note).
5. Announce email to owners + demo list — **after the Range campaign's day-3 send completes** (Resend daily quota; a blast same-day silently blocks transactional mail).
6. Support KB: the AU cache reset steps (§3.6).

## 8. Open decisions / watchlist

- **`AU_SANDBOX_SAFE` stays FALSE** (honest: we dlopen third-party code + write files). Revisit only if GarageBand hides Stride AND GB matters commercially.
- Space-in-Logic UX after QA #6 — if fall-through fails and users complain, options are: accept, or a Logic-only "click-through" hint in the UI. No CGEvent/Accessibility hacks.
- Focus-loss-after-resize bug status on macOS 15/26 — if it bites, consider clamping resize while hosted in Logic + the Standalone activation-helper contingency (§3.7).
- Favorites live in WKWebView localStorage — in the unsandboxed hosting service this should be the shared real profile (verify in QA; if per-host divergence shows up, migrate favorites into `stride-data/`).
- Future polish: lipo-probe scan entries and grey out arch-mismatched plugins (Unify pattern); out-of-process plugin scanning with a dead-man's-pedal; `aumf` (music effect) second component if audio-track hosting demand shows up.

## 9. Pointers

- Prior art: `docs/stride-cross-daw-vst3-research.md`, `docs/stride-wrapper-vst3-spec.md`, `docs/stride-wrapper-decision-memo.md`
- Wrapper source: `stride-wrapper/m0-spike/`
- CI: `.github/workflows/build-vst3.yml` → `stride-wrapper/m0-spike/ci/build-mac-vst3.sh`
- Tests: `stride-vst/test/test-vst3-au.js` (+ the existing `test-vst3-*.js` family)
