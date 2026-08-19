/**
 * test-vst3-reptile-compact.js
 *
 * Reptile Mode + Compact View, integrated into the real wrapper (2026-08-19).
 *
 * The whole risk of this feature is that it is PRESENTATION bolted onto a shipping
 * instrument. So these tests are mostly about what it must NOT do:
 *   - it must not exist at all in the desktop Electron app (canvas.js is shared)
 *   - it must not own product state: the card grid renders from a READ-ONLY snapshot
 *   - it must not intercept clicks meant for Stride's controls
 *   - the existing "Compact" control must keep its own meaning (the prototype view
 *     switch is a separate DEV control)
 *   - a plugin editor cannot paint outside its bounds, so the character opens a zone
 *     and the host GROWS by exactly that height, restoring it on deactivate
 *   - both layers must PARK their animation loops so an inactive feature costs nothing
 */
'use strict';
const fs = require('fs');
const path = require('path');

let passed = 0, failed = 0;
function ok(name, cond, extra) {
    if (cond) { passed++; }
    else { failed++; console.log('  ✗ ' + name + (extra ? '  — ' + extra : '')); }
}
console.log('test-vst3-reptile-compact.js');

const root   = path.join(__dirname, '..', '..');
const W      = path.join(root, 'stride-wrapper', 'm0-spike');
const rd     = (p) => fs.readFileSync(p, 'utf8');
const rep    = rd(path.join(W, 'ui', 'reptile.js'));
const comp   = rd(path.join(W, 'ui', 'compact.js'));
const indexH = rd(path.join(W, 'ui', 'index.html'));
const shim   = rd(path.join(W, 'ui', 'shim.js'));
const editor = rd(path.join(W, 'src', 'PluginEditor.cpp'));
const edH    = rd(path.join(W, 'src', 'PluginEditor.h'));
const cmake  = rd(path.join(W, 'CMakeLists.txt'));
const canvas = rd(path.join(root, 'stride-vst', 'app', 'renderer', 'canvas.js'));
const deskH  = rd(path.join(root, 'stride-vst', 'app', 'renderer', 'index.html'));

// ── 1. WRAPPER ONLY. canvas.js is shared with the desktop app. ──
ok('reptile.js bails out unless it is the wrapper', /if \(!window\.__STRIDE_WRAPPER__\) return;/.test(rep));
ok('compact.js bails out unless it is the wrapper', /if \(!window\.__STRIDE_WRAPPER__\) return;/.test(comp));
ok('desktop UI never loads either layer',
   !/reptile\.js/.test(deskH) && !/compact\.js/.test(deskH));
ok('both load AFTER canvas.js so the accessors exist',
   indexH.indexOf('canvas.js') < indexH.indexOf('reptile.js') &&
   indexH.indexOf('canvas.js') < indexH.indexOf('compact.js'));

// ── 2. COMPACT IS A VIEW, NOT A SECOND STATE ──
ok('canvas.js exposes a READ-ONLY snapshot', /window\.sdCompactSnapshot = function \(\)/.test(canvas));
ok('snapshot carries what a card needs (name/device/lock/colour/range/points)',
   /name: p\.name/.test(canvas) && /device: p\.device \|\| ''/.test(canvas) &&
   /locked: !!p\.locked/.test(canvas) && /rgb: sdLaneColor\(p, i\)/.test(canvas) &&
   /points: p\.points/.test(canvas));
ok('snapshot carries the engine playhead + curve epoch, not a private clock',
   /phase: _sdEngPhase/.test(canvas) && /epoch: _sdCurveEpoch/.test(canvas));
ok('the card grid never writes lane state (no assignment into a lane from compact.js)',
   !/\.points\s*=/.test(comp) && !/\.locked\s*=/.test(comp) && !/sdCanvasParams/.test(comp));
ok('card lock uses the REAL existing action, not a private lock concept',
   /window\.sdToggleLockLane\(c\.p\.id\)/.test(comp));
ok('ranged lanes are mapped through their band exactly like the drive does',
   /p\.rangeOn \? \(p\.rangeMin \+ v \* \(p\.rangeMax - p\.rangeMin\)\) : v/.test(comp));

