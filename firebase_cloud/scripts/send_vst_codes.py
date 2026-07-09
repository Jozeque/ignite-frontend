#!/usr/bin/env python3
"""Stride VST free-upgrade mailer: one UNIQUE claim link per existing customer.

Reuses send_campaign.py (same folder) for the Firestore customer fetch, the
Resend sender, and the from/reply-to identity, so deliverability matches the
rest of your CRM mail. On top of that it:

  * loads a pool of unique claim links from the codes CSV (columns: code,claim_url),
  * assigns exactly ONE code per customer and records it in an assignment log
    (kept NEXT TO the codes CSV) so a re-run reuses the SAME code and never
    double-consumes a code or double-emails anyone,
  * renders a "Claim your free Stride VST" button.

SAFETY: dry-run is the DEFAULT; --send makes you type SEND; resume-safe.

    # 1) self-test to yourself (real send of one email)
    python send_vst_codes.py --codes "C:/.../stride-vst-codes.csv" --template vst_free_upgrade.txt --send --only you@gmail.com
    # 2) preview the whole run (sends nothing)
    python send_vst_codes.py --codes "C:/.../stride-vst-codes.csv" --template vst_free_upgrade.txt --dry-run
    # 3) send for real
    python send_vst_codes.py --codes "C:/.../stride-vst-codes.csv" --template vst_free_upgrade.txt --send

Env:  RESEND_API_KEY   (export RESEND_API_KEY="$(firebase functions:secrets:access RESEND_API_KEY | tail -1)")
Deps: pip install firebase-admin resend

NOTE: the codes CSV and the assignment log contain live 100%-off codes. Keep
them OUT of git and private; delete unredeemed codes after the campaign.
"""
import argparse
import csv
import html as html_lib
import os
import sys
import time

# Import send_campaign.py from this script's own folder, regardless of CWD, so
# you can run this from anywhere (e.g. from the folder holding the codes CSV,
# which should NOT be inside the repo).
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import send_campaign as sc  # noqa: E402


def load_codes(path):
    out = []
    with open(path, encoding="utf-8") as f:
        r = csv.reader(f)
        next(r, None)
        for row in r:
            if len(row) >= 2 and row[0].strip():
                out.append((row[0].strip(), row[1].strip()))
    return out


def load_recipients(path):
    """Eligible audience CSV (email[,name]) from build_vst_audience.py — already
    excludes refunds + 100%-off buyers."""
    out = []
    with open(path, encoding="utf-8") as f:
        r = csv.reader(f)
        next(r, None)  # header
        for row in r:
            if row and "@" in row[0]:
                out.append({"email": row[0].strip().lower(),
                            "name": (row[1].strip() if len(row) > 1 else ""),
                            "id": "csv"})
    return out


def load_assignments(path):
    """email -> {code, claim_url, status}. Last row per email wins."""
    a = {}
    if os.path.exists(path):
        with open(path, encoding="utf-8") as f:
            r = csv.reader(f)
            next(r, None)
            for row in r:
                if len(row) >= 4:
                    a[row[0].strip().lower()] = {"code": row[1], "claim_url": row[2], "status": row[3]}
    return a


def append_assignment(path, email, code, claim_url, status):
    new = not os.path.exists(path)
    with open(path, "a", newline="", encoding="utf-8") as f:
        w = csv.writer(f)
        if new:
            w.writerow(["email", "code", "claim_url", "status"])
        w.writerow([email, code, claim_url, status])


def render_text(body, name, claim_url):
    first, np = sc._name_part(name)
    t = body.replace("{name_part}", np).replace("{{first_name}}", first or "there")
    t = t.replace("{{claim_button}}", f"Claim your free Stride VST:\n{claim_url}")
    return t.replace("{{claim_url}}", claim_url).strip("\n")


