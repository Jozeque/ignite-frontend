"""Regression tests for the /try demo funnel (2026-08-25).

Runs against the REAL main.py, not a copy: the cloud deps that are not installed
locally (firebase_functions, flask, mido, genai) are stubbed just far enough that
the module imports, so the logic under test is the code that actually ships.

No network, no credentials, no Firestore. The Firestore surfaces the functions
touch are faked, so these assert BEHAVIOUR (precedence, windows, dedupe, the
one-candidate rule) rather than the presence of a line of code.

    python test_demo_funnel.py
"""
import sys, types, time, hashlib

# ── stub the cloud-only imports ──────────────────────────────────────────────
def _passthrough_decorator(*a, **k):
    def deco(fn):
        return fn
    return deco

ff = types.ModuleType("firebase_functions")
for _name in ("https_fn", "firestore_fn", "scheduler_fn"):
    m = types.ModuleType(_name)
    m.on_request = _passthrough_decorator
    m.on_schedule = _passthrough_decorator
    m.on_document_created = _passthrough_decorator
    m.Request = object
    m.Response = object
    m.ScheduledEvent = object
    setattr(ff, _name, m)
_opts = types.ModuleType("options")
class _Mem:
    """Any MemoryOption main.py reaches for resolves to a string."""
    def __getattr__(self, name):
        return name
_opts.MemoryOption = _Mem()
_opts.set_global_options = lambda *a, **k: None
_opts.SupportedRegion = types.SimpleNamespace(US_CENTRAL1="us-central1")
_opts.CorsOptions = lambda *a, **k: None
ff.options = _opts
sys.modules["firebase_functions"] = ff
for _n in ("https_fn", "firestore_fn", "scheduler_fn", "options"):
    sys.modules[f"firebase_functions.{_n}"] = getattr(ff, _n)

flask = types.ModuleType("flask")
flask.send_file = lambda *a, **k: None
flask.jsonify = lambda *a, **k: (a[0] if len(a) == 1 else dict(**k))
sys.modules["flask"] = flask

for _mod in ("mido",):
    m = types.ModuleType(_mod)
    m.Message = object; m.MidiFile = object; m.MidiTrack = object
    m.bpm2tempo = lambda *a, **k: 0
    sys.modules[_mod] = m

import firebase_admin
if not getattr(firebase_admin, "_apps", None):
    firebase_admin._apps = {"stub": True}          # stop initialize_app from running

import main   # the real thing

PASSED = FAILED = 0
def ok(name, cond, detail=""):
    global PASSED, FAILED
    if cond:
        PASSED += 1
    else:
        FAILED += 1
        print(f"  FAIL  {name}" + (f"  -- {detail}" if detail else ""))

H = 3600000
NOW = int(time.time() * 1000)


# ── fakes ────────────────────────────────────────────────────────────────────
class FakeDoc:
    def __init__(self, data, doc_id="d"):
        self._d = dict(data); self.id = doc_id
        self.reference = self
        self.updated = None
    def to_dict(self):
        return dict(self._d)
    def update(self, patch):
        self.updated = dict(patch); self._d.update(patch)

class FakeQuery:
    def __init__(self, rows):
        self._rows = rows
    def where(self, *a, **k):
        return self
    def limit(self, *a, **k):
        return self
    def stream(self):
        return iter(self._rows)

class FakeCollection:
    def __init__(self, rows):
        self._rows = rows
    def where(self, *a, **k):
        return FakeQuery(self._rows)
    def limit(self, *a, **k):
        return FakeQuery(self._rows)
    def stream(self):
        return iter(self._rows)

class FakeDb:
    def __init__(self, by_collection):
        self._c = by_collection
    def collection(self, name):
        return FakeCollection(self._c.get(name, []))


def events(*rows):
    return FakeDb({main.EVENTS_COLLECTION: [FakeDoc(r, r.get("type", "e")) for r in rows]})


