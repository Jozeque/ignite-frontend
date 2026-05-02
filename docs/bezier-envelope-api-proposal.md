# Live needs a bezier envelope API

*A modest proposal from a Max for Live developer*

## TL;DR

Ableton's Live Object Model lets us write breakpoints into clip envelopes — but only as stair-step plateaus. There's no programmatic way to write bezier curve handles. As a result, every Max for Live modulator developer working with smooth automation has to take a bizarre detour: generate an `.alc` file on disk, then ask the user to drag it manually into a clip slot. **One new LOM method would eliminate this friction for an entire category of devices — and unlock four new capabilities that don't exist anywhere else.**

## The friction, named

I've been building **Stride** — a desktop app + Max for Live device that lets producers draw automation curves visually and apply them to instrument racks in Ableton. The intended workflow is: scan rack → draw curves → apply → hear it. The actual workflow looks like this:

1. User scans their rack — Stride reads every parameter via LOM ✓
2. User drags a MIDI clip from the rack's track into the User Library to **create a template** ✗
3. User draws bezier curves on a canvas ✓
4. Stride generates the curves and writes them to an `.alc` file on disk ✗
5. User finds the file in `~/Desktop/Stride/` ✗
6. User drags the file into Ableton's clip slot ✗
7. **User often drops on the wrong track. The drop "succeeds" silently. No automation is applied.** ✗
8. They press play and hear nothing change. They email me confused. ✗

Steps 2, 4, 5, 6, 7, 8 should not exist. They exist only because **LOM cannot write bezier breakpoints into a clip envelope.**

## The user-facing pain (a real story)

A producer emailed me last week: "I drew curves, hit Apply, dragged the .alc onto a clip slot — nothing happened. The track plays but no automation."

The cause: he dropped the .alc on a MIDI track that had a **different rack** than the one he scanned with. The .alc references parameter `PointeeId`s from the original rack. On the target track, those IDs don't exist. Ableton imports the clip without erroring, but every envelope is orphaned. Total silent failure.

The workaround I had to give him: "drop on a fresh empty MIDI track with no rack on it." That works, but it's voodoo. He'd never figure it out from the UI.

This is one of dozens of similar emails. Each one is a producer who almost refunded because Stride looked broken. **The user's experience of LOM's lack of bezier-write directly produces user-facing failure modes.**

## The technical reality

`Clip.create_automation_envelope(parameter)` returns an `AutomationEnvelope` object whose entire writable surface is one method:

```
insert_step(time: float, length: float, value: float) → None
```

This produces flat plateaus followed by vertical jumps. Not even linear interpolation between values — actual stair-steps.

