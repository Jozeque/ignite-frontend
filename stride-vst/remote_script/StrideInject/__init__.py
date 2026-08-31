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
                    if isinstance(data, dict) and data.get("action") == "read_probe":
                        self._read_probe(data)
                    else:
                        self._write_inject(data)
                except Exception as e:
                    self.log_message("StrideInject: unhandled error: " + str(e))
                    self.log_message(traceback.format_exc())
                    self._fail("Internal error: " + str(e))
        except Exception as e:
            self.log_message("StrideInject: poll error: " + str(e))
        self.schedule_message(20, self._poll)

    # ─── result reporting ─────────────────────────────────────────────────

    def _ok(self, params_written, points_written, notes_written=0, written_paths=None):
        self._result({
            "success": True,
            "message": "OK",
            "mode": self._mode,
            "params_written": params_written,
            "points_written": points_written,
            "notes_written": notes_written,
            # Which params actually got an envelope. A count alone cannot tell the
            # caller WHICH lanes to hand over to Live: a param on another track is
            # skipped by design, and that lane must keep modulating.
            "written_paths": written_paths or [],
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
            # Arrangement clips can't take direct envelope writes and must not be
            # resized via loop_end. Hand the clip back untouched; _write_inject
            # detects it and routes to the rebuild-and-place arrangement path.
            # See docs/arrangement-inject-spec.md.
            return clip, None
        # Session clips: size to the requested bar count and loop (unchanged).
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

    def _resolve_macro(self, clip, macro_name):
        """Resolve one of Stride's OWN DAW-facing macro parameters by NAME.

        A hosted lane (Serum's WT Pos, say) has no LOM path of its own: the knob lives
        inside Stride, invisible to Live. What Live DOES see is the macro Stride
        publishes for it, named "<device>: <param>". So we search the CLIP'S OWN TRACK
        for a parameter with that exact name.

        The track is both the only place a clip envelope can reach and the smallest
        correct search space, which also settles the two-Strides-in-one-set case for
        free: each clip resolves against the Stride on its own track.
        """
        if not macro_name:
            return None
        track = self._resolve_clip_track(clip)
        if track is None:
            return None
        try:
            devices = list(track.devices)
        except Exception:
            return None
        # Racks nest, so walk chains too.
        stack = list(devices)
        seen = 0
        while stack and seen < 256:
            dev = stack.pop(0)
            seen += 1
            try:
                for p in dev.parameters:
                    try:
                        if str(p.name) == macro_name:
                            return p
                    except Exception:
                        continue
            except Exception:
                pass
            for attr in ("chains", "return_chains"):
                try:
                    for ch in getattr(dev, attr, []):
                        stack.extend(list(ch.devices))
                except Exception:
                    pass
        self.log_message("StrideInject: no macro named '%s' on the clip's track. Press "
                         "'Send to DAW' in Stride so Ableton exposes it." % macro_name)
        return None

    def _write_json(self, path, obj):
        try:
            with open(path, "w") as f:
                json.dump(obj, f, indent=2)
        except Exception as e:
            self.log_message("StrideInject: could not write " + path + ": " + str(e))

    def _read_probe(self, data):
        """Diagnostic + foundation for 'read existing curves' (Mode B).
        Reads the open clip's CLIP ENVELOPES via the proven Python path
        (clip.automation_envelope) and reports what's there. Walks the
        selected track's devices INCLUDING rack chains. READ-ONLY — never
        creates/clears. Writes ~/_stride_inject_read_probe.json."""
        probe_path = os.path.join(_HOME, "_stride_inject_read_probe.json")
        out = {"ok": True, "clip_name": "?", "clip_length": 0.0,
               "params_walked": 0, "params_with_env": 0, "found": [], "notes": []}
        def note(s):
            out["notes"].append(s)
            self.log_message("StrideInject ReadProbe: " + s)
        try:
            song = self.song()
            clip = None
            try:
                clip = song.view.detail_clip
            except Exception:
                clip = None
            if clip is None:
                try:
                    hs = song.view.highlighted_clip_slot
                    if hs is not None and hs.has_clip:
                        clip = hs.clip
                except Exception:
                    clip = None
            if clip is None:
                out["ok"] = False
                note("no clip selected (open a clip in the detail view)")
                self._write_json(probe_path, out)
                return
            try: out["clip_name"] = str(getattr(clip, "name", "?"))
            except Exception: pass
            try: out["clip_length"] = float(clip.length)
            except Exception: pass
            clip_len = out["clip_length"] or 4.0
            note("clip='%s' length=%s" % (out["clip_name"], out["clip_length"]))

            try:
                track = song.view.selected_track
            except Exception:
                track = None
            if track is None:
                out["ok"] = False
                note("no selected track")
                self._write_json(probe_path, out)
                return

            walked = [0]
            CAP = 400

            def test_param(param, label):
                if walked[0] >= CAP:
                    return
                walked[0] += 1
                env = None
                try:
                    env = clip.automation_envelope(param)
                except Exception as e:
                    if not out["found"]:
                        note("automation_envelope raised for '%s': %s" % (label, str(e)))
                    return
                if env is None:
                    return
                samples = []
                try:
                    for k in range(5):
                        t = clip_len * k / 4.0
                        samples.append(round(float(env.value_at_time(t)), 5))
                except Exception as e:
                    samples = ["value_at_time err: " + str(e)]
                ev_count = None
                try:
                    ev_count = len(list(env.events_in_range(0.0, clip_len)))
                except Exception as e:
                    ev_count = "events err: " + str(e)
                rec = {"param": label, "value_at_time": samples, "event_count": ev_count}
                try:
                    rec["min"] = float(param.min)
                    rec["max"] = float(param.max)
                except Exception:
                    pass
                out["found"].append(rec)

            def walk_device(dev):
                if walked[0] >= CAP:
                    return
                try:
                    dname = str(getattr(dev, "name", "dev"))
                except Exception:
                    dname = "dev"
                if dname == "StrideLink":
                    return
                try:
                    for p in dev.parameters:
                        if walked[0] >= CAP:
                            break
                        try:
                            pn = str(p.name)
                        except Exception:
                            pn = "?"
                        if pn == "Device On":
                            continue
                        test_param(p, dname + ": " + pn)
                except Exception:
                    pass
                try:
                    chains = getattr(dev, "chains", None)
                    if chains:
                        for ch in chains:
                            try:
                                for sub in ch.devices:
                                    walk_device(sub)
                            except Exception:
                                pass
                except Exception:
                    pass

            try:
                for dev in track.devices:
                    if walked[0] >= CAP:
                        break
                    walk_device(dev)
            except Exception as e:
                note("device walk error: " + str(e))

            out["params_walked"] = walked[0]
            out["params_with_env"] = len(out["found"])
            out["found"] = out["found"][:50]
            note("walked=%d params_with_env=%d" % (walked[0], len(out["found"])))
            self._write_json(probe_path, out)
        except Exception as e:
            out["ok"] = False
            out["fatal"] = str(e)
            self.log_message("StrideInject ReadProbe FATAL: " + str(e))
            self.log_message(traceback.format_exc())
            try:
                self._write_json(probe_path, out)
            except Exception:
                pass

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
            # A note at the very start of a warped or non-integer-length clip can read
            # back a hair below zero (field 2026-08-31: a clip at start_time 63.99,
            # length 16.01, losing its first-bar note on some injects but not others).
            # Dropping it deletes real MIDI, so nudge it onto the grid instead and only
            # reject something genuinely out of range.
            if -0.02 < start < 0.0:
                start = 0.0
            if pitch < 0 or pitch > 127 or start < 0 or dur <= 0:
                self.log_message("StrideInject: dropped an out-of-range note "
                                 "(pitch %s start %s dur %s)" % (pitch, start, dur))
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

        # Arrangement clips can't take direct envelope writes — rebuild the clip
        # in a Session slot and place it onto the timeline. Session path below is
        # untouched. See docs/arrangement-inject-spec.md.
        try:
            _is_arr = bool(getattr(clip, "is_arrangement_clip", False))
        except Exception:
            _is_arr = False
        if _is_arr:
            self._write_inject_arrangement(data, clip, clip_bars)
            return

        queue = []           # (env, time, dur, native_value) for chunked step writes
        params_written = 0
        points_written = 0
        written_paths = []
        for pd in data.get("params", []):
            points = pd.get("points", [])
            if not points:
                continue

            param = self._resolve_param(pd.get("_path")) if pd.get("_path") else None
            if param is None and pd.get("macro_name"):
                param = self._resolve_macro(clip, pd.get("macro_name"))
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
                        written_paths.append(pd.get("_path") or ("macro:" + str(pd.get("macro_name"))))
                    self.log_message("StrideInject: %s -> %d events (bezier)" % (pd.get("name"), n))
                else:
                    tuples = self._adaptive_step_tuples(points, target_length, pmin, pmax, use_log)
                    if tuples:
                        for (t, dur, val) in tuples:
                            queue.append((env, t, dur, val))
                        params_written += 1
                        points_written += len(tuples)
                        written_paths.append(pd.get("_path") or ("macro:" + str(pd.get("macro_name"))))
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
            self._ok(params_written, points_written, notes_written, written_paths)
            return

        # Step mode: every param resolved and its envelope exists, so the inject
        # has effectively succeeded — the queued insert_steps themselves are
        # reliable. Report success NOW so a big clip never trips a false bridge
        # timeout, then stream the writes in CHUNK_SIZE batches across the
        # scheduler (responsive, never blocks Ableton). The automation fills into
        # the clip as the queue drains.
        self._ok(params_written, points_written, notes_written, written_paths)
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

    # ─── Arrangement inject: rebuild-in-Session + place-on-timeline ────────
    #
    # Direct envelope writes are impossible on Arrangement clips (the LOM's
    # automation_envelope / create_automation_envelope return None there, and
    # even has_envelopes reads False). So we rebuild the clip in a Session slot
    # (where envelope writes work), then duplicate it onto the timeline at the
    # original clip's start (overwriting + extending as needed) and delete the
    # original. duplicate_clip_to_arrangement carries the clip envelopes across.
    # Full design + proof: docs/arrangement-inject-spec.md.

    def _resolve_clip_track(self, clip):
        """The clip's own track. Arrangement: clip -> track. Session: clip ->
        clip_slot -> track. Walk canonical_parent until it quacks like a Track;
        fall back to the selected track."""
        def _is_track(o):
            return o is not None and hasattr(o, "devices") and hasattr(o, "clip_slots")
        try:
            cur = clip
            for _ in range(6):
                if cur is None:
                    break
                if _is_track(cur):
                    return cur
                cur = getattr(cur, "canonical_parent", None)
        except Exception:
            pass
        try:
            return self.song().view.selected_track
        except Exception:
            return None

    def _read_clip_notes(self, clip, length):
        """Read a clip's notes as [{pitch,time,duration,velocity}]. Works on
        Arrangement clips (the note API is not blind like the envelope API).
        Prefers get_notes_extended (Live 11+), falls back to get_notes."""
        out = []
        # Read from BEFORE zero. A clip that does not start on a beat boundary (field
        # 2026-08-31: start_time 63.99, length 16.012) can hold its first note at a
        # marginally NEGATIVE content time, and a read starting at exactly 0.0 never
        # sees it. That loss is invisible from the counts: 1 read, 1 written, and the
        # bar-1 note simply gone. The caller nudges small negatives back onto 0.
        try:
            vec = clip.get_notes_extended(0, 128, _d(-0.25), _d(float(length) + 0.50))
            for n in vec:
                out.append({"pitch": int(n.pitch), "time": float(n.start_time),
                            "duration": float(n.duration), "velocity": int(n.velocity)})
            return out
        except Exception:
            pass
        try:
            for row in clip.get_notes(_d(-0.25), 0, _d(float(length) + 0.50), 128):
                out.append({"pitch": int(row[0]), "time": float(row[1]),
                            "duration": float(row[2]), "velocity": int(row[3])})
        except Exception as e:
            self.log_message("StrideInject: arr read notes failed: " + str(e))
        return out

    def _write_notes_to_fresh_clip(self, clip, notes):
        """Add notes to a freshly-created (empty) clip using the MODERN
        add_new_notes API only — avoids the deprecated replace_selected_notes /
        set_notes path (the likely source of the Live confirmation popup). Falls
        back to the shared _write_notes only if add_new_notes is unavailable."""
        valid = []
        for n in notes:
            try:
                pitch = int(n.get("pitch"))
                start = float(n.get("time", 0))
                dur = float(n.get("duration", 0.25))
                vel = int(n.get("velocity", 100))
            except Exception:
                continue
            # A note at the very start of a warped or non-integer-length clip can read
            # back a hair below zero (field 2026-08-31: a clip at start_time 63.99,
            # length 16.01, losing its first-bar note on some injects but not others).
            # Dropping it deletes real MIDI, so nudge it onto the grid instead and only
            # reject something genuinely out of range.
            if -0.02 < start < 0.0:
                start = 0.0
            if pitch < 0 or pitch > 127 or start < 0 or dur <= 0:
                self.log_message("StrideInject: dropped an out-of-range note "
                                 "(pitch %s start %s dur %s)" % (pitch, start, dur))
                continue
            vel = 1 if vel < 1 else (127 if vel > 127 else vel)
            valid.append((pitch, start, dur, vel))
        if not valid:
            return 0
        try:
            from Live.Clip import MidiNoteSpecification as _MNS
            specs = tuple(_MNS(pitch=p, start_time=_d(s), duration=_d(d),
                               velocity=v, mute=False) for (p, s, d, v) in valid)
            clip.add_new_notes(specs)
            return len(valid)
        except Exception as e:
            self.log_message("StrideInject: add_new_notes (fresh) unavailable, falling back: " + str(e))
            return self._write_notes(clip, notes)

    def _find_empty_slot(self, track):
        """First empty Session slot on the track, or None."""
        try:
            for cs in track.clip_slots:
                try:
                    if not cs.has_clip:
                        return cs
                except Exception:
                    pass
        except Exception:
            pass
        return None

    def _apply_curves_sync(self, clip, params, target_length):
        """Write each param's curve into `clip`'s envelope SYNCHRONOUSLY (no
        chunk streaming) — the writes must be complete before the clip is
        duplicated to the timeline. Returns (params_written, points_written, written_paths).
        Reuses the same param resolution + bezier/step math as the Session
        path; only the (synchronous) emit differs."""
        use_bezier = (self._EnvelopeEvent is not None)
        params_written = 0
        points_written = 0
        written_paths = []
        for pd in params:
            points = pd.get("points", [])
            if not points:
                continue
            param = self._resolve_param(pd.get("_path")) if pd.get("_path") else None
            if param is None and pd.get("macro_name"):
                param = self._resolve_macro(clip, pd.get("macro_name"))
            if param is None:
                self.log_message("StrideInject: arr could not resolve '%s'" % pd.get("name"))
                continue
            try:
                pmin = _d(pd["min"]) if "min" in pd else _d(param.min)
                pmax = _d(pd["max"]) if "max" in pd else _d(param.max)
            except Exception:
                pmin = _d(param.min)
                pmax = _d(param.max)
            use_log = should_use_log(pd.get("name"), pmin, pmax, pd.get("is_log"))
            env = self._get_or_create_envelope(clip, param)
            if env is None:
                self.log_message("StrideInject: arr no envelope for '%s'" % pd.get("name"))
                continue
            if use_bezier and self._create_event_works is None:
                self._create_event_works = hasattr(env, 'create_event')
            this_bezier = use_bezier and bool(self._create_event_works)
            try:
                env.delete_events_in_range(_d(0.0), _d(target_length))
            except Exception:
                pass
            try:
                if this_bezier:
                    n = self._write_bezier(env, points, target_length, pmin, pmax, use_log)
                    if n > 0:
                        params_written += 1
                        points_written += n
                        written_paths.append(pd.get("_path") or ("macro:" + str(pd.get("macro_name"))))
                else:
                    tuples = self._adaptive_step_tuples(points, target_length, pmin, pmax, use_log)
                    for (t, dur, val) in tuples:
                        try:
                            env.insert_step(t, dur, val)
                        except Exception as e:
                            self.log_message("StrideInject: arr insert_step failed: " + str(e))
                    if tuples:
                        params_written += 1
                        points_written += len(tuples)
                        written_paths.append(pd.get("_path") or ("macro:" + str(pd.get("macro_name"))))
            except Exception as e:
                self.log_message("StrideInject: arr curve write failed for '%s': %s" % (pd.get("name"), str(e)))
        return params_written, points_written, written_paths

    def _write_inject_arrangement(self, data, original_clip, clip_bars):
        """Replace-in-place for an Arrangement clip: rebuild it with the curves and
        put it back at the original's start, carrying the original's notes (or the
        armed pattern's).

        NON-DESTRUCTIVE LENGTH (2026-08-31). This used to build the replacement at
        exactly the requested bar count, which SHORTENED a longer clip and silently
        discarded every note past that point. Injecting a 4-bar curve onto an 8-bar
        part destroyed half the MIDI. The clip is now never shorter than it was: the
        curves still map across the drawn window, and the rest of the part survives
        untouched."""
        if self._busy:
            self._fail("Busy writing a previous inject — try again in a moment")
            return
        L_new = float(clip_bars * 4)     # the drawn window: what the curves map across

        # 1) Capture the original BEFORE any mutation.
        try:
            T = float(original_clip.start_time)
        except Exception:
            self._fail("Arrangement inject: could not read the clip's start time")
            return
        try:
            orig_len = float(original_clip.length)
        except Exception:
            orig_len = L_new
        # Never shrink: the replacement is at least as long as what it replaces, so no
        # note can fall off the end. Growing is still allowed (a longer drawn window).
        L_clip = max(L_new, orig_len)
        cap = {}
        for attr in ("name", "color", "looping"):
            try:
                cap[attr] = getattr(original_clip, attr)
            except Exception:
                pass

        # 2) The clip's own track.
        track = self._resolve_clip_track(original_clip)
        if track is None:
            self._fail("Arrangement inject: could not resolve the clip's track")
            return

        # 3) Notes: armed-pattern payload notes if present, else the clip's own.
        #    Drop notes that start past the new (requested) length.
        notes = data.get("notes") or []
        if not notes:
            notes = self._read_clip_notes(original_clip, L_clip)
            self.log_message("StrideInject: arr read %d note(s) from the original clip "
                             "(len %.3f) at %s" % (len(notes), L_clip,
                             ", ".join("%.4f" % float(n.get("time", 0)) for n in notes[:12])))
        # Keep every note the clip actually holds. The old filter cut at the REQUESTED
        # length and was the note-loss bug; L_clip cannot be shorter than the original,
        # so this only ever drops notes that were already past the clip's own end.
        notes = [n for n in notes if float(n.get("time", 0)) < L_clip - 1e-6]

        # 4) Need a free Session slot to build the temp clip in.
        slot = self._find_empty_slot(track)
        if slot is None:
            self._fail("Arrangement inject needs a free Session slot on this track — free one and retry")
            return

        # 5) Group everything into one undo step where supported.
        song = self.song()
        undo = hasattr(song, "begin_undo_step") and hasattr(song, "end_undo_step")
        if undo:
            try:
                song.begin_undo_step()
            except Exception:
                undo = False

        params_written = 0
        points_written = 0
        notes_written = 0
        try:
            # 6) Build the temp Session clip at the REQUESTED length.
            slot.create_clip(_d(L_clip))
            temp = slot.clip
            try:
                temp.looping = True
            except Exception:
                pass
            for attr in ("name", "color"):
                if attr in cap:
                    try:
                        setattr(temp, attr, cap[attr])
                    except Exception:
                        pass
            # 7) Notes (modern API) + 8) curves (synchronous, before the copy).
            if notes:
                notes_written = self._write_notes_to_fresh_clip(temp, notes)
            params_written, points_written, written_paths = self._apply_curves_sync(temp, data.get("params", []), L_new)

            if params_written == 0 and notes_written == 0:
                try:
                    slot.delete_clip()
                except Exception:
                    pass
                if undo:
                    try:
                        song.end_undo_step()
                    except Exception:
                        pass
                self._fail("Nothing to inject — no curves or notes (check Ableton log)")
                return

            # 9) Delete the original, 10) place the temp at the original's start
            #    (overwrites + extends that span), 11) clean up the temp.
            try:
                track.delete_clip(original_clip)
            except Exception as e:
                self.log_message("StrideInject: arr delete original failed (place overwrites the span): " + str(e))
            track.duplicate_clip_to_arrangement(temp, _d(T))
            try:
                slot.delete_clip()
            except Exception as e:
                self.log_message("StrideInject: arr temp cleanup failed: " + str(e))
        except Exception as e:
            self.log_message("StrideInject: arrangement inject error: " + str(e))
            self.log_message(traceback.format_exc())
            try:
                slot.delete_clip()
            except Exception:
                pass
            if undo:
                try:
                    song.end_undo_step()
                except Exception:
                    pass
            self._fail("Arrangement inject failed: " + str(e))
            return

        if undo:
            try:
                song.end_undo_step()
            except Exception:
                pass

        self._mode = "arrangement"
        self.log_message("StrideInject: arrangement inject OK — %d bars drawn, clip %.2f beats "
                         "(was %.2f), %d params, %d notes at beat %.2f" % (
            clip_bars, L_clip, orig_len, params_written, notes_written, T))
        self._ok(params_written, points_written, notes_written, written_paths)

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
