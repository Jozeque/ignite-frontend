/**
 * test-device-filter.js
 *
 * Covers "click a chain device to filter the canvas to its lanes" (the multi-view
 * device filter) plus the surrounding wrapper wiring added alongside it:
 * per-device bypass and the hosted-window title.
 *
 * canvas.js can't load in Node (DOM-bound), so — like test-lock-unlock.js — this is
 * two layers:
 *   1. Behavioral — replicate the pure logic (sdVisibleParams + sdSetDeviceFilter
 *      toggle, incl. keeping the active lane visible) and assert it.
 *   2. Source assertions — read the REAL canvas.js / shim.js / Plugin*.cpp and
 *      assert the wiring exists, so the replica can't silently drift from shipping.
 */
'use strict';
const fs = require('fs');
const path = require('path');

let passed = 0, failed = 0;
function ok(name, cond, extra) {
    if (cond) { passed++; }
    else { failed++; console.log('  ✗ ' + name + (extra ? '  — ' + extra : '')); }
}

console.log('test-device-filter.js');

// ─────────────────────────────────────────────────────────────
// 1. BEHAVIORAL — replica of the canvas.js view filter
// ─────────────────────────────────────────────────────────────
function makeParam(id, device) { return { envelopeId: id, device: device, name: 'p' + id }; }

let params, filter, activeId;
function reset() {
    params = [makeParam('1', 'Serum'), makeParam('2', 'Serum'), makeParam('3', 'BitCrush')];
    filter = null; activeId = '1';
}
// replica of sdVisibleParams()
function visible() { return filter ? params.filter(p => (p.device || '') === filter) : params; }
// replica of window.sdSetDeviceFilter()
function setFilter(dev) {
    filter = (dev && dev !== filter) ? dev : null;
    const vis = visible();
    if (filter && !vis.some(p => p.envelopeId === activeId)) activeId = vis.length ? vis[0].envelopeId : activeId;
    return filter;
}

reset();
ok('no filter shows all lanes', visible().length === 3);
setFilter('Serum');
ok('filter Serum shows its 2 lanes', visible().length === 2, 'len=' + visible().length);
ok('filter Serum shows only Serum lanes', visible().every(p => p.device === 'Serum'));
ok('active lane (Serum) stays visible after filtering', activeId === '1');
setFilter('BitCrush');
ok('switching to BitCrush shows its 1 lane', visible().length === 1);
ok('active lane reassigned to first visible (3) when old active hidden', activeId === '3');
setFilter('BitCrush');
ok('clicking the same device again clears the filter', filter === null && visible().length === 3);
setFilter('Serum');
ok('clicking a different device switches the filter', filter === 'Serum');
setFilter(null);
ok('null arg clears the filter', filter === null);
(function () { reset(); activeId = '2'; setFilter('Nope'); ok('filter to a device with no lanes shows none + keeps active', visible().length === 0 && activeId === '2'); })();

// ── global motion tools target only the focused device's lanes ──
(function () {
    const ps = [makeParam('1', 'Serum'), makeParam('2', 'Serum'), makeParam('3', 'BitCrush')];
    ps.forEach(p => { p.locked = false; p.selected = false; });
    let f = 'Serum';
    const vis = () => f ? ps.filter(p => (p.device || '') === f) : ps;
    // replica of sdGetUnlockedParams() pool logic
    const unlocked = () => { const pool = vis(); const sel = pool.filter(p => p.selected && !p.locked); return sel.length ? sel : pool.filter(p => !p.locked); };
    ok('motion pool = focused device unlocked lanes', unlocked().length === 2 && unlocked().every(p => p.device === 'Serum'));
    ps[0].locked = true;
    ok('motion pool still skips locked lanes within the device', unlocked().length === 1);
    f = null;
    ok('motion pool = all unlocked when no device focused', unlocked().length === 2);
})();

// ─────────────────────────────────────────────────────────────
// 2. SOURCE ASSERTIONS — the real wiring exists
// ─────────────────────────────────────────────────────────────
const root   = path.join(__dirname, '..', '..');
const canvas = fs.readFileSync(path.join(__dirname, '..', 'app', 'renderer', 'canvas.js'), 'utf8');
const shim   = fs.readFileSync(path.join(root, 'stride-wrapper', 'm0-spike', 'ui', 'shim.js'), 'utf8');
const editor = fs.readFileSync(path.join(root, 'stride-wrapper', 'm0-spike', 'src', 'PluginEditor.cpp'), 'utf8');
const proc   = fs.readFileSync(path.join(root, 'stride-wrapper', 'm0-spike', 'src', 'PluginProcessor.cpp'), 'utf8');

// device filter (canvas.js — shared)
ok('canvas.js declares sdDeviceFilter', /let\s+sdDeviceFilter\s*=/.test(canvas));
ok('canvas.js defines sdVisibleParams()', /function\s+sdVisibleParams\s*\(/.test(canvas));
ok('canvas.js exposes window.sdSetDeviceFilter', /window\.sdSetDeviceFilter\s*=/.test(canvas));
ok('multi hit-test routes through sdVisibleParams()', /const\s+vis\s*=\s*sdVisibleParams\(\)/.test(canvas));
ok('clamp scroll uses sdVisibleParams().length', /sdVisibleParams\(\)\.length/.test(canvas));
ok('params carry a device field', /device:\s*p\.device/.test(canvas));
ok('two-line label keys off param.device', /if\s*\(\s*param\.device\s*\)/.test(canvas));
ok('sdGetUnlockedParams scopes to sdVisibleParams', /function\s+sdGetUnlockedParams[\s\S]*?sdVisibleParams\(\)/.test(canvas));
ok('sdGetTargetParams scopes to sdVisibleParams', /function\s+sdGetTargetParams[\s\S]*?sdVisibleParams\(\)/.test(canvas));
ok('Bloom spreads via sdVisibleParams', /sdVisibleParams\(\)\.forEach\(param =>/.test(canvas));
ok('Prism recipients via sdVisibleParams', /sdVisibleParams\(\)\.filter\(p => p !== source/.test(canvas));

// shim (wrapper)
// By SLOT since 2026-08-20: two copies of one plugin share a name, so focusing by name
// showed the lanes of both.
ok('shim chip focuses by chain slot', /window\.sdSetDeviceFilter\(i\)/.test(shim));
ok('shim chip has a bypass dot (setBypass)', /emit\('setBypass'/.test(shim));
ok('shim live_curves carries clip_bars', /clip_bars:\s*\(window\.sdGetBars/.test(shim));

// hosted-window title + bypass (C++)
ok('HostedWindow takes a title param', /HostedWindow\s*\(const juce::String& title/.test(editor));
ok('hosted window titled from the device name', /HostedWindow>\s*\(i < names\.size\(\)/.test(editor));
ok('editor has a setBypass listener', /withEventListener\s*\("setBypass"/.test(editor));
ok('editor pushes bypassed[] with the device list', /o->setProperty\s*\("bypassed"/.test(editor));
ok('processBlock skips bypassed nodes', /!\s*chain\[i\]\.bypassed/.test(proc));
ok('setNodeBypassed exists', /void\s+StrideWrapperProcessor::setNodeBypassed/.test(proc));
ok('bypass is persisted in saved state', /setAttribute\s*\("bypassed"/.test(proc));

console.log('  ' + passed + ' passed, ' + failed + ' failed');
process.exit(failed ? 1 : 0);
