# StrideLink Push support — implementation spec (Route A)

Goal: make the StrideQuick action buttons (Chaos, Neuro, Reflector, S&H, Prism, Lock, Unlock, Inject, loop sizes) triggerable from Ableton Push, native and shipped inside StrideLink, with no automation dots in normal use. Companion to the analysis in `docs/stridelink-push-mapping-research.md`.

Date: 2026-06-18. Status: spec only, nothing built.

---

## The prerequisite nobody can skip

The current StrideQuick buttons are `textbutton` with `parameter_enable: 0`. They are **not parameters**, so they are mappable to Push by **nothing** — not Push's Configure mode, not MAP8, not Push Hacker, not any third-party tool. Every one of those maps *parameters*.

So step 1 for ANY Push path (native or third-party) is the same: **expose each action as a parameter.** Once that's done, Push's own banking handles the rest and no extra device is needed. This is why "just use a quick-conversion device" doesn't work on its own, there's nothing for them to grab yet.

## Build (Route A)

### 1. One `live.button` per action — the Push-mappable trigger
For each action, add a `live.button` in the patch (it can live off-screen; it's a trigger, not part of the panel UI, so the StrideQuick look is untouched). Inspector:
- **Parameter Mode Enable: ON**
- **Scripting Name:** `sd_chaos`, `sd_neuro`, `sd_reflector`, `sd_sh`, `sd_prism`, `sd_lock`, `sd_unlock`, `sd_inject`, `sd_loop4` … (unique, no spaces)
- **Long / Short Name:** "Chaos", "Neuro", … (this is the label Push shows)
- **Parameter Visibility: "Automated and Stored"** (mandatory, "Stored Only" / "Hidden" are invisible to Push)

### 2. Wire each `live.button` to the action it already triggers
The `live.button`'s left outlet → the SAME `quick <action>` message box the matching `textbutton` already feeds → `node.script`. Now a Push press and an on-screen click fire the identical path. Nothing in canvas.js / server.js / the WS changes; the buttons just gain a second trigger source.

### 3. The Push button-state reset (the one quirk)
Push doesn't clear a button parameter's state after a press, so without a reset the 2nd press registers no change and won't re-fire. Per button:
```
live.button ─► [sel 1] ─► (a) bang the "quick <action>" message
                       └► [delay 80] ─► [0(  ─► back into live.button   (reset to 0)
```
`[sel 1]` reacts only to the pressed (1) state, so the reset's 0 doesn't re-trigger. (Documented Push behavior, see the ScruffyFox guide in the research doc.)

### 4. One `[live.banks]` for the banking
Add a single `[live.banks]` object floating in the patch (no patch cords needed). Double-click → editor → add the action params → arrange into banks of 8 (Push shows 8 at a time):
- **Bank 1** (most-reached): Chaos · Neuro · Reflector · S&H · Prism · Inject · Lock · Unlock
- **Bank 2**: loop 4 · loop 8 · loop 16 · loop 32 · Rescan · (spare)

Without `live.banks` Push shows params in raw inspector order; `live.banks` gives you deliberate control.

### 5. Where they land on Push
Push's 8 buttons above the display map to on/off params, which is exactly what these momentary `live.button`s are. The encoders are for continuous values (none here). So selecting StrideLink on Push (2 or 3) puts the actions on those buttons, banked as above.

## The automation-dot reality (the whole point)
These params are "Automated and Stored", so they are technically automatable, they show up in Live's automation chooser and MIDI-map list. **But the red dot only appears when a parameter actually has recorded automation**, and a momentary action button never accrues any unless you record-arm and deliberately press it. So in real use: **no dots.** That's the difference from the moving/scanned counter, whose value changed continuously and got captured during playback. If you ever need literal zero-parameter footprint (nothing automatable at all), that's Route B (`grab_control`) in the research doc, a bigger, Push-specific build.

## The "quick conversion" devices you heard about — what they actually are
- **Push Configure mode** (built in), **MAP8 / MultiMap**, **Push 3 Control Master** (Isotonik, free): make mapping params to Push *fast*, but they map PARAMETERS, so they still need step 1 (exposed `live.button` params) first. Conveniences on top of Route A, not a way around it, and they don't change the automatable reality.
- **Push Hacker 2** (Soundmanufacture), **ClyphX Pro**: control-surface-level remappers that can bind Push controls to actions (potentially parameter-free), more powerful, but PAID third-party devices each customer would have to own. Not shippable inside StrideLink.

Bottom line: there is no device that turns StrideLink's `textbutton`s into Push controls without first exposing parameters. The quick path IS Route A, and shipping it in StrideLink means every customer gets Push support with zero extra purchases.

## Effort & ship
~half a day: add ~12 `live.button`s, wire each to its existing `quick <action>` message, the small reset patch per button, one `live.banks`, set names + visibility. No canvas/server/WS changes. Then the usual: re-copy `User Library/Stride/StrideLink.amxd` → repo, rebuild, tag.

## Open questions for the build
- Which actions make Bank 1 vs Bank 2 (the 8 + the rest)?
- Loop sizes as 4 separate `live.button`s, or one `live.tab` (radio) param? (tab is cleaner on Push but maps as a stepped value, not buttons.)
- Do we want the StrideQuick on-screen buttons to visually reflect a Push press (light up)? Optional polish, the `live.button` value could drive the textbutton's state.
