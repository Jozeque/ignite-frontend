"""
Interop guard for product-scoped licensing (see docs/stride-entitlements-spec.md).

Proves the backend's entitlement signing (main.py _ent_canonical / _resolve_entitlements
/ _sign_entitlements) stays byte-compatible with the JS client verifier
(stride-vst/app/lib/entitlements.js). The load-bearing guarantee is the CANONICAL
string: Ed25519 signs bytes, so if Python and JS serialize a payload identically,
signatures verify cross-language.

The logic below MUST stay in lockstep with main.py. JS_GOLDEN is the cross-check
against the JS module:
    node -e "console.log(require('./stride-vst/app/lib/entitlements').canonicalize({key:'AAAA-BBBB',ents:['stridelink','vst'],iat:1783036800000}))"

Run:  python firebase_cloud/functions/test_entitlements_interop.py
Deps: stdlib + cryptography (in requirements.txt).
"""
import json, re, sys

passed = 0
failed = 0


def check(name, cond):
    global passed, failed
    if cond:
        print("  ok  " + name); passed += 1
    else:
        print("  XX  " + name); failed += 1


# ── mirror of main.py (keep in lockstep) ──────────────────────
ENT_PRODUCTS = [
    {"ents": ["stridelink"],        "ids": ["973706"],  "names": ["stride", "stridelink", "stride link", "stride for ableton"]},
    {"ents": ["vst"],               "ids": ["1188468"], "names": ["stride vst", "stride vst3"]},
    {"ents": ["stridelink", "vst"], "ids": [],          "names": ["stride bundle", "stride both", "stride complete"]},
]
ENT_GIVEAWAY_CUTOFF_MS = 1783036800000


def _ent_norm_name(s):
    return re.sub(r"\s+", " ", str(s or "").lower().strip())


def _resolve_entitlements(pid, pname, cms):
    pid = str(pid) if pid is not None else None
    pn = _ent_norm_name(pname)
    base = None
    for p in ENT_PRODUCTS:
        if (pid and pid in p["ids"]) or (pn and pn in [_ent_norm_name(n) for n in p["names"]]):
            base = list(p["ents"]); break
    if not base:
        return []
    ents = set(base)
    if "stridelink" in ents and cms is not None and cms <= ENT_GIVEAWAY_CUTOFF_MS:
        ents.add("vst")
    return sorted(ents)


def _ent_canonical(p):
    return json.dumps(p, sort_keys=True, separators=(",", ":"), ensure_ascii=False)


# ── 1. CANONICAL GOLDEN (the JS interop contract) ─────────────
JS_GOLDEN = '{"ents":["stridelink","vst"],"iat":1783036800000,"key":"AAAA-BBBB"}'
check("canonical matches JS golden byte-for-byte",
      _ent_canonical({"key": "AAAA-BBBB", "ents": ["stridelink", "vst"], "iat": 1783036800000}) == JS_GOLDEN)
check("canonical is key-order independent",
      _ent_canonical({"iat": 1, "key": "K", "ents": ["a"]}) == _ent_canonical({"ents": ["a"], "key": "K", "iat": 1}))

# ── 1b. exp golden (the 24h Discovery Pass) ───────────────────
# exp sorts alphabetically between ents and iat (e-n-t-s < e-x-p < i-a-t < k-e-y).
# CRITICAL: the no-exp golden (line 64) MUST stay byte-identical so every perpetual
# key's existing Ed25519 signature keeps verifying — that is the "don't break keys" proof.
JS_GOLDEN_EXP = '{"ents":["vst"],"exp":1785628800000,"iat":1783036800000,"key":"AAAA-BBBB"}'
check("exp canonical matches JS golden byte-for-byte (exp between ents and iat)",
      _ent_canonical({"key": "AAAA-BBBB", "ents": ["vst"], "iat": 1783036800000, "exp": 1785628800000}) == JS_GOLDEN_EXP)
check("no-exp golden UNCHANGED by adding exp support (perpetual keys still verify)",
      _ent_canonical({"key": "AAAA-BBBB", "ents": ["stridelink", "vst"], "iat": 1783036800000}) == JS_GOLDEN)
check("exp sorts strictly between ents and iat",
      _ent_canonical({"exp": 2, "iat": 3, "key": "K", "ents": ["a"]}) == '{"ents":["a"],"exp":2,"iat":3,"key":"K"}')

# ── 2. resolve decision table (mirror of the spec) ────────────
check("StrideLink id pre-cutoff -> both",        _resolve_entitlements(973706, "Stride", ENT_GIVEAWAY_CUTOFF_MS - 1) == ["stridelink", "vst"])
check("StrideLink id post-cutoff -> stridelink", _resolve_entitlements(973706, "Stride", ENT_GIVEAWAY_CUTOFF_MS + 1) == ["stridelink"])
check("VST id -> vst",                           _resolve_entitlements(1188468, "Stride VST", None) == ["vst"])
check("bundle name -> both",                     _resolve_entitlements(None, "Stride Bundle", None) == ["stridelink", "vst"])
check("unknown -> [] (fail closed)",             _resolve_entitlements(999, "Other", None) == [])
check("StrideLink LS name 'Stride' (name only)", _resolve_entitlements(None, "Stride", ENT_GIVEAWAY_CUTOFF_MS + 1) == ["stridelink"])
check("'Stride VST' does not collide with 'Stride'", "stridelink" not in _resolve_entitlements(None, "Stride VST", None))

# ── 3. Ed25519 sign -> verify round-trip ──────────────────────
try:
    from cryptography.hazmat.primitives.asymmetric.ed25519 import Ed25519PrivateKey
    priv = Ed25519PrivateKey.generate()
    pub = priv.public_key()
    msg = _ent_canonical({"key": "K", "ents": ["vst"], "iat": 1}).encode("utf-8")
    pub.verify(priv.sign(msg), msg)   # raises on failure
    check("Ed25519 sign/verify round-trip", True)
    msge = _ent_canonical({"key": "K", "ents": ["vst"], "iat": 1, "exp": 2}).encode("utf-8")   # the pass path
    pub.verify(priv.sign(msge), msge)
    check("Ed25519 sign/verify round-trip WITH exp", True)
    try:
        pub.verify(priv.sign(msg), _ent_canonical({"key": "K", "ents": ["vst", "x"], "iat": 1}).encode("utf-8"))
        check("tampered payload rejected", False)
    except Exception:
        check("tampered payload rejected", True)
except Exception as e:
    check("Ed25519 available", False)
    print("   ", e)

print("\n%d passed, %d failed\n" % (passed, failed))
sys.exit(1 if failed else 0)
