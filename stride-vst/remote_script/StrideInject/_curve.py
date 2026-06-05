"""
Pure curve + value-scaling helpers for StrideInject.

NO Ableton imports — so this module is unit-testable outside Live
(see test/test_stride_inject_curve.py) and is the single Python mirror of
shared/rasterizer.js (sampleSegment) + shared/log-scaling.js (shouldUseLog /
scaleValue).

⚠️  These reproduce the CANVAS draw math exactly. If the JS side changes, this
must change too — the JS test-rasterizer.js LOCKSTEP test and this file's
parity test (test_stride_inject_curve.py) guard both sides against silent
drift. The `1.2` factor and the sign convention come straight from
canvas.js (~1805) via shared/rasterizer.js.
"""


def sample_segment(v0, v1, cv, s):
    """Value at normalized progress s in [0,1] along the segment v0->v1.

    Mirror of shared/rasterizer.js `sampleSegment`:
        cv == 0 -> straight line
        else    -> quadratic bezier, control = midV + cv*|v1-v0|*1.2
    Returns curve-space value (may slightly overshoot [0,1]; caller clamps).
    """
    if not cv:
        return v0 + (v1 - v0) * s
    mid = (v0 + v1) / 2.0
    cp = mid + cv * abs(v1 - v0) * 1.2
    om = 1.0 - s
    return om * om * v0 + 2.0 * om * s * cp + s * s * v1


def should_use_log(name, mn, mx, is_log):
    """Mirror of shared/log-scaling.js `shouldUseLog` — first hit wins:
    explicit is_log -> cutoff/freq name -> classic audio-frequency range."""
    try:
        mn = float(mn)
        mx = float(mx)
    except (TypeError, ValueError):
        return False
    if mn <= 0 or mx <= mn:
        return False
    if is_log:
        return True
    n = (name or "").lower()
    if "cutoff" in n or "freq" in n:
        return True
    if (mx / mn) >= 100 and mn >= 10 and mx >= 5000:
        return True
    return False


def scale_value(v, mn, mx, use_log):
    """Mirror of shared/log-scaling.js `scaleValue`. v clamped to [0,1].
        linear: mn + v*(mx-mn)
        log:    mn * (mx/mn)^v
    """
    mn = float(mn)
    mx = float(mx)
    c = max(0.0, min(1.0, float(v)))
    if use_log:
        return mn * ((mx / mn) ** c)
    return mn + c * (mx - mn)


def adaptive_steps(points, target_length, mn, mx, use_log,
                   probe_beats=0.02, eps=0.0025):
    """Approximate the canvas curve as held steps: return
    [(time, duration, native_value), ...].

    Probe the curve on a fixed `probe_beats` grid (sample_segment), then emit a
    step ONLY where the normalized value moves >= `eps` since the last emit.
    Flat/slow stretches collapse to one held step; every move is kept at probe
    resolution — redundancy removal, NOT resolution loss. `eps` already captures
    any drift >= 0.25%, so no max-gap is needed.

    Fidelity: at the probe grid the staircase is within `eps` of the curve
    (>=99.75%). BETWEEN grid points it can lag by at most the curve's movement
    over one `probe_beats` step — well under 1% for musical curves; a sharp edge
    is instead captured at the grid's time resolution (0.02 beats ≈ 10 ms).
    Native values come from scale_value(..., use_log), matching the .alc path.

    Pure (no Ableton): the caller writes these via insert_step, ideally chunked.
    Emit count is bounded by the probe grid (target_length / probe_beats),
    regardless of how many points were drawn.
    """
    sorted_pts = sorted(points, key=lambda p: float(p.get("time", 0)))
    if not sorted_pts:
        return []

    # 1) Probe on a FIXED time grid so the probe count tracks CLIP LENGTH, not
    #    how many points were drawn — a 10k-point freehand lane probes the same
    #    as a 2-point one. Mirrors shared/rasterizer.js's grid sampling.
    total = float(target_length)
    if total <= 0:
        return []
    n_pts = len(sorted_pts)
    first_t = float(sorted_pts[0].get("time", 0))
    last_t = float(sorted_pts[-1].get("time", 0))
    last_v = float(sorted_pts[-1].get("value", 0))
    grid_n = max(1, int(round(total / probe_beats)))
    probe = []
    seg_i = 0
    for k in range(grid_n + 1):
        t = k * probe_beats
        if t > total:
            t = total
        if t <= first_t:
            vn = float(sorted_pts[0].get("value", 0))
        elif t >= last_t:
            vn = last_v
        else:
            while seg_i + 1 < n_pts and float(sorted_pts[seg_i + 1].get("time", 0)) <= t:
                seg_i += 1
            a = sorted_pts[seg_i]
            b = sorted_pts[seg_i + 1]
            t0 = float(a.get("time", 0))
            v0 = float(a.get("value", 0))
            t1 = float(b.get("time", 0))
            v1 = float(b.get("value", 0))
            cv = float(a.get("curve", 0) or 0)   # bend lives on the leading point
            vn = v1 if t1 <= t0 else sample_segment(v0, v1, cv, (t - t0) / (t1 - t0))
        if vn < 0.0:
            vn = 0.0
        elif vn > 1.0:
            vn = 1.0
        probe.append((t, vn))
    if not probe:
        return []
    if probe[-1][0] < total - 1e-9:
        probe.append((total, probe[-1][1]))

    # 2) Adaptive emit — keep a sample only when value moved >= eps since last.
    emit = [probe[0]]
    for (t, v) in probe[1:]:
        if abs(v - emit[-1][1]) >= eps:
            emit.append((t, v))
    if emit[-1][0] < probe[-1][0] - 1e-4:
        emit.append(probe[-1])

    # 3) -> (time, duration, native_value), each held until the next.
    out = []
    for i in range(len(emit)):
        t, vn = emit[i]
        nt = emit[i + 1][0] if i + 1 < len(emit) else target_length
        dur = nt - t
        if dur <= 0.0:
            continue
        out.append((t, dur, scale_value(vn, mn, mx, use_log)))
    return out
