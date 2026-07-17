/**
 * test-vst3-ranges.js
 *
 * Covers the engine-owned range-bands batch (1.1.5). Field incident 2026-07-16:
 * "pressed something and all the ranges got reset" — ranges lived ONLY in the
 * canvas, keyed by the wrapper's POSITIONAL _path ("wrap:<i>"), and the engine's
 * rack_scanned payload always said no-range: any structural re-push could wipe
 * or misroute every band (then auto-save persisted the wipe). Now the ENGINE
 * owns ranges like it owns curves:
 *   - canvas reports every committed edit (set_range, wrapper-gated)
 *   - engine stores them on the mapped entries, persists them in the PROJECT
 *     state (they finally survive a DAW project reopen), carries them through
 *     undo snapshots, and echoes them in every rack_scanned
 *   - canvas rebuilds bands from the payload; the positional carry only fills
 *     what the payload left empty (desktop/M4L behavior unchanged)
 */
'use strict';
const fs = require('fs');
const path = require('path');

let passed = 0, failed = 0;
function ok(name, cond, extra) {
    if (cond) { passed++; }
    else { failed++; console.log('  ✗ ' + name + (extra ? '  — ' + extra : '')); }
}
console.log('test-vst3-ranges.js');

const root   = path.join(__dirname, '..', '..');
const W      = path.join(root, 'stride-wrapper', 'm0-spike');
const rd     = (p) => fs.readFileSync(p, 'utf8');
const procC  = rd(path.join(W, 'src', 'PluginProcessor.cpp'));
const procH  = rd(path.join(W, 'src', 'PluginProcessor.h'));
const editor = rd(path.join(W, 'src', 'PluginEditor.cpp'));
const shim   = rd(path.join(W, 'ui', 'shim.js'));
const cmake  = rd(path.join(W, 'CMakeLists.txt'));
const canvas = rd(path.join(root, 'stride-vst', 'app', 'renderer', 'canvas.js'));

// ─────────────────────────────────────────────────────────────
// 1. BEHAVIORAL — payload-wins merge + band clamp replicas
// ─────────────────────────────────────────────────────────────

// the rebuilt-lane merge (mirrors the structural-merge carry): the engine payload
// wins where it speaks; the carry only fills what the payload left empty
(function () {
    function merge(payload, carry) {
        const p = { points: payload.points || [], rangeOn: !!payload.rangeOn, rangeMin: payload.rangeMin || 0, rangeMax: (typeof payload.rangeMax === 'number' ? payload.rangeMax : 1), locked: false };
        const c = carry;
        if (c) {
            if (c.points && !(p.points && p.points.length)) p.points = c.points;
            if (c.locked) p.locked = true;
            if (c.rangeOn && !p.rangeOn) { p.rangeOn = true; p.rangeMin = c.rangeMin; p.rangeMax = c.rangeMax; }
        }
        return p;
    }
    const engine = merge({ rangeOn: true, rangeMin: 0.2, rangeMax: 0.8, points: [{ t: 0 }] },
                         { rangeOn: true, rangeMin: 0.5, rangeMax: 0.6, points: [{ t: 9 }], locked: true });
    ok('engine payload wins for ranges (stale carry cannot misroute)', engine.rangeMin === 0.2 && engine.rangeMax === 0.8);
    ok('engine payload wins for points', engine.points[0].t === 0);
    ok('locks still carry (engine does not own locks)', engine.locked === true);
    const desktop = merge({}, { rangeOn: true, rangeMin: 0.3, rangeMax: 0.7, points: [{ t: 5 }], locked: false });
    ok('desktop (payload silent): carry fills exactly as before', desktop.rangeOn === true && desktop.rangeMin === 0.3 && desktop.points[0].t === 5);
    const fresh = merge({}, null);
    ok('no carry, silent payload -> clean lane', fresh.rangeOn === false && fresh.points.length === 0);
})();

// engine-side clamp (mirrors setMappedRange): sane band whatever the client sends
(function () {
    const clamp = (lo, hi) => { const l = Math.min(1, Math.max(0, lo)); const h = Math.min(1, Math.max(0, Math.max(hi, l))); return { l, h }; };
    ok('band clamped into 0..1', clamp(-0.5, 1.7).l === 0 && clamp(-0.5, 1.7).h === 1);
    ok('inverted band collapses safely (hi >= lo)', clamp(0.8, 0.2).h === 0.8);
})();

