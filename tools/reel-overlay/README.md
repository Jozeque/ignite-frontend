# STRIDE 9:16 Story Overlay

A transparent, always-on-top, **click-through** framing guide you float over Ableton
(or anything) to compose a vertical 9:16 reel/story. Everything outside the frame is
dimmed so you see exactly what lands in-frame while you arrange devices.

## Run

Double-click **`start-overlay.bat`** (uses the Electron already in `stride-vst/app`).

Or from a terminal in this folder:

```
..\..\stride-vst\app\node_modules\electron\dist\electron.exe .
```

## Use

- **Click-through everywhere** — Ableton stays fully usable underneath. Only the
  control bar, the **⠿ MOVE** grip, and the corner dots capture the mouse.
- Drag **⠿ MOVE** (top of frame) to reposition; drag a **corner dot** to resize
  (locked to 9:16). Or use the **Size** slider / presets.
- Toggles: **Thirds**, **Center** cross, **Safe zone** (approx Reels/TikTok caption +
  buttons UI so you keep key content clear).
- **Dim** slider controls how dark the outside is.
- **Display** cycles the overlay to your other monitor.
- **Record mode** hides the control bar + dim so only a clean frame remains; click the
  **◱ SHOW CONTROLS** chip (top-left) to bring it back.
- Readout shows the on-screen pixel size and the nominal **1080 × 1920** export.

### Shortcuts
`↑ ↓ ← →` nudge · `Shift`+`↑ ↓` resize · `C` center · `R` record ·
`Ctrl+Shift+X` quit · `Ctrl+Shift+H` hide/show the control bar

## Recording the reel

Set your screen recorder (OBS, etc.) to a **1080×1920** canvas and crop/position the
capture to the **inside** of the frame. Turn on **Record mode** first so the control bar
and dim don't get captured.
