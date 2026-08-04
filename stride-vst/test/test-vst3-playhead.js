/**
 * test-vst3-playhead.js
 *
 * Covers the engine-synced playhead batch (1.1.2) on the Stride wrapper:
 *   - the lane "comet" no longer free-runs on wall clock in the wrapper — the
 *     engine publishes the TRUE loop phase (0..1) + transport state every block,
 *     the editor forwards it change-detected (≤30Hz), and canvas.js repaints
 *     ONLY when the head actually moved (no RAF loop; zero paints when stopped;
 *     the head PARKS at the real DAW position, trail only in motion)
 *   - desktop/M4L untouched: the ambient drift only retires after the FIRST
 *     engine tick, which only the wrapper ever sends
 *
 * Two layers (C++/canvas.js are not loaded in Node):
 *   1. Behavioral — replicate the pure logic (head positioning walk, the two
 *      change-detect gates, ambient-retire, coalescing) and assert it.
 *   2. Source assertions — read the REAL files and assert the wiring.
 */
'use strict';
const fs = require('fs');
const path = require('path');

let passed = 0, failed = 0;
function ok(name, cond, extra) {
    if (cond) { passed++; }
    else { failed++; console.log('  ✗ ' + name + (extra ? '  — ' + extra : '')); }
}
console.log('test-vst3-playhead.js');

const root   = path.join(__dirname, '..', '..');
const W      = path.join(root, 'stride-wrapper', 'm0-spike');
const rd     = (p) => fs.readFileSync(p, 'utf8');
const procC  = rd(path.join(W, 'src', 'PluginProcessor.cpp'));
const procH  = rd(path.join(W, 'src', 'PluginProcessor.h'));
const editor = rd(path.join(W, 'src', 'PluginEditor.cpp'));
const edH    = rd(path.join(W, 'src', 'PluginEditor.h'));
const shim   = rd(path.join(W, 'ui', 'shim.js'));
const cmake  = rd(path.join(W, 'CMakeLists.txt'));
const canvas = rd(path.join(root, 'stride-vst', 'app', 'renderer', 'canvas.js'));

// ─────────────────────────────────────────────────────────────
// 1. BEHAVIORAL — pure-logic replicas
// ─────────────────────────────────────────────────────────────

// head positioning (mirrors _sdFxDraw): tx by phase across the poly's x-span,
// walk to the segment containing tx
(function () {
    const poly = [{ x: 10 }, { x: 20 }, { x: 40 }, { x: 80 }, { x: 110 }];
    const headIdx = (phase) => {
        const n = poly.length;
        const tx = poly[0].x + phase * (poly[n - 1].x - poly[0].x);
        let idx = 0; while (idx < n - 1 && poly[idx + 1].x <= tx) idx++;
        return Math.min(idx, n - 1);
    };
    ok('phase 0 -> first point', headIdx(0) === 0);
    ok('phase 1 -> last point', headIdx(1) === poly.length - 1);
    ok('phase 0.5 (tx=60) lands in the 40..80 segment', headIdx(0.5) === 2);
    ok('phase just past a vertex advances', headIdx(0.11) === 1);   // tx=21 -> past x=20
})();

// editor send gate (mirrors the timerCallback block): send on on-flip, or while
// playing when the phase moved; a stopped transport sends ONE parking event
(function () {
    let lastOn = false, lastPh = -1, sent = [];
    const tick = (on, ph) => {
        if (on !== lastOn || (on && Math.abs(ph - lastPh) > 0.0005)) { lastOn = on; lastPh = ph; sent.push({ on, ph }); }
    };
    tick(false, 0.2); tick(false, 0.2); tick(false, 0.2);
    ok('stopped + never played: nothing sent', sent.length === 0);
    tick(true, 0.21);
    ok('play starts: sends (on-flip)', sent.length === 1 && sent[0].on === true);
    tick(true, 0.22); tick(true, 0.2201); tick(true, 0.23);
    ok('while playing: sends only real moves (0.0001 skipped)', sent.length === 3);
    tick(false, 0.24);
    ok('stop: exactly ONE parking event', sent.length === 4 && sent[3].on === false);
    tick(false, 0.24); tick(false, 0.24);
    ok('stopped: silent afterwards (zero bridge traffic)', sent.length === 4);
})();

// canvas repaint gate (mirrors sdSetEnginePlayhead): paint on on-flip or a
// >0.0015 phase move; sub-pixel crawls coalesce into fewer paints
(function () {
    let drawnPh = -1, drawnOn = null, paints = 0;
    const setPh = (ph, on) => {
        if (on !== drawnOn || Math.abs(ph - drawnPh) > 0.0015) { drawnPh = ph; drawnOn = on; paints++; }
    };
    setPh(0.1, true);
    ok('first tick paints', paints === 1);
    // a 64-bar loop at 30Hz moves ~0.00026/tick — most ticks skip
    let ph = 0.1;
    for (let i = 0; i < 30; i++) { ph += 0.00026; setPh(ph, true); }
    ok('long-loop crawl: 30 ticks coalesce into a few paints', paints >= 5 && paints <= 8, 'paints=' + paints);
    const before = paints;
    setPh(ph, false);
    ok('stop repaints once (parks the head, drops the trail)', paints === before + 1);
    setPh(ph, false);
    ok('parked: no further paints', paints === before + 1);
})();

