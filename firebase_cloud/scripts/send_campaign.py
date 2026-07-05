#!/usr/bin/env python3
"""Segment-aware campaign mailer for Stride.

Sends a templated, personalized email to ONE CRM segment at a time, via Resend.
Sends multipart text + HTML: plain text is the deliverable fallback (and what
text-first clients show), HTML adds a clickable video thumbnail when a template
has a `Video:` line.

Segments (derived from the Firestore `waitlist` collection, which the backend
already tags for exactly this):

  purchased  -> status == "purchased" (or source == "lemonsqueezy").
                Use for version-update announcements (redownload from LS).
  abandoned  -> last_action == "buyer_lead" AND not purchased.
                Use for cart-recovery (push to buy).

Sender is "Joe <home@stridehub.io>" (DKIM/SPF/DMARC already set, same as the
welcome email), so deliverability is in place.

SAFETY:
  * Dry-run is the DEFAULT. A real send needs --send AND typing SEND.
  * Resume-safe: every send is logged to sent-<segment>.csv; re-running SKIPS
    anyone already sent, so a crash or a second run never double-emails.
  * Honors an opt-out list (--suppress) so "reply STOP" people are excluded.

Template format:
    Subject: <one line>
    Video: <youtube url>        (optional; drives the {{video}} thumbnail)
    <blank line>
    <body ... {name_part} ... {{video}} ...>
  {name_part} -> " First" (or ""). {{video}} -> a clickable thumbnail (HTML) /
  a "▶ <url>" link (text); removed if no video.

Usage:
  python send_campaign.py --segment purchased --template templates/update_2.2.0.txt --dry-run
  python send_campaign.py --segment purchased --template templates/update_2.2.0.txt --send --only you@gmail.com
  python send_campaign.py --segment abandoned --template templates/cart_recovery.txt --send

Flags:
  --video URL      override the template's Video: line
  --text-only      send plain text only (no HTML thumbnail)
  --limit N        process only the first N recipients
  --throttle SEC   seconds between sends (default 0.6, ~100/min)
  --key PATH       Firebase service-account JSON (defaults to ADC)
  --log PATH       resume log CSV (default sent-<segment>.csv)
  --suppress PATH  newline-delimited emails to exclude (replied STOP)

Requirements:  pip install firebase-admin resend
Environment:   RESEND_API_KEY   (firebase functions:secrets:access RESEND_API_KEY)
"""

import argparse
import csv
import html as html_lib
import os
import re
import sys
import time

FROM = "Joe <home@stridehub.io>"
REPLY_TO = "home@stridehub.io"

_URL_RE = re.compile(r'(https?://[^\s<>()]+)')
_YT_RE = re.compile(r'(?:youtu\.be/|youtube\.com/(?:watch\?v=|embed/))([A-Za-z0-9_-]{6,})')


# ── Firestore ────────────────────────────────────────────
def init_firestore(key_path):
    import firebase_admin
    from firebase_admin import credentials
    if firebase_admin._apps:
        return
    if key_path:
        firebase_admin.initialize_app(credentials.Certificate(key_path))
    else:
        firebase_admin.initialize_app()


def _client():
    from firebase_admin import firestore as admin_firestore
    return admin_firestore.client()


def fetch_purchased():
    """Paying customers, deduped by email: status==purchased plus the
    source==lemonsqueezy fallback (a buyer whose status was later edited)."""
    db = _client()
    seen = {}

    def _add(doc):
        d = doc.to_dict() or {}
        email = (d.get("email") or "").strip().lower()
        if not email or email in seen:
            return
        seen[email] = {"email": email, "name": (d.get("name") or "").strip(), "id": doc.id}

    for doc in db.collection("waitlist").where("status", "==", "purchased").stream():
        _add(doc)
    for doc in db.collection("waitlist").where("source", "==", "lemonsqueezy").stream():
        _add(doc)
    return seen


def _fetch_leads_by_action(action, purchased_emails):
    """Non-buyers whose last_action == `action`, deduped by email. Excludes
    anyone already in `purchased_emails` and any row whose own status is
    purchased."""
    db = _client()
    seen = {}
    for doc in db.collection("waitlist").where("last_action", "==", action).stream():
        d = doc.to_dict() or {}
        email = (d.get("email") or "").strip().lower()
        if not email or email in seen:
            continue
        if (d.get("status") or "") == "purchased":
            continue
        if email in purchased_emails:
            continue
        seen[email] = {"email": email, "name": (d.get("name") or "").strip(), "id": doc.id}
    return seen


def fetch_abandoned(purchased_emails):
    """Cart-abandoners: last_action==buyer_lead AND not a buyer."""
    return _fetch_leads_by_action("buyer_lead", purchased_emails)


