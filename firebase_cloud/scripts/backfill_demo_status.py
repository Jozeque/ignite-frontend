#!/usr/bin/env python3
"""One-time backfill: correctly tag free-demo downloaders in the CRM.

The order_created webhook used to stamp status="purchased" on EVERY Lemon
Squeezy order, so free-demo downloads (product 1190710) looked like sales.
This walks LS orders -- the only complete history, because the CRM merges rows
by email and a later purchase overwrote the demo product id on the row -- and,
for every email that has at least one demo order:

  * sets demo_at = time of their earliest demo order
  * sets status  = "purchased" if they ALSO have a non-demo order (a
                   conversion), otherwise "demo".

Idempotent (safe to re-run). Dry-run by default; pass --send to write.

    LS_API_KEY=... python backfill_demo_status.py                     # dry run
    LS_API_KEY=... python backfill_demo_status.py --send              # apply
    LS_API_KEY=... python backfill_demo_status.py --send --key sa.json

Firebase creds: Application Default Credentials, or --key <service-account>.json.
Deps: pip install firebase-admin
"""
import argparse
import json
import os
import sys
import urllib.request
from datetime import datetime

STORE_ID = "336645"
DEMO_PRODUCT_ID = 1190710


def ls_get(url, key):
    req = urllib.request.Request(
        url, headers={"Authorization": f"Bearer {key}", "Accept": "application/vnd.api+json"})
    with urllib.request.urlopen(req, timeout=30) as r:
        return json.load(r)


def fetch_orders(key):
    orders = []
    url = f"https://api.lemonsqueezy.com/v1/orders?filter[store_id]={STORE_ID}&page[size]=100"
    while url:
        d = ls_get(url, key)
        orders.extend(d.get("data", []))
        url = (d.get("links") or {}).get("next")
    return orders


def parse_iso(s):
    if not s:
        return None
    try:
        return datetime.fromisoformat(s.replace("Z", "+00:00"))
    except Exception:
        return None


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--send", action="store_true", help="Apply writes (default: dry-run).")
    ap.add_argument("--key", help="Firebase service-account JSON path (defaults to ADC).")
    args = ap.parse_args()

    ls_key = os.environ.get("LS_API_KEY")
    if not ls_key:
        print("ERROR: set LS_API_KEY in the environment.")
        sys.exit(1)

    orders = fetch_orders(ls_key)
    print(f"Scanned {len(orders)} LS orders.")

    # email -> {"demo_at": earliest ISO str | None, "has_purchase": bool}
    agg = {}
    for o in orders:
        a = o.get("attributes") or {}
        foi = a.get("first_order_item") or {}
        email = (a.get("user_email") or "").lower().strip()
        if not email:
            continue
        created = a.get("created_at") or ""
        e = agg.setdefault(email, {"demo_at": None, "has_purchase": False})
        if foi.get("product_id") == DEMO_PRODUCT_ID:
            if e["demo_at"] is None or (created and created < e["demo_at"]):
                e["demo_at"] = created  # ISO 8601 sorts chronologically as text
        else:
            e["has_purchase"] = True

    demo_emails = {em: v for em, v in agg.items() if v["demo_at"]}
    converted = sum(1 for v in demo_emails.values() if v["has_purchase"])
    print(f"Demo downloaders: {len(demo_emails)}  |  of them also purchased (converted): {converted}")
    if not demo_emails:
        print("Nothing to backfill.")
        return

    import firebase_admin
    from firebase_admin import credentials, firestore
    if args.key:
        firebase_admin.initialize_app(credentials.Certificate(args.key))
    else:
        firebase_admin.initialize_app()
    db = firestore.client()

    updated = created_new = 0
    for email, v in sorted(demo_emails.items()):
        status = "purchased" if v["has_purchase"] else "demo"
        demo_dt = parse_iso(v["demo_at"])
        found = list(db.collection("waitlist").where("email", "==", email).limit(1).stream())
        if found:
            # status comes from LS (has_purchase), NOT the existing row. The old
            # webhook wrongly stamped BOTH status=purchased AND purchased_at on
            # the $0 demo order, so the current row can't be trusted -- that is
            # exactly the bug we are fixing. LS is authoritative for "did they
            # ever actually buy something".
            update = {
                "demo_at": demo_dt,
                "status": status,
                "updated_at": firestore.SERVER_TIMESTAMP,
            }
            if status == "demo":
                # Remove the bogus purchased_at the old webhook set on the demo,
                # so a demo-only lead is never shown as a dated purchase.
                update["purchased_at"] = firestore.DELETE_FIELD
            print(f"  {'WRITE ' if args.send else 'DRY   '} {email:<38} -> {status:<10} demo_at={v['demo_at']}")
            if args.send:
                found[0].reference.update(update)
            updated += 1
        else:
            print(f"  {'CREATE' if args.send else 'DRY-C '} {email:<38} -> {status:<10} (no CRM row yet)")
            if args.send:
                db.collection("waitlist").add({
                    "email": email,
                    "name": "",
                    "demo_at": demo_dt,
                    "status": status,
                    "created_at": firestore.SERVER_TIMESTAMP,
                    "updated_at": firestore.SERVER_TIMESTAMP,
                })
            created_new += 1

    print(f"\n{'APPLIED' if args.send else 'DRY RUN (no writes)'}: "
          f"rows updated={updated}, created={created_new}, converted={converted}")


if __name__ == "__main__":
    main()
