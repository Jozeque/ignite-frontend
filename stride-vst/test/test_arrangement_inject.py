#!/usr/bin/env python3
"""
Tests for the Arrangement-inject (replace-in-place) path in
StrideInject/__init__.py.

The production remote script normally only runs inside Ableton. Here we stub the
`_Framework.ControlSurface` base + a fake Live Object Model so the REAL module
is imported and exercised outside Live. Mirrors the mock-LOM approach in
test/test-scanner-freeze-guard.js.

Covers:
  - arrangement inject end-to-end (rebuild in Session -> place on timeline)
  - length rule: result length = REQUESTED bars, not the original clip length
  - notes preserved + filtered to the new length
  - armed-pattern notes override the clip's own notes
  - notes written via the MODERN add_new_notes API (popup-avoidance)
  - operation ORDER: delete original BEFORE duplicate-to-arrangement
  - the original arrangement clip's envelope is never written (LOM blind)
  - atomic undo is balanced (begin == end) on success / no-op / failure
  - no-empty-slot fails cleanly and touches nothing
  - SESSION path is unchanged (regression): writes the clip envelope, NO
    duplicate-to-arrangement, clip is resized

Run: python test/test_arrangement_inject.py
"""

import os
import sys
import types

HERE = os.path.dirname(os.path.abspath(__file__))
SI_DIR = os.path.join(HERE, "..", "remote_script", "StrideInject")

# ── Stub the Ableton imports the module needs at import time ──────────────────
_fw = types.ModuleType("_Framework")
_cs_mod = types.ModuleType("_Framework.ControlSurface")


class _ControlSurface(object):
    def __init__(self, *a, **k):
        pass

    def log_message(self, *a, **k):
        pass

    def schedule_message(self, *a, **k):
        pass

    def song(self):
        return getattr(self, "_song", None)

    def application(self):
        return getattr(self, "_app", None)

    def disconnect(self):
        pass


_cs_mod.ControlSurface = _ControlSurface
_fw.ControlSurface = _cs_mod
sys.modules["_Framework"] = _fw
sys.modules["_Framework.ControlSurface"] = _cs_mod

# Stub Live.Clip.MidiNoteSpecification (used by the modern note writer).
_live = types.ModuleType("Live")
_live_clip = types.ModuleType("Live.Clip")


class _MNS(object):
    def __init__(self, pitch=0, start_time=0.0, duration=0.0, velocity=100, mute=False):
        self.pitch = pitch
        self.start_time = start_time
        self.duration = duration
        self.velocity = velocity
        self.mute = mute


_live_clip.MidiNoteSpecification = _MNS
_live.Clip = _live_clip
sys.modules["Live"] = _live
sys.modules["Live.Clip"] = _live_clip

# ── Import the REAL production module ─────────────────────────────────────────
import importlib.util  # noqa: E402

# Make the module's `from _curve import ...` fallback resolve (flat import).
sys.path.insert(0, SI_DIR)

_spec = importlib.util.spec_from_file_location(
    "strideinject_prod", os.path.join(SI_DIR, "__init__.py"))
SI = importlib.util.module_from_spec(_spec)
_spec.loader.exec_module(SI)

# Neutralize the file-polling loop so constructing the surface does no I/O.
SI.StrideInject._poll = lambda self: None

passed = 0
failed = 0


def ok(name, cond):
    global passed, failed
    if cond:
        print("  ok   " + name)
        passed += 1
    else:
        print("  FAIL " + name)
        failed += 1


def approx(a, b, eps=1e-6):
    try:
        return abs(float(a) - float(b)) <= eps
    except Exception:
        return False


# ── Fake LOM ─────────────────────────────────────────────────────────────────
class FakeEnv(object):
    def __init__(self):
        self.steps = []
        self.cleared = []

    def insert_step(self, t, dur, val):
        self.steps.append((float(t), float(dur), float(val)))

    def delete_events_in_range(self, a, b):
        self.cleared.append((float(a), float(b)))

    def value_at_time(self, t):
        return 0.0
    # deliberately NO create_event -> forces step mode (matches Live 12.3.0)


class FakeParam(object):
    def __init__(self, name="Filter Freq", mn=0.0, mx=1.0, quant=False):
        self.name = name
        self.min = mn
        self.max = mx
        self.is_quantized = quant
        self.value = 0.0


class FakeDevice(object):
    def __init__(self, name="Dev", params=None):
        self.name = name
        self.parameters = params if params is not None else [FakeParam()]


class FakeNote(object):
    def __init__(self, pitch, start, dur, vel):
        self.pitch = pitch
        self.start_time = start
        self.duration = dur
        self.velocity = vel
        self.mute = False


