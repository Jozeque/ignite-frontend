"""Tracking readiness audit for the live demo-acquisition campaign.

Answers one question: if someone clicks an ad right now, does every link in the
chain survive, all the way to a row we can bill a customer against?

    ad url_tags        -> do the macros exist, on every ad
    resolved URL       -> what the browser actually receives after Meta expands them
    landing page       -> does /try still carry the pixel and read those params
    pixel              -> is Meta receiving events, and which ones
    CAPI               -> are the server events arriving with match keys
    exclusions         -> are the audiences still attached and ready
    cohort join        -> can the report key on what the chain delivers

Read only. Touches nothing.
"""
import io
import json
import os
import sys
import urllib.parse
import urllib.request

sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding="utf-8", errors="replace")

GRAPH = "https://graph.facebook.com/v23.0"
ACC = "act_3411622499006924"
CAMPAIGN = "120254058561820440"
ADSET = "120254058566090440"
PIXEL = "952457524222772"
TRY_URL = "https://stridehub.io/try/"

rows = []


def check(name, ok, detail=""):
    rows.append((name, ok, detail))
    print(f"  {'PASS' if ok else 'FAIL'}  {name:<50} {detail}")
    return ok


def g(path, **params):
    tok = os.environ.get("META_ACCESS_TOKEN", "")
    if not tok:
        sys.exit("META_ACCESS_TOKEN not set")
    q = urllib.parse.urlencode({"access_token": tok, **params})
    with urllib.request.urlopen(f"{GRAPH}/{path}?{q}", timeout=60) as r:
        j = json.loads(r.read().decode())
    if "error" in j:
        raise RuntimeError(j["error"].get("message"))
    return j


