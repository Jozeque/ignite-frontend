/**
 * test-vst3-pass-ui.js
 *
 * Phase E — the Discovery Pass UI in the wrapper index.html: the one-click Start screen,
 * the Ended (purchase) screen, the active-pass countdown + 2-hour nudge, and the removal of
 * the old freeze demo. Source assertions on the HTML/JS wiring + the copy.
 */
'use strict';
const fs = require('fs');
const path = require('path');

let passed = 0, failed = 0;
function ok(name, cond, extra) {
    if (cond) { passed++; }
    else { failed++; console.log('  ✗ ' + name + (extra ? '  — ' + extra : '')); }
}
console.log('test-vst3-pass-ui.js');

const H = fs.readFileSync(path.join(__dirname, '..', '..', 'stride-wrapper', 'm0-spike', 'ui', 'index.html'), 'utf8');

// ── the overlay states exist ────────────────────────────────
ok('pass-start screen (one-click, no email field)', /id="pass-start"/.test(H) && /startDiscoveryPass\(\)/.test(H) && /Start My 24-Hour Pass/.test(H));
ok('NO email input on the start screen (device-bound)', !/pass-start[\s\S]{0,600}<input/.test(H));
ok('pass-ended (locked/purchase) screen', /id="pass-ended"/.test(H) && /Your Discovery Pass has ended/.test(H));
ok('active-pass countdown banner', /id="pass-banner"/.test(H) && /id="pass-banner-text"/.test(H));

// ── the flow ────────────────────────────────────────────────
ok('checkLicense routes not-entitled -> pass gate (not the demo)', /showPassGate\s*\(\s*reason === 'exp-expired' \? 'ended' : 'start'\s*\)/.test(H));
ok('the old "Continue in demo" is gone', !/Continue in demo/.test(H));
ok('startDiscoveryPass -> stride.startPass -> cachePass -> unlock', /async function startDiscoveryPass\(\)[\s\S]{0,700}window\.stride\.startPass\(\)[\s\S]{0,300}cachePass\(r\)[\s\S]{0,160}unlockApp\(false\)/.test(H));
ok('cachePass persists the signed pass (ent/ent_sig/exp, pass flag)', /async function cachePass\(r\)[\s\S]{0,320}ent:\s*r\.ent[\s\S]{0,120}ent_sig:\s*r\.ent_sig[\s\S]{0,80}/.test(H) && /pass:\s*true/.test(H));
ok('showPassGate + showActivationForm (license key still reachable)', /function showPassGate\(state\)/.test(H) && /function showActivationForm\(\)/.test(H));

// ── countdown + 2h nudge + resume ───────────────────────────
ok('sdPassInit starts the countdown from exp', /function sdPassInit\(expMs\)[\s\S]{0,220}setInterval\(sdPassTick/.test(H));
ok('countdown resumes on reopen for an active pass', /lic\.entitled && age < OFFLINE_GRACE_MS[\s\S]{0,400}sdPassInit\(Number\(lic\.ent\.exp\)\)/.test(H));
ok('2-hours-left nudge fires once (fuchsia)', /ms <= 2 \* 3600000 && !_passNudged[\s\S]{0,260}border-fuchsia/.test(H));

// ── mid-session expiry overlay + copper CTA ─────────────────
ok('mid-session expiry pops the ended overlay + stops the countdown (sdPassExpired)', /window\.sdPassExpired = function \(\)[\s\S]{0,260}showPassGate\('ended'\)/.test(H));
ok('CTA uses the website copper (btn-copper), not the orange→red gradient', /\.sd-btn-copper\{background:linear-gradient\(180deg,#e58a2e,#c6712b\)/.test(H) && !/from-orange-500 to-red-600/.test(H));
ok('the Start + Get Stride CTAs carry sd-btn-copper', /id="pass-start-btn"[\s\S]{0,40}sd-btn-copper/.test(H) && (H.match(/sd-btn-copper/g) || []).length >= 4);

// ── the copy (Yossi's, verbatim tone) ───────────────────────
ok('welcome copy', /Welcome to your[\s\S]{0,80}24-hour Discovery Pass[\s\S]{0,140}Explore without limits/.test(H));
ok('projects-remain-untouched copy', /projects remain untouched/.test(H));
ok('2-hours-left copy', /Found something you love/.test(H));
ok('no "BUY NOW" hard-sell', !/BUY NOW/i.test(H));

console.log('  ' + passed + ' passed, ' + failed + ' failed');
process.exit(failed ? 1 : 0);
