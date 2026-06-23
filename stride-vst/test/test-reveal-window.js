/**
 * test-reveal-window.js
 *
 * Regression guard for the "Open Canvas does nothing" bug (found + fixed 2026-06-23).
 *
 * A feature/Motion press boots the canvas HIDDEN (STRIDE_START_HIDDEN=1, show:false).
 * Open Canvas (and a second launch hitting the single-instance lock, and macOS
 * activate) must REVEAL it — i.e. call mainWindow.show(), not just .focus(): focus()
 * alone leaves a hidden window invisible. The fix routes all three reveal triggers
 * through a shared revealMainWindow() that calls show(). If this fails, a hidden
 * window can't be brought back.
 */
'use strict';
const fs = require('fs');
const path = require('path');
let passed = 0, failed = 0;
function ok(name, cond, extra) { if (cond) passed++; else { failed++; console.log('  ✗ ' + name + (extra ? '  -- ' + extra : '')); } }
console.log('test-reveal-window.js');

const mainSrc = fs.readFileSync(path.join(__dirname, '..', 'app', 'main.js'), 'utf8');
const serverSrc = fs.readFileSync(path.join(__dirname, '..', 'm4l', 'node', 'server.js'), 'utf8');

// the shared reveal helper exists and SHOWS (not just focuses) the window
ok('main: revealMainWindow() exists', /function revealMainWindow\s*\(\)/.test(mainSrc));
ok('main: revealMainWindow calls mainWindow.show()', /function revealMainWindow\s*\(\)\s*\{[\s\S]*?mainWindow\.show\(\)[\s\S]*?\}/.test(mainSrc));

// all three reveal triggers route through it
ok('main: ipcMain focus-window reveals (Open Canvas via WS)', /ipcMain\.on\('focus-window'[\s\S]{0,160}revealMainWindow\(\)/.test(mainSrc));
ok('main: second-instance reveals a hidden window (the bug)', /on\('second-instance'[\s\S]{0,600}revealMainWindow\(\)/.test(mainSrc));
ok('main: activate reveals when a window already exists', /on\('activate'[\s\S]{0,220}revealMainWindow\(\)/.test(mainSrc));

// the hidden-launch contract a feature press relies on
ok('main: feature press launches hidden (show gated on STRIDE_START_HIDDEN)', /show:\s*process\.env\.STRIDE_START_HIDDEN\s*!==\s*'1'/.test(mainSrc));

// guard against regressing second-instance back to a bare focus()-without-show()
const si = mainSrc.match(/on\('second-instance'[\s\S]{0,600}?\}\s*\)\s*;/);
ok('main: second-instance does NOT bare-focus without revealing', !!si && si[0].indexOf('revealMainWindow()') !== -1);

// #3 fix: a relay bridge (duplicated track) must NOT auto-launch a 2nd instance —
// which would pop the hidden canvas — when a canvas is already connected elsewhere.
ok('server: helper detects a canvas connected anywhere (STATE_FILE.connected + fresh ts)', /function _aCanvasIsConnectedAnywhere[\s\S]*?s\.connected === 1[\s\S]*?Date\.now\(\) - s\.ts < 4000/.test(serverSrc));
ok('server: quick-handler auto-launch gated on _aCanvasIsConnectedAnywhere (no duplicated-track pop)', /readyState !== 1\) && !_aCanvasIsConnectedAnywhere\(\)/.test(serverSrc));

console.log('\n' + passed + ' passed, ' + failed + ' failed');
process.exit(failed ? 1 : 0);
