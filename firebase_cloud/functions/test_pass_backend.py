"""
Discovery Pass backend guard — the start_pass dedup state machine + signed exp.

Firestore isn't available offline, so this replicates the EXACT decision logic in
main.py _handle_start_pass (device-first, then email, then mint) and asserts the four
outcomes, plus source-checks that main.py wires it correctly and signs with exp.

Run:  python firebase_cloud/functions/test_pass_backend.py
"""
import os
import re
import sys

passed = 0
failed = 0


def check(name, cond):
    global passed, failed
    if cond:
        print("  ok  " + name); passed += 1
    else:
        print("  XX  " + name); failed += 1


PASS_DURATION_MS = 24 * 60 * 60 * 1000


def decide(device_doc, now_ms):
    """Replica of _handle_start_pass's dedup — the DEVICE is the ONLY guard (email is optional
    lead-capture, never a gate). Returns (outcome, exp_or_None)."""
    if device_doc is not None:
        exp = int(device_doc.get("exp") or 0)
        if now_ms < exp and device_doc.get("ent") and device_doc.get("ent_sig"):
            return ("resume", exp)
        return ("pass_ended", None)
    return ("mint", now_ms + PASS_DURATION_MS)


NOW = 1751328000000

# 1. MINT — this device hasn't passed before.
check("fresh device -> mint (24h)", decide(None, NOW) == ("mint", NOW + PASS_DURATION_MS))

# 2. RESUME — same device, still valid (mid-pass reinstall just resumes).
active = {"exp": NOW + 3600000, "ent": {"x": 1}, "ent_sig": "sig"}
check("same device, still valid -> resume (same exp)", decide(active, NOW) == ("resume", NOW + 3600000))

# 3. PASS_ENDED — same device, expired (non-renewable, survives reinstall).
expired = {"exp": NOW - 1, "ent": {"x": 1}, "ent_sig": "sig"}
check("same device, expired -> pass_ended (no new pass)", decide(expired, NOW) == ("pass_ended", None))

# 4. Device is the guard: a NEW/fake email on the SAME device can't earn a second pass —
#    the outcome is decided by the device record, not the email.
check("same expired device, any email -> still pass_ended (fake emails don't help)", decide(expired, NOW)[0] == "pass_ended")
check("same active device, any email -> resume (not a new mint)", decide(active, NOW)[0] == "resume")

# 5. Device record exists but is corrupt (missing ent) -> treated as ended, never mints a dup.
check("device record missing ent -> pass_ended (fail closed)", decide({"exp": NOW + 9999, "ent": None, "ent_sig": None}, NOW)[0] == "pass_ended")

# ── source: main.py wires start_pass correctly ────────────────
here = os.path.dirname(os.path.abspath(__file__))
src = open(os.path.join(here, "main.py"), encoding="utf-8").read()
check("PASS_DURATION_MS = 24h", re.search(r"PASS_DURATION_MS\s*=\s*24\s*\*\s*60\s*\*\s*60\s*\*\s*1000", src) is not None)
check("PASS_COLLECTION = vst_passes (own collection)", 'PASS_COLLECTION = "vst_passes"' in src)
check("_handle_start_pass defined", "def _handle_start_pass(data: dict, ip: str" in src)
check("start_pass routed", re.search(r'action"\)\s*==\s*"start_pass"[\s\S]{0,160}_handle_start_pass\(data_pre', src) is not None)
check("pass ent signed WITH exp", re.search(r'_sign_entitlements\(device,\s*\["vst"\],\s*started_at,\s*exp_ms=exp\)', src) is not None)
check("device is the doc id + the sole dedup guard", re.search(r'passes\.document\(device\)', src) is not None)
_sp = src[src.find("def _handle_start_pass"):]
_sp = _sp[:_sp.find("@https_fn")]   # just the start_pass handler body
check("start_pass REQUIRES device, is NOT gated on email", "if not device:" in _sp and "if not email" not in _sp)
check("no email-based refusal (fake emails can't earn a second pass)", "email_used" not in src)
check("lead capture is guarded on email presence + never downgrades a buyer", "if email:" in src and re.search(r'!=\s*"purchased"', src) is not None)
check("validate returns server_now_ms (anti-rollback source)", '"server_now_ms": int(time.time() * 1000)' in src)
check("per-IP velocity cap constant", "PASS_IP_DAILY_CAP" in src)
check("start_pass takes the client IP + caps mints per IP", "def _handle_start_pass(data: dict, ip: str" in src and 'where("mint_ip", "==", ip)' in src and '"mint_ip": ip' in src)
check("dispatch passes the client IP (X-Forwarded-For) to start_pass", "_handle_start_pass(data_pre, _pass_ip)" in src)

print("\n%d passed, %d failed\n" % (passed, failed))
sys.exit(1 if failed else 0)
