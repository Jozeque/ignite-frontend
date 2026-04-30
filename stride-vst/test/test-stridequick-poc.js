/**
 * StrideQuick POC — math correctness gate
 *
 * Locks the bezier rasterizer + log scaling + sine generator against drift.
 * If any test here fails, the .alc workflow and StrideQuick will diverge —
 * which is exactly the failure mode that killed the previous Live Preview.
 *
 * Run: node test/test-stridequick-poc.js
 */

const { rasterizeCurve, sampleSegment, sampleCountForLoop } =
    require('../shared/rasterizer.js');
const { shouldUseLog, scaleValue, unscaleValue } =
    require('../shared/log-scaling.js');
const { makeRng, genSine, genPump } = require('../shared/generators.js');

let passed = 0, failed = 0;
function test(name, fn) {
    try { fn(); console.log(`  ${'✓'} ${name}`); passed++; }
    catch (e) { console.log(`  ${'✗'} ${name}: ${e.message}`); failed++; }
}
function assert(cond, msg) { if (!cond) throw new Error(msg); }
function assertEq(a, b, msg) {
    if (a !== b) throw new Error((msg || 'mismatch') + ` got=${JSON.stringify(a)} expected=${JSON.stringify(b)}`);
}
// Default tolerance is Float32-friendly (~1e-6 since Float32 has ~7 digits).
// Tests using bare paramScale = Float32Array storage need this.
function assertClose(a, b, eps, msg) {
    eps = eps || 1e-6;
    if (Math.abs(a - b) > eps) throw new Error((msg || 'not close') + ` got=${a} expected=${b} diff=${a - b}`);
}

// ─── Bezier segment math ──────────────────────────────────────────

console.log('\nBezier segment evaluation (mirrors canvas.js:1564 math)\n');

test('Linear segment (cv=0): s=0 → v0', () => assertClose(sampleSegment(0.2, 0.8, 0, 0), 0.2));
test('Linear segment (cv=0): s=1 → v1', () => assertClose(sampleSegment(0.2, 0.8, 0, 1), 0.8));
test('Linear segment (cv=0): s=0.5 → midpoint', () => assertClose(sampleSegment(0.2, 0.8, 0, 0.5), 0.5));

test('Curved segment endpoints unaffected (s=0)', () => assertClose(sampleSegment(0.2, 0.8, 0.5, 0), 0.2));
test('Curved segment endpoints unaffected (s=1)', () => assertClose(sampleSegment(0.2, 0.8, 0.5, 1), 0.8));

test('Positive curve bulges value upward at s=0.5', () => {
    // v0=0.2 v1=0.8 cv=+0.5 → cpV = 0.5 + 0.5*0.6*1.2 = 0.86
    // s=0.5: 0.25*0.2 + 2*0.5*0.5*0.86 + 0.25*0.8 = 0.05 + 0.43 + 0.2 = 0.68
    assertClose(sampleSegment(0.2, 0.8, 0.5, 0.5), 0.68);
});

test('Negative curve bulges value downward at s=0.5', () => {
    // v0=0.2 v1=0.8 cv=-0.5 → cpV = 0.5 - 0.5*0.6*1.2 = 0.14
    // s=0.5: 0.25*0.2 + 2*0.5*0.5*0.14 + 0.25*0.8 = 0.05 + 0.07 + 0.2 = 0.32
    assertClose(sampleSegment(0.2, 0.8, -0.5, 0.5), 0.32);
});

test('Identical endpoints with curve = constant', () => {
    // v0=v1=0.5 cv=0.5 → cpV = 0.5 + 0.5*0*1.2 = 0.5; quadratic resolves to 0.5
    assertClose(sampleSegment(0.5, 0.5, 0.5, 0.3), 0.5);
});

// ─── Rasterizer ──────────────────────────────────────────────────

console.log('\nRasterizer\n');

test('Empty points → constant 0.5', () => {
    const buf = rasterizeCurve([], 4, 100);
    assert(buf.length === 100, 'wrong length');
    assert(buf.every(v => v === 0.5), 'not all 0.5');
});

test('Single point → constant value', () => {
    const buf = rasterizeCurve([{ time: 2, value: 0.7 }], 4, 100);
    assert(buf.every(v => Math.abs(v - 0.7) < 1e-6), 'not all 0.7');
});

test('Two points, linear → linear interpolation in middle', () => {
    const buf = rasterizeCurve(
        [{ time: 0, value: 0 }, { time: 4, value: 1 }],
        4, 100
    );
    // Sample at i=50 → tBeats=2 → v=0.5
    assertClose(buf[50], 0.5, 0.02);
    // Sample at i=25 → tBeats=1 → v=0.25
    assertClose(buf[25], 0.25, 0.02);
});

