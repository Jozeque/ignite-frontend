/**
 * test-vst3-stride-controls.js
 *
 * Covers the 2026-08-07 batch (field requests):
 *   1. STRIDE CONTROL PARAMS — Stride's own controls as DAW-automatable params so a
 *      MIDI knob can ride them: "Stride BPM" (log-mapped 5..999, lands in Manual
 *      tempo) + the Active sliders (Smooth/Depth/Curve/Floor/Ceiling), driving the
 *      SAME snapshot-based functions the strip uses. RAW AudioProcessorParameter like
 *      the macros — mixing ID-based params into a raw list would flip JUCE's VST3
 *      param-ID scheme and orphan every existing automation lane. Appended AFTER the
 *      macro pool: indices 0..31 untouched (the macro-pool additive precedent).
 *   2. S&H GRID MODE — a second mode for both S&H generators: a fixed division
 *      (1/8, 1/8T, 1/16, 1/16T, 1/32, 1/32T) where EVERY step takes a new held
 *      value; Poly (the classic polyrhythm) stays the default. Sticky ▾ choice.
 */
'use strict';
const fs = require('fs');
const path = require('path');

let passed = 0, failed = 0;
function ok(name, cond, extra) {
    if (cond) { passed++; }
    else { failed++; console.log('  ✗ ' + name + (extra ? '  — ' + extra : '')); }
}
console.log('test-vst3-stride-controls.js');

const root   = path.join(__dirname, '..', '..');
const W      = path.join(root, 'stride-wrapper', 'm0-spike');
const rd     = (p) => fs.readFileSync(p, 'utf8');
const procC  = rd(path.join(W, 'src', 'PluginProcessor.cpp'));
const procH  = rd(path.join(W, 'src', 'PluginProcessor.h'));
const editor = rd(path.join(W, 'src', 'PluginEditor.cpp'));
const shim   = rd(path.join(W, 'ui', 'shim.js'));
const canvas = rd(path.join(root, 'stride-vst', 'app', 'renderer', 'canvas.js'));

// ─────────────────────────────────────────────────────────────
// 1. BEHAVIORAL — BPM log map, grid emitter, ride gesture
// ─────────────────────────────────────────────────────────────

// The BPM map, mirrored: log between 5 and 999 so the knob feels musical everywhere.
(function () {
    const clamp = (x, a, b) => Math.min(b, Math.max(a, x));
    const normToBpm = (n) => clamp(5 * Math.pow(999 / 5, clamp(n, 0, 1)), 5, 999);
    const bpmToNorm = (b) => clamp(Math.log(clamp(b, 5, 999) / 5) / Math.log(999 / 5), 0, 1);
    for (const b of [5, 60, 120, 174, 999])
        ok('BPM round-trips through the log map (' + b + ')', Math.abs(normToBpm(bpmToNorm(b)) - b) < 0.01);
    ok('default 120 sits mid-knob-ish (log feel)', bpmToNorm(120) > 0.55 && bpmToNorm(120) < 0.65);
    ok('the map clamps junk', normToBpm(-1) === 5 && normToBpm(2) === 999);
})();

// The grid emitter, mirrored: fixed division, ε-gap flat holds, MIN_DELTA jumps.
(function () {
    const EPS = 0.005, MIN_DELTA = 0.15;
    const round4 = t => Math.round(t * 10000) / 10000;
    const gridPts = (sB, eB, d) => {
        const pts = []; let lastV = null;
        for (let t = sB; t < eB - 1e-4; t += d) {
            const stepEnd = Math.min(t + d, eB);
            let v, tries = 0;
            do { v = Math.random(); tries++; }
            while (lastV !== null && Math.abs(v - lastV) < MIN_DELTA && tries < 12);
            lastV = v;
            const tA = round4(t);
            pts.push({ time: tA, value: v });
            const tB = round4(stepEnd - EPS);
            if (tB > tA) pts.push({ time: tB, value: v });
        }
        return pts;
    };
    const p16 = gridPts(0, 2, 0.25);   // 1/16 over 2 beats = 8 steps
    ok('1/16 grid: 8 steps × 2 points each', p16.length === 16);
    ok('every step is a flat hold (pair carries the same value)',
       p16.every((pt, i) => i % 2 === 0 ? pt.value === p16[i + 1].value : true));
    ok('steps land dead on the division', p16[2].time === 0.25 && p16[6].time === 0.75);
    const t8 = gridPts(0, 4, 1 / 3);   // 1/8T over a bar = 12 triplet steps
    ok('1/8T grid: 12 triplet steps per bar', t8.length === 24);
    ok('triplet steps land on the triplet grid', Math.abs(t8[2].time - round4(1 / 3)) < 1e-9);
    const jumps = [];
    for (let i = 2; i < p16.length; i += 2) jumps.push(Math.abs(p16[i].value - p16[i - 2].value));
    ok('adjacent steps stay visibly apart (MIN_DELTA)', jumps.every(j => j >= MIN_DELTA - 1e-9) || jumps.length === 0);
})();

