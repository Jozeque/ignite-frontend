/**
 * Tests for stride-vst/app/lib/entitlements.js
 *
 * Product-scoped licensing: the release-blocker for the 2-product split
 * (StrideLink $59 vs Stride VST $99). Covers:
 *   • resolveEntitlements   — server-side decision (the spec's decision table)
 *   • builtin tier mapping  — master/ambassador unlock everything
 *   • Ed25519 sign/verify   — tamper resistance of the signed entitlement
 *   • readEntitlement       — the client gate (StrideLink + VST both call it)
 *   • back-compat           — legacy v1 license.json files don't lock users out
 *
 * The two load-bearing guarantees, asserted end-to-end below:
 *   1. A StrideLink key does NOT unlock the VST (unless pre-cutoff giveaway).
 *   2. Hand-editing license.json to add "vst" fails (signature breaks).
 *
 * Run: node test/test-entitlements.js
 * Style mirrors test-install-verify.js: pure Node, no mock libraries.
 */

const ent = require('../app/lib/entitlements');
const { PRODUCT } = ent;

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
function assertDeepEq(a, b, msg) {
    if (JSON.stringify(a) !== JSON.stringify(b)) {
        throw new Error((msg || 'mismatch') + ` — got ${JSON.stringify(a)}, expected ${JSON.stringify(b)}`);
    }
}

// ─── Fixtures ────────────────────────────────────────────────

// Fixed timestamps — deterministic, no reliance on the wall clock.
const NOW = 2000000000000;
const DAY = 86400000;
const CUTOFF = 1751328000000;   // giveaway boundary (a StrideLink purchase at/before this also unlocks VST)

const CONFIG = {
    products: [
        { entitlement: PRODUCT.STRIDELINK, productIds: [111], productNames: ['StrideLink', 'Stride for Ableton'] },
        { entitlement: PRODUCT.VST,        productIds: [222], productNames: ['Stride VST'] },
        { entitlements: [PRODUCT.STRIDELINK, PRODUCT.VST], productIds: [333], productNames: ['Stride Bundle', 'Stride Complete'] },
    ],
    freeVstForStridelinkBeforeMs: CUTOFF,
};
const CONFIG_NO_GIVEAWAY = Object.assign({}, CONFIG, { freeVstForStridelinkBeforeMs: null });

// One server keypair for the whole run, plus an unrelated one to prove that a
// signature only verifies under the matching public key.
const KP = ent.generateKeypair();
const KP_WRONG = ent.generateKeypair();

// Assemble a v2 signed license.json record the way main.js would cache it.
function signedRecord(key, ents, cachedAt, priv) {
    const built = ent.buildSignedEntitlement(key, ents, cachedAt, priv || KP.privateKeyPem);
    return {
        key: ent.normalizeKey(key),
        valid: true,
        builtin: false,
        cached_at: cachedAt,
        entitlements: ents.slice(),   // unsigned display mirror — NOT trusted for gating
        ent: built.ent,
        ent_sig: built.ent_sig,
    };
}

console.log('\nentitlements.js — product-scoped licensing tests\n');

// ─── resolveEntitlements (server decision) ───────────────────

test('VST purchase (by name) resolves to [vst]', () => {
    assertDeepEq(ent.resolveEntitlements({ productName: 'Stride VST', createdAtMs: NOW }, CONFIG), ['vst']);
});

test('VST purchase (by productId) resolves to [vst]', () => {
    assertDeepEq(ent.resolveEntitlements({ productId: 222, createdAtMs: NOW }, CONFIG), ['vst']);
    assertDeepEq(ent.resolveEntitlements({ productId: '222' }, CONFIG), ['vst'], 'string id also matches');
});

test('StrideLink purchase BEFORE cutoff → [stridelink, vst] (the giveaway)', () => {
    assertDeepEq(
        ent.resolveEntitlements({ productName: 'StrideLink', createdAtMs: CUTOFF - DAY }, CONFIG),
        ['stridelink', 'vst']
    );
});

test('StrideLink purchase AFTER cutoff → [stridelink] only (paid separation)', () => {
    assertDeepEq(
        ent.resolveEntitlements({ productName: 'StrideLink', createdAtMs: CUTOFF + DAY }, CONFIG),
        ['stridelink']
    );
});

