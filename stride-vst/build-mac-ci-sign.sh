#!/bin/bash
# ─── Stride Mac Build — Stage 1: sign + submit ──────────────
# Runs in Job 1 of .github/workflows/build-mac.yml.
#
# Produces a signed (but unnotarized) Stride.app, zips it for artifact
# upload, and submits it to Apple's notary service. Job 1 exits fast
# (~5 min total) — no polling, no waiting. Job 2 takes over from here.
#
# Required env vars (set by the workflow):
#   APPLE_ID                     Apple ID email
#   APPLE_APP_SPECIFIC_PASSWORD  app-specific password from appleid.apple.com
#   APPLE_TEAM_ID                10-char team ID
#
# Outputs (in stride-vst/):
#   Stride-signed.zip            ditto zip of the signed Stride.app
#   submission-id.txt            submission UUID to poll in Job 2
#
# Architecture rationale: see project_mac_signed_release.md memory —
# Apple's notary service holds first submissions from new Developer IDs
# for hours to days. We cannot out-wait this in a single 120-min job.
# Job 1 captures the signed bits and submission ID, then Job 2 (with a
# 350-min timeout AND the ability to resume from a previous run's
# artifact) handles the wait.

set -e

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
APP_DIR="$SCRIPT_DIR/app"
VERSION=$(node -e "console.log(require('./app/package.json').version)")

echo "═══════════════════════════════════════════════"
echo "  STRIDE MAC SIGN — v${VERSION}"
echo "═══════════════════════════════════════════════"
echo ""

# ─── Step 0: Regenerate .icns from assets/icon.png ─────
# Keeps the .app's icon in sync with assets/icon.png. png2icons runs
# cross-platform in pure JS so CI doesn't need iconutil / ImageMagick.
echo "[0/4] Regenerating build/icon.icns from assets/icon.png..."
cd "$APP_DIR"
node -e "const p=require('png2icons');const fs=require('fs');const d=fs.readFileSync('assets/icon.png');const icns=p.createICNS(d,p.BILINEAR,0);if(!icns){console.error('ICNS fail');process.exit(1);}fs.writeFileSync('build/icon.icns',icns);console.log('build/icon.icns ->',icns.length,'bytes');"

# ─── Step 1: @electron/packager (unsigned .app build) ─
echo "[1/4] Running @electron/packager..."
cd "$APP_DIR"
rm -rf dist

npx --yes @electron/packager . Stride \
    --platform=darwin \
    --arch=universal \
    --out=dist \
    --asar \
    --overwrite \
    --app-bundle-id=io.stridehub.canvas \
    --app-category-type=public.app-category.music \
    --icon=build/icon.icns \
    --app-version="${VERSION}" \
    --build-version="${VERSION}" \
    --ignore="^/dist($|/)" \
    --prune=true 2>&1 | tail -30

# Universal build lands at dist/Stride-darwin-universal/. Fall back to single-
# arch output paths in case a dev ever flips --arch locally without updating
# this script — we walk candidates in preference order.
MAC_OUT=""
for candidate in "Stride-darwin-universal" "Stride-darwin-arm64" "Stride-darwin-x64"; do
    if [ -d "$APP_DIR/dist/$candidate/Stride.app" ]; then
        MAC_OUT="$APP_DIR/dist/$candidate"
        break
    fi
done
if [ -z "$MAC_OUT" ]; then
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

# ─── Step 1b: Obfuscate source code ────────────────────────
# Extract app.asar → obfuscate all JS → repack. This happens BEFORE
# signing so the signature covers the obfuscated code (not the source).
echo ""
echo "[1b/4] Obfuscating source code..."
OBFUSCATOR="$APP_DIR/node_modules/.bin/javascript-obfuscator"
ASAR="$MAC_OUT/Stride.app/Contents/Resources/app.asar"
ASAR_TMP="$(mktemp -d)"

npx @electron/asar extract "$ASAR" "$ASAR_TMP"