// The ride gesture, mirrored: <1s between knob moves = one gesture; ≥1s re-arms.
(function () {
    let last = 0, resets = 0;
    const hostCtl = (now) => { if (now - last > 1000) resets++; last = now; };
    hostCtl(5000); hostCtl(5100); hostCtl(5500); hostCtl(5900);   // first-ever move resets (Date.now() >> 1000), then the ride holds
    ok('a continuous ride is ONE gesture (one snapshot reset)', resets === 1);
    hostCtl(7400);
    ok('a second ride after ≥1s of silence re-arms', resets === 2);
})();

// ─────────────────────────────────────────────────────────────
// 2. ENGINE — raw params, appended, accessors
// ─────────────────────────────────────────────────────────────
ok('ControlParameter is a RAW AudioProcessorParameter (ID-scheme safety documented)',
   /class ControlParameter : public juce::AudioProcessorParameter/.test(procH)
   && /flip\s+\/\/ JUCE's VST3 param-ID scheme|flip[\s\S]{0,80}param-ID scheme/.test(procH));
ok('six controls, fixed order, defined in the header enum',
   /enum StrideCtl \{ ctlBpm = 0, ctlSmooth, ctlDepth, ctlCurve, ctlFloor, ctlCeil, kControlCount \};/.test(procH));
ok('registered AFTER the macro pool (additive; indices 0..31 untouched)',
   (() => {
       const macros = procC.indexOf('macroParams[(size_t) i] = mp;');
       const ctls = procC.indexOf('controlParams[(size_t) i] = cp;');
       return macros > 0 && ctls > macros;
   })());
ok('names + neutral defaults (Ceiling 1, Depth 0.5 = intensity 100 of 0..200, Curve/Smooth/Floor 0, BPM 120)',
   /"Stride BPM",\s+ctlBpmToNorm \(120\.0f\)/.test(procC) && /"Stride Ceiling", 1\.0f/.test(procC)
   && /"Stride Smooth",\s+0\.0f/.test(procC) && /"Stride Curve",\s+0\.0f/.test(procC)
   && /"Stride Depth",\s+0\.5f/.test(procC));
ok('getControlValue is bounds-guarded; syncBpmParamFromUI is gesture-wrapped + change-guarded',
   /float StrideWrapperProcessor::getControlValue \(int idx\) const[\s\S]{0,200}idx >= kControlCount/.test(procC)
   && /syncBpmParamFromUI[\s\S]{0,500}beginChangeGesture\(\);[\s\S]{0,120}setValueNotifyingHost \(n\);[\s\S]{0,80}endChangeGesture\(\);/.test(procC));
ok('log map helpers live in the header (editor shares them)',
   /static float ctlNormToBpm/.test(procH) && /static float ctlBpmToNorm/.test(procH));
ok('Configure announce covers the control params too (no in-Stride UI to touch otherwise)',
   /for \(auto\* cp : controlParams\)[\s\S]{0,500}cp->beginChangeGesture\(\);[\s\S]{0,200}cp->endChangeGesture\(\);/.test(procC));
ok('UI → param sync: every slider apply pushes set_ctl_param (Configure catches a touched slider)',
   /function _sdPushCtlParamToEngine\(k, uiVal\)/.test(canvas)
   && (canvas.match(/_sdPushCtlParamToEngine\('(smooth|depth|curve|floor|ceil)', val\)/g) || []).length === 5
   && /\(k === 'depth'\) \? 200 : 100/.test(canvas));
ok('set_ctl_param route updates the relay baseline FIRST (echo-proof) then gesture-syncs the param',
   /if \(type == "set_ctl_param"\)[\s\S]{0,900}lastCtlSent\[it->second\] = v;[\s\S]{0,120}syncControlParamFromUI \(it->second, v\);/.test(editor)
   && /void StrideWrapperProcessor::syncControlParamFromUI \(int idx, float norm\)[\s\S]{0,400}beginChangeGesture/.test(procC));

// ─────────────────────────────────────────────────────────────
// 3. EDITOR — seeded change-detected relay in the ATOMIC tick section
// ─────────────────────────────────────────────────────────────
ok('baselines seeded on the first tick (an editor open never re-applies parked knobs)',
   /if \(! ctlSeeded\)[\s\S]{0,300}lastCtlSent\[i\] = proc\.getControlValue \(i\);/.test(editor));
ok('BPM change → engine (mode untouched) + a light bpmEcho for the pill',
   /proc\.setTempoMode \(proc\.getTempoMode\(\), bpm\);[\s\S]{0,300}"bpmEcho"/.test(editor));
ok('slider changes ride as strideCtl {k, v}, editLocked-gated',
   /kCtlKeys\[\] = \{ "", "smooth", "depth", "curve", "floor", "ceil" \};[\s\S]{0,700}"strideCtl"/.test(editor)
   && /if \(proc\.isEditLocked\(\)\) continue;/.test(editor));
ok('the relay sits BEFORE the bounded lock gate (atomic tick section — no keyswitch-class regression)',
   (() => {
       const relay = editor.indexOf('Stride control params');
       const gate = editor.indexOf('if (! proc.hostLockFreeBounded()) return;', relay);   // the TIMER's gate (the funnel has an identical line earlier in the file)
       return relay > 0 && gate > relay;
   })());
ok('a UI tempo edit moves the DAW lane too (set_tempo_mode → syncBpmParamFromUI)',
   /setTempoMode \(\(int\) msg\.getProperty \("mode", 0\),[\s\S]{0,300}syncBpmParamFromUI/.test(editor));

// ─────────────────────────────────────────────────────────────
// 4. SHIM + CANVAS — echo, forward, receiver, S&H grid
// ─────────────────────────────────────────────────────────────
ok('shim: bpmEcho repaints the tempo pill; strideCtl forwards to the canvas receiver',
   /listen\('bpmEcho', function \(d\) \{[\s\S]{0,150}paintTempo\(\);/.test(shim)
   && /listen\('strideCtl', function \(d\) \{[\s\S]{0,150}sdHostCtl/.test(shim));
ok('canvas receiver drives the strip functions with the 1s ride-gesture rule',
   /window\.sdHostCtl = function \(k, v\) \{[\s\S]{0,300}now - _sdHostCtlLastMs > 1000\) sdResetSliderSnapshots\(\);/.test(canvas)
   && /sdApplySmooth\(out\)/.test(canvas) && /sdApplyIntensity\(out\)/.test(canvas)
   && /sdApplyCurve\(out\)/.test(canvas) && /sdApplyFloor\(out\)/.test(canvas) && /sdApplyCeiling\(out\)/.test(canvas));
ok('Depth maps to its REAL range (0..200, neutral 100) — every other control is 0..100',
   /\(k === 'depth'\) \? Math\.round\(n \* 200\) : Math\.round\(n \* 100\)/.test(canvas));
ok('the visible handles follow the knob on BOTH strips (sidebar + compact), labels included',
   /\['sd-' \+ ids, 'qpc-' \+ ids\]\.forEach/.test(canvas) && /intensity-slider/.test(canvas)
   && /qpc-intensity-val/.test(canvas));
ok('the ▾ rides EVERY S&H surface (desktop Shapes; wrapper Shapes + COMPACT + Motion row), all classed for the timing label',
   (() => {
       const dHtml = rd(path.join(root, 'stride-vst', 'app', 'renderer', 'index.html'));
       const wHtml = rd(path.join(W, 'ui', 'index.html'));
       return (dHtml.match(/sd-sh-mode-btn/g) || []).length === 1
           && (wHtml.match(/sd-sh-mode-btn/g) || []).length === 3
           && /sdApplyGlobalSampleHold\(\)[^>]*>S&amp;H<\/button><button onclick="window\.sdOpenShModePopup/.test(wHtml);
   })());
ok('the picked timing is painted onto every ▾ (boot + pick + card re-render)',
   /function _sdShPaintModeBtns\(\)[\s\S]{0,300}querySelectorAll\('\.sd-sh-mode-btn'\)/.test(canvas)
   && /_sdShMode > 0 \? \(_sdShModeLabel\(\) \+ ' ▾'\) : '▾'/.test(canvas)
   && (canvas.match(/_sdShPaintModeBtns\(\);/g) || []).length >= 3);
ok('S&H mode table has every straight division AND its triplet',
   /\[\['Poly', 0\], \['1\/8', 0\.5\], \['1\/8T', 1 \/ 3\], \['1\/16', 0\.25\], \['1\/16T', 1 \/ 6\], \['1\/32', 0\.125\], \['1\/32T', 1 \/ 12\]\]/.test(canvas));
ok('BOTH S&H generators take the grid branch (Motion + Shapes-row lane)',
   (canvas.match(/_sdShGridPts\(sB, eB, _sdShMode, EPS, MIN_DELTA, round4\)/g) || []).length === 2);
ok('Poly stays the default and the choice is sticky',
   /let _sdShMode = 0;/.test(canvas) && /localStorage\.getItem\('sd_sh_mode'\)/.test(canvas)
   && /localStorage\.setItem\('sd_sh_mode', String\(v\)\)/.test(canvas));
ok('the ▾ mode button rides next to the Motion S&H (2-col grid preserved via a flex cell)',
   /<div class="flex gap-0\.5">'[\s\S]{0,700}sdOpenShModePopup\(event\)/.test(canvas));

console.log('  ' + passed + ' passed, ' + failed + ' failed');
process.exit(failed ? 1 : 0);
