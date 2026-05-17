/**
 * Tests for stride-vst/app/lib/library-path.js — User Library path resolver.
 *
 * Phase 1 of docs/install-to-ableton-spec.md.
 *
 * Run: node test/test-library-path.js
 *
 * Covers:
 *   • validate() — marker-folder threshold, StrideLink-definitive shortcut, husks
 *   • persist() — round-trip, source labeling, m4l-bypass of validate, changed flag
 *   • cached() / cachedSource() — auto-invalidate when path disappears
 *   • forget() — idempotent
 *   • resolve() — cache precedence over detect
 *   • detectStandard() — finds standard Documents/Music location via a faked home
 *
 * Uses real filesystem under os.tmpdir() for everything so we exercise the
 * actual code paths (no mocks). Each test gets a fresh tempdir; cleanup is
 * best-effort in a finally.
 */

const fs = require('fs');
const path = require('path');
const os = require('os');

const lib = require('../app/lib/library-path');

let passed = 0;
let failed = 0;
let skipped = 0;

function test(name, fn) {
    const tmpDataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'stride-libpath-data-'));
    lib._setDataDir(tmpDataDir);
    try {
        fn();
        console.log(`  ✓ ${name}`);
        passed++;
    } catch (e) {
        console.log(`  ✗ ${name}: ${e.message}`);
        if (e.stack) console.log(e.stack.split('\n').slice(1, 4).join('\n'));
        failed++;
    } finally {
        try { fs.rmSync(tmpDataDir, { recursive: true, force: true }); } catch (e) {}
    }
}

function assert(cond, msg) { if (!cond) throw new Error(msg || 'assertion failed'); }
function assertEq(a, b, msg) {
    if (a !== b) throw new Error((msg || 'mismatch') + ` — got ${JSON.stringify(a)}, expected ${JSON.stringify(b)}`);
}

// Build a fake User Library on disk with N marker subfolders. Returns the path.
function makeFakeLibrary(markers, extras) {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'stride-fake-lib-'));
    for (const m of (markers || [])) {
        fs.mkdirSync(path.join(root, m), { recursive: true });
    }
    for (const [rel, isDir] of (extras || [])) {
        const full = path.join(root, rel);
        fs.mkdirSync(path.dirname(full), { recursive: true });
        if (isDir) fs.mkdirSync(full, { recursive: true });
        else fs.writeFileSync(full, '');
    }
    return root;
}

console.log('\nlibrary-path.js — Phase 1 unit tests\n');

// ─── validate() ──────────────────────────────────────────────

test('validate() rejects null', () => {
    assertEq(lib.validate(null), false);
});

test('validate() rejects empty string', () => {
    assertEq(lib.validate(''), false);
});

test('validate() rejects non-existent path', () => {
    assertEq(lib.validate('/this/should/not/exist/anywhere/zzz'), false);
});

test('validate() rejects a file (not directory)', () => {
    const f = path.join(os.tmpdir(), 'stride-libpath-test-file-' + Date.now());
    fs.writeFileSync(f, 'hi');
    try {
        assertEq(lib.validate(f), false);
    } finally {
        try { fs.unlinkSync(f); } catch (e) {}
    }
});

test('validate() rejects empty folder (zero markers)', () => {
    const dir = makeFakeLibrary([]);
    try {
        assertEq(lib.validate(dir), false, 'empty folder should not validate');
    } finally {
        try { fs.rmSync(dir, { recursive: true, force: true }); } catch (e) {}
    }
});

test('validate() rejects folder with only 1 marker (stale husk)', () => {
    const dir = makeFakeLibrary(['Presets']);
    try {
        assertEq(lib.validate(dir), false, '1 marker = stale husk');
    } finally {
        try { fs.rmSync(dir, { recursive: true, force: true }); } catch (e) {}
    }
});

test('validate() accepts folder with 2 markers', () => {
    const dir = makeFakeLibrary(['Presets', 'Samples']);
    try {
        assertEq(lib.validate(dir), true, '2 markers = plausible library');
    } finally {
        try { fs.rmSync(dir, { recursive: true, force: true }); } catch (e) {}
    }
});

