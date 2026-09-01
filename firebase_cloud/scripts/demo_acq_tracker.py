"""Live tracker for the COLD | DEMO ACQUISITION | SALES campaign.

Writes demo_acq_tracker.html, a self-contained dark page that reloads itself
every 5 minutes. Regenerate on a loop with demo_acq_autorefresh.bat (scheduled
task), exactly the HOT59 pattern.

THE NUMBERS COME FROM ONE PLACE. The cohort and every KPI formula are imported
from demo_acq_report.py (build_cohort / compute_kpis), so this page can never
disagree with the CLI report. Meta supplies spend and delivery, nothing else;
its claimed purchases are shown once, labelled reference-only, and used nowhere.

Degrades gracefully: with no Meta token the funnel side still renders and the
media side says so, because a tracker that dies on a token hiccup during a live
campaign is worse than a partial one.
"""
import collections
import datetime
import html
import io
import json
import os
import subprocess
import sys
import time

sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding="utf-8", errors="replace")

import firebase_admin
from firebase_admin import credentials, firestore

from demo_acq_report import (CAMPAIGN_ID, ILS_PER_USD, SERVICE_KEY,
                             build_cohort, compute_kpis, load_events)
import demo_lifecycle_mirror as lcm

HERE = os.path.dirname(os.path.abspath(__file__))
OUT = os.path.join(HERE, "demo_acq_tracker.html")
IL = datetime.timezone(datetime.timedelta(hours=3))
SINCE = "2026-08-26"                      # campaign launch day
GRAPH = "https://graph.facebook.com/v23.0"
# Lifecycle send schedule, for the "next mail" estimate only (display, not logic).
SEND_PLAN = {"start_nudge": 26.0, "post_reg": 72.0, "onboard": 1.25, "post_demo": 3.0}


def get_meta_token():
    token = os.environ.get("META_ACCESS_TOKEN", "")
    if not token:
        try:
            out = subprocess.run(
                "firebase functions:secrets:access META_ACCESS_TOKEN",
                shell=True, capture_output=True, text=True, timeout=60,
                cwd=os.path.dirname(HERE))
            token = out.stdout.strip().splitlines()[-1].strip() if out.stdout.strip() else ""
        except Exception:
            token = ""
    return token


def mg(path, params, token):
    """Meta GET that returns None on ANY failure instead of killing the page."""
    if not token:
        return None
    import urllib.parse
    import urllib.request
    q = urllib.parse.urlencode({"access_token": token, **params})
    try:
        with urllib.request.urlopen(f"{GRAPH}/{path}?{q}", timeout=60) as r:
            j = json.loads(r.read().decode())
        return None if "error" in j else j
    except Exception:
        return None


def act_val(row, *names):
    acts = {a["action_type"]: int(float(a["value"])) for a in (row.get("actions") or [])}
    for n in names:
        if n in acts:
            return acts[n]
    return 0


def fmt_ts(ms):
    return datetime.datetime.fromtimestamp(int(ms) / 1000, IL).strftime("%m-%d %H:%M") if ms else "-"


def state_of(c):
    if c["pur"]:
        return "PURCHASED"
    if c["chk"]:
        return "CHECKOUT"
    if c["act"]:
        return "ACTIVATED"
    return "REGISTERED"


def next_mail(c, sent_keys, now_ms):
    """Best-effort estimate of the next lifecycle touch, for the ops table."""
    if c["pur"] or c["chk"]:
        return "-"                        # owned by checkout recovery / done
    if c["act"]:
        exp = int(c["act"].get("exp_ms") or 0)
        if "onboard" not in sent_keys and now_ms < exp:
            return f"onboard ~{fmt_ts(int(c['act']['ts_ms']) + SEND_PLAN['onboard'] * 3600000)}"
        if "post_demo" not in sent_keys and exp:
            return f"post_demo ~{fmt_ts(exp + SEND_PLAN['post_demo'] * 3600000)}"
        return "-"
    if "start_nudge" not in sent_keys:
        return f"start_nudge ~{fmt_ts(c['reg_ms'] + SEND_PLAN['start_nudge'] * 3600000)}"
    if "post_reg" not in sent_keys:
        return f"post_reg ~{fmt_ts(c['reg_ms'] + SEND_PLAN['post_reg'] * 3600000)}"
    return "-"