test('StrideLink purchase EXACTLY at cutoff → included (<=)', () => {
    assertDeepEq(
        ent.resolveEntitlements({ productName: 'StrideLink', createdAtMs: CUTOFF }, CONFIG),
        ['stridelink', 'vst']
    );
});

test('StrideLink alias name ("Stride for Ableton") resolves', () => {
    assertDeepEq(
        ent.resolveEntitlements({ productName: 'Stride for Ableton', createdAtMs: CUTOFF + DAY }, CONFIG),
        ['stridelink']
    );
});

test('product name match is case / whitespace insensitive', () => {
    assertDeepEq(ent.resolveEntitlements({ productName: '  STRIDELINK  ', createdAtMs: CUTOFF + DAY }, CONFIG), ['stridelink']);
    assertDeepEq(ent.resolveEntitlements({ productName: 'stride   vst' }, CONFIG), ['vst']);
});

test('unknown product → [] (fail closed)', () => {
    assertDeepEq(ent.resolveEntitlements({ productName: 'Some Other Plugin' }, CONFIG), []);
    assertDeepEq(ent.resolveEntitlements({ productId: 999 }, CONFIG), []);
});

test('giveaway OFF: StrideLink before cutoff still only [stridelink]', () => {
    assertDeepEq(
        ent.resolveEntitlements({ productName: 'StrideLink', createdAtMs: CUTOFF - DAY }, CONFIG_NO_GIVEAWAY),
        ['stridelink']
    );
});

test('StrideLink with NO purchase date + giveaway on → [stridelink] (missing date fails closed)', () => {
    assertDeepEq(ent.resolveEntitlements({ productName: 'StrideLink' }, CONFIG), ['stridelink']);
});

test('VST purchase before cutoff does NOT gain stridelink (cutoff only affects stridelink)', () => {
    assertDeepEq(ent.resolveEntitlements({ productName: 'Stride VST', createdAtMs: CUTOFF - DAY }, CONFIG), ['vst']);
});

test('BUNDLE purchase (by name) resolves to both products', () => {
    assertDeepEq(ent.resolveEntitlements({ productName: 'Stride Bundle', createdAtMs: NOW }, CONFIG), ['stridelink', 'vst']);
});

test('BUNDLE purchase (by productId) resolves to both products', () => {
    assertDeepEq(ent.resolveEntitlements({ productId: 333 }, CONFIG), ['stridelink', 'vst']);
});

test('BUNDLE "Stride Complete" alias resolves to both (no lockout for bundle buyers)', () => {
    assertDeepEq(ent.resolveEntitlements({ productName: 'Stride Complete' }, CONFIG), ['stridelink', 'vst']);
});

test('resolveEntitlements tolerates junk input without throwing', () => {
    assertDeepEq(ent.resolveEntitlements(null, CONFIG), []);
    assertDeepEq(ent.resolveEntitlements(undefined, CONFIG), []);
    assertDeepEq(ent.resolveEntitlements({}, CONFIG), []);
});

// ─── Production config wiring (DEFAULT_CONFIG) ───────────────
// Locks the real Lemon Squeezy ids + giveaway cutoff so a stray edit can't
// silently break scoping. Update these literals if the products/cutoff change.

test('DEFAULT_CONFIG wired: 973706 + 1188468 both unlock the full bundle', () => {
    const D = ent.DEFAULT_CONFIG;
    // 973706 is the $99 bundle (all variants) — every key unlocks BOTH apps,
    // regardless of purchase date (the old giveaway cutoff no longer matters).
    assertDeepEq(ent.resolveEntitlements({ productId: 973706 }, D), ['stridelink', 'vst'], '973706 -> both');
    assertDeepEq(ent.resolveEntitlements({ productName: 'Stride' }, D), ['stridelink', 'vst'], 'name "Stride" -> both');
    // 1188468 (standalone VST) also grants both so early VST buyers get StrideLink too.
    assertDeepEq(ent.resolveEntitlements({ productId: 1188468 }, D), ['stridelink', 'vst'], '1188468 -> both');
    assertDeepEq(ent.resolveEntitlements({ productName: 'Stride VST' }, D), ['stridelink', 'vst'], 'name "Stride VST" -> both');
    // Unknown product still grants nothing (fail closed).
    assertDeepEq(ent.resolveEntitlements({ productId: 999999 }, D), [], 'unknown -> [] (fail closed)');
});