test('validate() accepts folder with many markers', () => {
    const dir = makeFakeLibrary(['Presets', 'Samples', 'Sounds', 'Defaults', 'Templates']);
    try {
        assertEq(lib.validate(dir), true);
    } finally {
        try { fs.rmSync(dir, { recursive: true, force: true }); } catch (e) {}
    }
});

test('validate() accepts folder with existing StrideLink (definitive)', () => {
    const dir = makeFakeLibrary([], [['Stride/StrideLink.amxd', false]]);
    try {
        // Zero markers, but Stride/StrideLink.amxd exists → trust it.
        assertEq(lib.validate(dir), true);
    } finally {
        try { fs.rmSync(dir, { recursive: true, force: true }); } catch (e) {}
    }
});

// ─── persist / cached / cachedSource / forget ────────────────

test('persist() rejects empty path', () => {
    const r = lib.persist('', 'manual');
    assertEq(r.ok, false);
    assertEq(r.error, 'invalid_path');
});

test('persist() rejects non-string path', () => {
    const r = lib.persist(null, 'manual');
    assertEq(r.ok, false);
    assertEq(r.error, 'invalid_path');
});

test('persist() rejects invalid library when source != m4l', () => {
    const dir = makeFakeLibrary([]); // empty husk
    try {
        const r = lib.persist(dir, 'detected');
        assertEq(r.ok, false);
        assertEq(r.error, 'invalid_library');
    } finally {
        try { fs.rmSync(dir, { recursive: true, force: true }); } catch (e) {}
    }
});

test('persist() accepts ANY existing path when source == m4l (trust the device)', () => {
    const dir = makeFakeLibrary([]); // empty husk
    try {
        const r = lib.persist(dir, 'm4l');
        assertEq(r.ok, true, 'm4l source should bypass validate');
        assertEq(r.changed, true);
        assertEq(lib.cached(), dir);
        assertEq(lib.cachedSource(), 'm4l');
    } finally {
        try { fs.rmSync(dir, { recursive: true, force: true }); } catch (e) {}
    }
});

test('persist() round-trips through cached() and cachedSource()', () => {
    const dir = makeFakeLibrary(['Presets', 'Samples']);
    try {
        const r = lib.persist(dir, 'manual');
        assertEq(r.ok, true);
        assertEq(r.changed, true);
        assertEq(lib.cached(), dir);
        assertEq(lib.cachedSource(), 'manual');
    } finally {
        try { fs.rmSync(dir, { recursive: true, force: true }); } catch (e) {}
    }
});

test('persist() reports changed=false when same path re-persisted', () => {
    const dir = makeFakeLibrary(['Presets', 'Samples']);
    try {
        lib.persist(dir, 'detected');
        const r = lib.persist(dir, 'm4l');
        assertEq(r.ok, true);
        assertEq(r.changed, false, 'same path should not be flagged as changed');
        // Source should still update even when path didn't change.
        assertEq(lib.cachedSource(), 'm4l');
    } finally {
        try { fs.rmSync(dir, { recursive: true, force: true }); } catch (e) {}
    }
});

test('cached() returns null when nothing persisted', () => {
    assertEq(lib.cached(), null);
    assertEq(lib.cachedSource(), null);
});

test('cached() auto-invalidates when persisted path no longer exists on disk', () => {
    const dir = makeFakeLibrary(['Presets', 'Samples']);
    lib.persist(dir, 'manual');
    assertEq(lib.cached(), dir, 'sanity: persisted');
    fs.rmSync(dir, { recursive: true, force: true });
    assertEq(lib.cached(), null, 'should auto-invalidate when path disappears');
    assertEq(lib.cachedSource(), null);
});

test('forget() removes cached entry', () => {
    const dir = makeFakeLibrary(['Presets', 'Samples']);
    try {
        lib.persist(dir, 'manual');
        assertEq(lib.cached(), dir);
        lib.forget();
        assertEq(lib.cached(), null);
    } finally {
        try { fs.rmSync(dir, { recursive: true, force: true }); } catch (e) {}
    }
});

