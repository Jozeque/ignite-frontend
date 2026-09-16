/* The post-purchase funnel, run for real.
 *
 * On 2026-09-16 the first live buyer was redirected to /post, told the offer did not
 * exist, and sent straight on to /welcome. Paddle redirects the moment the payment
 * clears, which was four seconds before the webhook created the offer record, and the
 * page treated "not born yet" exactly like "there is no offer".
 *
 * These are not string checks. The page's own inline scripts are lifted out of the HTML
 * and executed against a stub browser, so the race, the wallet path and every early exit
 * are exercised as the buyer meets them.
 *
 *   node test/post-purchase-funnel.test.js
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

// ── lifting the page's own scripts out of the HTML ───────────────────────────
function scripts(file) {
  const html = fs.readFileSync(path.join(ROOT, file), 'utf8');
  const re = /<script(?![^>]*\bsrc=)(?![^>]*\btype=)[^>]*>([\s\S]*?)<\/script>/gi;
  const out = [];
  let m;
  while ((m = re.exec(html)) !== null) out.push(m[1]);
  return out;
}
// By CONTENT, never by index: a new tag in <head> must not silently retarget a test.
function scriptWith(file, needle) {
  const hit = scripts(file).filter(s => s.includes(needle));
  if (hit.length !== 1) {
    throw new Error(`${file}: ${hit.length} inline scripts contain ${needle}, expected 1`);
  }
  return hit[0];
}

// ── a stub browser, only as much of one as these pages touch ─────────────────
function store() {
  const m = new Map();
  return {
    _m: m,
    getItem: k => (m.has(k) ? m.get(k) : null),
    setItem: (k, v) => m.set(k, String(v)),
    removeItem: k => m.delete(k),
  };
}

function element() {
  const set = new Set();
  return {
    textContent: '', hidden: false, _href: null, _listeners: {},
    classList: { add: c => set.add(c), remove: c => set.delete(c), contains: c => set.has(c) },
    setAttribute(k, v) { if (k === 'href') this._href = v; this['_' + k] = v; },
    removeAttribute(k) { delete this['_' + k]; },
    addEventListener(ev, fn) { (this._listeners[ev] = this._listeners[ev] || []).push(fn); },
    click() { (this._listeners.click || []).forEach(fn => fn.call(this)); },
  };
}

// One fetch for the whole page. Offer lookups walk `plan` and then repeat its last entry;
// every stage call is answered ok and recorded, which is how the funnel is asserted.
function fetcher(plan) {
  const sent = [];
  const queue = plan.slice();
  function fetch(url, opts) {
    let body = {};
    try { body = JSON.parse(opts.body); } catch (e) {}
    sent.push(body);
    if (body.action === 'offer_stage') {
      return Promise.resolve({ json: () => Promise.resolve({ ok: true }) });
    }
    const answer = queue.length > 1 ? queue.shift() : queue[0];
    if (answer instanceof Error) return Promise.reject(answer);
    return Promise.resolve({ json: () => Promise.resolve(answer) });
  }
  return {
    fetch, sent,
    stages: () => sent.filter(b => b.action === 'offer_stage').map(b => b.stage),
    lookups: () => sent.filter(b => b.action !== 'offer_stage'),
  };
}

function browser(href, seed) {
  const els = new Map();
  const ctx = {
    console, URL, URLSearchParams, Intl, JSON, Date, Math, Promise, Object, Number, String,
    setTimeout, clearTimeout, setInterval, clearInterval,
    sessionStorage: store(), localStorage: store(),
    history: { replaceState(_s, _t, url) { ctx.window.location._rewritten = url; } },
    document: {
      querySelector(sel) {
        if (!els.has(sel)) els.set(sel, element());
        return els.get(sel);
      },
      addEventListener() {},
    },
    _els: els,
  };
  ctx.window = ctx;
  ctx.globalThis = ctx;
  const u = new URL(href);
  ctx.window.location = {
    href, search: u.search, pathname: u.pathname, _replaced: null, _rewritten: null,
    replace(to) { if (!this._replaced) this._replaced = to; },
  };
  ctx.location = ctx.window.location;
  Object.keys(seed || {}).forEach(k => ctx.sessionStorage.setItem(k, seed[k]));
  vm.createContext(ctx);
  return ctx;
}

const q = (ctx, sel) => ctx.document.querySelector(sel);
const wait = ms => new Promise(r => setTimeout(r, ms));

const OPEN = {
  ok: true, status: 'open', expires_at_ms: Date.now() + 72 * 3600000, server_now_ms: Date.now(),
  collection: { status: 'open', list_price: { amount: '7699', currency: 'ILS', formatted: '₪76.99' },
                offer_price: { amount: '5854', currency: 'ILS', formatted: '₪58.54' } },
  session: { status: 'open', owner_price: { amount: '30900', currency: 'ILS', formatted: '₪309.00' },
             standard_price: { amount: '61900', currency: 'ILS', formatted: '₪619.00' } },
};
const NOT_YET = { ok: true, status: 'invalid', server_now_ms: Date.now() };
const clone = o => JSON.parse(JSON.stringify(o));

// Synthetic, and it must stay that way: this file ships with the site, so anything real
// here is a working credential for somebody's owner price, readable at stridehub.io/test/.
const PTXN = 'txn_01aaaaaaaaaaaaaaaaaaaaaaaa';
// These five must match the stages the backend accepts. Anything a page
// sends that is not on this list is dropped by the backend and silently never recorded.
const STAGES = ['post_viewed', 'post_skipped', 'post_checkout', 'welcome_viewed', 'session_viewed'];

console.log('post-purchase-funnel.test.js');

// Top-level await is ESM only, and this file is CommonJS by choice: no build step, no
// dependencies, `node test/post-purchase-funnel.test.js` and nothing else.
(async function () {

// ══ 1. /post reads Paddle's own ?_ptxn= ══════════════════════════════════════
const POST_HEAD = scriptWith('post/index.html', "searchParams.has('_ptxn')");
const POST_OFFER = scriptWith('post/index.html', 'post_purchase_offers');

{
  const ctx = browser('https://stridehub.io/post/?_ptxn=' + PTXN);
  vm.runInContext(POST_HEAD, ctx);
  ok('the transaction is taken off the success URL Paddle sent',
    ctx.window.STRIDE_POST_TXN === PTXN && ctx.sessionStorage.getItem('stride_last_txn') === PTXN);
  ok('and the parameter is stripped, so Paddle cannot reopen the paid checkout over the offer',
    ctx.window.location._rewritten === '/post/');
}
{
  const ctx = browser('https://stridehub.io/post/?_ptxn=not-a-transaction');
  vm.runInContext(POST_HEAD, ctx);
  ok('a malformed id is kept out of storage and still stripped from the URL',
    !ctx.window.STRIDE_POST_TXN && ctx.sessionStorage.getItem('stride_last_txn') === null
    && ctx.window.location._rewritten === '/post/');
}
{
  const ctx = browser('https://stridehub.io/post/');
  vm.runInContext(POST_HEAD, ctx);
  ok('no parameter, no rewrite and nothing invented', ctx.window.location._rewritten === null);
}
{
  const html = fs.readFileSync(path.join(ROOT, 'post/index.html'), 'utf8');
  ok('the capture runs before paddle.js, which is the whole point of it being in <head>',
    html.indexOf('_ptxn') < html.indexOf('cdn.paddle.com/paddle/v2/paddle.js'));
}

// ══ 2. the race the first live buyer lost ════════════════════════════════════
async function runPost(opts) {
  const ctx = browser(opts.href || 'https://stridehub.io/post/', opts.seed);
  const f = fetcher(opts.plan || [clone(OPEN)]);
  ctx.fetch = f.fetch;
  ctx.StrideTrack = { push() {} };
  vm.runInContext(POST_HEAD, ctx);
  vm.runInContext(POST_OFFER, ctx);
  await wait(opts.settle || 60);
  return { ctx, f };
}

{
  // Two "not born yet" answers, then the webhook lands. STEP is 600ms in the page.
  const { ctx, f } = await runPost({
    seed: { stride_last_txn: PTXN },
    plan: [clone(NOT_YET), clone(NOT_YET), clone(OPEN)],
    settle: 1500,
  });
  ok('an offer that does not exist YET is asked for again, not treated as no offer',
    f.lookups().length === 3, f.lookups().length + ' lookups');
  ok('the buyer is not sent away while it is still being made',
    ctx.window.location._replaced === null);
  ok('and the offer renders once it lands, at the price the server gave',
    q(ctx, '#offer').classList.contains('ready')
    && q(ctx, '[data-now]').textContent === '₪58.54'
    && q(ctx, '[data-was]').textContent === '₪76.99'
    && q(ctx, '[data-cta-price]').textContent === '₪58.54');
  ok('reaching the offer is recorded against the purchase',
    f.stages().includes('post_viewed')
    && f.sent.some(b => b.action === 'offer_stage' && b.txn === PTXN));
}

{
  // The wallet and new-tab paths: checkout.completed never reached the page that opened
  // the checkout, so sessionStorage is empty and the URL is the only witness.
  const { ctx, f } = await runPost({ href: 'https://stridehub.io/post/?_ptxn=' + PTXN });
  ok('with nothing in storage, the URL alone still resolves the offer',
    f.lookups().length === 1 && f.lookups()[0].txn === PTXN
    && q(ctx, '#offer').classList.contains('ready') && ctx.window.location._replaced === null);
}

{
  const { ctx, f } = await runPost({ plan: [clone(OPEN)] });
  ok('no transaction anywhere is the one case that leaves at once, asking nothing',
    ctx.window.location._replaced === '/welcome.html' && f.sent.length === 0);
}

// ══ 3. every other answer is final ═══════════════════════════════════════════
for (const [label, status] of [['owned', 'owned'], ['used', 'used'], ['expired', 'expired']]) {
  const answer = clone(OPEN);
  answer.collection = { status };
  const { ctx, f } = await runPost({ seed: { stride_last_txn: PTXN }, plan: [answer], settle: 900 });
  ok(`a Collection already ${label} goes to the product at once, with no second ask`,
    ctx.window.location._replaced === '/welcome.html' && f.lookups().length === 1);
}
{
  const { ctx, f } = await runPost({
    seed: { stride_last_txn: PTXN }, plan: [{ ok: false, error: 'boom' }], settle: 900,
  });
  ok('a backend that refuses is final too: the buyer goes to the product, not into a loop',
    ctx.window.location._replaced === '/welcome.html' && f.lookups().length === 1);
}
{
  // Retrying a NETWORK failure is right (transient), but it must still end.
  const { ctx } = await runPost({
    seed: { stride_last_txn: PTXN }, plan: [new Error('offline')], settle: 1500,
  });
  ok('a dead network is retried and never strands anyone: no offer, and no crash',
    !q(ctx, '#offer').classList.contains('ready'));
}

// ══ 4. the skip is an answer worth having ════════════════════════════════════
{
  const { ctx, f } = await runPost({ seed: { stride_last_txn: PTXN } });
  q(ctx, '[data-skip]').click();
  await wait(30);
  ok('"No thanks" is recorded, so a rejected offer reads differently from an unseen one',
    f.stages().includes('post_skipped'));
  ok('every stage /post sends is one the backend knows',
    f.stages().every(s => STAGES.includes(s)), f.stages().join(','));
}

// ══ 5. /welcome carries the purchase to session.html ═════════════════════════
const RAIL = scriptWith('welcome.html', 'session-rail');
{
  const ctx = browser('https://stridehub.io/welcome.html', { stride_offer_txn: PTXN });
  const f = fetcher([clone(OPEN)]);
  ctx.fetch = f.fetch;
  ctx.document.getElementById = () => {
    const rail = element();
    rail.querySelector = sel => ctx.document.querySelector(sel);
    return rail;
  };
  vm.runInContext(RAIL, ctx);
  await wait(80);
  ok('the rail shows the owner price the server quoted',
    q(ctx, '[data-rail-now]').textContent === '₪309.00'
    && q(ctx, '[data-rail-was]').textContent === '₪619.00');
  ok('and "See what it covers" now carries the purchase, which is what kept the owner price',
    q(ctx, '.rail-link')._href === 'session.html?txn=' + PTXN);
  ok('reaching the rail is recorded', f.stages().includes('welcome_viewed'));
}
{
  const html = fs.readFileSync(path.join(ROOT, 'welcome.html'), 'utf8');
  ok('the bare link stays in the markup for anyone with no offer and no JavaScript',
    /<a href="session\.html" class="rail-link/.test(html));
}

// ══ 6. session.html accepts either name for the same offer ═══════════════════
const SESSION_HEAD = scriptWith('session.html', "searchParams.has('offer')");
const TOKEN = '0123456789abcdef0123456789abcdef';   // synthetic, see PTXN
{
  const ctx = browser('https://stridehub.io/session.html?txn=' + PTXN);
  vm.runInContext(SESSION_HEAD, ctx);
  ok('the purchase arrives from /welcome, is kept for the tab, and leaves the URL',
    ctx.window.STRIDE_SESSION_TXN === PTXN
    && ctx.sessionStorage.getItem('stride_offer_txn') === PTXN
    && ctx.window.location._rewritten === '/session.html');
}
{
  const ctx = browser('https://stridehub.io/session.html?offer=' + TOKEN);
  vm.runInContext(SESSION_HEAD, ctx);
  ok('the mailed token still works exactly as it did, and still outlives the tab',
    ctx.window.STRIDE_SESSION_OFFER === TOKEN
    && ctx.localStorage.getItem('stride_session_offer') === TOKEN
    && ctx.window.location._rewritten === '/session.html');
}
{
  const ctx = browser('https://stridehub.io/session.html?booked=1&txn=' + PTXN);
  vm.runInContext(SESSION_HEAD, ctx);
  ok('?booked=1 survives the strip, because the page still has to read it',
    ctx.window.location._rewritten === '/session.html?booked=1');
}
{
  const ctx = browser('https://stridehub.io/session.html?txn=nope');
  vm.runInContext(SESSION_HEAD, ctx);
  ok('a malformed transaction is not stored, and is still stripped',
    !ctx.window.STRIDE_SESSION_TXN && ctx.window.location._rewritten === '/session.html');
}
{
  const src = fs.readFileSync(path.join(ROOT, 'session.html'), 'utf8');
  ok('both the lookup and the checkout send whichever credential resolved the offer',
    src.includes("Object.assign({ action: 'session_offer' }, cred)")
    && src.includes("Object.assign({ action: 'session_checkout' }, offer.cred || {})"));
  ok('and no page sends a price or an expiry back to the backend',
    !/(owner_price|offer_price|expires_at_ms)\s*[:,]/.test(
      (src.match(/action: 'session_(offer|checkout)'[\s\S]{0,200}/g) || []).join('')));
}

// ══ 7. the contract with the backend ═════════════════════════════════════════
{
  const pages = ['post/index.html', 'welcome.html', 'session.html'];
  const found = new Set();
  const actions = new Set();
  for (const p of pages) {
    const src = fs.readFileSync(path.join(ROOT, p), 'utf8');
    for (const m of src.matchAll(/stage:\s*'([a-z_]+)'/g)) found.add(m[1]);
    for (const m of src.matchAll(/action:\s*'([a-z_]+)'/g)) actions.add(m[1]);
  }
  ok('every literal stage in the pages is one the backend whitelists',
    [...found].every(s => STAGES.includes(s)), [...found].join(','));
  ok('and the pages call only the four public actions the backend routes',
    [...actions].every(a =>
      ['offer_stage', 'post_purchase_offers', 'session_offer', 'session_checkout'].includes(a)),
    [...actions].join(','));
}

// ══ 8. the Collection artwork on /post ════════════════════════════════
{
  const html = fs.readFileSync(path.join(ROOT, 'post/index.html'), 'utf8');
  const sleeves = [...html.matchAll(/<figure class="sleeve"><img src="([^"]+)"/g)].map(m => m[1]);
  ok('the three covers from the /samples hero are on the page', sleeves.length === 3);
  ok('every one of them is a file that actually exists',
    sleeves.every(src => fs.existsSync(path.join(ROOT, src.replace(/^\//, '')))), sleeves.join(' '));
  // /post lives in a SUBDIRECTORY. samples.html is at the root and can say assets/packs/…;
  // copying that verbatim would resolve to /post/assets/packs/ and 404 three times.
  ok('and is referenced from the site root, because this page is not at the root',
    sleeves.every(src => src.startsWith('/assets/packs/')), sleeves.join(' '));

  const offer = html.slice(html.indexOf('id="offer"'), html.indexOf('</section>'));
  ok('the artwork sits inside the gated offer panel, so it never flashes at someone being sent away',
    offer.includes('class="stack"') && offer.split('class="sleeve"').length === 4);

  // The bug this page was built around: a script element is raw text, so &amp; is NOT
  // decoded. samples.html ships &amp;token= and its teaser 403s. Verified against the
  // live URL on 2026-09-16.
  const src = (html.match(/STRIDE_TEASER_SRC = "([^"]+)"/) || [])[1] || '';
  ok('the teaser URL carries a real token, not an HTML-escaped one',
    src.includes('&token=') && !src.includes('&amp;'), src.slice(-60));
  ok('and the file is fetched only when someone presses play',
    /<video id="teaser-v" controls playsinline preload="none"/.test(html)
    && !/<video[^>]*\bsrc=/.test(html));
}

// ── this file is published, so it must never carry a live credential ───────
{
  const self = fs.readFileSync(__filename, 'utf8');
  const txns = [...self.matchAll(/txn_[0-9a-z]{26}/g)].map(m => m[0]);
  const tokens = [...self.matchAll(/'([0-9a-f]{32})'/g)].map(m => m[1]);
  ok('every transaction id in this file is synthetic',
    txns.every(t => /^txn_01a+$/.test(t)), [...new Set(txns)].join(','));
  ok('and so is every offer token', tokens.every(t => t === '0123456789abcdef0123456789abcdef'),
    tokens.join(','));
}

// ── the root copies are what GitHub Pages actually serves ────────────────────
for (const f of ['post/index.html', 'welcome.html', 'session.html', 'index.html']) {
  const a = fs.readFileSync(path.join(ROOT, f), 'utf8');
  const b = fs.readFileSync(path.join(ROOT, 'frontend', f), 'utf8');
  ok(`${f} is in sync between frontend/ and the root that ships`, a === b);
}

console.log(`  ${PASSED} passed, ${FAILED} failed`);
process.exit(FAILED ? 1 : 0);
})();
