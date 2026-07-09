# How the Stride reel + commercial were made

A reproducible, forward-able breakdown of the hand-coded product-simulation reel
(the "3D" Stride workflow animation) and the capture + caption pipeline that
turned it into the MP4 used in the June commercial.

The short version: it is not 3D and not After Effects. It is one self-contained
HTML file drawing on a 2D `<canvas>` with vanilla JavaScript, recorded out of
headless Chrome, then encoded and captioned with ffmpeg + a speech-to-text pass.

---

## File inventory (where everything lives)

**The reel source (the animation itself)**
- `docs/stride-inject-reel.html` — the master reel. 489 lines, self-contained, no libraries.
- `docs/stride-logo.png`, `docs/ableton-ui.png` — the two image assets it loads (end-card logo + blurred backdrop).
- Sibling reels on the same engine: `docs/stride-modulate-everything.html`, `docs/stride-inject-motion.html`.

**The capture + caption pipeline** — `C:\Users\Yossi\reel-capture\`
- `capture.js` — records `stride-inject-reel.html` to `reel.webm` (hard-wired).
- `capture_any.js` — generalized recorder: `node capture_any.js <page.html> <durationMs> <outName>`.
- `shot.js` — grabs still frames at given t-seconds (thumbnails / frame checks).
- `transcribe.py` — faster-whisper, audio to word-level timestamps (`words.json`).
- `build_ass.py` — turns `words.json` into a styled `.ass` subtitle file.
- `package.json` — only dep is `puppeteer-core` ^25.1.0.
- Intermediates produced along the way: `reel.webm`, `hook_audio.wav`, `words.json`, `captions.ass`.

**Outputs**
- `D:\Stridehub content\June New Commercial\stride-reel.mp4` — the canvas reel as MP4 (the clip dropped into the commercial edit).
- `D:\Stridehub content\June New Commercial\Finals\Hook 2 Final - Captions.mp4` — the finished, captioned commercial.

---

## Part 1 — the animation engine (`stride-inject-reel.html`)

The cinematic feel is faked entirely with 2D canvas tricks. The real skill here
is animation timing, not the tooling.

**Canvas + resolution**
- Fixed virtual frame `VW=1080, VH=1920` (9:16). Everything is authored in those
  coordinates, then scaled by `Sv = W/VW` and `DPR`, so it is resolution independent.
- Two canvases: an offscreen world canvas (`oc`/`octx`) and the onscreen output
  (`cv`/`ctxMain`). A single `ctx` pointer is swapped between them. The world is
  drawn offscreen, then composited onto the screen (that is what enables motion blur).

**The virtual camera (the "3D" feeling)**
- `CAM[]` is a list of keyframes `{t, x, y, z, e}`: a look-at point (x, y), a zoom
  (z), and an easing name (e).
- `camAt(t)` finds the two keyframes bracketing the current time and interpolates
  between them with the named easing.
- `renderWorld(t)` applies the camera as a transform: translate to screen center,
  `scale(cam.z)`, translate by `-cam.x, -cam.y`. Every shape is then drawn in world
  space and the camera does the rest.
- Easing library `E`: `io` (in-out cubic, for whip-pans), `out`/`in` (cubic),
  `expoIn` (for crash-zooms), `back` (overshoot/settle), `smooth` (smoothstep).
  The crash-zoom into a lane uses `expoIn`; the punch onto the INJECT button uses
  `back` so it overshoots and settles.

**Motion blur (this is ~80% of the expensive look)**
- In `composite()`, instead of drawing the world once, it stamps the offscreen
  world `n=7` times at `globalAlpha = 1/n`.
- Each copy is scaled by `1 + zb*f` (a zoom blur) and offset by `px, py` (a
  directional pan smear), where `f` walks from -0.5 to +0.5 across the 7 copies.
- `zb`, `px`, `py` come from camera velocity: `frame()` samples the camera at `t`
  and at `t - dt`, and the faster it moved, the bigger the blur. Fast zoom gives a
  zoom-blur, fast pan gives a directional smear.
- When motion is below a small threshold it short-circuits to a single clean
  `drawImage` (no blur), so static held shots stay crisp.

**Everything is procedural (math, not assets)**
- The automation curves are functions of x: `patSH` (a hashed 8-step sample-and-hold),
  `patChaos` (summed sines at different rates), `reflectSource`/`reflector` (mirror
  pairs where odd lanes are the vertical inverse of even lanes).
- A real `Mutate` is implemented (`rng32` seeded PRNG, `buildMutatePlan`): it chops
  the curve into 3 to 6 chunks, shuffles their order, and per chunk applies flip
  (reverse time), mirror (invert value), amplitude scale/shift, and time warp. This
  mirrors the actual `sdMutate` tool in the product. It is rendered as a left to
  right "wipe" with a glowing scan-line head, so you watch the curve get rewritten.
- The Ableton UI is procedural too: `drawSessionBG` (the track grid behind), 
  `drawColumn` (the clip column, mixer, fader, sends, S/arm), and `drawTimeline`
  (a 14-lane arrangement cutaway showing the injected automation). On top of that a
  real Ableton screenshot (`ableton-ui.png`) is blurred 5px and drawn at 0.62 alpha
  as the backdrop for depth.

**The finishing layers (cheap, high impact)**
- Glow: `ctx.shadowBlur` + `ctx.shadowColor`, nothing more.
- Cables: cubic bezier paths (`bez`) with a glow pass and traveling white dots.
- Grain: a 150x150 noise tile generated once, drawn as a repeating pattern at low alpha.
- Vignette: radial-gradient overlays darkening the edges.
- Mood glow: four colored radial blobs slowly drifting, drawn in `lighter` composite mode.
- The mouse cursor is a hand-drawn polygon that eases from off-target onto each real
  button rect, with a click ring and a scale-pop on press.

**Timing / storyboard**
- `ACTS[]` defines 3 scenarios (Sample & Hold, Chaos LFO, Reflector). Each has a
  start time `t0` and a window map (`RELD`/`RELS`) naming sub-beats: pick, draw,
  track, press, fire, land. Every visual keys off the global clock `t`, so the
  camera, cursor, curves, cables, and overlays all stay in sync by construction.
- `SLOW=1.2` slows the whole thing down globally; the loop length is `LOOP=35.5s`;
  a requestAnimationFrame loop drives it; the HUD (pause/restart) is only for previewing.

To author this you need a text editor and a feel for easing. That is it.

---

## Part 2 — capture the canvas to video (`capture.js` -> `reel.webm`)

- A tiny Node `http` server serves the `docs/` folder on `127.0.0.1:8099`. This
  matters: the page must be served over http, not opened as a `file://`, or Chrome
  treats the canvas as tainted (it loaded local PNGs) and refuses `captureStream`.
