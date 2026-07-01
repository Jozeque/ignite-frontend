# Stride — Product-Scoped Licensing (Entitlements) Spec

**Status:** Engine built + fully tested (`stride-vst/app/lib/entitlements.js`, `stride-vst/test/test-entitlements.js`, 41 tests green). Wiring into the shipping layers is specified here and **not yet applied** — it touches `main.js`, `main.py`, the renderer, and the VST, and needs three inputs from the user (see §10).

**Why:** Stride is splitting into two paid products — **StrideLink $59** (Ableton) and **Stride VST $99** (cross-DAW flagship). The current build shares one backend, one set of built-in keys, and one `license.json`, and treats a license as a single boolean (`valid` → unlock everything). That **cross-unlocks**: any StrideLink key unlocks the VST and vice-versa, so the VST cannot be sold separately. Product-scoping is the release-blocker for the split. It also has to give existing StrideLink owners the VST **free** (the giveaway) without opening the door to future $59-only buyers.

---

## 1. Goals

1. A **StrideLink** key unlocks StrideLink only. A **Stride VST** key unlocks the VST only.
2. **Giveaway:** a StrideLink key purchased **on/before a cutoff date** also unlocks the VST (free upgrade for existing owners). Post-cutoff StrideLink buyers do **not** — they see an upgrade offer.
3. **Tamper-resistant offline:** a user editing `license.json` to add `"vst"` must fail (answers the earlier "isn't the file crackable?" question).
4. **No regressions / no lockouts:** existing installs with a legacy `license.json` keep working; existing customers never get locked out.
5. **Slot-free** for the giveaway: unlocking the VST from a StrideLink key must not consume that key's Lemon Squeezy activation slots (the "2/2 devices" problem).

## 2. Trust model

