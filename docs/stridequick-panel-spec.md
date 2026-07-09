# StrideQuick — M4L Quick-Control Panel (fresh v2 spec)

**Status:** specced, not implemented. Spec-first per project rules.
**One-liner:** a folding panel on the StrideLink device, next to "Open Canvas", whose buttons are shortcuts that drive the canvas remotely over the existing WebSocket. The canvas (Electron app) stays the single source of truth and updates the instant any button is pressed. No screen switching.

> Supersedes the OLD "StrideQuick" concept (a parallel live.remote~ audio-rate modulator, see memory `project_stridequick_spec`). This reuses the name for a different, simpler feature: a remote control surface for the canvas.

---

## The design principle that guarantees safety

StrideQuick calls the SAME `window.sd*` functions the canvas buttons already call. It introduces NO new generator logic. Therefore it automatically inherits every existing invariant: lane-lock respect, undo (`pushUndo`), selection-awareness, redraw, status messages. A StrideQuick press is identical to a canvas click, because it is the same function call, triggered remotely. The only NEW canvas code is one composed-from-existing-helpers function (global Prism) plus two backward-compatible optional arguments. Everything else is message plumbing.

---

## Architecture (rides the existing spine)

```
 Max UI button                server.js (node.script)            Electron app (canvas)
 ─────────────                ───────────────────────            ─────────────────────
 [msg "quick chaos"] ─inlet─► Max.addHandler('quick') ─sendToApp─► strideLink.on('quick_command')
                                                                       │
                                                                       ▼
                                                              sdHandleQuickCommand(action)
                                                                       │ calls existing window.sd* fn
                                                                       ▼
                                                              canvas mutates + redraws instantly
                                                                       │
 number boxes / LED ◄─outlet─ Max.outlet('quick_state') ◄─send─── _sdSendQuickState()
 (chain/canvas/bars/conn)     (handleAppMessage case)
```

Two new message types, nothing existing touched:
- `quick_command` (M4L → app): "do this action on the canvas"
- `quick_state` (app → M4L): "here are the current counts / bars / connection for your display"

---

## Button → function map (verified against the code)

| Panel button | Calls (canvas.js) | Scope | Status |
|---|---|---|---|
| **Rescan** | `window.sdRefreshSync()` (525) | re-sync scan | reuse as-is |
| **Chaos** | `window.sdApplyGlobalChaos()` (3424) | all unlocked lanes | reuse as-is |
| **Neuro** | `window.sdApplyGlobalNeuro()` (3389) | all unlocked lanes | reuse as-is |
| **Reflector** | `window.sdApplyGlobalReflector()` (3640) | all unlocked (needs ≥2) | reuse as-is |
| **S&H** | `window.sdApplyGlobalSampleHold()` (3471) | all unlocked lanes | reuse as-is |
| **Prism** | `window.sdApplyGlobalPrism()` | source = lane[0], variants to all other unlocked lanes | **NEW (composes existing Prism helpers)** |
| **Mutate** | `window.sdMutate(allUnlocked)` (4379) | all unlocked lanes (ignores selection) | **MODIFY: add optional targets arg** |
| **Shuffle** | `window.sdShuffleLanes()` (6650) | all unlocked lanes | reuse as-is |
| **2x** | `window.sdTimeStretch(2, allUnlocked)` (4101) | all unlocked lanes (stretch, slower) | **MODIFY: add optional targets arg** |
| **1/2x** | `window.sdTimeStretch(0.5, allUnlocked)` | all unlocked lanes (compress, faster) | same |
| **Loop 4/8/16/32** | `window.sdSetBars(n, true)` (325) | sets canvas bars (+ inject length) | reuse as-is |
| **Inject to Clip** | `window.applyToAbletonDirect()` (1616) | direct inject | reuse as-is |
| **Counter (chain / canvas)** | `quick_state` push | display only | **NEW plumbing** |

Note: the panel deliberately uses the GLOBAL (all-lanes) versions of Chaos/Neuro/S&H. The canvas SHAPES-row buttons that target a single lane (`sdApplyTemplate('chaos_lfo')`, `sdApplySampleHoldLane()`) are left untouched and keep working as before.

---

## The three NEW / MODIFIED app-side pieces

### 1. `window.sdApplyGlobalPrism()` — NEW
Prism today is a live-draw TOOL (`_sdPrismCompute` keyed on `sdActiveParamId`). The panel needs a one-shot. Per the user: source = the first parameter in the canvas (lane[0]); every other unlocked lane receives a variant.