def render_html(body, name, claim_url):
    first, np = sc._name_part(name)
    b = body.replace("{name_part}", np).replace("{{first_name}}", first or "there")
    button = (
        '<table role="presentation" cellpadding="0" cellspacing="0" border="0" style="margin:24px 0;">'
        '<tr><td style="border-radius:10px;background:#c6712b;">'
        f'<a href="{html_lib.escape(claim_url)}" target="_blank" '
        'style="display:inline-block;padding:14px 30px;border-radius:10px;'
        'font:bold 15px Arial,Helvetica,sans-serif;color:#ffffff;text-decoration:none;">'
        'Claim your free Stride VST</a></td></tr></table>'
    )
    b = b.replace("{{claim_url}}", html_lib.escape(claim_url))
    parts = b.split("{{claim_button}}")
    chunks = []
    for i, seg in enumerate(parts):
        chunks.append(html_lib.escape(seg).replace("\n", "<br>\n"))
        if i < len(parts) - 1:
            chunks.append(button)
    inner = "".join(chunks)
    return (
        '<!doctype html><html><body style="margin:0;padding:0;background:#ffffff;">'
        '<div style="max-width:600px;margin:0 auto;padding:24px 22px;'
        'font:15px/1.65 Arial,Helvetica,sans-serif;color:#222222;">'
        f'{inner}</div></body></html>'
    )


