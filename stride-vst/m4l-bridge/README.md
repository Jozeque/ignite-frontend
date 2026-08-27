# StrideBridge — assembling and installing the device

The output stage that lets Stride VST modulate Ableton's own devices.
Everything here is source; the `.amxd` is assembled once in Live's Max editor
(the repo never holds binary Max devices — StrideLink rule).

## One-time assembly

1. `npm install` in THIS folder (fetches `ws` for node.script).
2. In Live: drop a blank **Max Audio Effect** on any track → click its edit (patcher) icon.
3. In the Max editor: **File → Open** `StrideBridge.maxpat` from this folder.
4. Copy everything (Cmd/Ctrl+A, Cmd/Ctrl+C) into the blank device's patcher, or just
   **File → Save As…** the opened patcher as `StrideBridge.amxd` **into this folder** —
   the device must live next to `bridge-server.js`, `bridge_max.js`, `rasterizer.js`,
   `log-scaling.js`, `stride_voice.maxpat` and `node_modules/`, because node.script and
   the voice abstraction resolve by file location.
5. Live's audio prefs: **Scheduler in Overdrive** + **in Audio Interrupt** ON (same as the POC).

Max console should print `[StrideBridge] listening on :9101`.

## Using it

- One instance anywhere in the set. `live.remote~` targets by parameter id, not track.
- In Stride VST, the **MAP LIVE** button appears automatically once the bridge is
  detected (the WebView connects to :9101 and the button un-hides).
- Press MAP LIVE → click any knob in Live → it becomes a Stride lane. If the knob you
  want is *already* Live's selected parameter, click a different knob first, then it —
  the detector triggers on selection *change* (Live's own Map buttons share this).
- Stepped/enumerated controls (filter type menus, Operator's algorithm selector) are
  refused with a toast — Live does not allow modulating quantized parameters.

## What to expect

- Modulation keeps running with the Stride window closed — buffers and bindings live in
  the device, not in the plugin UI. Reopening Stride reclaims the lanes.
- Nothing is written into clips. This is live modulation (it renders on bounce);
  Inject-style visible automation stays a StrideLink feature.
- A bound knob can't be hand-moved while its lane exists (live.remote~ semantics —
  same as Envelope Follower's Remote Control). Removing the lane releases it.

## Sync rule

`rasterizer.js` and `log-scaling.js` are **copies** of `stride-vst/shared/`. Edit the
shared originals and re-copy — never fork the math here (canvas parity contract).

## Rollback

Delete the StrideBridge device from the set. The VST hides its MAP LIVE button when
the socket drops and hosted-plugin lanes are untouched. Plugin-side changes are behind
`vst3 revert`: tag `pre-stride-bridge`.

## Shipping (in the release zips since 1.4.x)

Both platform zips carry a `StrideBridge/` folder: the .amxd + 4 js files +
user README + Outfit.ttf. **Users need NO npm install** - the VST link (:9102)
runs on Node built-ins; the ws server (:9101) is dev tooling only and degrades
gracefully when node_modules is absent. The repo's `StrideBridge.amxd` is the
canonical shipping artifact - after ANY generator change, re-patch the deployed
device AND refresh the repo copy (the drift-guard test fails otherwise).