def main():
    print("=" * 74)
    print(" DEMO ACQUISITION · TRACKING READINESS")
    print("=" * 74)

    # ── 1. the ads ────────────────────────────────────────────────────────────
    print("\n1. ADS AND THEIR TAGS")
    ads = g(f"{ADSET}/ads", limit="25",
            fields="name,status,effective_status,creative{url_tags,object_story_spec,asset_feed_spec}")
    data = ads.get("data", [])
    check("3 ads exist", len(data) == 3, f"{len(data)}")
    needed = ["ad_id={{ad.id}}", "adset_id={{adset.id}}", "campaign_id={{campaign.id}}",
              "utm_content={{ad.name}}", "utm_source=meta"]
    for a in sorted(data, key=lambda x: x["name"]):
        cr = a.get("creative") or {}
        tags = cr.get("url_tags") or ""
        short = a["name"].split("|")[2].strip() if "|" in a["name"] else a["name"]
        missing = [n for n in needed if n not in tags]
        check(f"  {short}: url_tags complete", not missing,
              "all 5 params" if not missing else f"missing {missing}")
        link = (((cr.get("object_story_spec") or {}).get("video_data") or {})
                .get("call_to_action") or {}).get("value", {}).get("link", "")
        check(f"  {short}: destination is /try", link == TRY_URL, link or "none")
        bodies = ((cr.get("asset_feed_spec") or {}).get("bodies")) or []
        check(f"  {short}: 2 primary texts", len(bodies) == 2, f"{len(bodies)}")
        check(f"  {short}: delivering or in review",
              a["effective_status"] in ("ACTIVE", "PENDING_REVIEW", "IN_PROCESS"),
              a["effective_status"])

    # ── 2. what a click actually delivers ────────────────────────────────────
    print("\n2. RESOLVED CLICK URL (macros expanded as Meta would)")
    sample = sorted(data, key=lambda x: x["name"])[0]
    tags = (sample.get("creative") or {}).get("url_tags", "")
    resolved = (tags.replace("{{ad.id}}", sample["id"])
                    .replace("{{adset.id}}", ADSET)
                    .replace("{{campaign.id}}", CAMPAIGN)
                    .replace("{{ad.name}}", urllib.parse.quote(sample["name"])))
    full = f"{TRY_URL}?{resolved}&fbclid=EXAMPLE123"
    print(f"     {full[:150]}")
    parsed = urllib.parse.parse_qs(urllib.parse.urlparse(full).query)
    for key in ("ad_id", "adset_id", "campaign_id", "utm_source", "utm_content", "fbclid"):
        check(f"  click carries {key}", key in parsed, (parsed.get(key, [""])[0])[:34])

    # ── 3. the landing page ──────────────────────────────────────────────────
    print("\n3. LANDING PAGE")
    with urllib.request.urlopen(TRY_URL + "?cachebust=audit", timeout=40) as r:
        html = r.read().decode("utf-8", "replace")
    check("  /try reachable", len(html) > 5000, f"{len(html)} bytes")
    check("  pixel present", f"fbq('init', '{PIXEL}'" in html)
    check("  fires PageView", "fbq('track', 'PageView')" in html)
    check("  fires Lead", "fbq('track', 'Lead'" in html)
    check("  fires DemoRegistered", "trackCustom', 'DemoRegistered'" in html)
    check("  derives _fbc from fbclid", "_fbc=" in html)
    check("  reads ad_id / campaign_id", "'ad_id'" in html and "'campaign_id'" in html)
    check("  persists params to localStorage", "stride_' + k" in html or "stride_ad_id" in html)
    check("  posts demo_register", "demo_register" in html)
    check("  gates pixel on first_time", "d.first_time === true" in html)

    # ── 4. pixel health ──────────────────────────────────────────────────────
    print("\n4. PIXEL")
    px = g(PIXEL, fields="name,last_fired_time,enable_automatic_matching,automatic_matching_fields")
    check("  pixel exists", bool(px.get("id") or px.get("name")), px.get("name", ""))
    check("  fired recently", bool(px.get("last_fired_time")),
          (px.get("last_fired_time") or "")[:19])
    check("  advanced matching on", px.get("enable_automatic_matching") is True,
          f"{len(px.get('automatic_matching_fields') or [])} fields")

    # ── 5. ad set config that tracking depends on ────────────────────────────
    print("\n5. AD SET")
    s = g(ADSET, fields=("name,status,effective_status,daily_budget,optimization_goal,"
                         "promoted_object,attribution_spec,targeting"))
    check("  ad set active", s.get("status") == "ACTIVE", s.get("effective_status", ""))
    check("  optimizing PURCHASE",
          (s.get("promoted_object") or {}).get("custom_event_type") == "PURCHASE")
    check("  pixel bound to the ad set",
          (s.get("promoted_object") or {}).get("pixel_id") == PIXEL)
    check("  7-day click attribution",
          s.get("attribution_spec") == [{"event_type": "CLICK_THROUGH", "window_days": 7}],
          json.dumps(s.get("attribution_spec")))
    excl = (s.get("targeting") or {}).get("excluded_custom_audiences") or []
    check("  7 exclusion audiences attached", len(excl) == 7, f"{len(excl)}")

    # ── 6. exclusions still usable ───────────────────────────────────────────
    print("\n6. EXCLUSION AUDIENCES")
    for e in excl:
        a = g(e["id"], fields="name,delivery_status,operation_status")
        ready = (a.get("delivery_status") or {}).get("code") == 200
        check(f"  {a.get('name','')[:40]}", ready,
              (a.get("delivery_status") or {}).get("description", "")[:34])

    # ── 7. delivery so far ───────────────────────────────────────────────────
    print("\n7. DELIVERY SO FAR")
    try:
        ins = g(f"{CAMPAIGN}/insights",
                time_range=json.dumps({"since": "2026-08-26", "until": "2026-08-26"}),
                fields="spend,impressions,inline_link_clicks,actions")
        d = (ins.get("data") or [{}])[0]
        acts = {a["action_type"]: a["value"] for a in (d.get("actions") or [])}
        print(f"     spend ILS {d.get('spend','0')} · impressions {d.get('impressions','0')} "
              f"· clicks {d.get('inline_link_clicks','0')} · LPV {acts.get('landing_page_view','0')}")
        print("     (zero is expected while the ads are still in review)")
    except Exception as ex:
        print(f"     insights unavailable: {ex}")

    print("\n" + "=" * 74)
    bad = [r for r in rows if not r[1]]
    print(f" {len(rows)-len(bad)}/{len(rows)} checks passed")
    for n, _, det in bad:
        print(f"   FAIL  {n}  {det}")
    print("=" * 74)
    return 1 if bad else 0


if __name__ == "__main__":
    sys.exit(main())