def main():
    try:
        sys.stdout.reconfigure(encoding="utf-8", errors="replace")
    except Exception:
        pass

    p = argparse.ArgumentParser(description="Stride VST free-upgrade mailer (unique claim link per customer).")
    p.add_argument("--codes", required=True, help="CSV of unique codes (columns: code, claim_url).")
    p.add_argument("--template", required=True, help="Email template (Subject: line, blank line, body with {{claim_button}}).")
    mode = p.add_mutually_exclusive_group(required=True)
    mode.add_argument("--dry-run", action="store_true", help="Preview audience + sample, send nothing.")
    mode.add_argument("--send", action="store_true", help="Actually send.")
    p.add_argument("--only", help="Send to just this email (self-test).")
    p.add_argument("--recipients", help="CSV of the eligible audience (email[,name]) from build_vst_audience.py "
                                        "(excludes refunds + 100%%-off). Overrides the Firestore fetch.")
    p.add_argument("--limit", type=int, help="Process only the first N recipients.")
    p.add_argument("--throttle", type=float, default=0.6, help="Seconds between sends (default 0.6).")
    p.add_argument("--key", help="Firebase service-account JSON (defaults to ADC).")
    p.add_argument("--assign-log", help="Assignment log CSV (default: beside the codes file).")
    p.add_argument("--suppress", help="Newline-delimited emails to exclude (replied STOP).")
    args = p.parse_args()

    if args.send and not os.environ.get("RESEND_API_KEY"):
        print('ERROR: RESEND_API_KEY not set. Run:')
        print('  export RESEND_API_KEY="$(firebase functions:secrets:access RESEND_API_KEY | tail -1)"')
        sys.exit(1)

    subject, _, body = sc.load_template(args.template)
    if not subject:
        print(f"ERROR: template {args.template} needs a 'Subject: ...' first line.")
        sys.exit(1)
    if "{{claim_button}}" not in body and "{{claim_url}}" not in body:
        print("ERROR: template must contain {{claim_button}} (or {{claim_url}}) so each customer gets their link.")
        sys.exit(1)

    assign_log = args.assign_log or os.path.join(os.path.dirname(os.path.abspath(args.codes)), "vst-code-assignments.csv")
    codes = load_codes(args.codes)
    assignments = load_assignments(assign_log)
    used = {a["code"] for a in assignments.values()}
    pool = iter([c for c in codes if c[0] not in used])
    free_count = sum(1 for c in codes if c[0] not in used)
    print(f"Codes: {len(codes)} total | {len(used)} already assigned | {free_count} free")
    print(f"Assignment log: {assign_log}")

    # Recipients. Preferred: --recipients CSV from build_vst_audience.py (already
    # excludes refunds + 100%-off). Fallback: Firestore "purchased" (does NOT
    # exclude refunds/freebies — not appropriate for this campaign).
    if args.only:
        recipients = [{"email": args.only.strip().lower(), "name": "Tester", "id": "self-test"}]
    elif args.recipients:
        recipients = load_recipients(args.recipients)
        print(f"Loaded {len(recipients)} eligible recipients from {args.recipients}")
    else:
        print("WARNING: no --recipients list -> falling back to raw Firestore 'purchased', which does")
        print("         NOT exclude refunds or 100%-off users. For this campaign, run")
        print("         build_vst_audience.py and pass --recipients. (Ctrl+C to stop.)")
        sc.init_firestore(args.key)
        recipients = list(sc.fetch_purchased().values())

    suppress = sc.load_suppress(args.suppress)
    if suppress:
        recipients = [r for r in recipients if r["email"] not in suppress]

    already_sent = {e for e, a in assignments.items() if a["status"] == "sent"}
    todo = [r for r in recipients if r["email"] not in already_sent]
    if args.limit:
        todo = todo[: args.limit]
    need_new = sum(1 for r in todo if r["email"] not in assignments)

    print(f"\nRecipients: {len(recipients)} | already sent: {len(recipients) - len(todo)} | to send: {len(todo)}")
    if need_new > free_count:
        print(f"WARNING: {need_new} customers need a NEW code but only {free_count} free codes remain. Generate more first.")

    # Preview first recipient.
    if todo:
        s = todo[0]
        prev = assignments.get(s["email"], {}).get("claim_url")
        if not prev:
            fc = next((c for c in codes if c[0] not in used), None)
            prev = fc[1] if fc else "<NO FREE CODE>"
        print("\n--- Sample (first recipient) ---")
        print(f"To:      {s['email']}")
        print(f"Subject: {sc.render_subject(subject, s['name'])}\n")
        print(render_text(body, s["name"], prev))
        print("--------------------------------")
        if not args.dry_run:
            with open("vst-campaign-preview.html", "w", encoding="utf-8") as f:
                f.write(render_html(body, s["name"], prev))
            print("HTML preview -> vst-campaign-preview.html")

    if args.dry_run:
        print(f"\nDRY RUN. Nothing sent. Would send {len(todo)}; {free_count} codes free.")
        return
    if not todo:
        print("\nNothing to send.")
        return

    if input(f"\nSend {len(todo)} free-VST emails? Type SEND to confirm: ").strip() != "SEND":
        print("Aborted.")
        return

    import resend
    resend.api_key = os.environ["RESEND_API_KEY"]

    sent = failed = 0
    for i, r in enumerate(todo, 1):
        email = r["email"]
        if email in assignments and assignments[email].get("code"):
            code, claim = assignments[email]["code"], assignments[email]["claim_url"]
        else:
            nxt = next(pool, None)
            if nxt is None:
                print(f"  OUT OF CODES at {email} — stopping. Generate more, then re-run.")
                break
            code, claim = nxt
            append_assignment(assign_log, email, code, claim, "assigned")  # crash-safe reservation
            assignments[email] = {"code": code, "claim_url": claim, "status": "assigned"}
        subj = sc.render_subject(subject, r["name"])
        ok, info = sc.send_one(resend, email, subj, render_text(body, r["name"], claim), render_html(body, r["name"], claim))
        append_assignment(assign_log, email, code, claim, "sent" if ok else "FAILED")
        if ok:
            sent += 1
            print(f"  [{i}/{len(todo)}] OK  {email:<40} code={code}")
        else:
            failed += 1
            print(f"  [{i}/{len(todo)}] ERR {email:<40} {info}")
            if any(k in info.lower() for k in ("rate", "429", "too many")):
                time.sleep(3)
        time.sleep(args.throttle)

    print(f"\nDone. sent={sent} failed={failed}. Assignment log: {assign_log}")


if __name__ == "__main__":
    main()