class FakeSessionClip(object):
    """A Session clip: envelope writes WORK; note APIs available."""
    def __init__(self, length):
        self.is_arrangement_clip = False
        self.length = float(length)
        self.loop_end = float(length)
        self.looping = False
        self.name = ""
        self.color = 0
        self.envs = {}
        self.added_notes = None
        self.note_method = None

    def automation_envelope(self, param):
        if id(param) not in self.envs:
            self.envs[id(param)] = FakeEnv()
        return self.envs[id(param)]

    def create_automation_envelope(self, param):
        self.automation_envelope(param)

    def add_new_notes(self, specs):
        self.added_notes = list(specs)
        self.note_method = "add_new_notes"

    # legacy paths (the fresh-clip writer must NOT reach these)
    def select_all_notes(self):
        pass

    def deselect_all_notes(self):
        pass

    def replace_selected_notes(self, t):
        self.note_method = "replace_selected_notes"

    def set_notes(self, t):
        self.note_method = "set_notes"


class FakeArrClip(object):
    """An Arrangement clip: envelope API is BLIND (returns None); notes readable."""
    def __init__(self, start, length, notes=None, name="ArrClip"):
        self.is_arrangement_clip = True
        self.start_time = float(start)
        self.length = float(length)
        self.name = name
        self.color = 7
        self.looping = True
        self._notes = notes or []
        self.canonical_parent = None  # set to the track by the scenario
        self.env_write_attempts = 0

    def automation_envelope(self, param):
        self.env_write_attempts += 1
        return None  # arrangement read/write-blind

    def create_automation_envelope(self, param):
        self.env_write_attempts += 1

    def get_notes_extended(self, from_pitch, pitch_span, from_time, time_span):
        return [FakeNote(p, s, d, v) for (p, s, d, v) in self._notes]


class FakeSlot(object):
    def __init__(self, has_clip=False):
        self.has_clip = has_clip
        self.clip = FakeSessionClip(4.0) if has_clip else None
        self.last_clip = None
        self.delete_count = 0

    def create_clip(self, length):
        self.clip = FakeSessionClip(float(length))
        self.last_clip = self.clip
        self.has_clip = True

    def delete_clip(self):
        self.has_clip = False
        self.clip = None
        self.delete_count += 1


class FakeTrack(object):
    def __init__(self, slots, devices):
        self.clip_slots = slots
        self.devices = devices
        self.name = "Trk"
        self.ops = []        # ordered log of ("delete"/"place", ...)
        self.deleted = []
        self.placed = []

    def delete_clip(self, clip):
        self.ops.append(("delete", clip))
        self.deleted.append(clip)

    def duplicate_clip_to_arrangement(self, clip, time):
        self.ops.append(("place", clip, float(time)))
        self.placed.append((clip, float(time)))
        return FakeArrClip(float(time), clip.length)


class FakeView(object):
    def __init__(self, detail=None, track=None):
        self.detail_clip = detail
        self.selected_track = track
        self.highlighted_clip_slot = None


class FakeSong(object):
    def __init__(self, view, with_undo=True):
        self.view = view
        self.undo_depth = 0
        self.undo_begins = 0
        self._with_undo = with_undo
        if with_undo:
            self.begin_undo_step = self._begin
            self.end_undo_step = self._end

    def _begin(self):
        self.undo_depth += 1
        self.undo_begins += 1

    def _end(self):
        self.undo_depth -= 1


class FakeApp(object):
    def get_major_version(self):
        return 12

    def get_minor_version(self):
        return 3

    def get_bugfix_version(self):
        return 0


def make_surface(detail_clip, track, with_undo=True):
    si = SI.StrideInject(c_instance=None)
    si._app = FakeApp()
    si._song = FakeSong(FakeView(detail_clip, track), with_undo=with_undo)
    si._results = []
    si._result = lambda payload: si._results.append(payload)
    return si


PARAM_PATH = "live_set view selected_track devices 0 parameters 0"


def ramp_params(name="Filter Freq"):
    # A simple curve. Step mode (no create_event) -> insert_step on the env.
    return [{
        "_path": PARAM_PATH, "name": name, "min": 0.0, "max": 1.0,
        "points": [{"time": 0, "value": 0.1}, {"time": 8, "value": 0.9}],
    }]


def arr_scenario(arr_clip, n_empty=2, n_full=0):
    param = FakeParam()
    dev = FakeDevice("Operator", [param])
    slots = [FakeSlot(has_clip=True) for _ in range(n_full)] + \
            [FakeSlot(has_clip=False) for _ in range(n_empty)]
    track = FakeTrack(slots, [dev])
    arr_clip.canonical_parent = track
    si = make_surface(arr_clip, track)
    return si, track, param


