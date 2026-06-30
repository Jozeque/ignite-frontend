# Stride Cross-DAW / VST3 — Market & Feasibility Research

**Date:** 2026-06-29
**Question from users (all DAWs):** *"Is Stride available as a VST3 that can speak with any DAW?"*
**Internal hypothesis:** *"Biggest market is Cubase — get Stride working on Cubase, same logic, same code."*

---

## TL;DR (read this first)

1. **"Same logic, same code" cannot reach any DAW as a VST3.** Stride's two defining moves — *scan another instrument's parameters* and *inject automation curves into a clip* — both reach **outside the plugin sandbox**. Every plugin format (VST3, AU, AAX) forbids a plugin from seeing other plugins' parameters or writing host automation. This is an architectural certainty, verified against the Steinberg VST3 SDK. It is not a missing feature we can work around with effort.

2. **Stride only works in Ableton because Ableton is special.** The Live Object Model (exposed through Max for Live) is a *host-side* API. Almost no other DAW exposes anything like it. **The single exception is REAPER**, whose ReaScript API can read any FX parameter *and* write automation envelope points offline — so REAPER is the one DAW where Stride's exact mechanism ports cleanly.

3. **Cubase is the *hardest* target, not the easiest.** Cubase has no way for a third party to enumerate plugin parameters or write timeline automation. Its only extensibility (the MIDI Remote API) is a hardware-controller mapping layer. Worse: Cubase does not even route a plugin's MIDI output to instruments without a virtual MIDI-port workaround. A Cubase port means **rebuilding Stride as a different, more manual product** (MIDI-CC modulator or plugin-wrapper).

4. **The reachable cross-DAW products are two, and both are a different Stride:**
   - **Wrapper VST3** — Stride *hosts the user's instrument inside itself*, so it legally owns (and can scan + modulate) that plugin's parameters. Universal, keeps most of Stride's identity, loses "inject into the clip."
   - **MIDI-CC modulator** — Stride outputs drawn curves as MIDI CC; the user MIDI-learns each target. Universal-ish, but coarse (7-bit), per-DAW routing friction, no scanning. This already exists as a shipping competitor: **Cableguys MidiShaper**.

5. **Strategic answer to "best market":** It depends on the product form.
   - For **"same code" deep integration** → **REAPER** is the only option (small but passionate, easy build).
   - For **a re-architected universal wrapper** → the biggest reachable pools are **FL Studio + Logic** (creators) and **Cubase is genuinely attractive** because its users (orchestral/film/Europe/Japan) automate heavily and have weak native modulation — *high value-gap* — **but only via the wrapper, never via "same code."**

---

## 1. What Stride actually does today (grounded in the code)

I read the integration layer (`stride-vst/m4l/node/`) to be precise about what is portable and what is not.

### The portable half — the canvas/curve engine
`app/renderer/canvas.js` (drawing tools, templates, mutations), `index.html` (UI), the curve math, sessions/templates, license system. **This is 100% reusable in any plugin or app.** It has no Ableton dependency — it just produces arrays of `{time, value, curve}` points per lane. This is the bulk of the UX and a large share of the code.

### The non-portable half — the DAW integration layer
Everything that touches Ableton lives in `m4l/` and depends on APIs that exist nowhere else:

**(A) Scanning parameters — `scanner_max.js`**
```
new LiveAPI("live_set view selected_track")
  → .get("devices")              // enumerate OTHER devices on the track
    → devPath + " parameters " + i
      → param.get("name" | "min" | "max" | "value" | "automation_state")
        → recurse into rack chains + mixer_device (volume/pan/sends)
```
This reads the parameters of **devices Stride does not own**. (The code even caps VST3 plugins at 500 params with the comment *"VST3 plugins can expose THOUSANDS of internal automatable params to the host"* — a telling reminder that the host sees what a plugin cannot.) **No plugin API in any format allows this.**

**(B) Injecting automation — three Ableton-only paths**
- **`.alc` generation** (`alc-generator.js` + `alc-injector.js`): parses Ableton's gzipped clip XML, rewrites `<ClipEnvelope>`/`<AutomationEnvelope>` `FloatEvent`/`IntEvent`/`BoolEvent` breakpoints with the canvas points scaled to each param's min/max, re-gzips, writes `~/Desktop/Stride/*.alc`. **The `.alc` format is proprietary Ableton.**
- **Direct inject** (`server.js apply_inject` → StrideInject Remote Script): writes envelopes straight into the selected clip via a **Python Remote Script running inside Ableton** (a Live-only extension type).
- **Arrangement recording** (`scanner_max.js write_automation`): slows tempo to 40 BPM, sets `record_mode`, and on a 5 ms `Task` tick calls `param.set("value", …)` on the cached LOM objects while the transport plays, so Live records the motion as automation. *Note: this "drive live + host records" pattern is the one model that conceptually survives into VST3 — except in VST3 you can only drive **your own** parameters, never the synth's.*

