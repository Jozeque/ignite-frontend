#!/bin/bash
# ─── Stride Build Script ─────────────────────────────────
# Builds the Electron app and packages everything for distribution.
# Usage: bash build.sh
#
# Output: dist-release/Stride/ (folder) + dist-release/Stride_v1.0.0_Windows.zip

set -e
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
APP_DIR="$SCRIPT_DIR/app"
M4L_DIR="$SCRIPT_DIR/m4l"
DIST="$SCRIPT_DIR/dist-release"
VERSION=$(node -e "console.log(require('./app/package.json').version)")

OBFUSCATOR="$APP_DIR/node_modules/.bin/javascript-obfuscator"

echo "═══════════════════════════════════════"
echo "  STRIDE BUILD — v${VERSION}"
echo "═══════════════════════════════════════"
echo ""

# ─── Step 0: Regenerate .ico from assets/icon.png ────────
# Keeps the Windows .exe icon in sync with the source PNG. png2icons is a
# pure-JS npm devDep so this works on any OS without ImageMagick.
echo "[0/5] Regenerating build/icon.ico from assets/icon.png..."
cd "$APP_DIR"
node -e "const p=require('png2icons');const fs=require('fs');const d=fs.readFileSync('assets/icon.png');const ico=p.createICO(d,p.BILINEAR,0,false);if(!ico){console.error('ICO fail');process.exit(1);}fs.writeFileSync('build/icon.ico',ico);console.log('build/icon.ico ->',ico.length,'bytes');"

# ─── Step 1: Build Electron app ──────────────────────────
echo "[1/5] Building Electron app..."
cd "$APP_DIR"
npx electron-builder --win --dir 2>&1 | grep -E "^  [•⨯]" || true

if [ ! -f "dist/win-unpacked/Stride.exe" ]; then
    echo "ERROR: Build failed — Stride.exe not found"
    exit 1
fi
echo "      Stride.exe built OK"

# ─── Step 2: Assemble distribution folder ────────────────
echo "[2/5] Assembling distribution..."
rm -rf "$DIST" 2>/dev/null || true
# If cleanup fails (stale Windows handle), use a fresh suffix
if [ -d "$DIST/Stride" ]; then
    DIST="${DIST}_$(date +%s)"
fi
mkdir -p "$DIST/Stride/M4L"

# Copy Electron app
cp -r "$APP_DIR/dist/win-unpacked/"* "$DIST/Stride/"

# Strip unused locales (keep English only)
cd "$DIST/Stride/locales"
for f in *.pak; do
    case "$f" in en-US.pak|en-GB.pak) ;; *) rm -f "$f" ;; esac
done

# Copy M4L device + node scripts (flat alongside .amxd so Max finds them)
cp "$M4L_DIR/StrideLink.amxd" "$DIST/Stride/M4L/"
cp "$M4L_DIR/node/"*.js "$DIST/Stride/M4L/"
cp "$M4L_DIR/node/"*.py "$DIST/Stride/M4L/"
cp -r "$M4L_DIR/node/node_modules" "$DIST/Stride/M4L/node_modules"

# Clean dev files from M4L copy
rm -rf "$DIST/Stride/M4L/__pycache__"
rm -f "$DIST/Stride/M4L/_stride_"*.json

# Copy Getting Started guide
mkdir -p "$DIST/Stride/Guide"
cp "$APP_DIR/assets/guide.html" "$DIST/Stride/Guide/"
cp "$APP_DIR/assets/step2.png" "$DIST/Stride/Guide/"
cp "$APP_DIR/assets/step4.png" "$DIST/Stride/Guide/"
cp "$APP_DIR/assets/step6.png" "$DIST/Stride/Guide/"
cp "$APP_DIR/assets/step7.png" "$DIST/Stride/Guide/"

# Tutorial videos used to be bundled here (~104 MB combined). They now
# live on YouTube + the stridehub.io/welcome page (linked from the
# post-purchase email), so we don't ship them in the build anymore.
# Saves the user a 100 MB download and lets us update the videos
# without re-shipping the whole app.

echo "      Distribution assembled"

# ─── Step 3: Obfuscate source code ──────────────────────
echo "[3/5] Obfuscating source code..."
ASAR="$DIST/Stride/resources/app.asar"
ASAR_TMP="$DIST/_asar_tmp"

# Extract asar
npx asar extract "$ASAR" "$ASAR_TMP"

