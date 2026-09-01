"""READ-ONLY mirror of the demo lifecycle mailer, for the live tracker and the CLI.

    python demo_lifecycle_mirror.py            # who got which mail, what is due, what will be skipped
    python demo_lifecycle_mirror.py --mail post_reg someone@x.com   # the exact text, ready to send by hand

TWO SOURCES, ON PURPOSE
  1. THE REAL BACKEND DECIDES. functions/main.py is imported with the cloud-only
     modules stubbed (the test-harness trick) and DEMO_LIFECYCLE_MODE forced to
     "dry", pointed at an in-memory copy of the live events, and its
     demo_lifecycle() is actually RUN: once at the real clock and once at every
     future due moment (clock faked forward). Its "[DRY] send -> email" lines are
     the verdict on whether a mail will leave. Nothing can be written or sent:
     dry mode returns before the claim, the fake db raises on any write, and the
     real Firestore client is never handed to it.
  2. A small hand mirror of the schedule (DEMO_SENDS) exists ONLY to know WHEN to
     probe and to LABEL why the backend skipped someone. It never decides.

WHY THIS SHAPE. A tracker that re-implements the mailer's rules drifts the first
time the rules change and then reports "working" while nothing is sent. Running
the deployed logic itself cannot drift, and when the backend refuses a send that
the schedule says is due, the page says so and hands over the mail text so it can
be sent by hand.
"""
import contextlib
import datetime
import hashlib
import io
import os
import re
import sys
import time
import types
import urllib.parse

HERE = os.path.dirname(os.path.abspath(__file__))
FUNCTIONS_DIR = os.path.join(os.path.dirname(HERE), "functions")
IL = datetime.timezone(datetime.timedelta(hours=3))

# Mirrors main.DEMO_SENDS; used only when main.py cannot be imported.
# Mirrors main.DEMO_SENDS (5-tuples since the 2026-09-01 resequence: the 5th element
# is a predicate on the derived state). Used only when main.py cannot be imported.
SENDS_DEFAULT = {
    "activate_nudge":   ("DEMO_NOT_ACTIVATED", "registered_at_ms", 8.0,  1788269065969, None),
    "friction_rescue":  ("DEMO_NOT_ACTIVATED", "registered_at_ms", 48.0, 1788269065969, None),
    "onboard":          ("DEMO_ACTIVE",        "activated_at_ms",  1.25, 1787680000000, None),
    "post_demo":        ("DEMO_EXPIRED",       "expires_at_ms",    3.0,  1787744000000, None),
    "post_demo_unused": ("DEMO_EXPIRED",       "expires_at_ms",    3.0,  1788269065969, None),
}
SEND_ORDER = ("activate_nudge", "friction_rescue", "onboard", "post_demo", "post_demo_unused")
ACT_TRACK = ("onboard", "post_demo", "post_demo_unused")   # keyed off a DETECTED activation
REG_TRACK = ("activate_nudge", "friction_rescue")          # activation never seen
ENTRY_TYPES = ("demo_registered", "demo_downloaded", "demo_activated", "demo_expired")
FLOOR_DEFAULT = 1787680000000
MAX_AGE_H_DEFAULT = 336.0
NUDGE_H_DEFAULT = 24.0
LS_BUY_URL_DEFAULT = "https://strideengine.lemonsqueezy.com/checkout/buy/9099d993-aa75-42d5-800f-299445b9350a"

CADENCE_MIN = 30     # Cloud Scheduler runs demo_lifecycle every 30 minutes
GRACE_MIN = 45       # due + cadence + run time; a send still unclaimed after this is OVERDUE
STUCK_MIN = 15       # a claim still "claimed" this long after creation died mid-send


def fmt_ts(ms, with_day=True):
    if not ms:
        return "-"
    d = datetime.datetime.fromtimestamp(int(ms) / 1000, IL)
    return d.strftime("%m-%d %H:%M") if with_day else d.strftime("%H:%M")


def email_key(email):
    return hashlib.sha256((email or "").strip().lower().encode("utf-8")).hexdigest()[:40]