Implementation: a faithful copy of `_sdPrismCompute` with two differences, composing the existing, tested helpers (`_sdPrismExtractAnchors`, `_sdPrismAssignPersonalities`, `_sdPrismGenerateVariant`, `_sdPrismMakeRng`, `_sdPrismHashStr`):
- source is `sdCanvasParams[0]`, not `sdActiveParamId`.
- uses a LOCAL seed + LOCAL personality map. It must NOT write the module globals `_sdPrismRngSeed` / `_sdPrismPerLane` and must NOT set `_sdActiveTool`, so it never disturbs an in-progress live Prism session.

Guards: needs ≥2 lanes; lane[0] must have points (else status "Draw on the first lane first"); recipients = unlocked lanes except lane[0]. `pushUndo()` first, selection-aware, ends with `sdResetSliderSnapshots(); sdRenderSidebar(); sdDrawCanvasGrid();` like its siblings. Lives next to `_sdPrismCompute` in canvas.js so it can see the closure helpers.

### 2. `window.sdMutate(targetsOverride)` — MODIFY (backward-compatible)
Today: `const targets = sdGetTargetParams().filter(p => p.points.length >= 2)`. Change to `const base = targetsOverride || sdGetTargetParams();` then the same filter. Existing canvas call `sdMutate()` (no arg) is byte-identical. Panel calls `sdMutate(sdGetUnlockedParams())`.

### 3. `window.sdTimeStretch(factor, targetsOverride)` — MODIFY (backward-compatible)
Today: early-returns on `!sdActiveParamId`, then uses `sdGetTargetParams()`. Change to: `const targets = targetsOverride || sdGetTargetParams(); if (!targetsOverride && !sdActiveParamId) return;` then iterate `targets`. Existing call `sdTimeStretch(2)` keeps the active-lane guard and behavior. Panel calls `sdTimeStretch(<factor>, sdGetUnlockedParams())`.

Both modifications preserve the existing call sites exactly (the new parameter is optional and defaults to current behavior). Verified existing callers pass no override.

---

## Message protocol (exact)

### M4L → app: `quick_command`
- Max button sends to the node.script inlet: `quick <action> [arg]` (one message target for every button).
- server.js (NEW, additive):
  ```js
  Max.addHandler('quick', (action, arg) => {
      sendToApp({ type: 'quick_command', action: String(action), arg: (arg !== undefined ? arg : null) });
  });
  ```
- app (NEW): `strideLink.on('quick_command', m => window.sdHandleQuickCommand(m.action, m.arg));`
- actions: `rescan, chaos, neuro, reflector, sh, prism, mutate, shuffle, double, half, bars` (arg = 4/8/16/32), `inject`.

### app → M4L: `quick_state`
- app (NEW):
  ```js
  function _sdSendQuickState() {
      strideLink.send({ type: 'quick_state',
          on_chain: _sdLastChainParamCount, on_canvas: sdCanvasParams.length,
          bars: sdGetBars(), connected: strideLink.connected ? 1 : 0 });
  }
  ```
  Called after every quick action, on `rack_scanned` (also set `_sdLastChainParamCount = msg.parameters.length`), on `connected`/`disconnected`, and on bars change.
- server.js (NEW case in `handleAppMessage`):
  ```js
  case 'quick_state':
      Max.outlet('quick_state', msg.on_chain||0, msg.on_canvas||0, msg.bars||4, msg.connected?1:0);
      break;
  ```
- Max: node.script outlet → `[route quick_state]` → `[unpack 0 0 0 0]` → two number boxes (chain / canvas), bars highlight, connection LED.

### `sdHandleQuickCommand` dispatcher (NEW, canvas.js)
A switch mapping each action to the function in the table above, then `_sdSendQuickState()`. `bars` does `sdSetBars(parseInt(arg)||4, true)`. `inject` does `applyToAbletonDirect()`.

---

## Files touched (all additive or backward-compatible)

1. `m4l/node/server.js`: + `Max.addHandler('quick', …)`; + `case 'quick_state'`. No existing handler changed. The "dumb bridge" stays dumb: it only forwards.
2. `app/renderer/canvas.js`: + `sdApplyGlobalPrism`, + `sdHandleQuickCommand`, + `_sdSendQuickState` (+ `_sdLastChainParamCount`); modify `sdMutate` / `sdTimeStretch` signatures (optional arg); + `strideLink.on('quick_command', …)` and state-push call sites near the other `strideLink.on` registrations (701-1067).
3. `app/renderer/ws-client.js`: nothing required (generic `on`/`send` already cover it). Optional thin helpers for readability.
4. `shared/message-types.js`: + `QUICK_COMMAND`, `QUICK_STATE` constants for consistency.

No change to: the .alc path, the inject Remote Script, the scanner, the gate feature, read-existing-curves, or any generator's logic.

---

## What YOU build in the device (kept minimal)

