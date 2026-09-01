/**
 * Focus Draw Deck — the drawing overhaul (2026-08-28).
 * Field feedback: "clunky, hard to get usable shapes; starter shapes that snap
 * to grid like Current / Infiltrator."
 *
 * canvas.js is a browser IIFE, so these are STRUCT pins (the style every other
 * canvas suite here uses): they hold the load-bearing shape of the feature —
 * focus-only gating, the deck's claim on the canvas height, snap and stamp
 * plumbing, and the interaction contracts — so a refactor cannot silently
 * drop them.
 *
 * Run: node test/test-focus-draw.js
 */

const fs = require('fs');
const path = require('path');

let passed = 0, failed = 0;
function test(name, fn) {
    try { fn(); console.log(`  ✓ ${name}`); passed++; }
    catch (e) { console.log(`  ✗ ${name}: ${e.message}`); failed++; }
}
function assert(c, m) { if (!c) throw new Error(m || 'assertion failed'); }

const canvas = fs.readFileSync(path.join(__dirname, '..', 'app', 'renderer', 'canvas.js'), 'utf8');
const deck = canvas.slice(canvas.indexOf('FOCUS DRAW DECK'));
assert(deck.length > 1000, 'deck module present');

console.log('\n— focus draw deck: gating —');

test('the deck exists ONLY in focus view with a focused lane (the user\'s hard requirement)', () => {
    assert(/const wants = \(sdViewMode === 'focus'\) && !!sdActiveParamId && sdCanvasParams\.length > 0;/.test(deck), 'visibility formula');
    assert(/window\.sdToggleViewMode = function\(\) \{\s*sdViewMode = sdViewMode === 'multi' \? 'focus' : 'multi';\s*if \(typeof _sdDeckSync === 'function'\) _sdDeckSync\(\);/.test(canvas), 'view toggle syncs the deck');
    assert(/if \(typeof _sdDeckSync === 'function'\) _sdDeckSync\(\);\s*\/\/ the draw deck follows the view/.test(canvas) || /_sdDeckSync\(\);\s+\/\/ the draw deck follows the view \(focus only\)/.test(canvas), 'every redraw re-checks the gate');
    assert(/leaving focus: put every focus-only mode down/.test(deck) && /_sdStampShape = null; _sdStampDrag = null;/.test(deck), 'leaving focus disarms the pen');
});

test('every new gesture is gated on focus view', () => {
    assert(/if \(sdViewMode === 'focus' && _sdStampShape && sdActiveTool !== 'freehand'\) \{/.test(canvas), 'stamp gesture (FREE tool bypasses the armed chip)');
    assert(/if \(e\.shiftKey && sdViewMode === 'focus'\) \{ pushUndo\(\); _sdPaintStepCell\(hd, param, totalBeats\); \}/.test(canvas), 'step draw (mousedown)');
    assert(/if \(e\.shiftKey && sdViewMode === 'focus'\) _sdPaintStepCell\(hd, param, totalBeats\);/.test(canvas), 'step draw (mousemove)');
    assert(/if \(sdViewMode === 'focus' && e\.button === 0 && idx === -1 && _sdHandleRects\.length/.test(canvas), 'segment handles');
    assert(/function _sdDrawFocusOverlays\(param, lw, lh, totalBeats\) \{\s*_sdHandleRects = \[\];\s*if \(sdViewMode !== 'focus'\) return;/.test(deck), 'overlays bail outside focus');
    assert(/if \(!param \|\| sdViewMode !== 'focus'\) return;|sdViewMode !== 'focus'\) \{ sdDrawCanvasGrid\(\); return; \}/.test(deck) || /param\.locked \|\| sdViewMode !== 'focus'\) \{ sdDrawCanvasGrid\(\); return; \}/.test(deck), 'commit refuses outside focus');
    assert(/if \(!param \|\| sdViewMode !== 'focus'\) return;/.test(deck.slice(deck.indexOf('sdRollPattern'))), 'Roll refuses outside focus');
});

console.log('\n— the deck claims its space honestly —');

test('the canvas gives up exactly the deck height (no lane hidden under the panel)', () => {
    assert(/const _deckH = \(typeof _sdDeckHeight === 'function'\) \? _sdDeckHeight\(\) : 0;/.test(canvas), 'resize consults the deck');
    assert(/const _cvH = Math\.max\(40, container\.clientHeight - _deckH\);/.test(canvas), 'height subtraction');
    assert((canvas.match(/_cvH \* dpr/g) || []).length === 2, 'both canvases (main + fx) shrink together');
    assert(/try \{ sdResizeCanvas\(\); \} catch \(e\) \{\}\s*_sdDeckSyncing = false;/.test(deck), 'showing/hiding the deck re-sizes the canvas');
    assert(/const SD_DECK_H = 168, SD_DECK_H_MIN = 30;/.test(deck), 'full + collapsed heights');
});

console.log('\n— starter shapes —');

test('the shape set: cycle stamps + drag sweeps, each with an icon and a generator', () => {
    for (const k of ['sine', 'tri', 'sawup', 'sawdn', 'square', 'steps', 'sh', 'swell', 'fade', 'line'])
        assert(new RegExp("key: '" + k + "'").test(deck), 'shape ' + k);
    assert(/span: 'cycle'/.test(deck) && /span: 'drag'/.test(deck), 'both span kinds');
    assert(/1 cycle per grid step/.test(deck), 'the grid drives the cycle rate (the ask, verbatim)');
    assert(/if \(t1 - t0 < grid \* 0\.5\) t1 = Math\.min\(totalBeats, t0 \+ grid\);/.test(deck), 'a click stamps one grid cell, never nothing');
    assert(/param\.points = param\.points\.filter\(pt => pt\.time < made\.t0 - 1e-6 \|\| pt\.time > made\.t1 \+ 1e-6\);/.test(deck), 'only the stamped span is replaced');
    assert(/pushUndo\(\);/.test(deck.slice(deck.indexOf('_sdStampCommit'))), 'stamp is one undo step');
    assert(/drag\.rand\[cyc\] === undefined\) drag\.rand\[cyc\] = Math\.random\(\);/.test(deck), 'S+H ghost and commit share the same random values');
});

test('the ghost preview IS the commit (same generator feeds both)', () => {
    const g = deck.slice(deck.indexOf('stamp ghost'));
    assert(/const made = _sdStampPoints\(_sdStampDrag\);/.test(g), 'overlay calls the same _sdStampPoints');
    assert(/setLineDash\(\[5, 4\]\)/.test(g), 'ghost reads as a preview, not committed data');
});

console.log('\n— snap —');

test('value snap: the missing half of the grid, with the Shift bypass convention', () => {
    assert(/const SD_VAL_SNAP = \[null, 0\.5, 0\.25, 0\.125, 0\.05\];/.test(deck), 'ladder');
    assert(/if \(!s \|\| \(ev && ev\.shiftKey\)\) return c;/.test(deck), 'Shift bypasses');
    assert(/value: _sdSnapValue\(hd\.value, e\) \};/.test(canvas), 'new points take the ladder');
    assert(/sdDraggedPoint\.value = _sdSnapValue\(hd\.value, e\);/.test(canvas), 'dragged points take the ladder');
    assert(/time: e\.shiftKey \? Math\.max\(0, Math\.min\(totalBeats, hd\.time\)\) : sdSnapDrawBeat\(hd\.time\)/.test(canvas), 'Shift frees TIME too on placement');
    assert(/sdDraggedPoint\.time = Math\.max\(0, Math\.min\(totalBeats, e\.shiftKey \? hd\.time : sdSnapDrawBeat\(hd\.time\)\)\);/.test(canvas), 'and while dragging');
    assert(/let _sdValSnapIdx = 2;/.test(deck), 'default = quarters (usable pumps out of the box)');
});

