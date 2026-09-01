"""Stride demo CRM: one page, one row per demo user, everything we know about them.

WHY THIS EXISTS, AND WHY IT IS NOT THE CAMPAIGN TRACKER
-------------------------------------------------------
demo_acq_tracker.py answers "is the current ad campaign working". It is scoped to
one campaign_id and to the lifecycle mailer's candidate window, which is a few days
wide. That is the right scope for that question and the wrong scope for this one.

This page answers "who are our demo users and what is true about each of them",
across every demo we have ever handed out. That population lives in two places
that do not join by themselves:

  events    rich, per-action, but only since 2026-08-25 when the log was created
  waitlist  the CRM proper, back to 2026-04-09, but only end states, no journey

So roughly 260 of our ~310 demo users have no event rows at all. The honest thing
is to show them with an explicit era marker rather than let the page imply we
watched a journey we never recorded. Every field carries its own provenance for
the same reason: a CRM that cannot tell "no" apart from "we never looked" will
eventually be used to make a decision it cannot support.

WHAT IT DOES NOT DO
-------------------
Read only. Nothing here sends, suppresses, edits or deletes. Segments export
addresses to the clipboard and the actual send stays a deliberate act in
send_campaign.py, because a CRM with a send button one click from a 300-person
list is a CRM that eventually mails 300 people by accident.

Regenerate with demo_crm_autorefresh.bat, exactly the HOT59/demo_acq pattern.
"""
import collections
import datetime
import html
import io
import json
import os
import sys
import time

sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding="utf-8", errors="replace")

import firebase_admin
from firebase_admin import credentials, firestore

from demo_acq_report import SERVICE_KEY, load_events
import demo_lifecycle_mirror as lcm

HERE = os.path.dirname(os.path.abspath(__file__))
OUT = os.path.join(HERE, "demo_crm.html")
IL = datetime.timezone(datetime.timedelta(hours=3))

# The demo entry points, in the order we prefer to believe them.
DEMO_ENTRY_TYPES = ("demo_registered", "demo_downloaded")
LIFECYCLE_SENDS = ("activate_nudge", "friction_rescue", "onboard", "post_demo", "post_demo_unused",
                   "start_nudge", "post_reg")


def ts_ms(v):
    """Milliseconds from whatever Firestore handed us: int, str, or a datetime."""
    if v is None or v == "":
        return 0
    if isinstance(v, (int, float)):
        return int(v)
    if isinstance(v, str):
        try:
            return int(float(v))
        except ValueError:
            try:
                return int(datetime.datetime.fromisoformat(v.replace("Z", "+00:00")).timestamp() * 1000)
            except Exception:
                return 0
    try:
        return int(v.timestamp() * 1000)
    except Exception:
        return 0


def fmt(ms, with_time=True):
    if not ms:
        return ""
    d = datetime.datetime.fromtimestamp(int(ms) / 1000, IL)
    return d.strftime("%Y-%m-%d %H:%M" if with_time else "%Y-%m-%d")


def ek(email):
    return (email or "").strip().lower()


def load_all(db):
    """Every source, read once. Returns plain dicts so the rest of the file is pure."""
    by_email, anonymous = load_events(db)

    waitlist = collections.defaultdict(list)
    for d in db.collection("waitlist").stream():
        w = d.to_dict() or {}
        em = ek(w.get("email"))
        if em:
            w["_id"] = d.id
            waitlist[em].append(w)

    passes = []
    for d in db.collection("vst_passes").stream():
        p = d.to_dict() or {}
        p["_id"] = d.id
        passes.append(p)

    claims = collections.defaultdict(list)
    for d in db.collection("demo_claims").stream():
        c = d.to_dict() or {}
        em = ek(c.get("email"))
        if em:
            c["_id"] = d.id
            claims[em].append(c)

    supp = set()
    try:
        snap = db.collection("config").document("email_suppression").get()
        supp = {ek(e) for e in ((snap.to_dict() or {}).get("emails") or [])}
    except Exception:
        pass

    feedback = collections.defaultdict(list)
    for d in db.collection("feedback").stream():
        f = d.to_dict() or {}
        em = ek(f.get("userEmail"))
        if em and em != "anonymous":
            feedback[em].append(f)

    return {"by_email": by_email, "anonymous": anonymous, "waitlist": waitlist,
            "passes": passes, "claims": claims, "supp": supp, "feedback": feedback}


def is_demo_row(w):
    """Did this CRM row come from someone taking a demo?"""
    return bool(w.get("demo_at") or w.get("demo_source") or w.get("pass_started_at")
                or str(w.get("status") or "").lower() == "demo")


def purchase_of(rows, evs):
    """Purchase signal from EVERY source, deliberately over-inclusive.

    A person routinely holds several waitlist rows, because a demo order and a paid
    order are two Lemon Squeezy orders and therefore two writes. Reading only the
    earliest row, or only the "best" one, is exactly how the summer cohort leaked two
    paying customers into a discount blast. So if ANY row or ANY event says paid, the
    person is paid. Over-suppressing costs one unsent mail. Under-suppressing sends a
    customer a pitch for something they already bought."""
    paid_ms, order, cents, cur, keys = 0, "", 0, "USD", []
    for w in rows:
        cash = int(ts_ms(w.get("total_cents")) or 0)
        signal = (w.get("purchased_at") or w.get("license_key") or w.get("license_key_short")
                  or str(w.get("status") or "").lower() == "purchased"
                  or (w.get("ls_order_id") and cash > 0))
        if not signal:
            continue
        t = ts_ms(w.get("purchased_at")) or ts_ms(w.get("license_created_at")) or ts_ms(w.get("created_at"))
        if t and (not paid_ms or t < paid_ms):
            paid_ms = t
        order = order or str(w.get("ls_order_id") or "")
        cents = max(cents, cash)
        cur = w.get("currency") or cur
        k = w.get("license_key_short") or w.get("license_key")
        if k and str(k)[:24] not in keys:
            keys.append(str(k)[:24])
    for e in evs:
        if e.get("type") != "purchase_completed":
            continue
        t = ts_ms(e.get("ts_ms"))
        if t and (not paid_ms or t < paid_ms):
            paid_ms = t
        order = order or str(e.get("ls_order_id") or "")
        cents = max(cents, int(ts_ms(e.get("total_cents")) or 0))
        cur = e.get("currency") or cur
    return {"paid": bool(paid_ms or order or cents), "at": paid_ms, "order": order,
            "cents": cents, "currency": cur, "keys": keys}


