/**
 * Behavior tests for S&H — Sample & Hold global generator
 * (window.sdApplyGlobalSampleHold in app/renderer/canvas.js).
 *
 *   - Rate pool: straight 1/2..1/32 + triplets 1/4T,1/8T,1/16T; floor = 1/32
 *   - Every pool rate tiles a 4-beat bar evenly (triplets stay grid-true)
 *   - Per lane: per-bar rate (changes only on bar lines)
 *   - Steps are hard: flat holds (equal-value pairs) + vertical ε-gap jumps,
 *     never bezier slopes
 *   - Values span the FULL 0–1 axis (no sub-band confinement); adjacent steps
 *     mostly differ (min-delta)
 *   - Deterministic per seed; selection merge preserves out-of-range points
 *
 * Pure-logic specs — DOM-bound canvas.js can't be loaded directly, so this
 * re-implements the step-math from sdApplyGlobalSampleHold and validates the
 * contract. If canvas.js drifts (rate pool / range / stepping), update both.
 *
 * Run: node test/test-sample-hold.js
 */

let passed = 0, failed = 0;
function test(name, fn) {
    try { fn(); console.log(`  ✓ ${name}`); passed++; }
    catch (e) { console.log(`  ✗ ${name}: ${e.message}`); failed++; }
}
function assert(cond, msg) { if (!cond) throw new Error(msg); }
function assertClose(a, b, tol, msg) {
    if (Math.abs(a - b) > (tol || 0.0001)) throw new Error((msg || 'not close') + ` — got ${a}, expected ≈ ${b}`);
}

// ─── Spec mirror of canvas.js sdApplyGlobalSampleHold ────────────
// MUST stay identical to the constants in canvas.js.
const RATES = [2, 1, 0.5, 0.25, 0.125, 4 / 6, 2 / 6, 1 / 6];
const EPS = 0.005;
const MIN_DELTA = 0.15;
const round4 = t => Math.round(t * 10000) / 10000;

