# Stride Local — Development Setup

## Prerequisites

- Node.js 18+
- Ableton Live 11+ (Suite or with Max for Live)
- npm or yarn

## Quick Start

### 1. Install Dependencies

```bash
# Canvas app
cd stride-vst/app
npm install

# M4L device
cd ../m4l/node
npm install
```

### 2. Run the Canvas App

```bash
cd stride-vst/app
npm start        # production mode
npm run dev      # dev mode (opens DevTools)
```

### 3. Set Up M4L Device

1. Open Ableton Live
2. Create a new MIDI track
3. Load your instrument (any synth/rack)
4. Drag `StrideLink.amxd` onto the same track
5. The device will start the WebSocket server automatically

### 4. Connect

1. The Canvas app auto-connects to `localhost:9100`
2. Green dot = connected, gray = disconnected
3. Click "Scan Rack" to load parameters
4. Draw automation, click "Apply" to write to clip

## Development Workflow

### Canvas App (Electron)
- Edit files in `app/renderer/`
- Refresh with Ctrl+R (dev mode) or restart app
- Canvas engine is in `canvas.js` — pure JS, no build step

### M4L Device
- Edit Node scripts in `m4l/node/`
- Max patches need to be edited in Max for Live editor
- Node scripts auto-reload when Max refreshes

### Cloud Functions
- No changes needed for v1
- Same `firebase_cloud/functions/main.py` as the web app
- Deploy: `cd firebase_cloud && firebase deploy --only functions`

## Building for Distribution

### Windows
```bash
cd stride-vst/app
npm run build:win
# Output: dist/Stride Setup.exe
```

### macOS
```bash
cd stride-vst/app
npm run build:mac
# Output: dist/Stride.dmg
```

### M4L Device
1. Open the patcher in Max
2. File → Export as Frozen Device
3. Produces `StrideLink.amxd`

## Project Structure

```
stride-vst/
├── ARCHITECTURE.md      ← full system spec
├── m4l/
│   ├── StrideLink.amxd  ← Max for Live device
│   ├── node/
│   │   ├── server.js    ← WebSocket server
│   │   ├── scanner.js   ← scan helpers
│   │   ├── writer.js    ← write helpers
│   │   └── package.json
│   └── README.md
├── app/
│   ├── main.js          ← Electron main process
│   ├── preload.js       ← IPC bridge
│   ├── renderer/
│   │   ├── index.html   ← canvas UI
│   │   ├── canvas.js    ← drawing engine
│   │   ├── ws-client.js ← M4L connection
│   │   └── cloud-client.js ← online mode
│   └── package.json
├── shared/
│   └── message-types.js ← WebSocket protocol
└── docs/
    └── dev-setup.md     ← this file
```