The **server decides, the client verifies.** Only the backend can look up the Lemon Squeezy product + purchase date behind a key, so only the backend can decide entitlements. It signs the decision with an **Ed25519 private key**. The client (Electron main process, and the VST's C++) embeds only the **public key** and verifies.

Asymmetric signing is the whole point: shipping the public key is safe. A cracker cannot forge a new entitlement or escalate a cached `license.json` by hand — the signature won't match, and they don't have the private key. (Binary patching remains possible, as with all client-side DRM; compiled C++ raises that bar well above the Electron/asar level. We accept it — see §7.)

**Exception:** built-in master/ambassador keys (hard-coded SHA-256 hashes in `main.js`) are trusted by hash, validate fully offline, and unlock every product without a signature.

## 3. The decision table

`resolveEntitlements({ productId, productName, createdAtMs }, config)` → sorted product list. Unknown products grant nothing (fail closed).

| Key came from | Purchased | `stridelink` | `vst` |
|---|---|---|---|
| Stride VST | any | — | ✅ |
| StrideLink | **on/before cutoff** | ✅ | ✅ (giveaway) |
| StrideLink | **after cutoff** | ✅ | ❌ → "Upgrade to Stride VST" |
| Both bundle ($129) | any | ✅ | ✅ |
| Built-in master/ambassador | — | ✅ | ✅ |
| Unknown product | — | ❌ | ❌ |

Cutoff is a single config value (`freeVstForStridelinkBeforeMs`, epoch-ms; `null` disables the giveaway). A product grants one entitlement (`entitlement`) or several (`entitlements: [...]`, used by the bundle).

## 4. `license.json` v2 schema (backward compatible)

All existing v1 fields are preserved (so LS instance-id reuse, offline grace, and the CRM keep working). v2 **adds**:

```jsonc
{
  // ── v1 fields (unchanged) ──
  "key": "AAAA-BBBB-…", "valid": true, "tier": "pro",
  "customer_name": "…", "customer_email": "…", "product_name": "Stride VST",
  "instance_id": "…", "activation_limit": 2, "activation_usage": 1,
  "expires_at": null, "status": "active", "builtin": false,
  "validated_at": 1751…, "cached_at": 1751…,

  // ── v2 additions ──
  "version": 2,
  "entitlements": ["stridelink", "vst"],        // UNSIGNED display mirror — never trusted for gating
  "ent":  { "key": "AAAA-BBBB-…", "ents": ["stridelink","vst"], "iat": 1751… },  // the SIGNED payload
  "ent_sig": "<base64 Ed25519 over canonicalize(ent)>"
}
```

Gating trusts **only** `ent` + `ent_sig` (after verification). The bare `entitlements` array is for display/telemetry.

**Back-compat rules** (implemented in `readEntitlement`):
- **v1 record, StrideLink app** (`grandfatherProduct: 'stridelink'`) → unlock (`reason: v1-grandfathered`). Existing users are never locked out.
- **v1 record, VST** (`grandfatherProduct: null`) → **denied** (`reason: v1-needs-online`). The VST forces an online re-validation to obtain scoped entitlements. This is what closes the cross-unlock hole for already-cached files — and there are no legacy VST installs, so nobody is inconvenienced.
- On the next successful online validation, a v1 record is replaced by a signed v2 one automatically.

## 5. The engine — `stride-vst/app/lib/entitlements.js` (built)

Dependency-free (Node `crypto` only), never throws on bad input. Public API:

| Function | Side | Purpose |
|---|---|---|
| `resolveEntitlements(purchase, config)` | server | The decision table |
| `entitlementsForBuiltinTier(tier)` | both | master/ambassador → all products |
| `buildSignedEntitlement(key, ents, iat, privPem)` | server | Produce `{ ent, ent_sig }` |
| `sign` / `verify` | server / client | Ed25519 over `canonicalize()` |
| `canonicalize(payload)` | both | Deterministic sorted-key JSON (VST must match byte-for-byte) |
| `readEntitlement(license, opts)` | client | **The gate** — returns `{ entitled, reason, entitlements }` |
| `generateKeypair()` | one-time | Mint the server keypair (PEM) |

`readEntitlement` reasons: `signed`, `builtin`, `v1-grandfathered` (entitled); `no-license`, `not-valid`, `wrong-product`, `bad-signature`, `key-mismatch`, `grace-expired`, `v1-needs-online` (denied).

## 6. Wiring (to apply next — precise change list)

### 6a. Backend — `firebase_cloud/functions/main.py`
`_handle_validate_license` (line ~502) already reads `meta` and `license_key`. Changes:
- **Forward more identity** in the response (line ~663): add `product_id` = `meta.get("product_id")`, `variant_id` = `meta.get("variant_id")`, `created_at` = `lk.get("created_at")`.
- **Compute + sign entitlements:** port `resolveEntitlements` to Python (mirror of the JS; the JS test vectors are the cross-check). Canonicalization must be identical: `json.dumps(obj, sort_keys=True, separators=(',', ':'), ensure_ascii=False)`.
- **Sign** with Ed25519 (`cryptography` lib → add to `requirements.txt`) using a new secret **`STRIDE_ENT_PRIVATE_KEY`** (add to the function's `secrets=[…]` list, line ~693). Return `entitlements`, `ent`, `ent_sig`.
- Built-in keys never reach the backend, so no server change needed for them.

### 6b. Electron main — `stride-vst/app/main.js`
- `const entitlements = require('./lib/entitlements');` and embed `const ENT_PUBLIC_KEY = "-----BEGIN PUBLIC KEY-----\n…";`.
- Define `const APP_PRODUCT = entitlements.PRODUCT.STRIDELINK;`.
- In `validate-license-key` (line ~380): for the **builtin** path, attach `entitlements: entitlementsForBuiltinTier(tier)`. For the **backend** path, pass through `ent`/`ent_sig`/`entitlements`, then compute `entitled = readEntitlement({...result, key}, { product: APP_PRODUCT, publicKey: ENT_PUBLIC_KEY, grandfatherProduct: APP_PRODUCT, skipGrace: true }).entitled` and include `entitled` + `reason` in the returned object.
- `save-license` (line ~479): persist `version: 2`, `ent`, `ent_sig`, `entitlements` (already spreads `...licenseData`, so just make sure the renderer passes them — see 6c).
- `load-license` (line ~494): attach a freshly-computed `entitled`/`reason` for `APP_PRODUCT` (this is the offline/grace path — do **not** pass `skipGrace`).

### 6c. Renderer — `stride-vst/app/renderer/index.html`
- `checkLicense` (line ~1053): unlock only when `lic.valid && lic.entitled` (main computes `entitled`). Same for the grace-expired online branch.
- `activateLicense` (line ~1089): `if (result && result.valid && result.entitled)` → unlock; else if `result.valid && !result.entitled && result.reason === 'wrong-product'` → show an **"Upgrade to Stride VST"** message + link instead of a generic error.
- `cacheLicense` (line ~1151): add `version`, `ent`, `ent_sig`, `entitlements` to the `saveLicense` payload.

### 6d. VST (C++/JUCE)
Mirror the engine: embed the **same** public key, hit the same endpoint, verify Ed25519 (libsodium or a vendored ed25519 — JUCE has no built-in), reproduce `canonicalize` **byte-for-byte**, then gate with `product = 'vst'`, `grandfatherProduct = null`. Same 14-day grace. The JS module + its tests are the reference; consider exporting a few signed test vectors for a C++ conformance test.

## 7. Security model

- **Stops:** hand-editing `license.json` to add a product (signature breaks); using a StrideLink key on the VST (`wrong-product`); replaying a stale offline cache beyond 14 days (grace).
- **Does not stop:** patching the compiled binary to skip the check. Universal to client-side DRM; C++ is materially harder than Electron. Accepted — ROI is in conversion/goodwill, not a DRM fortress.
- **Private key** lives only as a Firebase secret. Never in the repo, client, or VST. Compromise = ability to forge → treat like any signing key.
- **Optional hardening (future):** bind a machine fingerprint into the signed payload to stop copying a signed `license.json` between machines within the grace window.

## 8. Rollout order (each step is safe on its own)

1. **Mint the keypair** once: `node -e "console.log(JSON.stringify(require('./stride-vst/app/lib/entitlements').generateKeypair()))"`. Store the private PEM as `STRIDE_ENT_PRIVATE_KEY` (Firebase secret); paste the public PEM into `main.js` (and later the VST).
2. **Fill config:** real LS `product_ids` + the `freeVstForStridelinkBeforeMs` cutoff in `DEFAULT_CONFIG`.
3. **Deploy backend.** Old clients ignore the new `ent`/`ent_sig` fields → zero regression.
4. **Ship the StrideLink update** that enforces entitlement (grandfathers v1 → no lockouts). Existing caches upgrade to signed v2 on next validation.
5. **Ship the VST** (`product='vst'`, `grandfather=null`).

**Why it's non-breaking:** the only behavior change for existing users is that the *VST* refuses to unlock offline from a *legacy* cache — and no legacy VST installs exist.

## 9. Test plan → `stride-vst/test/test-entitlements.js` (41 tests, green)

Covers: the full decision table (incl. cutoff boundary, aliases, fail-closed unknowns, giveaway on/off); builtin tiers; Ed25519 round-trip + tamper/wrong-key/garbage; the gate for every reason; the two load-bearing guarantees end-to-end — **(a)** a StrideLink-only key does not unlock the VST, **(b)** hand-adding `"vst"` to `license.json` fails the signature; and back-compat (v1 grandfather, v1 VST needs-online, v1 grace). Run: `node test/test-entitlements.js`. Full suite: 38/38 files pass.

## 10. Open inputs needed from you

1. **LS product IDs** for StrideLink and Stride VST (LS dashboard → each product's numeric id).
2. **Exact LS product names** (to confirm the name fallbacks in `DEFAULT_CONFIG`).
3. **Cutoff date** = VST launch day → epoch-ms (`freeVstForStridelinkBeforeMs`).
4. **Go-ahead to mint + store the keypair** (I can generate it locally; you set the Firebase secret).