# ── 1. email key: deterministic, safe as a Firestore id ──────────────────────
print("test_demo_funnel.py")
k1 = main._email_key("Alice@Example.COM ")
k2 = main._email_key("alice@example.com")
ok("email key is case/whitespace insensitive", k1 == k2)
ok("email key has no path separator", "/" not in k1 and len(k1) == 40)
ok("different emails get different keys", main._email_key("a@b.com") != main._email_key("c@d.com"))


# ── 2. lifecycle precedence ──────────────────────────────────────────────────
E = "u@x.com"
reg = {"type": "demo_registered", "email": E, "ts_ms": NOW - 50 * H}
act = {"type": "demo_activated", "email": E, "ts_ms": NOW - 40 * H,
       "started_at_ms": NOW - 40 * H, "exp_ms": NOW - 16 * H, "identity": "inferred"}
act_live = dict(act, exp_ms=NOW + 5 * H)
chk = {"type": "checkout_started", "email": E, "ts_ms": NOW - 2 * H}
buy = {"type": "purchase_completed", "email": E, "ts_ms": NOW - 1 * H}

ok("registered only -> DEMO_REGISTERED",
   main.demo_state(events(dict(reg, ts_ms=NOW - 1 * H)), E, NOW)["state"] == "DEMO_REGISTERED")
ok("registered and past the window -> DEMO_NOT_ACTIVATED",
   main.demo_state(events(reg), E, NOW)["state"] == "DEMO_NOT_ACTIVATED")
ok("inside the pass -> DEMO_ACTIVE",
   main.demo_state(events(reg, act_live), E, NOW)["state"] == "DEMO_ACTIVE")
ok("past exp_ms -> DEMO_EXPIRED",
   main.demo_state(events(reg, act), E, NOW)["state"] == "DEMO_EXPIRED")
ok("checkout OUTRANKS an expired demo",
   main.demo_state(events(reg, act, chk), E, NOW)["state"] == "CHECKOUT_STARTED")
ok("checkout OUTRANKS a live demo",
   main.demo_state(events(reg, act_live, chk), E, NOW)["state"] == "CHECKOUT_STARTED")
ok("purchase outranks EVERYTHING",
   main.demo_state(events(reg, act_live, chk, buy), E, NOW)["state"] == "PURCHASED")
ok("purchase alone is PURCHASED",
   main.demo_state(events(buy), E, NOW)["state"] == "PURCHASED")
ok("no events at all -> UNKNOWN, never a demo state",
   main.demo_state(events(), E, NOW)["state"] == "UNKNOWN")
# an LS $0 order is still a registration, so the old path keeps working
ok("legacy LS demo_downloaded counts as a registration",
   main.demo_state(events({"type": "demo_downloaded", "email": E, "ts_ms": NOW - 50 * H}), E, NOW)["state"]
   == "DEMO_NOT_ACTIVATED")

st = main.demo_state(events(reg, act), E, NOW)
ok("state carries the real timestamps", st["registered_at_ms"] == NOW - 50 * H
   and st["activated_at_ms"] == NOW - 40 * H and st["expires_at_ms"] == NOW - 16 * H)
ok("state carries how identity was obtained", st["identity"] == "inferred")


# ── 3. IP correlation: the rule that stops a wrong identity ──────────────────
def claims(*rows):
    return FakeDb({main.DEMO_CLAIMS_COLLECTION: [FakeDoc(r, f"c{i}") for i, r in enumerate(rows)]})

fresh = {"email": "a@b.com", "ip": "1.2.3.4", "registered_at_ms": NOW - 1 * H, "claimed": False}
old   = {"email": "c@d.com", "ip": "1.2.3.4",
         "registered_at_ms": NOW - int(main.DEMO_CLAIM_WINDOW_H * H) - 5 * H, "claimed": False}
used  = {"email": "e@f.com", "ip": "1.2.3.4", "registered_at_ms": NOW - 1 * H, "claimed": True}