# ═══ TEST 1: arrangement inject end-to-end ════════════════════════════════════
arr = FakeArrClip(start=160.0, length=4.0, notes=[(60, 0.0, 1.0, 100), (62, 2.0, 1.0, 90)])
si, track, param = arr_scenario(arr, n_empty=2)
empty_slot = track.clip_slots[0]
si._write_inject({"clip_bars": 4, "params": ramp_params(), "notes": []})

res = si._results[-1] if si._results else {}
ok("T1 reports success", res.get("success") is True)
ok("T1 mode == arrangement", res.get("mode") == "arrangement")
ok("T1 temp clip was created", empty_slot.last_clip is not None)
ok("T1 temp length == requested 16 beats (4 bars)",
   empty_slot.last_clip is not None and approx(empty_slot.last_clip.length, 16.0))
ok("T1 curve written to temp envelope (steps emitted)",
   empty_slot.last_clip is not None and len(empty_slot.last_clip.envs) == 1 and
   any(len(e.steps) > 0 for e in empty_slot.last_clip.envs.values()))
ok("T1 original arrangement clip deleted", arr in track.deleted)
ok("T1 temp duplicated onto timeline at original start (beat 160)",
   any(t == 160.0 for (_c, t) in track.placed))
ok("T1 temp session clip cleaned up", empty_slot.delete_count >= 1)
ok("T1 original clip envelope never written (LOM blind)", arr.env_write_attempts == 0)
ok("T1 undo step balanced (begin==end)", si._song.undo_depth == 0 and si._song.undo_begins == 1)

# ═══ TEST 2: ORDER — delete original BEFORE duplicate ═════════════════════════
arr2 = FakeArrClip(start=64.0, length=2.0)
si2, track2, _ = arr_scenario(arr2, n_empty=1)
si2._write_inject({"clip_bars": 4, "params": ramp_params(), "notes": []})
del_idx = next((i for i, o in enumerate(track2.ops) if o[0] == "delete"), -1)
place_idx = next((i for i, o in enumerate(track2.ops) if o[0] == "place"), -1)
ok("T2 delete happened", del_idx >= 0)
ok("T2 place happened", place_idx >= 0)
ok("T2 delete BEFORE place", del_idx >= 0 and place_idx >= 0 and del_idx < place_idx)
ok("T2 placed at original start (beat 64)", track2.placed and track2.placed[0][1] == 64.0)

# ═══ TEST 3: length rule + notes filtered to new length ══════════════════════
# 1-bar original, request 4 bars; one note sits past 16 beats and must be dropped.
arr3 = FakeArrClip(start=0.0, length=4.0,
                   notes=[(60, 0.0, 1.0, 100), (62, 4.0, 1.0, 100), (64, 20.0, 1.0, 100)])
si3, track3, _ = arr_scenario(arr3, n_empty=1)
slot3 = track3.clip_slots[0]
si3._write_inject({"clip_bars": 4, "params": ramp_params(), "notes": []})
temp3 = slot3.last_clip
ok("T3 result length = requested 16 beats (not original 4)",
   temp3 is not None and approx(temp3.length, 16.0))
ok("T3 notes carried into temp", temp3 is not None and temp3.added_notes is not None)
ok("T3 note past new length dropped (2 of 3 kept)",
   temp3 is not None and temp3.added_notes is not None and len(temp3.added_notes) == 2)
ok("T3 notes written via modern add_new_notes API",
   temp3 is not None and temp3.note_method == "add_new_notes")

# ═══ TEST 4: armed-pattern notes override the clip's own notes ════════════════
arr4 = FakeArrClip(start=0.0, length=4.0, notes=[(60, 0.0, 1.0, 100)])  # 1 own note
si4, track4, _ = arr_scenario(arr4, n_empty=1)
slot4 = track4.clip_slots[0]
pattern = [{"pitch": 36, "time": 0.0, "duration": 0.5, "velocity": 120},
           {"pitch": 38, "time": 1.0, "duration": 0.5, "velocity": 120},
           {"pitch": 42, "time": 2.0, "duration": 0.5, "velocity": 120}]
si4._write_inject({"clip_bars": 4, "params": ramp_params(), "notes": pattern})
temp4 = slot4.last_clip
ok("T4 armed-pattern notes used (3 not 1)",
   temp4 is not None and temp4.added_notes is not None and len(temp4.added_notes) == 3)
ok("T4 pattern pitch present (36)",
   temp4 is not None and temp4.added_notes is not None and
   any(getattr(n, "pitch", None) == 36 for n in temp4.added_notes))

