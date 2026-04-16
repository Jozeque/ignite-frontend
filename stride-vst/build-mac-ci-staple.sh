#!/bin/bash
# ─── Stride Mac Build — Stage 2: poll + staple + package ──────────
# Runs in Job 2 of .github/workflows/build-mac.yml.
#
# Takes the signed Stride.app produced in Job 1, polls Apple's notary
# service until the submission is Accepted, staples the ticket, then
# assembles the final distribution zip with M4L + Guide + README.
#
# Required env vars (set by the workflow):
#   APPLE_ID                     Apple ID email
#   APPLE_APP_SPECIFIC_PASSWORD  app-specific password
#   APPLE_TEAM_ID                team ID
#   SUBMISSION_ID                UUID of the submission to poll
#   SIGNED_ZIP                   absolute path to Stride-signed.zip
#
# This script is IDEMPOTENT: you can re-run it any number of times with
# the same SUBMISSION_ID and the same SIGNED_ZIP and it will either
# (a) find that Apple is still processing and poll some more, or
# (b) find that Apple is done and staple + package.
#
# Max wall-clock budget: ~5h 45m (polling) + 15m (assemble + zip).
# GitHub Actions hard ceiling is 360 min per job, so we use 350 for
# the poll phase.

set -e

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
APP_DIR="$SCRIPT_DIR/app"
M4L_DIR="$SCRIPT_DIR/m4l"
DIST="$SCRIPT_DIR/dist-release-mac-signed"

if [ -z "$APPLE_ID" ] || [ -z "$APPLE_APP_SPECIFIC_PASSWORD" ] || [ -z "$APPLE_TEAM_ID" ]; then
    echo "❌ Apple credentials not set"
    exit 1
fi
if [ -z "$SUBMISSION_ID" ]; then
    echo "❌ SUBMISSION_ID not set"
    exit 1
fi
if [ -z "$SIGNED_ZIP" ] || [ ! -f "$SIGNED_ZIP" ]; then
    echo "❌ SIGNED_ZIP not set or file missing: $SIGNED_ZIP"
    exit 1
fi

VERSION=$(node -e "console.log(require('./app/package.json').version)")

echo "═══════════════════════════════════════════════"
echo "  STRIDE MAC STAPLE — v${VERSION}"
echo "═══════════════════════════════════════════════"
echo "  Submission: $SUBMISSION_ID"
echo "  Signed zip: $SIGNED_ZIP"
echo ""

# ─── Step 1: Unzip signed .app ───────────────────────────
# Put it where Job 1's packager put it so any relative paths in the
# original script still work. Recreate the packager output directory.
echo "[1/5] Unzipping signed .app..."
WORK_DIR="$APP_DIR/dist/Stride-darwin-arm64"
rm -rf "$APP_DIR/dist"
mkdir -p "$WORK_DIR"
ditto -x -k "$SIGNED_ZIP" "$WORK_DIR/"

if [ ! -d "$WORK_DIR/Stride.app" ]; then
    echo "❌ Stride.app missing after unzip"
    ls -la "$WORK_DIR"
    exit 1
fi

# Verify signature survived the artifact roundtrip
codesign --verify --deep --strict "$WORK_DIR/Stride.app" 2>&1 || {
    echo "❌ Signature broken after unzip — artifact corruption"
    exit 1
}
echo "      ✅ Signature intact"

# ─── Step 2: Poll notarytool until verdict ────────────────
# Call `notarytool info` every 30s. On transient network error (e.g.
# -1009), retry up to MAX_POLL_FAILS times before giving up. Hard
# wall-clock cap: MAX_WAIT_SEC seconds. When we hit that, we exit
# non-zero but the submission REMAINS valid on Apple's side and you
# can re-run Job 2 / resume-staple later to pick up where we left off.
echo ""
echo "[2/5] Polling Apple for verdict (every 30s)..."