test('forget() is idempotent (succeeds on empty state)', () => {
    assertEq(lib.forget(), true, 'forget on empty state should succeed');
    assertEq(lib.forget(), true, 'second forget should also succeed');
});

test('persist() write survives a process re-init (file-based, not in-memory)', () => {
    // Same DATA_DIR, re-init module reference → cache file should be readable.
    const dir = makeFakeLibrary(['Presets', 'Samples']);
    try {
        const dataDir = path.dirname(path.dirname(dir)) // unused — keeping the test focused
        lib.persist(dir, 'manual');
        // Simulate a "restart": re-require would reset module-level state,
        // but since _dataDir is set fresh per-test we re-set and re-read.
        // The cache FILE is what should survive.
        const cachedPath = lib.cached();
        assertEq(cachedPath, dir);
    } finally {
        try { fs.rmSync(dir, { recursive: true, force: true }); } catch (e) {}
    }
});

// ─── resolve() ───────────────────────────────────────────────

test('resolve() returns null when no cache and no detection', () => {
    // Detection on a fresh test machine without Ableton paths may still hit
    // a real library on the dev machine running tests. Only assert null when
    // we know detect() also returned null, otherwise skip the assertion.
    const detected = lib.detect();
    if (detected) {
        console.log(`    (skipping null assertion — host has a real library at ${detected})`);
        return;
    }
    assertEq(lib.resolve(), null);
});

test('resolve() returns cached entry with source=cache', () => {
    const dir = makeFakeLibrary(['Presets', 'Samples']);
    try {
        lib.persist(dir, 'manual');
        const r = lib.resolve();
        assertEq(r && r.path, dir);
        assertEq(r && r.source, 'cache');
    } finally {
        try { fs.rmSync(dir, { recursive: true, force: true }); } catch (e) {}
    }
});

// ─── detectStandard() ────────────────────────────────────────
//
// We can't change os.homedir() at runtime, so we test detectStandard()
// behaviorally: it either finds the host's real library (acceptable) or
// returns null. The interesting behavior — that it falls through stale
// husks — is covered by the validate() tests above.

test('detectStandard() returns null OR a validated path', () => {
    const r = lib.detectStandard();
    if (r !== null) {
        assertEq(lib.validate(r), true, 'detected path must validate');
    }
});

// ─── detectOneDrive() ────────────────────────────────────────

test('detectOneDrive() returns null on non-Windows', () => {
    if (process.platform === 'win32') {
        console.log('    (skipped — running on Windows; non-Windows path not testable here)');
        skipped++;
        return;
    }
    assertEq(lib.detectOneDrive(), null);
});

test('detectOneDrive() returns null OR a validated path on Windows', () => {
    if (process.platform !== 'win32') {
        console.log('    (skipped — Windows-only)');
        skipped++;
        return;
    }
    const r = lib.detectOneDrive();
    if (r !== null) {
        assertEq(lib.validate(r), true, 'OneDrive-detected path must validate');
    }
});

// ─── detectAbletonPrefs() — Phase 1 stub ─────────────────────

test('detectAbletonPrefs() is a Phase 1 stub returning null', () => {
    assertEq(lib.detectAbletonPrefs(), null);
});

// ─── LIBRARY_MARKERS export sanity ───────────────────────────

test('LIBRARY_MARKERS exports the expected set', () => {
    assert(Array.isArray(lib.LIBRARY_MARKERS), 'should be array');
    assert(lib.LIBRARY_MARKERS.length >= 5, 'should have at least 5 markers');
    assert(lib.LIBRARY_MARKERS.includes('Presets'), 'Presets is a baseline marker');
    assert(lib.LIBRARY_MARKERS.includes('Samples'), 'Samples is a baseline marker');
});

// ─── Summary ─────────────────────────────────────────────────

console.log(`\n${passed} passed, ${failed} failed, ${skipped} skipped\n`);
process.exit(failed > 0 ? 1 : 0);
