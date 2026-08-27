/**
 * test-context-freshness.js
 *
 * Regression guard for the "inject on a newly-selected track does nothing / scans
 * choke" bug (found + fixed 2026-06-24).
 *
 * ROOT CAUSE: context-freshness (_sdContextDirty) was only ever set by the
 * track_changed / clip_focus_changed WS handlers, which require the canvas to be
 * OPEN. In the normal device-driven flow the canvas is CLOSED when you switch to a
 * new track, so those events are dropped (server sendToApp has no client). On
 * relaunch the canvas restores the PREVIOUS track's lanes with _sdContextDirty=false.
 * Inject's gate (rescan-first ONLY when dirty) then skipped the rescan and wrote the
 * old track's _paths into the new clip → StrideInject finds no envelopes → "nothing
 * to inject". Switching tracks with the canvas open (or focusing it) finally fired
 * the observers/scan and "unstuck" it — the exact workaround the user reported.
 *
 * FIX (pure-canvas — NO StrideQuick / server.js / scanner / .amxd change):
 *   1. The `connected` handler sets _sdContextDirty = true. Across any (re)connect the
 *      canvas can't trust restored paths until a scan lands, so the first inject
 *      rescans-then-writes. rack_scanned clears it → a later inject on the SAME context
 *      writes directly with no extra scan, so the normal Motion→Inject flow is ONE scan
 *      (Motion already refreshed it). Matches the user's "inject doesn't need its own
 *      scan if Motion already scanned".
 *   2. _sdAutoScan coalesces stacked scans (_sdScanPending) so the launch pile-up
 *      (connect boot-scan + window-focus scan + Motion/inject rescan) can't flood
 *      Ableton's single-threaded scanner — the "scans 2-3 times then freezes" report.
 *
 * If this fails, someone removed the connect-time staleness guard or the scan-coalesce
 * guard — the closed-canvas track-switch inject will silently miss again, and/or the
 * launch scan pile-up will return.
 */
'use strict';
const fs = require('fs');
const path = require('path');
let passed = 0, failed = 0;
function ok(name, cond, extra) { if (cond) passed++; else { failed++; console.log('  ✗ ' + name + (extra ? '  -- ' + extra : '')); } }
console.log('test-context-freshness.js');

const canvasSrc = fs.readFileSync(path.join(__dirname, '..', 'app', 'renderer', 'canvas.js'), 'utf8');

// ── SOURCE: fix #1 — connect-time staleness guard ──
ok('canvas: connected handler marks context dirty on (re)connect',
   /\(Re\)connect safety[\s\S]{0,900}_sdContextDirty = true;/.test(canvasSrc));
ok('canvas: inject rescans-first ONLY when _sdContextDirty (no always-scan freeze)',
   /action === 'inject' && _sdContextDirty/.test(canvasSrc));
ok('canvas: rack_scanned clears _sdContextDirty (landed scan = proven fresh → next inject is direct)',
   /on\('rack_scanned'[\s\S]{0,300}_sdContextDirty = false/.test(canvasSrc));

// ── SOURCE: fix #2 — scan coalesce ──
ok('canvas: _sdScanPending flag declared', /let _sdScanPending = false;/.test(canvasSrc));
ok('canvas: _sdAutoScan coalesces while a scan is in flight (2.5s self-heal bound)',
   /_sdScanPending && \(Date\.now\(\) - _sdLastAutoScanAt\) < 2500\) return;/.test(canvasSrc));
