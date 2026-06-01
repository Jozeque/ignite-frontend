/**
 * Tests for the library-path resolver integration in main.js — specifically
 * the fix landed in commit d256d0f that makes _findUserLibraryDir() and
 * getDefaultUserLibraryPath() consult the resolver instead of using only
 * standard-location detection.
 *
 * Background: prior to the fix, the watcher in main.js used its own
 * hardcoded "check ~/Music/.../User Library, then ~/Documents/.../User Library"
 * detection — completely ignoring lib/library-path.js. For any user with a
 * relocated Ableton User Library (e.g. external SSD), the watcher silently
 * watched the wrong folder (or didn't start), drags never got detected, and
 * Apply silently used stale templates.
 *
 * The fix: _findUserLibraryDir() now calls libraryPath.resolve() first and
 * falls back to standard detection only as a cold-start safety net. The
 * persist-library-path IPC also now triggers restartLibraryWatcher() when
 * the resolved path changes — wiring the `changed` flag the resolver was
 * already returning but nobody read.
 *
 * SCOPE OF THIS TEST FILE:
 *   The fallback (standard-location detection) is unchanged from before the
 *   fix and already has coverage in test-library-path.js. These tests focus
 *   only on what CHANGED: the resolver-first semantics, the cache-precedence
 *   behavior, and the `changed` flag that drives restartLibraryWatcher().
 *
 *   We can't fake os.homedir(), so the fallback path isn't testable here.
 *   These tests verify "when the resolver has something, it wins" — which
 *   is the entire fix.
 *
 * Run: node test/test-library-fix-integration.js
 */

const fs = require('fs');
const path = require('path');
const os = require('os');

const lib = require('../app/lib/library-path');

let passed = 0;
let failed = 0;

function test(name, fn) {
    const tmpDataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'stride-libfix-data-'));
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

// MIRROR of main.js _findUserLibraryDir()'s resolver-first behavior.
// The fallback is not tested here (covered by test-library-path.js's
// detectStandard tests). What this verifies: when the resolver has a path,
// it's the one used. When it returns null, the function falls through.
function resolverFirst(libraryPath) {
    const resolved = libraryPath.resolve();
    if (resolved && resolved.path) return resolved.path;
    return null; // fallback would run here in production; not tested
}

// Build a fake User Library on disk with marker subfolders so validate() accepts it.
function makeFakeLibrary(markers) {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'stride-fake-lib-'));
    for (const m of (markers || ['Presets', 'Samples', 'Sounds'])) {
        fs.mkdirSync(path.join(root, m), { recursive: true });
    }
    return root;
}

console.log('\nlibrary-path fix — integration tests\n');


// ─── Resolver-first semantics (the core of the fix) ─────────────────────
console.log('Resolver-first semantics: cached path always wins over fallback');

test('m4l self-reports custom path → resolverFirst returns it', () => {
    const customLib = makeFakeLibrary();
    try {
        const persistResult = lib.persist(customLib, 'm4l');
        assert(persistResult.ok, 'persist should succeed for m4l source');
        assert(persistResult.changed, 'first persist must report changed=true');

        const result = resolverFirst(lib);
        assertEq(result, customLib, 'should return the m4l-reported custom path');
    } finally {
        try { fs.rmSync(customLib, { recursive: true, force: true }); } catch (e) {}
    }
});

test('manual-picker path → resolverFirst returns it (install-flow scenario)', () => {
    const customLib = makeFakeLibrary();
    try {
        // Simulates user clicking "Browse..." in install flow and picking custom dir
        const persistResult = lib.persist(customLib, 'manual');
        assert(persistResult.ok, 'manual source persists');

        const result = resolverFirst(lib);
        assertEq(result, customLib, 'manual-picked path flows through resolver');
    } finally {
        try { fs.rmSync(customLib, { recursive: true, force: true }); } catch (e) {}
    }
});

test('detected-by-resolver path → resolverFirst returns it', () => {
    const customLib = makeFakeLibrary();
    try {
        const persistResult = lib.persist(customLib, 'detected');
        assert(persistResult.ok);
        assertEq(resolverFirst(lib), customLib, 'any persist source flows through');
    } finally {
        try { fs.rmSync(customLib, { recursive: true, force: true }); } catch (e) {}
    }
});


