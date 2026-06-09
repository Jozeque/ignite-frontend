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
META_CAPI_VERSION = "v18.0"


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
    try:
        value = float(total_cents or 0) / 100.0
    except (TypeError, ValueError):
        value = 0.0
    # Meta penalizes 0-value Purchase events in campaign optimization,
    # so fall back to the current list price rather than send zero.
    # Bump this if the base price flips again (founding $39 era ended
    # 2026-05-24 → flat $59).
    if value <= 0:
        value = 59.0
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
