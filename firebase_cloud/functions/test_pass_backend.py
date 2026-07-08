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


def decide(device_doc, email_hit, now_ms):
    """Replica of _handle_start_pass's dedup: returns (outcome, exp_or_None)."""
    if device_doc is not None:
        exp = int(device_doc.get("exp") or 0)
        if now_ms < exp and device_doc.get("ent") and device_doc.get("ent_sig"):
            return ("resume", exp)
        return ("pass_ended", None)
    if email_hit:
        return ("email_used", None)
    started = now_ms
    return ("mint", started + PASS_DURATION_MS)


NOW = 1751328000000

# 1. MINT — neither device nor email seen.
check("fresh device + email -> mint (24h)", decide(None, False, NOW) == ("mint", NOW + PASS_DURATION_MS))

# 2. RESUME — same device, still valid (mid-pass reinstall).
active = {"exp": NOW + 3600000, "ent": {"x": 1}, "ent_sig": "sig"}
check("same device, still valid -> resume (same exp)", decide(active, False, NOW) == ("resume", NOW + 3600000))

# 3. PASS_ENDED — same device, expired (non-renewable).
expired = {"exp": NOW - 1, "ent": {"x": 1}, "ent_sig": "sig"}
check("same device, expired -> pass_ended (no new pass)", decide(expired, False, NOW) == ("pass_ended", None))
check("same device, expired, even if email absent -> still pass_ended", decide(expired, False, NOW)[0] == "pass_ended")

# 4. EMAIL_USED — new device but the email already spent a pass elsewhere (one-device).
check("new device, email already used -> email_used", decide(None, True, NOW) == ("email_used", None))

# 5. Device record exists but is corrupt (missing ent) -> treated as ended, never mints a dup.
check("device record missing ent -> pass_ended (fail closed)", decide({"exp": NOW + 9999, "ent": None, "ent_sig": None}, False, NOW)[0] == "pass_ended")

# ── source: main.py wires start_pass correctly ────────────────
here = os.path.dirname(os.path.abspath(__file__))
src = open(os.path.join(here, "main.py"), encoding="utf-8").read()
check("PASS_DURATION_MS = 24h", re.search(r"PASS_DURATION_MS\s*=\s*24\s*\*\s*60\s*\*\s*60\s*\*\s*1000", src) is not None)
check("PASS_COLLECTION = vst_passes (own collection)", 'PASS_COLLECTION = "vst_passes"' in src)
check("_handle_start_pass defined", "def _handle_start_pass(data: dict):" in src)
check("start_pass routed", re.search(r'action"\)\s*==\s*"start_pass"[\s\S]{0,80}_handle_start_pass', src) is not None)
check("pass ent signed WITH exp", re.search(r'_sign_entitlements\(device,\s*\["vst"\],\s*started_at,\s*exp_ms=exp\)', src) is not None)
check("device is the doc id (no raw machine id stored server-side beyond the hash)", re.search(r'passes\.document\(device\)', src) is not None)
check("email dedup query (one-device binding)", re.search(r'passes\.where\("email",\s*"==",\s*email\)', src) is not None)
check("lead capture never downgrades a buyer", re.search(r'!=\s*"purchased"', src) is not None)
check("validate returns server_now_ms (anti-rollback source)", '"server_now_ms": int(time.time() * 1000)' in src)

print("\n%d passed, %d failed\n" % (passed, failed))
sys.exit(1 if failed else 0)