got = main._demo_claim_for_ip(claims(fresh), "1.2.3.4", NOW)
ok("exactly one fresh candidate matches", got is not None and got.to_dict()["email"] == "a@b.com")
ok("two live candidates -> NO match (shared network stays anonymous)",
   main._demo_claim_for_ip(claims(fresh, dict(fresh, email="z@z.com")), "1.2.3.4", NOW) is None)
ok("an expired registration is not matched",
   main._demo_claim_for_ip(claims(old), "1.2.3.4", NOW) is None)
ok("an already-claimed registration is not matched again",
   main._demo_claim_for_ip(claims(used), "1.2.3.4", NOW) is None)
ok("old + fresh still resolves to the fresh one",
   (main._demo_claim_for_ip(claims(old, fresh), "1.2.3.4", NOW) or FakeDoc({})).to_dict().get("email") == "a@b.com")
ok("no IP -> no match", main._demo_claim_for_ip(claims(fresh), "", NOW) is None)


# ── 3b. no activation may be silently dropped ────────────────────────────────
# Support grants "24 more hours" by DELETING vst_passes/<device>, which mints a genuinely
# new pass on the same machine. Keyed on the device alone, that second activation collided
# with the first and vanished from the funnel entirely.
src_pass = inspect.getsource(main._handle_start_pass) if False else None   # (imported below)
import inspect as _inspect
_sp = _inspect.getsource(main._handle_start_pass)
ok("activation is keyed per PASS, not per device",
   'f"{device}__{started_at}"' in _sp,
   "a re-granted pass on the same machine would collide with the first and be lost")
ok("the activation event is written on EVERY successful mint",
   _sp.index("dev_ref.set(") < _sp.index('_log_event("demo_activated"'))
_se = _inspect.getsource(main.demo_expiry_sweep)
ok("expiry is keyed per pass too, so a re-grant gets its own end",
   "started_at_ms" in _se and "__" in _se)

# ── 4. the sends are configured, and OFF ─────────────────────────────────────
ok("lifecycle mail is OFF by default", main.DEMO_LIFECYCLE_MODE == "off")
ok("expiry sweep is ON by default (it only records, never mails)",
   main.DEMO_EXPIRY_SWEEP_MODE == "on")
ok("every send maps to exactly one state",
   {v[0] for v in main.DEMO_SENDS.values()} == {"DEMO_NOT_ACTIVATED", "DEMO_ACTIVE", "DEMO_EXPIRED"})
ok("no send targets CHECKOUT_STARTED or PURCHASED",
   not {"CHECKOUT_STARTED", "PURCHASED"} & {v[0] for v in main.DEMO_SENDS.values()})
ok("each send measures its delay from a field the state provides",
   all(v[1] in ("registered_at_ms", "activated_at_ms", "expires_at_ms")
       for v in main.DEMO_SENDS.values()))
ok("timings are env-configurable in ONE place",
   main.DEMO_NUDGE_ACTIVATE_H > 0 and main.DEMO_ONBOARD_H > 0 and main.DEMO_POST_EXPIRY_H > 0)


# ── 4b. THE ONBOARD MAIL (send B) ────────────────────────────────────────────
ok("onboard fires 75 minutes after activation, measured from activated_at_ms",
   abs(main.DEMO_ONBOARD_H - 1.25) < 1e-9 and main.DEMO_SENDS["onboard"][1] == "activated_at_ms")
ok("onboard and post_demo have copy; activate_nudge still refuses",
   set(main.DEMO_SEND_COPY) == {"onboard", "post_demo"} and
   main._demo_send_render("activate_nudge") is None)

subj, txt, html = main._demo_send_render("onboard", "")
ok("subject is exact", subj == "Try this with a synth you already know")
ok("no name -> 'Hey,' with no stray space", txt.startswith("Hey,\n"))
s2, t2, h2 = main._demo_send_render("onboard", "Dana Levi")
ok("first name only, templated into text AND html",
   t2.startswith("Hey Dana,\n") and "Hey Dana," in h2 and "{name_part}" not in t2 + h2)

