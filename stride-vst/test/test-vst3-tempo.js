/**
 * test-vst3-tempo.js
 *
 * Covers the Stride-tempo batch (1.1.7, revised per user feedback — no Free
 * mode, no popup): an ON-THE-BAR toggle
 *   SYNC (default) = follow the host exactly (byte-identical to before)
 *   MANUAL         = Stride's own BPM, TRANSPORT-MAPPED (beats × manual/host —
 *                    one multiply, deterministic: loops/scrubs/renders aligned;
 *                    70 on a 140 set = every lane half-time, ANY 5–999 value)
 * The BPM readout scrubs like the range MIN/MAX fields (drag up/down, ~1 BPM
 * per 2px) and double-click types an exact value. Engine-owned + saved with
 * the project. ~Zero CPU: one multiply per block, skipped entirely in sync.
 */
'use strict';
const fs = require('fs');
const path = require('path');

let passed = 0, failed = 0;
function ok(name, cond, extra) {
    if (cond) { passed++; }
    else { failed++; console.log('  ✗ ' + name + (extra ? '  — ' + extra : '')); }
}
console.log('test-vst3-tempo.js');

const W      = path.join(__dirname, '..', '..', 'stride-wrapper', 'm0-spike');
const rd     = (p) => fs.readFileSync(p, 'utf8');
const procC  = rd(path.join(W, 'src', 'PluginProcessor.cpp'));
const procH  = rd(path.join(W, 'src', 'PluginProcessor.h'));
const editor = rd(path.join(W, 'src', 'PluginEditor.cpp'));
const shim   = rd(path.join(W, 'ui', 'shim.js'));
const cmake  = rd(path.join(W, 'CMakeLists.txt'));

// ─────────────────────────────────────────────────────────────
// 1. BEHAVIORAL — the beat-clock mapping
// ─────────────────────────────────────────────────────────────
(function () {
    const effBeats = (hostBeats, mode, manualBpm, hostBpm) =>
        mode === 1 ? hostBeats * (manualBpm / Math.max(1, hostBpm)) : hostBeats;

    ok('SYNC = identity (byte-identical to the old behavior)', effBeats(37.25, 0, 70, 140) === 37.25);
    ok('Manual 70 on a 140 set = half-time', effBeats(8, 1, 70, 140) === 4);
    ok('Manual 35 on a 140 set = quarter-time', effBeats(8, 1, 35, 140) === 2);
    ok('Manual 280 on a 140 set = double-time (faster works too)', effBeats(8, 1, 280, 140) === 16);
    ok('ANY bpm value works — not just halves/doubles (93 on 140)', Math.abs(effBeats(140, 1, 93, 140) - 93) < 1e-9);
    ok('deterministic: same host position always maps to the same Stride position',
       effBeats(123.5, 1, 70, 140) === effBeats(123.5, 1, 70, 140));
    ok('host tempo automation re-ratios live (absolute BPM semantics)',
       effBeats(8, 1, 70, 140) === 4 && Math.abs(effBeats(8, 1, 70, 160) - 3.5) < 1e-9);
    ok('degenerate host bpm cannot divide by zero', isFinite(effBeats(8, 1, 70, 0)));

    const clamp = (v) => Math.max(5, Math.min(999, v));
    ok('bpm clamped 5..999', clamp(0.1) === 5 && clamp(5000) === 999 && clamp(70) === 70);
})();

// scrub math (mirrors the bar readout): drag up = faster, ~1 BPM per 2px, integer steps
(function () {
    const scrub = (startVal, startY, y) => Math.max(5, Math.min(999, Math.round(startVal + (startY - y) * 0.5)));
    ok('drag UP 20px = +10 BPM', scrub(120, 300, 280) === 130);
    ok('drag DOWN 40px = -20 BPM', scrub(120, 300, 340) === 100);
    ok('scrub clamps at the floor', scrub(10, 300, 400) === 5);
    ok('scrub clamps at the ceiling', scrub(990, 300, 200) === 999);
    ok('tiny wobble rounds to whole BPM', scrub(120, 300, 299) === 121);
})();

// toggle + type semantics (mirrors the bar control)
(function () {
    let mode = 0;
    const toggle = () => { mode = (mode === 0 ? 1 : 0); };
    toggle(); ok('toggle: sync -> manual', mode === 1);
    toggle(); ok('toggle: manual -> sync (pure on/off)', mode === 0);
    const commit = (prev, text) => { const v = parseFloat(text); return isNaN(v) ? prev : Math.max(5, Math.min(999, v)); };
    ok('typed value commits clamped', commit(120, '93') === 93 && commit(120, '2000') === 999);
    ok('garbage input keeps the previous value', commit(120, 'abc') === 120);
})();