# ── 1. the real backend, imported read-only ─────────────────────────────────
_BACKEND = {"module": None, "error": None, "tried": False}


def load_backend():
    """Import functions/main.py with DEMO_LIFECYCLE_MODE=dry. Returns (module, error)."""
    if _BACKEND["tried"]:
        return _BACKEND["module"], _BACKEND["error"]
    _BACKEND["tried"] = True
    os.environ["DEMO_LIFECYCLE_MODE"] = "dry"        # read at import; can never flip to live here
    try:
        def _pt(*a, **k):
            def deco(fn):
                return fn
            return deco
        ff = types.ModuleType("firebase_functions")
        for _n in ("https_fn", "firestore_fn", "scheduler_fn"):
            m = types.ModuleType(_n)
            m.on_request = _pt
            m.on_schedule = _pt
            m.on_document_created = _pt
            m.Request = object
            m.Response = object
            m.ScheduledEvent = object
            setattr(ff, _n, m)
        _o = types.ModuleType("options")

        class _Mem:
            def __getattr__(self, n):
                return n
        _o.MemoryOption = _Mem()
        _o.set_global_options = lambda *a, **k: None
        _o.SupportedRegion = types.SimpleNamespace(US_CENTRAL1="us-central1")
        _o.CorsOptions = lambda *a, **k: None
        ff.options = _o
        sys.modules["firebase_functions"] = ff
        for _n in ("https_fn", "firestore_fn", "scheduler_fn", "options"):
            sys.modules[f"firebase_functions.{_n}"] = getattr(ff, _n)
        fl = types.ModuleType("flask")
        fl.send_file = lambda *a, **k: None
        fl.jsonify = lambda *a, **k: (a[0] if len(a) == 1 else dict(**k))
        sys.modules["flask"] = fl
        md = types.ModuleType("mido")
        md.Message = object
        md.MidiFile = object
        md.MidiTrack = object
        md.bpm2tempo = lambda *a, **k: 0
        sys.modules["mido"] = md
        import firebase_admin
        if not getattr(firebase_admin, "_apps", None):
            firebase_admin._apps = {"stub": True}     # stop main's initialize_app
        if FUNCTIONS_DIR not in sys.path:
            sys.path.insert(0, FUNCTIONS_DIR)
        with contextlib.redirect_stdout(io.StringIO()):
            import main                                # noqa: the real thing
        if getattr(main, "DEMO_LIFECYCLE_MODE", "") != "dry":
            raise RuntimeError("main.py did not come up in dry mode; refusing to probe")
        _BACKEND["module"] = main
    except Exception as e:                             # the page must survive this
        _BACKEND["error"] = f"{type(e).__name__}: {e}"
    return _BACKEND["module"], _BACKEND["error"]


# ── 2. an in-memory Firestore that can only be read ─────────────────────────
class _Snap:
    def __init__(self, id, d):
        self.id, self._d = id, d

    @property
    def exists(self):
        return self._d is not None

    def to_dict(self):
        return dict(self._d) if self._d is not None else None


class _Query:
    def __init__(self, rows):
        self.rows = rows

    def where(self, field, op, value):
        if op == "==":
            keep = lambda a: a == value
        elif op == ">=":
            keep = lambda a: a is not None and a >= value
        elif op == "<=":
            keep = lambda a: a is not None and a <= value
        else:                                          # loud, so a backend change is noticed
            raise NotImplementedError(f"fake db: operator {op!r}")
        return _Query([(i, r) for i, r in self.rows if keep(r.get(field))])

    def limit(self, n):
        return _Query(self.rows[:n])

    def stream(self):
        return iter(_Snap(i, r) for i, r in self.rows)


class _Ref:
    def __init__(self, id, d):
        self.id, self._d = id, d

    def get(self):
        return _Snap(self.id, self._d)

    def _no(self, *a, **k):
        raise RuntimeError("fake db: WRITE attempted during a read-only probe")
    create = update = set = delete = _no