# Max safe protection — renameGlobals + renameProperties stay false
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

npx @electron/asar pack "$ASAR_TMP" "$ASAR"
rm -rf "$ASAR_TMP"
echo "      ✅ Source code obfuscated"

# ─── Step 1c: Bundle M4L inside Stride.app ────────────────
# Put the Max device + node scripts into Contents/Resources/M4L/ so they
# ship WITH the signed, notarized app. On first launch Stride copies this
# folder into the user's Ableton User Library so StrideLink appears in
# Ableton's browser. This is the critical piece that fixes path issues:
# the M4L folder always travels with Stride.app — wherever Stride.app
# ends up, we can always reach the M4L payload.
#
# osx-sign will pick these up as "resources" during the deep signing pass.
# We only ship pure JS (ws + @xmldom, no native bindings) so there are no
# Mach-O binaries nested inside that would need separate signing passes.
echo ""
echo "[1c/4] Bundling M4L inside Stride.app..."
M4L_SRC="$SCRIPT_DIR/m4l"
M4L_DEST="$MAC_OUT/Stride.app/Contents/Resources/M4L"

# Fresh install of M4L node deps (ws + @xmldom) so the bundled copy is
# complete. Omit dev deps to keep size minimal.
echo "      Installing M4L node dependencies..."
(cd "$M4L_SRC/node" && rm -rf node_modules && npm install --omit=dev 2>&1 | tail -3)

mkdir -p "$M4L_DEST"
cp "$M4L_SRC/StrideLink.amxd" "$M4L_DEST/"
cp "$M4L_SRC/node/"*.js "$M4L_DEST/"
cp "$M4L_SRC/node/"*.py "$M4L_DEST/"
cp -R "$M4L_SRC/node/node_modules" "$M4L_DEST/node_modules"

# Clean dev leftovers
rm -rf "$M4L_DEST/__pycache__"
rm -f "$M4L_DEST/_stride_"*.json

# Obfuscate bundled M4L JS files (same settings as the electron app.asar
# above — max safe protection with rename-globals/properties off).
echo "      Obfuscating bundled M4L JS..."
for f in server.js scanner.js writer.js inject-writer.js alc-generator.js alc-injector.js; do
    "$OBFUSCATOR" "$M4L_DEST/$f" --output "$M4L_DEST/$f" \
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
        --rename-properties false 2>&1 | tail -1
done
# scanner_max.js runs in Max's older JS engine — lighter profile
"$OBFUSCATOR" "$M4L_DEST/scanner_max.js" --output "$M4L_DEST/scanner_max.js" \
    --compact true \
    --string-array true \
    --string-array-encoding base64 \
    --string-array-threshold 0.75 \
    --string-array-rotate true \
    --string-array-shuffle true \
    --rename-globals false \
    --rename-properties false \
    --control-flow-flattening false \
    --target browser 2>&1 | tail -1

echo "      ✅ M4L bundled at $M4L_DEST"

# ─── Step 1d: Bundle StrideInject Remote Script inside Stride.app ──
# Stride 2.0: "Install to Ableton" copies this into <User Library>/Remote
# Scripts/StrideInject so Ableton lists it as a Control Surface (direct
# inject — the core 2.0 workflow). main.js finds it at
# Contents/Resources/StrideInject (process.resourcesPath). Embedded BEFORE
# signing so osx-sign seals it into the notarized bundle. Plain .py — Ableton
# runs Remote Scripts from source, so no obfuscation and no Mach-O to sign.
echo ""
echo "[1d/4] Bundling StrideInject inside Stride.app..."
SI_DEST="$MAC_OUT/Stride.app/Contents/Resources/StrideInject"
mkdir -p "$SI_DEST"
cp "$SCRIPT_DIR/remote_script/StrideInject/"*.py "$SI_DEST/"
rm -rf "$SI_DEST/__pycache__"
if [ ! -f "$SI_DEST/__init__.py" ]; then
    echo "❌ StrideInject payload missing — __init__.py not copied"
    exit 1
