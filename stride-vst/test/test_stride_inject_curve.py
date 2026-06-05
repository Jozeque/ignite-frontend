#!/usr/bin/env python3
"""
Parity test for StrideInject/_curve.py — the Python mirror of
shared/rasterizer.js (sampleSegment) + shared/log-scaling.js
(shouldUseLog / scaleValue).

The direct-inject path's fidelity depends on this Python math matching the JS
canvas math exactly. The expected values below are the SAME ones asserted in
test/test-rasterizer.js, so if the two ever drift, one of the suites fails.

Run: python test/test_stride_inject_curve.py
"""

import os
import sys

sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", "remote_script", "StrideInject"))
import _curve  # noqa: E402

passed = 0
failed = 0


def check(name, got, want, eps=1e-6):
    global passed, failed
    if abs(got - want) <= eps:
        print("  ok   %s" % name)
        passed += 1
    else:
        print("  FAIL %s: got %r want %r" % (name, got, want))
        failed += 1


def check_bool(name, got, want):
    global passed, failed
    if bool(got) == bool(want):
        print("  ok   %s" % name)
        passed += 1
    else:
        print("  FAIL %s: got %r want %r" % (name, got, want))
        failed += 1


# ── sample_segment: matches the canvas quadratic bezier (== test-rasterizer.js) ──
check("sample_segment linear midpoint", _curve.sample_segment(0, 1, 0, 0.5), 0.5)
check("sample_segment linear quarter", _curve.sample_segment(0, 1, 0, 0.25), 0.25)
# cv=0.5: cp = 0.5 + 0.5*1*1.2 = 1.1 ; B(0.5) = 2*0.25*1.1 + 0.25 = 0.8
check("sample_segment convex 0->1 cv0.5", _curve.sample_segment(0, 1, 0.5, 0.5), 0.8)
# v0=0.2,v1=0.8,cv=0.5: cp = 0.5 + 0.5*0.6*1.2 = 0.86 ; B(0.5)=0.05+0.43+0.2 = 0.68
check("sample_segment convex 0.2->0.8 cv0.5", _curve.sample_segment(0.2, 0.8, 0.5, 0.5), 0.68)

# ── scale_value: matches shared/log-scaling.js ──
check("scale linear 0.5 of 0..127", _curve.scale_value(0.5, 0, 127, False), 63.5)
check("scale log 0.5 of 20..20000", _curve.scale_value(0.5, 20, 20000, True), 20 * (1000 ** 0.5), 1e-3)
check("scale clamps >1", _curve.scale_value(1.7, 0, 100, False), 100.0)
check("scale clamps <0", _curve.scale_value(-0.3, 0, 100, False), 0.0)

# ── should_use_log: first hit wins ──
check_bool("log via is_log flag", _curve.should_use_log("Macro", 0.0, 1.0, True), False)  # min<=0 → False even with flag
check_bool("log via is_log flag (valid range)", _curve.should_use_log("Macro", 1.0, 2.0, True), True)
check_bool("log via name Cutoff", _curve.should_use_log("Filter Cutoff", 20.0, 20000.0, False), True)
check_bool("log via freq name", _curve.should_use_log("Osc Freq", 20.0, 20000.0, False), True)
check_bool("log via range heuristic", _curve.should_use_log("Whatever", 100.0, 20000.0, False), True)
check_bool("no log: linear macro", _curve.should_use_log("Macro", 0.0, 127.0, False), False)
check_bool("no log: degenerate range", _curve.should_use_log("X", 0.0, 1.0, False), False)

# ── adaptive_steps: the direct-inject step generator ──────────────────────────
# Locks the promises to the user: (1) FIDELITY — at the probe grid (the emit
# decision points) the staircase is within EPS of the curve (≥99.75%); between
# grid points a smooth curve stays under 1% (≥99%). We drop redundant duplicate
# steps, NOT resolution. (2) SAFETY — step count is bounded by CLIP LENGTH, not
# curve wiggle or point count, so the writer can't be made to emit the ~128k
# steps that crashed Ableton.
PROBE = 0.02
EPS = 0.0025


def _staircase_at(steps, t):
    """Held value at time t — the value of the LAST step whose start <= t, which
    is exactly insert_step semantics (a step sets the value from its start time
    onward). Steps are sorted by start time."""
    val = steps[0][2]
    for (st, _dur, v) in steps:
        if st <= t + 1e-9:
            val = v
        else:
            break
    return val


