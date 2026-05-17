/**
 * Tests for stride-vst/app/lib/install-verify.js
 *
 * Backs the verify patch added to installStrideLinkToAbleton in main.js.
 * Covers the predicate that decides whether an install actually deposited
 * the critical files — both pre-flight (source bundle complete?) and
 * post-copy (target populated?).
 *
 * Run: node test/test-install-verify.js
 *
 * Style mirrors test-library-path.js + test-alc-longpath.js: real
 * filesystem under os.tmpdir(), no mock libraries.
 */

const fs = require('fs');
const path = require('path');
const os = require('os');

const {
    INSTALL_REQUIRED_FILES,
    INSTALL_MARKER_FILENAME,
    checkInstallFiles,
    checkInstallSource,
    readInstallMarker,
    writeInstallMarker,
} = require('../app/lib/install-verify');

let passed = 0;
let failed = 0;

function test(name, fn) {
    try {
        fn();
        console.log(`  ✓ ${name}`);
        passed++;
    } catch (e) {
        console.log(`  ✗ ${name}: ${e.message}`);
        if (e.stack) console.log(e.stack.split('\n').slice(1, 4).join('\n'));
        failed++;
    }
}

function assert(cond, msg) { if (!cond) throw new Error(msg || 'assertion failed'); }
function assertEq(a, b, msg) {
    if (a !== b) throw new Error((msg || 'mismatch') + ` — got ${JSON.stringify(a)}, expected ${JSON.stringify(b)}`);
}
function assertDeepEq(a, b, msg) {
    if (JSON.stringify(a) !== JSON.stringify(b)) {
        throw new Error((msg || 'mismatch') + ` — got ${JSON.stringify(a)}, expected ${JSON.stringify(b)}`);
    }
}

// Helper: populate a directory with every required file so checkInstallFiles
// returns []. Useful base state — tests then delete one at a time to verify
// specific missing files are surfaced.
function populateFullyValidInstall(dir) {
    for (const rel of INSTALL_REQUIRED_FILES) {
        const full = path.join(dir, rel);
        fs.mkdirSync(path.dirname(full), { recursive: true });
        fs.writeFileSync(full, 'fixture');
    }
}

console.log('\ninstall-verify.js — verify-patch tests\n');

// ─── INSTALL_REQUIRED_FILES sanity ───────────────────────────

test('INSTALL_REQUIRED_FILES is non-empty and contains expected entries', () => {
    assert(Array.isArray(INSTALL_REQUIRED_FILES), 'should be array');
    assert(INSTALL_REQUIRED_FILES.length >= 3, 'should have at least 3 required files');
    assert(INSTALL_REQUIRED_FILES.includes('StrideLink.amxd'), 'StrideLink.amxd is required');
    assert(INSTALL_REQUIRED_FILES.includes('server.js'), 'server.js is required');
    // The node_modules/ws/package.json check is the strong-evidence one —
    // confirms node_modules tree was actually copied, not just an empty husk.
    assert(
        INSTALL_REQUIRED_FILES.some(f => f.includes('ws') && f.endsWith('package.json')),
        'should check for ws/package.json (not just the ws/ folder, which would false-pass on empty)'
    );
});

// ─── checkInstallFiles() — null / empty dir cases ─────────────

test('checkInstallFiles(null) returns the full required list', () => {
    assertDeepEq(checkInstallFiles(null), INSTALL_REQUIRED_FILES.slice());
});

test('checkInstallFiles(undefined) returns the full required list', () => {
    assertDeepEq(checkInstallFiles(undefined), INSTALL_REQUIRED_FILES.slice());
});

test('checkInstallFiles("") returns the full required list', () => {
    assertDeepEq(checkInstallFiles(''), INSTALL_REQUIRED_FILES.slice());
});

test('checkInstallFiles on a non-existent path returns the full list', () => {
    // No throw — just everything missing.
    const result = checkInstallFiles('/this/path/definitely/does/not/exist/zzz');
    assertDeepEq(result, INSTALL_REQUIRED_FILES.slice());
});