fi
echo "      ✅ StrideInject bundled at $SI_DEST"

# ─── Step 2: Sign with @electron/osx-sign ──────────────────
# Calling osx-sign as a library via `node -e` — we bypass electron-builder
# entirely. osx-sign is the low-level signer electron-builder delegates
# to anyway. It handles the correct signing order for Electron's nested
# Helper apps, Frameworks, and native modules.
echo ""
echo "[2/4] Signing with @electron/osx-sign..."
IDENTITY="Developer ID Application: Yossi Bozo (B3Y92NHRMC)"
ENTITLEMENTS="$APP_DIR/build/entitlements.mac.plist"

if [ ! -f "$ENTITLEMENTS" ]; then
    echo "❌ Entitlements plist not found at $ENTITLEMENTS"
    exit 1
fi

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

# ─── Step 3: Zip for notarize AND artifact upload ─
# This same zip is what we send to Apple AND what Job 2 downloads as the
# artifact. Using ditto with --keepParent preserves the Stride.app folder
# structure and symlinks; signature survives the roundtrip.
echo ""
echo "[3/4] Zipping signed .app..."
SIGNED_ZIP="$SCRIPT_DIR/Stride-signed.zip"
rm -f "$SIGNED_ZIP"
(cd "$MAC_OUT" && ditto -c -k --keepParent Stride.app "$SIGNED_ZIP")
echo "      $SIGNED_ZIP ($(du -h "$SIGNED_ZIP" | cut -f1))"

# ─── Step 4: Submit to Apple (no --wait) ──────────────────
# We submit async and capture only the submission ID. Job 2 polls the
# status later. Do NOT use --wait here — multiple hours of polling is
# fragile and GitHub Actions has a 6h hard job timeout anyway.
echo ""
echo "[4/4] Submitting to Apple notary service..."

# Pre-flight: show history so we can see any pending submissions we
# forgot about from previous runs (Apple holds them forever server-side).
echo "      Recent submission history:"
xcrun notarytool history \
    --apple-id "$APPLE_ID" \
    --password "$APPLE_APP_SPECIFIC_PASSWORD" \
    --team-id "$APPLE_TEAM_ID" 2>&1 | head -20 || true
echo ""

SUBMIT_OUTPUT=$(xcrun notarytool submit "$SIGNED_ZIP" \
    --apple-id "$APPLE_ID" \
    --password "$APPLE_APP_SPECIFIC_PASSWORD" \
    --team-id "$APPLE_TEAM_ID" \
    --output-format json 2>&1)
SUBMIT_STATUS=$?
echo "      submit output: $SUBMIT_OUTPUT"

if [ "$SUBMIT_STATUS" -ne 0 ]; then
    echo "❌ notarytool submit failed (exit $SUBMIT_STATUS)"
    exit 1
fi

SUBMISSION_ID=$(echo "$SUBMIT_OUTPUT" | python3 -c "import json,sys; print(json.loads(sys.stdin.read().splitlines()[-1])['id'])" 2>/dev/null || true)
if [ -z "$SUBMISSION_ID" ]; then
    echo "❌ Could not extract submission ID from notarytool output"
    exit 1
fi

echo "$SUBMISSION_ID" > "$SCRIPT_DIR/submission-id.txt"
echo "$VERSION" > "$SCRIPT_DIR/version.txt"
echo ""
echo "═══════════════════════════════════════════════"
echo "  STAGE 1 COMPLETE"
echo "═══════════════════════════════════════════════"
echo "  Submission ID: $SUBMISSION_ID"
echo "  Signed zip:    $SIGNED_ZIP"
echo ""
echo "  Apple is now processing the submission. Job 2 will poll"
echo "  for the verdict and staple when Apple is done. First-time"
echo "  submissions from a new Developer ID can take 1h - several days"
echo "  (Apple DTS confirmed). Subsequent submissions are 2-15 min."
echo ""
