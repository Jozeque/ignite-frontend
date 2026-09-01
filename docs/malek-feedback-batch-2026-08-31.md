# Malek's feedback batch, 2026-08-31

Contact form reply with five points and five screenshots. All five are addressed. This is
the record of what each one actually turned out to be, because in three cases the report
described a symptom and the cause was somewhere else.

Source: `[Stride] Contact form_ malek_zouiten@hotmail.fr.eml`, 31 Aug 2026 17:54.

---

## 1. Range was unusable at the ranges people want

**He said:** "Let's say i only want to modulate a very sensitive parameter like the pitch
from 0-3%. With the range feature this way, i no longer see my curves and visuals and i
have no idea of what random shapes i have when i click on Neuro or Chaos." His screenshot
shows a lane at MIN 0% MAX 3% drawing a flat fuzzy line.

**What it was:** the lane rendered the OUTPUT value, so a 3% band squashed the drawing
into 3% of the row. The shape itself was always stored 0..1 and scaled on the way out
(`_sdRangeApply`), so only the drawing was wrong.

**Worse, and unreported:** the hit test ran through the same squash (`_sdRangeInv`). On a
0-3% band every click above the band floor mapped to 1.0, so a ranged lane could not be
drawn on at all. He never got far enough to hit that, but anyone using the feature would.

**Fixed:** the lane draws its 0..1 shape at full height, the band stays behind it as the
shaded dead zone plus dashed boundaries, and clicks map 1:1. `_sdRangeInv` is gone. The
motions ghost preview was un-squashed to match, or the drop would not look like the
promise. **Output is byte-identical**: a lane banded to 0-3% still only moves the knob
across 0-3%.

That is exactly what he asked for: "that full 100% curve modulates only that range".

## 2. No way to run Stride as an audio effect

**He said:** "at the moment if i put it as an instrument after a synth or on the master
channel it blocks audio."

**What it was:** not a passthrough bug. Instrument vs effect is a VST3 category fixed at
build time, and Live disables the input bus on a device it classifies as an instrument,
which lands on `buffer.clear()` in `processBlock`. The unity-gain passthrough has been in
there since 1.2.0 and simply never got fed.

**Fixed:** `Stride FX`, a second target from the same sources with `IS_SYNTH FALSE` and
its own frozen code `SwFx`. Ships in the same zip, no extra charge, same license file.
Details in `stride-fx-variant-spec.md`. No runtime toggle can do this, which is why it is
a second plugin rather than a button.

## 3. FOCUS clipped its own extremes

**He said:** "when they are at minimum level in the bottom, they seem to be masked or
something, i don't see them. And for the up points, i only see half of them when they are
at maximum."

**What it was:** focus mapped 0..1 straight onto 0..canvas height. A point is a dot with a
radius, so a point at 0 was centred on the last row of pixels and half of it fell outside.
The canvas stops above the draw deck, so there was nowhere to overflow into.

**Fixed:** a 10px plot inset, applied through one pair of functions (`_sdFocusY` /
`_sdFocusV`) that every draw site and the hit test now go through. They are exact
inverses, which matters: a mismatch there makes points jump when you click them.

## 4. No Select in FOCUS

**He said:** "i can only move points and add them, but i cannot select multiple points and
move them around."

**Built:** Ctrl+drag opens a marquee, and dragging any selected point moves the whole
selection. Ctrl is the same "select without activating" modifier multi view already uses
for lanes.

**Why not a plain drag:** in focus a plain click IS the add-a-point gesture, and taking
that away would be a worse trade. Same reason a Ctrl+click with no box area is the clear
gesture rather than a plain click.

The offsets are captured at press and the group is clamped as a group, so dragging into an
edge stops the selection there instead of squashing it flat. One undo checkpoint per
gesture. The selection drops on Escape, on focusing another lane, on leaving focus, and on
drawing a new point.

## 5. The MIN/MAX scrub could not reach 100%

**He said:** "when you put the max range very low let's say at 3%, you have to move the
mouse upward multiple times to get back to 100%."

**What it was:** two things at once. The gain was 200px for the full range, so 3% to 100%
needed ~194px in one gesture, and the handler was bound to the canvas element, so the run
ended at the canvas edge.

**Fixed:** the listener moved to the window, the value accumulates per move instead of
measuring from the press point, and it clamps as it goes so overshooting does not wind up
a debt you have to unwind before it moves back. Shift is 4x finer for the last percent.

---

## Not in this batch

From his FIRST mail, and not repeated in the second, so treated as still open rather than
silently dropped:

- **Ramp up / ramp down** motions are missing from the shape set
- **A tilt tool**: move the top and bottom points from a start value to an end value
  across the curve (his postimg example)
- **Intensity and cycles over time**: an LFO that starts at 0 and speeds up or intensifies
  across the bar, like the Midi sketch video he linked at 1:10

The third is the biggest of the three and the most interesting: it is a per-lane envelope
over the modulation depth and rate, not a new shape.