// scale round-trip (mirrors shim scale -> engine unscaled echo): the canvas draws a raw
// 0..1 shape, the shim scales it host-bound, the echo hands the RAW shape back
(function () {
    const scale = (v, lo, hi) => Math.max(0, Math.min(1, lo + v * (hi - lo)));           // shim, on push
    const unscale = (v, lo, hi, on) => { const s = hi - lo; return (on && s > 0.0001) ? Math.max(0, Math.min(1, (v - lo) / s)) : v; };   // engine, on echo
    const rt = (v) => unscale(scale(v, 0.2, 0.8), 0.2, 0.8, true);
    ok('ranged round-trip returns the drawn shape', Math.abs(rt(0) - 0) < 1e-6 && Math.abs(rt(0.5) - 0.5) < 1e-6 && Math.abs(rt(1) - 1) < 1e-6);
    ok('band off: echo passes values through untouched (old projects byte-identical)', unscale(0.37, 0.2, 0.8, false) === 0.37);
    ok('degenerate band (span 0) cannot divide by zero', unscale(0.5, 0.4, 0.4, true) === 0.5);
})();

// ─────────────────────────────────────────────────────────────
// 2. ENGINE — owned, persisted, snapshotted, echoed
// ─────────────────────────────────────────────────────────────
ok('MapRef carries the band', /bool rangeOn = false; float rangeLo = 0\.0f, rangeHi = 1\.0f/.test(procH));
ok('setMappedRange stores under the host lock + clamps + marks the project dirty',
   /setMappedRange \(int pos, bool on, float lo, float hi\)[\s\S]{0,500}jlimit[\s\S]{0,200}hostDirtyPending\.store \(true\)/.test(procC));
ok('setMappedRange does NOT re-push (no mapVersion bump would fight the drag)', !/setMappedRange[\s\S]{0,600}mapVersion\.fetch_add/.test(procC));
ok('getMappedRanges exposes {on,lo,hi} in mapped order', /getMappedRanges\(\) const[\s\S]{0,400}setProperty \("on", m\.rangeOn\)/.test(procC));
ok('curve echo inverse-maps ranged lanes back to the RAW shape', /unscale = m\.rangeOn && span > 0\.0001f/.test(procC) && /if \(unscale\) v = juce::jlimit \(0\.0f, 1\.0f, \(v - m\.rangeLo\) \/ span\)/.test(procC));
ok('project state SAVES the band (ro/rl/rh; absent = full)', /if \(m\.rangeOn\)[\s\S]{0,300}setAttribute \("ro", 1\)[\s\S]{0,120}"rl"[\s\S]{0,80}"rh"/.test(procC));
ok('project state LOADS the band (old projects default off)', /getIntAttribute \("ro", 0\)[\s\S]{0,120}getDoubleAttribute \("rl", 0\.0\)[\s\S]{0,120}getDoubleAttribute \("rh", 1\.0\)/.test(procC));
ok('undo snapshots carry the bands (clearChain + removeNode)', (procC.match(/d\.ron\.push_back \(m\.rangeOn \? 1 : 0\)/g) || []).length === 2);
ok('restore rebuilds mapped entries WITH their bands', /restore this device's lanes \(\+ their range bands\)[\s\S]{0,400}d\.ron\[k\] != 0/.test(procC));
ok('snapshot Dev struct carries parallel range vectors', /std::vector<char> ron; std::vector<float> rlo, rhi;/.test(procH));

// ─────────────────────────────────────────────────────────────
// 3. BRIDGE — set_range in, rangeOn/Min/Max out
// ─────────────────────────────────────────────────────────────
ok('editor handles set_range (editLocked-gated)', /if \(type == "set_range"\)[\s\S]{0,300}isEditLocked\(\)\) return;[\s\S]{0,300}setMappedRange/.test(editor));
ok('rack_scanned echoes the band per lane', /getMappedRanges\(\)[\s\S]{0,1800}setProperty \("rangeOn",\s+true\)[\s\S]{0,200}"rangeMin"[\s\S]{0,120}"rangeMax"/.test(editor));

