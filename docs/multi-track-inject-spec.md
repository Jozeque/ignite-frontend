# Multi-Track / Scene Inject — Engineering Spec

**Status:** Proposed (future). Author: CTO review pass, 2026-06-14.
**One-liner:** Let Stride inject automation into multiple clips across multiple tracks in a single action, with a per-track pattern assignment — *without ever writing a curve to the wrong parameter.*

> **Prime directive (non-negotiable):** Stride must never write to a parameter it cannot **positively identify**. A mismatch is a hard stop, surfaced to the user — *never* a silent write. Everything below is in service of that.

---

## 1. Verdict

**Feasible, and it's the natural evolution of Stride 2.0 direct-inject.** It is mostly *re-plumbing existing, proven primitives* + a new **safety layer**. There is **no new Live API capability required**:

- The write primitives (`automation_envelope`, `create_event`, `insert_step`, `create_clip`) already work and are battle-tested (`remote_script/StrideInject/__init__.py`).
- The param resolver **already accepts absolute paths** — `tracks N devices D parameters P`, `return_tracks`, `chains` (`StrideInject/__init__.py:264`). It is only ever *fed* `view selected_track …` paths today; nothing structural blocks absolute addressing.
- The chunked, throttled writer (`CHUNK_SIZE=400`/tick, adaptive steps) already scales to large write volumes without freezing Ableton.

The real work is in three places, **none of them the LOM**:
1. **Identity & verification** (the safety layer — the heart of this spec).
2. **Addressing** — emit absolute paths + carry a verifiable fingerprint; target clips by `tracks N clip_slots S` instead of `detail_clip`.
3. **Data model + UI** — a Session/Scene map and a per-track assignment surface.

---

## 2. How inject works **today** (verified, with file refs)

```
canvas.js (renderer)                 server.js          inject-writer.js            StrideInject (Python Remote Script)
  build params payload  ──ws─▶  route apply_inject ─▶  write _stride_inject_       ─▶  poll trigger, resolve param by _path,
  {id,_path,name,min,max,points}                       trigger.json, poll result      get/create envelope, write, report
```

- **Payload identity** (`canvas.js` ~L474–540): each param carries `id`, `_path`, `name`, `min`, `max`, `is_log`, `points`. Canvas persists curves keyed by `envelopeId` (= `String(p.id)`), stable per rack.
- **Clip target** (`StrideInject/__init__.py:194` `_get_target_clip`): always `song.view.detail_clip` (or `highlighted_clip_slot`). **The focused clip only.** Arrangement clips are rejected (`:228`) — **direct inject is Session-only** (no Live API to write Arrangement automation).
- **Param resolution** (`:248` `_resolve_param`): splits the `_path` string and walks the object tree **by positional index**. Returns a `DeviceParameter` if the final object has `min`/`max`/`value`.
- **Write** (`:583` `_write_inject`): for each param → resolve `_path` → `automation_envelope(param)` (create if missing) → `delete_events_in_range(0, len)` → bezier `create_event` (Live ≥12.4 where exposed) **or** adaptive `insert_step` (chunked).
- **The bug surface** (`:606–608`): `id` and `name` come in on the payload but are used **only for log messages**. Resolution + write trust the **positional path alone**.

### 2.1 Root-cause analysis of the misroute class (why this is the real risk)
Identity today is **positional + late-bound + unverified**:
- **Positional:** `devices 0 parameters 7` is an *array offset*, not an identity. Offsets shift when devices/tracks are added, removed, reordered, or when a rack's macro mapping changes.
- **Late-bound:** the offset is resolved at **write time** against the **current** session, which may differ from the session at **scan/draw time**.
- **Unverified:** the resolved object is **never checked** against the intended `id`/`name`. A wrong resolution is indistinguishable from a right one.

Historical incidents this explains:
- **v1.2.0 sort misroute** (`project_v1_2_0_sort_misroute_regression`): name-sorted lanes vs positional write → curves hit the wrong param on 95% of multi-param racks. Fixed by binding to `_path`/`envelopeId` instead of array position — but the *late/unverified* properties remain.
- **Nigel non-default-library** (`project_nigel_nondefault_library_bug`): a path-resolution dependency in the **.alc** path sent a curve to the wrong parameter. Same family: path-as-identity.

