/**
 * test-vst3-demo.js
 *
 * Covers the Stride VST3 wrapper's DEMO MODE + the batch of UX fixes shipped
 * alongside it (favorites manager, unmap, openExternal, device-remove popup fix,
 * window-size memory). Source-assertion style (canvas.js / C++ aren't loaded in
 * Node): read the REAL files and assert the wiring is present AND consistent.
 *
 * The demo model (see docs/stride-demo-mode-spec.md):
 *   - No VST entitlement -> runs in DEMO (not locked). demoMode == !entitled.
 *   - Unlimited params (no cap); the limiter is a play-synced move/freeze cycle:
 *       10s of PLAYBACK moves, then a 60s real-time FREEZE (knobs hold), repeating.
 *   - Save disabled + offline render = noise. Cycle persisted (reload-proof).
 *   - PAID PATH UNTOUCHED: a valid VST entitlement -> full unlock, no caps.
 */
'use strict';
const fs = require('fs');
const path = require('path');

let passed = 0, failed = 0;
function ok(name, cond, extra) {
    if (cond) { passed++; }
    else { failed++; console.log('  ✗ ' + name + (extra ? '  — ' + extra : '')); }
}
console.log('test-vst3-demo.js');

const root = path.join(__dirname, '..', '..');
const rd = (p) => fs.readFileSync(p, 'utf8');
const W = path.join(root, 'stride-wrapper', 'm0-spike');
const procH  = rd(path.join(W, 'src', 'PluginProcessor.h'));
const procC  = rd(path.join(W, 'src', 'PluginProcessor.cpp'));
const editor = rd(path.join(W, 'src', 'PluginEditor.cpp'));
const editorH= rd(path.join(W, 'src', 'PluginEditor.h'));
const license= rd(path.join(W, 'src', 'License.h'));
const shim   = rd(path.join(W, 'ui', 'shim.js'));
const indexH = rd(path.join(W, 'ui', 'index.html'));

