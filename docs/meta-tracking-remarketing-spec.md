# Spec — Meta purchaser capture + remarketing (2026-06-14)

**Goal:** Every Meta-sourced purchaser is (1) captured with maximum match data so Meta reliably identifies them, (2) attributed to the ad that drove them, and (3) usable for remarketing — keep showing ads to buyers (future products / reviews / referrals), feed lookalikes, and exclude them from acquisition.

## Current state (already working — do not rebuild)
- **Pixel** `952457524222772` base + PageView on landing (`frontend/index.html:33-74`); client `Purchase` on `frontend/welcome.html:79` with `eventID` dedup.
- **fbclid → _fbc → checkout → event:** captured `index.html:58-70`, carried to Lemon Squeezy via `checkout[custom][fbc]` (`index.html:828`), surfaces on webhook (`main.py:255`).
- **Server CAPI Purchase** (`firebase_cloud/functions/meta_capi.py`) fires from the LS `order_created` webhook (`main.py:365-387`) — the reliable, ad-blocker-proof path. Sends `em` (SHA-256), `fbc`, `fbp`, `client_user_agent`, value, currency, `event_id`.
- **Audiences (Ads Manager, all populating "Normal"):** purchasers 180d + 1% LAL; site-visitors 30d + 1% LAL; IG engagers + 1% LAL; "Visited, didn't buy 30d"; a general exclusion audience. Conversion ad sets exclude purchasers + prospect off the purchaser lookalike.

→ Core capture + remarketing infra exists. This spec **raises match quality** and **closes the remaining gaps**.

---

## PHASE 1 — Backend match-quality (no frontend) · ~30-45 min · LOW risk
Add match keys Meta uses, all from data already in the webhook. Empty fields are ignored by Meta, and CAPI errors are already swallowed (non-blocking).

**`meta_capi.py`** (user_data assembly ~L88-105; `_hash_pii` at L32-41):
- `fn`, `ln` — split webhook `name` into first/last, SHA-256 each.
- `country` — 2-letter ISO, lowercase, SHA-256. Source: LS order billing country (verify field at impl); fallback: derive from currency or omit.
- `external_id` — SHA-256 of `ls_customer_id` (stable per buyer; improves dedup/match).
- Bump Graph API `v18.0 → v21.0` (L29).

**`main.py`** (`_fire_meta_purchase_capi` call ~L369-384): also pass `name`, `country`, `ls_customer_id`.

**Impact:** higher Event Match Quality → more purchases attributed + more buyers correctly placed in audiences/lookalikes.

---

## PHASE 2 — Client IP capture (max match) · ~30 min · SMALL frontend change
Meta uses `client_ip_address`, but the webhook sees Lemon Squeezy's server IP, not the buyer's — so capture the buyer's IP client-side (same pattern as the UA pass-through).

- **New first-party endpoint** `whoami` (Firebase HTTPS fn) returns caller IP from `X-Forwarded-For`; CORS allow `stridehub.io`. (Avoids a third-party IP service; ipify is the fallback option.)
- **`index.html`**: on load, call `whoami`, store IP alongside fbc/ua, append `&checkout[custom][ip]=` at checkout (mirrors `index.html:820,830`). Sync root copy per repo rule.
- **`main.py`**: read `custom.get("ip")`; **`meta_capi.py`**: send as `client_ip_address` (raw, not hashed).

**Decision point:** adds a dependency for incremental gain — do it if we want max match; skippable if Phase 1 lift is enough.

---

## PHASE 3 — Ads Manager hygiene · ~10 min · I can do via API (+ 1 manual check)
- **Standardize purchaser exclusion:** conversion ad sets already exclude "רכשו באתר 180d" ✅; US + engagement sets use a different "general exclusion" — verify it includes purchasers, add the purchaser exclusion where missing so we never pay to re-acquire a buyer.
- **(Optional) extend purchaser audience retention** 180d → 365d for a longer remarketing window.
- **Manual (you):** Events Manager → pixel → `Purchase` → confirm browser+server **dedup** and check the **Event Match Quality** score (the one thing not visible via the ads API).

---

## PHASE 4 — "Keep putting ads on buyers" (remarketing campaign) · when there's an offer
The purchasers audience is ready to **target** (not exclude). But ads to buyers only pay off with something to show them:
- **TENDRIL** launch (the upcoming synth) = the natural purchaser-remarketing campaign.
- Or a review/testimonial ask, referral, or bundle upsell.

Audience is small today (~dozens) — too small for efficient delivery. **Plan:** keep capturing (Phases 1-2 grow/clean it); when there's a buyer offer + a few hundred buyers, stand up the campaign. (The more immediately valuable remarketing is retargeting "Visited, didn't buy" — also pending audience size.)

---

## Recommended order
**Phase 1** (quick, high ROI) → **Phase 3** (config hygiene) → **Phase 2** (if max match wanted) → **Phase 4** (when TENDRIL/offer ready).

## Open questions
1. Does the LS `order_created` payload include billing **country**? (confirms Phase 1 country field)
2. Want purchaser audience retention extended to **365d**?
3. Confirm **Graph API target version** (v21.0 proposed).