def attribution(rows, evs):
    """Where they came from. Events win when present, because they are stamped at the
    moment of the click, while the CRM row is a later write that the Lemon Squeezy
    webhook has been known to clobber."""
    a = {"source": "", "campaign_id": "", "adset_id": "", "ad_id": "", "utm_source": "",
         "utm_campaign": "", "utm_content": "", "fbclid": "", "country": "", "heard_from": "",
         "ip": "", "ua": "", "from": ""}
    entry = next((e for e in evs if e.get("type") in DEMO_ENTRY_TYPES), None)
    chk = next((e for e in evs if e.get("type") == "checkout_started"), None)
    for src, tag in ((entry, "event"), (chk, "checkout")):
        if not src:
            continue
        for k in ("campaign_id", "adset_id", "ad_id", "utm_source", "utm_campaign",
                  "utm_content", "fbclid", "country", "heard_from", "ip", "ua"):
            if not a[k] and src.get(k):
                a[k] = str(src.get(k))
                a["from"] = a["from"] or tag
    for w in rows:
        for k in ("source", "campaign_id", "adset_id", "ad_id", "utm_source",
                  "utm_campaign", "utm_content", "fbclid", "country", "ip", "ua"):
            if not a[k] and w.get(k):
                a[k] = str(w.get(k))
                a["from"] = a["from"] or "crm"
        if not a["source"] and w.get("acquisition_source"):
            a["source"] = str(w.get("acquisition_source"))
        if not a["source"] and w.get("demo_source"):
            a["source"] = str(w.get("demo_source"))
    return a


def build_people(data, now_ms):
    """One record per email. Everything the page shows is decided here, once."""
    by_email, waitlist = data["by_email"], data["waitlist"]
    passes_by_email = collections.defaultdict(list)
    passes_by_device = {}
    for p in data["passes"]:
        passes_by_device[str(p.get("device") or p["_id"])] = p
        em = ek(p.get("email"))
        if em:
            passes_by_email[em].append(p)

    demo_evs = DEMO_ENTRY_TYPES + ("demo_activated", "demo_expired", "demo_download", "demo_first_use")
    emails = set()
    for em, evs in by_email.items():
        if em and any(e.get("type") in demo_evs for e in evs):
            emails.add(em)
    for em, rows in waitlist.items():
        if any(is_demo_row(w) for w in rows):
            emails.add(em)
    emails.update(passes_by_email)

    people = []
    for em in sorted(emails):
        evs = by_email.get(em, [])
        rows = waitlist.get(em, [])
        byt = collections.defaultdict(list)
        for e in evs:
            byt[e.get("type")].append(e)

        name = next((str(w.get("name") or "").strip() for w in rows if str(w.get("name") or "").strip()), "")
        entry = (byt.get("demo_registered") or byt.get("demo_downloaded") or [None])[0]
        reg_ms = ts_ms(entry.get("ts_ms")) if entry else 0
        demo_at = max([ts_ms(w.get("demo_at")) for w in rows] or [0])
        created = min([ts_ms(w.get("created_at")) for w in rows if ts_ms(w.get("created_at"))] or [0])
        first_ms = min([t for t in (reg_ms, demo_at, created) if t] or [0])

        dl = (byt.get("demo_download") or [None])[0]
        act = (byt.get("demo_activated") or [None])[0]
        use = (byt.get("demo_first_use") or [None])[0]
        chk = (byt.get("checkout_started") or [None])[0]
        pur = purchase_of(rows, evs)

        # Pass truth. The event log records what happened; vst_passes holds the live
        # entitlement. Prefer the event, fall back to the pass doc, because a legacy
        # user can hold a pass with no event behind it.
        pass_docs = list(passes_by_email.get(em, []))
        if act and str(act.get("device") or "") in passes_by_device:
            d = str(act["device"])
            pass_docs = [passes_by_device[d]] + [p for p in pass_docs if str(p.get("device") or p["_id"]) != d]
        act_ms = ts_ms(act.get("ts_ms")) if act else max([ts_ms(p.get("started_at")) for p in pass_docs] or [0])
        exp_ms = (ts_ms(act.get("exp_ms")) if act else 0) or max([ts_ms(p.get("exp")) for p in pass_docs] or [0])
        if not act_ms:
            act_ms = max([ts_ms(w.get("pass_started_at")) for w in rows] or [0])

        identity = (act or {}).get("identity") or ("confirmed" if (act or {}).get("email") else "")

        # ERA. Do we have a journey for this person, or only an end state? Everything
        # before the event log went live on 2026-08-25 is an end state only, and the
        # page must never let those two look alike.
        era = "tracked" if evs else "legacy"

        # STAGE. Strictly ordered, most advanced wins.
        #
        # UNRECORDED exists because of a trap this page would otherwise walk straight
        # into. A legacy user has no activation row, which looks identical to a tracked
        # user who genuinely never activated. Collapsing the two puts ~260 people whose
        # outcome nobody ever watched into a "never activated" segment, and the first
        # thing anyone does with that segment is mail it. Purchase is exempt because it
        # is written to the CRM in every era and is therefore known for everyone.
        if pur["paid"]:
            stage = "CUSTOMER"
        elif chk:
            stage = "CHECKOUT"
        elif act_ms and exp_ms and now_ms >= exp_ms:
            stage = "EXPIRED"
        elif act_ms:
            stage = "ACTIVE"
        elif era == "legacy":
            stage = "UNRECORDED"
        elif dl:
            stage = "DOWNLOADED"
        else:
            stage = "REGISTERED"

        mails = [{"send": e.get("send"), "status": e.get("status"), "state": e.get("state"),
                  "ms": ts_ms(e.get("ts_ms"))} for e in byt.get("demo_mail_sent", [])]
        mails += [{"send": "checkout_recovery", "status": e.get("status"), "state": "CHECKOUT",
                   "ms": ts_ms(e.get("ts_ms"))} for e in byt.get("recovery_email_sent", [])]
        mails.sort(key=lambda m: m["ms"])

        keep = ("send", "status", "state", "identity", "device", "signal", "platform",
                "heard_from", "total_cents", "ls_order_id", "campaign_id", "ad_id", "utm_content")
        timeline = [{"ms": ts_ms(e.get("ts_ms")), "type": e.get("type"),
                     "detail": " ".join(f"{k}={str(e[k])[:44]}" for k in keep if e.get(k))}
                    for e in evs]
        for w in rows:
            for k, label in (("created_at", "crm row created"), ("demo_at", "crm demo stamp"),
                             ("purchased_at", "crm purchase"), ("license_created_at", "licence issued"),
                             ("license_last_validated_at", "licence last validated")):
                if w.get(k):
                    timeline.append({"ms": ts_ms(w.get(k)), "type": label, "detail": ""})
        timeline.sort(key=lambda t: t["ms"])

        lic = {}
        for w in rows:
            if w.get("license_key_short") or w.get("license_key"):
                lic = {"key": str(w.get("license_key_short") or w.get("license_key") or "")[:24],
                       "status": str(w.get("license_status") or ""),
                       "used": ts_ms(w.get("license_activation_usage")),
                       "limit": ts_ms(w.get("license_activation_limit")),
                       "validations": ts_ms(w.get("license_validation_count")),
                       "last": ts_ms(w.get("license_last_validated_at"))}
                break

        # "converted" = paid more than an hour after the first demo touch. Below that the
        # demo order and the paid order are one Lemon Squeezy session, which is a purchase
        # that happens to carry a demo row, not a trial that worked.
        converted = bool(pur["paid"] and pur["at"] and first_ms and pur["at"] > first_ms + 3600000)
        people.append({
            "converted": converted,
            "email": em, "name": name, "first": name.split(" ")[0] if name else "",
            "stage": stage, "era": era, "identity": identity,
            "first_ms": first_ms, "reg_ms": reg_ms, "demo_at_ms": demo_at,
            "dl_ms": ts_ms(dl.get("ts_ms")) if dl else 0,
            "act_ms": act_ms, "exp_ms": exp_ms,
            "use_ms": ts_ms(use.get("ts_ms")) if use else 0,
            "chk_ms": ts_ms(chk.get("ts_ms")) if chk else 0,
            "paid": pur["paid"], "paid_ms": pur["at"], "order": pur["order"],
            "cents": pur["cents"], "currency": pur["currency"], "keys": pur["keys"],
            "suppressed": em in data["supp"],
            "attr": attribution(rows, evs),
            "devices": [{"device": str(p.get("device") or p["_id"])[:16], "status": p.get("status") or "",
                         "started": ts_ms(p.get("started_at")), "exp": ts_ms(p.get("exp")),
                         "ip": p.get("mint_ip") or "", "ua": str(p.get("mint_ua") or "")[:70]}
                        for p in pass_docs],
            "claims": [{"ip": c.get("ip") or "", "claimed": bool(c.get("claimed")),
                        "device": str(c.get("claimed_by_device") or "")[:16]}
                       for c in data["claims"].get(em, [])],
            "mails": mails, "timeline": timeline, "license": lic, "crm_rows": len(rows),
            "feedback": [{"ms": ts_ms(f.get("timestamp")), "message": str(f.get("message") or "")[:400]}
                         for f in data["feedback"].get(em, [])],
        })
    return people


