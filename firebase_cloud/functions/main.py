from firebase_functions import https_fn, options, firestore_fn
from flask import send_file, jsonify
import mido
import json
import os
import re
import time
import urllib.request
import urllib.parse
import uuid
import io
import hmac
import hashlib
from datetime import datetime, timedelta
from mido import Message, MidiFile, MidiTrack

# --- ALC Sound Design Imports ---
import math
import random
import gzip
import xml.etree.ElementTree as ET

# --- New Security Imports ---
import firebase_admin
from firebase_admin import auth as admin_auth
from firebase_admin import firestore as admin_firestore
from firebase_admin import storage

# Initialize Admin SDK for Server-Side verification & Storage
if not firebase_admin._apps:
    firebase_admin.initialize_app(options={
        'storageBucket': 'veero-next.firebasestorage.app'
    })

try:
    from google import genai
    from google.genai import types
    GEMINI_READY = True
except ImportError:
    GEMINI_READY = False

# --- Supabase (dual-write alongside Firestore) ---
# Lazy-init: secrets are injected at request time, not at import time
SUPABASE_URL = "https://hqhngkgcivdqkqpcqfvb.supabase.co"
SUPABASE_READY = False
supabase = None

def _ensure_supabase():
    global supabase, SUPABASE_READY
    if SUPABASE_READY:
        return True
    try:
        from supabase import create_client
        key = os.environ.get("SUPABASE_SERVICE_KEY", "")
        if not key:
            print("[Supabase] SUPABASE_SERVICE_KEY not found in environment")
            return False
        supabase = create_client(SUPABASE_URL, key)
        SUPABASE_READY = True
        print("[Supabase] Client initialized successfully")
        return True
    except Exception as e:
        print(f"[Supabase] Init failed: {e}")
        return False

def sb_upsert_user(uid, email, is_admin=False, display_name=None):
    """Upsert user into Supabase (non-blocking)."""
    if not _ensure_supabase(): return
    try:
        row = {
            "id": uid,
            "email": email,
            "is_admin": is_admin,
            "last_seen_at": datetime.utcnow().isoformat()
        }
        if display_name:
            row["display_name"] = display_name
        supabase.table("users").upsert(row, on_conflict="id").execute()
    except Exception as e:
        print(f"[Supabase] user upsert error: {e}")

def sb_log_generation(uid, data_dict, display_name=None):
    """Log a generation to Supabase (non-blocking)."""
    if not _ensure_supabase(): return
    try:
        row = {"user_id": uid}
        if display_name:
            row["display_name"] = display_name
        row.update(data_dict)
        supabase.table("generations").insert(row).execute()
    except Exception as e:
        print(f"[Supabase] generation log error: {e}")

def sb_update_credits(uid, credits_used, generations_count, last_active_month):
    """Sync credit state to Supabase (non-blocking)."""
    if not _ensure_supabase(): return
    try:
        supabase.table("users").update({
            "credits_used": credits_used,
            "generations_count": generations_count,
            "last_active_month": last_active_month
        }).eq("id", uid).execute()
    except Exception as e:
        print(f"[Supabase] credit update error: {e}")

API_KEY = os.environ.get("GEMINI_API_KEY")
ADMIN_WEBHOOK_URL = os.environ.get("ADMIN_WEBHOOK_URL")
RESEND_API_KEY = os.environ.get("RESEND_API_KEY")

# Plain-text welcome email sent once per customer after license_key_created.
# Personal tone + plain text + no tracking maximises Gmail Primary tab landing.
WELCOME_EMAIL_TEMPLATE = """\
Hey{name_part},

Joe here, welcome aboard.

Start here, a 3-minute video walkthrough. Covers the exact setup so you're rolling on the first try.

stridehub.io/welcome

Stuck on anything? That same page has a Book a Call button. Pick a slot, I'll get you moving.

Stride turns your existing racks into sound design playgrounds. Same rack, infinite variations. You're about to discover sounds in your own instruments you didn't know were there.

A quick note on workflow: Stride is a creative tool, not a mixing tool. You draw curves first, then hear them after — that loop is built for exploration, not for tight mixing feedback. Lean into it for variation, motion, and "what does this preset do that I haven't tried yet."

Your license key is in the Lemon Squeezy receipt that came separately. Paste it on first launch.

Reply to this email anytime.

Best regards,
Joe
"""

# Where contact-form messages get mirrored — admin handles every customer
# inquiry from one Gmail inbox. Two recipients for redundancy in case the
# stridehub.io→Gmail forwarding ever breaks. Buyer leads + waitlist signups
# deliberately stay on Discord (high volume, no reply expected).
CONTACT_FORM_RECIPIENTS = [
    "home@stridehub.io",
    "stride.engine@gmail.com",
]


def _send_welcome_email(email: str, full_name: str) -> bool:
    """Send the post-purchase welcome email via Resend. Returns True on success.

    Failures are logged but never raised — webhook must still 200.
    Skipped silently if RESEND_API_KEY is unset (safe to deploy before secret).
    """
    if not RESEND_API_KEY:
        print("[Welcome Email] RESEND_API_KEY not set — skipping send")
        return False
    if not email:
        print("[Welcome Email] no recipient — skipping send")
        return False

    first_name = (full_name or "").strip().split(" ")[0] if full_name else ""
    name_part = f" {first_name}" if first_name else ""
    body = WELCOME_EMAIL_TEMPLATE.format(name_part=name_part)

    try:
        import resend
        resend.api_key = RESEND_API_KEY
        result = resend.Emails.send({
            "from": "Joe <home@stridehub.io>",
            "to": [email],
            "reply_to": "home@stridehub.io",
            "subject": "Welcome to Stride",
            "text": body,
        })
        print(f"[Welcome Email] sent to {email} id={result.get('id') if isinstance(result, dict) else result}")
        return True
    except Exception as e:
        print(f"[Welcome Email] send failed for {email}: {e}")
        return False

def parse_midi_to_json(midi_bytes):
    """Parses a raw MIDI byte stream into a simplified JSON note array for Gemini."""
    mid = MidiFile(file=io.BytesIO(midi_bytes))
    notes = []
    active_notes = {}
    current_time = 0
    for msg in mid:
        current_time += msg.time
        if msg.type == 'note_on' and msg.velocity > 0:
            active_notes[msg.note] = {"s": current_time, "v": msg.velocity}
        elif msg.type == 'note_off' or (msg.type == 'note_on' and msg.velocity == 0):
            if msg.note in active_notes:
                start_time = active_notes[msg.note]["s"]
                duration = current_time - start_time
                notes.append({"n": msg.note, "s": start_time, "d": duration, "v": active_notes[msg.note]["v"]})
                del active_notes[msg.note]
    return {"notes": notes}

def safe_int(val, default=0):
    """Bulletproof integer conversion to prevent TypeErrors from bad client payloads."""
    try:
        if val is None:
            return default
        if isinstance(val, str) and not val.strip():
            return default
        return int(float(val))
    except (ValueError, TypeError):
        return default

# ─── Lemon Squeezy integration ────────────────────────────────────────
# Two public entry points (no Firebase auth required):
#   1. Webhooks from LS (order_created, license_key_created) — HMAC-authenticated
#   2. License validation proxy — called from the Electron desktop app
#
# Secrets injected via Firebase Secret Manager:
#   LEMONSQUEEZY_API_KEY         — store API key (used to call LS API)
#   LEMONSQUEEZY_WEBHOOK_SECRET  — webhook signing secret (used to verify HMAC)

def _handle_lemon_webhook(raw_body: bytes, event_name: str, received_sig: str):
    """Receive a Lemon Squeezy webhook, verify HMAC, upsert customer in Firestore.

    raw_body:      the unparsed request body bytes (needed for HMAC signature check)
    event_name:    value of X-Event-Name header (e.g. 'order_created', 'license_key_created')
    received_sig:  value of X-Signature header (hex HMAC-SHA256 of raw_body)
    """
    secret = os.environ.get("LEMONSQUEEZY_WEBHOOK_SECRET", "")
    if not secret:
        print("[LS Webhook] LEMONSQUEEZY_WEBHOOK_SECRET not set — rejecting")
        return jsonify({"error": "webhook not configured"}), 500

    expected_sig = hmac.new(secret.encode("utf-8"), raw_body, hashlib.sha256).hexdigest()
    if not hmac.compare_digest(expected_sig, (received_sig or "").strip()):
        print(f"[LS Webhook] REJECTED signature for event={event_name}")
        return jsonify({"error": "invalid signature"}), 401

    try:
        payload = json.loads(raw_body.decode("utf-8") or "{}")
    except Exception as je:
        print(f"[LS Webhook] invalid JSON: {je}")
        return jsonify({"error": "invalid json"}), 400

    data_obj = payload.get("data") or {}
    attrs = data_obj.get("attributes") or {}
    email = (attrs.get("user_email") or "").lower().strip()
    name = (attrs.get("user_name") or "").strip()
    print(f"[LS Webhook] event={event_name} id={data_obj.get('id')} email={email}")

    try:
        _db = admin_firestore.client()
    except Exception as dbe:
        print(f"[LS Webhook] Firestore client failed: {dbe}")
        # Still return 200 so LS doesn't retry forever — log it for manual recovery
        return jsonify({"received": True, "warning": "firestore unavailable"}), 200

    try:
        if event_name == "order_created":
            order_item = attrs.get("first_order_item") or {}
            doc_data = {
                "name": name,
                "email": email,
                "source": "lemonsqueezy",
                "status": "purchased",
                "ls_order_id": str(data_obj.get("id") or ""),
                "ls_customer_id": attrs.get("customer_id"),
                "ls_product_id": order_item.get("product_id"),
                "ls_variant_id": order_item.get("variant_id"),
                "order_identifier": attrs.get("identifier"),
                "total_cents": attrs.get("total"),
                "currency": attrs.get("currency"),
                "purchased_at": admin_firestore.SERVER_TIMESTAMP,
                "updated_at": admin_firestore.SERVER_TIMESTAMP,
            }

            # Find existing row to merge into. Check BOTH email and ls_order_id:
            # - email match catches prior waitlist signups / buy-modal leads
            # - ls_order_id match catches orphans created by a license_key_created
            #   webhook that arrived BEFORE this order_created (rare but real —
            #   LS doesn't guarantee webhook order). Without the ls_order_id
            #   check, we'd create a duplicate row with USD+email while the
            #   orphan kept the license key → two partial records per customer.
            order_id_str = str(data_obj.get("id") or "")
            match = None
            if email:
                found = list(
                    _db.collection("waitlist").where("email", "==", email).limit(1).stream()
                )
                if found:
                    match = found[0]
            if match is None and order_id_str:
                found = list(
                    _db.collection("waitlist").where("ls_order_id", "==", order_id_str).limit(1).stream()
                )
                if found:
                    match = found[0]
                    print(f"[LS Webhook] found orphan row {match.id} by ls_order_id — merging")

            if match is not None:
                match.reference.update(doc_data)
                print(f"[LS Webhook] upgraded lead {match.id} → customer")
            else:
                _db.collection("waitlist").add({
                    **doc_data,
                    "created_at": admin_firestore.SERVER_TIMESTAMP,
                })
                print(f"[LS Webhook] new customer record for {email}")

            # Discord alert
            if ADMIN_WEBHOOK_URL and email:
                try:
                    amount_str = ""
                    if attrs.get("total") is not None:
                        amount_str = f"${(attrs.get('total', 0) or 0) / 100:.2f} {attrs.get('currency', '')}"
                    msg = {
                        "username": "Stride Engine",
                        "content": (
                            f"🔑 **NEW CUSTOMER**\n"
                            f"**Name:** `{name or '?'}`\n"
                            f"**Email:** `{email}`\n"
                            f"**Amount:** `{amount_str or '?'}`\n"
                            f"**Order:** `{attrs.get('identifier') or '?'}`"
                        ),
                    }
                    urllib.request.urlopen(
                        urllib.request.Request(
                            ADMIN_WEBHOOK_URL,
                            data=json.dumps(msg).encode("utf-8"),
                            headers={
                                "Content-Type": "application/json",
                                "User-Agent": "Stride-Backend/1.0",
                            },
                        ),
                        timeout=10,
                    )
                except Exception as we:
                    print(f"[LS Webhook] Discord alert failed: {we}")

        elif event_name == "license_key_created":
            # LS generated a license key for a completed order. Link the key
            # to the customer record we (hopefully) created from order_created.
            update = {
                "license_key": attrs.get("key") or "",
                "license_key_short": attrs.get("key_short") or "",
                "ls_license_key_id": str(data_obj.get("id") or ""),
                "license_activation_limit": attrs.get("activation_limit"),
                "license_status": attrs.get("status") or "active",
                "license_created_at": admin_firestore.SERVER_TIMESTAMP,
                "updated_at": admin_firestore.SERVER_TIMESTAMP,
            }
            order_id = attrs.get("order_id")

            match = None
            # Prefer lookup by order_id (exact) then fall back to email
            if order_id is not None:
                try:
                    found = list(
                        _db.collection("waitlist")
                        .where("ls_order_id", "==", str(order_id))
                        .limit(1)
                        .stream()
                    )
                    if found:
                        match = found[0]
                except Exception as qe:
                    print(f"[LS Webhook] query by ls_order_id failed: {qe}")
            if match is None and email:
                found = list(
                    _db.collection("waitlist").where("email", "==", email).limit(1).stream()
                )
                if found:
                    match = found[0]

            order_id_str = str(order_id) if order_id is not None else ""

            if match is not None:
                existing = match.to_dict() or {}
                match.reference.update(update)
                print(f"[LS Webhook] attached license key to {match.id}")

                # Welcome email — dedup by ORDER (not customer) so a returning
                # buyer gets a fresh welcome on each new purchase, while LS
                # webhook retries for the same order are still skipped.
                sent_for_orders = existing.get("welcome_email_sent_for_orders") or []
                if order_id_str and order_id_str not in sent_for_orders:
                    if _send_welcome_email(email, name or existing.get("name") or ""):
                        match.reference.update({
                            "welcome_email_sent_for_orders": admin_firestore.ArrayUnion([order_id_str]),
                            "welcome_email_last_sent_at": admin_firestore.SERVER_TIMESTAMP,
                        })
            else:
                # Orphan license — create a minimal record so the CRM still sees it
                _, new_ref = _db.collection("waitlist").add({
                    **update,
                    "name": name,
                    "email": email,
                    "source": "lemonsqueezy",
                    "status": "purchased",
                    "ls_order_id": order_id_str or None,
                    "created_at": admin_firestore.SERVER_TIMESTAMP,
                })
                print(f"[LS Webhook] orphan license record for {email}")

                # Welcome email — orphan branch still represents a real customer
                if order_id_str and _send_welcome_email(email, name):
                    new_ref.update({
                        "welcome_email_sent_for_orders": admin_firestore.ArrayUnion([order_id_str]),
                        "welcome_email_last_sent_at": admin_firestore.SERVER_TIMESTAMP,
                    })

        else:
            print(f"[LS Webhook] ignoring unhandled event: {event_name}")

        return jsonify({"received": True, "event": event_name}), 200

    except Exception as e:
        print(f"[LS Webhook] processing error: {e}")
        # Return 200 so LS doesn't retry forever; the error is logged.
        return jsonify({"received": True, "error": str(e)}), 200


