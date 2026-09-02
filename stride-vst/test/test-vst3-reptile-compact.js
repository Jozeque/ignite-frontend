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
   /translate\(\$\{\(MVP_W \/ 2 - lph \* LOOP_W\)/.test(comp));
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
   /const REP_SETS = \[/.test(rep) && /EDGE: 661/.test(rep) && /MOUTH: \[/.test(rep));
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
ok('art anchors are named per-set fields, not magic numbers', /int edge = 383;/.test(ovl) && /kVisibleH/.test(ovl));
ok('PNG copies exist for the native overlay (JUCE cannot decode WebP)',
   /ui\/rep_idle\.png/.test(cmake) && /loadPng \("rep_idle\.png"\)/.test(ovl));
// activate() used to always raise the IN-WINDOW creature, so choosing floating while he
// was off recorded the preference and then stood him inside Stride anyway.
ok('turning him on HONOURS where he lives',
   /if \(st\.floating\) \{[\s\S]{0,360}sdReptileFloatRequest\(true, st\.scaleMul, charIdx\)/.test(rep) &&
   /floating: true/.test(rep));
ok('choosing a home while he is off only records it, and activate applies it',
   /if \(!st\.on\) \{ paintTrigger\(\); return; \}/.test(rep));
ok('turning the mode off also tears the floating window down',
   /sdReptileFloatRequest && window\.sdReptileFloatRequest\(false\)/.test(rep));
ok('only one creature at a time: floating hides the in-window one and gives the strip back',
   /gRep\.setAttribute\('opacity', '0'\);[\s\S]{0,120}requestZone\(0\)/.test(rep));

// ── 9c. HOLDING THE WINDOW ──
// "he is holding Stride and you can see Ableton behind him". Achieved WITHOUT any
// z-order manipulation: one always-on-top window that refuses to paint over Stride's
// own rectangle, so the plugin occludes him exactly as if he were behind it.
ok('the overlay clips Stride out of its own painting instead of covering it',
   /excludeClipRegion \(editorLocal\.withTrimmedTop \(gripPx \(s\)\)\)/.test(ovl));
ok('the clip rect is recomputed from the live editor bounds, never cached stale',
   /editorLocal = local; repaint\(\);/.test(ovl) && /b\.translated \(-want\.getX\(\), -want\.getY\(\)\)/.test(ovl));
// A FIXED inset cut his claws off: everything the art draws below the wrist has to land on
// Stride, and how much that is depends on his scale (field report 2026-08-19).
// Two goes at this. The wrist has to land ON the window's top edge - the line where Stride
// begins - with ONLY the hand carrying on below it. Offsetting the art by the grip as well
// put the wrist exactly on the clip boundary, which clipped the whole hand away.
ok('the wrist lands on the window edge, so the body is cut exactly there',
   /const int y = b\.getY\(\) - juce::roundToInt \(cur\(\)\.edge \* s\);/.test(ovl) &&
   !/b\.getY\(\) \+ gripPx/.test(ovl));
ok('the hand below it is spared by the clip, measured to the lowest row the ART draws',
   /int gripPx \(float s\) const noexcept/.test(ovl) &&
   /sets\[1\]\.hand = 420/.test(ovl) &&
   /juce::roundToInt \(\(float\) \(cur\(\)\.hand - cur\(\)\.edge\) \* s\) \+ kGripPad/.test(ovl) &&
   /excludeClipRegion \(editorLocal\.withTrimmedTop \(gripPx \(s\)\)\)/.test(ovl));
ok('frames CROSS-DISSOLVE - the open mouth is an alternative frame, not a layer',
   /g\.setOpacity \(1\.0f - openAmt\);\s*\n\s*g\.drawImage \(cur\(\)\.idle/.test(ovl) &&
   /imgIdle\.setAttribute\('opacity', \+\(1 - op\)\.toFixed\(3\)\)/.test(rep));
ok('the strike frame is the one with NO painted tongue',
   /open  = loadPng \("rep_open\.png"\)/.test(ovl) && /tongueExt \* 2\.2f/.test(ovl) &&
   /ui\/rep_open\.png/.test(cmake) && /ui\/reptile_open\.webp/.test(cmake) &&
   /open:  'reptile_open\.webp'/.test(rep));
ok('the in-window creature opens the same tongue-free mouth',
   /id="sdRepOpen"/.test(rep) && /imgOpen\.setAttribute\('opacity', op\)/.test(rep) &&
   /st\.tongue\.ext \* 2\.2/.test(rep));
ok('he scales with the window between a readable floor and a capped ceiling',
   /kSpanOfWindow/.test(ovl) && /juce::jlimit \(kVisibleH \/ \(float\) cur\(\)\.edge,/.test(ovl) &&
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
// ── LANE SPEED ON THE CARD (2026-08-20) ──
ok('speed sits beside the lock and the range',
   /class="sdc-lk"[\s\S]{0,600}class="sdc-rg[\s\S]{0,400}class="sdc-sp/.test(comp) && /\.sdc-sp\{/.test(indexH));
ok('it steps the SAME ladder through the same engine push',
   /window\.sdCompactSetSpeed = function \(envelopeId, dir\)/.test(canvas) &&
   /SD_SPEED_LADDER\[i\]/.test(canvas) && /_sdPushSpeedToEngine\(p\)/.test(canvas));
ok('clicking steps up and wraps, so every rate is reachable; right-click restores 1X',
   /\(_sdSpeedIdx\(cur\) \+ dir \+ n\) % n/.test(canvas) &&
   /\(dir === 0\) \? _sdSpeedIdx\(1\)/.test(canvas) &&
   /sp\.addEventListener\('click', \(\) => step\(1\)\)/.test(comp) &&
   /contextmenu[\s\S]{0,60}step\(0\)/.test(comp));
ok('the label is formatted ONCE, in canvas.js, so both views word a rate the same',
   /speedLabel: _sdSpeedLabel\(/.test(canvas) && /p\.speedLabel \|\| '1X'/.test(comp) &&
   !/1\/2|SD_SPEED_LADDER/.test(comp));
ok('a rate other than 1X is visibly lit', /\.sdc-sp\.on\{color:var\(--lc\)\}/.test(indexH) &&
   /\(p\.speed && p\.speed !== 1\) \? ' on' : ''/.test(comp));
ok('the card re-keys when a speed changes', /\(typeof p\.speed === 'number' \? p\.speed : 1\)/.test(canvas));
// The knob rode the SHARED playhead, so it moved at 1X whatever rate the lane was set to
// (field report 2026-08-20). It now mirrors the engine's own drive:
// fmod(ph * speed, laneLoop) - which also picks up per-lane loop boundaries.
ok('a card runs on the LANE clock, not the shared playhead',
   /function lanePhase\(p, ph, bars\)/.test(comp) &&
   /let lx = \(ph \* cb \* spd\) % lL;/.test(comp) &&
   /const lph = lanePhase\(c\.p, ph, snap\.bars\)/.test(comp));
ok('the knob AND the travelling curve both use it, so they agree',
   /laneValue\(c\.p, lph\)/.test(comp) && /MVP_W \/ 2 - lph \* LOOP_W/.test(comp));
ok('per-lane loop boundaries reach the card too', /loopBeats: \(typeof p\.loopBeats === 'number'/.test(canvas) &&
   /p\.loopBeats > 0\.01\) \? p\.loopBeats : cb/.test(comp));

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
   /window\.sdToggleLaneSelection\(d\.c\.p\.id\)/.test(comp) && /\.sdc\.sel\{/.test(indexH));
ok('selection state reaches the cards through the snapshot',
   /selected: !!p\.selected/.test(canvas) && /p\.selected \? ' sel' : ''/.test(comp));
ok('one gesture, split by travel: a few px is a click, past that it is a drag',
   /if \(Math\.abs\(e\.clientX - d\.x\) \+ Math\.abs\(e\.clientY - d\.y\) < 6\) return;/.test(comp) &&
   /if \(d\.moved\) \{/.test(comp));
ok('controls inside the card keep their own gestures',
   /e\.target\.closest\('button, \.sdk'\)/.test(comp));
// Moving the element that HOLDS a pointer capture drops the capture, which killed the
// drag after its first reorder (field report 2026-08-19).
ok('the drag listens on the window, not on a capture the reorder would drop',
   /window\.addEventListener\('pointermove', dragMove\)/.test(comp) &&
   !/setPointerCapture[\s\S]{0,200}insertBefore/.test(comp));
ok('the card lifts out of the grid and rides the cursor',
   /el\.style\.position = 'fixed'/.test(comp) && /el\.style\.left = \(e\.clientX - d\.ox\)/.test(comp));
ok('a placeholder holds the slot, so the grid never reflows under the pointer',
   /d\.ph\.className = 'sdc-ph'/.test(comp) && /wrap\.insertBefore\(d\.ph,/.test(comp) &&
   /\.sdc-ph\{/.test(indexH));
ok('the lifted card is transparent to the pointer while it rides',
   /el\.style\.pointerEvents = 'none'/.test(comp));
ok('a card drag also freezes the grid rebuild', /if \(drag \|\| cardDrag\) \{/.test(comp));
ok('the dropped DOM order is what gets committed',
   /wrap\.querySelectorAll\('\.sdc'\), n => n\.getAttribute\('data-id'\)/.test(comp) &&
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
ok('project state carries the order attrs and old projects stay inert (v9 od, now v10 with the bridge blob)',
   (/root\.setAttribute \("version", (\d+)\)/.test(proc) && parseInt(RegExp.$1, 10) >= 10) &&
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

// ── 9f. A LANE OWNS ITS COLOUR ──
// AUTO colours rotate by POSITION, so dragging a card repainted the lane you moved.
ok('auto colour follows the LANE, not its slot in the grid',
   /return sdLaneRGB\(param && typeof param\.autoIdx === 'number' \? param\.autoIdx : paramIdx\);/.test(canvas) &&
   /function _sdFreezeAutoColorSlots/.test(canvas));
ok('the auto slots are frozen BEFORE any saved order is applied, so a reload matches',
   /_sdFreezeAutoColorSlots\(\);[\s\S]{0,200}_sdApplyOrderEcho\(\)/.test(canvas));
ok('reordering does not touch the colour fields at all',
   !/sdCompactSetOrder = function[\s\S]{0,900}(colorIdx|autoIdx)\s*=/.test(canvas));

// ── 9g. A LICK AT WHATEVER JUST GOT MAPPED ──
ok('a freshly mapped lane is announced, and a big jump stays silent',
   /sd-lane-mapped/.test(canvas) && /fresh\.length && fresh\.length <= 2/.test(canvas));
// He was aiming at the wrong lane: the id-diff called an old lane new whenever the mapping
// renumbered, and looking for the card ONCE fell back to lane geometry that is stale (and
// zero-sized) while compact is showing (field report 2026-08-20).
ok('a new lane is identified by device+name, not by the positional id',
   /const _sdLaneIdentity = \(p\) => \(p\.device \|\| ''\) \+ '\|' \+ p\.name;/.test(canvas) &&
   /sdCanvasParams\.filter\(p => !before\[_sdLaneIdentity\(p\)\]\)/.test(canvas) &&
   !/const fresh = ids\.filter/.test(canvas));
ok('lane geometry is refused when the canvas is hidden or the lane is gone',
   /if \(r\.width < 2 \|\| r\.height < 2\) return null;/.test(canvas) &&
   /if \(!sdCanvasParams\.some\(p => p\.envelopeId === envelopeId\)\) return null;/.test(canvas));
ok('a card in a hidden grid is not a target',
   /card && card\.offsetParent !== null/.test(rep));
ok('he WAITS for the real target instead of pointing at whatever is there',
   /function lickAt\(id, tries, prev\)/.test(rep) && /setTimeout\(\(\) => lickAt\(id, left\), 90\)/.test(rep));
ok('and says nothing at all if the target never appears',
   /if \(left > 0\) setTimeout/.test(rep));
// Mapping a lane INSERTS a card and reflows every card after it, so the first position the
// new card reports is often already stale - measured at 208px of drift (2026-08-20).
ok('he waits for the grid to SETTLE: the same position twice before striking',
   /Math\.abs\(prev\[0\] - t\[0\]\) > 2 \|\| Math\.abs\(prev\[1\] - t\[1\]\) > 2/.test(rep) &&
   /setTimeout\(\(\) => lickAt\(id, left, t\), 90\)/.test(rep));
ok('and keeps following the card while the tongue is out',
   /function trackTarget\(id\)/.test(rep) && /window\.sdReptileAim\(t\[0\], t\[1\]\)/.test(rep) &&
   /st\.tongue\.target = t; kick\(\)/.test(rep));
ok('re-aiming moves a tongue in flight and can never start one',
   /void aimAt \(juce::Point<int> screenPoint\)/.test(ovl) &&
   /if \(tonguePhase == 0\) return;/.test(ovl) && /"reptileAim"/.test(editor) &&
   /window\.sdReptileAim    = function/.test(shim));
ok('page coords become screen coords through the editor, not by adding to its origin',
   /repOverlay->strikeAt \(localPointToGlobal \(juce::Point<int> \(x, y\)\)\)/.test(editor) &&
   /repOverlay->aimAt \(localPointToGlobal \(juce::Point<int> \(x, y\)\)\)/.test(editor));
// ── TOUCH A KNOB IN A PLUGIN, HE POINTS AT ITS LANE ──
// Rides the EXISTING param-touch glow (pendingGlowPos -> param_glow), so there is no second
// notion of "the user touched this knob" to keep in step with the first.
ok('the touch announcement comes off the existing glow, not a new signal',
   /param_glow/.test(canvas) && /sd-lane-touched/.test(canvas) &&
   /dispatchEvent\(new CustomEvent\('sd-lane-touched'/.test(canvas));
ok('he points at the touched lane', /window\.addEventListener\('sd-lane-touched'/.test(rep));
ok('a knob DRAG cannot make him chatter: one lane, and not over a tongue already out',
   /if \(id == null \|\| tongueBusy\(\)\) return;/.test(rep) &&
   /String\(id\) === lastPointId && now - lastPointAt < 4000/.test(rep) &&
   /const tongueBusy = \(\) => \(performance\.now\(\) < tongueBusyUntil \|\| st\.tongue\.phase !== 'idle'\)/.test(rep));
ok('the floating tongue counts as busy too, though its state lives in C++',
   /tongueBusyUntil = performance\.now\(\) \+ 950;/.test(rep));
ok('a lane he just pointed at for being MAPPED is not pointed at twice',
   /lastPointId = String\(id\); lastPointAt = performance\.now\(\);/.test(rep));

ok('the character points at the new lane in whichever view is showing',
   /#sd-compact \.sdc\[data-id=/.test(rep) && /window\.sdLaneScreenPoint/.test(rep) &&
   /window\.sdLaneScreenPoint = function/.test(canvas));
ok('the floating one licks through the host; the in-window one uses its own tongue',
   /if \(st\.floating\) \{ try \{ window\.sdReptileStrike/.test(rep) && /else strikeAt\(t\[0\], t\[1\]\)/.test(rep));
ok('the host turns page coords into screen coords through the editor',
   /reptileStrike/.test(editor) && /localPointToGlobal \(juce::Point<int> \(x, y\)\)/.test(editor));
ok('the tongue is drawn OUTSIDE the clip, so it reaches in front of the window',
   /juce::Graphics::ScopedSaveState body \(g\)/.test(ovl) &&
   /tongueExt > 0\.002f/.test(ovl) && /cur\(\)\.mouthX/.test(ovl));
// It read as "a string coming out of his mouth" when it was a stroked line with a blob on
// the end. It is now the same tapered-ribbon construction the in-window SVG creature uses.
ok('the tongue is a tapered RIBBON on a bezier, not a stroked line',
   /juce::Point<float> top\[N \+ 1\], bot\[N \+ 1\]/.test(ovl) &&
   /w = base \* \(1\.0f - 0\.72f \* t\)/.test(ovl) && /fillPath \(path\)/.test(ovl));
ok('it swells into a spade and then FORKS', /base \* 0\.34f \* std::sin/.test(ovl) &&
   /const auto notch = E \+ endD \* \(fl \* 0\.12f\)/.test(ovl) &&
   /path\.lineTo \(tipL\);[\s\S]{0,120}path\.lineTo \(notch\);[\s\S]{0,120}path\.lineTo \(tipR\);/.test(ovl));
ok('the fork sits on the spine end tangent, or it twists into a one-sided hook',
   /if \(i == N\) \{ endD = \{ d\.x \/ l, d\.y \/ l \}; endU = u; \}/.test(ovl) &&
   /E \+ endD \* fl \+ endU \* spread/.test(ovl));
// The open-mouth artwork has a tongue PAINTED INTO IT, so showing it while the drawn
// tongue is out gave him two tongues at once (field report 2026-08-19).
ok('a strike never raises the painted-tongue frame',
   !/tonguePhase = 1;[\s\S]{0,200}bleping = true/.test(ovl));
ok('the idle blep pose waits until the drawn tongue is back in, in both layers',
   /r < 78 && tonguePhase == 0/.test(ovl) &&
   /if \(st\.tongue\.phase !== 'idle' \|\| st\.tongue\.ext > 0\.001\) return;/.test(rep));
ok('it WHIPS: the body lags while travelling and settles as it lands',
   /const float travel = 1\.0f - tongueExt;/.test(ovl) &&
   /sag = \(24\.0f \+ wob \* 22\.0f\)[\s\S]{0,80}travel\)/.test(ovl));
ok('the window grows to reach the target, and shrinks back after',
   /if \(tonguePhase != 0\)[\s\S]{0,200}getUnion/.test(ovl) &&
   /tonguePhase = 0; tongueExt = 0\.0f; follow\(\);/.test(ovl));
ok('switching him off cancels a tongue in flight', /tonguePhase = 0; tongueExt = 0\.0f; setVisible \(false\)/.test(ovl));

// ── 9h2. TWO CHARACTERS, SWITCHABLE ──
// "can it be revertable easily?" - yes: the second set is an ALTERNATIVE, not a
// replacement, and switching is one click each way.
ok('anchors travel WITH the art, they are not shared constants',
   /struct CharSet/.test(ovl) && /int edge = 383;/.test(ovl) && /int mouthX = 215, mouthY = 239;/.test(ovl) &&
   !/static constexpr int   kArtEdge/.test(ovl));
// The tongue has to leave from the mouth of whoever is on screen. The second character's
// mouth sits ~117px lower and ~32px left of the first's, so a shared anchor put his tongue
// on the bridge of his nose (field report 2026-08-19).
ok('the second character has its OWN mouth, not the first one\'s',
   /sets\[1\]\.mouthX = 183; sets\[1\]\.mouthY = 356;/.test(ovl) &&
   /MOUTH: \[316, 615\]/.test(rep) &&
   !/sets\[1\][\s\S]{0,40}mouthX = 215/.test(ovl));
ok('both sets are loaded, each with its own anchors',
   /sets\[0\]\.edge = 383; sets\[0\]\.hand = 420/.test(ovl) &&
   /sets\[1\]\.edge = 389; sets\[1\]\.hand = 420/.test(ovl) &&
   /loadPng \("rep2_idle\.png"\)/.test(ovl));
ok('the second set has no painted-tongue frame, so its open mouth doubles as the pose',
   /sets\[1\]\.blep  = sets\[1\]\.open;/.test(ovl));
ok('every draw and every anchor reads the CURRENT set',
   /cur\(\)\.idle/.test(ovl) && /cur\(\)\.edge/.test(ovl) && /cur\(\)\.mouthX/.test(ovl) &&
   /const CharSet& cur\(\) const noexcept/.test(ovl));
ok('switching cancels a tongue in flight (his mouth is somewhere else now)',
   /void setCharacter \(int i\)[\s\S]{0,300}tonguePhase = 0; tongueExt = 0\.0f;/.test(ovl));
ok('the page keeps its own switchable sets, and layout reads only the active one',
   /const REP_SETS = \[/.test(rep) && /const REP_ART = Object\.assign\(\{\}, REP_SETS\[0\]\)/.test(rep) &&
   /reptile2_idle\.webp/.test(rep) && /EDGE: 672/.test(rep));
ok('the choice rides the bridge and is remembered',
   /c: \(typeof c === 'number' \? c : 0\)/.test(shim) && /prefsWrite\('repChar', v\)/.test(shim) &&
   /repOverlay->setCharacter \(\(int\) v\.getProperty \("c", 0\)\)/.test(editor));
ok('adopting a saved character does not write it straight back',
   /setCharacter\(v, false\);/.test(rep));
ok('there is a one-click switch, and it says which character is on',
   /Switch character/.test(rep) && /setCharacter\(\(charIdx \+ 1\) % REP_SETS\.length\)/.test(rep) &&
   /'Character: ' \+ REP_SETS\[charIdx\]\.name/.test(rep));
ok('both new sets ship as resources', /ui\/rep2_idle\.png/.test(cmake) &&
   /ui\/rep2_open\.png/.test(cmake) && /ui\/reptile2_idle\.webp/.test(cmake));

// ── 9h. SIZE ──
ok('he is smaller by default and the stature is still capped',
   /kVisibleH = 132\.0f/.test(ovl) && /kMaxVisibleH = 232\.0f/.test(ovl));
ok('size is a clamped multiplier the host applies to his scale',
   /void setScaleMul \(float m\)/.test(ovl) && /juce::jlimit \(0\.55f, 1\.5f, m\)/.test(ovl) &&
   /scaleMul \* juce::jlimit/.test(ovl));
ok('the resizer shows only while he is actually out there',
   /sizeBtns\.forEach\(b => \{ b\.style\.display = st\.floating \? 'block' : 'none'; \}\)/.test(rep));
ok('size persists through the prefs FILE, not localStorage alone',
   /window\.sdReptileScaleSave = function \(v\) \{ try \{ prefsWrite\('repScale', v\)/.test(shim) &&
   /window\.sdReptileScaleAdopt/.test(shim) && /window\.sdReptileScaleAdopt = function/.test(rep));
ok('adopting a saved size does not write it straight back',
   /Adopted from the prefs file on boot: take the value, do NOT write it back/.test(rep));

// ── 9i. THE VIEW YOU LEFT IN, AND A WINDOW YOU CAN STILL RESIZE ──
// Two field reports: reopening Stride always landed on the lane canvas, and while the
// character was on the window could not be made smaller.
ok('the view you were in is remembered',
   /window\.sdCompactSave/.test(comp) && /prefsWrite\('compactOn', !!v\)/.test(shim) &&
   /window\.sdCompactAdopt\(_natPrefs\.compactOn\)/.test(shim));
ok('restoring it is SILENT - it must not read as the user choosing it',
   /function setCompact\(v, silent\)/.test(comp) && /if \(!silent\)/.test(comp) &&
   /setCompact\(true, true\);/.test(comp));
ok('the restore lands whichever side of DOMContentLoaded the prefs arrive on',
   /function applyPending\(\)/.test(comp) && /if \(!wrap && !mount\(\)\) return;/.test(comp) &&
   /boot\(\) \{\s*\n\s*mount\(\);\s*\n\s*applyPending\(\);/.test(comp));
ok('it is adopted ONCE, so it can never overrule a later choice of yours',
   /if \(adopted \|\| pendingOn === null\) return;/.test(comp) && /adopted = true;/.test(comp));

// The strip is what the IN-WINDOW creature stands in. Floating costs Stride no height, so
// reporting a strip while floating made every resize re-request one - and the host pinned
// the window to the height captured when it opened.
ok('the strip is zero while he is floating',
   /\(st\.on && !st\.floating\) \? Math\.round\(REP_ART\.EDGE \* st\.scale\) \+ 4 : 0/.test(rep));
ok('a resize only re-requests the strip for the in-window creature',
   /if \(st\.on && !st\.floating\) requestZone\(zoneH\(\)\)/.test(rep));
ok('the pre-strip height follows the USER resizing, instead of freezing when it opened',
   /if \(repZoneH > 0\) preRepH = juce::jmax \(120, getHeight\(\) - repZoneH\);/.test(editor));
ok('re-requesting the strip already showing changes nothing (no fight over the height)',
   /if \(want != repZoneH\)\s*\n\s*\{\s*\n\s*repZoneH = want;/.test(editor));

// ── 10. NO PRODUCT BEHAVIOUR TOUCHED ──
ok('no DSP / mapping / transport / serialization words appear in either layer',
   !/processBlock|setStateInformation|apply_inject|set_range|set_speed|set_lock\b/.test(rep + comp));
ok('the canvas.js additions are a snapshot plus thin wrappers over existing paths',
   /sdCompactSnapshot[\s\S]{0,900}return \{/.test(canvas) &&
   /_sdPushRangeToEngine|_sdRangeSetPercent/.test(canvas));

console.log('  ' + passed + ' passed, ' + failed + ' failed');
process.exit(failed ? 1 : 0);