class _Collection(_Query):
    def __init__(self, rows, docs):
        super().__init__(rows)
        self.docs = docs

    def document(self, id):
        return _Ref(id, self.docs.get(id))


class FakeDb:
    """{collection: (rows [(id, dict)], docs {id: dict})}. Reads only."""
    def __init__(self, data):
        self.data = data

    def collection(self, name):
        rows, docs = self.data.get(name, ([], {}))
        return _Collection(rows, docs)


_DRY_RE = re.compile(r"\[DemoLifecycle\]\[DRY\] (\w+) -> (\S+) \(state=(\w+), identity=(\w+), copy=(\w+)\)")


def probe(main, fake_db, at_ms):
    """Run the REAL demo_lifecycle at clock `at_ms`. Returns {(send, email): copy_ok}."""
    real_time, real_fs = time.time, main.admin_firestore
    main.admin_firestore = types.SimpleNamespace(client=lambda: fake_db, SERVER_TIMESTAMP=None)
    time.time = lambda: at_ms / 1000.0
    buf = io.StringIO()
    try:
        with contextlib.redirect_stdout(buf):
            main.demo_lifecycle(None)
    finally:
        time.time = real_time
        main.admin_firestore = real_fs
    out = buf.getvalue()
    if "mode=dry" not in out:
        raise RuntimeError("probe did not run in dry mode: " + out[-200:])
    return {(m.group(1), m.group(2).lower()): m.group(5).lower() == "yes" for m in _DRY_RE.finditer(out)}


# ── 3. the hand mirror (WHEN to probe, WHY a skip) ──────────────────────────
def _newest_per_type(evs):
    out = {}
    for e in evs:
        t = e.get("type")
        if t and (t not in out or int(e.get("ts_ms") or 0) > int(out[t].get("ts_ms") or 0)):
            out[t] = e
    return out


def hand_state(evs, now_ms, nudge_h=NUDGE_H_DEFAULT):
    """Copy of main.demo_state, for when main.py cannot be imported."""
    ev = _newest_per_type(evs)
    reg = ev.get("demo_registered") or ev.get("demo_downloaded")
    act = ev.get("demo_activated")
    exp_ms = int((act or {}).get("exp_ms") or 0)
    st = {"registered_at_ms": int((reg or {}).get("ts_ms") or 0),
          "activated_at_ms": int((act or {}).get("started_at_ms") or (act or {}).get("ts_ms") or 0),
          "expires_at_ms": exp_ms,
          "identity": (act or {}).get("identity") or ("confirmed" if (act or {}).get("email") else "anonymous"),
          "state": "UNKNOWN"}
    if ev.get("purchase_completed"):
        st["state"] = "PURCHASED"
    elif ev.get("checkout_started"):
        st["state"] = "CHECKOUT_STARTED"
    elif act:
        st["state"] = "DEMO_ACTIVE" if (exp_ms and now_ms < exp_ms) else "DEMO_EXPIRED"
    elif reg:
        st["state"] = ("DEMO_NOT_ACTIVATED"
                       if (now_ms - st["registered_at_ms"]) / 3600000.0 >= nudge_h else "DEMO_REGISTERED")
    return st


# Sends whose refusal is explained by the usage predicate rather than by state or timing.
USAGE_GATED = {
    "post_demo_unused": "needs a KNOWN 'never got anywhere' trial; first-use reporting is off",
    "post_demo":        "suppressed because meaningful use was recorded",
    "onboard":          "suppressed because meaningful use was recorded",
}


def skip_reason(st, suppressed, since, floor_ms, has_copy=True, send=None):
    """Best-effort label for a backend skip, in the backend's own order of checks."""
    if suppressed:
        return suppressed
    if st["state"] in ("PURCHASED", "CHECKOUT_STARTED"):
        return "left nurture: " + st["state"].lower().replace("_", " ")
    if st["state"] == "UNKNOWN":
        return "no registration event"
    if st["state"] == "DEMO_REGISTERED":
        return "under 24h old, nurture has not started"
    if st["identity"] not in ("confirmed", "inferred"):
        return "identity guard (backend labels never-activated people anonymous and skips them)"
    if since and since < floor_ms:
        return "before the no-backfill floor"
    if not has_copy:
        return "no copy defined"
    if send in USAGE_GATED:
        return USAGE_GATED[send]
    return "unknown, compare with the function logs"


