/**
 * test-vst3-points-sort.js
 *
 * Covers the unsorted-points freeze (field report 2026-08-03, Hyby): adding or
 * dragging a point in the canvas' All-Lines view appended/moved it WITHOUT
 * re-sorting the raw array. The renderer draws from sorted COPIES so the edit
 * LOOKED right, but the raw array is what live_curves/inject/saved state carry,
 * and the engine's interp() treats the last element as "the end" — so the
 * parameter played normally up to the edited point, then froze at its value.
 * Zoom-and-back cured it because the detail paths sort in place.
 *
 * The fix, at every layer:
 *   - canvas sorts at the mutation sites (add on mousedown, commit on mouseup)
 *   - engine sorts on ingress (live_curves/apply bridge + LANES project load),
 *     so mid-drag flushes AND states saved by older builds heal on arrival
 */
'use strict';
const fs = require('fs');
const path = require('path');

let passed = 0, failed = 0;
function ok(name, cond, extra) {
    if (cond) { passed++; }
    else { failed++; console.log('  ✗ ' + name + (extra ? '  — ' + extra : '')); }
}
console.log('test-vst3-points-sort.js');

const root   = path.join(__dirname, '..', '..');
const W      = path.join(root, 'stride-wrapper', 'm0-spike');
const rd     = (p) => fs.readFileSync(p, 'utf8');
const procC  = rd(path.join(W, 'src', 'PluginProcessor.cpp'));
const procH  = rd(path.join(W, 'src', 'PluginProcessor.h'));
const editor = rd(path.join(W, 'src', 'PluginEditor.cpp'));
const canvas = rd(path.join(root, 'stride-vst', 'app', 'renderer', 'canvas.js'));

// ─────────────────────────────────────────────────────────────
// 1. BEHAVIORAL — the freeze, then the heal (replicas of interp + sortLaneByTime)
// ─────────────────────────────────────────────────────────────

// interp() mirrored from PluginProcessor.cpp — ascending-times contract included.
function interp(xs, ys, cs, x) {
    if (!xs.length) return 0;
    if (x <= xs[0]) return ys[0];
    if (x >= xs[xs.length - 1]) return ys[ys.length - 1];
    for (let i = 0; i + 1 < xs.length; i++)
        if (x >= xs[i] && x <= xs[i + 1]) {
            const d = xs[i + 1] - xs[i];
            const s = d > 0 ? (x - xs[i]) / d : 0;
            const cv = i < cs.length ? cs[i] : 0;
            if (cv === 0) return ys[i] + s * (ys[i + 1] - ys[i]);
            const cp = (ys[i] + ys[i + 1]) * 0.5 + cv * Math.abs(ys[i + 1] - ys[i]) * 1.2;
            const u = 1 - s;
            return u * u * ys[i] + 2 * u * s * cp + s * s * ys[i + 1];
        }
    return ys[ys.length - 1];
}

// sortLaneByTime mirrored: ascending fast-path, joint stable permutation of t/v/c.
function sortLane(ts, vs, cs) {
    let sorted = true;
    for (let i = 1; i < ts.length; i++) if (ts[i] < ts[i - 1]) { sorted = false; break; }
    if (sorted) return { ts, vs, cs, resorted: false };
    const idx = ts.map((_, i) => i).sort((a, b) => ts[a] - ts[b]);
    return {
        ts: idx.map(i => ts[i]),
        vs: idx.map(i => (i < vs.length ? vs[i] : 0)),
        cs: idx.map(i => (i < cs.length ? cs[i] : 0)),
        resorted: true
    };
}

