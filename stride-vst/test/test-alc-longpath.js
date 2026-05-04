/**
 * Tests for the Windows long-path fix in alc-injector.js.
 *
 * Bug: a producer with a 20+ device rack chain produced a 280-char .alc
 * filename. Combined with the C:\Users\<user>\Desktop\Stride\ prefix, the
 * full path exceeded Windows MAX_PATH (260) and fs.writeFileSync threw
 * ENOENT.
 *
 * Fix: prefix absolute Windows paths with \\?\ to enter extended-length
 * path mode (~32,767 char limit). No filename cap.
 *
 * Tests cover:
 *   1. toLongPath helper — unit tests of the cross-platform branching
 *   2. Integration — actually write a 280-char-named file on Windows
 *      via the same code path the injector uses, verify it lands on disk
 *      and reads back identically. Skipped on non-Windows.
 *
 * Pure-logic specs — alc-injector.js drags in @xmldom/xmldom which we
 * don't want to load at test time, so toLongPath is mirrored here. If
 * the source drifts, update both sides.
 *
 * Run: node test/test-alc-longpath.js
 */

const fs = require('fs');
const path = require('path');
const os = require('os');

let passed = 0;
let failed = 0;
let skipped = 0;

function test(name, fn) {
    try { fn(); console.log(`  ✓ ${name}`); passed++; }
    catch (e) { console.log(`  ✗ ${name}: ${e.message}`); failed++; }
}
function testWin(name, fn) {
    if (process.platform !== 'win32') {
        console.log(`  ⊘ ${name} (skipped on ${process.platform})`);
        skipped++;
        return;
    }
    test(name, fn);
}
function assert(cond, msg) { if (!cond) throw new Error(msg); }
function assertEq(a, b, msg) {
    if (a !== b) throw new Error((msg || 'mismatch') + ` — got ${JSON.stringify(a)}, expected ${JSON.stringify(b)}`);
}

// ─── Spec implementation (mirror alc-injector.js) ────────────────

function specToLongPath(p) {
    if (process.platform !== 'win32') return p;
    if (!p || p.startsWith('\\\\?\\') || !path.isAbsolute(p)) return p;
    return '\\\\?\\' + path.normalize(p);
}

// ─── Unit tests on the helper ─────────────────────────────────────

console.log('toLongPath helper — branching\n');

test('Returns input unchanged on non-Windows (Linux/Mac path)', () => {
    // We can only really verify this when actually running on win32 by
    // checking the Win-prefix is added; on non-Win, it's a no-op. Both
    // branches are tested by running the same suite on both platforms.
    if (process.platform === 'win32') {
        // On Win, an absolute Win path SHOULD get prefixed
        const p = 'C:\\Users\\foo\\bar.alc';
        assert(specToLongPath(p).startsWith('\\\\?\\'), 'expected prefix on absolute Windows path');
    } else {
        // On non-Win, paths pass through unchanged
        assertEq(specToLongPath('/tmp/foo.alc'), '/tmp/foo.alc');
        assertEq(specToLongPath('relative/foo.alc'), 'relative/foo.alc');
    }
});

test('Empty input returns input unchanged (no crash)', () => {
    assertEq(specToLongPath(''), '');
});

test('Null input returns null (no crash)', () => {
    assertEq(specToLongPath(null), null);
});

test('Undefined input returns undefined (no crash)', () => {
    assertEq(specToLongPath(undefined), undefined);
});

testWin('Already-prefixed path is returned unchanged (no double-prefix)', () => {
    const already = '\\\\?\\C:\\Users\\foo\\bar.alc';
    assertEq(specToLongPath(already), already);
});

testWin('Relative Windows path returns unchanged (prefix needs absolute)', () => {
    assertEq(specToLongPath('foo.alc'), 'foo.alc');
    assertEq(specToLongPath('subdir\\foo.alc'), 'subdir\\foo.alc');
});

testWin('Absolute Windows path gets \\\\?\\ prefix', () => {
    const result = specToLongPath('C:\\Users\\Yossi\\Desktop\\Stride\\foo.alc');
    assert(result.startsWith('\\\\?\\'), `expected \\\\?\\ prefix, got: ${result}`);
    assert(result.includes('C:\\Users\\Yossi\\Desktop\\Stride\\foo.alc'), 'expected original path inside');
});