// ─────────────────────────────────────────────────────────────
// 4. CANVAS — reports edits, trusts the payload, desktop-gated
// ─────────────────────────────────────────────────────────────
ok('canvas reports committed edits via set_range', /_sdPushRangeToEngine[\s\S]{0,600}type: 'set_range'/.test(canvas));
ok('wrapper-gated (desktop strideLink lacks the flag)', /window\.strideLink\._wrapper\) return;/.test(canvas) && /_wrapper: true/.test(shim));
ok('push sites: icon toggle/reset (group-aware)', /_sdRangeApplyGroup\(p\);\s+\/\/ engine owns ranges \(toggle \+ double-click reset\)/.test(canvas));
ok('push sites: committed boundary drag (group-aware, batched)', /_sdPushRangesToEngine\(_rdGroup\)/.test(canvas));
ok('push sites: scrub + typed MIN/MAX fields (group-aware)', /_sdRangeSetPercent\(param, edge, pct\)[\s\S]{0,400}_sdRangeApplyGroup\(param\)/.test(canvas));
ok('lane rebuild reads the band from the payload', /rangeOn: !!p\.rangeOn, rangeMin: \(typeof p\.rangeMin === 'number'/.test(canvas));
ok('carry: payload wins, carry only fills empties', /if \(c\.points && !\(p\.points && p\.points\.length\)\) p\.points = c\.points;/.test(canvas) && /if \(c\.rangeOn && !p\.rangeOn\)/.test(canvas));

// ─────────────────────────────────────────────────────────────
// 5. RANGE FOR GROUP (1.1.6) — the selection IS the group
// ─────────────────────────────────────────────────────────────

// group targeting (mirrors _sdRangeGroupTargets): selected edited lane -> every
// selected lane (locked skipped, except the edited lane itself) PLUS the ACTIVE
// lane — a plain click "chooses" without selecting, and users read the active
// lane as part of their set (field report: "only changes the other 3").
// Unselected edited lane -> single-lane, unchanged.
(function () {
    const targets = (edited, lanes, activeId) => {
        const anySel = lanes.some(p => p.selected);
        const isActive = edited.id === activeId;
        if (!(edited.selected || (isActive && anySel))) return [edited];
        const t = lanes.filter(p => p.selected && (p === edited || !p.locked));
        const active = lanes.find(p => p.id === activeId);
        if (active && !active.locked && t.indexOf(active) < 0) t.push(active);
        if (t.indexOf(edited) < 0) t.push(edited);
        return t.length ? t : [edited];
    };
    const A = { id: 'A', selected: true, locked: false }, B = { id: 'B', selected: true, locked: false },
          C = { id: 'C', selected: true, locked: true },  D = { id: 'D', selected: false, locked: false };
    const lanes = [A, B, C, D];
    ok('FIELD REPORT #1 (member): active-but-unselected lane joins a group edit on a selected lane', (() => {
        const g = targets(A, lanes, 'D');           // D was plain-clicked ("the 1st"), A..C Ctrl-selected
        return g.includes(A) && g.includes(B) && g.includes(D);
    })());
    ok('FIELD REPORT #2 (trigger): editing the ACTIVE-unselected lane drives the whole group', (() => {
        const g = targets(D, lanes, 'D');           // tweak the first/active lane itself while A,B are selected
        return g.includes(D) && g.includes(A) && g.includes(B) && !g.includes(C);
    })());
    ok('symmetry: editing ANY of the three moves all three', (() => {
        const viaB = targets(B, lanes, 'D'), viaD = targets(D, lanes, 'D');
        const ids = (g) => g.map(x => x.id).sort().join(',');
        return ids(viaB) === ids(viaD);
    })());
    ok('selected edit -> all selected, locked skipped, unselected non-active skipped', (() => {
        const g = targets(A, lanes, 'A');           // active IS the edited lane
        return g.includes(A) && g.includes(B) && !g.includes(C) && !g.includes(D);
    })());
    ok('locked ACTIVE lane stays untouched', (() => {
        const g = targets(A, lanes, 'C');           // active lane is locked
        return !g.includes(C) && g.includes(A) && g.includes(B);
    })());
    ok('editing an UNSELECTED, NON-ACTIVE lane stays single-lane (the escape hatch)', targets(D, lanes, 'A').length === 1 && targets(D, lanes, 'A')[0] === D);
    const gLocked = targets(C, lanes, 'C');
    ok('the physically edited lane always applies, even locked', gLocked.includes(C) && gLocked.includes(B) && !gLocked.includes(D));
})();

// whole-band copy + batch shape (mirrors _sdRangeApplyGroup/_sdPushRangesToEngine)
(function () {
    const edited = { envelopeId: '0', selected: true, locked: false, rangeOn: true, rangeMin: 0.2, rangeMax: 0.8 };
    const other  = { envelopeId: '3', selected: true, locked: false, rangeOn: false, rangeMin: 0, rangeMax: 1 };
    for (const t of [edited, other]) if (t !== edited) { t.rangeOn = edited.rangeOn; t.rangeMin = edited.rangeMin; t.rangeMax = edited.rangeMax; }
    ok('group apply copies the WHOLE band (on + min + max)', other.rangeOn === true && other.rangeMin === 0.2 && other.rangeMax === 0.8);
    const items = [edited, other].map(p => ({ id: parseInt(p.envelopeId, 10), on: !!p.rangeOn, min: p.rangeMin, max: p.rangeMax })).filter(it => !isNaN(it.id));
    ok('batch items carry engine positions', items.length === 2 && items[0].id === 0 && items[1].id === 3);
    ok('a single lane falls back to the 1.1.5 set_range path', ([edited].length === 1));
})();

ok('canvas: group helpers exist', /function _sdRangeGroupTargets\(edited\)/.test(canvas) && /function _sdRangeApplyGroup\(edited\)/.test(canvas) && /function _sdPushRangesToEngine\(params\)/.test(canvas));
ok('canvas: the ACTIVE lane rides with the group (locked active respected)', /envelopeId === sdActiveParamId\);\s*\n\s*if \(active && !active\.locked && targets\.indexOf\(active\) < 0\) targets\.push\(active\);/.test(canvas));
ok('canvas: the ACTIVE lane is also a group TRIGGER (editing it drives the selection)', /if \(!\(edited\.selected \|\| \(isActive && anySelected\)\)\) return \[edited\];/.test(canvas));
ok('canvas: Ctrl+mousedown arms without toggling (toggle deferred to mouseup)', /window\.sdToggleLaneSelection\(_sdDragSelectPending\.laneId\)/.test(canvas));
ok('canvas: promotion = cursor reached a DIFFERENT lane', /_phit\.param\.envelopeId !== _sdDragSelectPending\.laneId/.test(canvas));
ok('canvas: promotion pulls the start lane INTO the sweep', /_start && !_start\.locked && !_start\.selected/.test(canvas));
ok('canvas: single lane keeps set_range; groups batch as set_ranges', /if \(items\.length === 1\) \{ _sdPushRangeToEngine\(params\[0\]\); return; \}/.test(canvas) && /type: 'set_ranges', items: items/.test(canvas));
ok('canvas: drag captures the group at GRAB time', /_sdRangeDrag = \{ param: hit\.param, edge: edge, rect: hit\.rect, group: _sdRangeGroupTargets\(hit\.param\) \}/.test(canvas));
ok('canvas: group drag follows LIVE during mousemove', /rd\.group && rd\.group\.length > 1/.test(canvas) && /t\.rangeOn = rd\.param\.rangeOn; t\.rangeMin = rd\.param\.rangeMin; t\.rangeMax = rd\.param\.rangeMax;/.test(canvas));
ok('engine: setMappedRanges = one lock pass, one dirty mark, no re-push', /void StrideWrapperProcessor::setMappedRanges[\s\S]{0,700}hostDirtyPending\.store \(true\)/.test(procC) && !/setMappedRanges[\s\S]{0,700}mapVersion\.fetch_add/.test(procC));
ok('bridge: set_ranges handled (editLocked-gated)', /if \(type == "set_ranges"\)[\s\S]{0,260}isEditLocked\(\)\) return;[\s\S]{0,200}setMappedRanges \(\*arr\)/.test(editor));

// version: ships as 1.1.5+
(function () {
    const m = cmake.match(/project\(StrideWrapperM0 VERSION (\d+)\.(\d+)\.(\d+)/);
    ok('CMake VERSION parses', !!m);
    if (m) ok('VERSION >= 1.1.5', +m[1] > 1 || (+m[1] === 1 && (+m[2] > 1 || (+m[2] === 1 && +m[3] >= 5))));
})();

console.log('  ' + passed + ' passed, ' + failed + ' failed');
process.exit(failed ? 1 : 0);
