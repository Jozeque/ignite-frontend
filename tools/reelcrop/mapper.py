#!/usr/bin/env python3
"""
ReelCrop - mapper

Turns a cursor log (from the tracker, in recording-frame pixels) into smoothed,
cam-aware, mouse-centered square-crop keyframes for the renderer.

  - centers a square on the cursor  (your mouse stays in the middle of the bottom)
  - One-Euro smoothing               (glides instead of jittering)
  - never overlaps the cam box       (no cam ever leaks into the bottom frame)
  - clamps to the frame edges
  - decimates to a compact keyframe list

Usage:
    python mapper.py cursor_log.jsonl              -> crop_keys.json
    python mapper.py cursor_log.jsonl -o keys.json
"""
import argparse
import json
import math
import os

HERE = os.path.dirname(os.path.abspath(__file__))
CONFIG = os.path.join(HERE, "reelcrop_config.json")


class OneEuro:
    """One-Euro filter - low jitter at rest, low lag on fast moves."""

    def __init__(self, freq=60.0, min_cutoff=1.0, beta=0.0, d_cutoff=1.0):
        self.freq = freq
        self.min_cutoff = min_cutoff
        self.beta = beta
        self.d_cutoff = d_cutoff
        self.x_prev = None
        self.dx_prev = 0.0
        self.t_prev = None

    def _alpha(self, cutoff):
        tau = 1.0 / (2 * math.pi * cutoff)
        te = 1.0 / self.freq
        return 1.0 / (1.0 + tau / te)

    def __call__(self, t, x):
        if self.x_prev is None:
            self.x_prev = x
            self.t_prev = t
            return x
        dt = t - self.t_prev
        if dt > 1e-6:
            self.freq = 1.0 / dt
        dx = (x - self.x_prev) * self.freq
        a_d = self._alpha(self.d_cutoff)
        dx_hat = a_d * dx + (1 - a_d) * self.dx_prev
        cutoff = self.min_cutoff + self.beta * abs(dx_hat)
        a = self._alpha(cutoff)
        x_hat = a * x + (1 - a) * self.x_prev
        self.x_prev = x_hat
        self.dx_prev = dx_hat
        self.t_prev = t
        return x_hat


def clamp(v, lo, hi):
    return lo if v < lo else (hi if v > hi else v)


def avoid_cam(X, Y, S, cam, W, H, margin=0, prev_side=None):
    """Guarantee the SxS content square never overlaps the camera.

    `cam` is the FULL camera footprint (the whole PiP - shoulders/arm included,
    not just the face shown in the top slot), grown by `margin` on every side for
    safety. The cam sits in the top-right corner, so the square escapes by sliding
    fully LEFT of it or tucking fully BELOW it.

    The escape side is COMMITTED for the whole time the square is inside the cam
    zone: pick the nearest escape on entry, then hold it until the square is fully
    clear again (`prev_side` resets to None when clear). Entry and exit are smooth
    (the push is ~0 at the cam's edge), and committing kills the jump-cut you'd get
    if the left/below choice were re-evaluated every frame and flip-flopped while
    the cursor lingers behind the cam. Returns (X, Y, side); thread `side` back in."""
    x0 = cam["x"] - margin
    y0 = cam["y"] - margin
    x1 = cam["x"] + cam["w"] + margin
    y1 = cam["y"] + cam["h"] + margin
    overlaps = (X + S > x0) and (X < x1) and (Y + S > y0) and (Y < y1)
    if not overlaps:
        return X, Y, None             # clear of the cam: end the episode
    x_left = x0 - S                   # slide left:  right edge -> cam's (padded) left
    y_down = y1                       # tuck down:   top edge   -> cam's (padded) bottom
    can_left = x_left >= 0
    can_down = y_down + S <= H
    if prev_side == "left" and can_left:
        side = "left"                 # already committed this episode - hold it
    elif prev_side == "down" and can_down:
        side = "down"
    else:                             # entering the zone: commit to the nearest escape
        left_push = (X + S) - x0
        down_push = y1 - Y
        if can_left and (not can_down or left_push <= down_push):
            side = "left"
        elif can_down:
            side = "down"
        elif can_left:
            side = "left"
        else:
            return max(0, x_left), Y, "left"   # nothing fits: best-effort hug left
    if side == "left":
        return x_left, Y, "left"
    return X, y_down, "down"


def to_frame(vx, vy, monitors, off):
    """Map a virtual-desktop cursor point onto recording-frame coords, plus the
    monitor index it's on. OBS shows whichever monitor the cursor is on, so each
    monitor carries its own (virtual rect) -> (frame rect) transform."""
    if monitors:
        for i, m in enumerate(monitors):
            if m["vx"] <= vx < m["vx"] + m["vw"] and m["vy"] <= vy < m["vy"] + m["vh"]:
                fxc = m["fx"] + (vx - m["vx"]) * (m["fw"] / float(m["vw"]))
                fyc = m["fy"] + (vy - m["vy"]) * (m["fh"] / float(m["vh"]))
                return fxc, fyc, i
        return None, None, None       # in a gap / off every captured monitor
    return vx - off["x"], vy - off["y"], 0   # single-monitor fallback


