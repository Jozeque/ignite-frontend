#!/usr/bin/env python3
"""Build the eligible audience for the free Stride VST upgrade, straight from
Lemon Squeezy orders (the source of truth for who PAID and who REFUNDED).

ELIGIBLE = an order that is:
  * status 'paid'      (not pending / failed),
  * total > 0          (so it is NOT a 100%-off / free order),
  * NOT refunded       (skips refunded + partially-refunded),
  * for the StrideLink product.

This is exactly the "paying customers, minus refunds, minus 100%-off" list.
Deduped by email. Output CSV columns: email,name  -> feed to send_vst_codes.py --recipients.

Usage:
  export LS_API_KEY="<a FRESH temp LS API key>"        # PowerShell: $env:LS_API_KEY="..."
  python build_vst_audience.py --out eligible-vst-audience.csv
Optional:
  --product-id 973706   StrideLink product id (repeat the flag for multiple SKUs; default 973706)
  --store-id  336645
"""
import argparse
import csv
import json
import os
import sys
import urllib.request

ORDERS = "https://api.lemonsqueezy.com/v1/orders"


def _get(url, key):
    req = urllib.request.Request(url, headers={
        "Authorization": f"Bearer {key}",
        "Accept": "application/vnd.api+json",
    })
    with urllib.request.urlopen(req, timeout=30) as r:
        return json.loads(r.read().decode("utf-8"))


def main():
    p = argparse.ArgumentParser()
    p.add_argument("--out", default="eligible-vst-audience.csv")
    p.add_argument("--store-id", default="336645")
    p.add_argument("--product-id", action="append", help="StrideLink product id(s). Default: 973706.")
    args = p.parse_args()

    key = os.environ.get("LS_API_KEY", "").strip()
    if not key:
        print('ERROR: set LS_API_KEY (a fresh temp LS API key). Do NOT hardcode it.')
        sys.exit(1)
    product_ids = {str(x) for x in (args.product_id or ["973706"])}

    eligible = {}   # email -> name
    exc = {"refunded": 0, "free_100pct": 0, "unpaid": 0, "other_product": 0, "no_email": 0}
    scanned = 0
    url = f"{ORDERS}?filter[store_id]={args.store_id}&page[size]=100&page[number]=1"

    while url:
        data = _get(url, key)
        for o in data.get("data", []):
            scanned += 1
            a = o.get("attributes", {})
            foi = a.get("first_order_item") or {}
            pid = str(foi.get("product_id") or "")
            status = a.get("status")
            total = a.get("total") or 0
            refunded = bool(a.get("refunded"))
            email = (a.get("user_email") or "").strip().lower()
            name = (a.get("user_name") or "").strip()

            if pid not in product_ids:
                exc["other_product"] += 1; continue
            if refunded or status in ("refunded", "partial_refunded"):
                exc["refunded"] += 1; continue
            if status != "paid":
                exc["unpaid"] += 1; continue
            if total <= 0:
                exc["free_100pct"] += 1; continue          # <-- 100%-off / free orders dropped here
            if not email:
                exc["no_email"] += 1; continue
            eligible.setdefault(email, name)
        url = (data.get("links") or {}).get("next")

    with open(args.out, "w", newline="", encoding="utf-8") as f:
        w = csv.writer(f)
        w.writerow(["email", "name"])
        for e, n in eligible.items():
            w.writerow([e, n])

    print(f"Scanned {scanned} store orders.")
    print(f"Excluded -> refunded:{exc['refunded']}  100%-off:{exc['free_100pct']}  "
          f"unpaid:{exc['unpaid']}  other-product:{exc['other_product']}  no-email:{exc['no_email']}")
    print(f"ELIGIBLE (paid, not refunded, StrideLink): {len(eligible)}  ->  {args.out}")


if __name__ == "__main__":
    main()