What `.alc` XML supports (and what Live's clip envelope engine renders beautifully) is far richer. Each `<FloatEvent>` element supports `CurveControl1X/Y` and `CurveControl2X/Y` attributes that bend the segment between two breakpoints into a quadratic bezier. **You can see this when you draw an automation curve in Live by hand and pull a handle.**

The ask: expose those bezier handles to LOM.

## The proposed API

Two viable shapes. Either solves the problem.

### Option A — batch on Clip

```python
Clip.set_envelope_breakpoints(
    parameter,
    breakpoints: list[dict]  # [{ "time": 0.0, "value": 0.5, "c1x": 0.5, "c1y": 0.3, "c2x": 0.5, "c2y": 0.3 }]
) → None
```

Atomic, fast for bulk writes. Follows Ableton's recent LOM extension pattern (task-specific methods on parent objects — see `create_audio_clip`, `create_midi_clip` added in Live 12.1).

### Option B — per-breakpoint method

```python
Clip.add_envelope_breakpoint(
    parameter,
    time: float,
    value: float,
    c1x: float = 0.5, c1y: float = 0.0,
    c2x: float = 0.5, c2y: float = 0.0
) → None
```

Defaults that produce a linear segment — backwards-compatible. More LOM calls per write but simpler API surface.

## What this single API change unlocks

It's not just "make Stride less awkward." Five entire categories of capability become possible that aren't possible today.

### 1. Direct write — eliminates 6 friction steps in one shot

The seven-step nightmare above collapses to: scan → draw → apply. No template, no file, no drag, no track confusion, no silent failures. **Producer time saved per iteration: ~10 seconds → ~0.5 seconds.**

### 2. Track-mismatch detection — kills the silent-fail class entirely

Post-API, Stride reads `live_set view detail_clip`, walks up to its track, compares against the rack's track. If they don't match, refuse to write and show: *"The clip you have open is on track 'X'. Stride is bound to track 'Y'. Open a clip on the right track."* The producer sees the actual problem instead of staring at unmoving parameters.

### 3. Live preview — closes the feedback loop completely

With direct envelope writes, Stride can debounce slider drag input at ~30 Hz and write each tick directly to the clip. Producer drags Smooth → hears the curve smoothing **in real time during the drag**. Drags Cutoff Floor → hears the filter open **as they pull the slider**.

This is the ONLY way to get real-time automation feedback in Live today. `live.remote~` modulates parameters in real time but writes nothing to clips (modulation dies when the device is removed). Native automation lanes have no programmatic-write path. The bezier API enables both: real-time preview AND clip-persistent storage in one capability. **This is the single biggest creative-workflow improvement Live could ship for sound designers.**

### 4. Per-lane Apply — additive automation instead of clip replacement

Today, `.alc` import REPLACES the clip's entire envelope set. Producer wants to add a Cutoff curve without touching their existing Filter Resonance automation? Impossible without re-creating Filter Resonance from scratch in the new .alc.

With the API, Stride writes only the lanes the user picked. Other envelopes stay untouched. Producers can layer curves across multiple sessions without rewriting their work each time.

### 5. Undo Apply — first-class clip-level undo

Snapshot existing breakpoints before write. On Undo, restore them. Today there's no way back from a bad Apply.

### 6. New device categories that don't exist today

- **Curve marketplaces** — share a curve as a `.curve` file, apply to any rack via LOM `_path` matching. Currently impossible because curves are tied to template envelope structure.
- **Generative modulators** that write to clips (not just modulate live) — algorithmic envelope generation, AI-driven automation, streaming generation pipelines.
- **Curve editors that aren't tied to specific devices** — third-party envelope drawing tools that work with ANY rack, not just ones with pre-saved templates.

## Who benefits

**M4L modulator developers (~50–100 commercial devs):**
- Stride and similar drawing tools can write directly to clips. No `.alc` files. No drag-drop. No silent failures.
- Custom envelope generators (Shaper-style devices, but programmable from outside) become possible.
- Generative automation tools can write smooth modulation programmatically — currently impossible.

**Producers using those devices:**
- Removed the most-friction step in any "draw curves and hear them" workflow.
- Real-time preview where there's currently a 10-second feedback loop.
- No more "I followed the steps and it didn't work" silent failures.
- More iterations per session = more sound design exploration.

**Ableton:**
- Live becomes the only DAW with deep programmable bezier automation. FL Studio, Logic, Bitwig — none have this.
- Differentiator that attracts sound designers who currently flinch at Live's stock automation tools.
- Suite upsell driver — every interesting M4L modulator becomes a reason to be on Suite.
- Costs ~1–2 engineering weeks. Possibly less.
- Aligns with the recent Live 12.x LOM expansion direction (`create_audio_clip`, `create_midi_clip`, take-lane access, `display_value`).

## Why now

Live 12 added several modulator-related APIs — clear signal that Ableton is investing in this space. The Modulators pack (Shaper, LFO, Envelope Follower) shipped with sophisticated curve-drawing UI. The internal capability obviously exists. **Exposing it to LOM is the next natural step.**

Live 12.1's addition of `Clip.create_audio_clip` and `Clip.create_midi_clip` shows Ableton is willing to add task-specific methods on `Clip`. `set_envelope_breakpoints` fits the same pattern.

## Backwards compatibility

The proposal is purely additive. `insert_step` continues to work exactly as it does today. Existing M4L devices that use it are unaffected. The new method/methods exist alongside, with sensible defaults that produce linear segments if curve handles aren't specified — keeping the API approachable for developers who don't need bezier.

No breaking changes to LOM. No deprecations. Just a new capability.

## The cost on Ableton's side

Estimated 1–2 engineering weeks based on:
- The XML format already supports bezier handles (`CurveControl1X/Y`, `CurveControl2X/Y` are written by Live itself when users draw curves manually)
- The clip envelope engine already renders bezier — that's how Live displays user-drawn curves
- The work is exposing the existing internal capability through LOM, not building new rendering or storage

Compared to the developer ecosystem this enables — and the producer workflow improvement it unblocks — it's a small investment for a large multiplier.

## How M4L devs can help

If you've hit this wall too — building modulators, automation tools, generative devices — chime in:

- Cycling 74 forum thread: [link to existing or new thread]
- Ableton's developer feedback channel
- Tag with #M4LBezier on social

Pressure from working developers is what drives LOM extensions. This is one of those moments.

---

*Written by Joe — building Stride, the sound design engine that shouldn't need a file dragger.*

*[stridehub.io](https://stridehub.io) · [@strideengine](https://www.youtube.com/@strideengine)*
