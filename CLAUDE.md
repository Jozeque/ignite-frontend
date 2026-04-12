# STRIDE — Project Guide

## What is Stride?

Stride is a **Sound Design Engine for Ableton Live** — a desktop app (Electron) paired with a Max for Live device (StrideLink). Producers load their own Ableton instrument racks, draw dynamic automation curves on a visual canvas, and apply them directly to clips. Optional cloud generation creates curves and MIDI via API.

**Tagline:** Sound Design Engine. Your racks, reborn.

**Critical rule:** This is NOT an AI tool in public messaging. Never mention AI, LLMs, or Gemini in any user-facing copy, UI text, or marketing. The product is a **sound design engine** — the technology behind it is irrelevant to the user.

---

## Audience & Voice

Electronic music producers who work in Ableton Live. They care about workflow speed, creative ownership, and discovering new sounds from instruments they already own.

**Copy rules:**
- Lead with **sound design**, MIDI is secondary
- Producer language: racks, patches, automation, Live, clips, bars, grooves
- Confidence without hype — no "revolutionary" anything
- Short, punchy. No filler. No corporate speak.
- Tone: "built by someone who actually produces"
- **Never say:** AI-powered, machine learning, generate music for you, or compare to DAWs

---

## Architecture

Three layers connected via WebSocket on `localhost:9100`:

```
┌─────────────────┐    WebSocket     ┌──────────────┐    Max LOM    ┌─────────┐
│  Electron App   │ ◄──────────────► │  M4L Bridge  │ ◄───────────► │ Ableton │
│  (Canvas UI)    │   JSON messages  │  (Node.js)   │   LiveAPI     │  Live   │
└─────────────────┘                  └──────────────┘               └─────────┘
        │                                                                
        │ HTTPS (optional)                                               
        ▼                                                                
┌─────────────────┐                                                      
│ Cloud Functions  │  ← v2 feature: cloud-generated curves + MIDI        
│ (Firebase/GCF)  │                                                      
└─────────────────┘                                                      
```

### Electron App (`stride-vst/app/`)

The standalone desktop UI where producers draw automation curves.

| File | Lines | Purpose |
|------|-------|---------|
| `main.js` | 380 | Electron lifecycle, IPC handlers, license validation, file watchers |
| `preload.js` | 69 | Secure IPC bridge — exposes `window.stride` API to renderer |
| `renderer/index.html` | 2,962 | Full UI — activation gate, canvas, sidebar, toolbars, modals |
| `renderer/canvas.js` | 2,187 | Drawing engine — tools, templates, mutations, undo/redo, sessions |
| `renderer/ws-client.js` | 158 | WebSocket client to M4L (`window.strideLink` singleton) |
| `renderer/cloud-client.js` | 168 | Firebase auth + cloud generation API (`window.strideCloud`) |