def n0(v, fmt="{:,.0f}"):
    return fmt.format(v) if v is not None else "–"


def tile(value, label, sub="", big=False, accent=False):
    cls = "tile big" if big else "tile"
    color = "color:#e58a2e" if accent else ""
    return (f'<div class="{cls}"><div class="v" style="{color}">{value}</div>'
            f'<div class="k">{label}</div>'
            + (f'<div class="s">{sub}</div>' if sub else "") + "</div>")


LC_PILL = {"PURCHASED": "#3ec78f", "CHECKOUT_STARTED": "#e5b02e", "DEMO_ACTIVE": "#7db4e8",
           "DEMO_EXPIRED": "#6f8fb0", "DEMO_NOT_ACTIVATED": "#857c6e", "DEMO_REGISTERED": "#857c6e",
           "UNKNOWN": "#5c554a"}
LC_HEAD = {"activate_nudge": "reg +8h", "friction_rescue": "reg +48h",
           "onboard": "act +75m", "post_demo": "expiry +3h",
           "post_demo_unused": "expiry +3h, unused"}


def render_lifecycle(lc, lc_err):
    """(notice_html, section_html). Every verdict comes from demo_lifecycle_mirror,
    which RUNS the real demo_lifecycle read-only; this only draws it."""
    e = html.escape
    if lc is None:
        msg = e(lc_err or "?")
        return (f'<div class="notice warn">Lifecycle mirror unavailable this refresh: {msg}</div>',
                f'<h2 id="mails">Lifecycle mails</h2><div class="tile"><div class="s">mirror unavailable: {msg}</div></div>')
    rows = lc["rows"]
    cells = [c for r in rows.values() for c in r["cells"].values()]
    n = collections.Counter(c["kind"] for c in cells)
    per_kind = collections.Counter(x.get("send") for x in lc["log"] if x.get("status") == "sent")
    upcoming = sorted((c["due_ms"], s, r["email"]) for r in rows.values()
                      for s, c in r["cells"].items() if c["kind"] in ("sched", "warn", "due") and c["due_ms"])
    nxt = (f"next: {upcoming[0][1]} → {upcoming[0][2].split('@')[0]} {lcm.fmt_ts(upcoming[0][0])}"
           if upcoming else "nothing scheduled")
    skip_why = collections.Counter(c["why"] for c in cells
                                   if c["kind"] == "warn" or (c["kind"] == "bad" and "SKIPPED" in c["text"]))
    top_why = skip_why.most_common(1)[0][0] if skip_why else ""
    n_skip = sum(skip_why.values())
    actions = lc["actions"]
    backend = ("REAL" if lc["backend_ok"] else "n/a",
               f"main.py @{lc.get('source', '?')} (working tree) run dry at {lc['probe_count']} due moments" if lc["backend_ok"]
               else e(str(lc["backend_error"])))

    tiles = "".join([
        tile(f"{n['ok']}", "lifecycle mails sent",
             " · ".join(f"{v} {k}" for k, v in per_kind.items()) or "none yet"),
        tile(f"{n['sched'] + n['warn']}", "scheduled", e(nxt)),
        tile(f"{n['due']}", "due now", "the next 30-min run sends them" if n["due"] else ""),
        tile(f"{n_skip}", "backend will skip", e(top_why), accent=n_skip > 0),
        tile(f"{len(actions)}", "action needed", "send by hand, text below" if actions else "", accent=bool(actions)),
        tile(backend[0], "backend check", backend[1]),
        tile(f"{lc['paid_at_risk']}", "queued for a payer",
             (f"{lc['paid_in_window']} payer(s) in the window · independent check, not the backend's"
              if not lc["paid_at_risk"] else "a paying customer is about to be mailed"),
             accent=bool(lc["paid_at_risk"])),
    ])

    if lc["paid_at_risk"]:
        notice = (f'<div class="notice bad">STOP · {lc["paid_at_risk"]} lifecycle send'
                  f'{"s are" if lc["paid_at_risk"] != 1 else " is"} still queued for someone who has '
                  f'ALREADY PAID · <a href="#mails">see Lifecycle mails</a></div>')
    elif actions:
        notice = (f'<div class="notice bad">ACTION NEEDED · {len(actions)} lifecycle mail'
                  f'{"s" if len(actions) != 1 else ""} will not leave on their own · '
                  f'<a href="#mails">see Lifecycle mails</a></div>')
    elif n["warn"]:
        first = upcoming[0] if upcoming else None
        notice = (f'<div class="notice warn">{n["warn"]} scheduled lifecycle mail{"s" if n["warn"] != 1 else ""} '
                  f'will be SKIPPED by the backend: {e(top_why)} · '
                  + (f'first one {first[1]} at {lcm.fmt_ts(first[0])} · ' if first else "")
                  + 'fix before then or send by hand · <a href="#mails">details</a></div>')
    elif not lc["backend_ok"]:
        notice = f'<div class="notice warn">backend check unavailable: {backend[1]}</div>'
    else:
        notice = ""

    act_html = ""
    for a in actions:
        r = lc["render"](a["send"], a["email"], a["first"])
        body = (f'<details><summary>mail text, ready to send as Joe</summary>'
                f'<pre>To: {e(a["email"])}\nFrom: Joe &lt;home@stridehub.io&gt;\nSubject: {e(r["subject"])}'
                f'\n\n{e(r["text"])}</pre></details>'
                if r else '<div class="why">copy unavailable (backend not importable)</div>')
        act_html += (f'<div class="act"><b>{e(a["send"])}</b> → {e(a["email"])}'
                     f'{(" (" + e(a["first"]) + ")") if a["first"] else ""} · {e(a["text"])} · {e(a["why"])}{body}</div>')
    if actions:
        act_html = '<h2>Action needed · the backend will not send these, send them by hand</h2>' + act_html

    matrix = ""
    for em, r in sorted(rows.items(), key=lambda x: -x[1]["reg_ms"]):
        src_tag = "campaign" if r["campaign"] else ("LS demo" if r["source"] == "demo_downloaded" else "organic /try")
        col = LC_PILL.get(r["state"], "#5c554a")
        who = (f'<b>{e(em)}</b><span class="sub">{e(r["name"]) + " · " if r["name"] else ""}{src_tag}'
               f'{" · SUPPRESSED: " + e(r["suppressed"]) if r["suppressed"] else ""}</span>')
        tds = ""
        for s in lcm.SEND_ORDER:
            c = r["cells"][s]
            tds += (f'<td class="c {c["kind"]}">{e(c["text"])}'
                    + (f'<div class="why">{e(c["why"])}</div>' if c["why"] else "") + "</td>")
        matrix += (f'<tr><td>{who}</td><td>{lcm.fmt_ts(r["reg_ms"])}</td>'
                   f'<td><span class="pill" style="background:{col}22;color:{col};border:1px solid {col}55">'
                   f'{e(r["state"])}</span></td><td>{e(r["identity"])}</td>{tds}</tr>')
    if not matrix:
        matrix = "<tr><td colspan='8'>nobody in the lifecycle window yet</td></tr>"
    heads = "".join(f"<th>{s}<small>{LC_HEAD[s]}</small></th>" for s in lcm.SEND_ORDER)

    log_rows = "".join(
        f'<tr><td>{lcm.fmt_ts(int(x.get("ts_ms") or 0))}</td><td>{e(x.get("send") or "")}</td>'
        f'<td>{e(x.get("email") or "")}</td>'
        f'<td class="{"hi" if x.get("status") == "sent" else ""}">{e(x.get("status") or "")}</td>'
        f'<td>{e(x.get("state") or "")} · {e(x.get("identity") or "")}</td></tr>'
        for x in lc["log"]) or "<tr><td colspan='5'>no lifecycle mail has left yet</td></tr>"

    lib = ""
    for s in lcm.SEND_ORDER:
        want, since_f, delay_h = lc["sends"][s][:3]
        r = lc["render"](s, "EMAIL", "")
        when = f'{want.lower().replace("_", " ")} · {since_f.replace("_ms", "").replace("_", " ")} + {delay_h:g}h'
        lib += (f'<details class="lib"><summary><b>{s}</b> · "{e(r["subject"]) if r else "?"}" · {e(when)}</summary>'
                + (f'<pre>Subject: {e(r["subject"])}\n\n{e(r["text"])}</pre>'
                   f'<div class="why">"Hey," takes the first name when the CRM has one; EMAIL in the checkout link = the recipient.</div>'
                   if r else '<div class="why">copy unavailable</div>') + "</details>")

    section = f"""
<h2 id="mails">Lifecycle mails · who got what, what is due, what the backend will skip</h2>
<div class="grid g7">{tiles}</div>
<div class="foot" style="margin:8px 0 0">Purchase check: the backend re-checks every 30 minutes, per person,
before any send (opt-out list, then a purchase_completed event, then the CRM row) and it fails SAFE, so a
purchase that lands at any point before the send simply cancels it. The tile above is OUR OWN second
opinion, matched case-insensitively across both sources, because the backend's CRM lookup is an exact-case
match and 347 of 350 past buyers exist only in the CRM.</div>
{act_html}
<div class="scroll" style="margin-top:14px"><table>
<tr><th>person</th><th>registered</th><th>state</th><th>identity</th>{heads}</tr>
{matrix}
</table></div>
<div class="foot" style="margin-top:8px">Window: everyone the mailer itself considers (entry event since
{lcm.fmt_ts(lc["window_lo_ms"])}). Two tracks, never both: a DETECTED activation gets onboard + post_demo;
activation never seen gets start_nudge + post_reg. A time is when the send becomes due; the scheduler runs
every 30 minutes, so the mail lands within the following half hour.</div>

<h2>Send log · every lifecycle mail that left, newest first</h2>
<div class="scroll"><table>
<tr><th>time</th><th>send</th><th>to</th><th>status</th><th>state · identity at send</th></tr>
{log_rows}
</table></div>

<h2>Mail library · the four sends, for a manual send</h2>
{lib}
"""
    return notice, section


