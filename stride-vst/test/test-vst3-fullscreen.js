/**
 * test-vst3-fullscreen.js
 *
 * Fullscreen (maximize) toggle for the VST: a titlebar button resizes the editor to the screen
 * work area and back, without clobbering the persisted "working" window size. Source-assertion
 * style (the resize is runtime): assert the editor toggle + size-memory guard + the UI wiring.
 */
'use strict';
const fs = require('fs');
const path = require('path');

let passed = 0, failed = 0;
function ok(name, cond, extra) {
    if (cond) { passed++; }
    else { failed++; console.log('  ✗ ' + name + (extra ? '  — ' + extra : '')); }
}
console.log('test-vst3-fullscreen.js');

const root = path.join(__dirname, '..', '..');
const rd = (p) => fs.readFileSync(p, 'utf8');
const W = path.join(root, 'stride-wrapper', 'm0-spike');
const editor  = rd(path.join(W, 'src', 'PluginEditor.cpp'));
const editorH = rd(path.join(W, 'src', 'PluginEditor.h'));
const shim    = rd(path.join(W, 'ui', 'shim.js'));
const indexH  = rd(path.join(W, 'ui', 'index.html'));

// ── editor ──────────────────────────────────────────────────
ok('editor tracks fullscreen state + the pre-fullscreen size', /bool\s+sdFullscreen\s*=\s*false;\s*int\s+preFsW\s*=\s*0,\s*preFsH\s*=\s*0/.test(editorH));
ok('editor has a toggleFullscreen listener', /withEventListener\s*\("toggleFullscreen"/.test(editor));
ok('fullscreen resizes to the display work area', /toggleFullscreen"[\s\S]{0,500}getDisplayForRect\s*\(getScreenBounds\(\)\)[\s\S]{0,200}userArea[\s\S]{0,120}setSize\s*\(ua\.getWidth\(\), ua\.getHeight\(\)\)/.test(editor));
ok('it remembers the working size and restores it', /preFsW = getWidth\(\); preFsH = getHeight\(\)/.test(editor) && /setSize\s*\(preFsW > 0 \? preFsW/.test(editor));
ok('it pushes fullscreenState to the UI (icon)', /emitEventIfBrowserIsVisible\s*\("fullscreenState"/.test(editor));
ok('the fullscreen size is NOT persisted (working size preserved)', /!\s*sdFullscreen\s*&&\s*cw > 0/.test(editor));
ok('resize ceiling raised so fullscreen fills big monitors', /setResizeLimits\s*\(380, 280, 5120, 2880\)/.test(editor));

// ── UI ──────────────────────────────────────────────────────
ok('shim exposes sdToggleFullscreen -> emit toggleFullscreen', /window\.sdToggleFullscreen\s*=\s*function\s*\(\)\s*\{\s*emit\('toggleFullscreen'\)/.test(shim));
ok('shim swaps the icon on fullscreenState', /listen\('fullscreenState'[\s\S]{0,400}setAttribute\('d'/.test(shim));
ok('titlebar has a fullscreen button wired to sdToggleFullscreen', /id="sd-fullscreen-btn"[\s\S]{0,200}sdToggleFullscreen/.test(indexH));
ok('the button icon has the id the shim toggles (sd-fs-icon)', /id="sd-fs-icon"/.test(indexH));

console.log('  ' + passed + ' passed, ' + failed + ' failed');
process.exit(failed ? 1 : 0);
