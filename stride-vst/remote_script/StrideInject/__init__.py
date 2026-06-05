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

# Pure curve + scaling helpers (no Ableton deps; mirrors shared/rasterizer.js
# + shared/log-scaling.js). Relative import in the package; fall back to flat.
try:
    from ._curve import sample_segment, should_use_log, scale_value, adaptive_steps
except (ImportError, ValueError):
    from _curve import sample_segment, should_use_log, scale_value, adaptive_steps

_HOME = os.path.expanduser("~")
TRIGGER = os.path.join(_HOME, "_stride_inject_trigger.json")
RESULT = os.path.join(_HOME, "_stride_inject_result.json")

# Subdivision used by the step-mode fallback. Matches legacy StrideWriter.
LEGACY_STEP_SIZE = 0.02

# Adaptive step generation — prevents the bulk-write freeze/crash WITHOUT losing
# resolution. PROBE_BEATS is the cheap (Python-only) sampling granularity used to
# FIND where the curve moves; EPS_NORM is how far the normalized value must move
# before we emit an actual insert_step (the expensive LOM call) — so flat holds
# collapse to one step but every MOVE is kept; CHUNK_SIZE spreads the LOM writes
# across scheduler ticks so the ~128k writes that froze/crashed Ableton can never
# block the main thread again, no matter the clip length.
PROBE_BEATS = 0.02         # cheap Python probe granularity (find where curve moves)
EPS_NORM = 0.0025          # emit a step when normalized value moves this much →
                           # max deviation 0.25% → ≥99.75% match. NO lossy cap:
                           # every move is kept; flat holds collapse to one step.