// ─── checkInstallFiles() — empty / partial / full dirs ────────

test('empty dir: all required files reported missing', () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'stride-iv-empty-'));
    try {
        assertDeepEq(checkInstallFiles(tmp), INSTALL_REQUIRED_FILES.slice());
    } finally {
        fs.rmSync(tmp, { recursive: true, force: true });
    }
});

test('fully populated dir: no missing files (returns [])', () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'stride-iv-full-'));
    try {
        populateFullyValidInstall(tmp);
        assertDeepEq(checkInstallFiles(tmp), [], 'should report nothing missing');
    } finally {
        fs.rmSync(tmp, { recursive: true, force: true });
    }
});

test('missing one required file is reported (just that one)', () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'stride-iv-partial-'));
    try {
        populateFullyValidInstall(tmp);
        // Remove StrideLink.amxd specifically
        fs.unlinkSync(path.join(tmp, 'StrideLink.amxd'));
        const missing = checkInstallFiles(tmp);
        assertEq(missing.length, 1, 'should report exactly 1 missing');
        assertEq(missing[0], 'StrideLink.amxd');
    } finally {
        fs.rmSync(tmp, { recursive: true, force: true });
    }
});

test('missing node_modules/ws/package.json is reported (the strong-evidence check)', () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'stride-iv-noWs-'));
    try {
        populateFullyValidInstall(tmp);
        const wsPkg = INSTALL_REQUIRED_FILES.find(f => f.includes('ws') && f.endsWith('package.json'));
        fs.unlinkSync(path.join(tmp, wsPkg));
        const missing = checkInstallFiles(tmp);
        assertEq(missing.length, 1);
        assertEq(missing[0], wsPkg);
    } finally {
        fs.rmSync(tmp, { recursive: true, force: true });
    }
});

test('EMPTY node_modules/ws/ directory still flagged as missing (the false-pass guard)', () => {
    // This is the key regression test for the change from `node_modules/ws`
    // (folder check, false-passes on empty) → `node_modules/ws/package.json`
    // (file check, only passes when actual content present).
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'stride-iv-emptyWs-'));
    try {
        // Populate the OTHER required files normally.
        fs.writeFileSync(path.join(tmp, 'StrideLink.amxd'), 'fixture');
        fs.writeFileSync(path.join(tmp, 'server.js'), 'fixture');
        // Create node_modules/ws/ as an EMPTY directory (no package.json).
        fs.mkdirSync(path.join(tmp, 'node_modules', 'ws'), { recursive: true });
        // The check should catch this — folder exists but is a husk.
        const missing = checkInstallFiles(tmp);
        assertEq(missing.length, 1, 'empty ws/ folder should be flagged');
        assert(missing[0].endsWith('package.json'), 'the missing entry is the package.json file');
    } finally {
        fs.rmSync(tmp, { recursive: true, force: true });
    }
});

test('missing multiple required files reports all of them', () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'stride-iv-twoMissing-'));
    try {
        populateFullyValidInstall(tmp);
        fs.unlinkSync(path.join(tmp, 'StrideLink.amxd'));
        fs.unlinkSync(path.join(tmp, 'server.js'));
        const missing = checkInstallFiles(tmp);
        assertEq(missing.length, 2);
        assert(missing.includes('StrideLink.amxd'));
        assert(missing.includes('server.js'));
    } finally {
        fs.rmSync(tmp, { recursive: true, force: true });
    }
});

// ─── checkInstallSource() — pre-flight with extras (dev-mode case) ──

test('checkInstallSource: packaged-style flat dir + no extras = behaves like checkInstallFiles', () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'stride-iv-flat-'));
    try {
        populateFullyValidInstall(tmp);
        assertDeepEq(checkInstallSource(tmp, []), [],
            'fully populated primary + no extras = nothing missing');
    } finally {
        fs.rmSync(tmp, { recursive: true, force: true });
    }
});