console.log('\n— curvature made visible —');

test('segment midpoint handles reuse the proven Alt-drag machinery', () => {
    assert(/sdCurveDragSegment = \{ point: h\.point, startY: e\.clientY, startCurve: h\.point\.curve \|\| 0 \};/.test(canvas), 'handle grab = the same drag state');
    assert(/const hy = 0\.25 \* y1 \+ 0\.5 \* cpY \+ 0\.25 \* y2;/.test(deck), 'the dot sits ON the curve, not the chord');
    assert(/x2 - x1 < 16/.test(deck), 'no handle clutter on tiny segments');
    assert(/pushUndo\(\); h\.point\.curve = 0; sdDrawCanvasGrid\(\);/.test(deck), 'double-click = straight again (undoable)');
    assert(/!param\.locked && param\.points\.length >= 2 && sdActiveTool === 'select' && !_sdStampShape/.test(deck), 'handles yield to lock, tools and the pen');
});

console.log('\n— roll + feedback —');

test('Roll: grid-aware patterns inside the selection, one undo per press', () => {
    for (const f of ['steps', 'gates', 'ramps', 'smooth', 'euclid'])
        assert(deck.indexOf("'" + f + "'") >= 0, 'flavor ' + f);
    assert(/const sel = sdGetSelection\(\);\s*const t0 = sel \? sel\.startBeat : 0, t1 = sel \? sel\.endBeat : totalBeats;/.test(deck), 'selection scopes it');
    assert(/const grid = sdVisualGridBeats\(\);/.test(deck.slice(deck.indexOf('sdRollPattern'))), 'the grid is the clock');
    assert(/Lane locked: unlock to roll/.test(deck), 'locked lanes refuse politely');
});

