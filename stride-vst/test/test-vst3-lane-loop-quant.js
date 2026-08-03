/**
 * test-vst3-lane-loop-quant.js
 *
 * Covers the 1.3.0 lane-feature train:
 *   1. Per-lane LOOP boundary — drag the grip at a lane's right end and that lane
 *      wraps early (1 bar of a 4-bar canvas), engine-owned like ranges/colors.
 *   2. Per-lane GROOVE GRID — a lane header glyph picks a step (1/8, 1/16, 1/16T...);
 *      the engine sample-and-holds the curve at each step, non-destructively.
 *   3. Alt+drag DUPLICATE — Alt+drop a device chip clones the device (same patch,
 *      same mapped params on fresh macro slots, ranges/colors/loop/quant carried)
 *      with EMPTY lanes, riding the same async restore machinery as undo.
 *   4. Param-touch GLOW — touching a MAPPED knob in a hosted plugin's own GUI
 *      flashes that lane on the canvas (the engine's own drive writes never fire
 *      listeners, so playback can't trigger it).
 * Everything canvas-side is wrapper-gated: the desktop app renders byte-identically.
 */
'use strict';
const fs = require('fs');
const path = require('path');

let passed = 0, failed = 0;
function ok(name, cond, extra) {
    if (cond) { passed++; }
    else { failed++; console.log('  ✗ ' + name + (extra ? '  — ' + extra : '')); }
}
console.log('test-vst3-lane-loop-quant.js');

const root   = path.join(__dirname, '..', '..');
const W      = path.join(root, 'stride-wrapper', 'm0-spike');
const rd     = (p) => fs.readFileSync(p, 'utf8');
const procC  = rd(path.join(W, 'src', 'PluginProcessor.cpp'));
const procH  = rd(path.join(W, 'src', 'PluginProcessor.h'));
const editH  = rd(path.join(W, 'src', 'PluginEditor.h'));
const editor = rd(path.join(W, 'src', 'PluginEditor.cpp'));
const shim   = rd(path.join(W, 'ui', 'shim.js'));
const canvas = rd(path.join(root, 'stride-vst', 'app', 'renderer', 'canvas.js'));

// ─────────────────────────────────────────────────────────────
// 1. BEHAVIORAL — replica of the engine's per-lane eval position
// ─────────────────────────────────────────────────────────────
// Mirrors processBlock: lx = global phase, unless the lane loops (wrap the
// ABSOLUTE clock at loopBeats), then quantize floors to the step.
(function () {
    // Loop anchor = the CLIP PHASE (canvas origin), NOT the absolute host clock: the lane
    // must restart the instant the playhead crosses the drawn boundary, mid-bar included.
    // (v1 wrapped the absolute clock; inside a Live loop brace the wraps landed at
    // fmod(brace-start, L) offsets and mid-bar boundaries never audibly restarted.)
    function laneX(beats, clipBeats, loopBeats, quantStep) {
        const ph = ((beats % clipBeats) + clipBeats) % clipBeats;
        let lx = ph;
        if (loopBeats > 0.01) lx = ph % loopBeats;
        if (quantStep > 0.001) lx = Math.floor(lx / quantStep) * quantStep;
        return lx;
    }
    ok('defaults are byte-identical (no loop, no quant = global phase)', laneX(37.5, 16, 0, 0) === 37.5 % 16);
    ok('1-bar loop of a 4-bar clip wraps every 4 beats', laneX(37, 16, 4, 0) === 1);
    ok('MID-BAR boundary restarts AT the boundary, brace-independent', laneX(128 + 2.25, 16, 2.25, 0) === 0);   // brace at ppq 128: crossing the drawn 2.25 line = instant rewrap
    ok('loop anchor = canvas origin (restart aligns with the ghost ticks)', laneX(16 + 4.5, 16, 2.25, 0) === 0);
    ok('clip top re-anchors every lane (short last cycle, like a brace)', laneX(16, 16, 3, 0) === 0);
    ok('groove grid floors to the step (1/16 = 0.25 beats)', laneX(1.37, 16, 0, 0.25) === 1.25);
    ok('triplet grid floors to 1/6-beat steps (1/16T)', Math.abs(laneX(0.9, 16, 0, 1 / 6) - (5 / 6)) < 1e-9);
    ok('loop + grid compose (wrap first, then floor)', laneX(9.4, 16, 4, 0.5) === 1.0);   // wrap(9.4->1.4) -> floor to 1.0
    ok('negative host beats stay in range', laneX(-0.5, 16, 4, 0) >= 0);
})();

