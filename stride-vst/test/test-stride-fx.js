/**
 * Stride FX — the audio-effect build of the wrapper (2026-08-31).
 *
 * Field request (Malek): "i want to put it on the Master channel or on an audio
 * channel and just play with random parameters on an effect". Instrument vs effect
 * is a VST3 CATEGORY fixed at build time and read by the host when it scans, so no
 * runtime toggle can do it. Stride FX is the SAME sources declared as an effect.
 *
 * What these pin:
 *   - the second target exists and is declared correctly (Fx, own frozen code)
 *   - the FIRST target is untouched, because SwM0 is frozen and shipping
 *   - both CI jobs build it, sign it where signing happens, and put it in the zip
 *   - the one source-level difference (STRIDE_FX) reaches the page
 *   - and, when a local build is present, that the built bundles really do declare
 *     different categories and different UIDs. Source text alone would not catch a
 *     JUCE change that stopped honouring IS_SYNTH.
 *
 * Run: node test/test-stride-fx.js
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
const cmake = fs.readFileSync(path.join(SPIKE, 'CMakeLists.txt'), 'utf8');

// The FX target block only — so "IS_SYNTH FALSE" can never be satisfied by a line
// that belongs to the instrument, or to any other target added later.
function block(target) {
    const i = cmake.indexOf('juce_add_plugin(' + target);
    assert(i >= 0, 'no juce_add_plugin(' + target + ')');
    // Close on a paren that STARTS a line: the comments inside these blocks contain
    // parentheses of their own ("(aumu / SwM0 / Strd)"), and stopping at the first one
    // silently truncated the block so half the pins passed by not being reached.
    const j = cmake.indexOf('\n)', i);
    assert(j > i, 'unterminated juce_add_plugin(' + target + ')');
    return cmake.slice(i, j);
}

console.log('\n— the FX target —');

test('StrideWrapperFx is declared as an audio effect with its own frozen identity', () => {
    const fx = block('StrideWrapperFx');
    assert(/IS_SYNTH\s+FALSE/.test(fx), 'IS_SYNTH FALSE, or Live lists it under Instruments and never feeds it audio');
    assert(/PLUGIN_CODE\s+SwFx/.test(fx), 'PLUGIN_CODE SwFx');
    assert(/PRODUCT_NAME\s+"Stride FX"/.test(fx), 'PRODUCT_NAME "Stride FX"');
    assert(/BUNDLE_ID\s+io\.stridehub\.wrapper\.fx/.test(fx), 'its own bundle id');
    assert(/NEEDS_MIDI_INPUT\s+TRUE/.test(fx), 'MIDI in stays on: keyswitches and Notes mode still work via MIDI To');
    assert(/FORMATS\s+VST3\s*$/m.test(fx) || /FORMATS\s+VST3\s*\n/.test(fx),
           'VST3 only for now: an AU effect identity is a separate frozen triple with its own auval gate');
    assert(!/AU_MAIN_TYPE/.test(fx), 'no AU main type while there is no AU target');
});

test('the SHIPPING instrument identity is untouched', () => {
    const m0 = block('StrideWrapperM0');
    assert(/PLUGIN_CODE\s+SwM0/.test(m0), 'SwM0 still SwM0');
    assert(/IS_SYNTH\s+TRUE/.test(m0), 'still an instrument');
    assert(/AU_MAIN_TYPE\s+kAudioUnitType_MusicDevice/.test(m0), 'aumu untouched');
    assert(/PRODUCT_NAME\s+"Stride"/.test(m0), 'still named Stride');
    // Every project ever saved with Stride resolves it by this triple.
    assert(/PLUGIN_MANUFACTURER_CODE\s+Strd/.test(m0), 'Strd untouched');
});

test('one UI binary feeds both plugins, so the page can never drift between them', () => {
    assert(/target_link_libraries\(StrideWrapperFx[\s\S]{0,200}StrideWrapperM0Data/.test(cmake),
           'FX links the SAME binary data target as the instrument');
    const fxSrc = cmake.slice(cmake.indexOf('target_sources(StrideWrapperFx'));
    ['PluginProcessor.cpp', 'PluginEditor.cpp', 'monocypher.c'].forEach(f => {
        assert(fxSrc.indexOf(f) >= 0 && fxSrc.indexOf(f) < 600, f + ' compiled into the FX target too');
    });
    assert(/target_compile_definitions\(StrideWrapperFx[\s\S]{0,400}STRIDE_FX=1/.test(cmake),
           'STRIDE_FX=1 defined for the FX target');
    assert(!/target_compile_definitions\(StrideWrapperM0[\s\S]{0,400}STRIDE_FX/.test(cmake),
           'and NEVER for the instrument');
});

console.log('\n— the one source-level difference —');

test('the plugin reports which build it is, and the page is told', () => {
    const h = fs.readFileSync(path.join(SPIKE, 'src', 'PluginProcessor.h'), 'utf8');
    assert(/#ifdef STRIDE_FX[\s\S]{0,200}return "StrideWrapperFx"[\s\S]{0,120}return "StrideWrapperM0"/.test(h),
           'getName is gated, and the instrument keeps the string hosts already saved');

    const ed = fs.readFileSync(path.join(SPIKE, 'src', 'PluginEditor.cpp'), 'utf8');
    assert(/#ifdef STRIDE_FX[\s\S]{0,200}setProperty \("is_fx", true\)[\s\S]{0,120}setProperty \("is_fx", false\)/.test(ed),
           'rack_scanned carries is_fx both ways, so the page never has to guess');

    const shim = fs.readFileSync(path.join(SPIKE, 'ui', 'shim.js'), 'utf8');
    assert(/msg\.type !== 'rack_scanned' \|\| _fxNamed \|\| ! msg\.is_fx/.test(shim),
           'the page renames itself once, only on the FX build');
    assert(/'STRIDE FX'/.test(shim), 'and it says STRIDE FX');
});

console.log('\n— it reaches the user —');

test('the Windows job builds it and puts it in the same zip', () => {
    const wf = fs.readFileSync(path.join(ROOT, '.github', 'workflows', 'build-vst3.yml'), 'utf8');
    assert(/--target StrideWrapperFx_VST3/.test(wf), 'windows builds the FX target');
    assert(/find build -name 'Stride FX\.vst3'/.test(wf), 'and finds the bundle');
    assert(/Stride FX\.vst3 not found/.test(wf), 'a missing bundle fails the job instead of shipping a zip without it');
    const zip = wf.match(/7z a -tzip[^\n]*/);
    assert(zip && /"Stride\.vst3" "Stride FX\.vst3"/.test(zip[0]), 'both plugins in the zip: ' + (zip && zip[0]));
});

