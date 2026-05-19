# Stride — Meta Pixel Integration Spec

**Status:** Phase 1 ✅ shipped · Phase 2 ✅ shipped · Phase 3 ✅ code complete (awaiting Meta token + deploy)
**Pixel ID:** `952457524222772`
**Events fired per purchase:** `Purchase` (standard, for revenue/attribution) + `welcome` (custom, for conversion-campaign optimization). Both share the event_id so each one CAPI-dedupes independently. Meta does not cross-dedup across event names.
**Scope:** Track ad-campaign performance end-to-end — landing page traffic (PageView) and purchase conversions (Purchase + welcome events) — on both client and server, deduplicated.

---

## Summary

Add Meta's tracking pixel to the landing page and wire a Purchase event that fires when someone completes a Lemon Squeezy checkout. Do it in a way that survives ad blockers and iOS tracking restrictions, so Meta's campaign-optimization algorithm gets the strongest possible conversion signal.

---

## Why server-side AND client-side

A single client-side pixel was the standard ~5 years ago and is still the easiest thing to ship. Today it's lossy:

| Loss surface | Client-side only | Client + Server (CAPI) |
|---|---|---|
| Ad blockers (uBlock, Brave, etc.) | ~30-40% blocked | Server-side bypass |
| iOS Safari ITP (24h cookie expiry) | Tracks Day 1, loses Day 2+ | Server-side persists |
| Browser tracking-prevention defaults | Partial loss | Bypass |
| Failed JS / aggressive caching | Event never fires | Server-side fires anyway |
| User closes tab before pixel finishes | Lost | Server-side fires from webhook |

Meta's documented best practice: **fire from both, deduplicate via `event_id`**. Both events arrive at Meta with the same `event_id`, Meta counts them as one event with higher fidelity. Meta calls this match score "Event Match Quality (EMQ)" and uses it as a campaign optimization input — so this directly affects ad spend efficiency, not just measurement.

---

## Architecture

```
┌──────────────────────────────────────────────────────────────────┐
│  stridehub.io/                  (landing page, frontend/index)   │
│  ─────────────────────────                                       │
│  Meta Pixel snippet → fbq('init', PIXEL_ID)                      │
│                       fbq('track', 'PageView')                   │
│                                                                  │
│  Click "GET STRIDE" → href to Lemon Squeezy checkout             │
│                       (append ?event_id=<uuid> to track-back URL)│
└──────────────────────────┬───────────────────────────────────────┘
                           │
                           ▼
┌──────────────────────────────────────────────────────────────────┐
│  Lemon Squeezy checkout                                          │
└──────────────────────────┬───────────────────────────────────────┘
                           │
        ┌──────────────────┼───────────────────────┐
        │ on success: 2 parallel things happen     │
        ▼                                          ▼
┌─────────────────────────────────┐  ┌─────────────────────────────────┐
│  REDIRECT → /welcome.html?      │  │  WEBHOOK → main.py              │
│             event_id=<uuid>     │  │             _handle_lemon_webhook │
│             &order=<id>         │  │             event_name=order_created│
│                                 │  │                                 │
│  Client-side Purchase event:    │  │  Server-side Purchase via       │
│  fbq('track', 'Purchase', {     │  │  Meta Conversions API:          │
│    value: 39, currency: 'USD',  │  │  POST graph.facebook.com/v18.0/ │
│    eventID: <uuid>,             │  │       {pixel_id}/events         │
│  });                            │  │  {                              │
│                                 │  │    event_id: <uuid>,            │
│                                 │  │    event_name: 'Purchase',      │
│                                 │  │    value: 39, currency: 'USD',  │
│                                 │  │    user_data: {                 │
│                                 │  │      em: sha256(email),         │
│                                 │  │      client_ip_address: <ip>,   │
│                                 │  │      client_user_agent: <ua>,   │
│                                 │  │    }                            │
│                                 │  │  }                              │
└────────────────┬────────────────┘  └────────────────┬────────────────┘
                 │                                    │
                 └───────────────┬────────────────────┘
                                 ▼
                  ┌──────────────────────────────┐
                  │  Meta Events Manager         │
                  │  Both events arrive with     │
                  │  same event_id → dedup'd     │
                  │  as one Purchase event       │
                  │  with high match quality     │
                  └──────────────────────────────┘
```

