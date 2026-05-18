/**
 * Tests for the Meta Pixel Purchase-event flow used by:
 *   frontend/index.html     (event_id generation at GET STRIDE click)
 *   frontend/welcome.html   (Purchase event fire on post-purchase landing)
 *
 * Phase 2 of docs/meta-pixel-integration-spec.md.
 *
 * The pixel-related logic in those HTML files is inline JS (no module
 * exports we can require from Node). To unit-test the pure-logic parts —
 * event_id generation, URL param parsing, fire/skip decisions — this file
 * MIRRORS those functions and exercises them.
 *
 * If you change the logic in welcome.html or the submitBuyForm event_id
 * generator in index.html, update the mirrored helpers below too.
 *
 * Run: node test/test-pixel-tracking.js
 */

let passed = 0;
let failed = 0;

function test(name, fn) {
    try {
        fn();
        console.log(`  ✓ ${name}`);
        passed++;
    } catch (e) {
        console.log(`  ✗ ${name}: ${e.message}`);
        if (e.stack) console.log(e.stack.split('\n').slice(1, 4).join('\n'));
        failed++;
    }
}

function assert(cond, msg) { if (!cond) throw new Error(msg || 'assertion failed'); }
function assertEq(a, b, msg) {
    if (a !== b) throw new Error((msg || 'mismatch') + ` — got ${JSON.stringify(a)}, expected ${JSON.stringify(b)}`);
}

// ─── Mirrored helpers from frontend (see file header) ─────────────────

// MIRROR of index.html submitBuyForm event_id generation
function generateEventId(cryptoObj) {
    return (cryptoObj && cryptoObj.randomUUID)
        ? cryptoObj.randomUUID()
        : 'evt-' + Date.now() + '-' + Math.random().toString(36).slice(2, 10);
}

// MIRROR of welcome.html URL param parsing
// Pure function: takes a query string, returns the resolved values.
function parseWelcomeParams(searchString, sessionStorageEventId) {
    const params = new URLSearchParams(searchString || '');
    const order = (params.get('order') || '').trim();
    let eventId = (params.get('event_id') || '').trim();
    if (!eventId && sessionStorageEventId) {
        eventId = String(sessionStorageEventId).trim();
    }
    return { order, eventId };
}

// MIRROR of welcome.html fire-or-skip decision
function shouldFirePurchase({ order, eventId, alreadyFired }) {
    const isFreshPurchase = !!(order || eventId);
    return isFreshPurchase && !alreadyFired;
}

// MIRROR of welcome.html purchaseData construction
function buildPurchaseData(order) {
    const data = {
        value: 39,
        currency: 'USD',
        content_name: 'Stride Sound Design Engine',
        content_type: 'product',
    };
    if (order) data.content_ids = [order];
    return data;
}

// Polyfill for URLSearchParams since we're in Node — Node 10+ has it
// globally available. If running on an old Node without it, fall back.
if (typeof URLSearchParams === 'undefined') {
    global.URLSearchParams = require('url').URLSearchParams;
}

// Mock crypto.randomUUID for some tests
const mockCryptoWithRandomUUID = { randomUUID: () => 'mock-uuid-' + Math.random() };
const mockCryptoWithoutRandomUUID = {};

console.log('\npixel-tracking — Phase 2 unit tests\n');

// ─── generateEventId() ─────────────────────────────────────

test('generateEventId returns crypto.randomUUID() when available', () => {
    let calls = 0;
    const cryptoObj = { randomUUID: () => { calls++; return 'aaaa-bbbb-cccc-dddd'; } };
    const id = generateEventId(cryptoObj);
    assertEq(calls, 1);
    assertEq(id, 'aaaa-bbbb-cccc-dddd');
});

test('generateEventId returns evt-<ts>-<rand> fallback when crypto missing', () => {
    const id = generateEventId(undefined);
    assert(id.startsWith('evt-'), 'should start with evt-');
    const parts = id.split('-');
    assert(parts.length >= 3, 'should be evt-ts-rand');
    assert(parseInt(parts[1], 10) > 0, 'timestamp portion should be a positive integer');
});

test('generateEventId returns fallback when crypto.randomUUID is missing', () => {
    const id = generateEventId({});
    assert(id.startsWith('evt-'), 'no randomUUID method → fall back');
});

test('generateEventId fallback produces unique IDs on rapid calls', () => {
    const ids = new Set();
    for (let i = 0; i < 50; i++) ids.add(generateEventId(undefined));
    assert(ids.size >= 40, 'expect mostly-unique IDs across 50 calls (timestamp + random)');
});

// ─── parseWelcomeParams() ──────────────────────────────────

test('parseWelcomeParams: order + event_id both in URL', () => {
    const r = parseWelcomeParams('?order=abc-123&event_id=evt-xyz', null);
    assertEq(r.order, 'abc-123');
    assertEq(r.eventId, 'evt-xyz');
});

test('parseWelcomeParams: order in URL, event_id from sessionStorage', () => {
    const r = parseWelcomeParams('?order=abc-123', 'evt-from-storage');
    assertEq(r.order, 'abc-123');
    assertEq(r.eventId, 'evt-from-storage');
});

test('parseWelcomeParams: URL event_id wins over sessionStorage event_id', () => {
    const r = parseWelcomeParams('?event_id=evt-url', 'evt-storage');
    assertEq(r.eventId, 'evt-url', 'URL takes precedence — that\'s what LS surfaces');
});