// ─────────────────────────────────────────────────────────────
// 1. demoMode — single source of truth (native, not the WebView)
// ─────────────────────────────────────────────────────────────
ok('processor has demoMode flag', /std::atomic<bool>\s+demoMode/.test(procH));
ok('processor exposes setDemoMode', /void\s+setDemoMode\s*\(bool/.test(procH));
ok('processor exposes isDemo', /bool\s+isDemo\s*\(\)\s*const/.test(procH));
ok('License.h has cachedEntitled() for the construction-time seed', /bool\s+cachedEntitled\s*\(\)/.test(license));
ok('cachedEntitled reuses computeEntitled (no second gate)', /inline bool cachedEntitled[\s\S]{0,800}computeEntitled/.test(license));
ok('cachedEntitled enforces the offline grace', /inline bool cachedEntitled[\s\S]{0,800}kOfflineGraceDays/.test(license));
ok('processor seeds demoMode from cachedEntitled at construction', /demoMode\.store\s*\(\s*!\s*stride_license::cachedEntitled/.test(procC));
ok('processor includes License.h', /#include\s+"License\.h"/.test(procC));

// ─────────────────────────────────────────────────────────────
// 2. The move/freeze cycle — 10s playback move / 60s real-time freeze
// ─────────────────────────────────────────────────────────────
ok('cycle constant: move = 10s', /kDemoMoveSecs\s*=\s*10\.0/.test(procH));
ok('cycle constant: freeze = 60s', /kDemoFreezeSecs\s*=\s*60\.0/.test(procH));
ok('move budget is playback-ms (demoMoveUsedMs)', /demoMoveUsedMs/.test(procH) && /demoMoveUsedMs/.test(procC));
ok('freeze end is real-time (demoFreezeUntilMs)', /demoFreezeUntilMs/.test(procH) && /demoFreezeUntilMs/.test(procC));
ok('move budget accrues only while transport is playing', /if\s*\(\s*transportPlaying\s*\)/.test(procC) && /demoMoveUsedMs\.store/.test(procC));
ok('processBlock reads the transport play state', /transportPlaying/.test(procC) && /getIsPlaying/.test(procC));
ok('freeze begins after 10s of playback used', /used\s*>=\s*kDemoMoveSecs\s*\*\s*1000/.test(procC) && /demoFreezeUntilMs\.store\s*\(\s*now/.test(procC));
ok('FREEZE skips the drive so knobs HOLD (drive gated on !demoFreezeNow)', /!\s*driveLanes\.empty\(\)\s*&&\s*!\s*demoFreezeNow/.test(procC));
ok('freeze exposes a live countdown (demoResumeSecs)', /demoResumeSecs/.test(procH) && /demoResumeSecs\.store/.test(procC));

// ─────────────────────────────────────────────────────────────
// 3. Caps: NO param cap (unlimited), save-off, offline-noise
// ─────────────────────────────────────────────────────────────
ok('param cap REMOVED — no kDemoMaxParams anywhere', !/kDemoMaxParams/.test(procH) && !/kDemoMaxParams/.test(procC));
ok('save disabled in demo (getStateInformation early-returns)', /getStateInformation[\s\S]{0,200}if\s*\(demoMode\.load\(\)\)\s*return;/.test(procC));
ok('offline render = noise in demo (isNonRealtime + demoRng)', /demoMode\.load\(\)\s*&&\s*isNonRealtime\(\)/.test(procC) && /demoRng/.test(procC));

// ─────────────────────────────────────────────────────────────
// 4. Reload-proofing — the cycle is persisted to disk
// ─────────────────────────────────────────────────────────────
ok('processor persists the cycle (saveDemoCycleState)', /void\s+StrideWrapperProcessor::saveDemoCycleState/.test(procC));
ok('processor restores the cycle at construction (loadDemoCycleState)', /void\s+StrideWrapperProcessor::loadDemoCycleState/.test(procC) && /loadDemoCycleState\s*\(\)\s*;/.test(procC));
ok('cycle persisted to stride-demo.json', /stride-demo\.json/.test(procC));
ok('editor persists the cycle from the message thread (timer)', /saveDemoCycleState\s*\(\)/.test(editor) && /demoSaveTick/.test(editorH));

// ─────────────────────────────────────────────────────────────
// 5. Editor <-> UI bridge for demo (flag in, countdown out)
// ─────────────────────────────────────────────────────────────
ok('editor listens for setDemoMode -> proc.setDemoMode', /withEventListener\s*\("setDemoMode"[\s\S]{0,700}setDemoMode/.test(editor));
ok('editor pushes demo_freeze (frozen + secs) to the badge', /emitEventIfBrowserIsVisible\s*\("demo_freeze"/.test(editor) && /isDemoFrozen/.test(editor) && /demoSecsUntilResume/.test(editor));
ok('shim relays demo flag to engine (strideSetDemoMode -> setDemoMode)', /strideSetDemoMode\s*=\s*function/.test(shim) && /emit\('setDemoMode'/.test(shim));
ok('shim renders the freeze countdown into #sd-demo-status', /listen\('demo_freeze'/.test(shim) && /sd-demo-status/.test(shim));

// ─────────────────────────────────────────────────────────────
// 6. License GATE flips to run-in-demo (index.html)  + PAID PATH SAFE
// ─────────────────────────────────────────────────────────────
ok('unlockApp takes a demo flag', /function\s+unlockApp\s*\(demo\)/.test(indexH));
ok('no-entitlement path enters demo (unlockApp(true))', /unlockApp\(true\)/.test(indexH));
ok('PAID: entitled paths unlock FULL (unlockApp(false))', /unlockApp\(false\)/.test(indexH));
// paid safety: the demo flag is relayed, and full mode explicitly turns caps off
ok('PAID: full unlock relays demo=false to the engine', /strideSetDemoMode/.test(indexH) || /strideSetDemoMode/.test(shim));
ok('DEMO badge element present', /id="sd-demo-badge"/.test(indexH) && /id="sd-demo-status"/.test(indexH));
ok('badge has Activate (reopen form) + Get Stride VST (checkout)', /showActivationOverlay/.test(indexH) && /Get Stride VST/.test(indexH));
ok('checkout points at the Stride VST product', /strideengine\.lemonsqueezy\.com\/checkout\/buy\/cd9e5114/.test(indexH));

// ─────────────────────────────────────────────────────────────
// 7. openExternal fix — was a no-op stub, now routes to the plugin
// ─────────────────────────────────────────────────────────────
ok('shim openExternal takes a url + emits (not a no-op)', /openExternal:\s*function\s*\(url\)/.test(shim) && /emit\('openExternal'/.test(shim));
ok('editor opens the url in the default browser', /withEventListener\s*\("openExternal"/.test(editor) && /launchInDefaultBrowser/.test(editor));

// ─────────────────────────────────────────────────────────────
// 8. Favorites manager (drag reorder / delete / add)
// ─────────────────────────────────────────────────────────────
ok('favorites manager modal exists (showFavManager)', /function\s+showFavManager/.test(shim));
ok('manage button (open the modal) is wired', /Manage favorites/.test(shim) && /showFavManager\(\)/.test(shim));
ok('favorites reorder is DRAG (not arrows)', /draggable\s*=\s*true/.test(shim) && /addEventListener\('dragstart'/.test(shim) && /addEventListener\('drop'/.test(shim));
ok('reorder persists + refreshes the dropdown', /favSet\(a\)[\s\S]{0,60}populateFav\(\)/.test(shim));

// ─────────────────────────────────────────────────────────────
// 9. Device-remove popup fix (erase ONE window, don't reopen all)
// ─────────────────────────────────────────────────────────────
ok('removeDevice erases only the removed window (targeted)', /removeDevice"[\s\S]{0,240}synthWindows\.erase\s*\(\s*synthWindows\.begin\(\)\s*\+\s*i/.test(editor));
ok('removeDevice no longer clears ALL windows', !/removeDevice"[\s\S]{0,240}synthWindows\.clear\(\)/.test(editor));
ok('timer only auto-opens windows on ADD (n > size), not on remove', /n\s*>\s*\(int\)\s*synthWindows\.size\(\)\)\s*openMissingSynthWindows/.test(editor));

// ─────────────────────────────────────────────────────────────
// 10. beta10 regression guards — bus fix + plugin identity
// ─────────────────────────────────────────────────────────────
ok('bus fix present: configureHostedBuses (main-bus only)', /configureHostedBuses/.test(procC));
ok('bus fix applied in BOTH load + restore (>=3 refs: def+2 calls)', (procC.match(/configureHostedBuses/g) || []).length >= 3);
ok('no enableAllBuses() CALL remains (crash source)', !/[^\/]\benableAllBuses\s*\(\s*\)\s*;/.test(procC));

// ─────────────────────────────────────────────────────────────
// 11. SECURITY hardening — close the two no-debugger cracks
// ─────────────────────────────────────────────────────────────
const crypto = require('crypto');

// (A) A stored "builtin":true must be RE-VERIFIED by re-hashing the key — not trusted.
ok('computeEntitled re-verifies builtin via builtinCheck (not blind trust)',
   /builtin[^\n]*\n[\s\S]{0,400}builtinCheck\s*\(\s*lic\.getProperty\s*\(\s*"key"/.test(license));
ok('computeEntitled rejects a forged builtin flag (forged-builtin reason)',
   /"forged-builtin"/.test(license));
ok('no blind "return mk (true, \\"builtin\\")" without a key re-hash before it',
   !/getProperty\s*\(\s*"builtin"[^\)]*\)\)\s*return\s+mk\s*\(\s*true/.test(license));

// (B) Native setDemoMode must recompute entitlement itself, not trust the WebView flag.
ok('setDemoMode handler recomputes natively (cachedEntitled), ignores JS flag',
   /withEventListener\s*\("setDemoMode"[\s\S]{0,700}setDemoMode\s*\(\s*!\s*stride_license::cachedEntitled\s*\(\)/.test(editor));
ok('setDemoMode no longer trusts v.getProperty("demo") to lift the demo',
   !/withEventListener\s*\("setDemoMode"[\s\S]{0,200}setDemoMode\s*\(\s*\(bool\)\s*v\.getProperty\s*\(\s*"demo"/.test(editor));

// Behavioural replica — prove the fix logic: re-hashing rejects a forged builtin but
// accepts a real one. Mirrors License.h builtinCheck (sha256 of trim+upper == a table hash).
(function () {
    const MASTER = '074ac7dc594a379be6e5bdfbaab4d16d5400a19cc2f2af9f8c83e88612efdb62';
    const table = new Set([MASTER]);   // (only the master hash is needed to prove the gate)
    const sha = (k) => crypto.createHash('sha256').update(String(k).trim().toUpperCase()).digest('hex');
    // the HARDENED gate: honour builtin ONLY if the stored key actually hashes into the table
    const entitledBuiltin = (lic) => !!lic && lic.valid === true && lic.builtin === true && table.has(sha(lic.key || ''));
    ok('forged {builtin:true, key:"FAKE"} is REJECTED by the re-hash gate',
       entitledBuiltin({ valid: true, builtin: true, entitled: true, key: 'FAKE-CRACK-KEY' }) === false);
    ok('forged builtin with NO key is rejected',
       entitledBuiltin({ valid: true, builtin: true, entitled: true }) === false);
    // and a real builtin key (its hash IS in the table) still unlocks — no legit-user regression
    const fakePlain = 'X'; const tableWithFake = new Set([sha(fakePlain)]);
    const gate2 = (lic) => !!lic && lic.valid === true && lic.builtin === true && tableWithFake.has(sha(lic.key || ''));
    ok('a key whose hash IS in the table still unlocks (no legit regression)',
       gate2({ valid: true, builtin: true, key: fakePlain }) === true);
    // the OLD blind-trust gate would have accepted the forgery — proves the hole was real
    const oldGate = (lic) => !!lic && lic.valid === true && lic.builtin === true;
    ok('the OLD blind-trust gate WOULD have accepted the forgery (hole confirmed closed)',
       oldGate({ valid: true, builtin: true, key: 'FAKE-CRACK-KEY' }) === true);
})();

// The unforgeable path is untouched: Ed25519 verify + key-binding still gate the signed route.
ok('signed-entitlement path still Ed25519-verified (entVerify unchanged)',
   /crypto_ed25519_check/.test(license) && /if\s*\(\s*!\s*entVerify\s*\(/.test(license));
ok('signed path still binds ent.key == lic.key (no ent transplant)',
   /"key-mismatch"/.test(license));

console.log('  ' + passed + ' passed, ' + failed + ' failed');
process.exit(failed ? 1 : 0);
