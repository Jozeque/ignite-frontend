/**
 * test-vst3-locks.js
 *
 * Covers engine-owned per-lane LOCKS. Field incident 2026-08-03: a producer
 * layering several Stride instances over the same synth locked lanes in one
 * instance and every other instance "switched to the same automation lanes"
 * on its next open. Root cause chain:
 *   - the wrapper's save key is track_name ("Stride", constant) + chain summary
 *     — NO per-instance component (wrapper _paths are "wrap:<i>", so the
 *     desktop's track-index disambiguation never applies)
 *   - canvas state persisted to localStorage, which the wrapper shares as ONE
 *     WebView profile across every instance in the DAW (and every project)
 *   - restoreCanvasState force-restored LOCKED saved lanes (curve + padlock)
 *     over the per-instance engine echo; the 30s autosave doubles as the
 *     live_curves push, so the cross-loaded lanes were then written into that
 *     instance's ENGINE and saved with the project
 * The fix is the ranges (1.1.5) / colors (1.1.11) / loop+quant (1.3.0) pattern:
 *   - canvas reports every padlock change (set_lock / batched set_locks)
 *   - engine stores `locked` on the mapped entries, persists it in the project
 *     ("lk" attr, state v5), carries it through undo/duplicate snapshots, and
 *     echoes it in every rack_scanned
 *   - in wrapper mode restoreCanvasState NEVER applies the shared localStorage
 *     slot — the engine echo is the single source of truth per instance
 *   - desktop/M4L behavior byte-identical (per-track keys, full restore kept)
 */
'use strict';
const fs = require('fs');
const path = require('path');

let passed = 0, failed = 0;
function ok(name, cond, extra) {
    if (cond) { passed++; }
    else { failed++; console.log('  ✗ ' + name + (extra ? '  — ' + extra : '')); }
}
console.log('test-vst3-locks.js');

const root   = path.join(__dirname, '..', '..');
const W      = path.join(root, 'stride-wrapper', 'm0-spike');
const rd     = (p) => fs.readFileSync(p, 'utf8');
const procC  = rd(path.join(W, 'src', 'PluginProcessor.cpp'));
const procH  = rd(path.join(W, 'src', 'PluginProcessor.h'));
const editor = rd(path.join(W, 'src', 'PluginEditor.cpp'));
const shim   = rd(path.join(W, 'ui', 'shim.js'));
const canvas = rd(path.join(root, 'stride-vst', 'app', 'renderer', 'canvas.js'));

const count = (src, needle) => src.split(needle).length - 1;

// ─────────────────────────────────────────────────────────────
// 1. THE BUG — why client-side storage can never be per-instance
// ─────────────────────────────────────────────────────────────

// save-key derivation (mirrors canvas.js loadParamsDirectly): the wrapper reports a
// CONSTANT track_name and its _paths carry no "tracks N", so the key collapses to the
// chain summary — identical for every instance hosting the same chain.
(function () {
    const trackIdxOf = (params) => {
        const p = (params || [])[0];
        const m = p && p._path && String(p._path).match(/tracks (\d+)/);
        return m ? parseInt(m[1], 10) : -1;
    };
    const rackIdOf = (ti, track, device) =>
        ((ti >= 0 ? 't' + ti + '_' : '') + track + '_' + device).replace(/[^a-zA-Z0-9]/g, '_');

    const wrapParams = [{ _path: 'wrap:0' }];
    ok('wrapper _paths ("wrap:<i>") yield NO track index', trackIdxOf(wrapParams) === -1);
    const instA = rackIdOf(trackIdxOf(wrapParams), 'Stride', 'Serum');
    const instB = rackIdOf(trackIdxOf(wrapParams), 'Stride', 'Serum');
    ok('two instances, same chain -> SAME save key (the collision)', instA === instB);
    const instC = rackIdOf(-1, 'Stride', 'Serum + OTT');
    ok('different chain summary -> different key (why only same-chain layers leaked)', instA !== instC);

    const desktopA = rackIdOf(trackIdxOf([{ _path: 'live_set tracks 3 devices 0' }]), 'Bass', 'Serum Rack');
    const desktopB = rackIdOf(trackIdxOf([{ _path: 'live_set tracks 4 devices 0' }]), 'Bass', 'Serum Rack');
    ok('desktop duplicated tracks stay separate (t<idx> prefix)', desktopA !== desktopB);
})();

