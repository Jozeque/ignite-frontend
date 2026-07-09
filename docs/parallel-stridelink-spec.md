# Parallel per-track StrideLink — spec

## Goal
Today, multiple StrideLink devices are all remotes for **one** canvas, which
operates on the currently-selected rack. They all show the same status and drive
the same active rack.

The ask: let each StrideLink modulate **its own track, independently and
simultaneously**. Four StrideLinks on four tracks = four "Strides", each with its
own params, curves, status readout, and inject target. No re-selecting or
re-scanning to move between them.

## Why it isn't that today
- One Electron canvas (port 9100) = one engine. It holds **one** rack's params
  (`sdCanvasParams`) at a time and follows Ableton's track selection (auto-scan
  on focus/select).
- Devices are thin remotes: commands relay to the one canvas (command relay),
  status mirrors back to every device (state relay, shipped in 2.1.0). So they're
  identical views of one engine.
- Canvas state IS already saved per-rack (`canvas_<rackId>.json`), so switching
  racks restores that rack's curves — but only one is "live" at a time.

## Proposed: a track-scoped multi-rack engine
Keep **one** Electron app (one process, light), but make it hold and operate
**multiple racks at once**, each addressed by the device that owns it.

### 1. Each device knows its track
A StrideLink can resolve its host track through the LOM (`this_device` →
canonical_parent → track id + name). So every device has a stable track identity
and tags everything it sends with it.

### 2. Route everything by track id
- **Commands** carry the device's track id → `quick <action> <trackId>`. The
  canvas applies the action to **that** rack, not the active one.
- **Status** becomes per-rack: the state-relay file goes from one readout to a
  map `{ trackId: readout }`. Each device's bridge reads **its** track's entry,
  so four devices show four independent readouts at the same time.
- **Inject** routes per-track: device N's Inject writes rack N's curves into
  track N's clip (StrideInject targets that track's clip by absolute path, not
  the focused `detail_clip`).

### 3. Canvas becomes multi-rack
- Refactor the single `sdCanvasParams` into a map
  `sdRacks[trackId] = { params, bars, moveStack, ... }`.
- The canvas scans + caches each device's rack on that device's first command.
- Generators / transforms / inject take a **target trackId** and operate on
  `sdRacks[trackId]`.
- The visible window still edits **one** rack at a time (the selected one); the
  others operate headlessly in memory, driven by their devices. (Optional later:
  a rack switcher / tabs to see them all.)

## Changes by component
| Component | Change |
|---|---|
| **StrideLink.amxd** | Resolve host track id via LOM (`this_device` parent). Append it to every `quick` message. Status box keyed to this device's track. |
| **server.js (bridge)** | Command-relay payload carries `trackId`. State relay becomes a per-track map; each bridge reads only its own track's entry. |
| **canvas.js** | `sdCanvasParams` → `sdRacks[trackId]` map. Scan-on-demand per track. Every generator/transform/inject takes a target rack. Status emitted keyed by trackId. |
| **StrideInject** | Inject into a **specified** track's clip by path, not just the focused clip. Per `docs/multi-track-inject-spec.md`: feasible, but carries the structural misroute risk flagged there. |

## Feasibility + risks
- **Device track id:** feasible — `this_device` → parent track is a standard LOM lookup.
- **Multi-rack canvas:** feasible refactor — per-rack save already exists; this generalizes from 1 to N.
- **Per-track status relay:** feasible — the relay just shipped; make it keyed.
- **Per-track inject:** feasible (the resolver takes absolute paths) BUT the
  positional/identity misroute risk from `multi-track-inject-spec` applies. Gate
  it with that spec's safety: fingerprint-verify → dry-run → snapshot/revert.
- **Node-leak / multi-bridge:** with N devices there are already N bridges
  fighting over 9100; the relay tolerates it and track-scoped routing rides the
  same relay. The leak is still a separate underlying fix.
- **One canvas connection:** the canvas connects to one bridge (the port-holder);
  all devices' commands relay to it tagged by track; the canvas operates each
  rack. Works.

## Phasing
- **Phase 0 — Track identity:** StrideLink resolves + reports its host track id; prove it's stable across the set and survives duplication.
- **Phase 1 — Multi-rack canvas + command routing:** `sdRacks` map; commands route by trackId; generators/transforms operate per-rack (still one visible rack).
- **Phase 2 — Per-track status relay:** keyed relay; each device shows its own rack.
- **Phase 3 — Per-track inject:** with the multi-track-inject safety gates.
- **Phase 4 (optional) — Canvas rack switcher:** see/edit all held racks in the window.

## Lighter alternative (if full parallel is overkill)
**Device-driven auto-switch:** keep the single-rack engine, but a device press
first **auto-selects its track** (the canvas instantly switches to that rack)
then acts. Feels per-device, far smaller build. Downside: not truly simultaneous
— the canvas is on one rack at a time and the status still reflects the active
rack, so the devices would NOT show their own status at the same moment. It does
not deliver the per-device-status independence you noticed; only the full
multi-rack engine does.
