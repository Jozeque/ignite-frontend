/**
 * test-vst3-landing.js
 *
 * Covers the LANDING ANIMATION (2026-08-12, Yossi-picked mockup B "draw-on"): when a
 * motion tool / template prints new curves, each lane's stroke draws itself bar-1→end
 * with a comet head, lanes staggered 15ms (capped ≤ ~240ms total on big racks).
 * The hard constraints, test-pinned:
 *   - ONE-SHOT: a single rAF chain that terminates and cleans up — zero idle cost
 *   - the main canvas merely SKIPS the animating strokes (geometry still builds)
 *   - the shared FX overlay is handed BACK to the playhead comet at the end
 *   - reduced-motion / focus view = instant print, exactly the old behavior
 *   - while it runs, the comet painter (_sdFxDraw) is gated OFF — a playing
 *     transport kicks it ≤30Hz and each kick clearRects the overlay, wiping the
 *     landing's partial strokes between frames (field report 2026-08-13:
 *     "glitches" only while the DAW plays; stopped was smooth)
 */
'use strict';
const fs = require('fs');
const path = require('path');

let passed = 0, failed = 0;
function ok(name, cond, extra) {
    if (cond) { passed++; }
    else { failed++; console.log('  ✗ ' + name + (extra ? '  — ' + extra : '')); }
}
console.log('test-vst3-landing.js');

const canvas = fs.readFileSync(path.join(__dirname, '..', 'app', 'renderer', 'canvas.js'), 'utf8');

// ─────────────────────────────────────────────────────────────
// 1. BEHAVIORAL — the draw-on math, replicated
// ─────────────────────────────────────────────────────────────
(function () {
    const easeOutCubic = (x) => 1 - Math.pow(1 - x, 3);
    const kOf = (now, t0, idx, stag, dur) => Math.max(0, Math.min(1, (now - t0 - idx * stag) / dur));

    // Lane 0 leads, lane 3 trails by 3 staggers; everyone lands by t0 + dur + 3*stag.
    ok('stagger orders the lanes and the last lane still completes',
       kOf(100, 0, 0, 15, 200) > kOf(100, 0, 3, 15, 200) && kOf(200 + 45, 0, 3, 15, 200) === 1);
    ok('the edge only moves forward (ease is monotonic)',
       easeOutCubic(0.2) < easeOutCubic(0.5) && easeOutCubic(0.5) < easeOutCubic(0.9));

    // The stagger cap: 4 lanes ride the full 15ms; 30 lanes squeeze to ≤ 240ms total.
    const stag = (n) => Math.min(15, 240 / n);
    ok('small racks get the full 15ms cascade', stag(4) === 15);
    ok('big racks stay under the ~240ms budget', stag(30) * 30 <= 240 + 1e-9);

    // One-shot semantics: frames run while any lane is unfinished, then STOP.
    let frames = 0, running = true;
    const lanes = [0, 1, 2, 3];
    let t = 0;
    while (running && frames < 1000) {
        t += 16.7; frames++;
        running = lanes.some(i => kOf(t, 0, i, 15, 200) < 1);
    }
    ok('the rAF chain terminates on its own (~15 frames, never a loop)', frames > 5 && frames < 30);
})();

// ─────────────────────────────────────────────────────────────
// 2. SOURCE — wiring, guards, cleanup
// ─────────────────────────────────────────────────────────────
ok('every generator commit kicks the landing (12 sites: motion tools + templates + both S&H modes ×2 surfaces)',
   (canvas.match(/_sdLandKick\((targets|sdGetTargetParams\(\)|)\);/g) || []).length === 12);
ok('lane geometry carries the id the animation matches by',
   /id: param\.envelopeId,\s+\/\/ the landing animation matches lanes by id/.test(canvas));
ok('the main canvas SKIPS animating strokes with a balanced restore (geometry already built)',
   /_sdLandAnim && _sdLandAnim\.ids\.has\(param\.envelopeId\)\) \{[\s\S]{0,120}sdCtx\.restore\(\);[\s\S]{0,80}continue;/.test(canvas));
ok('one-shot lifecycle: re-fire cancels, completion cleans the overlay and repaints',
   /if \(_sdLandAnim && _sdLandAnim\.raf\) cancelAnimationFrame\(_sdLandAnim\.raf\);/.test(canvas)
   && /function _sdLandEnd\(\)[\s\S]{0,600}_sdFxClearAll\(\);[\s\S]{0,200}sdDrawCanvasGrid\(\);/.test(canvas));
ok('the overlay is handed back to the playhead comet at the end',
   /_sdLandEnd\(\)[\s\S]{0,700}if \(_sdEngMode\) _sdEngKick\(\);\s+\/\/ hand the overlay back/.test(canvas));
ok('reduced-motion and focus view keep the instant print',
   /_SD_LAND_REDUCED \|\| sdViewMode !== 'multi'\) return;/.test(canvas)
   && /prefers-reduced-motion: reduce/.test(canvas));
ok('the writing head reuses the comet look (glow + white core)',
   /_sdLandFrame[\s\S]{0,2500}shadowBlur = 8;[\s\S]{0,400}arc\(head\.x, head\.y, 1\.1/.test(canvas));
ok('stagger cap lives in the kick', /stag: Math\.min\(15, 240 \/ order\.length\)/.test(canvas));

// ─────────────────────────────────────────────────────────────
// 3. OVERLAY OWNERSHIP — the playing-DAW flicker (2026-08-13)
// ─────────────────────────────────────────────────────────────
(function () {
    // Replica of the interleave: landing frames and comet kicks alternate on ONE
    // overlay. The gate makes the comet painter a no-op while the landing runs.
    let overlay = 'empty';
    let landAnim = { on: true };
    const landFrame = () => { overlay = 'strokes'; };
    const fxDraw = () => { if (landAnim) return; overlay = 'comet'; };
    landFrame(); fxDraw();          // a 30Hz playhead kick lands between landing frames
    ok('a comet kick mid-landing no longer wipes the strokes', overlay === 'strokes');
    landAnim = null; fxDraw();      // landing over → the handback kick repaints
    ok('the handback kick repaints the comet once the landing ends', overlay === 'comet');
})();
ok('the comet painter is gated off while the landing runs — BEFORE any clear',
   /function _sdFxDraw\(phase, withTrail\) \{\s+if \(!sdFxCtx \|\| !sdCanvasFx\) return;[\s\S]{0,800}if \(_sdLandAnim\) return;\s+_sdFxClearAll\(\);/.test(canvas));
ok('both comet drivers flow through the gated painter (ambient drift + engine kicks)',
   /_sdFxDraw\(\(ts % SD_FX_LOOP\) \/ SD_FX_LOOP, true\)/.test(canvas)
   && /_sdFxDraw\(_sdEngPhase, _sdEngOn\)/.test(canvas));

console.log('  ' + passed + ' passed, ' + failed + ' failed');
process.exit(failed ? 1 : 0);
