#!/bin/bash
# ─── Stride Build Script — macOS (cross-compiled from Windows) ─────────
# Builds an UNSIGNED Mac .app bundle from a Windows host. For beta/dev use only.
# For signed production releases, run this on an actual Mac with Apple Dev ID.
#
# Usage:
#   bash build-mac.sh                # default: universal (Intel + Apple Silicon)
#   MAC_ARCH=arm64 bash build-mac.sh # Apple Silicon only (faster dev build)
#   MAC_ARCH=x64 bash build-mac.sh   # Intel Macs only
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

# Target architecture. Default universal so the produced .app runs on both
# Intel and Apple Silicon. Override with MAC_ARCH env var for faster dev builds.
MAC_ARCH="${MAC_ARCH:-universal}"

OBFUSCATOR="$APP_DIR/node_modules/.bin/javascript-obfuscator"

echo "═══════════════════════════════════════"
echo "  STRIDE BUILD — v${VERSION} (Mac, ${MAC_ARCH}, UNSIGNED)"
echo "═══════════════════════════════════════"
echo ""

# ─── Step 0: Regenerate .icns from assets/icon.png ─────
echo "[0/5] Regenerating build/icon.icns from assets/icon.png..."
(cd "$APP_DIR" && node -e "const p=require('png2icons');const fs=require('fs');const d=fs.readFileSync('assets/icon.png');const icns=p.createICNS(d,p.BILINEAR,0);if(!icns){process.exit(1);}fs.writeFileSync('build/icon.icns',icns);console.log('build/icon.icns ->',icns.length,'bytes');")

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
    --icon=build/icon.icns \
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

# Tutorial videos are NOT bundled — they live on YouTube + the
# stridehub.io/welcome page (linked from the purchase email). Keeps the
# download light and lets us update the videos without re-shipping the app.

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
for f in server.js scanner.js writer.js inject-writer.js alc-generator.js alc-injector.js; do
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

# ─── Step 3b: Embed M4L + StrideInject inside the .app bundle ──────
# main.js resolves both at Contents/Resources/{M4L,StrideInject}
# (process.resourcesPath). The sibling Stride/M4L/ folder above is NOT found
# on Mac (exeDir is Contents/MacOS), so the install flow needs them here too.
# Unsigned beta — no codesign ordering concerns. M4L is the already-obfuscated
# copy; StrideInject ships as plain .py (Ableton runs Remote Scripts from source).
echo "      Embedding M4L + StrideInject into Stride.app/Contents/Resources/ ..."
APP_RES="$DIST/Stride/Stride.app/Contents/Resources"
mkdir -p "$APP_RES/M4L" "$APP_RES/StrideInject"
cp -R "$DIST/Stride/M4L/"* "$APP_RES/M4L/"
cp "$SCRIPT_DIR/remote_script/StrideInject/"*.py "$APP_RES/StrideInject/"
rm -rf "$APP_RES/StrideInject/__pycache__"
if [ ! -f "$APP_RES/StrideInject/__init__.py" ] || [ ! -f "$APP_RES/M4L/StrideLink.amxd" ]; then
    echo "ERROR: bundled M4L/StrideInject payload missing from Stride.app"
    exit 1
fi
echo "      M4L + StrideInject embedded in the .app"

# ─── Step 4: Add README ─────────────────────────────────
echo "[4/5] Adding README..."
cat > "$DIST/Stride/README.txt" << 'READMEEOF'
===============================================================
 STRIDE - Sound Design Engine for Ableton Live (macOS BETA)
 Modulate everything in your session.
===============================================================

>> THIS IS AN UNSIGNED BETA BUILD cross-compiled from Windows.
   macOS Gatekeeper will block it on first launch. To fix,
   ONE TIME ONLY:

   1. Move Stride.app to /Applications (or anywhere you want).
   2. Open Terminal (Cmd+Space, type "Terminal", Enter).
   3. Paste and run:
        xattr -cr "/Applications/Stride.app"
   4. Double-click Stride.app normally - it launches.

   After the first launch, it behaves like any other app.
   (A signed/notarized release is on the way.)

>> START HERE: watch the 3-minute walkthrough at
   https://stridehub.io/welcome  (same link as your purchase email).
   More tutorials live on YouTube: https://www.youtube.com/@strideengine
   Seriously, watch the welcome video first.

---------------------------------------------------------------
 INSTALL  (beta — one Terminal step)
---------------------------------------------------------------

1. Unzip and move Stride.app to /Applications.
2. Run the xattr -cr step ONCE (see FIRST-LAUNCH above) - this
   unsigned beta needs it; the signed release won't.
3. Launch Stride from /Applications and enter your license key
   (from your purchase email).

Requirements: Ableton Live 11+ Suite (or Standard + Max for Live),
macOS 11 (Big Sur) or later.

---------------------------------------------------------------
 ONE-TIME SETUP  (do this once)
---------------------------------------------------------------

1. In Stride's title bar, click "Install to Ableton". This installs
   StrideLink (the Max device) AND StrideInject (the engine that
   writes your curves straight into clips) into your Ableton User
   Library.

2. In Ableton: Preferences -> Link/Tempo/MIDI -> Control Surface
   -> choose "StrideInject". Once, and you're set.

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
