/**
 * test-install-guide.js
 *
 * Guards the post-install StrideInject popup + the in-app guide refresh (added
 * 2026-06-24).
 *
 * THE WALL: new users forget to enable StrideInject as a Control Surface — Ableton
 * can't auto-enable it, so inject silently fails. The old post-install message was a
 * 10px status line that AUTO-DISMISSED in 7s with no screenshot, so everyone missed
 * it. Fix: a PERSISTENT popup with the step1.png Control-Surface screenshot + the
 * exact Settings path + a link into the (now website-synced) guide. The guide also
 * gains the website's "Recommended Ableton settings" step.
 *
 * If this fails, the popup/guide regressed back toward the silently-missed state.
 */
'use strict';
const fs = require('fs');
const path = require('path');
let passed = 0, failed = 0;
function ok(name, cond, extra) { if (cond) passed++; else { failed++; console.log('  ✗ ' + name + (extra ? '  -- ' + extra : '')); } }
console.log('test-install-guide.js');

const appDir = path.join(__dirname, '..', 'app');
const idx = fs.readFileSync(path.join(appDir, 'renderer', 'index.html'), 'utf8');
const canvas = fs.readFileSync(path.join(appDir, 'renderer', 'canvas.js'), 'utf8');

// ── post-install popup: exists, shows the Control-Surface screenshot, names the path ──
ok('index: sd-strideinject-modal exists', /id="sd-strideinject-modal"/.test(idx));
ok('index: popup shows the StrideInject Control-Surface screenshot (step1.png)',
   /id="sd-strideinject-modal"[\s\S]*?\.\.\/assets\/ss\/step1\.png/.test(idx));
ok('index: popup names the exact path (Link, Tempo & MIDI → Control Surface → StrideInject)',
   /Link, Tempo &amp; MIDI[\s\S]{0,200}Control Surface[\s\S]{0,200}StrideInject/.test(idx));
ok('index: popup warns to restart Ableton', /Restart Ableton/i.test(idx));
ok('index: popup wires Got it + Open setup guide buttons',
   /sdDismissStrideInjectSetup/.test(idx) && /sdOpenGuideFromInstall/.test(idx));

// ── popup wired in canvas.js; install-success routes into it (not the old 7s auto-dismiss) ──
ok('canvas: sdShowStrideInjectSetup defined + exported',
   /function sdShowStrideInjectSetup\(\)/.test(canvas) && /window\.sdShowStrideInjectSetup = sdShowStrideInjectSetup/.test(canvas));
ok('canvas: sdDismissStrideInjectSetup chains to the welcome overlay on first run',
   /function sdDismissStrideInjectSetup\(\)[\s\S]{0,400}sd-welcome-overlay/.test(canvas));
ok('canvas: sdOpenGuideFromInstall opens the guide modal',
   /function sdOpenGuideFromInstall\(\)[\s\S]{0,400}guide-modal/.test(canvas));
ok('canvas: install success opens the Setup Guide immediately (sdOpenGuideFromInstall)',
   /res\.strideInjectInstalled[\s\S]{0,800}sdOpenGuideFromInstall\(\)/.test(canvas));
ok('canvas: sdOpenGuideFromInstall hides the install overlay + opens the guide',
   /function sdOpenGuideFromInstall\(\)[\s\S]{0,500}sd-install-m4l-overlay[\s\S]{0,400}guide-modal/.test(canvas));
ok('canvas: the old auto-dismissing multi-step status text is gone',
   !/One-time setup in Ableton:/.test(canvas));

// ── guide refreshed: now carries the website's "Recommended Ableton settings" step ──
ok('guide: Record, Warp & Launch recommended-settings step added', /Record, Warp &amp; Launch/.test(idx));
ok('guide: Record Session automation in = All Tracks', /Record Session automation in[\s\S]{0,160}All Tracks/.test(idx));
ok('guide: Start Transport With Record = On', /Start Transport With Record[\s\S]{0,160}>On</.test(idx));
ok('guide: step1.png alt fixed to describe the Control Surface (not "load StrideLink")',
   /step1\.png" alt="Choose StrideInject as the Control Surface/.test(idx));

// ── the screenshot the popup + guide reference is actually bundled in the app ──
ok('asset: app bundle has assets/ss/step1.png', fs.existsSync(path.join(appDir, 'assets', 'ss', 'step1.png')));

// ── guide: Arrangement-view guidance (the 2 unfold arrows + clip selection) ──
ok('guide: Arrangement-view block added', /Working in Arrangement view/.test(idx));
ok('guide: arrangement block tells the user to unfold the track / turn on the two arrows',
   /unfold the track[\s\S]{0,220}two arrows/.test(idx));
ok('guide: arrangement block requires selecting the MIDI clip in the Detail view',
   /Working in Arrangement view[\s\S]{0,700}MIDI clip[\s\S]{0,200}Detail view/.test(idx));
ok('guide: arrangement block shows the unfold-arrows screenshot (arrangement.png)', /arrangement\.png/.test(idx));
ok('asset: app bundle has assets/ss/arrangement.png', fs.existsSync(path.join(appDir, 'assets', 'ss', 'arrangement.png')));

console.log('\n' + passed + ' passed, ' + failed + ' failed');
process.exit(failed ? 1 : 0);
