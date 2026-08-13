/**
 * test-vst3-speed-endless-chain.js
 *
 * Covers the 2026-08-04 feature batch (field requests, Hyby):
 *   1. DEAD-ZONE GREY-OUT — the region past a lane's loop boundary is shaded
 *      OVER the curve. The old shade painted UNDER it, so the full-alpha curve
 *      made the non-modulating zone read as live ("hard to diagnose").
 *   2. ENDLESS NOTES-FREE — the phrase clock never globally wraps in Free:
 *      each lane wraps at its OWN boundary (bar length when none), so one
 *      unboundaried lane hitting the bar count no longer resets every lane.
 *   3. PER-LANE SPEED — the groove grid's replacement, same icon slot: a
 *      press-and-drag rate ladder (¼x…4x), engine-owned (set_speed / "sp"
 *      state attr v6 / speedVal echo), scales the lane clock before the wrap.
 *   4. CHAIN PRESETS (.stridechain) — save/load the entire instance as a file;
 *      the file IS the project state chunk, loaded through the proven
 *      project-open restore machinery. Demo-gated.
 */
'use strict';
const fs = require('fs');
const path = require('path');

let passed = 0, failed = 0;
function ok(name, cond, extra) {
    if (cond) { passed++; }
    else { failed++; console.log('  ✗ ' + name + (extra ? '  — ' + extra : '')); }
}
console.log('test-vst3-speed-endless-chain.js');

const root   = path.join(__dirname, '..', '..');
const W      = path.join(root, 'stride-wrapper', 'm0-spike');
const rd     = (p) => fs.readFileSync(p, 'utf8');
const procC  = rd(path.join(W, 'src', 'PluginProcessor.cpp'));
const procH  = rd(path.join(W, 'src', 'PluginProcessor.h'));
const editor = rd(path.join(W, 'src', 'PluginEditor.cpp'));
const editH  = rd(path.join(W, 'src', 'PluginEditor.h'));
const shim   = rd(path.join(W, 'ui', 'shim.js'));
const canvas = rd(path.join(root, 'stride-vst', 'app', 'renderer', 'canvas.js'));

const count = (src, needle) => src.split(needle).length - 1;

// ─────────────────────────────────────────────────────────────
// 1. BEHAVIORAL — the endless-free complaint, replicated end to end
// ─────────────────────────────────────────────────────────────
(function () {
    // The reported setup: 8-bar canvas (32 beats), lanes A+B with a 16-beat (4-bar)
    // boundary, lane C with none. OLD math wrapped the GLOBAL phase at 32 first, so
    // every lane re-anchored when C did. NEW free-mode math wraps each lane alone.
    const laneOld = (beats, cb, L) => { const ph = ((beats % cb) + cb) % cb; return L > 0 ? ph % L : ph; };
    const laneNew = (beats, cb, L, spd, free) => {
        const s = spd > 0.001 ? spd : 1;
        const B = L > 0.01 ? L : cb;
        let lx = ((free ? beats : ((beats % cb) + cb) % cb) * s) % B;
        return lx < 0 ? lx + B : lx;
    };
    // With a 3-beat boundary in a 32-beat canvas, the bar-count wrap used to snap the
    // lane mid-cycle: at beats=32 the old math jumps fmod(32,32)=0 while the lane's own
    // cycle sat at fmod(32,3)=2 — a 2-beat discontinuity injected by ANOTHER lane's loop.
    ok('OLD: global wrap yanked boundaried lanes mid-cycle (the complaint)',
       laneOld(31.9, 32, 3) > 1.8 && laneOld(32.1, 32, 3) < 0.2);
    ok('NEW free: the same lane keeps its own cycle through the bar count',
       Math.abs(laneNew(31.9, 32, 3, 1, true) - (31.9 % 3)) < 1e-9
       && Math.abs(laneNew(32.1, 32, 3, 1, true) - (32.1 % 3)) < 1e-9);
    ok('NEW free: unboundaried lanes wrap at the bar length exactly as before',
       laneNew(33, 32, 0, 1, true) === 1 && laneOld(33, 32, 0) === 1);
    ok('Transport keeps the clip anchor byte-identical (1x, any boundary)',
       laneNew(37, 16, 4, 1, false) === laneOld(37, 16, 4));

    // Speed scales the lane clock BEFORE the wrap: 2x completes its boundary twice as often.
    ok('2x lane completes two cycles per boundary span', laneNew(3, 32, 4, 2, false) === 2 && laneNew(4, 32, 4, 2, false) === 0);
    ok('½x lane needs two spans per cycle', laneNew(8, 32, 8, 0.5, false) === 4);
    ok('speed alone (no boundary) wraps at the bar length', laneNew(20, 32, 0, 2, false) === 8);
})();

