"""Tests for the Meta Conversions API helpers used by the Lemon Squeezy
webhook in main.py.

Run from the functions/ directory:
    python -m pytest test_meta_capi.py -v
or as a standalone script:
    python test_meta_capi.py
"""

import hashlib
import io
import json
import os
import unittest
from unittest.mock import patch, MagicMock

from meta_capi import (
    CAPI_EVENT_NAMES,
    META_CAPI_VERSION,
    META_PIXEL_ID,
    _build_capi_payload,
    _fire_meta_purchase_capi,
    _fire_meta_lead_capi,
    _hash_pii,
)


def _find_event(payload, name):
    """Helper: pull the first event matching name from a CAPI payload."""
    for ev in payload["data"]:
        if ev["event_name"] == name:
            return ev
    raise AssertionError(f"event {name!r} not found in payload (have: "
                         f"{[e['event_name'] for e in payload['data']]})")


# ─── _hash_pii ───────────────────────────────────────────────────────


class HashPiiTests(unittest.TestCase):
    def test_lowercases_and_trims_before_hashing(self):
        h = _hash_pii("Test@Example.COM ")
        expected = hashlib.sha256(b"test@example.com").hexdigest()
        self.assertEqual(h, expected)

    def test_empty_string_returns_empty(self):
        self.assertEqual(_hash_pii(""), "")

    def test_none_returns_empty(self):
        self.assertEqual(_hash_pii(None), "")

    def test_whitespace_only_string_returns_empty(self):
        # Falsy guard means non-empty-after-strip; but ' ' is truthy as a string.
        # Confirm we still produce a hash (the SHA of '') — Meta will treat this
        # as a low-match field. Acceptable: never raise.
        h = _hash_pii(" ")
        expected = hashlib.sha256(b"").hexdigest()
        self.assertEqual(h, expected)

    def test_unicode_email(self):
        # Should not raise on non-ASCII input
        h = _hash_pii("Tést@Example.com")
        self.assertEqual(len(h), 64)  # SHA256 hex = 64 chars

    def test_idempotent(self):
        a = _hash_pii("user@example.com")
        b = _hash_pii("user@example.com")
        self.assertEqual(a, b)


# ─── _build_capi_payload ─────────────────────────────────────────────


