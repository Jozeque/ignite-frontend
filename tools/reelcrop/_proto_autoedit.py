#!/usr/bin/env python3
"""ReelCrop - PROTOTYPE auto-edit (zoom-emphasized).

Reuses the cursor log for the CENTER (same as the normal tool) but ADDS a
variable ZOOM driven by signals: punch in when you dwell + audio is active,
pull back to the base framing during fast cursor transit. Camera stays hidden
(same avoid logic, variable crop size). Output is a separate -PROTO reel so the
normal pipeline is untouched. One-off experiment; not wired into record.py.

  python _proto_autoedit.py
"""
import os, sys, json, math, subprocess, importlib.util
import numpy as np
from PIL import Image

HERE = r"C:\Users\Yossi\Desktop\Desktop_MIDI_APP\tools\reelcrop"
SRC  = r"D:\Videos (D)\2026-06-15 11-58-07.mp4"
OUT  = r"D:\Stridehub content\Reels\2026-06-15 11-58-07 reel-PROTO.mp4"
FFMPEG, FFPROBE = "ffmpeg", "ffprobe"

# ---- tunables ----
FPS = 30
S_WIDE   = 580      # base framing (cam-safe; tucks under the cam)
S_TIGHT  = 400      # punch-in for emphasis (smaller = more zoom)
SPEED_REF = 700.0   # px/s that counts as "fast transit" -> no punch-in
W_DWELL, W_AUD = 0.55, 0.45
ZOOM_TC = 0.8       # seconds: zoom smoothing time-constant (higher = lazier)

spec = importlib.util.spec_from_file_location("mapper", os.path.join(HERE, "mapper.py"))
m = importlib.util.module_from_spec(spec); spec.loader.exec_module(m)
cfg = json.load(open(os.path.join(HERE, "reelcrop_config.json"), encoding="utf-8"))
W, H = cfg["source_w"], cfg["source_h"]
box = cfg["cam_avoid_box"]; margin = cfg["cam_safe_margin"]; cam = cfg["cam_box"]
sm = cfg["smoothing"]; monitors = cfg.get("monitors"); off = cfg.get("monitor_offset", {"x": 0, "y": 0})
dz = cfg.get("dead_zone", 0); DEB = 4

# ---- 1) follow center per cursor sample (replicate the mapper's smoothing) ----
samples = []
for line in open(os.path.join(HERE, "cursor_log.jsonl"), encoding="utf-8"):
    line = line.strip()
    if line:
        d = json.loads(line); samples.append((float(d["t"]), float(d["x"]), float(d["y"])))
samples.sort()
centers = []
fx = fy = None; fpx = fpy = None; committed = -1; pending = -1; pend_n = 0
for t, vx, vy in samples:
    fxr, fyr, mi = m.to_frame(vx, vy, monitors, off)
    if mi is None:
        continue
    if committed == -1:
        committed = mi
    elif mi != committed:
        if mi == pending: pend_n += 1
        else: pending, pend_n = mi, 1
        if pend_n < DEB: continue
        committed = mi; fx = fy = None; fpx = fpy = None
    if fx is None:
        fx = m.OneEuro(min_cutoff=sm["min_cutoff"], beta=sm["beta"])
        fy = m.OneEuro(min_cutoff=sm["min_cutoff"], beta=sm["beta"])
    sx, sy = fx(t, fxr), fy(t, fyr)
    if fpx is None: fpx, fpy = sx, sy
    ddx, ddy = sx - fpx, sy - fpy; dist = math.hypot(ddx, ddy)
    if dist > dz:
        fpx += ddx * (dist - dz) / dist; fpy += ddy * (dist - dz) / dist
    centers.append((t, fpx, fpy))

# ---- 2) frame grid + resample center ----
dur = float(subprocess.check_output(
    [FFPROBE, "-v", "error", "-show_entries", "format=duration", "-of", "csv=p=0", SRC]).decode().strip())
N = int(round(dur * FPS))
cts = np.array([c[0] for c in centers]); cxs = np.array([c[1] for c in centers]); cys = np.array([c[2] for c in centers])
ti = np.arange(N) / FPS
fpx_i = np.interp(ti, cts, cxs); fpy_i = np.interp(ti, cts, cys)
spd = np.zeros(N); spd[1:] = np.hypot(np.diff(fpx_i), np.diff(fpy_i)) * FPS

# ---- 3) audio RMS per frame ----
try:
    pcm = subprocess.run([FFMPEG, "-v", "quiet", "-i", SRC, "-map", "0:a:0",
                          "-ac", "1", "-ar", "8000", "-f", "s16le", "-"], capture_output=True).stdout
    a = np.frombuffer(pcm, np.int16).astype(np.float32) / 32768.0
    spf = 8000 / FPS
    rms = np.array([math.sqrt(float(np.mean(a[int(i * spf):int((i + 1) * spf)] ** 2)) + 1e-9)
                    if int(i * spf) < len(a) else 0.0 for i in range(N)])
    rms = rms / (rms.max() + 1e-9)