test('the mac job signs, notarizes, staples and packs it like any other bundle', () => {
    const mac = fs.readFileSync(path.join(SPIKE, 'ci', 'build-mac-vst3.sh'), 'utf8');
    assert(/--target StrideWrapperFx_VST3/.test(mac), 'mac builds it');
    assert(/FX3="\$\(find "\$BUILD_DIR" -name 'Stride FX\.vst3'/.test(mac), 'and locates it');
    assert(/if \[ -z "\$FX3" \]/.test(mac), 'a missing bundle fails the build');
    // An unsigned or unstapled bundle is worse than a missing one: it installs and
    // then Gatekeeper blocks it on the user's machine.
    const signAndStaple = mac.match(/for BUNDLE in [^\n]*/g) || [];
    assert(signAndStaple.length >= 2, 'sign + staple loops found');
    signAndStaple.forEach(l => assert(/\$FX3/.test(l), 'FX missing from a bundle loop: ' + l));
    assert(/ditto "\$FX3"\s+"\$STAGE\/Stride FX\.vst3"/.test(mac), 'notarized in the same submission');
    assert(/ditto "\$FX3"\s+"\$DIST\/Stride\/Stride FX\.vst3"/.test(mac), 'packed into the zip');
    assert(/stapler validate "\$DIST\/Stride\/Stride FX\.vst3"/.test(mac), 'staple re-checked after the copy');
    // auval is the AU gate. There is no AU FX target, so it must NOT be validated.
    assert(!/auval[^\n]*SwFx/.test(mac), 'no auval for a plugin that has no AU build');
});

test('the shipped README explains what the second file is and that it costs nothing', () => {
    const rd = fs.readFileSync(path.join(SPIKE, 'ci', 'README.txt'), 'utf8');
    assert(/Stride FX/.test(rd), 'named');
    assert(/ONE LICENSE|one license/i.test(rd), 'says one license covers both');
    assert(/Stride\.vst3  AND  Stride FX\.vst3/.test(rd), 'install step names both files');
    assert(/VST3 only/i.test(rd), 'the Logic gap is stated rather than discovered');
    assert(rd.indexOf('—') < 0, 'README: no em dashes');
});

console.log('\n— what actually got built (skipped without a local build) —');

test('LOCAL BUILD: the two bundles declare different categories and different UIDs', () => {
    const fx = path.join(SPIKE, 'build', 'StrideWrapperFx_artefacts', 'Release', 'VST3',
                         'Stride FX.vst3', 'Contents', 'Resources', 'moduleinfo.json');
    const m0 = path.join(SPIKE, 'build', 'StrideWrapperM0_artefacts', 'Release', 'VST3',
                         'Stride.vst3', 'Contents', 'Resources', 'moduleinfo.json');
    if (!fs.existsSync(fx) || !fs.existsSync(m0)) return;   // no local build: nothing to check

    // JUCE writes trailing commas, so this is read with regex rather than JSON.parse.
    const read = (p) => {
        const s = fs.readFileSync(p, 'utf8').replace(/^﻿/, '');
        return { sub: (s.match(/"Sub Categories"\s*:\s*\[([^\]]*)\]/) || [])[1] || '',
                 cid: (s.match(/"CID"\s*:\s*"([^"]+)"/) || [])[1] || '' };
    };
    const a = read(fx), b = read(m0);
    assert(/Fx/.test(a.sub) && !/Instrument/.test(a.sub), 'Stride FX declares Fx, got ' + a.sub.trim());
    assert(/Instrument/.test(b.sub), 'Stride still declares Instrument, got ' + b.sub.trim());
    // Same UID would make the two plugins replace each other in every host's database.
    assert(a.cid && b.cid && a.cid !== b.cid, 'distinct VST3 UIDs, got ' + a.cid + ' / ' + b.cid);
    assert(/53774D30$/i.test(b.cid), 'the instrument UID still ends in SwM0, got ' + b.cid);
});

console.log(`\n${passed} passed, ${failed} failed\n`);
process.exit(failed ? 1 : 0);
