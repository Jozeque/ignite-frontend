#!/usr/bin/env python3
"""
ReelCrop - reel renderer (direct to MP4, no Resolve node-graph needed)

Composes the finished vertical reel with ffmpeg:
    top 1/3 = your webcam (cropped from the landscape's cam box)
    bottom  = the content, square-cropped (and, in full mode, panning to
              follow your mouse)

Two modes:
    --still      render ONE composite frame to reel_still.png (fast - use this
                 to check the cam framing and content crop are right)
    (default)    render the full reel.mp4 from crop_keys.json (animated)

Usage:
    python render_reel.py RECORDING.mp4 --still
    python render_reel.py RECORDING.mp4 --still --at 3.0
    python render_reel.py RECORDING.mp4 --keys crop_keys.json -o reel.mp4

The cam region, content region and square size live in reelcrop_config.json.
The --still preview tells you if those numbers are right; tweak and re-run.
"""
import argparse
import json
import os
import subprocess
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
CONFIG = os.path.join(HERE, "reelcrop_config.json")


def load_config():
    with open(CONFIG, "r", encoding="utf-8") as f:
        return json.load(f)


def probe_dims(path):
    """Actual WxH of the input, or None if ffprobe isn't reachable."""
    try:
        out = subprocess.check_output(
            ["ffprobe", "-v", "error", "-select_streams", "v:0",
             "-show_entries", "stream=width,height", "-of", "csv=p=0", path],
            stderr=subprocess.STDOUT).decode().strip()
        w, h = out.splitlines()[0].split(",")[:2]
        return int(w), int(h)
    except Exception:
        return None


def clamp_boxes(c, dims):
    """Keep every crop inside the real frame (handles 1918x1078 vs 1920x1080)."""
    if not dims:
        return
    w, h = dims
    b = c["cam_box"]
    b["w"] = min(b["w"], w - b["x"])
    b["h"] = min(b["h"], h - b["y"])
    c["crop_size"] = min(c["crop_size"], h)            # square can't exceed height
    c["still_x"] = max(0, min(c.get("still_x", 0), w - c["crop_size"]))
    c["_in_w"], c["_in_h"] = w, h


def num(v):
    if abs(v - round(v)) < 1e-9:
        return str(int(round(v)))
    return ("%.4f" % v).rstrip("0").rstrip(".")


def cam_chain(c):
    """Crop the cam box, then scale-to-fill the top slot (center crop)."""
    b = c["cam_box"]
    return ("[0:v]crop=%d:%d:%d:%d,"
            "scale=%d:%d:force_original_aspect_ratio=increase,"
            "crop=%d:%d[cam]" % (
                b["w"], b["h"], b["x"], b["y"],
                c["out_w"], c["cam_top_h"],
                c["out_w"], c["cam_top_h"]))


def content_chain(c, x_value, y_value):
    """Square-crop the content at (x_value, y_value) - constants for --still, or
    t-expressions for the full render - then scale-to-fill the bottom slot."""
    bottom_h = c["out_h"] - c["cam_top_h"]
    s = c["crop_size"]
    return ("[0:v]crop=%d:%d:'%s':'%s',"
            "scale=%d:%d:force_original_aspect_ratio=increase,"
            "crop=%d:%d[content]" % (
                s, s, x_value, y_value,
                c["out_w"], bottom_h,
                c["out_w"], bottom_h))


def build_x_expr(keys):
    """Flat (shallow) piecewise-linear ffmpeg expression v(t) from [(t, v), ...].
    A flat sum of gated segments - avoids the deep if() nesting that overflows
    ffmpeg's expression parser when there are many keyframes."""
    if not keys:
        return "0"
    if len(keys) == 1:
        return num(keys[0][1])
    terms = ["%s*lt(t,%s)" % (num(keys[0][1]), num(keys[0][0]))]  # hold before first
    for i in range(len(keys) - 1):
        t0, v0 = keys[i]
        t1, v1 = keys[i + 1]
        if t1 <= t0:
            continue
        seg = "(%s+(%s)*(t-%s)/(%s))" % (num(v0), num(v1 - v0), num(t0), num(t1 - t0))
        terms.append("%s*gte(t,%s)*lt(t,%s)" % (seg, num(t0), num(t1)))
    terms.append("%s*gte(t,%s)" % (num(keys[-1][1]), num(keys[-1][0])))  # hold after last
    return "(" + "+".join(terms) + ")"


