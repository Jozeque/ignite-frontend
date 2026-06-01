/**
 * Tests for the pattern library manifest: schema integrity,
 * controlled-vocab compliance, file existence on disk.
 *
 * Run: node test/test-pattern-manifest.js
 */

const fs = require('fs');
const path = require('path');
const loader = require('../app/renderer/pattern-loader.js');

let passed = 0;
let failed = 0;

function test(name, fn) {
    try { fn(); console.log(`  ✓ ${name}`); passed++; }
    catch (e) { console.log(`  ✗ ${name}: ${e.message}`); failed++; }
}
function assert(cond, msg) { if (!cond) throw new Error(msg); }
function assertEq(a, b, msg) {
    if (a !== b) throw new Error((msg || 'mismatch') + ` — got ${JSON.stringify(a)}, expected ${JSON.stringify(b)}`);
}

const MANIFEST_PATH = path.join(__dirname, '..', 'app', 'assets', 'patterns', 'manifest.json');
const PATTERNS_ROOT = path.dirname(MANIFEST_PATH);

console.log('\n── Pattern Manifest ───────────────────────────\n');

let manifest;

test('manifest.json exists and is valid JSON', () => {
    assert(fs.existsSync(MANIFEST_PATH), 'manifest.json missing');
    const raw = fs.readFileSync(MANIFEST_PATH, 'utf8');
    manifest = JSON.parse(raw);
});

test('manifest validates against schema', () => {
    const v = loader.validateManifest(manifest);
    assert(v.ok, 'validation errors: ' + v.errors.join('; '));
});

test('manifest has version 1', () => {
    assertEq(manifest.version, 1);
});

test('manifest.patterns is non-empty array (v1.2 ships with placeholders)', () => {
    assert(Array.isArray(manifest.patterns), 'patterns not an array');
    assert(manifest.patterns.length > 0, 'patterns is empty');
});

test('every pattern has all required fields', () => {
    for (const p of manifest.patterns) {
        for (const f of loader.REQUIRED_FIELDS) {
            assert(p[f] !== undefined && p[f] !== null && p[f] !== '',
                `pattern "${p.id}" missing field "${f}"`);
        }
    }
});

test('no duplicate pattern ids', () => {
    const ids = manifest.patterns.map(p => p.id);
    const unique = new Set(ids);
    assertEq(ids.length, unique.size, 'duplicate ids present');
});

test('every category is in the pinned vocab', () => {
    for (const p of manifest.patterns) {
        assert(loader.VALID_CATEGORIES.includes(p.category),
            `pattern "${p.id}" has invalid category "${p.category}"`);
    }
});

test('every style tag is in the pinned style vocab', () => {
    for (const p of manifest.patterns) {
        for (const s of (p.style || [])) {
            assert(loader.VALID_STYLES.includes(s),
                `pattern "${p.id}" has invalid style "${s}"`);
        }
    }
});

test('every .mid file referenced by manifest exists on disk', () => {
    for (const p of manifest.patterns) {
        const full = path.join(PATTERNS_ROOT, p.file);
        assert(fs.existsSync(full), `pattern file missing: ${p.file}`);
        const stat = fs.statSync(full);
        assert(stat.size > 14, `pattern file too small (likely empty): ${p.file} (${stat.size} bytes)`);
    }
});

test('every .mid file starts with MThd magic bytes', () => {
    for (const p of manifest.patterns) {
        const full = path.join(PATTERNS_ROOT, p.file);
        const buf = fs.readFileSync(full);
        const magic = buf.subarray(0, 4).toString('ascii');
        assertEq(magic, 'MThd', `${p.file} bad MIDI header`);
    }
});

test('createLibrary builds a working index', () => {
    const lib = loader.createLibrary(manifest);
    assert(lib.valid, 'library invalid: ' + lib.errors.join('; '));
    assertEq(lib.patterns.length, manifest.patterns.length);
    for (const p of manifest.patterns) {
        const got = lib.getById(p.id);
        assert(got !== null, `getById failed for ${p.id}`);
        assertEq(got.id, p.id);
    }
});

test('listCategories returns counts per category', () => {
    const lib = loader.createLibrary(manifest);
    const counts = lib.listCategories();
    // Sum should equal total patterns
    const sum = Object.values(counts).reduce((a, b) => a + b, 0);
    assertEq(sum, manifest.patterns.length);
});

console.log(`\nResults: ${passed} passed, ${failed} failed\n`);
if (failed > 0) process.exit(1);
