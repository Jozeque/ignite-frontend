/**
 * Stride — Bezier curve rasterizer
 *
 * Converts canvas-style point arrays into dense Float32 sample buffers,
 * suitable for buffer~ poke / play~ playback through live.remote~ at audio rate.
 *
 * Reproduces the canvas's quadratic bezier math EXACTLY:
 *   - Between two points (t0, v0) and (t1, v1) with curve scalar cv on the
 *     leading point:
 *       midV = (v0 + v1) / 2
 *       cpV  = midV + cv * |v1 - v0| * 1.2   ← sign matches canvas after Y-inversion
 *       value(s) = (1-s)²·v0 + 2·(1-s)·s·cpV + s²·v1
 *     where s ∈ [0,1] is normalized progress along the segment.
 *   - cv = 0 → straight line (linear interpolation).
 *
 * The 1.2 factor and the sign convention are taken directly from
 * canvas.js:1564 — keep in lockstep.
 *
 * Output sample values are scaled into the parameter's native range using
 * shared/log-scaling.js. The buffer is fed straight to live.remote~.
 */

const { scaleValue, shouldUseLog } = require('./log-scaling.js');

/**
 * Sample a single bezier segment at normalized progress s∈[0,1].
 * Returns the value coordinate (still in [0..1] curve-space).
 */
function sampleSegment(v0, v1, cv, s) {
    if (!cv || cv === 0) {
        return v0 + (v1 - v0) * s;
    }
    const midV = (v0 + v1) / 2;
    const cpV  = midV + cv * Math.abs(v1 - v0) * 1.2;
    const oneMinusS = 1 - s;
    return oneMinusS * oneMinusS * v0 + 2 * oneMinusS * s * cpV + s * s * v1;
}

/**
 * Rasterize a Stride curve into a Float32Array suitable for buffer~ poke.
 *
 * @param {Array} points    sorted-by-time array of { time, value, curve? }
 * @param {number} lengthBeats   length of the loop in beats (typically bars*4)
 * @param {number} sampleCount   number of samples in the output buffer
 * @param {object} [paramScale]  { min, max, is_log? } — if provided, output is in
 *                               native range; if omitted, output stays in [0..1].
 * @returns {Float32Array}
 *
 * Behavior:
 *   - Empty points array → constant 0.5 (a safe midpoint, never silent)
 *   - One point → constant value
 *   - Time outside [first.time, last.time] → clamps to first / last value
 *   - Sorts a defensive copy of points (caller's array is not mutated)
 *
 * Critical for 1:1 fidelity: this reproduces the canvas's draw loop, NOT
 * Ableton's clip envelope interpolation. Ableton clip envelopes apply a
 * different interpolation between FloatEvent breakpoints, which is why the
 * old 33Hz Live Preview attempt drifted by 42%. We bypass that entirely:
 * we render the curve, write samples to buffer~, play through live.remote~.
 */