def run(cmd, cwd=None):
    print("\n$ " + " ".join(('"%s"' % a if " " in a else a) for a in cmd) + "\n")
    try:
        return subprocess.call(cmd, cwd=cwd)
    except FileNotFoundError:
        print("ffmpeg not found on PATH. Install it first (see the README), then "
              "open a NEW terminal so PATH refreshes.")
        return 127


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("input", help="landscape recording (mp4/mkv/mov)")
    ap.add_argument("--still", action="store_true",
                    help="render one composite frame to reel_still.png")
    ap.add_argument("--at", type=float, default=2.0,
                    help="--still: seconds into the clip to sample (default 2.0)")
    ap.add_argument("--keys", default=None,
                    help="crop_keys.json for the animated render")
    ap.add_argument("-o", "--out", default=os.path.join(HERE, "reel.mp4"))
    a = ap.parse_args()

    c = load_config()
    clamp_boxes(c, probe_dims(a.input))

    if a.still:
        x = c.get("still_x", 300)
        y = c.get("still_y", 0)
        fc = (cam_chain(c) + ";" + content_chain(c, str(x), str(y))
              + ";[cam][content]vstack=inputs=2[out]")
        out_png = os.path.join(HERE, "reel_still.png")
        cmd = ["ffmpeg", "-ss", str(a.at), "-i", a.input,
               "-filter_complex", fc, "-map", "[out]",
               "-frames:v", "1", "-update", "1", "-y", out_png]
        rc = run(cmd)
        if rc == 0:
            print("Wrote " + out_png + "  - open it and check the layout looks right.")
        sys.exit(rc)

    # full animated render
    if not a.keys or not os.path.exists(a.keys):
        print("Full render needs --keys crop_keys.json (run the mapper first).")
        print("To just check the layout now, use:  --still")
        sys.exit(2)
    with open(a.keys, "r", encoding="utf-8") as f:
        data = json.load(f)
    keys = data["keys"]  # [{"t":.., "x":.., "y":..}, ...]
    c["crop_size"] = min(int(data.get("crop_size", c["crop_size"])),
                         c.get("_in_h", c["source_h"]))
    S = c["crop_size"]
    in_w = c.get("_in_w", c["source_w"])
    in_h = c.get("_in_h", c["source_h"])

    # Pass 1: one crop that moves per-frame, driven by a sendcmd command file.
    # sendcmd targets the 'crop' filter class, so this pass holds exactly one
    # crop. Run it with cwd=HERE so the command file resolves by bare name (a
    # drive-letter colon in the path breaks the filtergraph parser).
    cmds = os.path.join(HERE, "_cmds.txt")
    with open(cmds, "w", encoding="utf-8") as f:
        for k in keys:
            t = float(k["t"])
            x = int(round(max(0.0, min(float(k["x"]), in_w - S))))
            y = int(round(max(0.0, min(float(k["y"]), in_h - S))))
            f.write("%.3f crop x %d;\n%.3f crop y %d;\n" % (t, x, t, y))
    content_raw = os.path.join(HERE, "_content_raw.mp4")
    p1 = ["ffmpeg", "-i", a.input,
          "-filter_complex", "[0:v]sendcmd=f=_cmds.txt,crop=%d:%d:0:0[out]" % (S, S),
          "-map", "[out]", "-an", "-y", content_raw]
    if run(p1, cwd=HERE) != 0:
        sys.exit(1)

    # Pass 2: static composite - cam cropped from the source on top, the moving
    # content from pass 1 scaled to fill the bottom.
    bottom_h = c["out_h"] - c["cam_top_h"]
    fc2 = (cam_chain(c) + ";"
           + "[1:v]scale=%d:%d:force_original_aspect_ratio=increase,crop=%d:%d[content];"
             % (c["out_w"], bottom_h, c["out_w"], bottom_h)
           + "[cam][content]vstack=inputs=2[out]")
    # -c:a copy keeps OBS's audio bit-for-bit (no re-encode, no quality loss)
    p2 = ["ffmpeg", "-i", a.input, "-i", content_raw,
          "-filter_complex", fc2, "-map", "[out]", "-map", "0:a?",
          "-r", str(c["fps"]), "-pix_fmt", "yuv420p", "-c:a", "copy",
          "-y", a.out]
    sys.exit(run(p2))


if __name__ == "__main__":
    main()
