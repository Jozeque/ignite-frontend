# StrideBridge — Stride VST modulates Ableton's own devices (Phase 1 spec)

**Status: POC validated on the rig 2026-08-26** (live.remote~ architecture, StrideBridgePOC.maxpat).
Spec-first, per working rules. Nothing below is built.

## What this is

Stride VST becomes the one surface for two target kinds per lane:

- **host** — a parameter of a VST3 hosted inside Stride (today's behavior, untouched)
- **live** — a parameter of anything in the Ableton set (Operator, Auto Filter, mixer, any device),
  driven by a thin new `StrideBridge.amxd` output stage via `live.remote~`

Mapping gesture stays the Stride gesture: press **Map Live** in Stride, click any knob in Live,
it becomes a lane. No scan, no list.

## Components

### 1. StrideBridge.amxd (new device, deliberately dumb)

One instance anywhere in the set (live.remote~ targets by id, not track). Contents:

- `node.script` running a WebSocket **server on :9101** (9100 stays StrideLink's; both coexist,
  no port fight, none of server.js's heartbeat/relay complexity is needed)
- a **fixed bank of 16 lane voices**: `buffer~` + `phasor~ @lock 1` (rate in ticks =
  `bars * 1920`, times the lane's SPEED multiplier) + `wave~` + `live.remote~`
- a Map section: `live.path live_set view selected_parameter` + `live.object` probe of the
  clicked param (`name`, `is_quantized`, `min`, `max`, path string)
- UI: connection LED + "mapping…" indicator only. All real UI lives in the VST.

**Buffer fill path (v1):** node.script rasterizes lane points with `shared/rasterizer.js`
(the tested single source of truth), writes a temp `.wav`, sends `replace <file>` to that
lane's `buffer~` — exactly the mechanism the POC already proved. No 88k-float Max messages.

### 2. VST WebView (shim.js + canvas.js)

- A second transport: a plain `WebSocket("ws://127.0.0.1:9101")` **opened from JS in the
  WebView**. The JUCE bridge is untouched; likely **zero C++ for transport**.
- Lane flavor `live`: created by the Map-Live flow, labeled from the bridge's echo
  `{name, device, path, id, is_quantized, min, max}`.
- `is_quantized == 1` → refuse the mapping with a toast ("stepped controls can't be
  modulated") instead of creating a dead lane.
- **Ranges, locks, mirror/Link, speed all apply VST-side, before rasterization.** The bridge
  only ever receives final 0..1 curves. Lock = send a constant buffer. This keeps every
  existing lane feature working on live lanes with no bridge logic.
- Edit-commit (mouseup / debounced ~150ms) → `{type:'set_live_lane', lane, bars, speed, points}`.

### 3. Engine (C++) — the real Phase 1 cost

Live lanes must survive .als save/reload, and engine state is the only durable store
(localStorage is lossy — established rule). So:

- Lane target field in engine state: **v10**, attrs `lt` (target type) + `lp` (LOM path string).
- Engine treats live lanes as inert curve holders: it does not tick them into any hosted
  plugin. Their playback happens in Max, locked to Live's transport — which is also what makes
  them sample-accurate without the engine's involvement.
- On project load: VST reconnects to :9101, re-pushes every live lane's curve, bridge
  **re-resolves path → id fresh** (LOM ids are session-scoped; paths can shift if the user
  reorders tracks/devices). Unresolvable target → reuse the 1.4.1 missing-device report
  pattern: one toast naming what couldn't be found, lane kept but marked.

## Explicit v1 scope cuts

- **Transport-locked loops only.** Free/endless run modes and MIDI-triggered (keyswitch) modes
  don't map to a looping buffer; live lanes hide those controls in v1.
- 16 live lanes max (the bank). Raise later if CPU headroom allows (need the gate-4 number).
- No modulation of quantized/enum params (Live's own limitation, surfaced honestly).
- Unmap must truly unbind (send id 0 to live.remote~ and verify the knob is released —
  explicit test, this is the "knob hostage" trap).

## Build order

- **A.** Bridge device with one hardcoded lane fed over WS from a test script — no VST changes.
- **B.** shim.js WS + Map-Live flow behind a dev flag; lanes live in-session only.
- **C.** Engine v10 persistence + reload re-bind + missing-target report.
- **D.** Polish: speed ladder on live lanes, toasts, demo gating parity, docs.

Each step is independently testable on the rig before the next.

## Open questions (answers wanted before step C)

1. Gate 4's CPU % from the POC run — sets whether 16 voices is conservative or generous.
2. Gate 2 (fidelity vs baked .alc) and gate 3 (transport reset) — assumed green from
   "it's working", not individually confirmed.
3. live.remote~ normalization: did the POC sweep land musically right on Cutoff, or was the
   range off? Decides whether the bridge sends normalized 0..1 or pre-scaled values.