# the mail's contract: session guidance and NOTHING else
for needle in ["don't overthink the first session",
               "synth you already know well",
               "change the character of the sound",
               "Lock what works. Push the rest somewhere else.",
               "let your taste decide what stays",
               "I read every one"]:
    ok("body carries: " + needle[:40], needle in txt and needle in html)
ok("NO purchase CTA, price, discount or link",
   all(b not in (txt + html).lower() for b in
       ["buy", "purchase", "price", "$", "discount", "% off", "stridehub.io", "http://", "https://"]))
ok("no em dash anywhere in the mail", chr(8212) not in txt and chr(8212) not in html)
ok("the opt-out line rides along", "Reply STOP to opt out" in txt and "Reply STOP to opt out" in html)

# suppression is the STATE MACHINE: checkout/purchase before send time changes the state,
# so the pending onboard simply never fires
mid_pass_checkout = events(reg, act_live, chk)
ok("checkout during the pass cancels the onboard (state leaves DEMO_ACTIVE)",
   main.demo_state(mid_pass_checkout, E, NOW)["state"] == "CHECKOUT_STARTED")
mid_pass_buy = events(reg, act_live, buy)
ok("purchase during the pass cancels it too",
   main.demo_state(mid_pass_buy, E, NOW)["state"] == "PURCHASED")

# the loop's own guards, asserted on the real source
import inspect as _insp
_dl = _insp.getsource(main.demo_lifecycle)
ok("only identified activations may be mailed",
   'if st["identity"] not in ("confirmed", "inferred"):' in _dl)
ok("dedupe: one claim per send+email, first writer wins",
   'claim_id = f"demo_mail_sent__{send_key}__{_email_key(email)}"' in _dl and ".create(" in _dl)
ok("a send failure never releases the claim (once means once)",
   "send_failed" in _dl and ".delete(" not in _dl)
ok("suppression check runs before any send", _dl.index("_recovery_is_suppressed") < _dl.index("claim_id"))
ok("no backfill: the floor sits at the mail's ship date",
   main.DEMO_LIFECYCLE_FLOOR_MS >= 1787680000000)


# ── 4c. THE POST-DEMO MAIL (send C) ──────────────────────────────────────────
ok("post_demo fires ~3h after expiry (configurable), measured from expires_at_ms",
   abs(main.DEMO_POST_EXPIRY_H - 3.0) < 1e-9 and main.DEMO_SENDS["post_demo"][1] == "expires_at_ms")
ok("post_demo has its OWN no-backfill floor, wired into the send table",
   main.DEMO_POST_DEMO_FLOOR_MS >= 1787740000000
   and main.DEMO_SENDS["post_demo"][3] == main.DEMO_POST_DEMO_FLOOR_MS)
ok("the loop enforces the per-send floor on the qualifying moment",
   "if since < floor_ms:" in _dl)

_URL = main.LS_BUY_URL + "?checkout[email]=u%40x.com"
ps, pt, ph = main._demo_send_render("post_demo", "", _URL)
ok("subject is exact", ps == "Did Stride take you anywhere interesting?")
ok("no name -> 'Hey,' with no stray space", pt.startswith("Hey,\n"))
ps2, pt2, ph2 = main._demo_send_render("post_demo", "Dana Levi", _URL)
ok("first name only, templated into text AND html",
   pt2.startswith("Hey Dana,\n") and "Hey Dana," in ph2)
ok("no unresolved placeholders",
   "{name_part}" not in pt2 + ph2 and "{checkout_url}" not in pt2 + ph2)

for needle in ["Joe here.",
               "Your 24 hours with Stride just wrapped up, and I wanted to ask how it went.",
               "Did Stride take you anywhere interesting?",
               "Did the workflow click, or was there something that got in the way?",
               "reply to this email. I read every one",
               "pick it up here"]:
    ok("body carries: " + needle[:44], needle in pt and needle in ph)