def purchased_everywhere(db):
    """Every address that has EVER paid, lowercased, from BOTH sources.

    This is deliberately NOT how the backend checks. `_recovery_is_suppressed`
    queries waitlist with `where("email", "==", email)` using the lowercased
    address the event log gave it, so a CRM row that stored the address with
    capitals would not match and that purchaser would not be suppressed. Today
    347 of 350 purchasers exist ONLY in the CRM (the event log is younger than
    the customer base), so for almost every past buyer that one exact-match
    query is the whole defence. We lowercase on our side and compare, so the
    page can shout if the backend is about to mail somebody who already paid.
    """
    out = set()
    try:
        for d in db.collection("waitlist").stream():
            r = d.to_dict() or {}
            em = (r.get("email") or "").strip().lower()
            if em and (r.get("purchased_at") or r.get("status") == "purchased"):
                out.add(em)
    except Exception:
        pass
    try:
        for d in db.collection("events").where("type", "==", "purchase_completed").stream():
            em = ((d.to_dict() or {}).get("email") or "").strip().lower()
            if em:
                out.add(em)
    except Exception:
        pass
    return out


def _suppressed(email, evs, supp_set, wl_rows):
    if email in supp_set:
        return "opted out"
    if any(e.get("type") == "purchase_completed" for e in evs):
        return "purchased (event)"
    for r in wl_rows:
        if r.get("purchased_at") or r.get("status") == "purchased":
            return "purchased (CRM)"
    return ""


def _source_stamp():
    """Which main.py the verdicts come from: git HEAD short hash, '+local edits' if
    main.py differs from it. The page shows this because the mirror runs the WORKING
    TREE, and prod only matches it once that tree is deployed."""
    try:
        import subprocess
        root = os.path.dirname(os.path.dirname(HERE))
        h = subprocess.run(["git", "rev-parse", "--short", "HEAD"], capture_output=True,
                           text=True, cwd=root, timeout=10).stdout.strip()
        dirty = subprocess.run(["git", "status", "--porcelain", "--", "firebase_cloud/functions/main.py"],
                               capture_output=True, text=True, cwd=root, timeout=10).stdout.strip()
        return (h or "?") + (" +local edits" if dirty else "")
    except Exception:
        return "?"


