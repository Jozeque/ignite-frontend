"""Meta Conversions API helpers for the Stride backend.

Phase 3 of docs/meta-pixel-integration-spec.md. Fires a server-side
Purchase event into Meta whenever LS sends order_created. Deduplicates
with the client-side fbq('track','Purchase') in welcome.html via a
shared event_id (passed through LS checkout custom_data → surfaces at
payload.meta.custom_data.event_id on the webhook).

Why server-side at all: ~30-40% of buyers run ad blockers or browsers
with tracking prevention, so the client-side Purchase event silently
fails for them. CAPI is the bypass — Meta's optimizer treats both events
as one when event_id matches, and as authoritative when only the server
event arrives.

Lives in its own module so the pure helpers are unit-testable without
booting Firebase Admin (which main.py initialises at import time).
"""

import hashlib
import json
import os
import time
import urllib.parse
import urllib.request
import uuid


META_PIXEL_ID = "952457524222772"
# Graph API version for CAPI POSTs. v18.0 (Oct 2023) still answers but is far
# past Meta's ~2-year version window and can be dropped without much notice;
# the insights code in main.py already calls v23.0. Keep these in step.
META_CAPI_VERSION = "v23.0"

# "Stride - Purchasers (CRM)" customer-list audience. Every paid order adds the
# buyer's hashed email here from the webhook, so ad sets excluding this list
# stop showing ads to customers automatically — no more manual re-uploads
# (the list had gone 3 weeks stale before the 2026-07-28 refresh, which meant
# summer-sale ads would have been shown to people who just paid full price).
META_BUYERS_AUDIENCE_ID = "120252721670600440"


def _hash_pii(value):
    """SHA256 of trimmed + lowercased value. Meta requires PII fields
    (email, phone, name) hashed this way before sending. Returns '' on
    falsy input. Never raises."""
    if not value:
        return ""
    try:
        return hashlib.sha256(str(value).strip().lower().encode("utf-8")).hexdigest()
    except Exception:
        return ""


# Event names fired for each Stride purchase. Both share the event_id so
# Meta deduplicates client+server per event independently (dedup is keyed
# on event_name + event_id, so different event names sharing an event_id
# are still counted as two separate events).
#   Purchase  — standard event for revenue attribution and Meta's standard
#               optimization. Carries value + currency + content_ids.
#   welcome   — custom conversion event used as the optimization target
#               for the conversion campaign. Same payload as Purchase so
#               Meta has data to optimize against.
CAPI_EVENT_NAMES = ("Purchase", "welcome")


def _build_capi_payload(order_data, event_id):
    """Build the Meta Conversions API v18.0 request body for the Stride
    purchase events. Pure function, no side effects — easy to snapshot-test.

    Emits BOTH a 'Purchase' standard event and a 'welcome' custom event in
    the same payload (matches the client-side fbq() calls in welcome.html).
    Both events share the event_id so each one deduplicates against its
    client counterpart; Meta does not cross-dedup across event names.

    order_data: dict with keys email, order_id, order_identifier,
        total_cents, currency. All optional; sensible fallbacks applied.
    event_id: shared with the client-side fbq() call for dedup. Empty
        string is accepted — server generates a UUID so the event still
        lands (no client dedup in that case, slight over-count)."""
    email = (order_data.get("email") or "").strip().lower()
    total_cents = order_data.get("total_cents")
    tax_cents = order_data.get("tax_cents")
    try:
        value = float(total_cents or 0) / 100.0
    except (TypeError, ValueError):
        value = 0.0
    # Net the tax off. LS `total` is gross (product + VAT), and reporting gross
    # made an EU buyer of a $79 product look like a $94.80 conversion while a US
    # buyer of the SAME product looked like $79 — inflating ROAS by up to ~20%
    # and biasing the optimizer toward high-VAT countries. `total - tax` is the
    # revenue actually earned. Note LS `subtotal` is PRE-discount, so it is the
    # wrong field here: a 50%-off order has subtotal 79.00 but earns 39.50.
    try:
        value = round(value - (float(tax_cents or 0) / 100.0), 2)
    except (TypeError, ValueError):
        pass
    # Meta penalizes 0-value Purchase events in campaign optimization,
    # so fall back to the current list price rather than send zero.
    # Summer sale $79 until 2026-08-31, then back to $129 — bump on flip.
    if value <= 0:
        value = 79.0
    currency = (order_data.get("currency") or "USD").upper()
    order_id = str(
        order_data.get("order_id")
        or order_data.get("order_identifier")
        or ""
    )

    user_data = {}
    if email:
        user_data["em"] = [_hash_pii(email)]
    # Meta attribution fields — captured at landing-page time from the
    # ad click and passed through LS custom checkout data. fbc/fbp/UA
    # are NOT hashed (Meta requirement); they're raw cookie/header
    # values. Each is optional — when missing, CAPI still works but
    # match quality drops, which costs us on campaign optimization.
    fbc = (order_data.get("fbc") or "").strip()
    if fbc:
        user_data["fbc"] = fbc
    fbp = (order_data.get("fbp") or "").strip()
    if fbp:
        user_data["fbp"] = fbp
    client_ua = (order_data.get("client_user_agent") or "").strip()
    if client_ua:
        user_data["client_user_agent"] = client_ua
    # client_ip_address (raw, NOT hashed) — Meta's top Purchase match rec
    # (~+6.28% additional conversions). Recovered from the buyer_lead, which
    # captured the buyer's IP server-side at checkout-intent.
    client_ip = (order_data.get("client_ip_address") or "").strip()
    if client_ip:
        user_data["client_ip_address"] = client_ip
    # first/last name (hashed) from the Lemon Squeezy order — Meta's
    # name/address match rec. Each hashed field is an array of one hash.
    fn = order_data.get("first_name")
    if fn:
        user_data["fn"] = [_hash_pii(fn)]
    ln = order_data.get("last_name")
    if ln:
        user_data["ln"] = [_hash_pii(ln)]

    resolved_event_id = event_id or str(uuid.uuid4())
    event_time = int(time.time())
    custom_data = {
        "value": round(value, 2),
        "currency": currency,
        "content_name": "Stride Sound Design Engine",
        "content_type": "product",
        "content_ids": [order_id] if order_id else [],
    }

    return {
        "data": [
            {
                "event_name": name,
                "event_time": event_time,
                "event_id": resolved_event_id,
                "event_source_url": "https://stridehub.io/welcome.html",
                "action_source": "website",
                "user_data": user_data,
                "custom_data": custom_data,
            }
            for name in CAPI_EVENT_NAMES
        ]
    }


