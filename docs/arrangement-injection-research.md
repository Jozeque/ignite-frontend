# Arrangement-view automation injection — research (parked 2026-06-05)

**Question:** Can Stride write automation/curves *directly* into a MIDI clip in
Ableton's **Arrangement** view (not just Session)? Joe recalls "we managed to do
that in the past."

**Status:** Parked for later. Session injection works; arrangement does not (yet)
via any direct API we've found. Two working *workarounds* exist today.

---

## What works TODAY for arrangement automation

1. **Session inject → drag to Arrangement.** Direct-inject writes clip-internal
   envelopes into a Session clip; dragging that clip into the Arrangement carries
   the envelopes with it. Native, no `.alc`, no template. (Confirmed by Joe.)
2. **`.alc` drop.** Stride's `.alc` carries BOTH the clip envelope (in the
   MidiClip) AND track-level AutomationEnvelope (on MainTrack); dropping it into
   the Arrangement timeline produces the automation. (The original shipping path.)

Both get curves into the arrangement. Neither is "select an arrangement clip,
hit inject, done."

---

## Why direct arrangement injection fails (evidence)

### 1. `Clip.automation_envelope` / `create_automation_envelope` → `None` for arrangement clips
- **Verified empirically** in Joe's Ableton log (2026-06-04): `target clip =
  Operator 6 (arrangement=True)` → every param logged `no envelope for '<param>'
  — skipping`. i.e. both `automation_envelope(param)` and
  `create_automation_envelope(param)` returned `None` for the arrangement clip,
  while resolving the params themselves succeeded.
- Session clips (`is_arrangement_clip == False`) return valid envelopes and
  `insert_step` works — this is the path direct-inject uses today.

### 2. Extensions SDK (Live 12.4.5 beta, `index.d.cts`) — no automation write at all
- **No `Track.duplicate_clip_to_arrangement`** (or any `duplicate_clip_*`) — my
  hoped-for "automate the drag" primitive does **not** exist.
- Track DOES expose `createMidiClip(startTime, duration)` and `createAudioClip(...)`
  that create clips **in the arrangement** — but these create *empty* clips.
- The SDK exposes **zero** envelope/automation API (no clip-envelope write, no
  track-automation write). Same wall as the bezier research:
  `docs/bezier-envelope-api-proposal.md` + `docs/community-bezier-api-evidence.md`.

### 3. Track (arrangement-timeline) automation — zero LOM/SDK API
- The LOM has never exposed an entry point to create/write/modify arrangement
  timeline automation lanes (20-year gap; cited Cycling '74 threads in the bezier
  docs). Arrangement automation only enters Live via the `.alc`/project file.

**Conclusion so far:** As of Live 12.3 (Remote Script LOM) and the 12.4.5
Extensions SDK beta, there is **no API to write automation into an arrangement
clip or the arrangement timeline.** Arrangement automation must ride in on a clip
(Session→drag) or a `.alc`.

---

## Open threads to chase when we resume

1. **"We did it before" — finish the git-history search.** (The agent doing this
   was interrupted before reporting.) Pickaxe the history for arrangement-writing
   code: `git log -S"automation_envelope" --all`, `git log -S"arrangement" --all`,
   look at old `StrideWriter`, `alc_injector.py`, `writer.js`, and any removed
   remote scripts. If a past version really wrote arrangement automation, find the
   exact API calls + commit. (Most likely Joe is remembering the `.alc`-drop or
   the Session→drag flow, both of which DO land curves in the arrangement.)
2. **Probe a freshly-created arrangement clip.** Does `automation_envelope` /
   `create_automation_envelope` behave differently on a clip created via
   `createMidiClip` (SDK) vs. an existing arrangement clip? Build a probe remote
   script that enumerates `dir(clip)` / `dir(track)` for an arrangement clip and
   tries every envelope method, logging results. (Empirical — must run in Ableton.)
3. **Re-check newer Live betas** for any arrangement-automation write API as
   Ableton iterates the Extensions SDK (it's 1.0.0-beta.0 — automation may land later).
4. **Automate the drag a different way.** Since `duplicate_clip_to_arrangement`
   doesn't exist, is there ANY LOM call to place a Session clip into the
   arrangement at the playhead (so we keep the working "inject Session + it lands
   in arrangement" UX without a manual drag)? Worth a `dir(track)` sweep.

## Decision recorded
Direct-inject stays **Session-only**; arrangement is served by Session→drag and
`.alc`. The in-app message already points users there. Revisit if a write API
appears or the git search turns up a real past mechanism.
