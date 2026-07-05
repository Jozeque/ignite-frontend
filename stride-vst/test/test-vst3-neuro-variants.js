/**
 * test-vst3-neuro-variants.js
 *
 * The 6 Neuro v2 variants (docs/neuro-variants-mockup.html) ported into canvas.js as per-param
 * generators, exposed on the wrapper's fuchsia SEL/shapes row (selected/active-scoped) via
 * sdApplyNeuroVariant. Also guards the motion-scope revert (motion-for-all is back to the
 * original single orange row; the _sdGenScope/sdApplyMotion machinery is gone).
 *
 * Source assertions + a REAL behavioural harness: the ported generators are pure (Math only),
 * so we extract + eval them and validate every emitted point across bar counts + a selection.
 */
'use strict';
const fs = require('fs');
const path = require('path');

let passed = 0, failed = 0;
function ok(name, cond, extra) {
    if (cond) { passed++; }
    else { failed++; console.log('  ✗ ' + name + (extra ? '  — ' + extra : '')); }
}
console.log('test-vst3-neuro-variants.js');

const root = path.join(__dirname, '..', '..');
const rd = (p) => fs.readFileSync(p, 'utf8');
const canvas = rd(path.join(root, 'stride-vst', 'app', 'renderer', 'canvas.js'));
const indexH = rd(path.join(root, 'stride-wrapper', 'm0-spike', 'ui', 'index.html'));
const deskH  = rd(path.join(root, 'stride-vst', 'app', 'renderer', 'index.html'));

// ─────────────────────────────────────────────────────────────
// 1. Ported generators + dispatcher + selection-aware apply
// ─────────────────────────────────────────────────────────────
['_sdNeuroV1','_sdNeuroV2','_sdNeuroV3','_sdNeuroV4','_sdNeuroV5','_sdNeuroV6'].forEach(fn =>
    ok('generator ' + fn + ' exists', new RegExp('function\\s+' + fn + '\\s*\\(sB, eB\\)').test(canvas)));
ok('curve-aware inject helper (_sdNeuroInject)', /function\s+_sdNeuroInject\s*\(out, shape, cB, chunk, curveVal\)/.test(canvas));
ok('V2 segment emitter (_sdNeuroEmitSegment, 9 types)', /function\s+_sdNeuroEmitSegment/.test(canvas) && /denseChop[\s\S]{0,1500}octaveSlam/.test(canvas));
ok('dispatcher maps all 6 variant names', /_sdGenNeuroVariant[\s\S]{0,400}case 'smooth'[\s\S]{0,200}case 'storm'[\s\S]{0,200}case 'poly'[\s\S]{0,200}case 'call'[\s\S]{0,200}case 'acid'[\s\S]{0,200}case 'anchor'/.test(canvas));
ok('sdApplyNeuroVariant is selection-aware (sdGetTargetParams)', /window\.sdApplyNeuroVariant\s*=\s*function[\s\S]{0,400}sdGetTargetParams\(\)\.forEach/.test(canvas));
ok('sdApplyNeuroVariant honors a time selection (sdGetSelection)', /window\.sdApplyNeuroVariant\s*=\s*function[\s\S]{0,300}sdGetSelection\(\)/.test(canvas));
ok('sdApplyNeuroVariant pushes to the synth (sdDrawCanvasGrid flush)', /window\.sdApplyNeuroVariant[\s\S]{0,600}sdDrawCanvasGrid\(\)/.test(canvas));

// ─────────────────────────────────────────────────────────────
// 2. Motion-scope machinery REVERTED (motion-for-all as before)
// ─────────────────────────────────────────────────────────────
ok('_sdGenScope removed from canvas.js', !/_sdGenScope/.test(canvas));
ok('sdApplyMotion removed from canvas.js', !/sdApplyMotion/.test(canvas));
ok('wrapper motion row back to direct globals (sdApplyGlobalChaos())', /onclick="sdApplyGlobalChaos\(\)"/.test(indexH));
ok('no sdApplyMotion left in the wrapper UI', !/sdApplyMotion/.test(indexH));
ok('motion-scope test file was removed', !fs.existsSync(path.join(root, 'stride-vst', 'test', 'test-vst3-motion-scope.js')));

// ─────────────────────────────────────────────────────────────
// 3. SEL / shapes row — fuchsia, same-size, per-param, selected
// ─────────────────────────────────────────────────────────────
ok('SEL row labelled (◉ Sel)', /◉ Sel/.test(indexH));
ok('base shapes on the SEL row = Sine + Pump (fuchsia)',
   /sdApplyTemplate\('sine'\)[^>]*text-fuchsia-300/.test(indexH) && /sdApplyTemplate\('pump'\)[^>]*text-fuchsia-300/.test(indexH));
ok('generative shapes on the SEL row (Chaos/Neuro/S&H, selected-scoped)',
   /sdApplyTemplate\('chaos_lfo'\)/.test(indexH) && /sdApplyComplexTemplate\('neuro'\)/.test(indexH) && /sdApplySampleHoldLane\(\)/.test(indexH));
