"""
Stride Inject — Ableton MIDI Remote Script (v.next direct-inject path).

Writes automation envelopes directly into the SELECTED clip on the
selected track. No .alc file, no drag-and-drop step.

Prefers Live 12's native bezier envelope API:
    env.create_event(EnvelopeEvent(
        time, value,
        EnvelopeEventControlCoefficients(x1, y1, x2, y2)))

If those classes are not importable in the running Live build, falls
back to insert_step subdivision (the legacy StrideWriter behaviour) so
the direct-inject UX still works — only the curve fidelity differs.

This script is PARALLEL to (not a replacement for) StrideWriter. It uses
its own trigger/result filenames and a separate Control Surface slot.
The legacy StrideWriter is left untouched so anyone using it today
continues to work exactly as before.

INSTALL:
    1. Copy this folder (StrideInject/) to Ableton's MIDI Remote Scripts dir:
         Win:  C:\\ProgramData\\Ableton\\Live 12 Suite\\Resources\\MIDI Remote Scripts\\
         Mac:  /Applications/Ableton Live 12 Suite.app/Contents/App-Resources/MIDI Remote Scripts/
    2. Ableton -> Preferences -> Link/Tempo/MIDI -> Control Surface slot -> StrideInject
    3. Done. The script is silent until Stride sends it work.

PROTOCOL (file-based, polled every 20ms):
    Trigger:  ~/_stride_inject_trigger.json  (written by Stride's M4L bridge)
    Result:   ~/_stride_inject_result.json   (read back by Stride's M4L bridge)

Payload schema is documented at the bottom of this file.
"""

from __future__ import absolute_import
import json
import os
import struct
import traceback

try:
    from _Framework.ControlSurface import ControlSurface
except ImportError:
    from ableton.v3.control_surface import ControlSurface

_HOME = os.path.expanduser("~")
TRIGGER = os.path.join(_HOME, "_stride_inject_trigger.json")
RESULT = os.path.join(_HOME, "_stride_inject_result.json")

# Subdivision used by the step-mode fallback. Matches legacy StrideWriter.
LEGACY_STEP_SIZE = 0.02

# Cubic bezier identity — a straight line from P0 to P3.
DEFAULT_COEFFS = (0.5, 0.5, 0.5, 0.5)

_CANDIDATE_MODULES = (
    "Live.Envelope",
    "Live.Clip",
    "Live.Automation",
    "Live.AutomationEnvelope",
    "Live.ClipEnvelope",
)


def _d(v):
    """Force a value to a pure CPython float (Boost.Python rejects subclasses)."""
    return struct.unpack('d', struct.pack('d', float(v)))[0]


def create_instance(c_instance):
    return StrideInject(c_instance=c_instance)


def _probe_bezier_classes(log):
    """Locate EnvelopeEvent + EnvelopeEventControlCoefficients in any plausible
    Live module. Returns (EE, EECC) or (None, None) — caller decides fallback."""
    for mod_path in _CANDIDATE_MODULES:
        try:
            mod = __import__(mod_path, globals(), locals(), ["*"], 0)
            ee = getattr(mod, "EnvelopeEvent", None)
            cc = getattr(mod, "EnvelopeEventControlCoefficients", None)
            if ee and cc:
                log("StrideInject: bezier classes found in " + mod_path)
                return ee, cc
        except Exception:
            pass
    log("StrideInject: bezier classes NOT importable — falling back to insert_step")
    return None, None