def _handle_validate_license(data: dict):
    """Proxy a license validation call through to the Lemon Squeezy API.

    First-time use (no instance_id): activates a new instance (creates an activation
    slot tied to this machine) and returns the new instance_id.
    Returning use (instance_id present): validates the existing instance.

    Stale-instance self-heal: if /validate returns "not found" AND the client
    had a cached instance_id, we automatically retry as /activate so the
    client gets a fresh instance. This recovers from cases where the admin
    deactivated the old instance on LS but the client still has the old
    instance_id cached in license.json.

    Request body (from Electron app):
      { action: 'validate_license', key: 'XXXX-YYYY-ZZZZ',
        instance_id?: 'saved-from-previous-activation',
        instance_name?: 'Stride on <hostname>' }
    """
    # Aggressive key normalization — strip all whitespace AND invisible unicode
    # (non-breaking space, zero-width joiner/non-joiner, BOM). These sneak in
    # when users copy keys from email clients that render rich text. Hyphens
    # are preserved — they're part of LS's UUID format.
    raw_key = data.get("key") or ""
    key = re.sub(r"[\s\u00A0\u200B\u200C\u200D\uFEFF]", "", raw_key).upper()
    instance_id = (data.get("instance_id") or "").strip()
    instance_name = (data.get("instance_name") or "Stride Desktop").strip()[:255]

    if not key:
        return jsonify({"valid": False, "error": "Missing license key"}), 400

    api_key = os.environ.get("LEMONSQUEEZY_API_KEY", "")
    if not api_key:
        print("[License] LEMONSQUEEZY_API_KEY not set")
        return jsonify({"valid": False, "error": "License service not configured"}), 500

    def _call_ls(url: str, form: dict):
        """Call LS API. Returns (result_dict_or_None, err_body_str, http_status_int).
        Never raises."""
        try:
            req_obj = urllib.request.Request(
                url,
                data=urllib.parse.urlencode(form).encode("utf-8"),
                headers={
                    "Authorization": f"Bearer {api_key}",
                    "Content-Type": "application/x-www-form-urlencoded",
                    "Accept": "application/json",
                    "User-Agent": "Stride-Backend/1.0",
                },
            )
            with urllib.request.urlopen(req_obj, timeout=15) as resp:
                return json.loads(resp.read().decode("utf-8")), "", resp.status
        except urllib.error.HTTPError as he:
            body = ""
            try:
                body = he.read().decode("utf-8")
            except Exception:
                pass
            return None, body, he.code
        except Exception as e:
            return None, str(e), 0

    # First call: /validate if we have an instance_id, /activate otherwise.
    used_instance_id = bool(instance_id)
    if instance_id:
        url = "https://api.lemonsqueezy.com/v1/licenses/validate"
        form = {"license_key": key, "instance_id": instance_id}
    else:
        url = "https://api.lemonsqueezy.com/v1/licenses/activate"
        form = {"license_key": key, "instance_name": instance_name}

    result, err_body, status = _call_ls(url, form)

    # Stale-instance retry: if /validate failed with "not found" type error
    # and we had an instance_id, treat it as stale and retry as /activate.
    if used_instance_id:
        stale_signal = False
        if result is None:
            # HTTP error — check err_body for stale-instance markers
            body_low = (err_body or "").lower()
            if status == 404 or "not found" in body_low or "instance" in body_low:
                stale_signal = True
        elif not (result.get("valid") or result.get("activated")):
            err_low = str(result.get("error") or "").lower()
            if "not found" in err_low or "instance" in err_low:
                stale_signal = True

        if stale_signal:
            print(f"[License] stale instance_id ({instance_id[:8]}...), retrying as /activate")
            url = "https://api.lemonsqueezy.com/v1/licenses/activate"
            form = {"license_key": key, "instance_name": instance_name}
            result, err_body, status = _call_ls(url, form)

    # Handle network/HTTP failure (result is None = never got parseable JSON back)
    if result is None:
        msg = ""
        if err_body:
            try:
                msg = json.loads(err_body).get("error") or ""
            except Exception:
                pass
        if not msg:
            msg = f"License server rejected (HTTP {status})" if status else "Cannot reach license server"
        print(f"[License] LS API HTTP {status}: {(err_body or '(no body)')[:300]}")
        return jsonify({"valid": False, "error": msg}), 200

    # Log the raw response (first 500 chars) so future debugging has ground
    # truth on what LS actually returned. Sensitive fields like license key
    # are already in the JSON so no extra exposure.
    try:
        raw_preview = json.dumps(result)[:500]
        print(f"[License] LS API HTTP {status} response: {raw_preview}")
    except Exception:
        pass

    # Success check — accept BOTH "valid" (/validate response) and "activated"
    # (/activate response). Earlier code only checked "valid" which would have
    # incorrectly rejected successful activations if LS ever omitted that field
    # from the /activate response body.
    success = bool(result.get("valid") or result.get("activated"))
    if not success:
        return jsonify({
            "valid": False,
            "error": result.get("error") or "License key is not valid",
        }), 200

    lk = result.get("license_key") or {}
    inst = result.get("instance") or {}
    meta = result.get("meta") or {}
    customer_email = (meta.get("customer_email") or "").lower().strip()

    # Best-effort: bump last-validated timestamp + activation tracking so the
    # admin CRM can show Activated YES/NO and Onboarding YES/NO columns.
    #
    #   license_activation_usage   — int from LS, count of activated installs
    #   license_activation_limit   — int from LS, max allowed installs
    #   license_validation_count   — incremented on each call, our usage signal
    #   first_validated_at         — set once on first validation
    #   license_last_validated_at  — bumped on every call (existing)
    #   license_status             — "active"/"inactive"/"expired" (existing)
    try:
        if customer_email:
            _db = admin_firestore.client()
            matches = list(
                _db.collection("waitlist").where("email", "==", customer_email).limit(1).stream()
            )
            if matches:
                ref = matches[0].reference
                existing = matches[0].to_dict() or {}
                updates = {
                    "license_last_validated_at": admin_firestore.SERVER_TIMESTAMP,
                    "license_status": lk.get("status") or "active",
                    "license_activation_usage": int(lk.get("activation_usage") or 0),
                    "license_activation_limit": int(lk.get("activation_limit") or 0),
                    "license_validation_count": int(existing.get("license_validation_count") or 0) + 1,
                }
                if not existing.get("first_validated_at"):
                    updates["first_validated_at"] = admin_firestore.SERVER_TIMESTAMP
                ref.update(updates)
    except Exception as fe:
        print(f"[License] Firestore touch failed (non-fatal): {fe}")

    return jsonify({
        "valid": True,
        "instance_id": inst.get("id"),
        "customer_name": meta.get("customer_name"),
        "customer_email": customer_email,
        "product_name": meta.get("product_name"),
        "activation_limit": lk.get("activation_limit"),
        "activation_usage": lk.get("activation_usage"),
        "expires_at": lk.get("expires_at"),
        "status": lk.get("status") or "active",
    }), 200


