/**
 * Behavior tests for Prism (live-draw multi-lane variant engine).
 *
 *   - mulberry32 RNG: deterministic per seed
 *   - FNV-1a string hash: deterministic, low collision
 *   - Anchor extraction: per-bar peak + valley in time order, first/last bound
 *   - 8 personality functions: midpoints in [0,1], deterministic per seed
 *   - Variant generation: anchors verbatim + personality midpoints between
 *   - Personality assignment: cyclic shuffle, deterministic per seed
 *   - Full pipeline: variants share source anchors, locked lanes skipped
 *   - Diversity edge cases (0% identity-ish, 100% maximum departure)
 *
 * Pure-logic specs — DOM-bound code in canvas.js can't be loaded directly,
 * so these tests re-implement the same logic and validate the contract.
 * If main canvas.js drifts, update both sides to match.
 *
 * Run: node test/test-prism.js
 */

let passed = 0;
let failed = 0;

function test(name, fn) {
    try { fn(); console.log(`  ✓ ${name}`); passed++; }
    catch (e) { console.log(`  ✗ ${name}: ${e.message}`); failed++; }
}
function assert(cond, msg) { if (!cond) throw new Error(msg); }
function assertEq(a, b, msg) {
    if (a !== b) throw new Error((msg || 'mismatch') + ` — got ${JSON.stringify(a)}, expected ${JSON.stringify(b)}`);
}
function assertClose(a, b, tol, msg) {
    if (Math.abs(a - b) > (tol || 0.0001)) throw new Error((msg || 'not close') + ` — got ${a}, expected ≈ ${b}`);
}

// ─── Spec implementations (mirror canvas.js logic) ───────────────

const PRISM_PERSONALITIES = [
    'mirror', 'mutate', 'mutateMirror', 'stutter',
    'smooth', 'step',   'drift',        'chase',
];