// ─── Stale-cache invalidation (must not silently misfire) ───────────────
console.log('\nStale-cache invalidation');

test('cached path deleted → cache auto-invalidates → resolverFirst falls through', () => {
    const customLib = makeFakeLibrary();
    try {
        lib.persist(customLib, 'm4l');
        assertEq(resolverFirst(lib), customLib, 'pre-delete: cache wins');

        // User reorganizes — deletes the directory the cache points at
        fs.rmSync(customLib, { recursive: true, force: true });

        // Resolver's _readCache() validates existence — returns null on miss
        // But resolve() ALSO calls detect() which uses real os.homedir().
        // So result here is either the real-host library or null.
        const result = resolverFirst(lib);
        assert(result !== customLib, 'must not return the deleted path');
    } finally {
        try { fs.rmSync(customLib, { recursive: true, force: true }); } catch (e) {}
    }
});

test('forget() drops cache → resolverFirst returns to detection fallback', () => {
    const customLib = makeFakeLibrary();
    try {
        lib.persist(customLib, 'm4l');
        assertEq(resolverFirst(lib), customLib, 'pre-forget: cache wins');

        lib.forget();

        // After forget, resolve() falls to detect() which uses real os.homedir().
        // Result is either real-host library or null — but NOT the forgotten path.
        const result = resolverFirst(lib);
        assert(result !== customLib, 'must not return the forgotten path');
    } finally {
        try { fs.rmSync(customLib, { recursive: true, force: true }); } catch (e) {}
    }
});


// ─── The `changed` flag (drives restartLibraryWatcher) ──────────────────
console.log('\nThe `changed` flag (drives restartLibraryWatcher)');

test('first persist after cold start → changed=true → restart fires', () => {
    const customLib = makeFakeLibrary();
    try {
        assertEq(lib.cached(), null, 'cache is empty at start');
        const r = lib.persist(customLib, 'm4l');
        assertEq(r.ok, true);
        assertEq(r.changed, true, 'first persist always reports changed=true');
    } finally {
        try { fs.rmSync(customLib, { recursive: true, force: true }); } catch (e) {}
    }
});

test('reconnect with SAME path → changed=false → no restart (avoids flicker)', () => {
    const customLib = makeFakeLibrary();
    try {
        lib.persist(customLib, 'm4l');
        const r2 = lib.persist(customLib, 'm4l');
        assertEq(r2.ok, true);
        assertEq(r2.changed, false, 'same path twice → no restart');
    } finally {
        try { fs.rmSync(customLib, { recursive: true, force: true }); } catch (e) {}
    }
});

test('user moves library mid-session → changed=true → restart fires', () => {
    const oldLib = makeFakeLibrary();
    const newLib = makeFakeLibrary();
    try {
        lib.persist(oldLib, 'm4l');
        const move = lib.persist(newLib, 'm4l');
        assertEq(move.ok, true);
        assertEq(move.changed, true, 'different path → changed=true → restartLibraryWatcher() fires');
    } finally {
        try { fs.rmSync(oldLib, { recursive: true, force: true }); } catch (e) {}
        try { fs.rmSync(newLib, { recursive: true, force: true }); } catch (e) {}
    }
});

test('Stride install on Mac then re-launch → m4l confirms same path → no restart', () => {
    // First-launch case: install persists detected path → m4l later confirms same.
    const detectedLib = makeFakeLibrary();
    try {
        const install = lib.persist(detectedLib, 'detected');
        assertEq(install.changed, true);
        // Later: StrideLink connects, self-reports its location
        const m4lConfirm = lib.persist(detectedLib, 'm4l');
        assertEq(m4lConfirm.ok, true);
        assertEq(m4lConfirm.changed, false, 'install+m4l agree → no unnecessary restart');
    } finally {
        try { fs.rmSync(detectedLib, { recursive: true, force: true }); } catch (e) {}
    }
});

