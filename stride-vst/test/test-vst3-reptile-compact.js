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
ok('the editor grows by the granted zone height and restores it', /"reptileZone"/.test(editor) &&
   /setSize \(getWidth\(\), want > 0 \? base \+ want : base\)/.test(editor));
// 2026-08-19: a tall window shoved Stride off the bottom of the display. The host now
// grants only what fits and reports it back, and the character scales to what it got.
ok('the grant is clamped to the display work area',
   /jmin \(want, disp->userArea\.getHeight\(\) - 80 - base\)/.test(editor));
ok('the granted height is reported back to the page', /"reptileZoneState"/.test(editor) &&
   /window\.sdReptileZoneGranted/.test(shim));
ok('the character scales to the GRANTED strip, not the request',
   /window\.sdReptileZoneGranted = function \(h\)/.test(rep) && /zoneGot \/ REP_ART\.EDGE/.test(rep));
ok('character size is fixed, not window-relative (small window made it a speck)',
   /const ZONE_WANT = 152;/.test(rep) && !/h \* 0\.22/.test(rep));
// The fixed-232px track that replaced the original stretch left a dead margin down both
// sides of the grid (field report 2026-08-19). Tracks fill the width again, but a card
// now has BOTH a floor (readable) and a ceiling (never a poster).
ok('the card grid fills the width instead of parking a margin down each side',
   /grid-template-columns:repeat\(auto-fill,minmax\(204px,1fr\)\)/.test(indexH) &&
   !/#sd-compact\{[^}]*justify-content:center/.test(indexH));
ok('a card still cannot grow into a poster or shrink below readable',
   /max-width:300px/.test(indexH) && /minmax\(204px/.test(indexH));
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

// ── 9b. FLOATING OVERLAY (opt-in). This is the risky one: the codebase already has an
//        open always-on-top focus bug, so the guards matter more than the feature. ──
const ovl = rd(path.join(W, 'src', 'ReptileOverlay.h'));
ok('the floating window is OPT-IN and defaults off', /bool  active = false/.test(ovl) &&
   /getProperty \("on", false\)/.test(editor));
ok('nothing is created until it is switched on', /if \(repOverlay == nullptr\) repOverlay = std::make_unique<ReptileOverlay>/.test(editor) &&
   /repOverlay\.reset\(\);/.test(editor));
// strip comments: the header explains what it deliberately does NOT call, and a naive
// negative match would fail on the explanation rather than on any real call
const ovlCode = ovl.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');
ok('it can never take focus', /setWantsKeyboardFocus \(false\)/.test(ovlCode)
   && !/grabKeyboardFocus/.test(ovlCode) && !/toFront/.test(ovlCode));
ok('it is transparent to the mouse twice over (peer flag + hit test)',
   /windowIgnoresMouseClicks/.test(ovl) && /bool hitTest \(int, int\) override \{ return false; \}/.test(ovl)
   && /setInterceptsMouseClicks \(false, false\)/.test(ovl));
ok('it HIDES whenever our app is not in front (the focus-bug mitigation)',
   /juce::Process::isForegroundProcess\(\)/.test(ovl));
ok('it hides when the editor is not showing', /target\.isShowing\(\)/.test(ovl));
ok('it follows the editor rather than owning a position', /target\.getScreenBounds\(\)/.test(ovl));
ok('art anchors are named constants, not magic numbers', /kArtEdge = 383/.test(ovl) && /kVisibleH/.test(ovl));
ok('PNG copies exist for the native overlay (JUCE cannot decode WebP)',
   /ui\/rep_idle\.png/.test(cmake) && /loadPng \("rep_idle\.png"\)/.test(ovl));
ok('turning the mode off also tears the floating window down',
   /sdReptileFloatRequest && window\.sdReptileFloatRequest\(false\)/.test(rep));
ok('only one creature at a time: floating hides the in-window one and gives the strip back',
   /gRep\.setAttribute\('opacity', '0'\);[\s\S]{0,120}requestZone\(0\)/.test(rep));

// ── 9c. HOLDING THE WINDOW ──
// "he is holding Stride and you can see Ableton behind him". Achieved WITHOUT any
// z-order manipulation: one always-on-top window that refuses to paint over Stride's
// own rectangle, so the plugin occludes him exactly as if he were behind it.
ok('the overlay clips Stride out of its own painting instead of covering it',
   /excludeClipRegion \(editorLocal\.withTrimmedTop \(kGrip\)\)/.test(ovl));
ok('the clip rect is recomputed from the live editor bounds, never cached stale',
   /editorLocal = local; repaint\(\);/.test(ovl) && /b\.translated \(-want\.getX\(\), -want\.getY\(\)\)/.test(ovl));
ok('his fingers overlap the frame so he reads as gripping it, not perching on it',
   /kGrip = 13/.test(ovl) && /b\.getY\(\) \+ kGrip - juce::roundToInt \(kArtEdge \* s\)/.test(ovl));
ok('he scales with the window between a readable floor and a capped ceiling',
   /kSpanOfWindow/.test(ovl) && /juce::jlimit \(kVisibleH \/ \(float\) kArtEdge,/.test(ovl) &&
   /kMaxVisibleH/.test(ovl));
ok('no z-order fighting: the illusion never reorders windows',
   !/SetWindowPos|orderWindow|toBehind/.test(ovlCode));

// ── 9d. RANGE ON THE CARD (Serum-style ring) ──
// The band already exists as a lane feature; the card must REACH it, never re-implement
// it. Every gesture here lands in canvas.js on the same code path the lane canvas uses.
ok('the range control sits next to the lock, as asked',
   /class="sdc-lk"[\s\S]{0,260}class="sdc-rg/.test(comp) && /\.sdc-lk,\.sdc-rg\{/.test(indexH));
ok('the knob ring is the band control and it is draggable',
   /class="khit"/.test(comp) && /pointer-events="stroke"/.test(comp) &&
   /pointerdown/.test(comp) && /cursor:ns-resize/.test(indexH));
ok('the band is legible as a band: an arc on its own radius with both edges marked',
   /class="kcapa"/.test(comp) && /class="kcapb"/.test(comp) && /RR = KR \+ 7\.0/.test(comp) &&
   /\.sdc\.rng \.kticks\{opacity:\.5\}/.test(indexH));
ok('the grabbed boundary is the one nearest the grab, not always the same one',
   /Math\.abs\(av - mn\) <= Math\.abs\(av - mx\) \? 'rangeMin' : 'rangeMax'/.test(comp));
ok('the card mutates nothing itself - every edit goes through canvas.js',
   /window\.sdCompactRangeDrag\(c\.p\.id, edge, pct, phase\)/.test(comp) &&
   /window\.sdCompactToggleRange/.test(comp) &&
   !/\.rangeMin\s*=|\.rangeMax\s*=|\.rangeOn\s*=/.test(comp));
ok('a drag freezes the grid so the rebuild cannot kill the pointer capture',
   /if \(drag \|\| cardDrag\) \{/.test(comp) && /paint\(snap\); lastPhase = snap\.phase;/.test(comp));
ok('range toggling is STRICTLY single-lane (the 2026-08-12 group-wipe lesson)',
   /sdCompactToggleRange = function[\s\S]{0,700}_sdPushRangeToEngine\(p\);/.test(canvas) &&
   !/sdCompactToggleRange = function[\s\S]{0,700}_sdRangeApplyGroup/.test(canvas));
ok('boundary drags keep the canvas group semantics via the existing setter',
   /sdCompactRangeDrag = function[\s\S]{0,900}_sdRangeSetPercent\(p, edge, pct\)/.test(canvas));
ok('range edits are undoable and persisted, like every other band edit',
   /sdCompactToggleRange = function[\s\S]{0,200}pushUndo\(\);/.test(canvas) &&
   /sdCompactRangeDrag = function[\s\S]{0,900}saveCanvasState\(\)/.test(canvas));
ok('the card grid re-keys when a band arms, so the button state cannot go stale',
   /\(p\.rangeOn \? 1 : 0\)/.test(canvas));

// ── 9e. CARD ACTIONS: remove, select, reorder ──
const proc = rd(path.join(W, 'src', 'PluginProcessor.cpp'));
const procH = rd(path.join(W, 'src', 'PluginProcessor.h'));
ok('the ✕ removes the lane through the existing unmap path',
   /class="sdc-x"/.test(comp) && /window\.sdUnmapLane\(c\.p\.id\)/.test(comp));
ok('the ✕ stays quiet until the card is hovered (not a grid of delete buttons)',
   /\.sdc-x\{[^}]*opacity:0/.test(indexH) && /\.sdc:hover \.sdc-x\{opacity:1\}/.test(indexH));
ok('clicking a card SELECTS the lane, so the toolbar motion tools reach it',
   /window\.sdToggleLaneSelection\(c\.p\.id\)/.test(comp) && /\.sdc\.sel\{/.test(indexH));
ok('selection state reaches the cards through the snapshot',
   /selected: !!p\.selected/.test(canvas) && /p\.selected \? ' sel' : ''/.test(comp));
ok('one gesture, split by travel: a few px is a click, past that it is a drag',
   /if \(Math\.abs\(e\.clientX - cardDrag\.x\) \+ Math\.abs\(e\.clientY - cardDrag\.y\) < 6\) return;/.test(comp) &&
   /if \(moved\) \{/.test(comp));
ok('controls inside the card keep their own gestures',
   /e\.target\.closest\('button, \.sdk'\)/.test(comp));
ok('a card drag also freezes the grid rebuild', /if \(drag \|\| cardDrag\) \{/.test(comp));
ok('the dropped DOM order is what gets committed',
   /\[\.\.\.wrap\.querySelectorAll\('\.sdc'\)\]\.map\(el => el\.getAttribute\('data-id'\)\)/.test(comp) &&
   /window\.sdCompactSetOrder\(ids\)/.test(comp));

// Order is ENGINE-OWNED (localStorage is one shared profile across instances - the
// 2026-08-03 lock-leak lesson), but it must NOT renumber the mapping.
ok('order rides as a per-lane attribute; `mapped` is never reordered',
   /int  ord = -1;/.test(procH) && /void StrideWrapperProcessor::setMappedOrders/.test(proc) &&
   !/std::(rotate|sort|swap) \(mapped/.test(proc) && !/mapped\.insert/.test(proc));
ok('one batched lock pass + dirty mark, no re-push (the set_ranges pattern)',
   /setMappedOrders[\s\S]{0,400}hostDirtyPending\.store \(true\)/.test(proc) &&
   !/setMappedOrders[\s\S]{0,400}mapVersion\.fetch_add/.test(proc));
ok('bridge: set_order handled and editLocked-gated',
   /if \(type == "set_order"\)[\s\S]{0,200}isEditLocked\(\)\) return;[\s\S]{0,160}setMappedOrders \(\*arr\)/.test(editor));
ok('the order is echoed back like every other engine-owned lane attribute',
   /getMappedOrders\(\)/.test(editor) && /o->setProperty \("ord", orders\[i\]\)/.test(editor));
ok('project state bumps to v9 and old projects stay inert (absent = natural order)',
   /root\.setAttribute \("version", 9\)/.test(proc) &&
   /if \(m\.ord >= 0\) e->setAttribute \("od", m\.ord\)/.test(proc) &&
   /getIntAttribute \("od", -1\)/.test(proc));
ok('a removed device carries its lanes\' order back on restore',
   /std::vector<int> ord;/.test(procH) && /d\.ord\.push_back \(m\.ord\)/.test(proc) &&
   /k < d\.ord\.size\(\) \? d\.ord\[k\] : -1/.test(proc));
ok('canvas: an explicit order wins over the name sort, unranked lanes go last',
   /_sdApplyOrderEcho\(\)/.test(canvas) && /ranked\.concat\(sdCanvasParams\.filter/.test(canvas));
ok('canvas: a bad id list is REFUSED rather than scrambling the lanes',
   /if \(seq\.length !== vis\.length\) return;/.test(canvas));
ok('canvas: lanes hidden by a device filter keep the slots they hold',
   /sdCanvasParams\.map\(p => \(visible\.indexOf\(p\) >= 0 \? seq\[k\+\+\] : p\)\)/.test(canvas));

// A hidden canvas measures 0x0, so a resize landing while compact was open left the lane
// view blank on return until a real window resize nudged it (field report 2026-08-19).
ok('leaving compact re-measures the canvas immediately, and again after layout settles',
   /window\.sdResizeCanvasNow = function/.test(canvas) &&
   /else if \(typeof window\.sdResizeCanvasNow === 'function'\)/.test(comp) &&
   /requestAnimationFrame\(\(\) => window\.sdResizeCanvasNow\(\)\)/.test(comp));
ok('the re-measure happens AFTER the container is visible again',
   /host\.style\.display = on \? 'none' : '';[\s\S]{0,400}sdResizeCanvasNow/.test(comp));

// ── 10. NO PRODUCT BEHAVIOUR TOUCHED ──
ok('no DSP / mapping / transport / serialization words appear in either layer',
   !/processBlock|setStateInformation|apply_inject|set_range|set_speed|set_lock\b/.test(rep + comp));
ok('the canvas.js additions are a snapshot plus thin wrappers over existing paths',
   /sdCompactSnapshot[\s\S]{0,900}return \{/.test(canvas) &&
   /_sdPushRangeToEngine|_sdRangeSetPercent/.test(canvas));

console.log('  ' + passed + ' passed, ' + failed + ' failed');
process.exit(failed ? 1 : 0);
