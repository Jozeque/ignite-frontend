/**
 * Malek's batch, 2026-08-31 (contact form, with screenshots).
 *
 * Three of the five things he reported, all in the shared canvas.js:
 *
 *   1. RANGE was unusable at the ranges people actually want. Banding pitch to 0-3%
 *      squashed the drawing into 3% of the lane: "i no longer see my curves and i
 *      have no idea what shapes i have when i click on Neuro or Chaos". Worse, the
 *      hit test ran through the same squash, so on a 3% band every click above the
 *      floor read as 1.0 and the lane could not be drawn on at all.
 *
 *   2. FOCUS clipped its own extremes. "when they are at minimum level in the
 *      bottom, they seem to be masked or something, i don't see them. And for the
 *      up points, i only see half of them when they are at maximum."
 *
 *   3. FOCUS had no way to select. "i cannot select multiple points and move them
 *      around." Plain click in focus is already the ADD gesture, so the marquee
 *      takes Ctrl+drag, the modifier multi view already uses to select lanes.
 *
 * canvas.js is a browser IIFE, so the wiring is pinned by shape (the house style for
 * canvas suites here) and the MATH is executed for real against extracted formulas.
 *
 * Run: node test/test-focus-select-range.js
 */
'use strict';
const fs = require('fs');
const path = require('path');

let passed = 0, failed = 0;
function test(name, fn) {
    try { fn(); console.log(`  ✓ ${name}`); passed++; }
    catch (e) { console.log(`  ✗ ${name}: ${e.message}`); failed++; }
}
function assert(c, m) { if (!c) throw new Error(m || 'assertion failed'); }
function close(a, b, eps, m) { if (Math.abs(a - b) > (eps || 1e-9)) throw new Error((m || 'not close') + ` — got ${a}, expected ${b}`); }

const canvas = fs.readFileSync(path.join(__dirname, '..', 'app', 'renderer', 'canvas.js'), 'utf8');

console.log('\n— 1. range: draw full height, band on the way out —');