def attach_lifecycle(people, lc):
    """Overlay the mailer's own verdicts, which come from demo_lifecycle_mirror running
    the REAL demo_lifecycle read-only. Anyone outside the mailer's candidate window is
    marked as such rather than left looking merely quiet: the automation will never
    touch those people again, and that is a fact the page has to state out loud."""
    rows = (lc or {}).get("rows") or {}
    for p in people:
        r = rows.get(p["email"])
        if not r:
            p["lc"] = None
            p["next"] = ""
            continue
        cells = {}
        for send, c in (r.get("cells") or {}).items():
            cells[send] = {"kind": c.get("kind"), "text": c.get("text"), "why": c.get("why"),
                           "due": c.get("due_ms") or 0}
        p["lc"] = {"cells": cells, "state": r.get("state"), "paid": bool(r.get("paid")),
                   "suppressed": bool(r.get("suppressed"))}
        nxt = r.get("next") or ""
        p["next"] = "" if nxt.strip() in ("", "-") else nxt
        # DONE means every send this person could still receive is blocked for good:
        # already claimed, floored out, or ruled out by state. It is not the same as
        # quiet. These are the people the automation will never write to again, which
        # makes them exactly the list worth working by hand.
        live = [c for c in cells.values() if c["kind"] in ("sched", "due", "pending", "warn")]
        p["lc"]["done"] = not live and bool(cells)
        p["lc"]["why_done"] = ""
        if p["lc"]["done"]:
            whys = [c["why"] for c in cells.values() if c.get("why")]
            p["lc"]["why_done"] = collections.Counter(whys).most_common(1)[0][0] if whys else ""
    return people


def next_action(p, now_ms):
    """The single most useful thing to know about this person right now.

    Ordered by what actually costs money. A queued mail to a payer is a live incident;
    a legacy user with no journey is merely unknowable. Everything in between is
    ordinary funnel state."""
    if p["lc"]:
        bad = [c for c in p["lc"]["cells"].values() if c["kind"] == "bad"]
        if bad:
            return ("alert", bad[0]["why"] or bad[0]["text"] or "lifecycle problem")
    if p["paid"]:
        return ("done", "customer, no lifecycle mail should ever queue")
    if p["suppressed"]:
        return ("muted", "opted out, excluded from every send")
    if p["stage"] == "CHECKOUT":
        return ("hot", "reached checkout and did not finish, owned by checkout recovery")
    if p["stage"] == "ACTIVE":
        return ("hot", "pass running now, expires " + fmt(p["exp_ms"]))
    if p["stage"] == "EXPIRED" and not p["use_ms"]:
        return ("warm", "pass ended, no meaningful use recorded")
    if p["stage"] == "EXPIRED":
        return ("warm", "pass ended after real use, best buy candidate")
    if p["stage"] == "UNRECORDED":
        return ("cold", "took a demo before we logged anything, outcome unknown")
    if p["stage"] in ("REGISTERED", "DOWNLOADED"):
        age_h = (now_ms - p["first_ms"]) / 3600000.0 if p["first_ms"] else 0
        done = bool(p["lc"] and p["lc"].get("done"))
        if done:
            return ("warm", "never activated, and the automation has nothing left to send")
        if age_h > 72:
            return ("cold", "registered %.0fh ago and never activated" % age_h)
        return ("warm", "registered, waiting on activation")
    return ("cold", "")


# ── the page ─────────────────────────────────────────────────────────────────
# Built as a template with __TOKEN__ placeholders rather than str.format, because
# the CSS and JS below are full of braces and escaping every one of them is how
# these files rot.

