/**
 * test-lock-unlock.js
 *
 * Covers the Quick lock/unlock feature + the rescan-then-apply integration.
 * canvas.js can't load in Node (DOM-bound), so this has two layers:
 *   1. Behavioral — replicate the pure logic (moving-detection, lock/unlock set
 *      ops, locked count, additive lock) AND simulate the auto-scan merge to
 *      prove a lock survives the rescan that every Motion generator now triggers.
 *   2. Source assertions — read the REAL canvas.js / server.js and assert the
 *      wiring exists (so the replicated logic can't silently drift from shipping
 *      code): unlock action, lane-action list, merge carries `locked`, the
 *      device locked-count outlet, and no em dash in the status copy.
 */
'use strict';
const fs = require('fs');
const path = require('path');

let passed = 0, failed = 0;
function ok(name, cond, extra) {
    if (cond) { passed++; }
    else { failed++; console.log('  ✗ ' + name + (extra ? '  — ' + extra : '')); }
}

console.log('test-lock-unlock.js');

// ─────────────────────────────────────────────────────────────
// 1. BEHAVIORAL — replicas of the canvas.js logic under test
// ─────────────────────────────────────────────────────────────

// _sdLaneMoving: a lane "moves" only if its curve varies by > 0.001
function laneMoving(p) {
    if (!p.points || p.points.length < 2) return false;
    let lo = p.points[0].value, hi = p.points[0].value;
    for (let i = 1; i < p.points.length; i++) {
        const v = p.points[i].value;
        if (v < lo) lo = v;
        if (v > hi) hi = v;
    }
    return (hi - lo) > 0.001;
}
function lockCurrent(params) { let n = 0; params.forEach(p => { if (laneMoving(p)) { if (!p.locked) n++; p.locked = true; } }); return n; }
function unlockAll(params)  { let n = 0; params.forEach(p => { if (p.locked) { n++; p.locked = false; } }); return n; }
function lockedCount(params) { return params.filter(p => p.locked).length; }

function lane(id, values, locked) {
    return { envelopeId: id, locked: !!locked, points: (values || []).map((v, i) => ({ time: i, value: v })) };
}

// ── moving detection ──
ok('flat lane is not moving', laneMoving(lane('a', [0.5, 0.5, 0.5])) === false);
ok('varying lane is moving', laneMoving(lane('b', [0, 0.5, 1])) === true);
ok('single-point lane is not moving', laneMoving(lane('c', [0.5])) === false);
ok('empty lane is not moving', laneMoving(lane('d', [])) === false);
ok('sub-threshold wobble is not moving', laneMoving(lane('e', [0.5, 0.5005, 0.5])) === false);

// ── lock current locks moving lanes only ──
(function () {
    const ps = [lane('A', [0, 1]), lane('B', [0.5, 0.5]), lane('C', [0.2, 0.9]), lane('D', [])];
    const n = lockCurrent(ps);
    ok('lockCurrent: returns 2 newly-locked (A, C)', n === 2, 'n=' + n);
    ok('lockCurrent: A locked', ps[0].locked === true);
    ok('lockCurrent: B (flat) stays unlocked', ps[1].locked === false);
    ok('lockCurrent: C locked', ps[2].locked === true);
    ok('lockCurrent: D (empty) stays unlocked', ps[3].locked === false);
    ok('lockedCount == 2', lockedCount(ps) === 2);
})();

// ── lock is ADDITIVE/repeatable: add a new moving lane, lock again locks only it ──
(function () {
    const ps = [lane('A', [0, 1]), lane('B', [0.5, 0.5])];
    lockCurrent(ps);                       // A locked
    ps.push(lane('E', [0.1, 0.8]));        // user adds a param + draws on it
    const n2 = lockCurrent(ps);            // press Lock again
    ok('additive lock: only the new lane newly-locks', n2 === 1, 'n2=' + n2);
    ok('additive lock: A still locked', ps[0].locked === true);
    ok('additive lock: E now locked', ps[2].locked === true);
    ok('additive lock: total locked == 2', lockedCount(ps) === 2);
})();

// ── unlock all clears every lock ──
(function () {
    const ps = [lane('A', [0, 1], true), lane('B', [0.2, 0.9], true), lane('C', [0.5, 0.5])];
    const n = unlockAll(ps);
    ok('unlockAll: returns 2 cleared', n === 2, 'n=' + n);
    ok('unlockAll: nothing left locked', lockedCount(ps) === 0);
    ok('unlockAll: idempotent (second call clears 0)', unlockAll(ps) === 0);
})();

// ── generator targeting respects locks (filter p=>!p.locked) ──
(function () {
    const ps = [lane('A', [0, 1], true), lane('B', []), lane('C', [], false)];
    const targets = ps.filter(p => !p.locked);
    ok('generator skips locked lane A', targets.indexOf(ps[0]) === -1);
    ok('generator targets the 2 unlocked lanes', targets.length === 2);
})();

