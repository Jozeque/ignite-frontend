/**
 * test-vst3-host-automation.js
 *
 * Covers Phase 1 of the host-automation macro layer (docs/stride-wrapper-host-automation-spec.md):
 * a fixed pool of 32 VST3 "macro" params Stride publishes so the DAW can automate/record the
 * hosted knobs, a stable slot assignment keyed to (node,param), a global Live/Automation drive
 * mode, backward-compatible persistence, and the editor/UI wiring.
 *
 * Source-assertion style (C++ isn't compiled in Node) + a behavioural replica proving the ONE
 * property that matters: unmapping/removing a param frees its slot WITHOUT shuffling the others,
 * so the DAW's automation stays bound to the same knob.
 */
'use strict';
const fs = require('fs');
const path = require('path');

let passed = 0, failed = 0;
function ok(name, cond, extra) {
    if (cond) { passed++; }
    else { failed++; console.log('  ✗ ' + name + (extra ? '  — ' + extra : '')); }
}
console.log('test-vst3-host-automation.js');

const root = path.join(__dirname, '..', '..');
const rd = (p) => fs.readFileSync(p, 'utf8');
const W = path.join(root, 'stride-wrapper', 'm0-spike');
const procH  = rd(path.join(W, 'src', 'PluginProcessor.h'));
const procC  = rd(path.join(W, 'src', 'PluginProcessor.cpp'));
const editor = rd(path.join(W, 'src', 'PluginEditor.cpp'));
const shim   = rd(path.join(W, 'ui', 'shim.js'));
const cmake  = rd(path.join(W, 'CMakeLists.txt'));

