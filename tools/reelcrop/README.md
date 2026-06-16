# ReelCrop

Auto-follow crop for vertical reels. You record your Ableton / Stride session
landscape in OBS (facecam in the top-right). ReelCrop logs your mouse during the
take and renders a finished **1080x1920 reel.mp4**:

- **top third** = your facecam (cropped from the cam box)
- **bottom two-thirds** = a square crop of Ableton that **follows your mouse**
  (mouse stays centered), smoothed, and **never showing any part of the cam**.

No DaVinci, no node graph, no hand-keyframing. One command in, finished reel out.
Target: IG reel spec, 1080x1920 @ 30fps.

## Requirements

- Python 3 (standard library) + ffmpeg on PATH (`winget install --id Gyan.FFmpeg -e`)
- `pip install obsws-python` (for the synced recorder)
- OBS WebSocket on: **Tools -> WebSocket Server Settings -> Enable**. Put the
  port/password into `reelcrop_config.json` under `"obs"`.

## Use it

```
python record.py            (or double-click record.cmd)
```

Run it, then **record in OBS as usual** — it watches OBS read-only (it never
starts/stops your recording) and logs your cursor in sync. Press **Stop in OBS**
when you're done (or press any key in the logger window). It writes the cursor
log, then auto-maps and renders the reel.

(Manual pipeline, if you ever want the steps separately:)

```
python mapper.py cursor_log.jsonl                       # -> crop_keys.json
python render_reel.py "<video>" --keys crop_keys.json   # -> reel.mp4
python render_reel.py "<video>" --still                 # one frame, to check boxes
```

## Tuning (`reelcrop_config.json`)

| Key | What it does |
|-----|--------------|
| `cam_box` | Where the facecam sits in the recording — the part cropped into the top slot (head/face). |
| `cam_avoid_box` / `cam_safe_margin` | The FULL camera PiP (shoulders/arm included) the bottom crop must never show, plus its safety pad. Raise these if any camera leaks into the content. |
| `crop_size` | Zoom of the bottom square. Smaller = tighter/more legible, and lets it slip below the cam. Keep `crop_size + cam_safe_margin <= 600` so it can tuck under the cam. |
| `smoothing.min_cutoff` / `beta` | Lower min_cutoff = smoother/laggier; higher beta = snappier on fast moves. |
| `monitor_offset` | Set to the Ableton monitor's top-left virtual-desktop coords if the follow looks shifted. |
| `obs` | host / port / password for OBS WebSocket. |

Keep your OBS layout consistent between videos — `cam_box` is calibrated to it.

## Files

- `record.py` - watches OBS (read-only) + logs cursor in sync + auto render
- `tracker.py` - cursor logging only (no OBS control)
- `mapper.py` - cursor log -> smoothed, cam-aware, mouse-centered crop keyframes
- `render_reel.py` - composes the final reel with ffmpeg (`--still` for a preview frame)
- `export_fusion.py` - optional DaVinci Fusion export (legacy path)

## Status

- [x] Cursor tracking + synced OBS recorder
- [x] One-Euro smoothing, mouse-centered crop, cam-aware (no cam in the bottom)
- [x] 2D animated render -> reel.mp4 (validated)
- [ ] First real take (verify sync + monitor offset, then tune zoom/smoothing)