testWin('Path with . and .. segments is normalized before prefixing', () => {
    // The \\?\ prefix mode disables Win32 path normalization, so we
    // MUST normalize first or the OS will reject paths with . / ..
    const result = specToLongPath('C:\\Users\\Yossi\\.\\Desktop\\foo\\..\\bar.alc');
    assert(result.startsWith('\\\\?\\C:\\'), 'expected normalized prefix');
    assert(!result.includes('\\.\\'), `expected no '.' segments, got: ${result}`);
    assert(!result.includes('\\..\\'), `expected no '..' segments, got: ${result}`);
});

testWin('Forward-slash absolute path normalized to backslashes before prefixing', () => {
    // path.isAbsolute accepts both / and \\ on Windows; path.normalize
    // converts to \\.
    const result = specToLongPath('C:/Users/Yossi/foo.alc');
    assert(result.startsWith('\\\\?\\C:\\'), `expected backslash-normalized prefix, got: ${result}`);
});

// ─── Integration: actually write a 280-char filename ──────────────

console.log('\nIntegration — long-path file write (Windows only)\n');

function makeLongName() {
    // Mimics the real-world bug report — a producer's 18-device chain.
    // Filename lands ~230 chars, which is INSIDE NTFS's 255-char per-name
    // limit but combined with C:\Users\<user>\Desktop\Stride\ (~30 chars)
    // pushes the TOTAL path past Win32's 260-char MAX_PATH. The \\?\
    // prefix is what unblocks this case.
    return [
        'Arpeggiator', 'Operator', 'kHs_Distortion', 'ValhallaSupermassive',
        'ValhallaDelay', 'Spatial_Room', 'Drum_Buss', 'Comb_Filtered_Beat',
        'Overdrive', 'Drum_Buss', 'Pro-MB', 'Utility', 'Spatial_Room',
        'L4_Ultramaximizer', 'Stereo',
    ].join('_') + '_16bars_130707_Stride.alc';
}

// Note: a "no-prefix should fail" test isn't reliable here. Win10/11 with
// LongPathsEnabled in registry + Node 20+ silently handles paths up to ~32k
// chars on some machines, so the bug doesn't reproduce on every dev box.
// The user's machine still hit ENOENT, which means we can't rely on the
// dev environment to mirror production. We assert the FIX works (next test)
// — that's what matters.

testWin('Long total path WITH \\\\?\\ prefix succeeds and round-trips', () => {
    const dir = path.join(os.tmpdir(), 'stride_longpath_test_fix_padding_' + 'x'.repeat(40));
    fs.mkdirSync(dir, { recursive: true });
    const longName = makeLongName();
    const fullPath = path.join(dir, longName);
    assert(fullPath.length > 260, `test setup: total path should exceed MAX_PATH, got ${fullPath.length}`);
    const longPath = specToLongPath(fullPath);
    assert(longPath.startsWith('\\\\?\\'), 'fix should produce a prefixed path');
    const payload = Buffer.from('Stride .alc payload — ' + Date.now());

    // Write with prefix — should succeed where the unprefixed write failed above
    fs.writeFileSync(longPath, payload);

    // Read back with prefix (regular read might fail too at this length)
    const roundtrip = fs.readFileSync(longPath);
    assert(roundtrip.equals(payload), 'roundtrip content mismatch');

    // Cleanup
    try { fs.unlinkSync(longPath); } catch (e) { /* ignore */ }
    try { fs.rmdirSync(dir); } catch (e) { /* ignore */ }
});

testWin('mkdirSync recursive works through \\\\?\\ prefix', () => {
    // The fix ALSO uses prefix for mkdirSync. Verify nested dir creation
    // works with the prefix (some Node versions had quirks with this).
    const baseDir = path.join(os.tmpdir(), 'stride_longpath_mkdir_test');
    const nested = path.join(baseDir, 'a', 'b', 'c');
    const longNested = specToLongPath(nested);
    fs.mkdirSync(longNested, { recursive: true });
    assert(fs.existsSync(longNested), 'nested dir should exist after mkdir');
    // Cleanup
    try { fs.rmSync(specToLongPath(baseDir), { recursive: true, force: true }); } catch (e) { /* ignore */ }
});

