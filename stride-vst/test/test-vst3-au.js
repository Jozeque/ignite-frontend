/**
 * test-vst3-au.js
 *
 * Covers the AU (Logic Pro / GarageBand) batch on the Stride wrapper:
 *   - the AU build target (aumu, identity frozen to the VST3's SwM0/Strd codes)
 *   - AU HOSTING on macOS (formatManager + format-agnostic load/restore by path)
 *   - the plugin browser's AU scan + format chips + favorites labels
 *   - the sandboxed-host license resolver (Logic's container would otherwise
 *     hide a license activated in Live/Bitwig)
 *   - the Mac CI: AU build + codesign + auval gate + notarize/staple + package
 *
 * Two layers (canvas.js / C++ are not loaded in Node):
 *   1. Behavioral — replicate the pure logic (format-by-extension resolution,
 *      favorites naming, chip visibility, sandbox path decision) and assert it.
 *   2. Cross-file + source assertions — read the REAL files and assert the wiring
 *      is present AND consistent (e.g. the auval line in CI must be built from the
 *      SAME 4-char codes CMake declares, so the two can never drift).
 */
'use strict';
const fs = require('fs');
const path = require('path');

let passed = 0, failed = 0;
function ok(name, cond, extra) {
    if (cond) { passed++; }
    else { failed++; console.log('  ✗ ' + name + (extra ? '  — ' + extra : '')); }
}
console.log('test-vst3-au.js');

const root   = path.join(__dirname, '..', '..');
const rd     = (p) => fs.readFileSync(p, 'utf8');
const cmake  = rd(path.join(root, 'stride-wrapper', 'm0-spike', 'CMakeLists.txt'));
const proc   = rd(path.join(root, 'stride-wrapper', 'm0-spike', 'src', 'PluginProcessor.cpp'));
const procH  = rd(path.join(root, 'stride-wrapper', 'm0-spike', 'src', 'PluginProcessor.h'));
const editor = rd(path.join(root, 'stride-wrapper', 'm0-spike', 'src', 'PluginEditor.cpp'));
const licH   = rd(path.join(root, 'stride-wrapper', 'm0-spike', 'src', 'License.h'));
const shim   = rd(path.join(root, 'stride-wrapper', 'm0-spike', 'ui', 'shim.js'));
const indexH = rd(path.join(root, 'stride-wrapper', 'm0-spike', 'ui', 'index.html'));
const macSh  = rd(path.join(root, 'stride-wrapper', 'm0-spike', 'ci', 'build-mac-vst3.sh'));
const readme = rd(path.join(root, 'stride-wrapper', 'm0-spike', 'ci', 'README.txt'));

// ─────────────────────────────────────────────────────────────
// 1. BEHAVIORAL — pure-logic replicas
// ─────────────────────────────────────────────────────────────

// format resolution by path (mirrors findPluginTypesForFile: first format that
// claims the file wins; VST3 claims .vst3, AU claims .component)
(function () {
    const claims = {
        VST3: (p) => /\.vst3$/i.test(p),
        AU:   (p) => /\.component$/i.test(p),
    };
    const resolve = (p, formats) => (formats.find(f => claims[f](p)) || null);
    const macFormats = ['VST3', 'AU'], winFormats = ['VST3'];

    ok('resolve: .vst3 -> VST3 (both platforms)',
       resolve('C:\\VST3\\Serum.vst3', winFormats) === 'VST3'
       && resolve('/Library/Audio/Plug-Ins/VST3/Serum.vst3', macFormats) === 'VST3');
    ok('resolve: .component -> AU on mac', resolve('/Library/Audio/Plug-Ins/Components/Serum.component', macFormats) === 'AU');
    ok('resolve: .component unclaimed on Windows (AU format not registered)', resolve('X:\\Serum.component', winFormats) === null);
    ok('resolve: case-insensitive extensions', resolve('/a/B.COMPONENT', macFormats) === 'AU' && resolve('/a/B.VST3', macFormats) === 'VST3');
    ok('resolve: unknown extension -> none', resolve('/a/b.dll', macFormats) === null);
})();

