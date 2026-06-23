/**
 * test-param-identity.js
 *
 * Regression guard for the "Chaos hit my locked lanes" / curves-land-on-wrong-param
 * bug (found + fixed 2026-06-23).
 *
 * ROOT CAUSE: the scanner gives each lane a POSITIONAL id (`_paramIdCounter++`,
 * reset every scan — scanner_max.js), so adding/removing a mapped param RENUMBERS
 * every later id. Therefore the canvas must carry locks/curves across a rescan, and
 * persist saved state, keyed on the STABLE LOM `_path` — NOT the positional
 * envelopeId. This test MODELS the renumber and proves `_path` keying keeps
 * locks/curves on the right params, while the old envelopeId keying misroutes them.
 *
 * If this ever fails, someone re-introduced positional-id keying somewhere in the
 * carry/save/restore path — the curves/locks will silently land on the wrong params.
 */
'use strict';
const fs = require('fs');
const path = require('path');
let passed = 0, failed = 0;
function ok(name, cond, extra) { if (cond) passed++; else { failed++; console.log('  ✗ ' + name + (extra ? '  -- ' + extra : '')); } }
console.log('test-param-identity.js');

// Behavioral replica of the rescan-merge carry (mirrors canvas.js ~931-950):
// snapshot current lanes' curves+locks, rebuild lanes from the scan (locked:false),
// then re-apply the snapshot. `keyOf` lets us contrast _path (correct) vs envelopeId (buggy).
function mergeCarry(before, scanned, keyOf) {
    const carried = {};
    before.forEach(p => {
        const k = keyOf(p);
        if (k != null && ((p.points && p.points.length) || p.locked)) {
            carried[k] = { points: (p.points && p.points.length) ? p.points : null, locked: !!p.locked };
        }
    });
    const lanes = scanned.map(p => ({ envelopeId: String(p.id), _path: p._path, name: p.name, locked: false, points: [] }));
    lanes.forEach(p => {
        const c = carried[keyOf(p)];
        if (c) { if (c.points) p.points = c.points.slice(); if (c.locked) p.locked = true; }
    });
    return lanes;
}

// 4 params mapped + locked (positional ids 0..3, but STABLE _paths).
const before = [
    { _path: 'live_set tracks 0 devices 0 parameters 10', envelopeId: '0', name: 'Osc',  locked: true, points: [{ time: 0, value: 0.2 }] },
    { _path: 'live_set tracks 0 devices 0 parameters 11', envelopeId: '1', name: 'Amp',  locked: true, points: [{ time: 0, value: 0.3 }] },
    { _path: 'live_set tracks 0 devices 0 parameters 12', envelopeId: '2', name: 'Pan',  locked: true, points: [{ time: 0, value: 0.4 }] },
    { _path: 'live_set tracks 0 devices 0 parameters 13', envelopeId: '3', name: 'Send', locked: true, points: [{ time: 0, value: 0.5 }] },
];
// User maps 2 NEW filter params. The scanner RENUMBERS by scan order: the filter
// params sit EARLY in the device, so they take ids 0,1 and the four old params
// shift to ids 2..5. Their _paths are unchanged.
const scanned = [
    { id: 0, _path: 'live_set tracks 0 devices 0 parameters 4',  name: 'Filter Freq' },
    { id: 1, _path: 'live_set tracks 0 devices 0 parameters 5',  name: 'Filter Res' },
    { id: 2, _path: 'live_set tracks 0 devices 0 parameters 10', name: 'Osc' },
    { id: 3, _path: 'live_set tracks 0 devices 0 parameters 11', name: 'Amp' },
    { id: 4, _path: 'live_set tracks 0 devices 0 parameters 12', name: 'Pan' },
    { id: 5, _path: 'live_set tracks 0 devices 0 parameters 13', name: 'Send' },
];

