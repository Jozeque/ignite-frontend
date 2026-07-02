# Stride VST — Demo Mode (permanent scope-cap)

**Status:** BUILT + tested (2026-07-02). Ships in **beta11** (public launch build — same
one binary serves free-upgrade customers who activate and new prospects who demo). Full Node
suite green (1037) incl. a dedicated **test-vst3-demo.js** (47 assertions); **pluginval
strictness-5 SUCCESS**. Launch/licensing state: see the entitlements memory.
**Model (REVISED — the 3-param cap was replaced during testing):** No time trial, **no param
cap**. UNLIMITED params so the demo shows the full "modulate everything" wow — the limiter is
a **play-synced move/freeze cycle**: modulation moves for **10s of PLAYBACK**, then
**FREEZES** (mapped knobs hold their last value) for **60s of real-time**, repeating. Plus
**save = nothing** and **offline render = noise**. (Rationale: Stride's value is the
modulation you *generate*, recordable in real time. A param cap hides the wow; a clean
time-window leaks captures. The freeze keeps params unlimited while making a continuous take /
clean bounce / saved project impractical — the bar is "impractical for real work", not
"uncrackable".)

**Locked decisions (2026-07-02):** NO param cap (unlimited); cycle = **10s playback move / 60s
real-time freeze**, TIED TO TRANSPORT (the move budget accrues only while playing, so setup
time is free; **stop pauses it**); freeze = **hold last value** (not mute), with a live orange
countdown on the badge; save = **nothing**; offline render = **noise**; cycle **persisted to
`stride-demo.json`** so a plugin reload can't grant a fresh window (deleting that file is the
only reset — tedious); scope = **VST only**; CTA = **Activate modal + "Get Stride VST" → LS
checkout** (both).

Whole thing is the SAME binary — the license result just picks **full vs demo**. Today
"no key" LOCKS the app (activation gate blocks the UI); demo mode flips that to "no key =
runs, but limited".

---

## 1. demoMode — the single source of truth