test('checkInstallSource: dev-style split layout (amxd as extra) reports nothing missing', () => {
    // Simulate dev mode: primaryDir has server.js + node_modules but NOT
    // StrideLink.amxd. The amxd is passed as an extra (sibling file).
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'stride-iv-dev-'));
    try {
        // Populate primary with everything except StrideLink.amxd
        for (const rel of INSTALL_REQUIRED_FILES) {
            if (rel === 'StrideLink.amxd') continue;
            const full = path.join(tmp, rel);
            fs.mkdirSync(path.dirname(full), { recursive: true });
            fs.writeFileSync(full, 'fixture');
        }
        // Create a separate "extras" file simulating m4l/StrideLink.amxd
        const extraTmp = fs.mkdtempSync(path.join(os.tmpdir(), 'stride-iv-extras-'));
        const amxdExtra = path.join(extraTmp, 'StrideLink.amxd');
        fs.writeFileSync(amxdExtra, 'fixture');
        try {
            assertDeepEq(
                checkInstallSource(tmp, [amxdExtra]),
                [],
                'primary missing StrideLink.amxd is covered by the extra'
            );
        } finally {
            fs.rmSync(extraTmp, { recursive: true, force: true });
        }
    } finally {
        fs.rmSync(tmp, { recursive: true, force: true });
    }
});

test('checkInstallSource: empty primary + no extras = all missing', () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'stride-iv-empty-source-'));
    try {
        assertDeepEq(
            checkInstallSource(tmp, []),
            INSTALL_REQUIRED_FILES.slice(),
            'nothing in primary, no extras = everything reported missing'
        );
    } finally {
        fs.rmSync(tmp, { recursive: true, force: true });
    }
});

test('checkInstallSource: nested required (node_modules/ws/...) cannot be satisfied by extras', () => {
    // Extras are flat-basename matched only. A nested required path like
    // node_modules/ws/package.json cannot be covered by passing an extra
    // file named "package.json" — that's intentional, extras are for
    // flat top-level files, the dep tree must come through primaryDir.
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'stride-iv-nested-'));
    try {
        // Primary has nothing
        // Extras has a misleading "package.json"
        const extraTmp = fs.mkdtempSync(path.join(os.tmpdir(), 'stride-iv-fake-'));
        const fakePkg = path.join(extraTmp, 'package.json');
        fs.writeFileSync(fakePkg, '{}');
        try {
            const missing = checkInstallSource(tmp, [fakePkg]);
            // The nested ws/package.json entry should still be missing,
            // even though there's a top-level package.json extra.
            assert(
                missing.some(m => m.includes('ws') && m.endsWith('package.json')),
                'ws/package.json must not be satisfied by a top-level package.json extra'
            );
        } finally {
            fs.rmSync(extraTmp, { recursive: true, force: true });
        }
    } finally {
        fs.rmSync(tmp, { recursive: true, force: true });
    }
});

test('checkInstallSource: null/undefined primaryDir is tolerated', () => {
    // Edge case — handler shouldn't blow up if caller passes a falsy dir.
    assertDeepEq(checkInstallSource(null, []), INSTALL_REQUIRED_FILES.slice());
    assertDeepEq(checkInstallSource(undefined, []), INSTALL_REQUIRED_FILES.slice());
});

// ─── Version marker — write / read / round-trip ─────────────

test('INSTALL_MARKER_FILENAME is exported and looks like a metadata filename', () => {
    assert(typeof INSTALL_MARKER_FILENAME === 'string' && INSTALL_MARKER_FILENAME.length > 0,
        'should be a non-empty string');
    assert(INSTALL_MARKER_FILENAME.includes('version') || INSTALL_MARKER_FILENAME.includes('build'),
        'filename should hint at its purpose so future-me knows what it is');
});

test('writeInstallMarker + readInstallMarker round-trip', () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'stride-iv-marker-rt-'));
    try {
        const ok = writeInstallMarker(tmp, '1.0.5');
        assertEq(ok, true);
        assertEq(readInstallMarker(tmp), '1.0.5');
    } finally {
        fs.rmSync(tmp, { recursive: true, force: true });
    }
});

