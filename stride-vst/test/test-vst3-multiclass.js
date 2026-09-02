/**
 * Multi-class VST3 bundles: surface every plugin in a file, not just the first.
 *
 * Field report 2026-09-02: Serum 2 FX is installed and works in Live but never appears in
 * Stride's + Add browser. One .vst3 may declare several plugins, and Serum2.vst3 declares
 * two ("Serum 2" [Instrument, Synth] and "Serum 2 FX" [Fx]) from a single 18.5 MB file.
 * Stride lost the second one twice over: the browser listed FILES and named rows after the
 * filename, and the loader always took class 0, so even if a row had existed clicking it
 * would have loaded the synth.
 *
 * Spec: docs/ multi-class bundle spec. The identifier is
 * PluginDescription::createIdentifierString(), resolved with matchesIdentifierString(),
 * because an INDEX is not contractual (a vendor reordering classes would silently swap a
 * user's synth for the effect inside saved projects) and a NAME is renamed between versions.
 *
 * Run: node test/test-vst3-multiclass.js
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
const SPIKE = path.join(ROOT, 'stride-wrapper', 'm0-spike');
const proc = fs.readFileSync(path.join(SPIKE, 'src', 'PluginProcessor.cpp'), 'utf8');
const procH = fs.readFileSync(path.join(SPIKE, 'src', 'PluginProcessor.h'), 'utf8');
const ed = fs.readFileSync(path.join(SPIKE, 'src', 'PluginEditor.cpp'), 'utf8');
const shim = fs.readFileSync(path.join(SPIKE, 'ui', 'shim.js'), 'utf8');

console.log('\n— the loader picks a CLASS, not just a file —');

test('loadPlugin takes an optional class id, so every old call site still compiles', () => {
    assert(/void loadPlugin \(const juce::File& pluginFile, const juce::String& classId = \{\}\);/.test(procH),
           'defaulted argument');
    assert(/void StrideWrapperProcessor::loadPlugin \(const juce::File& pluginFile, const juce::String& classId\)/.test(proc),
           'definition matches');
    // The default is the OLD behaviour. Every pre-v11 project and every internal call site
    // passes nothing and must keep getting found[0].
    assert(/const juce::PluginDescription\* want = found\[0\];/.test(proc), 'found[0] is the default');
    assert(/if \(classId\.isNotEmpty\(\)\)/.test(proc), 'and it is only overridden when asked');
});

test('resolution is id, then name, then first class with a warning', () => {
    const body = proc.slice(proc.indexOf('void StrideWrapperProcessor::loadPlugin'),
                            proc.indexOf('void StrideWrapperProcessor::loadPlugin') + 2600);
    assert(/matchesIdentifierString \(classId\)/.test(body),
           'matchesIdentifierString, not string equality: it survives the deprecatedUid migration');
    assert(/byName/.test(body), 'a name fallback for a plugin that changed its uid in an update');
    // Silently loading the WRONG plugin into someone's project is the worst outcome here,
    // so the last-resort fallback is reported rather than swallowed.
    assert(/onLoadFailed[\s\S]{0,220}instead/.test(body), 'the fallback is reported, not silent');
    assert(/found\.size\(\) > 1/.test(body),
           'and only reported when the bundle actually HAS alternatives, or every ordinary '
         + 'single-plugin load would warn');
});

console.log('\n— the browser lists every class —');

test('the scan enumerates classes and names them properly', () => {
    const body = ed.slice(ed.indexOf('void StrideWrapperEditor::scanPluginsToWeb'));
    assert(/fm_findAllTypes \(fm, path, types\)/.test(body), 'each bundle is opened and enumerated');
    assert(/o->setProperty \("cls",  ids\[i\]\);/.test(body), 'the row carries WHICH plugin');
    assert(/o->setProperty \("isFx", /.test(body), 'and whether it is an effect');
    // The old row name was the FILENAME, which is why the browser said "Serum2" and not
    // "Serum 2" even before the FX went missing.
    assert(/o->setProperty \("name", names\[i\]\);/.test(body), 'named after the PLUGIN, not the file');
    assert(!/const auto name = f\.getFileNameWithoutExtension\(\);\s*\n\s*if \(seen\.contains \(name\)\) continue;/.test(body),
           'the filename-keyed dedup is gone');
    assert(/const auto dedup = path \+ "\|" \+ ids\[i\];/.test(body),
           'dedup is per CLASS, so system + per-user folders still collapse to one row');
});

test('opening someone else\'s code is guarded three ways', () => {
    const body = ed.slice(ed.indexOf('void StrideWrapperEditor::scanPluginsToWeb'));
    // 1. cached by path + size + mtime, so a rescan is only slow once
    assert(/f\.getSize\(\)[\s\S]{0,120}getLastModificationTime/.test(body), 'cache key includes size and mtime');
    // 2. the marker is written BEFORE the bundle is opened, so a plugin that takes the host
    //    down is skipped next launch instead of killing us again
    const busy = body.indexOf('cache->setProperty (kidBusy, true);');
    const open = body.indexOf('fm_findAllTypes');
    assert(busy > 0 && busy < open, 'the crash marker is written BEFORE the open, not after');
    assert(/cache->removeProperty \(kidBusy\)/.test(body), 'and cleared once it survives');
    assert(/crashedLastTime/.test(body), 'a bundle that killed us before is not retried');
    // 3. anything that yields nothing still gets a row, so one bad plugin cannot empty
    //    the browser
    assert(/if \(names\.isEmpty\(\)\)[\s\S]{0,200}getFileNameWithoutExtension/.test(body),
           'falls back to the filename row');
    assert(/catch \(\.\.\.\)/.test(body), 'and a throw inside the vendor is caught');
});

test('the browser and the loader agree about what is in a file', () => {
    // Enumerating through a DIFFERENT format manager could list an id the loader then fails
    // to match, which would look like "the browser lies".
    assert(/juce::AudioPluginFormatManager& getFormatManagerForScan\(\)/.test(procH), 'one manager, shared');
    assert(/auto& fm = proc\.getFormatManagerForScan\(\);/.test(ed), 'the scan uses it');
});

console.log('\n— it survives a project save —');

test('state v11 writes the class ONLY when it is not the first', () => {
    assert(/root\.setAttribute \("version", 11\);/.test(proc), 'version bumped');
    // A single-plugin device must produce byte-identical XML to v10, or every existing
    // project churns on first save for no reason.
    assert(/if \(chain\[\(size_t\) i\]\.cls\.isNotEmpty\(\)\) dev->setAttribute \("cls", chain\[\(size_t\) i\]\.cls\);/.test(proc),
           'written conditionally');
    assert(/const juce::String clsStr = \(found\.size\(\) > 1\) \? want->createIdentifierString\(\) : juce::String\(\);/.test(proc),
           'and only recorded at all for a multi-class bundle');
});

test('restore resolves the same way, and absent means class 0', () => {
    assert(/d\.cls  = dev->getStringAttribute \("cls"\);/.test(proc), 'read back');
    const r = proc.slice(proc.indexOf('restoreMissingNames.add'));
    assert(/if \(d\.cls\.isNotEmpty\(\)\)[\s\S]{0,320}matchesIdentifierString \(d\.cls\)/.test(r),
           'restore picks by id too, or a saved FX comes back as the synth');
    assert(/Node \{ std::move \(inst\), name, d\.path, d\.bypassed, d\.cls \}/.test(proc),
           'and the restored node remembers it, so the NEXT save is right too');
});

test('undo brings back the same plugin, not its neighbour in the bundle', () => {
    // Both snapshot paths: removing one device, and clearing the whole chain.
    assert((proc.match(/d\.cls  = chain\[\(size_t\) i(ndex)?\]\.cls;/g) || []).length === 2,
           'both removeNode and clearChain snapshots carry the class');
    assert(/struct Node \{[\s\S]{0,220}juce::String cls;/.test(procH), 'the node carries it');
    assert(/struct Dev \{ juce::String path; juce::String cls;/.test(procH), 'the snapshot carries it');
});

console.log('\n— the page —');

test('the row sends its class, and favourites do not collapse two plugins into one', () => {
    assert(/emit\('loadSynthPath', \{ path: p\.path, cls: p\.cls \|\| '' \}\)/.test(shim), 'the click carries cls');
    assert(/x\.path === p\.path && \(x\.cls \|\| ''\) === \(p\.cls \|\| ''\)/.test(shim),
           'a favourite is keyed on path AND class');
    assert(/emit\('loadSynthPath', \{ path: f\.path, cls: f\.cls \|\| '' \}\)/.test(shim), 'the favourite Load button too');
    // Only mark the effect when the bundle actually produced more than one row: the same
    // rule the format chip already follows.
    assert(/if \(p\.multi && p\.isFx\)/.test(shim), 'the FX chip only appears when it disambiguates');
});

test('the native side still accepts a page that does not know about classes', () => {
    // An older page build sends {path} with no cls. That has to keep working, because the
    // page and the binary are versioned together but a stale WebView cache is a real thing.
    assert(/v\.getProperty \("cls", ""\)\.toString\(\)/.test(ed), 'absent cls reads as empty');
    assert(/const juce::PluginDescription\* want = found\[0\];/.test(proc), 'and empty means the first class');
});

console.log('\n— the fixture on this machine (skipped elsewhere) —');

test('LOCAL: Serum2.vst3 really does declare two classes', () => {
    const mi = 'C:/Program Files/Common Files/VST3/Serum2.vst3/Contents/Resources/moduleinfo.json';
    if (!fs.existsSync(mi)) return;   // not this machine: nothing to check
    const s = fs.readFileSync(mi, 'utf8').replace(/^\uFEFF/, '');
    const names = [...s.matchAll(/"Name"\s*:\s*"([^"]+)"[\s\S]{0,400}?"Sub Categories"\s*:\s*\[([^\]]*)\]/g)];
    assert(names.length >= 2, 'the bundle declares more than one plugin, got ' + names.length);
    assert(names.some(m => /Fx/.test(m[2])), 'one of them is an effect');
    assert(names.some(m => /Instrument/.test(m[2])), 'and one is an instrument');
});

console.log(`\n${passed} passed, ${failed} failed\n`);
process.exit(failed ? 1 : 0);