`demoMode == !entitled`, where `entitled` = the SAME product-scoped result the license gate
already computes (shipped beta8 / `dbc100a`): a valid, in-grace license carrying the
**Stride VST** entitlement — i.e. `License.h computeEntitled(...)` (VST product) is true, or
a builtin/pre-cutoff-StrideLink key. Reuse it verbatim; do NOT invent a second gate. It must
live in the PROCESSOR (the caps are enforced in native audio/state code, not the WebView, so
they can't be bypassed from JS):

```cpp
std::atomic<bool> demoMode { true };   // fail-safe default: limited until proven licensed
void setDemoMode (bool d) { demoMode.store (d); }
```

Sourcing:
- **Editor** validates the license (existing `handleLicense` / startup check) → calls
  `proc.setDemoMode(!entitled)`. Lifts the caps live the moment they activate.
- **Processor** must be correct even with the UI closed (offline bounce, headless) — so at
  construction it reads the CACHED license (`stride_license::load()` + the same builtin/
  offline-grace check the editor uses) to set the initial value. Default `true` if unknown.

## 2. The three caps (only when demoMode)

### (a) Play-synced move/freeze cycle  ← the main lever (REPLACED the 3-param cap)
No param cap — map as many as you like. Instead, `processBlock()` gates the drive on a
persisted, transport-tied cycle:
- Accumulate `demoMoveUsedMs` ONLY while the transport is playing (so loading/mapping/drawing
  doesn't burn it, and stopping pauses it). When it reaches `kDemoMoveSecs` (10s of playback),
  set `demoFreezeUntilMs = now + kDemoFreezeSecs*1000` (60s real-time freeze); reset the budget
  when the freeze elapses.
- While frozen, the drive loop is skipped (`! demoFreezeNow`) so hosted knobs HOLD their last
  value — the synth keeps sounding, just static (not muted).
- `demoFrozen` / `demoResumeSecs` are pushed to the badge (`demo_freeze` event) as a live orange
  countdown; the editor persists the cycle (`saveDemoCycleState` on change + every ~2s), and the
  processor restores it at construction (`loadDemoCycleState`) — so a reload continues mid-cycle.
- The FULL workflow (draw, all Motion tools, live drive, hosting synths, compact UI, ANY number
  of params) is available during the move window — the demo FEELS like the real thing, in 10s bursts.

### (b) Save disabled
In `getStateInformation()`:
```cpp
if (demoMode.load()) { /* write a tiny marker, no chain/mapped/lanes */ return; }
```
→ the DAW project won't recall Stride's chain or curves. They can evaluate within a session
but can't build a track that depends on it. (Open Q §7: save nothing vs save chain-only.)

### (c) Offline-render mute
In `processBlock()`, AFTER the chain runs, when the host is rendering offline (bounce /
freeze / export):
```cpp
if (demoMode.load() && isNonRealtime())
    // overwrite output with low-level noise so an export can't be clean; real-time
    // playback (evaluation) is untouched. Real-time resample still works but is capped
    // to 3 params anyway, so there's little worth grabbing.
```

## 3. License-gate / UI change

Today `index.html`'s `#activation-overlay` blocks everything until `unlockApp()`. Change it
to run-in-demo, with three license states:
- **No/invalid key → demo.** Don't block; show a persistent, non-modal **DEMO badge** + two
  CTAs: **Activate** (the existing key-entry form) and **Get Stride VST** (the LS checkout,
  so the demo converts directly).
- **Valid key but NOT VST-entitled** (a StrideLink-only key = the existing "doesn't include
  Stride VST" case) → **also demo**, but the message reads **"Upgrade to Stride VST"** and the
  CTA is the checkout. This is the upsell path for StrideLink users past the free-upgrade cutoff.
- **Valid VST entitlement → full**, badge hidden, caps lifted (`setDemoMode(false)`).
- **Param-cap message** (em-dash-free per copy rule): when `demoCapHit` / `mapped.size()>=3`
  in demo, inline `Demo mode. 3 params max. Get Stride VST for unlimited.` + the checkout CTA.
- Activation/upgrade success anywhere flips demoMode off live (no relaunch).
- **Checkout URL** (from the launch setup): `https://strideengine.lemonsqueezy.com/checkout/buy/cd9e5114-080a-48f2-ae27-7c99169f438d`
  (Stride VST product 1188468, $99). Open via `window.stride.openExternal`.

## 4. What the demo does NOT limit (so it converts)
Full feel on the 3 lanes: point/free draw, all Motion generators (Chaos/Neuro/…), live
drive, bars, hosting the user's own synths, the whole compact UI. The demo's job is "prove
the workflow feels great in my session" — the full "modulate EVERYTHING" wow lives in the
marketing reels, not the demo. Funnel: video wows → demo tries the workflow → buy for unlimited.

## 5. Edge cases
- **Licensed project opened in demo** (>3 mapped): keep/drive/expose only the first 3;
  surface "N params hidden — activate to restore all". Don't crash, don't silently drop
  their data on the licensed side (we save nothing in demo anyway, so their original project
  is intact when reopened licensed).
- **Grace expiry:** an entitled user who goes offline past the 14-day grace → falls to demo
  until they reconnect (same as today's gate, just demo instead of locked).
- **Anti-tamper:** caps are native + off the signed entitlement; the UI can't flip them. A
  binary patch can, as with all DRM — goal is casual-proof, not uncrackable. Don't over-invest.

## 6. Files to touch
- `stride-wrapper/m0-spike/src/PluginProcessor.h/.cpp` — `demoMode`/`setDemoMode` +
  `demoCapHit`, the cap in `mapParam` + on restore, save-off in `getStateInformation`,
  offline-mute in `processBlock`, cached-license read at construction.
- `stride-wrapper/m0-spike/src/PluginEditor.cpp` — after `handleLicense`/startup validate,
  call `proc.setDemoMode(!entitled)`; push demo state + cap-hit to the UI in `rack_scanned`/
  a small event.
- `stride-wrapper/m0-spike/src/License.h` — a `cachedEntitled()` helper (reuse the existing
  builtin + offline-grace logic) for the processor's construction-time read.
- `ui/index.html` + `ui/shim.js` — don't block on no-key; DEMO badge + Activate modal +
  param-cap message.

## 7. Decisions (LOCKED 2026-07-02)
1. **Save-off:** save NOTHING (no chain/mapped/lanes) in demo. Cleanest "can't build on it".
2. **Offline render:** low-level NOISE (an obviously-demo bounce), not silence.
3. **Scope:** VST wrapper ONLY. Desktop (Ableton M4L) parity deferred, revisit later.
4. **NO param cap** (unlimited). The limiter is the play-synced **10s-move / 60s-freeze** cycle
   (persisted, transport-tied, freeze = hold last value) — shows the full wow, blocks real use.
5. **Buy CTA:** BOTH — an **Activate** modal (for key holders) AND a **Get Stride VST** link to
   the LS checkout (product 1188468, $99); the same checkout doubles as the "Upgrade" upsell
   for StrideLink-only keys.

## 8. Build gate
Do NOT start before the launch is out and stable (2026-07-03). Then: build → CI (Win+Mac) →
smoke-test the three license states (no key = demo/3-cap; StrideLink-only key = demo/upgrade
msg; VST key = full) → beta11.
