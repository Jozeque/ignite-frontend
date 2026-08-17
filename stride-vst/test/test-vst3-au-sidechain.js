/**
 * test-vst3-au-sidechain.js
 *
 * 1.3.4: the stereo AUDIO IN bus now includes the AU (it was excluded in 1.2.0 to
 * keep the frozen aumu surface untouched; this is the promised "own auval-gated
 * pass"). An input element on the music device is what makes Logic show its Side
 * Chain menu on Stride (field request 2026-08-14). Pins:
 *   - strideBuses declares the input UNCONDITIONALLY (no host-type gate)
 *   - the aumu identity is untouched (no manufacturer/code churn)
 *   - layout contract stays stereo-or-disabled in / stereo out
 *   - the empty-chain clear survives only for disabled-input hosts
 */
'use strict';
const fs = require('fs');
const path = require('path');

let passed = 0, failed = 0;
function ok(name, cond, extra) {
    if (cond) { passed++; }
    else { failed++; console.log('  ✗ ' + name + (extra ? '  — ' + extra : '')); }
}
console.log('test-vst3-au-sidechain.js');

const root = path.join(__dirname, '..', '..', 'stride-wrapper', 'm0-spike');
const cpp = fs.readFileSync(path.join(root, 'src', 'PluginProcessor.cpp'), 'utf8');
const hdr = fs.readFileSync(path.join(root, 'src', 'PluginProcessor.h'), 'utf8');

// ─── SOURCE — the bus is unconditional now ───────────────────
const busFn = (cpp.match(/BusesProperties StrideWrapperProcessor::strideBuses\(\)[\s\S]{0,400}?\n\}/) || [''])[0];
ok('strideBuses declares the stereo input with NO host-type gate',
   /withInput \("Audio In", juce::AudioChannelSet::stereo\(\), true\)/.test(busFn)
   && !/wrapperType_AudioUnit/.test(busFn) && !/getPluginLoadedAs/.test(busFn));
ok('the input bus keeps its 1.2.0 name (host pin/routing names must not churn)',
   /withInput \("Audio In"/.test(busFn));
ok('layout contract unchanged: input stereo-or-disabled, output stereo',
   /getMainOutputChannelSet\(\) != juce::AudioChannelSet::stereo\(\)\) return false;/.test(cpp)
   && /in == juce::AudioChannelSet::disabled\(\) \|\| in == juce::AudioChannelSet::stereo\(\);/.test(cpp));
ok('empty-chain clear survives for disabled-input hosts only (comment tells the story)',
   /unassigned Side Chain feeds silence[\s\S]{0,200}getTotalNumInputChannels\(\) == 0\)\s+buffer\.clear\(\);/.test(cpp));
ok('the comment records WHY the AU is included now (Logic Side Chain + auval gate)',
   /Side Chain menu on Stride/.test(cpp) && /strict auval gate/.test(cpp));
ok('header one-liner matches the new reality', /AU included since 1\.3\.4/.test(hdr));

// aumu identity must not churn — CMake carries the 4-char codes.
const cmake = fs.readFileSync(path.join(root, 'CMakeLists.txt'), 'utf8');
ok('frozen AU identity untouched (SwM0/Strd still the shipped codes)',
   /PLUGIN_MANUFACTURER_CODE\s+Strd/.test(cmake) && /PLUGIN_CODE\s+SwM0/.test(cmake));
ok('version is 1.3.4+', (function () {   // >= pin: the bus shape ships forward from 1.3.4 (1.4.0 bumped for Motions + Link)
    const m = cmake.match(/project\(StrideWrapperM0 VERSION (\d+)\.(\d+)\.(\d+)/);
    return !!m && (+m[1] > 1 || (+m[1] === 1 && (+m[2] > 3 || (+m[2] === 3 && +m[3] >= 4))));
})());

// ─── BEHAVIORAL — the layout acceptance, replicated ──────────
(function () {
    const accepts = (inCh, outCh) => outCh === 2 && (inCh === 0 || inCh === 2);
    ok('stereo-in accepted, disabled-in accepted (AU sidechain + VST3 no-input both live)',
       accepts(2, 2) && accepts(0, 2));
    ok('mono-in and non-stereo-out still rejected', !accepts(1, 2) && !accepts(2, 1));
})();

console.log('  ' + passed + ' passed, ' + failed + ' failed');
process.exit(failed ? 1 : 0);
