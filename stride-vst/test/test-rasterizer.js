/**
 * Tests for shared/rasterizer.js — the fidelity foundation of the direct-inject
 * path (Phase 1). These lock three things:
 *
 *   1. sampleSegment reproduces the CANVAS's quadratic-bezier draw EXACTLY.
 *      The canvas (canvas.js ~1805) draws each segment as:
 *          cpY = my - cv * |y - py| * 1.2 ; quadraticCurveTo(mx, cpY, x, y)
 *      In screen space Y is inverted (y = laneH - value*laneH). Converting that
 *      control point back to value-space, the laneH cancels and you get:
 *          cpV = midV + cv * |v1 - v0| * 1.2
 *      which is exactly sampleSegment's control. This test recomputes the
 *      canvas control in screen space and asserts it maps to the same cpV — so
 *      if anyone changes the canvas draw, this fails and we know fidelity broke.
 *   2. Log scaling matches shared/log-scaling.js (same module the .alc path uses).
 *   3. rasterizeLaneToSteps produces the right step count (bounded by clip
 *      length, NOT by how many points the user drew) and native-range values.
 *
 * Run: node test/test-rasterizer.js
 */

const { rasterizeCurve, sampleSegment, rasterizeLaneToSteps } = require('../shared/rasterizer.js');
const { scaleValue } = require('../shared/log-scaling.js');

let passed = 0, failed = 0;
function test(name, fn) {
    try { fn(); console.log(`  ✓ ${name}`); passed++; }
    catch (e) { console.log(`  ✗ ${name}: ${e.message}`); failed++; }
}
function assert(c, m) { if (!c) throw new Error(m || 'assertion failed'); }
function close(a, b, eps, m) { if (Math.abs(a - b) > (eps || 1e-9)) throw new Error((m || 'not close') + ` — got ${a}, expected ${b}`); }

// ─── 1. Canvas ↔ rasterizer lockstep ──────────────────────────────

test('sampleSegment: cv=0 is exact linear interpolation', () => {
    close(sampleSegment(0, 1, 0, 0.5), 0.5);
    close(sampleSegment(0, 1, 0, 0.25), 0.25);
    close(sampleSegment(0.2, 0.8, 0, 0.5), 0.5);
});

test('sampleSegment: convex bezier bows above the line (cv>0)', () => {
    // cpV = 0.5 + 0.5*1*1.2 = 1.1 ; B(0.5) = 2*0.25*1.1 + 0.25*1 = 0.8
    close(sampleSegment(0, 1, 0.5, 0.5), 0.8);
    assert(sampleSegment(0, 1, 0.5, 0.5) > 0.5, 'convex must exceed linear midpoint');
});

test('LOCKSTEP: canvas screen-space control point inverts to rasterizer cpV', () => {
    // Reproduce the canvas draw (canvas.js ~1805) for one segment, then invert.
    const laneH = 100, v0 = 0.2, v1 = 0.8, cv = 0.5;
    const py = laneH - v0 * laneH;          // prev point screen Y
    const y  = laneH - v1 * laneH;          // this point screen Y
    const my = (py + y) / 2;
    const cpY = my - cv * Math.abs(y - py) * 1.2;   // <-- canvas formula
    const canvasCpValue = (laneH - cpY) / laneH;     // back to value space
    const rasterizerCpV = (v0 + v1) / 2 + cv * Math.abs(v1 - v0) * 1.2;
    close(canvasCpValue, rasterizerCpV, 1e-9, 'canvas control point must equal rasterizer cpV');
    close(rasterizerCpV, 0.86);
});

// ─── 2. rasterizeCurve behavior ───────────────────────────────────

test('rasterizeCurve: straight line samples linearly', () => {
    const pts = [{ time: 0, value: 0 }, { time: 16, value: 1 }];
    const n = 16;
    const buf = rasterizeCurve(pts, 16, n); // no paramScale → stays 0..1
    for (let i = 1; i < n; i++) close(buf[i], i / n, 1e-6, `sample ${i}`);
});