**(C) The bridge — `server.js`**
A WebSocket server on `localhost:9100` inside Node-for-Max, relaying JSON between the Electron canvas and the Max patcher (`Max.addHandler` / `Max.outlet`). Portable in concept; the thing it bridges *to* (the LOM) is not.

**Bottom line of the code review:** the value users see ("scan my rack, draw, inject into my clip, no MIDI mapping") is delivered entirely by the non-portable half. Porting the portable half is trivial; replacing the non-portable half is the entire problem — and for most DAWs there is nothing to replace it with.

---

## 2. The hard wall: what a VST3 plugin is allowed to do

Verified against the official Steinberg VST3 SDK (headers + developer portal) and corroborated by JUCE/Apple/Avid docs and Steinberg-staff forum replies.

| Capability Stride needs | Possible in a VST3 plugin? | Why |
|---|---|---|
| Enumerate **other** plugins' parameters (names/ranges) | **No** | Every interface (`IEditController`, `IComponentHandler`, `IConnectionPoint`, `IHostApplication`) is scoped to the plugin's **own** instance. `IHostApplication` offers only `getName` + `createInstance` — no track list, no plugin list. There is no inter-plugin API. |
| Write a **precomputed automation curve** into the timeline (offline) | **No** | No VST3 API accepts a time-stamped array/envelope. `performEdit(id, value)` carries **no timestamp** — only "this param is this value *now*." |
| Drive **its own** param and have the host record it | **Yes, conditionally** | `beginEdit → performEdit → endEdit`. But only the plugin's own params, only in real time, and **only if the user armed write/touch/latch and is playing**. |
| Output **MIDI CC** to the host | **Yes (7-bit)** | `LegacyMIDICCOutEvent` (SDK 3.6.12). 7-bit values; routing to other tracks is **host-dependent** (good in Reaper/Bitwig, lossy in Ableton, **not routed to MIDI Remote in Cubase**, broken in FL). |
| Declare itself a "modulation source" the host assigns to any param | **No** | No such VST3 concept. That only exists **host-side** (Bitwig's unified modulation, Ableton's LOM). |

**AU and AAX are the same.** AUv3 can output MIDI to the host (AUv2 cannot); AAX edits are host-mediated and Pro Tools owns automation. Neither lets a plugin read other plugins or write timeline curves.