// the leak itself, old restore vs new: instance B (own curves, unlocked) opens while the
// shared slot holds instance A's LOCKED lanes. Old code force-restored A onto B; the fix
// (wrapper gate) leaves B's engine echo untouched.
(function () {
    const overlay = (lanes, saved, wrapperGated) => {
        if (wrapperGated) return lanes;                       // the fix: echo is the truth
        saved.forEach(sp => {                                 // old behavior (desktop keeps it)
            const l = lanes.find(x => x._path === sp._path);
            if (!l) return;
            if (sp.locked) { if (sp.points) l.points = sp.points; l.locked = true; }
            else if (sp.points) l.points = sp.points;
        });
        return lanes;
    };
    const bEcho = () => [{ _path: 'wrap:0', locked: false, points: [{ time: 0, value: 0.9 }] }];
    const aSlot = [{ _path: 'wrap:0', locked: true, points: [{ time: 0, value: 0.1 }] }];

    const oldB = overlay(bEcho(), aSlot, false);
    ok('OLD: the shared slot force-loads A\'s lock + curve over B\'s echo (the bug)',
       oldB[0].locked === true && oldB[0].points[0].value === 0.1);

    const newB = overlay(bEcho(), aSlot, true);
    ok('NEW: wrapper gate keeps B\'s own lanes (per-instance truth)',
       newB[0].locked === false && newB[0].points[0].value === 0.9);
})();

// ─────────────────────────────────────────────────────────────
// 2. BEHAVIORAL — echo build, batch push, engine setter, lk attr
// ─────────────────────────────────────────────────────────────

// lane build from the engine payload (mirrors loadParamsDirectly): payload speaks -> locked;
// silent payload (desktop scanners) -> unlocked, exactly the old hardcoded false.
(function () {
    const build = (p) => ({ envelopeId: String(p.id), locked: !!p.locked, points: Array.isArray(p.points) ? p.points : [] });
    ok('echoed locked:true rebuilds the padlock', build({ id: 0, locked: true }).locked === true);
    ok('absent locked (desktop payload) -> unlocked, as before', build({ id: 0 }).locked === false);
})();

// batch push builder (mirrors _sdPushLocksToEngine): engine positions, NaN filtered,
// single lane collapses to the set_lock path.
(function () {
    const itemsOf = (params) => (params || [])
        .map(p => ({ id: p ? parseInt(p.envelopeId, 10) : NaN, on: !!(p && p.locked) }))
        .filter(it => !isNaN(it.id));
    const items = itemsOf([
        { envelopeId: '0', locked: true },
        { envelopeId: '2', locked: false },
        { envelopeId: 'nope', locked: true },
        null
    ]);
    ok('batch carries engine positions + on flags, junk filtered',
       items.length === 2 && items[0].id === 0 && items[0].on === true && items[1].id === 2 && items[1].on === false);
    ok('a single lane falls back to the set_lock path', itemsOf([{ envelopeId: '5', locked: true }]).length === 1);
})();

// engine setter replica (mirrors setMappedLock/setMappedLocks): bounds-guarded, batch
// applies per item, absent "on" reads false.
(function () {
    const mapped = [{ locked: false }, { locked: false }, { locked: true }];
    const setLock = (pos, on) => { if (pos < 0 || pos >= mapped.length) return; mapped[pos].locked = on; };
    setLock(-1, true); setLock(99, true);
    ok('out-of-range positions are ignored', mapped[0].locked === false && mapped[1].locked === false);
    [{ id: 0, on: true }, { id: 2, on: false }, { id: 7, on: true }].forEach(it => setLock(it.id, !!it.on));
    ok('batch applies each item (and only in-range ones)', mapped[0].locked === true && mapped[1].locked === false && mapped[2].locked === false);
})();