# Obfuscate Electron app JS files — max safe protection
# renameGlobals + renameProperties MUST stay false (breaks Electron APIs)
# debugProtection MUST stay false (freezes DevTools, can cause issues)
for f in main.js preload.js renderer/canvas.js renderer/ws-client.js renderer/cloud-client.js; do
    echo "      obfuscate: $f"
    "$OBFUSCATOR" "$ASAR_TMP/$f" --output "$ASAR_TMP/$f" \
        --compact true \
        --control-flow-flattening true \
        --control-flow-flattening-threshold 0.75 \
        --dead-code-injection true \
        --dead-code-injection-threshold 0.4 \
        --string-array true \
        --string-array-encoding base64 \
        --string-array-threshold 0.75 \
        --string-array-rotate true \
        --string-array-shuffle true \
        --unicode-escape-sequence true \
        --numbers-to-expressions true \
        --simplify true \
        --transform-object-keys true \
        --self-defending true \
        --rename-globals false \
        --rename-properties false
done

# Repack asar
npx asar pack "$ASAR_TMP" "$ASAR"
rm -rf "$ASAR_TMP"

# Obfuscate M4L Node files — same max profile as Electron
for f in server.js scanner.js writer.js inject-writer.js alc-generator.js alc-injector.js; do
    echo "      obfuscate: M4L/$f"
    "$OBFUSCATOR" "$DIST/Stride/M4L/$f" --output "$DIST/Stride/M4L/$f" \
        --compact true \
        --control-flow-flattening true \
        --control-flow-flattening-threshold 0.75 \
        --dead-code-injection true \
        --dead-code-injection-threshold 0.4 \
        --string-array true \
        --string-array-encoding base64 \
        --string-array-threshold 0.75 \
        --string-array-rotate true \
        --string-array-shuffle true \
        --unicode-escape-sequence true \
        --numbers-to-expressions true \
        --simplify true \
        --transform-object-keys true \
        --self-defending true \
        --rename-globals false \
        --rename-properties false
done

# scanner_max.js uses Max's older JS engine — lighter obfuscation
# (no control-flow-flattening, no dead-code-injection, target=browser)
echo "      obfuscate: M4L/scanner_max.js (Max JS)"
"$OBFUSCATOR" "$DIST/Stride/M4L/scanner_max.js" --output "$DIST/Stride/M4L/scanner_max.js" \
    --compact true \
    --string-array true \
    --string-array-encoding base64 \
    --string-array-threshold 0.75 \
    --string-array-rotate true \
    --string-array-shuffle true \
    --rename-globals false \
    --rename-properties false \
    --control-flow-flattening false \
    --target browser

echo "      Source code obfuscated"

# ─── Step 3b: Embed M4L copy inside resources/ for first-launch install ──
# Stride's main process copies this bundled folder to the user's Ableton
# User Library when they click "Install to Ableton". Keeping it inside
# resources/ lets main.js find it via process.resourcesPath — the same
# lookup path that works on Mac (Contents/Resources/M4L).
#
# We copy the ALREADY-OBFUSCATED M4L folder so the bundled copy gets the
# same protection as the top-level Stride/M4L/ folder used by portable mode.
echo "      Embedding M4L into resources/M4L/ for first-launch install..."
mkdir -p "$DIST/Stride/resources/M4L"
cp -R "$DIST/Stride/M4L/"* "$DIST/Stride/resources/M4L/"
echo "      M4L embedded at resources/M4L/"

# ─── Step 4: Add README ─────────────────────────────────
echo "[4/5] Adding README..."
cat > "$DIST/Stride/README.txt" << 'READMEEOF'
===============================================================
 STRIDE - Sound Design Engine for Ableton Live
 Modulate everything in your session.
===============================================================

>> START HERE: watch the 3-minute walkthrough at
   https://stridehub.io/welcome  (the same link is in your purchase email).
   More tutorials, tips, and inspiration live on YouTube:
   https://www.youtube.com/@strideengine
   Seriously, watch the welcome video first.

---------------------------------------------------------------
 INSTALL  (three steps)
---------------------------------------------------------------

1. Unzip the Stride .zip to your Desktop or Documents
   (NOT Downloads - Windows sometimes cleans it). Keep Stride.exe,
   the M4L/ folder, and the Guide/ folder together in the Stride/
   folder.

2. Double-click Stride.exe.
   FIRST LAUNCH ONLY: Windows shows "Windows protected your PC"
   (SmartScreen). Click "More info" -> "Run anyway". One time.
   This happens because Stride isn't code-signed for Windows
   (small indie product, no signing cert yet). After that first
   Run anyway, Windows never asks again on this machine.

