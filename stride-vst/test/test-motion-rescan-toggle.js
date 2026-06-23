/**
 * test-motion-rescan-toggle.js
 *
 * The StrideQuick Auto-Rescan toggle, REBUILT canvas-owned (no bridge -> no race)
 * after the 2026-06-23 revert. GREEN/ON (default) = Motion rescans-then-applies;
 * GREY/OFF = applies on the loaded params only, EXCEPT it still rescans if the
 * track/clip changed since the last scan (the _sdContextDirty safety guard) so it
 * can never apply a stale rack. The device toggle sends quick rescan_set/_toggle and
 * its color reflects via quick_state.rescan -> server quick_rescan outlet. canvas.js
 * is DOM-bound, so these are source assertions over the real files + a behavioral
 * replica of the rescan-gate logic.
 */
'use strict';
const fs = require('fs');
const path = require('path');
let passed = 0, failed = 0;
function ok(name, cond, extra) { if (cond) passed++; else { failed++; console.log('  ✗ ' + name + (extra ? '  -- ' + extra : '')); } }
console.log('test-motion-rescan-toggle.js');

const root = path.join(__dirname, '..');
const canvasSrc = fs.readFileSync(path.join(root, 'app', 'renderer', 'canvas.js'), 'utf8');
const serverSrc = fs.readFileSync(path.join(root, 'm4l', 'node', 'server.js'), 'utf8');
const htmlSrc   = fs.readFileSync(path.join(root, 'app', 'renderer', 'index.html'), 'utf8');
const typesSrc  = fs.readFileSync(path.join(root, 'shared', 'message-types.js'), 'utf8');
const maxpatPath = path.join(root, '..', 'docs', 'StrideQuick-motion-rescan.maxpat');
const maxpat    = fs.existsSync(maxpatPath) ? fs.readFileSync(maxpatPath, 'utf8') : '';   // graceful: a missing (untracked) fixture must not CRASH the whole suite

// ── 1. canvas: canvas-owned toggle, green default ──
ok('canvas: sdAutoRescan defaults ON (green)', /let sdAutoRescan = true;/.test(canvasSrc));
ok('canvas: setter + toggle + init exist', /window\.sdSetAutoRescan = function/.test(canvasSrc) && /window\.sdToggleAutoRescan = function/.test(canvasSrc) && /async function sdInitAutoRescan/.test(canvasSrc));
ok('canvas: on-screen button painter exists', /function _sdPaintAutoRescanBtn/.test(canvasSrc));
ok('canvas: handles rescan_set / rescan_toggle', /case 'rescan_set':[\s\S]*?sdSetAutoRescan\(parseInt/.test(canvasSrc) && /case 'rescan_toggle':[\s\S]*?sdSetAutoRescan\(!sdAutoRescan\)/.test(canvasSrc));
ok('canvas: quick_state reflects rescan', /rescan: sdAutoRescan \? 1 : 0/.test(canvasSrc));
ok('canvas: gate = green OR context-dirty (cannot apply a stale rack)', /_SD_GENERATORS\.indexOf\(action\) !== -1 && \(sdAutoRescan \|\| _sdContextDirty\)/.test(canvasSrc));
// the GREY safety guard only works if _sdContextDirty is SET on track/clip change and CLEARED when a scan lands
ok('canvas: track_changed sets _sdContextDirty', /on\('track_changed'[\s\S]*?_sdContextDirty = true/.test(canvasSrc));
ok('canvas: clip_focus_changed sets _sdContextDirty', /on\('clip_focus_changed'[\s\S]*?_sdContextDirty = true/.test(canvasSrc));
ok('canvas: rack_scanned clears _sdContextDirty', /on\('rack_scanned'[\s\S]*?_sdContextDirty = false/.test(canvasSrc));
ok('canvas: inject arm of the gate (rescan only when context dirty)', /action === 'inject' && _sdContextDirty/.test(canvasSrc));
// persistence: the green/grey choice survives a relaunch
ok('canvas: persist writes settings.autoRescan', /settings\.autoRescan = sdAutoRescan/.test(canvasSrc));
ok('canvas: init only overrides on a boolean (default ON preserved)', /typeof res\.settings\.autoRescan === 'boolean'/.test(canvasSrc));
// release hygiene: the device maxpat fixture must ship (untracked files break a clean checkout)
ok('maxpat fixture present (git add it before building)', typeof maxpat === 'string' && maxpat.length > 0);

// ── 2. canvas: NO bridge ownership / NO race (the thing that caused the bugs) ──
ok('canvas: m4l_ready does NOT adopt a bridge value (no race)', !/auto_rescan/.test(canvasSrc));
ok('canvas: no bridge race-flag', !/_sdAutoRescanFromBridge/.test(canvasSrc));

// ── 3. server: simple reflection, NO bridge-owned setting ──
ok('server: quick_state persists rescan', /rescan: msg\.rescan \? 1 : 0/.test(serverSrc));
ok('server: ws-close seed preserves rescan', /rescan: \(typeof prev\.rescan === 'number' \? prev\.rescan : 1\)/.test(serverSrc));
ok('server: outlets quick_rescan (device button color)', /Max\.outlet\('quick_rescan'/.test(serverSrc));
ok('server: NO bridge-owned file (AUTORESCAN_FILE gone)', !/AUTORESCAN_FILE/.test(serverSrc));
ok('server: NO bridge poll / _autoRescan / _reflectAutoRescan', !/_autoRescan|_pollAutoRescan|_reflectAutoRescan/.test(serverSrc));

// ── 4. UI + protocol + device snippet ──
ok('index.html: on-screen Rescan toggle button present', /id="sd-autorescan-btn"[\s\S]*?sdToggleAutoRescan/.test(htmlSrc));
ok('types: documents rescan_set/rescan_toggle', /rescan_set'\s*\|\s*'rescan_toggle/.test(typesSrc));
ok('maxpat: valid JSON + sends quick rescan_set', (() => { try { JSON.parse(maxpat); } catch (e) { return false; } return /quick rescan_set/.test(maxpat); })());

// ── 5. behavioral: the rescan-gate logic ──
function rescanFirst(isGen, green, dirty, isInject) { return (isGen && (green || dirty)) || (isInject && dirty); }
ok('behav: GREEN generator always rescans', rescanFirst(true, true, false, false) === true);
ok('behav: GREY generator skips rescan on a stable rack (crank)', rescanFirst(true, false, false, false) === false);
ok('behav: GREY generator STILL rescans if rack/clip changed (safety)', rescanFirst(true, false, true, false) === true);
ok('behav: inject rescans only when context dirty', rescanFirst(false, false, false, true) === false && rescanFirst(false, false, true, true) === true);

console.log('\n' + passed + ' passed, ' + failed + ' failed');
process.exit(failed ? 1 : 0);