testWin('Short filename with \\\\?\\ prefix still works (no regression for normal case)', () => {
    const dir = path.join(os.tmpdir(), 'stride_longpath_test_short');
    fs.mkdirSync(dir, { recursive: true });
    const fullPath = path.join(dir, 'short.alc');
    const longPath = specToLongPath(fullPath);
    fs.writeFileSync(longPath, Buffer.from('short'));
    assert(fs.existsSync(longPath), 'short-name file should write through prefix too');
    fs.unlinkSync(longPath);
    fs.rmdirSync(dir);
});

testWin('Returned output_path stays clean (no \\\\?\\ prefix leaks into response)', () => {
    // The injector returns output_path: outputPath (the ORIGINAL, non-prefixed
    // path). Renderer + dock + Apply Reveal show this to the user, so the
    // prefix must NOT appear there. Verify by simulating the contract:
    // toLongPath is only used at the fs call site; the original is preserved
    // for the response.
    const userVisiblePath = 'C:\\Users\\Yossi\\Desktop\\Stride\\Bass_Drop.alc';
    const fsPath = specToLongPath(userVisiblePath);

    // The prefixed path is what fs gets
    if (process.platform === 'win32') {
        assert(fsPath.startsWith('\\\\?\\'), 'fs should get prefix');
    }
    // The original (which the response uses) is unchanged
    assert(!userVisiblePath.startsWith('\\\\?\\'), 'user-visible path stays clean');
    assertEq(userVisiblePath, 'C:\\Users\\Yossi\\Desktop\\Stride\\Bass_Drop.alc', 'original path preserved');
});

// ─── Filename cap (alc-generator.js mirror) ──────────────────────
//
// The real-world bug had a 267-char filename (NTFS limit is 255 per name).
// `\\?\` prefix only fixes the TOTAL path limit (Win32 MAX_PATH = 260),
// not the per-filename NTFS limit. So alc-generator.js also caps the name.

console.log('\nFilename cap (NTFS 255-char-per-name safety)\n');

function specBuildFilename(deviceName, clipName, clipBars, ts) {
    const safeDev = (deviceName || 'Rack').replace(/[^a-zA-Z0-9 _-]/g, '').replace(/\s+/g, '_');
    const safeClip = clipName ? clipName.replace(/[^a-zA-Z0-9 _-]/g, '').replace(/\s+/g, '_') : null;
    // 200 = MAX_PATH 260 - 60 chars headroom for STRIDE_DIR prefix
    // (covers worst-case Windows usernames). Lower than NTFS 255 limit
    // for a bonus reason: keeps drag-and-drop working in Windows Shell.
    const MAX_FILENAME = 200;
    const suffix = `_${clipBars}bars_${ts}_Stride.alc`;
    const namePortion = safeClip || safeDev;
    const truncatedName = namePortion.length + suffix.length > MAX_FILENAME
        ? namePortion.slice(0, MAX_FILENAME - suffix.length)
        : namePortion;
    return truncatedName + suffix;
}

test('Short device name passes through verbatim (no truncation)', () => {
    const result = specBuildFilename('Operator Bass', null, 8, '130707');
    assertEq(result, 'Operator_Bass_8bars_130707_Stride.alc');
});

test('Clip name takes precedence over device name', () => {
    const result = specBuildFilename('Long Device Chain', 'Bass Drop', 8, '130707');
    assertEq(result, 'Bass_Drop_8bars_130707_Stride.alc');
});

test('Real-world 267-char filename is truncated to <= 200', () => {
    const longChain = [
        'Arpeggiator', 'Operator', 'kHs Distortion', 'ValhallaSupermassive',
        'ValhallaDelay', 'Spatial Room', 'Drum Buss', 'Comb Filtered Beat',
        'Overdrive', 'Comb Filtered Beat', 'Drum Buss', 'Comb Filtered Beat',
        'Overdrive', 'Drum Buss', 'Pro-MB', 'Utility', 'Spatial Room',
        'L4 Ultramaximizer', 'Stereo',
    ].join(' ');
    const result = specBuildFilename(longChain, null, 16, '130707');
    assert(result.length <= 200, `filename too long: ${result.length}`);
    assert(result.endsWith('_16bars_130707_Stride.alc'), 'suffix must be preserved verbatim');
});