def _true_norm_at(pts, target_length, t):
    """Normalized curve value at t — the same math adaptive_steps probes."""
    sp = sorted(pts, key=lambda p: p["time"])
    if t <= sp[0]["time"]:
        return max(0.0, min(1.0, sp[0]["value"]))
    for i in range(len(sp)):
        t0 = sp[i]["time"]; v0 = sp[i]["value"]; cv = sp[i].get("curve", 0) or 0
        if i + 1 < len(sp):
            t1 = sp[i + 1]["time"]; v1 = sp[i + 1]["value"]
        else:
            t1 = target_length; v1 = v0; cv = 0
        if t1 > t0 and t0 <= t <= t1 + 1e-9:
            return max(0.0, min(1.0, _curve.sample_segment(v0, v1, cv, (t - t0) / (t1 - t0))))
    return max(0.0, min(1.0, sp[-1]["value"]))


# FIDELITY at the probe grid (the emit decision points): <= EPS.
# min=0,max=1,linear → native == normalized for a direct comparison.
_curvy = [
    {"time": 0, "value": 0.0, "curve": 0.6},
    {"time": 8, "value": 1.0, "curve": -0.6},
    {"time": 16, "value": 0.25, "curve": 0.0},
    {"time": 24, "value": 0.9},
    {"time": 32, "value": 0.1},
]
_steps = _curve.adaptive_steps(_curvy, 32, 0.0, 1.0, False, PROBE, EPS)
_GRID = int(round(32 / PROBE))
_dev_grid = max(abs(_staircase_at(_steps, k * PROBE) - _true_norm_at(_curvy, 32, k * PROBE))
                for k in range(_GRID + 1))
check("adaptive fidelity at grid: <= EPS (>=99.75%)", _dev_grid, 0.0, EPS + 1e-6)

# FIDELITY continuous (between grid points): a smooth curve stays under 1%
# (>=99%). Sharp edges are instead captured at the 0.02-beat (~10ms) grid.
_dev_cont = 0.0
_t = 0.0
while _t <= 32:
    _dev_cont = max(_dev_cont, abs(_staircase_at(_steps, _t) - _true_norm_at(_curvy, 32, _t)))
    _t += 0.005
check_bool("adaptive fidelity continuous: <1% (>=99%)", _dev_cont < 0.01, True)

# COVERAGE: steps tile the whole clip (durations sum to clip length, no gaps).
check("adaptive coverage: durations sum to clip length",
      sum(d for (_, d, _) in _steps), 32.0, 1e-6)

# SAFETY BOUND: count never exceeds the fixed grid (clip_len/probe), regardless
# of how many points were drawn. 32 beats / 0.02 = 1600 grid slots.
check_bool("adaptive bound: count <= grid", len(_steps) <= _GRID + 4, True)
_dense = [{"time": 32.0 * k / 4999, "value": float(k % 2)} for k in range(5000)]
_dense_steps = _curve.adaptive_steps(_dense, 32, 0.0, 1.0, False, PROBE, EPS)
check_bool("adaptive bound: 5000-point input still <= grid", len(_dense_steps) <= _GRID + 4, True)

# FLAT COLLAPSE: a flat lane is ONE held step — no redundant duplicates.
_flat = [{"time": 0, "value": 0.5}, {"time": 32, "value": 0.5}]
_flat_steps = _curve.adaptive_steps(_flat, 32, 0.0, 1.0, False, PROBE, EPS)
check_bool("adaptive flat collapse: flat lane -> 1 step", len(_flat_steps) == 1, True)
check("adaptive flat collapse: held at 0.5", _staircase_at(_flat_steps, 16.0), 0.5, 1e-6)

# NATIVE SCALING: a log cutoff sweep stays in range and rises monotonically.
_sweep = [{"time": 0, "value": 0.0}, {"time": 16, "value": 1.0}]
_log_steps = _curve.adaptive_steps(_sweep, 4, 20.0, 20000.0, True, PROBE, EPS)
check_bool("adaptive native: log values within [min,max]",
           all(20.0 - 1e-6 <= v <= 20000.0 + 1e-6 for (_, _, v) in _log_steps), True)
check_bool("adaptive native: log sweep monotonic up",
           all(_log_steps[i][2] <= _log_steps[i + 1][2] + 1e-6 for i in range(len(_log_steps) - 1)), True)

print("\n%d passed, %d failed" % (passed, failed))
sys.exit(0 if failed == 0 else 1)
