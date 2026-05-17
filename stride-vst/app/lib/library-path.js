/**
 * library-path.js — Resolver for the Ableton User Library path.
 *
 * Four resolution layers, in priority order:
 *   1. M4L self-report  — StrideLink lives INSIDE the User Library, so server.js
 *                         knows the real path with zero guessing. Reported on
 *                         every WebSocket handshake. Overrides anything else.
 *   2. Persisted cache  — Whatever path was last confirmed-working (detected,
 *                         manual pick, or self-report).
 *   3. Smart detection  — Standard paths + OneDrive variants + (stub) Ableton
 *                         prefs parsing.
 *   4. Manual picker    — Last resort. Caller (main.js) handles the dialog;
 *                         this module just persists the choice.
 *
 * Cache lives at <DATA_DIR>/library-path.json — kept SEPARATE from
 * settings.json because the renderer's save-settings IPC overwrites the whole
 * settings file, which would race with M4L self-report writes from main.
 *
 * No Electron dependency. The caller wires DATA_DIR via _setDataDir() once at
 * startup. Tests override with a tempdir.
 *
 * See docs/install-to-ableton-spec.md for full architectural rationale.
 */

const fs = require('fs');
const path = require('path');
const os = require('os');

// ─── State ────────────────────────────────────────────────

let _dataDir = null;

function _setDataDir(dir) {
    _dataDir = dir;
}

function _cacheFile() {
    if (!_dataDir) throw new Error('library-path: _setDataDir() must be called before use');
    return path.join(_dataDir, 'library-path.json');
}

// ─── Persistence ──────────────────────────────────────────

// Read the cache entry, validating the path still exists. Stale entries
// (folder deleted/moved) return null so the resolver can fall through to
// detection and pick up the new location automatically.
function _readCache() {
    try {
        const file = _cacheFile();
        if (!fs.existsSync(file)) return null;
        const raw = JSON.parse(fs.readFileSync(file, 'utf8'));
        if (!raw || typeof raw.path !== 'string' || !raw.path) return null;
        if (!fs.existsSync(raw.path)) return null;
        return raw;
    } catch (e) {
        return null;
    }
}

// Atomic write: tmp file + rename, so a partial write can't corrupt the cache.
function _writeCache(entry) {
    try {
        if (!fs.existsSync(_dataDir)) fs.mkdirSync(_dataDir, { recursive: true });
        const file = _cacheFile();
        const tmp = file + '.tmp';
        fs.writeFileSync(tmp, JSON.stringify(entry, null, 2));
        fs.renameSync(tmp, file);
        return true;
    } catch (e) {
        return false;
    }
}

function cached() {
    const c = _readCache();
    return c ? c.path : null;
}

function cachedSource() {
    const c = _readCache();
    return c ? c.source : null;
}

// Persist a confirmed library path with its origin source.
//   source ∈ 'detected' | 'manual' | 'm4l'
// Returns { ok, changed } on success, { ok: false, error } on failure.
// `changed` is true if this path differs from any previously persisted one —
// callers use it to decide whether to restart the library watcher.
//
// 'm4l' bypasses validate(): StrideLink's own location IS the User Library by
// definition, even on unusual setups where the folder doesn't have the
// standard marker subdirectories.
function persist(libPath, source) {
    if (typeof libPath !== 'string' || !libPath) {
        return { ok: false, error: 'invalid_path' };
    }
    if (source !== 'm4l' && !validate(libPath)) {
        return { ok: false, error: 'invalid_library' };
    }
    const prev = _readCache();
    const entry = {
        path: libPath,
        source: source || 'detected',
        set_at: Date.now(),
    };
    const ok = _writeCache(entry);
    if (!ok) return { ok: false, error: 'write_failed' };
    const changed = !prev || prev.path !== libPath;
    return { ok: true, changed };
}

// Drop the cache. Idempotent — succeeds even if nothing was cached.
function forget() {
    try {
        const file = _cacheFile();
        if (fs.existsSync(file)) fs.unlinkSync(file);
        return true;
    } catch (e) {
        return false;
    }
}

// ─── Validation ───────────────────────────────────────────

// Subfolders Ableton creates inside a real User Library. Two or more of these
// = plausibly the real thing. A stale empty Documents/Ableton/User Library
// husk (left behind by an old Live install) has zero or one and fails.
const LIBRARY_MARKERS = [
    'Presets', 'Samples', 'Sounds', 'Defaults', 'Templates',
    'Live Recordings', 'Drums', 'Grooves', 'Lessons',
];