except Exception:
    rms = np.zeros(N)

# ---- 4) zoom envelope: dwell + audio -> punch in; fast transit -> base ----
dwell = 1.0 - np.clip(spd / SPEED_REF, 0, 1)
interest = np.clip(W_DWELL * dwell + W_AUD * rms, 0, 1)
s_target = S_WIDE - interest * (S_WIDE - S_TIGHT)
alpha = 1.0 - math.exp(-1.0 / (FPS * ZOOM_TC))
s_env = np.empty(N); acc = float(s_target[0]) if N else S_WIDE
for i in range(N):
    acc = acc + alpha * (s_target[i] - acc); s_env[i] = acc
s_env = np.clip(s_env, S_TIGHT, S_WIDE)

# ---- 5) per-frame crop window (center + variable size + cam-avoid) ----
Xs = np.empty(N, int); Ys = np.empty(N, int); Ss = np.empty(N, int)
side = None
for i in range(N):
    s = int(round(s_env[i]))
    X = m.clamp(fpx_i[i] - s / 2.0, 0, W - s); Y = m.clamp(fpy_i[i] - s / 2.0, 0, H - s)
    X, Y, side = m.avoid_cam(X, Y, s, box, W, H, margin, side)
    X = m.clamp(X, 0, W - s); Y = m.clamp(Y, 0, H - s)
    Xs[i], Ys[i], Ss[i] = int(round(X)), int(round(Y)), s
json.dump({"fps": FPS, "frames": [{"t": round(i / FPS, 3), "x": int(Xs[i]), "y": int(Ys[i]), "s": int(Ss[i])}
          for i in range(N)]}, open(os.path.join(HERE, "_proto_plan.json"), "w"))
print("plan: %d frames | zoom %d..%d px (smaller=tighter) | punch-in frames (<%d): %d (%.0f%%)"
      % (N, int(s_env.min()), int(s_env.max()), S_WIDE - 40,
         int((s_env < S_WIDE - 40).sum()), 100.0 * (s_env < S_WIDE - 40).mean()))

# ---- 6) streaming render: crop+zoom content + facecam, composite, with audio ----
OUTW, OUTH, CAMH = 1080, 1920, 480
CONH = OUTH - CAMH
DN = subprocess.DEVNULL


def fill(arr, Wt, Ht):
    im = Image.fromarray(np.ascontiguousarray(arr))
    sw, sh = im.size; sc = max(Wt / sw, Ht / sh)
    im = im.resize((max(1, round(sw * sc)), max(1, round(sh * sc))), Image.BILINEAR)
    nw, nh = im.size; l = (nw - Wt) // 2; t = (nh - Ht) // 2
    return im.crop((l, t, l + Wt, t + Ht))


dec = subprocess.Popen([FFMPEG, "-v", "quiet", "-i", SRC, "-f", "rawvideo", "-pix_fmt", "rgb24", "-"],
                       stdout=subprocess.PIPE, stderr=DN)
enc = subprocess.Popen([FFMPEG, "-y", "-v", "quiet", "-f", "rawvideo", "-pix_fmt", "rgb24",
                        "-s", "%dx%d" % (OUTW, OUTH), "-r", str(FPS), "-i", "-", "-i", SRC,
                        "-map", "0:v", "-map", "1:a:0?", "-c:v", "libx264", "-pix_fmt", "yuv420p",
                        "-c:a", "aac", "-shortest", OUT], stdin=subprocess.PIPE, stdout=DN, stderr=DN)
fsize = W * H * 3; i = 0
while True:
    buf = dec.stdout.read(fsize)
    if len(buf) < fsize:
        break
    fr = np.frombuffer(buf, np.uint8).reshape(H, W, 3)
    j = min(i, N - 1); s, X, Y = Ss[j], Xs[j], Ys[j]
    con = fill(fr[Y:Y + s, X:X + s], OUTW, CONH)
    cm = fill(fr[cam["y"]:cam["y"] + cam["h"], cam["x"]:cam["x"] + cam["w"]], OUTW, CAMH)
    out = Image.new("RGB", (OUTW, OUTH)); out.paste(cm, (0, 0)); out.paste(con, (0, CAMH))
    enc.stdin.write(np.asarray(out).tobytes()); i += 1
enc.stdin.close(); dec.stdout.close(); enc.wait(); dec.wait()
print("wrote %s  (%d frames)" % (OUT, i))
