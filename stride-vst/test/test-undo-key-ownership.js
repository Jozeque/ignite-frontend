/**
 * Who owns Ctrl+Z? (2026-09-01)
 *
 * Reported twice from the field, latest verbatim: "again there was a bug with the ctrl z
 * that took control over the ableton and i couldnt undo a task (moving devices in the
 * chain)".
 *
 * The cause: canvas.js called preventDefault on Ctrl+Z unconditionally. Stride's WebView
 * keeps keyboard focus after any draw, and WebView2 never passes a key to the host on its
 * own, so the DAW's undo died in our handler whether or not Stride had anything of its own
 * to undo. Ctrl+S and Space had both already been given a forward-to-host path for exactly
 * this reason; undo never got one.
 *
 * The rule now: Stride owns the key only while the user is actually working in Stride.
 * Both conditions must hold, because either alone gets a real case wrong.
 *   - our stack is non-empty, and
 *   - the user has touched Stride since this window last took focus. Coming back from the
 *     DAW and hitting undo means the DAW, even with a full Stride stack. That is the
 *     reported case, and the stack-only check would not have fixed it.
 *
 * Run: node test/test-undo-key-ownership.js
 */
'use strict';
const fs = require('fs');
const path = require('path');

let passed = 0, failed = 0;
function test(name, fn) {
    try { fn(); console.log(`  ✓ ${name}`); passed++; }
    catch (e) { console.log(`  ✗ ${name}: ${e.message}`); failed++; }
}
function assert(c, m) { if (!c) throw new Error(m || 'assertion failed'); }

const ROOT = path.join(__dirname, '..', '..');
const canvas = fs.readFileSync(path.join(__dirname, '..', 'app', 'renderer', 'canvas.js'), 'utf8');
const shim = fs.readFileSync(path.join(ROOT, 'stride-wrapper', 'm0-spike', 'ui', 'shim.js'), 'utf8');
const ed = fs.readFileSync(path.join(ROOT, 'stride-wrapper', 'm0-spike', 'src', 'PluginEditor.cpp'), 'utf8');
const edh = fs.readFileSync(path.join(ROOT, 'stride-wrapper', 'm0-spike', 'src', 'PluginEditor.h'), 'utf8');
const mac = fs.readFileSync(path.join(ROOT, 'stride-wrapper', 'm0-spike', 'src', 'MacKeyForward.mm'), 'utf8');
const macH = fs.readFileSync(path.join(ROOT, 'stride-wrapper', 'm0-spike', 'src', 'MacKeyForward.h'), 'utf8');

console.log('\n— the key is never black-holed —');

test('Ctrl+Z goes to the DAW unless Stride has BOTH a stack and the focus', () => {
    assert(canvas.indexOf("if (undoStack.length && _sdTouchedSinceFocus) { sdUndo(); _sdUndoSay('UNDO: Stride'); }") > 0
        && canvas.indexOf("else _sdKeyToHost('undo');") > 0,
           'undo is gated on both conditions and forwarded otherwise');
    assert(canvas.indexOf("if (redoStack.length && _sdTouchedSinceFocus) { sdRedo(); _sdUndoSay('REDO: Stride'); }") > 0
        && canvas.indexOf("else _sdKeyToHost('redo');") > 0,
           'redo the same');
    // The old unconditional swallow is what caused this. It must not come back.
    assert(canvas.indexOf("e.code === 'KeyZ' && !e.shiftKey) { e.preventDefault(); sdUndo(); return; }") < 0,
           'the unconditional swallow is gone');
    // Ctrl+Y is Redo too, and had the same hole.
    assert(canvas.indexOf("(e.code === 'KeyY' || (e.code === 'KeyZ' && e.shiftKey))") > 0,
           'Ctrl+Y and Ctrl+Shift+Z share one gated branch');
});

test('the focus flag starts false and is only earned by real work', () => {
    assert(/let _sdTouchedSinceFocus = false;/.test(canvas), 'starts false: a freshly focused Stride has not been worked in');
    assert(/window\.addEventListener\('blur',\s*function \(\) \{ _sdTouchedSinceFocus = false; \}\);/.test(canvas),
           'leaving the window drops it, which is what hands the next undo back to the DAW');
    assert(/\['mousedown', 'wheel'\]\.forEach/.test(canvas), 'clicking or scrolling in Stride earns it');
    // Pressing undo must never be what earns Stride the NEXT undo, or the first press
    // would hand every following one to Stride.
    assert(/if \(e\.ctrlKey \|\| e\.metaKey \|\| e\.altKey\) return;   \/\/ shortcuts are not "working in Stride"/.test(canvas),
           'a modified keystroke does not count as working in Stride');
});

