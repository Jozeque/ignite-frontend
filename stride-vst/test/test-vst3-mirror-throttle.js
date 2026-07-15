/**
 * test-vst3-mirror-throttle.js
 *
 * Covers the Maschine-hang batch (1.1.1) on the Stride wrapper:
 *   - the Live-mode macro mirror is now ~15Hz-capped, gesture-wrapped, and OFF
 *     under NI Maschine (field report 2026-07: Mac, 4-5 instances, playback,
 *     whole-app hang within minutes — an un-gestured 30Hz edit stream per
 *     instance backlogging Maschine's UI thread)
 *   - editor destruction closes any open macro gestures (Live must never think
 *     a param is still "touched" after Stride's window closed mid-play)
 *   - Mac key-forwarder multi-instance hygiene: refcounted NSEvent monitor
 *     (closing one Stride window must not kill forwarding for the rest) + an
 *     editor-view REGISTRY (unregister only your own view; every instance's
 *     frame counts as "ours" in delivery discovery)
 *
 * Two layers (C++ is not loaded in Node):
 *   1. Behavioral — replicate the pure logic (throttle gate, gesture state
 *      machine, refcount, registry) and assert it.
 *   2. Source assertions — read the REAL files and assert the wiring exists
 *      and stays consistent.
 */
'use strict';
const fs = require('fs');
const path = require('path');

let passed = 0, failed = 0;
function ok(name, cond, extra) {
    if (cond) { passed++; }
    else { failed++; console.log('  ✗ ' + name + (extra ? '  — ' + extra : '')); }
}
console.log('test-vst3-mirror-throttle.js');

const W      = path.join(__dirname, '..', '..', 'stride-wrapper', 'm0-spike');
const rd     = (p) => fs.readFileSync(p, 'utf8');
const procC  = rd(path.join(W, 'src', 'PluginProcessor.cpp'));
const procH  = rd(path.join(W, 'src', 'PluginProcessor.h'));
const editor = rd(path.join(W, 'src', 'PluginEditor.cpp'));
const edH    = rd(path.join(W, 'src', 'PluginEditor.h'));
const mac    = rd(path.join(W, 'src', 'MacKeyForward.mm'));
const macH   = rd(path.join(W, 'src', 'MacKeyForward.h'));
const cmake  = rd(path.join(W, 'CMakeLists.txt'));

// ─────────────────────────────────────────────────────────────
// 1. BEHAVIORAL — pure-logic replicas
// ─────────────────────────────────────────────────────────────

// The mirror pipeline (mirrors pushMacroValuesToHost): NI gate -> stale-gesture
// close -> mode gate -> 66ms throttle -> per-slot change-detect + gesture-open.
function makeMirror(opts) {
    const st = {
        ni: !!opts.ni, mode: opts.mode || 'live', lastMirror: 0,
        slots: {},                             // slot -> {v, lastPushed, gestureOpen, lastEdit}
        begins: 0, ends: 0, pushes: 0,
    };
    st.slot = (id, v) => { st.slots[id] = st.slots[id] || { v: 0, lastPushed: -1, gestureOpen: false, lastEdit: 0 }; st.slots[id].v = v; };
    st.tick = (now) => {
        if (st.ni) return;
        for (const s of Object.values(st.slots))
            if (s.gestureOpen && now - s.lastEdit > 400) { s.gestureOpen = false; st.ends++; }
        if (st.mode !== 'live') return;
        if (now - st.lastMirror < 66) return;
        st.lastMirror = now;
        for (const s of Object.values(st.slots))
            if (Math.abs(s.v - s.lastPushed) > 0.0005) {
                if (!s.gestureOpen) { s.gestureOpen = true; st.begins++; }
                st.pushes++; s.lastPushed = s.v; s.lastEdit = now;
            }
    };
    st.close = () => { for (const s of Object.values(st.slots)) if (s.gestureOpen) { s.gestureOpen = false; st.ends++; } };
    return st;
}

// throttle: a 30Hz editor tick stream must push at most ~every 66ms
(function () {
    const m = makeMirror({});
    m.slot(0, 0);
    let t = 1000;
    for (let i = 0; i < 30; i++) { m.slot(0, i / 30); m.tick(t); t += 33; }   // 30 ticks @33ms = ~1s of movement
    ok('throttle: ~15Hz — 30 moving 33ms-ticks produce ~half the pushes', m.pushes >= 13 && m.pushes <= 16, 'pushes=' + m.pushes);
    ok('throttle: one gesture spans the whole moving stretch (no begin-spam)', m.begins === 1, 'begins=' + m.begins);
})();

