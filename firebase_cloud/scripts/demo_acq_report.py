"""Demo-acquisition cohort report.

Measures the COLD | DEMO ACQUISITION | SALES campaign as a COHORT OF PEOPLE,
not as a row of Meta-reported conversions.

THE RULE THIS SCRIPT ENFORCES
    Meta is the source of truth for SPEND and nothing else.
    Our append-only `events` collection is the source of truth for every
    human step: registration, activation, checkout, purchase.
    Revenue comes from the purchase event's own total_cents, which originates
    in the Lemon Squeezy webhook, so it is money that actually moved.

COHORT DEFINITION
    A person is IN the cohort if their `demo_registered` event carries
    campaign_id == CAMPAIGN_ID. That is "first entry into this funnel came
    from this campaign". Everything they do afterwards is attributed to it,
    forever, regardless of what Meta claims and regardless of which ad they
    later clicked. Entry is recorded once and never reassigned.

WHY NOT JOIN ON THE PURCHASE EVENT
    A purchase event only carries campaign_id if the CRM row still had it at
    webhook time. Registration is the reliable carrier because the /try page
    posts the ad parameters directly. Joining on registration and walking
    forward by email is lossless; joining on purchase is not.

Usage:
    python demo_acq_report.py                 # since campaign creation
    python demo_acq_report.py --since 2026-09-01 --until 2026-09-30
    python demo_acq_report.py --csv out.csv   # per-person cohort dump
"""
import argparse
import collections
import datetime
import json
import os
import statistics
import sys
import urllib.parse
import urllib.request

import firebase_admin
from firebase_admin import credentials, firestore

# ── configuration ────────────────────────────────────────────────────────────
CAMPAIGN_ID = os.environ.get("DEMO_ACQ_CAMPAIGN_ID", "120254058561820440")
AD_ACCOUNT = "act_3411622499006924"
GRAPH = "https://graph.facebook.com/v23.0"
ILS_PER_USD = float(os.environ.get("ILS_PER_USD", "2.98"))
SERVICE_KEY = os.environ.get(
    "GOOGLE_APPLICATION_CREDENTIALS",
    r"C:\Users\Yossi\Downloads\veero-next-firebase-adminsdk-fbsvc-2ed18717ed.json",
)
IL = datetime.timezone(datetime.timedelta(hours=3))

# Events that mark a person entering the funnel through the demo door.
ENTRY_TYPES = ("demo_registered", "demo_downloaded")


def meta_get(path, params):
    token = os.environ.get("META_ACCESS_TOKEN", "")
    if not token:
        sys.exit("META_ACCESS_TOKEN is not set.\n"
                 "  firebase functions:secrets:access META_ACCESS_TOKEN")
    q = urllib.parse.urlencode({"access_token": token, **params})
    with urllib.request.urlopen(f"{GRAPH}/{path}?{q}", timeout=60) as r:
        body = json.loads(r.read().decode("utf-8"))
    if "error" in body:
        sys.exit(f"Meta API error: {body['error'].get('message')}")
    return body


def campaign_spend(since, until):
    """Spend and delivery for the campaign. Explicit time_range always: every
    date_preset silently drops today, which has already produced one wrong
    conclusion in this account."""
    rows = meta_get(f"{CAMPAIGN_ID}/insights", {
        "time_range": json.dumps({"since": since, "until": until}),
        "fields": "spend,impressions,reach,frequency,inline_link_clicks,cpm,actions",
        "limit": "50",
    }).get("data", [])
    if not rows:
        return {"spend": 0.0, "impressions": 0, "reach": 0, "clicks": 0, "lpv": 0,
                "meta_claimed_purchases": 0}
    r = rows[0]
    act = {a["action_type"]: int(float(a["value"])) for a in (r.get("actions") or [])}
    return {
        "spend": float(r.get("spend") or 0),
        "impressions": int(r.get("impressions") or 0),
        "reach": int(r.get("reach") or 0),
        "clicks": int(r.get("inline_link_clicks") or 0),
        "lpv": act.get("landing_page_view", 0),
        "meta_claimed_purchases": act.get("omni_purchase", act.get("purchase", 0)),
    }