// ── 3. THE MINI MOTION WINDOW (the point of the mode) ──
ok('the lane travels through a clipped viewport under a fixed centre playhead',
   /translate\(\$\{\(MVP_W \/ 2 - ph \* LOOP_W\)/.test(comp));
ok('three copies make the loop seamless at both edges',
   /class="s0"/.test(comp) && /class="s1"/.test(comp) && /class="s2"/.test(comp));
ok('the window is clipped and edge-masked, not a floating sparkline',
   /overflow:hidden/.test(indexH) && /\.sdc-w::after/.test(indexH));
ok('curve geometry is drawn from the REAL lane points', /function lanePath\(p, w, h\)/.test(comp) &&
   /laneValue\(p, t\)/.test(comp));
ok('curve edits redraw paths IN PLACE (no DOM teardown mid-drag)',
   /function drawCurves\(\)/.test(comp) && /snap\.epoch !== lastEpoch/.test(comp));

// ── 4. CARDS STAY SIMPLE (no mini-Stride per card) ──
ok('cards carry knob + lock + curve + menu and no shape/motion tools',
   !/MIRROR|MUTATE|CHAOS|NEURO|REFLECTOR|PRISM|BLOOM/i.test(comp));

// ── 5. CPU: both layers park ──
ok('reptile parks its loop when the mode is off',
   /if \(st\.on \|\| anim\.length \|\| st\.tongue\.phase !== 'idle' \|\| st\.contact\.at\) kick\(\);/.test(rep));
ok('reptile skips DOM writes when nothing moved', /if \(tx !== lastTx\)/.test(rep));
ok('compact drops off rAF when the transport is stopped',
   /if \(snap && snap\.playing\) kick\(\);\s*\n\s*else raf = setTimeout/.test(comp));
ok('compact skips knob writes when the rounded value did not change', /if \(q !== c\.lv\)/.test(comp));

// ── 6. Z-ORDER / CLICK-THROUGH ──
ok('the character layer never intercepts clicks', /id = 'sd-rep-layer'[\s\S]{0,220}pointer-events:none/.test(rep));
ok('the character zone never intercepts clicks', /id = 'sd-rep-zone'[\s\S]{0,220}pointer-events:none/.test(rep));

// ── 7. WINDOW BOUNDS: grow the editor, do not steal canvas ──
ok('the page asks the host for a character zone', /window\.sdReptileZoneRequest = function \(h\)/.test(shim) &&
   /emit\('reptileZone'/.test(shim));
ok('the editor grows by exactly the zone height and restores it', /"reptileZone"/.test(editor) &&
   /setSize \(getWidth\(\), h > 0 \? base \+ h : base\)/.test(editor));
ok('the pre-zone height is remembered for restore', /int repZoneH = 0, preRepH = 0;/.test(edH));
ok('the zone request is clamped (a bad value can never resize the plugin absurdly)',
   /juce::jlimit \(0, 400, \(int\) v\.getProperty \("h", 0\)\)/.test(editor));

// ── 8. ENTRY POINTS: the existing Compact control keeps its meaning ──
ok('the prototype view switch is a SEPARATE dev control', /id="sd-devcompact-btn"/.test(indexH) &&
   /DEV: parameter-card view/.test(indexH));
ok('the existing Compact button still calls its own function untouched',
   /onclick="window\.toggleCompactMode && window\.toggleCompactMode\(\)"/.test(indexH));
ok('the reptile trigger is unlabelled and low-emphasis (easter egg, not a feature)',
   /id = 'sd-rep-trigger'/.test(rep) && /trigger\.title = '';/.test(rep)
   && /opacity:\.28/.test(rep)
   && !/textContent\s*=\s*['"][^'"]*[Rr]eptile/.test(rep));   // no visible label anywhere on it

// ── 9. SWAPPABLE ART, normalized anchors ──
ok('art is a descriptor with normalized anchors, not hard-coded numbers',
   /const REP_ART = \{/.test(rep) && /EDGE: 661/.test(rep) && /MOUTH: \[/.test(rep));
ok('art can be replaced at runtime without touching layout', /setArt: \(o\)/.test(rep));
ok('the three states ship as separate resources, not baked into the JS',
   /ui\/reptile_idle\.webp/.test(cmake) && /ui\/reptile_blink\.webp/.test(cmake) &&
   /ui\/reptile_blep\.webp/.test(cmake) && !/data:image\/webp;base64/.test(rep));
ok('the new layers are registered as binary data', /ui\/reptile\.js/.test(cmake) && /ui\/compact\.js/.test(cmake));
ok('webp is served with the right mime type', /endsWithIgnoreCase \(".webp"\)  \? "image\/webp"/.test(editor));

// ── 10. NO PRODUCT BEHAVIOUR TOUCHED ──
ok('no DSP / mapping / transport / serialization words appear in either layer',
   !/processBlock|setStateInformation|apply_inject|set_range|set_speed|set_lock\b/.test(rep + comp));
ok('canvas.js addition is additive only (accessors, no mutation)',
   /sdCompactSnapshot[\s\S]{0,900}return \{/.test(canvas));

console.log('  ' + passed + ' passed, ' + failed + ' failed');
process.exit(failed ? 1 : 0);