// ─────────────────────────────────────────────────────────────
// 1. Macro parameter pool (fixed, published to the DAW)
// ─────────────────────────────────────────────────────────────
ok('kMacroCount = 32', /static constexpr int kMacroCount = 32/.test(procH));
ok('MacroParameter subclasses AudioProcessorParameter', /class\s+MacroParameter\s*:\s*public\s+juce::AudioProcessorParameter/.test(procH));
ok('MacroParameter holds an atomic value (audio-thread safe)', /std::atomic<float>\s+value/.test(procH));
ok('MacroParameter is automatable', /bool\s+isAutomatable\(\)\s*const\s+override\s*\{\s*return\s+true/.test(procH));
ok('free macro reads "Stride N", assigned reads the label', /Stride\s+"\s*\+\s*juce::String\s*\(slot\s*\+\s*1\)/.test(procH) && /l\.isNotEmpty\(\)\s*\?\s*l/.test(procH));
ok('macro pool array of pointers held for the drive loop', /std::array<MacroParameter\*,\s*kMacroCount>\s+macroParams/.test(procH));
ok('constructor creates + addParameter for the whole pool', /for\s*\(int i = 0; i < kMacroCount; \+\+i\)[\s\S]{0,180}addParameter\s*\(mp\)/.test(procC));

// ─────────────────────────────────────────────────────────────
// 2. Stable slot assignment keyed to the mapped param
// ─────────────────────────────────────────────────────────────
ok('MapRef carries a macroSlot (stable, travels with the entry)', /struct\s+MapRef\s*\{\s*int\s+node;\s*int\s+param;\s*int\s+macroSlot/.test(procH));
ok('reassignMacros exists', /void\s+StrideWrapperProcessor::reassignMacros\s*\(\)/.test(procC));
ok('reassignMacros keeps valid unique slots (only clears -1/oob/dup)', /if\s*\(m\.macroSlot < 0 \|\| m\.macroSlot >= kMacroCount \|\| used\[[^\]]*m\.macroSlot\]\)/.test(procC));
ok('mapParam claims a slot + relabels', /mapped\.push_back\s*\(\{\s*node,\s*parameterIndex,\s*-1\s*\}\)[\s\S]{0,120}reassignMacros\(\)[\s\S]{0,220}triggerAsyncUpdate/.test(procC));
ok('unmap frees the slot (reassignMacros in removeMappedAt)', /removeMappedAt[\s\S]{0,900}reassignMacros\(\)/.test(procC));
ok('removeNode reassigns (remaining params keep slots)', /removeNode[\s\S]{0,2400}reassignMacros\(\)/.test(procC));   // window widened for the 1.3.0 loop/quant snapshot lines
ok('macroSlotFor looks up the slot by (node,param)', /int\s+StrideWrapperProcessor::macroSlotFor\s*\(int node, int param\)/.test(procC));

// ─────────────────────────────────────────────────────────────
// 3. Relabel on the MESSAGE thread (AsyncUpdater) — updateHostDisplay
// ─────────────────────────────────────────────────────────────
ok('processor is an AsyncUpdater (relabel works even with the editor closed)', /private\s+juce::AsyncUpdater/.test(procH));
ok('handleAsyncUpdate -> refreshMacroLabels', /void\s+StrideWrapperProcessor::handleAsyncUpdate\s*\(\)[\s\S]{0,80}refreshMacroLabels\(\)/.test(procC));
ok('refreshMacroLabels sets real names + fires kParamTitlesChanged', /void\s+StrideWrapperProcessor::refreshMacroLabels[\s\S]{0,1400}updateHostDisplay\s*\([\s\S]{0,90}withParameterInfoChanged\s*\(true\)/.test(procC));
ok('ChangeDetails is fully-qualified (avoids the AudioProcessor/Listener ambiguity)', /juce::AudioProcessorListener::ChangeDetails\{\}\.withParameterInfoChanged/.test(procC));
ok('destructor cancels the pending relabel (no use-after-free)', /~StrideWrapperProcessor[\s\S]{0,120}cancelPendingUpdate\(\)/.test(procC));

// ─────────────────────────────────────────────────────────────
// 4. Global Live/Automation drive mode (processBlock branch)
// ─────────────────────────────────────────────────────────────
ok('DriveMode enum (Live/Automation)', /enum class DriveMode\s*\{\s*Live,\s*Automation\s*\}/.test(procH));
ok('driveMode atomic defaults to Live', /std::atomic<DriveMode>\s+driveMode\s*\{\s*DriveMode::Live\s*\}/.test(procH));
ok('AUTOMATION branch: DAW macro value -> hosted param', /DriveMode::Automation[\s\S]{0,1000}macroParams\[[^\]]*macroSlot\]->getValue\(\)/.test(procC));
ok('LIVE branch: curve drives + mirrors onto the macro', /interp\s*\([\s\S]{0,400}macroParams\[[^\]]*slot\]->setValue\s*\(v\)/.test(procC));
ok('freeze (demo) still skips ALL driving', /!\s*demoFreezeNow/.test(procC));

// ─────────────────────────────────────────────────────────────
// 5. Persistence — backward-compatible (missing = defaults)
// ─────────────────────────────────────────────────────────────
ok('state schema version bumped to 2', /setAttribute\s*\(\s*"version",\s*2\s*\)/.test(procC));
ok('driveMode persisted', /setAttribute\s*\(\s*"driveMode",\s*\(int\)\s*driveMode\.load\(\)/.test(procC));
ok('macroSlot persisted per mapped param ("s")', /setAttribute\s*\(\s*"s",\s*m\.macroSlot\s*\)/.test(procC));
ok('driveMode restored (default 0=Live for old projects)', /driveMode\.store\s*\(\s*\(DriveMode\)\s*xml->getIntAttribute\s*\(\s*"driveMode",\s*0\s*\)/.test(procC));
ok('macroSlot restored via Dev.slots (default -1 for pre-macro projects)', /\.slots\.push_back\s*\(e->getIntAttribute\s*\(\s*"s",\s*-1\s*\)/.test(procC));
ok('restoreNextDevice carries the persisted slot onto the mapped entry', /mapped\.push_back\s*\(\{\s*p,\s*d\.params\[k\],\s*k < d\.slots\.size\(\)\s*\?\s*d\.slots\[k\]\s*:\s*-1,/.test(procC));   // trailing comma: the entry now also carries the range band (1.1.5)
ok('demo still persists nothing (save-off preserved)', /getStateInformation[\s\S]{0,120}if\s*\(demoMode\.load\(\)\)\s*return;/.test(procC));

// ─────────────────────────────────────────────────────────────
// 6. Editor + UI wiring
// ─────────────────────────────────────────────────────────────
ok('editor has a setDriveMode event listener', /withEventListener\s*\("setDriveMode"[\s\S]{0,160}setDriveMode/.test(editor));
ok('rack_scanned exposes drive_mode + exposed_macros + macro_pool', /"drive_mode"[\s\S]{0,200}"exposed_macros"[\s\S]{0,200}"macro_pool"/.test(editor));
ok('shim has a DAW/Live toggle button', /◆ DAW|▶ Live/.test(shim));
ok('shim toggle emits setDriveMode', /emit\('setDriveMode',\s*\{\s*mode:/.test(shim));
ok('shim reads drive_mode/exposed_macros from rack_scanned', /msg\.drive_mode[\s\S]{0,200}msg\.exposed_macros/.test(shim));

// ─────────────────────────────────────────────────────────────
// 7. Additive / no-break guarantees
// ─────────────────────────────────────────────────────────────
ok('plugin identity unchanged (PLUGIN_CODE SwM0)', /PLUGIN_CODE\s+SwM0/.test(cmake));
ok('plugin identity unchanged (manufacturer Strd)', /PLUGIN_MANUFACTURER_CODE\s+Strd/.test(cmake));
ok('macro count is a compile-time constant (fixed VST3 param list)', /static constexpr int kMacroCount/.test(procH));
ok('Live is the default mode (existing behavior preserved)', /driveMode\s*\{\s*DriveMode::Live\s*\}/.test(procH));

// ─────────────────────────────────────────────────────────────
// 7b. Configure exposure — announce macros to Ableton via a host gesture
// ─────────────────────────────────────────────────────────────
ok('announceMacrosToHost exists', /void\s+StrideWrapperProcessor::announceMacrosToHost/.test(procC));
ok('it fires a real host gesture (begin/setValueNotifyingHost/end)',
   /announceMacrosToHost[\s\S]{0,900}beginChangeGesture\(\)[\s\S]{0,200}setValueNotifyingHost[\s\S]{0,200}endChangeGesture\(\)/.test(procC));
ok('it only announces EXPOSED macros (macroSlot >= 0)', /announceMacrosToHost[\s\S]{0,400}m\.macroSlot >= 0/.test(procC));
ok('editor has the announceMacros event listener', /withEventListener\s*\("announceMacros"[\s\S]{0,80}announceMacrosToHost/.test(editor));
ok('shim has a Send-to-DAW action emitting announceMacros', /emit\('announceMacros'\)/.test(shim) && /Send to DAW/.test(shim));
ok('Live/DAW toggle + Send are folded under one automation popover', /DAW Automation/.test(shim) && /sd-auto-live/.test(shim) && /sd-auto-daw/.test(shim) && /sd-auto-send/.test(shim));
ok('DAW mode dims the canvas + shows a banner (clear Stride-OR-DAW signal)',
   /classList\.toggle\('sd-daw-mode',\s*daw\)/.test(shim) && /body\.sd-daw-mode #sd-canvas-container > canvas\{opacity/.test(shim) && /◆ DAW driving/.test(shim));
ok('drive toggle reads "Stride" (disambiguated from Ableton Live)', /▶ Stride/.test(shim));

// ─────────────────────────────────────────────────────────────
// 8. BEHAVIOURAL — the stability property (spec §3): unmap frees a slot
//    without shuffling the others; a new map reuses the freed slot.
// ─────────────────────────────────────────────────────────────
function reassign(mapped, N) {
    const used = new Array(N).fill(false);
    for (const m of mapped) {
        if (m.slot < 0 || m.slot >= N || used[m.slot]) m.slot = -1;
        else used[m.slot] = true;
    }
    for (const m of mapped) {
        if (m.slot < 0)
            for (let s = 0; s < N; s++) if (!used[s]) { m.slot = s; used[s] = true; break; }
    }
    return mapped;
}
(function () {
    const N = 32;
    let m = [{ id: 'A', slot: -1 }, { id: 'B', slot: -1 }, { id: 'C', slot: -1 }];
    reassign(m, N);
    ok('fresh map assigns 0,1,2 in order', m[0].slot === 0 && m[1].slot === 1 && m[2].slot === 2);

    // Unmap B: remove it, the OTHERS keep their slots, then reassign.
    m = m.filter((x) => x.id !== 'B');
    reassign(m, N);
    const A = m.find((x) => x.id === 'A'), C = m.find((x) => x.id === 'C');
    ok('unmapping B does NOT shuffle C (C keeps slot 2)', C.slot === 2 && A.slot === 0);

    // Map D: it should reuse the freed slot 1, not push C.
    m.push({ id: 'D', slot: -1 });
    reassign(m, N);
    const D = m.find((x) => x.id === 'D');
    ok('new map D reuses the freed slot 1', D.slot === 1 && C.slot === 2);

    // Reload with a persisted slot: a valid stored slot is kept exactly (DAW automation matches).
    let loaded = [{ id: 'X', slot: 5 }, { id: 'Y', slot: 9 }];
    reassign(loaded, N);
    ok('persisted slots survive a reload unchanged', loaded[0].slot === 5 && loaded[1].slot === 9);

    // Pool full: 32 map, the 33rd stays -1 (driven in Stride, not exposed).
    let full = Array.from({ length: 33 }, (_, i) => ({ id: i, slot: -1 }));
    reassign(full, N);
    const exposed = full.filter((x) => x.slot >= 0).length;
    ok('32 exposed, the 33rd stays -1 (not exposed)', exposed === 32 && full[32].slot === -1);

    // Duplicate/corrupt slots get de-duped deterministically.
    let dup = [{ id: 'P', slot: 3 }, { id: 'Q', slot: 3 }];
    reassign(dup, N);
    ok('duplicate slots are de-duped (one keeps 3, the other gets a fresh slot)',
       dup[0].slot === 3 && dup[1].slot >= 0 && dup[1].slot !== 3);
})();

// ─────────────────────────────────────────────────────────────
// 9. Wide-main-bus crash fix (SIGSEGV: memset null on load of a >2ch instrument)
// ─────────────────────────────────────────────────────────────
ok('wide (>2ch) main bus constrained to stereo where allowed',
   /getNumberOfChannels\(\) > 2[\s\S]{0,140}setCurrentLayout\s*\(\s*juce::AudioChannelSet::stereo/.test(procC));
ok('processBlock work buffer backstops a >2ch instrument (no null-channel memset)',
   /needCh[\s\S]{0,500}hostWorkBuffer\.setSize/.test(procC) && /hostWorkBuffer\.copyFrom/.test(procC) && /buffer\.copyFrom\s*\(ch, 0, hostWorkBuffer/.test(procC));
ok('needCh spans the whole chain (in + out channels of every node)',
   /needCh = juce::jmax \(needCh, n\.inst->getTotalNumInputChannels\(\), n\.inst->getTotalNumOutputChannels\(\)\)/.test(procC));
ok('stereo chains keep the in-place fast path (no copy overhead)', /needCh <= buffer\.getNumChannels\(\)/.test(procC));
ok('work buffer is pre-sized in prepareToPlay (no audio-thread realloc for common widths)',
   /prepareToPlay[\s\S]{0,300}hostWorkBuffer\.setSize \(16,/.test(procC));

console.log('  ' + passed + ' passed, ' + failed + ' failed');
process.exit(failed ? 1 : 0);