**How real "modulate anything" plugins cope (prior art):**
1. **MIDI CC out + user MIDI-learn** (e.g., **Cableguys MidiShaper** — drawable LFOs → Pitch/ModWheel/up to 6 CCs; explicitly notes routing is *"straightforward in Reaper and Ableton, more setup in Logic"*).
2. **Host the target plugin inside yourself** — the wrapper/"snapin" model: **Blue Cat PatchWork** (40 mapped params), **DDMF Metaplugin** (100), **PlugInGuru Unify**, **Kilohearts**, **Melda MXXX**. Because you're a mini-host, you legally see and modulate the hosted plugin's params.
3. **DAW-native deep integration** — Max for Live/LOM (today's Stride), Bitwig native, REAPER ParamMod/ReaScript. Deepest, but DAW-specific.

---

## 3. Per-DAW feasibility matrix ("can Stride's exact model port?")

| DAW | Extensibility API | Read other plugins' params? | Write offline automation? | External-app bridge? | "Same logic" port | Note |
|---|---|:--:|:--:|:--:|:--:|---|
| **Ableton** | Max for Live + LOM | ✅ | ✅ | ✅ (WS) | **Home** | Where Stride lives. |
| **REAPER** | ReaScript (Lua/Py/EEL) + ext SDK | ✅ (w/ true min/max) | ✅ (point-by-point, incl. bezier) | ✅ (OSC/web/file, unsandboxed) | **Easy** ✅ | The **only** clean port. |
| **FL Studio** | MIDI/Piano-roll scripting (Py) | ⚠️ (names + normalized only) | ❌ | ❌ (sandboxed, MIDI-only) | **Hard** | Can scan, can't inject, no bridge. |
| **Studio One** | Undocumented JS + DAWproject file | ❌ | ⚠️ (only via whole-project DAWproject import) | ❌ | **Hard** | Offline curves only via fragile file interchange. |
| **Bitwig** | Controller API (Java/JS) | ❌ (only 8 mapped remotes) | ❌ | ✅ (TCP/OSC) | **Hard** | Bridge easy, core blocked — *and native modulators make Stride redundant.* |
| **Pro Tools** | PTSL Scripting SDK (gRPC) | ❌ | ❌ | ✅ (gRPC) | **Hard** | Real API, but exposes neither params nor automation (yet). |
| **Logic Pro** | Scripter (JS MIDI FX) | ❌ (own params only) | ❌ | ❌ | **Impossible** | Real-time MIDI processor, sandboxed. |
| **Cubase / Nuendo** | MIDI Remote API (JS) | ❌ | ❌ | ❌ (expects HW controller) | **Impossible** | Controller-mapping layer only. |

**Reading of the table:** Only REAPER lets Stride's mechanism port directly. Every other DAW forces a different architecture. The control-surface DAWs (Cubase, Logic, Pro Tools, plus FL's live-set and Bitwig's mapped remotes) can at most push **real-time** parameter moves — so a port there must become a MIDI-CC / live-record tool, and give up auto-scanning the rack.

---

## 4. Market analysis — which market is actually worth capturing

### 4a. Data caveat
DAW market-share numbers are **soft**. There is no authoritative census; every source is biased by its audience. The two honest data shapes:

- **Pro/recording communities** (e.g., Production Expert's 2025 survey, 2,500+ responses, self-selected and post-production-heavy): **Pro Tools leads by a wide margin**, then **Logic Pro**, then **Studio One**; **Steinberg/Cubase+Nuendo ≈ 3rd overall**, with Cubase/Ableton/Studio One/REAPER "tightly grouped" in the middle tier. *FL Studio isn't even mentioned* — which exposes the bias.
- **Creator/beatmaker data** (search interest, sales, younger producers): **FL Studio, Ableton, and Logic** dominate (one breakdown puts these three at ~58% of the "creator" market). FL is huge in hip-hop/US/global; Ableton in electronic/Europe/live.

Both pictures are true for their slice. The DAW software market overall is ~$3.8 B (2025), growing ~9% CAGR.

### 4b. The metric that actually matters: **value-gap × reachability**
Raw size is the wrong sole metric. What matters is *where Stride adds value users can't already get natively* **and** *can we technically reach them*.

| DAW | Size (creator/pro) | Native modulation strength | **Stride value-gap** | Same-code port | Wrapper/MIDI port |
|---|---|---|---|:--:|:--:|
| **REAPER** | small–mid / mid | Has native ParamMod + JS | Medium | ✅ Easy | ✅ |
| **FL Studio** | **very large** / low | Automation clips + LFO + Patcher | Medium | ❌ | ✅ |
| **Logic Pro** | **large** / mid | Modulator MIDI FX (clunky) | **Med-High** | ❌ | ✅ (AU) |
| **Cubase** | mid / **strong in orchestral+film, EU+Japan** | **Weak** per-param LFO/modulation | **High** | ❌ | ✅ (high friction) |
| **Pro Tools** | small / **leads pro studios** | Weak | High, but audience is tracking/mixing not synth-modulation | ❌ | ✅ |
| **Studio One** | mid / mid | Some | Medium | ❌ | ⚠️ |
| **Bitwig** | small | **Best-in-class** | **Low (redundant)** | ❌ | ❌ skip |

**Key strategic reads:**
- The user's instinct about **Cubase has real merit** — Cubase composers (orchestral/film/hybrid) automate *constantly* and Cubase has *weak* native per-parameter modulation, so the **value-gap is high**, and the user base is loyal and pays. *But* it carries the worst technical friction, so it's only reachable via the wrapper, never via "same code."
- **REAPER** is the inverse: easy to reach, modest market, medium value-gap. Best *first* cross-DAW move and proof-of-concept.
- **FL Studio + Logic** are the largest reachable creator pools, but again only via wrapper/MIDI.
- **Bitwig** is a trap: easy to admire, but its native modulation already does Stride's job — skip.

---

## 5. Cubase deep-dive (the explicit ask)

### 5a. Can "scan params + inject curves" be reproduced in Cubase? **No.**
- **No parameter enumeration.** Nothing in Cubase lets a third party list the parameters (names/ranges) of instruments on tracks. The MIDI Remote API only maps a controller to a *focused* plugin's ~8 Quick Controls.
- **No automation-write API.** There is no public/unofficial way to write envelope curves into a `.cpr` project. The `.cpr` format is undocumented binary; the SKI is internal/NDA.
- **MIDI Remote API ≠ scripting.** It exists to *"bridge MIDI controller hardware and the Cubase environment"* (JavaScript ES5). It expects a hardware controller and cannot batch-insert curves.
- **Extra Cubase-specific trap:** a plugin's MIDI output is **not routed to the MIDI Remote input** (confirmed by Steinberg staff). To feed Cubase from a plugin you must create a **virtual MIDI endpoint via the OS MIDI API** and route through that.

### 5b. The *best achievable* Cubase workflow (and its friction)
The realistic path is **MIDI-CC modulation captured as automation** via **VST Quick Controls** (8 per track, each assignable to any VST param, automatable):

1. Load the synth in Cubase. *(user)*
2. Run Stride as a **VST3 MIDI effect** (or a separate app feeding a **virtual MIDI port**). *(needs a virtual-port install on Cubase)*
3. In Cubase, assign **VST Quick Controls** to the target params (e.g., Cutoff → QC1). *(manual, per parameter, max 8/track)*
4. MIDI-learn each Quick Control to a Stride CC. *(manual)*
5. Arm the QC lane for **write** (the `W` button), play the transport; Stride emits the drawn curve as CC; Cubase **records it as automation**. *(real-time only)*
6. Switch to **read** to play it back.

**Friction at every step:** virtual MIDI port setup, manual QC assignment, manual MIDI-learn, 8-param ceiling per track, 7-bit resolution, real-time recording (no instant offline inject), and **no auto-scan** of the rack. This is a fundamentally clunkier product than the Ableton experience — and it's essentially **what Cableguys MidiShaper already ships**, so we'd be entering an occupied category without our headline differentiator ("inject into the clip, no MIDI").

### 5c. Verdict on Cubase
**Do not lead the cross-DAW push with Cubase, and do not promise "same logic, same code."** Cubase is a worthwhile *eventual* target **only** through the wrapper architecture (§6, Option A), where Stride hosts the synth and modulates it directly — sidestepping every Cubase limitation above. Framed that way, Cubase's high value-gap becomes a real opportunity. Framed as "port the Ableton integration," it's impossible.

---

## 6. Recommended strategy (options + a pick)

> Per project rule #1 (spec before code), this section frames the options and a recommendation — we'd write a focused spec for whichever path you choose before building.

### Option A — **Wrapper VST3 ("Stride Host")**  ← recommended for true cross-DAW
Stride ships as a VST3/AU that **hosts the user's instrument/rack inside it**. As a mini-host it can legally **enumerate the hosted plugin's parameters** (recovering the "scan" pillar) and **modulate them with the drawn curves in real time** (recovering "draw → motion"). Identical behavior in **every DAW**, including Cubase, Logic, FL, Pro Tools.
- **Keeps:** the canvas, the scan-and-draw identity, cross-DAW uniformity.
- **Loses:** "inject straight into the clip envelope" (modulation is live/internal); to print motion into the DAW's own lanes you fall back to write-mode capture or MIDI CC.
- **Cost:** real plugin-hosting engine (JUCE `AudioPluginFormatManager`, or reuse an open host like Kushview Element). This is the big build.
- **Precedent:** Blue Cat PatchWork, DDMF Metaplugin, Unify.

### Option B — **MIDI-CC modulator VST3 ("Stride MIDI")**
Output curves as MIDI CC; user MIDI-learns targets.
- **Universal-ish, cheap to build**, but **directly competes with MidiShaper**, is 7-bit, per-DAW routing friction (and the Cubase virtual-port trap), and **drops scanning**. Weakest differentiation. Reasonable as a *fast, low-cost beachhead* or a companion feature, not the flagship.

### Option C — **Per-DAW deep integration, starting with REAPER**
Rewrite only the `m4l/` layer as **ReaScript** (scan via `TrackFX_GetParam*`, write via `GetFXEnvelope` + `InsertEnvelopePoint`), swap the WS bridge for OSC/file/REAPER's web server. **Full parity with the Ableton experience, including offline inject.** Small market, but the *only* "same logic" port and a strong proof that the cross-DAW canvas works.

### Suggested sequencing
1. **REAPER port (Option C)** — fastest real win, validates the cross-DAW canvas, keeps the full magic, satisfies the "same code" crowd. Low effort, high goodwill.
2. **Wrapper VST3 (Option A)** — the strategic universal product. This is what actually unlocks **Cubase, Logic, FL, Pro Tools** with meaningful value. Treat **Cubase as a primary beneficiary** of this build (high value-gap, paying users), not as a standalone "port."
3. Keep **"inject into your clips, zero MIDI" as the Ableton (+REAPER) exclusive** — it's a genuine differentiator for those platforms and honest marketing everywhere else.

**What to tell the users asking "is there a VST3 for my DAW?":** "A cross-DAW version is on the roadmap. REAPER gets the full experience; for other DAWs (Cubase included) Stride will run as a plugin that hosts your instrument and modulates it — the same draw-and-shape workflow, adapted to how each DAW lets plugins talk to it." (No "AI," no over-promising "same as Ableton.")

---

## Sources

**VST3 / plugin sandbox**
- Steinberg VST3 Dev Portal — Communication FAQ: https://steinbergmedia.github.io/vst3_dev_portal/pages/FAQ/Communication.html
- Steinberg VST3 Dev Portal — Parameters & Automation: https://steinbergmedia.github.io/vst3_dev_portal/pages/Technical+Documentation/Parameters+Automation/Index.html
- VST3 SDK headers `ivsteditcontroller.h`, `ivstmessage.h`, `ivstevents.h`: https://github.com/steinbergmedia/vst3_pluginterfaces
- LegacyMIDICCOutEvent (3.6.12): https://steinbergmedia.github.io/vst3_dev_portal/pages/Technical+Documentation/Change+History/3.6.12/LegacyMIDICCOutEvent.html
- JUCE `AudioProcessorParameter` (host "may use" gesture to record automation): https://docs.juce.com/master/classAudioProcessorParameter.html
- Steinberg forum — Cubase does not route plugin MIDI out to MIDI Remote (Arne Scheffler): https://forums.steinberg.net/t/help-send-midi-cc-events-to-host-cubase/798420
- Ableton — VST MIDI output merges to channel 1: https://help.ableton.com/hc/en-us/articles/209070189
- Bitwig — Unified Modulation System: https://www.bitwig.com/userguide/latest/the_unified_modulation_system/
- Apple TN2104 — Audio Unit events/gestures: https://developer.apple.com/library/archive/technotes/tn2104/_index.html

**Per-DAW APIs**
- REAPER ReaScript + API reference: https://www.reaper.fm/sdk/reascript/reascript.php · https://www.reaper.fm/sdk/reascript/reascripthelp.html
- REAPER envelope-from-FX-param example (ReaTeam): https://github.com/ReaTeam/ReaScripts/blob/master/Envelopes/spk77_Create%20envelope%20points%20from%20FX%20param%20values.lua
- FL Studio MIDI scripting + plugins module: https://www.image-line.com/fl-studio-learning/fl-studio-online-manual/html/midi_scripting.htm · https://il-group.github.io/FL-Studio-API-Stubs/midi_controller_scripting/plugins/
- Studio One scripting (forum) + DAWproject: https://studiooneforum.com/threads/studio-one-scripting-api.1356/ · https://github.com/bitwig/dawproject
- Bitwig Controller API stubs + DrivenByMoss: https://github.com/trappar/bitwig-api-stubs · https://github.com/git-moss/DrivenByMoss
- Pro Tools Scripting SDK / PTSL: https://developer.avid.com/scripting/ · https://kb.avid.com/pkb/articles/en_US/Knowledge/Pro-Tools-Scripting-SDK-FAQ
- Logic Scripter (GetParameter): https://support.apple.com/guide/logicpro/getparameter-function-lgce71e8f5c8/mac
- Cubase MIDI Remote API: https://steinbergmedia.github.io/midiremote_api_doc/

**Cubase workflow**
- VST Quick Controls (Steinberg): https://archive.steinberg.help/cubase_pro_artist/v9/en/cubase_nuendo/topics/vst_instruments/vst_instruments_vst_quick_controls_c.html
- Quick Controls + MIDI/automation (AudioSwift): https://audioswiftapp.com/quick-controls-in-cubase/
- Plugin parameter automation w/ MIDI Remote (Steinberg forum): https://forums.steinberg.net/t/plugin-parameter-automation-with-midi-remote-surface/1018511

**Market**
- Production Expert — 2025 DAW Survey: https://www.production-expert.com/production-expert-1/2025-daw-survey-the-results
- Sean Kim — DAW Market Share 2025 breakdown: https://blog.imseankim.com/daw-market-share-2025/
- DAW market size: https://www.mordorintelligence.com/industry-reports/digital-audio-workstation-market
- Cubase in orchestral/film scoring (VI-Control): https://vi-control.net/community/threads/the-industry-is-moving-more-and-more-towards-cubase-chair-of-the-film-scoring-department-at-berklee-do-you-agree.156541/

**Competitor / prior art**
- Cableguys MidiShaper (drawable LFO → MIDI CC, cross-DAW): https://www.cableguys.com/midishaper
- Blue Cat PatchWork (host-and-map model): https://www.bluecataudio.com/Products/Product_PatchWork/
- DDMF Metaplugin: https://www.soundonsound.com/reviews/ddmf-metaplugin-3