ok('canvas: _sdAutoScan marks a scan pending before sending', /_sdScanPending = true;/.test(canvasSrc));
ok('canvas: rack_scanned releases the coalesce guard', /on\('rack_scanned'[\s\S]{0,300}_sdScanPending = false/.test(canvasSrc));

// ── BEHAVIORAL: the inject/generator rescan gate (mirrors canvas.js sdHandleQuickCommand) ──
const GENERATORS = ['chaos','neuro','reflector','sh','prism'];
function rescanFirst(action, sdAutoRescan, dirty) {
    return (GENERATORS.indexOf(action) !== -1 && (sdAutoRescan || dirty)) || (action === 'inject' && dirty);
}
ok('gate: inject + dirty=false → no rescan (the pre-fix hazard the connect-guard removes)', rescanFirst('inject', true, false) === false);
ok('gate: inject + dirty=true (connect guard) → rescans first', rescanFirst('inject', true, true) === true);
ok('gate: generator + green → always rescan (unchanged by this fix)', rescanFirst('chaos', true, false) === true);
ok('gate: generator + grey + dirty → rescan (stale-rack guard, unchanged)', rescanFirst('chaos', false, true) === true);
ok('gate: generator + grey + clean → no rescan (crank the same rack, unchanged)', rescanFirst('chaos', false, false) === false);

// ── BEHAVIORAL: relaunch → first inject → scan → second inject. Exactly ONE scan, then direct. ──
function simulate() {
    let dirty, pending, scans = 0;
    const autoScan = () => { if (pending) return; pending = true; scans++; };   // coalesce: in-flight scan absorbs the duplicate
    const scanLands = () => { pending = false; dirty = false; };                // rack_scanned
    // relaunch (connect): context marked stale
    dirty = true; pending = false;
    // boot scan fires, and an inject arrives before it lands
    autoScan();                                              // connect boot-scan
    const injectRescans1 = rescanFirst('inject', true, dirty);   // dirty=true → rescans
    if (injectRescans1) autoScan();                          // coalesced into the in-flight scan
    scanLands();                                             // the single scan lands → queued inject applies on FRESH lanes
    // a SECOND inject, same context, scan already landed
    const injectRescans2 = rescanFirst('inject', true, dirty);   // dirty=false now
    if (injectRescans2) autoScan();
    return { scans, injectRescans1, injectRescans2 };
}
const sim = simulate();
ok('sequence: relaunch + inject triggers exactly ONE scan (coalesced, no pile-up freeze)', sim.scans === 1, 'scans=' + sim.scans);
ok('sequence: that first inject rescans-first so it writes the CURRENT track’s paths', sim.injectRescans1 === true);
ok('sequence: a second inject (scan already landed) writes directly — no extra scan', sim.injectRescans2 === false && sim.scans === 1);

// ── SOURCE: fix #3 — clear stale lanes when a context switch lands on an EMPTY rack ──
// The connect/track/clip dirty-guard made the first inject RESCAN, but an empty scan (a
// fresh rack with no mapped params) hit the "don't wipe" guard and KEPT the previous
// rack's lanes anyway → they showed as "moving N / total M" and got injected into the new
// clip (the fresh-Operator stale-cache bug, 2026-06-25). Fix: capture the dirty flag
// before rack_scanned clears it, and on an empty scan that followed a real context switch,
// clear the lanes. A transient empty on the SAME rack (not dirty) still keeps them.
ok('canvas: rack_scanned captures _wasContextDirty before clearing the flag',
   /const _wasContextDirty = _sdContextDirty;[\s\S]{0,160}_sdContextDirty = false;/.test(canvasSrc));
ok('canvas: empty scan after a context switch CLEARS the stale lanes (StrideBridge live lanes exempt by design)',
   /if \(params\.length === 0\)[\s\S]{0,1000}if \(_wasContextDirty && sdCanvasParams\.length > 0\) \{[\s\S]{0,240}sdCanvasParams = sdCanvasParams\.filter\(p => p\._live\);/.test(canvasSrc));
ok('canvas: the clear is GATED by _wasContextDirty (transient same-rack empty keeps lanes)',
   /_wasContextDirty && sdCanvasParams\.length > 0/.test(canvasSrc));

// ── BEHAVIORAL: the empty-rack clear decision ──
function emptyScanClears(wasDirty, loadedCount) { return !!wasDirty && loadedCount > 0; }
ok('empty-clear: dirty switch onto an empty rack WITH stale lanes → clear', emptyScanClears(true, 4) === true);
ok('empty-clear: transient empty on the SAME rack (not dirty) → keep lanes', emptyScanClears(false, 4) === false);
ok('empty-clear: dirty but nothing loaded → no-op', emptyScanClears(true, 0) === false);

// ── SEQUENCE: open a NEW project on a fresh Operator (no mapped params) → no stale inject ──
function freshDeviceLoad() {
    let lanes = 4;            // stale lanes lingering in memory from the previous rack/project
    let dirty = true;         // the connected handler marks every (re)connect stale
    const wasDirty = dirty; dirty = false;   // rack_scanned captures, then clears
    const params = [];        // fresh Operator → scan returns 0 mapped params
    if (params.length === 0 && wasDirty && lanes > 0) lanes = 0;   // the fix clears the stale lanes
    return lanes;
}
ok('sequence: fresh device load + 0 mapped params clears stale lanes (nothing to inject)', freshDeviceLoad() === 0);

console.log('\n' + passed + ' passed, ' + failed + ' failed');
process.exit(failed ? 1 : 0);
