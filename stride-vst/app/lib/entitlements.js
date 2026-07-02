/**
 * Stride — License Entitlements (product-scoped licensing)
 *
 * WHY THIS EXISTS
 * ---------------
 * Stride ships as TWO paid products that share one backend, one set of
 * built-in keys, and one on-disk license.json:
 *
 *     StrideLink  ($59)  — the Ableton M4L + Electron product
 *     Stride VST  ($99)  — the cross-DAW VST3 wrapper (flagship)
 *
 * The pre-split build treats a license as a single boolean ("valid" -> unlock
 * everything). That CROSS-UNLOCKS: any StrideLink key unlocks the VST and
 * vice-versa, so we could never charge separately for the VST. This module
 * makes licensing PRODUCT-SCOPED. It is the release-blocker for the 2-product
 * split (see docs/stride-entitlements-spec.md).
 *
 * TRUST MODEL
 * -----------
 * The SERVER decides which products a key is entitled to — it alone can look
 * up the Lemon Squeezy product + purchase date behind a key — and SIGNS that
 * decision with an Ed25519 PRIVATE key. The CLIENT (this module, embedded in
 * the Electron main process, and mirrored in the VST's C++) only ever VERIFIES
 * that signature with the embedded PUBLIC key. Because verification is
 * asymmetric, shipping the public key in the app is safe: a cracker cannot
 * forge a new entitlement without the private key, and cannot escalate a
 * cached license.json by hand-editing it (the signature stops matching). This
 * directly answers the "isn't the license file crackable?" concern.
 *
 * Built-in master/ambassador keys are the one exception: they are trusted by
 * their hard-coded SHA-256 hash (see main.js BUILTIN_KEY_HASHES), validate
 * fully offline, and are granted every product WITHOUT a signature.
 *
 * This file is dependency-free (Node 'crypto' only) and NEVER throws on bad
 * input — same discipline as lib/install-verify.js. It is unit-tested by
 * test/test-entitlements.js and is the reference implementation the VST's C++
 * verifier must match byte-for-byte (canonicalization + Ed25519 over UTF-8).
 */

'use strict';

const crypto = require('crypto');

// Entitlement tokens that appear in the signed `ents` array. These strings are
// the wire contract between server, this module, and the VST — DO NOT rename.
const PRODUCT = Object.freeze({
    STRIDELINK: 'stridelink',
    VST: 'vst',
});

const ALL_PRODUCTS = Object.freeze([PRODUCT.STRIDELINK, PRODUCT.VST]);

// Default product-mapping config. Names are matched case/space-insensitively;
// productIds (from Lemon Squeezy) are matched first and are more robust because
// a store owner can rename a product without breaking licensing. Fill in the
// real LS product_ids before shipping (see spec §"Open inputs").
//
// `freeVstForStridelinkBeforeMs` is the giveaway switch: any StrideLink key
// whose purchase was created at/before this epoch-ms ALSO unlocks the VST.
// null = giveaway OFF (StrideLink never grants VST).
const DEFAULT_CONFIG = Object.freeze({
    products: [
        // 973706 is the $99 BUNDLE (all variants) and 1188468 the standalone VST;
        // BOTH now grant BOTH apps (a single key unlocks StrideLink + VST). This
        // also auto-upgrades existing $39/$59 StrideLink customers to the VST.
        // Licensing is per-PRODUCT — variants/price don't affect entitlements.
        { entitlements: [PRODUCT.STRIDELINK, PRODUCT.VST], productIds: [973706],  productNames: ['stride', 'stridelink', 'stride link', 'stride for ableton', 'stride bundle', 'stride complete'] },
        { entitlements: [PRODUCT.STRIDELINK, PRODUCT.VST], productIds: [1188468], productNames: ['stride vst', 'stride vst3'] },
    ],
    // Giveaway cutoff: a StrideLink purchase created at/before this epoch-ms also
    // unlocks the VST. 1783036800000 = 2026-07-03T00:00:00Z (through end of
    // 2026-07-02 UTC — "everyone who bought on/before launch day"). null = off.
    freeVstForStridelinkBeforeMs: 1783036800000,
});

// Invisible unicode codepoints rich-text email clients inject when a user
// copies a license key from their receipt: NBSP, zero-width space / non-joiner
// / joiner, and BOM. Stripped alongside normal whitespace. Kept as explicit
// codepoints (not literal chars in the regex) so the source stays readable and
// provably matches main.js / main.py.
const INVISIBLE_CODEPOINTS = new Set([0x00A0, 0x200B, 0x200C, 0x200D, 0xFEFF]);