test('Hold first value before first point time', () => {
    const buf = rasterizeCurve(
        [{ time: 1, value: 0.7 }, { time: 3, value: 0.2 }],
        4, 100
    );
    // First 25% of the buffer is before t=1, should hold 0.7
    assertClose(buf[0], 0.7);
    assertClose(buf[10], 0.7);
});

test('Hold last value after last point time', () => {
    const buf = rasterizeCurve(
        [{ time: 0, value: 0.3 }, { time: 1, value: 0.9 }],
        4, 100
    );
    // After t=1 should hold 0.9 (last 75% of buffer)
    assertClose(buf[80], 0.9);
    assertClose(buf[99], 0.9);
});

test('Defensive copy — caller array not mutated', () => {
    const input = [{ time: 2, value: 0.5 }, { time: 0, value: 0.1 }];
    const original = JSON.parse(JSON.stringify(input));
    rasterizeCurve(input, 4, 100);
    assertEq(JSON.stringify(input), JSON.stringify(original), 'input was mutated');
});

test('Curve scalar 0 ≡ linear (no bezier kink)', () => {
    const linearPts = [{ time: 0, value: 0 }, { time: 4, value: 1 }];
    const curvedPts = [{ time: 0, value: 0, curve: 0 }, { time: 4, value: 1 }];
    const a = rasterizeCurve(linearPts, 4, 100);
    const b = rasterizeCurve(curvedPts, 4, 100);
    for (let i = 0; i < 100; i++) assertClose(a[i], b[i], 1e-9, `idx ${i}`);
});

test('paramScale applies linear range', () => {
    const buf = rasterizeCurve(
        [{ time: 0, value: 0 }, { time: 4, value: 1 }],
        4, 100,
        { min: 0, max: 100 }
    );
    // Buffer covers [0, 4) beats — last sample is at tBeats=3.96, value=0.99
    // (this is correct for looped playback; phasor wraps before reaching length)
    assertClose(buf[0], 0, 0.5);
    assertClose(buf[50], 50, 1);
    assertClose(buf[99], 99, 0.5);
});

test('paramScale applies log range for cutoff-style param', () => {
    const buf = rasterizeCurve(
        [{ time: 0, value: 0 }, { time: 4, value: 1 }],
        4, 1000,
        { min: 20, max: 20000, name: 'Filter Cutoff' }
    );
    // v=0 → 20, v=0.999 → 20*1000^0.999 ≈ 19862, v=0.5 → 20*1000^0.5 ≈ 632.45
    assertClose(buf[0], 20, 0.5);
    assertClose(buf[999], 19862, 200);
    assertClose(buf[500], 20 * Math.sqrt(1000), 30);
});

// ─── Log scaling ─────────────────────────────────────────────────

console.log('\nLog scaling — detection rules (mirrors alc-injector.js:403-417)\n');

test('Scanner is_log flag wins', () => {
    assertEq(shouldUseLog({ name: 'Anything', min: 1, max: 100, is_log: true }), true);
});
test('Cutoff name triggers log', () => {
    assertEq(shouldUseLog({ name: 'Filter Cutoff', min: 20, max: 20000 }), true);
});
test('Freq name triggers log', () => {
    assertEq(shouldUseLog({ name: 'Osc Freq', min: 20, max: 20000 }), true);
});
test('Range heuristic triggers log (10..20k, ratio 2000)', () => {
    assertEq(shouldUseLog({ name: 'Mystery', min: 20, max: 20000 }), true);
});
test('Linear range stays linear (0..127)', () => {
    assertEq(shouldUseLog({ name: 'Velocity', min: 0, max: 127 }), false);
});
test('Negative min disables log', () => {
    assertEq(shouldUseLog({ name: 'Cutoff', min: -1, max: 100 }), false);
});
test('Zero min disables log', () => {
    assertEq(shouldUseLog({ name: 'Cutoff', min: 0, max: 100 }), false);
});

console.log('\nLog scaling — value math\n');

test('Linear: v=0 → min', () => assertClose(scaleValue(0, { min: 10, max: 90 }), 10));
test('Linear: v=1 → max', () => assertClose(scaleValue(1, { min: 10, max: 90 }), 90));
test('Linear: v=0.5 → midpoint', () => assertClose(scaleValue(0.5, { min: 10, max: 90 }), 50));

