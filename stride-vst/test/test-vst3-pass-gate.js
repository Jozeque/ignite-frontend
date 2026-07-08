/**
 * test-vst3-pass-gate.js
 *
 * Phase B — the native (C++) enforcement of the Discovery Pass expiry + the clock-rollback
 * guard. Source assertions on License.h / PluginProcessor.cpp (C++ isn't run in Node) + a
 * behavioural replica of the exp gate math (eff = max(now, maxSeen); deny when eff >= exp).
 */
'use strict';
const fs = require('fs');
const path = require('path');

let passed = 0, failed = 0;
function ok(name, cond, extra) {
    if (cond) { passed++; }
    else { failed++; console.log('  ✗ ' + name + (extra ? '  — ' + extra : '')); }
}
console.log('test-vst3-pass-gate.js');

const root = path.join(__dirname, '..', '..');
const rd = (p) => fs.readFileSync(p, 'utf8');
const W = path.join(root, 'stride-wrapper', 'm0-spike');
const lic  = rd(path.join(W, 'src', 'License.h'));
const proc = rd(path.join(W, 'src', 'PluginProcessor.cpp'));

// ── clock guard infrastructure ──────────────────────────────
ok('pass-clock is a SEPARATE file (not license.json)', /passClockFile\(\)[\s\S]{0,80}getChildFile\s*\(\s*"pass-clock\.json"\s*\)/.test(lic) && !/license\.json[\s\S]{0,40}maxSeen/.test(lic));
ok('passClockMaxSeen reads maxSeen (0 when absent)', /passClockMaxSeen\(\)[\s\S]{0,200}getProperty\s*\(\s*"maxSeen"/.test(lic));
ok('raisePassClock is monotonic (never lowers)', /raisePassClock[\s\S]{0,140}if\s*\(ms\s*<=\s*0\s*\|\|\s*ms\s*<=\s*passClockMaxSeen\(\)\)\s*return/.test(lic));

// ── the exp gate in computeEntitled ─────────────────────────
ok('vst membership restructured to a flag (so the exp check runs after)', /bool\s+hasVst\s*=\s*false;[\s\S]{0,200}hasVst\s*=\s*true;\s*break;[\s\S]{0,120}if\s*\(!\s*hasVst\)\s*return\s+mk\s*\(false,\s*"wrong-product"\)/.test(lic));
ok('exp enforced against max(now, maxSeen) → exp-expired', /juce::int64\s+exp\s*=[\s\S]{0,120}if\s*\(exp\s*>\s*0\)[\s\S]{0,220}juce::jmax\s*\(juce::Time::getCurrentTime\(\)\.toMilliseconds\(\),\s*passClockMaxSeen\(\)\)[\s\S]{0,120}if\s*\(eff\s*>=\s*exp\)\s*return\s+mk\s*\(false,\s*"exp-expired"\)/.test(lic));
ok('perpetual key (no exp) is unaffected — exp check is guarded by exp>0', /exp\s*>\s*0/.test(lic) && /return\s+mk\s*\(true,\s*"signed"\)/.test(lic));

// ── the launch stamp ────────────────────────────────────────
ok('plugin construction stamps the pass clock BEFORE the entitlement seed', /raisePassClock\s*\(juce::Time::getCurrentTime\(\)\.toMilliseconds\(\)\)[\s\S]{0,160}cachedEntitled\(\)/.test(proc));

// ── JS gate mirrors it ──────────────────────────────────────
const ent = rd(path.join(root, 'stride-vst', 'app', 'lib', 'entitlements.js'));
ok('JS readEntitlement enforces exp with max(now, maxSeen)', /const\s+exp\s*=\s*Number\(license\.ent\.exp\)[\s\S]{0,220}Math\.max\(nowMs,\s*maxSeen\)\s*>=\s*exp[\s\S]{0,60}return\s+deny\('exp-expired'/.test(ent));

// ── C2: client device-id + startPass plumbing ───────────────
ok('deviceHash salts getUniqueDeviceID and hashes it natively (raw id never sent)', /deviceHash\(\)[\s\S]{0,260}getUniqueDeviceID\(\)[\s\S]{0,200}shaUpper\s*\(juce::String\s*\("stride-pass-v1\|"\)/.test(lic));
ok('startPass POSTs action=start_pass with the device hash', /startPass[\s\S]{0,500}"action",\s*"start_pass"[\s\S]{0,160}"device",\s*device/.test(lic));
ok('startPass raises the anti-rollback clock from the server time', /startPass[\s\S]{0,2200}raisePassClock\s*\(\(juce::int64\)\s*parsed\.getProperty\s*\("server_now_ms"/.test(lic));
ok('startPass caches key = device hash (matches the signed ent.key)', /startPass[\s\S]{0,2600}setProperty\s*\("key",\s*device\)/.test(lic));
const ed = rd(path.join(W, 'src', 'PluginEditor.cpp'));
ok('editor routes op start_pass -> stride_license::startPass', /op == "start_pass"[\s\S]{0,70}startPass\s*\(msg\.getProperty\s*\("email"/.test(ed));
const shim = rd(path.join(W, 'ui', 'shim.js'));
ok('shim exposes startPass(email) -> start_pass (device stays native)', /startPass:\s*function\s*\(email\)[\s\S]{0,90}_licCall\('start_pass',\s*\{\s*email:\s*email\s*\}\)/.test(shim));

// ── behavioural replica of the gate math ────────────────────
(function () {
    // Mirror: exp absent → permanent; exp>0 → deny once max(now,maxSeen) >= exp.
    function gate(entObj, nowMs, maxSeen) {
        const exp = Number(entObj.exp);
        if (!Number.isFinite(exp) || exp <= 0) return 'signed';          // perpetual
        return (Math.max(nowMs, maxSeen || 0) >= exp) ? 'exp-expired' : 'signed';
    }
    ok('replica: active pass → signed', gate({ exp: 1000 }, 500, 0) === 'signed');
    ok('replica: expired pass → exp-expired', gate({ exp: 1000 }, 1000, 0) === 'exp-expired');
    ok('replica: rollback (now<exp) but maxSeen≥exp → exp-expired', gate({ exp: 1000 }, 10, 1001) === 'exp-expired');
    ok('replica: no maxSeen, within window → signed', gate({ exp: 1000 }, 999, 0) === 'signed');
    ok('replica: perpetual (no exp) → signed regardless of clock', gate({}, 9e15, 9e15) === 'signed');
    ok('replica: exp:0 treated as perpetual', gate({ exp: 0 }, 9e15, 9e15) === 'signed');
})();

console.log('  ' + passed + ' passed, ' + failed + ' failed');
process.exit(failed ? 1 : 0);