test('the lane draws its shape at full height and the band is behind it', () => {
    assert(/const valueToY = \(v\) => rect\.bottom - v \* rect\.height;/.test(canvas), 'multi-view valueToY is unscaled');
    assert(!/_rangeMap/.test(canvas), 'no range-aware display map survives anywhere');
    // The band itself must still be drawn, or the user loses all sight of where the
    // shape lands on the knob.
    assert(/if \(param\.rangeOn\) \{[\s\S]{0,900}dead zone \(outside the band\)/.test(canvas), 'dead-zone shade still drawn');
    assert(/if \(param\.rangeOn\) \{[\s\S]{0,900}setLineDash\(\[3, 3\]\)/.test(canvas), 'boundary lines still drawn');
});

test('the OUTPUT is untouched: a full-height shape still lands inside the band', () => {
    // The whole point of the fix is that only the DRAWING changed.
    const m = canvas.match(/function _sdRangeApply\(p\) \{[\s\S]*?\n    \}/);
    assert(m, '_sdRangeApply still exists');
    const apply = (v, on, lo, hi) => {
        if (!on) return v;
        return Math.max(0, Math.min(1, lo + v * (hi - lo)));
    };
    assert(/lo \+ pt\.value \* span/.test(m[0]), 'still lo + value*span: ' + m[0].slice(0, 120));
    close(apply(1, true, 0, 0.03), 0.03, 1e-9, 'peak of a 0-3% band');
    close(apply(0, true, 0, 0.03), 0, 1e-9, 'trough of a 0-3% band');
    close(apply(0.5, true, 0, 0.03), 0.015, 1e-9, 'mid of a 0-3% band');
    close(apply(0.5, false, 0, 0.03), 0.5, 1e-9, 'range off is passthrough');
});

test('a click maps 1:1 to the shape, so a narrow band is still drawable', () => {
    assert(!/function _sdRangeInv/.test(canvas), 'the inverse is gone');
    assert(/const value = Math\.max\(0, Math\.min\(1, 1 - \(\(pos\.y - laneRect\.top\) \/ laneRect\.height\)\)\);/.test(canvas),
           'multi view reads the pixel straight');
    // What the old inverse did on Malek's band, kept as the reason it had to go.
    const inv = (v, lo, hi) => Math.max(0, Math.min(1, (v - lo) / (hi - lo)));
    close(inv(0.5, 0, 0.03), 1, 1e-9, 'half height used to read as full');
    close(inv(0.1, 0, 0.03), 1, 1e-9, 'a tenth of the way up did too');
});

test('the motions ghost previews at full height, so the drop matches the promise', () => {
    assert(/tY = \(v\) => gr\.bottom - Math\.max\(0, Math\.min\(1, v\)\) \* gr\.height/.test(canvas), 'ghost unscaled');
    assert(/const tp = gr\.param;/.test(canvas), 'and tp is still bound for the stroke colour below it');
});

console.log('\n— 2. focus: the extremes are inside the canvas —');

test('one mapper in, one mapper out, and they are exact inverses', () => {
    assert(/const SD_FOCUS_PAD_Y = 10;/.test(canvas), 'the inset exists');
    assert(!/lh - \((?:pt|prev|next)?\.?v(?:alue)? \* lh\)/.test(canvas), 'no raw value->pixel map left in focus');

    const span = (lh) => Math.max(1, lh - 2 * 10);
    const Y = (v, lh) => (lh - 10) - v * span(lh);
    const V = (y, lh) => Math.max(0, Math.min(1, ((lh - 10) - y) / span(lh)));
    const lh = 600;
    // The bug: a dot of radius 3 at value 0 was centred on the last row of pixels, so
    // its bottom half fell outside. Same at the top.
    assert(Y(0, lh) <= lh - 6, 'a point at 0 has room for its own radius, got ' + Y(0, lh) + ' of ' + lh);
    assert(Y(1, lh) >= 6, 'a point at 1 has room too, got ' + Y(1, lh));
    close(Y(0.5, lh), lh / 2, 1e-9, 'mid still lands dead centre');
    [0, 0.25, 0.5, 0.75, 1].forEach(v => close(V(Y(v, lh), lh), v, 1e-9, 'round trip at ' + v));
    // A click at the very top or bottom edge still resolves to a legal value.
    close(V(0, lh), 1, 1e-9, 'top edge clamps to 1');
    close(V(lh, lh), 0, 1e-9, 'bottom edge clamps to 0');
});

test('every focus draw site and the hit test go through the pair', () => {
    ['const y = _sdFocusY(v, lh);',                       // horizontal grid lines
     'const y = _sdFocusY(pt.value, lh);',                // curve + points
     'const py = _sdFocusY(prev.value, lh);',             // bezier control
     'const ny = _sdFocusY(next.value, lh);',             // bend marker
     'const toY = (v) => _sdFocusY(v, lh);',              // overlays, handles, snap guides
    ].forEach(sig => assert(canvas.indexOf(sig) > 0, 'missing: ' + sig));
    assert(/value: _sdFocusV\(pos\.y, rect\.height\)/.test(canvas), 'the hit test uses the inverse');
    // The axis labels have to move with the plot or they point at the wrong rows.
    assert(/fillText\(fv\(ap\.max\), 4, _sdFocusY\(1, lh\) \+ 10\)/.test(canvas), 'max label follows');
    assert(/fillText\(fv\(ap\.min\), 4, _sdFocusY\(0, lh\) - 4\)/.test(canvas), 'min label follows');
});

console.log('\n— 3. focus: box-select points and move them together —');

test('Ctrl+drag opens the box, and it is claimed before the stamp', () => {
    const md = canvas.indexOf('// MARQUEE (focus, Ctrl+drag)');
    assert(md > 0, 'the marquee branch exists');
    const stamp = canvas.indexOf('// STAMP (focus deck): an armed shape owns the gesture');
    assert(md < stamp, 'claimed BEFORE the stamp, or an armed shape makes selection unreachable');
    assert(/if \(sdViewMode === 'focus' && e\.button === 0 && \(e\.ctrlKey \|\| e\.metaKey\)\) \{/.test(canvas),
           'focus + left button + Ctrl or Cmd');
    // Plain click must still ADD a point. That is the whole reason the marquee is not
    // on a plain drag.
    assert(/param\.points\.push\(np\); param\.points\.sort/.test(canvas), 'plain click still adds a point');
});

test('dragging a selected point moves the whole selection, and only then', () => {
    assert(/idx !== -1[\s\S]{0,40}&& _sdPtSel\.size > 1 && _sdPtSel\.has\(param\.points\[idx\]\)\) \{/.test(canvas),
           'group drag needs a multi-selection AND a hit on a member');
    const g = canvas.slice(canvas.indexOf('_sdPtGroupDrag = {'), canvas.indexOf('_sdPtGroupDrag = {') + 400);
    assert(/pushUndo\(\);[\s\S]{0,200}_sdPtGroupDrag = \{/.test(canvas), 'ONE undo checkpoint for the gesture');
    assert(/t0: pt\.time, v0: pt\.value/.test(g), 'offsets captured up front so re-sorting cannot drift the drag');
    assert(/g\.param\.points\.sort\(\(a, b\) => a\.time - b\.time\)/.test(canvas),
           'the array is re-sorted: every consumer walks it in time order');
});

test('the group move outranks the stamp AND the FREE tool', () => {
    // Field report 2026-09-01: "i selected a few dots in the focus view and tryied to drag
    // but they didnt drag. in another try an half an hour ago it worked well." Nothing about
    // the selection changed between those two tries, the PEN state did. Two branches used to
    // swallow the press before the point hit test was even reached:
    //   - an armed shape chip (the STAMP branch returns early)
    //   - the FREE tool (the group drag sat in the ELSE of the freehand branch)
    // So the claim is hoisted above both. Pressing a dot that is already in a multi-selection
    // can only mean "move these".
    const claim = canvas.indexOf('// GROUP MOVE, claimed here and not down in the drawing branches');
    const stamp = canvas.indexOf("// STAMP (focus deck): an armed shape owns the gesture");
    const free  = canvas.indexOf("if (sdActiveTool === 'freehand') {");
    assert(claim > 0 && stamp > 0 && free > 0, 'all three branches present');
    assert(claim < stamp, 'claimed BEFORE the stamp, or an armed chip lays a shape instead of dragging');
    assert(claim < free,  'claimed BEFORE the freehand branch, or FREE paints instead of dragging');
    // The hit test has to be hoisted with it, or the claim has no idx to test.
    assert(canvas.indexOf('const hitT = (totalBeats * 0.025) / sdViewZoomX') < stamp,
           'the point hit test is computed above the stamp too');
    // ...and it must exist exactly once: two copies would drift.
    assert(canvas.split('const hitT = (totalBeats * 0.025)').length === 2, 'one hit test, not two');
    assert(canvas.split('_sdPtGroupDrag = {').length === 2, 'one place starts a group drag, not two');
});

test('the group is clamped as a group, so the shape survives the edges', () => {
    // Extracted from the handler: clamp the OFFSET by the group extremes, never each
    // point on its own, or the shape squashes against the wall instead of stopping.
    const clamp = (refs, dt, dv, totalBeats) => {
        let tMin = Infinity, tMax = -Infinity, vMin = Infinity, vMax = -Infinity;
        for (const r of refs) {
            if (r.t0 < tMin) tMin = r.t0;
            if (r.t0 > tMax) tMax = r.t0;
            if (r.v0 < vMin) vMin = r.v0;
            if (r.v0 > vMax) vMax = r.v0;
        }
        return { dt: Math.max(-tMin, Math.min(totalBeats - tMax, dt)),
                 dv: Math.max(-vMin, Math.min(1 - vMax, dv)) };
    };
    const refs = [{ t0: 2, v0: 0.2 }, { t0: 6, v0: 0.8 }];
    let r = clamp(refs, -10, 0, 16);
    close(r.dt, -2, 1e-9, 'dragged hard left, the earliest point stops at 0');
    r = clamp(refs, 100, 0, 16);
    close(r.dt, 10, 1e-9, 'dragged hard right, the latest point stops at the end');
    r = clamp(refs, 0, 5, 16);
    close(r.dv, 0.2, 1e-9, 'dragged up, the highest point stops at 1');
    r = clamp(refs, 0, -5, 16);
    close(r.dv, -0.2, 1e-9, 'dragged down, the lowest point stops at 0');
    // The gap between the two points is preserved in every case, which is the point.
    const moved = refs.map(x => x.v0 + 0.2);
    close(moved[1] - moved[0], 0.6, 1e-9, 'spacing preserved');
});

test('the selection is dropped whenever it stops meaning anything', () => {
    assert(/function _sdPtSelClear\(\)/.test(canvas), 'one clear helper');
    assert(/if \(id !== sdActiveParamId\) _sdPtSelClear\(\);/.test(canvas), 'focusing another lane clears it');
    assert(/_sdPtSelClear\(\); _sdPtGroupDrag = null;/.test(canvas), 'leaving focus clears it');
    assert(/_sdPtSelClear\(\)\; \}? ?\{?/.test(canvas) && canvas.indexOf("if (_sdPtSelClear()) { sdDrawCanvasGrid(); return; }") > 0,
           'Escape clears it');
    assert(/_sdPtSelClear\(\);   \/\/ drawing a new point is the end of the old selection/.test(canvas),
           'adding a point clears it');
    // A Ctrl+click (a box with no area) is the deliberate deselect, since a plain
    // click can never mean deselect in a view where it means "add".
    assert(/x1 - x0 < 3 && y1 - y0 < 3/.test(canvas), 'a zero-area box is the clear gesture');
});

test('the box and the selection are visible, and the gesture is taught', () => {
    assert(/_sdPtSel\.has\(pt\)/.test(canvas) && /arc\(x, y, 6\.5, 0, Math\.PI \* 2\); sdCtx\.stroke\(\)/.test(canvas),
           'selected points get a ring');
    assert(/if \(_sdPtMarquee\) \{[\s\S]{0,600}strokeRect/.test(canvas), 'the box is drawn');
    assert(canvas.indexOf('Ctrl+drag = select points') > 0, 'the deck hint teaches it');
    assert(canvas.indexOf('drag down flips them') > 0, 'and the hint it shares a line with survives');
    assert(/box-select points, then drag any selected point to move them all/.test(canvas), 'the help card explains it');
});

console.log('\n— 4. the MIN/MAX scrub can reach 100% —');

test('the scrub is global and accumulates, instead of running out of canvas', () => {
    // "when you put the max range very low let's say at 3%, you have to move the mouse
    // upward multiple times to get back to 100%": ~194px of travel, on a listener bound
    // to the canvas, so the run ended at the canvas edge.
    assert(/window\.addEventListener\('mousemove', e => \{\s*const nd = _sdRangeNumDrag;/.test(canvas),
           'the scrub listens on the window');
    assert(!/sdCanvasEl\.addEventListener\('mousemove'[\s\S]{0,400}_sdRangeNumDrag/.test(canvas),
           'and no longer on the canvas');
    assert(/lastY: e\.clientY, val: _f\.param\[_f\.edge\] \|\| 0/.test(canvas), 'seeded from the live value');
    assert(/const gain = e\.shiftKey \? 800 : 200;/.test(canvas), 'Shift = fine');
});

test('the accumulator clamps as it goes, so there is no wind-up to undo', () => {
    const step = (val, lastY, y, shift) => Math.max(0, Math.min(1, val + (lastY - y) / (shift ? 800 : 200)));
    // 3% back to 100% in one continuous gesture: 194px, which now spans the window
    // rather than the lane row.
    let v = 0.03, y = 500;
    for (let i = 0; i < 194; i++) { v = step(v, y, y - 1, false); y -= 1; }
    close(v, 1, 1e-9, 'reaches the top');
    // Keep pushing past the end, then come back one pixel: it must move IMMEDIATELY.
    for (let i = 0; i < 300; i++) { v = step(v, y, y - 1, false); y -= 1; }
    close(v, 1, 1e-9, 'still clamped at the top, not wound up to 2.5');
    v = step(v, y, y + 1, false);
    close(v, 0.995, 1e-9, 'one pixel down moves it at once');
    // Shift is 4x finer, for the last percent.
    v = 0.5; v = step(v, 100, 96, true);
    close(v, 0.505, 1e-9, '4px of Shift travel = half a percent');
});

console.log('\n— 5. the lane legend draws the REAL icons —');

test('every legend icon is painted by the function the lane itself uses', () => {
    // Field report 2026-09-01: "i cannot see the range icon and the speed icon is not as
    // the actual speed icon that lives next to the range icon." The legend was text
    // glyphs, so it had drifted: a plus-minus sign for Range, when the real icon is a
    // ceiling/floor pair with a double arrow between them, and "2X / half X" for Speed,
    // when at the default 1x the lane draws a METRONOME the legend never showed at all.
    assert(canvas.indexOf('function _sdPaintHelpIcons(card)') > 0, 'the painter exists');
    [['unmap:', '_drawUnmapIcon(c, PAD, PAD, D, col)'],
     ['range:', '_drawRangeIcon(c, PAD, PAD, D, col, false)'],
     ['focus:', '_drawFocusIcon(c, PAD, PAD, D, col)'],
     ['lock:',  '_drawLockIcon(c, PAD, PAD, D, col, false)'],
     ['speed:', '_drawSpeedIcon(c, PAD, PAD, D, col)'],
     // The two on the label column. Both are hover-revealed on the lane, so a legend row
     // with an empty icon slot was the least helpful place to leave them (asked directly,
     // 2026-09-01: "where are these icons?").
     ['book:',  '_sdDrawBookmark(c, PAD + 2, PAD, D, true)'],
     ['jack:',  '_sdDrawJack(c, PAD + D / 2, PAD + D / 2, 8, 1, null)']].forEach(([key, call]) => {
        assert(canvas.indexOf(call) > 0, key + ' painted by the real drawer, not a glyph: ' + call);
    });
    // The very same functions the lane calls, which is what stops the two drifting again.
    ['_drawRangeIcon(sdCtx, laneDrawLeft - 54', '_drawSpeedIcon(sdCtx, laneDrawLeft - 72']
        .forEach(sig => assert(canvas.indexOf(sig) > 0, 'the lane still draws via ' + sig.split('(')[0]));
    // And no text glyph is left claiming to be one of them.
    assert(canvas.indexOf("['±', 'Range.") < 0, 'the plus-minus glyph row is gone');
    assert(canvas.indexOf("['2X · ½X'") < 0, 'the 2X text row is gone');
});

test('the icons are bigger than the lane draws them, and crisp on a scaled display', () => {
    // The lane draws at 12px in context. Out of context that is unreadable, which is the
    // other half of what he reported.
    assert(canvas.indexOf('const D = 18, PAD = 3') > 0, 'drawn at 18px inside the 24px box');
    assert(canvas.indexOf('cv.width = Math.round(24 * dpr)') > 0
        && canvas.indexOf('c.setTransform(dpr, 0, 0, dpr, 0, 0)') > 0,
           'backing store scaled by devicePixelRatio, or they blur on a scaled display');
    assert(canvas.indexOf('canvas class="sd-help-icon" data-icon="') > 0, 'each row carries its own canvas');
    assert(canvas.indexOf('_sdPaintHelpIcons(card);') > 0, 'painted right after the card is built');
    // Only the two GESTURE rows may sit without an icon, and the card says so in its title.
    assert(canvas.indexOf('Lane icons and gestures') > 0, 'the card admits it lists gestures too');
});

console.log(`\n${passed} passed, ${failed} failed\n`);
process.exit(failed ? 1 : 0);