test('Log: v=0 → min', () => assertClose(scaleValue(0, { min: 20, max: 20000, is_log: true }), 20));
test('Log: v=1 → max', () => assertClose(scaleValue(1, { min: 20, max: 20000, is_log: true }), 20000));
test('Log: v=0.5 → geometric mean', () => {
    // sqrt(20 * 20000) = sqrt(400000) ≈ 632.46
    assertClose(scaleValue(0.5, { min: 20, max: 20000, is_log: true }), Math.sqrt(20 * 20000), 1e-6);
});

test('Inverse round-trip: linear', () => {
    const p = { min: 10, max: 90 };
    for (const v of [0, 0.25, 0.5, 0.75, 1]) {
        assertClose(unscaleValue(scaleValue(v, p), p), v, 1e-9);
    }
});
test('Inverse round-trip: log', () => {
    const p = { min: 20, max: 20000, is_log: true };
    for (const v of [0, 0.25, 0.5, 0.75, 1]) {
        assertClose(unscaleValue(scaleValue(v, p), p), v, 1e-9);
    }
});

test('Clamp: v < 0 → min', () => assertClose(scaleValue(-0.3, { min: 10, max: 90 }), 10));
test('Clamp: v > 1 → max', () => assertClose(scaleValue(1.5, { min: 10, max: 90 }), 90));

// ─── Sine generator ──────────────────────────────────────────────

console.log('\nSine generator (mirrors canvas.js:2691)\n');

test('Sine produces 17 points for 4 beats (every 0.25)', () => {
    // 0, 0.25, 0.5, ... 4.0 = 17 points
    assertEq(genSine(4).length, 17);
});

test('Sine value range stays in [0..1]', () => {
    const pts = genSine(8);
    for (const p of pts) assert(p.value >= 0 && p.value <= 1, `out of range: ${p.value}`);
});

test('Sine starts at 0.5 (midpoint of sin(0))', () => {
    const pts = genSine(4);
    assertClose(pts[0].value, 0.5);
});

test('Sine 4-beat dur has 1 full cycle (returns to 0.5 at end)', () => {
    const pts = genSine(4);
    assertClose(pts[pts.length - 1].value, 0.5, 1e-9);
});

test('Sine 8-beat dur has 2 cycles (peak count)', () => {
    const pts = genSine(8);
    let peaks = 0;
    for (let i = 1; i < pts.length - 1; i++) {
        if (pts[i].value > pts[i - 1].value && pts[i].value > pts[i + 1].value) peaks++;
    }
    assertEq(peaks, 2);
});

test('Sine deterministic — same input, same output', () => {
    const a = genSine(4);
    const b = genSine(4);
    assertEq(JSON.stringify(a), JSON.stringify(b));
});

// ─── Sample-count helper ─────────────────────────────────────────

console.log('\nSample count for loop\n');

test('4 bars at 120 BPM = 8 seconds', () => {
    // 4 bars × 4 beats = 16 beats. At 120 BPM = 0.5 sec/beat → 8 sec.
    // At 1 kHz default → 8000 samples
    assertEq(sampleCountForLoop(4, 120), 8000);
});
test('8 bars at 100 BPM at 2 kHz', () => {
    // 8 bars × 4 = 32 beats × 0.6 sec = 19.2 sec × 2000 Hz = 38400
    assertEq(sampleCountForLoop(8, 100, 2000), 38400);
});
test('Minimum 1 sample even for tiny loop', () => {
    assert(sampleCountForLoop(0, 120) >= 1);
});

// ─── End-to-end: sine through full pipeline ──────────────────────

console.log('\nEnd-to-end: sine → rasterize → log scale\n');

test('Sine into 4-bar buffer at 1kHz BPM 120: 8000 samples', () => {
    const pts = genSine(16);  // 16 beats = 4 bars
    const sampleCount = sampleCountForLoop(4, 120);
    const buf = rasterizeCurve(pts, 16, sampleCount, { min: 20, max: 20000, name: 'Filter Cutoff' });
    assertEq(buf.length, 8000);
    // Sine starts at 0.5 → 20 * 1000^0.5 ≈ 632 Hz
    assertClose(buf[0], Math.sqrt(20 * 20000), 30);
});

test('Sine peak hits log max near top of cycle (~7000Hz on 20-20000 log range)', () => {
    const pts = genSine(16);
    const buf = rasterizeCurve(pts, 16, 1000, { min: 20, max: 20000, name: 'Filter Cutoff' });
    const max = Math.max(...buf);
    // sin peak = 1 → 20000. Should be very close to max.
    assert(max > 18000, `peak too low: ${max}`);
});

console.log(`\n${passed} passed, ${failed} failed\n`);
process.exit(failed > 0 ? 1 : 0);