**The `event_id` is the spine.** Generated once at checkout-click time, persisted through to the welcome page (via redirect URL) and to the webhook (via Lemon Squeezy "custom data" or the receipt URL match). Both events submit it. Meta deduplicates.

---

## Implementation phases

Strict order — each phase ships independently and adds value, even if later phases never ship.

### Phase 1 — Landing PageView (client-side, minimum viable tracking)

**Goal:** Meta sees ad clicks land on stridehub.io and counts traffic.

**Files:**
- `frontend/index.html` — paste the Meta Pixel snippet inside `<head>`. Source of truth.
- `index.html` (root, GitHub Pages) — sync.

**Changes:** Single paste of the provided snippet, plus sync. ~12 lines added.

**Verification:**
- Install [Meta Pixel Helper](https://chromewebstore.google.com/detail/meta-pixel-helper/fdgfkebogiimcoedlicjlajpkdmockpc) Chrome extension
- Visit stridehub.io after the next deploy
- Helper icon shows green "1 pixel found, 1 event PageView"
- In Meta Events Manager → Pixels → Test Events tab, the PageView shows up within a few seconds

**Done when:** PageView appears in Events Manager from a real browser visit.

---

### Phase 2 — Client-side Purchase on `/welcome` (Pageviewable conversion)

**Goal:** Lemon Squeezy success → buyer lands on welcome.html → Purchase event fires with the actual order value.

**Pre-work in Lemon Squeezy:**

1. **Set the redirect URL** on the Stride product:
   `https://stridehub.io/welcome.html?order={order_id}&amount={order_total}&event_id={custom_event_id}`
   (LS supports a Thank-You URL with template variables like `{order_id}` and `{order_total}` — exact variable names need confirmation against current LS UI; see "Edge cases" below.)

2. **Pass `event_id` through checkout** — generated client-side when the user clicks "GET STRIDE", appended to the checkout URL as `&checkout[custom][event_id]=<uuid>`. LS surfaces custom data on both the redirect URL and the webhook payload, which is how client + server stay matched.

**Files:**
- `frontend/index.html` — JS to generate a UUID v4 on every "GET STRIDE" click, store in `sessionStorage`, and append to the LS checkout URL as a custom param.
- `frontend/welcome.html` — paste the Meta Pixel snippet (PageView + Purchase). Parse `event_id`, `amount`, `order` from URL params. Fire:
  ```js
  fbq('init', '952457524222772');
  fbq('track', 'PageView');
  fbq('track', 'Purchase', {
      value: parseFloat(amount) || 39,
      currency: 'USD',
      content_name: 'Stride Sound Design Engine',
      content_ids: [order],
  }, { eventID: event_id });
  ```
- `welcome.html` (root) — sync.

**Why default value is 39 (USD):** if the URL params are missing/malformed (LS template variable changes, user pastes the URL manually), still fire SOMETHING rather than a zero-value Purchase. Meta heavily penalizes zero-value conversions.

**Done when:** A test purchase via LS → buyer lands on welcome.html → Meta Pixel Helper shows Purchase event with the right value → Events Manager Test Events shows the Purchase.

---

### Phase 3 — Server-side Purchase via Conversions API (CAPI)

**Goal:** Match-quality booster, ad-blocker bypass, iOS ITP survival. Same Purchase event fires from the server when Lemon Squeezy webhook arrives.

**Pre-work in Meta:**

1. Generate a Conversions API access token at Meta Events Manager → Pixel → Settings → "Generate access token". Store as `META_CAPI_ACCESS_TOKEN` env var (Firebase Functions secret).
2. Add to Firebase Functions deploy secrets list.

**Files (implemented):**
- `firebase_cloud/functions/meta_capi.py` (NEW) — pure helpers: `_hash_pii`, `_build_capi_payload`, `_fire_meta_purchase_capi`. Lives in its own module so the helpers are unit-testable without booting firebase_admin (which main.py imports at module load and would crash unauthenticated tests).
- `firebase_cloud/functions/main.py` — imports `_fire_meta_purchase_capi` from `meta_capi`, calls it from `_handle_lemon_webhook()` inside the `event_name == 'order_created'` branch after the existing Discord alert. Best-effort: any error logged, never breaks the webhook 200 response.
- `firebase_cloud/functions/main.py` — added `META_CAPI_ACCESS_TOKEN` to the `secrets=[...]` list on the function decorator.
- Uses `urllib.request.urlopen` (stdlib, already in main.py) — no new dependency added to `requirements.txt`.

**Payload shape (Conversions API v18+):**
```python
{
    "data": [{
        "event_name": "Purchase",
        "event_time": int(time.time()),                 # unix seconds
        "event_id": custom_data.get("event_id"),        # from LS custom data
        "event_source_url": "https://stridehub.io/welcome.html",
        "action_source": "website",
        "user_data": {
            # All PII fields hashed with sha256, lowercased + trimmed first
            "em": [hash_pii(email)],
            "client_ip_address": event_data.get("client_ip"),   # if available
            "client_user_agent": event_data.get("client_ua"),   # if available
        },
        "custom_data": {
            "value": float(order_total),
            "currency": order_currency.upper(),    # 'USD'
            "content_name": "Stride Sound Design Engine",
            "content_ids": [str(order_id)],
            "content_type": "product",
        },
    }],
}
```

Posted to `https://graph.facebook.com/v18.0/{PIXEL_ID}/events?access_token={CAPI_TOKEN}` with a strict 3-second timeout. Logs success/failure but never raises.

**Hashing helper (already a standard pattern):**
```python
def _hash_pii(value: str) -> str:
    if not value:
        return ""
    return hashlib.sha256(value.strip().lower().encode("utf-8")).hexdigest()
```

**Done when:** A test purchase shows Purchase in Events Manager under BOTH "Browser" and "Server" columns, and the dedup count shows them as one event.

### Phase 3 deploy steps (user-side, in order)

1. **Generate the access token in Meta:**
   - Go to [Meta Events Manager](https://business.facebook.com/events_manager2/list/pixel/952457524222772) → Pixel `952457524222772` → Settings tab
   - Scroll to "Conversions API" → "Generate access token"
   - Copy the token (you won't be able to view it again, only regenerate)

2. **Set the Firebase secret:**
   ```bash
   cd firebase_cloud
   firebase functions:secrets:set META_CAPI_ACCESS_TOKEN
   # Paste the token when prompted, hit Enter
   ```

3. **Deploy:**
   ```bash
   firebase deploy --only functions
   ```

4. **Verify dedup:**
   - Make a real $0.01 test purchase through LS (or use existing test mode)
   - Open Meta Events Manager → Test Events tab — should see Purchase from **both** Browser AND Server within ~30 seconds
   - Open Meta Events Manager → Overview tab → Events column should show one Purchase event (not two — the `event_id` deduplicates them)
   - Open Meta Events Manager → Diagnostics tab — should not flag mismatches

5. **Confirm webhook still 200s for LS** even if Meta is unreachable:
   - Temporarily set `META_CAPI_ACCESS_TOKEN` to garbage → webhook should still return 200 → LS dashboard webhook log confirms 200
   - Reset token to real value
   - This proves the best-effort guarantee — never block license issuance for ad tracking

---

## Tests

Three categories, all unit-testable without hitting real Meta endpoints.

### Phase 1 tests (none required — pure HTML paste)

Smoke test only: visit landing page, Meta Pixel Helper shows PageView. Manual.

### Phase 2 tests — UUID generation + URL parsing

New file: `frontend/test/test-pixel-checkout.html` (Jest-free, runs in browser).

Tests:
- `generateEventId()` returns a valid UUID v4 (format check)
- `generateEventId()` returns different IDs on each call
- Appending to LS checkout URL preserves existing query params
- `parsePurchaseParams()` on `?order=123&amount=39&event_id=abc` returns `{order:'123', amount:39, event_id:'abc'}`
- `parsePurchaseParams()` on missing params returns sensible defaults (value=39, currency='USD')
- `parsePurchaseParams()` rejects malformed `amount` (negative, non-numeric, NaN) → falls back to default
- `parsePurchaseParams()` on a URL with no params at all does not throw

### Phase 3 tests — CAPI integration

New file: `firebase_cloud/functions/test_meta_capi.py` (pytest, requests-mocked).

Tests:
- `_hash_pii('Test@Example.COM ')` → returns sha256 of `'test@example.com'` (lowercase + trim)
- `_hash_pii('')` → returns empty string (not error)
- `_hash_pii(None)` → returns empty string
- `_build_capi_payload(...)` produces the exact JSON Meta expects (snapshot test)
- `_fire_meta_purchase_capi` with mocked `requests.post`:
  - Returns True on 200
  - Returns False on 4xx (logged, not raised)
  - Returns False on connection timeout (logged, not raised)
  - Returns False on missing `META_CAPI_ACCESS_TOKEN` env var (logged, not raised)
  - **Never raises** — verify the function call wrapped in `assert_no_exception_raised`
- Integration: `_handle_lemon_webhook` with mocked CAPI:
  - `order_created` event triggers CAPI call exactly once
  - `license_key_created` event does NOT trigger CAPI (already-purchased customer)
  - Webhook still returns 200 even when CAPI call fails

---

## Edge cases & safety

| Scenario | Behavior |
|---|---|
| User runs an ad blocker (uBlock, Brave) | Client pixel blocked → server CAPI still fires → event still counted by Meta |
| User on iOS Safari with ITP | Client pixel may degrade after 24h → server CAPI persists |
| Lemon Squeezy webhook retry (same event twice) | Both fire CAPI → Meta dedupes via `event_id` (and existing webhook idempotency via `ls_order_id` lookup already prevents Firestore double-write) |
| LS redirect URL template variables change | URL params may be wrong → welcome.html falls back to default value=39 → CAPI uses the actual order value from webhook (source of truth) |
| Server-side CAPI down / timeout | Webhook still returns 200 to LS → client-side Purchase still counted → degraded but functional |
| Missing event_id (e.g. user pastes welcome URL directly) | Client + server fire WITHOUT event_id → Meta counts as 2 separate events → over-counts slightly. Acceptable for the rare manual-paste case. |
| Test events from Yossi's own browser | Use Meta's Test Events tab — fires with `test_event_code` param so they don't pollute real analytics |
| Privacy / GDPR | Need privacy.html update (see below). Don't ship Phase 1 until policy updated. |
| Stride app (Electron) — should pixel fire there? | NO — the desktop app is post-purchase. No tracking inside the app. |

---

## Privacy & legal

Adding tracking pixels requires the privacy policy to disclose:
- We use Meta Pixel + Meta Conversions API for ad measurement
- Data sent to Meta: page views, purchase events (value + currency + order ID), hashed email
- Users can opt out via Facebook ad preferences
- Cookie disclosure (Meta Pixel sets `_fbp` cookie)

**Action:** `frontend/privacy.html` gets a "Third-Party Services" section before Phase 1 ships. Sync to root.

No EU/UK cookie banner planned for v1 (small operation, no significant EU traffic yet). If/when EU campaigns ramp up, revisit consent mode.

---

## File touchpoints (summary)

| Phase | File | Change |
|---|---|---|
| 1 | `frontend/index.html` | Paste Meta Pixel snippet in `<head>` |
| 1 | `index.html` (root) | Sync from frontend |
| 1 | `frontend/privacy.html` | Add "Third-Party Services" section disclosing Meta Pixel |
| 1 | `privacy.html` (root) | Sync from frontend |
| 2 | `frontend/index.html` | Generate `event_id` UUID on "GET STRIDE" click, append to LS URL |
| 2 | `frontend/welcome.html` | Paste pixel snippet + URL-param parser + Purchase event fire |
| 2 | `welcome.html` (root) | Sync from frontend |
| 2 | `frontend/test/test-pixel-checkout.html` (NEW) | Unit tests for UUID gen + URL parser |
| 3 | `firebase_cloud/functions/main.py` | `_hash_pii`, `_build_capi_payload`, `_fire_meta_purchase_capi`. Wire into `_handle_lemon_webhook` for `order_created` only. |
| 3 | `firebase_cloud/functions/test_meta_capi.py` (NEW) | Pytest unit tests with mocked `requests.post` |
| 3 | Firebase secrets | Add `META_CAPI_ACCESS_TOKEN` |
| 3 | `firebase_cloud/functions/main.py` `@https_fn.on_request(secrets=[...])` | Add `META_CAPI_ACCESS_TOKEN` to the secrets list of the function that handles the LS webhook |

**Lines changed (rough):**
- Phase 1: ~20 lines (HTML paste + privacy section)
- Phase 2: ~60 lines (pixel + URL parsing + UUID gen + tests)
- Phase 3: ~120 lines (Python helpers + tests + wiring)

---

## Effort estimate

| Phase | Effort |
|---|---|
| 1 — Landing PageView | 30 min (paste + sync + privacy + Pixel Helper verify) |
| 2 — Welcome Purchase | 1.5 hours (LS config + UUID flow + welcome.html + tests + real test purchase) |
| 3 — Server-side CAPI | 2.5 hours (Meta token setup + Python helpers + tests + verify dedup in Events Manager) |

**Total: ~4.5 hours of focused work** + ~30 min of testing real purchases through LS.

Phases ship independently. Phase 1 alone gives basic traffic measurement. Phase 1 + 2 gives campaign optimization signal that works for the ~70% of users who aren't blocking pixels. Phase 1 + 2 + 3 is the full setup with ~95%+ event match rate.

**Recommendation:** ship Phase 1 immediately (no campaign optimization risk, just measurement), then Phase 2 + 3 together when the campaign is about to start so the optimization signal is strong from day one.

---

## What this spec does NOT change

To keep scope tight:
- No tracking inside the Stride desktop app (Electron) — desktop is post-purchase, no marketing surface
- No tracking on blog pages — separate decision if/when content marketing becomes a priority
- No Google Analytics, no other pixels — Meta only for now
- No A/B testing framework — different feature
- No conversion modeling for Apple iOS 14.5+ ATT — different framework (Meta SKAdNetwork), only relevant for mobile app campaigns which we don't run

---

## Verification checklist (before declaring "live")

1. **Phase 1**: Meta Pixel Helper shows green + PageView on stridehub.io after deploy
2. **Phase 1**: Meta Events Manager → Test Events tab shows PageView from your browser
3. **Phase 2**: Real test purchase via LS → buyer lands on welcome.html → Pixel Helper shows Purchase event with value=39, currency=USD → Events Manager shows Purchase under "Browser" column
4. **Phase 3**: Same test purchase → Events Manager shows Purchase under BOTH "Browser" AND "Server" columns → "Event Match Quality" rated Good or Great → deduplication confirmed in Diagnostics tab
5. **Privacy**: stridehub.io/privacy reflects Meta Pixel disclosure
6. **Tests**: all new tests pass (frontend test + Python pytest)
7. **No regressions**: existing LS webhook flow still works (license issuance, Firestore write, Discord alert, customer email all still fire)

---

## Resume checklist

When implementing:

1. Re-read this spec
2. Confirm with user: "starting Meta Pixel integration per locked spec"
3. Phase 1 first — ship + verify before moving on
4. Phase 2 next — needs LS dashboard config first (redirect URL, custom data flow)
5. Phase 3 last — needs Meta CAPI access token first
6. After all phases pass verification, declare live + monitor Events Manager for a week to confirm steady event flow

If implementation pauses mid-phase:

- Phase 1: complete the HTML paste + sync + privacy, then stop. Safe state.
- Phase 2: complete the welcome.html paste before merging. Don't ship event_id generation without the welcome.html consumer — that just leaves dead query params.
- Phase 3: don't merge until tests pass + a real test purchase has been verified end-to-end through both Browser and Server columns.