test('parseWelcomeParams: nothing → both empty', () => {
    const r = parseWelcomeParams('', null);
    assertEq(r.order, '');
    assertEq(r.eventId, '');
});

test('parseWelcomeParams: whitespace gets trimmed', () => {
    const r = parseWelcomeParams('?order=%20%20abc%20&event_id=%20evt%20', null);
    assertEq(r.order, 'abc');
    assertEq(r.eventId, 'evt');
});

test('parseWelcomeParams: malformed query string does not throw', () => {
    // URLSearchParams is forgiving — just verify no throw
    parseWelcomeParams('?===&&order=ok', null);
    parseWelcomeParams('?order', null); // value-less key
    parseWelcomeParams(null, null);
    parseWelcomeParams(undefined, null);
});

test('parseWelcomeParams: extra unrelated params are ignored', () => {
    const r = parseWelcomeParams('?order=abc&utm_source=fb&utm_medium=cpc&random=junk', null);
    assertEq(r.order, 'abc');
    assertEq(r.eventId, '');
});

// ─── shouldFirePurchase() ──────────────────────────────────

test('shouldFirePurchase: order present, not yet fired → fire', () => {
    assertEq(shouldFirePurchase({ order: 'abc', eventId: '', alreadyFired: false }), true);
});

test('shouldFirePurchase: event_id present, not yet fired → fire', () => {
    assertEq(shouldFirePurchase({ order: '', eventId: 'evt', alreadyFired: false }), true);
});

test('shouldFirePurchase: nothing present → do not fire (random visit)', () => {
    assertEq(shouldFirePurchase({ order: '', eventId: '', alreadyFired: false }), false);
});

test('shouldFirePurchase: already fired this session → do not re-fire on reload', () => {
    assertEq(shouldFirePurchase({ order: 'abc', eventId: 'evt', alreadyFired: true }), false);
});

test('shouldFirePurchase: both order + event_id present → fire (normal case)', () => {
    assertEq(shouldFirePurchase({ order: 'abc', eventId: 'evt', alreadyFired: false }), true);
});

// ─── buildPurchaseData() ───────────────────────────────────

test('buildPurchaseData: default fields always set', () => {
    const d = buildPurchaseData('');
    assertEq(d.value, 39);
    assertEq(d.currency, 'USD');
    assertEq(d.content_name, 'Stride Sound Design Engine');
    assertEq(d.content_type, 'product');
    assertEq(d.content_ids, undefined, 'no content_ids when no order');
});

test('buildPurchaseData: order_id present → content_ids array set', () => {
    const d = buildPurchaseData('order-uuid-here');
    assert(Array.isArray(d.content_ids), 'content_ids should be array');
    assertEq(d.content_ids.length, 1);
    assertEq(d.content_ids[0], 'order-uuid-here');
});

test('buildPurchaseData: never fires zero value (Meta penalizes 0-value Purchase)', () => {
    const d = buildPurchaseData('any');
    assert(d.value > 0, 'value must be > 0');
});

// ─── End-to-end flow simulation ────────────────────────────

test('e2e: fresh purchase from LS → Purchase fires once with right data', () => {
    // Simulate: user clicked GET STRIDE → event_id stored → LS redirected
    // back to welcome.html?order=abc&event_id=evt
    const sessionStorageBefore = 'evt-stored-on-landing';
    const search = '?order=abc-123&event_id=evt-from-ls';
    const alreadyFired = false;

    const params = parseWelcomeParams(search, sessionStorageBefore);
    const fire = shouldFirePurchase({ ...params, alreadyFired });
    assertEq(fire, true);
    assertEq(params.order, 'abc-123');
    assertEq(params.eventId, 'evt-from-ls', 'URL beats sessionStorage');

    const data = buildPurchaseData(params.order);
    assertEq(data.value, 39);
    assertEq(data.content_ids[0], 'abc-123');
});

test('e2e: user reloads welcome.html → Purchase does NOT fire again', () => {
    const params = parseWelcomeParams('?order=abc&event_id=evt', null);
    const fire = shouldFirePurchase({ ...params, alreadyFired: true });
    assertEq(fire, false, 'reload should not double-count');
});

test('e2e: random visit (bookmark, direct URL) → Purchase does NOT fire', () => {
    const params = parseWelcomeParams('', null);
    const fire = shouldFirePurchase({ ...params, alreadyFired: false });
    assertEq(fire, false, 'no order, no event_id, no recent checkout → just PageView');
});

test('e2e: tab closed mid-checkout, reopened → event_id NOT in storage, but order_id in URL → Purchase fires', () => {
    // sessionStorage is per-tab; if user closed tab then came back from
    // LS email link, sessionStorage is empty. But the LS redirect URL
    // still has order param → we fire Purchase with a NEW event_id.
    const params = parseWelcomeParams('?order=abc', null);
    const fire = shouldFirePurchase({ ...params, alreadyFired: false });
    assertEq(fire, true, 'order param alone should trigger fire');
    // The pixel code generates a fresh event_id when none available —
    // that means no dedup with server CAPI for this edge case. Acceptable.
    assertEq(params.eventId, '', 'no event_id resolved from URL or storage');
});

// ─── Summary ───────────────────────────────────────────────

console.log(`\n${passed} passed, ${failed} failed\n`);
process.exit(failed > 0 ? 1 : 0);