def _fire_meta_purchase_capi(order_data, event_id):
    """POST a Purchase event to Meta's Conversions API. Best-effort —
    NEVER raises. Returns True on HTTP 2xx, False on missing token,
    timeout, non-2xx, or any other failure. All paths logged.

    Token is mandatory: Meta rejects unauthenticated CAPI calls. If the
    token isn't set we silently skip (logged once) and let the
    client-side Pixel event carry the conversion alone."""
    token = os.environ.get("META_CAPI_ACCESS_TOKEN") or ""
    if not token:
        print("[Meta CAPI] META_CAPI_ACCESS_TOKEN not set — skipping server-side Purchase")
        return False

    try:
        payload = _build_capi_payload(order_data, event_id)
        url = (
            f"https://graph.facebook.com/{META_CAPI_VERSION}/"
            f"{META_PIXEL_ID}/events?access_token={urllib.parse.quote(token, safe='')}"
        )
        req = urllib.request.Request(
            url,
            data=json.dumps(payload).encode("utf-8"),
            headers={
                "Content-Type": "application/json",
                "User-Agent": "Stride-Backend/1.0",
            },
        )
        with urllib.request.urlopen(req, timeout=3) as resp:
            status = resp.getcode()
            body = resp.read().decode("utf-8", "replace")
        first = payload["data"][0]
        names = ",".join(ev.get("event_name", "?") for ev in payload["data"])
        # Which match keys actually went out. A 200'd event that still doesn't
        # attribute is almost always thin user_data (no fbc / no hashed email),
        # so log the keys present — this is the single most useful diagnostic.
        ud = first.get("user_data", {})
        keys = ",".join(k for k in ("em", "fbc", "fbp", "client_user_agent") if ud.get(k)) or "NONE"
        if 200 <= status < 300:
            recvd = trace = "?"
            msgs = []
            try:
                rj = json.loads(body)
                recvd = rj.get("events_received", "?")
                trace = rj.get("fbtrace_id", "")
                msgs = rj.get("messages") or []
            except Exception:
                pass
            print(
                f"[Meta CAPI] sent events=[{names}] event_id={first['event_id']} "
                f"value={first['custom_data']['value']} status={status} "
                f"received={recvd} match_keys=[{keys}] fbtrace={trace}"
                + (f" messages={msgs}" if msgs else "")
            )
            return True
        print(f"[Meta CAPI] non-2xx status {status} match_keys=[{keys}] body={body[:300]}")
        return False
    except Exception as e:
        # urllib.error.HTTPError, URLError, socket.timeout, JSON errors,
        # anything — all swallowed. Webhook MUST 200 for LS.
        print(f"[Meta CAPI] POST failed: {e}")
        return False


