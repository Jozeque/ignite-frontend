# Stride Local — Architecture Spec

## Overview

Stride Local is a hybrid system: a **standalone desktop app** (the canvas UI) paired with a **Max for Live device** (the Ableton bridge). Together they replace the web app's upload/download flow with a seamless, mostly-offline workflow.

```
┌─────────────────────────────────────────────────────────────┐
│                        ABLETON LIVE                         │
│                                                             │
│   Track: "My Synth"                                         │
│   ┌──────────────┐  ┌──────────────┐  ┌──────────────────┐  │
│   │  Serum (VST)  │  │  Stride M4L  │  │  MIDI Clip (4 bar)│ │
│   └──────────────┘  └──────┬───────┘  └──────────────────┘  │
│                            │                                 │
└────────────────────────────┼─────────────────────────────────┘
                             │ WebSocket (localhost:9100)
                             │
              ┌──────────────▼───────────────┐
              │      Stride Canvas App       │
              │      (Electron / Tauri)       │
              │                              │
              │  • Full drawing canvas       │
              │  • Parameter lanes           │
              │  • Tools & templates         │
              │  • Offline by default        │
              │  • Optional: Generate btn    │
              │    (requires account)        │
              └──────────────┬───────────────┘
                             │ HTTPS (only when generating)
                             │
              ┌──────────────▼───────────────┐
              │    Firebase Cloud Functions   │
              │                              │
              │  • Gemini generation          │
              │  • Auth & credits             │
              │  • Same main.py as today      │
              └──────────────────────────────┘
```

---

## Components

### 1. Max for Live Device (`m4l/StrideLink.amxd`)

**Purpose:** Bridge between Ableton and the canvas app. Tiny footprint, no UI beyond a few buttons.

**Responsibilities:**
- Scan all parameters of the instrument rack on the current track
- Read clip length (bars) from the selected clip slot
- Create empty clips if none exist
- Write automation envelopes to clips
- Optionally: real-time parameter preview (temporarily set values for auditioning)

**Tech:**
- Max/MSP patcher with `node.script` (Node for Max)
- Node.js WebSocket server running on `localhost:9100`
- Communicates via JSON messages

**M4L Device UI (minimal):**
```
┌─────────────────────────────────────┐
│  STRIDE LINK              ● Online  │
│  [Scan Rack]  [Open Canvas]         │
│  Track: My Synth | Clip: 4 bars     │
└─────────────────────────────────────┘
```

**What M4L can access (Live Object Model):**
```javascript
// Read device parameters
const track = new LiveAPI("live_set tracks 0");
const device = new LiveAPI("live_set tracks 0 devices 0");
const paramCount = device.get("parameters").length;

// For each parameter:
param.get("name")          // "Filter Cutoff"
param.get("min")           // 0.0
param.get("max")           // 1.0
param.get("value")         // 0.65
param.get("is_enabled")    // 1

// Read clip
clip.get("length")         // 16.0 (4 bars)
clip.get("is_midi_clip")   // 1

// Write automation
clip.call("clear_envelope", paramId);
clip.call("insert_step", paramId, time, duration, value);
```

---

### 2. Standalone Canvas App (`app/`)

**Purpose:** Full-featured sound design canvas — all drawing, editing, generation, and manipulation tools.

**Tech options (in order of recommendation):**

| Option | Pros | Cons |
|--------|------|------|
| **Electron** | Reuse 100% of existing HTML/JS/CSS, fast to ship | Large bundle (~150MB), memory heavy |
| **Tauri** | Tiny bundle (~10MB), fast, Rust backend | WebView quirks on Windows, less mature |
| **JUCE + WebView** | Industry standard for audio plugins | C++ complexity, overkill for this |

**Recommendation: Electron for v1, evaluate Tauri for v2.**

Reason: Your entire canvas, toolbar, lane system, and drawing logic already exists in `app.html`. With Electron, you literally wrap it in a window and add WebSocket client code. Ship fast, optimize later.

**App modes:**

```
OFFLINE MODE (no account):
  • Canvas with all drawing tools
  • Templates (Sine, Pump, Glitch, Groove Build, Chaos LFO, Neuro)
  • All manipulation (Mirror, Flip, Copy, Paste, Paste To, Quantize, Swing)
  • Bezier curve bending
  • Connect to M4L for scanning params + writing automation
  • Zero internet, zero data sent anywhere
  • Included in one-time purchase

ONLINE MODE (account + credits):
  • Everything above
  • "Generate" button appears in toolbar
  • Sends params + settings to Firebase cloud function
  • Receives generated curves + optional MIDI
  • Costs credits per generation
  • Requires sign-in
```