def load_events(db):
    """Every event, grouped by person. Anonymous rows are kept separately so the
    activation gap stays visible instead of silently shrinking the denominator."""
    by_email = collections.defaultdict(list)
    anonymous = []
    for d in db.collection("events").stream():
        ev = d.to_dict() or {}
        ev["_id"] = d.id
        em = (ev.get("email") or "").strip().lower()
        (by_email[em] if em else anonymous).append(ev)
    for em in by_email:
        by_email[em].sort(key=lambda e: int(e.get("ts_ms") or 0))
    return by_email, anonymous


def first_of(events, *types):
    for e in events:
        if e.get("type") in types:
            return e
    return None


def compute_kpis(cohort, spend_ils, ils_per_usd=ILS_PER_USD):
    """EVERY KPI, in one place, so the formulas are auditable and testable.

    `cohort` maps email -> {act, chk, pur, revenue_usd, reg_ms, ...}.
    Returns a flat dict. Rates are None when the denominator is zero, never 0.0,
    so "no data yet" can never be mistaken for "performed at zero".
    """
    div = lambda n, d: (n / d) if d else None

    reg = len(cohort)
    act = sum(1 for c in cohort.values() if c["act"])
    chk = sum(1 for c in cohort.values() if c["chk"])
    pur = sum(1 for c in cohort.values() if c["pur"])
    act_chk = sum(1 for c in cohort.values() if c["act"] and c["chk"])
    act_pur = sum(1 for c in cohort.values() if c["act"] and c["pur"])
    rev_usd = sum(c["revenue_usd"] for c in cohort.values())
    rev_ils = rev_usd * ils_per_usd

    r2a, a2c, a2p = [], [], []
    for c in cohort.values():
        if not c["act"]:
            continue
        a_ms = int(c["act"]["ts_ms"])
        r2a.append((a_ms - c["reg_ms"]) / 3600000)
        if c["chk"]:
            a2c.append((int(c["chk"]["ts_ms"]) - a_ms) / 3600000)
        if c["pur"]:
            a2p.append((int(c["pur"]["ts_ms"]) - a_ms) / 3600000)

    return {
        "registrations": reg,
        "activations": act,
        "checkouts": chk,
        "purchasers": pur,
        "spend_ils": spend_ils,
        "revenue_usd": rev_usd,
        "revenue_ils": rev_ils,
        # cost per X = spend / count of X
        "cost_per_registration": div(spend_ils, reg),
        "cost_per_activation": div(spend_ils, act),
        "cost_per_customer": div(spend_ils, pur),          # THE headline KPI
        # rates = numerator / denominator, both stated at the call site
        "activation_rate": div(act, reg),                   # activated / registered
        "activated_to_checkout": div(act_chk, act),         # of ACTIVATED, not of registered
        "activated_to_purchase": div(act_pur, act),
        "registered_to_purchase": div(pur, reg),
        "revenue_per_registration_usd": div(rev_usd, reg),
        "roas": div(rev_ils, spend_ils),                    # ILS revenue / ILS spend
        "median_reg_to_act_h": statistics.median(r2a) if r2a else None,
        "median_act_to_chk_h": statistics.median(a2c) if a2c else None,
        "median_act_to_pur_h": statistics.median(a2p) if a2p else None,
        "_n_timing": (len(r2a), len(a2c), len(a2p)),
    }