def main():
    now = datetime.datetime.now(IL)
    now_ms = int(now.timestamp() * 1000)
    until = now.strftime("%Y-%m-%d")

    if not firebase_admin._apps:
        firebase_admin.initialize_app(credentials.Certificate(SERVICE_KEY))
    db = firestore.client()
    by_email, anonymous = load_events(db)
    cohort = build_cohort(by_email, CAMPAIGN_ID)

    # lifecycle mails already sent, per cohort member
    sent_by_email = {}
    for em in cohort:
        sent_by_email[em] = {e.get("send") for e in by_email.get(em, [])
                             if e.get("type") == "demo_mail_sent"}
    mails_sent = collections.Counter(k for s in sent_by_email.values() for k in s)

    # lifecycle mails: the REAL demo_lifecycle, run dry against a copy of these events
    lc, lc_err = None, None
    try:
        lc = lcm.build(db, by_email, anonymous, now_ms)
    except Exception as ex:                          # never let the mirror kill the page
        lc_err = f"{type(ex).__name__}: {ex}"

    launch_ms = int(datetime.datetime.fromisoformat(SINCE + "T00:00:00")
                    .replace(tzinfo=IL).timestamp() * 1000)
    anon_acts = sum(1 for e in anonymous
                    if e.get("type") == "demo_activated"
                    and int(e.get("ts_ms") or 0) >= launch_ms)

    # ── Meta side ────────────────────────────────────────────────────────────
    token = get_meta_token()
    tr = json.dumps({"since": SINCE, "until": until})
    tot = mg(f"{CAMPAIGN_ID}/insights",
             {"time_range": tr, "fields": "spend,impressions,reach,inline_link_clicks,actions"},
             token)
    trow = (tot or {}).get("data", [{}])
    trow = trow[0] if trow else {}
    spend = float(trow.get("spend") or 0) if tot else None
    per_ad = mg(f"{CAMPAIGN_ID}/insights",
                {"time_range": tr, "level": "ad", "limit": "25",
                 "fields": "ad_name,spend,impressions,inline_link_clicks,actions"}, token)
    per_day = mg(f"{CAMPAIGN_ID}/insights",
                 {"time_range": tr, "time_increment": "1", "limit": "90",
                  "fields": "spend,impressions,inline_link_clicks,actions"}, token)

    k = compute_kpis(cohort, spend or 0.0)

    # ── render ───────────────────────────────────────────────────────────────
    e = html.escape
    pill = {"PURCHASED": "#3ec78f", "CHECKOUT": "#e5b02e", "ACTIVATED": "#7db4e8",
            "REGISTERED": "#857c6e"}

    def rate(v, n, d):
        return f"{v * 100:.1f}%" if v is not None else "–", f"{n}/{d}"

    d2p, d2p_sub = rate(k["registered_to_purchase"], k["purchasers"], k["registrations"])
    cpc = (f"ILS {k['cost_per_customer']:,.0f}" if k["cost_per_customer"] is not None
           else "–")
    roas = f"{k['roas']:.2f}x" if k["roas"] is not None else "–"

    primary = "".join([
        tile(d2p, "DEMO → PURCHASE", d2p_sub + " · buyers / registrations", big=True, accent=True),
        tile(cpc, "COST PER DEMO-ACQUIRED CUSTOMER",
             (f"= {spend:,.2f} / {k['purchasers']}" if spend is not None else "spend unavailable"),
             big=True, accent=True),
        tile(f"{k['purchasers']}", "demo-acquired customers", "first entry = this campaign"),
        tile(f"${k['revenue_usd']:,.0f}", "revenue from them",
             f"ILS {k['revenue_ils']:,.0f}"),
        tile(roas, "ROAS (cohort)", "break-even 1.00"),
    ])

    media = "".join([
        tile(f"ILS {n0(spend, '{:,.2f}')}", "spend", f"since {SINCE}"),
        tile(n0(int(trow.get("impressions") or 0) if tot else None), "impressions"),
        tile(n0(int(trow.get("inline_link_clicks") or 0) if tot else None), "link clicks"),
        tile(n0(act_val(trow, "landing_page_view") if tot else None), "landing views"),
        tile((f"ILS {spend / act_val(trow, 'landing_page_view'):,.2f}"
              if tot and act_val(trow, "landing_page_view") else "–"), "per visit"),
        tile(n0(act_val(trow, "omni_purchase", "purchase") if tot else None),
             "Meta claimed buys", "reference only, never used"),
    ])

    act_rate, act_sub = rate(k["activation_rate"], k["activations"], k["registrations"])
    diag = "".join([
        tile(f"{k['registrations']}", "registrations"),
        tile((f"ILS {k['cost_per_registration']:,.2f}"
              if k["cost_per_registration"] is not None else "–"), "per registration"),
        tile(f"{k['activations']}", "identified activations",
             f"+{anon_acts} anonymous since launch · a FLOOR, not a measurement"),
        tile(act_rate, "activation rate", act_sub),
        tile(f"{k['checkouts']}", "reached checkout"),
        tile(f"{sum(mails_sent.values())}", "lifecycle mails sent",
             " · ".join(f"{n} {c}" for n, c in mails_sent.items()) or "none yet"),
    ])

    # per-ad table: Meta delivery x our cohort, ranked buyers -> cost -> regs
    ads_rows = ""
    per_cre = collections.defaultdict(lambda: {"reg": 0, "act": 0, "buy": 0, "rev": 0.0})
    for c in cohort.values():
        key = c["utm_content"] or c["ad_id"] or "(untagged)"
        per_cre[key]["reg"] += 1
        per_cre[key]["act"] += 1 if c["act"] else 0
        per_cre[key]["buy"] += 1 if c["pur"] else 0
        per_cre[key]["rev"] += c["revenue_usd"]
    meta_ads = {r.get("ad_name", ""): r for r in (per_ad or {}).get("data", [])}
    names = sorted(set(per_cre) | set(meta_ads),
                   key=lambda n: (-per_cre[n]["buy"] if n in per_cre else 0,
                                  -(per_cre[n]["reg"] if n in per_cre else 0),
                                  -float((meta_ads.get(n) or {}).get("spend") or 0)))
    for n in names:
        m = meta_ads.get(n, {})
        sp = float(m.get("spend") or 0)
        ours = per_cre.get(n, {"reg": 0, "act": 0, "buy": 0, "rev": 0.0})
        cpb = f"{sp / ours['buy']:,.0f}" if ours["buy"] and sp else "–"
        ads_rows += (f"<tr><td>{e(n)}</td><td>{sp:,.2f}</td>"
                     f"<td>{int(m.get('impressions') or 0):,}</td>"
                     f"<td>{int(m.get('inline_link_clicks') or 0):,}</td>"
                     f"<td>{act_val(m, 'landing_page_view')}</td>"
                     f"<td>{act_val(m, 'lead')}</td>"
                     f"<td class='hi'>{ours['reg']}</td><td>{ours['act']}</td>"
                     f"<td class='hi'>{ours['buy']}</td><td>{cpb}</td></tr>")

    # per-day
    day_rows = ""
    regs_by_day = collections.Counter(
        datetime.datetime.fromtimestamp(c["reg_ms"] / 1000, IL).strftime("%m-%d")
        for c in cohort.values())
    buys_by_day = collections.Counter(
        fmt_ts(c["pur"]["ts_ms"])[:5] for c in cohort.values() if c["pur"])
    for r in (per_day or {}).get("data", []):
        day = r.get("date_start", "")[5:]
        day_rows += (f"<tr><td>{e(day)}</td><td>{float(r.get('spend') or 0):,.2f}</td>"
                     f"<td>{int(r.get('impressions') or 0):,}</td>"
                     f"<td>{int(r.get('inline_link_clicks') or 0):,}</td>"
                     f"<td>{act_val(r, 'landing_page_view')}</td>"
                     f"<td class='hi'>{regs_by_day.get(day, 0)}</td>"
                     f"<td class='hi'>{buys_by_day.get(day, 0)}</td></tr>")
    if per_day is None:
        day_rows = "<tr><td colspan='7'>Meta unavailable this refresh</td></tr>"

    # cohort table
    people = ""
    for em, c in sorted(cohort.items(), key=lambda x: -x[1]["reg_ms"]):
        st = state_of(c)
        sent = sent_by_email.get(em, set())
        revenue = f"${c['revenue_usd']:,.0f}" if c["pur"] else "-"
        people += (f"<tr><td>{e(em)}</td><td>{fmt_ts(c['reg_ms'])}</td>"
                   f"<td>{e((c['utm_content'] or c['ad_id'] or '-').replace('DEMO-ACQ | ', ''))}</td>"
                   f"<td><span class='pill' style='background:{pill[st]}22;color:{pill[st]};"
                   f"border:1px solid {pill[st]}55'>{st}</span></td>"
                   f"<td>{', '.join(sorted(sent)) or '-'}</td>"
                   f"<td>{e(lc['rows'][em]['next'] if lc and em in lc['rows'] else next_mail(c, sent, now_ms))}</td>"
                   f"<td>{revenue}</td></tr>")
    if not people:
        people = "<tr><td colspan='7'>no cohort members yet</td></tr>"

    notice, lifecycle_html = render_lifecycle(lc, lc_err)

    page = f"""<!doctype html>
<html lang="en"><head>
<meta charset="utf-8">
<meta http-equiv="refresh" content="300">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>Demo Acquisition Tracker</title>
<style>
:root{{--bg:#141310;--panel:#1d1b16;--raise:#252119;--line:rgba(216,201,176,.12);
--ink:#ece4d6;--ink2:#b8ad9b;--ink3:#857c6e;--copper:#dd9a52;--ember:#e58a2e}}
*{{box-sizing:border-box}}
body{{margin:0;background:var(--bg);color:var(--ink2);font:15px/1.5 system-ui,'Segoe UI',sans-serif}}
.wrap{{max-width:1200px;margin:0 auto;padding:26px 22px 60px}}
header{{display:flex;flex-wrap:wrap;gap:8px 18px;align-items:baseline;margin-bottom:20px}}
h1{{font-size:19px;color:var(--ink);margin:0;letter-spacing:.02em}}
h1 b{{color:var(--copper)}}
.meta{{font:12px ui-monospace,Consolas,monospace;color:var(--ink3)}}
h2{{font-size:11px;letter-spacing:.22em;text-transform:uppercase;color:var(--ink3);
margin:28px 0 10px;font-weight:800}}
.grid{{display:grid;gap:10px}}
.g5{{grid-template-columns:repeat(5,1fr)}}.g6{{grid-template-columns:repeat(6,1fr)}}
.g7{{grid-template-columns:repeat(7,1fr)}}
@media(max-width:1100px){{.g7{{grid-template-columns:repeat(4,1fr)}}}}
@media(max-width:900px){{.g5,.g6,.g7{{grid-template-columns:repeat(2,1fr)}}}}
.tile{{background:var(--panel);border:1px solid var(--line);border-radius:12px;padding:14px 16px}}
.tile.big{{grid-column:span 1;background:var(--raise)}}
.tile .v{{font:600 26px/1.1 ui-monospace,Consolas,monospace;color:var(--ink);
font-variant-numeric:tabular-nums;letter-spacing:-.02em}}
.tile.big .v{{font-size:34px}}
.tile .k{{margin-top:6px;font-size:11px;letter-spacing:.14em;text-transform:uppercase;
color:var(--ink3);font-weight:700}}
.tile .s{{margin-top:4px;font-size:11.5px;color:var(--ink3)}}
table{{width:100%;border-collapse:collapse;background:var(--panel);border:1px solid var(--line);
border-radius:12px;overflow:hidden;font-size:13px}}
th,td{{padding:8px 12px;text-align:right;border-bottom:1px solid var(--line);white-space:nowrap}}
th:first-child,td:first-child{{text-align:left}}
th{{font-size:10px;letter-spacing:.12em;text-transform:uppercase;color:var(--ink3);
background:var(--raise)}}
td{{font-variant-numeric:tabular-nums;font-family:ui-monospace,Consolas,monospace;color:var(--ink2)}}
td:first-child{{font-family:system-ui,'Segoe UI',sans-serif}}
td.hi{{color:var(--copper);font-weight:700}}
tr:last-child td{{border-bottom:0}}
.pill{{display:inline-block;padding:2px 9px;border-radius:999px;font:700 10px/1.6 system-ui;
letter-spacing:.08em}}
.scroll{{overflow-x:auto}}
.notice{{margin:0 0 18px;padding:10px 14px;border-radius:10px;font-size:13px;font-weight:600}}
.notice.bad{{background:#e0563c22;color:#ff9a86;border:1px solid #e0563c66}}
.notice.warn{{background:#e5b02e1f;color:#e5b02e;border:1px solid #e5b02e55}}
.notice a{{color:inherit}}
td.c{{text-align:left;font-size:12.5px;vertical-align:top}}
td.c .why{{font:11px/1.35 system-ui,'Segoe UI',sans-serif;color:var(--ink3);white-space:normal;
max-width:230px;margin-top:2px}}
td.c.ok{{color:#3ec78f}}td.c.sched{{color:var(--ink2)}}td.c.due{{color:#7db4e8}}
td.c.warn{{color:#e5b02e}}td.c.bad{{color:#ff7a5c;font-weight:700}}td.c.na{{color:#5c554a}}
td .sub{{display:block;font:11px system-ui,'Segoe UI',sans-serif;color:var(--ink3)}}
th small{{display:block;font-weight:400;letter-spacing:0;text-transform:none;color:#5c554a}}
.act{{background:var(--panel);border:1px solid #e0563c55;border-left:3px solid #e0563c;border-radius:10px;
padding:10px 14px;margin:8px 0;font-size:13px}}
.act b{{color:var(--ink)}}
details{{margin-top:6px}}summary{{cursor:pointer;color:var(--copper);font-size:12px}}
pre{{white-space:pre-wrap;background:var(--bg);border:1px solid var(--line);border-radius:8px;padding:12px;
font:12.5px/1.5 ui-monospace,Consolas,monospace;color:var(--ink2);margin:8px 0 0;user-select:all}}
.lib{{background:var(--panel);border:1px solid var(--line);border-radius:10px;padding:8px 14px;margin:6px 0}}
.lib summary b{{color:var(--ink)}}
.foot{{margin-top:26px;font-size:12px;color:var(--ink3);line-height:1.7}}
.foot b{{color:var(--ink2)}}
</style></head><body><div class="wrap">
<header>
  <h1><b>DEMO ACQUISITION</b> · live tracker</h1>
  <a class="meta" href="demo_crm.html" style="color:var(--copper);text-decoration:none">demo CRM &rarr;</a>
  <span class="meta">campaign {CAMPAIGN_ID} · since {SINCE}</span>
  <span class="meta">generated {now.strftime('%Y-%m-%d %H:%M:%S')} IL · page reloads every 5 min</span>
</header>
{notice}
<h2>Primary · judge the campaign on these, nothing else</h2>
<div class="grid g5">{primary}</div>

<h2>Media (Meta: spend and delivery only)</h2>
<div class="grid g6">{media}</div>

<h2>Diagnostic · explains the primary, never a target</h2>
<div class="grid g6">{diag}</div>

<h2>By ad · ranked by buyers, then registrations</h2>
<div class="scroll"><table>
<tr><th>ad</th><th>ILS</th><th>impr</th><th>clicks</th><th>LPV</th><th>Meta leads</th>
<th>our regs</th><th>act</th><th>buys</th><th>ILS/buy</th></tr>
{ads_rows or "<tr><td colspan='10'>Meta unavailable this refresh</td></tr>"}
</table></div>

<h2>By day</h2>
<div class="scroll"><table>
<tr><th>day</th><th>ILS</th><th>impr</th><th>clicks</th><th>LPV</th><th>our regs</th><th>buys</th></tr>
{day_rows}
</table></div>

<h2>Cohort · every acquired person</h2>
<div class="scroll"><table>
<tr><th>email</th><th>registered</th><th>ad</th><th>state</th><th>mails sent</th>
<th>next mail (est)</th><th>revenue</th></tr>
{people}
</table></div>
{lifecycle_html}
<div class="foot">
<b>How to read this.</b> The cohort is anchored on registration: a person whose first entry
carried this campaign's id belongs to it forever, and their purchase joins by email from the
payment webhook. Meta's claimed buys are shown once and used nowhere.
<b>Identified activations are a floor</b>, not a measurement: activation is device-bound and
only becomes a person when the IP correlation succeeds, which cross-device users defeat.
Anonymous activations since launch are counted beside it. Formulas are imported from
demo_acq_report.py, so this page and the CLI can never disagree.
<b>Lifecycle mails are judged by the backend itself:</b> main.py is imported in dry mode and its
demo_lifecycle is run against a copy of the live events, at the real clock and at every due moment.
"will skip" means the deployed logic refused that send; nothing on this page models the rules.
OVERDUE = 45 minutes past due with no claim. Manual send: python demo_lifecycle_mirror.py --mail SEND EMAIL
</div>
</div></body></html>"""

    with open(OUT, "w", encoding="utf-8") as f:
        f.write(page)
    print(f"[Tracker] wrote {OUT}")
    print(f"[Tracker] cohort={k['registrations']} buyers={k['purchasers']} "
          f"spend={'n/a' if spend is None else f'ILS {spend:,.2f}'} "
          f"meta={'ok' if tot else 'UNAVAILABLE'}")
    if lc:
        print(f"[Tracker] lifecycle: people={len(lc['rows'])} actions={len(lc['actions'])} "
              f"backend={'real' if lc['backend_ok'] else 'UNAVAILABLE ' + str(lc['backend_error'])}")
    else:
        print(f"[Tracker] lifecycle mirror FAILED: {lc_err}")


if __name__ == "__main__":
    main()
