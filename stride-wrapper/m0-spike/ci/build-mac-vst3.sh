#!/bin/bash
# ─── Stride — macOS build + sign + auval + notarize + staple (VST3 + AU) ────
# Runs in the `mac` job of .github/workflows/build-vst3.yml.
#
# Builds the JUCE plugin universal (arm64 + x86_64) in BOTH formats:
#   Stride.vst3       — Live / Bitwig / Cubase / Studio One / Reaper / FL ...
#   Stride.component  — AUv2 (aumu SwM0 Strd) for Logic Pro + GarageBand
# codesigns both with the Developer ID + the disable-library-validation
# entitlement (so Stride can host other plugins), gates the build on `auval`
# (the exact validation Logic runs before it lists an AU), notarizes both in a
# single submission (--wait), staples, and zips one Mac package.
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
echo "  STRIDE — macOS build (VST3 + AU)"
echo "═══════════════════════════════════════════"

if [ -z "$APPLE_ID" ] || [ -z "$APPLE_APP_SPECIFIC_PASSWORD" ] || [ -z "$APPLE_TEAM_ID" ]; then
    echo "❌ Apple credentials not set"; exit 1
fi
if ! security find-identity -v -p codesigning | grep -q "Developer ID Application"; then
    echo "❌ Developer ID Application identity not found in keychain"; exit 1
fi

# ─── 1. Configure + build (universal, both formats) ─────────────────────────
echo "[1/6] cmake configure + build (arm64 + x86_64, VST3 + AU)..."
cmake -S "$SCRIPT_DIR" -B "$BUILD_DIR" \
    -DCMAKE_BUILD_TYPE=Release \
    -DCMAKE_OSX_ARCHITECTURES="arm64;x86_64" \
    -DCMAKE_OSX_DEPLOYMENT_TARGET=11.0
cmake --build "$BUILD_DIR" --config Release -j3 \
    --target StrideWrapperM0_VST3 --target StrideWrapperM0_AU

VST3="$(find "$BUILD_DIR" -name 'Stride.vst3' -type d | head -1)"
AU="$(find "$BUILD_DIR" -name 'Stride.component' -type d | head -1)"
if [ -z "$VST3" ]; then
    echo "❌ Stride.vst3 not found after build"; find "$BUILD_DIR" -name '*.vst3' 2>/dev/null; exit 1
fi
if [ -z "$AU" ]; then
    echo "❌ Stride.component not found after build"; find "$BUILD_DIR" -name '*.component' 2>/dev/null; exit 1
fi
echo "      built: $VST3"
echo "      arch:  $(lipo -archs "$VST3/Contents/MacOS/Stride" 2>/dev/null || echo '?')"
echo "      built: $AU"
echo "      arch:  $(lipo -archs "$AU/Contents/MacOS/Stride" 2>/dev/null || echo '?')"

# ─── 2. Codesign both (hardened runtime + disable-library-validation) ───────
echo "[2/6] codesign (both bundles)..."
[ -f "$ENT" ] || { echo "❌ entitlements missing: $ENT"; exit 1; }
for BUNDLE in "$VST3" "$AU"; do
    codesign --force --deep --options runtime --timestamp \
        --entitlements "$ENT" --sign "$IDENTITY" "$BUNDLE"
    codesign --verify --deep --strict --verbose=2 "$BUNDLE" || { echo "❌ codesign verify failed: $BUNDLE"; exit 1; }
done
echo "      ✅ signed"

# ─── 3. auval gate — the same validation Logic runs before listing an AU ────
# Install the SIGNED component where the registrar looks, reset the component
# cache, then validate STRICT on the native (arm64) slice. A FAIL here is
# exactly what would make Logic reject or hide Stride on a customer's machine,
# so it fails the build. The x86_64 slice (Intel-Mac Logic) is validated via
# Rosetta when the runner has it: a real validation FAIL fails the build; a
# missing-Rosetta launch error only warns (out of our control on CI images).
echo "[3/6] auval (aumu SwM0 Strd, strict)..."
AU_INSTALL="$HOME/Library/Audio/Plug-Ins/Components/Stride.component"
mkdir -p "$HOME/Library/Audio/Plug-Ins/Components"
rm -rf "$AU_INSTALL"
ditto "$AU" "$AU_INSTALL"
killall -9 AudioComponentRegistrar 2>/dev/null || true
if ! auval -strict -v aumu SwM0 Strd; then
    echo "❌ auval FAILED — Logic would refuse this build"; exit 1