test('the POINTER leaving also drops the flag, because blur is not dependable here', () => {
    // Second report, after the blur-only version shipped: "still there is this black holes
    // where i cannot undo". An embedded WebView2 can keep DOM focus while the host window
    // loses OS focus, so window.blur may never fire and the flag stayed true forever. Going
    // to Live to drag a device takes the mouse OUT of Stride every time, so the pointer is
    // the signal that actually fires for the reported workflow.
    assert(/document\.addEventListener\('mouseleave', function \(\) \{ _sdTouchedSinceFocus = false; \}\);/.test(canvas),
           'leaving the document drops it');
    assert(/if \(!e\.relatedTarget && !e\.toElement\) _sdTouchedSinceFocus = false;/.test(canvas),
           'and the mouseout fallback for engines that do not fire mouseleave on document');
    assert(/window\.addEventListener\('blur'/.test(canvas), 'blur is kept as well, it just cannot be the only one');
});

test('every press says who took it, so the next report is not another guess', () => {
    // Ctrl+Z failing is invisible by nature: the key vanishes and there is nothing to look
    // at. That is why this took several rounds. The readout distinguishes the two failure
    // modes: "Stride" when we wrongly kept it, "sent to the DAW" when we forwarded and the
    // host still did nothing.
    assert(/sdUndo\(\); _sdUndoSay\('UNDO: Stride'\)/.test(canvas), 'says when Stride took it');
    assert(/sdRedo\(\); _sdUndoSay\('REDO: Stride'\)/.test(canvas), 'redo too');
    assert(/_sdUndoSay\(sent \? k\.toUpperCase\(\) \+ ': sent to the DAW'/.test(canvas), 'says when it was forwarded');
    assert(/': no host to send to'/.test(canvas), 'and names the case where there is no bridge at all');
    assert(/function _sdUndoSay\(text\)/.test(canvas) && /getElementById\('sd-canvas-status'\)/.test(canvas),
           'written to the canvas status line the user can actually see');
});

test('the desktop app is unaffected: there is no host to forward to', () => {
    const m = canvas.match(/function _sdKeyToHost\(k\) \{[\s\S]*?\n    \}/);
    assert(m, 'the helper exists');
    assert(/typeof window\.sdForwardKeyToHost === 'function'/.test(m[0]),
           'guarded on the wrapper-only hook, so canvas.js stays shared');
    assert(/try \{/.test(m[0]), 'and it can never throw into the key handler');
    assert(/window\.sdForwardKeyToHost = function \(k\)/.test(shim), 'the wrapper defines it');
    assert(/emit\('transportKey', \{ key: k \}\)/.test(shim), 'over the same bridge Ctrl+S and Space use');
});

console.log('\n— the native side actually posts it —');

test('Windows posts a bare Z, riding the Ctrl the user is already holding', () => {
    assert(/const bool isUndo = \(key == "undo" \|\| key == "redo"\);/.test(ed), 'undo and redo recognised');
    assert(/isUndo\s*\?\s*\(WPARAM\) 'Z'/.test(ed), "posts 'Z'");
    // Same trick as save: no synthesised modifiers, because the user's fingers are on
    // them, so Ctrl+Shift+Z reaches the host as redo for free.
    assert(/\(key == "save"\) \? \(WPARAM\) 'S'/.test(ed), 'save still posts S the same way');
});

test('undo gets its own guard, because it is a key people hammer', () => {
    assert(/juce::uint32 lastUndoKeyMs = 0;/.test(edh), 'its own timestamp');
    assert(/if \(nowMs - lastUndoKeyMs < 60\) return;/.test(ed), '60ms, not the transport 150ms');
    assert(/if \(nowMs - lastTransportKeyMs < 150\) return;/.test(ed), 'transport keeps its 150ms');
    // Separate timestamps: an undo must not eat the next space, nor the other way round.
    assert(ed.indexOf('lastUndoKeyMs = nowMs;') > 0 && ed.indexOf('lastTransportKeyMs = nowMs;') > 0,
           'both stamps are written independently');
});

test('macOS posts Cmd+Z through the same window discovery as Cmd+S', () => {
    assert(/void strideMacKeyForward_postUndo \(bool redo\);/.test(macH), 'declared');
    assert(/strideMacKeyForward_postUndo \(key == "redo"\)/.test(ed), 'called for undo and redo');
    // One poster for both keys: window discovery, the suppression check and the two
    // delivery paths were the fiddly, hard-won part and must not be duplicated.
    assert(/static void stridePostCmdKey \(NSString\* ch, unsigned short keyCode, NSEventModifierFlags flags,/.test(mac),
           'a shared poster');
    assert(/stridePostCmdKey \(@"s", \(unsigned short\) 1, NSEventModifierFlagCommand, 0\.15, &g_strideLastPost\);/.test(mac),
           'save routed through it with the SAME arguments it always had');
    assert(/stridePostCmdKey \(@"z", \(unsigned short\) 6,/.test(mac), 'undo posts z / keyCode 6');
    assert(/NSEventModifierFlagCommand \| NSEventModifierFlagShift/.test(mac), 'redo adds Shift');
    assert(/0\.06, &g_strideLastUndoPost/.test(mac), 'its own shorter guard and its own timestamp');
    // The suppression and discovery policy still applies to both.
    assert(/if \(g_strideSuppressed\) return;/.test(mac.slice(mac.indexOf('stridePostCmdKey'))),
           'Logic/GarageBand suppression still respected');
});

console.log(`\n${passed} passed, ${failed} failed\n`);
process.exit(failed ? 1 : 0);
