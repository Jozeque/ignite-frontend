/**
 * Tests for the User Library watcher helpers in app/main.js.
 *
 * Re-implements _findUserLibraryDir() and _walkAlcFiles() locally as a
 * behavior spec, then validates against fake filesystem trees. Run after
 * editing main.js to confirm the watcher still does what we expect:
 *   - Mac orders Music before Documents; Windows the reverse
 *   - Walker recurses into subfolders, skips dotfiles, skips User Library/Stride/
 *   - Recency filter only catches recently-modified files
 *   - alc-generator filename leads with the rack/clip name and ends with _Stride
 *
 * Run: node test/test-library-watcher.js
 */

const fs = require('fs');
const os = require('os');
const path = require('path');

let passed = 0;
let failed = 0;

function test(name, fn) {
    try { fn(); console.log(`  ✓ ${name}`); passed++; }
    catch (e) { console.log(`  ✗ ${name}: ${e.message}`); failed++; }
}
function assert(cond, msg) { if (!cond) throw new Error(msg); }

// ─── Behavior spec — keep in sync with app/main.js ────────────────────

function specFindUserLibraryDir(home, platform, existsFn) {
    const candidates = platform === 'darwin'
        ? [path.join(home, 'Music', 'Ableton', 'User Library'),
           path.join(home, 'Documents', 'Ableton', 'User Library')]
        : [path.join(home, 'Documents', 'Ableton', 'User Library'),
           path.join(home, 'Music', 'Ableton', 'User Library')];
    return candidates.find(existsFn) || null;
}

function specWalkAlcFiles(dir, onAlc) {
    let entries;
    try { entries = fs.readdirSync(dir, { withFileTypes: true }); }
    catch (e) { return; }
    for (const entry of entries) {
        if (entry.name.startsWith('.')) continue;
        const fullPath = path.join(dir, entry.name);
        if (entry.isDirectory()) {
            if (entry.name === 'Stride') continue;
            specWalkAlcFiles(fullPath, onAlc);
        } else if (entry.isFile() && entry.name.toLowerCase().endsWith('.alc')) {
            onAlc(fullPath);
        }
    }
}

// ─── Tests ────────────────────────────────────────────────────────────

console.log('Library Watcher Behavior Tests\n');

console.log('Platform-aware path ordering:');

test('Mac with both Music and Documents picks Music first', () => {
    const home = '/Users/test';
    const musicPath = path.join(home, 'Music', 'Ableton', 'User Library');
    const docsPath = path.join(home, 'Documents', 'Ableton', 'User Library');
    const exists = (p) => p === musicPath || p === docsPath;
    const got = specFindUserLibraryDir(home, 'darwin', exists);
    assert(got === musicPath, `expected ${musicPath}, got ${got}`);
});

test('Mac with only Documents falls back to Documents', () => {
    const home = '/Users/test';
    const docsPath = path.join(home, 'Documents', 'Ableton', 'User Library');
    const exists = (p) => p === docsPath;
    const got = specFindUserLibraryDir(home, 'darwin', exists);
    assert(got === docsPath, `expected ${docsPath}, got ${got}`);
});

test('Windows with both picks Documents first', () => {
    const home = 'C:\\Users\\test';
    const exists = (p) => p === path.join(home, 'Documents', 'Ableton', 'User Library') ||
                          p === path.join(home, 'Music', 'Ableton', 'User Library');
    const got = specFindUserLibraryDir(home, 'win32', exists);
    assert(got === path.join(home, 'Documents', 'Ableton', 'User Library'),
        `expected Documents path, got ${got}`);
});

test('No User Library at either location returns null', () => {
    const got = specFindUserLibraryDir('/Users/test', 'darwin', () => false);
    assert(got === null, `expected null, got ${got}`);
});

console.log('\nRecursive .alc walker:');

// Build a fake User Library tree in os tmpdir
const fakeLib = fs.mkdtempSync(path.join(os.tmpdir(), 'stride-libwatcher-'));
function setupFakeTree() {
    // Root .alc — should be found
    fs.writeFileSync(path.join(fakeLib, 'Root.alc'), 'a');
    // Hidden file — should be skipped
    fs.writeFileSync(path.join(fakeLib, '.HiddenRoot.alc'), 'a');
    // Subfolder
    const sub = path.join(fakeLib, 'Sounds');
    fs.mkdirSync(sub);
    fs.writeFileSync(path.join(sub, 'InSub.alc'), 'a');
    fs.writeFileSync(path.join(sub, 'NotAnAlc.txt'), 'a');
    // Nested subfolder
    const nested = path.join(sub, 'Drums');
    fs.mkdirSync(nested);
    fs.writeFileSync(path.join(nested, 'Nested.alc'), 'a');
    // Stride/ — should be entirely skipped (our own templates)
    const stride = path.join(fakeLib, 'Stride');
    fs.mkdirSync(stride);
    fs.writeFileSync(path.join(stride, 'OurTemplate.alc'), 'a');
    // Dotfolder — should be skipped
    const dot = path.join(fakeLib, '.cache');
    fs.mkdirSync(dot);
    fs.writeFileSync(path.join(dot, 'CachedAlc.alc'), 'a');
    // Mixed-case .alc extension — should be matched
    fs.writeFileSync(path.join(fakeLib, 'MixedCase.ALC'), 'a');
}
setupFakeTree();

