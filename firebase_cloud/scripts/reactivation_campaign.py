"""One-time Stride demo reactivation campaign.

Grants legacy demo users ONE extra 24-hour Discovery Pass so they can see the
Ableton Bridge. Separate cohort, separate events, separate kill switch.

THE CLOCK DOES NOT START HERE. This script only writes a grant and sends a mail
carrying a token. The 24 hours begin when the plugin consumes the claim, which
is handled server-side in _reactivation_mint.

STAGES, each explicit and each safe to run twice:
    --dry-run           count + identifiers, writes nothing, sends nothing
    --grant  --limit N  create grant docs + demo_reactivation_granted events
    --send   --limit N  mail the granted + demo_reactivation_email_sent events
    --status            where every grant currently stands

    python reactivation_campaign.py --dry-run
    python reactivation_campaign.py --grant --limit 25 --batch test-01
    python reactivation_campaign.py --send  --limit 25 --batch test-01
    python reactivation_campaign.py --send  --limit 25 --batch test-01 --live

Nothing sends without --live. Without it, --send prints the rendered mail for
the first recipient and stops.
"""
import argparse
import collections
import csv
import datetime
import hashlib
import io
import os
import secrets
import sys
import time

sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding="utf-8", errors="replace")

import firebase_admin
from firebase_admin import credentials, firestore

KEY = os.environ.get("GOOGLE_APPLICATION_CREDENTIALS",
                     r"C:\Users\Yossi\Downloads\veero-next-firebase-adminsdk-fbsvc-2ed18717ed.json")
IL = datetime.timezone(datetime.timedelta(hours=3))
COLL = "demo_reactivations"
EVENTS = "events"

# The Meta demo-acquisition campaign. Anyone whose funnel entry carries this is a
# NEW acquisition and must never be pulled into the legacy reactivation cohort.
META_CAMPAIGN_ID = os.environ.get("DEMO_ACQ_CAMPAIGN_ID", "120254058561820440")

# Configurable cutoff: only demos from BEFORE this moment are legacy. Defaults to
# the day the Meta campaign was built, so the two cohorts cannot overlap in time.
CUTOFF = os.environ.get("REACTIVATION_CUTOFF", "2026-08-25T00:00:00")

CLAIM_BASE = os.environ.get("REACTIVATION_LINK_BASE", "https://stridehub.io/try/")

SUBJECT = "I reopened Stride for you"

BODY = """Hey{name_part},

Joe here.

Stride has changed quite a bit since you tried it.

I just added a new Bridge that lets Stride connect directly to Ableton devices, alongside the VSTs you already use inside Stride.

It opens up a lot more possibilities, and I wanted people who tried the earlier version to actually experience it.

So I reopened a fresh 24-hour Discovery Pass for you.

Your 24 hours won't start until you activate it.

{link}

If you give it another go, I'd genuinely love to hear what you think.

Joe
Stride

You're receiving this because you tried Stride with a Discovery Pass. Reply STOP to opt out.
"""


def ekey(email):
    return hashlib.sha256((email or "").strip().lower().encode()).hexdigest()[:40]


def render(email, name, token):
    first = (name or "").strip().split(" ")[0] if name else ""
    return BODY.replace("{name_part}", f" {first}" if first else "") \
               .replace("{link}", f"{CLAIM_BASE}?react={token}")


def load(db):
    """Everything eligibility needs, in one pass over each collection."""
    raw = collections.defaultdict(list)
    for d in db.collection("waitlist").stream():
        r = d.to_dict() or {}
        em = (r.get("email") or "").strip().lower()
        if em:
            raw[em].append(r)

    def merge(rs):
        buy = [x for x in rs if x.get("purchased_at")]
        base = dict(sorted(buy or rs,
                           key=lambda x: x.get("updated_at") or x.get("created_at")
                           or datetime.datetime.min.replace(tzinfo=datetime.timezone.utc))[-1])
        for x in rs:
            for k in ("demo_at", "created_at"):
                if x.get(k) and (not base.get(k) or x[k] < base[k]):
                    base[k] = x[k]
            if x.get("last_action") == "buyer_lead":
                base["_chk"] = True
        return base

    people = {e: merge(rs) for e, rs in raw.items()}

    evs = collections.defaultdict(list)
    for d in db.collection(EVENTS).stream():
        r = d.to_dict() or {}
        em = (r.get("email") or "").strip().lower()
        if em:
            evs[em].append(r)

    supp = {x.strip().lower() for x in
            ((db.collection("config").document("email_suppression").get().to_dict() or {})
             .get("emails") or [])}
    grants = {d.id: (d.to_dict() or {}) for d in db.collection(COLL).stream()}
    return people, evs, supp, grants


