/**
 * test-vst3-param-range.js
 *
 * Per-param min/max RANGE clamp: a lane's 0..1 shape is SCALED into [rangeMin,rangeMax] on host
 * output (inject + VST live-drive), displayed confined to the band (+ boundary lines, dead-zone
 * shade, % tag), and drawing inverse-maps into the band. Fully additive (no range = today).
 * Source assertions on the shared canvas.js + the wrapper shim + a behavioural scale/inverse test.
 */
'use strict';
const fs = require('fs');
const path = require('path');
let passed = 0, failed = 0;
function ok(name, cond, extra) { if (cond) passed++; else { failed++; console.log('  ✗ ' + name + (extra ? '  — ' + extra : '')); } }
console.log('test-vst3-param-range.js');

const root = path.join(__dirname, '..', '..');
const rd = (p) => fs.readFileSync(p, 'utf8');
const cv = rd(path.join(root, 'stride-vst', 'app', 'renderer', 'canvas.js'));
const shim = rd(path.join(root, 'stride-wrapper', 'm0-spike', 'ui', 'shim.js'));

// ── data model + persistence ────────────────────────────────
ok('range fields default null (rangeOn:false, min:0, max:1) at init sites', (cv.match(/rangeOn:\s*false,\s*rangeMin:\s*0,\s*rangeMax:\s*1/g) || []).length >= 1);
ok('range carried across rescan + restored', /carried\[k\]\s*=\s*\{[\s\S]{0,160}rangeOn/.test(cv) && /if\s*\(c\.rangeOn\)\s*\{\s*p\.rangeOn\s*=\s*true/.test(cv));
ok('range reset on clip switch', /p\.rangeOn\s*=\s*false;\s*p\.rangeMin\s*=\s*0;\s*p\.rangeMax\s*=\s*1/.test(cv));
ok('save stores 0..1 shape + range metadata (non-destructive)', /rangeOn:\s*!!p\.rangeOn,\s*rangeMin:\s*p\.rangeMin,\s*rangeMax:\s*p\.rangeMax/.test(cv));
ok('restore loads the range independent of lock/curve', /param\.rangeOn\s*=\s*sp\.rangeOn/.test(cv));

// ── host-bound output scale (inject + live-drive) ───────────
ok('_sdRangeApply scales 0..1 -> [min,max]', /function _sdRangeApply\(p\)[\s\S]{0,240}lo\s*\+\s*pt\.value\s*\*\s*span/.test(cv));
ok('inject output uses _sdRangeApply', /points:\s*_sdRangeApply\(p\)/.test(cv));
ok('shim scales the VST live-drive when ranged', /l\.rangeOn[\s\S]{0,180}l\.rangeMin\s*\+\s*pt\.value\s*\*\s*\(l\.rangeMax\s*-\s*l\.rangeMin\)/.test(shim));

// ── render (confine + band) ─────────────────────────────────
ok('curve confined to the band via a range-aware valueToY', /_rangeMap\s*=\s*\(v\)\s*=>\s*param\.rangeOn[\s\S]{0,140}valueToY\s*=\s*\(v\)\s*=>\s*rect\.bottom\s*-\s*_rangeMap\(v\)/.test(cv));
ok('band drawn: dead-zone shade + dashed boundary lines + % tag', /if\s*\(param\.rangeOn\)/.test(cv) && /setLineDash\(\[3, 3\]\)/.test(cv) && /Math\.round\(param\.rangeMin\s*\*\s*100\)\s*\+\s*'–'/.test(cv));
ok('range icon defined + drawn next to focus/lock', /function _drawRangeIcon/.test(cv) && /_drawRangeIcon\(sdCtx, laneDrawLeft - 54/.test(cv));

// ── interaction ─────────────────────────────────────────────
ok('range icon: single click toggles, double click resets', /p\.rangeOn\s*=\s*!p\.rangeOn/.test(cv) && /_sdRangeIconClick[\s\S]{0,180}p\.rangeOn\s*=\s*false;\s*p\.rangeMin\s*=\s*0;\s*p\.rangeMax\s*=\s*1/.test(cv));
ok('boundary drag: grab -> mousemove update -> mouseup persist', /_sdRangeDrag\s*=\s*\{\s*param:[\s\S]{0,40}edge:/.test(cv) && /if\s*\(_sdRangeDrag\)\s*\{[\s\S]{0,450}rangeMax\s*=\s*Math\.max/.test(cv) && /if\s*\(_sdRangeDrag\)\s*\{[\s\S]{0,160}_sdRangeDrag\s*=\s*null[\s\S]{0,140}saveCanvasState/.test(cv));
ok('drawing inverse-maps into the band (sdGetTimeValue)', /function _sdRangeInv/.test(cv) && /_sdRangeInv\(sdCanvasParams\[activeIdx\]/.test(cv));

// ── behavioural: scale + inverse (the math the user described) ──
(function () {
    const rangeApply = (v, on, lo, hi) => on ? Math.max(0, Math.min(1, lo + v * (hi - lo))) : v;
    const rangeInv = (v, on, lo, hi) => (on && hi > lo) ? Math.max(0, Math.min(1, (v - lo) / (hi - lo))) : v;
    ok('scale: full sine peak 1.0 -> max 0.4 (FM 0–40%)', Math.abs(rangeApply(1.0, true, 0, 0.4) - 0.4) < 1e-9);
    ok('scale: trough 0 -> min 0', rangeApply(0, true, 0, 0.4) === 0);
    ok('scale: mid 0.5 -> 0.2 (relative to 0–40%)', Math.abs(rangeApply(0.5, true, 0, 0.4) - 0.2) < 1e-9);
    ok('scale: band 0.2–0.6, shape 0.5 -> 0.4', Math.abs(rangeApply(0.5, true, 0.2, 0.6) - 0.4) < 1e-9);
    ok('range off = passthrough (additive/null-default)', rangeApply(0.73, false, 0, 0.4) === 0.73);
    ok('inverse round-trips: inv(apply(x)) === x', Math.abs(rangeInv(rangeApply(0.65, true, 0.1, 0.5), true, 0.1, 0.5) - 0.65) < 1e-9);
    ok('inverse: click the ceiling (0.4) in a 0–0.4 band -> shape 1.0', Math.abs(rangeInv(0.4, true, 0, 0.4) - 1.0) < 1e-9);
})();

// ── unmap keeps each surviving lane's OWN range (no positional-_path carry) ──
// Bug: touch-unmapping a ranged lane re-pushed the whole rack; the carry keyed lanes by the
// positional "wrap:<i>" _path, which renumbers on erase, so the removed lane's range landed
// on its neighbour. Fix: splice that ONE lane by position (like the × button), never re-push.
const proc_h = rd(path.join(root, 'stride-wrapper', 'm0-spike', 'src', 'PluginProcessor.h'));
const proc_c = rd(path.join(root, 'stride-wrapper', 'm0-spike', 'src', 'PluginProcessor.cpp'));
const ed_c   = rd(path.join(root, 'stride-wrapper', 'm0-spike', 'src', 'PluginEditor.cpp'));

ok('canvas: _sdRemoveLaneByPos splices by position (no rack re-push)', /function _sdRemoveLaneByPos\(pos, notifyEngine\)[\s\S]{0,300}sdCanvasParams\.splice\(idx, 1\)/.test(cv));
ok('canvas: × button delegates with notifyEngine=true', /window\.sdUnmapLane = function[\s\S]{0,140}_sdRemoveLaneByPos\(p\.id, true\)/.test(cv));
ok('canvas: touch-unmap handler splices by position (engine already removed -> false)', /strideLink\.on\('unmapped_at'[\s\S]{0,140}_sdRemoveLaneByPos\(msg\.position, false\)/.test(cv));
ok('native: touch-unmap records the removed position', /pendingUnmapPos\.store \(pos\)/.test(proc_c) && /consumeUnmapByTouchPos\(\)\s*\{\s*return pendingUnmapPos\.exchange \(-1\)/.test(proc_h));
ok('native: editor splices one lane when a touch-unmap is pending, else full re-push', /consumeUnmapByTouchPos\(\)[\s\S]{0,140}pushUnmappedAt \(unmappedPos\)[\s\S]{0,60}else\s+pushRackScanned\(\)/.test(ed_c));
ok('native: unmapped_at carries the position + fresh macro counts', /"unmapped_at"[\s\S]{0,120}"position", pos[\s\S]{0,200}exposed_macros/.test(ed_c));
ok('shim: macro readout also refreshes on unmapped_at', /msg\.type !== 'rack_scanned' && msg\.type !== 'unmapped_at'/.test(shim));

(function () {
    // lanes 0..3; lane 1 (the one unmapped) has range 0–0.4, lane 2 has its OWN 0.2–0.8.
    var lanes = [
        { id: 0, name: 'A', rangeOn: false, rangeMin: 0,   rangeMax: 1   },
        { id: 1, name: 'B', rangeOn: true,  rangeMin: 0,   rangeMax: 0.4 },
        { id: 2, name: 'C', rangeOn: true,  rangeMin: 0.2, rangeMax: 0.8 },
        { id: 3, name: 'D', rangeOn: false, rangeMin: 0,   rangeMax: 1   }
    ];
    var pos = 1, idx = lanes.findIndex(function (p) { return p.id === pos; });
    lanes.splice(idx, 1);
    lanes.forEach(function (p) { if (p.id > pos) p.id -= 1; });
    var A = lanes.find(function (p) { return p.name === 'A'; });
    var C = lanes.find(function (p) { return p.name === 'C'; });
    ok('unmap: removed lane B is gone', !lanes.some(function (p) { return p.name === 'B'; }));
    ok('unmap: lane C keeps ITS OWN range 0.2–0.8 (not B’s 0–0.4)', C.rangeOn && C.rangeMin === 0.2 && C.rangeMax === 0.8);
    ok('unmap: lane A below the cut is untouched (no range leaked in)', A.rangeOn === false && A.id === 0);
    ok('unmap: C re-indexed down to position 1 (lockstep with the engine)', C.id === 1);
})();

console.log('  ' + passed + ' passed, ' + failed + ' failed');
process.exit(failed ? 1 : 0);
