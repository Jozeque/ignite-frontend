#!/bin/bash
# ─── Stride Build Script — macOS (cross-compiled from Windows) ─────────
# Builds an UNSIGNED Mac .app bundle from a Windows host. For beta/dev use only.
# For signed production releases, run this on an actual Mac with Apple Dev ID.
#
# Usage:
#   bash build-mac.sh               # default: arm64 (Apple Silicon M1+)
#   MAC_ARCH=x64 bash build-mac.sh  # Intel Macs
#   MAC_ARCH=universal bash build-mac.sh  # both (2x size, may fail on Windows)
#
# Output: dist-release-mac/Stride/ + dist-release-mac/Stride_v<VERSION>_Mac.zip
#
# First-launch note for the Mac user:
#   The .app is unsigned so Gatekeeper will block it. Solve with:
#     xattr -cr /path/to/Stride.app
#   Then double-click normally. See README.txt inside the zip.

set -e
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
APP_DIR="$SCRIPT_DIR/app"
M4L_DIR="$SCRIPT_DIR/m4l"
DIST="$SCRIPT_DIR/dist-release-mac"
VERSION=$(node -e "console.log(require('./app/package.json').version)")

# Target architecture. Default arm64 (2020+ Macs). Override with MAC_ARCH env var.
MAC_ARCH="${MAC_ARCH:-arm64}"

OBFUSCATOR="$APP_DIR/node_modules/.bin/javascript-obfuscator"

echo "═══════════════════════════════════════"
echo "  STRIDE BUILD — v${VERSION} (Mac, ${MAC_ARCH}, UNSIGNED)"
echo "═══════════════════════════════════════"
echo ""

# ─── Step 1: Build Electron app for Mac (direct into dist-release-mac) ──
# NOTE: electron-builder v25 dropped Windows→Mac cross-compile. We use
# @electron/packager instead.
#
# Critical: we ask packager to output DIRECTLY into $DIST, so we only ever
# need to `mv` (rename) the .app into its final slot — no cross-filesystem
# copy. This avoids Git Bash's inability to recreate Mac framework dangling
# symlinks during a cp/tar copy on Windows NTFS.
echo "[1/5] Building Electron app for Mac (${MAC_ARCH})..."

# Clean target dir before packager writes into it
rm -rf "$DIST" 2>/dev/null || true
if [ -d "$DIST/Stride" ]; then
    DIST="${DIST}_$(date +%s)"
fi
mkdir -p "$DIST"

# @electron/packager walks the entire source dir. On Windows, the --ignore
# regex uses backslash-separated paths, so a POSIX-style pattern like
# "^/dist" never matches. To keep the Windows build's dist/ artifacts out
# of the Mac asar (they'd add ~250MB of win-unpacked files), temporarily
# rename app/dist/ out of the way, run packager, restore it on exit.
DIST_HIDDEN=""
if [ -d "$APP_DIR/dist" ]; then
    # Move OUTSIDE the packager source dir (not inside app/) so packager
    # doesn't walk into it. Placing it in stride-vst/ keeps it on the same
    # filesystem so mv is instant.
    DIST_HIDDEN="$SCRIPT_DIR/.app_dist_hidden_$$"
    mv "$APP_DIR/dist" "$DIST_HIDDEN"
    trap 'if [ -n "$DIST_HIDDEN" ] && [ -d "$DIST_HIDDEN" ]; then mv "$DIST_HIDDEN" "$APP_DIR/dist" 2>/dev/null || true; fi' EXIT
fi

cd "$APP_DIR"

# @electron/packager flags:
#   .                 — source dir (app/ folder)
#   Stride            — product name → produces Stride.app
#   --platform=darwin — macOS target
#   --arch            — arm64 | x64 | universal
#   --out             — output parent dir (absolute, points into dist-release-mac)
#   --asar            — bundle app into Contents/Resources/app.asar
#   --overwrite       — replace existing output for this arch
#   --ignore          — skip dist/ in source to avoid recursive inclusion
#   --prune=true      — strip devDependencies from bundled node_modules
npx --yes @electron/packager . Stride \
    --platform=darwin \
    --arch=${MAC_ARCH} \
    --out="$DIST" \
    --asar \
    --overwrite \
    --app-bundle-id=io.stridehub.canvas \
    --app-category-type=public.app-category.music \
    --app-version="${VERSION}" \
    --build-version="${VERSION}" \
    --ignore="^/dist($|/)" \
    --prune=true 2>&1 | tail -20