- `puppeteer-core` launches the real installed Chrome (`headless: 'new'`), viewport
  exactly `1080x1920`, `deviceScaleFactor: 1`. Flags: `--mute-audio`,
  `--autoplay-policy=no-user-gesture-required`, `--hide-scrollbars`, `--no-sandbox`.
- It waits for `document.fonts.ready` plus a 2.5s warmup (so the Outfit font and the
  two PNGs are in before recording, otherwise text reflows mid-take).
- Inside the page: `cv.captureStream(30)` to grab the canvas, then `MediaRecorder`
  with `video/webm;codecs=vp9` (falls back to vp8) at `videoBitsPerSecond: 16000000`.
  It clicks Restart to reset to t=0 first, then records exactly one loop.
- `ondataavailable` chunks are base64'd and shipped to Node over an exposed function,
  concatenated, and written to `reel.webm`. Duration is `40500ms` (one 33s loop x 1.2
  slowdown, plus tail).
- `capture_any.js` is the same thing parameterized, for recording the other reels:
  `node capture_any.js stride-modulate-everything.html 21300 modulate`.

---

## Part 3 — encode to MP4

The captured `.webm` is transcoded to a widely-compatible H.264 MP4. Standard command:

```
ffmpeg -i reel.webm -c:v libx264 -pix_fmt yuv420p -crf 16 -r 30 reel.mp4
```