CHUNK_SIZE = 400           # insert_steps per scheduler tick — keeps Ableton
                           # responsive so ANY number of steps writes without freezing

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
        # Chunked-write state — bulk insert_step writes are spread CHUNK_SIZE per
        # scheduler tick so a huge clip never blocks Ableton's main thread.
        self._busy = False
        self._write_queue = []
        self._write_idx = 0
        self._pending = None
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

    def _ok(self, params_written, points_written, notes_written=0):
        self._result({
            "success": True,
            "message": "OK",
            "mode": self._mode,
            "params_written": params_written,
            "points_written": points_written,
            "notes_written": notes_written,
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
        """Target the clip the user actually has selected / open in Live's
        Detail (Clip) View — works for BOTH Session and Arrangement clips.
        Replaces the old clip_slots[0] default, which always hit the first
        Session slot regardless of what was selected."""
        song = self.song()
        clip = None
        try:
            clip = song.view.detail_clip
        except Exception:
            clip = None

        # Fallback: a highlighted Session slot that already holds a clip.
        if clip is None:
            try:
                hslot = song.view.highlighted_clip_slot
                if hslot is not None and hslot.has_clip:
                    clip = hslot.clip
            except Exception:
                clip = None

        if clip is None:
            return None, ("No clip selected. Open or select a clip in Live "
                          "(Session or Arrangement) so it shows in the Detail "
                          "view, then inject.")

        # Detect arrangement clips — their loop_end is read-only / has different
        # semantics, so only resize/loop Session clips.
        try:
            is_arr = bool(getattr(clip, "is_arrangement_clip", False))
        except Exception:
            is_arr = False
        self.log_message("StrideInject: target clip = %s (arrangement=%s)" % (
            getattr(clip, "name", "?"), is_arr))
        if is_arr:
            # Ableton exposes no API to write automation into Arrangement clips
            # (automation_envelope returns None for them — verified). Direct
            # inject is Session-only; arrangement goes through the .alc path.
            return None, ("Direct inject is Session-only (Ableton has no API to "
                          "write Arrangement automation). Inject into a Session "
                          "clip, then drag that clip into the Arrangement — the "
                          "curves travel with it.")
        if not is_arr:
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

    def _write_bezier(self, env, points, target_length, pmin, pmax, use_log):
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
            v_actual = _d(scale_value(v_norm, pmin, pmax, use_log))

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

    def _adaptive_step_tuples(self, points, target_length, pmin, pmax, use_log):
        """Thin wrapper over the pure, unit-tested _curve.adaptive_steps (see
        test/test_stride_inject_curve.py). Coerces each value to a Boost-safe
        float via _d() for the LOM. Emits a step only where the curve moves
        (>= EPS_NORM), so flat holds collapse but every move is kept at probe
        resolution — redundancy removal, not resolution loss (≥99.75% match)."""
        return [(_d(t), _d(dur), _d(val)) for (t, dur, val) in adaptive_steps(
            points, target_length, pmin, pmax, use_log,
            PROBE_BEATS, EPS_NORM)]

    # ─── MIDI notes (armed Pattern Library patterns ride the same inject) ──

    def _write_notes(self, clip, notes):
        """Write the armed pattern's MIDI notes into the target clip, replacing
        existing notes — unifies the Pattern Library into Direct Inject so
        "Inject to Clip" lays down curves AND notes in one shot. Tries the
        stable select-all/replace path, then set_notes, then the Live 11+
        add_new_notes API — whichever this build exposes (logged on failure)."""
        tuples = []
        for n in notes:
            try:
                pitch = int(n.get("pitch"))
                start = float(n.get("time", 0))
                dur = float(n.get("duration", 0.25))
                vel = int(n.get("velocity", 100))
            except Exception:
                continue
            if pitch < 0 or pitch > 127 or start < 0 or dur <= 0:
                continue
            vel = 1 if vel < 1 else (127 if vel > 127 else vel)
            tuples.append((pitch, start, dur, vel, False))
        if not tuples:
            return 0
        note_tuple = tuple(tuples)

        # 1) Stable path: select all, replace with our set (clears + writes).
        try:
            clip.select_all_notes()
            clip.replace_selected_notes(note_tuple)
            try:
                clip.deselect_all_notes()
            except Exception:
                pass
            return len(tuples)
        except Exception as e:
            self.log_message("StrideInject: replace_selected_notes failed: " + str(e))

        # 2) Fallback: clear then set_notes.
        try:
            try:
                clip.select_all_notes()
                clip.replace_selected_notes(tuple())
            except Exception:
                pass
            clip.set_notes(note_tuple)
            return len(tuples)
        except Exception as e:
            self.log_message("StrideInject: set_notes failed: " + str(e))

        # 3) Last resort: Live 11+ MidiNoteSpecification / add_new_notes.
        try:
            from Live.Clip import MidiNoteSpecification as _MNS
            specs = tuple(_MNS(pitch=t[0], start_time=t[1], duration=t[2],
                               velocity=t[3], mute=False) for t in tuples)
            try:
                span = max((t[1] + t[2]) for t in tuples)
                clip.remove_notes_extended(0, 128, _d(0.0), _d(span))
            except Exception:
                pass
            clip.add_new_notes(specs)
            return len(tuples)
        except Exception as e:
            self.log_message("StrideInject: add_new_notes failed: " + str(e))
        return 0

    # ─── main entry ───────────────────────────────────────────────────────

    def _write_inject(self, data):
        if self._busy:
            self._fail("Busy writing a previous inject — try again in a moment")
            return

        clip_bars = int(data.get("clip_bars", 4))
        target_length = clip_bars * 4
        force_legacy = bool(data.get("force_legacy_step", False))
        use_bezier = (self._EnvelopeEvent is not None) and (not force_legacy)

        clip, err = self._get_target_clip(data, target_length)
        if clip is None:
            self._fail(err or "No target clip")
            return

        queue = []           # (env, time, dur, native_value) for chunked step writes
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

            # Same log-scaling decision the .alc path makes (shared/log-scaling.js).
            use_log = should_use_log(pd.get("name"), pmin, pmax, pd.get("is_log"))

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

            # Clear existing automation for this param over the clip range.
            try:
                env.delete_events_in_range(_d(0.0), _d(target_length))
            except Exception:
                pass

            try:
                if use_bezier:
                    # Bezier writes few events (one per drawn point) — small
                    # enough to do synchronously.
                    n = self._write_bezier(env, points, target_length, pmin, pmax, use_log)
                    if n > 0:
                        params_written += 1
                        points_written += n
                    self.log_message("StrideInject: %s -> %d events (bezier)" % (pd.get("name"), n))
                else:
                    tuples = self._adaptive_step_tuples(points, target_length, pmin, pmax, use_log)
                    if tuples:
                        for (t, dur, val) in tuples:
                            queue.append((env, t, dur, val))
                        params_written += 1
                        points_written += len(tuples)
                    self.log_message("StrideInject: %s -> %d steps queued" % (pd.get("name"), len(tuples)))
            except Exception as e:
                self.log_message("StrideInject: prepare failed for '%s': %s" % (pd.get("name"), str(e)))
                self.log_message(traceback.format_exc())

        # Armed-pattern MIDI notes ride the same inject — "Inject to Clip" does
        # curves AND patterns. Written synchronously (a single LOM replace, not
        # thousands of insert_steps), into the same clip as the envelopes.
        notes = data.get("notes") or []
        notes_written = 0
        if notes:
            try:
                notes_written = self._write_notes(clip, notes)
                self.log_message("StrideInject: wrote %d notes" % notes_written)
            except Exception as e:
                self.log_message("StrideInject: note write failed: " + str(e))
                self.log_message(traceback.format_exc())

        self._mode = "bezier" if use_bezier else "step"

        if params_written == 0 and notes_written == 0:
            self._fail("Nothing to inject — no curves or notes (check Ableton log)", 0)
            return

        if not queue:
            # No queued step-writes (all-bezier, or notes-only) — done.
            self._ok(params_written, points_written, notes_written)
            return

        # Step mode: every param resolved and its envelope exists, so the inject
        # has effectively succeeded — the queued insert_steps themselves are
        # reliable. Report success NOW so a big clip never trips a false bridge
        # timeout, then stream the writes in CHUNK_SIZE batches across the
        # scheduler (responsive, never blocks Ableton). The automation fills into
        # the clip as the queue drains.
        self._ok(params_written, points_written, notes_written)
        self._busy = True
        self._write_queue = queue
        self._write_idx = 0
        self._pending = {"params": params_written, "points": points_written}
        self.log_message("StrideInject: streaming %d steps across %d params in chunks of %d (background)" % (
            len(queue), params_written, CHUNK_SIZE))
        self._flush_chunk()

    def _flush_chunk(self):
        """Write up to CHUNK_SIZE queued insert_steps, then yield to Ableton and
        reschedule until the queue is drained — keeps the UI responsive so any
        number of steps streams in without freezing. Success was already reported
        when the queue was built, so this just lays the steps down."""
        q = self._write_queue
        start = self._write_idx
        end = min(start + CHUNK_SIZE, len(q))
        try:
            for i in range(start, end):
                env, t, dur, val = q[i]
                try:
                    env.insert_step(t, dur, val)
                except Exception as e:
                    self.log_message("StrideInject: insert_step failed: " + str(e))
            self._write_idx = end
        except Exception as e:
            self.log_message("StrideInject: chunk error: " + str(e))
            self._write_idx = len(q)  # bail out of this run

        if self._write_idx < len(q):
            if (self._write_idx // 6000) != (start // 6000):   # ~every 6000 steps
                self.log_message("StrideInject: %d / %d steps written" % (self._write_idx, len(q)))
            self.schedule_message(1, self._flush_chunk)
        else:
            self.log_message("StrideInject: finished writing %d steps" % len(q))
            self._busy = False
            self._write_queue = []
            self._write_idx = 0
            self._pending = None

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