# ── 4. build the picture ─────────────────────────────────────────────────────
def build(db, by_email, anonymous, now_ms):
    """db = real Firestore client (reads only); by_email/anonymous = load_events() output.
    Returns a dict the tracker renders and the CLI prints."""
    main, err = load_backend()
    source = _source_stamp()
    sends = dict(main.DEMO_SENDS) if main else dict(SENDS_DEFAULT)
    max_age_h = float(getattr(main, "DEMO_LIFECYCLE_MAX_AGE_H", MAX_AGE_H_DEFAULT))
    floor_ms = int(getattr(main, "DEMO_LIFECYCLE_FLOOR_MS", FLOOR_DEFAULT))
    nudge_h = float(getattr(main, "DEMO_NUDGE_ACTIVATE_H", NUDGE_H_DEFAULT))
    buy_url = getattr(main, "LS_BUY_URL", LS_BUY_URL_DEFAULT)

    # the mailer's own candidate window
    lo = max(now_ms - int(max_age_h * 3600000), floor_ms)
    emails = sorted({em for em, evs in by_email.items()
                     if any(e.get("type") in ENTRY_TYPES and lo <= int(e.get("ts_ms") or 0) <= now_ms
                            for e in evs)} - {""})

    # real reads: suppression list + CRM rows for the window
    supp_set, supp_doc = set(), None
    try:
        snap = db.collection("config").document("email_suppression").get()
        supp_doc = snap.to_dict() if snap.exists else None
        supp_set = {e.strip().lower() for e in ((supp_doc or {}).get("emails") or [])}
    except Exception:
        pass
    paid = purchased_everywhere(db)
    wl = {}
    for em in emails:
        try:
            wl[em] = [(d.id, d.to_dict() or {}) for d in
                      db.collection("waitlist").where("email", "==", em).limit(3).stream()]
        except Exception:
            wl[em] = []

    # the in-memory copy the real function is run against
    ev_rows = [(e.get("_id") or f"{e.get('type')}__{i}", {k: v for k, v in e.items() if k != "_id"})
               for i, e in enumerate([x for evs in by_email.values() for x in evs] + list(anonymous))]
    fake = FakeDb({"events": (ev_rows, {}),
                   "config": ([], {"email_suppression": supp_doc}),
                   "waitlist": ([r for rows in wl.values() for r in rows], {})})

    def state_at(em, at_ms):
        if main:
            return main.demo_state(fake, em, at_ms)
        return hand_state(by_email.get(em, []), at_ms, nudge_h)

    rows, probes = {}, {}
    for em in emails:
        evs = by_email.get(em, [])
        st = state_at(em, now_ms)
        wl_rows = [r for _, r in wl.get(em, [])]
        name = next((r.get("name", "").strip() for r in wl_rows if (r.get("name") or "").strip()), "")
        first = name.split(" ")[0] if name else ""
        sup = _suppressed(em, evs, supp_set, wl_rows)
        sent = {}
        for e in evs:
            if e.get("type") == "demo_mail_sent" and e.get("send"):
                sent[e["send"]] = {"ts_ms": int(e.get("ts_ms") or 0), "status": e.get("status") or "?"}
        act_seen = any(e.get("type") == "demo_activated" for e in evs)
        entry = next((e for e in evs if e.get("type") in ("demo_registered", "demo_downloaded")), None)
        row = {"email": em, "name": name, "first": first, "state": st["state"],
               "paid": em in paid,
               "identity": st["identity"], "reg_ms": st["registered_at_ms"],
               "act_ms": st["activated_at_ms"], "exp_ms": st["expires_at_ms"],
               "suppressed": sup, "sent": sent, "cells": {}, "next": "-",
               "campaign": bool(entry and entry.get("campaign_id")),
               "source": (entry or {}).get("type", "")}
        for send in SEND_ORDER:
            want_state, since_field, delay_h, s_floor = sends[send][:4]
            on_track = send in (ACT_TRACK if act_seen else REG_TRACK)
            rec = sent.get(send)
            cell = {"kind": "na", "text": "–", "why": "", "due_ms": 0, "action": False}
            if rec:
                if rec["status"] == "sent":
                    cell = {"kind": "ok", "text": "✓ sent " + fmt_ts(rec["ts_ms"]), "why": "",
                            "due_ms": 0, "action": False}
                elif rec["status"] == "claimed" and now_ms - rec["ts_ms"] < STUCK_MIN * 60000:
                    cell = {"kind": "due", "text": "sending…", "why": "", "due_ms": 0, "action": False}
                elif rec["status"] == "claimed":
                    cell = {"kind": "bad", "text": "✗ STUCK " + fmt_ts(rec["ts_ms"]),
                            "why": "claimed, never sent", "due_ms": 0, "action": True}
                else:
                    cell = {"kind": "bad", "text": "✗ FAILED " + fmt_ts(rec["ts_ms"]),
                            "why": "Resend call failed, slot is burned", "due_ms": 0, "action": True}
            elif not on_track or st["state"] in ("PURCHASED", "CHECKOUT_STARTED", "UNKNOWN"):
                if send == "onboard" and act_seen and st["state"] == "DEMO_EXPIRED":
                    cell["text"], cell["why"] = "missed", "pass ended before it fired"
                elif on_track and st["state"] == "PURCHASED":
                    cell["why"] = "purchased, nothing sends"      # re-checked at every run, not at scheduling
                elif on_track and st["state"] == "CHECKOUT_STARTED":
                    cell["why"] = "reached checkout, recovery mail owns them"
            else:
                since = int(st.get(since_field) or 0)
                if not since:
                    pass
                elif since < s_floor:
                    cell = {"kind": "na", "text": "floor", "why": "moment predates the send's ship date",
                            "due_ms": 0, "action": False}
                else:
                    due = since + int(delay_h * 3600000)
                    cell["due_ms"] = due
                    probe_at = max(now_ms, due + 60000)
                    probes.setdefault(probe_at, []).append((em, send, since, s_floor))
                    cell["_since"] = since
                    cell["_floor"] = s_floor
                    cell["kind"] = "pending"
            row["cells"][send] = cell
        rows[em] = row

    # ask the real backend at every due moment
    backend_ok = main is not None
    probe_err = None
    verdicts = {}
    if backend_ok:
        for at_ms in sorted(probes):
            try:
                verdicts[at_ms] = probe(main, fake, at_ms)
            except Exception as e:
                backend_ok, probe_err = False, f"{type(e).__name__}: {e}"
                break

    for at_ms, items in probes.items():
        for em, send, since, s_floor in items:
            row = rows[em]
            cell = row["cells"][send]
            due = cell["due_ms"]
            overdue = now_ms > due + GRACE_MIN * 60000
            is_due = now_ms >= due
            if not backend_ok:
                cell["kind"] = "bad" if overdue else ("due" if is_due else "sched")
                cell["text"] = (("OVERDUE since " if overdue else ("due " if is_due else "~")) + fmt_ts(due))
                cell["why"] = "backend unavailable, unverified"
                cell["action"] = overdue
                continue
            will = (send, em) in verdicts.get(at_ms, {})
            copy_ok = verdicts.get(at_ms, {}).get((send, em), True)
            if will and copy_ok:
                if overdue:
                    cell.update(kind="bad", text="✗ OVERDUE since " + fmt_ts(due + GRACE_MIN * 60000),
                                why="backend would send it, yet nothing was claimed: is the scheduler running?",
                                action=True)
                elif is_due:
                    cell.update(kind="due", text="due, next run", why="backend confirms")
                else:
                    cell.update(kind="sched", text="~" + fmt_ts(due), why="backend confirms")
            else:
                st_then = state_at(em, at_ms)
                why = skip_reason(st_then, row["suppressed"], since, s_floor,
                                  has_copy=copy_ok, send=send)
                if overdue or is_due:
                    cell.update(kind="bad", text="✗ SKIPPED " + fmt_ts(due), why=why, action=True)
                else:
                    cell.update(kind="warn", text="⚠ " + fmt_ts(due) + " will skip", why=why, action=False)
            cell.pop("_since", None)
            cell.pop("_floor", None)

    # INDEPENDENT purchase cross-check: the backend must never mail someone who paid.
    # Runs last, so it overrides whatever the probe concluded.
    at_risk = 0
    for em, row in rows.items():
        if not row["paid"]:
            continue
        for s_key, cell in row["cells"].items():
            if cell["kind"] in ("sched", "due", "pending", "warn"):
                at_risk += 1
                cell.update(kind="bad", action=True,
                            text="✗ PURCHASED " + (fmt_ts(cell["due_ms"]) if cell["due_ms"] else ""),
                            why="this person has already paid and the backend still has this send "
                                "queued - do not let it leave")
            elif cell["kind"] == "na" and not cell["why"]:
                cell["why"] = "purchased"

    # per-person "next" + the action list
    actions = []
    for em, row in rows.items():
        nxt = [(c["due_ms"], s) for s, c in row["cells"].items() if c["kind"] in ("sched", "due", "warn") and c["due_ms"]]
        if nxt:
            d, s = min(nxt)
            row["next"] = f"{s} {row['cells'][s]['text']}"
        for s in SEND_ORDER:
            c = row["cells"][s]
            if c["action"]:
                actions.append({"email": em, "first": row["first"], "send": s, "text": c["text"], "why": c["why"]})

    log = sorted((dict(e, email=em) for em, evs in by_email.items() for e in evs
                  if e.get("type") == "demo_mail_sent"),
                 key=lambda e: -int(e.get("ts_ms") or 0))

    def render(send, email, first=""):
        if not main:
            return None
        url = f"{buy_url}?checkout[email]={urllib.parse.quote(email)}"
        r = main._demo_send_render(send, first, url)
        return None if not r else {"subject": r[0], "text": r[1]}

    return {"rows": rows, "actions": actions, "log": log, "window_lo_ms": lo, "floor_ms": floor_ms,
            "backend_ok": backend_ok, "backend_error": err or probe_err, "source": source,
            "paid_in_window": sum(1 for r in rows.values() if r["paid"]), "paid_at_risk": at_risk,
            "probe_count": len(probes), "sends": sends, "render": render,
            "now_verdict": sorted(verdicts.get(min(probes), {}).keys())
            if probes and min(probes) <= now_ms + 1 and backend_ok else []}