**Multi-track makes all three properties worse:** more objects → more offset drift; the user targets clips/params they're *not looking at*, so a silent misroute is invisible until playback sounds wrong (or a mix is quietly ruined).

---

## 3. Safety design (the part that matters)

Five layers, in order of importance. Layers 1–3 are **required for MVP**; 4–5 strongly recommended.

### 3.1 Verifiable identity ("fingerprint") — *required*
At **scan** time, capture a fingerprint per param, not just a path:
```jsonc
{
  "track_idx": 5, "track_name": "SERUM", "track_kind": "midi",
  "device_chain": ["Instrument Rack", "Serum"],   // device names from track root → param's device
  "device_name": "Serum",
  "param_name": "Filter Freq",
  "param_idx": 7,                                   // positional HINT (not identity)
  "min": 0.0, "max": 1.0, "is_log": false,
  "path": "live_set tracks 5 devices 0 chains 0 devices 1 parameters 7"
}
```
At **write** time, after positional resolution, **verify**:
- resolved `param.name == fingerprint.param_name`, **and**
- resolved param's owning device `name == fingerprint.device_name`, **and**
- resolved `param.min/max ≈ fingerprint.min/max` (tolerance).

If the path resolves but the fingerprint **does not match** → **do not write**. Attempt **self-heal** (3.2); if that fails, **abort that param** and report it.

### 3.2 Self-heal by search — *required*
The index is a *hint*; the **name within the device is the identity**. If positional resolution fails verification:
1. Re-walk the device named `device_name` on `track_idx` (and its chains).
2. Find the parameter whose `name == param_name` (tiebreak by nearest `param_idx`, then by min/max).
3. If exactly one match → use it (log "self-healed: index drifted N→M"). If zero or ambiguous → **abort + report**, never guess.

### 3.3 Pre-write validation gate + dry-run preview — *required*
**No envelope is touched until every target is resolved and verified.** The flow is two-phase:
- **Phase A — Resolve & Verify (read-only):** resolve every clip + every param, run fingerprint checks, classify each target as `OK | HEALED | UNRESOLVED | MISMATCH | NOT_INJECTABLE`. Write a **preview** result file. **Nothing is written.**
- **Phase B — Commit:** only on explicit confirm, and only the `OK`/`HEALED` targets are written. `UNRESOLVED`/`MISMATCH` are skipped and surfaced.

The canvas shows the preview as a checklist the user confirms:
```
Scene 3 inject — review:
  ✓ KICK   · Drive          ← S&H
  ✓ BASS   · Filter Freq    ← Reflector
  ⚠ SERUM  · Macro 3        ← Chaos   (index drifted, re-matched by name — OK)
  ✗ PAD    · Cutoff         ← Pump    (device changed — SKIPPED, re-scan PAD)
[ Inject 3 of 4 ]   [ Cancel ]
```
This converts the entire silent-misroute class into a **visible, user-gated decision**.

### 3.4 Pre-write snapshot + one-click revert ("Stride Undo") — *recommended*
Live's native undo records each `insert_step` as a separate step (Cmd-Z would take dozens of presses). Instead, **Stride owns the undo**:
- Before overwriting an envelope, snapshot its existing events over `[0, len]` (the `_read_probe` path already reads envelopes; `events_in_range`/`value_at_time` give us the data).
- Store snapshots with the inject record.
- Offer **"Revert last inject"** — re-`delete_events_in_range` + re-insert the snapshot. Deterministic, whole-batch, one click.

This is the ultimate answer to "Stride messed up my project": it is **always reversible**, regardless of Live's undo behavior.