ok("exactly ONE purchase link: the LS checkout, prefilled",
   pt.count(main.LS_BUY_URL) == 1 and ph.count(main.LS_BUY_URL) == 1
   and f'href="{_URL}"' in ph)
ok("the link is titled GET STRIDE, not a raw URL in the body",
   "GET STRIDE: " in pt and ">GET STRIDE</a>" in ph)
ok("recovery-mail register: no images, no buttons, no styled CTA blocks",
   all(b not in ph.lower() for b in ["<img", "<button", "display:inline-block",
                                     "border-radius", "background"]))
ok("no price, no discount", all(b not in (pt + ph).lower()
   for b in ["$", "price", "discount", "% off"]))
ok("no em dash anywhere in the mail", chr(8212) not in pt and chr(8212) not in ph)
ok("the opt-out line rides along",
   "Reply STOP to opt out" in pt and "Reply STOP to opt out" in ph)

# suppression is the state machine, same as the onboard: by send time (expiry + 3h) a
# checkout or purchase has already moved the state out of DEMO_EXPIRED, so the send
# never exists — checkout recovery owns checkout starters, purchase suppresses all
ok("checkout after expiry cancels the post-demo mail",
   main.demo_state(events(reg, act, chk), E, NOW)["state"] == "CHECKOUT_STARTED")
ok("purchase after expiry cancels it outright",
   main.demo_state(events(reg, act, buy), E, NOW)["state"] == "PURCHASED")
ok("an expired identified demo with no forward motion IS the audience",
   main.demo_state(events(reg, act), E, NOW)["state"] == "DEMO_EXPIRED")

# ── 5. the download stays a pure lookup ──────────────────────────────────────
ok("both platforms are offered", set(main.DEMO_FILES) == {"windows", "mac"})
ok("the build handed out is pinned and configurable", main.DEMO_BUILD)
ok("an unknown platform yields no url", main._demo_download_url("atari") == "")


# ── 5b. DISCORD ALERTS: both demo moments ping, and neither can break the flow ─
import inspect
src_reg2 = inspect.getsource(main._handle_demo_register)
ok("registration pings Discord (the LS ping was lost when /try replaced it)",
   "DEMO REGISTERED" in src_reg2 and "ADMIN_WEBHOOK_URL" in src_reg2)
ok("registration ping fires on the FIRST registration only",
   "if first_time and ADMIN_WEBHOOK_URL:" in src_reg2)
ok("registration ping is non-fatal (wrapped, logged, never raised)",
   "discord alert failed (non-fatal)" in src_reg2)
src_sp2 = inspect.getsource(main._handle_start_pass)
ok("activation pings Discord", "DEMO ACTIVATED" in src_sp2 and "ADMIN_WEBHOOK_URL" in src_sp2)
ok("activation ping carries identity + a live expiry countdown",
   "identity" in src_sp2 and "<t:{exp // 1000}:R>" in src_sp2)
ok("activation ping is non-fatal too", src_sp2.count("non-fatal") >= 3)
ok("resumed passes stay quiet (the alert sits after the resume return)",
   src_sp2.index('"resumed": True') < src_sp2.index("DEMO ACTIVATED"))

# ── 6. nothing here can grant entitlement ────────────────────────────────────
import inspect
src_reg = inspect.getsource(main._handle_demo_register)
ok("registration never signs an entitlement", "_sign_entitlements" not in src_reg)
ok("registration never touches the pass collection", "PASS_COLLECTION" not in src_reg)
ok("registration never writes a licence", "license" not in src_reg.lower())

src_pass = inspect.getsource(main._handle_start_pass)
ok("the pass is still minted before identity is considered",
   src_pass.index("_sign_entitlements") < src_pass.index("_demo_claim_for_ip"))
ok("the device hash is still the only guard",
   "dev_ref = passes.document(device)" in src_pass)
ok("correlation only runs when the client sent no email",
   "if not email:" in src_pass and "_demo_claim_for_ip" in src_pass)

print(f"  {PASSED} passed, {FAILED} failed")
sys.exit(1 if FAILED else 0)
