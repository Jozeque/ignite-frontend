/* Google consent mode v2: what we tell Google the visitor agreed to.
 *
 * Until 2026-09-22 the backend sent CONSENT_GRANTED on every conversion and the site
 * asked nobody anything. About two thirds of paying customers bill from the EEA, the UK
 * or Switzerland, where Google's EU user consent policy wants a real answer, so the
 * claim was wrong for most of the people it was made about.
 *
 * The rules that cost either money or honesty if they break:
 *   - the consent defaults must run BEFORE the Google tag. After it, the tag has already
 *     decided how to behave and the declaration is decoration.
 *   - the denied default is region-scoped and the granted one is not, so the rest of the
 *     world is untouched and sees no banner at all.
 *   - a stored answer is replayed synchronously on the next page, or a visitor who said
 *     no gets measured anyway the moment they navigate.
 *   - the two buttons stay the same size and weight. Making "accept" the loud one is the
 *     dark pattern these rules exist to stop.
 *   - this governs GOOGLE tags only: the Meta Pixel and Clarity are deliberately
 *     untouched, and a change that starts gating them is a decision, not a tidy-up.
 *
 * The block is EXECUTED here against a stub DOM, not just pattern-matched, because the
 * thing worth testing is what lands in dataLayer.
 *
 *   node test/consent-mode.test.js
 */
'use strict';

const fs = require('fs');
const path = require('path');
const vm = require('vm');

const ROOT = path.join(__dirname, '..');
let PASSED = 0, FAILED = 0;

function ok(name, cond, detail) {
  if (cond) { PASSED++; return; }
  FAILED++;
  console.log('  FAIL  ' + name + (detail ? '  -- ' + detail : ''));
}

const PAGES = ['index.html', 'answer.html', 'blog.html', 'privacy.html', 'refund.html',
               'samples.html', 'session.html', 'setup.html', 'terms.html', 'welcome.html',
               'post/index.html', 'post2/index.html', 'try/index.html'];
const FILES = [].concat(PAGES.map(p => 'frontend/' + p), PAGES);

const BLOCK_RE = /<script>\n(\(function \(\) \{\n    window\.dataLayer[\s\S]*?\}\)\(\);)\n<\/script>/;