test('the canvas answers back: readout chip + snap guides while editing', () => {
    assert(/function _sdReadoutText\(t, v\) \{/.test(deck) && /Math\.round\(Math\.max\(0, Math\.min\(1, v\)\) \* 100\) \+ '%'/.test(deck), 'bar.beat · % text');
    assert(/_sdDragReadout = \{ x: e\.clientX - rD\.left, y: e\.clientY - rD\.top, text: _sdReadoutText\(sdDraggedPoint\.time, sdDraggedPoint\.value\) \};/.test(canvas), 'point drags report');
    assert(/vs && \(sdIsDragging \|\| _sdStampDrag\) && vs >= 0\.125/.test(deck), 'snap guides only while interacting (no clutter)');
});

console.log('\n— interaction contracts —');

test('Escape: cancel the stamp in flight, then put the pen down, then clear selection', () => {
    const i = canvas.indexOf("if (e.code === 'Escape') {");
    const seg = canvas.slice(i, i + 700);
    assert(/_sdStampDrag = null; _sdDragReadout = null; sdDrawCanvasGrid\(\); return;/.test(seg), 'in-flight cancel first');
    // Point selection sits between the pen and the time selection: Escape should drop
    // the narrowest thing the user is holding first.
    assert(seg.indexOf('_sdStampDrag') < seg.indexOf('_sdStampShape')
        && seg.indexOf('_sdStampShape') < seg.indexOf('_sdPtSelClear')
        && seg.indexOf('_sdPtSelClear') < seg.indexOf('sdClearSelection'), 'priority order');
});

test('release commits the stamp and stays armed (map knob-after-knob rhythm)', () => {
    assert(/if \(_sdStampDrag\) \{ _sdStampCommit\(\); return; \}\s*\/\/ stamp lays down on release, stays armed/.test(canvas), 'mouseup commit');
    assert(deck.indexOf("'Stamped ' + sh.label + ': drag again, or Esc") >= 0, 'status keeps the loop going');
    assert(/if \(e\.button === 2\) \{ _sdStampArm\(_sdStampShape\); return; \}/.test(canvas), 'right-click puts the pen down instead of deleting');
});

test('bigger hit targets (laptops exist)', () => {
    assert(/const hitT = \(totalBeats \* 0\.025\) \/ sdViewZoomX; const hitV = 0\.06;/.test(canvas), 'hit radius grew');
});

console.log('\n— brand + wiring —');

test('the deck is Stride: Outfit, zinc ground, fuchsia draw accent, .sbtn control caps', () => {
    assert(deck.indexOf('font-family:Outfit,sans-serif') >= 0, 'Outfit');
    assert(deck.indexOf('bg-zinc-950/95 backdrop-blur-sm border-t border-white/10') >= 0, 'ground + hairline');
    assert(deck.indexOf('text-fuchsia-400">Draw</span>') >= 0, 'fuchsia = drawing (matches the tool row)');
    assert(deck.indexOf('class="sbtn mt-auto">') >= 0 && deck.indexOf('Roll</button>') >= 0, 'Roll is a .sbtn cap (2.0.5 control surface)');
    assert(deck.indexOf(String.fromCharCode(8212)) === -1, 'no em dashes anywhere in the deck module (copy rule)');
});

test('no inline handlers to out-of-scope functions (sdGridWiden lives in the IIFE)', () => {
    assert(!/onclick="sdGrid/.test(deck), 'grid buttons are wired programmatically');
    assert(/querySelector\('#sd-deck-gridw'\)\.addEventListener/.test(deck) && /querySelector\('#sd-deck-gridn'\)\.addEventListener/.test(deck), 'listeners attached');
    assert(/window\.sdRollPattern = function/.test(deck), 'Roll is a window fn (its inline onclick is legal)');
});

test('the deck lives in the canvas container both apps share', () => {
    assert(/document\.getElementById\('sd-canvas-container'\);\s*if \(!container \|\| _sdDeckEl\) return;/.test(deck), 'built once, into the shared container');
    const wrapper = fs.readFileSync(path.join(__dirname, '..', '..', 'stride-wrapper', 'm0-spike', 'ui', 'index.html'), 'utf8');
    const desktop = fs.readFileSync(path.join(__dirname, '..', 'app', 'renderer', 'index.html'), 'utf8');
    assert(wrapper.indexOf('id="sd-canvas-container"') > 0 && desktop.indexOf('id="sd-canvas-container"') > 0, 'container exists in wrapper AND desktop');
});

console.log('\n— fx overlay stays out of the label column (field 2026-08-30) —');

test('zoom/DPI guard: every draw re-syncs the backing store and clears ALL of it', () => {
    // Interface zoom (WebView2 page zoom) changes devicePixelRatio; stale sizes left
    // old strokes stuck on the right side of the canvas (field 2026-08-30).
    const gi = canvas.indexOf('ZOOM/DPI GUARD');
    const di = canvas.indexOf('function sdDrawCanvasGrid');
    assert(gi > di && gi < di + 2200, 'guard sits at the top of sdDrawCanvasGrid');
    const seg = canvas.slice(di, di + 3600);
    assert(seg.indexOf('{ sdResizeCanvas(); return; }') > 0, 'mismatch -> resize -> redraw');
    const idn = seg.indexOf('sdCtx.setTransform(1, 0, 0, 1, 0, 0);');
    const clr = seg.indexOf('sdCtx.clearRect(0, 0, sdCanvasEl.width, sdCanvasEl.height);');
    assert(idn > 0 && clr > idn, 'full-store clear under an identity transform');
    assert(seg.indexOf('sdCtx.setTransform(_cdpr, 0, 0, _cdpr, 0, 0);') > clr, 'dpr re-asserted per frame');
    assert(canvas.indexOf('sdCtx.scale(dpr, dpr)') === -1, 'resize uses absolute setTransform, never cumulative scale');
});

test('fx overlay clears identity-full-store (interface zoom-out left landings stuck)', () => {
    assert(canvas.indexOf('function _sdFxClearAll') > 0, 'helper exists');
    const raw = canvas.split('sdFxCtx.clearRect(0, 0, sdCanvasFx.width, sdCanvasFx.height);').length - 1;
    assert(raw === 1, 'the only raw fx clearRect lives inside the helper (got ' + raw + ')');
    const hi = canvas.indexOf('function _sdFxClearAll');
    const hseg = canvas.slice(hi, hi + 400);
    assert(hseg.indexOf('setTransform(1, 0, 0, 1, 0, 0)') > 0, 'identity transform before the clear');
    assert(canvas.split('_sdFxClearAll();').length - 1 >= 4, 'all four clear sites use it');
});

test('the FREE tool wins over an armed chip (field 2026-08-30: FREE looked dead)', () => {
    // A lit chip owns select-tool gestures; picking Free is an explicit hand-draw
    // intent, so stamping stands down (and the cell cursor yields with it).
    assert(/&& _sdStampShape && sdActiveTool !== 'freehand'\) \{/.test(canvas), 'mousedown stamp gate checks the tool');
    assert(/sdSetTool = function[\s\S]{0,900}_sdStampShape && tool !== 'freehand'/.test(canvas), 'sdSetTool refreshes the pen cursor');
});

test('stamp v2: drag direction is the polarity, INVERT still XORs (field video 2026-08-30)', () => {
    const seg = canvas.slice(canvas.indexOf('function _sdStampPoints'), canvas.indexOf('function _sdStampCommit'));
    assert(/const goingDown = drag\.vCur < drag\.v0;/.test(seg), 'direction read from the drag');
    assert(/flip = goingDown !== !!_sdStampInvert;/.test(seg), 'down flips, INVERT xors on top');
    assert(/const _mapV = \(v\) => flip \? \(lo \+ hi\) - v : v;/.test(seg), 'flip mirrors inside the band');
});

test('stamp v2: a single-cell gesture rides the NEAREST grid line (peak on the line)', () => {
    const seg = canvas.slice(canvas.indexOf('function _sdStampPoints'), canvas.indexOf('function _sdStampCommit'));
    assert(/Math\.abs\(drag\.tCur - drag\.t0\) < grid \* 0\.9/.test(seg), 'single-cell branch exists');
    assert(/Math\.round\(drag\.tCur \/ grid\) \* grid/.test(seg), 'nearest vertical grid line');
    assert(/line - grid/.test(seg) && /line \+ grid/.test(seg), 'one cycle spans a cell either side, apex ON the line');
});

test('the readout says which way the shape points', () => {
    assert(/'\\u25bc ' : '\\u25b2 '/.test(canvas) || canvas.indexOf(String.fromCharCode(9660)) >= 0, 'arrow prefix on the stamp readout');
});

test('the lane-icon legend exists in both views (field: "I didn\'t even know what those were")', () => {
    assert(canvas.indexOf('sd-lane-help-chip') > 0, 'the ? chip');
    assert(canvas.indexOf("['Range', 'give this param its own min and max") > 0, 'range row');
    assert(canvas.indexOf("['Lane speed', 'the slot left of Range.") > 0, 'speed row (wrapper)');
    assert(canvas.indexOf('_sdEnsureLaneHelp();') > 0, 'wired into the draw entry');
    assert(canvas.indexOf('drag down flips them') > 0, 'deck hint teaches the flip');
});

test('both FX passes clip to the lane draw area (comet + landing)', () => {
    // The main renderer clips every lane stroke; zoomed + panned, the UNclipped overlay
    // painted the landing animation across the parameter names.
    const fx = canvas.slice(canvas.indexOf('function _sdFxDraw'), canvas.indexOf('function _sdFxFrame'));
    assert(/sdFxCtx\.rect\(SD_MULTI_LABEL_WIDTH, 0, sdCanvasFx\.width, sdCanvasFx\.height\);\s*sdFxCtx\.clip\(\);/.test(fx), 'comet pass clips');
    assert(/sdFxCtx\.restore\(\);\s*\/\/ balances the label-column clip\s*\}/.test(fx), 'and restores');
    const land = canvas.slice(canvas.indexOf('function _sdLandFrame'), canvas.indexOf('function _sdLandEnd'));
    assert(/sdFxCtx\.rect\(SD_MULTI_LABEL_WIDTH, 0, sdCanvasFx\.width, sdCanvasFx\.height\);\s*sdFxCtx\.clip\(\);/.test(land), 'landing pass clips');
    assert(/sdFxCtx\.restore\(\);\s*\/\/ balances the label-column clip/.test(land), 'and restores before handing off');
});

console.log('\n— selection semantics (field 2026-08-28) —');

test('the ACTIVE lane rides with its selection group (the skipped-first-lane bug)', () => {
    const i1 = canvas.indexOf('function sdGetTargetParams');
    const seg1 = canvas.slice(i1, i1 + 1500);
    assert(/if \(act && !act\.locked && !act\.selected\) selected\.unshift\(act\);/.test(seg1), 'sdGetTargetParams pulls the active lane in');
    const i2 = canvas.indexOf('function sdGetUnlockedParams');
    const seg2 = canvas.slice(i2, i2 + 900);
    assert(/sel\.unshift\(act\);/.test(seg2), 'sdGetUnlockedParams too');
});

test('Shift+click = range select in multi view, anchored on the active lane', () => {
    assert(/if \(e\.shiftKey && !\(e\.ctrlKey \|\| e\.metaKey\)\) \{\s*const vis = sdVisibleParams\(\);/.test(canvas), 'shift branch exists');
    assert(/for \(let ri = lo; ri <= hiI; ri\+\+\) \{ if \(!vis\[ri\]\.locked\) vis\[ri\]\.selected = true; \}/.test(canvas), 'spans the range, skips locked');
    assert(canvas.indexOf('if (e.shiftKey && !(e.ctrlKey || e.metaKey))') < canvas.indexOf('// Ctrl/Cmd + click on any lane'), 'shift is checked before the ctrl toggle');
});

console.log(`\n${passed} passed, ${failed} failed\n`);
process.exit(failed);
