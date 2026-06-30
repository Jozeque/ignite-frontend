#!/bin/bash
# ─── Stride VST3 — macOS build + sign + notarize + staple ───────────────────
# Runs in the `mac` job of .github/workflows/build-vst3.yml.
#
# Builds the JUCE VST3 universal (arm64 + x86_64), codesigns it with the
# Developer ID + the disable-library-validation entitlement (so it can host
# other plugins), notarizes it (submit --wait — the Apple account is already
# warmed up by the desktop builds, so this is minutes), staples, and zips.
#
# Required env (set by the workflow):
#   APPLE_ID, APPLE_APP_SPECIFIC_PASSWORD, APPLE_TEAM_ID
set -e

SCRIPT_DIR="$(cd "$(dirname "$0")/.." && pwd)"   # stride-wrapper/m0-spike
CI_DIR="$SCRIPT_DIR/ci"
BUILD_DIR="$SCRIPT_DIR/build-mac"
ENT="$CI_DIR/entitlements.plist"
IDENTITY="Developer ID Application: Yossi Bozo (B3Y92NHRMC)"

echo "═══════════════════════════════════════════"
echo "  STRIDE VST3 — macOS build"
echo "═══════════════════════════════════════════"

if [ -z "$APPLE_ID" ] || [ -z "$APPLE_APP_SPECIFIC_PASSWORD" ] || [ -z "$APPLE_TEAM_ID" ]; then
    echo "❌ Apple credentials not set"; exit 1
fi
if ! security find-identity -v -p codesigning | grep -q "Developer ID Application"; then
    echo "❌ Developer ID Application identity not found in keychain"; exit 1
fi

# ─── 1. Configure + build (universal) ───────────────────────────────────────
echo "[1/5] cmake configure + build (arm64 + x86_64)..."
cmake -S "$SCRIPT_DIR" -B "$BUILD_DIR" \
    -DCMAKE_BUILD_TYPE=Release \
    -DCMAKE_OSX_ARCHITECTURES="arm64;x86_64" \
    -DCMAKE_OSX_DEPLOYMENT_TARGET=11.0
cmake --build "$BUILD_DIR" --config Release -j3 --target StrideWrapperM0_VST3

VST3="$(find "$BUILD_DIR" -name 'Stride.vst3' -type d -print -quit)"
if [ -z "$VST3" ]; then
    echo "❌ Stride.vst3 not found after build"; find "$BUILD_DIR" -name '*.vst3' 2>/dev/null; exit 1
fi
echo "      built: $VST3"
echo "      arch: $(lipo -archs "$VST3/Contents/MacOS/Stride" 2>/dev/null || echo '?')"

# ─── 2. Codesign (hardened runtime + disable-library-validation) ────────────
echo "[2/5] codesign..."
[ -f "$ENT" ] || { echo "❌ entitlements missing: $ENT"; exit 1; }
codesign --force --deep --options runtime --timestamp \
    --entitlements "$ENT" --sign "$IDENTITY" "$VST3"
codesign --verify --deep --strict --verbose=2 "$VST3" || { echo "❌ codesign verify failed"; exit 1; }
echo "      ✅ signed"

# ─── 3. Notarize (submit + wait) ────────────────────────────────────────────
echo "[3/5] notarize (submit --wait)..."
SIGNED_ZIP="$SCRIPT_DIR/Stride-vst3-signed.zip"
rm -f "$SIGNED_ZIP"
ditto -c -k --keepParent "$VST3" "$SIGNED_ZIP"

if ! xcrun notarytool submit "$SIGNED_ZIP" \
        --apple-id "$APPLE_ID" --password "$APPLE_APP_SPECIFIC_PASSWORD" --team-id "$APPLE_TEAM_ID" \
        --wait --timeout 30m; then
    echo "❌ notarization failed — last submission log:"
    LAST=$(xcrun notarytool history --apple-id "$APPLE_ID" --password "$APPLE_APP_SPECIFIC_PASSWORD" --team-id "$APPLE_TEAM_ID" --output-format json 2>/dev/null \
           | python3 -c "import json,sys;print(json.loads(sys.stdin.read())['history'][0]['id'])" 2>/dev/null || true)
    [ -n "$LAST" ] && xcrun notarytool log "$LAST" --apple-id "$APPLE_ID" --password "$APPLE_APP_SPECIFIC_PASSWORD" --team-id "$APPLE_TEAM_ID" 2>&1 || true
    exit 1
fi
echo "      ✅ notarized"

# ─── 4. Staple + verify ─────────────────────────────────────────────────────
echo "[4/5] staple..."
xcrun stapler staple "$VST3"
xcrun stapler validate "$VST3" || { echo "❌ stapler validate failed"; exit 1; }
echo "      ✅ stapled"

# ─── 5. Package ─────────────────────────────────────────────────────────────
echo "[5/5] package..."
DIST="$SCRIPT_DIR/dist-mac"
rm -rf "$DIST"; mkdir -p "$DIST"
ditto -c -k --keepParent "$VST3" "$DIST/Stride-VST3-Mac.zip"
echo ""
echo "✅ DONE: $DIST/Stride-VST3-Mac.zip ($(du -h "$DIST/Stride-VST3-Mac.zip" | cut -f1))"
echo "   Universal, Developer ID signed, notarized + stapled."
echo "   Install: unzip → drag Stride.vst3 to /Library/Audio/Plug-Ins/VST3"