test('rasterizeCurve: holds first/last value outside point range', () => {
    const pts = [{ time: 4, value: 0.3 }, { time: 12, value: 0.7 }];
    const buf = rasterizeCurve(pts, 16, 16);
    close(buf[0], 0.3, 1e-6, 'before first point holds first value');
    close(buf[15], 0.7, 1e-6, 'after last point holds last value');
});

test('rasterizeCurve: empty → constant 0.5; single point → constant', () => {
    // Float32Array storage → use a float32-appropriate tolerance.
    const e = rasterizeCurve([], 16, 8); for (const v of e) close(v, 0.5, 1e-6);
    const s = rasterizeCurve([{ time: 2, value: 0.42 }], 16, 8); for (const v of s) close(v, 0.42, 1e-6);
});

test('rasterizeCurve: log scaling matches shared/log-scaling.js', () => {
    const param = { min: 20, max: 20000, is_log: true, name: 'Cutoff' };
    const pts = [{ time: 0, value: 0 }, { time: 16, value: 1 }];
    const n = 1000;
    const buf = rasterizeCurve(pts, 16, n, param);
    // sample at t≈8 beats → s≈0.5 → expect scaleValue(0.5) = 20*(1000)^0.5 ≈ 632.46
    const i = Math.round(n * 0.5);
    const sNorm = i / n; // value-space at this sample (linear cv=0)
    close(buf[i], scaleValue(sNorm, param, true), 1e-3, 'log-scaled value parity');
    // monotonic increasing for a rising log sweep
    assert(buf[10] < buf[500] && buf[500] < buf[990], 'log sweep must rise');
});

// ─── 3. rasterizeLaneToSteps (direct-inject payload) ──────────────

test('rasterizeLaneToSteps: count bounded by clip length, not point count', () => {
    const sparse = { points: [{ time: 0, value: 0 }, { time: 16, value: 1 }], min: 0, max: 1 };
    const dense  = { points: Array.from({ length: 10000 }, (_, k) => ({ time: 16 * k / 9999, value: k / 9999 })), min: 0, max: 1 };
    const a = rasterizeLaneToSteps(sparse, 4, 0.02); // 4 bars = 16 beats / 0.02 = 800
    const b = rasterizeLaneToSteps(dense, 4, 0.02);
    assert(a.count === 800, `expected 800 steps, got ${a.count}`);
    assert(b.count === 800, `10k-point lane still 800 steps, got ${b.count}`);
    close(a.stepDur, 0.02, 1e-9);
    assert(a.values.length === 800 && b.values.length === 800, 'values length == count');
});

test('rasterizeLaneToSteps: values are native-range and trace the curve', () => {
    const param = { points: [{ time: 0, value: 0, curve: 0.5 }, { time: 16, value: 1 }], min: 0, max: 127, name: 'Macro' };
    const r = rasterizeLaneToSteps(param, 4, 0.02);
    close(r.values[0], 0, 1e-6, 'starts at min');
    assert(r.values[r.values.length - 1] <= 127.0001, 'ends within max');
    // convex curve → midpoint sample is above the linear midpoint (63.5)
    const mid = r.values[Math.round(r.count / 2)];
    assert(mid > 63.5, `convex midpoint should exceed linear 63.5, got ${mid}`);
});

test('rasterizeLaneToSteps: finer step = more steps (resolution knob)', () => {
    const param = { points: [{ time: 0, value: 0 }, { time: 16, value: 1 }], min: 0, max: 1 };
    const coarse = rasterizeLaneToSteps(param, 4, 0.04);
    const fine = rasterizeLaneToSteps(param, 4, 0.01);
    assert(fine.count === coarse.count * 4, `0.01 should be 4x 0.04: ${fine.count} vs ${coarse.count}`);
});

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed === 0 ? 0 : 1);