# ═══ TEST 5: SESSION path unchanged (regression) ═════════════════════════════
sess = FakeSessionClip(4.0)  # 1 bar
sess_param = FakeParam()
sess_dev = FakeDevice("Operator", [sess_param])
sess_track = FakeTrack([FakeSlot(has_clip=False)], [sess_dev])
si5 = make_surface(sess, sess_track)
# flat curve -> exactly one collapsed step, completes in one synchronous flush
si5._write_inject({"clip_bars": 2, "params": [{
    "_path": PARAM_PATH, "name": "Filter Freq", "min": 0.0, "max": 1.0,
    "points": [{"time": 0, "value": 0.5}, {"time": 8, "value": 0.5}],
}], "notes": []})
res5 = si5._results[-1] if si5._results else {}
ok("T5 session inject reports success", res5.get("success") is True)
ok("T5 session mode is NOT arrangement", res5.get("mode") != "arrangement")
ok("T5 session wrote directly to the clip envelope",
   len(sess.envs) == 1 and any(len(e.steps) > 0 for e in sess.envs.values()))
ok("T5 session did NOT duplicate to arrangement", len(sess_track.placed) == 0)
ok("T5 session resized clip to requested 8 beats", approx(sess.loop_end, 8.0))
ok("T5 session did not delete anything", len(sess_track.deleted) == 0)

# ═══ TEST 6: no empty Session slot -> clean failure, nothing touched ══════════
arr6 = FakeArrClip(start=0.0, length=4.0, notes=[(60, 0.0, 1.0, 100)])
si6, track6, _ = arr_scenario(arr6, n_empty=0, n_full=2)
si6._write_inject({"clip_bars": 4, "params": ramp_params(), "notes": []})
res6 = si6._results[-1] if si6._results else {}
ok("T6 fails when no empty slot", res6.get("success") is False)
ok("T6 failure message mentions a free Session slot",
   "slot" in (res6.get("message") or "").lower())
ok("T6 nothing deleted / placed on no-slot failure",
   len(track6.deleted) == 0 and len(track6.placed) == 0)
ok("T6 undo balanced on no-slot failure (never began)", si6._song.undo_depth == 0)

# ═══ TEST 7: nothing to inject (no params, no notes) -> clean, temp cleaned ═══
arr7 = FakeArrClip(start=0.0, length=4.0, notes=[])
si7, track7, _ = arr_scenario(arr7, n_empty=1)
slot7 = track7.clip_slots[0]
si7._write_inject({"clip_bars": 4, "params": [], "notes": []})
res7 = si7._results[-1] if si7._results else {}
ok("T7 empty inject fails cleanly", res7.get("success") is False)
ok("T7 empty inject did not place a clip", len(track7.placed) == 0)
ok("T7 empty inject cleaned up the temp", slot7.delete_count >= 1)
ok("T7 undo balanced after empty inject", si7._song.undo_depth == 0)

# ═══ TEST 8: works without undo support (older Live) ══════════════════════════
arr8 = FakeArrClip(start=32.0, length=4.0, notes=[(60, 0.0, 1.0, 100)])
param8 = FakeParam()
dev8 = FakeDevice("Operator", [param8])
track8 = FakeTrack([FakeSlot(has_clip=False)], [dev8])
arr8.canonical_parent = track8
si8 = make_surface(arr8, track8, with_undo=False)  # song has no begin/end_undo_step
si8._write_inject({"clip_bars": 4, "params": ramp_params(), "notes": []})
res8 = si8._results[-1] if si8._results else {}
ok("T8 arrangement inject works without undo API", res8.get("success") is True)
ok("T8 placed on timeline without undo API", len(track8.placed) == 1)

# ═══ TEST 9: deprecated note API gets sane args (popup-avoidance contract) ════
# The fresh-clip writer must build valid MidiNoteSpecification args (clamped).
arr9 = FakeArrClip(start=0.0, length=4.0,
                   notes=[(60, 0.0, 1.0, 200), (62, 1.0, 0.0, 100), (-5, 2.0, 1.0, 100)])
si9, track9, _ = arr_scenario(arr9, n_empty=1)
slot9 = track9.clip_slots[0]
si9._write_inject({"clip_bars": 4, "params": ramp_params(), "notes": []})
temp9 = slot9.last_clip
# note with dur<=0 dropped and pitch<0 dropped -> only the first (velocity clamped to 127)
ok("T9 invalid notes filtered (1 of 3 valid)",
   temp9 is not None and temp9.added_notes is not None and len(temp9.added_notes) == 1)
ok("T9 velocity clamped to <=127",
   temp9 is not None and temp9.added_notes and
   all(getattr(n, "velocity", 0) <= 127 for n in temp9.added_notes))

print("\n%d passed, %d failed" % (passed, failed))
sys.exit(0 if failed == 0 else 1)
