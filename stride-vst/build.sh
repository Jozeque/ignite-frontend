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

# ─── Step 3c: Embed StrideInject Remote Script for the install flow ──
# Stride 2.0: "Install to Ableton" copies this into <User Library>/Remote
# Scripts/StrideInject so Ableton lists it as a Control Surface (direct inject).
# main.js finds it via process.resourcesPath/StrideInject. Shipped as plain .py
# (Ableton runs Remote Scripts from source; the JS obfuscator doesn't apply).
echo "      Embedding StrideInject into resources/StrideInject/ ..."
mkdir -p "$DIST/Stride/resources/StrideInject"
cp "$SCRIPT_DIR/remote_script/StrideInject/"*.py "$DIST/Stride/resources/StrideInject/"
rm -rf "$DIST/Stride/resources/StrideInject/__pycache__"
echo "      StrideInject embedded at resources/StrideInject/"

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
 INSTALL  (Windows)
---------------------------------------------------------------

1. Unzip the Stride folder to your Desktop or Documents (NOT
   Downloads - Windows sometimes cleans it). Keep Stride.exe and
   the M4L/ folder together inside the Stride/ folder.

2. Double-click Stride.exe.
   FIRST LAUNCH ONLY: Windows SmartScreen shows "Windows protected
   your PC" -> click "More info" -> "Run anyway". One time only
   (Stride isn't code-signed for Windows yet). Never asks again.

3. Enter your license key when Stride asks for it (from your
   purchase email).

---------------------------------------------------------------
 ONE-TIME SETUP  (do this once)
---------------------------------------------------------------

1. In Stride's title bar, click "Install to Ableton". This installs
   StrideLink (the Max device) AND StrideInject (the engine that
   writes your curves straight into clips) into your Ableton User
   Library.

2. In Ableton: Preferences -> Link/Tempo/MIDI -> Control Surface
   -> choose "StrideInject". Once, and you're set.

Requirements: Ableton Live 11+ Suite (or Standard + Max for Live),
Windows 10 or 11. (Python 3 only if the rare Python fallback fires.)

---------------------------------------------------------------
 YOUR WORKFLOW
---------------------------------------------------------------

 1. In Ableton's browser: User Library -> Stride -> drag StrideLink
    onto the track with your instrument.

 2. MAP YOUR PARAMETERS: arm record (F9), nudge each knob you want
    to modulate, then disarm. Stride pulls them in as lanes
    AUTOMATICALLY - on open and whenever you switch back to it.

 3. Hit a MOTION tool (Chaos, Neuro, Prism, Bloom, Reflector, S&H).
    It lays modulation across EVERY lane in one click. Then reshape
    by hand or hit Mutate until it feels right.

 4. In Ableton, select the MIDI clip you want (double-click it so
    it's open in the Detail view - that's where Stride writes).

 5. Click "Inject to Clip". Stride writes your curves straight into
    that clip. No file, no drag, no export.

 6. Hit play. Your rack is modulating. Record the take when it's right.

 WANT MORE? Map more params (arm + record) -> they auto-appear in
 Stride -> draw curves -> Inject to Clip again. The new params join
 the modulated chain. No re-setup, no re-scan.

---------------------------------------------------------------
 TIPS
---------------------------------------------------------------

* MOTION tools hit every unlocked lane at once - the fastest way to
  a fully modulated rack. Start there, then refine by hand.

* ANCHOR + COMPLEMENT: find the one curve you love most, click that
  lane to make it active, then hit Bloom or Prism - the other lanes
  rearrange to complement your anchor instead of fighting it.

* LOCK a lane (the lock icon) to protect it - Motion tools and the
  edit sliders skip locked lanes.

* The canvas auto-saves per rack. Switch racks and come back - your
  curves are still there.

---------------------------------------------------------------
 TROUBLESHOOTING
---------------------------------------------------------------

"Inject to Clip" errors or does nothing
  -> Enable StrideInject: Ableton Preferences -> Link/Tempo/MIDI ->
     Control Surface -> StrideInject (the one-time setup step).
  -> Select a MIDI clip first (open it in the Detail view).

No lanes appear in Stride
  -> Map parameters first: open an automation lane for each knob
     (arm record + nudge, or draw a point). Then Stride syncs them.
  -> Check StrideLink is on the SAME track as your rack.

Canvas says "Disconnected"
  -> In Ableton, right-click StrideLink -> Delete -> drag it back
     onto the track, then click "Open Canvas" again.

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