// ─── Normalization ───────────────────────────────────────────

// Uppercase + strip whitespace and the invisible codepoints above. Hyphens are
// preserved (part of LS's UUID key format). Never throws.
function normalizeKey(k) {
    let out = '';
    for (const ch of String(k == null ? '' : k)) {
        if (/\s/.test(ch) || INVISIBLE_CODEPOINTS.has(ch.codePointAt(0))) continue;
        out += ch;
    }
    return out.toUpperCase();
}

function normalizeName(s) {
    return String(s == null ? '' : s).toLowerCase().trim().replace(/\s+/g, ' ');
}

// ─── Deterministic canonical JSON (for signing) ──────────────
//
// Ed25519 signs bytes, so both signer and verifier must serialize the payload
// identically. We sort object keys recursively; arrays keep their order (the
// `ents` array is sorted before it goes into the payload). The VST's C++
// verifier must reproduce this exact string.
function _sortKeys(v) {
    if (Array.isArray(v)) return v.map(_sortKeys);
    if (v && typeof v === 'object') {
        const out = {};
        for (const k of Object.keys(v).sort()) out[k] = _sortKeys(v[k]);
        return out;
    }
    return v;
}

function canonicalize(payload) {
    return JSON.stringify(_sortKeys(payload));
}

// ─── Entitlement resolution (SERVER-side decision) ───────────
//
// Given a Lemon Squeezy purchase, return the sorted, de-duped list of products
// it unlocks. Unknown products grant NOTHING (fail closed). This is the single
// source of truth for the decision table in the spec.
//
//   purchase = { productId?, productName?, createdAtMs? }
function resolveEntitlements(purchase, config) {
    const cfg = config || DEFAULT_CONFIG;
    if (!purchase || typeof purchase !== 'object') return [];

    const pid = purchase.productId != null ? String(purchase.productId) : null;
    const pname = normalizeName(purchase.productName);

    let baseEnts = null;
    for (const p of (cfg.products || [])) {
        const ids = (p.productIds || []).map(String);
        const names = (p.productNames || []).map(normalizeName);
        if ((pid && ids.includes(pid)) || (pname && names.includes(pname))) {
            // A product grants either one entitlement (`entitlement`) or several
            // (`entitlements`, e.g. the "Both" bundle).
            baseEnts = Array.isArray(p.entitlements)
                ? p.entitlements.slice()
                : (p.entitlement ? [p.entitlement] : []);
            break;
        }
    }
    if (!baseEnts || baseEnts.length === 0) return [];   // unknown product → no entitlements

    const ents = new Set(baseEnts);

    // Giveaway: pre-cutoff StrideLink buyers also get the VST free.
    const cutoff = cfg.freeVstForStridelinkBeforeMs;
    if (ents.has(PRODUCT.STRIDELINK) &&
        cutoff != null &&
        Number.isFinite(purchase.createdAtMs) &&
        purchase.createdAtMs <= cutoff) {
        ents.add(PRODUCT.VST);
    }

    return [...ents].sort();
}

// Built-in master/ambassador keys unlock every product (trusted by hash).
function entitlementsForBuiltinTier(tier) {
    if (tier === 'master' || tier === 'ambassador') return ALL_PRODUCTS.slice();
    return [];
}

// ─── Signing / verifying (Ed25519) ───────────────────────────

// Mint a fresh server keypair once. privateKeyPem stays on the backend (as a
// secret); publicKeyPem is embedded in the app + VST. Returns PEM strings.
function generateKeypair() {
    const { publicKey, privateKey } = crypto.generateKeyPairSync('ed25519');
    return {
        publicKeyPem: publicKey.export({ type: 'spki', format: 'pem' }).toString(),
        privateKeyPem: privateKey.export({ type: 'pkcs8', format: 'pem' }).toString(),
    };
}

// Build the signed entitlement payload for a license. `ents` is sorted so the
// canonical bytes are stable. Returns { ent, ent_sig } or null on failure.
//   ent     = { key, ents, iat }   (the object that gets signed)
//   ent_sig = base64 Ed25519 signature over canonicalize(ent)
function buildSignedEntitlement(key, ents, issuedAtMs, privateKeyPem) {
    const ent = {
        key: normalizeKey(key),
        ents: Array.isArray(ents) ? [...ents].sort() : [],
        iat: Number.isFinite(issuedAtMs) ? issuedAtMs : 0,
    };
    const ent_sig = sign(ent, privateKeyPem);
    if (!ent_sig) return null;
    return { ent, ent_sig };
}

