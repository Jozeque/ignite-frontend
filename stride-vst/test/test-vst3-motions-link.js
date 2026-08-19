/**
 * test-vst3-motions-link.js
 *
 * Covers the 1.4.0 pair (docs/stride-motions-library-spec.md):
 *
 * MOTIONS — save lane curves with one click (auto-named, no modal), browse them
 * in the right-side drawer (hover = ghost preview, click = load), pin favorites
 * into the toolbar. Durability is the favorites pattern: localStorage is only a
 * cache; writes go through wrapper-prefs.json (shim sdMotionsPersist), and the
 * old localStorage presets migrate in once. The C++ savePrefs is a WHOLE-OBJECT
 * replace, so the shim must send a MERGED prefs object on every write — a
 * favorites-only payload would wipe the motions and vice versa.
 *
 * LINK — lanes wired port-to-port share ONE curve ("one curve shown twice").
 * Mirroring lives in _sdLinkSyncPass inside saveCanvasState (the choke point
 * every curve write passes through), so tools / sliders / drawing / loads all
 * mirror without per-site instrumentation. Membership is ENGINE-OWNED (the
 * lock-leak lesson): set_link/set_links in, linkGroup/linkInv echoed in
 * rack_scanned, "lg"/"li" persisted in project state v8.
 */
'use strict';
const fs = require('fs');
const path = require('path');

let passed = 0, failed = 0;
function ok(name, cond, extra) {
    if (cond) { passed++; }
    else { failed++; console.log('  ✗ ' + name + (extra ? '  — ' + extra : '')); }
}
console.log('test-vst3-motions-link.js');

const root   = path.join(__dirname, '..', '..');
const W      = path.join(root, 'stride-wrapper', 'm0-spike');
const rd     = (p) => fs.readFileSync(p, 'utf8');
const procC  = rd(path.join(W, 'src', 'PluginProcessor.cpp'));
const procH  = rd(path.join(W, 'src', 'PluginProcessor.h'));
const editor = rd(path.join(W, 'src', 'PluginEditor.cpp'));
const shim   = rd(path.join(W, 'ui', 'shim.js'));
const indexH = rd(path.join(W, 'ui', 'index.html'));
const canvas = rd(path.join(root, 'stride-vst', 'app', 'renderer', 'canvas.js'));
const deskH  = rd(path.join(root, 'stride-vst', 'app', 'renderer', 'index.html'));
const cmake  = rd(path.join(W, 'CMakeLists.txt'));