// ── CORRECT: carry by _path keeps locks/curves on the right params ──
const byPath = mergeCarry(before, scanned, p => p._path);
const lockedPaths = byPath.filter(p => p.locked).map(p => p._path).sort();
const expectLocked = [
    'live_set tracks 0 devices 0 parameters 10', 'live_set tracks 0 devices 0 parameters 11',
    'live_set tracks 0 devices 0 parameters 12', 'live_set tracks 0 devices 0 parameters 13'
].sort();
ok('by _path: the 4 original params stay LOCKED', JSON.stringify(lockedPaths) === JSON.stringify(expectLocked));
ok('by _path: the 2 NEW filter params are UNLOCKED', byPath.filter(p => p.name.startsWith('Filter')).every(p => !p.locked));
ok('by _path: original params keep their curves', (byPath.find(p => p.name === 'Osc').points || []).length === 1);
ok('by _path: new params have NO carried curve', byPath.filter(p => p.name.startsWith('Filter')).every(p => p.points.length === 0));

// ── THE BUG: carry by positional envelopeId misroutes (this is what we must NEVER ship) ──
const byId = mergeCarry(before, scanned, p => p.envelopeId);
ok('by envelopeId (BUG): a NEW filter param wrongly inherits a lock', byId.find(p => p.name === 'Filter Freq').locked === true);
ok('by envelopeId (BUG): an ORIGINAL param wrongly loses its lock', byId.find(p => p.name === 'Send').locked === false);

// ── SOURCE: the real code keys carry/save/restore on _path ──
const canvasSrc = fs.readFileSync(path.join(__dirname, '..', 'app', 'renderer', 'canvas.js'), 'utf8');
ok('canvas: rescan-merge carry keyed by _path (not positional envelopeId)', /carried\[p\._path\]/.test(canvasSrc) && canvasSrc.indexOf('carried[p.envelopeId]') === -1);
ok('canvas: saveCanvasState persists _path', /_path: p\._path \|\| null/.test(canvasSrc));
ok('canvas: restoreCanvasState matches by _path (envelopeId only as legacy fallback)', /sp\._path[\s\S]{0,80}find\(p => p\._path && p\._path === sp\._path\)/.test(canvasSrc));

// ── SOURCE: the root cause is still as documented (positional id + stable _path) ──
const scannerSrc = fs.readFileSync(path.join(__dirname, '..', 'm4l', 'node', 'scanner_max.js'), 'utf8');
ok('scanner: id is the positional _paramIdCounter (the reason _path keying is mandatory)', /id: _paramIdCounter\+\+/.test(scannerSrc));
ok('scanner: every param carries a stable _path', /_path: paramPath/.test(scannerSrc));

// ── #1 fix: the MANUAL "Scan Mapped -> Keep Curves" merge ALSO keys by _path (not the positional id) ──
ok('canvas: Keep-Curves snapshot keyed by _path/name (oldCurves[k], not oldCurves[p.envelopeId])', /oldCurves\[k\]/.test(canvasSrc) && canvasSrc.indexOf('oldCurves[p.envelopeId]') === -1);
ok('canvas: Keep-Curves restore tries _path then name', /\(p\._path && oldCurves\[p\._path\]\) \|\| oldCurves\['n:' \+ p\.name\]/.test(canvasSrc));

// ── #2 fix: session lanes (no _path) carry by NAME so a loaded session is not dropped on the first merge ──
ok('canvas: auto-merge carry has a NAME fallback for lanes without _path', /carried\['n:' \+ p\.name\]/.test(canvasSrc));
function mergeUnified(before, scanned) {
    const carried = {};
    before.forEach(p => { if ((p.points && p.points.length) || p.locked) { const k = p._path || ('n:' + p.name); carried[k] = { points: p.points && p.points.length ? p.points : null, locked: !!p.locked }; } });
    const lanes = scanned.map(p => ({ envelopeId: String(p.id), _path: p._path, name: p.name, locked: false, points: [] }));
    lanes.forEach(p => { const c = (p._path && carried[p._path]) || carried['n:' + p.name]; if (c) { if (c.points) p.points = c.points.slice(); if (c.locked) p.locked = true; } });
    return lanes;
}
const sessMerged = mergeUnified(
    [{ envelopeId: '0', name: 'Operator: Filter Freq', locked: false, points: [{ time: 0, value: 0.7 }] }],   // a session lane: no _path
    [{ id: 0, _path: 'live_set tracks 0 devices 0 parameters 4', name: 'Operator: Filter Freq' }]
);
ok('session lane (no _path) carries its curve by NAME on the first merge (not dropped)', sessMerged[0].points.length === 1 && sessMerged[0].points[0].value === 0.7);

console.log('\n' + passed + ' passed, ' + failed + ' failed');
process.exit(failed ? 1 : 0);