class BuildCapiPayloadTests(unittest.TestCase):
    def _base_order(self):
        return {
            "email": "buyer@example.com",
            "order_id": "12345",
            "order_identifier": "ord-uuid-abc",
            "total_cents": 3900,
            "currency": "USD",
        }

    def test_payload_contains_both_purchase_and_welcome_events(self):
        # The contract: client fires Purchase + welcome together, so the
        # server must mirror both for per-event CAPI dedup to work.
        payload = _build_capi_payload(self._base_order(), "evt-shared-1")
        names = [ev["event_name"] for ev in payload["data"]]
        self.assertEqual(names, list(CAPI_EVENT_NAMES))
        self.assertIn("Purchase", names)
        self.assertIn("welcome", names)

    def test_both_events_share_event_id_for_per_event_dedup(self):
        # Meta dedupes per (event_name + event_id). Different names sharing
        # an event_id do NOT cross-dedup — each name dedupes against its
        # own client counterpart independently.
        payload = _build_capi_payload(self._base_order(), "evt-shared-1")
        ids = [ev["event_id"] for ev in payload["data"]]
        self.assertEqual(len(set(ids)), 1, "all events should share one event_id")
        self.assertEqual(ids[0], "evt-shared-1")

    def test_both_events_share_event_time(self):
        # event_time must match for dedup to recognise them as the same
        # conversion across channels.
        payload = _build_capi_payload(self._base_order(), "evt-1")
        times = {ev["event_time"] for ev in payload["data"]}
        self.assertEqual(len(times), 1, "event_time should be shared across events")

    def test_shape_matches_meta_v18_contract(self):
        payload = _build_capi_payload(self._base_order(), "evt-shared-1")
        self.assertIn("data", payload)
        self.assertEqual(len(payload["data"]), 2)
        for ev in payload["data"]:
            self.assertIn(ev["event_name"], CAPI_EVENT_NAMES)
            self.assertEqual(ev["event_id"], "evt-shared-1")
            self.assertEqual(ev["event_source_url"], "https://stridehub.io/welcome.html")
            self.assertEqual(ev["action_source"], "website")
            self.assertIn("user_data", ev)
            self.assertIn("custom_data", ev)

    def test_event_time_is_unix_seconds_integer(self):
        payload = _build_capi_payload(self._base_order(), "evt-1")
        for ev in payload["data"]:
            self.assertIsInstance(ev["event_time"], int)
            # Should be a sensible recent timestamp (after 2024-01-01)
            self.assertGreater(ev["event_time"], 1704067200)

    def test_total_cents_converted_to_dollars(self):
        payload = _build_capi_payload({"total_cents": 3900, "currency": "USD"}, "evt-1")
        for ev in payload["data"]:
            self.assertEqual(ev["custom_data"]["value"], 39.0)

    def test_total_cents_rounded_to_two_decimals(self):
        payload = _build_capi_payload({"total_cents": 3999, "currency": "USD"}, "evt-1")
        for ev in payload["data"]:
            self.assertEqual(ev["custom_data"]["value"], 39.99)

    def test_zero_value_falls_back_to_list_price(self):
        # Meta penalizes zero-value Purchase events — never send 0.
        # Fallback: 39 → 59 when the founding-member era ended (2026-05-24),
        # → 79 for the summer sale (2026-07-26). Bump when the price flips.
        payload = _build_capi_payload({"total_cents": 0, "currency": "USD"}, "evt-1")
        for ev in payload["data"]:
            self.assertEqual(ev["custom_data"]["value"], 79.0)

    def test_missing_total_falls_back_to_list_price(self):
        payload = _build_capi_payload({"currency": "USD"}, "evt-1")
        for ev in payload["data"]:
            self.assertEqual(ev["custom_data"]["value"], 79.0)

    def test_non_numeric_total_falls_back_to_list_price(self):
        payload = _build_capi_payload({"total_cents": "garbage"}, "evt-1")
        for ev in payload["data"]:
            self.assertEqual(ev["custom_data"]["value"], 79.0)

    def test_tax_is_netted_off_the_reported_value(self):
        # LS `total` is gross. A $79 product bought in a 20%-VAT country
        # totals 9480 cents; Meta must see 79.00, not 94.80, or the EU buyer
        # looks 20% more valuable than the US buyer of the same product.
        payload = _build_capi_payload(
            {"total_cents": 9480, "tax_cents": 1580, "currency": "USD"}, "evt-1")
        for ev in payload["data"]:
            self.assertEqual(ev["custom_data"]["value"], 79.0)

    def test_no_tax_field_reports_full_total(self):
        # US orders carry no tax — value is the total unchanged.
        payload = _build_capi_payload({"total_cents": 7900, "currency": "USD"}, "evt-1")
        for ev in payload["data"]:
            self.assertEqual(ev["custom_data"]["value"], 79.0)

    def test_discounted_order_reports_what_was_actually_earned(self):
        # 50%-off order: total 3950, tax 0. Must report 39.50 — NOT the LS
        # `subtotal` (7900), which is pre-discount and would double-count.
        payload = _build_capi_payload(
            {"total_cents": 3950, "tax_cents": 0, "currency": "USD"}, "evt-1")
        for ev in payload["data"]:
            self.assertEqual(ev["custom_data"]["value"], 39.5)

    def test_currency_uppercased(self):
        payload = _build_capi_payload({"total_cents": 3900, "currency": "usd"}, "evt-1")
        for ev in payload["data"]:
            self.assertEqual(ev["custom_data"]["currency"], "USD")

    def test_missing_currency_defaults_to_usd(self):
        payload = _build_capi_payload({"total_cents": 3900}, "evt-1")
        for ev in payload["data"]:
            self.assertEqual(ev["custom_data"]["currency"], "USD")

    def test_email_is_hashed_in_user_data(self):
        payload = _build_capi_payload(self._base_order(), "evt-1")
        for ev in payload["data"]:
            em = ev["user_data"]["em"]
            self.assertIsInstance(em, list)
            self.assertEqual(em[0], hashlib.sha256(b"buyer@example.com").hexdigest())

    def test_missing_email_omits_em_key(self):
        payload = _build_capi_payload({"total_cents": 3900}, "evt-1")
        for ev in payload["data"]:
            self.assertNotIn("em", ev["user_data"])

    def test_empty_event_id_generates_uuid_shared_across_events(self):
        payload = _build_capi_payload(self._base_order(), "")
        ids = [ev["event_id"] for ev in payload["data"]]
        # All events share ONE generated UUID — otherwise client dedup
        # would fail for whichever event the server generated separately.
        self.assertEqual(len(set(ids)), 1)
        self.assertEqual(len(ids[0]), 36)
        self.assertIn("-", ids[0])

    def test_order_id_appears_in_content_ids(self):
        payload = _build_capi_payload(self._base_order(), "evt-1")
        for ev in payload["data"]:
            self.assertEqual(ev["custom_data"]["content_ids"], ["12345"])

    def test_order_identifier_used_when_order_id_missing(self):
        d = self._base_order()
        d["order_id"] = None
        payload = _build_capi_payload(d, "evt-1")
        for ev in payload["data"]:
            self.assertEqual(ev["custom_data"]["content_ids"], ["ord-uuid-abc"])

    def test_no_order_id_returns_empty_content_ids(self):
        payload = _build_capi_payload({"total_cents": 3900}, "evt-1")
        for ev in payload["data"]:
            self.assertEqual(ev["custom_data"]["content_ids"], [])

    def test_content_name_and_type_constants(self):
        payload = _build_capi_payload(self._base_order(), "evt-1")
        for ev in payload["data"]:
            cd = ev["custom_data"]
            self.assertEqual(cd["content_name"], "Stride Sound Design Engine")
            self.assertEqual(cd["content_type"], "product")

    def test_email_with_uppercase_and_whitespace_normalized_in_hash(self):
        payload = _build_capi_payload(
            {"email": " Buyer@EXAMPLE.com ", "total_cents": 3900}, "evt-1"
        )
        for ev in payload["data"]:
            em = ev["user_data"]["em"][0]
            self.assertEqual(em, hashlib.sha256(b"buyer@example.com").hexdigest())

    # ─── Meta attribution fields (fbc / fbp / client_user_agent) ─────
    # Critical for campaign-driven Purchase events: Meta needs these to
    # match the server event back to the ad click that drove it. Without
    # them, the campaign optimizer can't credit the conversion → CPA
    # appears artificially high → profitable ads get killed prematurely.

    def test_fbc_included_in_user_data_when_provided(self):
        order = {
            "email": "buyer@example.com",
            "total_cents": 5900,
            "fbc": "fb.1.1717250000000.IwAR0FakeClickId",
        }
        payload = _build_capi_payload(order, "evt-1")
        for ev in payload["data"]:
            self.assertEqual(ev["user_data"]["fbc"], "fb.1.1717250000000.IwAR0FakeClickId")

    def test_fbp_included_in_user_data_when_provided(self):
        order = {
            "email": "buyer@example.com",
            "total_cents": 5900,
            "fbp": "fb.1.1717250000000.987654321",
        }
        payload = _build_capi_payload(order, "evt-1")
        for ev in payload["data"]:
            self.assertEqual(ev["user_data"]["fbp"], "fb.1.1717250000000.987654321")

    def test_client_user_agent_included_when_provided(self):
        ua = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36"
        order = {"email": "buyer@example.com", "total_cents": 5900, "client_user_agent": ua}
        payload = _build_capi_payload(order, "evt-1")
        for ev in payload["data"]:
            self.assertEqual(ev["user_data"]["client_user_agent"], ua)

    def test_all_attribution_fields_combine(self):
        order = {
            "email": "buyer@example.com",
            "total_cents": 5900,
            "fbc": "fb.1.123.abc",
            "fbp": "fb.1.456.xyz",
            "client_user_agent": "TestAgent/1.0",
        }
        payload = _build_capi_payload(order, "evt-1")
        for ev in payload["data"]:
            ud = ev["user_data"]
            self.assertIn("em", ud)
            self.assertEqual(ud["fbc"], "fb.1.123.abc")
            self.assertEqual(ud["fbp"], "fb.1.456.xyz")
            self.assertEqual(ud["client_user_agent"], "TestAgent/1.0")

    def test_attribution_fields_absent_when_not_provided(self):
        # Backwards-compat: organic visit with no fbclid → no fbc/fbp/ua
        # in user_data. Payload still valid, em still present.
        order = {"email": "buyer@example.com", "total_cents": 5900}
        payload = _build_capi_payload(order, "evt-1")
        for ev in payload["data"]:
            ud = ev["user_data"]
            self.assertIn("em", ud)
            self.assertNotIn("fbc", ud)
            self.assertNotIn("fbp", ud)
            self.assertNotIn("client_user_agent", ud)

    def test_empty_string_attribution_fields_are_omitted(self):
        # Defensive: if upstream passes "" instead of missing, we still
        # treat it as absent. Meta rejects empty-string user_data fields.
        order = {
            "email": "buyer@example.com",
            "total_cents": 5900,
            "fbc": "",
            "fbp": "   ",
            "client_user_agent": "",
        }
        payload = _build_capi_payload(order, "evt-1")
        for ev in payload["data"]:
            ud = ev["user_data"]
            self.assertNotIn("fbc", ud)
            self.assertNotIn("fbp", ud)
            self.assertNotIn("client_user_agent", ud)

    def test_welcome_event_carries_same_custom_data_as_purchase(self):
        # The welcome custom event should carry the same value/currency
        # /content payload as Purchase so Meta has data to optimize the
        # conversion campaign against. If welcome went out empty, custom
        # conversions in Ads Manager wouldn't have value to attribute.
        payload = _build_capi_payload(self._base_order(), "evt-1")
        purchase = _find_event(payload, "Purchase")
        welcome = _find_event(payload, "welcome")
        self.assertEqual(purchase["custom_data"], welcome["custom_data"])
        self.assertEqual(purchase["user_data"], welcome["user_data"])