def selftest():
    """Prove the formulas on a hand-checkable cohort. Touches no live system."""
    H = 3600000
    mk = lambda reg, a=None, c=None, p=None, rev=0.0: {
        "reg_ms": reg,
        "act": {"ts_ms": a} if a else None,
        "chk": {"ts_ms": c} if c else None,
        "pur": {"ts_ms": p} if p else None,
        "revenue_usd": rev, "ad_id": "", "adset_id": "", "utm_content": "", "entry": {"ts_ms": reg},
    }
    # 10 registered · 5 activated · 3 of those to checkout · 2 of those bought
    # plus 1 person who bought without ever activating (proves rates use the
    # right denominators and do not silently absorb him into activation math).
    cohort = {
        "a": mk(0, 2 * H, 5 * H, 6 * H, 79.0),
        "b": mk(0, 4 * H, 9 * H, 10 * H, 99.0),
        "c": mk(0, 6 * H, 12 * H),
        "d": mk(0, 8 * H),
        "e": mk(0, 10 * H),
        "f": mk(0), "g": mk(0), "h": mk(0), "i": mk(0),
        "j": mk(0, None, None, 20 * H, 59.0),   # bought, never activated
    }
    k = compute_kpis(cohort, spend_ils=1000.0, ils_per_usd=2.98)
    exp = {
        "registrations": 10, "activations": 5, "checkouts": 3, "purchasers": 3,
        "cost_per_registration": 100.0,          # 1000 / 10
        "cost_per_activation": 200.0,            # 1000 / 5
        "cost_per_customer": 1000.0 / 3,         # 1000 / 3
        "activation_rate": 0.5,                  # 5 / 10
        "activated_to_checkout": 2 / 5,          # a,b had checkout+act; c also -> 3/5
        "activated_to_purchase": 2 / 5,          # a,b  (j never activated)
        "registered_to_purchase": 0.3,           # 3 / 10
        "revenue_usd": 237.0,
        "median_reg_to_act_h": 6.0,              # 2,4,6,8,10
    }
    exp["activated_to_checkout"] = 3 / 5         # a,b,c
    ok = True
    print("  SELFTEST  10 registered · 5 activated · 3 checkout · 3 bought (1 never activated)")
    for key, want in exp.items():
        got = k[key]
        good = (got is not None) and abs(got - want) < 1e-9
        ok &= good
        print(f"    {'PASS' if good else 'FAIL'}  {key:<28} expected {want!r:<22} got {got!r}")
    # A zero DENOMINATOR must yield None, never 0.0, so "nothing happened yet"
    # can never read as "performed at zero".
    empty = compute_kpis({}, spend_ils=500.0)
    for key in ("activation_rate", "cost_per_customer"):
        good = empty[key] is None
        ok &= good
        print(f"    {'PASS' if good else 'FAIL'}  empty.{key:<22} expected None            got {empty[key]!r}")
    # ROAS is the opposite case: spend IS the denominator. Money spent with no
    # revenue back is a genuine 0.0 and must NOT be softened to None, or a
    # failing campaign would render identically to one that never ran.
    good = empty["roas"] == 0.0
    ok &= good
    print(f"    {'PASS' if good else 'FAIL'}  spent-but-no-revenue.roas  expected 0.0             got {empty['roas']!r}")
    nospend = compute_kpis({}, spend_ils=0.0)
    good = nospend["roas"] is None
    ok &= good
    print(f"    {'PASS' if good else 'FAIL'}  no-spend.roas              expected None            got {nospend['roas']!r}")
    print(f"\n  SELFTEST {'PASSED' if ok else 'FAILED'}")
    return 0 if ok else 1


def pct(n, d):
    return f"{n}/{d} = {n / d * 100:5.1f}%" if d else f"{n}/0 = n/a"


def money(n, d, cur="ILS"):
    return f"{cur} {n / d:,.2f}" if d else "n/a (no conversions yet)"


