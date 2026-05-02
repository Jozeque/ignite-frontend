# Live needs a bezier envelope API

*A modest proposal from a Max for Live developer*

## TL;DR

Ableton's Live Object Model lets us write breakpoints into clip envelopes — but only as stair-step plateaus. There's no programmatic way to write bezier curve handles. As a result, every Max for Live modulator developer working with smooth automation has to take a bizarre detour: generate an `.alc` file on disk, then ask the user to drag it manually into a clip slot. **One new LOM method would eliminate this friction for an entire category of devices.**

## The friction, named

I've been building **Stride** — a desktop app + Max for Live device that lets producers draw automation curves visually and apply them to instrument racks in Ableton. The workflow looks like this:

1. User scans their rack — Stride reads every parameter via LOM ✓
2. User draws bezier curves on a canvas ✓
3. Stride generates the curves... and writes them to an `.alc` file on disk ✗
4. User finds the file in `~/Desktop/Stride/` ✗
5. User drags the file into Ableton's clip slot ✗
6. They press play to hear it ✓

Steps 3-5 should not exist. They exist only because **LOM cannot write bezier breakpoints into a clip envelope**.

## The technical reality

`Clip.automation_envelope(parameter)` returns an `AutomationEnvelope` object whose entire writable surface is one method:

```
insert_step(time: float, length: float, value: float) → None
```

This produces flat plateaus followed by vertical jumps. Not even linear interpolation between values — actual stair-steps.

What `.alc` XML supports (and what Live's clip envelope engine renders beautifully) is far richer. Each `<FloatEvent>` element supports `CurveControl1X/Y` and `CurveControl2X/Y` attributes that bend the segment between two breakpoints into a quadratic bezier. **You can see this when you draw an automation curve in Live by hand and pull a handle.**

The ask: expose those bezier handles to LOM.

## The proposed API

```
AutomationEnvelope.add_bezier_breakpoint(
    time: float,
    value: float,
    curve_in_x: float = 0.5,
    curve_in_y: float = 0.0,
    curve_out_x: float = 0.5,
    curve_out_y: float = 0.0
) → None
```

Optional bezier control parameters with sensible defaults that produce a linear segment when omitted. Backwards compatible — `insert_step` continues to work exactly as it does today.

## Who benefits

**M4L modulator developers (~50-100 commercial devs):**
- Stride and similar drawing tools can write directly to clips. No `.alc` files. No drag-drop. Workflow goes from "design → file generation → drag → listen" to "design → listen."
- Custom envelope generators (Shaper-style devices, but programmable from outside) become possible.
- Generative automation tools can write smooth modulation programmatically — currently impossible.

**Producers using those devices:**
- Removed the most-friction step in any "draw curves and hear them" workflow.
- Per-iteration time drops from ~10 seconds to ~0 seconds.
- More iterations = more sound design exploration.

**Ableton:**
- Live becomes the only DAW with deep programmable automation. FL Studio, Logic, Bitwig — none have this.
- Differentiator that attracts sound designers who currently flinch at Live's stock automation tools.
- Suite upsell driver — every interesting M4L modulator becomes a reason to be on Suite.
- Costs ~1-2 engineering weeks. Possibly less.

## What this would unblock

- **Drawn-curve modulators** that actually write to clips (vs. just modulating in real-time)
- **Procedural automation** (algorithmic envelope generation, generative music tools)
- **Curve marketplaces** (preset packs of bezier curves users can apply to their own racks)
- **AI-driven automation** (controversial, but inevitable — and currently impossible without disk-file workarounds)
- **Cross-track curve libraries** (one user's saved curve, applied to anyone's rack)

The current `insert_step`-only approach doesn't just block these — it makes them awkward, file-based, dependent on UI gestures we can't simulate.

## Why now

Live 12 added several modulator-related APIs — clear signal that Ableton is investing in this space. The Modulators pack (Shaper, LFO, Envelope Follower) shipped with sophisticated curve-drawing UI. The internal capability obviously exists. **Exposing it to LOM is the next natural step.**

## How M4L devs can help

If you've hit this wall too — building modulators, automation tools, generative devices — chime in:

- Cycling 74 forum thread: [link to existing or new thread]
- Ableton's developer feedback channel
- Tag with #M4LBezier on social

Pressure from working developers is what drives LOM extensions. This is one of those.

---

*Written by Joe — building Stride, the sound design engine that shouldn't need a file dragger.*

*[stridehub.io](https://stridehub.io) · [@strideengine](https://www.youtube.com/@strideengine)*