// ─────────────────────────────────────────────────────────────
// 2. ENGINE — fields, setters, drive loop, persistence, snapshots
// ─────────────────────────────────────────────────────────────
ok('MapRef carries loopBeats + quantStep defaults', /float loopBeats = 0\.0f;[\s\S]{0,200}float quantStep = 0\.0f;/.test(procH));
ok('setMappedLoop clamps + marks the host dirty', /setMappedLoop[\s\S]{0,300}jlimit \(0\.0f, 1024\.0f, beats\)[\s\S]{0,120}hostDirtyPending/.test(procC));
ok('setMappedQuant clamps to a bar max', /setMappedQuant[\s\S]{0,300}jlimit \(0\.0f, 4\.0f, step\)/.test(procC));
ok('drive loop wraps the CLIP PHASE at the lane boundary (canvas-anchored)', /loopBeats > 0\.01f[\s\S]{0,120}std::fmod \(ph, \(double\) mr->loopBeats\)/.test(procC));
ok('drive loop sample-and-holds at the quant step', /quantStep > 0\.001f[\s\S]{0,120}std::floor \(lx \/ \(double\) mr->quantStep\) \* \(double\) mr->quantStep/.test(procC));
ok('one mapped lookup serves slot + loop + quant (no extra scan)', /const MapRef\* mr = nullptr;[\s\S]{0,220}m\.node == lane\.node && m\.param == lane\.param/.test(procC));
ok('state writes lb/qs only when set (old builds ignore them)', /m\.loopBeats > 0\.0f\) e->setAttribute \("lb"/.test(procC) && /m\.quantStep > 0\.0f\) e->setAttribute \("qs"/.test(procC));
ok('state parses lb/qs with off defaults (old projects unchanged)', /getDoubleAttribute \("lb", 0\.0\)/.test(procC) && /getDoubleAttribute \("qs", 0\.0\)/.test(procC));
ok('snapshot Dev struct carries parallel loop/quant vectors', /std::vector<float> lpb, qst;/.test(procH));
ok('all three snapshot sites capture loop/quant (clear + remove + duplicate)', (procC.match(/d\.lpb\.push_back \(m\.loopBeats\)/g) || []).length === 3);
ok('restore rebuilds mapped entries WITH loop/quant', /k < d\.lpb\.size\(\) \? d\.lpb\[k\] : 0\.0f/.test(procC));

// ─────────────────────────────────────────────────────────────
// 3. ENGINE — duplicate + glow
// ─────────────────────────────────────────────────────────────
ok('duplicateNode captures state + mapped params on FRESH slots', /duplicateNode[\s\S]{0,900}d\.slots\.push_back \(-1\)/.test(procC));
ok('duplicate starts with EMPTY lanes (no curves copied)', /duplicateNode[\s\S]{0,1600}d\.lanes stays empty/.test(procC));
ok('duplicate rides the undo restore machinery + generation stamp', /duplicateNode[\s\S]{0,1800}restoreNextDevice \(devs, 0, restoreGeneration\.fetch_add \(1\) \+ 1\)/.test(procC));
ok('duplicate marks the project dirty (a real edit)', /duplicateNode[\s\S]{0,1700}hostDirtyPending\.store \(true\)/.test(procC));
ok('glow latches only MAPPED params, never while Map/Unmap armed', /noteParamTouched[\s\S]{0,900}learnMode\.load\(\) \|\| unlearnMode\.load\(\)\) return;[\s\S]{0,600}pendingGlowPos\.store \(pos\)/.test(procC));
ok('both touch callbacks feed the glow (gesture + value fallback)', (procC.match(/noteParamTouched \(proc, parameterIndex\)/g) || []).length === 2);
ok('consumeGlowPos drains atomically (editor timer)', /consumeGlowPos\(\) \{ return pendingGlowPos\.exchange \(-1\); \}/.test(procH));

