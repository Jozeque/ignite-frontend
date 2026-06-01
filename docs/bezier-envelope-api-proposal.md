# A small API addition that would unlock a new class of creative tools in Live

*An open letter from a Max for Live developer building inside Ableton's ecosystem*

---

## In one paragraph

There's a small gap in Ableton's Live Object Model that's currently capping the growth of an entire category of creative tools. Producers want to draw automation curves visually and apply them to their racks — and the tools to do this exist, ship, and work. But because LOM can only write flat stair-step plateaus into clip envelopes (not the bezier curves Live itself draws beautifully in the UI), every tool in this category has to route through a file-drag intermediate step. The workflow works; producers are willing to learn it because the creative payoff is real. But that learning curve is a tax on every new user, and it's the single biggest reason these tools haven't reached the mainstream Live audience yet. **Exposing programmatic bezier-write on Live's existing automation surfaces — both clip envelopes and arrangement track envelopes — would remove that tax, unlock creative capabilities that don't exist in any DAW today (live preview during edits, per-lane Apply, undo at the clip level, track-mismatch protection), and make Live's stock instruments meaningfully more powerful in the hands of sound designers.**

---

## Who's writing this

I'm Joe — I build **Stride**, a desktop app + Max for Live device that lets producers draw automation curves on a visual canvas and apply them to any Ableton rack. Think of it as "sound design through gesture": you load your favourite Operator patch, draw an evolving curve on the Cutoff parameter, and the rack starts moving in ways you'd never program by hand.

Where Stride is today:
- **166 producers engaged** in the CRM — paying customers, ambassadors, and active waitlist combined
- **~30% conversion to paid** on those leads — and **this is before any marketing has started**
- **Growing daily** across YouTube subscribers, Instagram followers, Reddit engagement, and purchases — pure organic, word-of-mouth growth from Reddit's electronic-music production communities
- **Realistic 6-month forecast: 1,000+ engaged producers** as marketing ramps from zero
- Several customers are professional producers and Ableton-certified trainers

The audience is exactly Ableton's core: electronic producers who live inside Live and want deeper sound-design tools. The pre-marketing conversion rate is the signal — when producers find Stride, they buy it. The cap on growth right now isn't reach; it's the workflow friction documented below.

The problem I want to walk Ableton through isn't a Stride problem. It's an LOM problem that affects every developer working in this space — and more importantly, it affects every producer who tries to use these tools.

---

## What producers are saying

Stride works end-to-end — the math, the canvas, the rack scanning, the apply pipeline. Every customer who pushes through the workflow gets curves into their tracks and falls in love with what they hear. The friction isn't in the product; it's in the path from "I clicked Apply" to "I'm hearing the curve."

**Every new customer has to learn the same workflow before they're independent.** A typical first-day email reads:

> *"I just bought Stride today but can't get it to work. I'm getting the following error whenever I press Apply To Clip… I don't understand what's happening. I am using an instrument with 8 parameters, and the template does have 8 parameters."*

The pattern: they did everything right. Their rack has 8 parameters, their canvas shows 8 lanes, they drew their curves. The friction is that Stride has to route those curves through a file-drag intermediate step — and that step requires a pre-prepared "template" clip with all 8 envelopes embedded. They didn't know Ableton only embeds an envelope in a clip if the parameter has been manually touched at least once first. After a brief support email, they're working — and the follow-up messages are excited, full of sounds they discovered they couldn't have programmed by hand.

**The value at the end is real enough that producers push through.** The process of getting there is tedious and the order of operations is unintuitive — but they stay on it. Every week brings new customers walking the same path, each one needing personal hand-holding before they're independent. That's not a sustainable adoption pattern.

**The friction isn't unique to Stride, though.** It's a Max for Live ecosystem-level pattern that developers and producers have been documenting on the Cycling '74 forum and Ableton Forum for over a decade. A short sample of the dozens of public threads:

