# Stride — MIDI Pattern Library

**Status:** Spec (pre-implementation)
**Author:** CTO/PM session, 2026-05-27
**Targets:** Stride v1.2 (Electron VST app)
**Supersedes:** `project_cloud_gen_spec.md` (memory) — the cloud-Gemini path is shelved in favor of a curated bundled library.

---

## 1. Goal

Ship a **curated MIDI Pattern Library** inside the Stride canvas — a growing collection of hand-picked patterns (target: 1,000 in v1.2, growing every release) that users can browse, audition, and inject into their .alc output alongside their drawn automation curves.

**Why this and not cloud generation:**
- Zero per-call cost → no separate billing layer to build
- No AI/LLM/Gemini in the product story → matches brand DNA
- Producer trusts Yossi's taste more than a black box generator
- Auditioning a real curated pattern is faster + higher-quality than waiting 30-90s for Gemini
- Offline by default — works without internet, no Firebase dependency

**Non-goals (v1.2):**
- "Try in Live" audition (auditioning through user's own rack via WS) — deferred to v1.3
- Cloud generation — shelved
- Local ML training — deferred (until corpus is large + curated)
- Stems / multi-track patterns — single MIDI clip only
- Marketplace integration (paid `.stridepack` browsing) — separate roadmap

---

## 2. User flow

### 2.1 Happy path

```
[User has rack + template, curves drawn on canvas, 8 bars selected]
        ↓
Click PATTERNS button (top-left of toolbar)
        ↓
[Overlay slides in from left, covers ~92% of window]
[Canvas peek strip visible on right edge — faded snapshot]
        ↓
Filters auto-set to "Fits 8 bars" (matches canvas)
        ↓
Browse grid → click pattern card → preview pane fills on right
        ↓
Click ▶ in preview pane → Tone.js plays pattern audibly
        ↓
Click "Pick Pattern" → overlay slides out, canvas returns
[Armed chip appears above Apply to Clip: "🎵 Acid Roller 01 · F min · 4 bars · ×"]
        ↓
Click Apply to Clip
        ↓
[.alc written to ~/Desktop/Stride/ with BOTH curves AND notes from picked pattern]
        ↓
User drags .alc back into Ableton — clip has notes + automation, plays immediately
```

### 2.2 Skip path (existing users keep working unchanged)

```
[User does the curves-only flow they already know]
        ↓
Never opens PATTERNS button
        ↓
Apply to Clip → .alc has curves only (just like today, no behavior change)
```

**Critical guarantee:** The existing curves-only flow is byte-for-byte identical when no pattern is armed. The PATTERNS button is purely additive.

### 2.3 Escape paths from the overlay

Three ways to dismiss the library:
1. Click anywhere on the **canvas peek strip** (right edge)
2. Press **ESC**
3. Press **L** (same hotkey that opened it)

When dismissed:
- Canvas state untouched (curves, lanes, bar count, undo stack — all preserved)
- Armed pattern persists IF user picked one; cleared if they didn't pick
- Filter state, scroll position, last-selected pattern persist within session
- Tone.js playback stops

### 2.4 Bar-mismatch handling

The library default-filters to "Fits {canvas bars}". A pattern "fits N bars" if:
- Pattern length ≤ N AND N is a multiple of pattern length (so it can loop), OR
- Pattern length === N exactly

Examples:
- Canvas = 8 bars: shows patterns of 1, 2, 4, 8 bars (1, 2, 4 will loop)
- Canvas = 16 bars: shows patterns of 1, 2, 4, 8, 16 bars
- Canvas = 8 bars, user toggles "All bars": 16+ bar patterns show with a length badge. Picking one triggers confirm modal: "This pattern is 16 bars. Switch canvas to 16 bars?" → on yes, bumps `sdBars`, redraws canvas. Canvas curves get padded with empty space (no stretching).

**Looping logic on inject:** When pattern length < canvas length, the .alc injector repeats the notes to fill the clip. e.g., 4-bar pattern on 8-bar clip = pattern injected twice (offset 0, offset 4).

**No stretching ever.** Curves stay time-locked. Pattern notes stay rhythmically intact.

---

## 3. Data model

### 3.1 Manifest schema

`stride-vst/app/assets/patterns/manifest.json`:

```json
{
  "version": 1,
  "patterns": [
    {
      "id": "bass_acid_fmin_4_001",
      "name": "Acid Roller 01",
      "file": "bass/acid_roller_01.mid",
      "category": "bass",
      "style": ["acid", "techno"],
      "key": "F min",
      "bpm": 120,
      "bars": 4,
      "note_count": 32,
      "energy": 3,
      "complexity": 2,
      "tags": ["303", "rolling", "dark"],
      "added_in": "v1.2.0"
    }
  ]
}
```

**Required fields:** `id`, `name`, `file`, `category`, `key`, `bpm`, `bars`, `note_count`
**Optional fields:** `style`, `energy`, `complexity`, `tags`, `added_in`

**ID convention:** `{category}_{style}_{key}_{bars}_{NNN}` — stable, human-readable, never reused.

### 3.2 Pattern categories (locked v1.2)

Pinned controlled vocabulary — adding requires a code release because filter UI references these:

- `bass`
- `leads`
- `chords`
- `melodic`  (general melodic loops / arpeggios)
- `drums`
- `ambient`
- `sequences` (rhythmic phrases, FX patterns)

### 3.3 Style tags (controlled vocabulary)

~20 styles, alphabetized:
`acid, ambient, breaks, downtempo, drumandbass, dub, electronica, experimental, garage, house, idm, neosoul, psy, techno, trance, trap, world, jungle, deep, glitch`

Tags (the freeform `tags` array) are NOT controlled — Yossi can write anything.

### 3.4 Key field convention

Format: `<root> <quality>` where root is one of `C C# D D# E F F# G G# A A# B` and quality is `min|maj|dor|phr|lyd|mix|loc|harm|mel`.
Examples: `F min`, `A maj`, `C# phr`, `D harm`.

Parser must be tolerant: also accept lowercase, flat notation (`Bb` → `A#`), and unicode flat/sharp characters.

### 3.5 Armed-pattern state (in canvas.js)

```js
let sdArmedPattern = null;
// When set:
// {
//   id: "bass_acid_fmin_4_001",
//   name: "Acid Roller 01",
//   bars: 4,
//   notes: [{pitch: 36, time: 0, duration: 0.0625, velocity: 127}, ...]
// }
```

`notes` is pre-parsed from .mid at pick time so injection is fast at Apply time. Cleared when user clicks the × on the chip.

### 3.6 Persistence shape (settings.json additions)

```json
{
  "pattern_favorites": ["bass_acid_fmin_4_001", "leads_psy_amin_8_007"],
  "pattern_recent": [
    {"id": "bass_acid_fmin_4_001", "used_at": 1716800000000}
  ],
  "library_filters_last": {
    "bars": "auto",
    "style": "all",
    "key": "all"
  }
}
```

`pattern_recent` capped at 20 entries, MRU order.

---

## 4. File layout

```
stride-vst/app/assets/patterns/
  manifest.json                            ← single index
  bass/
    acid_roller_01.mid                     (~1 KB each)
    psy_bass_growl_02.mid
    ...
  leads/
  chords/
  melodic/
  drums/
  ambient/
  sequences/
```

**Bundle size budget:** 1,000 patterns × ~1 KB = 1 MB. Manifest ~80 KB. Tone.js ~250 KB minified. Total feature adds ~1.3 MB to install. Acceptable (Stride install is currently ~150 MB).

---

## 5. UI components

### 5.1 PATTERNS button (top toolbar)

**Placement:** `index.html` top bar (around line 130), inserted after the Stride logo, before the flex-1 spacer.

**Visual:**
```
[ STRIDE ]  [ ♫ PATTERNS ]  <flex-spacer>  [...other buttons...]
```

- Tailwind classes: `titlebar-no-drag text-[9px] text-zinc-500 hover:text-orange-400 uppercase font-bold tracking-widest transition-colors mr-3`
- Icon: stacked-bars or note glyph (Heroicons `MusicalNote` outline) — inline SVG, 12×12
- Active state when overlay is open: text color → `text-orange-400`, bg → subtle orange tint

**Hotkey:** `L` (single key, no modifier) when no input has focus. ESC also closes.

### 5.2 Overlay shell

**Element ID:** `sd-pattern-library-overlay`
**Z-index:** `z-[8500]` (above generate panel `8000`, below activation `9999`)

**Layout:**
- Position: `fixed inset-0`
- Width: 100vw, but content takes 100vw − 80px (the right 80px is the canvas peek strip — overlay's background is transparent over that strip; canvas underneath shows through at 30% opacity)
- Background: `rgba(9,9,11,0.97)` with `backdrop-blur-sm`

**Inner grid** (within the 100vw − 80px area):
```
┌──────────────┬─────────────────────────────────────────┐
│  HEADER (h-12): [logo] PATTERNS  [search]  [pick CTA]  │
├──────────────┼─────────────────────────────────────────┤
│              │  FILTERS BAR (h-10):                    │
│ CATEGORIES   │  Bars(8) Key Style Bpm Energy           │
│ (left rail   ├─────────────────────────────────────────┤
│ ~200px)      │  GRID (flex-1):                         │
│              │  ┌────┐┌────┐┌────┐┌────┐               │
│              │  │card││card││card││card│               │
│ ▸ Bass       │  └────┘└────┘└────┘└────┘               │
│ ▸ Leads      │  ...                                    │
│ ▸ Chords     │                                         │
│ ▸ Melodic    │              PREVIEW PANE               │
│ ▸ Drums      │              (right ~340px)             │
│ ▸ Ambient    │              ─────────────              │
│ ▸ Sequences  │              [piano roll svg]           │
│              │              Acid Roller 01             │
│ ★ Favorites  │              F min · 120 · 4 bars       │
│ ◷ Recent     │              [▶] [Pick Pattern]         │
└──────────────┴─────────────────────────────────────────┘
```

### 5.3 Canvas peek strip

**Element ID:** `sd-canvas-peek`
**Width:** 80px on right edge
**Behavior:**
- Renders a snapshot of the canvas at 30% opacity (using `html2canvas` OR — preferred — keeping the existing canvas DOM visible by leaving the overlay container transparent at that strip)
- Hover: opacity → 60%, cursor: pointer, fade-in caption `"← Back"` rotated 90deg
- Click anywhere in strip: dismisses overlay

**Implementation simplicity decision:** Don't snapshot. Just make the overlay 100vw − 80px wide and leave the rightmost 80px naturally showing the canvas (with a semi-transparent dark veil on top to indicate "not active"). Click handler attached to that veil strip.

### 5.4 Pattern card

```
┌──────────────────────────┐
│  Acid Roller 01      ★   │  ← name + favorite toggle
│  ────────────────────    │  ← mini piano roll SVG (60×40px)
│   ▄▄  ▄  ▄▄  ▄  ▄▄▄      │
│  ────────────────────    │
│  F min · 120 · 4 bars    │  ← metadata row
└──────────────────────────┘
```

- Click → selects (preview pane fills)
- Double-click → picks (same as clicking Pick Pattern, fast path)
- Star → toggles favorite (saved to settings.json)
- Hover: subtle border glow in orange

### 5.5 Preview pane

```
┌────────────────────────────────┐
│  Acid Roller 01           ★    │
│  F min · 120 BPM · 4 bars      │
│  Style: acid, techno           │
│  Tags: 303, rolling, dark      │
│                                │
│  ┌──────────────────────────┐  │  ← full piano roll
│  │                          │  │     (200px tall, full width)
│  │   ▄    ▄  ▄▄             │  │
│  │  ▄▄▄  ▄▄▄ ▄▄▄ ▄          │  │
│  │ ▄    ▄    ▄   ▄▄         │  │
│  └──────────────────────────┘  │
│                                │
│  ┌──────────┐  ┌────────────┐  │
│  │ ▶ Play   │  │ Pick       │  │
│  └──────────┘  └────────────┘  │
└────────────────────────────────┘
```

### 5.6 Armed-pattern chip (canvas toolbar)

Appears above/near Apply to Clip button when `sdArmedPattern !== null`:

```
🎵 Acid Roller 01 · F min · 4 bars  ×
```

Click × → clears `sdArmedPattern` → chip disappears.

---

## 6. .alc note injection

### 6.1 The XML structure to write

Inside the existing template .alc, the `<MidiClip>` element contains:

```xml
<MidiClip Id="0" Time="0">
  <CurrentStart Value="0" />
  <CurrentEnd Value="16" />
  ...
  <Notes>
    <KeyTracks>
      <KeyTrack Id="1">
        <Notes>
          <MidiNoteEvent Time="0" Duration="0.5" Velocity="100" OffVelocity="64" NoteId="1" />
          <MidiNoteEvent Time="1" Duration="0.5" Velocity="100" OffVelocity="64" NoteId="2" />
        </Notes>
        <MidiKey Value="36" />     ← MIDI pitch number (0-127)
      </KeyTrack>
      <KeyTrack Id="2">
        <Notes>
          <MidiNoteEvent Time="0.5" Duration="0.25" Velocity="80" OffVelocity="64" NoteId="3" />
        </Notes>
        <MidiKey Value="48" />
      </KeyTrack>
    </KeyTracks>
    <PerNoteEventStore><EventLists /></PerNoteEventStore>
    <NoteProbabilityGroups />
    <ProbabilityGroupIdGenerator><NextId Value="1" /></ProbabilityGroupIdGenerator>
    <NoteIdGenerator><NextId Value="4" /></NoteIdGenerator>
  </Notes>
</MidiClip>
```

**Time units:** beats (1.0 = quarter note). Decimal precision is used liberally — e.g. `0.333333333333333315` for triplet timing.

**Velocity:** 0-127 integer.

### 6.2 Injector function — new in `alc-injector.js`

Add an exported function:

```js
function injectMidiNotes(doc, root, notes, clipBeats) {
    // notes: [{pitch, time, duration, velocity}], time/duration in beats
    // clipBeats: total clip length in beats (clip_bars × 4)

    const midiClip = findDescendant(root, 'MidiClip');
    if (!midiClip) throw new Error('No MidiClip element — template is not a MIDI clip');

    const notesContainer = findChild(midiClip, 'Notes');
    if (!notesContainer) throw new Error('MidiClip has no Notes container');

    const keyTracks = findChild(notesContainer, 'KeyTracks');
    if (!keyTracks) throw new Error('Notes container has no KeyTracks');

    // 1. Wipe existing KeyTracks
    while (keyTracks.firstChild) keyTracks.removeChild(keyTracks.firstChild);

    // 2. Group notes by pitch
    const byPitch = {};
    let nextNoteId = 1;
    for (const n of notes) {
        if (n.time >= clipBeats) continue; // skip notes beyond clip
        if (!byPitch[n.pitch]) byPitch[n.pitch] = [];
        byPitch[n.pitch].push({
            time: n.time,
            duration: Math.min(n.duration, clipBeats - n.time),
            velocity: Math.max(0, Math.min(127, Math.round(n.velocity))),
            noteId: nextNoteId++
        });
    }

    // 3. Write one KeyTrack per pitch
    let trackId = 1;
    for (const pitchStr of Object.keys(byPitch).sort((a,b) => +a - +b)) {
        const keyTrack = doc.createElement('KeyTrack');
        keyTrack.setAttribute('Id', String(trackId++));
        const trackNotes = doc.createElement('Notes');
        for (const evt of byPitch[pitchStr]) {
            const e = doc.createElement('MidiNoteEvent');
            e.setAttribute('Time', String(evt.time));
            e.setAttribute('Duration', String(evt.duration));
            e.setAttribute('Velocity', String(evt.velocity));
            e.setAttribute('OffVelocity', '64');
            e.setAttribute('NoteId', String(evt.noteId));
            trackNotes.appendChild(e);
        }
        keyTrack.appendChild(trackNotes);
        const midiKey = doc.createElement('MidiKey');
        midiKey.setAttribute('Value', pitchStr);
        keyTrack.appendChild(midiKey);
        keyTracks.appendChild(keyTrack);
    }

    // 4. Update NoteIdGenerator NextId
    const noteIdGen = findChild(notesContainer, 'NoteIdGenerator');
    if (noteIdGen) {
        const nextIdEl = findChild(noteIdGen, 'NextId');
        if (nextIdEl) nextIdEl.setAttribute('Value', String(nextNoteId));
    }

    return { notesWritten: notes.length, pitchCount: Object.keys(byPitch).length };
}
```

### 6.3 Wiring into `injectAlcFile`

`alc-generator.js` calls `alcInjector.injectAlcFile(templatePath, autoData, outputPath)`. Add an optional `midiNotes` field to `autoData`:

```js
const autoData = {
    clip_bars: clipBars,
    total_param_count: totalParamCount,
    midi_notes: msg.midi_notes || null,   // ← NEW: pre-looped notes from armed pattern
    params: activeParams.map(...)
};
```

In `injectAlcFile`, after `injectAutomation` completes:

```js
if (autoData.midi_notes && autoData.midi_notes.length > 0) {
    const clipBeats = clipBars * 4.0;
    alcInjector.injectMidiNotes(doc, root, autoData.midi_notes, clipBeats);
}
```

### 6.4 .mid file parsing

We need to parse Standard MIDI Files (.mid) into the `{pitch, time, duration, velocity}` shape used by the armed state.

**Dependency choice:** `@tonejs/midi` (already MIT, ~50KB) or hand-rolled parser.

**Recommendation:** Use `@tonejs/midi`. It returns `tracks[].notes[]` with `midi`, `time`, `duration`, `velocity` properties (time/duration in seconds — must be converted to beats using the MIDI file's tempo metadata).

Conversion:
```js
const beats = noteTime * (bpm / 60);
const durBeats = noteDuration * (bpm / 60);
const vel = Math.round(noteVelocity * 127); // tonejs/midi uses 0-1
```

`@tonejs/midi` is a separate package from `tone`; can install only the parser to keep bundle small.

### 6.5 Bar-mismatch looping

If pattern bars < canvas bars, repeat the pattern. Implementation lives in the loader, not the injector:

```js
function expandToCanvasLength(patternNotes, patternBars, canvasBars) {
    if (patternBars >= canvasBars) {
        // Truncate notes past canvas length (defensive — shouldn't happen if filter works)
        const max = canvasBars * 4;
        return patternNotes.filter(n => n.time < max);
    }
    const reps = Math.floor(canvasBars / patternBars);
    const patternBeats = patternBars * 4;
    const out = [];
    for (let r = 0; r < reps; r++) {
        const offset = r * patternBeats;
        for (const n of patternNotes) {
            out.push({ ...n, time: n.time + offset });
        }
    }
    return out;
}
```

Called when arming a pattern (so the armed state holds the already-expanded notes).

---

## 7. Audition (in-app, Tone.js)

### 7.1 Dependency

- `tone` package (≈250 KB minified) — adds to `stride-vst/app/package.json`
- Loaded lazily on first overlay open (not at app startup)

### 7.2 Behavior

- One synth instance, reused: `new Tone.PolySynth(Tone.FMSynth)` with subtle distortion + reverb for character
- Click Play in preview pane:
  - Stop any currently-playing audition
  - Schedule all notes via `Tone.Part`
  - Loop the pattern
- Click Stop: `Tone.Transport.stop(); part.dispose()`
- On overlay close: stop + dispose
- On selecting a different pattern: stop + dispose, ready for next click

### 7.3 Audio context constraint

Browsers block `AudioContext` until user gesture. Tone.js handles this — but we ensure first call is from a click (the Play button), never auto-played.

---

## 8. Tests

All in `stride-vst/test/`, following existing node-direct convention:

### 8.1 `test-pattern-manifest.js`

- Loads `manifest.json`
- Asserts every entry has required fields
- Asserts every `file` path exists on disk
- Asserts no duplicate `id`s
- Asserts every `category` is in the pinned vocab
- Asserts every `style` tag is in the pinned style vocab

### 8.2 `test-pattern-filter.js`

- Bar-fit filter: 8-bar canvas accepts 1, 2, 4, 8 bar patterns; rejects 16
- Key filter: exact match
- Style filter: any-of match (pattern has `["acid","techno"]`, filter `"acid"` matches)
- BPM range: ±5% tolerance test
- Combined filter

### 8.3 `test-midi-parser.js`

- Parse a known 1-bar 4-on-the-floor .mid → 4 notes, pitches 36, times 0/1/2/3, all velocity 100
- Parse a polyphonic chord → returns simultaneous notes at same time
- Tempo extraction: BPM detected from MIDI metadata

### 8.4 `test-alc-note-injection.js`

- Read a real template .alc (with notes)
- Call `injectMidiNotes` with [{pitch:60, time:0, duration:1, velocity:100}]
- Serialize back
- Re-parse and assert: 1 KeyTrack, MidiKey=60, 1 MidiNoteEvent at Time=0
- **Regression check:** call `injectAutomation` BEFORE `injectMidiNotes` — assert envelope events unchanged

### 8.5 `test-pattern-expand.js`

- 4-bar pattern → 8-bar canvas → 2 repetitions, correct time offsets

### 8.6 Regression: rerun existing tests

`test-prism.js`, `test-sample-hold.js`, `test-file-roundtrip.js`, `test-alc-longpath.js`, `test-library-watcher.js` — all must still pass.

---

## 9. Risks & non-breaking guarantees

| Risk | Mitigation |
|---|---|
| Existing curves-only flow regresses | Pattern injection is opt-in (only runs if `sdArmedPattern !== null`). Apply path has explicit conditional. Tests assert byte-equivalent output when no pattern armed. |
| Template .alc doesn't have a `<MidiClip>` (audio rack edge case) | `injectMidiNotes` throws a soft error; UI shows toast "This rack template is audio-only — patterns can't be injected." Apply continues with curves only. |
| Bundle size bloats | Patterns are ~1 KB each. Tone.js + @tonejs/midi together <500 KB. Lazy-load both on first overlay open. |
| User picks a pattern, changes bar count mid-flow | Armed state stores pre-expanded notes for the bar count it was picked at. On bar-count change, re-expand using stored raw pattern data (keep both raw + expanded in armed state). |
| Tone.js audio context not granted | Defensive: wrap Play in try/catch, show "Click again to start audio" message on first failure. |
| Yossi adds invalid manifest entry | Manifest validator script runs in CI (and in test-pattern-manifest.js) — bad entries fail tests before release. |
| New filter UI confuses existing users | Library is fully optional. Coach surfaces it in step 6/7 of Getting Started guide. |

**Non-negotiables (must hold for v1.2 release):**
1. `applyToAbleton()` with no armed pattern produces an .alc bytes-identical to today's behavior (or, if XML normalization changes ordering, semantically identical — same envelopes, same values, same clip length).
2. The PATTERNS button is invisible/inert if `manifest.json` is missing or empty.
3. Tone.js failure (no audio context, dependency missing) does not block picking a pattern — Play button just shows "audio unavailable" but Pick still works.
4. No new WebSocket message types in v1.2 — armed pattern flows through the existing `apply_automation` message via a new optional field on the payload.

---

## 10. Message protocol additions

`shared/message-types.js` — extend `apply_automation` doc-comment only (no new types):

```js
const APPLY_AUTOMATION = 'apply_automation';
// { type, create_clip_if_missing, clip_bars, device_name, template_path, clip_name,
//   total_param_count, parameters: [...],
//   midi_notes?: [{pitch, time, duration, velocity}]  // ← NEW, optional
// }
```

`ws-client.js` `applyAutomation()` gains an optional `midiNotes` argument:

```js
applyAutomation(params, clipBars, deviceName, templatePath, createIfMissing, clipName, midiNotes) {
    return this.send({
        type: 'apply_automation',
        ...
        midi_notes: midiNotes || null
    });
}
```

---

## 11. Phase plan

| # | Phase | Files touched | Effort |
|---|---|---|---|
| 1 | Manifest + loader (with 5 placeholder patterns) | `assets/patterns/`, `app/renderer/pattern-loader.js` (new) | 0.5 d |
| 2 | Overlay shell + PATTERNS button | `index.html`, `canvas.js`, CSS | 0.5 d |
| 3 | Library content (grid, filters, preview pane) | `pattern-library.js` (new), `index.html`, CSS | 1.5 d |
| 4 | In-app audition (Tone.js) | `pattern-library.js`, `package.json` | 0.5 d |
| 5 | Armed state + .alc note injection | `canvas.js`, `ws-client.js`, `writer.js`, `alc-injector.js`, `alc-generator.js`, `server.js` | 1 d |
| 6 | Favorites + recent + dock strip | `pattern-library.js`, `canvas.js`, `main.js` IPC | 0.5 d |
| 7 | Tests + regression | `test/test-pattern-*.js` (new), rerun existing | 0.5 d |
| 8 | Curator tool (hidden dev page) | `app/curator/` (new), separate Electron window | 1 d (deferred ok) |

**Total to v1.2 ship-ready (phases 1-7): ~5 days of build.** Phase 8 (curator) can come right after.

---

## 12. Open decisions for Yossi

These need a lock before / during implementation:

1. **Initial corpus.** How many patterns ready at v1.2 ship? Suggest minimum 50 hand-picked (5-10 per category) for launch credibility; full 1,000 grows over months.
2. **Pattern licensing line.** EULA text re: bundled patterns being royalty-free. Confirm wording.
3. **Star/favorite UI placement.** Inside the card AND inside the preview pane, or just one?
4. **Recent strip in dock.** Confirm: it lives as a horizontal slice ABOVE the existing Recent Generations cards, separated by a 1px divider — not interleaved.
5. **Audition synth tone.** PolySynth FMSynth (suggested) vs. a sampler with a generic "neutral piano" patch. FM is smaller install but less idiomatic for non-EDM patterns. Pick one to lock the spec.

Until these are answered, defaults from this doc apply.

---

## 13. Future (post-v1.2)

- **Try in Live audition** — send notes via existing `apply_midi` to audition slot, hear through user's actual rack with curves applied.
- **Pattern variations** — given a picked pattern, deterministic transforms button: transpose, octave, swing, humanize velocity, density change.
- **Curator tool (phase 8)** — for Yossi to add patterns easily.
- **Cloud-hosted pattern packs** — optional download of additional packs without app update (signed manifest at `patterns.stridehub.io/v2.json`).
- **User-submitted patterns** — community marketplace, profit share (matches `project_marketplace_roadmap.md` memory).