// loop phase under manual tempo: the loop simply takes proportionally longer
(function () {
    const phase = (hostBeats, clipBeats, ratio) => {
        let b = hostBeats * ratio;
        let p = b % clipBeats; if (p < 0) p += clipBeats;
        return p / clipBeats;
    };
    ok('half-speed: the 16-beat loop wraps every 32 host beats', Math.abs(phase(32, 16, 0.5) - 0) < 1e-9 && Math.abs(phase(16, 16, 0.5) - 0.5) < 1e-9);
    ok('sync: wraps every 16 host beats as before', Math.abs(phase(16, 16, 1) - 0) < 1e-9);
})();

// ─────────────────────────────────────────────────────────────
// 2. ENGINE — two modes, one multiply, persisted
// ─────────────────────────────────────────────────────────────
ok('members declared (sync default)', /std::atomic<int>\s+tempoMode \{ 0 \}/.test(procH) && /std::atomic<float> manualBpm \{ 120\.0f \}/.test(procH));
ok('TempoMode enum is TWO states (Free removed per user feedback)', /enum class TempoMode \{ Project = 0, Manual = 1 \};/.test(procH));
ok('Manual scale is ONE multiply, only in Manual mode', /else if \(tMode == \(int\) TempoMode::Manual\)[\s\S]{0,600}beats \*= \(double\) manualBpm\.load\(\) \/ juce::jmax \(1\.0, hostBpm\)/.test(procC));
ok('standalone free-run honors the manual BPM (else classic 120)', /frBpm = \(tMode == \(int\) TempoMode::Manual\) \? \(double\) manualBpm\.load\(\) : 120\.0/.test(procC));
ok('playhead read in every mode (recording gate stays host-truth)', /play-state stay host-truth in every mode/.test(procC));
ok('host bpm read in the SAME playhead query as the position (no extra call)', /if \(auto bpm = pos->getBpm\(\)\) hostBpm = \*bpm;/.test(procC));
ok('setTempoMode clamps mode to 0..1 + bpm at the door and marks the project dirty', /setTempoMode \(int mode, float bpm\)[\s\S]{0,400}jlimit \(0, 1, mode\)[\s\S]{0,200}jlimit \(5\.0f, 999\.0f, bpm\)[\s\S]{0,120}hostDirtyPending\.store \(true\)/.test(procC));
ok('project state SAVES the mode', /setAttribute \("tempoMode", tempoMode\.load\(\)\)/.test(procC) && /setAttribute \("manualBpm"/.test(procC));
ok('project state LOADS with sync default (old projects byte-identical)', /jlimit \(0, 1, xml->getIntAttribute \("tempoMode", 0\)\)/.test(procC) && /getDoubleAttribute \("manualBpm", 120\.0\)/.test(procC));

// ─────────────────────────────────────────────────────────────
// 3. BRIDGE + UI (on-the-bar toggle, no popup)
// ─────────────────────────────────────────────────────────────
ok('editor handles set_tempo_mode (editLocked-gated)', /if \(type == "set_tempo_mode"\)[\s\S]{0,260}isEditLocked\(\)\) return;[\s\S]{0,200}setTempoMode/.test(editor));
ok('rack_scanned echoes the tempo state (UI rebuilds from the engine)', /setProperty \("tempo_mode", proc\.getTempoMode\(\)\)/.test(editor) && /setProperty \("manual_bpm", \(double\) proc\.getManualBpm\(\)\)/.test(editor));
ok('shim: a plain on/off TOGGLE on the bar (no popover)', /tempoBtn\.onclick = function \(\) \{ _tempoMode = \(_tempoMode === 0 \? 1 : 0\); paintTempo\(\); pushTempo\(\); \};/.test(shim));
ok('shim: sync hides the number; manual shows it inline', /synced \? 'hidden' :/.test(shim) && /'♪ sync' : '♪ manual'/.test(shim));
ok('shim: BPM readout SCRUBS like the range fields (~1 BPM per 2px, live push)', /_bpmDrag\.startVal \+ \(_bpmDrag\.startY - e\.clientY\) \* 0\.5/.test(shim) && /ns-resize/.test(shim));
ok('shim: double-click types an exact value (Enter commits, Escape cancels)', /addEventListener\('dblclick'/.test(shim) && /ev\.key === 'Enter'/.test(shim) && /ev\.key === 'Escape'/.test(shim));
ok('shim: edits push set_tempo_mode with the mode int', /type: 'set_tempo_mode', mode: _tempoMode, bpm: _manualBpm/.test(shim));
ok('shim: BPM clamped 5..999', /Math\.max\(5, Math\.min\(999, v\)\)/.test(shim));
ok('shim: state restored from rack_scanned', /msg\.tempo_mode/.test(shim) && /msg\.manual_bpm/.test(shim));

// version: ships as 1.1.7+
(function () {
    const m = cmake.match(/project\(StrideWrapperM0 VERSION (\d+)\.(\d+)\.(\d+)/);
    ok('CMake VERSION parses', !!m);
    if (m) ok('VERSION >= 1.1.7', +m[1] > 1 || (+m[1] === 1 && (+m[2] > 1 || (+m[2] === 1 && +m[3] >= 7))));
})();

console.log('  ' + passed + ' passed, ' + failed + ' failed');
process.exit(failed ? 1 : 0);
