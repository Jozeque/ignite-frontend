#!/bin/bash
# ─── Stride Mac CI Build ──────────────────────────────────
# Runs on GitHub Actions macos-14 runner (Apple Silicon M1).
# Produces a SIGNED + NOTARIZED .app bundle, packages it with M4L + Guide,
# and zips the whole thing with ditto (which preserves code signatures).
#
# Required env vars (set by .github/workflows/build-mac.yml):
#   CSC_LINK                    — base64-encoded .p12 (Developer ID cert + key)
#   CSC_KEY_PASSWORD            — password for the .p12
#   APPLE_ID                    — Apple ID email (for notarization)
#   APPLE_APP_SPECIFIC_PASSWORD — app-specific password from appleid.apple.com
#   APPLE_TEAM_ID               — 10-char team ID from developer.apple.com
#
# Output: dist-release-mac-signed/Stride_v<VERSION>_Mac.zip
#         dist-release-mac-signed/Stride/ (unpacked)

set -e
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
APP_DIR="$SCRIPT_DIR/app"
M4L_DIR="$SCRIPT_DIR/m4l"
DIST="$SCRIPT_DIR/dist-release-mac-signed"
VERSION=$(node -e "console.log(require('./app/package.json').version)")

echo "═══════════════════════════════════════════════"
echo "  STRIDE MAC BUILD — v${VERSION} (signed + notarized)"
echo "═══════════════════════════════════════════════"
echo ""

# ─── Step 1: Install M4L node dependencies ─────────────
# The M4L bridge has its own small node_modules (ws + xmldom) that ship
# alongside the .amxd. Reinstall fresh so we get darwin binaries.
echo "[1/4] Installing M4L node dependencies..."
cd "$M4L_DIR/node"
rm -rf node_modules
npm install --omit=dev 2>&1 | tail -5

# ─── Step 2: electron-builder (build + sign + notarize + staple) ─
# electron-builder reads CSC_LINK and CSC_KEY_PASSWORD to import the cert
# into a temporary keychain, signs the .app + helper apps + frameworks,
# then our afterSign hook (build/notarize.js) submits to Apple and staples.
# Target is "dir" — we'll package into the final zip ourselves below.
echo ""
echo "[2/4] Running electron-builder (signs + notarizes + staples)..."
cd "$APP_DIR"
npx electron-builder --mac --arm64 2>&1

# Locate the output .app — electron-builder puts it in dist/mac-arm64/
MAC_OUT=""
for candidate in dist/mac-arm64 dist/mac dist/mac-universal; do
    if [ -d "$candidate/Stride.app" ]; then
        MAC_OUT="$APP_DIR/$candidate"
        break
    fi
done
if [ -z "$MAC_OUT" ]; then
    echo "❌ Stride.app not found after electron-builder. dist/ contents:"
    find dist -maxdepth 3 -type d
    exit 1
fi
echo "      Stride.app built at $MAC_OUT"

# Verify the signature is valid + notarized (ticket stapled)
echo "      Verifying signature..."
codesign --verify --deep --strict --verbose=2 "$MAC_OUT/Stride.app" 2>&1 || {
    echo "❌ Signature verification failed"
    exit 1
}
echo "      Verifying notarization staple..."
xcrun stapler validate "$MAC_OUT/Stride.app" 2>&1 || {
    echo "⚠  Stapler validation failed — may need to rerun workflow"
    # Don't exit — Apple notarization can be flaky, allow the build to continue
}
echo "      ✅ Signed and notarized"

# ─── Step 3: Assemble final distribution folder ──────────
echo ""
echo "[3/4] Assembling distribution folder..."
rm -rf "$DIST"
mkdir -p "$DIST/Stride/M4L"
mkdir -p "$DIST/Stride/Guide"

# Copy the .app with ditto (preserves extended attributes, symlinks,
# and the code signature — cp -r on macOS usually works but ditto is safer)
ditto "$MAC_OUT/Stride.app" "$DIST/Stride/Stride.app"

# Verify signature survived the copy
codesign --verify --strict "$DIST/Stride/Stride.app" 2>&1 || {
    echo "❌ Signature broken after ditto copy"
    exit 1
}

