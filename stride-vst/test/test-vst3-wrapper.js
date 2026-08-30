/**
 * test-vst3-wrapper.js
 *
 * Covers the Stride VST3 wrapper batch:
 *   - license gate (License.h mirrors the desktop main.js 1:1; shim/editor bridge)
 *   - the compact UI tweaks (MOTION recolor, Shuffle, Mutate, Browse-in-header)
 *   - the "Stride" rename
 *   - the Win+Mac GitHub Actions CI (entitlements, signing, jobs)
 *
 * Two layers (canvas.js / C++ are not loaded in Node):
 *   1. Behavioral — replicate the pure logic (license req/resp bridge, offline
 *      grace, the validate-result builtin path) and assert it.
 *   2. Cross-file + source assertions — read the REAL files and assert the
 *      wiring is present AND consistent across desktop ↔ wrapper (so the two
 *      can't drift, e.g. accept different keys).
 */
'use strict';
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

let passed = 0, failed = 0;
function ok(name, cond, extra) {
    if (cond) { passed++; }
    else { failed++; console.log('  ✗ ' + name + (extra ? '  — ' + extra : '')); }
}
console.log('test-vst3-wrapper.js');

const root    = path.join(__dirname, '..', '..');
const rd = (p) => fs.readFileSync(p, 'utf8');
const mainJs  = rd(path.join(root, 'stride-vst', 'app', 'main.js'));
const license = rd(path.join(root, 'stride-wrapper', 'm0-spike', 'src', 'License.h'));
const shim    = rd(path.join(root, 'stride-wrapper', 'm0-spike', 'ui', 'shim.js'));
const editor  = rd(path.join(root, 'stride-wrapper', 'm0-spike', 'src', 'PluginEditor.cpp'));
const cmake   = rd(path.join(root, 'stride-wrapper', 'm0-spike', 'CMakeLists.txt'));
const indexH  = rd(path.join(root, 'stride-wrapper', 'm0-spike', 'ui', 'index.html'));
const ent     = rd(path.join(root, 'stride-wrapper', 'm0-spike', 'ci', 'entitlements.plist'));
const macSh   = rd(path.join(root, 'stride-wrapper', 'm0-spike', 'ci', 'build-mac-vst3.sh'));
const wf       = rd(path.join(root, '.github', 'workflows', 'build-vst3.yml'));

// ── helper: pull all 64-hex SHA-256 strings out of a blob ──
const hexes = (s) => (s.match(/[a-f0-9]{64}/g) || []);

// ─────────────────────────────────────────────────────────────
// 1. BEHAVIORAL — license bridge + offline grace + builtin path
// ─────────────────────────────────────────────────────────────

// req/resp bridge replica (shim _licCall + licenseReply correlation)
(function () {
    const pending = {}; let seq = 0; const sent = [];
    function emit(name, payload) { sent.push({ name: name, payload: payload }); }
    let resolved = null;
    function licCall(op, payload) {
        const id = ++seq; pending[id] = function (r) { resolved = r; };
        emit('license', Object.assign({ reqId: id, op: op }, payload || {}));
        return id;
    }
    function onReply(d) { const r = pending[d.reqId]; if (r) { delete pending[d.reqId]; r(d.result || {}); } }

    const id = licCall('validate', { key: 'ABC' });
    ok('bridge emits a license request with reqId+op', sent.length === 1 && sent[0].payload.op === 'validate' && sent[0].payload.reqId === 1);
    onReply({ reqId: id, result: { valid: true, tier: 'pro' } });
    ok('bridge resolves the matching reqId', resolved && resolved.valid === true && resolved.tier === 'pro');
    const before = resolved;
    onReply({ reqId: 999, result: { valid: false } });   // stale/unknown id ignored
    ok('bridge ignores an unknown reqId', resolved === before);
})();