3. Enter your license key when Stride asks for it (from your
   purchase email). After activation, a welcome window pops
   asking to install StrideLink to your Ableton User Library
   - click "Install to Ableton". Done.

Then: open Ableton Live -> browser sidebar -> User Library
-> Stride -> drag StrideLink onto any MIDI track.

Requirements: Ableton Live 11+ Suite (or Standard + M4L),
Python 3 (python.org - only needed if the Python fallback is
triggered, rarely). Windows 10 or 11.

---------------------------------------------------------------
 YOUR FIRST CLIP - 10 STEPS
---------------------------------------------------------------

 1. In Ableton, create or open a track with an Instrument Rack
 2. MAP YOUR PARAMETERS - open the automation lane for every
    parameter you want Stride to control. Fastest way:
    F9 + nudge each knob. Or: draw a single point on each lane.
 3. Create a MIDI clip on that track and drag it into the
    "User Library" sidebar in Ableton.
    (You only do this ONCE per rack. Change devices -> drag again.)
 4. From Ableton's browser: User Library -> Stride -> drag
    StrideLink onto the same track.
 5. On StrideLink, click "Open Canvas" - Stride launches (or
    focuses if it's already open). Click "Scan Mapped".
 6. The canvas fills with one lane per mapped parameter.
 7. Either draw by hand OR smash one of the Presets / Chaos /
    Bloom / Prism buttons. Start with a preset.
 8. Click "Apply to Clip". Stride generates a .alc file and
    opens the Stride folder for you.
 9. Drag the .alc onto a new MIDI clip slot on that track.
10. Hit play. Your rack is now automated. You're done.

---------------------------------------------------------------
 TIPS (read once, use forever)
---------------------------------------------------------------

* SAVE YOUR RACK inside the Canvas ("Save Session") so you
  can reload the same curves next time without re-scanning.

* GENERATE 5 VARIATIONS IN A ROW:
  hit Chaos -> Apply to Clip -> Chaos -> Apply to Clip -> ...
  Each Apply creates a new .alc with different curves.
  Audition them all against your track and pick the keeper.

* ANCHOR + COMPLEMENT: hit Chaos, find the single curve you
  love the most, click that lane to make it active, then hit
  Bloom (or Prism) - the rest of the lanes rearrange to
  complement your anchor curve instead of fighting it.
  This is the fastest way to a cohesive modulation pattern.

* ADJUST MASTER BPM while auditioning .alc variations - the
  same curves feel radically different at 120 vs 140 BPM.
  Some sweet spots only reveal themselves at specific tempos.

* EXPERIMENT. Stride rewards exploration. There are endless
  variations and combinations you can chase with the preset
  + Chaos + Bloom + Prism toolkit. No two sessions are alike.

---------------------------------------------------------------
 TROUBLESHOOTING
---------------------------------------------------------------

"Scan Mapped" does nothing
  -> Did you map parameters first? See step 2 above.
  -> Check StrideLink.amxd is on the SAME track as the rack.

"Apply to Clip" says "No template found"
  -> You skipped step 3. Drag a fresh MIDI clip from your track
     into the User Library. Stride uses that clip as the template.

Canvas says "Disconnected"
  -> StrideLink.amxd got reloaded. In Ableton, right-click
     StrideLink -> Delete -> drag it back onto the track.
  -> Click "Open Canvas" on the device again.

---------------------------------------------------------------
 SUPPORT
---------------------------------------------------------------

 Questions, feedback, bugs:   home@stridehub.io
 Web:                         https://stridehub.io

 I'm still exploring the tool myself and keep pushing releases.
 Send me your findings - I reply to everyone.

 Modulate everything in your session.
===============================================================
READMEEOF

# ─── Step 5: Zip ────────────────────────────────────────
echo "[5/5] Creating zip..."
cd "$DIST"
rm -f "Stride_v${VERSION}_Windows.zip"
powershell -Command "Compress-Archive -Path 'Stride' -DestinationPath 'Stride_v${VERSION}_Windows.zip' -Force"

ZIP_SIZE=$(du -h "Stride_v${VERSION}_Windows.zip" | cut -f1)
FOLDER_SIZE=$(du -sh "Stride/" | cut -f1)

echo ""
echo "═══════════════════════════════════════"
echo "  BUILD COMPLETE"
echo "═══════════════════════════════════════"
echo ""
echo "  Folder:  dist-release/Stride/          ($FOLDER_SIZE)"
echo "  Zip:     dist-release/Stride_v${VERSION}_Windows.zip  ($ZIP_SIZE)"
echo ""
echo "  Upload the .zip to Lemon Squeezy."
echo ""
