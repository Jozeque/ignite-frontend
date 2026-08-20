// Two copies of the SAME plugin in one chain.
//
// Field reports 2026-08-20:
//   1. deleting one device flung EVERY device's window open
//   2. focusing one of two identical devices showed the lanes of both
//
// A plugin NAME cannot tell two instances apart. The chain SLOT can, and it is what the
// device chips are indexed by, so that is what focus matches on.
const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..', '..');
const W    = path.join(root, 'stride-wrapper', 'm0-spike');
const rd   = (p) => fs.readFileSync(p, 'utf8');
const editor = rd(path.join(W, 'src', 'PluginEditor.cpp'));
const edH    = rd(path.join(W, 'src', 'PluginEditor.h'));
const proc   = rd(path.join(W, 'src', 'PluginProcessor.cpp'));
const procH  = rd(path.join(W, 'src', 'PluginProcessor.h'));
const shim   = rd(path.join(W, 'ui', 'shim.js'));
const canvas = rd(path.join(root, 'stride-vst', 'app', 'renderer', 'canvas.js'));

let passed = 0, failed = 0;
function ok(name, cond) {
  if (cond) { passed++; } else { failed++; console.log('  ✗ ' + name); }
}
console.log('test-vst3-duplicate-devices.js');

// ── 1. DELETING A DEVICE MUST NOT REOPEN THE OTHERS ──
// Close-all used to EMPTY the window vector, so the reconciler read "fewer windows than
// devices" as "devices were added" and opened the lot on the next chain change.
ok('close-all empties the SLOTS but keeps them aligned to the chain',
   /for \(auto& w : synthWindows\) w\.reset\(\);/.test(editor) &&
   !/"closeSynth",\s*\[this\] \(juce::var\)\s*\{ synthWindows\.clear\(\); \}/.test(editor));
ok('adding a device opens only the NEW slot, not every empty one',
   /openMissingSynthWindows \(\(int\) synthWindows\.size\(\)\)/.test(editor) &&
   /void StrideWrapperEditor::openMissingSynthWindows \(int firstIndex\)/.test(editor) &&
   /for \(int i = juce::jmax \(0, firstIndex\); i < n; \+\+i\)/.test(editor));
ok('"Synth UI" still means open everything', /openMissingSynthWindows \(int firstIndex = 0\)/.test(edH) &&
   /openMissingSynthWindows\(\);\s*\n\s*for \(auto& w : synthWindows\)/.test(editor));
ok('a removal still does NOT reopen (the targeted erase already handled it)',
   /n == size: a removal was already handled by the targeted erase/.test(editor));

// ── 2. FOCUS ONE OF TWO IDENTICAL DEVICES ──
ok('the engine reports which chain slot each lane came from',
   /juce::Array<int>  getMappedNodes\(\) const;/.test(procH) &&
   /juce::Array<int> StrideWrapperProcessor::getMappedNodes\(\) const/.test(proc) &&
   /for \(const auto& m : mapped\) out\.add \(m\.node\);/.test(proc));
ok('it rides along with every lane in rack_scanned',
   /const auto nodes  = proc\.getMappedNodes\(\)/.test(editor) &&
   /o->setProperty \("node", nodes\[i\]\)/.test(editor));
ok('the canvas keeps the slot on the lane', /nodeIdx: \(typeof p\.node === 'number' \? p\.node : -1\)/.test(canvas));
ok('focus matches on the SLOT, and a name still works for the desktop',
   /if \(sdDeviceFilterNode >= 0\)\s*\n\s*return sdCanvasParams\.filter\(p => p\.nodeIdx === sdDeviceFilterNode\);/.test(canvas) &&
   /if \(typeof dev === 'number' && dev >= 0\)/.test(canvas) &&
   /sdDeviceFilter = \(dev && dev !== sdDeviceFilter\) \? dev : null;/.test(canvas));
ok('clicking the focused device again clears it',
   /sdDeviceFilterNode = \(dev === sdDeviceFilterNode\) \? -1 : dev;/.test(canvas));
ok('selected stays a subset of visible, whichever way focus was set',
   /if \(p\.selected && vis\.indexOf\(p\) < 0\) \{ p\.selected = false; dropped = true; \}/.test(canvas));
ok('a focus on a slot that no longer has lanes is dropped, not left hiding everything',
   /if \(sdDeviceFilterNode >= 0 && !sdCanvasParams\.some\(p => p\.nodeIdx === sdDeviceFilterNode\)\)/.test(canvas));
ok('the chips focus by slot and highlight only the one clicked',
   /chip\.dataset\.slot = String\(i\);/.test(shim) &&
   /window\.sdSetDeviceFilter\(i\)/.test(shim) &&
   /parseInt\(kids\[k\]\.dataset\.slot, 10\) === _devFilter/.test(shim));
ok('repeated names are numbered so the copies can be told apart',
   /var dupTotal = 0, dupIdx = 0;/.test(shim) && /dupTotal > 1 \? ' ' \+ dupIdx : ''/.test(shim));

console.log('  ' + passed + ' passed, ' + failed + ' failed');
process.exit(failed ? 1 : 0);
