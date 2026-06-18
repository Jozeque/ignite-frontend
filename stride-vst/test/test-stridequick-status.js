/**
 * Regression tests for the StrideQuick v2.1 additions (device panel logic):
 *
 *   - "moving" detection — the device counter / status only count a lane whose
 *     curve actually VARIES (empty + flat lanes don't register).
 *   - Move stack — the status line accumulates moves: a generator resets the
 *     recipe, a transform stacks on (deduped), bars/rescan/inject leave it.
 *   - Prism source pick — the one-shot Prism picks the active lane if it has a
 *     real curve, else the richest moving lane, and BAILS (no wipe) when no lane
 *     has a moving curve. This is the guard that fixed the "Prism deleted 80% of
 *     the canvas" single-point-source bug.
 *
 * Pure-logic specs mirroring canvas.js (DOM-bound there, re-implemented here).
 * If canvas.js drifts, update both sides.
 *
 * Run: node test/test-stridequick-status.js
 */

let passed = 0, failed = 0;
function test(name, fn) {
    try { fn(); console.log(`  ✓ ${name}`); passed++; }
    catch (e) { console.log(`  ✗ ${name}: ${e.message}`); failed++; }
}
function assert(cond, msg) { if (!cond) throw new Error(msg || 'assertion failed'); }
function assertEq(a, b, msg) {
    const A = JSON.stringify(a), B = JSON.stringify(b);
    if (A !== B) throw new Error((msg || 'mismatch') + ` — got ${A}, expected ${B}`);
}

// ─── spec implementations (mirror canvas.js) ─────────────────────

function laneRange(p) {
    if (!p.points || p.points.length < 2) return 0;
    let lo = p.points[0].value, hi = p.points[0].value;
    for (let i = 1; i < p.points.length; i++) {
        const v = p.points[i].value;
        if (v < lo) lo = v;
        if (v > hi) hi = v;
    }
    return hi - lo;
}
function isMoving(p) { return laneRange(p) > 0.001; }

const GENERATORS = ['chaos', 'neuro', 'reflector', 'sh', 'prism'];
const LABELS = {
    chaos: 'Chaos', neuro: 'Neuro', reflector: 'Reflector', sh: 'S&H', prism: 'Prism',
    mutate: 'Mutate', shuffle: 'Shuffle', double: '2x', half: '0.5x',
};
// returns the NEW stack after applying `action` to `stack`
function applyMove(stack, action) {
    if (!LABELS[action]) return stack.slice();           // bars/rescan/inject/unknown: untouched
    const lbl = LABELS[action];
    if (GENERATORS.indexOf(action) !== -1) return [lbl]; // generator = fresh recipe
    if (stack.indexOf(lbl) === -1) return stack.concat([lbl]); // transform = append, deduped
    return stack.slice();
}

// returns the chosen source lane, or null = bail (never wipe)
function pickPrismSource(lanes, activeId) {
    let source = lanes.find(p => p.envelopeId === activeId) || null;
    if (!source || laneRange(source) <= 0.001) {
        source = null;
        let best = 0.001;
        lanes.forEach(p => { const r = laneRange(p); if (r > best) { best = r; source = p; } });
    }
    return source;
}

const flat = (v) => ({ points: [{ time: 0, value: v }, { time: 16, value: v }] });
const onePt = (v) => ({ points: [{ time: 2, value: v }] });
const curve = (lo, hi) => ({ points: [{ time: 0, value: lo }, { time: 4, value: hi }, { time: 8, value: lo }, { time: 12, value: hi }] });

// ─── "moving" detection ──────────────────────────────────────────
console.log('\nmoving detection (counter + status):');
test('empty lane is not moving', () => assert(!isMoving({ points: [] })));
test('single point is not moving', () => assert(!isMoving(onePt(0.5))));
test('flat 2-point line is not moving', () => assert(!isMoving(flat(0.5))));
test('sub-threshold wiggle (<0.001) is not moving', () =>
    assert(!isMoving({ points: [{ time: 0, value: 0.5 }, { time: 8, value: 0.5005 }] })));