class StrideInject(ControlSurface):

    def __init__(self, c_instance):
        super(StrideInject, self).__init__(c_instance)
        self._EnvelopeEvent, self._ControlCoeffs = _probe_bezier_classes(self.log_message)
        # Tri-state: None=untested, True/False=tested against a real envelope.
        # Necessary because in Live 12.3.0 the DATA classes import fine but
        # env.create_event is NOT actually exposed — we can only find out by
        # probing a real envelope object the first time we get one.
        self._create_event_works = None
        self._mode_default = "bezier" if self._EnvelopeEvent else "step"
        self._mode = self._mode_default
        self.log_message("StrideInject: ready (classes-imported=%s, write-mode-at-startup=%s). Watching %s" % (
            self._EnvelopeEvent is not None, self._mode_default, TRIGGER))
        self._poll()

    # ─── polling loop ─────────────────────────────────────────────────────

    def _poll(self):
        try:
            if os.path.exists(TRIGGER):
                self.log_message("StrideInject: trigger received")
                try:
                    with open(TRIGGER, "r") as f:
                        data = json.load(f)
                    try:
                        os.remove(TRIGGER)
                    except Exception:
                        pass
                except Exception as e:
                    self._fail("Could not read trigger file: " + str(e))
                    self.schedule_message(20, self._poll)
                    return
                try:
                    self._write_inject(data)
                except Exception as e:
                    self.log_message("StrideInject: unhandled error: " + str(e))
                    self.log_message(traceback.format_exc())
                    self._fail("Internal error: " + str(e))
        except Exception as e:
            self.log_message("StrideInject: poll error: " + str(e))
        self.schedule_message(20, self._poll)

    # ─── result reporting ─────────────────────────────────────────────────

    def _ok(self, params_written, points_written):
        self._result({
            "success": True,
            "message": "OK",
            "mode": self._mode,
            "params_written": params_written,
            "points_written": points_written,
        })

    def _fail(self, message, params_written=0):
        self._result({
            "success": False,
            "message": message,
            "mode": self._mode,
            "params_written": params_written,
            "points_written": 0,
        })

    def _result(self, payload):
        try:
            with open(RESULT, "w") as f:
                json.dump(payload, f)
        except Exception as e:
            self.log_message("StrideInject: could not write result file: " + str(e))

    # ─── target resolution ────────────────────────────────────────────────

    def _get_target_clip(self, data, target_length):
        song = self.song()
        track = song.view.selected_track
        clip_slot_idx = int(data.get("clip_slot", 0))
        create_if_missing = bool(data.get("create_clip", True))

        if clip_slot_idx >= len(track.clip_slots):
            return None, "Clip slot %d out of range" % clip_slot_idx
        slot = track.clip_slots[clip_slot_idx]

        if not slot.has_clip:
            if not create_if_missing:
                return None, "No clip in slot %d" % clip_slot_idx
            try:
                slot.create_clip(_d(target_length))
            except Exception as e:
                return None, "create_clip failed: " + str(e)

        clip = slot.clip
        try:
            if abs(float(clip.length) - target_length) > 0.1:
                clip.loop_end = _d(target_length)
        except Exception as e:
            self.log_message("StrideInject: could not resize clip: " + str(e))
        try:
            clip.looping = True
        except Exception:
            pass
        return clip, None

    def _resolve_param(self, lom_path):
        """Resolve a LOM path string (as emitted by scanner_max.js) to a
        DeviceParameter. Mirrors StrideWriter._resolve_param semantics."""
        if not lom_path:
            return None
        parts = lom_path.split()
        obj = self.song()
        i = 0
        try:
            while i < len(parts):
                part = parts[i]
                if part == "live_set":
                    i += 1
                elif part == "view" and i + 1 < len(parts) and parts[i + 1] == "selected_track":
                    obj = self.song().view.selected_track
                    i += 2
                elif part in ("tracks", "return_tracks", "devices", "chains", "parameters") and i + 1 < len(parts):
                    idx = int(parts[i + 1])
                    obj = getattr(obj, part)[idx]
                    i += 2
                else:
                    i += 1
        except Exception as e:
            self.log_message("StrideInject: resolution failed for '%s' — %s" % (lom_path, str(e)))
            return None
        if hasattr(obj, "min") and hasattr(obj, "max") and hasattr(obj, "value"):
            return obj
        self.log_message("StrideInject: resolved object is not a DeviceParameter")
        return None

    def _get_or_create_envelope(self, clip, param):
        """clip.clear_envelope() invalidates the envelope reference in Live 12 —
        we never call it. Use env.delete_events_in_range() instead. This is the
        hard-won lesson from StrideWriter; preserved here verbatim."""
        env = None
        try:
            env = clip.automation_envelope(param)
        except Exception:
            pass
        if env is None:
            try:
                clip.create_automation_envelope(param)
            except Exception:
                pass
            try:
                env = clip.automation_envelope(param)
            except Exception:
                pass
        return env

    # ─── curve -> bezier coefficient mapping ──────────────────────────────

    def _coeffs_for_segment(self, p0, p1):
        """Map Stride's per-point `curve` field to cubic bezier coefficients.

        Canvas stores `curve` in roughly [-1, 1] describing how the segment
        AFTER p0 bends:
            curve == 0 -> straight line (identity bezier)
            curve >  0 -> convex bend
            curve <  0 -> concave bend

        Phase A behaviour: straight-line bezier for curve==0 (the win is one
        event per canvas point vs ~200 micro-steps, regardless of bend), with
        a conservative ease applied for non-zero curve. The exact mapping
        will be calibrated against the canvas renderer once probe results
        confirm Ableton actually persists the coefficients."""
        curve = float(p0.get("curve", 0) or 0)
        if abs(curve) < 1e-6:
            return DEFAULT_COEFFS
        mag = min(1.0, abs(curve))
        if curve > 0:
            return (0.25, 0.5 + 0.4 * mag,
                    0.75, 0.5 + 0.4 * mag)
        else:
            return (0.25, 0.5 - 0.4 * mag,
                    0.75, 0.5 - 0.4 * mag)

    # ─── write paths ──────────────────────────────────────────────────────

    def _write_bezier(self, env, points, target_length, pmin, pmax):
        EE = self._EnvelopeEvent
        CC = self._ControlCoeffs

        try:
            env.delete_events_in_range(_d(0.0), _d(target_length))
        except Exception:
            pass

        sorted_pts = sorted(points, key=lambda p: float(p.get("time", 0)))
        pts_written = 0
        for i, p in enumerate(sorted_pts):
            t = _d(p.get("time", 0))
            v_norm = max(0.0, min(1.0, float(p.get("value", 0))))
            v_actual = _d(pmin + v_norm * (pmax - pmin))

            if i + 1 < len(sorted_pts):
                x1, y1, x2, y2 = self._coeffs_for_segment(p, sorted_pts[i + 1])
            else:
                x1, y1, x2, y2 = DEFAULT_COEFFS

            try:
                # Boost.Python bindings reject kwargs — pass positional floats.
                coeffs = CC(_d(x1), _d(y1), _d(x2), _d(y2))
                ev = EE(t, v_actual, coeffs)
                env.create_event(ev)
                pts_written += 1
            except Exception as e:
                self.log_message("StrideInject: create_event failed at t=%s: %s" % (t, str(e)))
        return pts_written

    def _write_step(self, env, points, target_length, pmin, pmax):
        """Subdivision fallback — mirrors StrideWriter line-for-line."""
        try:
            env.delete_events_in_range(_d(0.0), _d(target_length))
        except Exception:
            pass

        sorted_pts = sorted(points, key=lambda p: float(p.get("time", 0)))
        pts_written = 0
        for i in range(len(sorted_pts)):
            t0 = _d(sorted_pts[i].get("time", 0))
            v0 = _d(sorted_pts[i].get("value", 0))
            if i + 1 < len(sorted_pts):
                t1 = _d(sorted_pts[i + 1].get("time", 0))
                v1 = _d(sorted_pts[i + 1].get("value", 0))
            else:
                t1 = target_length
                v1 = v0

            seg = t1 - t0
            if seg <= 0.0001:
                continue
            n = max(1, int(seg / LEGACY_STEP_SIZE))
            step_dur = _d(seg / n)
            for s in range(n):
                frac = s / float(n)
                v = v0 + frac * (v1 - v0)
                t = _d(t0 + s * step_dur)
                clamped = max(0.0, min(1.0, v))
                actual = _d(pmin + clamped * (pmax - pmin))
                env.insert_step(_d(t), _d(step_dur), _d(actual))
                pts_written += 1
        return pts_written

    # ─── main entry ───────────────────────────────────────────────────────

    def _write_inject(self, data):
        clip_bars = int(data.get("clip_bars", 4))
        target_length = clip_bars * 4
        force_legacy = bool(data.get("force_legacy_step", False))
        use_bezier = (self._EnvelopeEvent is not None) and (not force_legacy)
        self._mode = "bezier" if use_bezier else "step"

        clip, err = self._get_target_clip(data, target_length)
        if clip is None:
            self._fail(err or "No target clip")
            return

        params_written = 0
        points_written = 0
        for pd in data.get("params", []):
            points = pd.get("points", [])
            if not points:
                continue

            param = self._resolve_param(pd.get("_path"))
            if param is None:
                self.log_message("StrideInject: could not resolve param '%s' — skipping" % pd.get("name"))
                continue

            try:
                pmin = _d(pd["min"]) if "min" in pd else _d(param.min)
                pmax = _d(pd["max"]) if "max" in pd else _d(param.max)
            except Exception:
                pmin = _d(param.min)
                pmax = _d(param.max)

            env = self._get_or_create_envelope(clip, param)
            if env is None:
                self.log_message("StrideInject: no envelope for '%s' — skipping" % pd.get("name"))
                continue

            # First-time runtime check: in Live 12.3.0 the EnvelopeEvent
            # classes import successfully but env.create_event is NOT
            # actually exposed at the Remote Scripts layer (verified via
            # StrideBezierProbe). Probe once and downgrade for this whole
            # run if the method's missing. Cached across params.
            if use_bezier and self._create_event_works is None:
                self._create_event_works = hasattr(env, 'create_event')
                if not self._create_event_works:
                    self.log_message("StrideInject: env.create_event not exposed in this Live build — falling back to step mode for the rest of this run")
            if use_bezier and not self._create_event_works:
                use_bezier = False
                self._mode = "step"

            try:
                if use_bezier:
                    n = self._write_bezier(env, points, target_length, pmin, pmax)
                else:
                    n = self._write_step(env, points, target_length, pmin, pmax)
                if n > 0:
                    params_written += 1
                    points_written += n
                self.log_message("StrideInject: %s -> %d events (%s mode)" % (
                    pd.get("name"), n, self._mode))
            except Exception as e:
                self.log_message("StrideInject: write failed for '%s': %s" % (pd.get("name"), str(e)))
                self.log_message(traceback.format_exc())

        if params_written > 0:
            self._ok(params_written, points_written)
        else:
            self._fail("No parameters were written — check Ableton log", 0)

    def disconnect(self):
        self.log_message("StrideInject: disconnected")
        super(StrideInject, self).disconnect()


# ─── PAYLOAD_SCHEMA ────────────────────────────────────────────────────────
# Trigger file (~/_stride_inject_trigger.json):
# {
#   "create_clip": true,
#   "clip_bars": 4,
#   "clip_slot": 0,
#   "force_legacy_step": false,
#   "params": [
#     {
#       "id": 12, "name": "Filter Freq",
#       "_path": "live_set view selected_track devices 0 parameters 7",
#       "min": 0.0, "max": 1.0, "is_log": false,
#       "points": [
#         { "time": 0.0, "value": 0.0, "curve": 0 },
#         { "time": 1.5, "value": 0.8, "curve": 0.3 }
#       ]
#     }
#   ]
# }
#
# Result file (~/_stride_inject_result.json):
# {
#   "success": true | false,
#   "message": "OK" | "<error>",
#   "mode": "bezier" | "step",
#   "params_written": N,
#   "points_written": M
# }