// ─── Built-in tiers ──────────────────────────────────────────

test('master tier unlocks every product', () => {
    assertDeepEq(ent.entitlementsForBuiltinTier('master'), ['stridelink', 'vst']);
});

test('ambassador tier unlocks every product', () => {
    assertDeepEq(ent.entitlementsForBuiltinTier('ambassador'), ['stridelink', 'vst']);
});

test('unknown / missing tier unlocks nothing', () => {
    assertDeepEq(ent.entitlementsForBuiltinTier('pro'), []);
    assertDeepEq(ent.entitlementsForBuiltinTier(undefined), []);
});

// ─── Canonicalization ────────────────────────────────────────

test('canonicalize is stable regardless of key insertion order', () => {
    assertEq(ent.canonicalize({ b: 1, a: 2 }), ent.canonicalize({ a: 2, b: 1 }));
    assertEq(
        ent.canonicalize({ key: 'X', ents: ['vst'], iat: 5 }),
        ent.canonicalize({ iat: 5, ents: ['vst'], key: 'X' })
    );
});

test('canonicalize sorts nested objects too', () => {
    assertEq(ent.canonicalize({ z: { d: 1, c: 2 } }), ent.canonicalize({ z: { c: 2, d: 1 } }));
});

// ─── Sign / verify (Ed25519) ─────────────────────────────────

test('sign + verify round-trip succeeds', () => {
    const payload = { key: 'AAAA-BBBB', ents: ['stridelink', 'vst'], iat: NOW };
    const sig = ent.sign(payload, KP.privateKeyPem);
    assert(typeof sig === 'string' && sig.length > 0, 'signature should be a non-empty base64 string');
    assertEq(ent.verify(payload, sig, KP.publicKeyPem), true);
});

test('tampering with the payload breaks verification', () => {
    const payload = { key: 'AAAA-BBBB', ents: ['stridelink'], iat: NOW };
    const sig = ent.sign(payload, KP.privateKeyPem);
    const tampered = { key: 'AAAA-BBBB', ents: ['stridelink', 'vst'], iat: NOW };   // added vst
    assertEq(ent.verify(tampered, sig, KP.publicKeyPem), false, 'escalated entitlements must not verify');
});

test('signature does not verify under the wrong public key', () => {
    const payload = { key: 'K', ents: ['vst'], iat: NOW };
    const sig = ent.sign(payload, KP.privateKeyPem);
    assertEq(ent.verify(payload, sig, KP_WRONG.publicKeyPem), false);
});

test('garbage / missing signature returns false (never throws)', () => {
    const payload = { key: 'K', ents: ['vst'], iat: NOW };
    assertEq(ent.verify(payload, 'not-a-real-signature', KP.publicKeyPem), false);
    assertEq(ent.verify(payload, null, KP.publicKeyPem), false);
    assertEq(ent.verify(payload, 'AAAA', 'not-a-key'), false);
    assertEq(ent.verify(null, 'AAAA', KP.publicKeyPem), false);
});

test('sign returns null on bad input (no key) instead of throwing', () => {
    assertEq(ent.sign({ a: 1 }, null), null);
    assertEq(ent.sign({ a: 1 }, 'not-a-valid-pem'), null);
});

test('buildSignedEntitlement sorts ents and produces a verifiable record', () => {
    const built = ent.buildSignedEntitlement('cccc-dddd', ['vst', 'stridelink'], NOW, KP.privateKeyPem);
    assertDeepEq(built.ent.ents, ['stridelink', 'vst'], 'ents stored sorted');
    assertEq(built.ent.key, 'CCCC-DDDD', 'key normalized (uppercased)');
    assertEq(ent.verify(built.ent, built.ent_sig, KP.publicKeyPem), true);
});

// ─── readEntitlement — the client gate ───────────────────────

const GATE = { publicKey: KP.publicKeyPem, nowMs: NOW, graceDays: 14 };