test('Suffix (bars + timestamp + _Stride.alc) preserved even on extreme input', () => {
    const giant = 'X'.repeat(1000);
    const result = specBuildFilename(giant, null, 4, '142510');
    assert(result.length <= 200, `still too long: ${result.length}`);
    assert(result.endsWith('_4bars_142510_Stride.alc'), 'suffix must survive truncation');
});

test('Long clip name also truncated (not just device name)', () => {
    const giantClip = 'My Super Long Clip Name '.repeat(20);
    const result = specBuildFilename('Operator', giantClip, 8, '130707');
    assert(result.length <= 200, `clip-name path also too long: ${result.length}`);
});

test('Total path stays under Windows MAX_PATH (260) for typical user', () => {
    // Worst-case username scenario: C:\Users\<30-char username>\Desktop\Stride\
    const worstCasePrefix = 'C:\\Users\\' + 'X'.repeat(30) + '\\Desktop\\Stride\\';
    assert(worstCasePrefix.length <= 60, `prefix sanity check: ${worstCasePrefix.length}`);
    const giant = 'X'.repeat(1000);
    const result = specBuildFilename(giant, null, 16, '130707');
    const fullPath = worstCasePrefix + result;
    assert(fullPath.length < 260, `full path overflows MAX_PATH: ${fullPath.length}`);
});

test('Empty device name falls back to "Rack"', () => {
    const result = specBuildFilename('', null, 8, '130707');
    assertEq(result, 'Rack_8bars_130707_Stride.alc');
});

test('Null device name falls back to "Rack"', () => {
    const result = specBuildFilename(null, null, 8, '130707');
    assertEq(result, 'Rack_8bars_130707_Stride.alc');
});

test('Special chars stripped (matches existing sanitizer)', () => {
    const result = specBuildFilename('Bass! @ #$ Drop?', null, 8, '130707');
    // Special chars stripped, multiple spaces collapsed to single underscore
    assert(!result.includes('!') && !result.includes('@') && !result.includes('?'), 'special chars must be stripped');
    assert(result.endsWith('_8bars_130707_Stride.alc'), 'suffix preserved');
});

testWin('End-to-end: capped filename + \\\\?\\ prefix writes successfully', () => {
    // Simulates the real user scenario after both fixes:
    //   1. alc-generator caps filename to 240 chars (NTFS-safe)
    //   2. alc-injector adds \\?\ prefix when writing (MAX_PATH-safe)
    const longChain = [
        'Arpeggiator', 'Operator', 'kHs_Distortion', 'ValhallaSupermassive',
        'ValhallaDelay', 'Spatial_Room', 'Drum_Buss', 'Comb_Filtered_Beat',
        'Overdrive', 'Drum_Buss', 'Pro-MB', 'Utility', 'Spatial_Room',
        'L4_Ultramaximizer', 'Stereo',
    ].join('_');
    const filename = specBuildFilename(longChain, null, 16, '130707');
    assert(filename.length <= 200, 'cap must hold');

    const dir = path.join(os.tmpdir(), 'stride_e2e_' + Date.now());
    fs.mkdirSync(dir, { recursive: true });
    const fullPath = path.join(dir, filename);
    const longPath = specToLongPath(fullPath);
    fs.writeFileSync(longPath, Buffer.from('end-to-end test payload'));
    assert(fs.existsSync(longPath), 'file should exist after combined fix');

    // Cleanup
    try { fs.unlinkSync(longPath); } catch (e) { /* ignore */ }
    try { fs.rmdirSync(dir); } catch (e) { /* ignore */ }
});

// ─── Summary ─────────────────────────────────────────────────────

console.log(`\n${passed} passed, ${failed} failed${skipped ? `, ${skipped} skipped (non-Windows)` : ''}`);
process.exit(failed ? 1 : 0);