### 3.5 Scope guards — *required*
Hard refusals, surfaced clearly (never silent):
- **Track/clip consistency:** every param in a target group must resolve to the **same track** as that group's clip. Cross-track param↔clip pairing → abort.
- **Session-only:** Arrangement clips rejected (already true). Multi-track is **Scene-scoped**.
- **No clips on returns/master:** see §6.
- **Topology-change tripwire:** capture a cheap session signature at scan (track count, per-track device-name list). If it changed before inject, force a re-scan of affected tracks before allowing commit.
- **Concurrency:** one inject batch at a time (`_busy` already guards; multi-track is **one trigger** carrying all targets, never N concurrent triggers).

---

## 4. Feature architecture

### 4.1 Mental model: **Scenes**
Don't model "arbitrary clips." Model an Ableton **Scene** — the column of clip slots at index `S` across tracks. It maps 1:1 to Live's concept, to the LOM (iterate tracks, same slot index), and to the *Modulate Everything* concept. The unit of work is: **"inject Scene S, with a per-track pattern assignment."**

### 4.2 Data model (Electron)
New top-level **Session Map** document (separate from per-rack `canvas_<rackId>.json`):
```jsonc
{
  "scene": 3,
  "session_sig": { "track_count": 8, "devices": ["Operator","Serum",...] },
  "targets": [
    {
      "track_idx": 4, "track_name": "SERUM", "clip_slot": 3,
      "generator": "sample_hold",            // or a saved canvas/curve set
      "params": [ /* fingerprinted param + points, per §3.1 */ ]
    },
    ...
  ]
}
```
A target's `params`/`points` come from either (a) a generator applied to that track's mapped params, or (b) a saved canvas for that track. Per-track mapping stays **intentional** (consistent with `feedback_intentional_param_mapping`): you map each track's params deliberately, but reuse saved maps so it's fast.

### 4.3 Message protocol
New action `apply_scene_inject` (additive; `apply_inject` untouched):
```jsonc
// trigger (canvas → bridge → Remote Script)
{
  "action": "apply_scene_inject",
  "phase": "preview" | "commit",          // §3.3 two-phase gate
  "scene": 3,
  "groups": [
    { "track_idx": 4, "clip_slot": 3, "clip_bars": 4, "create_clip_if_missing": true,
      "params": [ { ...fingerprint..., "points": [...] } ] },
    ...
  ]
}
// result adds per-target classification + (preview) snapshot ids
{ "success": true, "phase": "preview",
  "targets": [ {"track_idx":4,"param_name":"Filter Freq","status":"OK"}, ... ] }
```

### 4.4 Remote Script changes (`StrideInject`)
- **`_resolve_clip(track_idx, clip_slot)`** — new: `song.tracks[track_idx].clip_slots[clip_slot]`; `create_clip(len)` if empty **and** track is MIDI **and** `create_clip_if_missing`; reject returns/master.
- **`_resolve_param`** — extend to verify fingerprint (§3.1) + self-heal (§3.2); return `(param, status)`.
- **`_write_inject` → `_write_scene_inject`** — iterate groups; Phase A resolve+verify all, write preview; Phase B snapshot + commit `OK/HEALED` only; aggregate one chunked write queue across all groups (reuse `_flush_chunk`).
- **Verification helpers** — name/device/min-max compare.

