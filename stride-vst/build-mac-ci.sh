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

# ─── Step 2a: @electron/packager — build the unsigned .app ─
# We deliberately DO NOT use electron-builder on macOS. Every time we
# did, it completed the sign step with "Application signed" and then
# hung forever with zero output — with and without the afterSign
# hook, with and without --publish=never. Possibly a node/signal
# plumbing bug in electron-builder@25 on macos-14 arm64.
# @electron/packager is simpler and well-behaved: it just builds the
# .app bundle and exits. We sign + notarize + staple manually below.
echo ""
echo "[2a/4] Running @electron/packager (unsigned .app build)..."
cd "$APP_DIR"
rm -rf dist

# packager flags:
#   .                 source directory (app/)
#   Stride            product name → Stride.app
#   --platform=darwin macOS target
#   --arch=arm64      Apple Silicon native
#   --out=dist        output dir
#   --asar            bundle JS into app.asar
#   --overwrite       replace existing output
#   --ignore          skip dist/ in source to avoid recursive inclusion
#   --prune=true      strip devDependencies from bundled node_modules
npx --yes @electron/packager . Stride \
    --platform=darwin \
    --arch=arm64 \
    --out=dist \
    --asar \
    --overwrite \
    --app-bundle-id=io.stridehub.canvas \
    --app-category-type=public.app-category.music \
    --app-version="${VERSION}" \
    --build-version="${VERSION}" \
    --ignore="^/dist($|/)" \
    --prune=true 2>&1 | tail -30

# packager writes to dist/Stride-darwin-arm64/Stride.app
MAC_OUT="$APP_DIR/dist/Stride-darwin-arm64"
if [ ! -d "$MAC_OUT/Stride.app" ]; then
    echo "❌ Stride.app not found after packager. dist/ contents:"
    find dist -maxdepth 3 -type d
    exit 1
fi
echo "      Stride.app built at $MAC_OUT"

# Verify .app bundle structure — fail fast if anything critical is missing
for rel in "Stride.app/Contents/Info.plist" \
           "Stride.app/Contents/MacOS/Stride" \
           "Stride.app/Contents/Resources/app.asar" \
           "Stride.app/Contents/Frameworks/Electron Framework.framework"; do
    if [ ! -e "$MAC_OUT/$rel" ]; then
        echo "❌ .app bundle is broken — missing $rel"
        exit 1
    fi
done
echo "      ✅ .app bundle structure verified"

# ─── Step 2b: Sign the .app with @electron/osx-sign (direct library call) ─
# We call @electron/osx-sign as a node library here instead of going through
# electron-builder. The osx-sign output we saw earlier always completed
# cleanly — the hang was ALWAYS in electron-builder's wrapper code after
# osx-sign returned. Cutting electron-builder out of the picture removes
# that failure mode entirely.
#
# @electron/osx-sign is already installed as a transitive dep of
# electron-builder (via npm ci), so it's available in node_modules.
echo ""
echo "[2b/4] Signing .app with @electron/osx-sign..."

# Identity string we already verified in the "Verify signing identity is
# present" workflow step. The apple-actions/import-codesign-certs action
# imported the cert into a keychain that codesign can find automatically.
IDENTITY="Developer ID Application: Yossi Bozo (B3Y92NHRMC)"
ENTITLEMENTS="$APP_DIR/build/entitlements.mac.plist"

node -e "
const { signAsync } = require('@electron/osx-sign');
(async () => {
  const log = (msg) => process.stdout.write('  [sign] ' + msg + '\n');
  log('start');
  try {
    await signAsync({
      app: '$MAC_OUT/Stride.app',
      identity: '$IDENTITY',
      hardenedRuntime: true,
      entitlements: '$ENTITLEMENTS',
      entitlementsInherit: '$ENTITLEMENTS',
      platform: 'darwin',
      type: 'distribution',
      gatekeeperAssess: false,
      optionsForFile: () => ({
        hardenedRuntime: true,
        entitlements: '$ENTITLEMENTS',
      }),
    });
    log('signed OK');
    process.exit(0);
  } catch (e) {
    log('FAILED: ' + (e && e.message || e));
    process.exit(1);
  }
})();
" 2>&1

echo "      Verifying codesign signature..."
codesign --verify --deep --strict --verbose=2 "$MAC_OUT/Stride.app" 2>&1 || {
    echo "❌ Signature verification failed"
    exit 1
}
echo "      ✅ Signed cleanly"

# ─── Step 2c: Manual notarization via xcrun notarytool ─
# Zip the signed .app, submit it to Apple, wait for verdict, staple.
# stdbuf forces line-buffered output so we see notarytool's progress.
echo ""
echo "[2c/4] Submitting to Apple notarization..."
NOTARIZE_ZIP="$APP_DIR/dist/Stride-for-notarize.zip"
rm -f "$NOTARIZE_ZIP"
ditto -c -k --keepParent "$MAC_OUT/Stride.app" "$NOTARIZE_ZIP"
echo "      Zip ready ($(du -h "$NOTARIZE_ZIP" | cut -f1)) — uploading to Apple..."

xcrun notarytool submit "$NOTARIZE_ZIP" \
    --apple-id "$APPLE_ID" \
    --password "$APPLE_APP_SPECIFIC_PASSWORD" \
    --team-id "$APPLE_TEAM_ID" \
    --wait 2>&1 | tee "$APP_DIR/dist/notarize.log"

NOTARIZE_STATUS=${PIPESTATUS[0]}
rm -f "$NOTARIZE_ZIP"

if [ "$NOTARIZE_STATUS" -ne 0 ]; then
    echo "❌ notarytool submit failed (exit $NOTARIZE_STATUS)"
    exit 1
fi

# Staple the notarization ticket onto the .app so Gatekeeper doesn't
# need to phone Apple on first launch
echo "      Stapling notarization ticket..."
xcrun stapler staple "$MAC_OUT/Stride.app" 2>&1 || {
    echo "❌ Stapler failed"
    exit 1
}
xcrun stapler validate "$MAC_OUT/Stride.app" 2>&1 || {
    echo "⚠  Stapler validate failed — may need to rerun workflow"
}
echo "      ✅ Signed + notarized + stapled"

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

1. Drag Stride.app into your /Applications folder.
2. Keep the M4L/ folder and the Guide/ folder next to
   Stride.app (or anywhere you like - the M4L device finds
   the app either next to itself or in /Applications).
3. You don't launch Stride manually. Drag StrideLink.amxd
   onto a track in Ableton, click "Open Canvas" on the
   device - Stride launches and asks for your license key.
   Paste it there and you're in. Signed with an Apple
   Developer ID and notarized by Apple, no security bypass.
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
 5. On StrideLink, click "Open Canvas" - Stride launches (or
    focuses if it's already open). Click "Scan Mapped".
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
  -> Click "Open Canvas" on the device again.

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
