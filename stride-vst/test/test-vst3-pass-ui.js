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
ok('pass-start screen', /id="pass-start"/.test(H) && /startDiscoveryPass\(\)/.test(H) && /Start My 24-Hour Pass/.test(H));
// This used to assert "NO email input on the start screen (device-bound)", and after 94b5292
// added one it kept passing only because the field landed more than 600 characters after the
// card opened. A pin that asserts the opposite of the shipped feature and survives on
// character distance is worse than a failing one, so it now pins what is actually true: the
// field exists, and the pass is STILL granted on the device hash rather than on the address.
ok('the start screen asks for an email, and it is optional', /id="pass-email"/.test(H) && /startDiscoveryPass\(\)/.test(H));
ok('the pass is still device-bound, not email-gated', /device-bound; email only labels it/.test(H));
ok('pass-ended (locked/purchase) screen', /id="pass-ended"/.test(H) && /Your Discovery Pass has ended/.test(H));
ok('active-pass countdown banner', /id="pass-banner"/.test(H) && /id="pass-banner-text"/.test(H));

// ── the flow ────────────────────────────────────────────────
ok('checkLicense routes not-entitled -> pass gate (not the demo)', /showPassGate\s*\(\s*reason === 'exp-expired' \? 'ended' : 'start'\s*\)/.test(H));
ok('the old "Continue in demo" is gone', !/Continue in demo/.test(H));
// startPass carries the email since 94b5292 (Discovery Pass identity), so registration and
// activation can be joined without guessing by IP.
ok('startDiscoveryPass -> stride.startPass(email) -> cachePass -> unlock', /async function startDiscoveryPass\(\)[\s\S]{0,900}window\.stride\.startPass\(email\)[\s\S]{0,1400}cachePass\(r\)[\s\S]{0,200}unlockApp\(false\)/.test(H));
ok('the email is read from the field, never invented', /const emailEl = document\.getElementById\('pass-email'\);[\s\S]{0,120}emailEl\.value/.test(H));
// The safety property of that commit: the pass is granted on the DEVICE HASH alone, and a
// mismatched or absent address is advisory only. If identity could ever gate the pass, a
// typo would cost a real user their trial.
ok('identity is advisory: a mismatch NEVER blocks the pass', /A mismatch never blocks the pass/.test(H));
ok('and it gets exactly one correction attempt, not a nag loop', /__passEmailRetried/.test(H));
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

// ── bought-during-pass: activation must be reachable (P0 fix) ──
ok('active-pass banner has an Activate button (a buyer can enter their key)', /id="pass-banner"[\s\S]{0,700}showActivationForm\(\)[\s\S]{0,240}Activate/.test(H));
ok('paid activation supersedes the pass (stops countdown + hides banner)', /await cacheLicense\(key, result\);\s*_sdHidePassBanner\(\)/.test(H) && /function _sdHidePassBanner\(\)[\s\S]{0,220}clearInterval\(_passTimer\)[\s\S]{0,140}pass-banner[\s\S]{0,60}add\('hidden'\)/.test(H));
ok('showActivationForm reveals the overlay (works from the banner while unlocked)', /function showActivationForm\(\)[\s\S]{0,340}o\.style\.display\s*=\s*'flex'/.test(H));
ok('Back from banner-activate returns to full, not the start screen', /_sdActivateOverBanner[\s\S]{0,240}o\.style\.display\s*=\s*'none'/.test(H));

// ── activation is a visible second path, not a buried 10px link ──
// Window widened from 1500: the email field now sits between the card and the divider.
ok('pass-start: Activate promoted to an outlined button under an "Already purchased?" divider', /id="pass-start"[\s\S]{0,3200}Already purchased\?[\s\S]{0,320}onclick="showActivationForm\(\)"[\s\S]{0,240}Activate Your License/.test(H));
ok('pass-start: the email field sits in the card, with a note slot for the retry', /id="pass-email"/.test(H) && /id="pass-email-note"/.test(H));
ok('pass-ended: Activate promoted the same way', /id="pass-ended"[\s\S]{0,1300}Already purchased\?[\s\S]{0,320}onclick="showActivationForm\(\)"[\s\S]{0,240}Activate Your License/.test(H));
ok('the buried "Have a license? Activate →" text-link is gone', !/Have a license\? Activate →/.test(H));
ok('both pass screens carry the visible Activate button', (H.match(/Activate Your License/g) || []).length >= 2);

console.log('  ' + passed + ' passed, ' + failed + ' failed');
process.exit(failed ? 1 : 0);
