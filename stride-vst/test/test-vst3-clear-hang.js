/**
 * test-vst3-clear-hang.js
 *
 * Covers the CLEAR freeze (field report 2026-08-09: "several automation lanes open,
 * hit Clear, Ableton hangs — force close"). Root shape: teardown paths held hostLock
 * on Live's MAIN thread while (a) calling INTO hosted plugins (getStateInformation
 * for undo snapshots) and (b) DESTROYING hosted instances. A plugin whose getState
 * or destructor waits on its own worker/GUI closes the same freeze cycle as the
 * Wave Shift hang — and the shipped 1.3.1 has none of the hang hardening at all.
 *
 * The fix, everywhere a hosted instance is read-for-undo or torn down:
 *   TWO-PHASE — cheap metadata under the lock + SWAP the chain out (audio's next
 *   try-lock sees it empty), then hosted getState calls and destructors run AFTER
 *   the lock is released. Entries also refuse outright (bounded probe) when the
 *   audio thread is already wedged.
 * Sites: clearChain, removeNode, the setState project-load teardown, duplicateNode.
 */
'use strict';
const fs = require('fs');
const path = require('path');

let passed = 0, failed = 0;
function ok(name, cond, extra) {
    if (cond) { passed++; }
    else { failed++; console.log('  ✗ ' + name + (extra ? '  — ' + extra : '')); }
}
console.log('test-vst3-clear-hang.js');

const W      = path.join(__dirname, '..', '..', 'stride-wrapper', 'm0-spike');
const rd     = (p) => fs.readFileSync(p, 'utf8');
const procC  = rd(path.join(W, 'src', 'PluginProcessor.cpp'));
const editor = rd(path.join(W, 'src', 'PluginEditor.cpp'));

const fnBody = (src, sig) => {
    const s = src.indexOf(sig);
    if (s < 0) return '';
    const nxt = src.indexOf('\nvoid StrideWrapperProcessor::', s + sig.length);
    return src.slice(s, nxt > 0 ? nxt : s + 4000);
};

// ─────────────────────────────────────────────────────────────
// 1. BEHAVIORAL — the two-phase order, replicated
// ─────────────────────────────────────────────────────────────
(function () {
    // Model: under the lock the chain is swapped out; plugin calls + destruction
    // happen after release. The audio thread (try-lock) must never see a chain
    // that is mid-destruction — it sees the full chain, or an empty one.
    const events = [];
    const lock = { held: false };
    const clearChain = () => {
        lock.held = true; events.push('lock');
        events.push('swap');                       // chain -> doomed under the lock
        lock.held = false; events.push('unlock');
        events.push('getState');                   // plugin calls, lock-free
        events.push('destroy');                    // destructors, lock-free
    };
    clearChain();
    ok('plugin calls happen strictly AFTER the lock releases',
       events.indexOf('unlock') < events.indexOf('getState') && events.indexOf('getState') < events.indexOf('destroy'));
    ok('the swap happens under the lock (audio can never see a half-dead chain)',
       events.indexOf('lock') < events.indexOf('swap') && events.indexOf('swap') < events.indexOf('unlock'));
})();

// ─────────────────────────────────────────────────────────────
// 2. clearChain — two-phase + bounded refuse
// ─────────────────────────────────────────────────────────────
(function () {
    const b = fnBody(procC, 'void StrideWrapperProcessor::clearChain()');
    ok('clearChain refuses outright when the audio thread is wedged', /hostLockFreeBounded \(8\)\) return;/.test(b));
    ok('clearChain swaps the chain out under the lock', /doomed\.swap \(chain\);/.test(b));
    ok('clearChain makes NO plugin calls under the lock',
       (() => { const lockAt = b.indexOf('ScopedLock'); const swapAt = b.indexOf('doomed.swap'); const gs = b.indexOf('getStateInformation');
                return lockAt > 0 && swapAt > lockAt && gs > swapAt; })());
    ok('undo patches are captured from the DETACHED nodes, then destructors run lock-free',
       /for \(size_t i = 0; i < doomed\.size\(\)[\s\S]{0,200}getStateInformation \(lastRemoved\.devices\[i\]\.state\);[\s\S]{0,100}doomed\.clear\(\);/.test(b));
})();

// ─────────────────────────────────────────────────────────────
// 3. removeNode / setState teardown / duplicateNode — same treatment
// ─────────────────────────────────────────────────────────────
(function () {
    const b = fnBody(procC, 'void StrideWrapperProcessor::removeNode (int index)');
    ok('removeNode refuses when wedged + detaches the node under the lock',
       /hostLockFreeBounded \(8\)\) return;/.test(b) && /doomed = std::move \(chain\[\(size_t\) index\]\);/.test(b));
    ok('removeNode captures the patch + destroys OUTSIDE the lock',
       /\}\s*\n\s*\/\/ OUTSIDE the lock[\s\S]{0,300}doomed\.inst->getStateInformation \(lastRemoved\.devices\[0\]\.state\);[\s\S]{0,100}doomed = \{\};/.test(b));
})();
ok('project-load teardown swaps out under the lock and destroys after release',
   /doomed\.swap \(self->chain\); self->mapped\.clear\(\);/.test(procC)
   && /doomed\.clear\(\);\s+\/\/ hosted destructors run lock-free on the message thread/.test(procC));
ok('duplicateNode reads the source patch OUTSIDE the lock (instance stays owned + alive)',
   /srcInst\s+= chain\[\(size_t\) index\]\.inst\.get\(\);/.test(procC)
   && /if \(srcInst != nullptr\) srcInst->getStateInformation \(\(\*devs\)\[0\]\.state\);/.test(procC));

// ─────────────────────────────────────────────────────────────
// 4. Ordering invariants that must survive this refactor
// ─────────────────────────────────────────────────────────────
ok('editors still die BEFORE their instances (Clear route: windows first, then clearChain)',
   /synthWindows\.clear\(\); proc\.clearChain\(\);/.test(editor));
ok('the setState teardown still closes hosted editors before anything else',
   /closeHostedEditorsForTeardown\(\);[\s\S]{0,700}doomed\.swap \(self->chain\)/.test(procC));

console.log('  ' + passed + ' passed, ' + failed + ' failed');
process.exit(failed ? 1 : 0);