function specMakeRng(seed) {
    let a = (seed >>> 0) || 1;
    return function() {
        a = (a + 0x6D2B79F5) >>> 0;
        let t = a;
        t = Math.imul(t ^ (t >>> 15), t | 1);
        t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
        return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
}

function specHashStr(s) {
    let h = 2166136261;
    for (let i = 0; i < s.length; i++) {
        h ^= s.charCodeAt(i);
        h = Math.imul(h, 16777619);
    }
    return h >>> 0;
}

function specExtractAnchors(points, totalBeats) {
    if (!points.length) return [];
    const sorted = [...points].sort((a, b) => a.time - b.time);
    const bars = Math.max(1, Math.round(totalBeats / 4));
    const anchors = [];
    for (let b = 0; b < bars; b++) {
        const barStart = b * 4;
        const barEnd = (b + 1) * 4;
        const inBar = sorted.filter(p => p.time >= barStart && p.time < barEnd);
        if (inBar.length === 0) continue;
        if (inBar.length === 1) {
            anchors.push({ time: inBar[0].time, value: inBar[0].value });
            continue;
        }
        let peak = inBar[0], valley = inBar[0];
        for (const p of inBar) {
            if (p.value > peak.value) peak = p;
            if (p.value < valley.value) valley = p;
        }
        if (peak === valley) {
            anchors.push({ time: peak.time, value: peak.value });
        } else if (peak.time < valley.time) {
            anchors.push({ time: peak.time, value: peak.value });
            anchors.push({ time: valley.time, value: valley.value });
        } else {
            anchors.push({ time: valley.time, value: valley.value });
            anchors.push({ time: peak.time, value: peak.value });
        }
    }
    const first = sorted[0];
    const last = sorted[sorted.length - 1];
    if (anchors.length === 0 || anchors[0].time > first.time + 0.0001) {
        anchors.unshift({ time: first.time, value: first.value });
    }
    if (anchors[anchors.length - 1].time < last.time - 0.0001) {
        anchors.push({ time: last.time, value: last.value });
    }
    const out = [];
    for (const a of anchors) {
        if (!out.length || a.time > out[out.length - 1].time + 0.0001) out.push(a);
    }
    return out;
}

function specPersonalityMirror(a, b, diversity, rng) {
    const midT = (a.time + b.time) / 2;
    const linearV = (a.value + b.value) / 2;
    const flippedV = 1 - linearV;
    const v = linearV + (flippedV - linearV) * diversity;
    return [{ time: midT, value: Math.max(0, Math.min(1, v)), curve: 0 }];
}

function specPersonalityMutate(a, b, diversity, rng) {
    const numChunks = 3 + Math.floor(rng() * 5);
    const dy = b.value - a.value;
    const dx = b.time - a.time;
    const out = [];
    for (let i = 1; i < numChunks; i++) {
        const t = i / numChunks;
        const baseV = a.value + dy * t;
        const wander = (rng() - 0.5) * diversity * 0.6;
        out.push({
            time: a.time + dx * t,
            value: Math.max(0, Math.min(1, baseV + wander)),
            curve: (rng() - 0.5) * diversity * 0.4,
        });
    }
    return out;
}

function specPersonalityMutateMirror(a, b, diversity, rng) {
    return specPersonalityMutate(a, b, diversity, rng).map(p => ({
        time: p.time,
        value: Math.max(0, Math.min(1, 1 - p.value)),
        curve: -p.curve,
    }));
}

function specPersonalityStutter(a, b, diversity, rng) {
    const numSteps = 4 + Math.floor(rng() * 6);
    const dy = b.value - a.value;
    const dx = b.time - a.time;
    const out = [];
    for (let i = 1; i < numSteps; i++) {
        const t = i / numSteps;
        const baseV = a.value + dy * t;
        const swing = (i % 2 === 0 ? 1 : -1) * diversity * 0.4;
        out.push({
            time: a.time + dx * t,
            value: Math.max(0, Math.min(1, baseV + swing)),
            curve: 0,
        });
    }
    return out;
}

function specPersonalitySmooth(a, b, diversity, rng) {
    const midT = (a.time + b.time) / 2;
    const midV = (a.value + b.value) / 2;
    const sign = rng() < 0.5 ? -1 : 1;
    return [{ time: midT, value: midV, curve: sign * diversity * 0.85 }];
}

function specPersonalityStep(a, b, diversity, rng) {
    const holdT = a.time + (b.time - a.time) * 0.95;
    return [{ time: holdT, value: a.value, curve: 0 }];
}

function specPersonalityDrift(a, b, diversity, rng) {
    const numSteps = 6;
    const dy = b.value - a.value;
    const dx = b.time - a.time;
    const out = [];
    for (let i = 1; i < numSteps; i++) {
        const t = i / numSteps;
        const baseV = a.value + dy * t;
        const wander = (rng() - 0.5) * diversity * 0.3;
        out.push({
            time: a.time + dx * t,
            value: Math.max(0, Math.min(1, baseV + wander)),
            curve: 0,
        });
    }
    return out;
}

function specPersonalityChase(a, b, diversity, rng) {
    const dx = b.time - a.time;
    const offsetFrac = (rng() < 0.5 ? -1 : 1) * 0.25 * diversity;
    const midT = a.time + dx * (0.5 + offsetFrac);
    const midV = (a.value + b.value) / 2;
    const safeT = Math.max(a.time + dx * 0.05, Math.min(b.time - dx * 0.05, midT));
    return [{ time: safeT, value: midV, curve: 0 }];
}

const SPEC_FNS = {
    mirror: specPersonalityMirror,
    mutate: specPersonalityMutate,
    mutateMirror: specPersonalityMutateMirror,
    stutter: specPersonalityStutter,
    smooth: specPersonalitySmooth,
    step: specPersonalityStep,
    drift: specPersonalityDrift,
    chase: specPersonalityChase,
};

function specGenerateVariant(anchors, personality, diversity, rng) {
    if (!anchors.length) return [];
    if (anchors.length === 1) {
        return [{ time: anchors[0].time, value: anchors[0].value, curve: 0 }];
    }
    const fn = SPEC_FNS[personality] || specPersonalityMirror;
    const out = [{ time: anchors[0].time, value: anchors[0].value, curve: 0 }];
    for (let i = 0; i < anchors.length - 1; i++) {
        const mids = fn(anchors[i], anchors[i + 1], diversity, rng);
        for (const m of mids) {
            if (m.time > out[out.length - 1].time + 0.0001 && m.time < anchors[i + 1].time - 0.0001) {
                out.push(m);
            }
        }
        out.push({ time: anchors[i + 1].time, value: anchors[i + 1].value, curve: 0 });
    }
    return out;
}

function specAssignPersonalities(targets, seed) {
    const rng = specMakeRng(seed);
    const order = [...PRISM_PERSONALITIES];
    for (let i = order.length - 1; i > 0; i--) {
        const j = Math.floor(rng() * (i + 1));
        [order[i], order[j]] = [order[j], order[i]];
    }
    const assignment = {};
    targets.forEach((t, i) => {
        assignment[t.envelopeId] = order[i % order.length];
    });
    return assignment;
}

function specPrismCompute(params, activeId, diversity, totalBeats, perLane, rngSeed) {
    const sourceParam = params.find(p => p.envelopeId === activeId);
    if (!sourceParam) return;
    const anchors = specExtractAnchors(sourceParam.points, totalBeats);
    const targets = params.filter(p => p.envelopeId !== activeId && !p.locked);
    if (!anchors.length) {
        // Source has no anchors → leave variants alone. Lets user enter
        // Prism on an empty lane without wiping pre-existing variants.
        return;
    }
    targets.forEach(param => {
        const personality = (perLane && perLane[param.envelopeId]) || 'mirror';
        const laneSeed = ((rngSeed || 1) ^ specHashStr(param.envelopeId)) >>> 0;
        const rng = specMakeRng(laneSeed);
        const variant = specGenerateVariant(anchors, personality, diversity, rng);
        param.points = variant.map(p => ({
            time: Math.round(p.time * 10000) / 10000,
            value: Math.max(0, Math.min(1, p.value)),
            curve: p.curve || 0,
        }));
    });
}

// ─── RNG + hash ──────────────────────────────────────────────────

console.log('mulberry32 RNG\n');

test('Same seed produces same sequence', () => {
    const a = specMakeRng(42);
    const b = specMakeRng(42);
    for (let i = 0; i < 10; i++) assertEq(a(), b());
});
test('Different seeds produce different sequences', () => {
    const a = specMakeRng(1);
    const b = specMakeRng(2);
    let diffCount = 0;
    for (let i = 0; i < 10; i++) if (a() !== b()) diffCount++;
    assert(diffCount >= 9, 'expected sequences to diverge');
});
test('Output stays in [0, 1)', () => {
    const r = specMakeRng(12345);
    for (let i = 0; i < 1000; i++) {
        const v = r();
        assert(v >= 0 && v < 1, `out of range: ${v}`);
    }
});
test('Seed 0 falls back to seed 1 (avoid all-zero state)', () => {
    const r0 = specMakeRng(0);
    const r1 = specMakeRng(1);
    assertEq(r0(), r1());
});

console.log('\nFNV-1a string hash\n');

test('Same input produces same hash', () => {
    assertEq(specHashStr('foo'), specHashStr('foo'));
});
test('Different inputs produce different hashes (typical case)', () => {
    assert(specHashStr('lane-a') !== specHashStr('lane-b'));
    assert(specHashStr('lane-a') !== specHashStr('lane-c'));
});
test('Hash is unsigned 32-bit', () => {
    const h = specHashStr('test-envelope-id-12345');
    assert(h >= 0 && h < 0x100000000, `out of range: ${h}`);
});

// ─── Anchor extraction ───────────────────────────────────────────

console.log('\nAnchor extraction\n');

test('Empty points returns empty', () => {
    assertEq(specExtractAnchors([], 16).length, 0);
});
test('Single point returns single anchor', () => {
    const a = specExtractAnchors([{ time: 1.5, value: 0.7 }], 16);
    assertEq(a.length, 1);
    assertClose(a[0].time, 1.5);
    assertClose(a[0].value, 0.7);
});
test('Two points in one bar (peak before valley) → time-order anchors', () => {
    const a = specExtractAnchors([
        { time: 1.0, value: 0.9 },  // peak
        { time: 3.0, value: 0.1 },  // valley
    ], 4);
    assertEq(a.length, 2);
    assertClose(a[0].time, 1.0);
    assertClose(a[0].value, 0.9);
    assertClose(a[1].time, 3.0);
    assertClose(a[1].value, 0.1);
});
test('Two points in one bar (valley before peak) → time-order anchors', () => {
    const a = specExtractAnchors([
        { time: 0.5, value: 0.2 },  // valley
        { time: 3.5, value: 0.8 },  // peak
    ], 4);
    assertEq(a.length, 2);
    assertClose(a[0].value, 0.2);
    assertClose(a[1].value, 0.8);
});
test('Multiple points per bar pick highest + lowest', () => {
    const a = specExtractAnchors([
        { time: 0.5, value: 0.3 },
        { time: 1.0, value: 0.9 },  // peak
        { time: 2.0, value: 0.5 },
        { time: 3.0, value: 0.1 },  // valley
        { time: 3.5, value: 0.4 },
    ], 4);
    // First/last source bounds + anchors
    assert(a.length >= 2);
    const peak = a.find(p => p.value === 0.9);
    const valley = a.find(p => p.value === 0.1);
    assert(peak, 'peak missing');
    assert(valley, 'valley missing');
});
test('Bars with no points are skipped (no spurious anchors)', () => {
    const a = specExtractAnchors([
        { time: 0.5, value: 0.5 },
        { time: 12.5, value: 0.7 },  // bar 4 (skipping bars 2 and 3)
    ], 16);
    // No anchors from empty bars 2 & 3 — just the two source points
    assertEq(a.length, 2);
    assertClose(a[0].time, 0.5);
    assertClose(a[1].time, 12.5);
});
test('Multiple bars with anchors each', () => {
    const a = specExtractAnchors([
        { time: 0, value: 0 },
        { time: 1, value: 1 },
        { time: 5, value: 0.5 },
        { time: 7, value: 0 },
        { time: 9, value: 0.8 },
        { time: 11, value: 0.2 },
    ], 12);
    // Bar 0: peak 1 @ t=1, valley 0 @ t=0 → ordered by time → 0, 1
    // Bar 1 (t=4..8): peak 0.5 @ t=5, valley 0 @ t=7 → 0.5, 0
    // Bar 2 (t=8..12): peak 0.8 @ t=9, valley 0.2 @ t=11 → 0.8, 0.2
    assert(a.length >= 6, `expected at least 6 anchors, got ${a.length}`);
});
test('First source point always bounds the anchors', () => {
    const a = specExtractAnchors([
        { time: 2.5, value: 0.5 },
        { time: 3.5, value: 0.6 },
    ], 4);
    assertClose(a[0].time, 2.5);
});
test('Last source point always bounds the anchors', () => {
    const a = specExtractAnchors([
        { time: 0.5, value: 0.5 },
        { time: 3.7, value: 0.6 },
    ], 4);
    assertClose(a[a.length - 1].time, 3.7);
});
test('Anchors emitted in strictly increasing time order', () => {
    const a = specExtractAnchors([
        { time: 0, value: 0.5 },
        { time: 1, value: 0.9 },
        { time: 2, value: 0.1 },
        { time: 3, value: 0.7 },
        { time: 5, value: 0.4 },
        { time: 6, value: 0.95 },
        { time: 7, value: 0.05 },
    ], 8);
    for (let i = 1; i < a.length; i++) {
        assert(a[i].time > a[i - 1].time, `anchors not monotonic at index ${i}: ${a[i - 1].time} → ${a[i].time}`);
    }
});

// ─── Personalities ──────────────────────────────────────────────

console.log('\nPersonality: Mirror\n');

const A = { time: 0, value: 0.2 };
const B = { time: 4, value: 0.8 };

test('Mirror at diversity=0 returns linear midpoint', () => {
    const r = specMakeRng(1);
    const mids = specPersonalityMirror(A, B, 0, r);
    assertEq(mids.length, 1);
    assertClose(mids[0].value, 0.5);  // (0.2 + 0.8) / 2
    assertClose(mids[0].time, 2);
});
test('Mirror at diversity=1 fully flips midpoint', () => {
    const r = specMakeRng(1);
    const mids = specPersonalityMirror(A, B, 1, r);
    // linearV = 0.5, flipped = 0.5, blended = 0.5 (flat midpoint case)
    // Use asymmetric anchors for a non-degenerate test:
    const A2 = { time: 0, value: 0.1 };
    const B2 = { time: 4, value: 0.5 };
    const m2 = specPersonalityMirror(A2, B2, 1, r);
    // linearV = 0.3, flipped = 0.7
    assertClose(m2[0].value, 0.7);
});
test('Mirror values clamped to [0,1]', () => {
    const r = specMakeRng(1);
    const mids = specPersonalityMirror({ time: 0, value: 0 }, { time: 4, value: 0 }, 1, r);
    assert(mids[0].value >= 0 && mids[0].value <= 1);
});

console.log('\nPersonality: Mutate\n');

test('Mutate produces 2-6 midpoints', () => {
    const r = specMakeRng(7);
    const mids = specPersonalityMutate(A, B, 0.5, r);
    assert(mids.length >= 2 && mids.length <= 6, `unexpected count: ${mids.length}`);
});
test('Mutate is deterministic for same seed', () => {
    const r1 = specMakeRng(99);
    const r2 = specMakeRng(99);
    const m1 = specPersonalityMutate(A, B, 0.7, r1);
    const m2 = specPersonalityMutate(A, B, 0.7, r2);
    assertEq(JSON.stringify(m1), JSON.stringify(m2));
});
test('Mutate values stay in [0,1]', () => {
    for (let seed = 1; seed < 50; seed++) {
        const r = specMakeRng(seed);
        const mids = specPersonalityMutate(A, B, 1.0, r);
        for (const m of mids) {
            assert(m.value >= 0 && m.value <= 1, `out of range at seed ${seed}: ${m.value}`);
        }
    }
});
test('Mutate times fall strictly between A and B', () => {
    const r = specMakeRng(12);
    const mids = specPersonalityMutate(A, B, 0.5, r);
    for (const m of mids) {
        assert(m.time > A.time && m.time < B.time, `time out of range: ${m.time}`);
    }
});

console.log('\nPersonality: MutateMirror\n');

test('MutateMirror inverts mutate values', () => {
    const r1 = specMakeRng(33);
    const mut = specPersonalityMutate(A, B, 0.5, r1);
    const r2 = specMakeRng(33);
    const mm = specPersonalityMutateMirror(A, B, 0.5, r2);
    assertEq(mut.length, mm.length);
    for (let i = 0; i < mut.length; i++) {
        assertClose(mm[i].value, 1 - mut[i].value);
    }
});

console.log('\nPersonality: Stutter\n');

test('Stutter produces 3-8 midpoints', () => {
    const r = specMakeRng(2);
    const mids = specPersonalityStutter(A, B, 0.5, r);
    assert(mids.length >= 3 && mids.length <= 8, `unexpected count: ${mids.length}`);
});
test('Stutter is deterministic for same seed', () => {
    const r1 = specMakeRng(7);
    const r2 = specMakeRng(7);
    const a = specPersonalityStutter(A, B, 0.5, r1);
    const b = specPersonalityStutter(A, B, 0.5, r2);
    assertEq(JSON.stringify(a), JSON.stringify(b));
});
test('Stutter alternates above/below baseline (swing pattern)', () => {
    const r = specMakeRng(11);
    const mids = specPersonalityStutter(A, B, 0.5, r);
    // i=1 → -swing (below), i=2 → +swing (above), i=3 → -swing, ...
    // Trend: values should be pulled in alternating directions from baseline
    // Just sanity check that the values aren't all identical
    const distinct = new Set(mids.map(m => Math.round(m.value * 100)));
    assert(distinct.size > 1, 'all stutter values identical — swing not applied');
});

console.log('\nPersonality: Smooth\n');

test('Smooth returns exactly 1 midpoint with curve', () => {
    const r = specMakeRng(5);
    const mids = specPersonalitySmooth(A, B, 0.5, r);
    assertEq(mids.length, 1);
    assert(Math.abs(mids[0].curve) > 0, 'curve should be non-zero');
});
test('Smooth midpoint at the time midpoint', () => {
    const r = specMakeRng(5);
    const mids = specPersonalitySmooth(A, B, 0.5, r);
    assertClose(mids[0].time, 2);
    assertClose(mids[0].value, 0.5);  // (0.2 + 0.8) / 2
});
test('Smooth curve scales with diversity', () => {
    const r1 = specMakeRng(1);
    const lo = specPersonalitySmooth(A, B, 0.1, r1);
    const r2 = specMakeRng(1);
    const hi = specPersonalitySmooth(A, B, 1.0, r2);
    assert(Math.abs(hi[0].curve) > Math.abs(lo[0].curve), 'high diversity should have larger curve');
});

console.log('\nPersonality: Step\n');

test('Step holds A value until just before B', () => {
    const r = specMakeRng(1);
    const mids = specPersonalityStep(A, B, 0.5, r);
    assertEq(mids.length, 1);
    assertClose(mids[0].value, A.value);
    assert(mids[0].time > 3 && mids[0].time < 4, `step time should be near B: ${mids[0].time}`);
});

console.log('\nPersonality: Drift\n');

test('Drift produces 5 midpoints', () => {
    const r = specMakeRng(7);
    const mids = specPersonalityDrift(A, B, 0.5, r);
    assertEq(mids.length, 5);
});
test('Drift values stay in [0,1]', () => {
    for (let seed = 1; seed < 30; seed++) {
        const r = specMakeRng(seed);
        const mids = specPersonalityDrift(A, B, 1.0, r);
        for (const m of mids) {
            assert(m.value >= 0 && m.value <= 1, `out of range at seed ${seed}: ${m.value}`);
        }
    }
});

console.log('\nPersonality: Chase\n');

test('Chase produces 1 time-shifted midpoint', () => {
    const r = specMakeRng(1);
    const mids = specPersonalityChase(A, B, 0.5, r);
    assertEq(mids.length, 1);
});
test('Chase midpoint clamped inside (A, B) range', () => {
    for (let seed = 1; seed < 50; seed++) {
        const r = specMakeRng(seed);
        const mids = specPersonalityChase(A, B, 1.0, r);
        assert(mids[0].time > A.time && mids[0].time < B.time, `chase time escaped: ${mids[0].time}`);
    }
});

// ─── Variant generation ─────────────────────────────────────────

console.log('\nVariant generation (full pipeline)\n');

test('Empty anchors returns empty variant', () => {
    const r = specMakeRng(1);
    assertEq(specGenerateVariant([], 'mirror', 0.5, r).length, 0);
});
test('Single anchor returns single point', () => {
    const r = specMakeRng(1);
    const v = specGenerateVariant([{ time: 1, value: 0.5 }], 'mirror', 0.5, r);
    assertEq(v.length, 1);
    assertClose(v[0].time, 1);
});
test('Two anchors emit anchors verbatim with personality midpoints between', () => {
    const r = specMakeRng(1);
    const anchors = [{ time: 0, value: 0.2 }, { time: 4, value: 0.8 }];
    const v = specGenerateVariant(anchors, 'mirror', 0.5, r);
    // First and last must be the anchors
    assertClose(v[0].time, 0);
    assertClose(v[0].value, 0.2);
    assertClose(v[v.length - 1].time, 4);
    assertClose(v[v.length - 1].value, 0.8);
});
test('Anchors preserved exactly across all 8 personalities', () => {
    const anchors = [
        { time: 0, value: 0.1 },
        { time: 4, value: 0.9 },
        { time: 8, value: 0.3 },
        { time: 12, value: 0.7 },
    ];
    for (const personality of PRISM_PERSONALITIES) {
        const r = specMakeRng(7);
        const v = specGenerateVariant(anchors, personality, 0.5, r);
        // Anchors must appear at their original time + value
        for (const a of anchors) {
            const found = v.find(p => Math.abs(p.time - a.time) < 0.0001 && Math.abs(p.value - a.value) < 0.0001);
            assert(found, `${personality}: anchor missing at t=${a.time} v=${a.value}`);
        }
    }
});
test('Generated variant times are monotonically increasing', () => {
    const anchors = [
        { time: 0, value: 0 },
        { time: 4, value: 1 },
        { time: 8, value: 0 },
    ];
    for (const personality of PRISM_PERSONALITIES) {
        const r = specMakeRng(13);
        const v = specGenerateVariant(anchors, personality, 0.7, r);
        for (let i = 1; i < v.length; i++) {
            assert(v[i].time > v[i - 1].time, `${personality}: non-monotonic at i=${i}: ${v[i - 1].time} → ${v[i].time}`);
        }
    }
});
test('Unknown personality falls back to mirror (no crash)', () => {
    const r = specMakeRng(1);
    const v = specGenerateVariant([{ time: 0, value: 0 }, { time: 4, value: 1 }], 'bogus', 0.5, r);
    assert(v.length >= 2, 'fallback should still produce a variant');
});

// ─── Personality assignment ─────────────────────────────────────

console.log('\nPersonality assignment\n');

function makeTargets(n) {
    const out = [];
    for (let i = 0; i < n; i++) out.push({ envelopeId: 'lane-' + i });
    return out;
}

test('Assignment uses only valid personalities', () => {
    const a = specAssignPersonalities(makeTargets(13), 42);
    for (const id in a) assert(PRISM_PERSONALITIES.includes(a[id]), `invalid personality: ${a[id]}`);
});
test('Assignment is deterministic per seed', () => {
    const a1 = specAssignPersonalities(makeTargets(8), 99);
    const a2 = specAssignPersonalities(makeTargets(8), 99);
    assertEq(JSON.stringify(a1), JSON.stringify(a2));
});
test('Different seeds typically produce different assignments', () => {
    const a1 = specAssignPersonalities(makeTargets(8), 1);
    const a2 = specAssignPersonalities(makeTargets(8), 2);
    let diff = 0;
    for (const id in a1) if (a1[id] !== a2[id]) diff++;
    assert(diff > 0, 'two different seeds produced identical assignments');
});
test('All 8 personalities used when targets >= 8', () => {
    const a = specAssignPersonalities(makeTargets(8), 42);
    const used = new Set(Object.values(a));
    assertEq(used.size, 8);
});
test('Cycles through personalities when targets > 8', () => {
    const a = specAssignPersonalities(makeTargets(13), 42);
    // First 8 must cover all 8 personalities, last 5 are repeats
    const first8 = Object.values(a).slice(0, 8);
    assertEq(new Set(first8).size, 8);
});
test('Single target gets one personality', () => {
    const a = specAssignPersonalities(makeTargets(1), 42);
    assertEq(Object.keys(a).length, 1);
    assert(PRISM_PERSONALITIES.includes(Object.values(a)[0]));
});

// ─── Full pipeline (compute + lock filtering) ───────────────────

console.log('\nFull pipeline\n');

function makeLanes(specs) {
    return specs.map(s => ({
        envelopeId: s.id,
        locked: !!s.locked,
        points: s.points || [],
    }));
}

test('Variants generated for all unlocked non-source lanes', () => {
    const lanes = makeLanes([
        { id: 'src', points: [{ time: 0, value: 0 }, { time: 2, value: 1 }, { time: 4, value: 0 }] },
        { id: 'a' },
        { id: 'b' },
        { id: 'c' },
    ]);
    const perLane = { a: 'mirror', b: 'smooth', c: 'step' };
    specPrismCompute(lanes, 'src', 0.5, 4, perLane, 42);
    assert(lanes.find(l => l.envelopeId === 'a').points.length > 0, 'lane a empty');
    assert(lanes.find(l => l.envelopeId === 'b').points.length > 0, 'lane b empty');
    assert(lanes.find(l => l.envelopeId === 'c').points.length > 0, 'lane c empty');
});
test('Locked lanes are NEVER written', () => {
    const lockedSnapshot = [{ time: 0.5, value: 0.42 }];
    const lanes = makeLanes([
        { id: 'src', points: [{ time: 0, value: 0 }, { time: 2, value: 1 }, { time: 4, value: 0 }] },
        { id: 'locked', locked: true, points: [...lockedSnapshot] },
        { id: 'free' },
    ]);
    const perLane = { locked: 'mirror', free: 'smooth' };
    specPrismCompute(lanes, 'src', 0.5, 4, perLane, 42);
    const lockedLane = lanes.find(l => l.envelopeId === 'locked');
    assertEq(lockedLane.points.length, 1);
    assertClose(lockedLane.points[0].value, 0.42);
});
test('Source lane is never overwritten by compute', () => {
    const lanes = makeLanes([
        { id: 'src', points: [{ time: 0, value: 0 }, { time: 2, value: 1 }] },
        { id: 'a' },
    ]);
    const before = JSON.stringify(lanes.find(l => l.envelopeId === 'src').points);
    specPrismCompute(lanes, 'src', 0.5, 4, { a: 'mirror' }, 42);
    const after = JSON.stringify(lanes.find(l => l.envelopeId === 'src').points);
    assertEq(before, after);
});
test('Empty source leaves variants alone (live-draw entry point)', () => {
    // When user enters Prism on an empty lane, we must NOT wipe the
    // variants — they stay at whatever they were until the first stroke.
    const lanes = makeLanes([
        { id: 'src', points: [] },
        { id: 'a', points: [{ time: 1, value: 0.5 }] },
    ]);
    specPrismCompute(lanes, 'src', 0.5, 4, { a: 'mirror' }, 42);
    const a = lanes.find(l => l.envelopeId === 'a');
    assertEq(a.points.length, 1);
    assertClose(a.points[0].value, 0.5);
});
test('First source point added → variants compute from it (live-draw)', () => {
    // The headline UX: user enters Prism on empty source, draws one
    // point, variants react. Verify the first stroke triggers a real
    // compute (not a no-op).
    const lanes = makeLanes([
        { id: 'src', points: [{ time: 2, value: 0.7 }] },
        { id: 'a' },
        { id: 'b' },
    ]);
    specPrismCompute(lanes, 'src', 0.5, 4, { a: 'mirror', b: 'smooth' }, 42);
    const a = lanes.find(l => l.envelopeId === 'a');
    const b = lanes.find(l => l.envelopeId === 'b');
    assert(a.points.length > 0, 'lane a should have variant points');
    assert(b.points.length > 0, 'lane b should have variant points');
});
test('Variants share source anchors at exact same X/Y', () => {
    const sourcePts = [
        { time: 0, value: 0.1 },   // bar 0 valley
        { time: 2, value: 0.95 },  // bar 0 peak
        { time: 5, value: 0.85 },  // bar 1 peak
        { time: 7, value: 0.05 },  // bar 1 valley
    ];
    const lanes = makeLanes([
        { id: 'src', points: sourcePts },
        { id: 'a' },
        { id: 'b' },
        { id: 'c' },
    ]);
    const perLane = { a: 'smooth', b: 'drift', c: 'chase' };
    specPrismCompute(lanes, 'src', 0.7, 8, perLane, 42);
    // Pull the expected anchors from the source itself
    const expectedAnchors = specExtractAnchors(sourcePts, 8);
    for (const id of ['a', 'b', 'c']) {
        const lane = lanes.find(l => l.envelopeId === id);
        for (const a of expectedAnchors) {
            const found = lane.points.find(p => Math.abs(p.time - a.time) < 0.001 && Math.abs(p.value - a.value) < 0.001);
            assert(found, `lane ${id} (${perLane[id]}): missing anchor at t=${a.time} v=${a.value}`);
        }
    }
});
test('Multiple compute calls with same seed produce identical output', () => {
    const sourcePts = [
        { time: 0, value: 0 },
        { time: 2, value: 0.8 },
        { time: 4, value: 0.2 },
    ];
    const make = () => makeLanes([
        { id: 'src', points: [...sourcePts] },
        { id: 'a' },
        { id: 'b' },
    ]);
    const perLane = { a: 'mutate', b: 'drift' };
    const lanes1 = make();
    const lanes2 = make();
    specPrismCompute(lanes1, 'src', 0.6, 4, perLane, 12345);
    specPrismCompute(lanes2, 'src', 0.6, 4, perLane, 12345);
    assertEq(
        JSON.stringify(lanes1.find(l => l.envelopeId === 'a').points),
        JSON.stringify(lanes2.find(l => l.envelopeId === 'a').points),
    );
    assertEq(
        JSON.stringify(lanes1.find(l => l.envelopeId === 'b').points),
        JSON.stringify(lanes2.find(l => l.envelopeId === 'b').points),
    );
});
test('All variant point values clamped to [0,1]', () => {
    const sourcePts = [
        { time: 0, value: 0 },
        { time: 2, value: 1 },
        { time: 4, value: 0 },
    ];
    const lanes = makeLanes([
        { id: 'src', points: sourcePts },
        { id: 'a' }, { id: 'b' }, { id: 'c' }, { id: 'd' },
        { id: 'e' }, { id: 'f' }, { id: 'g' }, { id: 'h' },
    ]);
    const perLane = specAssignPersonalities(lanes.filter(l => l.envelopeId !== 'src'), 99);
    specPrismCompute(lanes, 'src', 1.0, 4, perLane, 99);
    for (const lane of lanes) {
        if (lane.envelopeId === 'src') continue;
        for (const p of lane.points) {
            assert(p.value >= 0 && p.value <= 1, `${lane.envelopeId}: out of range ${p.value}`);
        }
    }
});

// ─── Summary ────────────────────────────────────────────────────

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