def _fire_meta_lead_capi(user_data, event_id):
    """Server-side Lead event → Meta CAPI, fired for FREE demo downloads only.

    A demo (LS product 1190710) is a $0 download, NOT a purchase. Until
    2026-07-06 this backend fired Purchase + 'welcome' for it anyway (and the
    $0 total got bumped to the $59 list-price fallback in _build_capi_payload),
    which (a) inflated purchase count + ROAS and (b) trained the conversion
    campaign's 'welcome' optimization target to chase demo-grabbers who rarely
    buy. This distinct $0 Lead event keeps the demo signal — so you can build a
    'demo downloaders' Custom Audience to retarget OR exclude from prospecting —
    without ever touching Purchase, revenue, or 'welcome'. Best-effort; never
    raises. Carries the same match keys so the audience is usable."""
    token = os.environ.get("META_CAPI_ACCESS_TOKEN") or ""
    if not token:
        return False
    try:
        ud = {}
        email = (user_data.get("email") or "").strip().lower()
        if email:
            ud["em"] = [_hash_pii(email)]
        fn = user_data.get("first_name")
        if fn:
            ud["fn"] = [_hash_pii(fn)]
        ln = user_data.get("last_name")
        if ln:
            ud["ln"] = [_hash_pii(ln)]
        for k in ("fbc", "fbp", "client_ip_address", "client_user_agent"):
            v = (user_data.get(k) or "").strip()
            if v:
                ud[k] = v
        payload = {
            "data": [
                {
                    "event_name": "Lead",
                    "event_time": int(time.time()),
                    "event_id": event_id or str(uuid.uuid4()),
                    "event_source_url": "https://stridehub.io/",
                    "action_source": "website",
                    "user_data": ud,
                    # value 0 — a demo is worth nothing in revenue terms. Never
                    # fall back to list price here (that was the original bug).
                    "custom_data": {
                        "value": 0.0,
                        "currency": "USD",
                        "content_name": "Stride Free Demo",
                        "content_type": "product",
                    },
                }
            ]
        }
        url = (
            f"https://graph.facebook.com/{META_CAPI_VERSION}/"
            f"{META_PIXEL_ID}/events?access_token={urllib.parse.quote(token, safe='')}"
        )
        req = urllib.request.Request(
            url,
            data=json.dumps(payload).encode("utf-8"),
            headers={"Content-Type": "application/json", "User-Agent": "Stride-Backend/1.0"},
        )
        with urllib.request.urlopen(req, timeout=3) as resp:
            status = resp.getcode()
        keys = ",".join(k for k in ("em", "fbc", "fbp", "client_ip_address") if ud.get(k)) or "NONE"
        ok = 200 <= status < 300
        print(f"[Meta CAPI] Lead (free demo) status={status} match_keys=[{keys}]")
        return ok
    except Exception as e:
        print(f"[Meta CAPI Lead] POST failed: {e}")
        return False


def _add_buyer_to_meta_exclusion(email):
    """Add a buyer's hashed email to the 'Stride - Purchasers (CRM)' customer
    list (META_BUYERS_AUDIENCE_ID) so purchaser-excluding ad sets stop serving
    them ads. Fired from the LS order_created webhook for every PAID order
    (never demos — demo users are prime retargeting prospects, not customers).

    Uses META_ACCESS_TOKEN (the Marketing-API token the ad_dashboard action
    already holds as a secret) — audience writes need ads_management, which the
    CAPI token doesn't carry. Additive only; the email is SHA256-hashed locally
    and users stay on the list indefinitely. Best-effort: never raises, the
    webhook must 200 for LS regardless."""
    token = os.environ.get("META_ACCESS_TOKEN") or ""
    hashed = _hash_pii(email)
    if not token or not hashed:
        if not token:
            print("[Meta Audience] META_ACCESS_TOKEN not set — skipping buyer exclusion add")
        return False
    try:
        body = urllib.parse.urlencode({
            "payload": json.dumps({"schema": ["EMAIL"], "data": [[hashed]]}),
            "access_token": token,
        }).encode("utf-8")
        req = urllib.request.Request(
            f"https://graph.facebook.com/{META_CAPI_VERSION}/{META_BUYERS_AUDIENCE_ID}/users",
            data=body,
            headers={"Content-Type": "application/x-www-form-urlencoded", "User-Agent": "Stride-Backend/1.0"},
        )
        with urllib.request.urlopen(req, timeout=3) as resp:
            status = resp.getcode()
            rbody = resp.read().decode("utf-8", "replace")
        ok = 200 <= status < 300
        recvd = "?"
        try:
            recvd = json.loads(rbody).get("num_received", "?")
        except Exception:
            pass
        print(f"[Meta Audience] buyer exclusion add status={status} num_received={recvd}")
        return ok
    except Exception as e:
        # A permission error here means META_ACCESS_TOKEN lacks ads_management —
        # refresh the secret with the Marketing-API token and redeploy.
        print(f"[Meta Audience] buyer exclusion add failed: {e}")
        return False


