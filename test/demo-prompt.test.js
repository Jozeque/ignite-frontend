/* The 30-second demo prompt on the homepage.
 *
 * The homepage rule is that the /try email form never moves onto it, because registration
 * and its paired fbq Lead/DemoRegistered events with one shared event_id belong to /try
 * alone. This prompt honours that literally: it collects an ADDRESS and nothing else, then
 * hands off to /try, which does every part of the registration exactly as it always has.
 * So the checks below are mostly about what the homepage must NOT contain.
 *
 * The other rules, learned this week:
 *   - a visitor holding a discount code is never interrupted; they arrived on a paid click
 *     to buy at 20% off and a free demo competes with the click that was paid for
 *   - the address never travels in a URL, where GA4 page paths, the pixel and referrer
 *     headers would all pick it up
 *   - nothing about the prompt may move the page: it is fixed, last in the body, hidden
 *
 *   node test/demo-prompt.test.js
 */
'use strict';

const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
let PASSED = 0, FAILED = 0;

function ok(name, cond, detail) {
  if (cond) { PASSED++; return; }
  FAILED++;
  console.log('  FAIL  ' + name + (detail ? '  -- ' + detail : ''));
}

// ── the homepage ───────────────────────────────────────────────────────────────
for (const file of ['frontend/index.html', 'index.html']) {
  const src = fs.readFileSync(path.join(ROOT, file), 'utf8');
  const where = file + ': ';

  ok(where + 'the copy is the copy that was asked for',
     /<h2 class="dpop-h" id="dpop-h">Try Stride free for 24h<\/h2>/.test(src)
     && /<p class="dpop-s">Get endless sound design variations in seconds\.<\/p>/.test(src)
     && /id="dpop-go" type="submit">Try free<\/button>/.test(src));
  ok(where + 'no em dash crept into it',
     !/dpop-[hs]"[^>]*>[^<]*[—–]/.test(src));

  ok(where + 'the timer is 30 seconds', /var SECONDS = 30;/.test(src));
  ok(where + 'and counts only time the page is actually looked at',
     /if \(document\.hidden\) return;/.test(src));

  // The rule that matters most commercially.
  ok(where + 'a discount code silences it',
     /function hasCode\(\)/.test(src)
     && /if \(hasCode\(\) \|\| alreadyDone\(\)\) return;/.test(src)
     && /if \(hasCode\(\) \|\| alreadyDone\(\)\) clearInterval\(tick\);/.test(src));
  ok(where + 'and it checks the URL itself, not only the pricing script',
     /window\.STRIDE_CODE_ACTIVE/.test(src)
     && /searchParams\.get\('code'\)[\s\S]{0,40}\}\s*\n\s*catch/.test(src));
  ok(where + 'holding a code is NOT remembered as having been asked',
     src.indexOf('function hasCode()') < src.indexOf('function alreadyDone()')
     && !/hasCode\(\)[\s\S]{0,80}remember\(\)/.test(src));

  ok(where + 'nobody is asked twice',
     /localStorage\.getItem\(SEEN_KEY\)/.test(src) && /function remember\(\)/.test(src));
  ok(where + 'and nobody who already has the demo is asked at all',
     /localStorage\.getItem\('stride_try_email'\)/.test(src)
     && /localStorage\.getItem\('stride_try_dl'\)/.test(src));

  ok(where + 'it never opens over a checkout',
     /function busy\(\)/.test(src)
     && /getElementById\('buy-modal'\)/.test(src)
     && /iframe\[src\*="paddle"\]/.test(src)
     && /if \(busy\(\)\) \{ setTimeout\(open, 5000\); return; \}/.test(src));
  ok(where + 'and the always-mounted express wallet is not mistaken for one',
     /paddle-express-checkout'\)\) continue;/.test(src));

  // The address must not end up anywhere it can be read back.
  ok(where + 'the address is handed over in sessionStorage, never a URL',
     /sessionStorage\.setItem\(HANDOFF, email\)/.test(src)
     && /window\.location\.href = '\/try\?auto=1';/.test(src));
  ok(where + 'no address is ever put in a query string',
     !/email=' \+|email=" \+|\?email=|&email=/.test(src));

  // The standing rule: registration and its events stay on /try.
  ok(where + 'the homepage does NOT register anyone',
     !/demo_register/.test(src));
  // The event NAMES appear in the comments explaining why they are not here, so this
  // looks for the calls themselves rather than the words.
  ok(where + 'and fires no demo conversion events of its own',
     !/fbq\(\s*'track'\s*,\s*'Lead'/.test(src)
     && !/fbq\(\s*'trackCustom'\s*,\s*'DemoRegistered'/.test(src)
     && !/StrideTrack\.push\('demo_registered'\)/.test(src));

  // It must not be able to move the page.
  ok(where + 'the overlay is fixed and hidden until it fires',
     /\.dpop\{position:fixed;inset:0;z-index:120;display:none/.test(src)
     && /\.dpop\.on\{display:flex\}/.test(src));
  ok(where + 'and it is the last thing in the body',
     src.indexOf('id="dpop"') > src.indexOf('<section')
     && src.indexOf('id="dpop"') > src.lastIndexOf('</footer>'));
  ok(where + 'it can be dismissed by button, backdrop and Escape',
     /getElementById\('dpop-x'\)\.addEventListener\('click'/.test(src)
     && /if \(ev\.target === pop\) close\(\)/.test(src)
     && /ev\.key === 'Escape'/.test(src));
  ok(where + 'it restores the page scroll when it closes',
     /document\.body\.style\.overflow = '';/.test(src));
}

// ── /try, which does the actual work ───────────────────────────────────────────
const tryPage = fs.readFileSync(path.join(ROOT, 'try/index.html'), 'utf8');

ok('/try picks the handoff up from storage',
   /sessionStorage\.getItem\('stride_demo_email'\)/.test(tryPage));
ok('/try only does so for ?auto=1',
   /new URLSearchParams\(location\.search\)\.get\('auto'\) === '1'/.test(tryPage));
ok('/try consumes the handoff so it cannot be replayed',
   /sessionStorage\.removeItem\('stride_demo_email'\)/.test(tryPage));
ok('/try takes the marker off the URL',
   /history\.replaceState\(null, '', '\/try'\);/.test(tryPage));
ok('/try runs its OWN existing submit, rather than a second code path',
   /form\.dispatchEvent\(new Event\('submit', \{ cancelable: true \}\)\)/.test(tryPage));
ok('/try still owns the registration and both conversion events',
   /body\.action = 'demo_register';/.test(tryPage)
   && /fbq\('track', 'Lead'/.test(tryPage)
   && /fbq\('trackCustom', 'DemoRegistered'/.test(tryPage));
ok('/try still shares one event_id between the browser and the server halves',
   /body\.event_id = eid;/.test(tryPage) && /\{ eventID: eid \}/.test(tryPage));

console.log('  ' + PASSED + ' passed, ' + FAILED + ' failed');
process.exit(FAILED ? 1 : 0);
