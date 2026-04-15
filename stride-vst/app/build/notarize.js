/**
 * build/notarize.js — afterSign hook for electron-builder.
 *
 * Runs after electron-builder has signed the .app bundle. Submits the bundle
 * to Apple's notarization service (via @electron/notarize), waits for Apple's
 * verdict, and staples the returned ticket onto the .app so Gatekeeper doesn't
 * need to phone home on first launch.
 *
 * Env vars (set by .github/workflows/build-mac.yml):
 *   APPLE_ID                    — your Apple ID email
 *   APPLE_APP_SPECIFIC_PASSWORD — app-specific password from appleid.apple.com
 *   APPLE_TEAM_ID               — 10-char team ID from developer.apple.com
 *
 * If APPLE_ID is not set (e.g. running a local dev build), notarization is
 * silently skipped so developers can build unsigned/unnotarized debug copies.
 */

const path = require('path');

exports.default = async function afterSign(context) {
    const { electronPlatformName, appOutDir, packager } = context;

    // Skip non-Mac builds (e.g. Windows build.sh doesn't call this)
    if (electronPlatformName !== 'darwin') return;

    // Allow local dev builds without Apple credentials to complete successfully
    if (!process.env.APPLE_ID) {
        console.log('  [notarize] APPLE_ID not set — skipping notarization (dev build)');
        return;
    }

    if (!process.env.APPLE_APP_SPECIFIC_PASSWORD || !process.env.APPLE_TEAM_ID) {
        throw new Error(
            '[notarize] APPLE_ID is set but APPLE_APP_SPECIFIC_PASSWORD and/or ' +
            'APPLE_TEAM_ID are missing. All three must be set together.'
        );
    }

    const { notarize } = require('@electron/notarize');
    const appName = packager.appInfo.productFilename;
    const appPath = path.join(appOutDir, `${appName}.app`);

    // Force unbuffered stdout — GitHub Actions sometimes holds back
    // node's console.log output mid-step, making it look like we're
    // hung when we're really just waiting on Apple.
    const log = (msg) => { process.stdout.write(`  [notarize] ${msg}\n`); };

    log(`submitting ${appPath} to Apple...`);
    log(`apple-id=${process.env.APPLE_ID}  team-id=${process.env.APPLE_TEAM_ID}`);
    const startedAt = Date.now();

    // Heartbeat every 30s so we can see the wait is alive
    const heartbeat = setInterval(() => {
        const secs = Math.round((Date.now() - startedAt) / 1000);
        log(`still waiting on Apple... (${secs}s elapsed)`);
    }, 30_000);

    try {
        await notarize({
            tool: 'notarytool',
            appPath,
            appleId: process.env.APPLE_ID,
            appleIdPassword: process.env.APPLE_APP_SPECIFIC_PASSWORD,
            teamId: process.env.APPLE_TEAM_ID,
        });
    } finally {
        clearInterval(heartbeat);
    }

    const secs = Math.round((Date.now() - startedAt) / 1000);
    log(`done in ${secs}s — ticket stapled ✅`);
};
