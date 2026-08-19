// Removing a device must never unmap the plugin's code.
//
// Field report 2026-08-19: VerbSuite (Slate) loaded in the chain, transport running, press
// remove -> Live crashed. The crash dump (Ableton Live 12 Suite.exe.58080.dmp) showed
// HEAP_CORRUPTION (0xC0000374) reported by ntdll, with VerbSuite's module ALREADY ABSENT
// from the process - i.e. the plugin had been unloaded and something tripped over it after.
//
// Cause: JUCE reference-counts the VST3 module (RefCountedDllHandle), so destroying the
// LAST instance of a plugin runs its ExitDll and then FreeLibrary. We cannot fix a vendor's
// teardown, so we keep the binary resident, which is what the big hosts do.
const fs = require('fs');
const path = require('path');

const W = path.join(__dirname, '..', '..', 'stride-wrapper', 'm0-spike');
const rd = (p) => fs.readFileSync(p, 'utf8');
const proc = rd(path.join(W, 'src', 'PluginProcessor.cpp'));

let passed = 0, failed = 0;
function ok(name, cond) {
  if (cond) { passed++; }
  else { failed++; console.log('  ✗ ' + name); }
}
console.log('test-vst3-plugin-unload.js');

ok('a hosted binary is pinned resident when it loads',
   /static void pinPluginBinary \(const juce::String& bundlePath\)/.test(proc) &&
   /pinPluginBinary \(pathStr\)/.test(proc));
ok('the pin happens on the LOAD path, before the instance joins the chain',
   /pinPluginBinary \(pathStr\);[\s\S]{0,1200}chain\.push_back/.test(proc));
ok('it resolves the binary INSIDE a .vst3 bundle, not the bundle folder',
   /getChildFile \("Contents"\)\.getChildFile \("x86_64-win"\)/.test(proc) &&
   /findChildFiles \(juce::File::findFiles, false, "\*\.vst3"\)/.test(proc));
ok('each binary is pinned once, under a lock (loads are async)',
   /pinnedPaths->contains \(path\)\) return;/.test(proc) &&
   /const juce::ScopedLock sl \(pinLock\)/.test(proc));
ok('the handles are never closed, not even at static teardown',
   /pinnedLibs->add \(lib\.release\(\)\)/.test(proc) &&
   /static auto\* pinnedLibs  = new juce::OwnedArray<juce::DynamicLibrary>\(\)/.test(proc));
ok('Windows only: macOS never closes the bundle in the first place',
   /#if JUCE_WINDOWS[\s\S]{0,2200}static void pinPluginBinary/.test(proc) &&
   /#if JUCE_WINDOWS\s*\n\s*pinPluginBinary \(pathStr\);/.test(proc));
// The teardown ORDER that was already right stays right: meta under the lock, the hosted
// getState and the destructor outside it.
ok('removeNode still tears down in two phases (lock, then plugin calls)',
   /OUTSIDE the lock: the hosted patch capture for undo \+ the destructor/.test(proc) &&
   /doomed\.inst->getStateInformation \(lastRemoved\.devices\[0\]\.state\);\s*\n\s*doomed = \{\};/.test(proc));
// It always refused rather than freezing behind a wedged audio thread - but it refused
// SILENTLY, while the editor had already closed the device's window and pushed state as if
// it had worked, so the device looked gone and kept all its lanes in the UI.
ok('removeNode still refuses rather than freezing behind a wedged audio thread',
   /bool StrideWrapperProcessor::removeNode \(int index\)[\s\S]{0,500}if \(! hostLockFreeBounded \(8\)\) return false;/.test(proc));
ok('a refusal is REPORTED, not silent',
   /bool removeNode \(int index\);/.test(rd(path.join(W, 'src', 'PluginProcessor.h'))) &&
   /const bool removed = proc\.removeNode \(i\);/.test(rd(path.join(W, 'src', 'PluginEditor.cpp'))) &&
   /if \(! removed\)\s*\n\s*emitChainNote \("Device not removed"/.test(rd(path.join(W, 'src', 'PluginEditor.cpp'))));
ok('the refusal message says the parameters are still there',
   /its parameters are still here/.test(rd(path.join(W, 'src', 'PluginEditor.cpp'))));

console.log('  ' + passed + ' passed, ' + failed + ' failed');
process.exit(failed ? 1 : 0);