**App UI structure:**
```
┌──────────────────────────────────────────────────────────┐
│  STRIDE                          [Connect M4L] [Account] │
├──────────┬───────────────────────────────────────────────┤
│          │                                               │
│ Param    │         Canvas Grid                           │
│ Lanes    │         (automation curves)                   │
│          │                                               │
│ Filter   │    ───────────────────────────                │
│ Cutoff   │   /        \          /    \                  │
│ ──────── │  /          \        /      \                 │
│ LFO Rate │ /            \──────/        \────            │
│ ──────── │                                               │
│ Reverb   │                                               │
│ ──────── │                                               │
│          │                                               │
├──────────┴───────────────────────────────────────────────┤
│ Tools: [Point] [Draw] [Bend] | Templates | [Mirror]     │
│ [Flip] [Copy] [Paste] [Paste To] [Quantize] [Swing]     │
│                                          [Generate] [Apply] │
└──────────────────────────────────────────────────────────┘
```

---

### 3. WebSocket Protocol (`shared/protocol.md`)

All communication between M4L and the canvas app happens over WebSocket on `localhost:9100`. Messages are JSON.

#### M4L → App Messages

**`rack_scanned`** — After user clicks "Scan Rack"
```json
{
  "type": "rack_scanned",
  "track_name": "My Synth",
  "device_name": "Instrument Rack",
  "clip_bars": 4,
  "parameters": [
    {
      "id": 1,
      "name": "Filter Cutoff",
      "min": 0.0,
      "max": 1.0,
      "value": 0.65
    },
    {
      "id": 2,
      "name": "LFO Rate",
      "min": 0.0,
      "max": 1.0,
      "value": 0.3
    }
  ]
}
```

**`clip_changed`** — When user selects a different clip or resizes
```json
{
  "type": "clip_changed",
  "clip_bars": 8,
  "has_clip": true
}
```

**`apply_success`** — After automation is written
```json
{
  "type": "apply_success",
  "params_written": 12,
  "clip_bars": 4
}
```

**`apply_error`** — If writing fails
```json
{
  "type": "apply_error",
  "message": "No clip in selected slot"
}
```

#### App → M4L Messages

**`request_scan`** — App asks M4L to scan
```json
{
  "type": "request_scan"
}
```

**`apply_automation`** — Send curves to write into clip
```json
{
  "type": "apply_automation",
  "create_clip_if_missing": true,
  "clip_bars": 4,
  "parameters": [
    {
      "id": 1,
      "name": "Filter Cutoff",
      "points": [
        { "time": 0.0, "value": 0.0, "curve": 0.0 },
        { "time": 0.25, "value": 0.8, "curve": -0.5 },
        { "time": 0.5, "value": 0.3, "curve": 0.3 },
        { "time": 1.0, "value": 1.0, "curve": 0.0 }
      ]
    }
  ]
}
```

**`preview_param`** — Real-time preview (temporarily set a param value)
```json
{
  "type": "preview_param",
  "id": 1,
  "value": 0.75
}
```

**`stop_preview`** — Restore original param values
```json
{
  "type": "stop_preview"
}
```

**`request_create_clip`** — Ask M4L to create an empty clip
```json
{
  "type": "request_create_clip",
  "bars": 8,
  "slot_index": 0
}
```

---

### 4. Cloud Functions (Existing)

**No changes to `firebase_cloud/functions/main.py` needed for v1.**

The standalone app calls the same endpoints the web app uses:
- `POST /generate` — Gemini generation (curves + MIDI)
- Auth via Firebase token (same as web)
- Credit deduction (same as web)

The only difference: the web app receives an ALC file back. The standalone app only needs the raw JSON curves — the M4L device handles writing them to Ableton. So we may add a lightweight endpoint or a `format=json` flag that skips ALC packaging and returns raw curve data.

---

## User Flows

### Flow 1: Manual Sound Design (Offline, Free)

```
1. User opens Stride app (no login needed)
2. In Ableton: drops Stride M4L device on track with their rack
3. Clicks "Scan Rack" on M4L device (or "Connect" in app)
4. App shows all rack parameters as lanes
5. App reads clip length from M4L (or asks user for bar count)
6. User draws automation curves on canvas
7. Uses tools: templates, mirror, flip, bezier bending, etc.
8. Clicks "Apply"
9. M4L writes automation to the Ableton clip
10. User hits play — hears their rack with the new automation
```

**Credits used: 0. Internet required: No.**

### Flow 2: Generated Sound Design (Online, Credits)

```
1-5. Same as Flow 1
6. User clicks "Generate" button
7. App sends rack params + settings to Firebase cloud function
8. Cloud function calls Gemini, returns curves as JSON
9. Curves appear on canvas — user can edit/tweak
10. Clicks "Apply"
11. M4L writes automation to clip
```

