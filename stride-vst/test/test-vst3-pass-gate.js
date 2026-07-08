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
ok('raisePassClock is monotonic (never lowers) + trusted-only bootstrap', /raisePassClock\s*\(juce::int64 ms,\s*bool trusted\)[\s\S]{0,300}if\s*\(ms\s*<=\s*0\)\s*return[\s\S]{0,450}if\s*\(ms\s*<=\s*cur\)\s*return/.test(lic));

// ── the exp gate in computeEntitled ─────────────────────────
ok('vst membership restructured to a flag (so the exp check runs after)', /bool\s+hasVst\s*=\s*false;[\s\S]{0,200}hasVst\s*=\s*true;\s*break;[\s\S]{0,120}if\s*\(!\s*hasVst\)\s*return\s+mk\s*\(false,\s*"wrong-product"\)/.test(lic));
ok('exp enforced against max(now, maxSeen) → exp-expired', /juce::int64\s+exp\s*=[\s\S]{0,120}if\s*\(exp\s*>\s*0\)[\s\S]{0,900}juce::jmax\s*\(juce::Time::getCurrentTime\(\)\.toMilliseconds\(\),\s*passClockMaxSeen\(\)\)[\s\S]{0,120}if\s*\(eff\s*>=\s*exp\)\s*return\s+mk\s*\(false,\s*"exp-expired"\)/.test(lic));
ok('perpetual key (no exp) is unaffected — exp check is guarded by exp>0', /exp\s*>\s*0/.test(lic) && /return\s+mk\s*\(true,\s*"signed"\)/.test(lic));

// ── the launch stamp ────────────────────────────────────────
ok('plugin construction stamps the pass clock (untrusted) BEFORE the entitlement seed', /raisePassClock\s*\(juce::Time::getCurrentTime\(\)\.toMilliseconds\(\),\s*false\)[\s\S]{0,450}cachedEntitled\(\)/.test(proc));

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
ok('shim exposes startPass -> start_pass (device stays native)', /startPass:\s*function\s*\(email\)[\s\S]{0,120}_licCall\('start_pass'/.test(shim));
ok('startPass is device-first: email sent only if provided (no email gate)', /startPass[\s\S]{0,700}if\s*\(em\.isNotEmpty\(\)\)\s*body->setProperty\s*\("email"/.test(lic) && !/Enter a valid email to start/.test(lic));

// ── D: soft lock (native editLocked; edits blocked, audio kept) ──
const procH = rd(path.join(W, 'src', 'PluginProcessor.h'));
ok('processor has a native editLocked flag', /std::atomic<bool>\s+editLocked/.test(procH) && /setEditLocked\s*\(bool/.test(procH) && /isEditLocked\(\)/.test(procH));
ok('cachedExpiredPass: signature-verified VST ent, exp>0, now past -> true', /cachedExpiredPass\(\)[\s\S]{0,900}entVerify[\s\S]{0,900}exp\s*<=\s*0[\s\S]{0,200}passClockMaxSeen\(\)\)\s*>=\s*exp/.test(lic));
ok('recompute: native editLocked = !cachedEntitled; freeze demo retired', /const bool ent = stride_license::cachedEntitled\(\)[\s\S]{0,220}setEditLocked\s*\(\s*!\s*ent\s*\)[\s\S]{0,200}setDemoMode\s*\(false\)/.test(ed));
ok('SECURITY: a locked WebView cannot push new curves (sl_send apply/live guarded)', /if\s*\(isApply\s*\|\|\s*isLive\)[\s\S]{0,320}if\s*\(proc\.isEditLocked\(\)\)\s*return;/.test(ed));
ok('all edit ops are guarded (map/load/clear/reorder/bypass blocked when locked)', (ed.match(/if\s*\(proc\.isEditLocked\(\)\)\s*return;/g) || []).length >= 12);

// ── security hardening (adversarial-review fixes) ───────────
ok('CRITICAL: pass bound to THIS device at verify (ent.key == deviceHash → wrong-device)', /exp > 0[\s\S]{0,700}ka != deviceHash\(\)\.toUpperCase\(\)\)\s*return\s+mk\s*\(false,\s*"wrong-device"\)/.test(lic));
ok('cachedExpiredPass is device-bound too (a copied expired pass grants nothing here)', /cachedExpiredPass\(\)[\s\S]{0,1000}ka != deviceHash\(\)\.toUpperCase\(\)\)\s*return false/.test(lic));
ok('drive gated on driveAllowed (a never-passed machine gets no modulation)', /std::atomic<bool>\s+driveAllowed/.test(procH) && /!\s*demoFreezeNow\s*&&\s*driveAllowed\.load\(\)/.test(proc));
ok('editLocked + driveAllowed seeded natively in the processor ctor', /editLocked\.store\s*\(\s*!\s*ent\s*\)[\s\S]{0,160}driveAllowed\.store\s*\(ent\s*\|\|\s*stride_license::cachedExpiredPass\(\)\)/.test(proc));
ok('gates re-derived natively on the editor timer (mid-session expiry locks)', /licTick\s*>=\s*60[\s\S]{0,220}setEditLocked[\s\S]{0,160}setDriveAllowed/.test(ed));
ok('processor mutators refuse when locked (setDriveCurves + removeMappedAt)', /setDriveCurves[\s\S]{0,140}if\s*\(editLocked\.load\(\)\)\s*return;/.test(proc) && /removeMappedAt[\s\S]{0,140}if\s*\(editLocked\.load\(\)\)\s*return;/.test(proc));
ok('learn-by-touch is editLocked-gated too (a latched mode cannot mutate after expiry)', /mapParam[\s\S]{0,140}if\s*\(editLocked\.load\(\)\s*\|\|\s*!\s*learnMode\.load\(\)\)\s*return/.test(proc) && /unmapParamByTouch[\s\S]{0,140}if\s*\(editLocked\.load\(\)\s*\|\|\s*!\s*unlearnMode\.load\(\)\)\s*return/.test(proc));
ok('anti-brick clock: bootstrap only from a trusted server value + clamp absurd jumps', /raisePassClock\s*\(juce::int64 ms,\s*bool trusted\)[\s\S]{0,320}cur <= 0 && ! trusted[\s\S]{0,220}kMaxJumpMs/.test(lic) && /server_now_ms",\s*\(juce::int64\)\s*0\),\s*true\)/.test(lic));

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