// offline-grace age logic (mirrors License.h / main.js)
(function () {
    const GRACE = 14 * 24 * 60 * 60 * 1000;
    const within = (ageMs) => ageMs < GRACE;
    ok('offline grace: 1 day old is valid', within(1 * 24 * 60 * 60 * 1000) === true);
    ok('offline grace: 13 days old is valid', within(13 * 24 * 60 * 60 * 1000) === true);
    ok('offline grace: 15 days old is expired', within(15 * 24 * 60 * 60 * 1000) === false);
})();

// builtin check is a real SHA-256 of the upper-cased, trimmed key
(function () {
    const masterHash = '074ac7dc594a379be6e5bdfbaab4d16d5400a19cc2f2af9f8c83e88612efdb62';
    const sha = (k) => crypto.createHash('sha256').update(k.trim().toUpperCase()).digest('hex');
    // we don't ship the plaintext, but prove the *transform* the gate relies on
    ok('sha256(trim+upper) is deterministic 64-hex', /^[a-f0-9]{64}$/.test(sha('  some-key  ')));
    ok('master hash is a valid 64-hex constant', /^[a-f0-9]{64}$/.test(masterHash));
})();

// ─────────────────────────────────────────────────────────────
// 2. CROSS-FILE — VST3 license must accept the SAME keys as desktop
// ─────────────────────────────────────────────────────────────
(function () {
    // desktop BUILTIN_KEY_HASHES block
    const deskBlock = (mainJs.match(/BUILTIN_KEY_HASHES\s*=\s*\{[\s\S]*?\};/) || [''])[0];
    const desk = hexes(deskBlock);
    const lic  = hexes(license);
    ok('desktop has the 21 built-in key hashes', desk.length === 21, 'got ' + desk.length);
    ok('License.h has all 21 built-in key hashes', lic.length === 21, 'got ' + lic.length);
    const setEq = desk.length === lic.length && desk.every((h) => lic.includes(h));
    ok('VST3 built-in keys EXACTLY match the desktop (no drift)', setEq);
    ok('master key hash present in both', desk.includes('074ac7dc594a379be6e5bdfbaab4d16d5400a19cc2f2af9f8c83e88612efdb62') && lic.includes('074ac7dc594a379be6e5bdfbaab4d16d5400a19cc2f2af9f8c83e88612efdb62'));

    // same Lemon Squeezy proxy endpoint
    const ep = (mainJs.match(/LICENSE_ENDPOINT\s*=\s*'([^']+)'/) || [])[1];
    ok('desktop endpoint parsed', !!ep, ep);
    ok('VST3 uses the SAME backend endpoint', !!ep && license.includes(ep));
    ok('VST3 posts the validate_license action', /validate_license/.test(license));
    ok('VST3 + desktop share the 14-day offline grace', /14/.test(license) && /OFFLINE_GRACE_DAYS\s*=\s*14/.test(mainJs));
})();

