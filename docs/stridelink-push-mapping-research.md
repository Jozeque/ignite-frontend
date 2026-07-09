# StrideLink → Ableton Push mapping (research)

**Question:** make StrideLink's StrideQuick buttons (Chaos, Neuro, Reflector, S&H, Prism, Lock, Unlock, Inject, loop) triggerable from Ableton Push, WITHOUT the controls becoming automatable parameters that add the red "automation dots", the way the moving/scanned counter numbers stay clean (they're non-parameter displays).

Date: 2026-06-18. Status: research only, nothing built.

---

## 1. The core tension (verified)

Push only maps device **parameters**, and a Max for Live control is only visible to Push when its **Parameter Visibility = "Automated and Stored"**. Controls set to "Stored Only" or "Hidden" are invisible to Push.

"Automated and Stored" is, by definition, the automatable state. So:

> **Push-mappable ⟺ automatable.** A control cannot be both Push-mappable AND a pure non-parameter display (like the counter). They are mutually exclusive in Live's parameter system.

That's why the counter is dot-free: we made it a non-parameter, which is exactly what makes it NOT Push-mappable. You can't get both from the same object the simple way.

## 2. The key nuance — automation DOTS are not the same as "automatable"

The red automation dot appears **only when a parameter actually has recorded automation on it**. A parameter that is merely automatable ("Automated and Stored") but carries no automation shows **no dot** — it just shows its current value.

Why the counter got dots and a button won't:
- The **counter** is a continuously-changing VALUE. With automation-arm on during playback, Live captured those constant changes into an automation lane → dots.
- A **StrideQuick button** is a momentary ACTION trigger. It doesn't change on its own, so there's nothing to capture → no automation accrues → no dots, even though the button is technically automatable.

This nuance is what makes the pragmatic route (below) actually clean in practice.

## 3. The routes

### Route A — live.button + live.banks, "Automated and Stored"  (PRAGMATIC, recommended start)
Convert each StrideQuick `textbutton` to a `live.button` in parameter mode, give it a Scripting Name, set Parameter Visibility = "Automated and Stored", and add them all to a `[live.banks]` object (which controls which 8 land on Push and in what order). The button's bang still fires the same `quick <action>` message, so none of the WS/canvas logic changes.

- **Push UX:** native. Select StrideLink on Push → the buttons are right there on the encoders/buttons, banked.
- **Dots:** none in normal use (action buttons don't auto-record; the dot needs real automation). The only way to get a dot is to press a button while automation-recording is armed, which isn't how you'd use it.
- **Push button quirk:** Push doesn't clear a button's state cleanly, so add a small delay+reset (force the `live.button` back to 0 after each press) or it won't re-trigger. Known, well-documented.
- **Pros:** simplest (an afternoon), native Push experience, works on Push 2 / 3 / 3-standalone, future controllers too.
- **Cons:** the controls are technically automatable, so they DO appear in Live's automation chooser and MIDI-map list (unlike the counter). Cosmetically "automatable", just no visible dots.

### Route B — grab_control / ControlSurface LOM API  (TRULY dot-free, the literal ask)
A device can take over individual Push controls via the **ControlSurface LOM API**: enumerate the control surface, `grab_control` a specific pad/button, and Live forwards that control's MIDI (press/release) straight to the device. You observe the control's `value` and fire `quick <action>`. **No parameters are created at all.**

- **Push UX:** the grabbed pads/buttons trigger Stride directly.
- **Dots:** none, ever. There are zero parameters, so nothing is automatable, identical to how the counter stays clean.
- **Pros:** this is the exact thing the user asked for, Push control with no parameter/automation footprint whatsoever.
- **Cons:** real engineering. LOM ControlSurface scripting in the device; Push-version-specific control names (Push 2's `X_Clip_Y_Button` etc. differ from Push 3); grabbing is exclusive (that pad stops doing its normal Push job until released, so you need grab-on-focus / release logic); community reports it's finicky about where MIDI lands. Push-only (not generic MIDI controllers). Bigger build, closer to StrideInject in scope.

### Route C — Push User Mode + MIDI  (not recommended)
Put Push in User Mode (raw MIDI), route that MIDI to a device that listens and fires actions. Bypasses parameters, but User Mode replaces the normal device-control layout, the routing is awkward, and User-Mode buttons send fixed values. Clunky vs A or B.

### Route D — custom Push Remote Script (Python control surface)  (overkill)
A full Remote Script like StrideInject that maps Push to Stride. Most powerful, most work. Only worth it if Push integration becomes a headline feature with deep custom layouts.

## 4. Recommendation

1. **Start with Route A.** A handful of `live.button`s + one `[live.banks]`, "Automated and Stored", plus the delay/reset for the Push button quirk. You get real Push control fast, and because these are action triggers, no dots show up in normal use. Tell the user the one honest caveat: the buttons will be listed as automatable (just never dotted).
2. **If you specifically want zero parameter footprint** (truly identical to the counter, nothing automatable at all), that's **Route B (grab_control)** — a proper build, Push-version-specific, but it's the only route that literally creates no parameters. Write a full implementation spec before committing.

So: the thing the user described ("mappable to Push without automation dots, like the counter") is *only* achievable in the strict sense via grab_control (Route B). Route A gets 95% of the benefit for ~5% of the effort, with the dots never actually appearing for action buttons.

## Sources
- [Device Parameters in Max for Live (Cycling '74)](https://docs.cycling74.com/userguide/m4l/live_parameters/)
- [How to Make Parameters in Max for Live Devices Mappable (Sonic Bloom)](https://sonicbloom.net/how-to-make-parameters-in-max-for-live-devices-mappable/)
- [How to add basic Push support to any Max4Live device (ScruffyFox)](https://medium.com/@ScruffyFox/how-to-add-basic-push-support-to-any-max4live-device-78c9c57c7f7b)
- [Max for Live Devices on Push 3 standalone (Ableton)](https://help.ableton.com/hc/en-us/articles/8506527153308-Push-standalone-Max-for-Live-Device-compatibility)
- [ControlSurface — Live Object Model (Cycling '74)](https://docs.cycling74.com/apiref/lom/controlsurface/)
- [Working with Automation and Modulation (Ableton)](https://help.ableton.com/hc/en-us/articles/209070629-Working-with-Automation-and-Modulation)
