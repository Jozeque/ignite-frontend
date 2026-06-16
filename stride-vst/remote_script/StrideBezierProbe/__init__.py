"""
Stride Bezier Probe — Read-only test of Live 12's Envelope.create_event API.

WHY THIS EXISTS:
  structure-void's Live 12 docs reveal:
    - Envelope.create_event(EnvelopeEvent)
    - EnvelopeEvent(time, value, control_coefficients=...)
    - EnvelopeEventControlCoefficients(x1, y1, x2, y2)   # cubic bezier
  StrideWriter never tried this — it uses insert_step + micro-step
  subdivision to fake curves. If create_event works AND persists the
  bezier coefficients, Stride can write native bezier envelopes,
  eliminating the .alc drag flow.

INSTALL:
  1. Copy this folder (StrideBezierProbe/) to:
       Win:  C:\\ProgramData\\Ableton\\Live 12 Suite\\Resources\\MIDI Remote Scripts\\
       Mac:  /Applications/Ableton Live 12 Suite.app/Contents/App-Resources/MIDI Remote Scripts/
  2. Ableton: Preferences -> Link/Tempo/MIDI -> Control Surface slot -> StrideBezierProbe
  3. Open the log: Help -> Show Log File (or %APPDATA%/Ableton/Live x.x.x/Preferences/Log.txt)

RUN:
  1. Load a device with a continuous (non-quantized) parameter on a track
  2. Create a MIDI clip on that track, double-click it (so it's the detail clip)
  3. Drop ANY file at ~/_stride_bezier_probe.json (e.g. `echo {} > ~/_stride_bezier_probe.json`)
  4. Read result at  ~/_stride_bezier_probe_result.json
  5. After the probe, look at the param's envelope in Ableton — if you see
     a curve between the two written points (not a straight line), bezier
     persistence is REAL and Stride can ship native bezier writes.

This script does NOT touch the project beyond the selected clip/param.
"""

from __future__ import absolute_import
import json
import os
import traceback

try:
    from _Framework.ControlSurface import ControlSurface
except ImportError:
    from ableton.v3.control_surface import ControlSurface

_HOME = os.path.expanduser("~")
TRIGGER = os.path.join(_HOME, "_stride_bezier_probe.json")
RESULT = os.path.join(_HOME, "_stride_bezier_probe_result.json")

CANDIDATE_MODULES = ("Live.Envelope", "Live.Clip", "Live.Automation",
                     "Live.AutomationEnvelope", "Live.ClipEnvelope")


def create_instance(c_instance):
    return StrideBezierProbe(c_instance=c_instance)


