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
     /<h2 class="dpop-h" id="dpop-h">Try Stride free <span class="brand">for 24h<\/span><\/h2>/.test(src)
     && /<p class="dpop-s">Get endless sound design variations in seconds\.<\/p>/.test(src)
     && /id="dpop-go" type="submit">Try free<\/button>/.test(src));

  // It has to look like /try, not like a generic modal.
  ok(where + 'the 24h carries the same copper gradient /try uses',
     /<span class="brand">for 24h<\/span>/.test(src)
     && /\.brand\{background:linear-gradient\(90deg,var\(--copper-lt\),var\(--ember\)\)/.test(src));
  ok(where + 'every line in the panel is centred, as /try\'s hero is',
     /\.dpop-card\{[^}]*text-align:center/.test(src));
  ok(where + 'and the form centres with it',
     /\.dpop-f\{display:flex;gap:10px;flex-wrap:wrap;justify-content:center\}/.test(src));
  // On a phone the field fills the row, so an inline-width button wrapped under it and
  // sat off to the left.
  ok(where + 'on a phone the button is as wide as the field, not left-aligned',
     /@media \(max-width:560px\)\{\s*\n?\s*\.dpop-f input,\s*\n?\s*\.dpop-f \.btn-copper\{flex:1 1 100%;width:100%\}/.test(src)
     && /\.dpop-f \.btn-copper\{justify-content:center\}/.test(src));
  ok(where + 'no em dash crept into it',
     !/dpop-[hs]"[^>]*>[^<]*[—–]/.test(src));

  // The objection a 24-hour pass creates: it sounds like a crippled build.
  ok(where + 'the prompt says it is the full version and the work is kept',
     /<strong>The full version of Stride\.<\/strong> Inject the automation you\s*\n?\s*build in these 24 hours straight into your clips, and keep it forever\./.test(src));
  ok(where + 'and says it with INJECT, never the dead drag or .alc wording',
     !/drag/i.test((src.match(/class="dpop-keep"[\s\S]{0,260}<\/p>/) || [''])[0])
     && !/\.alc/i.test((src.match(/class="dpop-keep"[\s\S]{0,260}<\/p>/) || [''])[0]));

  ok(where + 'the threshold is 30 seconds', /var SECONDS = 30;/.test(src));

  // 30 seconds ON the page, added up. Someone who reads for ten seconds, leaves and comes
  // back has spent ten, and must NOT be shown the panel the instant they return.
  ok(where + 'only time spent on the page is counted',
     /if \(document\.hidden\) return;\s*\n\s*active \+= 1;/.test(src)
     && /if \(active < SECONDS\) return;/.test(src));
  ok(where + 'the total is carried across a navigation, not restarted',
     /var SECS_KEY = 'stride_demo_secs';/.test(src)
     && /parseInt\(sessionStorage\.getItem\(SECS_KEY\) \|\| '0', 10\)/.test(src)
     && /sessionStorage\.setItem\(SECS_KEY, String\(active\)\)/.test(src));
  ok(where + 'and leaving mid-count keeps what was earned',
     /visibilitychange', function \(\) \{ if \(document\.hidden\) saveSecs\(\); \}/.test(src)
     && /addEventListener\('pagehide', saveSecs\)/.test(src));
  ok(where + 'storage is written every few seconds, not every tick',
     /if \(active % 5 === 0\) saveSecs\(\);/.test(src));
  // "Cannot check storage" must not become "never show".
  ok(where + 'a browser that refuses storage still gets the prompt',
     /\}, false\);\s*\n\s*\}/.test(src.slice(src.indexOf('function alreadyDone()'),
                                             src.indexOf('function alreadyDone()') + 700)));

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

// The same promise as the prompt, so the two pages do not contradict each other.
const keep = (tryPage.match(/class="keepline"[\s\S]{0,300}?<\/p>/) || [''])[0];
ok('/try makes the same full-version promise',
   /<strong>The full version of Stride\.<\/strong>/.test(keep)
   && /straight into your clips, and keep it forever\./.test(keep));
ok('/try says it before the form, not after',
   tryPage.indexOf('class="keepline"') > 0
   && tryPage.indexOf('class="keepline"') < tryPage.indexOf('<form id="f"'));
ok('/try uses INJECT, never drag or .alc',
   !/drag/i.test(keep) && !/\.alc/i.test(keep));
ok('/try gives its button the full row on a phone too',
   /#f input\[type=email\], #f \.btn-copper\{flex:1 1 100%;width:100%\}/.test(tryPage)
   && /#f\{justify-content:center\}/.test(tryPage));
ok('neither page contradicts the other',
   keep.replace(/\s+/g, ' ').indexOf('Inject the automation you build in these 24 hours '
     + 'straight into your clips, and keep it forever.') > 0);

console.log('  ' + PASSED + ' passed, ' + FAILED + ' failed');
process.exit(FAILED ? 1 : 0);
