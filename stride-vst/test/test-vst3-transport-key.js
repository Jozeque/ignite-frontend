/**
 * test-vst3-transport-key.js
 *
 * Spacebar play/stop while Stride's WebView has focus. Once you draw or inject, the WebView
 * holds keyboard focus and WebView2's keys never reach the DAW's message queue — so the synth-
 * window key hook can't forward them. The JS forwards Space to native, which posts it to the
 * host's top window (same target as the hook). Source-assertion style (the post is runtime).
 */
'use strict';
const fs = require('fs');
const path = require('path');

let passed = 0, failed = 0;
function ok(name, cond, extra) {
    if (cond) { passed++; }
    else { failed++; console.log('  ✗ ' + name + (extra ? '  — ' + extra : '')); }
}
console.log('test-vst3-transport-key.js');

const root = path.join(__dirname, '..', '..');
const rd = (p) => fs.readFileSync(p, 'utf8');
const W = path.join(root, 'stride-wrapper', 'm0-spike');
const editor  = rd(path.join(W, 'src', 'PluginEditor.cpp'));
const editorH = rd(path.join(W, 'src', 'PluginEditor.h'));
const shim    = rd(path.join(W, 'ui', 'shim.js'));

// ── JS forward (wrapper only) ───────────────────────────────
ok('shim forwards Space to native as transportKey', /e\.code === 'Space' \|\| e\.key === ' '[\s\S]{0,260}emit\('transportKey', \{ key: 'space' \}\)/.test(shim));
ok('forward is skipped while typing in a field (license/search/range keep the key)', /Space[\s\S]{0,240}tagName === 'INPUT'[\s\S]{0,120}if \(! typing\) emit\('transportKey'/.test(shim));
ok('auto-repeat ignored — one toggle per press, not while held', /'Space' \|\| e\.key === ' '\) && ! e\.repeat/.test(shim));

// ── native handler ──────────────────────────────────────────
ok('editor declares forwardTransportKey', /void\s+forwardTransportKey\s*\(const juce::String&/.test(editorH));
ok('editor registers a transportKey listener', /withEventListener\s*\("transportKey"[\s\S]{0,120}forwardTransportKey\s*\(v\.getProperty\s*\("key"/.test(editor));
ok('forwardTransportKey posts the key to the HOST window (not the plugin)', /forwardTransportKey\s*\(const juce::String& key\)[\s\S]{0,400}hostMainWindow\(\)[\s\S]{0,160}PostMessage\s*\(host, WM_KEYDOWN, vk[\s\S]{0,120}PostMessage\s*\(host, WM_KEYUP/.test(editor));
ok('Space maps to VK_SPACE (Enter -> VK_RETURN)', /vk\s*=\s*\(key == "enter"\) \? VK_RETURN : VK_SPACE/.test(editor));
ok('Windows-guarded (macOS is a no-op follow-up, not a broken call)', /#if JUCE_WINDOWS[\s\S]{0,400}forwardTransportKey|forwardTransportKey[\s\S]{0,120}#if JUCE_WINDOWS[\s\S]{0,300}#else[\s\S]{0,80}ignoreUnused \(key\)/.test(editor));

// the synth-window hook stays (it covers focus-on-hosted-synth); the JS path covers focus-on-WebView
ok('the hosted-synth key hook is untouched (still forwards Space/Return from synth windows)', /VK_SPACE \|\| msg->wParam == VK_RETURN/.test(editor) && /ownsNativeWindow/.test(editor));

console.log('  ' + passed + ' passed, ' + failed + ' failed');
process.exit(failed ? 1 : 0);