**Credits used: 1-3 depending on mode. Internet required: Yes (for step 7-8 only).**

### Flow 3: MIDI Generation (Online, Credits)

```
1-5. Same as Flow 1
6. User clicks "Generate" with MIDI option enabled
7. Cloud function returns curves + MIDI data
8. Curves appear on canvas, MIDI is written to clip via M4L
9. User edits if needed, clicks "Apply" for final automation
```

---

## File Structure

```
stride-vst/
├── ARCHITECTURE.md          ← this file
│
├── m4l/                     ← Max for Live device
│   ├── StrideLink.amxd      ← the M4L device (Max patcher)
│   ├── node/                ← Node for Max scripts
│   │   ├── server.js        ← WebSocket server
│   │   ├── scanner.js       ← reads rack params via LOM
│   │   ├── writer.js        ← writes automation to clips
│   │   └── package.json
│   └── README.md
│
├── app/                     ← Standalone canvas app (Electron)
│   ├── main.js              ← Electron main process
│   ├── preload.js           ← bridge between main and renderer
│   ├── renderer/
│   │   ├── index.html       ← canvas UI (ported from app.html)
│   │   ├── canvas.js        ← drawing engine (extracted from app.html)
│   │   ├── ws-client.js     ← WebSocket client to M4L
│   │   ├── cloud-client.js  ← Firebase auth + generation API calls
│   │   └── styles.css       ← Tailwind (or extracted styles)
│   ├── package.json
│   └── electron-builder.yml ← packaging config
│
├── shared/
│   ├── protocol.md          ← WebSocket message spec (above)
│   └── message-types.js     ← shared type definitions
│
└── docs/
    └── dev-setup.md         ← how to run locally
```

---

## Licensing & Business Model

### Pricing
- **One-time purchase: $49-79** — full app + M4L device, all offline features
- **Launch promo (first 2 months): 50% off with coupon code** — drives early adoption, creates urgency
- **Includes starter credits** (e.g. 50 generations)
- **Credit top-ups: $5 for 50 credits** (or similar)
- No subscription required. Generation is optional.

### GTM Launch Strategy
- 50% launch coupon distributed via Reddit, Discord, YouTube producers, Ableton forum
- 2-month window creates urgency ("early supporter" pricing)
- After window closes, full price — early buyers feel rewarded
- Coupon tracking: store `coupon_code` and `discount_applied` in license record

### License Validation
```
Purchase → serial key generated → tied to user email
App launch → checks serial locally (encrypted cache)
First activation → validates online, registers machine_id
Allows 2-3 machines per serial
Offline grace: 14 days without re-validation
```

### Firestore Schema
```
licenses/{serial}
  email: "user@example.com"
  purchased_at: timestamp
  plan: "standard"
  credits_remaining: 50
  activations: [
    { machine_id: "abc123", os: "win", activated_at: timestamp },
    { machine_id: "def456", os: "mac", activated_at: timestamp }
  ]
```

---

## Phased Build Plan

### Phase 1 — M4L Device + WebSocket Bridge (Week 1-2)
- Build M4L patcher with `node.script`
- Implement scanner (read rack params via LOM)
- Implement WebSocket server on localhost:9100
- Test: scan a rack, see JSON in console
- Implement writer (write automation to clip)
- Test: send hardcoded curves, verify they appear in Ableton

### Phase 2 — Standalone App Shell (Week 2-3)
- Set up Electron project
- Port canvas UI from app.html (drawing engine, lanes, tools)
- Strip out all web-specific code (Firebase Auth UI, upload/download, modals)
- Add WebSocket client — connect to M4L
- Test: scan rack → see params in app → draw curves → apply → hear in Ableton

### Phase 3 — Full Offline Feature Parity (Week 3-4)
- All manipulation tools working (mirror, flip, copy, paste, paste to, quantize, swing)
- Templates working
- Bezier curve bending
- Clip length sync (M4L ↔ app)
- Canvas state save/load (local file, not Firestore)
- Preview mode (M4L temporarily sets param values)

### Phase 4 — Online Mode / Generation (Week 4-5)
- Add optional sign-in (Firebase Auth)
- Add "Generate" button (hidden until signed in)
- Connect to existing cloud functions (same API)
- Handle credits
- Add JSON-only response mode to cloud function (skip ALC packaging)

### Phase 5 — Licensing & Distribution (Week 5-6)
- Serial key generation system
- License validation endpoint
- Offline grace period
- Electron packaging (Windows installer + Mac dmg)
- M4L device packaging (.amxd export)

### Phase 6 — Polish & Beta (Week 6-8)
- Error handling, edge cases
- Auto-reconnect if M4L/app connection drops
- Update checker
- Beta testing with producers
- Landing page update for the desktop product