### 4.5 Scanner changes (`scanner_max.js`)
- Emit **absolute** paths (`live_set tracks N …`) by capturing the track index at scan, not `view selected_track`.
- Emit the **fingerprint** fields (device chain names, param name, idx, min/max).
- Support **scanning a specified track** (not just selected) for the multi-track map — lazily, one track at a time, cached, keeping the v2.0.2 id-guard (don't reintroduce the freeze).

### 4.6 UI (Electron)
- **Scene picker** (which scene column) + a **target matrix**: one row per track in the scene → assign generator/curve + show its mapped params.
- **Preview/confirm** sheet (§3.3) — the gate before any write.
- **"Revert last inject"** button (§3.4).

---

## 5. Phasing

- **Phase 0 — Go/No-Go spike (~1 hr).** Prove `insert_step`/`create_event` write to a **non-focused** clip on a **non-selected** track (`song.tracks[N].clip_slots[S].clip`). This is the *single real unknown*. ~90% confident it works (nothing in the LOM requires focus). Build on `StrideBezierProbe`. **Nothing ships until this is green.**
- **Phase 1 — Safe MVP.** One scene, **one pattern across selected tracks**, auto-use each track's saved map. Full safety stack (§3.1–3.3, §3.5) + **dry-run preview**. This is the 80%.
- **Phase 2 — Per-track matrix.** The assignment UI: each track picks its own generator/variation. Pure layer on Phase 1.
- **Phase 3 — Scene-fill + cross-track intelligence.** Create missing clips; **Prism across tracks** (lead/bass get *complementary*, not independent, motion) + snapshot/revert (§3.4) as a first-class feature.

---

## 6. Hard constraints & caveats (be honest in UX)
- **Returns/Master have no clips** → no clip automation. To "modulate the reverb," automate the **send amount from each source track's clip**, not the return's device. The *Modulate Everything* video's "A·REVERB / B·DELAY" rows are aspirational; real targets are clip-bearing MIDI/audio tracks.
- **Audio tracks:** can hold automation on **existing** clips, but `create_clip` is MIDI-only — can't fill empty audio slots.
- **Session-only:** Arrangement automation has no write API. Workflow stays: inject Session → drag to Arrangement (curves travel).
- **Write volume:** N tracks × M params × K points. Adaptive steps + chunking handle it, but add a **soft cap with a progress bar + cancel**; above the cap, suggest fewer tracks per pass.

---

## 7. Risks → mitigations

| Risk | Severity | Mitigation |
|---|---|---|
| Silent misroute (wrong param) | **Critical** | Fingerprint verify (§3.1) + self-heal (§3.2) + dry-run gate (§3.3). Never write on mismatch. |
| Corrupts user project | **Critical** | Pre-write snapshot + one-click revert (§3.4). Validate-all-then-commit (no partial). |
| Scanner freeze under N racks | High | Lazy per-track scan, cache, keep v2.0.2 id-guard; never scan whole session at once. |
| Topology drift between scan/inject | High | Session signature tripwire (§3.5); force re-scan of changed tracks before commit. |
| Write-volume timeout/freeze | Medium | Existing chunked drain; soft cap + progress + cancel. |
| Cross-track param/clip mispairing | High | Track-consistency guard (§3.5): param.track must == clip.track. |

---

## 8. Test plan (the regression net)
Automated (extend `test/test_stride_inject_curve.py` + a new resolver suite):
1. **Identity:** fingerprint match passes; renamed param → MISMATCH (no write); reordered device → HEALED by name; deleted device → UNRESOLVED (no write).
2. **Cross-track guard:** param from track A + clip from track B → abort.
3. **Returns/master:** target a return → rejected with the send-automation hint.
4. **Snapshot/revert:** inject → revert → envelope byte-identical to pre-inject (sample `value_at_time` grid).
5. **Volume:** 8 tracks × 6 params × dense LFO → no freeze, completes, counts match.
6. **Manual misroute gauntlet** (the scenarios that shipped bugs before): non-default User Library, name-sorted lanes, rack with duplicate macro names, device added between scan and inject.

---

## 9. Open decisions
- **Generator-per-track vs canvas-per-track:** MVP = one generator across the scene; matrix = per-track. Saved per-track canvases later.
- **Clip length per track:** unify to the scene's longest clip, or per-track? (Lean: per-track, default to existing clip length.)
- **Revert scope:** last inject only, or a short stack? (Lean: last only for MVP.)
- **Confirm friction:** always show the preview gate, or only when any target is `HEALED`/`MISMATCH`? (Lean: always for multi-track; it's the safety contract.)

---

### TL;DR for the build
1. **Phase 0 spike** proves non-focused-clip writes — the only unknown.
2. The feature is *re-pathing + a verification layer*; the LOM already supports it (`_resolve_param` handles absolute paths today).
3. The misroute risk is **structural** (positional, late, unverified identity at `StrideInject/__init__.py:248,606`). Fix it with **fingerprint verify → self-heal → dry-run gate → snapshot/revert**. Build that safety as a first-class citizen, not an afterthought — it's the difference between a killer feature and a refund machine.
