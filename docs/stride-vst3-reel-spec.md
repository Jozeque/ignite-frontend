# Stride VST3-Host Reel — approach (technical + creative)

Goal: a reel in the vibe of the winning "fresh creative" (`D:/Stridehub content/fresh creative/final renders/final with subs.mp4`) but for the NEW flow: **Stride hosts your VST3 plugins (a synth like Serum, effects like Valhalla) and modulates every one of THEIR parameters live, right in Ableton. No injection, no triggers, no bouncing.** It modulates the actual VST3 instruments/effects, not Ableton stock devices. Show the REAL plugins, not simulations.

Copy rules: no AI mentions, sound design first, producer language, no em dashes, "sound design engine".

---

## Why this is a strong creative

The hero visual writes itself: **the real Serum (or Valhalla) knobs dancing in real time, driven by Stride's curves, side by side.** That single shot proves three things at once, live and un-fakeable: it's real (that's the actual Serum UI every producer knows, not a mockup), it's live (curve moves, knob moves, same instant), and it's simple (your VST3 chain hosted in one window). Bonus: Serum / Valhalla are instantly recognizable, so the credibility lands in half a second. The old inject-to-clip flow could never show this, the knobs only moved after you injected. This one moves while you watch. That's the whole ad.

---

## Creative concept (~45-55s, reference vibe)

Same DNA that converted: command hook -> "now watch this" -> reveal -> let the real result breathe -> CTA + code. Talking-head bottom-split hook, centered animated captions (Arial Black, copper accents), dark cinematic, REKZ end card.

| Beat | ~time | On screen | VO |
|------|-------|-----------|-----|
| HOOK | 0:00-0:05 | you to camera (bottom-split with a quick shot of mapping LFOs one plugin at a time) | "You map an LFO to your synth. Then your reverb. Then your delay. There's a better way. Now watch this." |
| REVEAL | 0:05-0:11 | real Stride window: load Serum + Valhalla inside it | "This is Stride. Drop Serum, drop Valhalla, drop any VST3 right inside it." |
| THE WOW | 0:11-0:30 | **split screen: the real Serum / Valhalla knobs dancing (top) + Stride curves (bottom), perfectly synced**, sound evolving, minimal VO | "And every knob moves. Live." then let the sound carry |
| BENEFIT | 0:30-0:36 | keep the split running | "Your whole chain, breathing. It all speaks to Ableton in real time. No injecting, no triggers." |
| CTA | 0:36-0:42 | logo + code card | "Stride. A sound design engine for Ableton. Use code REKZ for twenty percent off." |

Hook angle options (pick one to A/B): (a) **tedium** = "map an LFO to your synth, then your reverb, then your delay" (mirrors the winning "stop routing LFOs"); (b) **power** = "what if your whole chain could move at once"; (c) **simplicity** = "no injecting, no triggers, no bouncing, just modulation".

The demo section (0:11-0:36) is the whole point: it must be the real split-screen, running long enough to feel alive. Front-load the VO, then shut up and let the knobs + sound do it, exactly like the winner's silent stretch.

---

## Technical: recording (the crux)

The modulation and the knob movement MUST be frame-synced in the reel (curve moves = knob moves, same frame). That one requirement drives everything.

### Recommendation: ONE OBS file, not two

Do NOT record two separate files. Two files = two clocks = sync drift + a painful manual alignment, and any dropped frame on one side desyncs the whole ad. Instead:

- **One OBS scene, two capture sources**: a Window/Display Capture of the **Stride window** (left monitor) + a Window/Display Capture of your **open VST3 plugin windows** (Serum, Valhalla, etc.) on the right monitor, composed into one canvas. One recording = one clock = perfect sync, automatically.
- **Canvas**: for quality + flexibility, record a big full-res canvas and let me crop in post. Two clean ways:
  - Stacked: canvas `1920x2160`, the VST3 plugin windows top (1920x1080), Stride bottom (1920x1080).
  - Side by side: canvas `3840x1080`, Stride left, the VST3 windows right.
  - Either is fine, I crop the exact regions and compose the 9:16 reel. (You could also compose straight into a `1080x1920` canvas in OBS, but that bakes the crop and loses flexibility, prefer full-res.)
- **Settings**: 60fps (smooth knob motion is the appeal), high bitrate (CQP ~16-18 / 40-60 Mbps), and record the **audio** (the modulated sound is the proof and the payoff).

### If two files are truly unavoidable
Record both outputs from the SAME OBS instance so they share a start, and do a hard **sync marker** at frame one: one sharp action visible on BOTH screens at the same instant (e.g., toggle Stride's modulation on, which jumps the curve AND the knob together) or a literal clap into the mic. I align by that marker. Still worse than one file, only do this if forced.

### Framing / capture tips
- **Zoom the VST3 plugin windows (Serum, Valhalla) so their knobs/sliders are BIG and readable** — the moving controls are the hero, they can't be tiny. Serum reads especially well (its macro/mod knobs move, and its oscilloscope/waveform reacts live, very cinematic).
- Frame the Stride window on the modulation view (the curves) so it reads.
- Capture these moments (60-90s of material to cut from): (1) loading Serum + Valhalla into Stride (shows the "host" idea), (2) modulation running with lots of plugin knobs dancing, (3) one big evolving passage where the sound clearly transforms.
- Assign MANY of the plugin parameters in Stride so lots of Serum/Valhalla knobs move at once, that's what makes "the whole chain breathing" read instantly.

---

## Technical: reel composition (post, I build it)

Reuse the reel pipeline. 9:16 frame:
- **Top: the VST3 plugins** (Serum, Valhalla, knobs dancing), cropped from the capture. The wow goes up top.
- **Bottom: the Stride window** (the curves driving it), cropped from the capture.
- Blurred backdrop, brand wordmark, centered animated captions (same style as the winner), copper accents, REKZ end card.
- The talking-head hook (shot separately, phone/webcam, like the reference) bookends it.
- Split stays on screen together through the demo so the viewer SEES curve-and-knob move on the same frame. That simultaneity is the proof, never cut away from it during the wow.

---

## Decisions before you record
1. **Layout**: VSTs top + Stride bottom (my rec, puts the dancing knobs up top, mirrors the series), or Stride on top?
2. **Talking-head hook**: shoot one like the winner, or open straight on the real split-screen (sound-led)?
3. **Hook angle**: tedium / power / simplicity (see options above).
4. **Which devices** to host in the demo (a recognizable synth like Serum + a couple of obvious FX reads best).
