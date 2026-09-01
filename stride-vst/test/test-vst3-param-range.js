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
ok('range carried across rescan + restored (engine payload wins when it speaks)', /carried\[k\]\s*=\s*\{[\s\S]{0,160}rangeOn/.test(cv) && /if\s*\(c\.rangeOn\s*&&\s*!p\.rangeOn\)\s*\{\s*p\.rangeOn\s*=\s*true/.test(cv));
ok('range reset on clip switch', /p\.rangeOn\s*=\s*false;\s*p\.rangeMin\s*=\s*0;\s*p\.rangeMax\s*=\s*1/.test(cv));
ok('save stores 0..1 shape + range metadata (non-destructive)', /rangeOn:\s*!!p\.rangeOn,\s*rangeMin:\s*p\.rangeMin,\s*rangeMax:\s*p\.rangeMax/.test(cv));
ok('restore loads the range independent of lock/curve', /param\.rangeOn\s*=\s*sp\.rangeOn/.test(cv));

// ── host-bound output scale (inject + live-drive) ───────────
ok('_sdRangeApply scales 0..1 -> [min,max]', /function _sdRangeApply\(p\)[\s\S]{0,240}lo\s*\+\s*pt\.value\s*\*\s*span/.test(cv));
ok('inject output uses _sdRangeApply', /points:\s*_sdRangeApply\(p\)/.test(cv));
ok('shim scales the VST live-drive when ranged', /l\.rangeOn[\s\S]{0,180}l\.rangeMin\s*\+\s*pt\.value\s*\*\s*\(l\.rangeMax\s*-\s*l\.rangeMin\)/.test(shim));

// ── render (FULL HEIGHT + band) ─────────────────────────────
// Reversed 2026-08-31 on field feedback. The curve used to be squashed into the band,
// which at the ranges people actually want (pitch 0-3%) drew a flat fuzzy line: "i no
// longer see my curves and i have no idea what shapes i have when i click Neuro". The
// shape is stored 0..1 and the band is applied on the way OUT (_sdRangeApply), so the
// lane now draws the shape at full height and the band shows where it lands.
ok('the curve draws at FULL lane height, never squashed into the band',
   /valueToY\s*=\s*\(v\)\s*=>\s*rect\.bottom\s*-\s*v\s*\*\s*rect\.height/.test(cv) && !/_rangeMap/.test(cv));
ok('band drawn: dead-zone shade + dashed boundary lines, NO on-lane % tag (readout is in the fields)', /if\s*\(param\.rangeOn\)/.test(cv) && /setLineDash\(\[3, 3\]\)/.test(cv) && !/Math\.round\(param\.rangeMin\s*\*\s*100\)\s*\+\s*'–'/.test(cv));
ok('range icon defined + drawn next to focus/lock', /function _drawRangeIcon/.test(cv) && /_drawRangeIcon\(sdCtx, laneDrawLeft - 54/.test(cv));

// ── interaction ─────────────────────────────────────────────
ok('range icon: single click toggles, double click resets', /p\.rangeOn\s*=\s*!p\.rangeOn/.test(cv) && /_sdRangeIconClick[\s\S]{0,180}p\.rangeOn\s*=\s*false;\s*p\.rangeMin\s*=\s*0;\s*p\.rangeMax\s*=\s*1/.test(cv));
ok('boundary drag: grab -> mousemove update -> mouseup persist', /_sdRangeDrag\s*=\s*\{\s*param:[\s\S]{0,40}edge:/.test(cv) && /if\s*\(_sdRangeDrag\)\s*\{[\s\S]{0,450}rangeMax\s*=\s*Math\.max/.test(cv) && /if\s*\(_sdRangeDrag\)\s*\{[\s\S]{0,260}_sdRangeDrag\s*=\s*null[\s\S]{0,320}saveCanvasState/.test(cv));   // windows widened: mouseup now also reports the band to the engine (1.1.5)
// The inverse is GONE on purpose. With a 3% band it mapped every click above the band
// floor to 1.0, so a ranged lane could not be drawn on at all: screen space and shape
// space are the same space now.
ok('a click maps 1:1 to the shape, in both views',
   !/function _sdRangeInv/.test(cv)
   && /const value = Math\.max\(0, Math\.min\(1, 1 - \(\(pos\.y - laneRect\.top\) \/ laneRect\.height\)\)\)/.test(cv)
   && /value: _sdFocusV\(pos\.y, rect\.height\)/.test(cv));   // focus reads through the inset pair
ok('the motions ghost previews at full height too, so the drop matches the promise',
   !/_rm\s*=\s*\(v\)\s*=>\s*tp\.rangeOn/.test(cv)
   && /tY = \(v\) => gr\.bottom - Math\.max\(0, Math\.min\(1, v\)\) \* gr\.height/.test(cv));

// ── behavioural: scale + inverse (the math the user described) ──
(function () {
    const rangeApply = (v, on, lo, hi) => on ? Math.max(0, Math.min(1, lo + v * (hi - lo))) : v;
    const rangeInv = (v, on, lo, hi) => (on && hi > lo) ? Math.max(0, Math.min(1, (v - lo) / (hi - lo))) : v;
    ok('scale: full sine peak 1.0 -> max 0.4 (FM 0–40%)', Math.abs(rangeApply(1.0, true, 0, 0.4) - 0.4) < 1e-9);
    ok('scale: trough 0 -> min 0', rangeApply(0, true, 0, 0.4) === 0);
    ok('scale: mid 0.5 -> 0.2 (relative to 0–40%)', Math.abs(rangeApply(0.5, true, 0, 0.4) - 0.2) < 1e-9);
    ok('scale: band 0.2–0.6, shape 0.5 -> 0.4', Math.abs(rangeApply(0.5, true, 0.2, 0.6) - 0.4) < 1e-9);
    ok('range off = passthrough (additive/null-default)', rangeApply(0.73, false, 0, 0.4) === 0.73);
    // The OUTPUT math is unchanged by the display fix, which is the point: a lane banded
    // to 0-3% still only ever moves the knob across 0-3%.
    ok('a full-height shape still lands inside a narrow band', Math.abs(rangeApply(1.0, true, 0, 0.03) - 0.03) < 1e-9);
    ok('and its trough still lands on the band floor', Math.abs(rangeApply(0, true, 0, 0.03) - 0) < 1e-9);
    // Kept as documentation of why the inverse had to go: on a 3% band it flattened
    // everything above 3% of the lane to 1.0, so drawing was impossible.
    ok('why the inverse was removed: on a 0-3% band a click at half height read as 1.0',
       Math.abs(rangeInv(0.5, true, 0, 0.03) - 1.0) < 1e-9);
})();

// ── unmap keeps each surviving lane's OWN range (no positional-_path carry) ──
// Bug: touch-unmapping a ranged lane re-pushed the whole rack; the carry keyed lanes by the
// positional "wrap:<i>" _path, which renumbers on erase, so the removed lane's range landed
// on its neighbour. Fix: splice that ONE lane by position (like the × button), never re-push.
const proc_h = rd(path.join(root, 'stride-wrapper', 'm0-spike', 'src', 'PluginProcessor.h'));
const proc_c = rd(path.join(root, 'stride-wrapper', 'm0-spike', 'src', 'PluginProcessor.cpp'));
const ed_c   = rd(path.join(root, 'stride-wrapper', 'm0-spike', 'src', 'PluginEditor.cpp'));

ok('canvas: _sdRemoveLaneByPos splices by position (no rack re-push)', /function _sdRemoveLaneByPos\(pos, notifyEngine\)[\s\S]{0,300}sdCanvasParams\.splice\(idx, 1\)/.test(cv));
ok('canvas: × button delegates with notifyEngine=true (after the StrideBridge live-lane branch)', /window\.sdUnmapLane = function[\s\S]{0,1400}_sdRemoveLaneByPos\(p\.id, true\)/.test(cv));
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

// ── numeric min/max fields: scrub (drag) + type (double-click) ──
// Stale since the 2.0.5 lane layout: the fields moved to a tall/mid/short ladder off
// rect.bottom instead of a fixed midY offset. They do render (the field screenshots
// show MIN 0% MAX 3% on the lane); the pin was pointing at the old geometry.
ok('render: min/max fields drawn under the name, placed by the lane height ladder',
   /_sdDrawRangeFields\(sdCtx, param, _tx, _big \? rect\.bottom - 19 : \(_mid \? rect\.bottom - 17 : midY \+ 5\), paramIdx\)/.test(cv)
   && /if \(param\.rangeOn\)[\s\S]{0,40}_sdDrawRangeFields/.test(cv));
ok('fields are MIN + MAX chips recorded as hit rects', /cap: 'MIN'[\s\S]{0,90}cap: 'MAX'/.test(cv) && /_sdRangeFieldRects\.push\(\{ param: param, edge: f\.edge/.test(cv));
ok('field rects reset each render', /_sdRangeFieldRects = \[\]; \/\/ rebuilt below/.test(cv));
ok('mousedown: press a field → scrub; double-click → type input', /_sdRangeFieldRects\[_fi\][\s\S]{0,600}_sdOpenRangeFieldInput\(_f\)[\s\S]{0,340}_sdRangeNumDrag = \{ param: _f\.param, edge: _f\.edge/.test(cv));
// Reworked 2026-08-31: the scrub was bound to the canvas and measured from the press
// point, so from a 3% band the ~194px run to 100% ended at the canvas edge and had to be
// repeated. Now global, accumulated, clamped as it goes, Shift for fine.
ok('mousemove: the scrub is global, accumulates and clamps',
   /window\.addEventListener\('mousemove', e => \{\s*const nd = _sdRangeNumDrag;/.test(cv)
   && /nd\.val = Math\.max\(0, Math\.min\(1, nd\.val \+ \(nd\.lastY - e\.clientY\) \/ gain\)\)/.test(cv)
   && /const gain = e\.shiftKey \? 800 : 200;/.test(cv));
ok('mouseup: scrub persists + re-drives', /_sdRangeNumDrag\) \{[\s\S]{0,140}_sdRangeNumDrag = null[\s\S]{0,140}saveCanvasState/.test(cv));
ok('cursor: a field OR a boundary line shows ns-resize (two arrows)', /let _rangeCur = false[\s\S]{0,2600}_rangeCur \? 'ns-resize'/.test(cv));
ok('type input: parse %, apply via _sdRangeSetPercent, persist', /function _sdOpenRangeFieldInput\(field\)[\s\S]{0,1300}_sdRangeSetPercent\(field\.param, field\.edge, n\)[\s\S]{0,80}saveCanvasState/.test(cv));
ok('_sdRangeSetPercent keeps a 2% floor between min and max', /function _sdRangeSetPercent\(param, edge, pct\)[\s\S]{0,240}rangeMax = Math\.max\(v, \(param\.rangeMin \|\| 0\) \+ 0\.02\)[\s\S]{0,140}rangeMin = Math\.min\(v, \(param\.rangeMax \|\| 1\) - 0\.02\)/.test(cv));

(function () {
    const setPct = (param, edge, pct) => {
        const v = Math.max(0, Math.min(1, pct / 100));
        if (edge === 'rangeMax') param.rangeMax = Math.max(v, (param.rangeMin || 0) + 0.02);
        else                     param.rangeMin = Math.min(v, (param.rangeMax || 1) - 0.02);
    };
    const p = { rangeMin: 0, rangeMax: 1 };
    setPct(p, 'rangeMax', (1.0 + (0 - 100) / 200) * 100);   // drag max down 100px -> 50%
    ok('scrub: drag max down 100px → 50%', Math.abs(p.rangeMax - 0.5) < 1e-9);
    setPct(p, 'rangeMin', 40);   // type 40 into min (max is 0.5) -> 0.4
    ok('type: set min 40% → 0.4', Math.abs(p.rangeMin - 0.4) < 1e-9);
    setPct(p, 'rangeMin', 90);   // type 90 into min, but max 0.5 -> clamp to 0.48
    ok('type: min can’t cross max (clamped to max−2%)', Math.abs(p.rangeMin - 0.48) < 1e-9);
    setPct(p, 'rangeMax', 150);  // over 100 -> 100
    ok('type: over 100% clamps to 100%', p.rangeMax === 1);
})();

console.log('  ' + passed + ' passed, ' + failed + ' failed');
process.exit(failed ? 1 : 0);