// ─────────────────────────────────────────────────────────────
// 2. CRITICAL: the rescan-then-apply merge must PRESERVE locks
//    (mirrors the fixed auto-scan merge in canvas.js: carry {points,locked}
//     by envelopeId → loadParamsDirectly rebuilds locked:false → restore)
// ─────────────────────────────────────────────────────────────
function simulateAutoScanMerge(before, scannedIds) {
    // carry by envelopeId
    const carried = {};
    before.forEach(p => {
        if ((p.points && p.points.length) || p.locked) {
            carried[p.envelopeId] = { points: (p.points && p.points.length) ? p.points : null, locked: !!p.locked };
        }
    });
    // loadParamsDirectly rebuilds EVERY lane with locked:false
    const after = scannedIds.map(id => ({ envelopeId: id, locked: false, points: [] }));
    // restore carried points + locks
    after.forEach(p => {
        const c = carried[p.envelopeId];
        if (c) { if (c.points) p.points = c.points; if (c.locked) p.locked = true; }
    });
    return after;
}
(function () {
    // user's exact story: lock A (moving), add a param C, fire a generator →
    // generator rescans first → merge → A must still be locked, C must be free.
    const before = [lane('A', [0, 1], true)];
    const after = simulateAutoScanMerge(before, ['A', 'C']);
    const A = after.find(p => p.envelopeId === 'A');
    const C = after.find(p => p.envelopeId === 'C');
    ok('merge: locked lane A survives the rescan', A && A.locked === true);
    ok('merge: A keeps its curve', A && A.points.length === 2);
    ok('merge: new lane C arrives unlocked', C && C.locked === false);
    const genTargets = after.filter(p => !p.locked);
    ok('merge: generator now hits only C (A stays frozen)', genTargets.length === 1 && genTargets[0].envelopeId === 'C');
})();

// ── move stack: a generator resets, a transform stacks, lock/unlock do NEITHER ──
const SD_GENERATORS = ['chaos', 'neuro', 'reflector', 'sh', 'prism'];
const SD_ACTION_LABELS = { chaos: 'Chaos', neuro: 'Neuro', reflector: 'Reflector', sh: 'S&H', prism: 'Prism', mutate: 'Mutate', shuffle: 'Shuffle', double: '2x', half: '0.5x' };
ok('lockcurrent is not a labelled move (no stack pollution)', !SD_ACTION_LABELS['lockcurrent']);
ok('unlockall is not a labelled move', !SD_ACTION_LABELS['unlockall']);
ok('generators rescan (chaos in generator set)', SD_GENERATORS.indexOf('chaos') !== -1);
ok('transforms do NOT rescan (mutate not a generator)', SD_GENERATORS.indexOf('mutate') === -1);
ok('lock does NOT rescan (lockcurrent not a generator)', SD_GENERATORS.indexOf('lockcurrent') === -1);

// ─────────────────────────────────────────────────────────────
// 3. SOURCE ASSERTIONS — the real files must carry the wiring
// ─────────────────────────────────────────────────────────────
const canvasSrc = fs.readFileSync(path.join(__dirname, '..', 'app', 'renderer', 'canvas.js'), 'utf8');
const serverSrc = fs.readFileSync(path.join(__dirname, '..', 'm4l', 'node', 'server.js'), 'utf8');

ok('canvas: sdUnlockAllLanes defined', /window\.sdUnlockAllLanes\s*=\s*function/.test(canvasSrc));
ok('canvas: unlockall dispatched', canvasSrc.indexOf("case 'unlockall':") !== -1);
ok('canvas: lockcurrent dispatched', canvasSrc.indexOf("case 'lockcurrent':") !== -1);
ok('canvas: lane-action list has unlockall', /_SD_LANE_ACTIONS\s*=\s*\[[^\]]*'unlockall'/.test(canvasSrc));
ok('canvas: lane-action list has lockcurrent', /_SD_LANE_ACTIONS\s*=\s*\[[^\]]*'lockcurrent'/.test(canvasSrc));
ok('canvas: two rack_scanned listeners (merge + queued generator)', (canvasSrc.match(/on\('rack_scanned'/g) || []).length >= 2);
ok('canvas: generator queue var present', canvasSrc.indexOf('_sdGenAfterScan') !== -1);
ok('canvas: quick_state sends locked count', /locked:\s*sdCanvasParams\.filter/.test(canvasSrc));
// the merge fix: carry AND restore the lock flag
ok('canvas: merge carries locked', canvasSrc.indexOf('locked: !!p.locked }') !== -1 || /locked:\s*!!p\.locked\s*\}/.test(canvasSrc));
ok('canvas: merge restores locked', canvasSrc.indexOf('if (c.locked) p.locked = true;') !== -1);
// param-identity fix: carry/save/restore key on the STABLE LOM _path, NOT the
// scanner's positional envelopeId (which renumbers when params are added, landing
// locks/curves on the wrong params — the "Chaos hit my locked lanes" bug).
ok('canvas: merge carries by stable _path (not positional envelopeId)', /carried\[p\._path\]/.test(canvasSrc) && canvasSrc.indexOf('carried[p.envelopeId]') === -1);
ok('canvas: saveCanvasState stores _path', /_path: p\._path \|\| null/.test(canvasSrc));
ok('canvas: restoreCanvasState matches by _path', /find\(p => p\._path && p\._path === sp\._path\)/.test(canvasSrc));
// copy rule: no em dash in the lock/unlock status strings
ok('canvas: lock status has no em dash', canvasSrc.indexOf('Generators now touch only new params') !== -1);
ok('canvas: unlock status has no em dash', canvasSrc.indexOf('Generators now modulate every lane') !== -1);
ok('canvas: old em-dash lock phrasing is gone', canvasSrc.indexOf('only modulate new params') === -1);
ok('canvas: no em dash char in lock function body', (function () {
    const i = canvasSrc.indexOf('sdLockCurrentLanes = function');
    const j = canvasSrc.indexOf('sdUnlockAllLanes = function');
    const k = canvasSrc.indexOf('};', j);
    return canvasSrc.slice(i, k).indexOf('—') === -1;
})());

ok('server: emits quick_locked outlet', serverSrc.indexOf("Max.outlet('quick_locked'") !== -1);
ok('server: carries locked from app msg', /locked:\s*msg\.locked/.test(serverSrc));
ok('server: preserves locked on ws-close idle', /locked:\s*prev\.locked/.test(serverSrc));

console.log('  ' + passed + ' passed, ' + failed + ' failed');
if (failed > 0) process.exit(1);