@https_fn.on_request(
    cors=options.CorsOptions(
        cors_origins=[
            "https://veero-next.web.app",
            "https://veero-next.firebaseapp.com",
            "https://jozeque.github.io",
            "https://stridehub.io",
            "https://www.stridehub.io",
            "http://localhost:5000",
            "http://localhost:5173",
            "http://127.0.0.1:5000"
        ],
        cors_methods=["POST", "OPTIONS"]
    ),
    timeout_sec=540,
    memory=options.MemoryOption.GB_1,
    max_instances=200,
    secrets=["SUPABASE_SERVICE_KEY", "LEMONSQUEEZY_API_KEY", "LEMONSQUEEZY_WEBHOOK_SECRET", "RESEND_API_KEY"]
)
def generate_midi(req: https_fn.Request) -> https_fn.Response:
    if req.method == 'OPTIONS':
        return https_fn.Response(status=204)

    # --- LEMON SQUEEZY WEBHOOK (public, HMAC-authenticated) ---
    # LS POSTs with X-Event-Name and X-Signature headers. We read the raw body
    # ONCE so the HMAC verification can use the exact bytes that were signed.
    # Flask caches the raw body, so later get_json() calls still work below.
    ls_event = req.headers.get("X-Event-Name") or req.headers.get("x-event-name")
    ls_sig = req.headers.get("X-Signature") or req.headers.get("x-signature")
    if ls_event and ls_sig:
        raw_body = req.get_data(cache=True) or b""
        return _handle_lemon_webhook(raw_body, ls_event, ls_sig)

    # --- FOUNDERS COUNTER (public, no auth) ---
    # Returns the real number of purchased rows in the waitlist collection so
    # the landing page can display a live founding-member progress bar. The
    # frontend applies its own multiplier + seed to the returned count — this
    # endpoint just reports the raw ground truth.
    data_pre = req.get_json(silent=True)
    if isinstance(data_pre, dict) and data_pre.get("action") == "founders_count":
        try:
            _db = admin_firestore.client()
            purchased = list(
                _db.collection("waitlist").where("status", "==", "purchased").stream()
            )
            return jsonify({"count": len(purchased)}), 200
        except Exception as e:
            print(f"[FoundersCount] firestore query failed: {e}")
            return jsonify({"count": 0, "error": "firestore unavailable"}), 200

    # --- WAITLIST / BUYER LEAD (public, no auth required) ---
    if isinstance(data_pre, dict) and data_pre.get("action") in ("waitlist_signup", "buyer_lead"):
        name = data_pre.get("name", "").strip()
        # Normalize email to lowercase for consistent dedup matching against the
        # LS webhook (which also lowercases). Firestore queries are case-sensitive
        # so "Alice@X.com" and "alice@x.com" would be treated as different
        # contacts without this — caused duplicate CRM rows before the fix.
        email = data_pre.get("email", "").strip().lower()
        country = data_pre.get("country", "").strip()
        source = data_pre.get("source", "").strip()
        # Terms acknowledgment record — legal audit trail for any future
        # chargeback / refund dispute. We capture as much context as the
        # browser can give us (user agent, timezone, the exact URL they
        # were on when they clicked accept) plus the server IP so the
        # acceptance is cryptographically timestamped in Firestore.
        terms_in = data_pre.get("terms_accepted") or {}
        terms_accepted = {
            "accepted": bool(terms_in.get("accepted", False)),
            "version": (terms_in.get("version") or "").strip() or "unversioned",
            "accepted_at_client": (terms_in.get("accepted_at") or "").strip() or None,
            "scope": (terms_in.get("scope") or "waitlist_signup").strip(),
            "user_agent": (terms_in.get("user_agent") or req.headers.get("User-Agent") or "").strip() or None,
            "tz_offset_min": terms_in.get("tz_offset_min"),
            "page_url": (terms_in.get("page_url") or "").strip() or None,
            # Server-side facts the client can't spoof:
            "ip": req.headers.get("X-Forwarded-For", req.remote_addr or "").split(",")[0].strip() or None,
            "accepted_at_server": admin_firestore.SERVER_TIMESTAMP,
        }

        if not name or not email:
            return jsonify({"error": "Name and email are required"}), 400
        # Always log the full signup so data is never lost
        print(f"[Waitlist] name={name} email={email} country={country} source={source} terms_ok={terms_accepted['accepted']}")
        db_ok = False
        was_existing = False
        try:
            _db = admin_firestore.client()
            # Dedupe by email — same email submitting the form twice (waitlist
            # then buy modal, or multiple visits) must not produce duplicate
            # rows. Update the existing record if one exists; otherwise create.
            # NOTE: does NOT touch the `status` field — the LS `order_created`
            # webhook owns that. A returning customer who already purchased
            # keeps their `purchased` status even if they re-submit the form.
            existing = list(
                _db.collection("waitlist").where("email", "==", email).limit(1).stream()
            )
            # last_action captures the action type ("buyer_lead" or
            # "waitlist_signup") that produced this write. Lets the admin
            # CRM derive "abandoned cart" status (last_action == buyer_lead
            # AND status != purchased) without crawling Discord history.
            payload = {
                "name": name,
                "email": email,
                "country": country,
                "source": source,
                "last_action": data_pre.get("action", ""),
                "terms_accepted": terms_accepted,
                "updated_at": admin_firestore.SERVER_TIMESTAMP,
            }
            if existing:
                existing[0].reference.update(payload)
                was_existing = True
                print(f"[Waitlist] updated existing lead {existing[0].id} (email already on list)")
            else:
                payload["created_at"] = admin_firestore.SERVER_TIMESTAMP
                _db.collection("waitlist").add(payload)
                print(f"[Waitlist] created new lead for {email}")
            db_ok = True
        except Exception as e:
            print(f"[Waitlist] FIRESTORE FAILED: {e} — data logged above")
        # Discord notification (includes DB failure warning if applicable).
        # Heading reflects the action type AND returning vs first-time:
        #   buyer_lead      -> user is actively in the buy flow (on LS checkout
        #                      right now, or just abandoned it). Fresh intent.
        #   waitlist_signup -> pre-launch waitlist signup (rare post-launch).
        # "returning" suffix fires on dedup match (this email already had a
        # row) so admin can spot repeat buyers / re-engagers.
        action_type = data_pre.get("action", "")
        if ADMIN_WEBHOOK_URL:
            try:
                status = "" if db_ok else "\n⚠️ **Firestore write failed — recover from logs**"
                is_buyer = action_type == "buyer_lead"
                if is_buyer:
                    base = "🛒 **BUYER LEAD** — on checkout"
                else:
                    base = "🎹 **WAITLIST SIGNUP**"
                heading = f"{base} — returning" if was_existing else base
                webhook_msg = {
                    "username": "Stride Engine",
                    "content": f"{heading}\n**Producer:** `{name}`\n**Email:** `{email}`\n**Country:** `{country}`" + (f"\n**Heard from:** `{source}`" if source else "") + status
                }
                webhook_req = urllib.request.Request(
                    ADMIN_WEBHOOK_URL,
                    data=json.dumps(webhook_msg).encode('utf-8'),
                    headers={'Content-Type': 'application/json', 'User-Agent': 'Stride-Backend/1.0'}
                )
                urllib.request.urlopen(webhook_req, timeout=10)
            except Exception as we:
                print(f"[Waitlist] DISCORD FAILED: {we} — data logged above")
        # Buyer leads + waitlist signups deliberately stay Discord-only —
        # admin doesn't want Gmail flooded with high-volume lead pings. Only
        # the contact form (much lower volume, requires reply) gets mirrored
        # to email.
        return jsonify({"success": True}), 200

    # --- CONTACT FORM (public, no auth required) ---
    # Previously the landing-page contact modal used a mailto: link, which
    # silently fails on mobile and on desktops without a configured email
    # client — we lost real customer tickets this way (e.g., Omer 2026-04-23).
    # Now the form POSTs here directly and we fire a Discord ping so every
    # message is guaranteed to reach us.
    if isinstance(data_pre, dict) and data_pre.get("action") == "contact_message":
        email = data_pre.get("email", "").strip().lower()
        name = data_pre.get("name", "").strip()
        message = data_pre.get("message", "").strip()

        if not email or not message:
            return jsonify({"error": "Email and message are required"}), 400

        # Always log — data is never lost even if Discord fails
        print(f"[Contact] email={email} name={name} len={len(message)} msg={message[:200]}")

        if ADMIN_WEBHOOK_URL:
            try:
                sender_label = f"`{name}` <`{email}`>" if name else f"`{email}`"
                # Clamp message to stay under Discord's 2000-char content limit
                clipped = message if len(message) <= 1500 else message[:1500] + "\n…(truncated)"
                webhook_msg = {
                    "username": "Stride Engine",
                    "content": f"📬 **CONTACT FORM**\n**From:** {sender_label}\n**Message:**\n```{clipped}```"
                }
                webhook_req = urllib.request.Request(
                    ADMIN_WEBHOOK_URL,
                    data=json.dumps(webhook_msg).encode('utf-8'),
                    headers={'Content-Type': 'application/json', 'User-Agent': 'Stride-Backend/1.0'}
                )
                urllib.request.urlopen(webhook_req, timeout=10)
            except Exception as we:
                print(f"[Contact] DISCORD FAILED: {we} — data logged above")

        # Mirror to Gmail via Resend — easier to reply to a real email than
        # copy a Discord ping into Gmail every time. Reply-to is set to the
        # sender so admin can hit Reply directly and reach the user.
        try:
            sender_label = f"{name} <{email}>" if name else email
            subject = f"[Stride] Contact form: {name or email}"
            body = (
                f"From: {sender_label}\n"
                f"\n"
                f"Message:\n"
                f"{message}\n"
            )
            # Override default reply_to so admin can hit Reply and the
            # message goes back to the user, not to home@stridehub.io.
            if RESEND_API_KEY:
                try:
                    import resend
                    resend.api_key = RESEND_API_KEY
                    resend.Emails.send({
                        "from": "Stride Notifications <home@stridehub.io>",
                        "to": CONTACT_FORM_RECIPIENTS,
                        "reply_to": email,
                        "subject": subject,
                        "text": body,
                    })
                    print(f"[Contact] admin email sent to {CONTACT_FORM_RECIPIENTS}")
                except Exception as ce:
                    print(f"[Contact] ADMIN EMAIL FAILED: {ce}")
        except Exception as ee:
            print(f"[Contact] ADMIN EMAIL OUTER FAILED: {ee}")

        return jsonify({"success": True}), 200

    # --- VALIDATE LICENSE (public, proxies to Lemon Squeezy API) ---
    # Called by the Electron desktop app to check if a license key is valid.
    # No Firebase auth — the license key itself IS the credential.
    if isinstance(data_pre, dict) and data_pre.get("action") == "validate_license":
        return _handle_validate_license(data_pre)

    if not GEMINI_READY or not API_KEY:
        return jsonify({"error": "CRITICAL: Gemini API Key missing or library not installed."}), 500

    # --- 1. AUTH & SECURITY CHECK ---
    auth_header = req.headers.get("Authorization")
    if not auth_header or not auth_header.startswith("Bearer "):
        return jsonify({"error": "Unauthorized. Missing or invalid token."}), 401
        
    try:
        id_token = auth_header.split("Bearer ")[1]
        decoded_token = admin_auth.verify_id_token(id_token)
        uid = decoded_token["uid"]
    except Exception as e:
        return jsonify({"error": "Forbidden. Invalid token signature."}), 403

    # Supabase: upsert user on every request (lightweight, keeps last_seen_at fresh)
    user_email = decoded_token.get("email", "")
    user_display_name = decoded_token.get("name", None)
    is_admin_user = user_email.lower() == "yossi.bozo112@gmail.com"
    sb_upsert_user(uid, user_email, is_admin_user, display_name=user_display_name)

    # Safely load JSON data
    data = req.get_json(silent=True)
    if not isinstance(data, dict):
        data = {}
        
    action = data.get("action", "generate")

    # --- ADMIN CRM: UPDATE LEAD (admin-only, writes to waitlist collection) ---
    # Called by admin.html when an admin edits a cell in the CRM table.
    # Caller is already Firebase-auth'd above; we just require admin email.
    # Field whitelist below prevents tampering with LS-managed fields like
    # license_key, ls_order_id, total_cents, etc.
    if action == "update_lead":
        if not is_admin_user:
            return jsonify({"error": "Admin access required"}), 403

        doc_id = (data.get("doc_id") or "").strip()
        updates_in = data.get("updates") or {}
        if not doc_id:
            return jsonify({"error": "Missing doc_id"}), 400
        if not isinstance(updates_in, dict):
            return jsonify({"error": "updates must be an object"}), 400

        ALLOWED_FIELDS = {"name", "country", "status", "notes", "assigned_to", "onboarding"}
        clean_updates = {}
        for k, v in updates_in.items():
            if k in ALLOWED_FIELDS and v is not None:
                # Sanity cap on string lengths so notes can't grow unbounded
                if isinstance(v, str):
                    clean_updates[k] = v[:5000]
                else:
                    clean_updates[k] = v

        # Special-case: "mark contacted now" — client sends the sentinel string
        # and the server stamps the actual server timestamp.
        if updates_in.get("last_contacted_at") == "__NOW__":
            clean_updates["last_contacted_at"] = admin_firestore.SERVER_TIMESTAMP

        if not clean_updates:
            return jsonify({"error": "No valid fields to update"}), 400

        clean_updates["updated_at"] = admin_firestore.SERVER_TIMESTAMP
        clean_updates["last_edited_by"] = user_email

        try:
            _db = admin_firestore.client()

            # Virtual rows: user exists in `users` collection but has no
            # waitlist record yet. Client sends doc_id="virtual_<uid>" plus
            # the email so we can upsert-by-email into waitlist.
            if doc_id.startswith("virtual_"):
                virtual_email = (data.get("email") or "").strip().lower()
                if not virtual_email:
                    return jsonify({"error": "Missing email for virtual doc"}), 400

                existing = list(
                    _db.collection("waitlist")
                    .where("email", "==", virtual_email)
                    .limit(1)
                    .stream()
                )
                if existing:
                    existing[0].reference.update(clean_updates)
                    target_id = existing[0].id
                    print(f"[CRM] {user_email} virtual-merged {virtual_email} → {target_id}")
                else:
                    virtual_name = (data.get("name") or "").strip()
                    virtual_uid = doc_id.replace("virtual_", "", 1)
                    new_doc = {
                        "email": virtual_email,
                        "name": virtual_name,
                        "source": "registered_user",
                        "firebase_uid": virtual_uid,
                        "created_at": admin_firestore.SERVER_TIMESTAMP,
                    }
                    new_doc.update(clean_updates)
                    _, ref = _db.collection("waitlist").add(new_doc)
                    target_id = ref.id
                    print(f"[CRM] {user_email} virtual-created {virtual_email} → {target_id}")
                return jsonify({"success": True, "upserted": target_id, "updated": list(clean_updates.keys())}), 200

            _db.collection("waitlist").document(doc_id).update(clean_updates)
            print(f"[CRM] {user_email} updated {doc_id} → {list(clean_updates.keys())}")
            return jsonify({"success": True, "updated": list(clean_updates.keys())}), 200
        except Exception as e:
            print(f"[CRM] update_lead failed: {e}")
            return jsonify({"error": f"Firestore update failed: {str(e)}"}), 500

    # --- FAST LANE 1: ENHANCE PROMPT (No DB, No Cost) ---
    if action == "enhance_prompt":
        base_text = data.get("text", "")
        if not base_text:
            return jsonify({"error": "No text provided for enhancement."}), 400
            
        client = genai.Client(api_key=API_KEY)
        
        enhancer_prompt = f"""
        Act as an elite musical prompt engineer for the Stride MIDI Engine.
        The user wants to generate a MIDI sequence based on this simple idea: "{base_text}"

        Your task is to rewrite this into a highly detailed, professional generation prompt (around 80-150 words).
        
        RULES FOR ENHANCEMENT:
        1. PRESERVE THE VIBE: If the user asked for a simple, clean, or standard genre, keep the instructions tasteful and restrained. If they asked for crazy jazz, ambient, or experimental, push the boundaries.
        2. MUSICAL THEORY: Translate their simple words into exact musical terms (e.g., specific chord extensions, voice leading rules, polyphony, rhythmic grids like 16ths or swing).
        3. HARMONIC INTEGRITY: If the prompt implies a dark, aggressive, tense, or exotic tonality (like Phrygian, Harmonic Minor, or Locrian), explicitly instruct the generation model to STRICTLY AVOID the relative major and to forbid happy or bright chord resolutions.
        4. TASTEFUL ENGINE FEATURES: Instruct the engine to use 'pb' (pitch bend) and 'cc' (sustain pedal) ONLY IF it logically fits the requested style.
        5. Output ONLY the final enhanced prompt text. No quotes.
        """
        
        try:
            response = client.models.generate_content(
                model='gemini-2.5-flash', 
                contents=enhancer_prompt
            )
            return jsonify({"success": True, "enhanced_prompt": response.text.strip()}), 200
        except Exception as e:
            return jsonify({"error": f"Enhancement failed: {str(e)}"}), 500

    # --- FAST LANE 2: PARSE ALC RACK FOR CANVAS EDITOR (No DB, No Cost) ---
    if action == "parse_alc":
        target_id = data.get("target_chain_id")
        if not target_id:
            return jsonify({"error": "No target_chain_id provided."}), 400
            
        bucket = storage.bucket()
        blob_path = target_id if "/" in target_id else f"templates/chains/{target_id}.alc"
        
        try:
            blob = bucket.blob(blob_path)
            alc_bytes = blob.download_as_bytes()
            try:
                xml_str = gzip.decompress(alc_bytes).decode('utf-8')
            except Exception:
                xml_str = alc_bytes.decode('utf-8')
            root = ET.fromstring(xml_str)
            
            # AGGRESSIVE GLOBAL PARAMETER PARSING
            param_id_to_name = {}
            param_bounds = {}
            
            for param in root.findall('.//*[@Id]'):
                p_id = param.get('Id')
                if not p_id: continue

                # 1. Extract Name
                name = None
                for n_tag in ['UserName', 'Name']:
                    n_node = param.find(f'.//{n_tag}')
                    if n_node is not None and n_node.get('Value'):
                        name = n_node.get('Value')
                        break
                if name:
                    param_id_to_name[p_id] = name

                # 2. Extract Bounds (only when explicitly declared)
                min_v, max_v = None, None

                min_node = param.find('Min')
                if min_node is None: min_node = param.find('.//Min')
                if min_node is not None:
                    val = min_node.get('Value') or min_node.text
                    if val:
                        try: min_v = float(val)
                        except: pass

                max_node = param.find('Max')
                if max_node is None: max_node = param.find('.//Max')
                if max_node is not None:
                    val = max_node.get('Value') or max_node.text
                    if val:
                        try: max_v = float(val)
                        except: pass

                # Sniff value tags to expand max beyond declared bounds
                for val_tag in ['Value', 'ManualValue', 'TargetMax']:
                    v_node = param.find(val_tag)
                    if v_node is None: v_node = param.find(f'.//{val_tag}')
                    if v_node is not None:
                        val = v_node.get('Value') or v_node.text
                        if val:
                            try:
                                f_val = float(val)
                                cur_max = max_v if max_v is not None else 1.0
                                if f_val > cur_max: max_v = f_val
                            except: pass

                # Only register when we found explicit bounds.
                # CRITICAL: also register under child AutomationTarget/ModulationTarget Ids —
                # PointeeId in envelopes points to those child elements, not the parameter itself.
                if min_v is not None or max_v is not None:
                    bounds = {'min': min_v if min_v is not None else 0.0,
                              'max': max_v if max_v is not None else 1.0}
                    param_bounds[p_id] = bounds
                    for tgt in param.findall('AutomationTarget') + param.findall('ModulationTarget'):
                        t_id = tgt.get('Id')
                        if t_id:
                            param_bounds[t_id] = bounds
                            if name: param_id_to_name[t_id] = name

            # PASS 2: parent-map for nested AutomationTarget
            # Handles PluginFloatParameter > ParameterValue > AutomationTarget (Serum 2, etc.)
            # without disturbing AutomatableDeviceParameter > AutomationTarget (Ableton native)
            _pmap = {child: parent for parent in root.iter() for child in parent}
            for _tag in ['AutomationTarget', 'ModulationTarget']:
                for _tgt in root.findall(f'.//{_tag}'):
                    _tid = _tgt.get('Id')
                    if not _tid:
                        continue
                    _par = _pmap.get(_tgt)
                    if _par is None:
                        continue
                    # MidiControllerRange on the direct parent is always authoritative.
                    # Covers both Ableton native (Volume/Pan/etc > MidiControllerRange)
                    # and Serum 2 (ParameterValue > MidiControllerRange).
                    # Always overwrite — resolves Id collisions between PluginFloatParameter
                    # and AutomationTarget sharing the same numeric Id in different scopes.
                    _mcr = _par.find('MidiControllerRange')
                    if _mcr is None:
                        continue  # no MCR — leave pass 1 result or default 0-1
                    _minv = _maxv = None
                    _mn = _mcr.find('Min')
                    _mx = _mcr.find('Max')
                    if _mn is not None:
                        try: _minv = float(_mn.get('Value') or _mn.text or '')
                        except: pass
                    if _mx is not None:
                        try: _maxv = float(_mx.get('Value') or _mx.text or '')
                        except: pass
                    if _minv is not None or _maxv is not None:
                        param_bounds[_tid] = {
                            'min': _minv if _minv is not None else 0.0,
                            'max': _maxv if _maxv is not None else 1.0
                        }
                        # Inherit name: check parent then grandparent
                        if _tid not in param_id_to_name:
                            _gpar = _pmap.get(_par)
                            for _src in ([_par, _gpar] if _gpar is not None else [_par]):
                                for _ntag in ['ParameterName', 'UserName', 'Name']:
                                    _nn = _src.find(_ntag)
                                    if _nn is not None and _nn.get('Value'):
                                        param_id_to_name[_tid] = _nn.get('Value')
                                        break
                                if _tid in param_id_to_name:
                                    break

            envelopes = []

            # SUPPORT BOTH CLIP ENVELOPES AND TIMELINE (ARRANGEMENT) ENVELOPES
            all_envelopes = root.findall('.//ClipEnvelope') + root.findall('.//AutomationEnvelope')
            
            for idx, env in enumerate(all_envelopes):
                name = None
                min_val = 0.0
                max_val = 1.0
                
                # Link via PointeeId
                pointee_node = env.find('.//EnvelopeTarget/PointeeId')
                pointee_id = pointee_node.get('Value') if pointee_node is not None else None
                
                if pointee_id:
                    if pointee_id in param_id_to_name:
                        name = param_id_to_name[pointee_id]
                    if pointee_id in param_bounds:
                        min_val = param_bounds[pointee_id]['min']
                        max_val = param_bounds[pointee_id]['max']
                
                if not name:
                    user_name_el = env.find('.//UserName')
                    if user_name_el is not None and user_name_el.get('Value'):
                        name = user_name_el.get('Value')
                if not name:
                    name = f"Automation Lane {idx + 1}"

                # Sniff any existing events in the template to guess scale
                events_node = env.find('.//Events')
                sniffed_max = max_val
                if events_node is not None:
                    for child in events_node:
                        try:
                            val_str = child.get('Value', '1.0')
                            if val_str.lower() == 'true': val = 1.0
                            elif val_str.lower() == 'false': val = 0.0
                            else: val = float(val_str)
                            if val > sniffed_max: sniffed_max = val
                        except: pass

                # NAME HEURISTICS: If Ableton XML hides Serum's WT Pos range
                p_name_lower = name.lower() if name else ""
                if sniffed_max <= 127.0:
                    if any(kw in p_name_lower for kw in ['wt pos', 'wavetable', 'osc a', 'osc b', 'position']):
                        sniffed_max = 256.0
                        
                # Modular snap to digital scales
                if sniffed_max > max_val:
                    if sniffed_max <= 127.0: max_val = 127.0
                    elif sniffed_max <= 255.0: max_val = 255.0
                    elif sniffed_max <= 256.0: max_val = 256.0
                    elif sniffed_max <= 1000.0: max_val = 1000.0
                    else: max_val = sniffed_max

                envelopes.append({
                    "envelopeId": str(idx),
                    "name": name,
                    "type": "Float",
                    "min": min_val,
                    "max": max_val,
                    "default": min_val + (max_val - min_val) / 2
                })
                
            return jsonify({"success": True, "parameters": envelopes}), 200
        except Exception as e:
            return jsonify({"error": f"Failed to parse ALC: {str(e)}"}), 500

    # --- AUTOMATE ONLY: Apply automation to user's ALC, preserve existing MIDI ---
    if action == "automate_only":
        target_id = data.get("target_chain_id")
        if not target_id:
            return jsonify({"error": "No target_chain_id provided."}), 400

        # Credit check (costs 1 credit)
        db = admin_firestore.client()
        user_ref = db.collection("users").document(uid)

        @admin_firestore.transactional
        def _ao_check(transaction, ref):
            snapshot = ref.get(transaction=transaction)
            if not snapshot.exists:
                return False, "User not found.", False
            ud = snapshot.to_dict()
            c_used = ud.get("credits_used", 0)
            admin_flag = (ud.get("email", "").lower() == "yossi.bozo112@gmail.com") or (c_used < 0)
            c_month = datetime.now().month
            if ud.get("last_active_month") != c_month and not admin_flag:
                c_used = 0
            if not admin_flag and (c_used + 1) > 30:
                return False, f"Not enough credits. Available: {30 - c_used}.", admin_flag
            if not admin_flag:
                transaction.update(ref, {
                    "credits_used": c_used + 1,
                    "generations_count": admin_firestore.Increment(1),
                    "last_active_month": c_month
                })
            return True, "OK", admin_flag

        transaction = db.transaction()
        try:
            can_gen, msg, is_admin = _ao_check(transaction, user_ref)
            if not can_gen:
                return jsonify({"error": msg}), 402
        except Exception:
            return jsonify({"error": "Database transaction failed. Please try again."}), 500

        bucket = storage.bucket()
        blob_path = target_id if "/" in target_id else f"templates/chains/{target_id}.alc"

        try:
            blob = bucket.blob(blob_path)
            alc_bytes = blob.download_as_bytes()
            try:
                xml_str = gzip.decompress(alc_bytes).decode('utf-8')
            except Exception:
                xml_str = alc_bytes.decode('utf-8')
            root = ET.fromstring(xml_str)

            # DO NOT touch KeyTracks — preserve user's original MIDI notes

            bars = max(1, min(32, safe_int(data.get("bars"), 8)))
            total_beats = bars * 4.0

            # Update loop length
            loop_node = root.find('.//Loop')
            if loop_node is not None:
                for tag in ['LoopEnd', 'HiddenLoopEnd', 'OutMarker']:
                    el = loop_node.find(tag)
                    if el is not None:
                        el.set('Value', str(total_beats))

            # --- AUTOMATION INJECTION (same logic as generate) ---
            all_envelopes = root.findall('.//ClipEnvelope') + root.findall('.//AutomationEnvelope')

            manual_params = data.get("manual_automation") or data.get("parameters", [])
            param_map = {int(p.get("envelopeId", -1)): p for p in manual_params}

            # AGGRESSIVE GLOBAL PARAMETER PARSING
            param_id_to_name = {}
            param_bounds = {}

            for param in root.findall('.//*[@Id]'):
                p_tag = param.tag
                p_id = param.get('Id')
                if not p_id: continue
                name = None
                for n_tag in ['UserName', 'Name']:
                    n_node = param.find(f'.//{n_tag}')
                    if n_node is not None and n_node.get('Value'):
                        name = n_node.get('Value')
                        break
                if name: param_id_to_name[p_id] = name
                min_v, max_v = None, None
                min_node = param.find('Min')
                if min_node is None: min_node = param.find('.//Min')
                if min_node is not None:
                    val = min_node.get('Value') or min_node.text
                    if val:
                        try: min_v = float(val)
                        except: pass
                max_node = param.find('Max')
                if max_node is None: max_node = param.find('.//Max')
                if max_node is not None:
                    val = max_node.get('Value') or max_node.text
                    if val:
                        try: max_v = float(val)
                        except: pass
                for val_tag in ['Value', 'ManualValue', 'TargetMax']:
                    v_node = param.find(val_tag)
                    if v_node is None: v_node = param.find(f'.//{val_tag}')
                    if v_node is not None:
                        val = v_node.get('Value') or v_node.text
                        if val:
                            try:
                                f_val = float(val)
                                cur_max = max_v if max_v is not None else 1.0
                                if f_val > cur_max: max_v = f_val
                            except: pass
                if min_v is not None or max_v is not None:
                    bounds = {'min': min_v if min_v is not None else 0.0,
                              'max': max_v if max_v is not None else 1.0,
                              'is_int': ('Int' in p_tag or 'Enum' in p_tag),
                              'is_bool': ('Bool' in p_tag)}
                    param_bounds[p_id] = bounds
                    for tgt in param.findall('AutomationTarget') + param.findall('ModulationTarget'):
                        t_id = tgt.get('Id')
                        if t_id:
                            param_bounds[t_id] = bounds
                            if name: param_id_to_name[t_id] = name

            # PASS 2: MidiControllerRange
            _pmap = {child: parent for parent in root.iter() for child in parent}
            for _tag in ['AutomationTarget', 'ModulationTarget']:
                for _tgt in root.findall(f'.//{_tag}'):
                    _tid = _tgt.get('Id')
                    if not _tid: continue
                    _par = _pmap.get(_tgt)
                    if _par is None: continue
                    _mcr = _par.find('MidiControllerRange')
                    if _mcr is None: continue
                    _minv = _maxv = None
                    _mn = _mcr.find('Min')
                    _mx = _mcr.find('Max')
                    if _mn is not None:
                        try: _minv = float(_mn.get('Value') or _mn.text or '')
                        except: pass
                    if _mx is not None:
                        try: _maxv = float(_mx.get('Value') or _mx.text or '')
                        except: pass
                    if _minv is not None or _maxv is not None:
                        _prev = param_bounds.get(_tid, {})
                        param_bounds[_tid] = {
                            'min': _minv if _minv is not None else 0.0,
                            'max': _maxv if _maxv is not None else 1.0,
                            'is_int': _prev.get('is_int', False),
                            'is_bool': _prev.get('is_bool', False)
                        }
                        if _tid not in param_id_to_name:
                            _gpar = _pmap.get(_par)
                            for _src in ([_par, _gpar] if _gpar is not None else [_par]):
                                for _ntag in ['ParameterName', 'UserName', 'Name']:
                                    _nn = _src.find(_ntag)
                                    if _nn is not None and _nn.get('Value'):
                                        param_id_to_name[_tid] = _nn.get('Value')
                                        break
                                if _tid in param_id_to_name: break

            for macro_idx, env in enumerate(all_envelopes):
                events_node = env.find('.//Events')
                if events_node is not None:
                    pointee_id = None
                    p_node = env.find('.//EnvelopeTarget/PointeeId')
                    if p_node is not None:
                        pointee_id = p_node.get('Value')

                    event_tag = 'FloatEvent'
                    template_max = 1.0
                    template_min = 0.0

                    if pointee_id and pointee_id in param_bounds:
                        template_min = param_bounds[pointee_id]['min']
                        template_max = param_bounds[pointee_id]['max']
                        if param_bounds[pointee_id]['is_int']: event_tag = 'IntEvent'
                        elif param_bounds[pointee_id]['is_bool']: event_tag = 'BoolEvent'

                    sniffed_max = template_max
                    for child in list(events_node):
                        if not (pointee_id and pointee_id in param_bounds):
                            event_tag = child.tag
                        try:
                            val_str = child.get('Value', '1.0')
                            if val_str.lower() == 'true': val = 1.0
                            elif val_str.lower() == 'false': val = 0.0
                            else: val = float(val_str)
                            if val > sniffed_max: sniffed_max = val
                        except: pass
                        events_node.remove(child)

                    user_param = param_map.get(macro_idx, {})

                    p_name = param_id_to_name.get(pointee_id, "").lower()
                    if sniffed_max <= 127.0:
                        if any(kw in p_name for kw in ['wt pos', 'wavetable', 'osc a', 'osc b', 'position']):
                            sniffed_max = 256.0

                    if "min" in user_param and "max" in user_param:
                        try:
                            template_min = float(user_param["min"])
                            template_max = float(user_param["max"])
                        except: pass
                    else:
                        if sniffed_max > template_max:
                            if sniffed_max <= 127.0: template_max = 127.0
                            elif sniffed_max <= 255.0: template_max = 255.0
                            elif sniffed_max <= 256.0: template_max = 256.0
                            elif sniffed_max <= 1000.0: template_max = 1000.0
                            else: template_max = sniffed_max
                        if event_tag in ['IntEvent', 'EnumEvent'] and template_max <= 1.0:
                            template_max = 127.0

                    if template_max <= template_min:
                        template_max = template_min + 1.0

                    anchor = ET.SubElement(events_node, event_tag)
                    anchor.set('Id', '0')
                    anchor.set('Time', '-63072000')
                    if event_tag == 'BoolEvent': anchor.set('Value', 'false')
                    elif event_tag in ['IntEvent', 'EnumEvent']: anchor.set('Value', str(int(template_max / 2)))
                    else: anchor.set('Value', '0.5')

                    event_id = 1
                    def _ao_add_point(t, v, curve=None):
                        nonlocal event_id
                        pt = ET.SubElement(events_node, event_tag)
                        pt.set('Id', str(event_id))
                        pt.set('Time', str(round(t, 5)))
                        clamped_v = max(0.0, min(1.0, v))
                        scaled_v = template_min + (clamped_v * (template_max - template_min))
                        if event_tag == 'BoolEvent':
                            pt.set('Value', 'true' if v >= 0.5 else 'false')
                        elif event_tag in ['IntEvent', 'EnumEvent']:
                            pt.set('Value', str(int(round(scaled_v))))
                        else:
                            pt.set('Value', f"{scaled_v:.5f}".rstrip('0').rstrip('.'))
                            if curve and event_tag == 'FloatEvent':
                                pt.set('CurveControl1X', str(curve[0]))
                                pt.set('CurveControl1Y', str(curve[1]))
                                pt.set('CurveControl2X', str(curve[2]))
                                pt.set('CurveControl2Y', str(curve[3]))
                        event_id += 1

                    user_points = user_param.get("points", [])

                    if len(user_points) > 0:
                        user_points.sort(key=lambda x: x.get("time", 0.0))
                        for i, pt in enumerate(user_points):
                            t = float(pt.get("time", 0.0))
                            v = float(pt.get("value", 0.0))
                            cv = float(pt.get("curve", 0.0))
                            # Convert simple curve (-1..1) to Ableton CurveControl format
                            curve_data = None
                            if abs(cv) > 0.01 and i < len(user_points) - 1:
                                # Ableton uses cubic bezier with two control points (x,y) relative to segment
                                # CurveControl1 and CurveControl2 define the cubic bezier handles
                                curve_data = (0.5, -cv * 0.5, 0.5, cv * 0.5)
                            _ao_add_point(t, v, curve=curve_data)
                    else:
                        # No canvas data and no MIDI generation — leave envelope empty
                        pass

            # Compress and upload
            new_xml_str = ET.tostring(root, encoding='utf-8', xml_declaration=True)
            compressed_alc = gzip.compress(new_xml_str)

            timestamp = datetime.now().strftime("%Y%m%d_%H%M%S")
            alc_filename = f"Stride_AutomateOnly_{bars}bars_{timestamp}.alc"
            alc_blob_path = f"generations/{uid}/AutomateOnly/{alc_filename}"
            alc_blob = bucket.blob(alc_blob_path)
            alc_blob.content_disposition = f'attachment; filename="{alc_filename}"'

            alc_download_token = str(uuid.uuid4())
            alc_blob.metadata = {"firebaseStorageDownloadTokens": alc_download_token}
            alc_blob.upload_from_string(compressed_alc, content_type='application/octet-stream')

            encoded_alc_path = urllib.parse.quote(alc_blob_path, safe='')
            alc_download_url = f"https://firebasestorage.googleapis.com/v0/b/{bucket.name}/o/{encoded_alc_path}?alt=media&token={alc_download_token}"

            # Save to history (Firestore)
            history_ref = db.collection("users").document(uid).collection("history").document()
            history_ref.set({
                "filename": alc_filename,
                "alc_url": alc_download_url,
                "chain_id": target_id,
                "style": "Automate Only",
                "key": "—",
                "bpm": 0,
                "bars": bars,
                "is_favorite": False,
                "timestamp": admin_firestore.SERVER_TIMESTAMP
            })

            # Dual-write: Supabase
            sb_log_generation(uid, {
                "filename": alc_filename,
                "alc_url": alc_download_url,
                "chain_id": target_id,
                "style": "Automate Only",
                "key": "—",
                "bpm": 0,
                "bars": bars,
                "action": "automate_only"
            }, display_name=user_display_name)

            return jsonify({
                "success": True,
                "alc_url": alc_download_url,
                "filename": alc_filename,
                "style": "Automate Only",
                "bars": bars
            }), 200

        except Exception as e:
            print(f"Automate Only Error: {str(e)}")
            if not is_admin:
                user_ref.update({
                    "credits_used": admin_firestore.Increment(-1),
                    "generations_count": admin_firestore.Increment(-1)
                })
            return jsonify({"error": f"Automation failed: {str(e)}"}), 500

    # --- ACTION RESOLUTION & COST CALCULATION ---
    enable_sound_design = data.get("enable_sound_design", False)
    action_cost = 2 if action in ["harmonize", "seed"] else 1
    if enable_sound_design:
        action_cost += 1

    # --- 2. SERVER-SIDE CREDIT MANAGEMENT ---
    db = admin_firestore.client()
    user_ref = db.collection("users").document(uid)
    
    @admin_firestore.transactional
    def check_and_deduct(transaction, ref, cost):
        snapshot = ref.get(transaction=transaction)
        if not snapshot.exists:
            return False, "User not found in database.", False

        user_data = snapshot.to_dict()
        c_used = user_data.get("credits_used", 0)
        admin_flag = (user_data.get("email", "").lower() == "yossi.bozo112@gmail.com") or (c_used < 0)
        c_month = datetime.now().month

        if user_data.get("last_active_month") != c_month and not admin_flag:
            c_used = 0

        if not admin_flag and (c_used + cost) > 30:
            return False, f"Not enough credits. Required: {cost}, Available: {30 - c_used}.", admin_flag

        if not admin_flag:
            transaction.update(ref, {
                "credits_used": c_used + cost,
                "generations_count": admin_firestore.Increment(1),
                "last_active_month": c_month
            })
        
        return True, "OK", admin_flag

    transaction = db.transaction()
    try:
        can_generate, msg, is_admin = check_and_deduct(transaction, user_ref, action_cost)
        if not can_generate:
            return jsonify({"error": msg}), 402
    except Exception as e:
        return jsonify({"error": "Database transaction failed. Please try again."}), 500

    # Dual-write: sync credits to Supabase after successful deduction
    try:
        _snap = user_ref.get()
        if _snap.exists:
            _ud = _snap.to_dict()
            sb_update_credits(uid, _ud.get("credits_used", 0), _ud.get("generations_count", 0), _ud.get("last_active_month"))
    except Exception:
        pass

    client = genai.Client(api_key=API_KEY)
    
    # Global variables with extreme safety limits
    bpm = max(40, min(300, safe_int(data.get("bpm"), 85)))
    bars = max(1, min(32, safe_int(data.get("bars"), 8)))
    folder_style = "Generations"
    folder_key = "General"
    filename_style = "Sequence"
    is_cosmic = data.get("is_cosmic", False)

    automation_instruction = "HYBRID AUTOMATION DIRECTOR: You must act as the Sound Design Director. Return an 'automation' array containing 2 to 4 string keywords that dictate the effect vibe. Valid keywords: 'pump', 'elite_groove_a', 'elite_stutter_step', 'elite_lazy_tail', 'elite_stutter_ramp'. Pick keywords that match the energy of the sequence you are writing."

    try:
        if action == "seed":
            # --- THE SEED ENGINE LOGIC ---
            seed_data = data.get("seed_data", [])
            if not isinstance(seed_data, list): seed_data = []
            ppq = max(1, float(data.get("ppq") or 480))
            intent = str(data.get("intent") or "chords")
            orig_filename = str(data.get("original_filename") or "Seed")
            custom_prompt = str(data.get("custom_prompt") or "").strip()
            bpm = max(40, min(300, safe_int(data.get("bpm"), 120)))
            bars = max(1, min(32, safe_int(data.get("bars"), 4)))
            
            ratio = 480.0 / ppq
            normalized_seed = []
            for n in seed_data:
                if not isinstance(n, dict): continue
                normalized_seed.append({
                    "n": safe_int(n.get("n")),
                    "s": int(safe_int(n.get("s")) * ratio),
                    "d": int(safe_int(n.get("d")) * ratio),
                    "v": safe_int(n.get("v"))
                })
                
            max_ticks = bars * 1920
            folder_style = "SeedEngine"
            folder_key = re.sub(r'[^a-zA-Z0-9_\-]', '', intent).capitalize()
            if not folder_key: folder_key = "Intent"
            
            if intent == "chords":
                type_instructions = "Write rich, supportive chord progressions and pads that perfectly harmonize with the provided seed sequence. Focus on advanced jazz/classical voice leading."
            elif intent == "bass":
                type_instructions = "Write a locked-in bassline and rhythmic groove that anchors the provided seed sequence. Focus on the root notes of the implied harmony."
            elif intent == "counter_melody":
                type_instructions = "Write an expressive counter-melody that interweaves with the provided seed sequence. Fill the rhythmic gaps (call and response) seamlessly."

            custom_vibe_text = f"\nUSER CUSTOM VIBE/REQUEST: '{custom_prompt}'\nIncorporate this vibe/style into your instructions without breaking the harmonic integrity of the seed." if custom_prompt else ""

            director_prompt = f"""
            Act as an elite music theorist and producer. The user provided a basic MIDI sketch ('The Seed') and wants to generate a complementary '{intent.upper()}' layer.
            Tempo: {bpm} BPM.
            {custom_vibe_text}

            [SEED SEQUENCE DATA]
            {json.dumps({"notes": normalized_seed})}

            This seed might be musically basic or stiff. Analyze its harmonic and rhythmic DNA. Write a highly detailed, 100-150 word instruction manual for a MIDI programmer on how to ELEVATE it and compose the perfect {intent.upper()} to complement it, strictly following the user's vibe (if provided) while maintaining absolute harmonic integrity with the original. Detail the specific voice leading, tension notes (e.g., 9ths, 11ths), rhythmic pocket, and counterpoint techniques to use to make it sound professional and musical. DO NOT write JSON. Output ONLY the musical instructions.
            """
            
            try:
                flash_response = client.models.generate_content(
                    model='gemini-2.5-flash',
                    contents=director_prompt
                )
                enhanced_musical_instructions = flash_response.text.strip()
            except Exception as e:
                enhanced_musical_instructions = "Analyze the seed harmony and produce a mathematically and harmonically perfect complementary layer based on the requested intent."

            prompt = f"""
            Act as an elite music theorist, composer, and MIDI programmer.
            You are powering 'The Seed Engine'. The user has provided a base MIDI sketch ('The Seed').
            Your task is to generate a flawless, highly musical complementary layer based on the user's intent: {intent.upper()}.

            [CONTEXT]
            - Tempo: {bpm} BPM
            - Length: {bars} Bars (Exactly {max_ticks} ticks total at 480 TPQN)
            - Production Intent: {intent.upper()}

            [SEED SEQUENCE (IMMUTABLE BASE)]
            {json.dumps({"notes": normalized_seed})}

            [MUSICAL DIRECTIVES (FROM LEAD PRODUCER)]
            {enhanced_musical_instructions}
            
            [AUTOMATION DIRECTIVE]
            {automation_instruction}

            [STRICT MUSICAL DNA & THEORY RULES]
            1. INTENT EXECUTION: {type_instructions}
            2. VOICE LEADING & HARMONY: Enforce strict harmony rules. Absolutely NO parallel fifths or octaves. Create smooth voice leading based on the inversions implied by the seed.
            3. TENSIONS & CLASHES: Add beautiful musical tensions (9ths, 11ths) where appropriate, but strictly avoid "avoid notes" that clash dissonantly with the seed melody/chords.
            4. INDEPENDENT LAYER: Return ONLY the newly generated notes. DO NOT include any notes from the Seed sequence. This output will be played simultaneously with the Seed.

            CRITICAL: Return ONLY a valid JSON object matching this format:
            {{"notes": [{{"n": note_number, "s": start_tick, "d": duration_ticks, "v": velocity}}], "cc": [], "pb": [], "gliss": [], "automation": ["elite_groove_a", "elite_lazy_tail"]}}
            """
            
            clean_orig = re.sub(r'[^a-zA-Z0-9_\-]', '', orig_filename.replace('.mid', '').replace('.midi', '').replace('Stride_', ''))
            filename_style = f"{clean_orig}_Seed_{intent.capitalize()}"

        elif action == "harmonize":
            # --- HARMONIZE LOGIC ---
            original_url = data.get("original_url")
            harmonize_type = str(data.get("harmonize_type") or "bass")
            orig_filename = str(data.get("original_filename") or "Sequence")
            custom_prompt = str(data.get("custom_prompt") or "").strip()
            bpm = max(40, min(300, safe_int(data.get("bpm"), 85)))
            bars = max(1, min(32, safe_int(data.get("bars"), 8)))
            max_ticks = bars * 1920

            if not original_url or not original_url.startswith("https://firebasestorage.googleapis.com/"):
                return jsonify({"error": "Invalid source URL"}), 400
            req_midi = urllib.request.Request(original_url)
            resp_midi = urllib.request.urlopen(req_midi, timeout=15)
            midi_bytes = resp_midi.read()
            original_json = parse_midi_to_json(midi_bytes)

            folder_style = "Harmonize"
            folder_key = re.sub(r'[^a-zA-Z0-9_\-]', '', harmonize_type).capitalize()
            if not folder_key: folder_key = "Harmonize"
            
            type_instructions = ""
            if harmonize_type == "bass":
                type_instructions = "Write a locked-in, grooving bassline that rigidly anchors the root notes of the original sequence. The downbeat of the first bar MUST be the exact root note of the implied scale. Provide groove and rhythmic variations (syncopation, octave jumps, dead notes), but NEVER wander harmonically. Restrict notes strictly to the bass register (MIDI notes 24 to 48 / C1 to C3)."
            elif harmonize_type == "chords":
                type_instructions = "Write lush, supportive chord progressions that rigidly follow the exact harmony implied by the original sequence. Use good voice leading but DO NOT invent reharmonizations that clash with the original notes. Restrict to the mid register (MIDI notes 48 to 72 / C3 to C5)."
            elif harmonize_type == "counter-melody":
                type_instructions = "Write an expressive, weaving counter-melody that fills the gaps in the original sequence. It MUST strictly adhere to the original sequence's scale and avoid dissonant intervals (minor 2nds/tritones) on strong beats. Restrict to the upper register (MIDI notes 60 to 84 / C4 to C6)."
            elif harmonize_type == "b-section":
                type_instructions = "Write a compelling B-section (continuation, chorus, or bridge) that logically evolves from the original sequence. Introduce new melodic or harmonic variations while maintaining the original style and exact key. IMPORTANT: The output must be a standalone sequence starting from tick 0. Do NOT return the original notes."

            custom_vibe_text = f"\nUSER CUSTOM VIBE/REQUEST: '{custom_prompt}'\nIncorporate this vibe/style into your instructions, but DO NOT allow the user to override the musical theory, key, or scale of the original sequence." if custom_prompt else ""

            director_prompt = f"""
            Act as an elite music theorist and producer. The user provided a MIDI sequence and wants to generate a PERFECTLY complementary '{harmonize_type.upper()}' layer.
            Tempo: {bpm} BPM.
            {custom_vibe_text}

            [ORIGINAL SEQUENCE DATA]
            {json.dumps(original_json)}

            Analyze its harmonic and rhythmic DNA. Write a highly detailed, 100-150 word instruction manual for a MIDI programmer on how to compose the perfect {harmonize_type.upper()} to complement it, strictly following the user's vibe (if provided) while maintaining absolute harmonic integrity with the original. Detail the specific voice leading, tension notes, rhythmic pocket, and counterpoint techniques to use. DO NOT write JSON. Output ONLY the musical instructions.
            """

            try:
                flash_response = client.models.generate_content(
                    model='gemini-2.5-flash',
                    contents=director_prompt
                )
                enhanced_musical_instructions = flash_response.text.strip()
            except Exception as e:
                enhanced_musical_instructions = "Analyze the original harmony and produce a mathematically and harmonically perfect complementary layer based on the requested intent."

            prompt = f"""
            Act as an elite music producer and MIDI programmer.
            Your task is to analyze an existing MIDI sequence and generate a PERFECTLY complementary '{harmonize_type.upper()}' part based on it.

            [CONTEXT]
            - Tempo: {bpm} BPM
            - Length: {bars} Bars (Exactly {max_ticks} ticks total at 480 TPQN)
            - Harmonize Task: {harmonize_type.upper()}

            [ORIGINAL SEQUENCE DATA]
            {json.dumps(original_json)}

            [MUSICAL DIRECTIVES (FROM LEAD PRODUCER)]
            {enhanced_musical_instructions}
            
            [AUTOMATION DIRECTIVE]
            {automation_instruction}

            [STRICT MUSICAL INSTRUCTIONS]
            1. SCALE & ROOT LOCK: Analyze the rhythmic timing, phrasing, and implied harmony of the original sequence. You MUST perfectly match the implied key/scale. DO NOT drift into random keys or start the progression on a dissonant, out-of-key note.
            2. {type_instructions}
            3. CRITICAL: Return ONLY the newly generated notes. DO NOT include any notes from the original sequence. This output will be saved as an independent, single-track MIDI file.
            4. Lock the sequence inside the maximum tick length ({max_ticks}).

            CRITICAL: Return ONLY a valid JSON object matching this format:
            {{"notes": [{{"n": note_number, "s": start_tick, "d": duration_ticks, "v": velocity}}], "cc": [], "pb": [], "gliss": [], "automation": ["elite_lazy_tail", "pump"]}}
            """
            
            clean_orig_name = re.sub(r'[^a-zA-Z0-9_\-]', '', orig_filename.replace('.mid', '').replace('Stride_', ''))
            if harmonize_type == "b-section":
                filename_style = f"{clean_orig_name}_B_Section"
            else:
                filename_style = f"{clean_orig_name}_Add_{harmonize_type.capitalize()}"

        elif action == "drums_generation":
            # --- THE RHYTHM ENGINE LOGIC ---
            style = str(data.get("style") or "Boom Bap")
            bpm = max(40, min(300, safe_int(data.get("bpm"), 90)))
            bars = max(1, min(32, safe_int(data.get("bars"), 4)))
            swing_feel = str(data.get("swing_feel") or "straight")
            drum_fills = str(data.get("drum_fills") or "4")
            
            max_ticks = bars * 1920
            folder_style = "RhythmEngine"
            
            folder_key = re.sub(r'[^a-zA-Z0-9_\-]', '', style).strip()
            if not folder_key: folder_key = "DrumGroove"
            
            fill_logic = "Do not write any drum fills. Keep the loop consistent."
            if drum_fills != "none":
                fill_logic = f"Write a consistent base groove, but exactly every {drum_fills} bars, break the pattern and write a professional drum fill using Toms (43) and Percussions (72, 73, 74)."

            director_prompt = f"""
            Act as an elite drum programmer and producer. We are creating a drum groove in the style of {style}.
            Tempo: {bpm} BPM. Length: {bars} Bars.
            
            Write a highly detailed, 100-word instruction manual for a MIDI drum programmer. Describe the exact kick/snare pocket, hi-hat syncopation, and ghost note placement.
            Do NOT write JSON. Output ONLY the musical instructions.
            """
            
            try:
                flash_response = client.models.generate_content(
                    model='gemini-2.5-flash',
                    contents=director_prompt
                )
                enhanced_musical_instructions = flash_response.text.strip()
            except Exception as e:
                enhanced_musical_instructions = "Program a realistic drum groove matching the requested style."

            prompt = f"""
            Act as an elite music producer and MIDI drum programmer.
            Your task is to generate a professional drum groove.

            [CORE PARAMETERS]
            - Style: {style}
            - Tempo: {bpm} BPM
            - Length: {bars} Bars (Exactly {max_ticks} ticks total at 480 TPQN)

            [MUSICAL DIRECTIVES]
            {enhanced_musical_instructions}
            
            [AUTOMATION DIRECTIVE]
            {automation_instruction}

            [STRICT DRUM MAPPING & RULES]
            1. STRICT MIDI MAPPING (DO NOT USE OTHER NOTES):
               - C1 (36) = Kick
               - C2 (48) = Main Snare (Backbeat)
               - D2 (50) = Ghost Snare / Syncopations
               - C3 (60) = Hi-Hats (Closed/Open)
               - G1 (43) = Toms (For Fills)
               - C4 (72), C#4 (73), D4 (74) = Percussions/FX
            2. DYNAMICS & VELOCITY:
               - Backbeat (Snare 48): Must hit hard (Velocity 90-110).
               - Ghost Notes (Snare 50): Must be extremely soft (Velocity 20-40) to create a pocket.
               - Hi-Hats: MUST NOT be flat. Use alternating velocities (strong-weak-medium-weak) to create realistic groove.
            3. RHYTHMIC TIMING: Generate perfectly straight 16th notes on the grid. Mathematical swing will be applied later in backend post-processing.
            4. FILLS: {fill_logic}

            CRITICAL: Return ONLY a valid JSON object matching this format:
            {{"notes": [{{"n": note_number, "s": start_tick, "d": duration_ticks, "v": velocity}}], "cc": [], "pb": [], "gliss": [], "automation": ["elite_stutter_ramp"]}}
            """
            
            filename_style = f"Drums_{folder_key}"

        else:
            # --- GENERATION LOGIC (Standard / Cosmic / NLP Assistant) ---
            bars = max(1, min(32, safe_int(data.get("bars"), 8)))
            max_ticks = bars * 1920
            
            is_prompt_mode = data.get("is_prompt_mode", False)
            
            if is_prompt_mode:
                prompt_text = data.get("prompt_text", "")
                
                prompt = f"""
                You are an elite music producer, theorist, and MIDI programmer.
                The user has requested a custom MIDI sequence based on the following free-text prompt:
                
                USER PROMPT: "{prompt_text}"

                Your constraints:
                1. Strictly lock the mathematical timing to 480 TPQN (Ticks Per Quarter Note).
                2. Limit the duration to exactly {bars} Bars (Exactly {max_ticks} ticks total).
                3. Do not generate any notes outside the standard playable range (MIDI notes 24 to 84 / C1 to C6).
                4. You MUST invent and define the BPM, Key, and Style based entirely on the mood and instructions in the user's text.
                5. Add appropriate humanization (velocity variations, slight timing shifts if requested).
                6. You can use 'pb' (pitch bend) and 'cc' (sustain pedal 64) if it fits the requested style.
                7. CRITICAL HARMONIC RULE: If the prompt requests a minor, dark, tense, or exotic mode (e.g., Phrygian, Aeolian, Harmonic Minor), you MUST strictly enforce that tonality. DO NOT drift into the relative major scale. FORBID happy, bright, or major chord resolutions entirely unless explicitly asked for.
                8. MELODIC FILLS: Insert tasteful single-note melodic licks, passing notes, and riffs between chord changes to connect the harmony fluently.
                
                [AUTOMATION DIRECTIVE]
                {automation_instruction}

                CRITICAL: You MUST return a valid JSON object containing a 'metadata' object alongside the note arrays.
                Format exactly like this:
                {{
                    "metadata": {{
                        "style": "Short Genre Description",
                        "key": "e.g., C Minor",
                        "bpm": integer_value_between_60_and_160,
                        "bars": {bars}
                    }},
                    "notes": [{{"n": note_number, "s": start_tick, "d": duration_ticks, "v": velocity}}],
                    "cc": [{{"c": 64, "v": value, "t": tick}}],
                    "pb": [{{"p": pitch_value_-8192_to_8191, "t": tick}}],
                    "gliss": [],
                    "automation": ["elite_stutter_step"]
                }}
                """
            
            elif is_cosmic:
                bpm = max(40, min(300, safe_int(data.get("bpm"), 85)))
                cosmic_algo = str(data.get("cosmic_algo") or "tesla")
                ancient_scale = str(data.get("ancient_scale") or "celestial")
                key = str(data.get("key") or "C")
                cosmic_density = safe_int(data.get("cosmic_density"), 50)
                gliss_intensity = str(data.get("gliss_intensity") or "sparse")
                
                folder_style = re.sub(r'[^a-zA-Z0-9_\-]', '', ancient_scale).capitalize()
                folder_key = re.sub(r'[^a-zA-Z0-9_\-]', '', key).replace('#', 'Sharp')
                
                if cosmic_density < 40 and gliss_intensity == "often":
                    gliss_intensity = "sparse"
                
                if cosmic_algo == "tesla": algo_logic = "TESLA 3-6-9: Base your velocity accents, phrasing boundaries, and rhythmic motifs on cycles of 3, 6, and 9. The groove should feel mathematically locked to these numbers."
                elif cosmic_algo == "fibonacci": algo_logic = "FIBONACCI SEQUENCE: Apply Fibonacci spacing (1, 2, 3, 5, 8...) to velocity accents, dynamic swells, and structural phrase lengths to create a rhythm that evolves like nature."
                else: algo_logic = "GOLDEN RATIO (1.618): Superimpose polyrhythms. Mathematically structure the velocity and complexity to reach an absolute climax exactly at 61.8% of the sequence total ticks."

                if ancient_scale == "celestial": tonality_logic = f"CELESTIAL (Lydian): Use the Lydian mode based on {key}."
                elif ancient_scale == "mystic": tonality_logic = f"MYSTIC (Hirajōshi): Use the Japanese Hirajōshi pentatonic scale based on {key}."
                elif ancient_scale == "ethereal": tonality_logic = f"ETHEREAL (Minor Pentatonic): Use a wide Minor Pentatonic scale based on {key}."
                else: tonality_logic = f"ENIGMATIC (Byzantine): Use the Double Harmonic / Byzantine scale based on {key}."

                density_logic = f"COSMIC FLOW (DENSITY) is {cosmic_density}/100. If <40, create 'Nebula' phrasing: slow, sparse, long sustained notes with lots of air/rests. If 40-70, create 'Orbit' phrasing: steady pulsing cinematic sequences. If >70, create 'Quantum' phrasing: rapid, rolling 16th/32nd note arpeggiations flowing endlessly."
                
                sustain_logic = "SUSTAIN (CC64): CRITICAL! Perform 'Pedal Pumping'. Apply CC64=127 exactly when hitting anchor root notes to create a deep resonating drone. Release it (CC64=0) strictly BEFORE playing passing notes or when resetting the phrase, to prevent dissonant muddy buildup."

                if gliss_intensity == "off":
                    gliss_logic = "GLISSANDO: OFF. Do not generate 'gliss' arrays."
                else:
                    chance = "15%" if gliss_intensity == "sparse" else "60%"
                    gliss_logic = f"GLISSANDO (MICRO-STRUM): {chance} chance to generate a fast cascade/strum instead of standard notes. Vary the note count between 3 to 6 notes based on tension. Place them strategically on downbeats or as pickups. Output these exclusively in the 'gliss' array: [{{\"s\": start_tick, \"notes\": [{{\"n\": pitch, \"v\": vel, \"d\": dur}}]}}]."

                director_prompt = f"""
                Act as an elite avant-garde composer. You are designing a dreamy, hypnotic, cinematic MIDI sequence using ancient intonation and sacred geometry.

                [CORE PARAMETERS]
                - Fundamental Root (Anchor): {key}
                - Base Tempo: {bpm} BPM
                - Sacred Rhythm & Groove: {algo_logic}
                - Cosmic Flow (Density): {density_logic}
                - Ancient Tonality: {tonality_logic}
                - Sustain & Resonance: {sustain_logic}
                - Glissando (Micro-Strum): {gliss_logic}

                Write a highly detailed, 100-word musical instruction manual for a MIDI programmer. Describe the exact phrasing, polyrhythms, and harmonic movement. Emphasize the strict 2-octave range (C3-C5), the MPE Micro-tuning handling, and the exact Pedal Pumping technique. Do NOT output JSON. Output ONLY the musical instructions.
                """
                
                try:
                    flash_response = client.models.generate_content(
                        model='gemini-2.5-flash',
                        contents=director_prompt
                    )
                    enhanced_musical_instructions = flash_response.text.strip()
                except Exception as e:
                    enhanced_musical_instructions = "Apply the requested sacred algorithms, ancient tonalities, and cosmic flow strictly."

                prompt = f"""
                Act as an elite avant-garde composer and mathematical MIDI programmer. 
                You are operating in 'COSMIC MODE'. Your goal is to create a dreamy, hypnotic, cinematic MIDI sequence.

                [CORE PARAMETERS]
                - Fundamental Root: {key}
                - Length: {bars} Bars (Exactly {max_ticks} ticks total at 480 TPQN)
                - Base Tempo: {bpm} BPM

                [MUSICAL DIRECTIVES (FROM LEAD COMPOSER)]
                {enhanced_musical_instructions}
                
                [AUTOMATION DIRECTIVE]
                {automation_instruction}

                [STRICT SYSTEM RULES]
                1. THE MAGIC RANGE (NO BASS): You MUST restrict ALL generated notes to a tight 2-octave range strictly between C3 and C5 (MIDI note numbers 48 to 72). Do NOT generate any low bass notes. This sequence is designed to float organically above the producer's own sub-bass.
                2. MICROTONAL MPE & SUSTAIN: The backend will automatically apply ancient Just Intonation via MPE (MIDI Polyphonic Expression) to specific notes based on the scale. You do NOT need to write 'pb' events. Your job is to output the notes, and intelligently use the Sustain Pedal ('cc' 64) via the 'Pedal Pumping' technique to allow root notes to blend, while explicitly clearing it (cc=0) before harmonic clashes.
                3. GLISSANDO: If instructed to use glissando, output these exclusively in the 'gliss' array: [{{"s": start_tick, "notes": [{{"n": pitch, "v": vel, "d": dur}}]}}]. 

                CRITICAL: Return ONLY a valid JSON object. Do not explain your math.
                Format: {{"notes": [{{"n": note_number, "s": start_tick, "d": duration_ticks, "v": velocity}}], "cc": [{{"c": 64, "v": value_0_or_127, "t": tick}}], "gliss": [{{"s": start_tick, "notes": [{{"n": note_number, "v": velocity, "d": duration_ticks}}]}}], "automation": ["elite_stutter_ramp"]}}
                """
                filename_style = f"Cosmic_{folder_style}_{cosmic_algo.capitalize()}_{folder_key}"

            else:
                bpm = max(40, min(300, safe_int(data.get("bpm"), 85)))
                style = str(data.get("style") or "Neo-Soul")
                key = str(data.get("key") or "C")
                mode = str(data.get("mode") or "Minor (Aeolian)")
                swing = safe_int(data.get("swing"), 0)
                sync_chance = safe_int(data.get("sync_chance"), 0)
                grid = str(data.get("grid") or "straight")
                gliss_intensity = str(data.get("gliss_intensity") or "sparse")
                
                voicing_mode = str(data.get("voicing_mode") or "poly")
                comp_level = safe_int(data.get("comp_level"), 4)
                
                density = safe_int(data.get("density"), 50)
                articulation = str(data.get("articulation") or "balanced")
                pitch_bend = str(data.get("pitch_bend") or "off")
                sustain = str(data.get("sustain") or "dry")

                folder_style = re.sub(r'[^a-zA-Z0-9_\-]', '', style)
                folder_key = re.sub(r'[^a-zA-Z0-9_\-]', '', key).replace('#', 'Sharp')

                grid_logic = ""
                if grid == "triplets": grid_logic = "Triplets (12/8 feel). Divide beats into 3 equal parts. Use triplet grid ticks."
                elif grid == "quintuplets": grid_logic = "Generate strictly Straight 16ths. DO NOT attempt to write 5 notes per beat or mathematically swing them yourself. The engine will automatically apply Quintuplet/Dilla swing (shifting offbeats to 288, etc.) mathematically in post-processing."
                elif grid == "polyrhythm": grid_logic = "Polyrhythm. Superimpose different subdivisions (e.g., 3 over 4) across the phrase."
                else: grid_logic = "Straight 16ths. Lock strictly into standard 16th-note mathematical grid divisions."

                articulation_logic = ""
                if articulation == "staccato": articulation_logic = "Staccato: Short, punchy durations (60-120 ticks). No overlapping notes."
                elif articulation == "legato": articulation_logic = "Legato: Long, sustained notes. Allow slightly overlapping durations."
                else: articulation_logic = "Balanced: Natural flow that breathes dynamically."

                pb_logic = ""
                if pitch_bend == "subtle": pb_logic = "PITCH BEND: Subtle grace notes. Slight drops (up to -2000) exactly at the ends of phrases. Must return to 0."
                elif pitch_bend == "portamento": pb_logic = "PITCH BEND: Portamento. Smooth glides (-4096 to 4096) between notes to mimic synth glide. Always return to 0."
                elif pitch_bend == "tapestop": pb_logic = "PITCH BEND: Tape stop. Drastic drops (down to -8192) acting as an effect at ends of bars."
                else: pb_logic = "PITCH BEND: OFF. Do not generate 'pb' events."

                sustain_logic = ""
                if sustain == "dry": sustain_logic = "SUSTAIN (CC64): DRY. Strictly 0 at all times. No pedal usage."
                elif sustain == "washed": sustain_logic = "SUSTAIN (CC64): WASHED. Hold pedal (value 127) to blur and merge notes. Clear to 0 only at major section drops."
                else: sustain_logic = "SUSTAIN (CC64): ADAPTIVE. Value 127 at chord strikes, drop to 0 right before chord changes to prevent mud."

                if voicing_mode == "mono":
                    harmony_rule = "MONOPHONIC: Strictly single-note lines (no chords). Keep it in a comfortable mid-register (C2-C5) for the user to transpose later."
                else:
                    if comp_level == 2: harmony_rule = "SIMPLE DYADS: Mostly 2-note intervals (thirds, sixths) and basic triads. Interweave short melodic passing notes and licks between chord changes."
                    elif comp_level == 3: harmony_rule = "STANDARD POLYPHONY: Full triads and 7th chords. Build clear chord progressions with expressive single-note melodic licks and riffs connecting the chords."
                    elif comp_level == 4: harmony_rule = "ADVANCED HARMONY: Rich voicings (7ths, 9ths, suspensions). Excellent voice leading with tasteful melodic transition licks and passing tones between chord strikes."
                    else: harmony_rule = "COMPLEX JAZZ/NEO-SOUL: Lush, complex polyphony (11ths, 13ths, rootless). Interweave intricate melodic licks, grace notes, and passing riffs fluently between the chord changes."

                if gliss_intensity == "off":
                    gliss_logic = "GLISSANDO: OFF. Do not generate 'gliss' arrays."
                else:
                    chance = "15%" if gliss_intensity == "sparse" else "60%"
                    gliss_logic = f"GLISSANDO (MICRO-STRUM): {chance} chance to generate a fast cascade/grace-note flurry instead of a regular note/chord. Vary the note count between 3 to 6 notes. Place them strategically on downbeats. Output exclusively in the 'gliss' array: [{{\"s\": start_tick, \"notes\": [{{\"n\": pitch, \"v\": vel, \"d\": dur}}]}}]. Do not calculate micro-offsets yourself."

                director_prompt = f"""
                Act as an elite music theorist and producer. We are creating a professional-grade MIDI sequence.

                [CORE PARAMETERS]
                - Style: {style}
                - Key & Mode: {key} {mode}
                - Tempo: {bpm} BPM
                - Harmony & Voicing: {harmony_rule}
                - Rhythmic Grid: {grid_logic}
                - Articulation: {articulation_logic}
                - Density: {density}/100
                - Pitch Bend: {pb_logic}
                - Sustain Pedal: {sustain_logic}
                - Glissando (Micro-Strum): {gliss_logic}
                - Swing Feel: {swing}/100
                - Syncopation Chance: {sync_chance}%

                Write a highly detailed, 100-150 word musical instruction manual for a MIDI programmer to execute this. Describe the exact chord voicings (e.g., 9ths, 11ths, rootless if jazz/soul), the rhythmic pocket, velocity humanization, and voice leading rules that fit the {style} genre. Specifically instruct the programmer to weave tasteful melodic licks, grace notes, and passing tones between the chord strikes to connect the harmony seamlessly. Do NOT write JSON. Output ONLY the musical instructions.
                """
                
                try:
                    flash_response = client.models.generate_content(
                        model='gemini-2.5-flash',
                        contents=director_prompt
                    )
                    enhanced_musical_instructions = flash_response.text.strip()
                except Exception as e:
                    enhanced_musical_instructions = "Apply the requested style, harmony, rhythm, and humanization settings strictly. Ensure melodic licks connect the chord progressions."

                licks_rule = "4. MELODIC FILLS (CRITICAL): Do NOT just place static block chords. You MUST insert tasteful single-note melodic licks, passing tones, and short riffs between the chord transitions to make the performance feel human, alive, and connected." if voicing_mode == "poly" else ""

                prompt = f"""
                Act as an elite music theorist, producer, and world-class MIDI programmer. 
                Your task is to generate a highly expressive, professional-grade MIDI sequence.

                [CORE PARAMETERS]
                - Style: {style}
                - Key & Mode: {key} {mode}
                - Tempo: {bpm} BPM
                - Length: {bars} Bars (Exactly {max_ticks} ticks total at 480 TPQN)

                [MUSICAL DIRECTIVES (FROM LEAD PRODUCER)]
                {enhanced_musical_instructions}
                
                [AUTOMATION DIRECTIVE]
                {automation_instruction}

                [STRICT SYSTEM RULES]
                1. MATHEMATICAL TIMING: Lock strictly to 480 TPQN. Do not exceed the {max_ticks} max tick limit.
                2. RANGE: Restrict to standard playable range (MIDI notes 24 to 84).
                3. GLISSANDO: If instructed to use micro-strums, output exclusively in the 'gliss' array: [{{"s": start_tick, "notes": [{{"n": pitch, "v": vel, "d": dur}}]}}]. Do not calculate micro-offsets yourself.
                {licks_rule}

                CRITICAL: Return ONLY a valid JSON object. 
                Format: {{"notes": [{{"n": note_number, "s": start_tick, "d": duration_ticks, "v": velocity}}], "cc": [{{"c": 64, "v": value_0_or_127, "t": tick}}], "pb": [{{"p": pitch_value_-8192_to_8191, "t": tick}}], "gliss": [{{"s": start_tick, "notes": [{{"n": note_number, "v": velocity, "d": duration_ticks}}]}}], "automation": ["elite_groove_a", "elite_stutter_step"]}}
                """
                filename_style = f"{folder_style}_{folder_key}"

        # --- Request Execution (Shared Logic) ---
        max_retries = 3
        base_delay = 2
        generation_model = 'gemini-2.5-flash' if data.get('fast_mode') else 'gemini-2.5-pro'

        for attempt in range(max_retries):
            try:
                response = client.models.generate_content(
                    model=generation_model,
                    contents=prompt,
                    config=types.GenerateContentConfig(
                        response_mime_type="application/json",
                    )
                )
                break 
                
            except Exception as api_error:
                error_str = str(api_error)
                retry_codes = ["500", "503", "504", "429", "InternalServerError", "DeadlineExceeded"]
                if any(code in error_str for code in retry_codes):
                    if attempt < max_retries - 1:
                        sleep_time = base_delay * (2 ** attempt) 
                        time.sleep(sleep_time)
                    else:
                        raise 
                else:
                    raise 
        
        # --- PREVENT CRASH IF GENERATION IS BLOCKED BY SAFETY FILTERS ---
        try:
            raw_response = response.text
        except ValueError:
            raise Exception("AI Safety Filter blocked the generation. Please try a different prompt or style.")

        json_match = re.search(r'\{.*\}', raw_response, re.DOTALL)
        if json_match:
            clean_json = json_match.group(0)
        else:
            clean_json = raw_response.replace("```json", "").replace("```", "").strip()
            
        # --- EXTREMELY SAFE JSON PARSING ---
        try:
            notes_data = json.loads(clean_json)
        except Exception as parse_e:
            notes_data = {"notes": []}
            
        if not isinstance(notes_data, dict):
            notes_data = {"notes": notes_data} if isinstance(notes_data, list) else {"notes": []}

        for key_name in ['notes', 'gliss', 'cc', 'pb']:
            if not isinstance(notes_data.get(key_name), list):
                notes_data[key_name] = []

        # --- POST-PROCESSING: QUINTUPLET SWING (DILLA FEEL) ---
        if action == "generate" and not is_cosmic and not data.get("is_prompt_mode") and data.get("grid") == "quintuplets":
            for n in notes_data['notes']:
                if not isinstance(n, dict): continue
                try:
                    s = max(0, safe_int(n.get('s')))
                    beat_tick = s % 480
                    
                    if abs(beat_tick - 120) < 30:
                        n['s'] = s + (96 - beat_tick)
                    elif abs(beat_tick - 240) < 30:
                        n['s'] = s + (288 - beat_tick)
                    elif abs(beat_tick - 360) < 30:
                        n['s'] = s + (384 - beat_tick)
                except Exception:
                    pass

        # --- POST-PROCESSING: RHYTHM ENGINE DRUM SWING ---
        if action == "drums_generation":
            swing_feel = str(data.get("swing_feel") or "straight")
            if swing_feel != "straight":
                for n in notes_data['notes']:
                    if not isinstance(n, dict): continue
                    try:
                        s = max(0, safe_int(n.get('s')))
                        pitch = safe_int(n.get('n'))
                        beat_tick = s % 480
                        bar_tick = s % 1920
                        
                        if swing_feel == "dilla":
                            if abs(beat_tick - 120) < 20:
                                n['s'] = s + 30
                            elif abs(beat_tick - 360) < 20:
                                n['s'] = s + 30
                                
                        elif swing_feel == "lazy":
                            if pitch == 48:
                                if abs(bar_tick - 480) < 20 or abs(bar_tick - 1440) < 20:
                                    n['s'] = s + 15
                                    
                        elif swing_feel == "mpc":
                            if abs(beat_tick - 240) < 20:
                                n['s'] = s + 25
                    except Exception:
                        pass

        # --- STUDIO ASSISTANT METADATA EXTRACTION ---
        if action == "generate" and data.get("is_prompt_mode", False):
            meta = notes_data.get("metadata")
            if not isinstance(meta, dict):
                meta = {}
                
            bpm = max(40, min(300, safe_int(meta.get("bpm"), 120)))
            style_meta = str(meta.get("style") or "Studio Generated")
            key_meta = str(meta.get("key") or "C")
            bars = max(1, min(32, safe_int(meta.get("bars"), bars)))
            
            folder_style = "PromptStudio"
            folder_key = re.sub(r'[^a-zA-Z0-9_\-]', '', key_meta).replace('#', 'Sharp')
            clean_style = re.sub(r'[^a-zA-Z0-9]', '', style_meta)
            if not clean_style:
                clean_style = "Generation"
            filename_style = f"NLP_{clean_style}_{folder_key}"

        # --- FILENAME LENGTH FIX (Prevent Errno 36) ---
        safe_filename_style = filename_style[:30] # Limit the dynamic part to 30 chars safely
        timestamp = datetime.now().strftime('%H%M%S')
        uid_short = str(uuid.uuid4())[:4].upper()
        
        filename = f"Stride_{safe_filename_style}_{bpm}BPM_{timestamp}_{uid_short}.mid"
        filepath = os.path.join("/tmp", filename)
        
        mid = MidiFile()
        track = MidiTrack()
        mid.tracks.append(track)
        track.append(mido.MetaMessage('set_tempo', tempo=mido.bpm2tempo(bpm)))
        
        events = []
        all_parsed_notes = []
        
        # 1. Gather Standard Notes
        for n in notes_data['notes']:
            if not isinstance(n, dict): continue
            try:
                start = max(0, safe_int(n.get('s')))
                duration = max(1, safe_int(n.get('d'), 120))
                note_val = max(0, min(127, safe_int(n.get('n'), 60)))
                vel = max(0, min(127, safe_int(n.get('v'), 100)))
                
                if start < max_ticks:
                    if start + duration > max_ticks:
                        duration = max_ticks - start
                    all_parsed_notes.append({'n': note_val, 's': start, 'd': duration, 'v': vel})
            except Exception:
                pass

        # 2. Gather Glissando Notes
        ms_to_ticks = (25 * bpm * 480) / 60000 
        gliss_per_bar_count = {} 
        for g in notes_data['gliss']:
            if not isinstance(g, dict): continue
            try:
                base_start = max(0, safe_int(g.get('s')))
                if base_start < max_ticks:
                    bar_index = int(base_start // 1920)
                    current_bar_count = gliss_per_bar_count.get(bar_index, 0)
                    
                    if current_bar_count == 0:
                        for idx, n in enumerate(g.get('notes', [])):
                            if not isinstance(n, dict): continue
                            try:
                                offset_ticks = int(idx * ms_to_ticks)
                                actual_start = base_start + offset_ticks
                                duration = max(1, safe_int(n.get('d'), 120))
                                note_val = max(0, min(127, safe_int(n.get('n'), 60)))
                                vel = max(0, min(127, safe_int(n.get('v'), 100)))
                                
                                if actual_start < max_ticks:
                                    if actual_start + duration > max_ticks:
                                        duration = max_ticks - actual_start
                                    all_parsed_notes.append({'n': note_val, 's': actual_start, 'd': duration, 'v': vel})
                            except Exception:
                                pass
                        gliss_per_bar_count[bar_index] = 1 
                    else:
                        for n in g.get('notes', []):
                            if not isinstance(n, dict): continue
                            try:
                                actual_start = base_start 
                                duration = max(1, safe_int(n.get('d'), 120))
                                note_val = max(0, min(127, safe_int(n.get('n'), 60)))
                                vel = max(0, min(127, safe_int(n.get('v'), 100)))
                                
                                if actual_start < max_ticks:
                                    if actual_start + duration > max_ticks:
                                        duration = max_ticks - actual_start
                                    all_parsed_notes.append({'n': note_val, 's': actual_start, 'd': duration, 'v': vel})
                            except Exception:
                                pass
            except Exception:
                pass

        all_parsed_notes.sort(key=lambda x: x['s'])

        # 3. MPE Channel Allocation & Micro-Tuning
        channel_status = {ch: -1 for ch in range(1, 16)} 
        
        if is_cosmic:
            key_map = {"C":0, "C#":1, "D":2, "D#":3, "E":4, "F":5, "F#":6, "G":7, "G#":8, "A":9, "A#":10, "B":11}
            root_idx = key_map.get(key, 0)
            micro_tuning = {}
            if ancient_scale == "celestial": micro_tuning[(root_idx + 6) % 12] = 491
            elif ancient_scale == "mystic": 
                micro_tuning[(root_idx + 1) % 12] = -410
                micro_tuning[(root_idx + 8) % 12] = -410
            elif ancient_scale == "ethereal": micro_tuning[(root_idx + 3) % 12] = 655
            elif ancient_scale == "enigmatic": micro_tuning[(root_idx + 11) % 12] = -573

        for note in all_parsed_notes:
            start = note['s']
            end = note['s'] + note['d']
            pitch = note['n']
            vel = note['v']
            
            ch = 9 if action == "drums_generation" else 0
            pb_val = 0
            
            if is_cosmic:
                for c in range(1, 16):
                    if channel_status[c] <= start:
                        ch = c
                        break
                if ch == 0:
                    ch = 1 
                
                channel_status[ch] = end + 10
                
                degree = pitch % 12
                if degree in micro_tuning:
                    pb_val = micro_tuning[degree]
                    
            events.append({'type': 'note_on', 'time': start, 'note': pitch, 'vel': vel, 'channel': ch})
            events.append({'type': 'note_off', 'time': end, 'note': pitch, 'vel': 0, 'channel': ch})
            
            if pb_val != 0:
                events.append({'type': 'pitchwheel', 'time': start, 'pitch': pb_val, 'channel': ch})
                events.append({'type': 'pitchwheel', 'time': end, 'pitch': 0, 'channel': ch})

        # 4. Process Control Change (CC)
        for c in notes_data['cc']:
            if not isinstance(c, dict): continue
            try:
                t = max(0, safe_int(c.get('t')))
                ctrl = max(0, min(127, safe_int(c.get('c'), 64)))
                val = max(0, min(127, safe_int(c.get('v'), 0)))
                if t <= max_ticks:
                    events.append({'type': 'control_change', 'time': t, 'control': ctrl, 'value': val, 'channel': 0})
            except Exception:
                pass
                
        # 5. Process Pitch Bend (PB) ONLY if not cosmic
        if not is_cosmic:
            for p in notes_data['pb']:
                if not isinstance(p, dict): continue
                try:
                    t = max(0, safe_int(p.get('t')))
                    safe_pitch = max(-8192, min(8191, safe_int(p.get('p'))))
                    if t <= max_ticks:
                        events.append({'type': 'pitchwheel', 'time': t, 'pitch': safe_pitch, 'channel': 0})
                except Exception:
                    pass

        def event_priority(evt_type):
            if evt_type == 'note_off': return 0
            if evt_type == 'control_change': return 1
            if evt_type == 'pitchwheel': return 2
            return 3 
            
        events.sort(key=lambda x: (x['time'], event_priority(x['type'])))
        
        last_time = 0
        for e in events:
            delta = max(0, e['time'] - last_time)
            ch = e.get('channel', 0)
            if e['type'] in ['note_on', 'note_off']:
                track.append(Message(e['type'], note=e['note'], velocity=e['vel'], time=delta, channel=ch))
            elif e['type'] == 'control_change':
                track.append(Message('control_change', control=e['control'], value=e['value'], time=delta, channel=ch))
            elif e['type'] == 'pitchwheel':
                track.append(Message('pitchwheel', pitch=e['pitch'], time=delta, channel=ch))
            last_time = e['time']
            
        mid.save(filepath)
            
        # --- 3. CLOUD VAULT (STORAGE & FIRESTORE) ---
        bucket = storage.bucket()
        blob_path = f"generations/{uid}/{folder_style}/{folder_key}/{filename}"
        blob = bucket.blob(blob_path)
        
        blob.content_disposition = f'attachment; filename="{filename}"'
        
        download_token = str(uuid.uuid4())
        blob.metadata = {"firebaseStorageDownloadTokens": download_token}
        blob.upload_from_filename(filepath, content_type='audio/midi')
        
        encoded_path = urllib.parse.quote(blob_path, safe='')
        download_url = f"https://firebasestorage.googleapis.com/v0/b/{bucket.name}/o/{encoded_path}?alt=media&token={download_token}"
        
        # --- SOUND DESIGN GENERATION (WITH HYBRID CANVAS INJECTION) ---
        alc_download_url = None
        chain_id = None
        if enable_sound_design:
            target_id = data.get("target_chain_id", "sound_design_1")
            chain_id = target_id
            try:
                if "/" in chain_id:
                    template_blob_path = chain_id
                else:
                    template_blob_path = f"templates/chains/{chain_id}.alc"
                    
                template_blob = bucket.blob(template_blob_path)
                template_bytes = template_blob.download_as_bytes()

                try:
                    xml_str = gzip.decompress(template_bytes).decode('utf-8')
                except Exception:
                    xml_str = template_bytes.decode('utf-8')
                root = ET.fromstring(xml_str)
                
                key_tracks = root.find('.//KeyTracks')
                if key_tracks is not None:
                    for child in list(key_tracks):
                        key_tracks.remove(child)
                        
                    notes_by_pitch = {}
                    for n in notes_data['notes']:
                        if not isinstance(n, dict): continue
                        pitch = max(0, min(127, safe_int(n.get('n'), 60)))
                        if pitch not in notes_by_pitch:
                            notes_by_pitch[pitch] = []
                        notes_by_pitch[pitch].append(n)
                        
                    for pitch, notes_list in notes_by_pitch.items():
                        key_track = ET.SubElement(key_tracks, 'KeyTrack')
                        key_track.set('Id', str(random.randint(10000, 99999)))
                        
                        midi_key_node = ET.SubElement(key_track, 'MidiKey')
                        midi_key_node.set('Value', str(pitch))
                        
                        notes_node = ET.SubElement(key_track, 'Notes')
                        
                        for n in notes_list:
                            start_beat = max(0, safe_int(n.get('s'))) / 480.0
                            duration_beat = max(1, safe_int(n.get('d'), 120)) / 480.0
                            velocity = max(0, min(127, safe_int(n.get('v'), 100)))
                            
                            if start_beat < (bars * 4.0):
                                if start_beat + duration_beat > (bars * 4.0):
                                    duration_beat = (bars * 4.0) - start_beat
                                    
                                note_event = ET.SubElement(notes_node, 'MidiNoteEvent')
                                note_event.set('Time', str(start_beat))
                                note_event.set('Duration', str(duration_beat))
                                note_event.set('Velocity', str(velocity))
                                note_event.set('OffVelocity', '64')
                                note_event.set('Probability', '1')
                                note_event.set('IsEnabled', 'true')
                                note_event.set('NoteId', str(random.randint(10000, 99999)))
                                
                total_beats = bars * 4.0
                loop_node = root.find('.//Loop')
                if loop_node is not None:
                    for tag in ['LoopEnd', 'HiddenLoopEnd', 'OutMarker']:
                        el = loop_node.find(tag)
                        if el is not None:
                            el.set('Value', str(total_beats))
                            
                # --- HYBRID AUTOMATION DIRECTOR (CANVAS + CHAOS) ---
                
                # SUPPORT BOTH CLIP ENVELOPES AND TIMELINE (ARRANGEMENT) ENVELOPES
                all_envelopes = root.findall('.//ClipEnvelope') + root.findall('.//AutomationEnvelope')
                
                manual_params = data.get("manual_automation") or data.get("parameters", [])
                param_map = {int(p.get("envelopeId", -1)): p for p in manual_params}
                
                # AGGRESSIVE GLOBAL PARAMETER PARSING
                param_id_to_name = {}
                param_bounds = {}
                
                for param in root.findall('.//*[@Id]'):
                    tag = param.tag
                    p_id = param.get('Id')
                    if not p_id: continue

                    # Name Extraction
                    name = None
                    for n_tag in ['UserName', 'Name']:
                        n_node = param.find(f'.//{n_tag}')
                        if n_node is not None and n_node.get('Value'):
                            name = n_node.get('Value')
                            break
                    if name: param_id_to_name[p_id] = name

                    # Bounds Extraction (only when explicitly declared)
                    min_v, max_v = None, None

                    min_node = param.find('Min')
                    if min_node is None: min_node = param.find('.//Min')
                    if min_node is not None:
                        val = min_node.get('Value') or min_node.text
                        if val:
                            try: min_v = float(val)
                            except: pass

                    max_node = param.find('Max')
                    if max_node is None: max_node = param.find('.//Max')
                    if max_node is not None:
                        val = max_node.get('Value') or max_node.text
                        if val:
                            try: max_v = float(val)
                            except: pass

                    # Sniff value tags to expand max beyond declared bounds
                    for val_tag in ['Value', 'ManualValue', 'TargetMax']:
                        v_node = param.find(val_tag)
                        if v_node is None: v_node = param.find(f'.//{val_tag}')
                        if v_node is not None:
                            val = v_node.get('Value') or v_node.text
                            if val:
                                try:
                                    f_val = float(val)
                                    cur_max = max_v if max_v is not None else 1.0
                                    if f_val > cur_max: max_v = f_val
                                except: pass

                    # Only register when we found explicit bounds.
                    # CRITICAL: also register under child AutomationTarget/ModulationTarget Ids —
                    # PointeeId in envelopes points to those child elements, not the parameter itself.
                    if min_v is not None or max_v is not None:
                        bounds = {
                            'min': min_v if min_v is not None else 0.0,
                            'max': max_v if max_v is not None else 1.0,
                            'is_int': ('Int' in tag or 'Enum' in tag),
                            'is_bool': ('Bool' in tag)
                        }
                        param_bounds[p_id] = bounds
                        for tgt in param.findall('AutomationTarget') + param.findall('ModulationTarget'):
                            t_id = tgt.get('Id')
                            if t_id:
                                param_bounds[t_id] = bounds
                                if name: param_id_to_name[t_id] = name

                # PASS 2: parent-map for nested AutomationTarget
                # Handles PluginFloatParameter > ParameterValue > AutomationTarget (Serum 2, etc.)
                # without disturbing AutomatableDeviceParameter > AutomationTarget (Ableton native)
                _pmap = {child: parent for parent in root.iter() for child in parent}
                for _tag in ['AutomationTarget', 'ModulationTarget']:
                    for _tgt in root.findall(f'.//{_tag}'):
                        _tid = _tgt.get('Id')
                        if not _tid:
                            continue
                        _par = _pmap.get(_tgt)
                        if _par is None:
                            continue
                        # MidiControllerRange on the direct parent is always authoritative.
                        # Covers both Ableton native (Volume/Pan/etc > MidiControllerRange)
                        # and Serum 2 (ParameterValue > MidiControllerRange).
                        # Always overwrite — resolves Id collisions between PluginFloatParameter
                        # and AutomationTarget sharing the same numeric Id in different scopes.
                        _mcr = _par.find('MidiControllerRange')
                        if _mcr is None:
                            continue  # no MCR — leave pass 1 result or default 0-1
                        _minv = _maxv = None
                        _mn = _mcr.find('Min')
                        _mx = _mcr.find('Max')
                        if _mn is not None:
                            try: _minv = float(_mn.get('Value') or _mn.text or '')
                            except: pass
                        if _mx is not None:
                            try: _maxv = float(_mx.get('Value') or _mx.text or '')
                            except: pass
                        if _minv is not None or _maxv is not None:
                            # Preserve type info from Pass 1 if it exists
                            _prev = param_bounds.get(_tid, {})
                            param_bounds[_tid] = {
                                'min': _minv if _minv is not None else 0.0,
                                'max': _maxv if _maxv is not None else 1.0,
                                'is_int': _prev.get('is_int', False),
                                'is_bool': _prev.get('is_bool', False)
                            }
                            # Inherit name: check parent then grandparent
                            if _tid not in param_id_to_name:
                                _gpar = _pmap.get(_par)
                                for _src in ([_par, _gpar] if _gpar is not None else [_par]):
                                    for _ntag in ['ParameterName', 'UserName', 'Name']:
                                        _nn = _src.find(_ntag)
                                        if _nn is not None and _nn.get('Value'):
                                            param_id_to_name[_tid] = _nn.get('Value')
                                            break
                                    if _tid in param_id_to_name:
                                        break

                for macro_idx, env in enumerate(all_envelopes):
                    events_node = env.find('.//Events')
                    if events_node is not None:
                        pointee_id = None
                        p_node = env.find('.//EnvelopeTarget/PointeeId')
                        if p_node is not None:
                            pointee_id = p_node.get('Value')

                        event_tag = 'FloatEvent'
                        template_max = 1.0
                        template_min = 0.0 
                        
                        if pointee_id and pointee_id in param_bounds:
                            template_min = param_bounds[pointee_id]['min']
                            template_max = param_bounds[pointee_id]['max']
                            if param_bounds[pointee_id]['is_int']: event_tag = 'IntEvent'
                            elif param_bounds[pointee_id]['is_bool']: event_tag = 'BoolEvent'
                            
                        sniffed_max = template_max
                        
                        # Sniff existing points
                        for child in list(events_node):
                            if not (pointee_id and pointee_id in param_bounds):
                                event_tag = child.tag
                            try:
                                val_str = child.get('Value', '1.0')
                                if val_str.lower() == 'true': val = 1.0
                                elif val_str.lower() == 'false': val = 0.0
                                else: val = float(val_str)
                                
                                if val > sniffed_max: sniffed_max = val
                            except Exception: pass
                            
                            events_node.remove(child)
                            
                        user_param = param_map.get(macro_idx, {})

                        # NAME HEURISTICS: Force 256 for WT Pos even if XML says 1.0
                        p_name = param_id_to_name.get(pointee_id, "").lower()
                        if sniffed_max <= 127.0:
                            if any(kw in p_name for kw in ['wt pos', 'wavetable', 'osc a', 'osc b', 'position']):
                                sniffed_max = 256.0

                        # --- MIN/MAX RESOLUTION ---
                        if "min" in user_param and "max" in user_param:
                            # Canvas params carry the exact bounds already computed by parse_alc
                            # (which already ran snap-to-scale). Trust them directly.
                            try:
                                template_min = float(user_param["min"])
                                template_max = float(user_param["max"])
                            except: pass
                        else:
                            # AI chaos mode (no canvas data): derive from XML sniff + snap-to-scale.
                            if sniffed_max > template_max:
                                if sniffed_max <= 127.0: template_max = 127.0
                                elif sniffed_max <= 255.0: template_max = 255.0
                                elif sniffed_max <= 256.0: template_max = 256.0
                                elif sniffed_max <= 1000.0: template_max = 1000.0
                                else: template_max = sniffed_max
                            if event_tag in ['IntEvent', 'EnumEvent'] and template_max <= 1.0:
                                template_max = 127.0

                        # Failsafe
                        if template_max <= template_min:
                            template_max = template_min + 1.0

                        anchor = ET.SubElement(events_node, event_tag)
                        anchor.set('Id', '0')
                        anchor.set('Time', '-63072000')
                        if event_tag == 'BoolEvent':
                            anchor.set('Value', 'false')
                        elif event_tag in ['IntEvent', 'EnumEvent']:
                            anchor.set('Value', str(int(template_max / 2)))
                        else:
                            anchor.set('Value', '0.5')
                        
                        event_id = 1
                        def add_point(t, v, curve=None):
                            nonlocal event_id
                            pt = ET.SubElement(events_node, event_tag)
                            pt.set('Id', str(event_id))
                            pt.set('Time', str(round(t, 5)))
                            
                            clamped_v = max(0.0, min(1.0, v))
                            scaled_v = template_min + (clamped_v * (template_max - template_min))
                            
                            if event_tag == 'BoolEvent':
                                pt.set('Value', 'true' if v >= 0.5 else 'false')
                            elif event_tag in ['IntEvent', 'EnumEvent']:
                                pt.set('Value', str(int(round(scaled_v))))
                            else:
                                # Ensure floating point strings are properly formatted for Ableton
                                pt.set('Value', f"{scaled_v:.5f}".rstrip('0').rstrip('.'))
                                if curve and event_tag == 'FloatEvent':
                                    pt.set('CurveControl1X', str(curve[0]))
                                    pt.set('CurveControl1Y', str(curve[1]))
                                    pt.set('CurveControl2X', str(curve[2]))
                                    pt.set('CurveControl2Y', str(curve[3]))
                                    
                            event_id += 1

                        user_points = user_param.get("points", [])
                        
                        if len(user_points) > 0:
                            # --- INJECT USER CANVAS DRAWINGS ---
                            user_points.sort(key=lambda x: x.get("time", 0.0))
                            for i, pt in enumerate(user_points):
                                t = float(pt.get("time", 0.0))
                                v = float(pt.get("value", 0.0))
                                cv = float(pt.get("curve", 0.0))
                                curve_data = None
                                if abs(cv) > 0.01 and i < len(user_points) - 1:
                                    curve_data = (0.5, -cv * 0.5, 0.5, cv * 0.5)
                                add_point(t, v, curve=curve_data)
                        else:
                            # --- FALLBACK: AI CHAOS SEQUENCER ---
                            current_beat = 0.0
                            shapes_pool = [
                                'dotted_ramp', 'mid_value_hold', 'offgrid_saw', 
                                'hard_chop', 'exponential_build',
                                'hyper_stutter', 'rhythmic_gate_build', 'syncopated_drops'
                            ]
                            
                            while current_beat < total_beats - 0.001:
                                chunk = random.choice([0.5, 1.0, 1.5, 2.0, 4.0])
                                if current_beat + chunk > total_beats: 
                                    chunk = total_beats - current_beat

                                shape = random.choice(shapes_pool)

                                if shape == 'dotted_ramp':
                                    peak = random.uniform(0.4, 1.0)
                                    add_point(current_beat, 0.0)
                                    add_point(current_beat + chunk * 0.75, peak, curve=(0.48, 0.17, 0.82, 0.51))
                                    add_point(current_beat + chunk * 0.75, 0.0)
                                    add_point(current_beat + chunk, 0.0)

                                elif shape == 'mid_value_hold':
                                    mid_val = random.uniform(0.15, 0.5)
                                    peak = random.uniform(0.7, 1.0)
                                    add_point(current_beat, 0.0)
                                    add_point(current_beat, peak)
                                    add_point(current_beat + chunk * 0.25, peak)
                                    add_point(current_beat + chunk * 0.25, mid_val)
                                    add_point(current_beat + chunk * 0.75, mid_val)
                                    add_point(current_beat + chunk * 0.75, peak)
                                    add_point(current_beat + chunk, peak)
                                    add_point(current_beat + chunk, 0.0)

                                elif shape == 'offgrid_saw':
                                    peak = random.uniform(0.5, 1.0)
                                    offgrid_point = random.choice([0.216, 0.414, 0.618, 0.88])
                                    actual_drop = chunk * offgrid_point 
                                    add_point(current_beat, 0.0)
                                    add_point(current_beat, peak)
                                    add_point(current_beat + actual_drop, 0.0, curve=(0.3, 0.0, 0.7, 1.0))
                                    add_point(current_beat + chunk, 0.0)

                                elif shape == 'hard_chop':
                                    sub = chunk / 4.0
                                    for i in range(4):
                                        val = random.choice([0.0, 1.0, random.uniform(0.3, 0.8)])
                                        if val > 0:
                                            t = current_beat + (i * sub)
                                            add_point(t, 0.0)
                                            add_point(t, val)
                                            add_point(t + (sub * 0.85), 0.0, curve=(0.16, 0.5, 0.49, 0.83))
                                    add_point(current_beat + chunk, 0.0)

                                elif shape == 'exponential_build':
                                    add_point(current_beat, 0.0)
                                    add_point(current_beat + chunk, 1.0, curve=(0.63, 0.12, 0.87, 0.36))
                                    add_point(current_beat + chunk, 0.0)

                                elif shape == 'hyper_stutter':
                                    stutter_step = random.choice([0.125, 0.0625])
                                    steps = int(chunk / stutter_step)
                                    for i in range(steps):
                                        if i % 2 == 0:
                                            t = current_beat + (i * stutter_step)
                                            val = random.uniform(0.6, 1.0)
                                            add_point(t, 0.0)
                                            add_point(t, val)
                                            add_point(t + (stutter_step * 0.9), 0.0, curve=(0.3789, 0.2070, 0.7929, 0.6210))
                                    add_point(current_beat + chunk, 0.0)

                                elif shape == 'rhythmic_gate_build':
                                    step = random.choice([0.125, 0.25, 0.5])
                                    steps = int(chunk / step)
                                    start_val = random.uniform(0.7, 1.0)
                                    end_val = random.uniform(0.0, 0.3)
                                    is_up = random.choice([True, False])
                                    for i in range(steps):
                                        t = current_beat + (i * step)
                                        progress = i / max(1, (steps - 1))
                                        current_peak = start_val + (end_val - start_val) * progress if not is_up else end_val + (start_val - end_val) * progress
                                        add_point(t, 0.0)
                                        add_point(t, current_peak)
                                        add_point(t + (step * 0.85), 0.0, curve=(0.1835, 0.4492, 0.5507, 0.8164))
                                    add_point(current_beat + chunk, 0.0)

                                elif shape == 'syncopated_drops':
                                    step = 0.25
                                    steps = int(chunk / step)
                                    for i in range(steps):
                                        if random.random() > 0.3:
                                            t = current_beat + (i * step)
                                            peak = random.uniform(0.3, 1.0)
                                            add_point(t, 0.0)
                                            add_point(t, peak)
                                            add_point(t + step * 0.9, peak * 0.8, curve=(0.16, 0.5, 0.49, 0.83))
                                            add_point(t + step * 0.9, 0.0)
                                    add_point(current_beat + chunk, 0.0)

                                current_beat = round(current_beat + chunk, 4)
                            
                new_xml_str = ET.tostring(root, encoding='utf-8', xml_declaration=True)
                compressed_alc = gzip.compress(new_xml_str)
                
                alc_filename = filename.replace('.mid', '.alc')
                alc_blob_path = f"generations/{uid}/{folder_style}/{folder_key}/{alc_filename}"
                alc_blob = bucket.blob(alc_blob_path)
                alc_blob.content_disposition = f'attachment; filename="{alc_filename}"'
                
                alc_download_token = str(uuid.uuid4())
                alc_blob.metadata = {"firebaseStorageDownloadTokens": alc_download_token}
                
                alc_blob.upload_from_string(compressed_alc, content_type='application/octet-stream')
                
                encoded_alc_path = urllib.parse.quote(alc_blob_path, safe='')
                alc_download_url = f"https://firebasestorage.googleapis.com/v0/b/{bucket.name}/o/{encoded_alc_path}?alt=media&token={alc_download_token}"
                
            except Exception as e:
                print(f"ALC Logic Error: {str(e)}")

        final_style_str = style_meta if (action == "generate" and data.get("is_prompt_mode")) else folder_style
        final_key_str = key_meta if (action == "generate" and data.get("is_prompt_mode")) else folder_key
        
        history_ref = db.collection("users").document(uid).collection("history").document()
        history_data = {
            "filename": filename,
            "url": download_url,
            "style": final_style_str,
            "key": final_key_str,
            "bpm": bpm,
            "bars": bars,
            "is_cosmic": is_cosmic if action not in ["harmonize", "seed"] else False,
            "is_favorite": False,
            "timestamp": admin_firestore.SERVER_TIMESTAMP
        }
        
        if action == "generate" and data.get("is_prompt_mode"):
            history_data["prompt_text"] = data.get("prompt_text", "")

        if enable_sound_design and alc_download_url:
            history_data["alc_url"] = alc_download_url
            history_data["chain_id"] = chain_id
            
        history_ref.set(history_data)

        # Dual-write: Supabase
        sb_log_generation(uid, {
            "filename": filename,
            "url": download_url,
            "alc_url": alc_download_url if enable_sound_design else None,
            "style": final_style_str,
            "key": final_key_str,
            "bpm": bpm,
            "bars": bars,
            "action": action,
            "is_cosmic": is_cosmic if action not in ["harmonize", "seed"] else False,
            "prompt_text": data.get("prompt_text", "") if data.get("is_prompt_mode") else None,
            "chain_id": chain_id if enable_sound_design else None,
            "fast_mode": data.get("fast_mode", False)
        }, display_name=user_display_name)

        return jsonify({
            "success": True,
            "url": download_url,
            "alc_url": alc_download_url if enable_sound_design else None,
            "filename": filename,
            "style": final_style_str,
            "key": final_key_str,
            "bpm": bpm,
            "bars": bars
        }), 200
            
    except Exception as e:
        print(f"Engine Error: {str(e)}")
        if 'is_admin' in locals() and not is_admin:
            user_ref.update({
                "credits_used": admin_firestore.Increment(-action_cost),
                "generations_count": admin_firestore.Increment(-1)
            })
        
        status_code = 400 if "Safety Filter" in str(e) else 500
        return jsonify({"error": f"Generation failed: {str(e)}"}), status_code

@firestore_fn.on_document_created(document="users/{userId}")
def notify_new_user(event: firestore_fn.Event[firestore_fn.DocumentSnapshot | None]) -> None:
    if not ADMIN_WEBHOOK_URL:
        return

    new_data = event.data
    if new_data is None:
        return
        
    user_data = new_data.to_dict()
    email = user_data.get("email", "Unknown Email")
    display_name = user_data.get("display_name", "")
    name_line = f"\n**Producer:** `{display_name}`" if display_name else ""

    message = {
        "username": "Stride Engine",
        "content": f"🔥 **NEW PRODUCER ALERT**\nA new user has just registered to the engine:\n`{email}`{name_line}"
    }
    
    try:
        req = urllib.request.Request(
            ADMIN_WEBHOOK_URL, 
            data=json.dumps(message).encode('utf-8'), 
            headers={'Content-Type': 'application/json', 'User-Agent': 'Stride-Backend/1.0'}
        )
        urllib.request.urlopen(req, timeout=10)
    except Exception as e:
        pass