> *"LOM has no means of writing automation lines."*
> — Norman Freund, on a thread asking for an M4L API to snapshot all device parameters into a clip envelope.
>
> Reply from Diemo Schwarz (recognised M4L developer):
> *"This is indeed my biggest incomprehension with Live."*
>
> [cycling74.com — Touch all Params to Clip Automations](https://cycling74.com/forums/touch-all-params-to-clip-automations)

> *"As of now (Ableton 12.1) there is no possibility to do this, sadly. But it would be amazing."*
> — hoowdie, on a multi-year Cycling '74 thread requesting programmatic clip envelope editing. The thread spans Live 10 → Live 12.1 with no resolution.
>
> [cycling74.com — Programatic Clip Envelope Editing??](https://cycling74.com/forums/programatic-clip-envelope-editing)

> *"Would be great if we could modify the automation envelope programatically. In the API docs there's a `Live.Clip.AutomationEnvelope.insert_step()` method. Could this be implemented?"*
> — hilifit, filed January 2024 against AbletonOSC (the most popular open-source Ableton OSC bridge). Shows the demand extends beyond M4L into the Python/OSC scripting community.
>
> [github.com — AbletonOSC Issue #112](https://github.com/ideoforms/AbletonOSC/issues/112)

These are independent voices, across three different developer communities, spanning ~20 years. The same request keeps surfacing with the same workarounds and the same lack of resolution.

There's also a moment that proves the technical capability exists internally: a developer ([Cycling '74 thread](https://cycling74.com/forums/parameter-automation-per-step)) reverse-engineered Live's compiled Python files (`LomTypes.pyc`, `MxDCore.pyc`) to expose `create_automation_envelope`, `insert_step`, and `value_at_time`. He explicitly noted the work was "a gray area" and refused to publish it, but explicitly asked Cycling '74 / Ableton to release these features officially. The methods exist inside Live — they're just not exposed to LOM.

What also matters is what we don't see: the silent majority — producers who hit the workflow once, decide it's too much friction, and quietly move on without ever sending an email. Stride's 30% pre-marketing conversion is just the producers who pushed through. The full audience is bigger.

The friction also shapes producers' expectations of M4L modulation tools generally — including future devices Ableton itself might release.

---

## What's actually missing

When you draw an automation curve in Live by hand and pull a handle to bend a segment, Live stores that bend as a bezier curve. The data lives in Live's automation format — whether it's a clip envelope (used in Session view, and inside Arrangement clips) or a track-level automation envelope (used on the Arrangement timeline). The renderer handles both. Save the project, reopen it — the curves are still there, still beautiful.

**The Live Object Model — the scripting interface Max for Live and Remote Scripts use — has no way to write that same bezier curve programmatically in either location.** The current state:

- **Clip envelopes:** LOM exposes `clip.create_automation_envelope(parameter)` → returns an envelope object whose only writable method is `insert_step(time, length, value)`. Produces flat stair-step plateaus. No interpolation. No bezier.
- **Arrangement / track-level automation:** LOM exposes nothing at all. No entry point to create, write, or modify track automation programmatically. Confirmed by multiple Cycling '74 community threads (*"to my knowledge there has never been any API for manipulating automation values in the timeline"* — tyler mazaika, on the Cycling '74 forum).

Stride works in both contexts: producers drop the generated automation into Session clip slots (uses clip envelopes) OR into the Arrangement timeline (uses track-level envelopes). Both workflows are common; both hit the same wall.

So every external tool that wants to produce smooth, curved automation has built the same workaround: a file-mediated path through Ableton's `.alc` format, which contains both clip envelopes and track-level envelopes in one bundle. The path works — Stride uses it today and ships real value to producers through it — but it requires every user to learn:

1. How to prepare a "template" MIDI clip with one automation point on every parameter they want to control
2. How to find the generated `.alc` on disk after clicking Apply
3. How to drag it into Ableton's clip slot without accidentally targeting the wrong track (which silently orphans every envelope because parameter IDs don't match the new track's rack)
4. How to identify which clip slot is the "right" one for their current session
5. How to recognise the difference between a successful drop and a no-op silent drop
6. How to re-prepare the template if they change their rack later

These six things make sense to anyone who's done it twice. They're a wall for the producer doing it once. **None of them would exist if external tools could write bezier breakpoints directly into Live's automation (clip envelopes for Session, track envelopes for Arrangement).** All six collapse into a single Apply button click.

---

## What we're asking for

Additive LOM methods that let external tools write bezier breakpoints into Live's automation envelopes — the same way Live writes them when a producer draws by hand — for **both** of the contexts producers actually use:

- **Clip envelopes** (used in Session view and inside Arrangement clips). Roughly:
  ```
  Clip.set_envelope_breakpoints(parameter, breakpoints)
  ```
- **Track-level automation envelopes** (used on the Arrangement timeline). Roughly:
  ```
  Track.set_arrangement_envelope_breakpoints(parameter, breakpoints)
  ```

Where each breakpoint carries a time, value, and the bezier handle coordinates that already exist in Live's storage format. Backwards-compatible with everything that exists today. The existing `insert_step` keeps working untouched. The new methods just slot in alongside it.

This is one cohesive capability — programmatic bezier write into Live's automation system — split across two existing surfaces in LOM. Producers don't think of these as two separate things; the tools shouldn't have to either.

Technical details on possible API shapes are at the end of this doc — Ableton's engineering team would obviously pick whichever fits their patterns best. We're flexible on shape.

---

## What changes when this ships

### For producers using tools like Stride

The learning-curve tax disappears entirely. The workflow collapses into: **draw → apply.** Time per iteration goes from ~10 seconds of file management to ~half a second. Producers who already love the value can now iterate 20x more frequently per session — meaning 20x more sound-design exploration in the same amount of studio time. And the silent majority who currently bounce off the workflow before they get to the value? They convert.

Critically, the silent-failure class goes away entirely. Tools can read which clip the producer has open, walk up to its track, compare against the rack they're working with — and refuse to write with a clear error if they don't match. No more *"I followed the steps and nothing happened."*

### For Ableton's stock instruments

This is the part I think is most under-appreciated. Operator, Wavetable, Drum Bus, Echo, Auto Filter, Roar, the rest of the stock devices — they all have ~50-200 modulatable parameters each. **In the hands of a producer with no external tools, producers automate maybe 1-2 parameters per track because manual envelope drawing is slow.** With visual curve-drawing tools that write directly to clips, that same producer routinely automates 8-20 parameters per track. The same rack becomes a different instrument.

Every time a Stride user discovers a sound in Operator they didn't know was possible, that's a producer falling more in love with an Ableton instrument. The friction the bezier API removes isn't just Stride's friction — it's the friction between Ableton's instruments and the deep sound-design workflows producers want from them.

### For the M4L developer ecosystem

Modulation devices, generative tools, curve drawing apps, AI-driven automation, parameter sequencers, evolving texture generators — entire categories of devices that today are awkward-to-impossible become natural. Any developer who's tried to build a "draw curves and hear them" tool has hit this exact wall. Removing it doesn't just help one device; it makes the whole M4L marketplace more inventive.

### For Ableton's business

- **Live becomes the only DAW with deep programmable bezier automation.** FL Studio, Logic, Bitwig — none of them have an open, scriptable curve-writing path into either clip envelopes or arrangement automation. This is a real differentiator in the sound-design-tools segment.
- **Strong Suite upsell driver.** Every interesting M4L modulator that ships post-API becomes a reason to be on Suite instead of Standard. The M4L ecosystem's strength is one of Suite's load-bearing value props.
- **Producer retention.** Sound designers who currently bounce off Live's stock automation tools (and migrate to Bitwig for its modulation system) get a programmable answer inside Live. This is the audience most likely to switch DAWs for deeper modulation.
- **Aligns with the Live 12.x LOM extension trajectory.** The API additions in 12.1 (`create_audio_clip`, `create_midi_clip`, take-lane access, `display_value`) all follow the same pattern: expose existing internal capabilities so the developer ecosystem can build interesting things on top. The bezier write API is the same pattern, applied to the gap that's currently bottlenecking the most creative category of M4L tooling.

---

## What we know is already in place

A few things worth flagging — not to tell Ableton how to implement, but to point out that the foundations exist:

- The Live project XML already stores bezier handle data for both clip envelopes and track-level automation. Any `.als` or `.alc` opened in a text editor shows `CurveControl1X/Y` and `CurveControl2X/Y` attributes on `<FloatEvent>` elements, inside both `<ClipEnvelope>` containers (clip-internal) and `<AutomationEnvelope>` containers (track-level).
- Live's envelope renderer already draws bezier curves from that data in both contexts — it's what user-drawn curves use today, whether in a clip's envelope view or on an arrangement automation lane.
- A developer in the Cycling '74 community has previously demonstrated (and refused to publish) that internal Python classes for envelope creation and writing exist in `LomTypes.pyc` / `MxDCore.pyc` — they're just not exposed to LOM.

The proposal is **purely additive**. No deprecations. No breaking changes. Every existing M4L device that uses `insert_step` continues to work exactly as it does today. The new methods exist alongside it.

---

## What I'd love to discuss

I'd welcome the chance to:
- Demo Stride live (5-10 minute walkthrough showing the workflow today + a paper sketch of what the same workflow looks like once the API ships)
- Share the full friction inventory from our user research (~13 distinct points, ~10 of which evaporate with this single API)
- Co-design the API shape with Ableton's LOM team to make sure it fits their patterns
- Be a public partner in announcing it when it ships — the Stride community would be a strong amplifier

Reachable any time at `home@stridehub.io`.

Thank you for reading.

— Joe
[stridehub.io](https://stridehub.io) · [YouTube](https://www.youtube.com/@strideengine) · [Instagram](https://www.instagram.com/strideengine)

---

## Appendix: technical API shape options

Two parallel surfaces are needed — one for clip envelopes (Session view + clips inside Arrangement) and one for track-level envelopes (Arrangement timeline). Either of the two write-method shapes below works on either surface. Ableton's engineering team should obviously pick whichever fits their LOM patterns best — and may choose different shapes for the two surfaces if that fits internal patterns better.

### Clip envelope surface (extends existing `Clip.create_automation_envelope` path)

**Option A — batch:**

```python
Clip.set_envelope_breakpoints(
    parameter,
    breakpoints: list[dict]
    # [{ "time": 0.0, "value": 0.5,
    #    "c1x": 0.5, "c1y": -0.3,
    #    "c2x": 0.5, "c2y":  0.3 }, ...]
) -> None
```

**Option B — per-breakpoint:**

```python
Clip.add_envelope_breakpoint(
    parameter,
    time: float,
    value: float,
    c1x: float = 0.5, c1y: float = 0.0,
    c2x: float = 0.5, c2y: float = 0.0,
) -> None
```

### Track-level (arrangement) envelope surface (new — no existing LOM entry point)

**Option A — batch:**

```python
Track.set_arrangement_envelope_breakpoints(
    parameter,
    breakpoints: list[dict]
) -> None
```

**Option B — per-breakpoint:**

```python
Track.add_arrangement_envelope_breakpoint(
    parameter,
    time: float,
    value: float,
    c1x: float = 0.5, c1y: float = 0.0,
    c2x: float = 0.5, c2y: float = 0.0,
) -> None
```

Batch shape is atomic and faster for bulk writes (which is what most envelope-drawing devices do). Follows Ableton's recent LOM extension pattern: task-specific methods on parent objects (see `create_audio_clip`, `create_midi_clip` added in Live 12.1). Per-breakpoint shape has the smallest per-call surface and lets defaults produce a linear segment for the simplest mental model.

### Coordinate space

Live's project XML already serializes `CurveControl1X/Y` and `CurveControl2X/Y` on `<FloatEvent>` elements in both clip envelopes and track-level envelopes, in a normalized coordinate space where X is along the segment (0 to 1) and Y is the deflection from the linear interpolation line. The new APIs should accept the same coordinate space so existing tools that already produce this format (including Stride's `.alc` writer) can map their output directly.

### Read access (nice-to-have, not required)

If the APIs also expose breakpoint reading (`Clip.get_envelope_breakpoints` and `Track.get_arrangement_envelope_breakpoints`), it enables one more capability: tools can implement true Undo Apply by snapshotting the existing envelope before write. Without read access, tools can still undo their own writes by remembering what they wrote — acceptable degradation. This isn't a blocker; ship write-only first if it's faster.
