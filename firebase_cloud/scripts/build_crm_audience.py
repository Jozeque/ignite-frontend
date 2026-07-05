#!/usr/bin/env python3
"""Build a Resend recipient CSV from the CRM (Firestore waitlist) by status.

Default statuses = purchased,active,demo -- i.e. everyone who owns the VST plus
demo users. Dedups by email and applies the same status derivation as
admin.html (a row with no explicit status but source=lemonsqueezy counts as
purchased, so older orders are not missed).

    python build_crm_audience.py --out audience.csv --key sa.json
    python build_crm_audience.py --out audience.csv --statuses purchased,demo --key sa.json

NOTE: the CRM does not track refunds, so a few refunded buyers may be included.
For a refund-clean paid list, use the LS-based build_vst_audience.py instead.
Deps: pip install firebase-admin
"""
import argparse
import csv
from collections import Counter


def derive_status(d):
    s = (d.get("status") or "").strip()
    if s:
        return s
    if d.get("source") == "lemonsqueezy":
        return "purchased"
    if d.get("last_action") == "buyer_lead":
        return "abandoned_cart"
    return "new"


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--out", required=True)
    ap.add_argument("--statuses", default="purchased,active,demo",
                    help="comma-separated statuses to include")
    ap.add_argument("--key", help="Firebase service-account JSON (defaults to ADC).")
    args = ap.parse_args()

    import firebase_admin
    from firebase_admin import credentials, firestore
    if args.key:
        firebase_admin.initialize_app(credentials.Certificate(args.key))
    else:
        firebase_admin.initialize_app()
    db = firestore.client()

    want = {s.strip() for s in args.statuses.split(",") if s.strip()}
    seen = {}
    breakdown = Counter()
    for doc in db.collection("waitlist").stream():
        d = doc.to_dict()
        email = (d.get("email") or "").strip().lower()
        if not email or "@" not in email or email in seen:
            continue
        st = derive_status(d)
        if st in want:
            seen[email] = (d.get("name") or "").strip()
            breakdown[st] += 1

    with open(args.out, "w", newline="", encoding="utf-8") as f:
        w = csv.writer(f)
        w.writerow(["email", "name"])
        for e, n in sorted(seen.items()):
            w.writerow([e, n])

    print(f"Wrote {len(seen)} recipients (statuses={sorted(want)}) -> {args.out}")
    print("  breakdown: " + ", ".join(f"{k}={v}" for k, v in sorted(breakdown.items())))


if __name__ == "__main__":
    main()