def _build_pageview_payload(user_data, event_id, event_source_url):
    """Build a server-side PageView event for the Conversions API. Used to grow
    the website Custom Audiences (retargeting pools): the browser pixel's
    PageView is blocked/unmatched for most iOS/Safari/ad-blocker visitors, but a
    server event carrying the visitor's IP + user-agent + fbp lets Meta match
    them anyway. action_source='website' + a URL makes it qualify for the
    'all website visitors' audience rule."""
    ud = {}
    # external_id = first-party visitor id (raw, non-PII) sent on every event;
    # the main lever for PageView Event Match Quality on email-less cold traffic.
    for k in ("fbp", "fbc", "external_id", "client_ip_address", "client_user_agent"):
        v = user_data.get(k)
        if isinstance(v, str):
            v = v.strip()
        if v:
            ud[k] = v
    return {
        "data": [
            {
                "event_name": "PageView",
                "event_time": int(time.time()),
                "event_id": event_id or str(uuid.uuid4()),
                "event_source_url": event_source_url or "https://stridehub.io/",
                "action_source": "website",
                "user_data": ud,
            }
        ]
    }


def _fire_meta_pageview_capi(user_data, event_id, event_source_url):
    """POST a server-side PageView to Meta's CAPI. Best-effort — never raises.
    Returns True on HTTP 2xx, False otherwise. The IP comes from the request on
    the server side (the one signal the browser can't reliably deliver), so this
    is what actually fills the website retargeting audiences."""
    token = os.environ.get("META_CAPI_ACCESS_TOKEN") or ""
    if not token:
        return False
    try:
        payload = _build_pageview_payload(user_data, event_id, event_source_url)
        url = (
            f"https://graph.facebook.com/{META_CAPI_VERSION}/"
            f"{META_PIXEL_ID}/events?access_token={urllib.parse.quote(token, safe='')}"
        )
        req = urllib.request.Request(
            url,
            data=json.dumps(payload).encode("utf-8"),
            headers={"Content-Type": "application/json", "User-Agent": "Stride-Backend/1.0"},
        )
        with urllib.request.urlopen(req, timeout=3) as resp:
            status = resp.getcode()
        ud = payload["data"][0].get("user_data", {})
        keys = ",".join(k for k in ("fbp", "fbc", "client_ip_address", "client_user_agent") if ud.get(k)) or "NONE"
        ok = 200 <= status < 300
        if not ok:
            print(f"[Meta CAPI PageView] non-2xx status {status} match_keys=[{keys}]")
        return ok
    except Exception as e:
        print(f"[Meta CAPI PageView] POST failed: {e}")
        return False


def _fire_meta_initiatecheckout_capi(user_data, event_id):
    """Server-side InitiateCheckout (checkout-intent) → Meta CAPI. Fired from the
    buyer_lead handler the instant a buyer enters their email + hits Buy (before
    they bounce to Lemon Squeezy). That moment carries our richest match data
    (hashed email + fbp + fbc + IP + UA + external_id), so it builds a
    high-quality, high-INTENT audience: 'started checkout'. Retarget those who
    InitiateCheckout but don't Purchase = cart abandoners. Best-effort; never
    raises. Shares event_id with the browser pixel InitiateCheckout for dedup."""
    token = os.environ.get("META_CAPI_ACCESS_TOKEN") or ""
    if not token:
        return False
    try:
        ud = {}
        email = (user_data.get("email") or "").strip().lower()
        if email:
            ud["em"] = [_hash_pii(email)]
        for k in ("fbp", "fbc", "external_id", "client_ip_address", "client_user_agent"):
            v = user_data.get(k)
            if isinstance(v, str):
                v = v.strip()
            if v:
                ud[k] = v
        payload = {
            "data": [
                {
                    "event_name": "InitiateCheckout",
                    "event_time": int(time.time()),
                    "event_id": event_id or str(uuid.uuid4()),
                    "event_source_url": "https://stridehub.io/",
                    "action_source": "website",
                    "user_data": ud,
                    # Matches the browser InitiateCheckout in index.html. Keep the
                    # two in step: summer sale $79 until 2026-08-31, then $129.
                    "custom_data": {"value": 79.0, "currency": "USD", "content_name": "Stride Sound Design Engine"},
                }
            ]
        }
        url = (
            f"https://graph.facebook.com/{META_CAPI_VERSION}/"
            f"{META_PIXEL_ID}/events?access_token={urllib.parse.quote(token, safe='')}"
        )
        req = urllib.request.Request(
            url,
            data=json.dumps(payload).encode("utf-8"),
            headers={"Content-Type": "application/json", "User-Agent": "Stride-Backend/1.0"},
        )
        with urllib.request.urlopen(req, timeout=3) as resp:
            return 200 <= resp.getcode() < 300
    except Exception as e:
        print(f"[Meta CAPI InitiateCheckout] POST failed: {e}")
        return False