def fetch_waitlist(purchased_emails):
    """The original waitlist sign-ups: non-buyers who are NEITHER cart-abandoners
    (buyer_lead) NOR free-pack downloaders (sample_pack_signup). Most are
    pre-launch signups with an empty/missing last_action (the field postdates
    them), so we scan the collection and exclude the tagged actions rather than
    query one value."""
    db = _client()
    seen = {}
    exclude = {"buyer_lead", "sample_pack_signup"}
    for doc in db.collection("waitlist").stream():
        d = doc.to_dict() or {}
        email = (d.get("email") or "").strip().lower()
        if not email or email in seen:
            continue
        if (d.get("status") or "") == "purchased":
            continue
        if email in purchased_emails:
            continue
        if (d.get("last_action") or "") in exclude:
            continue
        seen[email] = {"email": email, "name": (d.get("name") or "").strip(), "id": doc.id}
    return seen


def fetch_sample_pack(purchased_emails):
    """Free-pack downloaders who never bought: last_action==sample_pack_signup."""
    return _fetch_leads_by_action("sample_pack_signup", purchased_emails)


# ── Template + rendering ─────────────────────────────────
def load_template(path):
    """Returns (subject, video_url, body). Optional 'Video:' header line."""
    lines = open(path, encoding="utf-8").read().split("\n")
    subject, video, i = "", "", 0
    if i < len(lines) and lines[i].lower().startswith("subject:"):
        subject = lines[i][8:].strip()
        i += 1
    if i < len(lines) and lines[i].lower().startswith("video:"):
        video = lines[i][6:].strip()
        i += 1
    while i < len(lines) and lines[i] == "":
        i += 1
    return subject, video, "\n".join(lines[i:]).rstrip("\n")


def parse_youtube_id(url):
    m = _YT_RE.search(url or "")
    return m.group(1) if m else ""


def _name_part(name):
    first = (name or "").strip().split(" ")[0] if name else ""
    return first, (f" {first}" if first else "")


def _video_text(url):
    return ("▶ " + url) if url else ""  # "▶ <url>"


def _video_html(url, vid):
    thumb = f"https://img.youtube.com/vi/{vid}/maxresdefault.jpg"
    return (
        '<table role="presentation" cellpadding="0" cellspacing="0" border="0" style="margin:20px 0;">'
        '<tr><td style="text-align:center;">'
        f'<a href="{html_lib.escape(url)}" target="_blank" style="text-decoration:none;color:#c6712b;">'
        f'<img src="{thumb}" width="520" alt="Watch the 30-second demo" '
        'style="display:block;width:520px;max-width:100%;height:auto;border-radius:10px;border:1px solid #e5e5e5;" />'
        '<span style="display:inline-block;margin-top:10px;font:bold 15px Arial,Helvetica,sans-serif;color:#c6712b;">'
        '&#9654;&nbsp;Watch the 30-second demo</span>'
        '</a></td></tr></table>'
    )


def _linkify_escape(seg):
    out, last = [], 0
    for m in _URL_RE.finditer(seg):
        out.append(html_lib.escape(seg[last:m.start()]))
        u = m.group(1)
        out.append(f'<a href="{html_lib.escape(u)}" target="_blank" style="color:#c6712b;">{html_lib.escape(u)}</a>')
        last = m.end()
    out.append(html_lib.escape(seg[last:]))
    txt = ''.join(out)
    txt = re.sub(r'(?<![\w/@.])stridehub\.io\b',
                 '<a href="https://stridehub.io" target="_blank" style="color:#c6712b;">stridehub.io</a>', txt)
    return txt.replace('\n', '<br>\n')


def render_text(body, name, url):
    _, np = _name_part(name)
    t = body.replace("{name_part}", np).replace("{{first_name}}", _name_part(name)[0] or "there")
    t = t.replace("{{video}}", _video_text(url))
    t = re.sub(r'\{\{img:[^}]+\}\}', '', t)   # inline images are HTML-only
    return re.sub(r'\n{3,}', '\n\n', t).strip("\n")