function sign(payload, privateKey) {
    try {
        if (!privateKey) return null;
        const msg = Buffer.from(canonicalize(payload), 'utf8');
        return crypto.sign(null, msg, privateKey).toString('base64');
    } catch (e) {
        return null;
    }
}

function verify(payload, signatureB64, publicKey) {
    try {
        if (!payload || typeof signatureB64 !== 'string' || !publicKey) return false;
        const msg = Buffer.from(canonicalize(payload), 'utf8');
        return crypto.verify(null, msg, publicKey, Buffer.from(signatureB64, 'base64'));
    } catch (e) {
        return false;
    }
}

// ─── The client gate ─────────────────────────────────────────
//
// Decide whether a cached/validated license entitles the caller's product.
// This is the single function main.js (StrideLink) and the VST both call.
//
//   license = the license.json object (v1 or v2) or a fresh validation result
//   opts = {
//     product,            // required: PRODUCT.STRIDELINK or PRODUCT.VST
//     publicKey,          // embedded server public key (PEM) — for v2 verify
//     nowMs,              // default Date.now()
//     graceDays,          // default 14 — offline-trust window
//     grandfatherProduct, // v1 back-compat: the product a legacy (unsigned)
//                         //   license may unlock. StrideLink passes
//                         //   'stridelink'; the VST passes null so a legacy
//                         //   cache can NEVER unlock the new product offline.
//     requireSignature,   // default true; set false only in tests
//     skipGrace,          // true when validating fresh online (no time check)
//   }
//
// Returns { entitled: bool, reason: string, entitlements: string[] }.
function readEntitlement(license, opts) {
    const o = opts || {};
    const product = o.product;
    const nowMs = Number.isFinite(o.nowMs) ? o.nowMs : Date.now();
    const graceMs = (Number.isFinite(o.graceDays) ? o.graceDays : 14) * 86400000;

    const deny = (reason, ents) => ({ entitled: false, reason, entitlements: ents || [] });
    const allow = (reason, ents) => ({ entitled: true, reason, entitlements: ents || [] });

    if (!license || typeof license !== 'object') return deny('no-license');
    if (license.valid !== true) return deny('not-valid');
    if (!product) return deny('no-product-requested');

    // 1. Built-in master/ambassador — trusted by hard-coded hash, offline, all products.
    if (license.builtin === true) {
        const ents = entitlementsForBuiltinTier(license.tier);
        return ents.includes(product) ? allow('builtin', ents) : deny('wrong-product', ents);
    }

    // 2. v2 signed entitlements — the authoritative path.
    if (license.ent && license.ent_sig) {
        const okSig = (o.requireSignature === false) ? true : verify(license.ent, license.ent_sig, o.publicKey);
        if (!okSig) return deny('bad-signature');
        // The signature binds the key; make sure it matches this record's key
        // (stops splicing a signed `ent` from key A onto key B).
        if (normalizeKey(license.ent.key) !== normalizeKey(license.key)) return deny('key-mismatch');
        const ents = Array.isArray(license.ent.ents) ? license.ent.ents : [];
        if (!ents.includes(product)) return deny('wrong-product', ents);
        if (!o.skipGrace && (nowMs - _graceStamp(license) >= graceMs)) return deny('grace-expired', ents);
        return allow('signed', ents);
    }

    // 3. v1 (pre-split) cached license — no signed entitlements. Back-compat:
    //    an existing install keeps working, but the file proves no product, so
    //    we only grant the product the CALLER declares safe to grandfather.
    const gf = o.grandfatherProduct || null;
    if (gf && product === gf) {
        if (!o.skipGrace && (nowMs - _graceStamp(license) >= graceMs)) return deny('grace-expired');
        return allow('v1-grandfathered');
    }
    return deny(gf ? 'wrong-product' : 'v1-needs-online');
}

// Grace is measured from the client's last successful validation/cache, to
// match the existing renderer behavior (cached_at is refreshed on every
// silent revalidation). Falls back through the timestamps a record may carry.
function _graceStamp(license) {
    return Number(license.cached_at) ||
           Number(license.validated_at) ||
           (license.ent && Number(license.ent.iat)) ||
           0;
}

module.exports = {
    PRODUCT,
    ALL_PRODUCTS,
    DEFAULT_CONFIG,
    INVISIBLE_CODEPOINTS,
    normalizeKey,
    normalizeName,
    canonicalize,
    resolveEntitlements,
    entitlementsForBuiltinTier,
    generateKeypair,
    buildSignedEntitlement,
    sign,
    verify,
    readEntitlement,
};