def load_config():
    with open(CONFIG, "r", encoding="utf-8") as f:
        return json.load(f)


def simplify_1d(ts, vs, eps):
    """Indices of a value series to keep so linear interpolation stays within
    eps px of the original (iterative Douglas-Peucker on (t, value))."""
    n = len(ts)
    keep = set()
    if n == 0:
        return keep
    keep.add(0)
    keep.add(n - 1)
    stack = [(0, n - 1)]
    while stack:
        a, b = stack.pop()
        if b <= a + 1:
            continue
        ta, va, tb, vb = ts[a], vs[a], ts[b], vs[b]
        dt = tb - ta
        dmax, idx = eps, -1
        for i in range(a + 1, b):
            pred = va + (vb - va) * ((ts[i] - ta) / dt) if dt else va
            d = abs(vs[i] - pred)
            if d > dmax:
                dmax, idx = d, i
        if idx != -1:
            keep.add(idx)
            stack.append((a, idx))
            stack.append((idx, b))
    return keep


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("log", help="cursor_log.jsonl (recording-frame pixel coords)")
    ap.add_argument("-o", "--out", default=os.path.join(HERE, "crop_keys.json"))
    a = ap.parse_args()

    c = load_config()
    W, H = c["source_w"], c["source_h"]
    S = c["crop_size"]
    cam = c["cam_box"]
    cam_avoid = c.get("cam_avoid_box", cam)        # FULL PiP footprint to keep out
    cam_margin = c.get("cam_safe_margin", 0)
    off = c.get("monitor_offset", {"x": 0, "y": 0})
    sm = c.get("smoothing", {"min_cutoff": 1.0, "beta": 0.02})

    monitors = c.get("monitors")

    samples = []
    with open(a.log, "r", encoding="utf-8") as f:
        for line in f:
            line = line.strip()
            if not line:
                continue
            d = json.loads(line)
            samples.append((float(d["t"]), float(d["x"]), float(d["y"])))
    samples.sort(key=lambda s: s[0])

    # Map each sample onto the frame via its monitor, with two stabilizers:
    #  - monitor debounce: a new screen must persist a few samples before we
    #    switch to it, so a cursor grazing the edge can't flip the shot
    #  - dead-zone follow: the crop only chases the cursor once it leaves a small
    #    box, so resting your hand or tiny jitter doesn't pan the shot at all
    dz = c.get("dead_zone", 60)
    DEBOUNCE = 4

    raw = []
    fx = fy = None
    fpx = fpy = None
    cam_side = None
    committed, pending, pend_n = -1, -1, 0
    for t, vx, vy in samples:
        fxr, fyr, mi = to_frame(vx, vy, monitors, off)
        if mi is None:
            continue                            # between screens: hold
        if committed == -1:
            committed = mi                      # first monitor: commit at once
        elif mi != committed:
            if mi == pending:
                pend_n += 1
            else:
                pending, pend_n = mi, 1
            if pend_n < DEBOUNCE:
                continue                        # not committed yet: hold
            committed = mi                      # commit the switch -> snap
            fx = fy = None
            fpx = fpy = None
            cam_side = None
        if fx is None:
            fx = OneEuro(min_cutoff=sm["min_cutoff"], beta=sm["beta"])
            fy = OneEuro(min_cutoff=sm["min_cutoff"], beta=sm["beta"])
        sx, sy = fx(t, fxr), fy(t, fyr)
        if fpx is None:
            fpx, fpy = sx, sy
        ddx, ddy = sx - fpx, sy - fpy
        dist = math.hypot(ddx, ddy)
        if dist > dz:                           # cursor left the dead-zone: follow
            fpx += ddx * (dist - dz) / dist
            fpy += ddy * (dist - dz) / dist
        X = clamp(fpx - S / 2.0, 0, W - S)      # center square on the follow point
        Y = clamp(fpy - S / 2.0, 0, H - S)
        X, Y, cam_side = avoid_cam(X, Y, S, cam_avoid, W, H, cam_margin, cam_side)  # keep the WHOLE cam out
        X = clamp(X, 0, W - S)
        Y = clamp(Y, 0, H - S)
        raw.append((round(t, 3), int(round(X)), int(round(Y))))

    # Dense per-sample keyframes: the renderer drives the crop per-frame with
    # sendcmd (no expression-length limit), so there's no decimation and none of
    # the interpolation drift that came with it.
    keys = [{"t": t, "x": X, "y": Y} for (t, X, Y) in raw]

    out = {"fps": c["fps"], "crop_size": S, "keys": keys}
    with open(a.out, "w", encoding="utf-8") as f:
        json.dump(out, f, indent=2)
    print("Wrote %s  (%d keys from %d samples)" % (a.out, len(keys), len(samples)))


if __name__ == "__main__":
    main()