// gesture machine: begin on first move, end only after >400ms stillness
(function () {
    const m = makeMirror({});
    m.slot(0, 0.1); m.tick(1000);
    ok('gesture opens on the first push', m.begins === 1 && m.slots[0].gestureOpen === true);
    m.tick(1200); m.tick(1350);                       // still — inside the quiet window
    ok('gesture stays open through <400ms of stillness', m.slots[0].gestureOpen === true && m.ends === 0);
    m.tick(1450);                                     // 450ms after the last edit
    ok('gesture ends after 400ms of stillness', m.slots[0].gestureOpen === false && m.ends === 1);
    m.slot(0, 0.5); m.tick(1600);
    ok('a new moving stretch opens a NEW gesture', m.begins === 2 && m.slots[0].gestureOpen === true);
})();

// static values never touch the host at all
(function () {
    const m = makeMirror({});
    m.slot(0, 0.3); m.tick(1000);                     // first push latches lastPushed
    const p = m.pushes;
    for (let t = 1100; t < 3000; t += 100) m.tick(t); // value never changes again
    ok('a static lane goes silent (change-detect)', m.pushes === p);
    ok('...and its gesture closed on stillness', m.slots[0].gestureOpen === false);
})();

// NI (Maschine): the mirror is completely inert — no pushes, no gestures ever
(function () {
    const m = makeMirror({ ni: true });
    for (let t = 1000; t < 3000; t += 33) { m.slot(0, Math.random()); m.tick(t); }
    ok('Maschine: zero host pushes', m.pushes === 0);
    ok('Maschine: zero gestures opened', m.begins === 0);
})();

// Automation mode: host drives us — no mirror pushes, but stale gestures still close
(function () {
    const m = makeMirror({});
    m.slot(0, 0.2); m.tick(1000);                     // opens a gesture in live mode
    m.mode = 'automation';
    m.tick(1500);                                     // mode flipped with a gesture open
    ok('mode flip: open gesture closes on the next tick (no latched touch)', m.slots[0].gestureOpen === false && m.ends === 1);
    m.slot(0, 0.9); m.tick(1600);
    ok('automation mode: no mirror pushes', m.pushes === 1);   // only the original live-mode push
})();

// editor close: closeMacroGestures ends whatever is open
(function () {
    const m = makeMirror({});
    m.slot(0, 0.1); m.slot(1, 0.7); m.tick(1000);
    ok('two moving slots -> two open gestures', m.begins === 2);
    m.close();
    ok('editor dtor closes ALL open gestures', m.ends === 2 && !m.slots[0].gestureOpen && !m.slots[1].gestureOpen);
})();

// monitor refcount: one shared monitor, dies with the LAST editor only
(function () {
    let refs = 0, alive = false;
    const install = () => { refs++; if (!alive) alive = true; };
    const remove = () => { if (--refs > 0) return; refs = 0; alive = false; };
    install(); install(); install();                  // 3 instances
    remove(); remove();
    ok('monitor survives while any instance lives', alive === true && refs === 1);
    remove();
    ok('monitor dies with the last instance', alive === false && refs === 0);
    remove();                                          // stray extra remove
    ok('a stray extra remove cannot go negative', refs === 0);
    install();
    ok('a fresh install after teardown revives it', alive === true && refs === 1);
})();

// editor-view registry: every instance's frame is "ours"; unregister only your own
(function () {
    const views = []; let last = null;
    const reg = (v) => { if (!v) return; last = v; if (!views.includes(v)) views.push(v); };
    const unreg = (v) => { if (!v) return; const i = views.indexOf(v); if (i >= 0) views.splice(i, 1); if (last === v) last = views.length ? views[views.length - 1] : null; };
    const isOurs = (w) => views.some(v => v.win === w);
    const A = { win: 'winA' }, B = { win: 'winB' };
    reg(A); reg(B); reg(A);                            // A refreshes (idempotent)
    ok('registry: idempotent register', views.length === 2);
    ok('registry: BOTH instances\' windows are ours', isOurs('winA') && isOurs('winB'));
    ok('registry: last-refreshed wins the frame fallback', last === A);
    unreg(A);
    ok('unregister drops only your own; the other stays ours', !isOurs('winA') && isOurs('winB') && last === B);
    unreg(B);
    ok('empty registry -> no frame fallback target', last === null && !isOurs('winB'));
})();

