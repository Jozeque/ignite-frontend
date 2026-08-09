/**
 * test-vst3-unmap.js
 *
 * "Unmap" button — the inverse of Map. Same learn-by-touch flow, but touching a mapped knob
 * REMOVES it from the canvas. Map and Unmap are mutually exclusive. Source-assertion style
 * (C++ isn't run in Node) + a behavioural replica of the touch-to-remove + mutual-exclusion.
 */
'use strict';
const fs = require('fs');
const path = require('path');

let passed = 0, failed = 0;
function ok(name, cond, extra) {
    if (cond) { passed++; }
    else { failed++; console.log('  ✗ ' + name + (extra ? '  — ' + extra : '')); }
}
console.log('test-vst3-unmap.js');

const root = path.join(__dirname, '..', '..');
const rd = (p) => fs.readFileSync(p, 'utf8');
const W = path.join(root, 'stride-wrapper', 'm0-spike');
const procH  = rd(path.join(W, 'src', 'PluginProcessor.h'));
const procC  = rd(path.join(W, 'src', 'PluginProcessor.cpp'));
const editor = rd(path.join(W, 'src', 'PluginEditor.cpp'));
const shim   = rd(path.join(W, 'ui', 'shim.js'));

// ── engine ──────────────────────────────────────────────────
ok('unlearnMode + setUnlearnMode + isUnlearning exist', /std::atomic<bool>\s+unlearnMode/.test(procH) && /void\s+setUnlearnMode\s*\(bool/.test(procH) && /bool\s+isUnlearning\(\)/.test(procH));
ok('unmapParamByTouch defined + guards on unlearn mode (+ editLocked soft-lock)', /void\s+StrideWrapperProcessor::unmapParamByTouch[\s\S]{0,120}if\s*\(editLocked\.load\(\)\s*\|\|\s*!\s*unlearnMode\.load\(\)\)\s*return/.test(procC));
ok('unmap removes the matching mapped entry + its drive lanes + frees the slot',
   /unmapParamByTouch[\s\S]{0,900}driveLanes\.erase[\s\S]{0,120}mapped\.erase[\s\S]{0,80}reassignMacros\(\)/.test(procC));
ok('the touch callbacks route to BOTH map + unmap', /audioProcessorParameterChanged[\s\S]{0,200}mapParam[\s\S]{0,220}unmapParamByTouch/.test(procC) && /GestureBegin[\s\S]{0,200}mapParam[\s\S]{0,220}unmapParamByTouch/.test(procC));
ok('Map and Unmap are mutually exclusive', /setLearnMode[\s\S]{0,120}if\s*\(shouldLearn\)\s*unlearnMode\.store\s*\(false\)/.test(procC) && /setUnlearnMode[\s\S]{0,120}if\s*\(shouldUnlearn\)\s*learnMode\.store\s*\(false\)/.test(procC));

// ── editor + UI ─────────────────────────────────────────────
ok('editor has a toggleUnlearn listener -> setUnlearnMode', /withEventListener\s*\("toggleUnlearn"[\s\S]{0,120}setUnlearnMode/.test(editor));
ok('editor pushes the unmap flag (isUnlearning) in learnState', /setProperty\s*\(\s*"unmap",\s*proc\.isUnlearning\(\)\)/.test(editor));
ok('shim has an Unmap button emitting toggleUnlearn', /sbtn\('⊘ Unmap',\s*'toggleUnlearn'/.test(shim));
ok('Unmap button is styled distinctly (rose) + armed pulse', /BTN_UNMAP\s*=\s*'[^']*rose/.test(shim) && /sd-unmap-armed/.test(shim));
ok('learnState updates BOTH the Map and Unmap buttons', /learnState[\s\S]{0,260}mapBtn\.className[\s\S]{0,160}unmapBtn\.className/.test(shim));

// ── behavioural: touch-to-remove + mutual exclusion ─────────
(function () {
    // Replica: unmap removes the mapped entry matching the touched (node,param), leaves the rest.
    function unmapByTouch(mapped, node, param) {
        for (let i = 0; i < mapped.length; i++)
            if (mapped[i].node === node && mapped[i].param === param) { mapped.splice(i, 1); return true; }
        return false;
    }
    let mapped = [{ node: 0, param: 5, id: 'A' }, { node: 0, param: 9, id: 'B' }, { node: 1, param: 2, id: 'C' }];
    const removed = unmapByTouch(mapped, 0, 9);   // touch B
    ok('touching a mapped knob removes exactly that entry', removed && mapped.length === 2 && !mapped.some(m => m.id === 'B'));
    ok('the other mapped params are untouched', mapped.some(m => m.id === 'A') && mapped.some(m => m.id === 'C'));
    ok('touching an UNmapped knob is a no-op', unmapByTouch(mapped, 3, 3) === false && mapped.length === 2);

    // Mutual exclusion: arming one disarms the other.
    let learn = false, unlearn = false;
    const setLearn = (v) => { learn = v; if (v) unlearn = false; };
    const setUnlearn = (v) => { unlearn = v; if (v) learn = false; };
    setLearn(true);   ok('arming Map turns Unmap off', learn && !unlearn);
    setUnlearn(true); ok('arming Unmap turns Map off', unlearn && !learn);
    setLearn(true);   ok('arming Map again turns Unmap off', learn && !unlearn);
})();

console.log('  ' + passed + ' passed, ' + failed + ' failed');
process.exit(failed ? 1 : 0);