// "lk" attr round-trip (mirrors getState/setState): written only when locked, parse
// defaults to 0 — old projects (v4 and older, no attr) come back fully unlocked.
(function () {
    const write = (m) => { const e = {}; if (m.locked) e.lk = 1; return e; };
    const parse = (e) => ((e.lk || 0) !== 0 ? 1 : 0);
    ok('locked lane survives the round-trip', parse(write({ locked: true })) === 1);
    ok('unlocked lane writes NO attr and parses unlocked (old projects unchanged)',
       !('lk' in write({ locked: false })) && parse({}) === 0);
})();

// ─────────────────────────────────────────────────────────────
// 3. ENGINE — owned, persisted, snapshotted, echoed
// ─────────────────────────────────────────────────────────────
ok('MapRef carries the lock', /bool locked = false; \};/.test(procH));
ok('RemovedSnapshot::Dev carries the parallel lkd vector', /std::vector<char> lkd; \};/.test(procH));
ok('setMappedLock / setMappedLocks / getMappedLocks declared',
   /void setMappedLock \(int pos, bool on\);/.test(procH)
   && /void setMappedLocks \(const juce::Array<juce::var>& items\);/.test(procH)
   && /juce::Array<int> getMappedLocks\(\) const;/.test(procH));
ok('setMappedLock stores under the host lock + marks the project dirty',
   /void StrideWrapperProcessor::setMappedLock \(int pos, bool on\)[\s\S]{0,400}ScopedLock sl \(hostLock\);[\s\S]{0,200}\.locked = on;[\s\S]{0,120}hostDirtyPending\.store \(true\)/.test(procC));
ok('setMappedLock does NOT re-push (no mapVersion bump would fight the click)',
   !/setMappedLock \(int pos, bool on\)[\s\S]{0,500}mapVersion\.fetch_add/.test(procC));
ok('setMappedLocks = one lock pass, one dirty mark (the set_ranges pattern)',
   /void StrideWrapperProcessor::setMappedLocks[\s\S]{0,600}getProperty \("on", false\);[\s\S]{0,200}hostDirtyPending\.store \(true\)/.test(procC)
   && !/setMappedLocks[\s\S]{0,700}mapVersion\.fetch_add/.test(procC));
ok('getMappedLocks reports 1/0 in mapped order',
   /juce::Array<int> StrideWrapperProcessor::getMappedLocks\(\) const[\s\S]{0,300}m\.locked \? 1 : 0/.test(procC));
ok('project state: "lk" written only when locked (absent = unlocked; old builds ignore it)',
   /if \(m\.locked\) e->setAttribute \("lk", 1\);/.test(procC));
ok('project state version bumped to 5 (attr-based, v4 and older load unchanged)',
   /root\.setAttribute \("version", 5\);/.test(procC));
ok('project reopen parses "lk" into the restore list',
   /lkd\.push_back \(\(char\) \(e->getIntAttribute \("lk", 0\) != 0 \? 1 : 0\)\)/.test(procC));
ok('all three snapshots carry locks (Clear chain, remove device, Alt+drag duplicate)',
   count(procC, 'd.lkd.push_back (m.locked ? 1 : 0)') === 3);
ok('restore rebuilds mapped entries WITH their locks (missing vector = unlocked, old snapshots safe)',
   /k < d\.lkd\.size\(\) && d\.lkd\[k\] != 0 \}\);/.test(procC));
ok('fresh learn-mapped params start unlocked (struct default, partial aggregate init intact)',
   /mapped\.push_back \(\{ node, parameterIndex, -1 \}\);/.test(procC));

// ─────────────────────────────────────────────────────────────
// 4. BRIDGE — routed, guarded, echoed
// ─────────────────────────────────────────────────────────────
ok('set_lock routed (editLocked-gated) into setMappedLock',
   /if \(type == "set_lock"\)[\s\S]{0,300}isEditLocked\(\)\) return;[\s\S]{0,200}setMappedLock \(\(int\) msg\.getProperty \("id", -1\),/.test(editor));
