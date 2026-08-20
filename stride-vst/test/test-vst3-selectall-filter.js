/**
 * test-vst3-selectall-filter.js
 *
 * Covers the 2026-08-13 critical bug: with a chain device FOCUSED (device chip →
 * sdDeviceFilter), Select All selected EVERY device's lanes — so group range
 * edits (Range-for-Group, 1.1.5) modified devices that weren't even on screen.
 *
 * The fix is an invariant: selected ⊆ visible.
 *   - sdSelectAll pools from sdVisibleParams() (fill = visible unlocked only;
 *     toggle-off stays GLOBAL — deselect is the safe direction)
 *   - sdSetDeviceFilter drops selection on lanes the filter hides (closes the
 *     select-then-focus hole)
 *   - _sdRangeGroupTargets pools from sdVisibleParams() (belt-and-braces: even a
 *     stale hidden selection can't ride a group band edit)
 *   - _sdUpdateSelectionButtons lights from the visible pool
 */
'use strict';
const fs = require('fs');
const path = require('path');

let passed = 0, failed = 0;
function ok(name, cond, extra) {
    if (cond) { passed++; }
    else { failed++; console.log('  ✗ ' + name + (extra ? '  — ' + extra : '')); }
}
console.log('test-vst3-selectall-filter.js');

const canvas = fs.readFileSync(path.join(__dirname, '..', 'app', 'renderer', 'canvas.js'), 'utf8');
const desktopHtml = fs.readFileSync(path.join(__dirname, '..', 'app', 'renderer', 'index.html'), 'utf8');
const wrapperHtml = fs.readFileSync(path.join(__dirname, '..', '..', 'stride-wrapper', 'm0-spike', 'ui', 'index.html'), 'utf8');

// ─────────────────────────────────────────────────────────────
// 1. BEHAVIORAL — the scoped pools, replicated
// ─────────────────────────────────────────────────────────────
(function () {
    // Two devices, four lanes — the customer's shape (synth + Q4).
    const mkLanes = () => ([
        { envelopeId: 'a', device: 'Serum', locked: false, selected: false, rangeOn: true,  rangeMin: 0.2, rangeMax: 0.7 },
        { envelopeId: 'b', device: 'Serum', locked: false, selected: false, rangeOn: true,  rangeMin: 0.1, rangeMax: 0.9 },
        { envelopeId: 'c', device: 'Q4',    locked: false, selected: false, rangeOn: false, rangeMin: 0.0, rangeMax: 1.0 },
        { envelopeId: 'd', device: 'Q4',    locked: false, selected: false, rangeOn: false, rangeMin: 0.0, rangeMax: 1.0 },
    ]);

    // Replicas of the fixed logic (pool = visible).
    const visibleOf = (lanes, filter) => !filter ? lanes : lanes.filter(p => (p.device || '') === filter);
    function selectAll(lanes, filter) {
        const pool = visibleOf(lanes, filter);
        const unlocked = pool.filter(p => !p.locked);
        if (!unlocked.length) return;
        if (unlocked.every(p => p.selected)) lanes.forEach(p => { p.selected = false; });
        else pool.forEach(p => { if (!p.locked) p.selected = true; });
    }
    function setFilter(lanes, dev) {
        if (dev) lanes.forEach(p => { if (p.selected && (p.device || '') !== dev) p.selected = false; });
        return dev;
    }
    function groupTargets(lanes, filter, edited, activeId) {
        const pool = visibleOf(lanes, filter);
        const anySelected = pool.some(p => p && p.selected);
        if (!(edited.selected || (edited.envelopeId === activeId && anySelected))) return [edited];
        const targets = pool.filter(p => p && p.selected && (p === edited || !p.locked));
        const active = pool.find(p => p && p.envelopeId === activeId);
        if (active && !active.locked && targets.indexOf(active) < 0) targets.push(active);
        if (targets.indexOf(edited) < 0) targets.push(edited);
        return targets.length ? targets : [edited];
    }

    // The reported bug, step by step: focus Q4 → Select All → band-edit a Q4 lane.
    let lanes = mkLanes();
    const filter = 'Q4';
    selectAll(lanes, filter);
    ok('filtered Select All selects ONLY the focused device\'s lanes',
       lanes.filter(p => p.selected).map(p => p.envelopeId).join(',') === 'c,d');
    const targets = groupTargets(lanes, filter, lanes[2], 'c');
    lanes[2].rangeOn = true; lanes[2].rangeMin = 0.4; lanes[2].rangeMax = 0.6;
    for (const t of targets) { if (t !== lanes[2]) { t.rangeOn = lanes[2].rangeOn; t.rangeMin = lanes[2].rangeMin; t.rangeMax = lanes[2].rangeMax; } }
    ok('group band edit reaches both Q4 lanes',
       lanes[3].rangeOn === true && lanes[3].rangeMin === 0.4 && lanes[3].rangeMax === 0.6);
    ok('the other device\'s custom bands survive untouched',
       lanes[0].rangeMin === 0.2 && lanes[0].rangeMax === 0.7 && lanes[1].rangeMin === 0.1 && lanes[1].rangeMax === 0.9);

    // The second hole: select in all-view, THEN focus a device.
    lanes = mkLanes();
    selectAll(lanes, null);                       // all four selected
    ok('unfiltered Select All still selects everything', lanes.every(p => p.selected));
    setFilter(lanes, 'Q4');                       // focus drops the hidden selection
    ok('focusing a device drops selection on the lanes it hides',
       !lanes[0].selected && !lanes[1].selected && lanes[2].selected && lanes[3].selected);

    // Even WITHOUT the drop, a stale hidden selection can't ride the group (belt-and-braces).
    lanes = mkLanes();
    lanes.forEach(p => { p.selected = true; });   // stale: all selected, filter active
    const bb = groupTargets(lanes, 'Q4', lanes[2], 'c');
    ok('group targets never include filter-hidden lanes even if stale-selected',
       bb.every(t => t.device === 'Q4') && bb.length === 2);

    // Filtered toggle-off clears globally (deselect is the safe direction).
    lanes = mkLanes();
    lanes[0].selected = true;                     // pretend stale hidden selection
    lanes[2].selected = true; lanes[3].selected = true;
    selectAll(lanes, 'Q4');                       // pool fully selected → toggle off
    ok('filtered toggle-off deselects every lane, hidden ones included',
       lanes.every(p => !p.selected));

    // Locked lanes stay out of the fill.
    lanes = mkLanes();
    lanes[2].locked = true;
    selectAll(lanes, 'Q4');
    ok('locked lanes stay unselected in a filtered fill', !lanes[2].selected && lanes[3].selected);

    // Button lit-state: visible pool fully selected lights it even with hidden unselected.
    lanes = mkLanes();
    selectAll(lanes, 'Q4');
    const unlockedVis = visibleOf(lanes, 'Q4').filter(p => !p.locked);
    ok('button lights from the visible pool, not the whole rack',
       unlockedVis.length > 0 && unlockedVis.every(p => p.selected) && !lanes.every(p => p.selected));
})();