PAGE = r"""<!doctype html>
<html lang="en"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>Stride demo CRM</title>
<style>
:root{--bg:#141310;--panel:#1d1b16;--raise:#252119;--line:rgba(216,201,176,.12);
--ink:#ece4d6;--ink2:#b8ad9b;--ink3:#857c6e;--ink4:#5c554a;--copper:#dd9a52;--ember:#e58a2e;
--green:#3ec78f;--blue:#7db4e8;--amber:#e5b02e;--red:#ff7a5c}
*{box-sizing:border-box}
body{margin:0;background:var(--bg);color:var(--ink2);
font:14px/1.5 system-ui,'Segoe UI',sans-serif;-webkit-font-smoothing:antialiased}
.wrap{max-width:1680px;margin:0 auto;padding:22px 26px 80px}
header{display:flex;align-items:baseline;gap:14px;flex-wrap:wrap;margin-bottom:4px}
h1{font-size:19px;color:var(--ink);margin:0;letter-spacing:.02em;font-weight:700}
h1 b{color:var(--copper)}
.meta{font:12px ui-monospace,Consolas,monospace;color:var(--ink3)}
#age.stale{color:var(--amber)}
#age a{color:inherit}
h2{font-size:10.5px;letter-spacing:.22em;text-transform:uppercase;color:var(--ink3);
margin:26px 0 10px;font-weight:700}
.tiles{display:grid;grid-template-columns:repeat(auto-fit,minmax(146px,1fr));gap:10px}
.tile{background:var(--panel);border:1px solid var(--line);border-radius:12px;padding:13px 15px}
.tile .v{font:600 25px/1.1 ui-monospace,Consolas,monospace;color:var(--ink)}
.tile .k{margin-top:5px;font-size:9.5px;letter-spacing:.14em;text-transform:uppercase;
color:var(--ink3);font-weight:700}
.tile .s{margin-top:4px;font-size:11.5px;color:var(--ink3);line-height:1.35}
.notice{border-radius:10px;padding:11px 14px;margin:14px 0;font-size:13px;line-height:1.5}
.notice.warn{background:#e5b02e1a;color:var(--amber);border:1px solid #e5b02e55}
.notice.bad{background:#e0563c22;color:#ff9a86;border:1px solid #e0563c66}
.notice.info{background:var(--panel);color:var(--ink3);border:1px solid var(--line)}
.bar{display:flex;gap:8px;flex-wrap:wrap;align-items:center;margin:12px 0}
input[type=search]{flex:1;min-width:230px;background:var(--panel);border:1px solid var(--line);
border-radius:9px;padding:9px 13px;color:var(--ink);font:13px system-ui,sans-serif;outline:none}
input[type=search]:focus{border-color:#dd9a5288}
.chip{background:var(--panel);border:1px solid var(--line);border-radius:999px;
padding:6px 13px;font-size:11.5px;color:var(--ink2);cursor:pointer;user-select:none;
white-space:nowrap;transition:.12s}
.chip:hover{border-color:#dd9a5266;color:var(--ink)}
.chip.on{background:#dd9a5222;border-color:var(--copper);color:var(--copper);font-weight:700}
.chip .n{color:var(--ink4);margin-left:6px;font-family:ui-monospace,monospace;font-size:10.5px}
.chip.on .n{color:var(--copper)}
.btn{background:var(--raise);border:1px solid var(--line);border-radius:9px;padding:8px 14px;
color:var(--ink2);font:600 11.5px system-ui,sans-serif;cursor:pointer;letter-spacing:.04em}
.btn:hover{border-color:var(--copper);color:var(--copper)}
table{width:100%;border-collapse:collapse;background:var(--panel);
border:1px solid var(--line);border-radius:12px;overflow:hidden;font-size:12.5px}
th,td{padding:8px 11px;text-align:left;border-bottom:1px solid var(--line);white-space:nowrap}
th{font-size:9.5px;letter-spacing:.11em;text-transform:uppercase;color:var(--ink3);
background:var(--raise);cursor:pointer;user-select:none;position:sticky;top:0;z-index:2}
th:hover{color:var(--copper)}
th .ar{color:var(--copper);font-size:9px}
td{font-variant-numeric:tabular-nums;color:var(--ink2)}
td:last-child{white-space:normal;min-width:210px;line-height:1.35}
tbody tr{cursor:pointer}
tbody tr:hover{background:var(--raise)}
tbody tr.sel{background:#dd9a5218}
td.mono{font-family:ui-monospace,Consolas,monospace;font-size:11.5px}
td .sub{display:block;font-size:10.5px;color:var(--ink4);font-family:system-ui,sans-serif}
.pill{display:inline-block;padding:2px 8px;border-radius:999px;font:700 9.5px/1.6 system-ui,sans-serif;
letter-spacing:.08em;text-transform:uppercase}
.dot{display:inline-block;width:6px;height:6px;border-radius:50%;margin-right:6px;vertical-align:middle}
.muted{color:var(--ink4)}
.legacy{color:var(--ink4);font-style:italic}
#empty{padding:34px;text-align:center;color:var(--ink3);background:var(--panel);
border:1px solid var(--line);border-radius:12px;display:none}
/* detail drawer */
#drawer{position:fixed;top:0;right:0;width:min(620px,94vw);height:100%;background:var(--panel);
border-left:1px solid var(--line);box-shadow:-24px 0 60px #0009;padding:22px 24px 60px;
overflow-y:auto;transform:translateX(102%);transition:transform .18s ease;z-index:40}
#drawer.open{transform:none}
#drawer h3{margin:0;font-size:16px;color:var(--ink);font-weight:700;word-break:break-all}
#drawer .close{position:absolute;top:16px;right:18px;cursor:pointer;color:var(--ink3);
font-size:20px;line-height:1;background:none;border:none}
#drawer .close:hover{color:var(--copper)}
.sec{margin-top:20px}
.sec>.t{font-size:9.5px;letter-spacing:.2em;text-transform:uppercase;color:var(--ink3);
font-weight:700;margin-bottom:7px}
.kv{display:grid;grid-template-columns:132px 1fr;gap:3px 12px;font-size:12.5px}
.kv dt{color:var(--ink4);font-size:11px}
.kv dd{margin:0;color:var(--ink2);font-family:ui-monospace,Consolas,monospace;
font-size:11.5px;word-break:break-all}
.tl{border-left:1px solid var(--line);margin-left:5px;padding-left:15px}
.tl .e{position:relative;padding:5px 0;font-size:12px}
.tl .e:before{content:'';position:absolute;left:-19px;top:11px;width:7px;height:7px;
border-radius:50%;background:var(--ink4);border:2px solid var(--panel)}
.tl .e.k:before{background:var(--copper)}
.tl .e .w{color:var(--ink4);font-family:ui-monospace,monospace;font-size:10.5px;margin-right:8px}
.tl .e .d{display:block;color:var(--ink4);font-size:10.5px;font-family:ui-monospace,monospace;
word-break:break-all;margin-left:2px}
.mrow{display:flex;justify-content:space-between;gap:10px;padding:5px 0;
border-bottom:1px solid var(--line);font-size:12px}
.mrow:last-child{border:0}
.mrow .why{color:var(--ink4);font-size:10.5px;white-space:normal;line-height:1.4;margin-top:2px}
.k-ok{color:var(--green)}.k-sched{color:var(--ink2)}.k-due{color:var(--blue)}
.k-warn{color:var(--amber)}.k-bad{color:var(--red);font-weight:700}.k-na{color:var(--ink4)}
#scrim{position:fixed;inset:0;background:#0007;opacity:0;pointer-events:none;
transition:.18s;z-index:30}
#scrim.on{opacity:1;pointer-events:auto}
#toast{position:fixed;bottom:24px;left:50%;transform:translateX(-50%) translateY(80px);
background:var(--raise);border:1px solid var(--copper);color:var(--copper);padding:11px 20px;
border-radius:10px;font-size:13px;font-weight:600;transition:.2s;z-index:60}
#toast.on{transform:translateX(-50%)}
.foot{margin-top:30px;font-size:11.5px;color:var(--ink4);line-height:1.6}
</style></head><body>
<div class="wrap">
<header>
  <h1>Stride <b>demo CRM</b></h1>
  <span class="meta">__GEN__</span>
  <span class="meta" id="age"></span>
  <a class="meta" href="demo_acq_tracker.html" style="color:var(--copper);text-decoration:none;margin-left:auto">campaign tracker &rarr;</a>
</header>
<div class="meta">__SUBTITLE__</div>
__NOTICES__
<h2>Population</h2>
<div class="tiles">__TILES__</div>
<h2>What we actually know</h2>
<div class="tiles">__CONF__</div>

<h2>Segments</h2>
<div class="bar" id="segs"></div>
<div class="bar">
  <input type="search" id="q" placeholder="Search email, name, source, campaign, ad id, licence key, country">
  <button class="btn" id="copy">Copy emails</button>
  <button class="btn" id="csv">Download CSV</button>
  <button class="btn" id="clear">Clear</button>
</div>
<div class="meta" id="count"></div>
<table id="t"><thead><tr>__HEAD__</tr></thead><tbody id="tb"></tbody></table>
<div id="empty">Nothing matches that filter.</div>
<div class="foot">__FOOT__</div>
</div>
<div id="scrim"></div><aside id="drawer"><button class="close" id="x">&times;</button><div id="body"></div></aside>
<div id="toast"></div>
<script>
const BUILT = __NOW__;
(function age(){
 const el=document.getElementById('age'); if(!el) return;
 const m=Math.round((Date.now()-BUILT)/60000);
 const t = m<1?'just now' : m<60? m+' min old' : Math.round(m/60)+'h old';
 el.textContent='· '+t;
 el.className = m>40 ? 'meta stale' : 'meta';
 if(m>40) el.innerHTML='· '+t+' · <a href="" onclick="location.reload();return false">reload</a>';
 setTimeout(age,30000);
})();
const P = __DATA__;
const NOW = __NOW__;
const SENDS = __SENDS__;
const COLS = [
 {k:'email', t:'Person', w:'person'},
 {k:'stage', t:'Stage', w:'stage'},
 {k:'source', t:'Source', w:'src'},
 {k:'first_ms', t:'First seen', w:'ts'},
 {k:'act_ms', t:'Activated', w:'ts'},
 {k:'exp_ms', t:'Pass ended', w:'ts'},
 {k:'mailn', t:'Mails', w:'mail'},
 {k:'next', t:'Next mail', w:'next'},
 {k:'action', t:'Where they stand', w:'act'}
];
const SEG = [
 {id:'all',      t:'Everyone',            f:p=>true},
 {id:'live',     t:'Pass running now',    f:p=>p.stage==='ACTIVE'},
 {id:'stalled',  t:'Never activated',     f:p=>(p.stage==='REGISTERED'||p.stage==='DOWNLOADED')&&!p.paid},
 {id:'unknown',  t:'Outcome unknown',     f:p=>p.stage==='UNRECORDED'},
 {id:'unused',   t:'Expired, no use seen',f:p=>p.stage==='EXPIRED'&&!p.use_ms},
 {id:'warm',     t:'Expired, no purchase',f:p=>p.stage==='EXPIRED'&&!p.paid},
 {id:'cart',     t:'Checkout, no buy',    f:p=>p.stage==='CHECKOUT'},
 {id:'won',      t:'Bought after a demo', f:p=>p.converted},
 {id:'sameday',  t:'Paid in the same hour',f:p=>p.paid&&!p.converted},
 {id:'tracked',  t:'Fully tracked',       f:p=>p.era==='tracked'},
 {id:'legacy',   t:'Legacy, no journey',  f:p=>p.era==='legacy'},
 {id:'queued',   t:'Mail queued',         f:p=>p.next&&p.next.length>0},
 {id:'done',     t:'Automation finished',  f:p=>p.lc&&p.lc.done&&!p.paid&&!p.suppressed},
 {id:'alert',    t:'Needs a look',        f:p=>p.act_kind==='alert'},
 {id:'stop',     t:'Opted out',           f:p=>p.suppressed}
];
const STAGE_C = {CUSTOMER:'#3ec78f',CHECKOUT:'#e5b02e',ACTIVE:'#7db4e8',
 EXPIRED:'#8fa8c0',DOWNLOADED:'#b8ad9b',REGISTERED:'#857c6e',UNRECORDED:'#5c554a'};
const ACT_C = {alert:'#ff7a5c',hot:'#e5b02e',warm:'#dd9a52',cold:'#857c6e',
 done:'#3ec78f',muted:'#5c554a'};
let seg='all', sortK='first_ms', sortD=-1, view=[];

const esc = s => String(s==null?'':s).replace(/[&<>"]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c]));
function ts(ms,short){ if(!ms) return ''; const d=new Date(ms);
 const p=n=>String(n).padStart(2,'0');
 return d.getFullYear()+'-'+p(d.getMonth()+1)+'-'+p(d.getDate())+(short?'':' '+p(d.getHours())+':'+p(d.getMinutes())); }
function ago(ms){ if(!ms) return ''; const h=(NOW-ms)/3600000;
 if(h<1) return Math.max(0,Math.round(h*60))+'m ago';
 if(h<48) return Math.round(h)+'h ago';
 const d=Math.round(h/24); return d<60? d+'d ago' : Math.round(d/30)+'mo ago'; }

function cell(p,c){
 if(c.w==='person'){
  const tags=[];
  if(p.suppressed) tags.push('<span class="pill" style="background:#5c554a33;color:#857c6e">stop</span>');
  if(p.era==='legacy') tags.push('<span class="legacy">legacy</span>');
  if(p.identity==='confirmed') tags.push('<span class="pill" style="background:#3ec78f22;color:#3ec78f">id ok</span>');
  else if(p.identity) tags.push('<span class="muted">'+esc(p.identity)+'</span>');
  return '<b style="color:var(--ink)">'+esc(p.name||p.email.split('@')[0])+'</b>'+
   '<span class="sub">'+esc(p.email)+(tags.length?' &nbsp;'+tags.join(' '):'')+'</span>';
 }
 if(c.w==='stage'){ const col=STAGE_C[p.stage]||'#857c6e';
  return '<span class="dot" style="background:'+col+'"></span><span style="color:'+col+';font-weight:600">'+p.stage+'</span>'+
   (p.paid&&p.cents?'<span class="sub">'+(p.cents/100).toFixed(0)+' '+esc(p.currency)+'</span>':''); }
 if(c.w==='src'){ const a=p.attr||{};
  const s=a.source||a.utm_source||'';
  return '<span>'+esc(s||'unknown')+'</span>'+(a.utm_content?'<span class="sub">'+esc(a.utm_content)+'</span>':
   (a.campaign_id?'<span class="sub">'+esc(a.campaign_id)+'</span>':'')); }
 if(c.w==='ts'){ const v=p[c.k];
  return v? '<span class="mono">'+ts(v)+'</span><span class="sub">'+ago(v)+'</span>'
          : '<span class="muted">'+(p.era==='legacy'&&(c.k==='act_ms'||c.k==='exp_ms')?'not recorded':'')+'</span>'; }
 if(c.w==='mail'){ if(!p.mails.length) return '<span class="muted">0</span>';
  return '<span class="mono">'+p.mails.length+'</span><span class="sub">'+
   esc(p.mails.map(m=>m.send).join(', ').slice(0,34))+'</span>'; }
 if(c.w==='next'){ if(!p.lc) return '<span class="muted">outside window</span>';
  if(p.next) return '<span class="mono">'+esc(p.next)+'</span>';
  if(p.lc.done) return '<span class="muted">nothing more</span>'+
   (p.lc.why_done?'<span class="sub">'+esc(p.lc.why_done.slice(0,40))+'</span>':'');
  return '<span class="muted">nothing queued</span>'; }
 if(c.w==='act'){ const col=ACT_C[p.act_kind]||'#857c6e';
  return '<span style="color:'+col+'">'+esc(p.act_why)+'</span>'; }
 return esc(p[c.k]);
}

function sortVal(p,k){
 if(k==='email') return (p.name||p.email).toLowerCase();
 if(k==='source') return ((p.attr||{}).source||'zzz').toLowerCase();
 if(k==='mailn') return p.mails.length;
 if(k==='next') return p.next||'zzz';
 if(k==='action') return p.act_why||'';
 if(k==='stage') return ['UNRECORDED','REGISTERED','DOWNLOADED','ACTIVE','EXPIRED','CHECKOUT','CUSTOMER'].indexOf(p.stage);
 return p[k]||0;
}

function render(){
 const q=document.getElementById('q').value.trim().toLowerCase();
 const sf=(SEG.find(s=>s.id===seg)||SEG[0]).f;
 view=P.filter(p=>{
  if(!sf(p)) return false;
  if(!q) return true;
  return p._hay.indexOf(q)>=0;
 });
 view.sort((a,b)=>{ const x=sortVal(a,sortK), y=sortVal(b,sortK);
  return (x>y?1:x<y?-1:0)*sortD; });
 const tb=document.getElementById('tb');
 tb.innerHTML=view.map((p,i)=>'<tr data-i="'+i+'">'+COLS.map(c=>'<td>'+cell(p,c)+'</td>').join('')+'</tr>').join('');
 document.getElementById('empty').style.display=view.length?'none':'block';
 document.getElementById('t').style.display=view.length?'':'none';
 document.getElementById('count').textContent=view.length+' of '+P.length+' people'+(q?' matching "'+q+'"':'');
 document.querySelectorAll('#segs .chip').forEach(c=>c.classList.toggle('on',c.dataset.s===seg));
 document.querySelectorAll('th').forEach(th=>{
  const a=th.querySelector('.ar'); if(a) a.remove();
  if(th.dataset.k===sortK) th.insertAdjacentHTML('beforeend',' <span class="ar">'+(sortD>0?'&#9650;':'&#9660;')+'</span>');
 });
}

function drawer(p){
 const a=p.attr||{}, L=p.license||{};
 const row=(k,v)=>v?'<dt>'+esc(k)+'</dt><dd>'+esc(v)+'</dd>':'';
 let h='<h3>'+esc(p.name||p.email)+'</h3>'+
  '<div class="meta" style="margin-top:4px">'+esc(p.email)+'</div>';

 h+='<div class="sec"><div class="t">Where they stand</div><div style="color:'+(ACT_C[p.act_kind]||'#857c6e')+
    ';font-size:13.5px">'+esc(p.act_why)+'</div>';
 if(p.era==='legacy') h+='<div class="meta" style="margin-top:7px;line-height:1.5">This person took a demo '+
   'before the event log existed, so only the end state was ever written down. Blank fields below mean '+
   'nothing was recorded, not that nothing happened.</div>';
 h+='</div>';

 h+='<div class="sec"><div class="t">Funnel</div><dl class="kv">'+
  row('first seen', ts(p.first_ms)+(p.first_ms?'  ('+ago(p.first_ms)+')':'')) +
  row('registered', ts(p.reg_ms)) + row('demo stamp', ts(p.demo_at_ms)) +
  row('download click', p.dl_ms?ts(p.dl_ms):'') +
  row('activated', p.act_ms?ts(p.act_ms):(p.era==='legacy'?'':'no activation seen')) +
  row('pass ends', ts(p.exp_ms)) +
  row('first real use', p.use_ms?ts(p.use_ms):'not reported') +
  row('checkout', ts(p.chk_ms)) +
  row('purchased', p.paid?(ts(p.paid_ms)||'yes')+(p.cents?'  '+(p.cents/100).toFixed(2)+' '+p.currency:''):'') +
  row('bought after', p.paid?(p.converted?
    (((p.paid_ms-p.first_ms)/86400000).toFixed(1)+' days of holding a demo'):
    'the same checkout, so the demo row is an artefact'):'') +
  row('order', p.order) + row('identity', p.identity) +
  row('opted out', p.suppressed?'yes, excluded from every send':'') +
  '</dl></div>';

 h+='<div class="sec"><div class="t">Attribution</div><dl class="kv">'+
  row('source', a.source) + row('stamped from', a.from) + row('campaign', a.campaign_id) +
  row('ad set', a.adset_id) + row('ad', a.ad_id) + row('utm source', a.utm_source) +
  row('utm campaign', a.utm_campaign) + row('utm content', a.utm_content) +
  row('heard from', a.heard_from) + row('country', a.country) + row('fbclid', a.fbclid) +
  row('ip', a.ip) + row('user agent', a.ua) + '</dl>'+
  (a.source?'':'<div class="meta">No attribution was captured for this person.</div>')+'</div>';

 h+='<div class="sec"><div class="t">Lifecycle mail</div>';
 if(p.mails.length){ h+=p.mails.map(m=>'<div class="mrow"><span><b style="color:var(--ink)">'+esc(m.send)+
   '</b> <span class="muted">'+esc(m.state||'')+'</span></span><span class="mono '+
   (m.status==='sent'?'k-ok':'k-bad')+'">'+esc(m.status)+' '+ts(m.ms)+'</span></div>').join(''); }
 else h+='<div class="meta">Nothing has been sent to this person.</div>';
 if(p.lc){ const pend=SENDS.filter(s=>p.lc.cells[s]).map(s=>{const c=p.lc.cells[s];
   return '<div class="mrow"><span><b style="color:var(--ink)">'+esc(s)+'</b></span><span class="k-'+
    (c.kind||'na')+'" style="text-align:right">'+esc(c.text||'')+
    (c.why?'<span class="why">'+esc(c.why)+'</span>':'')+'</span></div>';}).join('');
  h+='<div class="t" style="margin-top:14px">Queue, as the mailer sees it</div>'+
     (pend||'<div class="meta">Nothing queued.</div>'); }
 else h+='<div class="meta" style="margin-top:10px">This person sits outside the lifecycle mailer&#39;s '+
   'candidate window, so the automation will not send them anything. Any contact has to be manual.</div>';
 h+='</div>';

 if(p.devices.length){ h+='<div class="sec"><div class="t">Machines that ran a pass</div>'+
  p.devices.map(d=>'<dl class="kv">'+row('device',d.device)+row('status',d.status)+
   row('started',ts(d.started))+row('ends',ts(d.exp))+row('ip',d.ip)+row('host',d.ua)+'</dl>').join('<hr style="border:0;border-top:1px solid var(--line);margin:8px 0">')+'</div>'; }

 if(p.claims.length){ h+='<div class="sec"><div class="t">Identity claims by IP</div>'+
  p.claims.map(c=>'<dl class="kv">'+row('ip',c.ip)+row('claimed',c.claimed?'yes':'no')+
   row('by device',c.device)+'</dl>').join('')+'</div>'; }

 if(L.key){ h+='<div class="sec"><div class="t">Licence</div><dl class="kv">'+
  row('key',L.key)+row('status',L.status)+
  row('activations',L.limit?L.used+' of '+L.limit:String(L.used||''))+
  row('validations',L.validations||'')+row('last check',ts(L.last))+'</dl></div>'; }

 if(p.feedback.length){ h+='<div class="sec"><div class="t">Feedback they sent</div>'+
  p.feedback.map(f=>'<div class="mrow"><span>'+esc(f.message)+'</span><span class="mono muted">'+
   ts(f.ms,1)+'</span></div>').join('')+'</div>'; }

 if(p.timeline.length){ h+='<div class="sec"><div class="t">Everything, in order</div><div class="tl">'+
  p.timeline.map(t=>{const key=/purchase|activated|registered|first_use|checkout/.test(t.type);
   return '<div class="e'+(key?' k':'')+'"><span class="w">'+ts(t.ms)+'</span>'+esc(t.type)+
    (t.detail?'<span class="d">'+esc(t.detail)+'</span>':'')+'</div>';}).join('')+'</div></div>'; }
 else h+='<div class="sec"><div class="meta">No event history exists for this person.</div></div>';

 document.getElementById('body').innerHTML=h;
 document.getElementById('drawer').classList.add('open');
 document.getElementById('scrim').classList.add('on');
}
function closeDrawer(){ document.getElementById('drawer').classList.remove('open');
 document.getElementById('scrim').classList.remove('on');
 document.querySelectorAll('#tb tr.sel').forEach(r=>r.classList.remove('sel')); }

function toast(m){ const t=document.getElementById('toast'); t.textContent=m; t.classList.add('on');
 setTimeout(()=>t.classList.remove('on'),2100); }
function copyText(txt,msg){
 const ta=document.createElement('textarea'); ta.value=txt; ta.style.position='fixed';
 ta.style.opacity='0'; document.body.appendChild(ta); ta.select();
 try{ document.execCommand('copy'); toast(msg); }catch(e){ toast('Copy failed'); }
 document.body.removeChild(ta);
}

document.getElementById('segs').innerHTML=SEG.map(s=>{
 const n=P.filter(s.f).length;
 return '<span class="chip" data-s="'+s.id+'">'+s.t+'<span class="n">'+n+'</span></span>';}).join('');
document.querySelectorAll('#segs .chip').forEach(c=>c.onclick=()=>{seg=c.dataset.s;render();});
document.getElementById('q').oninput=render;
document.getElementById('clear').onclick=()=>{seg='all';document.getElementById('q').value='';render();};
document.getElementById('copy').onclick=()=>{
 if(!view.length) return toast('Nothing to copy');
 copyText(view.map(p=>p.email).join('\n'), view.length+' addresses copied');
};
document.getElementById('csv').onclick=()=>{
 const head=['email','name','stage','era','identity','source','campaign','ad_id','country',
  'first_seen','registered','activated','pass_ends','first_use','checkout','purchased',
  'amount','order','mails_sent','next_mail','suppressed','standing'];
 const q=s=>'"'+String(s==null?'':s).replace(/"/g,'""')+'"';
 const rows=view.map(p=>[p.email,p.name,p.stage,p.era,p.identity,(p.attr||{}).source,
  (p.attr||{}).campaign_id,(p.attr||{}).ad_id,(p.attr||{}).country,
  ts(p.first_ms),ts(p.reg_ms),ts(p.act_ms),ts(p.exp_ms),ts(p.use_ms),ts(p.chk_ms),ts(p.paid_ms),
  p.paid&&p.cents?(p.cents/100).toFixed(2)+' '+p.currency:'',p.order,
  p.mails.map(m=>m.send).join('|'),p.next,p.suppressed?'yes':'',p.act_why].map(q).join(','));
 const blob=new Blob([head.map(q).join(',')+'\n'+rows.join('\n')],{type:'text/csv;charset=utf-8'});
 const a=document.createElement('a'); a.href=URL.createObjectURL(blob);
 a.download='stride-demo-crm-'+new Date().toISOString().slice(0,10)+'.csv';
 document.body.appendChild(a); a.click(); document.body.removeChild(a);
 toast(view.length+' rows exported');
};
document.getElementById('tb').onclick=e=>{ const tr=e.target.closest('tr'); if(!tr) return;
 document.querySelectorAll('#tb tr.sel').forEach(r=>r.classList.remove('sel'));
 tr.classList.add('sel'); drawer(view[+tr.dataset.i]); };
document.getElementById('x').onclick=closeDrawer;
document.getElementById('scrim').onclick=closeDrawer;
document.querySelectorAll('th').forEach(th=>th.onclick=()=>{
 const k=th.dataset.k; if(!k) return;
 if(sortK===k) sortD=-sortD; else { sortK=k; sortD=(k==='email'||k==='source')?1:-1; }
 render(); });
document.onkeydown=e=>{ if(e.key==='Escape') closeDrawer();
 if(e.key==='/'&&document.activeElement.id!=='q'){e.preventDefault();document.getElementById('q').focus();} };
render();
</script></body></html>"""