ok('set_locks routed (editLocked-gated) into setMappedLocks',
   /if \(type == "set_locks"\)[\s\S]{0,300}isEditLocked\(\)\) return;[\s\S]{0,200}setMappedLocks \(\*arr\)/.test(editor));
ok('rack_scanned fetches the locks alongside ranges/colors/loop/quant',
   /const auto locks\s+= proc\.getMappedLocks\(\);/.test(editor));
ok('rack_scanned echoes locked:true per lane (absent = unlocked)',
   /if \(i < locks\.size\(\) && locks\[i\] != 0\)\s*\n\s*o->setProperty \("locked", true\);/.test(editor));

// ─────────────────────────────────────────────────────────────
// 5. CANVAS — payload-built, pushed on every lock action, restore gated
// ─────────────────────────────────────────────────────────────
ok('both lane builders take the padlock from the engine payload',
   count(canvas, 'locked: !!p.locked,   // engine-owned padlock echo') === 2);
ok('push helpers exist and are wrapper-gated',
   /function _sdPushLockToEngine\(p\) \{[\s\S]{0,220}strideLink\._wrapper\) return;/.test(canvas)
   && /function _sdPushLocksToEngine\(params\) \{[\s\S]{0,220}strideLink\._wrapper\) return;/.test(canvas));
ok('single toggle sends set_lock with the engine position',
   /type: 'set_lock', id: id, on: !!p\.locked/.test(canvas));
ok('batch: groups send set_locks; a single lane keeps set_lock',
   /type: 'set_locks', items: items/.test(canvas)
   && /if \(items\.length === 1\) \{ window\.strideLink\.send\(\{ type: 'set_lock', id: items\[0\]\.id, on: items\[0\]\.on \}\); return; \}/.test(canvas));
ok('per-lane padlock toggle pushes to the engine',
   /p\.locked = !p\.locked;[\s\S]{0,400}_sdPushLockToEngine\(p\);/.test(canvas));
ok('Lock All / Lock current / Unlock all each push one batched pass',
   count(canvas, '_sdPushLocksToEngine(sdCanvasParams);') === 3);

// the fix's second half: in wrapper mode the shared localStorage slot is NEVER applied
(function () {
    const rIdx = canvas.indexOf('async function restoreCanvasState()');
    const gate = 'if (window.strideLink && window.strideLink._wrapper) { _renderTemplateStatus(); return; }';
    const gIdx = canvas.indexOf(gate);
    const lIdx = canvas.indexOf('window.stride.loadCanvasState', rIdx);
    ok('restoreCanvasState exists', rIdx >= 0);
    ok('wrapper gate sits INSIDE restore, BEFORE any localStorage read', gIdx > rIdx && lIdx > gIdx);
    ok('desktop keeps the full restore (current key + legacy-key migration fallback)',
       /await window\.stride\.loadCanvasState\(key\)/.test(canvas)
       && /currentLegacyKey && currentLegacyKey !== key/.test(canvas));
    ok('desktop restore still force-restores locked lanes (its keys are per-track, so this is safe there)',
       /if \(sp\.locked\) \{\s*\n\s*if \(sp\.points\) param\.points = sp\.points;\s*\n\s*param\.locked = true;/.test(canvas));
})();

// saveCanvasState is untouched: on the wrapper it doubles as the live-drive push, so the
// shim must still emit live_curves from it (locks fix must not break drive-as-you-draw).
ok('shim saveCanvasState still emits live_curves (live drive intact)',
   /saveCanvasState: function \(rackId, state\) \{[\s\S]{0,1200}type: 'live_curves'/.test(shim));

// ships as 1.3.0+
(function () {
    const cmake = rd(path.join(W, 'CMakeLists.txt'));
    const m = cmake.match(/project\(StrideWrapperM0 VERSION (\d+)\.(\d+)\.(\d+)/);
    ok('CMake VERSION parses', !!m);
    if (m) ok('VERSION >= 1.3.0', +m[1] > 1 || (+m[1] === 1 && +m[2] >= 3));
})();

console.log('  ' + passed + ' passed, ' + failed + ' failed');
process.exit(failed ? 1 : 0);