def render_html(body, name, url, vid):
    first, np = _name_part(name)
    b = body.replace("{name_part}", np).replace("{{first_name}}", first or "there")
    chunks = []
    # Split on {{video}} and {{img:URL}} tokens, keeping them, so the text
    # segments still get linkified/escaped but the tokens render as media.
    for seg in re.split(r'(\{\{video\}\}|\{\{img:[^}]+\}\})', b):
        if seg == "{{video}}":
            chunks.append(_video_html(url, vid) if (url and vid) else "")
        elif seg.startswith("{{img:"):
            src = seg[6:-2].strip()
            chunks.append(
                f'<img src="{html_lib.escape(src)}" alt="" '
                'style="display:block;max-width:100%;height:auto;margin:14px 0;'
                'border-radius:8px;border:1px solid #e5e5e5;">'
            )
        else:
            chunks.append(_linkify_escape(seg))
    inner = "".join(chunks)
    return (
        '<!doctype html><html><body style="margin:0;padding:0;background:#ffffff;">'
        '<div style="max-width:600px;margin:0 auto;padding:24px 22px;'
        'font:15px/1.65 Arial,Helvetica,sans-serif;color:#222222;">'
        f'{inner}</div></body></html>'
    )


def render_subject(subject, name):
    first, np = _name_part(name)
    return subject.replace("{name_part}", np).replace("{{first_name}}", first or "there")


# ── Logs / suppression ───────────────────────────────────
def load_suppress(path):
    if not path or not os.path.exists(path):
        return set()
    return {l.strip().lower() for l in open(path, encoding="utf-8") if "@" in l}


def load_sent(path):
    """Emails already SUCCESSFULLY sent (status=sent). Rows logged FAILED are
    NOT counted, so a re-run retries them — that's how the daily, quota-limited
    batches eventually reach everyone who didn't get through last time."""
    if not os.path.exists(path):
        return set()
    out = set()
    with open(path, encoding="utf-8") as f:
        rows = csv.reader(f)
        next(rows, None)
        for row in rows:
            if len(row) >= 2 and row[1] == "sent":
                out.add(row[0].strip().lower())
    return out


def log_sent(path, email, status, info):
    new = not os.path.exists(path)
    with open(path, "a", newline="", encoding="utf-8") as f:
        w = csv.writer(f)
        if new:
            w.writerow(["email", "status", "info"])
        w.writerow([email, status, str(info).replace("\n", " ")])


# ── Send ─────────────────────────────────────────────────
def send_one(resend_module, email, subject, text, html):
    try:
        payload = {"from": FROM, "to": [email], "reply_to": REPLY_TO, "subject": subject, "text": text}
        if html:
            payload["html"] = html
        result = resend_module.Emails.send(payload)
        rid = result.get("id") if isinstance(result, dict) else str(result)
        return True, rid
    except Exception as e:  # noqa: BLE001
        return False, str(e)