// ─────────────────────────────────────────────────────────────
// 1. ENGINE — link groups owned/persisted/echoed (the lock pattern)
// ─────────────────────────────────────────────────────────────
ok('MapRef carries linkGroup (0 = unlinked) + linkInv', /int  linkGroup = 0;/.test(procH) && /bool linkInv = false;/.test(procH));
ok('setMappedLink clamps + marks dirty, no mapVersion bump',
   /void StrideWrapperProcessor::setMappedLink \(int pos, int group, bool inv\)[\s\S]{0,400}jmax \(0, group\);[\s\S]{0,200}hostDirtyPending\.store \(true\)/.test(procC)
   && !/setMappedLink \(int pos[\s\S]{0,500}mapVersion\.fetch_add/.test(procC));
ok('setMappedLinks batches {id,g,inv} under ONE lock pass', /void StrideWrapperProcessor::setMappedLinks[\s\S]{0,600}getProperty \("g", 0\)[\s\S]{0,200}getProperty \("inv", false\)/.test(procC));
ok('getMappedLinks returns {g,inv} per mapped param', /juce::Array<juce::var> StrideWrapperProcessor::getMappedLinks\(\) const/.test(procC));
// v9 (card order) landed on top; what this guards is that the LINK attrs still ship and
// the version kept moving forward, not the specific number.
ok('project state is past v8 and still writes the link attrs',
   /root\.setAttribute \("version", (9|[1-9]\d)\)/.test(procC) &&
   /setAttribute \("lg", m\.linkGroup\)/.test(procC));
ok('state writes "lg" only when linked, "li" only when inverted (old builds ignore both)',
   /if \(m\.linkGroup > 0\)[\s\S]{0,200}setAttribute \("lg", m\.linkGroup\);[\s\S]{0,200}if \(m\.linkInv\) e->setAttribute \("li", 1\)/.test(procC));
ok('project reopen parses "lg"/"li" (0/off for older projects)',
   /lnk\.push_back \(e->getIntAttribute \("lg", 0\)\)/.test(procC) && /lin\.push_back \(\(char\) \(e->getIntAttribute \("li", 0\) != 0 \? 1 : 0\)\)/.test(procC));
ok('snapshot Dev struct carries the parallel link vectors', /std::vector<int> lnk;/.test(procH) && /std::vector<char> lin;/.test(procH));
ok('remove/clear snapshots capture links; DUPLICATE deliberately does not (copies leave the group)',
   (procC.match(/d\.lnk\.push_back \(m\.linkGroup\); d\.lin\.push_back \(m\.linkInv \? 1 : 0\);/g) || []).length === 2);
ok('restore rebuilds mapped entries WITH links (missing vectors = unlinked, old snapshots safe)',
   /k < d\.lnk\.size\(\) \? d\.lnk\[k\] : 0,[\s\S]{0,100}k < d\.lin\.size\(\) && d\.lin\[k\] != 0/.test(procC));
ok('editor routes set_link + set_links, both edit-lock gated',
   /type == "set_link"[\s\S]{0,300}setMappedLink \(/.test(editor) && /type == "set_links"[\s\S]{0,300}setMappedLinks \(/.test(editor)
   && /type == "set_link"[\s\S]{0,80}isEditLocked\(\)/.test(editor));
ok('rack_scanned echoes linkGroup + linkInv (canvas rebuilds chips + mirroring from THIS)',
   /getMappedLinks\(\);/.test(editor) && /setProperty \("linkGroup", links\[i\]\.getProperty \("g", 0\)\)/.test(editor)
   && /setProperty \("linkInv", true\)/.test(editor));

// ─────────────────────────────────────────────────────────────
// 2. SHIM — merged prefs writer + motions durability
// ─────────────────────────────────────────────────────────────
ok('prefsWrite sends the FULL merged object (whole-object replace on the C++ side)',
   /function prefsWrite\(key, val\) \{ _natPrefs\[key\] = val; emit\('prefsSave', \{ prefs: _natPrefs \}\); \}/.test(shim));
ok('sdMotionsPersist: cache + file writes ISOLATED (a cache throw must never kill the file write)',
   /window\.sdMotionsPersist = function[\s\S]{0,200}try \{ lsSet\('sd_motions', list \|\| \[\]\); \} catch[\s\S]{0,60}try \{ prefsWrite\('motions', list \|\| \[\]\); \} catch/.test(shim));
ok('boot adopts native motions / rescues the cache, then notifies the canvas',
   /var natM = _natPrefs\.motions \|\| \[\];/.test(shim) && /sd-motions-adopted/.test(shim));

// ─────────────────────────────────────────────────────────────
// 3. CANVAS — link engine (mirror at the choke point)
// ─────────────────────────────────────────────────────────────
ok('rack echo lands on the lanes (linkGroup/linkInv fields)', /linkGroup: \(typeof p\.linkGroup === 'number' && p\.linkGroup > 0 \? p\.linkGroup : 0\)/.test(canvas) && /linkInv: !!p\.linkInv/.test(canvas));
ok('rebuild hook normalizes groups + rebases the mirror shadows', /_sdLinkAfterRebuild\(\)/.test(canvas) && /function _sdLinkAfterRebuild\(\)[\s\S]{0,200}_sdLinkNormalize\(\);[\s\S]{0,80}_sdLinkShadowRebase\(\);/.test(canvas));
ok('links ride the undo snapshots (undoing a link-create actually unlinks)',
   /linkGroup: \(typeof p\.linkGroup === 'number' \? p\.linkGroup : 0\)/.test(canvas) && /linkInv: !!p\.linkInv/.test(canvas)
   && /typeof sp\.linkGroup === 'number'/.test(canvas));
ok('sync pass runs at the TOP of saveCanvasState (before the state/live_curves flush)',
   /async function saveCanvasState\(\) \{[\s\S]{0,700}_sdLinkSyncPass\(\);/.test(canvas));
ok('sync pass: first contact = baseline only (never a false mirror on boot)',
   /members\.some\(m => !\(m\.envelopeId in _sdLinkShadow\)\)/.test(canvas));
ok('sync pass: the ACTIVE lane wins as source among changed members',
   /dirty\.find\(m => m\.envelopeId === sdActiveParamId\) \|\| dirty\[0\]/.test(canvas));
ok('sync pass: locked members are frozen (receive nothing)', /if \(m === src \|\| m\.locked\) return;/.test(canvas));
ok('inverted members receive the flipped shape (1 - v, curve negated)',
   /function _sdInvPts\(pts\)[\s\S]{0,160}value: 1 - pt\.value, curve: -\(pt\.curve \|\| 0\)/.test(canvas));
ok('link create: source wins, target adopts (one undo step)',
   /function _sdCreateLink\(fromId, toId\)[\s\S]{0,600}pushUndo\(\);[\s\S]{0,900}_sdLinkAdoptFrom\(a\);/.test(canvas));
ok('group merge: linking two linked lanes absorbs the whole second group',
   /const old = b\.linkGroup;[\s\S]{0,120}if \(p\.linkGroup === old\) p\.linkGroup = g;/.test(canvas));
ok('groups of one dissolve (unmap / rebuild can never strand a group)',
   /counts\[p\.linkGroup\] < 2\) \{ p\.linkGroup = 0; p\.linkInv = false;/.test(canvas));
ok('membership pushes batched (set_links), engine-position keyed', /type: 'set_links', items: items/.test(canvas));
ok('unlock re-syncs a stale member to the group curve', /function _sdLinkResyncAfterUnlock\(p\)/.test(canvas) && /_sdLinkResyncAfterUnlock\(b\.p\)/.test(canvas));
ok('cables are ON DEMAND: drag, chip hover, ~1.2s flash after a link lands',
   /_sdCableShow\[g\] = Date\.now\(\) \+ 1200;/.test(canvas) && /if \(_sdHoverChipGroup\) show\[_sdHoverChipGroup\] = 1;/.test(canvas));
ok('port sits bottom-left (clears the color bar + range fields), rows under 34px hide it',
   /rect\.height >= 34/.test(canvas) && /const _pcx = 18, _pcy = rect\.bottom - 10;/.test(canvas));
ok('link rects rebuilt every multi draw (the unmap-× pattern)',
   /_sdPortRects = \[\];/.test(canvas) && /_sdChipRects = \[\];/.test(canvas) && /_sdBookRects = \[\];/.test(canvas));
ok('chip right-click opens the link menu BEFORE the color popup', /_sdOpenLinkMenu\(_c\.envelopeId, e\.clientX, e\.clientY\);[\s\S]{0,300}_sdOpenColorPopup/.test(canvas));
ok('Alt+click a chip = quick unlink; Shift+drag extends the group', /if \(e\.altKey\) \{ _sdUnlinkLane\(_c2\.envelopeId\); \}[\s\S]{0,200}else if \(e\.shiftKey\) \{ _sdLinkDragStart/.test(canvas));
ok('Esc cancels a cable drag before it closes the drawer', /if \(_sdLinkDrag\) \{ _sdLinkDragCancel\(\); return; \}[\s\S]{0,120}sdToggleMotions/.test(canvas));

// Behavioral: the invert transform is a pure involution (extract + run the real code).
(function () {
    const m = canvas.match(/function _sdInvPts\(pts\) \{[^\n]*\n?[^\n]*\}/);
    const src = m && m[0];
    ok('extracted _sdInvPts', !!src);
    if (!src) return;
    let inv;
    try { inv = new Function(src + '; return _sdInvPts;')(); } catch (e) { ok('_sdInvPts evaluates', false, e.message); return; }
    const pts = [{ time: 0, value: 0.2, curve: 0.5 }, { time: 2, value: 1, curve: -0.25 }, { time: 4, value: 0.5, curve: 0 }];
    const twice = inv(inv(pts));
    const same = twice.every((p, i) => Math.abs(p.value - pts[i].value) < 1e-9 && Math.abs((p.curve || 0) - (pts[i].curve || 0)) < 1e-9 && p.time === pts[i].time);
    ok('invert twice = identity (values + curves + times)', same);
    ok('invert flips around the midline', Math.abs(inv(pts)[0].value - 0.8) < 1e-9);
})();

// ─────────────────────────────────────────────────────────────
// 4. CANVAS — motions library
// ─────────────────────────────────────────────────────────────
ok('store key + one-time migration of the old localStorage presets',
   /const SD_MOTIONS_KEY = 'sd_motions';/.test(canvas) && /SD_MOTIONS_KEY \+ '_migrated'/.test(canvas)
   && /_sdMotionsMigrate[\s\S]{0,400}PRESET_STORAGE_KEY/.test(canvas));
ok('reads and writes go through the in-memory library FIRST (localStorage is a warm cache that can lose flushes)',
   /_sdMotionsMem = Array\.isArray\(list\) \? list : \[\];   \/\/ memory FIRST/.test(canvas)
   && /if \(_sdMotionsMem\) return _sdMotionsMem;/.test(canvas));
ok('every commit writes through to the native prefs (sdMotionsPersist)', /window\.sdMotionsPersist\) window\.sdMotionsPersist\(_sdMotionsMem\)/.test(canvas));
ok('boot adopt REPLACES the in-memory library with the file data from the event detail',
   /ev\.detail\.motions\) \? ev\.detail\.motions : null;/.test(canvas) && /if \(adopted && adopted\.length\) _sdMotionsMem = adopted;/.test(canvas));
ok('save is instant + auto-named (Param · Device), points stored normalized',
   /src\[0\]\.name \+ \(src\[0\]\.device \? ' · ' \+ src\[0\]\.device : ''\)/.test(canvas)
   && /t: totalBeats > 0 \? pt\.time \/ totalBeats : 0/.test(canvas));
ok('toolbar Save is scope-smart: selection first, else the active lane',
   /window\.sdSaveMotionSmart = function[\s\S]{0,300}p\.selected\);[\s\S]{0,260}sdActiveParamId/.test(canvas));
ok('the on-lane bookmark saves THAT lane', /window\.sdSaveMotionLane = function/.test(canvas));
ok('toast offers Rename + Undo (no naming modal anywhere in the flow)',
   /_sdMotionToast\('Saved to Motions · '/.test(canvas) && /_sdMotionRenameInline\(savedId\)/.test(canvas));
ok('apply is undoable and flushes through saveCanvasState (mirrors linked targets)',
   /function sdApplyMotion\(id, targetEnvelopeId\)[\s\S]{0,400}pushUndo\(\);[\s\S]{0,3000}saveCanvasState\(\)/.test(canvas));
ok('multi-lane apply matches by param + device name first, remaining in order',
   /norm\(p\.name\) === norm\(l\.name\) && norm\(p\.device\) === norm\(l\.device\)/.test(canvas));
ok('locked lanes are never written by a motion load', /targets\.forEach\(t => \{ if \(!t\.locked\)/.test(canvas));
ok('ghost preview: ~140ms hover intent, multi view, cleared on leave/apply',
   /_sdGhostTimer = setTimeout\([\s\S]{0,700}, 140\)/.test(canvas) && /function _sdMotionGhostClear\(\)/.test(canvas));
ok('card drag targets a specific lane (drop applies to the lane under the cursor)',
   /cont\.addEventListener\('drop'/.test(canvas) && /sdApplyMotion\(id, row\.param\.envelopeId\)/.test(canvas));
ok('factory tab reuses the bank presets + previews (no second content system)',
   /_presetPreviewSVG\(p\)/.test(canvas) && /sdApplyBankPreset\(pid\)/.test(canvas));
ok('pinned strip renders hearted motions (cap 6) into both toolbars',
   /\.filter\(m => m\.fav\)\.slice\(0, 6\)/.test(canvas) && /sd-pinned-motions-c/.test(canvas));
ok('drawer + module fully wrapper-gated (desktop renders byte-identically)',
   /function _sdIsWrapMotions\(\) \{ return !!\(window\.strideLink && window\.strideLink\._wrapper\); \}/.test(canvas)
   && /if \(!_sdIsWrapMotions\(\)\) return false;/.test(canvas));

// ─────────────────────────────────────────────────────────────
// 5. WRAPPER UI — entry points in BOTH toolbars (compact is the default)
// ─────────────────────────────────────────────────────────────
ok('ROW 0 center: Motions replaces the rose Presets button', /sdToggleMotions/.test(indexH) && !/sdTogglePresets\(\)" title="Preset bank"/.test(indexH));
ok('ROW 1: Save ▾ (instant, scope menu) + Pinned strip replace Save Lane + Saved chips',
   /sdSaveMotionSmart/.test(indexH) && /sdOpenSaveScopeMenu/.test(indexH) && /id="sd-pinned-motions"/.test(indexH)
   && !/id="user-presets-bar"/.test(indexH) && !/sdSavePreset\(\)/.test(indexH));
ok('COMPACT toolbar carries Save + Motions + pinned too (the wrapper boots into compact)',
   /id="sd-motions-btn-c"/.test(indexH) && /id="sd-pinned-motions-c"/.test(indexH));
ok('drawer shell present (tabs Mine/Factory, search, fav filter, grid, + Save current)',
   /id="sd-motions-drawer"/.test(indexH) && /id="sd-motions-tab-factory"/.test(indexH)
   && /id="sd-motions-search"/.test(indexH) && /id="sd-motions-grid"/.test(indexH));
ok('toast shell present (Rename / Undo)', /id="sd-motion-toast-rename"/.test(indexH) && /id="sd-motion-toast-undo"/.test(indexH));
ok('desktop UI untouched (keeps its Save Lane / preset strip; no drawer)',
   /user-presets-bar/.test(deskH) && !/sd-motions-drawer/.test(deskH));

// version: ships as 1.4.0+
(function () {
    const m = cmake.match(/project\(StrideWrapperM0 VERSION (\d+)\.(\d+)\.(\d+)/);
    ok('CMake VERSION parses', !!m);
    if (m) ok('VERSION >= 1.4.0', +m[1] > 1 || (+m[1] === 1 && +m[2] >= 4));
})();

console.log('  ' + passed + ' passed, ' + failed + ' failed');
process.exit(failed ? 1 : 0);