// ─────────────────────────────────────────────────────────────
// 2. SOURCE — the pools actually changed
// ─────────────────────────────────────────────────────────────
ok('sdSelectAll pools from sdVisibleParams()',
   /window\.sdSelectAll = function\(\) \{[\s\S]{0,600}const pool = sdVisibleParams\(\);/.test(canvas));
ok('the fill branch iterates the visible pool only',
   /pool\.forEach\(p => \{\s+if \(!p\.locked\) p\.selected = true;/.test(canvas));
ok('the toggle-off branch stays GLOBAL (deselect sweeps every lane)',
   /allSelected\) \{[\s\S]{0,300}sdCanvasParams\.forEach\(p => \{ p\.selected = false; \}\);/.test(canvas));
// Tested against VISIBILITY rather than the device name since 2026-08-20, so the invariant
// holds however focus was set - by name (desktop) or by chain slot (wrapper, duplicates).
ok('sdSetDeviceFilter drops selection on lanes the filter hides',
   /p\.selected && vis\.indexOf\(p\) < 0\) \{ p\.selected = false;/.test(canvas));
ok('the filter flip repaints the Select All button',
   /_sdUpdateSelectionButtons\(\);\s+\/\/ lit-state follows the pool/.test(canvas));
ok('_sdRangeGroupTargets pools from sdVisibleParams()',
   /function _sdRangeGroupTargets\(edited\) \{[\s\S]{0,1400}const pool = sdVisibleParams\(\);/.test(canvas));
ok('group targets + active-lane pull-in both read the visible pool',
   /const targets = pool\.filter\(p => p && p\.selected && \(p === edited \|\| !p\.locked\)\);/.test(canvas)
   && /const active = pool\.find\(p => p && p\.envelopeId === sdActiveParamId\);/.test(canvas));
ok('_sdUpdateSelectionButtons lights from the visible pool',
   /function _sdUpdateSelectionButtons\(\) \{[\s\S]{0,900}sdVisibleParams\(\)\.filter\(p => !p\.locked\);/.test(canvas));
ok('both UIs\' tooltips say what filtered Select All does',
   /focused device's lanes when one is selected/.test(desktopHtml)
   && /focused device's lanes when one is selected/.test(wrapperHtml));

console.log('  ' + passed + ' passed, ' + failed + ' failed');
process.exit(failed ? 1 : 0);