// favorites naming (mirrors shim favName/favLabel)
(function () {
    function favName(p) { p = String(p).replace(/\\/g, '/'); const f = p.split('/').pop() || p; return f.replace(/\.(vst3|component)$/i, ''); }
    function favLabel(p) { return /\.component$/i.test(String(p)) ? favName(p) + ' (AU)' : favName(p); }
    ok('favName strips .vst3', favName('C:\\Common Files\\VST3\\Serum.vst3') === 'Serum');
    ok('favName strips .component', favName('/Library/Audio/Plug-Ins/Components/Serum.component') === 'Serum');
    ok('favLabel suffixes AU devices only', favLabel('/x/Serum.component') === 'Serum (AU)' && favLabel('/x/Serum.vst3') === 'Serum');
})();

// format chips show ONLY when the list mixes formats (Windows stays untouched)
(function () {
    const multiFmt = (plugins) => plugins.some(x => x.fmt && x.fmt !== 'VST3');
    ok('chips hidden for a VST3-only list', multiFmt([{ fmt: 'VST3' }, { fmt: 'VST3' }]) === false);
    ok('chips hidden for a legacy list without fmt', multiFmt([{ name: 'Serum' }]) === false);
    ok('chips shown once an AU entry exists', multiFmt([{ fmt: 'VST3' }, { fmt: 'AU' }]) === true);
})();

// sandboxed-host data dir decision (mirrors License.h dataDir):
// unsandboxed -> default; sandboxed -> real home IF the shared license is there
// or the real folder is writable; else the container default.
(function () {
    function pickDir(s) {
        if (!s.sandboxed) return 'default';
        if (s.realHasLicense) return 'real';
        if (s.realWritable) return 'real';
        return 'default';
    }
    ok('unsandboxed host keeps the exact current path', pickDir({ sandboxed: false, realHasLicense: true, realWritable: true }) === 'default');
    ok('Logic + license activated in Live -> shared real path', pickDir({ sandboxed: true, realHasLicense: true, realWritable: false }) === 'real');
    ok('Logic + fresh machine + writable real path -> real (activation shared forward)', pickDir({ sandboxed: true, realHasLicense: false, realWritable: true }) === 'real');
    ok('Logic + sandbox denies real path -> container fallback (still activates per-host)', pickDir({ sandboxed: true, realHasLicense: false, realWritable: false }) === 'default');
})();

// ─────────────────────────────────────────────────────────────
// 2. CMake — the AU target + frozen identity
// ─────────────────────────────────────────────────────────────
ok('CMake FORMATS includes AU (and keeps VST3 + Standalone)', /FORMATS\s+AU\s+VST3\s+Standalone/.test(cmake));
ok('CMake pins AU_MAIN_TYPE to kAudioUnitType_MusicDevice (aumu)', /AU_MAIN_TYPE\s+kAudioUnitType_MusicDevice/.test(cmake));
ok('CMake enables AU hosting via PLUGINHOST_AU TRUE', /PLUGINHOST_AU\s+TRUE/.test(cmake));
ok('CMake no longer force-disables AU hosting', !/JUCE_PLUGINHOST_AU=0/.test(cmake));
ok('identity FROZEN: PLUGIN_CODE still SwM0', /PLUGIN_CODE\s+SwM0/.test(cmake));
ok('identity FROZEN: manufacturer still Strd', /PLUGIN_MANUFACTURER_CODE\s+Strd/.test(cmake));
ok('IS_SYNTH stays TRUE (aumu needs an instrument)', /IS_SYNTH\s+TRUE/.test(cmake));