# ─── _fire_meta_purchase_capi ────────────────────────────────────────


class FireMetaPurchaseCapiTests(unittest.TestCase):
    """End-to-end: build payload + POST. Mocks urlopen so no network."""

    def _order(self):
        return {
            "email": "buyer@example.com",
            "order_id": "12345",
            "total_cents": 3900,
            "currency": "USD",
        }

    def test_no_token_returns_false_and_does_not_post(self):
        with patch.dict(os.environ, {}, clear=False):
            os.environ.pop("META_CAPI_ACCESS_TOKEN", None)
            with patch("meta_capi.urllib.request.urlopen") as urlopen:
                result = _fire_meta_purchase_capi(self._order(), "evt-1")
                self.assertFalse(result)
                urlopen.assert_not_called()

    def _mock_response(self, status):
        resp = MagicMock()
        resp.getcode.return_value = status
        # urlopen returns a context manager — emulate __enter__/__exit__
        resp.__enter__ = MagicMock(return_value=resp)
        resp.__exit__ = MagicMock(return_value=False)
        return resp

    def test_success_200_returns_true(self):
        with patch.dict(os.environ, {"META_CAPI_ACCESS_TOKEN": "tok-123"}):
            with patch("meta_capi.urllib.request.urlopen", return_value=self._mock_response(200)) as urlopen:
                result = _fire_meta_purchase_capi(self._order(), "evt-1")
                self.assertTrue(result)
                urlopen.assert_called_once()

    def test_post_url_targets_correct_endpoint(self):
        with patch.dict(os.environ, {"META_CAPI_ACCESS_TOKEN": "tok-123"}):
            with patch("meta_capi.urllib.request.urlopen", return_value=self._mock_response(200)) as urlopen:
                _fire_meta_purchase_capi(self._order(), "evt-1")
                args, _ = urlopen.call_args
                req = args[0]
                self.assertIn(f"graph.facebook.com/{META_CAPI_VERSION}/{META_PIXEL_ID}/events", req.full_url)
                self.assertIn("access_token=tok-123", req.full_url)

    def test_post_body_has_correct_event_id(self):
        with patch.dict(os.environ, {"META_CAPI_ACCESS_TOKEN": "tok-123"}):
            with patch("meta_capi.urllib.request.urlopen", return_value=self._mock_response(200)) as urlopen:
                _fire_meta_purchase_capi(self._order(), "evt-shared-xyz")
                args, _ = urlopen.call_args
                req = args[0]
                body = json.loads(req.data.decode("utf-8"))
                self.assertEqual(body["data"][0]["event_id"], "evt-shared-xyz")

    def test_post_uses_3_second_timeout(self):
        with patch.dict(os.environ, {"META_CAPI_ACCESS_TOKEN": "tok-123"}):
            with patch("meta_capi.urllib.request.urlopen", return_value=self._mock_response(200)) as urlopen:
                _fire_meta_purchase_capi(self._order(), "evt-1")
                _, kwargs = urlopen.call_args
                self.assertEqual(kwargs.get("timeout"), 3)

    def test_4xx_response_returns_false_and_does_not_raise(self):
        with patch.dict(os.environ, {"META_CAPI_ACCESS_TOKEN": "tok-123"}):
            with patch("meta_capi.urllib.request.urlopen", return_value=self._mock_response(400)):
                result = _fire_meta_purchase_capi(self._order(), "evt-1")
                self.assertFalse(result)

    def test_5xx_response_returns_false_and_does_not_raise(self):
        with patch.dict(os.environ, {"META_CAPI_ACCESS_TOKEN": "tok-123"}):
            with patch("meta_capi.urllib.request.urlopen", return_value=self._mock_response(503)):
                result = _fire_meta_purchase_capi(self._order(), "evt-1")
                self.assertFalse(result)

    def test_network_exception_returns_false_and_does_not_raise(self):
        with patch.dict(os.environ, {"META_CAPI_ACCESS_TOKEN": "tok-123"}):
            with patch("meta_capi.urllib.request.urlopen", side_effect=ConnectionError("boom")):
                result = _fire_meta_purchase_capi(self._order(), "evt-1")
                self.assertFalse(result)

    def test_timeout_exception_returns_false_and_does_not_raise(self):
        import socket
        with patch.dict(os.environ, {"META_CAPI_ACCESS_TOKEN": "tok-123"}):
            with patch("meta_capi.urllib.request.urlopen", side_effect=socket.timeout("timed out")):
                result = _fire_meta_purchase_capi(self._order(), "evt-1")
                self.assertFalse(result)

    def test_token_url_encoded_to_avoid_injection(self):
        with patch.dict(os.environ, {"META_CAPI_ACCESS_TOKEN": "tok with spaces&extra"}):
            with patch("meta_capi.urllib.request.urlopen", return_value=self._mock_response(200)) as urlopen:
                _fire_meta_purchase_capi(self._order(), "evt-1")
                args, _ = urlopen.call_args
                req = args[0]
                # Token should be URL-encoded so & doesn't introduce a phantom param
                self.assertNotIn("tok with spaces&extra", req.full_url)
                self.assertIn("tok%20with%20spaces%26extra", req.full_url)

    def test_request_has_json_content_type_header(self):
        with patch.dict(os.environ, {"META_CAPI_ACCESS_TOKEN": "tok-123"}):
            with patch("meta_capi.urllib.request.urlopen", return_value=self._mock_response(200)) as urlopen:
                _fire_meta_purchase_capi(self._order(), "evt-1")
                args, _ = urlopen.call_args
                req = args[0]
                self.assertEqual(req.get_header("Content-type"), "application/json")