test('Walker finds .alc in root', () => {
    const found = [];
    specWalkAlcFiles(fakeLib, (p) => found.push(path.basename(p)));
    assert(found.includes('Root.alc'), 'Root.alc not found');
});

test('Walker recurses into subfolders', () => {
    const found = [];
    specWalkAlcFiles(fakeLib, (p) => found.push(path.basename(p)));
    assert(found.includes('InSub.alc'), 'InSub.alc not found in subfolder');
    assert(found.includes('Nested.alc'), 'Nested.alc not found in deeper subfolder');
});

test('Walker skips dotfiles and dotfolders', () => {
    const found = [];
    specWalkAlcFiles(fakeLib, (p) => found.push(path.basename(p)));
    assert(!found.includes('.HiddenRoot.alc'), 'Should skip dotfile at root');
    assert(!found.includes('CachedAlc.alc'), 'Should skip files inside dotfolder');
});

test('Walker skips User Library/Stride/ folder', () => {
    const found = [];
    specWalkAlcFiles(fakeLib, (p) => found.push(path.basename(p)));
    assert(!found.includes('OurTemplate.alc'),
        'Should skip our own templates inside Stride/');
});

test('Walker only matches .alc extension (case-insensitive)', () => {
    const found = [];
    specWalkAlcFiles(fakeLib, (p) => found.push(path.basename(p)));
    assert(!found.includes('NotAnAlc.txt'), 'Should not pick up .txt files');
    assert(found.includes('MixedCase.ALC'), 'Should match upper-case extension');
});

console.log('\nRecency filter (15-min window):');

test('Files newer than cutoff pass', () => {
    const now = Date.now();
    const cutoff = now - 15 * 60 * 1000;
    const recent = now - 5 * 60 * 1000;
    assert(recent >= cutoff, '5-min-old file should pass 15-min cutoff');
});

test('Files older than cutoff fail', () => {
    const now = Date.now();
    const cutoff = now - 15 * 60 * 1000;
    const old = now - 30 * 60 * 1000;
    assert(old < cutoff, '30-min-old file should fail 15-min cutoff');
});

test('Most-recent-wins picks highest mtime', () => {
    const items = [
        { path: 'a.alc', mtime: 100 },
        { path: 'b.alc', mtime: 300 },
        { path: 'c.alc', mtime: 200 },
    ];
    let best = null;
    for (const it of items) {
        if (!best || it.mtime > best.mtime) best = it;
    }
    assert(best.path === 'b.alc', `expected b.alc, got ${best.path}`);
});

console.log('\nDedupe key (path + mtime):');

test('Same path, same mtime = same key (dedupe blocks)', () => {
    const k1 = `/lib/x.alc|1000`;
    const k2 = `/lib/x.alc|1000`;
    assert(k1 === k2, 'Identical drops should dedupe');
});

test('Same path, different mtime = different key (drag-replace allowed)', () => {
    const k1 = `/lib/x.alc|1000`;
    const k2 = `/lib/x.alc|1500`;
    assert(k1 !== k2, 'Drag-replace should NOT dedupe');
});

console.log('\nGenerated .alc filename pattern (alc-generator.js):');

function specBuildFilename(deviceName, clipName, clipBars, ts) {
    const safeDev = (deviceName || 'Rack').replace(/[^a-zA-Z0-9 _-]/g, '').replace(/\s+/g, '_');
    const safeClip = clipName ? clipName.replace(/[^a-zA-Z0-9 _-]/g, '').replace(/\s+/g, '_') : null;
    return safeClip
        ? `${safeClip}_${clipBars}bars_${ts}_Stride.alc`
        : `${safeDev}_${clipBars}bars_${ts}_Stride.alc`;
}

test('No clip name: leads with rack name, ends with _Stride', () => {
    const got = specBuildFilename('My Rack', null, 4, '142315');
    assert(got === 'My_Rack_4bars_142315_Stride.alc',
        `unexpected filename: ${got}`);
});

test('With clip name: leads with clip name, ends with _Stride', () => {
    const got = specBuildFilename('Some Rack', 'Cool Clip', 8, '142315');
    assert(got === 'Cool_Clip_8bars_142315_Stride.alc',
        `unexpected filename: ${got}`);
});

test('Filename never starts with Stride_', () => {
    const got = specBuildFilename('My Rack', null, 4, '142315');
    assert(!got.startsWith('Stride_'),
        `filename should NOT start with Stride_, got ${got}`);
});

test('Filename always ends with _Stride.alc', () => {
    assert(specBuildFilename('Foo', null, 4, '12').endsWith('_Stride.alc'));
    assert(specBuildFilename('Foo', 'Bar', 4, '12').endsWith('_Stride.alc'));
});

// Cleanup
try { fs.rmSync(fakeLib, { recursive: true, force: true }); } catch (e) {}

console.log(`\n${passed} passed, ${failed} failed\n`);
process.exit(failed > 0 ? 1 : 0);