- The folding panel UI (bpatcher / subpatch with a toggle that shows/hides it, open by default). Pure Max UI, your call on the look.
- Each button → a `[message]` object `quick <action>` → into the node.script inlet. Bars buttons send `quick bars 8` etc. One inlet, one message format.
- The node.script outlet → `[route quick_state]` → `[unpack 0 0 0 0]` → wire to: chain number box, canvas number box, bars-highlight logic, connection LED.
- That is the entire Max job: messages out, four numbers in. No LOM, no JavaScript, no generator code. The bridge and the app do everything else.

I will hand you the literal list of button-to-message strings and the route/unpack patch when the backend is in.

---

## Counter semantics (v1)

- `on_canvas` = `sdCanvasParams.length` (lanes currently loaded). Always known by the app.
- `on_chain` = parameter count from the most recent scan (stored from `rack_scanned`). App-sourced, so the device needs zero LOM work.
- After a normal scan they match; they diverge if lanes were removed or a session loaded without a fresh sync, which is exactly the "you should Rescan" signal that makes this useful day to day.
- Phase 2 option (deferred): a live "mapped params on chain" count computed by the device's own LOM scan, for catching newly-mapped macros before a rescan. Costs Max work, so not in v1.

---

## Connection / app-not-open handling

If the app is disconnected, `sendToApp` is already a guarded no-op, so quick presses do nothing harmful. The device already emits `app_connected` / `app_disconnected` on its status outlet, and `quick_state.connected` lets the panel gray out and prompt "Open Canvas" (the existing button right next to it launches the app). Quick buttons are inert and safe while disconnected.

---

## Immediate-reflection guarantee

Every target function ends with `sdRenderSidebar(); sdDrawCanvasGrid();`. The Electron renderer keeps running even when the window is minimized or behind Ableton, so the canvas is updated the instant a button is pressed and is already correct when the user glances at it. No screen switching, which is the whole point. Inject runs its existing async toast flow (`inject_success` / `inject_error`).

---

## Risk analysis (nothing-breaks)

- **Existing canvas buttons:** unchanged. The two modified functions take optional args that default to current behavior; verified existing callers pass none.
- **Live Prism tool:** untouched. The one-shot uses isolated local seed + personalities and never sets `_sdActiveTool` or the Prism module globals.
- **.alc path, inject Remote Script, scanner, gate, read-curves:** not touched at all.
- **Bridge:** only an additive handler and a new case. The forward-only "dumb bridge" contract holds; all logic stays in the canvas (source of truth).
- **Lane-lock / undo / selection:** inherited for free, because the same functions are called.
- **Rapid presses / disconnect / no lanes / all locked:** handled by each function's own existing guards (status messages, early returns).
- **Performance:** generators run on the renderer main thread and are fast (point math, not LOM). The known inject drain cost is a separate, already-specced issue and is unchanged here.

## Test plan

- Existing suites unaffected: `test-prism.js`, `test-sample-hold.js` (generator logic unchanged).
- Add: dispatcher unit (action string → correct function called); `sdApplyGlobalPrism` (lane[0] is the source and is left unchanged; recipients changed; locked lanes skipped; <2 lanes and empty-lane[0] guarded); `sdMutate` / `sdTimeStretch` override parity (override path equals a manual all-unlocked-lanes run); message round-trip (quick_command in → function fires; quick_state out → correct 4-tuple).

---

## Phased plan

- **Phase 0 (backend glue, my job):** protocol + server.js handler/case + canvas dispatcher + the three functions + state push. After this, the app is fully drivable by sending `quick_command` over the socket, testable with zero Max UI (drive it from a tiny script or the devtools console).
- **Phase 1 (Max UI, your job):** build the folding panel, wire buttons to `quick <action>` messages, wire the `quick_state` outlet to the display. I provide the exact message list and the route/unpack patch.
- **Phase 2 (polish):** live chain count, inject progress shown in the panel, optional on-device toasts.

---

## Locked decisions (resolved 2026-06-16)

- **2x / 1/2x = time-stretch, direct factor.** "2x" stretches the pattern to 2x its length (slower / more spread) via `sdTimeStretch(2)`. "1/2x" compresses to half length (faster / denser, with tiling) via `sdTimeStretch(0.5)`. Label matches the factor.
- **Mutate / 2x / 1/2x = "select all + transform".** They target EVERY unlocked lane regardless of any on-canvas selection, i.e. the dispatcher passes `sdCanvasParams.filter(p => !p.locked)`. This affects all lanes (the stated intent) without persistently flipping the canvas selection state, so the user sees no surprise selection left behind. Locks are still respected (lock = absolute don't-touch).
- Other defaults stand: global generators for Chaos/Neuro/Reflector/S&H, app-sourced counts, Rescan = `sdRefreshSync`.