**Stack:** Electron 33, Tailwind CDN v3, HTML5 Canvas 2D, vanilla JS
**Font:** Outfit (Google Fonts, 300-900)
**Colors:** Dark base (#09090b), orange/fuchsia accents, zinc neutrals

**Canvas tools:** Point draw, Freehand draw, Bezier bend, Select | Mirror, Flip, Copy, Paste, Paste To (multi-lane), Quantize, Swing, Smooth, Intensity, Curve, Time Stretch | Templates: Sine, Pump, Glitch, Groove Build, Chaos LFO, Neuro | Mutate, Bloom

**IPC surface (`window.stride`):** saveCanvasState, loadCanvasState, saveLicense, loadLicense, validateLicenseKey, saveSettings, loadSettings, importTemplate, listTemplates, deleteTemplate, saveSession, listSessions, loadSession, deleteSession, pickAlcFile, onAlcDetected, openExternal, platform

### M4L Bridge (`stride-vst/m4l/`)

Node.js server running inside Max for Live's `[node.script]`. Bridges Electron canvas to Ableton's Live Object Model.

| File | Lines | Purpose |
|------|-------|---------|
| `node/server.js` | 416 | WebSocket server + Max API message routing |
| `node/scanner_max.js` | 694 | Max JS — recursive LOM parameter scanning |
| `node/scanner.js` | 130 | Scan helpers + Max JS reference |
| `node/alc-generator.js` | 298 | Template registry + .alc file generation |
| `node/alc-injector.js` | 557 | Binary .alc parsing & automation injection |
| `node/alc_injector.py` | 410 | Python fallback for .alc injection |
| `node/writer.js` | 203 | Automation/MIDI writer via temp JSON files |
| `StrideLink.amxd` | — | Compiled Max patcher (binary — do NOT read/edit) |

**Key flows:**
1. **Scan:** App → `request_scan` → server.js → Max outlet → scanner_max.js → LiveAPI → `rack_scanned` → App loads params
2. **Apply:** App → `apply_automation` → server.js → alc-generator → alc-injector → writes `~/Desktop/Stride/Device_HHmmss.alc` → user drags into Ableton

### Cloud Functions (`firebase_cloud/functions/`) — v2

Optional cloud generation. Not required for core functionality.

| File | Lines | Purpose |
|------|-------|---------|
| `main.py` | ~2,100 | Generation endpoint (Gemini), auth, credits, Supabase dual-write |
| `requirements.txt` | — | google-genai, mido, firebase-admin, supabase, flask |

**Deploy:** `cd firebase_cloud && firebase deploy --only functions`
**Endpoint:** `https://generate-midi-z3spyrafvq-uc.a.run.app`
**Secrets:** GEMINI_API_KEY, SUPABASE_SERVICE_KEY, ADMIN_WEBHOOK_URL (via `firebase functions:secrets:set`)

### Data Persistence

| What | Where |
|------|-------|
| Canvas state (per-rack) | `%APPDATA%/stride-canvas/stride-data/canvas_<rackId>.json` |
| License cache | `%APPDATA%/stride-canvas/stride-data/license.json` |
| Settings | `%APPDATA%/stride-canvas/stride-data/settings.json` |
| Templates + registry | `~/Desktop/Stride/template/` + `registry.json` |
| Sessions | `~/Desktop/Stride/sessions/` |
| Generated .alc files | `~/Desktop/Stride/<Device>_HHmmss.alc` |

### License System

- One-time purchase via Lemon Squeezy
- Built-in master key + 10 ambassador keys in main.js
- Offline grace period: 14 days after last validation
- Optional credits for cloud generation (50 starter, $5/50 additional)

---

## Web App (Legacy / Marketing Funnel)

The web app at stridehub.io serves as a landing page and signup funnel. It predates the desktop app.

- **Source of truth:** `frontend/index.html` (landing) and `frontend/app.html` (web app)
- **Root copies:** `index.html` and `app.html` at project root are for GitHub Pages
- **Sync rule:** After editing frontend files, ALWAYS copy to root: `cp frontend/app.html ./app.html && cp frontend/index.html ./index.html`
- **Deploy:** Push to `main` → GitHub Pages auto-deploys to stridehub.io
- **Data:** Firebase Auth + Firestore + Supabase (dual-write) + Firebase Storage

---

## File Map

```
stride-vst/                     ← PRIMARY PRODUCT
  app/
    main.js                     ← Electron main process
    preload.js                  ← IPC bridge
    renderer/
      index.html                ← Full UI
      canvas.js                 ← Drawing engine
      ws-client.js              ← WebSocket client
      cloud-client.js           ← Cloud API client
    assets/                     ← Icons, guide images
    package.json                ← Electron + ws deps
  m4l/
    StrideLink.amxd             ← Max device (binary)
    node/
      server.js                 ← WebSocket server
      scanner_max.js            ← LOM scanner (Max JS)
      alc-generator.js          ← Template + .alc generation
      alc-injector.js           ← Binary .alc manipulation
      alc_injector.py           ← Python fallback
  shared/
    message-types.js            ← WebSocket message constants
  build.sh                      ← Release build script
  dist-release/                 ← Ready-to-ship build
  ARCHITECTURE.md               ← Detailed system design

frontend/                       ← WEB APP (legacy/funnel)
  app.html                      ← Web app (source of truth)
  index.html                    ← Landing page (source of truth)
  privacy.html / terms.html     ← Legal pages

firebase_cloud/                 ← CLOUD BACKEND (v2)
  functions/
    main.py                     ← All backend logic
    requirements.txt
  firebase.json

app.html / index.html           ← Root copies for GitHub Pages
CNAME                           ← stridehub.io domain config
docs/                           ← Marketing/GTM strategy docs
```

### Ignore

- `frontend_OLD_BACKUP/` — old backup
- `app.py`, `main.py`, `requirements.txt`, `landing_page.html` at root — legacy pre-Firebase files
- `backfill_supabase.py` — one-time migration (already run)
- `mockup.html`, `mockup_landing_v2.html` — design explorations
- `tmp_forensic/` — temporary debug files
- `supabase_schema.sql` — schema reference only

---

## Working Rules

1. **Spec before code** — discuss the approach before writing. Don't implement until explicitly told to
2. **Never touch files you weren't asked to touch** — no drive-by refactors, no unsolicited improvements
3. **stride-vst/ is the primary product** — this is where active development happens
4. **StrideLink.amxd is binary** — never try to read or edit it. Modify the Node.js files instead
5. **Frontend source of truth is `frontend/`** — edit there first, sync to root before pushing
6. **Backend is one file** — `firebase_cloud/functions/main.py` (~2,100 lines), be careful with changes
7. **Supabase writes are non-blocking** — they should never cause the main request to fail
8. **No AI mentions in UI/copy** — ever