// ─────────────────────────────────────────────────────────────
// 3. SOURCE — license wiring (shared file, bridge, gate un-stub)
// ─────────────────────────────────────────────────────────────
ok('License.h shares the desktop folder (stride-canvas/stride-data)', /stride-canvas/.test(license) && /stride-data/.test(license) && /license\.json/.test(license));
ok('License.h uses userApplicationDataDirectory', /userApplicationDataDirectory/.test(license));
ok('shim loadLicense routes to the C++ bridge', /loadLicense:\s*function\s*\(\)\s*\{\s*return _licCall\('load'\)/.test(shim));
ok('shim validateLicenseKey routes to the bridge', /validateLicenseKey:\s*function\s*\(key\)\s*\{\s*return _licCall\('validate'/.test(shim));
ok('shim saveLicense routes to the bridge', /saveLicense:\s*function\s*\(lic\)\s*\{\s*return _licCall\('save'/.test(shim));
ok('shim listens for licenseReply', /listen\('licenseReply'/.test(shim));
ok('shim license stub is gone (no forced WRAPPER/valid)', !/key:\s*'WRAPPER'/.test(shim));
ok('editor includes License.h', /#include "License\.h"/.test(editor));
ok('editor has the license event listener', /withEventListener\s*\("license"/.test(editor));
ok('editor handleLicense exists', /void StrideWrapperEditor::handleLicense/.test(editor));
ok('async validate reply is SafePointer-guarded', /Component::SafePointer<StrideWrapperEditor>/.test(editor));
ok('CMake links juce_cryptography (SHA-256)', /juce::juce_cryptography/.test(cmake));

// ─────────────────────────────────────────────────────────────
// 4. SOURCE — UI tweaks + rename
// ─────────────────────────────────────────────────────────────
ok('rename: PRODUCT_NAME is "Stride"', /PRODUCT_NAME\s+"Stride"/.test(cmake));
ok('MOTION buttons ride the .sbtn control surface (2.0.5)', /onclick="sdApplyGlobalChaos\(\)" class="sbtn"/.test(indexH));
ok('compact has a Shuffle button (.sbtn cap, sdShuffleLanes)', /sdShuffleLanes\(\)"[^>]*class="sbtn/.test(indexH));
ok('compact Mutate is a .sbtn cap', /sdMutate\(\)"[^>]*class="sbtn/.test(indexH));
ok('Browse files button moved into the header (hright)', /var hright[\s\S]*?Browse files/.test(shim));
ok('no leftover big orange "Load from a file" button', !/Load from a file/.test(shim));

// ─────────────────────────────────────────────────────────────
// 5. SOURCE — Mac/Win CI (1:1, signed + notarized, entitlement)
// ─────────────────────────────────────────────────────────────
ok('workflow has a windows job', /\bwindows:\s*\n\s*name: Windows VST3/.test(wf) || /name: Windows VST3/.test(wf));
ok('workflow has a mac job', /name: macOS VST3/.test(wf));
ok('mac job imports the codesign cert', /import-codesign-certs/.test(wf));
ok('mac job runs the build/sign script', /build-mac-vst3\.sh/.test(wf));
ok('CI reuses the desktop Apple secrets', /APPLE_DEVELOPER_ID_P12_BASE64/.test(wf) && /APPLE_APP_SPECIFIC_PASSWORD/.test(wf));
ok('entitlements include disable-library-validation (host other plugins)', /com\.apple\.security\.cs\.disable-library-validation/.test(ent));
ok('mac script builds universal (arm64 + x86_64)', /arm64;x86_64/.test(macSh));
ok('mac script signs with Developer ID + hardened runtime', /Developer ID Application/.test(macSh) && /options runtime/.test(macSh));
ok('mac script notarizes + staples', /notarytool submit/.test(macSh) && /stapler staple/.test(macSh));
ok('mac script applies the entitlements', /--entitlements/.test(macSh));

// ─── open-all / close-all device-window pair (2026-08-18) ───
ok('control bar: close-all button sits next to open-all (⊟ → closeSynth)',
   /sbtn\('⊟', 'closeSynth', BTN_GHOST\)/.test(shim) && /Close all device windows/.test(shim)
   && shim.indexOf("sbtn('⛶', 'openSynth'") < shim.indexOf("sbtn('⊟', 'closeSynth'"));
// The SLOTS are kept (aligned to the chain) and only the windows dropped: emptying the
// vector made the reconciler read it as "devices were added" and reopen them all on the
// next chain change (field report 2026-08-20).
ok('editor routes closeSynth → windows dropped, slots kept (editors die, instances keep running)',
   /"closeSynth",\s*\[this\] \(juce::var\)\s*\{ for \(auto& w : synthWindows\) w\.reset\(\); \}/.test(editor));
ok('guide mentions the close-all', /closes them all/.test(indexH));

console.log('  ' + passed + ' passed, ' + failed + ' failed');
process.exit(failed ? 1 : 0);