// The speed ladder replica (mirrors the canvas drag): 24px per step, up = faster,
// clamped at the ends, junk speeds snap to the nearest rung.
(function () {
    const LADDER = [0.25, 0.5, 1, 2, 4];
    const idxOf = (s) => { let b = 2, d = 1e9; for (let i = 0; i < LADDER.length; i++) { const e = Math.abs(LADDER[i] - s); if (e < d) { d = e; b = i; } } return b; };
    const drag = (startSpeed, dyPx) => LADDER[Math.max(0, Math.min(LADDER.length - 1, idxOf(startSpeed) + Math.round(dyPx / 24)))];
    ok('one step up from 1x = 2x', drag(1, 24) === 2);
    ok('two steps down from 1x = ¼x', drag(1, -48) === 0.25);
    ok('clamped at the top rung', drag(4, 96) === 4);
    ok('an off-ladder engine value snaps to its nearest rung', idxOf(1.9) === 3 && idxOf(0.3) === 0);
})();

// ─────────────────────────────────────────────────────────────
// 2. ENGINE — speed owned/persisted/echoed, endless free, raw-beats publish
// ─────────────────────────────────────────────────────────────
ok('MapRef carries speed (default 1x)', /float speed = 1\.0f; \};/.test(procH));
ok('quantStep field kept for old-project round-trip, marked retired', /RETIRED 2026-08-04 \(groove grid\)/.test(procH));
ok('setMappedSpeed clamps + marks dirty, no re-push',
   /void StrideWrapperProcessor::setMappedSpeed \(int pos, float s\)[\s\S]{0,300}jlimit \(0\.1f, 8\.0f, s\);[\s\S]{0,120}hostDirtyPending\.store \(true\)/.test(procC)
   && !/setMappedSpeed[\s\S]{0,400}mapVersion\.fetch_add/.test(procC));
ok('state writes "sp" only when the lane leaves 1x (landed in v6; version only moves forward)',
   (() => { const m = procC.match(/root\.setAttribute \("version", (\d+)\);/); return !!m && +m[1] >= 6; })()
   && /std::abs \(m\.speed - 1\.0f\) > 1\.0e-4f/.test(procC));
ok('project reopen parses "sp" (default 1.0 for older projects)',
   /spd\.push_back \(\(float\) e->getDoubleAttribute \("sp", 1\.0\)\)/.test(procC));
ok('snapshot Dev struct carries the parallel speed vector', /std::vector<float> spd; \};/.test(procH));
ok('all three snapshots capture speed (clear + remove + duplicate)',
   count(procC, 'd.spd.push_back (m.speed);') === 3);
ok('restore rebuilds mapped entries WITH speed (missing vector = 1x, old snapshots safe)',
   /k < d\.spd\.size\(\) \? d\.spd\[k\] : 1\.0f \}\);/.test(procC));
ok('raw phrase beats published every block for the free-mode comet',
   /std::atomic<double> lastBeatsPub \{ 0\.0 \};/.test(procH) && /lastBeatsPub\.store \(beats\);/.test(procC));

// ─────────────────────────────────────────────────────────────
// 3. BRIDGE — set_speed routed, speedVal echoed, playhead carries b/free
// ─────────────────────────────────────────────────────────────
ok('set_speed routed (editLocked-gated) into setMappedSpeed',
   /if \(type == "set_speed"\)[\s\S]{0,260}isEditLocked\(\)\) return;[\s\S]{0,200}setMappedSpeed \(\(int\) msg\.getProperty \("id", -1\),/.test(editor));
ok('speedVal echoed only when the lane leaves 1x',
   /std::abs \(\(double\) speeds\[i\] - 1\.0\) > 1\.0e-4/.test(editor));
ok('playhead event carries raw beats + the notes-free flag',
   /setProperty \("b", proc\.lastBeatsPub\.load\(\)\)/.test(editor) && /setProperty \("free", proc\.getRunMode\(\) == 2\)/.test(editor));
ok('shim forwards b + free into sdSetEnginePlayhead',
   /sdSetEnginePlayhead\(\(d && d\.p\) \|\| 0, !!\(d && d\.on\), \(d && d\.b\) \|\| 0, !!\(d && d\.free\)\)/.test(shim));

// ─────────────────────────────────────────────────────────────
// 4. CANVAS — speed drag, echo build, dead-zone grey OVER the curve
// ─────────────────────────────────────────────────────────────
ok('lane build takes speed from the engine echo (speedVal; absent = 1x)',
   /speed: \(typeof p\.speedVal === 'number' && p\.speedVal > 0 \? p\.speedVal : 1\)/.test(canvas));