class StrideBezierProbe(ControlSurface):

    def __init__(self, c_instance):
        super(StrideBezierProbe, self).__init__(c_instance)
        self.log_message("BezierProbe: ready. Drop %s to run." % TRIGGER)
        self._poll()

    def _poll(self):
        try:
            if os.path.exists(TRIGGER):
                self.log_message("BezierProbe: trigger seen")
                try:
                    os.remove(TRIGGER)
                except Exception:
                    pass
                self._run_probe()
        except Exception as e:
            self.log_message("BezierProbe: poll error: " + str(e))
        self.schedule_message(50, self._poll)

    # ─── reporting ────────────────────────────────────────────────────────

    def _rec(self, results, name, ok, info="", err=None):
        results.append({
            "test": name,
            "ok": bool(ok),
            "info": str(info),
            "error": (repr(err) if err else None),
        })
        tag = "PASS" if ok else "FAIL"
        suffix = (" :: " + repr(err)) if err else ""
        self.log_message("BezierProbe: [%s] %s — %s%s" % (tag, name, info, suffix))

    def _finish(self, results, summary):
        passes = sum(1 for r in results if r["ok"])
        total = len(results)
        full = "%s (%d/%d)" % (summary, passes, total)
        try:
            with open(RESULT, "w") as f:
                json.dump({"summary": full, "results": results}, f, indent=2)
            self.log_message("BezierProbe: wrote %s — %s" % (RESULT, full))
        except Exception as e:
            self.log_message("BezierProbe: could not write result file: " + str(e))

    # ─── probe ────────────────────────────────────────────────────────────

    def _run_probe(self):
        results = []

        # 1) Find EnvelopeEvent + EnvelopeEventControlCoefficients in any plausible module
        EnvelopeEvent = None
        EnvelopeEventControlCoefficients = None
        found_in = None
        for mod_path in CANDIDATE_MODULES:
            try:
                mod = __import__(mod_path, globals(), locals(), ["*"], 0)
                ee = getattr(mod, "EnvelopeEvent", None)
                cc = getattr(mod, "EnvelopeEventControlCoefficients", None)
                if ee and cc:
                    EnvelopeEvent = ee
                    EnvelopeEventControlCoefficients = cc
                    found_in = mod_path
                    self._rec(results, "import_classes",
                              True, "from %s" % mod_path)
                    break
                else:
                    self._rec(results, "probe_module_" + mod_path,
                              False, "module imported, classes missing (ee=%s cc=%s)"
                              % (bool(ee), bool(cc)))
            except Exception as e:
                self._rec(results, "probe_module_" + mod_path, False, "", e)

        if not (EnvelopeEvent and EnvelopeEventControlCoefficients):
            self._finish(results, "FAIL: EnvelopeEvent classes not importable in this Live build")
            return

        # 2) Construct ControlCoefficients with straight-line defaults.
        # Boost.Python rejects kwargs — must pass 4 positional floats.
        try:
            cc_default = EnvelopeEventControlCoefficients(0.5, 0.5, 0.5, 0.5)
            self._rec(results, "new_coeffs_default", True,
                      "x1=%s y1=%s x2=%s y2=%s" %
                      (cc_default.x1, cc_default.y1, cc_default.x2, cc_default.y2))
        except Exception as e:
            self._rec(results, "new_coeffs_default", False, "", e)
            self._finish(results, "FAIL on default ControlCoefficients")
            return

        # 3) Construct ControlCoefficients with bezier values (positional only)
        try:
            cc_bez = EnvelopeEventControlCoefficients(0.25, 0.9, 0.75, 0.1)
            self._rec(results, "new_coeffs_bezier", True,
                      "x1=%s y1=%s x2=%s y2=%s" % (cc_bez.x1, cc_bez.y1, cc_bez.x2, cc_bez.y2))
        except Exception as e:
            self._rec(results, "new_coeffs_bezier", False, "", e)
            self._finish(results, "FAIL constructing bezier coeffs")
            return

        # 4) Construct EnvelopeEvent (positional: time, value, control_coefficients)
        try:
            ev_probe = EnvelopeEvent(0.0, 0.5, cc_bez)
            self._rec(results, "new_envelope_event", True,
                      "time=%s value=%s coeffs=(%s,%s,%s,%s)" %
                      (ev_probe.time, ev_probe.value,
                       ev_probe.control_coefficients.x1, ev_probe.control_coefficients.y1,
                       ev_probe.control_coefficients.x2, ev_probe.control_coefficients.y2))
        except Exception as e:
            self._rec(results, "new_envelope_event", False, "", e)
            self._finish(results, "FAIL constructing EnvelopeEvent")
            return

        # 5) Locate a clip — prefer detail_clip, fall back to highlighted slot
        clip = None
        try:
            clip = self.song().view.detail_clip
        except Exception:
            pass
        if clip is None:
            try:
                slot = self.song().view.highlighted_clip_slot
                if slot and slot.has_clip:
                    clip = slot.clip
            except Exception:
                pass
        if clip is None:
            self._rec(results, "select_clip", False,
                      "no detail_clip and no clip in highlighted slot — double-click a MIDI clip then retrigger")
            self._finish(results, "ABORT: no clip selected")
            return
        self._rec(results, "select_clip", True,
                  "name=%s length=%s" % (clip.name, clip.length))

        # 6) Find the CLIP'S OWN TRACK. Ableton enforces that the parameter
        #    being automated belongs to the same track as the clip. Walking
        #    canonical_parent is layout-dependent:
        #       Session view:     clip -> clip_slot -> track
        #       Arrangement view: clip -> track directly
        #    So we walk up until we hit an object that quacks like a Track
        #    (has .devices and .clip_slots). Anything else (Song, ClipSlot,
        #    Scene) gets skipped past.
        def _is_track(obj):
            return obj is not None and hasattr(obj, "devices") and hasattr(obj, "clip_slots")

        track = None
        try:
            current = clip
            for _ in range(6):
                if current is None:
                    break
                if _is_track(current):
                    track = current
                    break
                try:
                    current = current.canonical_parent
                except Exception:
                    break
        except Exception as e:
            self._rec(results, "resolve_clip_track", False, "", e)

        if track is None:
            self._rec(results, "resolve_clip_track", False,
                      "no Track found by walking canonical_parent from clip")
            try:
                track = self.song().view.selected_track
                self._rec(results, "fallback_selected_track", True,
                          "track='%s' (WARNING: may not match clip's track)" % track.name)
            except Exception as e2:
                self._rec(results, "fallback_selected_track", False, "", e2)
                self._finish(results, "ABORT: could not resolve any track")
                return
        else:
            self._rec(results, "resolve_clip_track", True,
                      "track='%s'" % (track.name or "(unnamed)"))

        # 7) Find a continuous (non-quantized) DeviceParameter on the
        #    clip's own track.
        param = None
        param_loc = ""
        try:
            for di, d in enumerate(track.devices):
                for pi, p in enumerate(d.parameters):
                    try:
                        if p.is_quantized:
                            continue
                    except Exception:
                        continue
                    if p.name == "Device On":
                        continue
                    param = p
                    param_loc = "device[%d].param[%d] '%s'" % (di, pi, p.name)
                    break
                if param:
                    break
        except Exception as e:
            self._rec(results, "find_param", False, "", e)
            self._finish(results, "ABORT")
            return
        if param is None:
            self._rec(results, "find_param", False,
                      "no continuous DeviceParameter on clip's track '%s' — load a device with a continuous knob on this track" % track.name)
            self._finish(results, "ABORT: load a device with a continuous knob")
            return
        self._rec(results, "find_param", True,
                  "%s min=%s max=%s" % (param_loc, param.min, param.max))

        # 7) Get/create envelope for that param
        env = None
        try:
            env = clip.automation_envelope(param)
            if env is None:
                clip.create_automation_envelope(param)
                env = clip.automation_envelope(param)
        except Exception as e:
            self._rec(results, "get_or_create_envelope", False, "", e)
            self._finish(results, "ABORT: envelope creation raised")
            return
        if env is None:
            self._rec(results, "get_or_create_envelope", False, "still None")
            self._finish(results, "ABORT: no envelope")
            return
        self._rec(results, "get_or_create_envelope", True, "obtained")

        # 8) Clear any existing events in 0..4 beats
        try:
            env.delete_events_in_range(0.0, float(clip.length))
            self._rec(results, "clear_range", True, "0..%s" % clip.length)
        except Exception as e:
            self._rec(results, "clear_range", False, "", e)

        # 9) Diagnostic: Live version + full enumeration of Envelope methods.
        try:
            app = self.application()
            ver = "%d.%d.%d" % (app.get_major_version(),
                                app.get_minor_version(),
                                app.get_bugfix_version())
            self._rec(results, "live_version", True, ver)
        except Exception as e:
            self._rec(results, "live_version", False, "", e)

        try:
            env_methods = sorted([m for m in dir(env) if not m.startswith("_")])
            self._rec(results, "envelope_methods", True,
                      "[%s]" % ", ".join(env_methods))
        except Exception as e:
            self._rec(results, "envelope_methods", False, "", e)

        # 10) Try every plausible write-method name. First one that works wins.
        pmin = float(param.min)
        pmax = float(param.max)
        v_low = pmin + 0.10 * (pmax - pmin)
        v_high = pmin + 0.90 * (pmax - pmin)
        ev_obj = EnvelopeEvent(0.0, v_low,
                               EnvelopeEventControlCoefficients(0.05, 0.95, 0.95, 0.05))

        candidates = [
            # (method_name, args_to_pass)
            ("create_event",      [ev_obj]),
            ("insert_event",      [ev_obj]),
            ("add_event",         [ev_obj]),
            ("add_breakpoint",    [0.0, v_low, 0.05, 0.95, 0.95, 0.05]),
            ("insert_breakpoint", [0.0, v_low, 0.05, 0.95, 0.95, 0.05]),
            ("set_breakpoints",   [[ev_obj]]),
        ]
        bezier_method = None
        for name, args in candidates:
            if not hasattr(env, name):
                self._rec(results, "method_" + name, False, "not present on Envelope")
                continue
            try:
                getattr(env, name)(*args)
                self._rec(results, "method_" + name, True, "called successfully")
                bezier_method = name
                break
            except Exception as e:
                self._rec(results, "method_" + name, False, "", e)

        # 11) Baseline fallback: insert_step (known good) — proves the write
        #     surface is reachable even if no bezier API name worked.
        try:
            env.delete_events_in_range(2.5, 4.0)
            env.insert_step(3.0, 0.5, v_high)
            self._rec(results, "baseline_insert_step", True,
                      "insert_step works (StrideWriter fallback path proven)")
        except Exception as e:
            self._rec(results, "baseline_insert_step", False, "", e)

        # 12) Read back whatever's in the envelope now via every plausible API
        try:
            evs = list(env.events_in_range(0.0, 4.0))
            persisted = []
            for e in evs:
                row = {"time": getattr(e, "time", None), "value": getattr(e, "value", None)}
                try:
                    cc = e.control_coefficients
                    row.update({
                        "x1": getattr(cc, "x1", None), "y1": getattr(cc, "y1", None),
                        "x2": getattr(cc, "x2", None), "y2": getattr(cc, "y2", None),
                    })
                except Exception:
                    row["no_coeffs"] = True
                persisted.append(row)
            self._rec(results, "read_back_events", True,
                      "method=%s count=%d %s" %
                      (bezier_method or "none-worked", len(persisted),
                       json.dumps(persisted)))

            curved = any(
                p.get("x1") not in (None, 0.5) or p.get("y1") not in (None, 0.5) or
                p.get("x2") not in (None, 0.5) or p.get("y2") not in (None, 0.5)
                for p in persisted
            )
            self._rec(results, "bezier_coeffs_persisted", curved,
                      "non-default coeffs survived round-trip!" if curved
                      else "no non-default coeffs in round-trip (either no bezier API worked, or coeffs were stripped)")
        except Exception as e:
            self._rec(results, "read_back_events", False, "", e)

        self._finish(results, "DONE (imported from %s)" % found_in)

    def disconnect(self):
        self.log_message("BezierProbe: disconnected")
        super(StrideBezierProbe, self).disconnect()