MAX_WAIT_SEC=20400   # 5h 40m — leaves room for 20 min of staple+zip
POLL_INTERVAL=30
POLL_FAILS=0
MAX_POLL_FAILS=20
START_TS=$(date +%s)

while true; do
    ELAPSED=$(( $(date +%s) - START_TS ))
    if [ "$ELAPSED" -gt "$MAX_WAIT_SEC" ]; then
        echo ""
        echo "❌ Poll budget exhausted after ${ELAPSED}s"
        echo ""
        echo "   Apple hasn't returned a verdict yet, but the submission"
        echo "   is still alive on their side. To resume:"
        echo ""
        echo "     1. Go to Actions → Build Mac → Run workflow"
        echo "     2. Set resume_submission_id = $SUBMISSION_ID"
        echo "     3. Set resume_run_id        = <this run's id>"
        echo "     4. Run workflow"
        echo ""
        echo "   Job 2 will download the same signed .app from this run's"
        echo "   artifacts and pick up polling exactly where we stopped."
        exit 1
    fi

    INFO_JSON=$(xcrun notarytool info "$SUBMISSION_ID" \
        --apple-id "$APPLE_ID" \
        --password "$APPLE_APP_SPECIFIC_PASSWORD" \
        --team-id "$APPLE_TEAM_ID" \
        --output-format json 2>&1)
    INFO_STATUS=$?

    if [ "$INFO_STATUS" -ne 0 ]; then
        POLL_FAILS=$((POLL_FAILS + 1))
        echo "      [${ELAPSED}s] poll error #$POLL_FAILS: $(echo "$INFO_JSON" | tail -1)"
        if [ "$POLL_FAILS" -gt "$MAX_POLL_FAILS" ]; then
            echo "❌ Too many consecutive poll failures ($POLL_FAILS) — giving up"
            echo "   Submission is still alive. Re-run Job 2 to continue."
            exit 1
        fi
        sleep "$POLL_INTERVAL"
        continue
    fi
    POLL_FAILS=0

    STATUS=$(echo "$INFO_JSON" | python3 -c "import json,sys; d=json.loads(sys.stdin.read().splitlines()[-1]); print(d.get('status','?'))" 2>/dev/null || echo "?")
    echo "      [${ELAPSED}s] status=$STATUS"

    case "$STATUS" in
        "Accepted")
            echo ""
            echo "      ✅ Apple accepted the submission"
            break
            ;;
        "Invalid"|"Rejected")
            echo ""
            echo "❌ Apple rejected the submission ($STATUS)"
            echo "--- Apple's notarization log ---"
            xcrun notarytool log "$SUBMISSION_ID" \
                --apple-id "$APPLE_ID" \
                --password "$APPLE_APP_SPECIFIC_PASSWORD" \
                --team-id "$APPLE_TEAM_ID" 2>&1 || true
            exit 1
            ;;
        "In Progress"|"?")
            sleep "$POLL_INTERVAL"
            ;;
        *)
            echo "      unknown status '$STATUS' — treating as still in progress"
            sleep "$POLL_INTERVAL"
            ;;
    esac
done

# ─── Step 3: Staple ticket onto Stride.app ─────────────────
echo ""
echo "[3/5] Stapling notarization ticket..."
xcrun stapler staple "$WORK_DIR/Stride.app" 2>&1 || {
    echo "❌ Stapler failed"
    exit 1
}
xcrun stapler validate "$WORK_DIR/Stride.app" 2>&1 || {
    echo "⚠  Stapler validate warning — continuing anyway"
}
echo "      ✅ Signed + notarized + stapled"

# ─── Step 4: Assemble final distribution folder ──────────
# Job 2 needs to install M4L node dependencies fresh (Job 1 didn't do
# this; M4L deps live alongside the .amxd, not inside Stride.app). Then
# copy everything into the Stride/ folder for the final zip.
echo ""
echo "[4/5] Assembling distribution folder..."

