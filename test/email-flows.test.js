/* The site half of the Audit 08 mails, run for real.
 *
 *   /answer.html   where the three one-click answers of the "One question" mail land (C4)
 *   /?gift=<token> the homepage opening the Discovery Pass gift checkout (A6)
 *   /setup.html    the Meta pixel every new buyer now meets (Audit 08, 8.3)
 *
 * As in post-purchase-funnel.test.js, the pages' own inline scripts are lifted out of the HTML
 * and run against a stub browser, so the token handling, every answer from the backend and the
 * checkout are exercised as a visitor meets them.
 *
 *   node test/email-flows.test.js
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

function scripts(file) {
  const html = read(file);
  const re = /<script(?![^>]*\bsrc=)(?![^>]*\btype=)[^>]*>([\s\S]*?)<\/script>/gi;
  const out = [];
  let m;
  while ((m = re.exec(html)) !== null) out.push(m[1]);
  return out;
}
function scriptWith(file, needle) {
  const hit = scripts(file).filter(s => s.includes(needle));
  if (hit.length !== 1) throw new Error(`${file}: ${hit.length} inline scripts contain ${needle}, expected 1`);
  return hit[0];
}

// ── a stub browser ───────────────────────────────────────────────────────────
function store() {
  const m = new Map();
  return { getItem: k => (m.has(k) ? m.get(k) : null), setItem: (k, v) => m.set(k, String(v)),
           removeItem: k => m.delete(k) };
}

function node(tag) {
  return {
    tagName: tag, id: '', type: '', textContent: '', style: {}, attrs: {}, children: [], listeners: {},
    setAttribute(k, v) { this.attrs[k] = String(v); },
    getAttribute(k) { return this.attrs[k]; },
    appendChild(c) { this.children.push(c); return c; },
    addEventListener(ev, fn) { (this.listeners[ev] = this.listeners[ev] || []).push(fn); },
    click() { (this.listeners.click || []).forEach(fn => fn({ preventDefault() {} })); },
  };
}

function browser(href) {
  const byId = new Map();
  const body = node('body');
  body.insertBefore = function (el) { this.children.unshift(el); return el; };
  function find(el, id) {
    if (el.id === id) return el;
    for (const c of el.children) { const hit = find(c, id); if (hit) return hit; }
    return null;
  }
  const timers = [];
  const ctx = {
    console, URL, URLSearchParams, Intl, JSON, Date, Math, Promise, Object, Number, String, Array, RegExp,
    setTimeout(fn, ms) { timers.push({ fn, ms }); return timers.length; },
    clearTimeout() {},
    sessionStorage: store(), localStorage: store(),
    history: { replaceState(_s, _t, url) { ctx.window.location._rewritten = url; } },
    _listeners: {},
    document: {
      body,
      getElementById(id) { return find(body, id) || byId.get(id) || null; },
      querySelector(sel) {
        const id = sel.replace(/^#/, '');
        if (!byId.has(id)) { const n = node('div'); n.id = id; byId.set(id, n); }
        return byId.get(id);
      },
      createElement: node,
      addEventListener(ev, fn) { (ctx._listeners[ev] = ctx._listeners[ev] || []).push(fn); },
    },
  };
  ctx.window = ctx;
  ctx.self = ctx;
  ctx._timers = timers;
  ctx.window.location = { href, _rewritten: null };
  vm.createContext(ctx);
  return ctx;
}

// One fetch, answered by action. An Error rejects; the string 'hang' never settles.
function fetcher(answers) {
  const sent = [];
  function fetch(url, opts) {
    let body = {};
    try { body = JSON.parse(opts.body); } catch (e) {}
    sent.push({ url, opts, body });
    const a = answers[body.action];
    if (a === 'hang') return new Promise(() => {});
    if (a instanceof Error) return Promise.reject(a);
    return Promise.resolve({ json: () => Promise.resolve(JSON.parse(JSON.stringify(a === undefined ? { ok: false } : a))) });
  }
  return { fetch, sent };
}

const wait = ms => new Promise(r => setTimeout(r, ms));
// Synthetic, and it must stay that way: this file ships with the site.
const TOKEN = 'fedcba9876543210fedcba9876543210';
const API = 'https://generate-midi-z3spyrafvq-uc.a.run.app';

console.log('email-flows.test.js');

(async function () {

// ══ 1. /answer.html ══════════════════════════════════════════════════════════
const A_HEAD = scriptWith('answer.html', "searchParams.get('t')");
const A_BODY = scriptWith('answer.html', 'survey_answer');
const UTM = '&utm_source=stride&utm_medium=email&utm_campaign=post_purchase&utm_content=one_question';

{
  const ctx = browser(`https://stridehub.io/answer.html?t=${TOKEN.toUpperCase()}&a=yes${UTM}`);
  vm.runInContext(A_HEAD, ctx);
  ok('answer: the token is kept for the request, however it was cased',
    ctx.STRIDE_SURVEY.token === TOKEN && ctx.STRIDE_SURVEY.answer === 'yes');
  ok('answer: and taken off the address, the answer and the utm tags staying',
    ctx.location._rewritten === '/answer.html?a=yes' + UTM, ctx.location._rewritten);
}
{
  const ctx = browser('https://stridehub.io/answer.html?t=nope&a=no');
  vm.runInContext(A_HEAD, ctx);
  ok('answer: a malformed token is not kept, and is still stripped',
    ctx.STRIDE_SURVEY.token === '' && ctx.location._rewritten === '/answer.html?a=no');
}
{
  const html = read('answer.html');
  const at = html.indexOf("searchParams.get('t')");
  ok('answer: the strip runs before GTM, GA4 and Clarity can read the URL',
    at > 0 && at < html.indexOf('googletagmanager.com/gtm.js') && at < html.indexOf('gtag/js')
    && at < html.indexOf('clarity.ms/tag'));
  ok('answer: the page is kept out of search', /<meta name="robots" content="noindex, nofollow">/.test(html));
}

async function runAnswer(href, answers, settle) {
  const ctx = browser(href);
  const f = fetcher(answers);
  ctx.fetch = f.fetch;
  vm.runInContext(A_HEAD, ctx);
  vm.runInContext(A_BODY, ctx);
  await wait(settle || 20);
  const q = sel => ctx.document.querySelector(sel);
  return { ctx, f, title: q('#title').textContent, line: q('#line').textContent,
           state: q('#card').getAttribute('data-state') };
}
const ANSWER_URL = a => `https://stridehub.io/answer.html?t=${TOKEN}&a=${a}${UTM}`;

for (const a of ['yes', 'some', 'no']) {
  const r = await runAnswer(ANSWER_URL(a), { survey_answer: { ok: true, status: 'recorded', answer: a } });
  ok(`answer ${a}: one request carrying the token and the answer, to the backend`,
    r.f.sent.length === 1 && r.f.sent[0].url === API
    && JSON.stringify(r.f.sent[0].body) === JSON.stringify({ action: 'survey_answer', token: TOKEN, answer: a }));
  ok(`answer ${a}: the thank-you for that answer`, r.state === a && r.title.length > 0 && r.line.length > 0, r.state);
}
{
  const yes = await runAnswer(ANSWER_URL('yes'), { survey_answer: { ok: true, status: 'recorded', answer: 'yes' } });
  const no = await runAnswer(ANSWER_URL('no'), { survey_answer: { ok: true, status: 'recorded', answer: 'no' } });
  ok('answer: a yes and a no read differently', yes.title !== no.title && yes.line !== no.line);
  ok('answer: no copy sells anything, and none has a dash of the forbidden kind',
    ![yes, no].some(r => /\$|\bbuy\b|—|–/i.test(r.title + r.line)));
}
{
  const r = await runAnswer(ANSWER_URL('no'), { survey_answer: { ok: true, status: 'answered', answer: 'yes' } });
  ok('answer: a second click is told its first answer was kept', r.state === 'again' && /already/i.test(r.title));
}
for (const bad of [{ ok: false, status: 'invalid' }, { ok: false, status: 'unavailable' }, new Error('offline')]) {
  const r = await runAnswer(ANSWER_URL('yes'), { survey_answer: bad });
  ok(`answer: ${bad instanceof Error ? 'a network failure' : bad.status} still reads as thanks, never an error`,
    r.state === 'fallback' && /thanks/i.test(r.title) && !/error|fail/i.test(r.title + r.line));
}
{
  const r = await runAnswer(`https://stridehub.io/answer.html?t=${TOKEN}&a=maybe`, {});
  ok('answer: an answer outside the three sends nothing', r.f.sent.length === 0 && r.state === 'fallback');
  const r2 = await runAnswer('https://stridehub.io/answer.html?a=yes', {});
  ok('answer: no token sends nothing', r2.f.sent.length === 0 && r2.state === 'fallback');
}
{
  const r = await runAnswer(ANSWER_URL('yes'), { survey_answer: 'hang' });
  const html = read('answer.html');
  ok('answer: while the backend is slow nothing is decided, and the card starts on "Saving"',
    r.state === undefined && html.includes('<main id="card" data-state="saving">')
    && html.includes('<p id="line">Saving your answer...</p>'));
  const t = r.ctx._timers.find(x => x.ms === 8000);
  t && t.fn();
  ok('answer: a backend that never answers leaves a thank-you after 8 seconds',
    !!t && r.ctx.document.querySelector('#card').getAttribute('data-state') === 'fallback');
}

// ══ 2. /?gift=<token> ════════════════════════════════════════════════════════
const G_HEAD = scriptWith('index.html', "searchParams.has('gift')");
const G_BODY = scriptWith('index.html', 'function strideGiftStart');
const MARKERS = '&utm_source=stride&utm_medium=email&utm_campaign=demo_funnel&utm_content=last_hours&fbclid=IwAR_x&ad_id=120';

{
  const ctx = browser(`https://stridehub.io/?utm_source=stride&gift=${TOKEN.toUpperCase()}${MARKERS}`);
  vm.runInContext(G_HEAD, ctx);
  ok('gift: the token is kept for the checkout', ctx.STRIDE_GIFT === TOKEN);
  ok('gift: and taken off the address, everything else staying for the tags',
    ctx.location._rewritten === '/?utm_source=stride' + MARKERS, ctx.location._rewritten);
}
{
  const ctx = browser('https://stridehub.io/?gift=abc&ad_id=1');
  vm.runInContext(G_HEAD, ctx);
  ok('gift: a malformed token is not kept, and is still stripped',
    ctx.STRIDE_GIFT === undefined && ctx.location._rewritten === '/?ad_id=1');
  const plain = browser('https://stridehub.io/?utm_source=x');
  vm.runInContext(G_HEAD, plain);
  ok('gift: a visit with no gift is never rewritten', plain.location._rewritten === null);
}
{
  const html = read('index.html');
  const at = html.indexOf("searchParams.has('gift')");
  ok('gift: the strip is the first script, ahead of every tag that records the URL',
    at > 0 && ['googletagmanager.com/gtm.js', 'gtag/js', 'clarity.ms/tag', 'fbevents.js', 'track_pageview',
               'captureAdClick'].every(n => html.indexOf(n) > at)
    && html.indexOf('<script') === html.lastIndexOf('<script', at));
  ok('gift: the page still defines everything the gift script leans on',
    ['const CHECKOUT_PROVIDER', 'const PADDLE_SUCCESS_URL', 'const STRIDE_PRICE', 'let strideLocal',
     'let strideExpressLive', 'function stridePaddleReady(', 'function strideExpressCustomData(']
      .every(n => html.includes(n)));
}

const PAGE_GLOBALS = `
  var CHECKOUT_PROVIDER = 'paddle';
  var PADDLE_SUCCESS_URL = 'https://stridehub.io/post/?code=sesh1o1';
  var STRIDE_PRICE = 99;
  var strideFx = null;
  var strideLocal = null;
  var strideExpressLive = true;
  function stridePaddleReady() { return !!window.Paddle; }
  function strideExpressCustomData() { return { fbc: 'fb.1.2.IwAR_x', fbclid: 'IwAR_x', ad_id: '120', external_id: 'xid-1', ua: 'UA' }; }
`;

async function runGift(o) {
  const ctx = browser('https://stridehub.io/');
  const f = fetcher(o.answers || {});
  ctx.fetch = f.fetch;
  ctx._opened = []; ctx._closed = 0; ctx._fbq = []; ctx._pushes = [];
  if (o.paddle !== false) {
    ctx.Paddle = { Checkout: { open(x) { ctx._opened.push(x); }, close() { ctx._closed++; } } };
  }
  ctx.fbq = function () { ctx._fbq.push(Array.prototype.slice.call(arguments)); };
  ctx.StrideTrack = { push(e, p) { ctx._pushes.push([e, p]); } };
  vm.runInContext(PAGE_GLOBALS + (o.globals || ''), ctx);
  if (o.token !== undefined) ctx.STRIDE_GIFT = o.token;
  vm.runInContext(G_BODY, ctx);
  (ctx._listeners.DOMContentLoaded || []).forEach(fn => fn());
  await wait(20);
  const bar = ctx.document.getElementById('stride-gift-bar');
  const text = ctx.document.getElementById('stride-gift-text');
  const btn = ctx.document.getElementById('stride-gift-open');
  return { ctx, f, bar, text: text ? text.textContent : '', btn };
}
const T_END = Date.now() + 40 * 3600000;
const OPEN = { gift_checkout: { ok: true, transaction_id: 'txn_01giftgiftgiftgiftgiftgift', expires_at_ms: T_END } };

{
  const r = await runGift({ token: TOKEN, answers: OPEN });
  const b = (r.f.sent[0] || {}).body || {};
  ok('gift: one request, the token and the ad markers, to the backend',
    r.f.sent.length === 1 && r.f.sent[0].url === API && b.action === 'gift_checkout' && b.token === TOKEN
    && b.fbclid === 'IwAR_x' && b.ad_id === '120' && b.external_id === 'xid-1');
  const o = r.ctx._opened[0] || {};
  ok('gift: the checkout the backend made opens, as the one-page overlay, landing on /post',
    r.ctx._opened.length === 1 && o.transactionId === 'txn_01giftgiftgiftgiftgiftgift'
    && o.settings.displayMode === 'overlay' && o.settings.variant === 'one-page' && o.settings.theme === 'dark'
    && o.settings.successUrl === 'https://stridehub.io/post/?code=sesh1o1');
  ok('gift: nothing on the page can reprice it: no items, no custom data, no discount',
    !('items' in o) && !('customData' in o) && !('discountId' in o) && !('discountCode' in o));
  ok('gift: the express button steps aside first, as it does for the buy form',
    r.ctx._closed === 1 && vm.runInContext('strideExpressLive', r.ctx) === false);
  ok('gift: a bar says the gift is open and until when, with a way back in',
    !!r.bar && /^Your gift is open until .+: Stride with the Experimental Collection included\.$/.test(r.text)
    && r.btn && r.btn.style.display === '', r.text);
  ok('gift: the bar sits at the top of the page, in the flow', r.ctx.document.body.children[0] === r.bar);
  ok('gift: opening it is reported once, at Stride\'s own price',
    r.ctx._fbq.length === 1 && r.ctx._fbq[0][0] === 'track' && r.ctx._fbq[0][1] === 'InitiateCheckout'
    && r.ctx._fbq[0][2].value === 99 && r.ctx._fbq[0][2].currency === 'USD'
    && r.ctx._pushes.length === 1 && r.ctx._pushes[0][0] === 'begin_checkout'
    && JSON.parse(r.ctx.sessionStorage.getItem('stride_checkout_value')).value === 99);
  r.btn.click();
  ok('gift: closed and reopened from the bar, it is the same checkout, reported once',
    r.ctx._opened.length === 2 && r.ctx._opened[1].transactionId === 'txn_01giftgiftgiftgiftgiftgift'
    && r.ctx._fbq.length === 1);
}
{
  const r = await runGift({ token: TOKEN, answers: OPEN,
    globals: 'strideLocal = { currency: "ILS", stride: 309, collection: 76.99 };' });
  ok('gift: a visitor priced in shekels is reported in shekels, at the amount Paddle gave',
    r.ctx._fbq[0][2].value === 309 && r.ctx._fbq[0][2].currency === 'ILS', JSON.stringify(r.ctx._fbq[0]));
}
const WORDS = {
  expired: /^Your gift has ended, but Stride is right here\.$/,
  used: /already yours/,
  owned: /^Stride is already yours/,
};
for (const st of Object.keys(WORDS)) {
  const r = await runGift({ token: TOKEN, answers: { gift_checkout: { ok: false, status: st } } });
  ok(`gift ${st}: the bar says so, offers no gift, and nothing opens`,
    WORDS[st].test(r.text) && r.btn.style.display === 'none' && r.ctx._opened.length === 0
    && r.ctx._fbq.length === 0, r.text);
}
for (const bad of [{ ok: false, status: 'invalid' }, { ok: false, status: 'unavailable' }, new Error('offline'),
                   { ok: true }]) {
  const r = await runGift({ token: TOKEN, answers: { gift_checkout: bad } });
  ok(`gift: ${bad instanceof Error ? 'a network failure' : JSON.stringify(bad)} reads as a gift that did not open`,
    /didn't open/.test(r.text) && r.btn.style.display === 'none' && r.ctx._opened.length === 0, r.text);
}
{
  const r = await runGift({ token: TOKEN, answers: OPEN, paddle: false });
  ok('gift: with Paddle blocked the bar says it did not open, and nothing is reported',
    /didn't open/.test(r.text) && r.ctx._fbq.length === 0);
}
{
  const r = await runGift({ answers: OPEN });
  ok('gift: a visit with no gift asks nothing and shows nothing', r.f.sent.length === 0 && !r.bar);
  const r2 = await runGift({ token: TOKEN, answers: OPEN, globals: 'CHECKOUT_PROVIDER = "lemonsqueezy";' });
  ok('gift: with Paddle switched off the gift stays out of the way', r2.f.sent.length === 0 && !r2.bar);
}

// ══ 3. setup.html carries the pixel ══════════════════════════════════════════
{
  const html = read('setup.html');
  const head = html.slice(0, html.indexOf('</head>'));
  ok('setup: the Meta pixel loads in the head',
    head.includes('connect.facebook.net/en_US/fbevents.js')
    && head.includes("fbq('init', '952457524222772', _strideXid ? { external_id: _strideXid } : {});")
    && head.includes("fbq('track', 'PageView');"));
  ok('setup: with the no-script fallback', head.includes('facebook.com/tr?id=952457524222772&ev=PageView&noscript=1'));
  ok('setup: PageView only, nothing that reads as a sale', !/fbq\('track', '(Purchase|InitiateCheckout|Lead)'/.test(html));
  const xid = scriptWith('setup.html', "fbq('init'");
  const ctx = browser('https://stridehub.io/setup.html');
  let cookie = '';
  Object.defineProperty(ctx.document, 'cookie', { get: () => cookie, set: v => { cookie = v.split(';')[0]; } });
  ctx.crypto = { randomUUID: () => 'uuid-1' };
  ctx._fbq = [];
  ctx.fbq = function () { ctx._fbq.push(Array.prototype.slice.call(arguments)); };
  ctx.fbq.callMethod = null;
  vm.runInContext(xid, ctx);
  ok('setup: the visitor id is the landing page\'s cookie, made if missing',
    cookie === 'stride_xid=uuid-1'
    && JSON.stringify(ctx._fbq[0]) === JSON.stringify(['init', '952457524222772', { external_id: 'uuid-1' }])
    && JSON.stringify(ctx._fbq[1]) === JSON.stringify(['track', 'PageView']), JSON.stringify(ctx._fbq));
}

// ══ 4. the root copies are the pages ═════════════════════════════════════════
for (const f of ['index.html', 'setup.html', 'answer.html']) {
  ok(`${f}: the root copy GitHub Pages serves matches frontend/`, read(f) === read('frontend/' + f));
}

console.log(`  ${PASSED} passed, ${FAILED} failed`);
process.exit(FAILED ? 1 : 0);
})().catch(e => { console.log('  CRASH ' + (e && e.stack || e)); process.exit(1); });