test('readInstallMarker returns null when marker is missing', () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'stride-iv-marker-miss-'));
    try {
        assertEq(readInstallMarker(tmp), null);
    } finally {
        fs.rmSync(tmp, { recursive: true, force: true });
    }
});

test('readInstallMarker returns null for an empty marker file', () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'stride-iv-marker-empty-'));
    try {
        fs.writeFileSync(path.join(tmp, INSTALL_MARKER_FILENAME), '');
        assertEq(readInstallMarker(tmp), null, 'empty content should read as null');
    } finally {
        fs.rmSync(tmp, { recursive: true, force: true });
    }
});

test('readInstallMarker trims whitespace + newlines', () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'stride-iv-marker-ws-'));
    try {
        fs.writeFileSync(path.join(tmp, INSTALL_MARKER_FILENAME), '  1.0.5  \n');
        assertEq(readInstallMarker(tmp), '1.0.5');
    } finally {
        fs.rmSync(tmp, { recursive: true, force: true });
    }
});

test('readInstallMarker tolerates null/undefined/empty dir', () => {
    assertEq(readInstallMarker(null), null);
    assertEq(readInstallMarker(undefined), null);
    assertEq(readInstallMarker(''), null);
});

test('writeInstallMarker rejects bad inputs without throwing', () => {
    assertEq(writeInstallMarker(null, '1.0'), false);
    assertEq(writeInstallMarker(undefined, '1.0'), false);
    assertEq(writeInstallMarker('', '1.0'), false);
    assertEq(writeInstallMarker('/some/dir', null), false);
    assertEq(writeInstallMarker('/some/dir', undefined), false);
    assertEq(writeInstallMarker('/some/dir', ''), false);
    assertEq(writeInstallMarker('/some/dir', 123), false, 'non-string version rejected');
});

test('writeInstallMarker returns false when dir does not exist (does not throw)', () => {
    const ok = writeInstallMarker('/this/path/should/not/exist/zzz-stride', '1.0.5');
    assertEq(ok, false);
});

test('version mismatch detection — the core update use case', () => {
    // Simulate: install at v1.0.4, then user updates Stride to v1.0.5.
    // The marker says "1.0.4" but currentVersion is "1.0.5" — mismatch
    // should trigger the "fall through to fresh copy" code path in the
    // install handler. Here we just verify the predicate building block.
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'stride-iv-marker-mismatch-'));
    try {
        writeInstallMarker(tmp, '1.0.4');
        const installed = readInstallMarker(tmp);
        const current = '1.0.5';
        assert(installed !== current, 'mismatch detected → handler will do fresh copy');
        assert(installed === '1.0.4', 'marker read returns the previously-installed version unchanged');
    } finally {
        fs.rmSync(tmp, { recursive: true, force: true });
    }
});

test('overwrite: writing a new version replaces the old marker', () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'stride-iv-marker-overwrite-'));
    try {
        writeInstallMarker(tmp, '1.0.4');
        assertEq(readInstallMarker(tmp), '1.0.4');
        writeInstallMarker(tmp, '1.0.5');
        assertEq(readInstallMarker(tmp), '1.0.5', 'second write should replace, not append');
    } finally {
        fs.rmSync(tmp, { recursive: true, force: true });
    }
});

test('returns a fresh copy of INSTALL_REQUIRED_FILES — caller mutations do not leak', () => {
    // Important: the null/empty branch returns `.slice()`. If we returned
    // the raw array by reference, a caller pushing to the result would
    // corrupt the constant for every future call. Guard against regressions.
    const r1 = checkInstallFiles(null);
    r1.push('attacker_added_file');
    const r2 = checkInstallFiles(null);
    assert(
        !r2.includes('attacker_added_file'),
        'second call should not see the mutation from the first call'
    );
});

// ─── Summary ─────────────────────────────────────────────────

console.log(`\n${passed} passed, ${failed} failed\n`);
process.exit(failed > 0 ? 1 : 0);
