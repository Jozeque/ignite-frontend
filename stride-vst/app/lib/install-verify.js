/**
 * install-verify.js — File-presence checks for Install to Ableton.
 *
 * Used by the install-stride-link-to-ableton handler in main.js, both as a
 * pre-flight (does the source bundle actually have the files we're about to
 * copy?) and as a post-copy verify (did the copy actually land them at the
 * target?). The same predicate guards both sides — if either side fails,
 * the handler returns a structured error instead of lying with success.
 *
 * Kept in its own module (no Electron dependency) so it can be unit-tested
 * without spinning up Electron. See test/test-install-verify.js.
 *
 * Motivation: two real customer cases motivated this guard.
 *   • keifr (Windows): stale empty ~/Documents/Ableton/User Library husk
 *     → install copied into the wrong folder → silent "success" lie.
 *   • macOS Sequoia customer: empty/unreadable bundled M4L payload
 *     → install copied zero files → silent "success" lie.
 *
 * Both would have produced an obvious error with this check in place.
 */

const fs = require('fs');
const path = require('path');

// Files that must exist for an install to count as real.
//
// StrideLink.amxd  — the Max device itself (definitive proof of payload)
// server.js        — the Node WebSocket server (proves core script copied)
// inject-writer.js — required by server.js at module load (added v1.2.0
//   for the direct-inject path). If this file is missing, node.script
//   crashes silently on load and clicking the M4L launch button surfaces
//   "Node script not ready" — the exact failure mode we hit during v1.2.0
//   pre-launch. Defensive add so a partial bundle can't fake a successful
//   install.
// node_modules/ws/package.json — proves the dependency tree was copied and
//   isn't just an empty husk. Checking the inner package.json (not just the
//   ws/ folder) defeats the false-positive where an empty dir would pass
//   fs.existsSync but contain none of the actual code.
//
// If you add/remove M4L deps and need to extend the check, edit this list
// and update test-install-verify.js's fixture helper to match.
const INSTALL_REQUIRED_FILES = [
    'StrideLink.amxd',
    'server.js',
    'inject-writer.js',
    path.join('node_modules', 'ws', 'package.json'),
];

/**
 * Returns the subset of INSTALL_REQUIRED_FILES that are MISSING under `dir`.
 * An empty array means everything required is present.
 * A null/undefined dir returns the full list (treat as fully missing).
 */
function checkInstallFiles(dir) {
    if (!dir) return INSTALL_REQUIRED_FILES.slice();
    return INSTALL_REQUIRED_FILES.filter(name => !fs.existsSync(path.join(dir, name)));
}

/**
 * Pre-flight variant: like checkInstallFiles but understands the bundled-
 * source layout where some critical files (e.g. StrideLink.amxd in dev
 * mode) live outside primaryDir as separate "extras" the installer copies
 * individually. A required file is considered present if it exists in
 * primaryDir OR matches the basename of any path in extras.
 *
 *   primaryDir — the directory copyDirRecursive will copy
 *   extras    — absolute paths to additional files copied flat into the target
 *
 * Returns array of required files that wouldn't end up at the target
 * after the install. Empty array = source is complete.
 */
function checkInstallSource(primaryDir, extras) {
    const extraBases = new Set((extras || []).map(p => path.basename(p)));
    return INSTALL_REQUIRED_FILES.filter(required => {
        if (primaryDir && fs.existsSync(path.join(primaryDir, required))) return false;
        if (extraBases.has(required)) return false;
        // Also handle the case where `required` is a nested path like
        // node_modules/ws/package.json — extras can only match flat
        // basenames, so nested entries fall through to "missing" unless
        // primaryDir has them. That's correct: extras are for flat files
        // (StrideLink.amxd), node_modules has to come through primaryDir.
        return true;
    });
}

// ─── Version marker ─────────────────────────────────────────
//
// After a successful install we write the Stride version into a small
// marker file inside the install target. On future "Install to Ableton"
// clicks, the handler reads the marker and compares against the current
// Stride version:
//
//   marker matches → "alreadyInstalled" short-circuit (skip rm + copy,
//                    avoiding EBUSY when Ableton has files locked).
//   marker missing → pre-versioning install (or never installed) →
//                    fall through to fresh copy.
//   marker stale   → user updated Stride, M4L files in the User Library
//                    are from an older build → force fresh copy.
//
// The marker lives WITH the install (inside the target Stride folder),
// not in app userData, so "delete the Stride folder" remains a complete
// reset — no orphan state to clean up separately.
//
// Filename uses a dot-prefix to signal "internal metadata, don't touch"
// (Unix convention; not auto-hidden on Windows but unlikely to confuse).
const INSTALL_MARKER_FILENAME = '.stride-build-version';

/**
 * Read the version marker from a previous install. Returns the trimmed
 * version string, or null if missing / unreadable / empty.
 * Never throws.
 */
function readInstallMarker(dir) {
    if (!dir) return null;
    try {
        const markerPath = path.join(dir, INSTALL_MARKER_FILENAME);
        if (!fs.existsSync(markerPath)) return null;
        const content = fs.readFileSync(markerPath, 'utf8');
        const trimmed = (content || '').trim();
        return trimmed || null;
    } catch (e) {
        return null;
    }
}

/**
 * Write the version marker to the install target. Best-effort — returns
 * true on success, false on any failure (read-only fs, quota, etc.).
 * The install itself is still considered successful even if marker write
 * fails; worst case next re-click does an unnecessary fresh copy.
 * Never throws.
 */
function writeInstallMarker(dir, version) {
    if (!dir || typeof dir !== 'string') return false;
    if (!version || typeof version !== 'string') return false;
    try {
        const markerPath = path.join(dir, INSTALL_MARKER_FILENAME);
        fs.writeFileSync(markerPath, version, 'utf8');
        return true;
    } catch (e) {
        return false;
    }
}

module.exports = {
    INSTALL_REQUIRED_FILES,
    INSTALL_MARKER_FILENAME,
    checkInstallFiles,
    checkInstallSource,
    readInstallMarker,
    writeInstallMarker,
};
