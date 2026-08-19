/**
 * test-vst3-chain-missing.js
 *
 * Missing-device report (2026-08-18). Before this, restoreNextDevice skipped
 * unfindable plugins SILENTLY: a .stridechain loaded on a machine without the
 * synth (or a project opened after an uninstall) came up half-empty with zero
 * explanation — the chain-sharing killer. Now each restore wave tallies its
 * misses (path not found AND found-but-wouldn't-instantiate), the editor timer
 * drains the tally in its UNGATED section (the 1.3.2 lesson: atomic work never
 * gates on a lock probe), and ONE chainNote names the missing devices.
 * Additive only: load behavior, file format, and the happy path are untouched.
 */
'use strict';
const fs = require('fs');
const path = require('path');

let passed = 0, failed = 0;
function ok(name, cond, extra) {
    if (cond) { passed++; }
    else { failed++; console.log('  ✗ ' + name + (extra ? '  — ' + extra : '')); }
}
console.log('test-vst3-chain-missing.js');

const root   = path.join(__dirname, '..', '..');
const W      = path.join(root, 'stride-wrapper', 'm0-spike');
const rd     = (p) => fs.readFileSync(p, 'utf8');
const procC  = rd(path.join(W, 'src', 'PluginProcessor.cpp'));
const procH  = rd(path.join(W, 'src', 'PluginProcessor.h'));
const editor = rd(path.join(W, 'src', 'PluginEditor.cpp'));

// ── processor: the wave tallies its misses ──
ok('report state lives on the processor (names + loaded + pending, message-thread only)',
   /juce::StringArray restoreMissingNames;/.test(procH) && /int  restoreMissingLoaded = 0;/.test(procH)
   && /bool restoreMissingPending = false;/.test(procH));
ok('fresh wave = fresh tally (reset at i == 0)',
   /if \(i == 0\)[\s\S]{0,220}restoreMissingNames\.clear\(\);[\s\S]{0,80}restoreMissingLoaded = 0;[\s\S]{0,80}restoreMissingPending = false;/.test(procC));
ok('wave end sets pending ONLY for the current generation (superseded waves stay silent)',
   /if \(gen == restoreGeneration\.load\(\) && ! restoreMissingNames\.isEmpty\(\)\)[\s\S]{0,60}restoreMissingPending = true;/.test(procC));
ok('path-not-found adds the device name (derived from the filename) and keeps going',
   /found\.isEmpty\(\)[\s\S]{0,260}restoreMissingNames\.add \(juce::File \(d\.path\)\.getFileNameWithoutExtension\(\)\);[\s\S]{0,120}restoreNextDevice \(devs, i \+ 1, gen\);/.test(procC));
ok('found-but-wont-instantiate is reported too (bad install / wrong arch)',
   /else\s*\{[\s\S]{0,300}restoreMissingNames\.add \(juce::File \(d\.path\)\.getFileNameWithoutExtension\(\)\);[\s\S]{0,80}ignoreUnused \(err\);/.test(procC));
ok('successful restores count toward the summary', /restoreMissingLoaded\+\+;/.test(procC));
ok('consumeRestoreMissing drains once (clears pending, hands out names + loaded)',
   /bool consumeRestoreMissing \(juce::StringArray& namesOut, int& loadedOut\)[\s\S]{0,300}restoreMissingPending = false;[\s\S]{0,120}return true;/.test(procH));

// ── editor: drained in the UNGATED timer section, surfaced as ONE chainNote ──
const idxDrain = editor.indexOf('consumeRestoreMissing');
const idxGate  = editor.indexOf('LOCK-TAKING TAIL');
ok('drain sits BEFORE the lock-taking tail (never behind the lock probe — 1.3.2 lesson)',
   idxDrain > 0 && idxGate > 0 && idxDrain < idxGate);
ok('the note names the missing devices', /"Couldn't find: " \+ missing\.joinIntoString \(", "\)/.test(editor));
ok('copy adapts: partial load vs nothing found',
   /The rest of the chain loaded fine\./.test(editor) && /None of this chain's devices were found on this machine\./.test(editor));
ok('actionable close: install, then load again', /Install them, then load the file again\./.test(editor));

// ── no-break: the load path itself is untouched ──
ok('chain load still writes state verbatim + optimistic note unchanged',
   /proc\.setStateInformation \(mb\.getData\(\), \(int\) mb\.getSize\(\)\);/.test(editor)
   && /"Chain loaded", f\.getFileNameWithoutExtension\(\)/.test(editor));
ok('missing devices are still SKIPPED, never fatal (chain keeps loading)',
   /restoreMissingNames\.add[\s\S]{0,140}restoreNextDevice \(devs, i \+ 1, gen\);\s*return;/.test(procC));
ok('demo gates on save/load unchanged', /Chain save needs a full license/.test(editor) && /Chain load needs a full license/.test(editor));

console.log('  ' + passed + ' passed, ' + failed + ' failed');
process.exit(failed ? 1 : 0);