# ─── _fire_meta_lead_capi (free-demo path) ───────────────────────────


class FireMetaLeadCapiTests(unittest.TestCase):
    """A $0 free-demo download must fire a distinct Lead event — NEVER
    Purchase/welcome — so it can't inflate purchase count/revenue or train
    the conversion optimizer on demo grabbers who rarely buy."""

    def _user(self):
        return {
            "email": "Demo-Grabber@Example.com ",
            "fbc": "fb.1.123.abc",
            "first_name": "Dee",
            "last_name": "Mo",
        }

    def _mock_response(self, status):
        resp = MagicMock()
        resp.getcode.return_value = status
        resp.__enter__ = MagicMock(return_value=resp)
        resp.__exit__ = MagicMock(return_value=False)
        return resp

    def test_no_token_returns_false_and_does_not_post(self):
        with patch.dict(os.environ, {}, clear=False):
            os.environ.pop("META_CAPI_ACCESS_TOKEN", None)
            with patch("meta_capi.urllib.request.urlopen") as urlopen:
                self.assertFalse(_fire_meta_lead_capi(self._user(), "evt-1"))
                urlopen.assert_not_called()

    def test_success_200_returns_true_and_posts_once(self):
        with patch.dict(os.environ, {"META_CAPI_ACCESS_TOKEN": "tok-123"}):
            with patch("meta_capi.urllib.request.urlopen", return_value=self._mock_response(200)) as urlopen:
                self.assertTrue(_fire_meta_lead_capi(self._user(), "evt-1"))
                urlopen.assert_called_once()

    def test_fires_lead_event_only_never_purchase_or_welcome(self):
        with patch.dict(os.environ, {"META_CAPI_ACCESS_TOKEN": "tok-123"}):
            with patch("meta_capi.urllib.request.urlopen", return_value=self._mock_response(200)) as urlopen:
                _fire_meta_lead_capi(self._user(), "evt-1")
                body = json.loads(urlopen.call_args[0][0].data.decode("utf-8"))
                names = [ev["event_name"] for ev in body["data"]]
                self.assertEqual(names, ["Lead"])
                self.assertNotIn("Purchase", names)
                self.assertNotIn("welcome", names)

    def test_value_is_zero_never_falls_back_to_list_price(self):
        # The entire point of the fix: a demo is worth $0 and must NOT hit
        # the $59 list-price fallback that _build_capi_payload applies.
        with patch.dict(os.environ, {"META_CAPI_ACCESS_TOKEN": "tok-123"}):
            with patch("meta_capi.urllib.request.urlopen", return_value=self._mock_response(200)) as urlopen:
                _fire_meta_lead_capi(self._user(), "evt-1")
                body = json.loads(urlopen.call_args[0][0].data.decode("utf-8"))
                self.assertEqual(body["data"][0]["custom_data"]["value"], 0.0)

    def test_hashes_email_normalized_for_audience_matching(self):
        with patch.dict(os.environ, {"META_CAPI_ACCESS_TOKEN": "tok-123"}):
            with patch("meta_capi.urllib.request.urlopen", return_value=self._mock_response(200)) as urlopen:
                _fire_meta_lead_capi(self._user(), "evt-1")
                body = json.loads(urlopen.call_args[0][0].data.decode("utf-8"))
                em = body["data"][0]["user_data"]["em"][0]
                self.assertEqual(em, hashlib.sha256(b"demo-grabber@example.com").hexdigest())

    def test_network_exception_returns_false_and_does_not_raise(self):
        with patch.dict(os.environ, {"META_CAPI_ACCESS_TOKEN": "tok-123"}):
            with patch("meta_capi.urllib.request.urlopen", side_effect=ConnectionError("boom")):
                self.assertFalse(_fire_meta_lead_capi(self._user(), "evt-1"))


