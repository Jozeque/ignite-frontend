# Arrangement Inject — Spec & Implementation Plan

**Status:** Feasibility PROVEN (2026-06-24, Live 12.3.0). Spec complete. Production NOT yet implemented.
**Owner:** Stride / StrideLink (stride-vst)
**Related memory:** `project_arrangement_inject_blocked.md`
**Test rig:** `stride-vst/remote_script/StrideInject2/` (parallel, isolated; see §9)

---

## 0. TL;DR

Make Stride's **Inject** work on **Arrangement-view** clips, matching the Session experience: the producer selects a MIDI clip on the timeline, hits Inject, and the clip comes back carrying the drawn **curves** (and its **notes**), at the **bar length they set in Stride**, sitting at the **same start position**.

Ableton's API does **not** allow writing automation into an Arrangement clip directly. The feature is delivered by **rebuilding the clip in a Session slot (where envelope writing works) and copying it onto the timeline** via `duplicate_clip_to_arrangement`, which carries the clip envelopes across. This is invisible to the user.

---

## 1. The core constraint (why this is not a normal inject)

Verified empirically on **Live 12.3.0** (via the StrideInject2 rig):

- **You cannot WRITE an automation envelope into an Arrangement clip.** `clip.automation_envelope(param)` returns `None`, and `clip.create_automation_envelope(param)` does nothing — for arrangement clips only. (Session clips work fine; that is what today's inject uses.)
- **You cannot READ one either.** `automation_envelope` → None, and even `clip.has_envelopes` returns **False on an arrangement clip even when the clip visibly has automation**. The LOM is fully *blind* to arrangement-clip envelopes.
- **BUT** `track.duplicate_clip_to_arrangement(session_clip, time)` **copies the whole clip, envelopes included.** Because it operates at the clip level (not per-parameter), it bypasses the per-envelope API block. Confirmed by **visual inspection**: a stepped S&H Transpose curve written into a Session clip appeared intact on the duplicated Arrangement clip.

Implication: Stride can never write "into" the existing timeline clip. It must **build a Session clip with the curves and swap it onto the timeline**.

---

## 2. What was proven (evidence, 2026-06-24)

All via `stride-vst/remote_script/StrideInject2/` actions `caps_probe`, `arr_place`, `arr_inject`:

| Capability | Result |
|---|---|
| Detect the selected arrangement clip | ✅ `live_set view detail_clip` + `is_arrangement_clip` (already in production scanner) |
| `track.duplicate_clip_to_arrangement(clip, time)` exists & works | ✅ returns a `Clip` |
| Curves survive the duplicate | ✅ visually confirmed (LOM can't read it back, but it's there & audible) |
| `track.delete_clip(clip)` (remove original) | ✅ verified (arrangement_clips_count returned to baseline) |
| `clip_slot.create_clip` / `clip_slot.delete_clip` (build/clean temp) | ✅ |
| Read notes off an arrangement clip | ✅ `get_notes_extended(0,128,0,len)` → 6 notes |
| Write notes into the temp clip | ✅ 6 notes written (but triggered a popup — see §6.1) |
| Length = requested bars, not original | ✅ 1-bar original → 4-bar (16-beat) result |
| Overwrite + expand the timeline | ✅ placed at original start, extended past original length |
| `song.last_event_time` is sticky | ⚠️ does not shrink after delete (harmless; don't rely on it) |

---

## 3. User-facing behavior (UX)

- **Trigger:** identical to today — select a clip (now also works when it's an Arrangement clip), set bars in Stride, hit **Inject**. No new button required.
- **Result:** the selected clip is replaced by a clip at the **same start time**, of length **= the bars set in Stride**, carrying:
  - the **curves** the producer drew, and
  - the clip's **notes** (preserved), OR the **armed Pattern**'s notes if a pattern is armed (mirrors Session behavior).
- **Length rule (locked with user):** clip length follows **Stride's requested bars**, NOT the original clip length.
  - Requested **longer** than original → the clip **expands** down the timeline, **overwriting** whatever sits in that span.
  - Requested **shorter** → the clip is **trimmed**; notes past the new end are dropped.
- **Notes (locked):** preserved **as-is at their positions**. Not looped to fill when expanding; trailing space is empty. Notes that start past the new length are dropped.
- It should feel **identical to Session inject** — the rebuild/swap is invisible.

---

## 4. Mechanism (production flow)

When Inject targets an **Arrangement** clip (`is_arrangement_clip == True`), run this instead of the normal envelope write:

1. **Capture the original clip** (before any change):
   - `T = clip.start_time`, `L_orig = clip.length`, `name`, `color`, `looping`, `signature_numerator/denominator`.
   - `notes = clip.get_notes_extended(0, 128, 0, L_orig)` (fallback `get_notes`). Convert to dicts `{pitch,time,duration,velocity}`.
2. **Resolve the clip's track** (walk `canonical_parent` until it has `.devices` and `.clip_slots`; fallback `song.view.selected_track`). Arrangement clip → track directly.
3. **`L_new = clip_bars * 4`** (from the inject payload).
4. **Pick the notes to write:** armed-Pattern notes from the payload if present, else the captured `notes`. Filter to `start < L_new`.
5. **Find an empty Session slot** `S` on the track (see §6.2 if none).
6. **Build the temp Session clip:** `S.create_clip(L_new)` → `temp = S.clip`; set `looping`, `name`, `color`, signature to match the original.
7. **Write notes** into `temp` via the **modern `add_new_notes` API** (§6.1).
8. **Write the curves** into `temp`'s envelopes using the **existing** inject curve path (`_resolve_param` + `_write_bezier` / `_adaptive_step_tuples` + `insert_step`). Same params, same track → resolves identically. This is the part that already works in Session.
9. **Delete the original** arrangement clip: `track.delete_clip(original)`. (Safe: everything needed was captured in step 1; Ctrl+Z recovers.)
10. **Place the temp on the timeline:** `track.duplicate_clip_to_arrangement(temp, T)`.
11. **Delete the temp Session clip:** `S.delete_clip()`. (Keep the new arrangement clip — it's the deliverable.)
12. **Report** success to the bridge. NOTE: Stride **cannot read-verify** the envelope landed (LOM read-blind on arrangement). That is acceptable — the operation is reliable; do not attempt read-back verification.

Reference implementation of steps 1-11 already exists and is proven: `StrideInject2._arr_inject` (uses a test ramp in step 8; production swaps in the real payload curves).

---

## 5. Production code changes

### 5.1 `stride-vst/remote_script/StrideInject/__init__.py` (the real remote script)
- In `_get_target_clip`: when `is_arrangement_clip`, **do not block** and **do not resize via loop_end**. Instead signal the caller to take the arrangement path.
- Add `_write_inject_arrangement(data, clip)` implementing §4 (port from `StrideInject2._arr_inject`, but step 8 uses the real payload params via the existing `_write_bezier`/`_adaptive_step_tuples` instead of a test ramp).
- In `_write_inject`: branch to `_write_inject_arrangement` when the resolved clip is arrangement; otherwise the existing Session path, unchanged.
- **Fix `_write_notes`** to use `add_new_notes` (MidiNoteSpecification) first to avoid the popup (§6.1). Keep the old paths as fallback only.
- Wrap the create/delete/duplicate in an **atomic undo step** if available (§6.4).

### 5.2 Bridge `stride-vst/m4l/node/server.js`
- Inject trigger already carries `clip_bars` + `params` + optional `notes`. Likely **no change needed** (clip resolution + arrangement handling live in the remote script). Confirm the payload includes everything; add a flag only if useful.

### 5.3 Canvas `stride-vst/app/renderer/canvas.js`
- **Per-clip state keying:** `_sdClipKey(rackId, slot)` keys by slot; arrangement clips have no slot and collapse to slot 0 → they would **share** drawn-curve state. Fix: key arrangement clips by **`clip_id`** (already delivered in the `clip_focus` payload, `scanner_max.js`). Needed for per-arrangement-clip curve memory parity.
- Optional UX: small "Arrangement clip" indicator so the producer knows the target + that it will be rebuilt at the requested length.

### 5.4 Scanner `stride-vst/m4l/node/scanner_max.js`
- `_resolveTargetClip` / `clip_focus` already report arrangement clips correctly (detail_clip + clip_id). Likely no change. Verify `clip_bars` reported for arrangement clips reflects the original length (it does today via `clip.length`); the producer overrides bars in Stride anyway.

---

## 6. Open items / decisions

### 6.1 The confirmation popup (MUST fix before ship) — OPEN
A Live dialog ("proceed?") appeared **only on the run that wrote notes** (the 0-note run was silent). Leading cause: `_write_notes` calls the **deprecated** `replace_selected_notes` / `set_notes` first. **Fix:** rewrite to use `add_new_notes` (MidiNoteSpecification) exclusively.
**NEEDS:** the exact popup wording + whether it had a "Don't ask again" box (user to provide) to confirm it's the note API and not an overwrite-existing-clips confirmation. If it's the overwrite confirm, that is a different (and possibly desirable) prompt — decide whether to keep, suppress, or avoid by not overlapping neighbors.

### 6.2 No empty Session slot — DECISION NEEDED
The temp needs a free Session slot on the track. If all slots are full:
- Option A: `song.create_scene(-1)` to append a scene (adds a slot to all tracks), use it, then `song.delete_scene` after. Visible churn but reliable.
- Option B: fail with a clear message asking the user to free a slot.
- **Recommend A** with clean delete, fall back to B if create/delete unavailable.

### 6.3 Property preservation — scope
Preserve: notes, length (= requested), name, color, looping, signature. Out of scope v1: groove, exact loop markers beyond length, take lanes. Audio arrangement clips: **out of scope v1** (MIDI only).

### 6.4 Atomic undo — nice-to-have
Group steps 6-11 so Ctrl+Z restores in one action. Check `song.begin_undo_step()` / `song.end_undo_step()` availability via the rig's `caps_probe`. If unavailable, document that undo may take multiple presses.

### 6.5 Order of operations — locked
Delete-original-then-duplicate (current). Safe because the original is fully captured (notes/T/length) before deletion, and Ctrl+Z recovers. Alternative (duplicate-first then clean leftover) is more complex for the shorter-than-original case; not needed.

### 6.6 Read-blind verification — accepted
Stride cannot confirm via LOM that the arrangement clip received the envelope. Do not block on verification. The duplicate is reliable.

---

## 7. Test matrix (for production validation)

Run each on a disposable arrangement clip, confirm visually (LOM can't verify envelopes):

1. 1-bar clip, request 4 bars → expands to 4 bars, curve over all 4, notes preserved.
2. 4-bar clip, request 2 bars → trims to 2 bars, notes past bar 2 dropped.
3. Clip with notes → notes preserved at positions, **no popup** (after §6.1 fix).
4. Clip with no notes → curve only, no errors.
5. Expansion overlapping a neighbor clip → neighbor overwritten in the span (expected).
6. Track with no empty Session slot → §6.2 behavior.
7. Ctrl+Z after inject → restores the original clip (one step if §6.4 done).
8. Multiple arrangement clips on one track → per-clip curve memory keyed by clip_id (§5.3).
9. Param identity: curve lands on the correct device parameter (reuse `_path` resolution).

---

## 8. Rollout

1. Implement §5.1 first in **StrideInject2** (rig) as a real-payload variant (or extend `arr_inject` to accept payload params), validate via the test matrix.
2. Port to production `StrideInject/__init__.py` (§5.1) — additive arrangement branch, Session path untouched.
3. Canvas per-clip keying (§5.3).
4. Deploy: copy `StrideInject/` to `C:\ProgramData\Ableton\Live 12 Suite\Resources\MIDI Remote Scripts\` and **restart Ableton** (remote scripts load at startup; toggling the control-surface slot does NOT reload — Live caches the module).
5. Smoke-test on Win; then Mac parity (the remote script is cross-platform Python).

---

## 9. Test rig reference (StrideInject2) — how to resume

- **Repo:** `stride-vst/remote_script/StrideInject2/` (`__init__.py`, `_curve.py`).
- **Deployed:** `C:\ProgramData\Ableton\Live 12 Suite\Resources\MIDI Remote Scripts\StrideInject2\`. Assigned to a free Control Surface slot ("MidiRemoteScript 4", In/Out = None). Fully isolated from production (own files `_stride_inject2_*`, own slot). Production `StrideInject` untouched.
- **Drive it** (write a trigger JSON to `C:\Users\Yossi\_stride_inject2_trigger.json`, read `C:\Users\Yossi\_stride_inject2_result.json`):
  - `{}` or `{"action":"arr_smoketest"}` → smoke test (write+read one envelope on the selected clip).
  - `{"action":"caps_probe"}` → non-destructive LOM capability scan.
  - `{"action":"arr_place","confirm":true,"keep":true}` → build a temp Session clip + duplicate to a far-out time; `keep` leaves it for visual inspection.
  - `{"action":"arr_inject","confirm":true,"bars":N}` → **the full replace-in-place** on the selected arrangement clip (notes + test curve, N bars). REPLACES the selected clip — use a disposable one.
- **RIG_VERSION** appears in every result + the ready log — confirm it before trusting a run.
- **GOTCHA:** any code change to the rig needs a **full Ableton restart** to load.

---

## 10. Driver snippet (fire a trigger + read result, from Git Bash / any shell with python)

```python
import os, time, json
trig = r"C:\Users\Yossi\_stride_inject2_trigger.json"
res  = r"C:\Users\Yossi\_stride_inject2_result.json"
if os.path.exists(res): os.remove(res)
open(trig,"w",encoding="utf-8").write('{"action":"arr_inject","confirm":true,"bars":4}')
t=time.time()
while time.time()-t < 30:          # allow time for the confirm popup
    if os.path.exists(res):
        time.sleep(0.2); print(open(res,encoding="utf-8").read()); break
    time.sleep(0.1)
```
(The 12s waits used earlier were too short when a confirmation dialog was open — use ~30s, or click the dialog promptly.)
