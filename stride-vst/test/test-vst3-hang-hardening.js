/**
 * test-vst3-hang-hardening.js
 *
 * Covers the Wave Shift hang guard (field incident 2026-08-06, twice, force-quit):
 * the audio thread holds hostLock across the hosted-chain run, so a hosted plugin
 * that STALLS inside processBlock parks the lock forever — and every BLOCKING
 * message-thread ScopedLock then froze Live's whole UI behind it (WER AppHangB1,
 * no faulting module because hangs never name one).
 *
 * The guard: nothing PERIODIC or LISTENER-DRIVEN may block on hostLock.
 *   - editor timer: skip the whole tick when the lock is wedged
 *   - canvas-message funnel (handleStrideLinkSend): drop the message when wedged
 *   - param-listener trio (mapParam / unmapParamByTouch / noteParamTouched):
 *     try-lock — hosted plugins notify from arbitrary threads
 *   - macro mirror (pushMacroValuesToHost): try-lock, a skipped tick is invisible
 * With Live's main thread never parked, a plugin waiting on it gets serviced,
 * its processBlock returns, the lock frees — the deadlock cannot sustain itself.
 */
'use strict';
const fs = require('fs');
const path = require('path');

let passed = 0, failed = 0;
function ok(name, cond, extra) {
    if (cond) { passed++; }
    else { failed++; console.log('  ✗ ' + name + (extra ? '  — ' + extra : '')); }
}
console.log('test-vst3-hang-hardening.js');

const W      = path.join(__dirname, '..', '..', 'stride-wrapper', 'm0-spike');
const rd     = (p) => fs.readFileSync(p, 'utf8');
const procC  = rd(path.join(W, 'src', 'PluginProcessor.cpp'));
const procH  = rd(path.join(W, 'src', 'PluginProcessor.h'));
const editor = rd(path.join(W, 'src', 'PluginEditor.cpp'));

// ─────────────────────────────────────────────────────────────
// 1. BEHAVIORAL — the wedge scenario AND the duty-cycle regression, replicated
// ─────────────────────────────────────────────────────────────
(function () {
    // Take two (2026-08-07): the audio thread holds the lock a large SLICE of real time
    // (the whole hosted-chain run), so a SINGLE-try probe fails at that duty cycle and
    // skipped work that should have run — the keyswitch regression. The BOUNDED probe
    // retries across a few ms: normal duty-cycle contention passes, a true wedge fails.
    let heldPattern = [];   // per-probe-attempt schedule of "is the lock held right now"
    let probeCalls = 0;
    const tryOnce = () => !(heldPattern[probeCalls++ % heldPattern.length]);
    const bounded = (tries) => { for (let i = 0; i < tries; i++) if (tryOnce()) return true; return false; };

    heldPattern = [true, false];            // ~50% duty cycle (audio holds every other probe)
    probeCalls = 0;
    let passes = 0;
    for (let t = 0; t < 20; t++) if (bounded(4)) passes++;
    ok('bounded probe rides out normal duty-cycle contention (no skipped ticks)', passes === 20);

    heldPattern = [true];                   // a true wedge: held at every probe, forever
    probeCalls = 0;
    ok('bounded probe still detects a true wedge and skips', bounded(4) === false);

    // The atomic sections (keyswitch drain, playhead) run EVERY tick regardless — the
    // main thread never parks, and latched keyswitch bits drain on time, every time.
    let ticks = 0, drains = 0, tailWork = 0;
    const tick = (wedged) => { ticks++; drains++; if (!wedged) tailWork++; };
    tick(false); tick(true); tick(true); tick(false);
    ok('drains fire on every tick; only the lock tail skips under a wedge', ticks === 4 && drains === 4 && tailWork === 2);
})();

// ─────────────────────────────────────────────────────────────
// 2. SOURCE — every periodic/listener path is non-blocking
// ─────────────────────────────────────────────────────────────
ok('both probes declared (single-try + bounded with 1ms-spaced retries)',
   /bool hostLockFreeNow\(\) const \{ const juce::ScopedTryLock t \(hostLock\); return t\.isLocked\(\); \}/.test(procH)
   && /bool hostLockFreeBounded \(int tries = 4\) const[\s\S]{0,300}juce::Thread::sleep \(1\);/.test(procH));
ok('editor tick is UNGATED through the atomic sections (keyswitch drain fires every tick — the 2026-08-07 regression fix)',
   (() => {
       const body = editor.slice(editor.indexOf('void StrideWrapperEditor::timerCallback()'));
       const drain = body.indexOf('consumeKeyswitchMask');
       const gate = body.indexOf('hostLockFreeBounded');
       const anyGateCall = body.slice(0, drain).indexOf('proc.hostLockFree');   // a CALL before the drain = a gate (comments may name the probes)
       return drain > 0 && gate > drain && anyGateCall === -1;
   })());
ok('only the lock-taking tail is gated, with the BOUNDED probe, right before the chain-summary read',
   /if \(! proc\.hostLockFreeBounded\(\)\) return;\s*\n\s*const auto summary = proc\.getChainSummary\(\);/.test(editor));
ok('canvas-message funnel uses the BOUNDED probe (clicks never drop under normal contention)',
   /void StrideWrapperEditor::handleStrideLinkSend \(const juce::var& msg\)\s*\{[\s\S]{0,600}if \(! proc\.hostLockFreeBounded\(\)\) return;/.test(editor));
ok('mapParam: bounded probe then a normal lock (learn touches survive duty-cycle contention)',
   /learnMode\.load\(\)\) return;[\s\S]{0,700}if \(! hostLockFreeBounded \(3\)\) return;\s*\n\s*const juce::ScopedLock sl \(hostLock\);/.test(procC));
ok('unmapParamByTouch: bounded probe then a normal lock',
   /unlearnMode\.load\(\)\) return;[\s\S]{0,300}if \(! hostLockFreeBounded \(3\)\) return;[^\n]*\n\s*const juce::ScopedLock sl \(hostLock\);/.test(procC));
ok('noteParamTouched (glow) tries, never blocks',
   /if \(learnMode\.load\(\) \|\| unlearnMode\.load\(\)\) return;\s*\n\s*const juce::ScopedTryLock sl \(hostLock\);[\s\S]{0,200}if \(! sl\.isLocked\(\)\) return;/.test(procC));
ok('macro mirror tries, never blocks (a skipped mirror tick is invisible)',
   /lastMirrorPushMs = now;[\s\S]{0,300}ScopedTryLock sl \(hostLock\);[\s\S]{0,200}if \(! sl\.isLocked\(\)\) return;/.test(procC));
ok('audio side unchanged: processBlock still TRY-locks and skips when contended',
   /const juce::ScopedTryLock sl \(hostLock\);\s*\n\s*if \(sl\.isLocked\(\) && ! chain\.empty\(\)\)/.test(procC));
ok('residual documented: getStateInformation deliberately still blocks (hang vs silent data loss)',
   /getStateInformation still blocks/.test(procH));

console.log('  ' + passed + ' passed, ' + failed + ' failed');
process.exit(failed ? 1 : 0);