test('a real curve is moving', () => assert(isMoving(curve(0.2, 0.8))));
test('moving count over a mixed rack', () => {
    const lanes = [curve(0.2, 0.8), flat(0.5), onePt(0.3), curve(0.1, 0.9), { points: [] }];
    assertEq(lanes.filter(isMoving).length, 2, '2 of 5 lanes move');
});

// ─── move stack (status accumulation) ────────────────────────────
console.log('\nmove stack:');
test('a generator seeds the stack', () => assertEq(applyMove([], 'neuro'), ['Neuro']));
test('a transform stacks on top', () => assertEq(applyMove(['Neuro'], 'double'), ['Neuro', '2x']));
test('press 8(bars) does not change the stack', () => assertEq(applyMove(['Neuro', '2x'], 'bars'), ['Neuro', '2x']));
test('full combo neuro->2x->mutate', () => {
    let s = [];
    ['neuro', 'bars', 'double', 'mutate'].forEach(a => { s = applyMove(s, a); });
    assertEq(s, ['Neuro', '2x', 'Mutate'], 'bars excluded, order kept');
});
test('repeated transform is deduped', () => {
    let s = applyMove(['Neuro'], 'double');
    s = applyMove(s, 'double');
    assertEq(s, ['Neuro', '2x']);
});
test('a new generator RESETS the stack', () => assertEq(applyMove(['Neuro', '2x', 'Mutate'], 'chaos'), ['Chaos']));
test('rescan + inject leave the stack', () => {
    assertEq(applyMove(['Chaos', 'Mutate'], 'rescan'), ['Chaos', 'Mutate']);
    assertEq(applyMove(['Chaos', 'Mutate'], 'inject'), ['Chaos', 'Mutate']);
});

// ─── Prism source pick (the canvas-wipe guard) ───────────────────
console.log('\nprism source pick (wipe guard):');
test('active lane with a curve is the source', () => {
    const lanes = [
        { envelopeId: 'a', points: curve(0.2, 0.8).points },
        { envelopeId: 'b', points: curve(0.1, 0.9).points },
    ];
    assert(pickPrismSource(lanes, 'b') && pickPrismSource(lanes, 'b').envelopeId === 'b');
});
test('bare active lane falls back to the richest moving lane', () => {
    const lanes = [
        { envelopeId: 'a', points: onePt(0.5).points },   // active but bare
        { envelopeId: 'b', points: curve(0.3, 0.6).points },
        { envelopeId: 'c', points: curve(0.0, 1.0).points }, // richest
    ];
    const src = pickPrismSource(lanes, 'a');
    assert(src && src.envelopeId === 'c', 'should pick the widest-range lane');
});
test('SINGLE-POINT-only rack bails (no wipe)', () => {
    // This is the exact bug: lane[0] is a mapping point -> would have spread a
    // single point onto every lane. The guard must return null instead.
    const lanes = [onePt(0.5), onePt(0.3), onePt(0.7)].map((l, i) => ({ envelopeId: 'l' + i, points: l.points }));
    assert(pickPrismSource(lanes, 'l0') === null, 'no moving lane -> bail');
});
test('all-flat rack bails (no wipe)', () => {
    const lanes = [flat(0.5), flat(0.2)].map((l, i) => ({ envelopeId: 'l' + i, points: l.points }));
    assert(pickPrismSource(lanes, 'l0') === null);
});
test('one real curve among bare lanes is found', () => {
    const lanes = [onePt(0.5), flat(0.3), curve(0.2, 0.8)].map((l, i) => ({ envelopeId: 'l' + i, points: l.points }));
    const src = pickPrismSource(lanes, 'l0');
    assert(src && src.envelopeId === 'l2', 'finds the only moving lane');
});

console.log(`\n${'─'.repeat(46)}`);
console.log(`  ${passed} passed, ${failed} failed`);
console.log(`${'─'.repeat(46)}`);
process.exit(failed ? 1 : 0);