def eligible(people, evs, supp, grants, cutoff):
    """THE ELIGIBILITY QUERY, in one place, every exclusion named.

    NOTE ON 'ACTIVATED': the spec asks for users who ACTIVATED a demo. That is not
    resolvable per-email for legacy users, because vst_passes is device-keyed and
    zero rows carry an email. DEMO TAKEN (waitlist.demo_at) is the only email-level
    signal that exists for this period, so it is what the cohort is built from.
    """
    out, rejected = [], collections.Counter()
    for em, r in people.items():
        demo_at = r.get("demo_at")
        if not demo_at:
            rejected["never took a demo"] += 1
            continue
        if r.get("purchased_at") or r.get("status") == "purchased":
            rejected["purchased"] += 1
            continue
        if demo_at.astimezone(IL) >= cutoff:
            rejected["demo after the cutoff"] += 1
            continue
        rows = evs.get(em, [])
        if any(r2.get("type") in ("demo_registered", "demo_downloaded")
               and str(r2.get("campaign_id") or "") == META_CAMPAIGN_ID for r2 in rows):
            rejected["belongs to the Meta cohort"] += 1
            continue
        if any(r2.get("type") == "purchase_completed" for r2 in rows):
            rejected["purchased (event log)"] += 1
            continue
        if r.get("_chk") or any(r2.get("type") == "checkout_started" for r2 in rows):
            rejected["in an open checkout state"] += 1
            continue
        if em in supp:
            rejected["opted out / suppressed"] += 1
            continue
        if ekey(em) in grants:
            rejected["already has a reactivation grant"] += 1
            continue
        out.append((em, (r.get("name") or "").strip(), demo_at.astimezone(IL)))
    out.sort(key=lambda x: x[2])
    return out, rejected


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--dry-run", action="store_true")
    ap.add_argument("--grant", action="store_true")
    ap.add_argument("--send", action="store_true")
    ap.add_argument("--status", action="store_true")
    ap.add_argument("--live", action="store_true", help="actually send (with --send)")
    ap.add_argument("--limit", type=int, default=0, help="0 = no limit")
    ap.add_argument("--batch", default="batch-1")
    ap.add_argument("--cutoff", default=CUTOFF)
    ap.add_argument("--csv", default="")
    args = ap.parse_args()
    if not any([args.dry_run, args.grant, args.send, args.status]):
        args.dry_run = True

    cutoff = datetime.datetime.fromisoformat(args.cutoff).replace(tzinfo=IL)
    if not firebase_admin._apps:
        firebase_admin.initialize_app(credentials.Certificate(KEY))
    db = firestore.client()

    print("=" * 74)
    print(" STRIDE DEMO REACTIVATION")
    print(f" cutoff {cutoff:%Y-%m-%d %H:%M} · batch {args.batch} · "
          f"limit {args.limit or 'none'}")
    print("=" * 74)

    if args.status:
        rows = [(d.id, d.to_dict() or {}) for d in db.collection(COLL).stream()]
        by = collections.Counter((r.get("status") or "?") for _, r in rows)
        print(f"\n grants: {len(rows)}")
        for k, v in by.most_common():
            print(f"   {k:<14} {v}")
        for _id, r in sorted(rows, key=lambda x: x[1].get("granted_at_ms") or 0)[:40]:
            em = r.get("email", "")
            mask = em[:3] + "***@" + em.split("@")[-1] if "@" in em else em
            print(f"   {mask:<40}{r.get('status',''):<12}{r.get('batch','')}")
        return 0

    people, evs, supp, grants = load(db)
    elig, rejected = eligible(people, evs, supp, grants, cutoff)

    print(f"\n EXCLUSIONS")
    for k, v in rejected.most_common():
        print(f"   {k:<36}{v}")
    print(f"\n ELIGIBLE: {len(elig)}")
    if elig:
        ages = [(datetime.datetime.now(IL) - d).days for _, _, d in elig]
        print(f"   demo age  min {min(ages)}d · median {sorted(ages)[len(ages)//2]}d "
              f"· max {max(ages)}d")
        print(f"   have a first name  {sum(1 for _, n, _ in elig if n)}/{len(elig)}")

    target = elig[:args.limit] if args.limit else elig

    if args.dry_run:
        print(f"\n DRY RUN. Would grant to {len(target)} of {len(elig)}.\n")
        print(f"   {'email':<44}{'name':<16}demo taken")
        for em, nm, d in target[:30]:
            mask = em[:3] + "***@" + em.split("@")[-1]
            print(f"   {mask:<44}{(nm or '-')[:14]:<16}{d:%Y-%m-%d}")
        if len(target) > 30:
            print(f"   ... and {len(target)-30} more")
        if args.csv:
            with open(args.csv, "w", newline="", encoding="utf-8") as f:
                w = csv.writer(f)
                w.writerow(["email", "name", "demo_at", "email_key"])
                for em, nm, d in target:
                    w.writerow([em, nm, d.isoformat(), ekey(em)])
            print(f"\n   full list written to {args.csv}")
        print("\n   SAMPLE MAIL")
        print("   " + "-" * 68)
        for line in render(target[0][0] if target else "x@y.z",
                           target[0][1] if target else "", "EXAMPLETOKEN").splitlines():
            print("   " + line)
        return 0

    if args.grant:
        made = 0
        for em, nm, d in target:
            k = ekey(em)
            if db.collection(COLL).document(k).get().exists:
                continue
            token = secrets.token_hex(16)
            now_ms = int(time.time() * 1000)
            try:
                db.collection(COLL).document(k).create({
                    "email": em, "name": nm, "token": token, "status": "granted",
                    "batch": args.batch, "granted_at_ms": now_ms,
                    "granted_at": firestore.SERVER_TIMESTAMP,
                    "source_demo_at": d,
                })
            except Exception as e:
                print(f"   skip {em}: {e}")
                continue
            db.collection(EVENTS).document(f"demo_reactivation_granted__{k}").set({
                "type": "demo_reactivation_granted", "email": em,
                "batch": args.batch, "ts_ms": now_ms,
                "ts": firestore.SERVER_TIMESTAMP,
            })
            made += 1
        print(f"\n GRANTED {made} new (batch {args.batch})")
        return 0

    if args.send:
        import resend
        api = os.environ.get("RESEND_API_KEY", "")
        pend = [(d.id, d.to_dict() or {}) for d in
                db.collection(COLL).where("batch", "==", args.batch).stream()]
        pend = [(k, r) for k, r in pend if r.get("status") == "granted"]
        pend = pend[:args.limit] if args.limit else pend
        print(f"\n {len(pend)} granted-not-yet-emailed in batch {args.batch}")
        if not pend:
            return 0
        if not args.live:
            k, r = pend[0]
            print("\n WOULD SEND (no --live). First recipient's exact mail:\n")
            print(f"   To:      {r.get('email')}")
            print(f"   Subject: {SUBJECT}")
            print("   " + "-" * 68)
            for line in render(r.get("email"), r.get("name"), r.get("token")).splitlines():
                print("   " + line)
            return 0
        if not api:
            sys.exit(" RESEND_API_KEY not set")
        resend.api_key = api
        sent = 0
        for k, r in pend:
            em = r.get("email")
            # last-moment re-check: purchase always wins
            fresh = db.collection(COLL).document(k).get().to_dict() or {}
            if fresh.get("status") != "granted":
                print(f"   skip {em}: status is now {fresh.get('status')}")
                continue
            try:
                resend.Emails.send({
                    "from": "Joe <home@stridehub.io>", "to": [em],
                    "reply_to": "home@stridehub.io", "subject": SUBJECT,
                    "text": render(em, r.get("name"), r.get("token")),
                })
                now_ms = int(time.time() * 1000)
                db.collection(COLL).document(k).update(
                    {"status": "emailed", "emailed_at_ms": now_ms,
                     "emailed_at": firestore.SERVER_TIMESTAMP})
                db.collection(EVENTS).document(f"demo_reactivation_email_sent__{k}").set({
                    "type": "demo_reactivation_email_sent", "email": em,
                    "batch": args.batch, "ts_ms": now_ms,
                    "ts": firestore.SERVER_TIMESTAMP,
                })
                sent += 1
                print(f"   sent {em}")
            except Exception as e:
                print(f"   FAILED {em}: {e}")
            time.sleep(0.6)
        print(f"\n SENT {sent}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