ok('speed drag: mousedown arms, mousemove steps the ladder live, mouseup persists',
   /_sdSpeedDrag = \{ param: hit\.param, startY: my, startIdx/.test(canvas)
   && /if \(_sdSpeedDrag\) \{[\s\S]{0,700}_sdPushSpeedToEngine\(d\.param\);/.test(canvas)
   && /if \(_sdSpeedDrag\) \{[\s\S]{0,500}saveCanvasState/.test(canvas));
ok('speed slot replaces the staircase: metronome at 1x, no quant glyph anywhere',
   /_drawSpeedIcon\(sdCtx, laneDrawLeft - 72/.test(canvas) && !/_drawQuantIcon/.test(canvas));
ok('off 1x the VALUE is the icon (centered in the slot, no colliding under-label)',
   /fillText\(_sdSpeedLabel\(_spdVal\), laneDrawLeft - 66, midY\);/.test(canvas)
   && !/laneDrawLeft - 66, midY \+ 12\)/.test(canvas));
ok('labels read as producer values, fractions spelled out (1/4, 1/2, 2X)', /'1\/4' : v === 0\.5 \? '1\/2' : \(v \+ 'X'\)/.test(canvas));
ok('dead zone is shaded OVER the curve (post-curve pass), boundary + grip re-stroked crisp',
   /rgba\(9,9,11,0\.66\)/.test(canvas)
   && /fillRect\(_bx2, rect\.top, lw - _bx2, rect\.height\);[\s\S]{0,400}_sdDrawLoopGrip\(sdCtx, _bx2/.test(canvas));
ok('saved canvas state carries speed instead of the retired quant',
   /speed: \(typeof p\.speed === 'number' \? p\.speed : 1\),/.test(canvas) && !/quantStep: \(typeof p\.quantStep/.test(canvas));

// ─────────────────────────────────────────────────────────────
// 5. CHAIN PRESETS — the state chunk verbatim, demo-gated, async chooser
// ─────────────────────────────────────────────────────────────
ok('save/load declared on the editor', /void saveChainToFile\(\);/.test(editH) && /void loadChainFromFile\(\);/.test(editH));
ok('bridge events wired', /"saveChain",\s+\[this\] \(juce::var\)\s+\{ saveChainToFile\(\); \}/.test(editor)
   && /"loadChain",\s+\[this\] \(juce::var\)\s+\{ loadChainFromFile\(\); \}/.test(editor));
ok('save = getStateInformation verbatim into the picked file',
   /proc\.getStateInformation \(mb\);[\s\S]{0,200}replaceWithData \(mb\.getData\(\), mb\.getSize\(\)\)/.test(editor));
ok('load = setStateInformation verbatim (rides the project-open restore machinery)',
   /loadFileAsData \(mb\)[\s\S]{0,400}proc\.setStateInformation \(mb\.getData\(\), \(int\) mb\.getSize\(\)\)/.test(editor));
ok('both directions demo-gated with a user-facing note (demo persists nothing)',
   count(editor, 'proc.isEditLocked() || proc.isDemo()') >= 2 && /emitChainNote \("Chain save needs a full license"/.test(editor));
ok('chooser is ASYNC (a modal chooser would freeze the host)',
   /Save chain",[\s\S]{0,300}launchAsync/.test(editor) && /Load chain", strideChainDir\(\), "\*\.stridechain"\);[\s\S]{0,120}launchAsync/.test(editor));
ok('files live in Documents/Stride/chains with the .stridechain extension',
   /getChildFile \("Stride"\)\.getChildFile \("chains"\)/.test(editor) && /hasFileExtension \("stridechain"\)/.test(editor));
(function () {
    const wrapHtml = rd(path.join(W, 'ui', 'index.html'));
    ok('SAVE/LOAD are WORDED titlebar buttons next to Compact (not control-bar glyphs)',
       /id="sd-save-chain-btn"[^>]*>Save<\/button>/.test(wrapHtml)
       && /id="sd-load-chain-btn"[^>]*>Load<\/button>/.test(wrapHtml)
       && /sd-quickpanel-btn[\s\S]{0,900}sd-save-chain-btn/.test(wrapHtml));
    ok('shim wires the titlebar buttons + the chainNote toast listens',
       /emit\('saveChain'\)/.test(shim) && /emit\('loadChain'\)/.test(shim) && /listen\('chainNote'/.test(shim));
})();

console.log('  ' + passed + ' passed, ' + failed + ' failed');
process.exit(failed ? 1 : 0);