fi
echo "      ✅ auval PASS (native slice)"
if X86OUT=$(arch -x86_64 auval -strict -v aumu SwM0 Strd 2>&1); then
    echo "      ✅ auval PASS (x86_64 slice via Rosetta)"
else
    if echo "$X86OUT" | grep -qiE 'bad cpu|posix_spawnp|not supported|Unknown architecture'; then
        echo "      ⚠️  x86_64 auval skipped (no Rosetta on this runner)"
    else
        echo "$X86OUT"
        echo "❌ auval FAILED on the x86_64 slice — Intel-Mac Logic would refuse this build"; exit 1
    fi
fi

# ─── 4. Notarize (one submission for both bundles) ──────────────────────────
echo "[4/6] notarize (submit --wait)..."
STAGE="$SCRIPT_DIR/notarize-stage"
SIGNED_ZIP="$SCRIPT_DIR/Stride-mac-signed.zip"
rm -rf "$STAGE" "$SIGNED_ZIP"
mkdir -p "$STAGE"
ditto "$VST3" "$STAGE/Stride.vst3"
ditto "$AU"   "$STAGE/Stride.component"
ditto -c -k "$STAGE" "$SIGNED_ZIP"

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

# ─── 5. Staple + verify both ────────────────────────────────────────────────
echo "[5/6] staple..."
for BUNDLE in "$VST3" "$AU"; do
    xcrun stapler staple "$BUNDLE"
    xcrun stapler validate "$BUNDLE" || { echo "❌ stapler validate failed: $BUNDLE"; exit 1; }
done
echo "      ✅ stapled"

# ─── 6. Package ─────────────────────────────────────────────────────────────
echo "[6/6] package (Stride.vst3 + Stride.component + README)..."
DIST="$SCRIPT_DIR/dist-mac"
rm -rf "$DIST"; mkdir -p "$DIST/Stride"
ditto "$VST3" "$DIST/Stride/Stride.vst3"
ditto "$AU"   "$DIST/Stride/Stride.component"
cp "$CI_DIR/README.txt" "$DIST/Stride/README.txt"
# StrideBridge rides along (see the Windows job note): self-contained M4L folder.
BRIDGE_SRC="$SCRIPT_DIR/../../stride-vst/m4l-bridge"
mkdir -p "$DIST/Stride/StrideBridge"
for f in StrideBridge.amxd bridge-server.js bridge_max.js rasterizer.js log-scaling.js inject-writer.js; do
  cp "$BRIDGE_SRC/$f" "$DIST/Stride/StrideBridge/"
done
# StrideInject rides along too (see the Windows job note): the Remote Script that
# writes the clip automation, previously only obtainable from the desktop app.
mkdir -p "$DIST/Stride/StrideBridge/StrideInject"
cp "$SCRIPT_DIR/../../stride-vst/remote_script/StrideInject/__init__.py" "$DIST/Stride/StrideBridge/StrideInject/"
cp "$SCRIPT_DIR/../../stride-vst/remote_script/StrideInject/_curve.py" "$DIST/Stride/StrideBridge/StrideInject/"
cp "$BRIDGE_SRC/README-StrideBridge.txt" "$DIST/Stride/StrideBridge/README.txt"
cp "$SCRIPT_DIR/../../docs/_fonts/Outfit.ttf" "$DIST/Stride/StrideBridge/"
xcrun stapler validate "$DIST/Stride/Stride.vst3"      || { echo "❌ staple lost after copy (vst3)"; exit 1; }
xcrun stapler validate "$DIST/Stride/Stride.component" || { echo "❌ staple lost after copy (component)"; exit 1; }
# Bake the CMake project version into the zip name — the file identifies its build,
# so a tester's download can never be mistaken for another version.
VER="$(sed -n 's/^project(StrideWrapperM0 VERSION \([0-9.]*\).*/\1/p' "$SCRIPT_DIR/CMakeLists.txt")"
[ -n "$VER" ] || { echo "❌ version not found in CMakeLists.txt"; exit 1; }
ditto -c -k --keepParent "$DIST/Stride" "$DIST/Stride-VST3-Mac-v$VER.zip"
echo ""
echo "✅ DONE: $DIST/Stride-VST3-Mac-v$VER.zip ($(du -h "$DIST/Stride-VST3-Mac-v$VER.zip" | cut -f1))"
echo "   Universal, Developer ID signed, notarized + stapled, auval-validated."
echo "   Install: unzip → Stride.vst3 to /Library/Audio/Plug-Ins/VST3"
echo "            unzip → Stride.component to /Library/Audio/Plug-Ins/Components (Logic/GarageBand)"
