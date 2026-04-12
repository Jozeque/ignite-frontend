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

# Copy tutorial videos (if present)
for vid in "$SCRIPT_DIR"/*.mov "$SCRIPT_DIR"/*.mp4; do
    [ -f "$vid" ] && cp "$vid" "$DIST/Stride/Guide/"
done

echo "      Distribution assembled"

# ─── Step 3: Obfuscate source code ──────────────────────
echo "[3/5] Obfuscating source code..."
ASAR="$DIST/Stride/resources/app.asar"
ASAR_TMP="$DIST/_asar_tmp"

# Extract asar
npx asar extract "$ASAR" "$ASAR_TMP"

# Obfuscate Electron app JS files
for f in main.js preload.js renderer/canvas.js renderer/ws-client.js renderer/cloud-client.js; do
    echo "      obfuscate: $f"
    "$OBFUSCATOR" "$ASAR_TMP/$f" --output "$ASAR_TMP/$f" \
        --compact true \
        --control-flow-flattening true \
        --control-flow-flattening-threshold 0.3 \
        --string-array true \
        --string-array-encoding base64 \
        --string-array-threshold 0.5 \
        --rename-globals false \
        --self-defending false
done

# Repack asar
npx asar pack "$ASAR_TMP" "$ASAR"
rm -rf "$ASAR_TMP"

# Obfuscate M4L Node files
for f in server.js scanner.js writer.js alc-generator.js alc-injector.js; do
    echo "      obfuscate: M4L/$f"
    "$OBFUSCATOR" "$DIST/Stride/M4L/$f" --output "$DIST/Stride/M4L/$f" \
        --compact true \
        --control-flow-flattening true \
        --control-flow-flattening-threshold 0.3 \
        --string-array true \
        --string-array-encoding base64 \
        --string-array-threshold 0.5 \
        --rename-globals false \
        --self-defending false
done

# scanner_max.js uses Max's older JS engine — lighter obfuscation
echo "      obfuscate: M4L/scanner_max.js (Max JS)"
"$OBFUSCATOR" "$DIST/Stride/M4L/scanner_max.js" --output "$DIST/Stride/M4L/scanner_max.js" \
    --compact true \
    --string-array true \
    --string-array-encoding base64 \
    --string-array-threshold 0.5 \
    --rename-globals false \
    --self-defending false \
    --control-flow-flattening false \
    --target browser

echo "      Source code obfuscated"

# ─── Step 4: Add README ─────────────────────────────────
echo "[4/5] Adding README..."
cat > "$DIST/Stride/README.txt" << 'READMEEOF'
STRIDE — Sound Design Engine for Ableton Live
===============================================

INSTALLATION
------------

1. STRIDE CANVAS (this app)
   - Run Stride.exe from this folder
   - Enter your license key when prompted
   - Keep this folder anywhere you like

2. STRIDELINK (Max for Live device)
   - Open the M4L folder in this directory
   - Drag "StrideLink.amxd" onto any MIDI track in Ableton Live
   - The device bridges Ableton and the Stride Canvas

REQUIREMENTS
------------
- Ableton Live 11+ (Suite, or Standard + Max for Live add-on)
- Python 3 installed on your system (python.org)
- Windows 10/11

QUICK START
-----------
1. Drop StrideLink.amxd on a track with an Instrument Rack
2. Click "Scan Mapped" in the M4L device (or in the Canvas sidebar)
3. Draw automation curves on the canvas
4. Click "Apply to Clip"
5. Drag the generated .alc file onto your clip slot

Your racks, reborn.

SUPPORT: yossi.bozo112@gmail.com
WEB: https://stridehub.io
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