# packager writes to $DIST/Stride-darwin-<arch>/Stride.app
MAC_OUT=""
for candidate in "Stride-darwin-${MAC_ARCH}" "Stride-darwin-universal" "Stride-darwin-arm64" "Stride-darwin-x64"; do
    if [ -d "$DIST/$candidate/Stride.app" ]; then
        MAC_OUT="$DIST/$candidate"
        break
    fi
done

if [ -z "$MAC_OUT" ]; then
    echo "ERROR: Mac build failed — Stride.app not found. Contents of $DIST:"
    ls -la "$DIST" 2>/dev/null || true
    exit 1
fi
echo "      Stride.app built at $MAC_OUT"

# Verify .app bundle structure — fail fast if anything critical is missing
REQUIRED_PATHS=(
    "Stride.app/Contents/Info.plist"
    "Stride.app/Contents/MacOS/Stride"
    "Stride.app/Contents/Resources/app.asar"
)
for rel in "${REQUIRED_PATHS[@]}"; do
    if [ ! -e "$MAC_OUT/$rel" ]; then
        echo "ERROR: .app bundle is broken — missing $rel"
        exit 1
    fi
done
echo "      .app bundle structure verified"

# ─── Step 2: Assemble distribution folder ────────────────
echo "[2/5] Assembling distribution..."
mkdir -p "$DIST/Stride/M4L"
mkdir -p "$DIST/Stride/Guide"

# Move the .app into final slot — rename on same filesystem, no file copy.
# This preserves symlinks because nothing is recreated.
mv "$MAC_OUT/Stride.app" "$DIST/Stride/Stride.app"
rm -rf "$MAC_OUT"

if [ ! -d "$DIST/Stride/Stride.app/Contents/Frameworks/Electron Framework.framework" ]; then
    echo "ERROR: .app move failed — framework not present at final location"
    exit 1
fi

# Copy M4L device + node scripts (flat layout matches Windows build)
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
for img in step2.png step4.png step6.png step7.png; do
    [ -f "$APP_DIR/assets/$img" ] && cp "$APP_DIR/assets/$img" "$DIST/Stride/Guide/"
done

