#!/usr/bin/env python3
"""
ReelCrop - cursor tracker

Records where your mouse is while you do your take, so the crop can follow
your work automatically. Dependency-free (Windows ctypes, no pip installs).

Start it right before you hit Record in OBS, do your take, press Ctrl+C when
done. Writes cursor_log.jsonl - one JSON object per sample:

    t   : seconds since the tracker started (line this up with your clip start)
    x,y : cursor position in virtual-desktop pixels (spans all your monitors)

This is the entire tracking job. You don't click anything per region - the
mouse IS the input. Because it's the same PC, when you switch to Stride your
cursor moves onto that screen and this keeps following it, no extra work.

(OBS-timecode sync is the next refinement, so t lines up to the exact frame
without you having to start the tracker and the recording together.)
"""
import ctypes
import json
import os
import sys
import time

POLL_HZ = 60
OUT = os.path.join(os.path.dirname(os.path.abspath(__file__)), "cursor_log.jsonl")


class POINT(ctypes.Structure):
    _fields_ = [("x", ctypes.c_long), ("y", ctypes.c_long)]


def cursor():
    p = POINT()
    ctypes.windll.user32.GetCursorPos(ctypes.byref(p))
    return int(p.x), int(p.y)


def main():
    if not sys.platform.startswith("win"):
        print("Windows only (uses user32.GetCursorPos).")
        return

    period = 1.0 / POLL_HZ
    samples = []
    start = time.perf_counter()
    next_t = start

    print("Tracking your cursor @ %d Hz. Press Ctrl+C to stop." % POLL_HZ)
    print("Tip: start this, THEN hit Record in OBS.\n")

    try:
        while True:
            t = time.perf_counter() - start
            x, y = cursor()
            samples.append({"t": round(t, 4), "x": x, "y": y})

            sys.stdout.write("\r  t=%6.1fs   x=%5d  y=%5d   samples=%d   "
                             % (t, x, y, len(samples)))
            sys.stdout.flush()

            next_t += period
            sleep = next_t - time.perf_counter()
            if sleep > 0:
                time.sleep(sleep)
            else:
                next_t = time.perf_counter()  # we fell behind; resync
    except KeyboardInterrupt:
        pass

    with open(OUT, "w", encoding="utf-8") as f:
        for s in samples:
            f.write(json.dumps(s) + "\n")

    dur = samples[-1]["t"] if samples else 0.0
    print("\n\nStopped. %d samples over %.1fs -> %s" % (len(samples), dur, OUT))


if __name__ == "__main__":
    main()
