/* The post-purchase funnel, run for real.
 *
 *   /post    the 1:1 session offer, reached as /post/?code=sesh1o1 (the Paddle success URL)
 *   /post2   the Experimental Collection offer, kept for testing
 *   /welcome the session rail
 *   /session the session page itself
 *
 * On 2026-09-16 the first live buyer was sent straight past /post: Paddle redirects the
 * moment the payment clears, the offer record was made by a webhook four seconds later, and
 * the page read "not made yet" as "no offer". These are not string checks. The pages' own
 * inline scripts are lifted out of the HTML and run against a stub browser, so the race,
 * every exit, the code in the URL and the checkout are exercised as a buyer meets them.
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

const read = f => fs.readFileSync(path.join(ROOT, f), 'utf8');

// ── lifting the pages' own scripts out of the HTML ───────────────────────────
function scripts(file) {
  const html = read(file);
  const re = /<script(?![^>]*\bsrc=)(?![^>]*\btype=)[^>]*>([\s\S]*?)<\/script>/gi;
  const out = [];
  let m;
  while ((m = re.exec(html)) !== null) out.push(m[1]);
  return out;
}
// By CONTENT, never by index: a new tag in <head> must not silently retarget a test.
function scriptWith(file, needle) {
  const hit = scripts(file).filter(s => s.includes(needle));
  if (hit.length !== 1) throw new Error(`${file}: ${hit.length} inline scripts contain ${needle}, expected 1`);
  return hit[0];
}

// ── a stub browser, only as much of one as these pages touch ─────────────────
function store() {
  const m = new Map();
  return { _m: m, getItem: k => (m.has(k) ? m.get(k) : null),
           setItem: (k, v) => m.set(k, String(v)), removeItem: k => m.delete(k) };
}

function element() {
  const set = new Set();
  return {
    textContent: '', hidden: false, _href: null, _listeners: {},
    classList: { add: c => set.add(c), remove: c => set.delete(c), contains: c => set.has(c) },
    setAttribute(k, v) { this['_' + k] = v; },
    removeAttribute(k) { delete this['_' + k]; },
    addEventListener(ev, fn) { (this._listeners[ev] = this._listeners[ev] || []).push(fn); },
    click() { (this._listeners.click || []).forEach(fn => fn.call(this, { preventDefault() {} })); },
  };
}

// One fetch for the whole page, answered BY ACTION. Each action walks its own list and then
// repeats the last entry; stage calls are answered ok and recorded.
function fetcher(routes) {
  const sent = [];
  const queues = {};
  for (const k of Object.keys(routes)) queues[k] = routes[k].slice();
  function fetch(url, opts) {
    let body = {};
    try { body = JSON.parse(opts.body); } catch (e) {}
    sent.push(body);
    if (body.action === 'offer_stage') return Promise.resolve({ json: () => Promise.resolve({ ok: true }) });
    const q = queues[body.action] || [{ ok: false, status: 'unrouted' }];
    const answer = q.length > 1 ? q.shift() : q[0];
    if (answer instanceof Error) return Promise.reject(answer);
    return Promise.resolve({ json: () => Promise.resolve(JSON.parse(JSON.stringify(answer))) });
  }
  return {
    fetch, sent,
    stages: () => sent.filter(b => b.action === 'offer_stage'),
    of: action => sent.filter(b => b.action === action),
  };
}

function browser(href, seed) {
  const els = new Map();
  const ctx = {
    console, URL, URLSearchParams, Intl, JSON, Date, Math, Promise, Object, Number, String, Array,
    setTimeout, clearTimeout, setInterval, clearInterval,
    sessionStorage: store(), localStorage: store(),
    history: { replaceState(_s, _t, url) { ctx.window.location._rewritten = url; } },
    document: {
      querySelector(sel) { if (!els.has(sel)) els.set(sel, element()); return els.get(sel); },
      querySelectorAll(sel) { return [ctx.document.querySelector(sel)]; },
      addEventListener() {},
    },
    _opened: [],
    open(url) { ctx._opened.push(url); },
    StrideTrack: { pushes: [], push(e, p) { this.pushes.push([e, p]); } },
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

function paddle(ctx) {
  ctx.Paddle = {
    Initialize(o) { ctx._paddleInit = o; },
    Checkout: { open(o) { ctx._checkout = o; } },
  };
}

const q = (ctx, sel) => ctx.document.querySelector(sel);
const wait = ms => new Promise(r => setTimeout(r, ms));
const clone = o => JSON.parse(JSON.stringify(o));

// Synthetic, and it must stay that way: this file ships with the site, so anything real
// here is a working credential for somebody's owner price, readable at stridehub.io/test/.
const PTXN = 'txn_01aaaaaaaaaaaaaaaaaaaaaaaa';
const TOKEN = '0123456789abcdef0123456789abcdef';   // synthetic, see PTXN
// These must match the stages the backend accepts. Anything a page sends that is not on this
// list is dropped by the backend and silently never recorded.
const STAGES = ['post_viewed', 'post_skipped', 'post_checkout',
                'post2_viewed', 'post2_skipped', 'post2_checkout',
                'welcome_viewed', 'welcome_checkout',
                'welcome_collection_viewed', 'welcome_collection_checkout',
                'session_viewed'];

const T = Date.now();
const usd = (a, f) => ({ amount: a, currency: 'USD', formatted: f });
const OPEN_USD = {
  ok: true, status: 'open', expires_at_ms: T + 72 * 3600000, server_now_ms: T,
  collection: { status: 'open', list_price: { amount: '7699', currency: 'ILS', formatted: '₪76.99' },
                offer_price: { amount: '5854', currency: 'ILS', formatted: '₪58.54' } },
  session: { status: 'open', owner_price: usd('9900', '$99.00'), standard_price: usd('19900', '$199.00'),
             code: 'sesh1o1', code_applied: true, offer_price: usd('9900', '$99.00') },
};
const OPEN_ILS = clone(OPEN_USD);
OPEN_ILS.session = { status: 'open',
  owner_price: { amount: '30900', currency: 'ILS', formatted: '₪309.00' },
  standard_price: { amount: '61900', currency: 'ILS', formatted: '₪619.00' },
  code: 'sesh1o1', code_applied: false,
  offer_price: { amount: '30900', currency: 'ILS', formatted: '₪309.00' } };
const NOT_YET = { ok: true, status: 'invalid', server_now_ms: T };
const withSession = (base, session) => Object.assign(clone(base), { session });

console.log('post-purchase-funnel.test.js');

// Top-level await is ESM only, and this file is CommonJS by choice: no build step, no
// dependencies, `node test/post-purchase-funnel.test.js` and nothing else.
(async function () {

// ══ 1. the head script on both offer pages ═══════════════════════════════════
for (const page of ['post/index.html', 'post2/index.html']) {
  const HEAD = scriptWith(page, "searchParams.has('_ptxn')");
  const dir = '/' + page.replace('index.html', '');
  {
    const ctx = browser(`https://stridehub.io${dir}?_ptxn=${PTXN}`);
    vm.runInContext(HEAD, ctx);
    ok(`${page}: a payment link's ?_ptxn= is kept for the offer and taken off the URL`,
      ctx.window.STRIDE_POST_TXN === PTXN && ctx.sessionStorage.getItem('stride_last_txn') === PTXN
      && ctx.window.location._rewritten === dir);
  }
  {
    const ctx = browser(`https://stridehub.io${dir}?_ptxn=nope`);
    vm.runInContext(HEAD, ctx);
    ok(`${page}: a malformed id is not stored, and is still stripped`,
      !ctx.window.STRIDE_POST_TXN && ctx.sessionStorage.getItem('stride_last_txn') === null
      && ctx.window.location._rewritten === dir);
  }
  const html = read(page);
  ok(`${page}: the strip runs before paddle.js can read the URL`,
    html.indexOf("searchParams.has('_ptxn')") < html.indexOf('cdn.paddle.com/paddle/v2/paddle.js'));
}
{
  const HEAD = scriptWith('post/index.html', "searchParams.has('_ptxn')");
  const ctx = browser(`https://stridehub.io/post/?code=sesh1o1&_ptxn=${PTXN}`);
  vm.runInContext(HEAD, ctx);
  ok('/post keeps ?code= in the URL while it strips ?_ptxn=',
    ctx.window.location._rewritten === '/post/?code=sesh1o1');
  const clean = browser('https://stridehub.io/post/?code=sesh1o1');
  vm.runInContext(HEAD, clean);
  ok('and a plain /post/?code=sesh1o1 is not rewritten at all', clean.window.location._rewritten === null);
}

// ══ 2. /post, the session offer ══════════════════════════════════════════════
const POST_HEAD = scriptWith('post/index.html', "searchParams.has('_ptxn')");
const POST = scriptWith('post/index.html', 'post_purchase_offers');

async function runPost(o) {
  const ctx = browser(o.href || 'https://stridehub.io/post/?code=sesh1o1', o.seed);
  const f = fetcher(o.routes || { post_purchase_offers: [clone(OPEN_USD)] });
  ctx.fetch = f.fetch;
  if (o.paddle !== false) paddle(ctx);
  vm.runInContext(POST_HEAD, ctx);
  vm.runInContext(POST, ctx);
  await wait(o.settle || 60);
  return { ctx, f };
}
const seeded = { stride_last_txn: PTXN };

{
  const { ctx, f } = await runPost({
    seed: seeded, settle: 1500,
    routes: { post_purchase_offers: [clone(NOT_YET), clone(NOT_YET), clone(OPEN_USD)] },
  });
  ok('an offer that is not made YET is asked for again, not treated as no offer',
    f.of('post_purchase_offers').length === 3, f.of('post_purchase_offers').length + ' lookups');
  ok('the buyer is not sent away while it is being made', ctx.window.location._replaced === null);
  ok('and it renders once it lands: $199 struck, $99 now',
    q(ctx, '#offer').classList.contains('ready')
    && q(ctx, '[data-was]').textContent === '$199' && q(ctx, '[data-now]').textContent === '$99');
  const left = q(ctx, '[data-left]').textContent;
  ok('the countdown reads like session.html: hours, minutes, seconds, from 72 down',
    /^\d{2}:\d{2}:\d{2}$/.test(left) && (left.startsWith('71:59') || left.startsWith('72:00')), left);
  ok('every lookup names the purchase AND the code from the URL',
    f.of('post_purchase_offers').every(b => b.txn === PTXN && b.code === 'sesh1o1'));
  const v = f.stages().find(b => b.stage === 'post_viewed');
  ok('reaching the offer is recorded as the session offer, with its code',
    v && v.txn === PTXN && v.offer === 'session' && v.code === 'sesh1o1');
}
{
  const { f } = await runPost({ seed: seeded, href: 'https://stridehub.io/post/?code=SESH1O1' });
  ok('the code is read however it was typed', f.of('post_purchase_offers')[0].code === 'sesh1o1');
}
{
  const { f } = await runPost({ seed: seeded, href: 'https://stridehub.io/post/?code=sesh1o1%3Cb%3E' });
  ok('anything that is not letters and digits is not a code, and is not sent as one',
    f.of('post_purchase_offers')[0].code === '');
}
{
  const both = withSession(OPEN_USD, { status: 'open', owner_price: usd('12345', '$123.45'),
                                       standard_price: usd('19900', '$199.00'), offer_price: usd('9900', '$99.00') });
  const { ctx } = await runPost({ seed: seeded, routes: { post_purchase_offers: [both] } });
  ok('the code price wins over the owner price when the backend sends both',
    q(ctx, '[data-now]').textContent === '$99');
}
{
  const old = withSession(OPEN_USD, { status: 'open', owner_price: usd('9900', '$99.00'),
                                      standard_price: usd('19900', '$199.00') });
  const { ctx } = await runPost({ seed: seeded, routes: { post_purchase_offers: [old] } });
  ok('a backend that sends no code price still shows the owner price: same offer, never blank',
    q(ctx, '#offer').classList.contains('ready') && q(ctx, '[data-now]').textContent === '$99');
}
{
  const { ctx } = await runPost({ seed: seeded, routes: { post_purchase_offers: [clone(OPEN_ILS)] } });
  ok('a buyer in shekels sees shekels, the owner price standing in for the dollar code',
    /309/.test(q(ctx, '[data-now]').textContent) && /619/.test(q(ctx, '[data-was]').textContent)
    && !/\$/.test(q(ctx, '[data-now]').textContent), q(ctx, '[data-now]').textContent);
}
{
  const { ctx, f } = await runPost({});
  ok('no purchase anywhere leaves at once and asks nothing',
    ctx.window.location._replaced === '/welcome.html' && f.sent.length === 0);
}
for (const status of ['used', 'expired']) {
  const s = withSession(OPEN_USD, { status });
  const { ctx, f } = await runPost({ seed: seeded, routes: { post_purchase_offers: [s] }, settle: 900 });
  ok(`a session offer that is ${status} goes to the product at once, with no second ask`,
    ctx.window.location._replaced === '/welcome.html' && f.of('post_purchase_offers').length === 1);
}
{
  const { ctx, f } = await runPost({ seed: seeded, routes: { post_purchase_offers: [{ ok: false }] }, settle: 900 });
  ok('a backend that refuses is final too', ctx.window.location._replaced === '/welcome.html'
    && f.of('post_purchase_offers').length === 1);
}
{
  const { ctx } = await runPost({ seed: seeded, routes: { post_purchase_offers: [new Error('offline')] }, settle: 1500 });
  ok('a dead network is retried and never renders an offer', !q(ctx, '#offer').classList.contains('ready'));
}

// Booking
{
  const { ctx, f } = await runPost({
    seed: seeded,
    routes: { post_purchase_offers: [clone(OPEN_USD)], session_checkout: [{ ok: true, transaction_id: 'txn_checkout' }] },
  });
  q(ctx, '[data-buy]').click();
  await wait(40);
  const c = f.of('session_checkout')[0] || {};
  ok('Book asks the backend for the checkout with the purchase and the code, never a price',
    c.txn === PTXN && c.code === 'sesh1o1' && !('price' in c) && !('amount' in c) && !('discount' in c));
  ok('and opens exactly the checkout the backend made, landing on /welcome after',
    ctx._checkout && ctx._checkout.transactionId === 'txn_checkout'
    && ctx._checkout.settings.successUrl === 'https://stridehub.io/welcome.html');
  ok('the Stride purchase is kept for the welcome rail before the checkout opens',
    ctx.sessionStorage.getItem('stride_offer_txn') === PTXN);
  ok('opening it is recorded, and GA4 hears begin_checkout in the money on screen',
    f.stages().some(b => b.stage === 'post_checkout' && b.offer === 'session')
    && ctx.StrideTrack.pushes.some(([e, p]) => e === 'begin_checkout' && p.value === 99 && p.currency === 'USD'));

  ctx._paddleInit.eventCallback({ name: 'checkout.completed', data: { transaction_id: 'txn_paid_session' } });
  ok('a paid session shows the booked state',
    q(ctx, '.book-live').hidden === true && q(ctx, '.booked').hidden === false);
  ok('and writes nothing welcome.html could count as a second Stride purchase',
    ctx.sessionStorage.getItem('stride_last_txn') === PTXN);
}
{
  const { ctx } = await runPost({
    seed: seeded,
    routes: { post_purchase_offers: [clone(OPEN_USD)], session_checkout: [{ ok: false, status: 'used' }] },
  });
  q(ctx, '[data-buy]').click();
  await wait(40);
  ok('an offer already used shows booked instead of a failed checkout',
    q(ctx, '.booked').hidden === false && !ctx._checkout);
}
{
  const { ctx } = await runPost({
    seed: seeded,
    routes: { post_purchase_offers: [clone(OPEN_USD)], session_checkout: [{ ok: false, status: 'expired' }] },
  });
  q(ctx, '[data-buy]').click();
  await wait(40);
  ok('an offer that ended while the page was open sends the buyer on to Stride',
    ctx.window.location._replaced === '/welcome.html');
}
{
  const { ctx } = await runPost({
    seed: seeded,
    routes: { post_purchase_offers: [clone(OPEN_USD)], session_checkout: [{ ok: false, status: 'unavailable' }] },
  });
  q(ctx, '[data-buy]').click();
  await wait(40);
  ok('a checkout that cannot be made says so and leaves the offer in place',
    q(ctx, '.offer-note').hidden === false && /try again/.test(q(ctx, '.offer-note').textContent)
    && ctx.window.location._replaced === null);
}
{
  const { ctx, f } = await runPost({ seed: seeded, paddle: false });
  q(ctx, '[data-buy]').click();
  await wait(20);
  ok('without Paddle, Book opens the Calendly profile as session.html does',
    ctx._opened[0] === 'https://calendly.com/stride-engine' && f.of('session_checkout').length === 0);
}
{
  const { ctx, f } = await runPost({ seed: seeded });
  q(ctx, '[data-skip]').click();
  await wait(20);
  ok('"No thanks" is recorded as a skip of the session offer',
    f.stages().some(b => b.stage === 'post_skipped' && b.offer === 'session'));
}

// ══ 3. /post2, the Collection offer kept for testing ═════════════════════════
const POST2_HEAD = scriptWith('post2/index.html', "searchParams.has('_ptxn')");
const POST2 = scriptWith('post2/index.html', 'post_purchase_offers');

async function runPost2(o) {
  const ctx = browser(o.href || 'https://stridehub.io/post2/', o.seed);
  const f = fetcher(o.routes || { post_purchase_offers: [clone(OPEN_USD)] });
  ctx.fetch = f.fetch;
  vm.runInContext(POST2_HEAD, ctx);
  vm.runInContext(POST2, ctx);
  await wait(o.settle || 60);
  return { ctx, f };
}
{
  const { ctx, f } = await runPost2({
    seed: seeded, settle: 1500,
    routes: { post_purchase_offers: [clone(NOT_YET), clone(NOT_YET), clone(OPEN_USD)] },
  });
  ok('/post2 rides out the same race', f.of('post_purchase_offers').length === 3
    && ctx.window.location._replaced === null);
  ok('and renders the Collection at the offer price',
    q(ctx, '#offer').classList.contains('ready') && q(ctx, '[data-now]').textContent === '₪58.54'
    && q(ctx, '[data-was]').textContent === '₪76.99');
  const v = f.stages().find(b => b.stage === 'post2_viewed');
  ok('its stages are post2_* and say they were about the Collection',
    v && v.offer === 'collection' && !f.stages().some(b => /^post_/.test(b.stage)));
}
for (const status of ['owned', 'used', 'expired']) {
  const a = clone(OPEN_USD);
  a.collection = { status };
  const { ctx, f } = await runPost2({ seed: seeded, routes: { post_purchase_offers: [a] }, settle: 900 });
  ok(`/post2: a Collection already ${status} goes to the product at once`,
    ctx.window.location._replaced === '/welcome.html' && f.of('post_purchase_offers').length === 1);
}
{
  const { ctx, f } = await runPost2({ seed: seeded });
  q(ctx, '[data-skip]').click();
  await wait(20);
  ok('/post2: "No thanks" is recorded as post2_skipped',
    f.stages().some(b => b.stage === 'post2_skipped' && b.offer === 'collection'));
}
async function buyPost2(checkoutAnswer) {
  const ctx = browser('https://stridehub.io/post2/', seeded);
  const f = fetcher({ post_purchase_offers: [clone(OPEN_USD)], collection_checkout: [checkoutAnswer] });
  ctx.fetch = f.fetch;
  paddle(ctx);
  ctx._strideXid = 'xid-0001';
  vm.runInContext(POST2_HEAD, ctx);
  vm.runInContext(POST2, ctx);
  await wait(60);
  q(ctx, '[data-buy]').click();
  await wait(40);
  return { ctx, f };
}
{
  const { ctx, f } = await buyPost2({ ok: true, transaction_id: 'txn_coll_checkout' });
  const c = f.of('collection_checkout')[0] || {};
  ok('/post2: Add asks the backend for the Collection checkout with the purchase, never a price',
    c.txn === PTXN && c.external_id === 'xid-0001' && !('discountId' in c) && !('priceId' in c));
  ok('/post2: and opens exactly that transaction, landing on /welcome',
    ctx._checkout && ctx._checkout.transactionId === 'txn_coll_checkout' && !ctx._checkout.items
    && !ctx._checkout.discountId && ctx._checkout.settings.successUrl === 'https://stridehub.io/welcome.html');
  ok('/post2: begin_checkout is sent once the checkout has opened, and the Stride purchase is kept',
    ctx.StrideTrack.pushes.some(([e]) => e === 'begin_checkout')
    && ctx.sessionStorage.getItem('stride_offer_txn') === PTXN
    && f.stages().some(b => b.stage === 'post2_checkout'));
}
{
  const { ctx } = await buyPost2({ ok: false, status: 'used' });
  ok('/post2: an offer already used sends the buyer on, with no checkout and no begin_checkout',
    ctx.window.location._replaced === '/welcome.html' && !ctx._checkout
    && !ctx.StrideTrack.pushes.some(([e]) => e === 'begin_checkout'));
}
{
  const { ctx } = await buyPost2({ ok: false, status: 'unavailable' });
  ok('/post2: a checkout that cannot be made says so and stays',
    q(ctx, '.offer-note').hidden === false && ctx.window.location._replaced === null);
}
ok('/post2 carries no price id and no discount id any more',
  !/pri_[0-9a-z]{20,}|dsc_[0-9a-z]{20,}/.test(read('post2/index.html')));

// ══ 4. /welcome ══════════════════════════════════════════════════════════════
const RAIL = scriptWith('welcome.html', 'session-rail');
// The card's parts that the markup ships hidden, read from the markup itself, so every run starts
// from the page's real first paint rather than from a stub where everything is visible.
const RAIL_HIDDEN = [...read('welcome.html').matchAll(/<[a-z]+\b[^>]*\bclass="[^"]*?\b(rail-[a-z-]+)[^"]*"[^>]*\shidden(?=[\s>])/g)]
  .map(m => '.' + m[1]);
ok('the card ships its offer states hidden', ['.rail-offer', '.rail-coll', '.rail-book', '.rail-coll-buy', '.rail-note']
  .every(sel => RAIL_HIDDEN.includes(sel)), RAIL_HIDDEN.join(' '));
async function runRail(answer, o) {
  o = o || {};
  const ctx = browser('https://stridehub.io/welcome.html', o.seed || { stride_offer_txn: PTXN });
  const f = fetcher(Object.assign({ post_purchase_offers: [answer] }, o.routes || {}));
  ctx.fetch = f.fetch;
  if (o.paddle) paddle(ctx);
  ctx._strideXid = 'xid-0002';
  for (const sel of RAIL_HIDDEN) ctx.document.querySelector(sel).hidden = true;
  ctx.document.getElementById = () => {
    const rail = element();
    rail.querySelector = sel => ctx.document.querySelector(sel);
    return rail;
  };
  vm.runInContext(RAIL, ctx);
  await wait(80);
  return { ctx, f };
}
const booked = coll => Object.assign(withSession(OPEN_USD, { status: 'used' }), { collection: coll });
const COLL_OPEN = clone(OPEN_USD.collection);

{
  const { ctx, f } = await runRail(clone(OPEN_USD));
  ok('not booked yet: the card is the session offer at the owner price',
    q(ctx, '[data-rail-now]').textContent === '$99.00' && q(ctx, '[data-rail-was]').textContent === '$199.00'
    && q(ctx, '.rail-offer').hidden === false && q(ctx, '.rail-coll').hidden === true);
  ok('"See what it covers" carries the purchase, which keeps the owner price on session.html',
    q(ctx, '.rail-link')._href === 'session.html?txn=' + PTXN);
  ok('reaching it is recorded as the session offer',
    f.stages().some(b => b.stage === 'welcome_viewed' && b.offer === 'session'));
}
{
  const { ctx, f } = await runRail(booked(COLL_OPEN));
  ok('BOOKED: the card turns to the Collection, the booking confirmed at its top',
    q(ctx, '.rail-coll').hidden === false && q(ctx, '.rail-session').hidden === true
    && q(ctx, '.rail-book').hidden === true && q(ctx, '.rail-link').hidden === true
    && q(ctx, '.rail-coll-buy').hidden === false);
  ok('at the Collection offer price the server quoted, on the button too',
    q(ctx, '[data-coll-now]').textContent === '₪58.54' && q(ctx, '[data-coll-was]').textContent === '₪76.99'
    && q(ctx, '[data-coll-cta]').textContent === '₪58.54');
  ok('with the time left on the same 72 hours', /\d+d \d+h \d+m/.test(q(ctx, '[data-coll-left]').textContent),
    q(ctx, '[data-coll-left]').textContent);
  ok('and the view is recorded as the Collection on the welcome card',
    f.stages().some(b => b.stage === 'welcome_collection_viewed' && b.offer === 'collection')
    && !f.stages().some(b => b.stage === 'welcome_viewed'));
}
for (const [label, coll, expect] of [
  ['bought the Collection off the offer too', { status: 'used' }, /Collection is yours/],
  ['already owned the Collection', { status: 'owned' }, /^You're booked in\. Check your inbox/],
  ['let the Collection offer lapse', { status: 'expired' }, /^You're booked in\. Check your inbox/],
]) {
  const { ctx } = await runRail(booked(coll));
  ok(`booked and ${label}: no offer, just the confirmation`,
    q(ctx, '.rail-coll').hidden === true && q(ctx, '.rail-public').hidden === true
    && q(ctx, '.rail-note').hidden === false && expect.test(q(ctx, '.rail-note').textContent),
    q(ctx, '.rail-note').textContent);
}

// Buying the Collection from the card
{
  // Only the last purchase is stored, as for a buyer who reached /welcome without /post, so the
  // card itself has to keep the Stride purchase before the Collection checkout can overwrite it.
  const { ctx, f } = await runRail(booked(COLL_OPEN), {
    seed: { stride_last_txn: PTXN },
    paddle: true, routes: { collection_checkout: [{ ok: true, transaction_id: 'txn_rail_coll' }] } });
  ok('the card starts with no stored Stride purchase of its own', ctx.sessionStorage.getItem('stride_offer_txn') === null);
  q(ctx, '.rail-coll-buy').click();
  await wait(40);
  const c = f.of('collection_checkout')[0] || {};
  ok('Add asks the backend for the Collection checkout with the purchase and the visitor id only',
    c.txn === PTXN && c.external_id === 'xid-0002' && Object.keys(c).sort().join() === 'action,external_id,txn');
  ok('and opens that transaction, coming back to /welcome after',
    ctx._checkout && ctx._checkout.transactionId === 'txn_rail_coll'
    && ctx._checkout.settings.successUrl === 'https://stridehub.io/welcome.html');
  ok('the Stride purchase is kept for the card, and the opening is recorded and reported',
    ctx.sessionStorage.getItem('stride_offer_txn') === PTXN
    && f.stages().some(b => b.stage === 'welcome_collection_checkout' && b.offer === 'collection')
    && ctx.StrideTrack.pushes.some(([e, p]) => e === 'begin_checkout' && p.currency === 'ILS'));
  ctx._paddleInit.eventCallback({ name: 'checkout.completed',
    data: { transaction_id: 'txn_rail_coll_paid', currency_code: 'ILS', totals: { total: 58.54 } } });
  ok('a paid Collection is handed to the page\'s purchase tracking, as /post2 does',
    ctx.sessionStorage.getItem('stride_last_txn') === 'txn_rail_coll_paid'
    && JSON.parse(ctx.sessionStorage.getItem('stride_checkout_value')).value === 58.54);
  ok('and the card says both are done', /Collection is yours/.test(q(ctx, '.rail-note').textContent)
    && q(ctx, '.rail-coll').hidden === true);
}
{
  const { ctx } = await runRail(booked(COLL_OPEN), {
    paddle: true, routes: { collection_checkout: [{ ok: false, status: 'used' }] } });
  q(ctx, '.rail-coll-buy').click();
  await wait(40);
  ok('a Collection already bought elsewhere shows as done, with no checkout',
    !ctx._checkout && /Collection is yours/.test(q(ctx, '.rail-note').textContent));
}
// Booking the session from the card
{
  const { ctx, f } = await runRail(clone(OPEN_USD), {
    paddle: true, routes: { session_checkout: [{ ok: true, transaction_id: 'txn_rail_session' }] } });
  q(ctx, '.rail-book').click();
  await wait(40);
  const c = f.of('session_checkout')[0] || {};
  ok('Book asks for the session checkout with the purchase alone',
    c.txn === PTXN && Object.keys(c).sort().join() === 'action,txn');
  ok('opens it, lands on the session page, and is recorded',
    ctx._checkout && ctx._checkout.transactionId === 'txn_rail_session'
    && ctx._checkout.settings.successUrl === 'https://stridehub.io/session.html?booked=1'
    && f.stages().some(b => b.stage === 'welcome_checkout' && b.offer === 'session'));
  ctx._paddleInit.eventCallback({ name: 'checkout.completed', data: { transaction_id: 'txn_rail_session_paid' } });
  ok('a paid session shows booked, and writes nothing that would read as a purchase',
    /^You're booked in\. Check your inbox/.test(q(ctx, '.rail-note').textContent)
    && ctx.sessionStorage.getItem('stride_last_txn') === null);
}
ok('the bare link stays in the markup for anyone with no offer and no JavaScript',
  /<a href="session\.html" class="rail-link/.test(read('welcome.html')));
{
  const w = read('welcome.html');
  const covers = [...w.matchAll(/<div class="rail-stack"[\s\S]*?<\/div>/g)].map(m => m[0]).join('');
  const srcs = [...covers.matchAll(/src="([^"]+)"/g)].map(m => m[1]);
  ok('the card carries the three Collection covers, each a real file',
    srcs.length === 3 && srcs.every(s => fs.existsSync(path.join(ROOT, s))), srcs.join(' '));
  ok('and they load only if the Collection is ever shown', /rail-stack[\s\S]*?loading="lazy"/.test(w));
  ok('welcome.html names no price id and no discount id', !/pri_[0-9a-z]{20,}|dsc_[0-9a-z]{20,}/.test(w));
}

// ══ 5. session.html accepts either name for the same offer ═══════════════════
const SESSION_HEAD = scriptWith('session.html', "searchParams.has('offer')");
{
  const ctx = browser('https://stridehub.io/session.html?txn=' + PTXN);
  vm.runInContext(SESSION_HEAD, ctx);
  ok('session.html keeps a purchase from /welcome for the tab, and takes it off the URL',
    ctx.window.STRIDE_SESSION_TXN === PTXN && ctx.sessionStorage.getItem('stride_offer_txn') === PTXN
    && ctx.window.location._rewritten === '/session.html');
}
{
  const ctx = browser('https://stridehub.io/session.html?offer=' + TOKEN);
  vm.runInContext(SESSION_HEAD, ctx);
  ok('the mailed token still works exactly as it did',
    ctx.window.STRIDE_SESSION_OFFER === TOKEN && ctx.localStorage.getItem('stride_session_offer') === TOKEN
    && ctx.window.location._rewritten === '/session.html');
}
{
  const ctx = browser('https://stridehub.io/session.html?booked=1&txn=' + PTXN);
  vm.runInContext(SESSION_HEAD, ctx);
  ok('?booked=1 survives the strip', ctx.window.location._rewritten === '/session.html?booked=1');
}
{
  const src = read('session.html');
  ok('both of its calls send whichever credential resolved the offer',
    src.includes("Object.assign({ action: 'session_offer' }, cred)")
    && src.includes("Object.assign({ action: 'session_checkout' }, offer.cred || {})"));
}

// ══ 6. /post is session.html's page ══════════════════════════════════════════
{
  const text = html => html.replace(/<script[\s\S]*?<\/script>/gi, ' ').replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<[^>]+>/g, ' ').replace(/&[a-z]+;/g, ' ').replace(/\s+/g, ' ').trim();
  const part = (html, start, end) => {
    const i = html.indexOf(start), j = html.indexOf(end, i);
    return i < 0 || j < 0 ? '' : text(html.slice(i, j + end.length));
  };
  const s = read('session.html'), p = read('post/index.html');
  for (const [label, a, b] of [
    ['hero', 'to change the way you explore sound design', 'best direction reveal itself.'],
    ['credentials card', 'Who you are booking', 'Released with'],
    ['timeline', '<ol class="tl">', '</ol>'],
    ['closing line', "You'll leave with the sounds", 'in your own sessions.'],
  ]) {
    const x = part(s, a, b), y = part(p, a, b);
    ok(`/post carries session.html's ${label} word for word`, x && x === y, x ? '' : 'anchor missing');
  }
  // Site images only: the Meta pixel's <noscript> beacon is an absolute external URL.
  const assets = [...p.matchAll(/<img[^>]+src="([^"]+)"/g)].map(m => m[1]).filter(a => !/^https?:/.test(a));
  ok('every image on /post is referenced from the site root, because /post is a subfolder',
    assets.length >= 5 && assets.every(a => a.startsWith('/assets/')), assets.join(' '));
  ok('and every one of them exists', assets.every(a => fs.existsSync(path.join(ROOT, a.slice(1)))));
  ok('no link on /post would resolve inside /post/',
    ![...p.matchAll(/href="([^"#]+)"/g)].map(m => m[1]).some(h => !/^(https?:|\/|mailto:|data:)/.test(h)));
  ok('the price, the button and the countdown sit in the hero as well as at the end',
    (p.match(/data-buy/g) || []).length >= 2 && (p.match(/data-left/g) || []).length >= 2);
  ok('nothing on /post names a price id or a discount id', !/pri_[0-9a-z]{20,}|dsc_[0-9a-z]{20,}/.test(p));
}

// ══ 7. the Collection artwork, now on /post2 ═════════════════════════════════
{
  const html = read('post2/index.html');
  const sleeves = [...html.matchAll(/<figure class="sleeve"><img src="([^"]+)"/g)].map(m => m[1]);
  ok('/post2 carries the three /samples covers', sleeves.length === 3);
  ok('each is a real file, referenced from the site root',
    sleeves.every(s => s.startsWith('/assets/packs/') && fs.existsSync(path.join(ROOT, s.slice(1)))), sleeves.join(' '));
  const gate = html.slice(html.indexOf('id="offer"'), html.indexOf('</section>'));
  ok('inside the gated panel, so it never flashes at someone being sent away',
    gate.includes('class="stack"') && gate.split('class="sleeve"').length === 4);
  ok('and its teaser is fetched only when someone presses play',
    /<video id="teaser-v" controls playsinline preload="none"/.test(html) && !/<video[^>]*\bsrc=/.test(html));
  // /samples shipped a script-embedded &amp; until 2026-09-16: a script is raw text, so the
  // entity is never decoded and Firebase got no token.
  for (const page of ['post2/index.html', 'samples.html', 'frontend/samples.html']) {
    const src = (read(page).match(/STRIDE_TEASER_SRC = "([^"]+)"/) || [])[1] || '';
    ok(`${page}: the teaser URL carries a real token`, src.includes('&token=') && !src.includes('&amp;'), src.slice(-40));
  }
}

// ══ 8. the checkout sends buyers to /post with the code ══════════════════════
{
  const m = read('index.html').match(/const PADDLE_SUCCESS_URL\s*=\s*'([^']+)'/);
  ok('the Stride checkout lands on /post with sesh1o1 in the URL',
    m && m[1] === 'https://stridehub.io/post/?code=sesh1o1', m && m[1]);
}

// ══ 9. the contract with the backend ═════════════════════════════════════════
{
  const found = new Set(), actions = new Set();
  for (const p of ['post/index.html', 'post2/index.html', 'welcome.html', 'session.html']) {
    const src = read(p);
    for (const m of src.matchAll(/stage\('([a-z0-9_]+)'|stage:\s*'([a-z0-9_]+)'|'(welcome_[a-z_]+)'\);/g)) found.add(m[1] || m[2] || m[3]);
    for (const m of src.matchAll(/action:\s*'([a-z_]+)'/g)) actions.add(m[1]);
  }
  ok('every stage a page fires is one the backend accepts',
    found.size >= 7 && [...found].every(s => STAGES.includes(s)), [...found].join(','));
  ok('the pages call only the five public actions the backend routes',
    [...actions].every(a => ['offer_stage', 'post_purchase_offers', 'session_offer', 'session_checkout',
                             'collection_checkout'].includes(a)),
    [...actions].join(','));
}

// ══ 10. this file is published: nothing live in it ═══════════════════════════
{
  const self = fs.readFileSync(__filename, 'utf8');
  const txns = [...self.matchAll(/txn_[0-9a-z]{26}/g)].map(m => m[0]);
  const tokens = [...self.matchAll(/'([0-9a-f]{32})'/g)].map(m => m[1]);
  ok('every transaction id in this file is synthetic', txns.every(t => /^txn_01a+$/.test(t)), [...new Set(txns)].join(','));
  ok('and so is every offer token', tokens.every(t => t === TOKEN), tokens.join(','));
}

// ── the root copies are what GitHub Pages actually serves ────────────────────
for (const f of ['post/index.html', 'post2/index.html', 'welcome.html', 'session.html', 'index.html', 'samples.html']) {
  ok(`${f} is in sync between frontend/ and the root that ships`, read(f) === read('frontend/' + f));
}

console.log(`  ${PASSED} passed, ${FAILED} failed`);
process.exit(FAILED ? 1 : 0);
})();