function mulberry32(seed) {
    let a = (seed >>> 0) || 1;
    return function () {
        a = (a + 0x6D2B79F5) >>> 0;
        let t = a;
        t = Math.imul(t ^ (t >>> 15), t | 1);
        t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
        return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
}

// One lane's worth of S&H. Returns the points (as canvas pushes them) plus
// the step descriptors so tests can assert structure. `rnd` is injected so
// the suite is deterministic; canvas.js uses Math.random in the same order.
function specSHLane(sB, eB, rnd) {
    const pts = [], steps = [];
    let lastV = null, prevRate = null;
    let secStart = sB;
    while (secStart < eB - 1e-4) {
        const secEnd = Math.min((Math.floor(secStart / 4) + 1) * 4, eB);
        const rate = (prevRate !== null && rnd() < 0.5)
            ? prevRate
            : RATES[Math.floor(rnd() * RATES.length)];
        prevRate = rate;
        let t = secStart;
        while (t < secEnd - 1e-4) {
            const stepEnd = Math.min(t + rate, secEnd);
            let v, tries = 0;
            do { v = rnd(); tries++; }
            while (lastV !== null && Math.abs(v - lastV) < MIN_DELTA && tries < 12);
            lastV = v;
            const cv = Math.max(0, Math.min(1, v));
            const tA = round4(t);
            pts.push({ time: tA, value: cv });
            const tB = round4(stepEnd - EPS);
            if (tB > tA) pts.push({ time: tB, value: cv });
            steps.push({ start: tA, end: stepEnd, rate, value: cv });
            t = stepEnd;
        }
        secStart = secEnd;
    }
    return { points: pts, steps };
}

// Selection merge — mirrors the `sel` branch in canvas.js.
function specMerge(existing, generated, sB, eB) {
    const outside = existing.filter(pt => pt.time < sB || pt.time > eB);
    return outside.concat(generated).sort((a, b) => a.time - b.time);
}

console.log('\nS&H — Sample & Hold\n');

// ── Rate pool design ──────────────────────────────────────────────
test('Every pool rate tiles a 4-beat bar evenly', () => {
    for (const r of RATES) {
        const n = 4 / r;
        assertClose(n, Math.round(n), 1e-9, `rate ${r} does not divide a bar into whole steps`);
    }
});
test('Triplet rates present (6 / 12 / 24 per bar)', () => {
    assertClose(4 / (4 / 6), 6, 1e-9, '1/4T should be 6 per bar');
    assertClose(4 / (2 / 6), 12, 1e-9, '1/8T should be 12 per bar');
    assertClose(4 / (1 / 6), 24, 1e-9, '1/16T should be 24 per bar');
});
test('Smallest rate is 1/32 (max 1/32 cap)', () => {
    assertClose(Math.min(...RATES), 0.125, 1e-9, 'floor should be 1/32 = 0.125 beats');
});

// ── Generated structure (many random trials) ──────────────────────
test('Produces points for a 4-bar lane', () => {
    assert(specSHLane(0, 16, mulberry32(1)).points.length > 0, 'no points produced');
});

test('Point times are sorted and within [sB, eB]', () => {
    for (let s = 1; s <= 60; s++) {
        const { points } = specSHLane(0, 16, mulberry32(s));
        for (let i = 0; i < points.length; i++) {
            assert(points[i].time >= 0 && points[i].time <= 16, `time ${points[i].time} out of range (seed ${s})`);
            if (i) assert(points[i].time >= points[i - 1].time, `times not sorted (seed ${s})`);
        }
    }
});

test('Values are all within [0,1]', () => {
    for (let s = 1; s <= 40; s++) {
        for (const p of specSHLane(0, 16, mulberry32(s)).points) {
            assert(p.value >= 0 && p.value <= 1, `value ${p.value} out of [0,1] (seed ${s})`);
        }
    }
});

test('Patterns use the FULL 0–1 range (no sub-band confinement)', () => {
    // The whole point of this revision: every lane must be able to reach the
    // floor and the ceiling. Across many lanes the min must hit near 0 and the
    // max near 1 — guards against re-introducing per-lane bands like 0.1–0.5.
    let lo = 1, hi = 0;
    for (let s = 1; s <= 200; s++) {
        for (const st of specSHLane(0, 16, mulberry32(s)).steps) {
            if (st.value < lo) lo = st.value;
            if (st.value > hi) hi = st.value;
        }
    }
    assert(lo < 0.05, `never reached the bottom — min value was ${lo.toFixed(3)}`);
    assert(hi > 0.95, `never reached the top — max value was ${hi.toFixed(3)}`);
});

test('A single dense lane spans most of the axis', () => {
    // One 1/32 (or fast) lane over 4 bars has plenty of steps — it should
    // cover a wide span, not sit in a strip.
    let best = 0;
    for (let s = 1; s <= 60; s++) {
        const { steps } = specSHLane(0, 16, mulberry32(s));
        if (steps.length < 16) continue;
        let lo = 1, hi = 0;
        for (const st of steps) { if (st.value < lo) lo = st.value; if (st.value > hi) hi = st.value; }
        best = Math.max(best, hi - lo);
    }
    assert(best > 0.85, `widest single-lane span was only ${best.toFixed(3)}`);
});

test('No bezier — points carry no curve', () => {
    for (let s = 1; s <= 40; s++) {
        for (const p of specSHLane(0, 16, mulberry32(s)).points) assert(!p.curve, `point has a curve (seed ${s})`);
    }
});

test('Only flat holds + vertical jumps (no slopes)', () => {
    // Any consecutive pair more than ~one ε apart must be a FLAT hold
    // (equal value). Closely-spaced pairs (≤2ε) are the vertical jumps.
    for (let s = 1; s <= 80; s++) {
        const { points } = specSHLane(0, 16, mulberry32(s));
        for (let i = 1; i < points.length; i++) {
            const gap = points[i].time - points[i - 1].time;
            if (gap > 0.02) {
                assertClose(points[i].value, points[i - 1].value, 1e-9,
                    `slope over ${gap.toFixed(4)} beats (seed ${s})`);
            }
        }
    }
});

test('Jumps are near-instant (≤ ~2ε wide)', () => {
    for (let s = 1; s <= 40; s++) {
        const { points } = specSHLane(0, 16, mulberry32(s));
        for (let i = 1; i < points.length; i++) {
            const gap = points[i].time - points[i - 1].time;
            const diff = Math.abs(points[i].value - points[i - 1].value) > 1e-9;
            if (diff) assert(gap <= 0.0101, `jump too wide: ${gap} (seed ${s})`);
        }
    }
});

test('Every step uses a rate from the pool', () => {
    for (let s = 1; s <= 60; s++) {
        for (const st of specSHLane(0, 16, mulberry32(s)).steps) {
            assert(RATES.some(r => Math.abs(r - st.rate) < 1e-9), `rate ${st.rate} not in pool (seed ${s})`);
        }
    }
});

test('Rate changes only land on bar lines', () => {
    for (let s = 1; s <= 80; s++) {
        const { steps } = specSHLane(0, 16, mulberry32(s));
        for (let i = 1; i < steps.length; i++) {
            if (Math.abs(steps[i].rate - steps[i - 1].rate) > 1e-9) {
                const onBar = Math.abs(steps[i].start - Math.round(steps[i].start / 4) * 4) < 1e-6;
                assert(onBar, `rate changed off a bar line at beat ${steps[i].start} (seed ${s})`);
            }
        }
    }
});

test('Adjacent steps mostly satisfy min-delta (≥ 85%)', () => {
    let total = 0, ok = 0;
    for (let s = 1; s <= 120; s++) {
        const { steps } = specSHLane(0, 16, mulberry32(s));
        for (let i = 1; i < steps.length; i++) {
            total++;
            if (Math.abs(steps[i].value - steps[i - 1].value) >= MIN_DELTA - 1e-9) ok++;
        }
    }
    const frac = ok / total;
    assert(frac >= 0.85, `only ${(frac * 100).toFixed(1)}% of adjacent steps met min-delta`);
});

test('Different lanes get different patterns', () => {
    const a = JSON.stringify(specSHLane(0, 16, mulberry32(11)).points);
    const b = JSON.stringify(specSHLane(0, 16, mulberry32(12)).points);
    assert(a !== b, 'two lanes produced identical patterns');
});

test('Deterministic per seed', () => {
    const a = JSON.stringify(specSHLane(0, 16, mulberry32(7)).points);
    const b = JSON.stringify(specSHLane(0, 16, mulberry32(7)).points);
    assert(a === b, 'same seed produced different output');
});

test('Selection merge preserves out-of-range points', () => {
    const existing = [
        { time: 1, value: 0.2 },    // before sel → kept
        { time: 5, value: 0.9 },    // inside sel → dropped
        { time: 9, value: 0.4 },    // after sel → kept
        { time: 12, value: 0.6 },   // after sel → kept
    ];
    const sB = 4, eB = 8;
    const gen = specSHLane(sB, eB, mulberry32(3)).points;
    const merged = specMerge(existing, gen, sB, eB);
    assert(merged.some(p => p.time === 1 && p.value === 0.2), 'lost outside point @1');
    assert(merged.some(p => p.time === 9 && p.value === 0.4), 'lost outside point @9');
    assert(merged.some(p => p.time === 12 && p.value === 0.6), 'lost outside point @12');
    assert(!merged.some(p => p.time === 5), 'stale inside point @5 remained');
    for (const p of gen) assert(p.time >= sB - 1e-9 && p.time <= eB + 1e-9, `gen point ${p.time} outside selection`);
    for (let i = 1; i < merged.length; i++) assert(merged[i].time >= merged[i - 1].time, 'merge not sorted');
});

test('Selection starting mid-bar still tiles in-range', () => {
    const { steps } = specSHLane(2, 10, mulberry32(5));
    assert(steps.length > 0, 'no steps in selection');
    for (const st of steps) assert(st.start >= 2 - 1e-9 && st.start < 10, `step start ${st.start} outside selection`);
});

console.log(`\n${passed} passed, ${failed} failed\n`);
process.exit(failed > 0 ? 1 : 0);
