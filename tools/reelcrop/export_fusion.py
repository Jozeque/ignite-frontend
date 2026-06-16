#!/usr/bin/env python3
"""
ReelCrop - Fusion exporter  (Step 0: pipeline test)

Generates a Fusion node with an ANIMATED input that you paste into DaVinci
Resolve's Fusion page. Purpose right now: confirm that generated keyframes
actually paste in and play on YOUR Resolve. Free Resolve is fine - this uses
copy/paste, NOT the Studio-only scripting API.

Once that's confirmed, the same spline-writer drives the real moving crop.

Usage:
    python export_fusion.py --demo                 # big short zoom-punch -> reelcrop_test.setting
    python export_fusion.py keys.json -o out.setting

keys.json schema (for later / manual use):
    { "fps": 30, "input": "Size",
      "keys": [ {"t": 0.0, "v": 1.0}, {"t": 2.0, "v": 1.3}, {"t": 4.0, "v": 1.0} ] }
"""
import argparse
import json
import os

# Token-replace template (avoids Lua/Python brace clashes). Indentation is
# cosmetic - Fusion ignores it.
TEMPLATE = r'''{
	Tools = ordered() {
		ReelTransform = Transform {
			CtrlWZoom = false,
			Inputs = {
				__INPUT__ = Input {
					SourceOp = "ReelAnim",
					Source = "Value",
				},
			},
			ViewInfo = OperatorInfo { Pos = { 220, 16.5 } },
		},
		ReelAnim = BezierSpline {
			SplineColor = { Red = 237, Green = 142, Blue = 243 },
			NameSet = true,
			KeyFrames = {
__KEYS__
			}
		},
	}
}
'''


def num(v):
    """Trim 1.0 -> 1, 1.30000 -> 1.3."""
    if abs(v - round(v)) < 1e-9:
        return str(int(round(v)))
    return ("%.5f" % v).rstrip("0").rstrip(".")


def build(input_name, fps, keys):
    # collapse to frame -> value (last write wins on a collision), then sort
    frames = {}
    for k in keys:
        frames[int(round(k["t"] * fps))] = float(k["v"])
    lines = ["\t\t\t\t[%d] = { %s }," % (f, num(v)) for f, v in sorted(frames.items())]
    return TEMPLATE.replace("__INPUT__", input_name).replace("__KEYS__", "\n".join(lines))


def demo_keys():
    # Big, unmistakable double zoom-punch that completes inside ~1 second, so it
    # is obvious even on a very short test clip. 1.0 <-> 1.6 is a 60% scale swing.
    return [
        {"t": 0.0,  "v": 1.0},
        {"t": 0.25, "v": 1.6},
        {"t": 0.5,  "v": 1.0},
        {"t": 0.75, "v": 1.6},
        {"t": 1.0,  "v": 1.0},
    ]


def main():
    ap = argparse.ArgumentParser(description="ReelCrop Fusion exporter")
    ap.add_argument("keys", nargs="?", help="keyframes JSON (omit for --demo)")
    ap.add_argument("-o", "--out", default=None, help="output .setting path")
    ap.add_argument("--demo", action="store_true", help="emit a zoom-pulse test")
    ap.add_argument("--fps", type=float, default=30.0)
    a = ap.parse_args()

    here = os.path.dirname(os.path.abspath(__file__))

    if a.demo or not a.keys:
        input_name, fps, keys = "Size", a.fps, demo_keys()
        out = a.out or os.path.join(here, "reelcrop_test.setting")
    else:
        with open(a.keys, "r", encoding="utf-8") as f:
            d = json.load(f)
        input_name = d.get("input", "Size")
        fps = float(d.get("fps", a.fps))
        keys = d["keys"]
        out = a.out or (os.path.splitext(a.keys)[0] + ".setting")

    with open(out, "w", encoding="utf-8") as f:
        f.write(build(input_name, fps, keys))

    print("Wrote " + out)
    print("")
    print("Paste test:")
    print("  1. Open the file, select ALL, copy.")
    print("  2. In Resolve's Fusion page, click the empty node area, Ctrl+V.")
    print("  3. Wire  MediaIn -> ReelTransform -> MediaOut  and scrub the playhead.")
    print("  You should see a gentle zoom in/out. That proves the pipeline works.")


if __name__ == "__main__":
    main()
