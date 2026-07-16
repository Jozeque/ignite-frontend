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
ok('Windows: posts the key to the HOST window (not the plugin)', /forwardTransportKey\s*\(const juce::String& key\)[\s\S]{0,700}hostMainWindow\(\)[\s\S]{0,160}PostMessage\s*\(host, WM_KEYDOWN, vk[\s\S]{0,120}PostMessage\s*\(host, WM_KEYUP/.test(editor));
ok('Space maps to VK_SPACE (Enter -> VK_RETURN, save -> S)', /vk\s*=\s*\(key == "enter"\) \? VK_RETURN : \(key == "save"\) \? \(WPARAM\) 'S' : VK_SPACE/.test(editor));
ok('debounced: one transport toggle per press (any path)', /lastTransportKeyMs < 150\) return;\s*lastTransportKeyMs = nowMs/.test(editor) && /juce::uint32 lastTransportKeyMs = 0/.test(editorH));

// REGRESSION GUARD: forwardTransportKey must live OUTSIDE every #if JUCE_WINDOWS span —
// in the HEADER (decl) and the CPP (definition). The WebView listener references it
// unconditionally; a Windows-guarded decl/def = "undeclared identifier" on the Mac CI
// (the exact v1.0.4 first-tag failure).
function inWindowsSpan(src, needle) {
    const at = src.indexOf(needle);
    if (at < 0) return true;   // missing entirely counts as broken
    const re = /#if JUCE_WINDOWS[\s\S]*?#endif/g; let m;
    while ((m = re.exec(src)) !== null)
        if (at > m.index && at < m.index + m[0].length) return true;
    return false;
}
ok('header: forwardTransportKey declared for ALL platforms (not Windows-guarded)', !inWindowsSpan(editorH, 'forwardTransportKey'));
ok('cpp: forwardTransportKey defined for ALL platforms (not Windows-guarded)', !inWindowsSpan(editor, 'void StrideWrapperEditor::forwardTransportKey'));
ok('header: the debounce member is unguarded too', !inWindowsSpan(editorH, 'lastTransportKeyMs'));

// the synth-window hook stays (it covers focus-on-hosted-synth); the JS path covers focus-on-WebView
ok('the hosted-synth key hook is untouched (still forwards Space/Return from synth windows)', /VK_SPACE \|\| msg->wParam == VK_RETURN/.test(editor) && /ownsNativeWindow/.test(editor));

// ── macOS (the Bitwig-on-Mac report: Space dead with Stride OR hosted Serum focused) ──
const mac  = rd(path.join(W, 'src', 'MacKeyForward.mm'));
const macH = rd(path.join(W, 'src', 'MacKeyForward.h'));
const cmake = rd(path.join(W, 'CMakeLists.txt'));
ok('Mac branch: forwardTransportKey -> strideMacKeyForward_post', /#elif JUCE_MAC[\s\S]{0,260}strideMacKeyForward_post \(key == "enter"\)/.test(editor));

// ── Ctrl/Cmd+S = save the PROJECT (an unsaved chain died in a crash, 2026-07-16) ──
ok('shim intercepts Ctrl/Cmd+S (kills the WebView save-page dialog) and forwards it',
   /e\.key === 's' \|\| e\.key === 'S'\) && \(e\.ctrlKey \|\| e\.metaKey\)/.test(shim) && /emit\('transportKey', \{ key: 'save' \}\)/.test(shim));
ok('Windows: "save" posts a bare S while the user physically holds Ctrl', /\(key == "save"\) \? \(WPARAM\) 'S' : VK_SPACE/.test(editor));
ok('Mac: "save" routes to the dedicated Cmd+S post', /if \(key == "save"\)\s*\n\s*strideMacKeyForward_postSave\(\)/.test(editor));
ok('mm: Cmd+S event carries the Command flag + kVK_ANSI_S', /strideMacKeyForward_postSave[\s\S]{0,1600}NSEventModifierFlagCommand[\s\S]{0,900}keyCode: \(unsigned short\) 1/.test(mac));
ok('mm: save respects the Logic/GB suppression + debounce', /strideMacKeyForward_postSave[\s\S]{0,300}g_strideSuppressed\) return;[\s\S]{0,200}g_strideLastPost < 0\.15\) return;/.test(mac));
ok('mm: discovery skips OUR windows (tagged synths + EVERY instance\'s editor frame)', /strideIsOurWindow[\s\S]{0,260}StrideHostedSynth[\s\S]{0,320}g_strideEditorViews/.test(mac));
ok('mm: mainWindow alone is not trusted — falls back to the frontmost non-ours window', /\[NSApp mainWindow\][\s\S]{0,320}strideIsOurWindow \(target\)[\s\S]{0,320}orderedWindows/.test(mac));
ok('mm: sandboxed-host fallback hands the key to the frame window OBJECT (skips our WebView, no loop)', /strideEditorFrameWindow\(\);[\s\S]{0,340}\[frame keyDown:[\s\S]{0,120}\[frame keyUp:/.test(mac));
ok('mm: fresh down+up NSEvents with the target\'s window number (Space 49 / Return 36)', /keyEventWithType[\s\S]{0,460}isReturn \? 36 : 49/.test(mac) && /sendEvent: strideMakeKeyEvent \(NSEventTypeKeyDown[\s\S]{0,140}sendEvent: strideMakeKeyEvent \(NSEventTypeKeyUp/.test(mac));
ok('mm: monitor ignores key auto-repeat (a synthesized pair per repeat would rapid-toggle)', /! \[e isARepeat\]/.test(mac));
ok('mm: its own 150ms debounce breaks any misdelivery bounce', /g_strideLastPost < 0\.15\) return false/.test(mac));
ok('editor registers its NSView with the forwarder (timer) + unregisters ONLY ITS OWN on destruction (multi-instance)', /strideMacKeyForward_registerEditorView \(lastForwardView\)/.test(editor) && /strideMacKeyForward_unregisterEditorView \(lastForwardView\)/.test(editor) && /strideMacKeyForward_unregisterEditorView \(void\* nsview\)/.test(macH));
ok('mm compiled on Apple only (CMake)', /if\(APPLE\)[\s\S]{0,120}MacKeyForward\.mm/.test(cmake));

console.log('  ' + passed + ' passed, ' + failed + ' failed');
process.exit(failed ? 1 : 0);