function rasterizeCurve(points, lengthBeats, sampleCount, paramScale) {
    const out = new Float32Array(sampleCount);
    if (!points || points.length === 0) {
        const v = paramScale
            ? scaleValue(0.5, paramScale)
            : 0.5;
        out.fill(v);
        return out;
    }

    // Defensive copy + sort. Caller's array remains untouched.
    const pts = points.slice().sort((a, b) => a.time - b.time);

    if (pts.length === 1) {
        const v = paramScale
            ? scaleValue(pts[0].value, paramScale)
            : pts[0].value;
        out.fill(v);
        return out;
    }

    const useLog = paramScale ? shouldUseLog(paramScale) : false;
    const firstT = pts[0].time;
    const lastT  = pts[pts.length - 1].time;
    const firstV = pts[0].value;
    const lastV  = pts[pts.length - 1].value;

    // Walk each output sample, find the segment it falls in, evaluate.
    // Two-cursor advance: segIdx only moves forward, so this is O(N+M)
    // where N=sampleCount and M=points.length.
    let segIdx = 0;
    for (let i = 0; i < sampleCount; i++) {
        const tBeats = (i / sampleCount) * lengthBeats;

        // Before first point: hold first value
        if (tBeats <= firstT) {
            out[i] = paramScale ? scaleValue(firstV, paramScale, useLog) : firstV;
            continue;
        }
        // After last point: hold last value
        if (tBeats >= lastT) {
            out[i] = paramScale ? scaleValue(lastV, paramScale, useLog) : lastV;
            continue;
        }

        // Advance segIdx until tBeats falls in [pts[segIdx].time, pts[segIdx+1].time]
        while (segIdx < pts.length - 2 && pts[segIdx + 1].time <= tBeats) {
            segIdx++;
        }

        const a = pts[segIdx];
        const b = pts[segIdx + 1];
        const segLen = b.time - a.time;
        const s = segLen > 0 ? (tBeats - a.time) / segLen : 0;
        const cv = a.curve || 0;

        let v = sampleSegment(a.value, b.value, cv, s);
        // Clamp value-space to [0..1] before scaling. Bezier with extreme
        // curve scalar can push slightly past the segment's endpoints.
        if (v < 0) v = 0;
        else if (v > 1) v = 1;

        out[i] = paramScale ? scaleValue(v, paramScale, useLog) : v;
    }

    return out;
}

/**
 * Convenience: pick a sample rate appropriate for modulation curves.
 *
 * Audio-rate (44.1k) is overkill for parameter modulation — humans can't hear
 * modulation faster than ~50 Hz on a knob. But denser sampling means cleaner
 * bezier reproduction, lower aliasing on sharp edges. 1 kHz is comfortably
 * above audible modulation rate yet keeps buffer sizes small.
 *
 * @param {number} bars   loop length in bars
 * @param {number} bpm    project tempo
 * @param {number} [hz]   target sample rate, default 1000 Hz
 * @returns {number}      total sample count for the loop
 */
function sampleCountForLoop(bars, bpm, hz) {
    const rate = hz || 1000;
    const beatsPerLoop = bars * 4;
    const secondsPerBeat = 60 / bpm;
    const seconds = beatsPerLoop * secondsPerBeat;
    return Math.max(1, Math.round(seconds * rate));
}

/**
 * Rasterize a Stride lane into a flat list of step values for the
 * direct-inject path (StrideInject writes each as an insert_step). Reuses
 * rasterizeCurve, so the shape is byte-identical to the canvas draw and the
 * value scaling is the same log-scaling.js the .alc path uses. Output values
 * are in the parameter's NATIVE range (bezier + log already applied) — the
 * Remote Script writes them verbatim (values_are_actual), so there's no
 * dependence on Ableton's envelope interpolation matching ours.
 *
 * @param {object} param           { points, min, max, is_log?, name? }
 * @param {number} bars            loop length in bars
 * @param {number} [stepBeats=0.02] step resolution in beats (smaller = finer)
 * @returns {{ stepDur:number, count:number, values:number[] }}
 *   stepDur — duration of each insert_step in beats
 *   count   — number of steps (bounded by lengthBeats/stepBeats, NOT by
 *             how many points the user drew)
 *   values  — native-range value per step, tracing the curve
 */
function rasterizeLaneToSteps(param, bars, stepBeats) {
    const step = stepBeats && stepBeats > 0 ? stepBeats : 0.02;
    const lengthBeats = (bars || 0) * 4;
    const count = Math.max(1, Math.round(lengthBeats / step));
    const buf = rasterizeCurve(param.points || [], lengthBeats, count, {
        min: param.min, max: param.max, is_log: param.is_log, name: param.name,
    });
    return { stepDur: count > 0 ? lengthBeats / count : lengthBeats, count, values: Array.from(buf) };
}

if (typeof module !== 'undefined') {
    module.exports = { rasterizeCurve, sampleSegment, sampleCountForLoop, rasterizeLaneToSteps };
}