// ambient-retire: the first engine tick kills the wall-clock loop; focus events
// can never resurrect it (sdStartFx no-ops in engine mode)
(function () {
    let engMode = false, rafAlive = true;
    const stopFx = () => { rafAlive = false; };
    const startFx = () => { if (engMode || rafAlive) return; rafAlive = true; };
    const engineTick = () => { if (!engMode) { engMode = true; stopFx(); } };
    engineTick();
    ok('first engine tick retires the ambient loop', rafAlive === false);
    startFx();   // window focus
    ok('focus cannot resurrect the drift in engine mode', rafAlive === false);
})();

// ─────────────────────────────────────────────────────────────
// 2. SOURCE — the wiring exists and stays consistent
// ─────────────────────────────────────────────────────────────

// processor: phase + transport published EVERY block, not just while driving
ok('processor publishes the phase unconditionally (outside the drive branch)', /Publish the TRUE loop position[\s\S]{0,700}lastModValue\.store[\s\S]{0,300}transportActive\.store \(transportPlaying\)/.test(procC));
ok('drive branch no longer owns the phase store', !/driveLanes\.empty\(\)\)[\s\S]{0,700}lastModValue\.store/.test(procC));
ok('transportActive member declared (atomic, playhead on/off)', /std::atomic<bool>\s+transportActive \{ false \}/.test(procH));

// editor: change-detected push, Live-mode + hosted-chain gated
ok('editor pushes "playhead" events', /"playhead"/.test(editor) && /setProperty \("p",/.test(editor) && /setProperty \("on",/.test(editor));
ok('push is change-detected (on-flip OR real move)', /on != lastPhOn \|\| \(on && std::abs \(ph - lastPhSent\) > 0\.0005f\)/.test(editor));
ok('playhead only in Live mode (Automation would lie)', /transportActive\.load\(\)[\s\S]{0,200}DriveMode::Live/.test(editor));
ok('editor members for the gate', /lastPhSent = -1\.0f/.test(edH) && /lastPhOn = false/.test(edH));

// shim: engine event -> canvas hook
ok('shim forwards playhead to canvas.js (with raw beats + the notes-free flag)', /listen\('playhead'/.test(shim) && /sdSetEnginePlayhead\(\(d && d\.p\) \|\| 0, !!\(d && d\.on\), \(d && d\.b\) \|\| 0, !!\(d && d\.free\)\)/.test(shim));

// canvas.js: shared drawer + engine mode + retire + geometry kick
ok('canvas: shared _sdFxDraw(phase, withTrail) drawer', /function _sdFxDraw\(phase, withTrail\)/.test(canvas));
ok('canvas: ambient loop is a thin wrapper over the shared drawer', /function _sdFxFrame\(ts\)[\s\S]{0,200}_sdFxDraw\(\(ts % SD_FX_LOOP\) \/ SD_FX_LOOP, true\)/.test(canvas));
ok('canvas: trail only in motion (parked head draws without trail)', /if \(withTrail\) for \(let k = 0; k < SD_FX_TRAIL/.test(canvas));
ok('canvas: sdSetEnginePlayhead exposed for the wrapper', /window\.sdSetEnginePlayhead = function \(phase, on, beats, free\)/.test(canvas));
ok('canvas: first engine tick retires the ambient drift', /if \(!_sdEngMode\) \{ _sdEngMode = true; sdStopFx\(\); \}/.test(canvas));
ok('canvas: sdStartFx inert in engine mode (focus can\'t resurrect the drift)', /function sdStartFx\(\) \{ if \(_sdEngMode \|\| _sdFxRAF\) return;/.test(canvas));
ok('canvas: paints coalesce through one pending RAF', /if \(_sdEngPend\) return;/.test(canvas));
ok('canvas: sub-pixel moves skip the repaint', /Math\.abs\(_sdEngPhase - _sdEngDrawnPhase\) > 0\.0015/.test(canvas));
ok('canvas: fresh lane geometry repaints the parked head (zoom/pan while stopped)', /_sdLaneGeom\.push\(\{ cy:[\s\S]{0,300}if \(_sdEngMode\) _sdEngKick\(\);/.test(canvas));

// version: ships as 1.1.2+
(function () {
    const m = cmake.match(/project\(StrideWrapperM0 VERSION (\d+)\.(\d+)\.(\d+)/);
    ok('CMake VERSION parses', !!m);
    if (m) ok('VERSION >= 1.1.2', +m[1] > 1 || (+m[1] === 1 && (+m[2] > 1 || (+m[2] === 1 && +m[3] >= 2))));
})();

console.log('  ' + passed + ' passed, ' + failed + ' failed');
process.exit(failed ? 1 : 0);
