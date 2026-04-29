#!/usr/bin/env python3
"""One-shot mailer for the v1.0.1 update announcement.

Reads paying customers from Firestore (`waitlist` collection where status
== "purchased" or source == "lemonsqueezy"), then sends each one a
personalized plain-text email via Resend — same `home@stridehub.io`
sender as the welcome email, so DKIM/SPF/DMARC are already in place.

Usage:
  # 1. Preview what would be sent — NO emails actually go out:
  python send_update_email.py --dry-run

  # 2. Smoke-test against your own inbox before mass-sending:
  python send_update_email.py --send --only you+test@gmail.com

  # 3. Real blast (asks for confirmation):
  python send_update_email.py --send

Optional flags:
  --limit N         Process only first N recipients (sorted by purchase)
  --throttle SEC    Seconds between sends (default 0.6 = ~100/min)
  --key path.json   Firebase service-account key path. Defaults to ADC
                    (gcloud auth application-default login).

Requirements (one-time install):
  pip install firebase-admin resend

Environment:
  RESEND_API_KEY  same key Firebase uses for the welcome email — set
                  it locally or run `firebase functions:secrets:access
                  RESEND_API_KEY` to copy the value.
"""

import argparse
import os
import sys
import time

SUBJECT = "Stride update — drag fixes, recent generations dock, walkthrough videos coming"

BODY_TEMPLATE = """\
Hey{name_part},

Pushed an update today. A few real bug fixes from the first round of feedback, plus a small new feature for faster iteration.

WHAT'S NEW
- Recent generations dock at the bottom of the canvas — your last 5 .alc files always visible, drag any of them straight into Ableton. Newest one gets a subtle LED glow on its border so you always know which is fresh.
- Filenames now lead with the rack name and end with _Stride.alc (was Stride_<rack>...). Way easier to scan your downloads folder.

WHAT'S FIXED
- Templates dropped into ANY User Library subfolder now register — previously only the top-level User Library root worked.
- "Open Canvas" in StrideLink works even when Stride is hidden behind Ableton (used to silently do nothing).
- Re-dragging a clip with the same filename now refreshes the template (used to be silently swallowed).
- Templates dropped before Stride was open are now caught when you click Scan Mapped.
- Mac users with a leftover Documents/Ableton folder now correctly read from Music/Ableton (the real default).

TO UPDATE (3 minutes)
1. Find your original Stride purchase email from Lemon Squeezy and click the Download button — it now serves the new build automatically. (No re-purchase, no new payment — same link, new file.)
2. Quit Ableton AND Stride.
3. Replace your Stride folder — extract the new zip over the old folder, or delete the old one and extract fresh.
4. Open the new Stride and let it activate (your license carries over).
5. Click "Install to Ableton" in the top toolbar — this overwrites the M4L files in your User Library with the new code.
6. In Ableton: right-click StrideLink on your track -> Delete -> drag a fresh StrideLink from User Library -> Stride.

That last step is the one most people skip — Ableton holds the old M4L bridge in memory, so you have to delete-and-redrag to load the new one. Without it, you'll have the new Stride.exe but the old M4L code keeps running.

Your canvas saves, sessions, and license all carry over through the update.

WHAT'S COMING
I'm putting together a series of workflow videos on YouTube — tips, inspiration, and the way I actually use Stride to generate massive sound variation in minimum time. Subscribe so you catch them as they drop:
https://www.youtube.com/@strideengine

Reply if anything misbehaves — I'm watching the inbox.

Best regards,
Joe
"""


def init_firestore(key_path):
    """Initialise Firebase Admin SDK. Uses a service-account key file if
    provided, otherwise falls back to Application Default Credentials.
    """
    import firebase_admin
    from firebase_admin import credentials
    if firebase_admin._apps:
        return
    if key_path:
        cred = credentials.Certificate(key_path)
        firebase_admin.initialize_app(cred)
    else:
        firebase_admin.initialize_app()