// AU ships in a minor version bump, not a patch
(function () {
    const m = cmake.match(/project\(StrideWrapperM0 VERSION (\d+)\.(\d+)\.(\d+)/);
    ok('CMake VERSION parses', !!m);
    if (m) ok('VERSION is >= 1.1.0 (AU is a feature release)', (+m[1] > 1) || (+m[1] === 1 && +m[2] >= 1));
})();

// ─────────────────────────────────────────────────────────────
// 3. Processor — AU format registered + format-agnostic load/restore
// ─────────────────────────────────────────────────────────────
ok('AudioUnitPluginFormat registered on mac', /AudioUnitPluginFormat/.test(proc));
ok('AU format guarded to mac (class only exists there)', /#if JUCE_PLUGINHOST_AU && JUCE_MAC\s*\n[^\n]*\n[^\n]*\n\s*formatManager\.addFormat \(std::make_unique<juce::AudioUnitPluginFormat>\(\)\);/.test(proc));
ok('shared resolver findPluginTypesForFile exists', /void findPluginTypesForFile \(juce::AudioPluginFormatManager&/.test(proc));
ok('loadPlugin resolves through the registered formats', /findPluginTypesForFile \(formatManager, pluginFile\.getFullPathName\(\), found\)/.test(proc));
ok('project restore resolves through the registered formats too', /findPluginTypesForFile \(formatManager, d\.path, found\)/.test(proc));
ok('no leftover hardcoded VST3-only resolution in load/restore', !/juce::VST3PluginFormat fmt;\s*\n\s*juce::OwnedArray<juce::PluginDescription> found;/.test(proc));
ok('header documents the .component path support', /\.component AU on macOS/.test(procH));

// ─────────────────────────────────────────────────────────────
// 4. Editor — browser scan + chooser filter
// ─────────────────────────────────────────────────────────────
ok('mac file chooser accepts .component too', /\*\.vst3;\*\.component/.test(editor));
ok('AU scan covers the system Components folder', /\/Library\/Audio\/Plug-Ins\/Components/.test(editor));
ok('AU scan covers the per-user Components folder', /~\/Library\/Audio\/Plug-Ins\/Components/.test(editor));
ok('AU scan matches .component bundles', /\*\.component/.test(editor));
ok('AU scan guarded to mac', /#if JUCE_PLUGINHOST_AU && JUCE_MAC/.test(editor));
ok('scan entries carry a fmt tag (VST3 + AU)', /setProperty \("fmt",\s+fmt\)/.test(editor) && /"AU"\)/.test(editor) && /"VST3"\)/.test(editor));
ok('sandboxed host: real per-user VST3 folder re-added to the search', /hostIsSandboxed\(\)/.test(editor) && /realUserHome\(\).getChildFile \("Library\/Audio\/Plug-Ins\/VST3"\)/.test(editor));
ok('sandboxed host: real per-user Components folder re-added to the search', /realUserHome\(\).getChildFile \("Library\/Audio\/Plug-Ins\/Components"\)/.test(editor));

// ─────────────────────────────────────────────────────────────
// 5. License.h — sandboxed-host (Logic) shared-license resolver
// ─────────────────────────────────────────────────────────────
ok('sandbox detection via the container path marker', /hostIsSandboxed/.test(licH) && /\/Library\/Containers\//.test(licH));
ok('real home read from the passwd db (not $HOME)', /getpwuid \(getuid\(\)\)/.test(licH));
ok('resolver prefers an existing shared license.json', /real\.getChildFile \("license\.json"\)\.existsAsFile\(\)/.test(licH));
ok('resolver probes writability before adopting the real path', /real\.isDirectory\(\) && real\.hasWriteAccess\(\)/.test(licH));
ok('container fallback keeps the EXACT legacy path', /userApplicationDataDirectory/.test(licH) && /getChildFile \("stride-canvas"\)\.getChildFile \("stride-data"\)/.test(licH));
ok('mac-only guard (Windows path byte-identical)', /#if JUCE_MAC\s*\n \#include <pwd\.h>/m.test(licH) || /#if JUCE_MAC[\s\S]{0,200}include <pwd\.h>/.test(licH));

// ─────────────────────────────────────────────────────────────
// 6. CI — AU build, sign, auval gate, notarize, package (consistency)
// ─────────────────────────────────────────────────────────────
ok('mac script builds the AU target', /--target StrideWrapperM0_AU/.test(macSh));
ok('mac script locates Stride.component', /Stride\.component/.test(macSh));
// Three bundles since 2026-08-31: Stride FX joined the VST3 + AU pair. Every one of
// them must go through sign AND staple, because an unsigned bundle installs fine and
// then Gatekeeper blocks it on the user's machine.
ok('mac script signs EVERY bundle, AU included', /for BUNDLE in "\$VST3" "\$FX3" "\$AU"/.test(macSh));
ok('mac script runs the STRICT auval gate and fails the build on FAIL', /auval -strict -v aumu/.test(macSh) && /auval FAILED/.test(macSh));
ok('mac script validates the x86_64 slice too (Rosetta; real failures fail the build)', /arch -x86_64 auval/.test(macSh) && /x86_64 slice/.test(macSh));
ok('mac script resets the component registrar before auval', /killall -9 AudioComponentRegistrar/.test(macSh));
ok('mac script notarizes both bundles in one submission', /ditto "\$VST3" "\$STAGE\/Stride\.vst3"/.test(macSh) && /ditto "\$AU"\s+"\$STAGE\/Stride\.component"/.test(macSh));
ok('mac script staples + validates both bundles', /stapler validate "\$DIST\/Stride\/Stride\.component"/.test(macSh));
ok('mac zip ships both formats', /ditto "\$AU"\s+"\$DIST\/Stride\/Stride\.component"/.test(macSh));

// the auval triple must be BUILT FROM the CMake identity — they can never drift
(function () {
    const code = (cmake.match(/PLUGIN_CODE\s+(\S+)/) || [])[1];
    const manu = (cmake.match(/PLUGIN_MANUFACTURER_CODE\s+(\S+)/) || [])[1];
    ok('CMake identity codes readable', !!code && !!manu);
    if (code && manu)
        ok('auval validates the SAME identity CMake declares (aumu ' + code + ' ' + manu + ')',
           new RegExp('auval (-strict )?-v aumu ' + code + ' ' + manu).test(macSh));
})();

// (the workflow yml itself is unchanged — it just runs ci/build-mac-vst3.sh,
// where ALL the AU build/sign/auval steps live; pushing workflow-file edits
// needs the `workflow` OAuth scope this machine's credentials don't have)

// ─────────────────────────────────────────────────────────────
// 7. Customer README + UI copy
// ─────────────────────────────────────────────────────────────
ok('README explains the Components install folder', /\/Library\/Audio\/Plug-Ins\/Components\//.test(readme));
ok('README names Logic Pro + GarageBand', /Logic Pro/.test(readme) && /GarageBand/.test(readme));
ok('README ships Stride.component instructions', /Stride\.component/.test(readme));
ok('README keeps the Pro Tools caveat', /Pro Tools not supported yet/.test(readme));
ok('shim strips .component in favorites', /\\\.\(vst3\|component\)\$/.test(shim));
ok('shim labels AU favorites', /favLabel/.test(shim) && /' \(AU\)'/.test(shim));
ok('shim shows chips only for mixed-format lists', /multiFmt/.test(shim) && /x\.fmt && x\.fmt !== 'VST3'/.test(shim));
ok('shim empty-state copy is format-neutral', /No plugins found in the standard folders\./.test(shim) && !/No VST3 plugins found/.test(shim));
ok('browser footer copy is format-neutral', /found in the standard plugin folders/.test(shim));
ok('in-app guide mentions AU on Mac', /VST3, or AU on Mac/.test(indexH));

// ─────────────────────────────────────────────────────────────
// 8. Logic-specific behavior — transport keys + load-failure toast
// ─────────────────────────────────────────────────────────────
const keyH  = rd(path.join(root, 'stride-wrapper', 'm0-spike', 'src', 'MacKeyForward.h'));
const keyMm = rd(path.join(root, 'stride-wrapper', 'm0-spike', 'src', 'MacKeyForward.mm'));

ok('key forwarder exposes a suppression switch', /strideMacKeyForward_setSuppressed/.test(keyH) && /strideMacKeyForward_setSuppressed/.test(keyMm));
ok('suppression gates BOTH forward paths at the single delivery point', /if \(g_strideSuppressed\) return false;/.test(keyMm));
ok('editor suppresses synthetic keys in Logic/GarageBand (out-of-process AU)',
   /strideMacKeyForward_setSuppressed \(juce::PluginHostType\(\)\.isLogic\(\) \|\| juce::PluginHostType\(\)\.isGarageBand\(\)\)/.test(editor));

ok('processor surfaces load failures on BOTH failure paths', (proc.match(/onLoadFailed \(/g) || []).length >= 2);
ok('processor documents the editor ownership of the callback', /reset in its dtor/.test(rd(path.join(root, 'stride-wrapper', 'm0-spike', 'src', 'PluginProcessor.h'))));
ok('editor wires the loadFailed toast and clears it in the dtor', /"loadFailed"/.test(editor) && /proc\.onLoadFailed = nullptr/.test(editor));
ok('shim shows the load-failure toast with the arch hint', /listen\('loadFailed'/.test(shim) && /Intel-only/.test(shim));

console.log('  ' + passed + ' passed, ' + failed + ' failed');
process.exit(failed ? 1 : 0);