# ─── Integration: shape verification of common LS-driven scenarios ──


class IntegrationSnapshotTests(unittest.TestCase):
    """Verify the JSON Meta receives for the typical purchase flow."""

    def test_standard_LS_order_produces_minimum_required_meta_fields(self):
        order_data = {
            "email": "real-customer@gmail.com",
            "order_id": 98765,
            "order_identifier": "uuid-aaaa-bbbb",
            "total_cents": 3900,
            "currency": "USD",
        }
        payload = _build_capi_payload(order_data, "evt-abc-123")
        for ev in payload["data"]:
            # Required by Meta CAPI v18.0
            self.assertIn(ev["event_name"], CAPI_EVENT_NAMES)
            self.assertEqual(ev["action_source"], "website")
            self.assertIn("event_time", ev)
            self.assertIn("event_id", ev)
            self.assertIn("user_data", ev)

            # User data — at least one match key required by Meta
            self.assertIn("em", ev["user_data"])

            # Value + currency for optimization
            self.assertEqual(ev["custom_data"]["value"], 39.0)
            self.assertEqual(ev["custom_data"]["currency"], "USD")

    def test_LS_webhook_with_no_custom_event_id_still_works(self):
        # Edge case: client did NOT pass event_id at checkout (bookmarked
        # LS link, direct nav, etc). Server still fires with a fresh UUID
        # — the conversion gets counted, just won't dedup with any client
        # event. Better to over-count than miss.
        payload = _build_capi_payload({"email": "x@y.com", "total_cents": 3900}, "")
        for ev in payload["data"]:
            self.assertEqual(len(ev["event_id"]), 36)

    def test_LS_webhook_with_eur_currency(self):
        payload = _build_capi_payload(
            {"email": "eu@example.com", "total_cents": 3500, "currency": "EUR"},
            "evt-1",
        )
        for ev in payload["data"]:
            self.assertEqual(ev["custom_data"]["currency"], "EUR")
            self.assertEqual(ev["custom_data"]["value"], 35.0)


if __name__ == "__main__":
    unittest.main(verbosity=2)
