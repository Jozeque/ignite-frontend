/**
 * test-quickpanel.js
 *
 * Two jobs:
 *   1. REGRESSION GUARD — prove the new QuickPanel is purely additive and
 *      isolated: the 5 protected files (index.html, canvas.js, ws-client.js,
 *      server.js, scanner_max.js) and every existing main.js IPC handler are
 *      intact, and the QuickPanel never loads canvas.js / ws-client.js or talks
 *      to the M4L bridge (so it can't affect the main canvas, app logic, or
 *      StrideQuick).
 *   2. BEHAVIOR — exercise quickpanel-core.js (pure logic): state
 *      normalization, the multi/focus view machine, lane colors, label
 *      hit-zones, and the adjustment-slider math.
 */
'use strict';
const fs = require('fs');
const path = require('path');
let passed = 0, failed = 0;
function ok(name, cond, extra) { if (cond) passed++; else { failed++; console.log('  ✗ ' + name + (extra ? '  -- ' + extra : '')); } }
function read(rel) { return fs.readFileSync(path.join(__dirname, '..', rel), 'utf8'); }
console.log('test-quickpanel.js');

// ── sources ──
const mainSrc = read('app/main.js');
const preMain = read('app/preload.js');
const qpHtml = read('app/renderer/quickpanel.html');
const qpJs = read('app/renderer/quickpanel.js');
const qpPre = read('app/quickpanel-preload.js');

// ── 1a. protected files still present + carry their defining signatures ──
ok('protected: index.html present', fs.existsSync(path.join(__dirname, '..', 'app/renderer/index.html')));
ok('protected: canvas.js present + multi-view intact', /function sdDrawMultiView/.test(read('app/renderer/canvas.js')));
ok('protected: ws-client.js present', fs.existsSync(path.join(__dirname, '..', 'app/renderer/ws-client.js')));
ok('protected: server.js present', fs.existsSync(path.join(__dirname, '..', 'm4l/node/server.js')));
ok('protected: scanner_max.js present', fs.existsSync(path.join(__dirname, '..', 'm4l/node/scanner_max.js')));