// ─────────────────────────────────────────────────────────────
// 2. SOURCE — the wiring exists and stays consistent
// ─────────────────────────────────────────────────────────────
ok('mirror is OFF under Maschine (the hang report)', /pushMacroValuesToHost[\s\S]{0,900}isMaschine\(\)/.test(procC));
ok('mirror capped to ~15Hz (66ms)', /kMirrorIntervalMs = 66/.test(procC) && /lastMirrorPushMs < kMirrorIntervalMs\) return/.test(procC));
ok('gestures end after 400ms of stillness', /kGestureQuietMs\s+= 400/.test(procC) && /lastEditMs > kGestureQuietMs/.test(procC));
ok('pushes are gesture-wrapped (begin on first move)', /pushMacroValuesToHost[\s\S]{0,2600}beginChangeGesture[\s\S]{0,300}setValueNotifyingHost/.test(procC));
ok('closeMacroGestures implemented + ends open gestures', /void StrideWrapperProcessor::closeMacroGestures\(\)[\s\S]{0,400}endChangeGesture/.test(procC));
ok('editor DTOR closes gestures (its timer was the only closer)', /StrideWrapperEditor::~StrideWrapperEditor\(\)[\s\S]{0,400}closeMacroGestures\(\)/.test(editor));
ok('MacroParameter carries the gesture state (message-thread only)', /gestureOpen = false;/.test(procH) && /lastEditMs = 0;/.test(procH));
ok('announceMacrosToHost untouched (still one-shot gesture-wrapped)', /announceMacrosToHost[\s\S]{0,900}beginChangeGesture\(\)[\s\S]{0,200}setValueNotifyingHost[\s\S]{0,200}endChangeGesture\(\)/.test(procC));

ok('mm: NSEvent monitor is refcounted', /g_strideMonitorRefs/.test(mac) && /\+\+g_strideMonitorRefs/.test(mac) && /--g_strideMonitorRefs > 0\) return/.test(mac));
ok('mm: refcount floors at zero (stray remove safe)', /g_strideMonitorRefs = 0;\s+\/\/ floor/.test(mac));
ok('mm: editor-view REGISTRY (multi-instance), not a single global', /std::vector<void\*> g_strideEditorViews/.test(mac));
ok('mm: register is idempotent + refreshes the fallback target', /strideMacKeyForward_registerEditorView[\s\S]{0,400}g_strideLastEditorView = nsview[\s\S]{0,220}push_back/.test(mac));
ok('mm: unregister drops only the caller\'s view + repoints the fallback', /strideMacKeyForward_unregisterEditorView[\s\S]{0,600}g_strideEditorViews\.empty\(\) \? nullptr : g_strideEditorViews\.back\(\)/.test(mac));
ok('mm: window discovery treats EVERY registered frame as ours', /strideIsOurWindow[\s\S]{0,600}for \(void\* view : g_strideEditorViews\)/.test(mac));
ok('header: register/unregister API declared', /strideMacKeyForward_registerEditorView \(void\* nsview\)/.test(macH) && /strideMacKeyForward_unregisterEditorView \(void\* nsview\)/.test(macH));
ok('editor tracks the exact view it registered', /lastForwardView = peer->getNativeHandle\(\)/.test(editor) && /lastForwardView = nullptr;/.test(edH));

// version: the Maschine batch ships as 1.1.1+
(function () {
    const m = cmake.match(/project\(StrideWrapperM0 VERSION (\d+)\.(\d+)\.(\d+)/);
    ok('CMake VERSION parses', !!m);
    if (m) {
        const [maj, min, pat] = [+m[1], +m[2], +m[3]];
        ok('VERSION >= 1.1.1', maj > 1 || (maj === 1 && (min > 1 || (min === 1 && pat >= 1))));
        ok('AU version bytes stay legal (minor/patch <= 255)', min <= 255 && pat <= 255);
    }
})();

console.log('  ' + passed + ' passed, ' + failed + ' failed');
process.exit(failed ? 1 : 0);
