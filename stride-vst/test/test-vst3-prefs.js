/**
 * test-vst3-prefs.js
 *
 * Covers the favorites-durability batch (1.1.3) on the Stride wrapper. Field
 * incident 2026-07-16: a Chromium localStorage profile reset (unclean WebView
 * teardown on device delete, profile living in %TEMP%) wiped a user's favorites.
 * User data must survive anything:
 *   - native SOURCE OF TRUTH: stride-data/wrapper-prefs.json — every favorites
 *     change writes through ('prefsSave'); boot pushes it back ('prefsState')
 *   - boot sync: native wins when non-empty; a non-empty local cache seeds a
 *     missing native file (the one-time rescue direction)
 *   - the WebView2 profile moves OUT of %TEMP% into stride-data/webview2, with
 *     a one-time migration copy of the legacy temp profile
 *
 * Two layers: behavioral replicas of the sync/migration decisions + source
 * assertions on the real files.
 */
'use strict';
const fs = require('fs');
const path = require('path');

let passed = 0, failed = 0;
function ok(name, cond, extra) {
    if (cond) { passed++; }
    else { failed++; console.log('  ✗ ' + name + (extra ? '  — ' + extra : '')); }
}
console.log('test-vst3-prefs.js');

const W      = path.join(__dirname, '..', '..', 'stride-wrapper', 'm0-spike');
const rd     = (p) => fs.readFileSync(p, 'utf8');
const editor = rd(path.join(W, 'src', 'PluginEditor.cpp'));
const edH    = rd(path.join(W, 'src', 'PluginEditor.h'));
const shim   = rd(path.join(W, 'ui', 'shim.js'));
const cmake  = rd(path.join(W, 'CMakeLists.txt'));

// ─────────────────────────────────────────────────────────────
// 1. BEHAVIORAL — sync + migration decision replicas
// ─────────────────────────────────────────────────────────────

// boot sync (mirrors the shim 'prefsState' handler)
(function () {
    function boot(nativeFavs, localFavs) {
        const out = { adopted: null, seeded: null, local: localFavs.slice() };
        if (nativeFavs.length) { out.local = nativeFavs.slice(); out.adopted = nativeFavs; }
        else if (localFavs.length) out.seeded = localFavs;
        return out;
    }
    const both = boot([{ n: 'Serum' }], [{ n: 'Old' }]);
    ok('native non-empty -> native wins (survives profile resets)', both.adopted && both.local[0].n === 'Serum');
    const rescue = boot([], [{ n: 'Cached' }]);
    ok('native missing + cache alive -> cache seeds the native file', rescue.seeded && rescue.seeded[0].n === 'Cached' && !rescue.adopted);
    const fresh = boot([], []);
    ok('both empty -> no writes at all', !fresh.adopted && !fresh.seeded);
})();

// write-through (mirrors favSet): every change hits BOTH stores
(function () {
    let ls = null, native = null;
    const favSet = (v) => { ls = v; native = { favorites: v }; };
    favSet([{ name: 'Diva', path: 'C:/VST3/Diva.vst3' }]);
    ok('favSet writes the cache AND the native file', ls && native && native.favorites[0].name === 'Diva');
    favSet([]);
    ok('deleting the last favorite persists the empty list too', ls.length === 0 && native.favorites.length === 0);
})();

// profile migration (mirrors the ctor): copy legacy temp profile ONCE; a partial
// copy is discarded and the session falls back to the legacy profile (retry later)
(function () {
    const migrate = (newExists, legacyExists, copyOk) => {
        if (newExists || !legacyExists) return { action: 'skip', profile: newExists ? 'new' : 'fresh' };
        if (copyOk) return { action: 'copy', profile: 'new' };
        return { action: 'discard+fallback', profile: 'legacy' };   // half a profile reads as corruption
    };
    ok('fresh machine, old temp profile present -> migrate', migrate(false, true, true).action === 'copy');
    ok('already migrated -> never copy again (no clobber)', migrate(true, true, true).action === 'skip');
    ok('fresh machine, no legacy -> plain create', migrate(false, false, true).action === 'skip');
    const fail = migrate(false, true, false);
    ok('partial copy -> discarded, session runs on the LEGACY profile (old behavior, favorites intact)', fail.action === 'discard+fallback' && fail.profile === 'legacy');
    ok('failed migration retries next open (target stays absent)', migrate(false, true, true).action === 'copy');
})();

// ─────────────────────────────────────────────────────────────
// 2. SOURCE — the wiring exists
// ─────────────────────────────────────────────────────────────
ok('native prefs file lives beside the license', /strideWrapperPrefsFile[\s\S]{0,200}wrapper-prefs\.json/.test(editor));
ok('editor pushes prefs to the page on boot (before connected)', /pushPrefs\(\); web->emitEventIfBrowserIsVisible \("sl_event"/.test(editor));
ok('editor handles the write-through save', /"prefsSave",\s+\[this\] \(juce::var v\)\s+\{ savePrefs/.test(editor));
ok('pushPrefs emits prefsState with the file contents', /void StrideWrapperEditor::pushPrefs\(\)[\s\S]{0,500}"prefsState"/.test(editor));
ok('savePrefs writes the whole object through', /void StrideWrapperEditor::savePrefs[\s\S]{0,400}replaceWithText \(juce::JSON::toString \(prefs\)\)/.test(editor));
ok('header declares the prefs pair', /void pushPrefs\(\);/.test(edH) && /void savePrefs \(const juce::var& prefs\);/.test(edH));

ok('WebView2 profile moved OUT of %TEMP% into stride-data', /stride_license::dataDir\(\)\.getChildFile \("webview2"\)/.test(editor));
ok('one-time legacy profile migration (no clobber)', /! userData\.exists\(\) && legacy\.isDirectory\(\)[\s\S]{0,120}copyDirectoryTo \(userData\)/.test(editor));
ok('partial migration discarded + legacy fallback (half a profile reads as corruption)', /userData\.deleteRecursively\(\);[\s\S]{0,80}userData = legacy;/.test(editor));
ok('legacy path still named for the migration source', /StrideWrapperWebView2/.test(editor));

ok('shim: favSet writes through to the native file', /function favSet\(v\) \{ lsSet\('stride_fav_synths', v\); emit\('prefsSave', \{ prefs: \{ favorites: v \} \}\); \}/.test(shim));
ok('shim: boot adopts native favorites when present', /listen\('prefsState'[\s\S]{0,400}lsSet\('stride_fav_synths', nat\); populateFav\(\);/.test(shim));
ok('shim: rescue direction — cache seeds a missing native file', /else \{ var loc = lsGet\('stride_fav_synths', \[\]\); if \(loc\.length\) emit\('prefsSave'/.test(shim));

// version: ships as 1.1.3+
(function () {
    const m = cmake.match(/project\(StrideWrapperM0 VERSION (\d+)\.(\d+)\.(\d+)/);
    ok('CMake VERSION parses', !!m);
    if (m) ok('VERSION >= 1.1.3', +m[1] > 1 || (+m[1] === 1 && (+m[2] > 1 || (+m[2] === 1 && +m[3] >= 3))));
})();

console.log('  ' + passed + ' passed, ' + failed + ' failed');
process.exit(failed ? 1 : 0);