test('null / invalid licenses are denied', () => {
    assertEq(ent.readEntitlement(null, { product: PRODUCT.VST, ...GATE }).reason, 'no-license');
    assertEq(ent.readEntitlement({ valid: false }, { product: PRODUCT.VST, ...GATE }).reason, 'not-valid');
    assertEq(ent.readEntitlement({ valid: true }, { ...GATE }).reason, 'no-product-requested');
});

test('builtin master unlocks the VST (no signature needed)', () => {
    const r = ent.readEntitlement({ valid: true, builtin: true, tier: 'master' }, { product: PRODUCT.VST, ...GATE });
    assert(r.entitled, 'master should unlock VST');
    assertEq(r.reason, 'builtin');
});

test('builtin ambassador unlocks StrideLink', () => {
    const r = ent.readEntitlement({ valid: true, builtin: true, tier: 'ambassador' }, { product: PRODUCT.STRIDELINK, ...GATE });
    assert(r.entitled);
});

test('builtin with unknown tier is denied', () => {
    const r = ent.readEntitlement({ valid: true, builtin: true, tier: 'weird' }, { product: PRODUCT.VST, ...GATE });
    assert(!r.entitled);
});

test('GIVEAWAY: signed [stridelink, vst] record unlocks the VST', () => {
    const rec = signedRecord('AAAA-1111', ['stridelink', 'vst'], NOW - DAY);
    const r = ent.readEntitlement(rec, { product: PRODUCT.VST, ...GATE });
    assert(r.entitled, 'pre-cutoff giveaway record should unlock VST');
    assertEq(r.reason, 'signed');
});

test('CORE: a StrideLink-only signed key does NOT unlock the VST', () => {
    const rec = signedRecord('BBBB-2222', ['stridelink'], NOW - DAY);
    const r = ent.readEntitlement(rec, { product: PRODUCT.VST, ...GATE });
    assert(!r.entitled, 'StrideLink key must NOT unlock the VST');
    assertEq(r.reason, 'wrong-product');
    // ...but it still unlocks StrideLink.
    assert(ent.readEntitlement(rec, { product: PRODUCT.STRIDELINK, ...GATE }).entitled);
});

test('CRACK ATTEMPT: hand-editing license.json to add "vst" fails the signature', () => {
    const rec = signedRecord('BBBB-2222', ['stridelink'], NOW - DAY);
    rec.ent.ents.push('vst');            // attacker edits the file
    rec.entitlements.push('vst');        // and the display mirror
    const r = ent.readEntitlement(rec, { product: PRODUCT.VST, ...GATE });
    assert(!r.entitled, 'tampered entitlements must not unlock');
    assertEq(r.reason, 'bad-signature');
});

test('splicing a valid signature onto a different key is rejected (key-mismatch)', () => {
    const rec = signedRecord('AAAA-1111', ['stridelink', 'vst'], NOW - DAY);
    rec.key = ent.normalizeKey('ZZZZ-9999');   // signature still covers AAAA-1111
    const r = ent.readEntitlement(rec, { product: PRODUCT.VST, ...GATE });
    assert(!r.entitled);
    assertEq(r.reason, 'key-mismatch');
});

test('signed record with NO public key provided is denied (bad-signature)', () => {
    const rec = signedRecord('AAAA-1111', ['vst'], NOW - DAY);
    const r = ent.readEntitlement(rec, { product: PRODUCT.VST, nowMs: NOW });   // no publicKey
    assert(!r.entitled);
    assertEq(r.reason, 'bad-signature');
});

test('requireSignature:false bypasses verification (test-only escape hatch)', () => {
    const rec = signedRecord('AAAA-1111', ['vst'], NOW - DAY);
    delete rec.ent_sig;   // no signature at all
    rec.ent_sig = 'x';    // present but bogus
    const r = ent.readEntitlement(rec, { product: PRODUCT.VST, nowMs: NOW, requireSignature: false });
    assert(r.entitled, 'with requireSignature:false the bogus sig is ignored');
});

