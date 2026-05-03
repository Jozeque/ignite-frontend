/**
 * Behavior tests for the v1.2 polish features:
 *   - Sticky last-used bar count (validation, fallback)
 *   - Lane lock filtering across the tool surface
 *
 * Pure-logic specs — DOM-bound code in canvas.js can't be loaded directly,
 * so these tests re-implement the same logic and validate the contract.
 * If main canvas.js drifts, update both sides to match.
 *
 * Run: node test/test-v1-2-polish.js
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

// ─── Sticky bars — validation contract ───────────────────────────

const SD_VALID_BARS = [2, 4, 8, 16, 32];
function specValidateBars(val) {
    const n = parseInt(val, 10);
    return SD_VALID_BARS.includes(n) ? n : 4;
}

console.log('Sticky last-used bars validation\n');

test('Valid 2 stays 2', () => assertEq(specValidateBars(2), 2));
test('Valid 4 stays 4', () => assertEq(specValidateBars(4), 4));
test('Valid 8 stays 8', () => assertEq(specValidateBars(8), 8));
test('Valid 16 stays 16', () => assertEq(specValidateBars(16), 16));
test('Valid 32 stays 32', () => assertEq(specValidateBars(32), 32));
test('String "8" parses to 8', () => assertEq(specValidateBars("8"), 8));
test('String "32" parses to 32', () => assertEq(specValidateBars("32"), 32));
test('Invalid 7 falls back to 4', () => assertEq(specValidateBars(7), 4));
test('Invalid 64 falls back to 4', () => assertEq(specValidateBars(64), 4));
test('Negative falls back to 4', () => assertEq(specValidateBars(-4), 4));
test('Zero falls back to 4', () => assertEq(specValidateBars(0), 4));
test('Null falls back to 4', () => assertEq(specValidateBars(null), 4));
test('Undefined falls back to 4', () => assertEq(specValidateBars(undefined), 4));
test('Garbage string falls back to 4', () => assertEq(specValidateBars("abc"), 4));
test('Float 4.5 parses to 4 (parseInt) — valid', () => assertEq(specValidateBars(4.5), 4));

// ─── Lane lock — filter contract ─────────────────────────────────

// Mirrors sdGetTargetParams + sdGetUnlockedParams in canvas.js. Locked
// lanes are excluded from BOTH the "all lanes" mode and the "active
// lane only" mode. Tools that iterate sdCanvasParams directly call
// sdGetUnlockedParams (or apply !p.locked filter inline).

function specGetTargetParams(params, applyAllMode, activeId) {
    if (applyAllMode) return params.filter(p => !p.locked);
    const p = params.find(p => p.envelopeId === activeId);
    return (p && !p.locked) ? [p] : [];
}
function specGetUnlockedParams(params) {
    return params.filter(p => !p.locked);
}
function specLockSkipMessage(params, processedCount) {
    const total = params.length;
    const locked = params.filter(p => p.locked).length;
    if (locked === 0) return null;
    return `Applied to ${processedCount}/${total} lanes — ${locked} locked`;
}

console.log('\nLane lock filtering\n');

const lanes = [
    { envelopeId: 'a', locked: false, points: [] },
    { envelopeId: 'b', locked: true,  points: [] },
    { envelopeId: 'c', locked: false, points: [] },
    { envelopeId: 'd', locked: true,  points: [] },
];

test('All-lanes mode skips locked lanes', () => {
    const t = specGetTargetParams(lanes, true, 'a');
    assertEq(t.length, 2);
    assertEq(t[0].envelopeId, 'a');
    assertEq(t[1].envelopeId, 'c');
});

test('Active-only mode returns active when unlocked', () => {
    const t = specGetTargetParams(lanes, false, 'a');
    assertEq(t.length, 1);
    assertEq(t[0].envelopeId, 'a');
});

test('Active-only mode returns nothing when active is locked', () => {
    const t = specGetTargetParams(lanes, false, 'b');
    assertEq(t.length, 0);
});

test('Active-only mode returns nothing when no active id is set', () => {
    const t = specGetTargetParams(lanes, false, null);
    assertEq(t.length, 0);
});

test('All lanes locked + all-mode returns empty', () => {
    const allLocked = lanes.map(l => ({ ...l, locked: true }));
    const t = specGetTargetParams(allLocked, true, 'a');
    assertEq(t.length, 0);
});

test('No lanes locked + all-mode returns everything', () => {
    const noneLocked = lanes.map(l => ({ ...l, locked: false }));
    const t = specGetTargetParams(noneLocked, true, 'a');
    assertEq(t.length, 4);
});

test('getUnlockedParams filters identically to all-mode', () => {
    const unlocked = specGetUnlockedParams(lanes);
    const allMode = specGetTargetParams(lanes, true, 'a');
    assertEq(unlocked.length, allMode.length);
    assertEq(unlocked.map(l => l.envelopeId).join(','),
             allMode.map(l => l.envelopeId).join(','));
});

console.log('\nLock skip message\n');

test('Returns null when no lanes are locked', () => {
    const noneLocked = lanes.map(l => ({ ...l, locked: false }));
    assertEq(specLockSkipMessage(noneLocked, 4), null);
});

test('Returns "X/Y — Z locked" when some are locked', () => {
    const msg = specLockSkipMessage(lanes, 2);
    assertEq(msg, 'Applied to 2/4 lanes — 2 locked');
});

test('Returns 0/Y when all are locked', () => {
    const allLocked = lanes.map(l => ({ ...l, locked: true }));
    assertEq(specLockSkipMessage(allLocked, 0), 'Applied to 0/4 lanes — 4 locked');
});

// ─── Lock persistence — saveCanvasState / restoreCanvasState round-trip ──

// Mirrors the save/restore logic. Locked lanes are saved even if empty
// (empty-locked is meaningful intent: "marked don't-touch"). Restore
// re-applies the locked flag from saved state onto current sdCanvasParams.

function specSaveState(params) {
    return params
        .filter(p => p.points.length > 0 || p.locked)
        .map(p => ({
            envelopeId: p.envelopeId,
            locked: !!p.locked,
            points: p.points.map(pt => ({ time: pt.time, value: pt.value, curve: pt.curve || 0 })),
        }));
}

function specRestoreState(currentParams, savedState) {
    savedState.forEach(sp => {
        const param = currentParams.find(p => p.envelopeId === sp.envelopeId);
        if (!param) return;
        if (sp.points) param.points = sp.points;
        if (typeof sp.locked === 'boolean') param.locked = sp.locked;
    });
}

console.log('\nCanvas-state save/restore round-trip\n');

test('Empty-locked lane is persisted', () => {
    const params = [{ envelopeId: 'a', locked: true, points: [] }];
    const saved = specSaveState(params);
    assertEq(saved.length, 1);
    assertEq(saved[0].locked, true);
    assertEq(saved[0].points.length, 0);
});

test('Empty-unlocked lane is NOT persisted', () => {
    const params = [{ envelopeId: 'a', locked: false, points: [] }];
    const saved = specSaveState(params);
    assertEq(saved.length, 0);
});

test('Lane with points is always persisted', () => {
    const params = [
        { envelopeId: 'a', locked: false, points: [{ time: 0, value: 0.5 }] },
        { envelopeId: 'b', locked: true,  points: [{ time: 1, value: 0.7 }] },
    ];
    const saved = specSaveState(params);
    assertEq(saved.length, 2);
});

test('Restore re-applies locked flag', () => {
    const current = [
        { envelopeId: 'a', locked: false, points: [] },
        { envelopeId: 'b', locked: false, points: [] },
    ];
    const saved = [
        { envelopeId: 'a', locked: true,  points: [] },
        { envelopeId: 'b', locked: false, points: [{ time: 0, value: 0.3 }] },
    ];
    specRestoreState(current, saved);
    assertEq(current[0].locked, true);
    assertEq(current[1].locked, false);
    assertEq(current[1].points.length, 1);
});

test('Restore is no-op for unknown envelopeId', () => {
    const current = [{ envelopeId: 'a', locked: false, points: [] }];
    const saved = [{ envelopeId: 'ghost', locked: true, points: [] }];
    specRestoreState(current, saved);
    assertEq(current[0].locked, false);
});

test('Restore preserves locked=false when saved is missing locked field', () => {
    const current = [{ envelopeId: 'a', locked: false, points: [] }];
    const saved = [{ envelopeId: 'a', points: [{ time: 0, value: 0.5 }] }]; // no locked
    specRestoreState(current, saved);
    assertEq(current[0].locked, false);
    assertEq(current[0].points.length, 1);
});

console.log(`\n${passed} passed, ${failed} failed\n`);
process.exit(failed > 0 ? 1 : 0);
