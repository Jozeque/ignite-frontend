# StrideQuick — "Map" button spec

A single device-side button named **Map** that records from the StrideLink panel instead of
Ableton's transport, so the user can map params without reaching for the main record button.
It is **view-aware**: it reads the focused view and triggers the matching record.

- Patch fragment: `docs/StrideQuick-map-button.maxpat`
- Self-contained: drives `live_set` / `live_app` directly via `live.object` / `live.path`.
  No connection to `scanner_max.js` or `node.script`, no WebSocket, works with the canvas app closed.

---

## Behavior

| State | Focused view | What Map does | LOM call(s) on `live_set` |
|-------|--------------|---------------|---------------------------|
| Press ON | **Arranger** | Arrangement Record + roll | `set record_mode 1` → `call start_playing` |
| Press ON | **Session** | Arm selected track, then Session Record | `selected_track set arm 1` → `call trigger_session_record` |
| Press OFF | either | Stop record + stop transport | `set record_mode 0` → `call stop_playing` |

View is read each press from `live_app view` → `get focused_document_view` (returns `Session` or `Arranger`).

## Why these LOM members (verified, Live 12 / Cycling '74 LOM)

- **`record_mode`** — get/set. `1` = Arrangement Record button on. Directly settable; already used in `scanner_max.js`.
- **`trigger_session_record`** — function. "Starts recording in either the selected slot or the next empty slot, **if the track is armed**." This is the Session Record equivalent — the Session Record *button state* (`session_record_status`) is **read-only**, so you start it with this function, not by setting a property.
- **`Track.arm`** — get/set. We arm `live_set view selected_track` so `trigger_session_record` has an armed track to record into. (With Ableton's **Record Session automation → All Tracks** setting on — which Stride's Setup Guide already recommends — arming is belt-and-suspenders, but it makes Session Map work regardless of that setting.)
- **`focused_document_view`** — read-only, returns `"Session"` / `"Arranger"`. The branch key.
- **`start_playing` / `stop_playing`** — transport roll/stop, so it rolls even if "Start Transport with Record" is off.

> LOM naming trap, for the record: the settable `session_record` boolean maps to **Session Overdub**, not Session Record. We deliberately don't use it.

## Dataflow (how the patch is wired)

```
loadbang ─┬─> [live.path live_set]      -> [live.object]  (SONG  = obj-6, the hub)
          └─> [live.path live_app view] -> [live.object]  (VIEW  = obj-8)

[textbutton "Map"] -> [sel 1 0]
   ON (1)  -> [t b b]  right: arm   -> [t b b] right: bang [live.path …selected_track] -> [live.object] (TRACK = obj-10)
                                         left: [set arm 1] -> TRACK
                       left:  read  -> [get focused_document_view] -> VIEW
                                       VIEW -> [route focused_document_view] -> [sel Session Arranger]
                                          Session  -> [call trigger_session_record] -> SONG
                                          Arranger -> [t b b] right:[set record_mode 1]->SONG  left:[call start_playing]->SONG
   OFF (0) -> [t b b]  right:[set record_mode 0]->SONG   left:[call stop_playing]->SONG
```

`trigger` (`t b b`) fires **right outlet first**, so ordering is: arm before read; refresh the
selected-track path before `set arm 1`; engage `record_mode` before `start_playing`.

## Wiring into StrideLink.amxd

1. Open `StrideLink.amxd` in Max (edit mode, Ctrl+E to unlock).
2. Open `docs/StrideQuick-map-button.maxpat`, select all (Ctrl+A), copy (Ctrl+C).
3. Paste (Ctrl+V) into StrideLink's patcher.
4. Open the Presentation view, position the **Map** button in the panel next to the other buttons.
5. Save / freeze the device. Re-copy `StrideLink.amxd` to the repo before building (per the release rule).

No outlets to connect to existing objects — the fragment is end-to-end on its own.

## Caveats / decisions

- **Session record creates a clip.** `trigger_session_record` records into the selected/next-empty
  slot — that's faithful to clicking Session Record. If you'd rather map param moves **without** a new
  clip, swap `obj-14` from `call trigger_session_record` to `set session_automation_record 1`
  (Automation Arm) with a clip already playing; param moves then write into that clip's automation.
- **Arrangement record writes to the arrangement timeline.** Expected; it's the Arrangement Record button.
- **`start_playing` while already rolling** relocates to the insert marker — a minor jump. Acceptable for a map pass.
- **Arming the selected track** is included (obj-22 / obj-23). Remove those two boxes if you don't want Map to touch arm state; Session record then relies on the user having a track already armed.
- **State reflection is button-local.** If the user stops recording from Ableton's transport, the Map
  button still shows ON. v2 polish: observe `record_mode` and push `set 0/1` back into the button.

## Optional variants

- **Jump to the right slot/marker** before recording (Session: select a clip slot; Arrangement: set `start_marker`).
- **Switch view** instead of branching: `live_app view` → `call focus_view Session|Arranger`.
- **Reflect record state** with an observer feeding `prepend set` → the Map button (same idiom as the Motion-Rescan `↻` button).