// ── every page carries it, above the tag it governs ───────────────────────────
for (const file of FILES) {
  const src = fs.readFileSync(path.join(ROOT, file), 'utf8');
  const where = file + ': ';

  const block = src.match(BLOCK_RE);
  ok(where + 'the consent block is present', !!block);
  if (!block) continue;

  ok(where + 'consent is declared BEFORE the Google Tag Manager snippet',
     src.indexOf('strideConsentAds') < src.indexOf("'GTM-5R4N7FVP'"));
  ok(where + 'and before the GA4 gtag config',
     src.indexOf('strideConsentAds') < src.indexOf('G-JCMEXN70CM'));

  // The hard rule: nothing here may add a GA4 config or a second Clarity tag.
  ok(where + 'it adds no GA4 config of its own',
     (src.match(/gtag\('config', 'G-JCMEXN70CM'\)/g) || []).length === 1);
  ok(where + 'it adds no second Clarity tag',
     (src.match(/clarity\.ms\/tag/g) || []).length === 1);
  ok(where + 'it does not touch the Meta Pixel',
     !/stride-consent[\s\S]{0,4000}fbq\(/.test(block[1]));
}

// ── what actually lands in dataLayer ──────────────────────────────────────────
const SRC = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8').match(BLOCK_RE)[1];

function run({ stored = null, timeZone = 'Europe/Berlin', throwStorage = false,
              cta = null, width = 1280, height = 900 } = {}) {
  const listeners = {};
  const winListeners = {};
  const created = [];
  const store = {};
  const timers = [];
  let observed = false;
  if (stored) store['stride_consent_ads'] = stored;

  const el = () => {
    const node = {
      style: {}, attrs: {}, children: [], _html: '', id: '', textContent: '',
      classes: new Set(),
      classList: null,
      setAttribute(k, v) { this.attrs[k] = v; },
      getAttribute(k) { return this.attrs[k] === undefined ? null : this.attrs[k]; },
      appendChild(c) { this.children.push(c); },
      addEventListener(ev, fn) { this._click = fn; },
      remove() { this.removed = true; },
      _on() { return this.classes.has('on'); },
      set innerHTML(v) { this._html = v; },
      get innerHTML() { return this._html; }
    };
    node.classList = {
      add: c => node.classes.add(c),
      remove: c => node.classes.delete(c),
      contains: c => node.classes.has(c)
    };
    created.push(node);
    return node;
  };

  const sandbox = {
    Intl: { DateTimeFormat: () => ({ resolvedOptions: () => ({ timeZone }) }) },
    localStorage: {
      getItem(k) { if (throwStorage) throw new Error('blocked'); return store[k] || null; },
      setItem(k, v) { if (throwStorage) throw new Error('blocked'); store[k] = v; }
    },
    innerWidth: width,
    innerHeight: height,
    addEventListener(ev, fn) { winListeners[ev] = fn; },
    // The homepage's buy bar. `cta` is its rect, or null when the page has no bar.
    MutationObserver: class {
      constructor(fn) { this.fn = fn; }
      observe() { observed = true; }
    },
    document: {
      cookie: '',
      readyState: 'complete',
      head: el(),
      body: el(),
      createElement: () => el(),
      getElementById: (id) => (id === 'm-cta' && cta
        ? { getBoundingClientRect: () => cta, tagName: 'DIV' } : null),
      addEventListener(ev, fn) { listeners[ev] = fn; }
    },
    // Timers are recorded, not fired, so a test can assert WHEN something is meant to
    // happen and then run it deliberately. A real setTimeout here would make the
    // entrance and the fade-out race the assertions.
    setTimeout: (fn, ms) => { timers.push({ fn, ms }); return 0; },
    _timers: timers,
    console
  };
  sandbox.window = sandbox;
  vm.createContext(sandbox);
  vm.runInContext(SRC, sandbox);
  return { sandbox, created, store, winListeners, observed: () => observed,
           banner: created.find(n => n.id === 'stride-consent') };
}

const fresh = run();
const dl = fresh.sandbox.dataLayer;

// gtag() pushes the Arguments object itself; that shape is what gtag.js reads.
const consentCalls = dl.filter(a => a[0] === 'consent').map(a => [a[1], a[2]]);
const defaults = consentCalls.filter(c => c[0] === 'default');

ok('two defaults are declared', defaults.length === 2);

const denied = defaults.find(d => d[1].ad_storage === 'denied');
const granted = defaults.find(d => d[1].ad_storage === 'granted');

ok('the denied default covers all four consent types',
   denied && denied[1].ad_user_data === 'denied' && denied[1].ad_personalization === 'denied'
   && denied[1].analytics_storage === 'denied');

ok('the denied default is region-scoped, the granted one is not',
   denied && Array.isArray(denied[1].region) && granted && granted[1].region === undefined);

ok('the region is the EU 27 plus the rest of the EEA, the UK and Switzerland',
   denied && denied[1].region.length === 32
   && ['DE', 'FR', 'SE', 'ES', 'IE', 'GB', 'CH', 'NO', 'IS', 'LI']
        .every(c => denied[1].region.includes(c))
   && !denied[1].region.includes('US') && !denied[1].region.includes('IL'));

ok('the denied default waits for a stored answer before tags fire',
   denied && denied[1].wait_for_update === 500);

ok('a fresh visitor has made no choice yet',
   fresh.sandbox.strideConsentAds() === ''
   && !consentCalls.some(c => c[0] === 'update'));

// ── a returning visitor ───────────────────────────────────────────────────────
for (const answer of ['granted', 'denied']) {
  const back = run({ stored: answer });
  const updates = back.sandbox.dataLayer.filter(a => a[0] === 'consent' && a[1] === 'update');
  ok('a stored "' + answer + '" is replayed on the next page',
     updates.length === 1 && updates[0][2].ad_user_data === answer
     && updates[0][2].ad_personalization === answer
     && updates[0][2].ad_storage === answer && updates[0][2].analytics_storage === answer);
  ok('a returning "' + answer + '" visitor is not asked again', !back.banner);
  ok('the checkout can read the stored "' + answer + '"',
     back.sandbox.strideConsentAds() === answer);
}

ok('a junk stored value is treated as unanswered, never as consent',
   ['true', 'yes', '1', 'GRANTED', ''].every(v => {
     const r = run({ stored: v });
     return r.sandbox.strideConsentAds() === ''
            && !r.sandbox.dataLayer.some(a => a[0] === 'consent' && a[1] === 'update');
   }));

// ── who gets asked ────────────────────────────────────────────────────────────
ok('a European visitor is asked', !!run({ timeZone: 'Europe/Berlin' }).banner);
ok('Iceland and the Atlantic islands are asked',
   ['Atlantic/Reykjavik', 'Atlantic/Canary', 'Atlantic/Madeira', 'Atlantic/Azores']
     .every(tz => !!run({ timeZone: tz }).banner));
ok('the rest of the world is not interrupted',
   ['Asia/Jerusalem', 'America/New_York', 'America/Sao_Paulo', 'Australia/Sydney',
    'America/Toronto'].every(tz => !run({ timeZone: tz }).banner));
ok('an unreadable timezone errs towards asking, never towards assuming',
   !!run({ timeZone: null }).banner);
ok('storage being blocked does not throw the page',
   run({ throwStorage: true }).sandbox.strideConsentAds() === '');

// ── the banner itself ─────────────────────────────────────────────────────────
const b = run().banner;
ok('the banner is a labelled dialog',
   b.getAttribute('role') === 'dialog' && !!b.getAttribute('aria-label'));
ok('it offers both answers', /data-consent="denied"/.test(b.innerHTML)
   && /data-consent="granted"/.test(b.innerHTML));
ok('it links the privacy policy', /href="\/privacy\.html"/.test(b.innerHTML));
ok('declining is worded as costing the visitor nothing',
   /nothing on the site changes/.test(b.innerHTML));
ok('the copy stays one short line, not a wall of vendor names',
   b.innerHTML.replace(/<[^>]*>/g, '').trim().length < 130);
ok('no em dashes anywhere in the banner copy', !/\u2014/.test(b.innerHTML));

const css = run().created.map(n => n.textContent).join('');
ok('both buttons share one size and weight, so neither is the loud one',
   /#stride-consent button\{flex:1 1 0;[^}]*font-weight:700/.test(css));
ok('neither button is singled out by colour either',
   // An orange "accept" beside a hollow "decline" is exactly the nudge regulators
   // fined Google over. No per-answer style rule may exist at all.
   !/\[data-consent=/.test(css));

// ── it looks like Stride, not like a compliance widget ────────────────────────
ok('the panel, hairline, raise and copper are the page tokens',
   /background:var\(--panel,#1d1b16\)/.test(css)
   && /border:1px solid var\(--line,rgba\(216,201,176,\.11\)\)/.test(css)
   && /background:var\(--raise,#252119\)/.test(css)
   && /color:var\(--copper-lt,#dd9a52\)/.test(css));
ok('every token carries a literal fallback, for the three Tailwind legal pages',
   (css.match(/var\(--[a-z0-9-]+,/g) || []).length ===
   (css.match(/var\(--/g) || []).length);
ok('it uses the same shadow as the 24h popup', /0 30px 70px -30px rgba\(0,0,0,\.85\)/.test(css));
ok('it is a corner panel, not a full-width bar across the page',
   /width:min\(372px/.test(css) && !/right:16px/.test(css));
ok('it rises in rather than being there on first paint',
   /opacity:0;transform:translateY\(12px\)/.test(css)
   && /#stride-consent\.on\{opacity:1;transform:none\}/.test(css));
ok('reduced motion turns the movement off', /prefers-reduced-motion:reduce/.test(css));

const shown = run();
ok('the panel is not visible on the very first frame', !shown.banner._on());
ok('it is shown after the page has had a moment to paint',
   shown.sandbox._timers.some(t => t.ms === 700));
shown.sandbox._timers.filter(t => t.ms === 700).forEach(t => t.fn());
ok('and then it is on', shown.banner._on());

// ── answering it ──────────────────────────────────────────────────────────────
for (const answer of ['granted', 'denied']) {
  const r = run();
  r.banner._click({ target: { getAttribute: () => answer } });
  const updates = r.sandbox.dataLayer.filter(a => a[0] === 'consent' && a[1] === 'update');
  ok('choosing "' + answer + '" updates all four consent types',
     updates.length === 1
     && ['ad_storage', 'ad_user_data', 'ad_personalization', 'analytics_storage']
          .every(k => updates[0][2][k] === answer));
  ok('choosing "' + answer + '" is remembered', r.store['stride_consent_ads'] === answer
     && r.sandbox.strideConsentAds() === answer);
  ok('choosing "' + answer + '" also writes a cookie the other pages can read',
     /stride_consent_ads=/.test(r.sandbox.document.cookie)
     && /SameSite=Lax/.test(r.sandbox.document.cookie));
  ok('choosing "' + answer + '" announces it on the dataLayer',
     r.sandbox.dataLayer.some(e => e && e.event === 'stride_consent'
                                   && e.consent_ads === answer));
  ok('choosing "' + answer + '" starts the panel leaving', !r.banner._on());
  r.sandbox._timers.filter(t => t.ms === 260).forEach(t => t.fn());
  ok('choosing "' + answer + '" then removes it', r.banner.removed === true);
}

// ── the answer reaches the backend ────────────────────────────────────────────
for (const file of ['frontend/index.html', 'index.html']) {
  const src = fs.readFileSync(path.join(ROOT, file), 'utf8');
  const where = file + ': ';
  ok(where + 'the buyer_lead beacon carries the answer',
     /consent_ads: \(window\.strideConsentAds \? window\.strideConsentAds\(\) : ''\),/.test(src));
  ok(where + 'the checkout URL carries it too, for when the beacon is dropped',
     /checkout\[custom\]\[consent_ads\]/.test(src));
  ok(where + 'the express button carries it', /out\.consent_ads = _consentAns/.test(src));
}
for (const file of ['frontend/try/index.html', 'try/index.html']) {
  const src = fs.readFileSync(path.join(ROOT, file), 'utf8');
  ok(file + ': the demo registration carries the answer',
     /body\.consent_ads = _consentAns/.test(src));
}

// ── it must not sit on top of the buy bar ─────────────────────────────────────
// Found by loading the real homepage, not by any unit test: the panel at bottom:18px
// landed squarely on #m-cta and hid "GET STRIDE" behind a cookie notice.
const BAR = { top: 823, bottom: 884, left: 0, right: 784, height: 61 };

const noBar = run();
ok('with no buy bar on the page, the panel sits at its normal offset',
   noBar.banner.style.bottom === '18px');

const withBar = run({ cta: BAR, height: 884 });
ok('when the buy bar is on screen, the panel rises above it',
   withBar.banner.style.bottom === (18 + BAR.height + 10) + 'px');

const barGone = run({ cta: { top: 893, bottom: 954, left: 0, right: 784, height: 61 },
                      height: 884 });
ok('a bar that has slid out of view below the fold is not counted',
   // Its bottom edge is still past the fold, so a bottom-edge test alone says "there".
   barGone.banner.style.bottom === '18px');

const phone = run({ cta: BAR, width: 375, height: 884 });
ok('the phone offset is the phone one, plus the bar',
   phone.banner.style.bottom === (12 + BAR.height + 10) + 'px');

ok('the panel re-measures on scroll and on resize',
   typeof withBar.winListeners.scroll === 'function'
   && typeof withBar.winListeners.resize === 'function');
ok('and watches the bar itself, which is switched by a class, not by scrolling',
   withBar.observed() === true);
ok('a page with no bar sets up no observer', noBar.observed() === false);
ok('moving is animated, so the panel does not jump when the bar arrives',
   /transition:[^}]*bottom \.25s ease/.test(css));


console.log(PASSED + ' passed, ' + FAILED + ' failed');
process.exit(FAILED ? 1 : 0);