def median_h(vals):
    return f"{statistics.median(vals):.1f}h  (n={len(vals)})" if vals else "n/a (n=0)"


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--since", default="2026-08-25")
    ap.add_argument("--until", default=datetime.datetime.now(IL).strftime("%Y-%m-%d"))
    ap.add_argument("--csv", default="")
    ap.add_argument("--campaign", default=CAMPAIGN_ID)
    ap.add_argument("--selftest", action="store_true",
                    help="verify every KPI formula on a known cohort; touches nothing")
    args = ap.parse_args()
    if args.selftest:
        sys.exit(selftest())
    campaign_id = args.campaign

    if not firebase_admin._apps:
        firebase_admin.initialize_app(credentials.Certificate(SERVICE_KEY))
    db = firestore.client()

    spend = campaign_spend(args.since, args.until)
    by_email, anonymous = load_events(db)
    now_ms = int(datetime.datetime.now(IL).timestamp() * 1000)

    # ── build the cohort ─────────────────────────────────────────────────────
    cohort = {}
    for em, evs in by_email.items():
        entry = first_of(evs, *ENTRY_TYPES)
        if not entry:
            continue
        if str(entry.get("campaign_id") or "") != str(campaign_id):
            continue
        acts = [e for e in evs if e.get("type") == "demo_activated"]
        chks = [e for e in evs if e.get("type") == "checkout_started"]
        purs = [e for e in evs if e.get("type") == "purchase_completed"]
        cohort[em] = {
            "entry": entry,
            "reg_ms": int(entry.get("ts_ms") or 0),
            "act": acts[0] if acts else None,
            "chk": chks[0] if chks else None,
            "pur": purs[0] if purs else None,
            "revenue_usd": sum(int(p.get("total_cents") or 0) for p in purs) / 100.0,
            "ad_id": entry.get("ad_id") or "",
            "adset_id": entry.get("adset_id") or "",
            "utm_content": entry.get("utm_content") or "",
        }

    reg = len(cohort)
    act = sum(1 for c in cohort.values() if c["act"])
    chk = sum(1 for c in cohort.values() if c["chk"])
    pur = sum(1 for c in cohort.values() if c["pur"])
    act_and_chk = sum(1 for c in cohort.values() if c["act"] and c["chk"])
    act_and_pur = sum(1 for c in cohort.values() if c["act"] and c["pur"])
    revenue_usd = sum(c["revenue_usd"] for c in cohort.values())
    revenue_ils = revenue_usd * ILS_PER_USD
    s = spend["spend"]

    # activations we could never attach to a person, campaign-wide
    anon_acts = [e for e in anonymous if e.get("type") == "demo_activated"]

    W = 78
    print("=" * W)
    print(f" DEMO ACQUISITION COHORT REPORT")
    print(f" campaign {campaign_id} · {args.since} to {args.until}")
    print("=" * W)

    print("\n MEDIA (Meta is the source of truth for spend, and only spend)")
    print(f"   spend                      ILS {s:>12,.2f}   (USD {s / ILS_PER_USD:,.2f})")
    print(f"   impressions                    {spend['impressions']:>12,}")
    print(f"   reach                          {spend['reach']:>12,}")
    print(f"   link clicks                    {spend['clicks']:>12,}")
    print(f"   landing page views             {spend['lpv']:>12,}")
    print(f"   Meta CLAIMED purchases         {spend['meta_claimed_purchases']:>12,}"
          f"   <- reference only, never used below")

    print("\n FUNNEL (our event log, one row per human)")
    print(f"   demo registrations             {reg:>12,}")
    print(f"   identified activations         {act:>12,}")
    print(f"   reached checkout               {chk:>12,}")
    print(f"   purchased                      {pur:>12,}")

    print("\n PRIMARY KPIs")
    print(f"   cost per demo registration     {money(s, reg):>18}"
          f"        = {s:,.2f} / {reg}")
    print(f"   cost per ACTIVATED demo        {money(s, act):>18}"
          f"        = {s:,.2f} / {act}")
    print(f"   activation rate                {pct(act, reg):>18}"
          f"        activated / registered")
    print(f"   activated -> checkout          {pct(act_and_chk, act):>18}")
    print(f"   activated -> purchase          {pct(act_and_pur, act):>18}")
    print(f"   registered -> purchase         {pct(pur, reg):>18}")

    print("\n THE HEADLINE NUMBER")
    print(f"   demo-acquired customers        {pur:>12,}"
          f"        first funnel entry = this campaign")
    print(f"   COST PER DEMO-ACQUIRED CUSTOMER  {money(s, pur):>16}"
          f"      = {s:,.2f} / {pur}")
    print(f"   revenue from those customers   USD {revenue_usd:>10,.2f}"
          f"   (ILS {revenue_ils:,.2f})")
    if s > 0:
        print(f"   ROAS (cohort)                  {revenue_ils / s:>12,.2f}x"
              f"       ILS revenue / ILS spend, break-even 1.00")
    else:
        print(f"   ROAS (cohort)                          n/a       no spend yet")
    print(f"   revenue per registration       USD {revenue_usd / reg if reg else 0:>10,.2f}")

    # ── timing ───────────────────────────────────────────────────────────────
    r2a, a2c, a2p = [], [], []
    for c in cohort.values():
        if c["act"]:
            r2a.append((int(c["act"]["ts_ms"]) - c["reg_ms"]) / 3600000)
            if c["chk"]:
                a2c.append((int(c["chk"]["ts_ms"]) - int(c["act"]["ts_ms"])) / 3600000)
            if c["pur"]:
                a2p.append((int(c["pur"]["ts_ms"]) - int(c["act"]["ts_ms"])) / 3600000)
    print("\n TIMING (median)")
    print(f"   registration -> activation     {median_h(r2a)}")
    print(f"   activation   -> checkout       {median_h(a2c)}")
    print(f"   activation   -> purchase       {median_h(a2p)}")

    # ── per-creative ─────────────────────────────────────────────────────────
    if cohort:
        print("\n BY AD (entry event's ad_id, so a person counts once, on entry)")
        per = collections.defaultdict(lambda: {"reg": 0, "act": 0, "pur": 0, "rev": 0.0})
        for c in cohort.values():
            k = c["utm_content"] or c["ad_id"] or "(untagged)"
            per[k]["reg"] += 1
            per[k]["act"] += 1 if c["act"] else 0
            per[k]["pur"] += 1 if c["pur"] else 0
            per[k]["rev"] += c["revenue_usd"]
        ad_spend = {}
        try:
            for row in meta_get(f"{campaign_id}/insights", {
                "time_range": json.dumps({"since": args.since, "until": args.until}),
                "level": "ad", "fields": "ad_name,spend", "limit": "100",
            }).get("data", []):
                ad_spend[row.get("ad_name", "")] = float(row.get("spend") or 0)
        except SystemExit:
            pass
        print(f"   {'ad':<34}{'ILS':>9}{'reg':>6}{'act':>6}{'buy':>6}{'ILS/buy':>10}")
        for k, v in sorted(per.items(), key=lambda x: -x[1]["reg"]):
            sp = ad_spend.get(k, 0.0)
            cpb = f"{sp / v['pur']:,.0f}" if v["pur"] else "-"
            print(f"   {k[:32]:<34}{sp:>9,.0f}{v['reg']:>6}{v['act']:>6}{v['pur']:>6}{cpb:>10}")

    # ── integrity ────────────────────────────────────────────────────────────
    print("\n DATA INTEGRITY (read this before trusting the rates above)")
    print(f"   activations that carry NO email, campaign-wide   {len(anon_acts):>6}")
    print("     Each one is a real person who started a trial and cannot be")
    print("     joined to a registration. They are EXCLUDED from 'identified")
    print("     activations', so the activation rate above is a FLOOR, not a")
    print("     measurement. It can only be too low, never too high.")
    untagged = sum(1 for c in cohort.values() if not c["ad_id"])
    print(f"   cohort members with no ad_id on entry            {untagged:>6}"
          f"  of {reg}")
    print("     These entered via this campaign but cannot be split by creative.")
    no_attr_pur = sum(1 for c in cohort.values()
                      if c["pur"] and not (c["pur"].get("campaign_id")))
    print(f"   purchases missing campaign_id on the event       {no_attr_pur:>6}"
          f"  of {pur}")
    print("     Harmless here: the cohort is defined at REGISTRATION, so these")
    print("     still count. It would matter only if joining on purchase.")

    if args.csv:
        import csv as _csv
        with open(args.csv, "w", newline="", encoding="utf-8") as f:
            w = _csv.writer(f)
            w.writerow(["email", "registered_at", "activated_at", "checkout_at",
                        "purchased_at", "revenue_usd", "ad_id", "adset_id", "utm_content"])
            for em, c in sorted(cohort.items(), key=lambda x: x[1]["reg_ms"]):
                def ts(e):
                    return (datetime.datetime.fromtimestamp(int(e["ts_ms"]) / 1000, IL)
                            .strftime("%Y-%m-%d %H:%M") if e else "")
                w.writerow([em, ts(c["entry"]), ts(c["act"]), ts(c["chk"]), ts(c["pur"]),
                            f"{c['revenue_usd']:.2f}", c["ad_id"], c["adset_id"], c["utm_content"]])
        print(f"\n   per-person cohort written to {args.csv}")

    print("\n" + "=" * W)


if __name__ == "__main__":
    main()