// ── 1b. existing main.js behavior + every original IPC handler still registered ──
ok('main: createWindow still loads index.html', /loadFile\(path\.join\(__dirname, 'renderer', 'index\.html'\)\)/.test(mainSrc));
ok('main: feature-press hidden-launch contract intact', /show:\s*process\.env\.STRIDE_START_HIDDEN\s*!==\s*'1'/.test(mainSrc));
ok('main: revealMainWindow intact', /function revealMainWindow\s*\(\)\s*\{[\s\S]*?mainWindow\.show\(\)/.test(mainSrc));
const ORIGINAL_CHANNELS = [
    'focus-window', 'save-canvas-state', 'load-canvas-state', 'validate-license-key',
    'save-license', 'load-license', 'save-settings', 'load-settings', 'load-pattern-manifest',
    'load-pattern-file', 'persist-library-path', 'get-cached-library-path', 'open-external',
    'get-version', 'check-stride-link-installed', 'install-stride-link-to-ableton',
    'pick-alc-file', 'import-template', 'list-templates', 'delete-template', 'save-session',
    'list-sessions', 'load-session', 'delete-session', 'trigger-library-scan', 'ondragstart',
    'reveal-in-folder', 'open-stride-folder', 'open-guide-folder',
];
ORIGINAL_CHANNELS.forEach(ch => ok('main: original IPC "' + ch + '" still registered', mainSrc.indexOf("'" + ch + "'") !== -1));

// ── 1c. main preload: full 'stride' surface intact + exposes ONLY the opener
//        (never the panel's read-only data bridge — that stays isolated) ──
ok('preload(main): still exposes window.stride', /exposeInMainWorld\('stride'/.test(preMain));
ok('preload(main): saveCanvasState intact', /saveCanvasState:/.test(preMain));
ok('preload(main): exposes openQuickPanel opener', /openQuickPanel:/.test(preMain));
ok('preload(main): does NOT expose the panel read-only surface', preMain.indexOf('strideQuick') === -1 && preMain.indexOf('loadLatestCanvas') === -1);
const indexSrc = read('app/renderer/index.html');
ok('index: titlebar button toggles compact mode', /sd-quickpanel-btn/.test(indexSrc) && /toggleCompactMode\(\)/.test(indexSrc));

// ── 1d. QuickPanel additions in main.js are present + opt-in + isolated ──
ok('main: createQuickPanelWindow added', /function createQuickPanelWindow\s*\(\)/.test(mainSrc));
ok('main: QuickPanel loads its OWN renderer', /loadFile\(path\.join\(__dirname, 'renderer', 'quickpanel\.html'\)\)/.test(mainSrc));
ok('main: QuickPanel uses its OWN preload', /preload: path\.join\(__dirname, 'quickpanel-preload\.js'\)/.test(mainSrc));
ok('main: QuickPanel is pinned (alwaysOnTop)', /alwaysOnTop:\s*true/.test(mainSrc));
ok('main: quickpanel-get-latest is read-only (readFileSync, no write)', /ipcMain\.handle\('quickpanel-get-latest'[\s\S]*?readFileSync[\s\S]*?\}\);/.test(mainSrc));
ok('main: open-quickpanel handler exists', /ipcMain\.on\('open-quickpanel'/.test(mainSrc));
ok('main: opener is the global shortcut (opt-in, not auto-opened)', /globalShortcut\.register\([\s\S]{0,60}createQuickPanelWindow\(\)/.test(mainSrc));
ok('main: shortcuts cleaned up on quit', /on\('will-quit'[\s\S]{0,120}unregisterAll\(\)/.test(mainSrc));
// the panel must NOT be auto-created in the whenReady mainline (only via shortcut/ipc)
const whenReady = mainSrc.match(/whenReady\(\)\.then\(\(\)\s*=>\s*\{([\s\S]*?)\}\);/);
ok('main: QuickPanel NOT auto-opened at startup', !!whenReady && !/^\s*createQuickPanelWindow\(\);\s*$/m.test(whenReady[1]));
ok('main: QuickPanel remembers its size/position', /quickpanel-bounds\.json/.test(mainSrc) && /quickPanelWindow\.on\('resize'/.test(mainSrc) && /_qpReadBounds\(\)/.test(mainSrc));

// ── 1e. QuickPanel renderer is isolated from the canvas + bridge ──
// isolation = not LOADED via <script src> (a mention in a doc comment is fine)
ok('qp html: does NOT load canvas.js', !/src=["'][^"']*canvas\.js["']/.test(qpHtml));
ok('qp html: does NOT load ws-client.js', !/src=["'][^"']*ws-client/.test(qpHtml));
ok('qp html: does NOT load cloud-client.js', !/src=["'][^"']*cloud-client/.test(qpHtml));
ok('qp html: loads quickpanel-core.js + quickpanel.js', /quickpanel-core\.js/.test(qpHtml) && /src="quickpanel\.js"/.test(qpHtml));
ok('qp js: no WebSocket / bridge connection', qpJs.indexOf('WebSocket') === -1 && qpJs.indexOf('ws://') === -1 && qpJs.indexOf('strideLink') === -1);
ok('qp preload: exposes strideQuick (read-only surface)', /exposeInMainWorld\('strideQuick'/.test(qpPre));
ok('qp preload: no write/apply IPC', qpPre.indexOf('save-canvas-state') === -1 && qpPre.indexOf('apply') === -1);

// ── 1f. live mirror wiring (canvas → main → panel; ONE-WAY, panel can't write back) ──
const canvasSrc = read('app/renderer/canvas.js');
ok('canvas: multi-view + saveCanvasState still intact', /function sdDrawMultiView/.test(canvasSrc) && /async function saveCanvasState/.test(canvasSrc));
// PIVOT (compact = the real canvas, reflowed): the old in-process mirror is GONE.
ok('canvas: mirror push removed (no _sdQuickPanelPush)', !/_sdQuickPanelPush/.test(canvasSrc));
ok('canvas: mirror emit removed (no __qpEmitState / _sdEmitQp)', !/__qpEmitState/.test(canvasSrc) && !/_sdEmitQp/.test(canvasSrc));
ok('canvas: command mirror removed (no _sdHandleQuickPanelCommand)', !/_sdHandleQuickPanelCommand/.test(canvasSrc));
ok('preload(main): exposes quickPanelPush (one-way push)', /quickPanelPush:/.test(preMain));
ok('main: forwards push → panel as quickpanel-state', /ipcMain\.on\('quickpanel-push-state'[\s\S]{0,300}send\('quickpanel-state'/.test(mainSrc));
ok('main: replays latest snapshot on panel load', /did-finish-load[\s\S]{0,220}quickpanel-state/.test(mainSrc));
ok('qp preload: receives live state via onState', /onState:[\s\S]{0,90}quickpanel-state/.test(qpPre));
ok('qp js: live state is authoritative over file (gotLive guard)', /gotLive/.test(qpJs));
ok('qp js: draws the bar/beat grid', /shared time grid/.test(qpJs));

// ── 1g. two-way edit commands (panel → canvas; canvas validates + is lock-safe) ──
ok('canvas: no in-process command shim left', !/onQuickPanelCommand\(/.test(canvasSrc) && !/_sdQuickPanelAfterCmd/.test(canvasSrc));
ok('canvas: real lock fns intact (compact calls them)', /sdToggleLockAll/.test(canvasSrc) && /sdUnlockAllLanes/.test(canvasSrc));
ok('canvas: real edit fns intact (compact sliders call them)', /window\.sdApplyIntensity = function/.test(canvasSrc) && /window\.sdApplySmooth = function/.test(canvasSrc));
ok('canvas: real tool fns intact (compact toolbar calls them)', /sdMirrorLane/.test(canvasSrc) && /sdMutate/.test(canvasSrc) && /sdApplySwing/.test(canvasSrc));
ok('preload(main): exposes onQuickPanelCommand', /onQuickPanelCommand:/.test(preMain));
ok('main: forwards command → canvas (mainWindow)', /ipcMain\.on\('quickpanel-command'[\s\S]{0,220}mainWindow\.webContents\.send\('quickpanel-command'/.test(mainSrc));
ok('qp preload: exposes sendCommand (panel → canvas)', /sendCommand:[\s\S]{0,90}quickpanel-command/.test(qpPre));
ok('qp js: lock/select/active go through commands', /cmd\(\{ type: 'toggleLock'/.test(qpJs) && /cmd\(\{ type: 'setActive'/.test(qpJs));
ok('qp js: slider release commits setPoints', /cmd\(\{ type: 'setPoints'[\s\S]{0,60}points: pts/.test(qpJs) && /function commitAdjust/.test(qpJs));

// ── 1h. tool buttons + drawing + label/slider polish ──
ok('canvas: toggleCompactMode toggles body.qp-compact (no mirror)', /document\.body\.classList\.toggle\('qp-compact'/.test(canvasSrc));
ok('canvas: compact re-fits the real canvas on toggle (resize)', /toggleCompactMode = function[\s\S]{0,900}dispatchEvent\(new Event\('resize'\)/.test(canvasSrc));
ok('qp html: Bezier button removed', qpHtml.indexOf('data-tool="bezier"') === -1 && qpHtml.indexOf('>Bezier<') === -1);
ok('qp html: action tool buttons wired (data-act)', /data-act="mirror"/.test(qpHtml) && /data-act="mutate"/.test(qpHtml) && /data-act="quantize"/.test(qpHtml));
ok('qp html: draw tools present (Point/Free)', /data-tool="point"/.test(qpHtml) && /data-tool="freehand"/.test(qpHtml));
ok('qp html: sliders are one no-wrap row', /flex-nowrap/.test(qpHtml) && /data-fx="ceil"[\s\S]{0,60}min-w-0/.test(qpHtml));
ok('qp js: action buttons send tool commands', /data-act[\s\S]{0,170}cmd\(\{ type: 'tool', tool: btn\.dataset\.act \}\)/.test(qpJs));
ok('qp js: drawing commits points on mouseup', /function endDraw[\s\S]{0,170}cmd\(\{ type: 'setPoints'/.test(qpJs) && /function startDraw/.test(qpJs));
ok('qp js: live push suppressed during an active draw', /function applyState[\s\S]{0,70}if \(drawState\) return/.test(qpJs));
ok('qp js: 3-line label (device · param · points)', /3 lines: device/.test(qpJs) && /points'/.test(qpJs));

// ── 1i. compact mode = the REAL canvas, reflowed (no 2nd renderer / mirror) ──
ok('index: old compact overlay removed', !/id="qp-compact"/.test(indexSrc));
ok('index: quickpanel renderer NOT loaded by the canvas window', !/src="quickpanel\.js"/.test(indexSrc) && !/src="quickpanel-core\.js"/.test(indexSrc));
ok('index: in-process mirror shim removed', !/window\.strideQuick = \{/.test(indexSrc));
ok('index: reflow classes drive compact (full-only hides, compact-only shows)', /body\.qp-compact \.sd-full-only \{ display: none/.test(indexSrc) && /body\.qp-compact \.sd-compact-only \{ display: flex/.test(indexSrc));
ok('index: sidebar + inject rail are full-only', /id="sd-sidebar" class="sd-full-only/.test(indexSrc) && /id="sd-inject-rail" class="sd-full-only/.test(indexSrc));
ok('index: compact toolbar wired to REAL fns', /sd-compact-only[\s\S]{0,1500}onclick="sdMirrorLane\(\)"/.test(indexSrc) && /onclick="sdMutate\(\)"/.test(indexSrc));
// Compact toolbar refinements (2026-06-29): Point/Free have ids (so sdSetTool can
// light them), 2x/1/2x added, Copy/Paste/Paste To removed, DEL clears the lane.
ok('index: compact Point/Free have ids', /id="qpc-tool-point"/.test(indexSrc) && /id="qpc-tool-free"/.test(indexSrc));
ok('index: compact has 2x / 1/2x stretch', /sd-compact-only[\s\S]{0,1800}onclick="sdTimeStretch\(2\)"/.test(indexSrc) && /onclick="sdTimeStretch\(0\.5\)"/.test(indexSrc));
ok('index: compact dropped the clipboard ops (Paste To only in full toolbar)', (indexSrc.match(/>Paste To</g) || []).length === 1);
ok('canvas: sdSetTool lights the compact Point/Free', /sdSetTool = function[\s\S]{0,1400}qpc-tool-point/.test(canvasSrc) && /qpc-tool-free/.test(canvasSrc));
ok('canvas: DEL/Backspace clears the selected lane', /e\.code === 'Delete' \|\| e\.code === 'Backspace'[\s\S]{0,120}sdClearCurrentCanvas/.test(canvasSrc));
ok('canvas: clear persists (saveCanvasState)', /sdClearCurrentCanvas = function[\s\S]{0,900}saveCanvasState/.test(canvasSrc));
ok('index: compact slider strip wired to REAL edit fns', /id="qpc-intensity-slider"[\s\S]{0,140}sdApplyIntensity/.test(indexSrc) && /id="qpc-smooth-slider"[\s\S]{0,140}sdApplySmooth/.test(indexSrc));
ok('index: compact Unlock All present (real fn)', /sdUnlockAllLanes\(\)/.test(indexSrc) && />Unlock All</.test(indexSrc));
ok('canvas: toggleCompactMode added (simplified, no mirror)', /window\.toggleCompactMode = function/.test(canvasSrc) && !/_sdEmitQp/.test(canvasSrc));
ok('canvas: compact slider strip resets in sync (_sdResetCompactSliders)', /_sdResetCompactSliders/.test(canvasSrc) && /qpc-intensity/.test(canvasSrc));
ok('main: compact mode shrinks + pins the window', /ipcMain\.on\('set-compact-mode'/.test(mainSrc) && /setAlwaysOnTop\(true\)/.test(mainSrc) && /setMinimumSize\(360/.test(mainSrc));
ok('main: compact un-maximizes first (maximized ignores resize)', /isMaximized\(\)\) mainWindow\.unmaximize\(\)/.test(mainSrc) && /_mainWasMaximized\) mainWindow\.maximize\(\)/.test(mainSrc));
ok('preload(main): exposes setCompactMode + setCompactPin', /setCompactMode:/.test(preMain) && /setCompactPin:/.test(preMain));
ok('canvas: rescan no-ops when params unchanged (anti-thrash)', /_newIds === _curIds && sdCanvasParams\.length > 0/.test(canvasSrc));
ok('main: reveal keeps the window pinned while compact', /!_mainCompact\) mainWindow\.setAlwaysOnTop\(false\)/.test(mainSrc));
ok('canvas: rescan "Keep/Replace" modal removed (always curve-preserving merge)', !/rescan-confirm-modal/.test(canvasSrc) && /A scan that has work to preserve ALWAYS keeps it/.test(canvasSrc));
ok('canvas: rescan merge keeps curves + locks by stable _path', /oldCurves\[p\._path\]/.test(canvasSrc) && /if \(c\.locked\) p\.locked = true/.test(canvasSrc));
// Device generators/transforms must PERSIST their fresh curve, or an Auto-Rescan
// merge reloads the stale disk curve over it ("S&H keeps the old Chaos, only with
// Auto-Rescan ON"). Guard: the mutator set exists AND _sdApplyQuickAction saves for it.
ok('canvas: quick mutators defined (generators + transforms)', /_SD_QUICK_MUTATORS = \['chaos','neuro','reflector','sh','prism','mutate','shuffle','double','half'\]/.test(canvasSrc));
ok('canvas: device generator/transform output is persisted (no reload-revert)', /_SD_QUICK_MUTATORS\.indexOf\(action\) !== -1\) \{ try \{ saveCanvasState\(\)/.test(canvasSrc));

// ── 2. behavior — quickpanel-core.js ──
const Core = require('../app/renderer/quickpanel-core.js');

// normalizeState
const n1 = Core.normalizeState({ params: [{ name: 'Cutoff', points: [{ time: 0, value: 2, curve: 0 }], locked: true }], bars: 8 });
ok('core: normalizeState parses params', n1.params.length === 1);
ok('core: normalizeState clamps value to [0,1]', n1.params[0].points[0].value === 1);
ok('core: normalizeState carries locked', n1.params[0].locked === true);
ok('core: normalizeState defaults an id', typeof n1.params[0].id === 'string' && n1.params[0].id.length > 0);
ok('core: normalizeState carries the stable _path key', Core.normalizeState({ params: [{ name: 'X', _path: 'live_set tracks 0', points: [] }] }).params[0]._path === 'live_set tracks 0');
ok('core: normalizeState reads bars', n1.bars === 8);
const n2 = Core.normalizeState(null);
ok('core: normalizeState(null) is safe', n2.params.length === 0 && n2.bars === 4);
ok('core: normalizeState(garbage) is safe', Core.normalizeState(42).params.length === 0);

// lane colors (patch cables)
ok('core: laneRGB(0) is the first patch cable', Core.laneRGB(0) === '198,113,43');
ok('core: laneRGB wraps every 5', Core.laneRGB(5) === Core.laneRGB(0) && Core.laneRGB(6) === Core.laneRGB(1));

// view machine
const v0 = Core.makeView();
ok('core: default view is multi', v0.mode === 'multi' && v0.focusId === null);
const vf = Core.focusLane(v0, 'lane3');
ok('core: focusLane → focus on that id', vf.mode === 'focus' && vf.focusId === 'lane3');
ok('core: backToMulti → multi', Core.backToMulti(vf).mode === 'multi');

// label hit-zones (lock / focus / select)
ok('core: labelZone lock', Core.labelZone(104) === 'lock');
ok('core: labelZone focus', Core.labelZone(80) === 'focus');
ok('core: labelZone select (name area)', Core.labelZone(20) === 'select');
ok('core: labelZone select (past lock)', Core.labelZone(119) === 'select');

// adjustment math
const pts = [{ time: 0, value: 0, curve: 0 }, { time: 1, value: 1, curve: 0 }, { time: 2, value: 0, curve: 0 }];
const flat = Core.applyAdjust(pts, { depth: 0 });
ok('core: depth 0 flattens to 0.5', flat.every(p => Math.abs(p.value - 0.5) < 1e-9));
const capped = Core.applyAdjust(pts, Object.assign(Core.defaultFx(), { ceil: 50 }));
ok('core: ceiling 50 caps the max at 0.5', Math.max.apply(null, capped.map(p => p.value)) <= 0.5 + 1e-9);
const floored = Core.applyAdjust(pts, Object.assign(Core.defaultFx(), { floor: 50 }));
ok('core: floor 50 lifts the min to 0.5', Math.min.apply(null, floored.map(p => p.value)) >= 0.5 - 1e-9);
ok('core: applyAdjust preserves length + time', Core.applyAdjust(pts, Core.defaultFx()).length === 3);
ok('core: applyAdjust identity keeps values', Core.applyAdjust(pts, Core.defaultFx()).map(p => p.value).join() === '0,1,0');
ok('core: applyAdjust on empty is safe', Core.applyAdjust([], Core.defaultFx()).length === 0);

console.log('\n' + passed + ' passed, ' + failed + ' failed');
process.exit(failed ? 1 : 0);