ok('SEL variant buttons = smooth/storm/call/acid/anchor (Poly deleted)',
   ["smooth","storm","call","acid","anchor"].every(v => indexH.includes("sdApplyNeuroVariant('" + v + "')")));
ok('Poly variant button removed from the UI', !indexH.includes("sdApplyNeuroVariant('poly')"));
ok('Glitch + Groove removed from the SEL row (no fuchsia glitch/groove button)',
   !/sdApplyTemplate\('glitch'\)[^>]*text-fuchsia-300/.test(indexH) && !/sdApplyTemplate\('groove_build'\)[^>]*text-fuchsia-300/.test(indexH));
ok('SEL buttons use the fuchsia color', /sdApplyNeuroVariant\('smooth'\)[^>]*text-fuchsia-300/.test(indexH));
ok('SEL buttons keep the shape button size (text-[9px] px-1.5 py-0.5)', /sdApplyNeuroVariant\('acid'\)[^>]*text-\[9px\][^>]*px-1\.5 py-0\.5/.test(indexH));
ok('panel tightened (compact toolbar gap reduced to gap-1.5, py-1)', /sd-compact-only[^>]*py-1 items-center gap-1\.5 flex-wrap/.test(indexH));
ok('Motion sits on its OWN line (basis-full break before Motion)', /basis-full[\s\S]{0,500}>Motion</.test(indexH));
ok('the "generative ..." tooltips are gone', !/generative motion across every mapped param/.test(indexH));
ok('poly generator kept in canvas.js (dispatcher still maps it)', /function\s+_sdNeuroV3\s*\(sB, eB\)/.test(canvas) && /case 'poly'/.test(canvas));

// ─────────────────────────────────────────────────────────────
// 4. NO-BREAK: desktop app untouched by the variant additions
// ─────────────────────────────────────────────────────────────
ok('desktop UI does not reference the variants (wrapper-only UI)', !/sdApplyNeuroVariant/.test(deskH));
ok('existing shapes/templates still intact (sdApplyTemplate/_sdGenTemplatePts)',
   /window\.sdApplyTemplate\s*=\s*function/.test(canvas) && /_sdGenTemplatePts/.test(canvas));

// ─────────────────────────────────────────────────────────────
// 5. BEHAVIOURAL — run the REAL ported generators (they're pure)
// ─────────────────────────────────────────────────────────────
(function () {
    const startMark = 'function _sdNeuroInject';
    const endMark = 'window.sdApplyNeuroVariant';
    const s = canvas.indexOf(startMark), e = canvas.indexOf(endMark);
    ok('extracted the pure generator block', s > 0 && e > s);
    if (s < 0 || e <= s) return;
    let genVariant;
    try {
        genVariant = new Function(canvas.slice(s, e) + '\n; return _sdGenNeuroVariant;')();
    } catch (err) {
        ok('generator block evaluates', false, err.message);
        return;
    }
    ok('generator block evaluates', typeof genVariant === 'function');

    const variants = ['smooth','storm','poly','call','acid','anchor'];
    const ranges = [ { sB: 0, eB: 4 }, { sB: 0, eB: 16 }, { sB: 0, eB: 32 }, { sB: 8, eB: 24 } ];  // 1/4/8 bars + a selection

    let allValid = true, timesOk = true, sortedOk = true, totalPoints = 0;
    for (const v of variants) {
        for (const r of ranges) {
            for (let iter = 0; iter < 25; iter++) {   // Math.random -> exercise many instances
                const pts = genVariant(v, r.sB, r.eB);
                if (!Array.isArray(pts)) { allValid = false; continue; }
                totalPoints += pts.length;
                let prevT = -Infinity;
                for (const p of pts) {
                    if (!Number.isFinite(p.time) || !Number.isFinite(p.value)) allValid = false;
                    if (p.value < -0.001 || p.value > 1.001) allValid = false;                 // in [0,1]
                    if (p.curve < -1.001 || p.curve > 1.001) allValid = false;                 // sane bezier
                    if (p.time < r.sB - 0.05 || p.time > r.eB + 0.05) timesOk = false;          // within the range
                    if (p.time < prevT - 1e-9) sortedOk = false;                                // non-decreasing
                    prevT = p.time;
                }
            }
        }
    }
    ok('every point: value in [0,1] + finite (all variants, all ranges)', allValid);
    ok('every point: time within the target [sB,eB]', timesOk);
    ok('points are emitted sorted (non-decreasing time)', sortedOk);
    ok('generators actually produce motion (points > 0)', totalPoints > 0);

    // Per-variant sanity: each produces at least some points for an 8-bar lane.
    for (const v of variants) {
        let got = 0;
        for (let i = 0; i < 10; i++) got += genVariant(v, 0, 32).length;
        ok('variant "' + v + '" generates points over 8 bars', got > 0);
    }

    // Empty/degenerate range must not throw or emit garbage.
    let safe = true;
    try { const z = genVariant('anchor', 0, 0); if (!Array.isArray(z)) safe = false; } catch (e2) { safe = false; }
    ok('zero-length range is handled safely', safe);
})();

console.log('  ' + passed + ' passed, ' + failed + ' failed');
process.exit(failed ? 1 : 0);