def fetch_customers():
    """Pull paying customers from Firestore. Dedupes by email so a row
    that matches both `status==purchased` and `source==lemonsqueezy`
    only sends once.
    """
    from firebase_admin import firestore as admin_firestore
    db = admin_firestore.client()

    seen = {}

    def _add(doc):
        data = doc.to_dict() or {}
        email = (data.get("email") or "").strip().lower()
        name = (data.get("name") or "").strip()
        if not email or email in seen:
            return
        seen[email] = {"email": email, "name": name, "id": doc.id}

    # Primary signal: explicit purchased status.
    for d in db.collection("waitlist").where("status", "==", "purchased").stream():
        _add(d)
    # Fallback: anyone whose row was written by the LS webhook, in case
    # status got overridden manually (contacted / churned) but they're
    # still actual buyers we should notify about updates.
    for d in db.collection("waitlist").where("source", "==", "lemonsqueezy").stream():
        _add(d)

    return list(seen.values())


def render_body(name):
    first_name = (name or "").strip().split(" ")[0] if name else ""
    name_part = f" {first_name}" if first_name else ""
    return BODY_TEMPLATE.format(name_part=name_part)


def send_one(resend_module, email, body):
    try:
        result = resend_module.Emails.send({
            "from": "Joe <home@stridehub.io>",
            "to": [email],
            "reply_to": "home@stridehub.io",
            "subject": SUBJECT,
            "text": body,
        })
        rid = result.get("id") if isinstance(result, dict) else str(result)
        return True, rid
    except Exception as e:
        return False, str(e)


def main():
    parser = argparse.ArgumentParser(description="Mass-send Stride update email via Resend.")
    mode = parser.add_mutually_exclusive_group(required=True)
    mode.add_argument("--dry-run", action="store_true", help="Preview list + sample email, send nothing.")
    mode.add_argument("--send", action="store_true", help="Actually send the emails.")
    parser.add_argument("--limit", type=int, help="Stop after N recipients (smoke testing).")
    parser.add_argument("--throttle", type=float, default=0.6, help="Seconds between sends.")
    parser.add_argument("--only", help="Override recipient list with this single email (for self-tests).")
    parser.add_argument("--key", help="Path to Firebase service-account JSON. Defaults to ADC.")
    args = parser.parse_args()

    if args.send and not os.environ.get("RESEND_API_KEY"):
        print("ERROR: RESEND_API_KEY env var not set. Run:")
        print('  export RESEND_API_KEY="$(firebase functions:secrets:access RESEND_API_KEY 2>/dev/null | tail -1)"')
        sys.exit(1)

    if args.only:
        customers = [{"email": args.only.strip().lower(), "name": "Tester", "id": "self-test"}]
    else:
        print("Connecting to Firestore...")
        init_firestore(args.key)
        print("Fetching paying customers...")
        customers = fetch_customers()

    if args.limit:
        customers = customers[: args.limit]

    print(f"Found {len(customers)} unique recipient(s).\n")

    # Always show the recipient list and a sample email so the operator
    # can sanity-check before any sends go out.
    print("─── Recipient list ───")
    for c in customers:
        print(f"  {c['email']:<42} {c['name'] or '(no name)'}")
    print()

    if customers:
        sample = customers[0]
        print("─── Sample email (rendered for first recipient) ───")
        print(f"From:    Joe <home@stridehub.io>")
        print(f"To:      {sample['email']}")
        print(f"Subject: {SUBJECT}")
        print()
        print(render_body(sample["name"]))
        print("───────────────────────────────────────────────")
        print()

    if args.dry_run:
        print(f"Dry-run only. Would send {len(customers)} email(s). Re-run with --send to actually send.")
        return

    # Real send. Final manual confirmation so we can't blast by accident.
    confirm = input(f"Send to {len(customers)} recipient(s)? Type 'SEND' to confirm: ").strip()
    if confirm != "SEND":
        print("Aborted.")
        return

    import resend
    resend.api_key = os.environ["RESEND_API_KEY"]

    sent = 0
    failed = 0
    errors = []
    print()
    for i, c in enumerate(customers, 1):
        body = render_body(c["name"])
        ok, info = send_one(resend, c["email"], body)
        if ok:
            sent += 1
            print(f"  [{i}/{len(customers)}] OK  {c['email']:<42} id={info}")
        else:
            failed += 1
            errors.append((c["email"], info))
            print(f"  [{i}/{len(customers)}] ERR {c['email']:<42} {info}")
        time.sleep(args.throttle)

    print()
    print(f"Done — {sent} sent, {failed} failed.")
    if errors:
        print("\nFailures:")
        for email, err in errors:
            print(f"  {email}: {err}")


if __name__ == "__main__":
    main()
