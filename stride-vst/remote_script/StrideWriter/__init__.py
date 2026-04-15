"""
Stride Writer — Ableton MIDI Remote Script
Writes automation envelopes with 1:1 accuracy using Python's LOM API.

The M4L device writes automation data to a trigger file.
This script picks it up and uses clip.automation_envelope().insert_step()
to write exact breakpoints — no thinning, no loss.

INSTALL:
  1. Copy the StrideWriter/ folder to:
     C:\ProgramData\Ableton\Live 12 Suite\Resources\MIDI Remote Scripts\
  2. In Ableton: Preferences → Link/Tempo/MIDI → Control Surface → StrideWriter
  3. Done — one-time setup
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
TRIGGER_FILE = os.path.join(_HOME, "_stride_trigger.json")
RESULT_FILE = os.path.join(_HOME, "_stride_result.json")


def _d(v):
    """Force a value to a pure CPython float (C double).
    Ableton's Boost.Python bindings reject float subclasses."""
    return struct.unpack('d', struct.pack('d', float(v)))[0]


def create_instance(c_instance):
    return StrideWriter(c_instance=c_instance)


class StrideWriter(ControlSurface):

    def __init__(self, c_instance):
        super(StrideWriter, self).__init__(c_instance)
        self.log_message("StrideWriter: Initialized — watching " + TRIGGER_FILE)
        self._poll()

    def _poll(self):
        try:
            if os.path.exists(TRIGGER_FILE):
                self.log_message("StrideWriter: Found trigger file")
                try:
                    with open(TRIGGER_FILE, "r") as f:
                        data = json.load(f)
                    os.remove(TRIGGER_FILE)
                    self._write_automation(data)
                except Exception as e:
                    self.log_message("StrideWriter: Error: " + str(e))
                    self.log_message(traceback.format_exc())
                    self._write_result(False, str(e), 0)
        except Exception as e:
            self.log_message("StrideWriter: Poll error: " + str(e))

        self.schedule_message(20, self._poll)

    def _write_result(self, success, message, params_written):
        try:
            with open(RESULT_FILE, "w") as f:
                json.dump({
                    "success": success,
                    "message": message,
                    "params_written": params_written
                }, f)
        except Exception as e:
            self.log_message("StrideWriter: Could not write result: " + str(e))

    def _get_or_create_envelope(self, clip, param):
        """Get an automation envelope for a parameter, creating if needed.
        CRITICAL: Never call clip.clear_envelope() — it invalidates the
        envelope object in Live 12. Use delete_events_in_range() instead."""
        env = None

        # First try to get an existing envelope
        try:
            env = clip.automation_envelope(param)
        except Exception:
            pass

        # If no existing envelope, create one and get fresh reference
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

    def _write_automation(self, data):
        song = self.song()
        track = song.view.selected_track
        track_name = track.name

        clip_slot_idx = data.get("clip_slot", 0)
        clip_bars = data.get("clip_bars", 4)
        target_length = _d(clip_bars * 4)
        create_clip = data.get("create_clip", True)

        self.log_message("StrideWriter: Track='%s' slot=%d bars=%d" % (
            track_name, clip_slot_idx, clip_bars))

        # Get clip slot
        if clip_slot_idx >= len(track.clip_slots):
            self._write_result(False, "Clip slot %d out of range" % clip_slot_idx, 0)
            return

        clip_slot = track.clip_slots[clip_slot_idx]

        # Create clip if needed
        if not clip_slot.has_clip:
            if create_clip:
                clip_slot.create_clip(target_length)
                self.log_message("StrideWriter: Created clip (%d beats)" % int(target_length))
            else:
                self._write_result(False, "No clip in slot %d" % clip_slot_idx, 0)
                return

        clip = clip_slot.clip

        # Resize if needed
        if abs(clip.length - target_length) > 0.1:
            clip.loop_end = target_length
        clip.looping = True

        # Process each parameter
        params_written = 0
        total_points = 0

        for param_data in data.get("params", []):
            points = param_data.get("points", [])
            if not points:
                continue

            param_path = param_data.get("_path")
            param_name = param_data.get("name", "unknown")

            if not param_path:
                self.log_message("StrideWriter: No _path for %s — skipping" % param_name)
                continue

            try:
                # Resolve the LOM path to a DeviceParameter object
                param = self._resolve_param(param_path)
                if param is None:
                    self.log_message("StrideWriter: Could not resolve %s" % param_path)
                    continue

                # Use min/max from canvas data (matches what scanner reported)
                # Fall back to live param range if not provided
                if "min" in param_data and "max" in param_data:
                    param_min = _d(param_data["min"])
                    param_max = _d(param_data["max"])
                else:
                    param_min = _d(param.min)
                    param_max = _d(param.max)

                self.log_message("StrideWriter: Writing %d pts to %s [%.3f-%.3f] (live: %.3f-%.3f)" % (
                    len(points), param_name, param_min, param_max, float(param.min), float(param.max)))

                # Get or create envelope — NEVER uses clear_envelope
                env = self._get_or_create_envelope(clip, param)
                if env is None:
                    self.log_message("StrideWriter: No envelope for %s — skipping" % param_name)
                    continue

                # Clear old events using delete_events_in_range (safe, doesn't invalidate env)
                try:
                    env.delete_events_in_range(_d(0.0), _d(target_length))
                except Exception:
                    pass

                # Sort points by time
                points.sort(key=lambda p: float(p.get("time", 0)))

                # Write interpolated steps between canvas points.
                # insert_step() creates flat steps, not linear ramps.
                # To reproduce the canvas's linear interpolation between points,
                # we subdivide each segment into small steps (~0.02 beats).
                STEP_SIZE = 0.02  # beats — gives smooth ramps in Ableton

                pts_written = 0
                for i in range(len(points)):
                    t0 = _d(points[i].get("time", 0))
                    v0 = _d(points[i].get("value", 0))

                    if i + 1 < len(points):
                        t1 = _d(points[i + 1].get("time", 0))
                        v1 = _d(points[i + 1].get("value", 0))
                    else:
                        # Last point: hold value to clip end
                        t1 = target_length
                        v1 = v0

                    seg_duration = t1 - t0
                    if seg_duration <= 0.0001:
                        continue

                    # Number of sub-steps for this segment
                    num_steps = max(1, int(seg_duration / STEP_SIZE))
                    step_dur = _d(seg_duration / num_steps)

                    for s in range(num_steps):
                        # Linear interpolation
                        frac = s / float(num_steps)
                        v = v0 + frac * (v1 - v0)
                        t = _d(t0 + s * step_dur)

                        clamped_v = max(0.0, min(1.0, v))
                        actual_value = _d(param_min + clamped_v * (param_max - param_min))

                        env.insert_step(_d(t), _d(step_dur), _d(actual_value))
                        pts_written += 1

                total_points += pts_written
                params_written += 1
                self.log_message("StrideWriter: Done %s — %d/%d points" % (
                    param_name, pts_written, len(points)))

            except Exception as e:
                self.log_message("StrideWriter: Error on %s: %s" % (param_name, str(e)))
                self.log_message(traceback.format_exc())

        # Write result
        if params_written > 0:
            self._write_result(True, "OK", params_written)
            self.log_message("StrideWriter: Complete — %d params, %d points" % (
                params_written, total_points))
        else:
            self._write_result(False, "No params written — check Ableton log", 0)
            self.log_message("StrideWriter: Failed — 0 params written")

    def _resolve_param(self, lom_path):
        """Resolve a LOM path to a DeviceParameter object."""
        parts = lom_path.split()
        obj = self.song()

        i = 0
        while i < len(parts):
            part = parts[i]

            if part == "live_set":
                i += 1
            elif part == "view" and i + 1 < len(parts) and parts[i + 1] == "selected_track":
                obj = self.song().view.selected_track
                i += 2
            elif part == "tracks" and i + 1 < len(parts):
                idx = int(parts[i + 1])
                obj = obj.tracks[idx]
                i += 2
            elif part == "return_tracks" and i + 1 < len(parts):
                idx = int(parts[i + 1])
                obj = obj.return_tracks[idx]
                i += 2
            elif part == "devices" and i + 1 < len(parts):
                idx = int(parts[i + 1])
                obj = obj.devices[idx]
                i += 2
            elif part == "chains" and i + 1 < len(parts):
                idx = int(parts[i + 1])
                obj = obj.chains[idx]
                i += 2
            elif part == "parameters" and i + 1 < len(parts):
                idx = int(parts[i + 1])
                obj = obj.parameters[idx]
                i += 2
            else:
                self.log_message("StrideWriter: Unknown path part '%s'" % part)
                i += 1

        if hasattr(obj, "min") and hasattr(obj, "max") and hasattr(obj, "value"):
            return obj

        self.log_message("StrideWriter: Resolved object is not a DeviceParameter")
        return None

    def disconnect(self):
        self.log_message("StrideWriter: Disconnected")
        super(StrideWriter, self).disconnect()