def main():
    # Windows consoles are often not UTF-8 (e.g. cp1255); keep the ▶ in the
    # preview from crashing the run. The email itself is always sent as UTF-8.
    try:
        sys.stdout.reconfigure(encoding="utf-8", errors="replace")
    except Exception:
        pass

    p = argparse.ArgumentParser(description="Segment-aware Stride campaign mailer via Resend.")
    p.add_argument("--segment", choices=["purchased", "abandoned", "waitlist", "sample_pack"], help="Audience to pull from Firestore.")
    p.add_argument("--template", required=True, help="Template file (Subject:/Video: headers, blank line, body).")
    mode = p.add_mutually_exclusive_group(required=True)
    mode.add_argument("--dry-run", action="store_true", help="Preview audience + sample, send nothing.")
    mode.add_argument("--send", action="store_true", help="Actually send.")
    p.add_argument("--only", help="Override the audience with this one email (self-test).")
    p.add_argument("--recipients", help="CSV of email[,name] to send to instead of a --segment (e.g. from build_vst_audience.py, which already excludes refunds and free/comped orders).")
    p.add_argument("--video", help="Override the template's Video: URL.")
    p.add_argument("--text-only", action="store_true", help="Send plain text only (no HTML thumbnail).")
    p.add_argument("--limit", type=int, help="Process only the first N recipients.")
    p.add_argument("--throttle", type=float, default=0.6, help="Seconds between sends (default 0.6).")
    p.add_argument("--key", help="Firebase service-account JSON path (defaults to ADC).")
    p.add_argument("--log", help="Resume log CSV (default sent-<segment>.csv).")
    p.add_argument("--suppress", help="Newline-delimited emails to exclude (replied STOP).")
    args = p.parse_args()

    if not args.only and not args.segment and not args.recipients:
        p.error("one of --segment / --recipients / --only is required")
    if args.send and not os.environ.get("RESEND_API_KEY"):
        print("ERROR: RESEND_API_KEY not set. Run:")
        print('  export RESEND_API_KEY="$(firebase functions:secrets:access RESEND_API_KEY 2>/dev/null | tail -1)"')
        sys.exit(1)

    subject, tpl_video, body = load_template(args.template)
    if not subject:
        print(f"ERROR: template {args.template} needs a 'Subject: ...' first line.")
        sys.exit(1)
    video_url = (args.video or tpl_video or "").strip()
    vid = parse_youtube_id(video_url)
    if video_url and not vid:
        print(f"WARNING: couldn't parse a YouTube id from '{video_url}' — HTML thumbnail will be skipped (text link still included).")

    # ── Build the recipient list ──
    if args.only:
        recipients = [{"email": args.only.strip().lower(), "name": "Tester", "id": "self-test"}]
        seg_label = "self-test"
    elif args.recipients:
        recipients = []
        with open(args.recipients, encoding="utf-8") as _f:
            _r = csv.reader(_f); next(_r, None)  # skip header
            for _row in _r:
                if _row and "@" in _row[0]:
                    recipients.append({"email": _row[0].strip().lower(),
                                       "name": (_row[1].strip() if len(_row) > 1 else ""), "id": "csv"})
        seg_label = "recipients-csv"
        print(f"Loaded {len(recipients)} recipients from {args.recipients}")
    else:
        print("Connecting to Firestore...")
        init_firestore(args.key)
        print(f"Fetching segment: {args.segment} ...")
        purchased = fetch_purchased()
        pe = set(purchased.keys())
        if args.segment == "purchased":
            audience = purchased
        elif args.segment == "abandoned":
            audience = fetch_abandoned(pe)
        elif args.segment == "waitlist":
            audience = fetch_waitlist(pe)
        else:  # sample_pack
            audience = fetch_sample_pack(pe)
        recipients = list(audience.values())
        seg_label = args.segment

    suppress = load_suppress(args.suppress)
    if suppress:
        before = len(recipients)
        recipients = [r for r in recipients if r["email"] not in suppress]
        print(f"Suppressed (opt-out): {before - len(recipients)}")

    log_path = args.log or f"sent-{seg_label}.csv"
    already = load_sent(log_path)
    if already:
        before = len(recipients)
        recipients = [r for r in recipients if r["email"] not in already]
        print(f"Already sent (skip) : {before - len(recipients)}  (log: {log_path})")

    if args.limit:
        recipients = recipients[: args.limit]

    # ── Preview ──
    print(f"\nSegment : {seg_label}")
    print(f"Template: {args.template}")
    print(f"From    : {FROM}")
    print(f"Video   : {video_url or '(none)'}{'  [text-only]' if args.text_only else ''}")
    print(f"TO SEND : {len(recipients)}\n")
    print("--- Recipients ---")
    for r in recipients[:50]:
        print(f"  {r['email']:<42} {r['name'] or '(no name)'}")
    if len(recipients) > 50:
        print(f"  ... and {len(recipients) - 50} more")

    if recipients:
        s = recipients[0]
        print("\n--- Sample TEXT (first recipient) ---")
        print(f"From:    {FROM}")
        print(f"To:      {s['email']}")
        print(f"Subject: {render_subject(subject, s['name'])}\n")
        print(render_text(body, s["name"], video_url))
        print("-------------------------------------")
        if not args.text_only:
            html = render_html(body, s["name"], video_url, vid)
            with open("campaign-preview.html", "w", encoding="utf-8") as f:
                f.write(html)
            print("HTML preview written to campaign-preview.html (open it in a browser to eyeball the thumbnail).")

    if args.dry_run:
        print(f"\nDRY RUN. Nothing sent. Would send {len(recipients)}. Re-run with --send to send for real.")
        return
    if not recipients:
        print("\nNothing to send.")
        return

    confirm = input(f"\nSend to {len(recipients)} recipient(s) in segment '{seg_label}'? Type SEND to confirm: ").strip()
    if confirm != "SEND":
        print("Aborted.")
        return

    import resend
    resend.api_key = os.environ["RESEND_API_KEY"]

    sent = failed = 0
    print()
    for i, r in enumerate(recipients, 1):
        subj = render_subject(subject, r["name"])
        text = render_text(body, r["name"], video_url)
        html = None if args.text_only else render_html(body, r["name"], video_url, vid)
        ok, info = send_one(resend, r["email"], subj, text, html)
        log_sent(log_path, r["email"], "sent" if ok else "FAILED", info)
        if ok:
            sent += 1
            print(f"  [{i}/{len(recipients)}] OK  {r['email']:<42} id={info}")
        else:
            failed += 1
            print(f"  [{i}/{len(recipients)}] ERR {r['email']:<42} {info}")
            if any(k in info.lower() for k in ("rate", "429", "too many")):
                time.sleep(3)
        time.sleep(args.throttle)

    print(f"\nDone. sent={sent} failed={failed}  (log: {log_path})")


if __name__ == "__main__":
    main()