test('Stride installed in default loc, user moves Ableton Library → m4l → restart', () => {
    // Nigel scenario: install was at default, user later moves library to SSD,
    // launches Ableton with StrideLink which now lives at the new path.
    const oldDefaultLib = makeFakeLibrary();
    const newSsdLib = makeFakeLibrary();
    try {
        lib.persist(oldDefaultLib, 'detected'); // install put it here originally
        const m4l = lib.persist(newSsdLib, 'm4l'); // StrideLink now reports SSD
        assertEq(m4l.ok, true);
        assertEq(m4l.changed, true, 'm4l-reported new path → restart watcher');
        assertEq(resolverFirst(lib), newSsdLib, 'subsequent resolve returns SSD path');
    } finally {
        try { fs.rmSync(oldDefaultLib, { recursive: true, force: true }); } catch (e) {}
        try { fs.rmSync(newSsdLib, { recursive: true, force: true }); } catch (e) {}
    }
});


// ─── Defensive: persist failures don't trigger phantom restarts ─────────
console.log('\nDefensive: rejected persist calls do not trigger restart');

test('persist with empty path → ok:false → IPC handler skips restart', () => {
    const result = lib.persist('', 'm4l');
    assertEq(result.ok, false, 'empty path rejected');
    // The IPC handler condition is: result && result.ok && result.changed
    // With ok:false, restart is skipped — exactly what we want.
    assert(!result.ok, 'IPC handler condition guards against this');
});

test('persist with null path → ok:false → IPC handler skips restart', () => {
    const result = lib.persist(null, 'm4l');
    assertEq(result.ok, false, 'null path rejected');
});

test('persist with non-string path → ok:false → IPC handler skips restart', () => {
    const result = lib.persist({}, 'm4l');
    assertEq(result.ok, false, 'non-string path rejected');
});

test('persist non-m4l source with invalid library → ok:false', () => {
    // For non-m4l sources (manual, detected), the path must pass validate().
    // An invalid (non-Library-looking) folder is rejected.
    const bogus = fs.mkdtempSync(path.join(os.tmpdir(), 'stride-bogus-'));
    try {
        const result = lib.persist(bogus, 'manual');
        assertEq(result.ok, false, 'manual source needs valid library');
    } finally {
        try { fs.rmSync(bogus, { recursive: true, force: true }); } catch (e) {}
    }
});

test('persist m4l source with non-validating path → still ok (bypasses validate)', () => {
    // m4l is authoritative: StrideLink is INSIDE the User Library by definition.
    // Even if the folder lacks marker subdirs, trust m4l's self-report.
    const minimal = fs.mkdtempSync(path.join(os.tmpdir(), 'stride-minimal-'));
    try {
        const result = lib.persist(minimal, 'm4l');
        assertEq(result.ok, true, 'm4l source bypasses validate()');
    } finally {
        try { fs.rmSync(minimal, { recursive: true, force: true }); } catch (e) {}
    }
});


// ─── The full Nigel scenario (state-machine sequence) ──────────────────
console.log('\nFull Nigel scenario as a state-machine');

test('cold start → empty → m4l SSD → restart → drag detected at SSD path', () => {
    const ssdLib = makeFakeLibrary();
    try {
        // State 1: app cold-starts. Cache is empty.
        assertEq(lib.cached(), null, 'state 1: no cache yet');

        // State 2: StrideLink connects, sends m4l_ready with SSD path.
        // IPC handler runs: const result = libraryPath.persist(libPath, source);
        // result.ok === true, result.changed === true → restartLibraryWatcher() fires.
        const persistResult = lib.persist(ssdLib, 'm4l');
        assertEq(persistResult.ok, true);
        assertEq(persistResult.changed, true,
            'state 2: changed flag means restartLibraryWatcher() fires');

        // State 3: watcher restarts, calls _findUserLibraryDir() which now
        // resolves to SSD path. Watcher starts on SSD.
        assertEq(resolverFirst(lib), ssdLib,
            'state 3: watcher would watch SSD library');

        // State 4: Nigel drags a clip to SSD library. fs.watch fires.
        // (Not testable here — that's Electron-side. But the WIRING is correct.)

        // State 5: StrideLink reconnects (Ableton restart). Same SSD path.
        const reconnect = lib.persist(ssdLib, 'm4l');
        assertEq(reconnect.ok, true);
        assertEq(reconnect.changed, false,
            'state 5: reconnect with same path → no flicker, watcher keeps running');
    } finally {
        try { fs.rmSync(ssdLib, { recursive: true, force: true }); } catch (e) {}
    }
});


console.log(`\n${passed} passed, ${failed} failed\n`);
process.exit(failed > 0 ? 1 : 0);