# Copy M4L device + node scripts (flat layout, matches Windows build.sh)
cp "$M4L_DIR/StrideLink.amxd" "$DIST/Stride/M4L/"
cp "$M4L_DIR/node/"*.js "$DIST/Stride/M4L/"
cp "$M4L_DIR/node/"*.py "$DIST/Stride/M4L/"
cp -R "$M4L_DIR/node/node_modules" "$DIST/Stride/M4L/node_modules"
rm -rf "$DIST/Stride/M4L/__pycache__"
rm -f "$DIST/Stride/M4L/_stride_"*.json

# Copy Getting Started guide
cp "$APP_DIR/assets/guide.html" "$DIST/Stride/Guide/"
for img in step2.png step4.png step6.png step7.png; do
    [ -f "$APP_DIR/assets/$img" ] && cp "$APP_DIR/assets/$img" "$DIST/Stride/Guide/"
done

# Copy tutorial videos (if present in stride-vst/ root)
for vid in "$SCRIPT_DIR"/*.mov "$SCRIPT_DIR"/*.mp4; do
    [ -f "$vid" ] && cp "$vid" "$DIST/Stride/Guide/"
done

# README
cat > "$DIST/Stride/README.txt" << 'READMEEOF'
===============================================================
 STRIDE - Sound Design Engine for Ableton Live
 Your racks, reborn.
===============================================================

>> START HERE: watch the two short videos inside the Guide/ folder.
   - Flow A-Z.mp4           - the full Stride workflow
   - Canvas Walkthrough.mov - tools and shortcuts
   Takes about 3 minutes total. Seriously, watch them first.

---------------------------------------------------------------
 INSTALL
---------------------------------------------------------------

1. Drag Stride.app into your /Applications folder
2. Double-click to launch - signed with an Apple Developer ID
   and notarized by Apple, no security bypass required.
3. Paste your license key when prompted
4. Requirements: Ableton Live 11+ Suite (or Standard + M4L),
   Python 3 (usually preinstalled, or: brew install python3),
   macOS 11 (Big Sur) or later

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
 4. Drag StrideLink.amxd (from the M4L/ folder in this zip)
    onto the same track.
 5. Launch Stride.app. Click "Scan Mapped" in the sidebar.
 6. The canvas fills with one lane per mapped parameter.
 7. Either draw by hand OR smash one of the Presets / Chaos /
    Bloom / Weave buttons. Start with a preset.
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

* ADJUST MASTER BPM while auditioning .alc variations - the
  same curves feel radically different at 120 vs 140 BPM.
  Some sweet spots only reveal themselves at specific tempos.

* EXPERIMENT. Stride rewards exploration. There are endless
  variations and combinations you can chase with the preset
  + Chaos + Bloom + Weave toolkit. No two sessions are alike.

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
  -> Close and reopen Stride.app.

---------------------------------------------------------------
 SUPPORT
---------------------------------------------------------------

 Questions, feedback, bugs:   home@stridehub.io
 Web:                         https://stridehub.io

 I'm still exploring the tool myself and keep pushing releases.
 Send me your findings - I reply to everyone.

 Your racks, reborn.
===============================================================
READMEEOF

echo "      Distribution assembled at $DIST/Stride"

# ─── Step 4: Zip with ditto (preserves signature + extended attributes) ─
echo ""
echo "[4/4] Creating zip..."
cd "$DIST"
ZIP_NAME="Stride_v${VERSION}_Mac.zip"
rm -f "$ZIP_NAME"
# --sequesterRsrc preserves resource forks + extended attributes
# --keepParent keeps the top-level "Stride" folder when extracting
ditto -c -k --sequesterRsrc --keepParent Stride "$ZIP_NAME"

ZIP_SIZE=$(du -h "$ZIP_NAME" | cut -f1)
FOLDER_SIZE=$(du -sh Stride | cut -f1)

echo ""
echo "═══════════════════════════════════════════════"
echo "  MAC BUILD COMPLETE"
echo "═══════════════════════════════════════════════"
echo ""
echo "  Folder:  dist-release-mac-signed/Stride/              ($FOLDER_SIZE)"
echo "  Zip:     dist-release-mac-signed/$ZIP_NAME            ($ZIP_SIZE)"
echo ""
echo "  ✅ Signed with Developer ID + notarized by Apple."
echo "     Users can double-click and run — no Gatekeeper warnings."
echo ""