# Copy tutorial videos (if present)
for vid in "$SCRIPT_DIR"/*.mov "$SCRIPT_DIR"/*.mp4; do
    [ -f "$vid" ] && cp "$vid" "$DIST/Stride/Guide/"
done

echo "      Distribution assembled"

# ─── Step 3: Obfuscate source code ──────────────────────
echo "[3/5] Obfuscating source code..."
ASAR="$DIST/Stride/Stride.app/Contents/Resources/app.asar"
ASAR_TMP="$DIST/_asar_tmp"

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
STRIDE — Sound Design Engine for Ableton Live (macOS beta)
============================================================

⚠ FIRST LAUNCH — READ THIS FIRST
---------------------------------
This is an UNSIGNED beta build cross-compiled from Windows.
macOS Gatekeeper will block it on first launch with either:
  "Stride.app is damaged and can't be opened"
or
  "Stride.app cannot be opened because it is from an unidentified developer"

To fix (ONE TIME ONLY — after this, it launches normally):

  1. Copy Stride.app anywhere you want (Applications folder works).
  2. Open Terminal (press Cmd+Space, type "Terminal", press Enter).
  3. Paste this command and press Enter (adjust path if needed):

       xattr -cr "/Applications/Stride.app"

  4. If step 3 doesn't work, also run:

       chmod +x "/Applications/Stride.app/Contents/MacOS/Stride"

  5. Now double-click Stride.app — it should launch.

If you still get a Gatekeeper warning, right-click Stride.app → Open →
click "Open" in the dialog.

INSTALLATION
------------

1. STRIDE CANVAS (this app)
   - Move Stride.app to /Applications or wherever you want
   - Follow the First Launch steps above on the first run
   - Enter your license key when prompted

2. STRIDELINK (Max for Live device)
   - Open the M4L/ folder in this directory
   - Drag "StrideLink.amxd" onto any MIDI track in Ableton Live
   - The device bridges Ableton and the Stride Canvas via localhost:9100

REQUIREMENTS
------------
- macOS 10.15 (Catalina) or later
- Ableton Live 11+ (Suite, or Standard + Max for Live add-on)
- Python 3 (python.org or: brew install python3)

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

# ─── Step 5: Zip (Python, preserves symlinks in Mac .app bundle) ─
# PowerShell Compress-Archive follows symlinks and fails on dangling chains
# inside Mac framework bundles. Python's zipfile lets us write symlink
# entries manually with the Unix symlink mode bit set.
echo "[5/5] Creating zip..."
cd "$DIST"
rm -f "Stride_v${VERSION}_Mac.zip"

SRC_DIR="Stride" ZIP_PATH="Stride_v${VERSION}_Mac.zip" python3 - <<'PYEOF'
import os, sys, zipfile, stat

src_dir = os.environ['SRC_DIR']
zip_path = os.environ['ZIP_PATH']

# Mach-O magic bytes — identifies Mac binaries (executables, .dylib, frameworks)
# that must have the +x bit set for macOS to load them.
MACHO_MAGIC = {
    b'\xcf\xfa\xed\xfe',  # Mach-O 64-bit LE (modern Mac binaries)
    b'\xce\xfa\xed\xfe',  # Mach-O 32-bit LE
    b'\xfe\xed\xfa\xcf',  # Mach-O 64-bit BE
    b'\xfe\xed\xfa\xce',  # Mach-O 32-bit BE
    b'\xca\xfe\xba\xbe',  # fat binary (multi-arch)
    b'\xbe\xba\xfe\xca',  # fat binary (reversed)
}

def read_head(path, n=4):
    try:
        with open(path, 'rb') as f:
            return f.read(n)
    except OSError:
        return b''

symlink_count = 0
file_count = 0
exec_count = 0

with zipfile.ZipFile(zip_path, 'w', compression=zipfile.ZIP_DEFLATED, allowZip64=True) as zf:
    for dirpath, dirnames, filenames in os.walk(src_dir, followlinks=False):
        # Directory symlinks show up in dirnames; pull them out and don't recurse
        dir_entries = []
        for d in list(dirnames):
            full = os.path.join(dirpath, d)
            if os.path.islink(full):
                dir_entries.append((d, full))
                dirnames.remove(d)

        entries = [(f, os.path.join(dirpath, f)) for f in filenames] + dir_entries

        for name, full in entries:
            rel = os.path.relpath(full, start='.')
            arcname = rel.replace(os.sep, '/')

            if os.path.islink(full):
                # Symlink entry: body = target path, normalize backslashes
                target = os.readlink(full).replace('\\', '/')
                zi = zipfile.ZipInfo(arcname)
                zi.create_system = 3  # Unix
                zi.external_attr = (stat.S_IFLNK | 0o777) << 16
                zf.writestr(zi, target)
                symlink_count += 1
            else:
                with open(full, 'rb') as fh:
                    data = fh.read()
                # Detect Mach-O binary → must be executable on macOS
                is_macho = len(data) >= 4 and data[:4] in MACHO_MAGIC
                unix_mode = 0o100755 if is_macho else 0o100644
                if is_macho:
                    exec_count += 1
                zi = zipfile.ZipInfo.from_file(full, arcname)
                zi.create_system = 3  # Unix
                zi.external_attr = unix_mode << 16
                zi.compress_type = zipfile.ZIP_DEFLATED
                zf.writestr(zi, data)
                file_count += 1

print(f"      zipped: {file_count} files ({exec_count} Mach-O execs), {symlink_count} symlinks")
PYEOF

if [ ! -f "Stride_v${VERSION}_Mac.zip" ]; then
    echo "ERROR: zip creation failed"
    exit 1
fi

ZIP_SIZE=$(du -h "Stride_v${VERSION}_Mac.zip" | cut -f1)
FOLDER_SIZE=$(du -sh "Stride/" | cut -f1)

echo ""
echo "═══════════════════════════════════════"
echo "  MAC BUILD COMPLETE (${MAC_ARCH})"
echo "═══════════════════════════════════════"
echo ""
echo "  Folder:  dist-release-mac/Stride/                     (${FOLDER_SIZE})"
echo "  Zip:     dist-release-mac/Stride_v${VERSION}_Mac.zip  (${ZIP_SIZE})"
echo ""
echo "  ⚠ UNSIGNED build — cross-compiled from Windows."
echo "    Mac user must run 'xattr -cr Stride.app' on first launch."
echo "    Full instructions in README.txt inside the zip."
echo ""