# ── 5. CLI ───────────────────────────────────────────────────────────────────
def _cli():
    import argparse
    import collections
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--mail", nargs=2, metavar=("SEND", "EMAIL"), help="print one mail's text for a manual send")
    a = ap.parse_args()
    sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding="utf-8", errors="replace")
    import firebase_admin
    from firebase_admin import credentials, firestore
    from demo_acq_report import SERVICE_KEY, load_events
    if not firebase_admin._apps:
        firebase_admin.initialize_app(credentials.Certificate(SERVICE_KEY))
    db = firestore.client()
    by_email, anonymous = load_events(db)
    now_ms = int(time.time() * 1000)
    pic = build(db, by_email, anonymous, now_ms)

    if a.mail:
        send, em = a.mail[0], a.mail[1].strip().lower()
        row = pic["rows"].get(em, {})
        r = pic["render"](send, em, row.get("first", ""))
        if not r:
            sys.exit(f"cannot render {send}: {pic['backend_error'] or 'no copy'}")
        print(f"To: {em}\nFrom: Joe <home@stridehub.io>\nSubject: {r['subject']}\n\n{r['text']}")
        return

    print("=" * 78)
    print(f" DEMO LIFECYCLE MAILS  ·  now {fmt_ts(now_ms)} IL  ·  window since {fmt_ts(pic['window_lo_ms'])}")
    print(f" backend: {'REAL main.py @' + pic['source'] + ' (working tree) run dry at ' + str(pic['probe_count']) + ' due moments' if pic['backend_ok'] else 'UNAVAILABLE: ' + str(pic['backend_error'])}")
    print("=" * 78)
    for em, row in sorted(pic["rows"].items(), key=lambda x: -x[1]["reg_ms"]):
        print(f"\n {em}  {('(' + row['name'] + ')') if row['name'] else ''}  reg {fmt_ts(row['reg_ms'])}  "
              f"{row['state']}  identity={row['identity']}"
              + (f"  SUPPRESSED: {row['suppressed']}" if row["suppressed"] else ""))
        for s in SEND_ORDER:
            c = row["cells"][s]
            print(f"     {s:<12} {c['text']:<28} {c['why']}")
    print("\n" + "-" * 78)
    print(f" sent so far: {dict(collections.Counter(e.get('send') for e in pic['log'])) or 'none'}")
    print(f" purchase cross-check: {pic['paid_in_window']} payer(s) in the window, "
          f"{pic['paid_at_risk']} send(s) still queued for them"
          + ("  <-- FIX THIS" if pic["paid_at_risk"] else "  (clean)"))
    print(f" would send on the very next run: {pic['now_verdict'] or 'nothing'}")
    if pic["actions"]:
        print(f"\n ACTION NEEDED ({len(pic['actions'])}), send by hand  ->  python demo_lifecycle_mirror.py --mail SEND EMAIL")
        for x in pic["actions"]:
            print(f"   {x['send']:<12} {x['email']:<36} {x['text']}  ·  {x['why']}")
    else:
        print("\n nothing needs a manual send")
    print("=" * 78)


if __name__ == "__main__":
    _cli()