// ─────────────────────────────────────────────────────────────
// 4. EDITOR — bridge in, echo out, window alignment
// ─────────────────────────────────────────────────────────────
ok('set_loop handled (editLocked-gated)', /if \(type == "set_loop"\)[\s\S]{0,200}isEditLocked\(\)\) return;[\s\S]{0,200}setMappedLoop/.test(editor));
ok('set_quant handled (editLocked-gated)', /if \(type == "set_quant"\)[\s\S]{0,200}isEditLocked\(\)\) return;[\s\S]{0,200}setMappedQuant/.test(editor));
ok('rack_scanned echoes loopBeats/quantStep per lane', /setProperty \("loopBeats", loops\[i\]\)/.test(editor) && /setProperty \("quantStep", quants\[i\]\)/.test(editor));
ok('duplicateDevice listener is editLocked-gated', /"duplicateDevice"[\s\S]{0,500}isEditLocked\(\)\) return;[\s\S]{0,400}duplicateNode/.test(editor));
ok('window slots stay aligned on duplicate (pending insert, deadline-stamped)', /pendingDupInsertAt/.test(editH) && /pendingDupSetMs < 5000/.test(editor));
ok('timer drains the glow into a param_glow sl_event', /consumeGlowPos\(\)[\s\S]{0,400}"param_glow"/.test(editor));

// ─────────────────────────────────────────────────────────────
// 5. SHIM — Alt+drag duplicate on the chips
// ─────────────────────────────────────────────────────────────
ok('chips allow copyMove (Alt shows the copy cursor)', /effectAllowed = 'copyMove'/.test(shim));
ok('Alt+drop emits duplicateDevice, landing AFTER the drop chip', /e\.altKey\) \{ emit\('duplicateDevice', \{ from: from, to: i \+ 1 \}\)/.test(shim));
ok('Alt hover reads as copy (emerald), move stays cyan', /e\.altKey \? '2px solid rgba\(52,211,153/.test(shim));
ok('Alt+drop on the SAME chip duplicates in place', /dragFrom === i && ! e\.altKey\)\) return;/.test(shim));
ok('the grip hints at Alt+drag', /Alt\+drag to duplicate/.test(shim));

// ─────────────────────────────────────────────────────────────
// 6. CANVAS — wrapper-gated UI (desktop byte-identical)
// ─────────────────────────────────────────────────────────────
ok('lane objects default loop/quant off', /loopBeats: 0, quantStep: 0,/.test(canvas));
ok('payload adoption: engine echo wins on rebuild', /loopBeats: \(typeof p\.loopBeats === 'number' && p\.loopBeats > 0 \? p\.loopBeats : 0\)/.test(canvas));
ok('saved state persists loop/quant per lane', /loopBeats: \(typeof p\.loopBeats === 'number' \? p\.loopBeats : 0\),/.test(canvas));
ok('restore only fills defaults (engine echo already landed)', /sp\.loopBeats > 0 && !\(param\.loopBeats > 0\)/.test(canvas));
ok('set_loop push is wrapper-gated', /_sdPushLoopToEngine[\s\S]{0,300}strideLink\._wrapper\) return;[\s\S]{0,200}type: 'set_loop'/.test(canvas));
ok('set_quant push is wrapper-gated', /_sdPushQuantToEngine[\s\S]{0,300}strideLink\._wrapper\) return;[\s\S]{0,200}type: 'set_quant'/.test(canvas));
ok('renderer chrome is wrapper-gated', /_isWrapUI = !!\(window\.strideLink && window\.strideLink\._wrapper\)/.test(canvas));
ok('grid picker offers the triplets (1/8T + 1/16T)', /'1\/8T', 1 \/ 3/.test(canvas) && /'1\/16T', 1 \/ 6/.test(canvas));
ok('loop drag snaps to the visible grid, full length = off', /_sdLoopDrag[\s\S]{0,900}sdVisualGridBeats\(\)[\s\S]{0,300}b >= tb - 1e-6\) \? 0 : b/.test(canvas));
ok('loop handle hit-test is wrapper-gated', /strideLink\._wrapper\) \{[\s\S]{0,600}_sdOpenQuantPopup/.test(canvas));
ok('glow scrolls the lane into view', /param_glow[\s\S]{0,900}sdMultiScrollOffset = Math\.max\(0, idx - visCount \+ 1\)/.test(canvas));
ok('glow repaints stay silent on the bridge (no drive-flush spam)', /_sdGlowPaint\) return;/.test(canvas));
ok('glow fades from the lane color (1s)', /_glowUntil - _glowNow[\s\S]{0,800}strokeRect/.test(canvas));
ok('comet geometry carries the lane loop fraction (wrapper-gated)', /loopFrac: \(_isWrapUI && typeof param\.loopBeats === 'number'/.test(canvas));
ok('comet wraps at the lane boundary, in step with the engine', /g\.loopFrac && g\.loopFrac > 0[\s\S]{0,220}phase - Math\.floor\(phase \/ g\.loopFrac\) \* g\.loopFrac/.test(canvas));

// ─────────────────────────────────────────────────────────────
console.log(`  ${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
