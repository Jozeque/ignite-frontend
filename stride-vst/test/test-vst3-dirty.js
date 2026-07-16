/**
 * test-vst3-dirty.js
 *
 * Covers the host dirty-flag batch (1.1.4). Field incident 2026-07-16: Live
 * crashed with an UNSAVED set — the chain built inside Stride was gone on
 * reload. Everything inside Stride lives in OUR chunk, which the DAW only
 * captures when IT saves — and Stride never told the DAW anything changed, so
 * the set didn't even show "unsaved changes". Now every user edit inside
 * Stride sets a pending flag (any thread) and the editor timer fires the VST3
 * setDirty notification (nonParameterStateChanged) on the message thread,
 * throttled. Restore-from-project paths deliberately DON'T set the flag.
 */
'use strict';
const fs = require('fs');
const path = require('path');

let passed = 0, failed = 0;
function ok(name, cond, extra) {
    if (cond) { passed++; }
    else { failed++; console.log('  ✗ ' + name + (extra ? '  — ' + extra : '')); }
}
console.log('test-vst3-dirty.js');

const W      = path.join(__dirname, '..', '..', 'stride-wrapper', 'm0-spike');
const rd     = (p) => fs.readFileSync(p, 'utf8');
const procC  = rd(path.join(W, 'src', 'PluginProcessor.cpp'));
const procH  = rd(path.join(W, 'src', 'PluginProcessor.h'));
const editor = rd(path.join(W, 'src', 'PluginEditor.cpp'));
const edH    = rd(path.join(W, 'src', 'PluginEditor.h'));
const cmake  = rd(path.join(W, 'CMakeLists.txt'));

// ─────────────────────────────────────────────────────────────
// 1. BEHAVIORAL — consume + throttle replica
// ─────────────────────────────────────────────────────────────
(function () {
    let pending = false, lastNotify = 0, notifies = 0;
    const mark = () => { pending = true; };
    const consume = () => { const p = pending; pending = false; return p; };
    const tick = (now) => {
        if (now - lastNotify > 3000 && (() => { if (now - lastNotify <= 3000) return false; return consume(); })()) { lastNotify = now; notifies++; }
    };
    // simpler faithful replica of the short-circuit order (throttle FIRST, then consume)
    const tick2 = (now) => { if (now - lastNotify > 3000) { if (consume()) { lastNotify = now; notifies++; } } };

    mark(); tick2(10000);
    ok('an edit produces one host notification', notifies === 1 && pending === false);
    tick2(10100); tick2(11000);
    ok('no pending edit -> silent', notifies === 1);
    mark(); tick2(11500);
    ok('throttle: a burst edit within 3s does NOT consume the flag', notifies === 1 && pending === true);
    tick2(13600);
    ok('...and the pending flag survives to fire after the window', notifies === 2 && pending === false);
    mark(); mark(); mark(); tick2(20000);
    ok('many edits coalesce into one notification', notifies === 3);
})();

// ─────────────────────────────────────────────────────────────
// 2. SOURCE — every user-mutation site sets the flag
// ─────────────────────────────────────────────────────────────
const dirtyCount = (procC.match(/hostDirtyPending\.store \(true\)/g) || []).length;
ok('at least 12 mutation sites set the pending flag', dirtyCount >= 12, 'found ' + dirtyCount);

ok('chain add (async load) marks dirty', /chain\.push_back \(\{ std::move \(instance\)[\s\S]{0,200}hostDirtyPending\.store \(true\)/.test(procC));
ok('curve pushes mark dirty (drawn curves are project state)', /drawn curves are project state too/.test(procC));
ok('HUMAN hosted-knob touches mark dirty (gesture, not the drive loop)', /audioProcessorParameterChangeGestureBegin[\s\S]{0,400}hostDirtyPending\.store \(true\)/.test(procC));
ok('hosted preset loads mark dirty (programChanged/nonParameterStateChanged)', /d\.programChanged \|\| d\.nonParameterStateChanged\) hostDirtyPending\.store \(true\)/.test(procH));
ok('bypass toggles mark dirty', /bypassed = shouldBypass;\s+hostDirtyPending\.store \(true\)/.test(procC));
ok('undo-restore marks dirty (a user edit, unlike project load)', /user-initiated restore \(Ctrl\+Z\)/.test(procC));

// restore-from-project must NOT mark dirty: setStateInformation's teardown block
// clears the chain directly and never touches the flag
ok('project load does not mark dirty', !/setStateInformation[\s\S]{0,900}hostDirtyPending\.store \(true\)/.test(procC));

ok('flag is an atomic consumed once', /std::atomic<bool> hostDirtyPending \{ false \}/.test(procH) && /hostDirtyPending\.exchange \(false\)/.test(procH));
ok('editor notifies on the MESSAGE thread via nonParameterStateChanged', /consumeHostDirty\(\)[\s\S]{0,300}withNonParameterStateChanged \(true\)/.test(editor));
ok('notify throttled (3s) with throttle checked BEFORE consuming', /nowMs - lastDirtyNotifyMs > 3000 && proc\.consumeHostDirty\(\)/.test(editor));
ok('editor holds the throttle clock', /lastDirtyNotifyMs = 0;/.test(edH));

// version: ships as 1.1.4+
(function () {
    const m = cmake.match(/project\(StrideWrapperM0 VERSION (\d+)\.(\d+)\.(\d+)/);
    ok('CMake VERSION parses', !!m);
    if (m) ok('VERSION >= 1.1.4', +m[1] > 1 || (+m[1] === 1 && (+m[2] > 1 || (+m[2] === 1 && +m[3] >= 4))));
})();

console.log('  ' + passed + ' passed, ' + failed + ' failed');
process.exit(failed ? 1 : 0);