def tile(v, k, s=""):
    return ('<div class="tile"><div class="v">' + str(v) + '</div><div class="k">' + k + '</div>'
            + ('<div class="s">' + s + '</div>' if s else "") + "</div>")


def pct(n, d):
    return "0%" if not d else "%.0f%%" % (100.0 * n / d)


def main():
    now_ms = int(time.time() * 1000)
    if not firebase_admin._apps:
        firebase_admin.initialize_app(credentials.Certificate(SERVICE_KEY))
    db = firestore.client()

    data = load_all(db)
    people = build_people(data, now_ms)

    # The mailer's own verdicts, from the mirror that runs the real demo_lifecycle.
    lc, lc_err = None, None
    try:
        lc = lcm.build(db, data["by_email"], data["anonymous"], now_ms)
    except Exception as e:
        lc_err = "%s: %s" % (type(e).__name__, e)
    attach_lifecycle(people, lc)

    for p in people:
        kind, why = next_action(p, now_ms)
        p["act_kind"], p["act_why"] = kind, why
        a = p["attr"]
        p["_hay"] = " ".join(str(x).lower() for x in (
            p["email"], p["name"], p["stage"], p["era"], p["identity"], p["order"],
            a["source"], a["campaign_id"], a["adset_id"], a["ad_id"], a["utm_source"],
            a["utm_campaign"], a["utm_content"], a["country"], a["heard_from"],
            (p["license"] or {}).get("key", ""), why,
            " ".join(m["send"] or "" for m in p["mails"]))).strip()

    n = len(people)
    st = collections.Counter(p["stage"] for p in people)
    era = collections.Counter(p["era"] for p in people)
    ident = collections.Counter(p["identity"] or "none" for p in people if p["act_ms"])
    activated = sum(1 for p in people if p["act_ms"])
    # Only the tracked era can answer "did they activate". Dividing by everyone would
    # quietly turn 263 unknowns into 263 failures and report a 3% activation rate for a
    # funnel that is actually running near 40%.
    trk = [p for p in people if p["era"] == "tracked"]
    trk_act = sum(1 for p in trk if p["act_ms"])
    # Activations that belong to NOBODY. A pass is granted on a device hash, so an
    # activation the backend could not join to a registration has no email and cannot
    # appear as a row on this page at all. Left unsaid, a per-person CRM silently halves
    # the activation rate: it can only ever count the activations it can name.
    orphan_act = sum(1 for e in data["anonymous"] if e.get("type") == "demo_activated")
    orphan_act += sum(1 for e in data["by_email"].get("", []) if e.get("type") == "demo_activated")
    paid = sum(1 for p in people if p["paid"])
    conv = sum(1 for p in people if p["converted"])
    gaps = sorted((p["paid_ms"] - p["first_ms"]) / 86400000.0
                  for p in people if p["converted"])
    med = gaps[len(gaps) // 2] if gaps else 0
    revenue = sum(p["cents"] for p in people if p["paid"]) / 100.0
    in_window = sum(1 for p in people if p["lc"])
    queued = sum(1 for p in people if p["next"])
    mailed = sum(1 for p in people if p["mails"])
    supp = sum(1 for p in people if p["suppressed"])
    used = sum(1 for p in people if p["use_ms"])
    tracked = era.get("tracked", 0)

    tiles = "".join([
        tile(n, "demo users", "everyone who has ever taken a demo"),
        tile(st.get("ACTIVE", 0), "pass running", "inside their 24 hours right now"),
        tile(st.get("REGISTERED", 0) + st.get("DOWNLOADED", 0), "never activated",
             "tracked era only, where we can tell"),
        tile(st.get("UNRECORDED", 0), "outcome unknown",
             "demoed before anything was logged"),
        tile(st.get("EXPIRED", 0), "pass ended", "no purchase yet"),
        tile(st.get("CHECKOUT", 0), "at checkout", "started, did not finish"),
        tile(conv, "demo then bought",
             "%s of all demo users, median %.1f days later" % (pct(conv, n), med)),
        tile(paid - conv, "paid the same hour",
             "demo row and paid order in one checkout, not a trial"),
        tile("$" + format(revenue, ",.0f"), "from demo users", "gross, every source"),
    ])

    conf = "".join([
        tile(pct(tracked, n), "have a journey",
             "%d of %d. The rest predate the event log." % (tracked, n)),
        tile(pct(trk_act, len(trk)), "activation rate we can name",
             "%d of %d in the tracked era" % (trk_act, len(trk))),
        tile(orphan_act, "activations with no owner",
             "real passes that match no person, so no row here"
             if orphan_act else "every activation is attached to someone"),
        tile(ident.get("confirmed", 0), "identity confirmed",
             "%d matched by ip only, %d never matched" % (
                 ident.get("inferred", 0), ident.get("anonymous", 0) + ident.get("none", 0) + orphan_act)),
        tile(used if used else "off", "real use recorded",
             "the plugin does not report use yet" if not used else "first mapping seen"),
        tile(in_window, "reachable by automation",
             "%d others can only be contacted by hand" % (n - in_window)),
        tile(mailed, "have had a mail", "%d queued next" % queued),
        tile(supp, "opted out", "excluded from every send"),
    ])

    notices = []
    at_risk = (lc or {}).get("paid_at_risk", 0)
    if at_risk:
        notices.append('<div class="notice bad"><b>%d queued send(s) point at someone who has already '
                       'paid.</b> Nothing has left yet. Check the queue below before the next mailer run.</div>'
                       % at_risk)
    if lc is None:
        notices.append('<div class="notice warn">The lifecycle mirror did not run this refresh (%s), so the '
                       '"next mail" column is blank for everyone. Every other column is unaffected.</div>'
                       % html.escape(lc_err or "?"))
    elif not lc.get("backend_ok"):
        notices.append('<div class="notice warn">The real mailer could not be consulted this refresh (%s). '
                       'Mail timings below are computed, not confirmed.</div>'
                       % html.escape(str(lc.get("backend_error") or "?")))
    if n - tracked:
        notices.append('<div class="notice info">%d of these %d people took a demo before the event log '
                       'existed on 2026-08-25. For them we hold the end state and nothing else, and they are '
                       'marked <i>legacy</i> throughout. Their blank activation and mail columns mean nobody '
                       'was watching, not that nothing happened.</div>' % (n - tracked, n))
    if orphan_act:
        notices.append('<div class="notice warn"><b>%d of %d activations belong to nobody on this page.</b> '
                       'A pass is granted on a device hash, so an activation the backend could not join to a '
                       'registration has no address and cannot be a row here. Counting only named activations '
                       'puts the tracked activation rate at %s; counting all of them puts it at up to %s. '
                       'The build carrying the optional email field at activation is what closes this gap.</div>'
                       % (orphan_act, trk_act + orphan_act, pct(trk_act, len(trk)),
                          pct(trk_act + orphan_act, len(trk))))
    if not used:
        notices.append('<div class="notice info">No plugin reports meaningful use yet, so "expired without '
                       'getting anywhere" cannot be separated from "expired after a good session". That split '
                       'arrives with the build that fires <code>demo_first_use</code>.</div>')

    head = "".join('<th data-k="%s">%s</th>' % (c, t) for c, t in (
        ("email", "Person"), ("stage", "Stage"), ("source", "Source"), ("first_ms", "First seen"),
        ("act_ms", "Activated"), ("exp_ms", "Pass ended"), ("mailn", "Mails"),
        ("next", "Next mail"), ("action", "Where they stand")))

    src = (lc or {}).get("source") or "lifecycle mirror unavailable"
    foot = ("Read only. Nothing on this page sends, edits or deletes anything; segments copy addresses "
            "and the send itself stays a deliberate act in send_campaign.py.<br>"
            "Sources: <b>events</b> (%d docs), <b>waitlist</b> (%d rows), <b>vst_passes</b> (%d), "
            "<b>demo_claims</b> (%d), <b>config/email_suppression</b>, <b>feedback</b>. "
            "Mail verdicts come from demo_lifecycle_mirror running the real demo_lifecycle read only: %s.<br>"
            "Click any row for the whole file on that person. Press / to search, Esc to close."
            % (sum(len(v) for v in data["by_email"].values()) + len(data["anonymous"]),
               sum(len(v) for v in data["waitlist"].values()), len(data["passes"]),
               sum(len(v) for v in data["claims"].values()), html.escape(str(src))))

    subtitle = ("Every person who has ever taken a Stride demo, from %s to now. "
                "Regenerated %s." % (
                    fmt(min([p["first_ms"] for p in people if p["first_ms"]] or [0]), False) or "?",
                    fmt(now_ms)))

    page = (PAGE
            .replace("__GEN__", html.escape(fmt(now_ms) + " Israel time"))
            .replace("__SUBTITLE__", subtitle)
            .replace("__NOTICES__", "".join(notices))
            .replace("__TILES__", tiles)
            .replace("__CONF__", conf)
            .replace("__HEAD__", head)
            .replace("__FOOT__", foot)
            .replace("__NOW__", str(now_ms))
            .replace("__SENDS__", json.dumps(list(LIFECYCLE_SENDS)))
            .replace("__DATA__", json.dumps(people, ensure_ascii=False, separators=(",", ":"))))

    with open(OUT, "w", encoding="utf-8", newline="\n") as f:
        f.write(page)

    print("demo CRM written: %s" % OUT)
    print("  %d demo users  |  %s tracked, %s legacy" % (n, tracked, n - tracked))
    print("  stages: " + "  ".join("%s %d" % (k, v) for k, v in st.most_common()))
    print("  activation %s of the tracked era (%d of %d)" % (pct(trk_act, len(trk)), trk_act, len(trk)))
    print("  demo then bought %d (%s, median %.1f days)   same-hour orders %d   revenue $%.2f"
          % (conv, pct(conv, n), med, paid - conv, revenue))
    print("  reachable by automation %d   queued %d   opted out %d" % (in_window, queued, supp))
    if orphan_act:
        print("  %d further activations belong to no known person (rate up to %s)"
              % (orphan_act, pct(trk_act + orphan_act, len(trk))))
    if at_risk:
        print("  !! %d queued send(s) aimed at a paying customer" % at_risk)
    return 0


if __name__ == "__main__":
    sys.exit(main())