test('grace expired on a signed record → denied', () => {
    const rec = signedRecord('AAAA-1111', ['vst'], NOW - 20 * DAY);   // older than 14-day grace
    const r = ent.readEntitlement(rec, { product: PRODUCT.VST, ...GATE });
    assert(!r.entitled);
    assertEq(r.reason, 'grace-expired');
});

test('grace expired but skipGrace (fresh online validation) → entitled', () => {
    const rec = signedRecord('AAAA-1111', ['vst'], NOW - 20 * DAY);
    const r = ent.readEntitlement(rec, { product: PRODUCT.VST, ...GATE, skipGrace: true });
    assert(r.entitled, 'online path ignores grace');
});

// ─── Back-compat: legacy v1 license.json (no signed entitlements) ──

test('v1 legacy license unlocks StrideLink (existing users not locked out)', () => {
    const v1 = { key: 'OLD-1234', valid: true, cached_at: NOW - DAY };   // no version / ent / ent_sig
    const r = ent.readEntitlement(v1, { product: PRODUCT.STRIDELINK, grandfatherProduct: PRODUCT.STRIDELINK, ...GATE });
    assert(r.entitled, 'legacy StrideLink install must keep working');
    assertEq(r.reason, 'v1-grandfathered');
});

test('v1 legacy license does NOT unlock the VST offline (VST forces online re-scope)', () => {
    const v1 = { key: 'OLD-1234', valid: true, cached_at: NOW - DAY };
    // VST caller passes grandfatherProduct=null: a legacy cache can never
    // silently unlock the new product — this closes the cross-unlock hole.
    const r = ent.readEntitlement(v1, { product: PRODUCT.VST, grandfatherProduct: null, ...GATE });
    assert(!r.entitled);
    assertEq(r.reason, 'v1-needs-online');
});

test('v1 legacy license honors the grace window', () => {
    const v1 = { key: 'OLD-1234', valid: true, cached_at: NOW - 20 * DAY };
    const r = ent.readEntitlement(v1, { product: PRODUCT.STRIDELINK, grandfatherProduct: PRODUCT.STRIDELINK, ...GATE });
    assert(!r.entitled);
    assertEq(r.reason, 'grace-expired');
});

test('v1 legacy license: StrideLink app asked for a product it cannot grandfather → wrong-product', () => {
    const v1 = { key: 'OLD-1234', valid: true, cached_at: NOW - DAY };
    const r = ent.readEntitlement(v1, { product: PRODUCT.VST, grandfatherProduct: PRODUCT.STRIDELINK, ...GATE });
    assert(!r.entitled);
    assertEq(r.reason, 'wrong-product');
});

// ─── End-to-end flows ────────────────────────────────────────

test('E2E giveaway: pre-cutoff StrideLink purchase → resolve → sign → unlocks both', () => {
    const ents = ent.resolveEntitlements({ productName: 'StrideLink', createdAtMs: CUTOFF - DAY }, CONFIG);
    assertDeepEq(ents, ['stridelink', 'vst']);
    const rec = signedRecord('GIVE-0001', ents, NOW - DAY);
    assert(ent.readEntitlement(rec, { product: PRODUCT.VST, ...GATE }).entitled, 'VST unlocked');
    assert(ent.readEntitlement(rec, { product: PRODUCT.STRIDELINK, ...GATE }).entitled, 'StrideLink unlocked');
});

test('E2E paid separation: post-cutoff StrideLink buyer is offered the VST upgrade', () => {
    const ents = ent.resolveEntitlements({ productName: 'StrideLink', createdAtMs: CUTOFF + DAY }, CONFIG);
    assertDeepEq(ents, ['stridelink']);
    const rec = signedRecord('PAID-0002', ents, NOW - DAY);
    const vst = ent.readEntitlement(rec, { product: PRODUCT.VST, ...GATE });
    assertEq(vst.entitled, false);
    assertEq(vst.reason, 'wrong-product', 'renderer routes wrong-product → "Upgrade to Stride VST"');
    assert(ent.readEntitlement(rec, { product: PRODUCT.STRIDELINK, ...GATE }).entitled, 'their StrideLink still works');
});

// ─── Summary ─────────────────────────────────────────────────

console.log(`\n${passed} passed, ${failed} failed\n`);
process.exit(failed > 0 ? 1 : 0);