(function () {
    // A drawn lane [0,4,8,16] and the user adds a point at t=6 in All-Lines view —
    // the OLD code appended it: [0,4,8,16,6].
    const xs = [0, 4, 8, 16, 6], ys = [0, 1, 0, 1, 0.5], cs = [0, 0, 0, 0, 0];

    // THE BUG: past t=6 the lane returns the appended point's value forever.
    ok('unsorted array freezes past the appended point (the reported symptom)',
       interp(xs, ys, cs, 10) === 0.5 && interp(xs, ys, cs, 15.9) === 0.5);
    ok('before the appended time it still played normally (matches the report)',
       Math.abs(interp(xs, ys, cs, 2) - 0.5) < 1e-9);

    // THE HEAL: one ingress sort restores the real curve, losing nothing.
    const h = sortLane(xs.slice(), ys.slice(), cs.slice());
    ok('heal re-orders jointly (value follows its time)',
       h.resorted && h.ts.join(',') === '0,4,6,8,16' && h.vs[2] === 0.5);
    ok('healed lane interpolates through the region that froze',
       Math.abs(interp(h.ts, h.vs, h.cs, 10) - 0.25) < 1e-9);
    ok('healed lane keeps the edited point exactly', interp(h.ts, h.vs, h.cs, 6) === 0.5);

    // Fast path: already-ascending input is untouched and unallocated.
    const s0 = sortLane([0, 1, 2], [5, 6, 7], [0, 0, 0]);
    ok('ascending input takes the zero-cost fast path', s0.resorted === false && s0.vs[0] === 5);

    // Curves ride the permutation too (a bent segment stays bent between the same points).
    const hb = sortLane([0, 8, 4], [0, 1, 0.5], [0, 0, 0.9]);
    ok('curve amounts follow their points through the sort', hb.ts.join(',') === '0,4,8' && hb.cs[1] === 0.9);
})();

// Dragging keeps its object reference across an in-place sort (the add-site fix
// sorts immediately after push while the drag holds `np`).
(function () {
    const np = { time: 2, value: 0.5 };
    const points = [{ time: 0, value: 0 }, { time: 4, value: 1 }];
    points.push(np); points.sort((a, b) => a.time - b.time);
    np.time = 3.5;   // the mousemove keeps mutating the SAME object
    ok('sort preserves the dragged point identity', points.indexOf(np) === 1 && points[1].time === 3.5);
})();

// ─────────────────────────────────────────────────────────────
// 2. CANVAS — mutation sites sort the raw array
// ─────────────────────────────────────────────────────────────
ok('add-site sorts immediately after the push (All-Lines new point)',
   /param\.points\.push\(np\); param\.points\.sort\(\(a, b\) => a\.time - b\.time\);/.test(canvas));
ok('mouseup drag-end re-sorts the edited lane BEFORE the live flush',
   /if \(sdIsDragging\) \{\s*\n\s*pushUndo\(\);[\s\S]{0,700}_mp\.points\.sort\(\(a, b\) => a\.time - b\.time\);[\s\S]{0,600}saveCanvasState/.test(canvas));

// ─────────────────────────────────────────────────────────────
// 3. ENGINE — belt at every ingress
// ─────────────────────────────────────────────────────────────
ok('sortLaneByTime declared (static, message-thread helper)',
   /static void sortLaneByTime \(std::vector<float>& ts, std::vector<float>& vs, std::vector<float>& cs\);/.test(procH));
ok('implementation: ascending fast-path + joint stable permutation',
   /void StrideWrapperProcessor::sortLaneByTime[\s\S]{0,300}bool sorted = true;[\s\S]{0,500}std::stable_sort/.test(procC));
ok('live_curves/apply ingress sorts each lane before it can drive',
   /StrideWrapperProcessor::sortLaneByTime \(lane\.times, lane\.values, lane\.curves\);[\s\S]{0,200}if \(! lane\.times\.empty\(\)\)/.test(editor));
ok('project-load (LANES) heals states saved unsorted by older builds',
   /strToFloats \(e->getStringAttribute \("c"\), l\.curves\);\s*\n\s*sortLaneByTime \(l\.times, l\.values, l\.curves\);/.test(procC));
ok('interp keeps its ascending contract (last element = the end)',
   /if \(x >= xs\.back\(\)\)  return ys\.back\(\);/.test(procC));

console.log('  ' + passed + ' passed, ' + failed + ' failed');
process.exit(failed ? 1 : 0);