# Install M4L node dependencies (ws + xmldom) for inclusion in the zip
echo "      Installing M4L node dependencies..."
cd "$M4L_DIR/node"
rm -rf node_modules
npm install --omit=dev 2>&1 | tail -5
cd "$SCRIPT_DIR"

rm -rf "$DIST"
mkdir -p "$DIST/Stride/M4L"
mkdir -p "$DIST/Stride/Guide"

# Copy the stapled .app with ditto (preserves everything including the
# new notarization ticket)
ditto "$WORK_DIR/Stride.app" "$DIST/Stride/Stride.app"

codesign --verify --strict "$DIST/Stride/Stride.app" 2>&1 || {
    echo "❌ Signature broken after ditto copy"
    exit 1
}

# Re-verify stapler on the copy
xcrun stapler validate "$DIST/Stride/Stride.app" 2>&1 || {
    echo "⚠  Stapler validation on copy failed — zip may still work"
}

# Copy M4L device + node scripts
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

* ANCHOR + COMPLEMENT: hit Chaos, find the single curve you
  love the most, click that lane to make it active, then hit
  Bloom (or Weave) - the rest of the lanes rearrange to
  complement your anchor curve instead of fighting it.
  This is the fastest way to a cohesive modulation pattern.

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

# ─── Step 5: Create DMG + zip ──────────────────────────────
echo ""
echo "[5/5] Creating DMG installer..."
cd "$DIST"

# Stage a DMG source folder:
#   Stride.app          — the signed + notarized app
#   M4L/                — StrideLink.amxd + node scripts
#   Guide/              — guide.html + screenshots + videos
#   README.txt          — install + workflow instructions
#   Applications        — symlink to /Applications for drag-install
DMG_STAGE="$DIST/_dmg_stage"
rm -rf "$DMG_STAGE"
mkdir -p "$DMG_STAGE"
ditto "$DIST/Stride/Stride.app" "$DMG_STAGE/Stride.app"
cp -R "$DIST/Stride/M4L" "$DMG_STAGE/M4L"
cp -R "$DIST/Stride/Guide" "$DMG_STAGE/Guide"
cp "$DIST/Stride/README.txt" "$DMG_STAGE/README.txt"
ln -s /Applications "$DMG_STAGE/Applications"

DMG_NAME="Stride_v${VERSION}_Mac.dmg"
rm -f "$DMG_NAME"

# hdiutil create: built into macOS, no extra deps
#   -volname   — volume name shown in Finder title bar when mounted
#   -srcfolder — source directory to pack into the DMG
#   -ov        — overwrite if exists
#   -format UDZO — compressed (zlib), standard distribution format
hdiutil create \
    -volname "Stride" \
    -srcfolder "$DMG_STAGE" \
    -ov \
    -format UDZO \
    "$DMG_NAME" 2>&1

rm -rf "$DMG_STAGE"

# Also create zip as fallback (some corporate firewalls block DMG downloads)
ZIP_NAME="Stride_v${VERSION}_Mac.zip"
rm -f "$ZIP_NAME"
ditto -c -k --sequesterRsrc --keepParent Stride "$ZIP_NAME"

DMG_SIZE=$(du -h "$DMG_NAME" | cut -f1)
ZIP_SIZE=$(du -h "$ZIP_NAME" | cut -f1)
FOLDER_SIZE=$(du -sh Stride | cut -f1)

echo ""
echo "═══════════════════════════════════════════════"
echo "  MAC BUILD COMPLETE"
echo "═══════════════════════════════════════════════"
echo ""
echo "  Folder:  dist-release-mac-signed/Stride/              ($FOLDER_SIZE)"
echo "  DMG:     dist-release-mac-signed/$DMG_NAME            ($DMG_SIZE)"
echo "  Zip:     dist-release-mac-signed/$ZIP_NAME            ($ZIP_SIZE)"
echo ""
echo "  ✅ Signed with Developer ID + notarized by Apple."
echo "     Users open the DMG, drag Stride.app to Applications."
echo ""