function validate(candidate) {
    try {
        if (!candidate || typeof candidate !== 'string') return false;
        const stat = fs.statSync(candidate);
        if (!stat.isDirectory()) return false;

        // Definitive: a prior Stride install lives here. Don't second-guess.
        if (fs.existsSync(path.join(candidate, 'Stride', 'StrideLink.amxd'))) {
            return true;
        }

        // Plausible: at least 2 Ableton-shaped subfolders.
        let hits = 0;
        for (const marker of LIBRARY_MARKERS) {
            try {
                if (fs.statSync(path.join(candidate, marker)).isDirectory()) {
                    hits++;
                    if (hits >= 2) return true;
                }
            } catch (e) {
                // marker absent — keep counting
            }
        }
        return false;
    } catch (e) {
        return false;
    }
}

// ─── Detection ────────────────────────────────────────────

// Standard out-of-box Ableton locations. Mac defaults to Music/...; Windows to
// Documents/.... Order matters: a leftover Documents/Ableton/User Library on
// macOS (auto-created by old Live versions) is a classic false positive — but
// validate() rejects empty husks, so a real Music-based library wins.
function detectStandard() {
    const home = os.homedir();
    const candidates = process.platform === 'darwin'
        ? [path.join(home, 'Music', 'Ableton', 'User Library'),
           path.join(home, 'Documents', 'Ableton', 'User Library')]
        : [path.join(home, 'Documents', 'Ableton', 'User Library'),
           path.join(home, 'Music', 'Ableton', 'User Library')];
    for (const c of candidates) {
        if (validate(c)) return c;
    }
    return null;
}

// OneDrive-redirected Documents. Windows sets OneDrive / OneDriveCommercial /
// OneDriveConsumer env vars when OneDrive is active. We also scan ~/OneDrive*
// directories for org-account variants like "OneDrive - Acme Corp" — those
// aren't always covered by the env vars.
function detectOneDrive() {
    if (process.platform !== 'win32') return null;

    const home = os.homedir();
    const roots = [];

    for (const v of ['OneDrive', 'OneDriveCommercial', 'OneDriveConsumer']) {
        const val = process.env[v];
        if (val && !roots.includes(val)) roots.push(val);
    }

    try {
        for (const entry of fs.readdirSync(home, { withFileTypes: true })) {
            if (!entry.isDirectory()) continue;
            const name = entry.name;
            if (name === 'OneDrive' || name.startsWith('OneDrive - ')) {
                const full = path.join(home, name);
                if (!roots.includes(full)) roots.push(full);
            }
        }
    } catch (e) {}

    for (const root of roots) {
        const candidate = path.join(root, 'Documents', 'Ableton', 'User Library');
        if (validate(candidate)) return candidate;
    }
    return null;
}

// Parse Ableton's user-configured library location from its preferences.
//
// Stub for Phase 1 — exact prefs file format varies by Live version and
// hasn't been verified against a clean test matrix yet. Implementation hook
// is in place so a future phase can fill it in without touching the rest of
// the resolver. Until then, custom-relocated libraries fall through to the
// manual picker, which is the documented fallback path.
//
// Expected eventual implementation:
//   Windows: %APPDATA%/Ableton/Live <ver>/Preferences/   (pick latest version)
//   macOS:   ~/Library/Preferences/Ableton/Live <ver>/   (pick latest version)
//   Read the user-library entry, validate(), return.
function detectAbletonPrefs() {
    return null;
}

// Run all detection layers in priority order. First valid hit wins.
function detect() {
    return detectStandard()
        || detectOneDrive()
        || detectAbletonPrefs()
        || null;
}

// Full resolve: cache first, then detect. Returns { path, source } or null.
//   source ∈ 'cache' | 'detect'   (where the answer came from THIS call)
// To find out the original origin (m4l/manual/detected), call cachedSource().
function resolve() {
    const c = cached();
    if (c) return { path: c, source: 'cache' };
    const d = detect();
    if (d) return { path: d, source: 'detect' };
    return null;
}

// ─── Exports ──────────────────────────────────────────────

module.exports = {
    resolve,
    cached,
    cachedSource,
    detect,
    detectStandard,
    detectOneDrive,
    detectAbletonPrefs,
    validate,
    persist,
    forget,
    _setDataDir,
    LIBRARY_MARKERS,
};