(`yuv420p` is what makes it play everywhere, including phones and social.)

---

## Part 4 — auto-captions (only if there is a voiceover)

The canvas capture is silent (video only). Captions are generated from whatever
voiceover you lay under the reel in the edit. For the commercial that was the spoken
hook, exported as `hook_audio.wav`.

1. Extract mono 16 kHz audio from the voiceover (whisper likes 16k mono):
   ```
   ffmpeg -i <voiceover>.mp4 -ac 1 -ar 16000 hook_audio.wav
   ```
2. `transcribe.py`: faster-whisper `small.en`, `device="cpu"`, `compute_type="int8"`,
   `word_timestamps=True`, `vad_filter=True`. Writes `words.json` (each word + start/end).
3. `build_ass.py`: groups words into punchy 1 to 2 word chunks (breaking on
   punctuation), forces strict non-overlapping timing, uppercases and strips
   punctuation, and writes a styled `.ass`:
   - Lower-third position `\pos(540,1500)`, fade `\fad(50,50)`.
   - A scale-pop on entry: `\fscx118\fscy118\t(0,90,\fscx100\fscy100)`.
   - Brand-copper accent color on keywords (STRIDE, MUTATE, INFINITE, ENDLESS, WATCH).
   - `CUTOFF=39.0s` so captions stop before the logo end card.
   - Style: Arial Black 72, white fill, dark outline.
4. Burn the subtitles into the video:
   ```
   ffmpeg -i reel.mp4 -vf "ass=captions.ass" -c:v libx264 -pix_fmt yuv420p -crf 16 -c:a copy reel-captioned.mp4
   ```

---

## The full stack to install

- Node.js + `npm i puppeteer-core` (drives the capture).
- Google Chrome (real install; puppeteer-core uses it headless).
- ffmpeg on PATH (`winget install --id Gyan.FFmpeg -e`) for encode + caption burn.
- Python 3 + `pip install faster-whisper` (transcription, runs on CPU).

Skills involved: JavaScript + Canvas 2D (the whole reel), animation/easing intuition
(the real skill), a little Python (transcription + subtitle build), basic ffmpeg and
`.ass` subtitle syntax, comfort on the command line.

---

## Recipe: make a NEW reel on this engine

1. Copy `docs/stride-inject-reel.html` to `docs/<new-reel>.html`.
2. Keep the engine (camera, motion blur, easings, procedural UI, curve generators,
   grain/vignette). Rewrite only the content:
   - `ACTS[]` + the `RELD`/`RELS` window maps for the new beat timing.
   - `CAM[]` keyframes for the new shot list (where to crash-zoom, whip, pull back).
   - the hook text and the logo end card in `overlays()`.
3. Preview in a browser; tune timing against the HUD clock.
4. Record: `node capture_any.js <new-reel>.html <durationMs> <new-reel>` -> `<new-reel>.webm`.
5. Encode: the ffmpeg webm to mp4 command above.
6. Optional captions: lay your voiceover, extract the wav, run `transcribe.py` then
   `build_ass.py`, then burn the `.ass`.

## Gotchas (the ones that cost time)

- Serve over http, never `file://`, or `captureStream` fails on the tainted canvas.
- Wait for `document.fonts.ready` before recording, or the first second has unstyled
  text that reflows.
- Keep `deviceScaleFactor: 1` at native 1080x1920: crisp output without huge files.
- The reel is silent by design; captions come from the voiceover track, not the capture.
- One loop only: the recorder clicks Restart, then records exactly `LOOP x SLOW` plus a
  small tail. If you change `LOOP` or `SLOW` in the HTML, update `DURATION_MS`.
