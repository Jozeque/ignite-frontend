/**
 * Tests for the pure-logic filter + bar-fit + note expansion functions
 * exposed by pattern-loader.js.
 *
 * Synthetic fixtures — does not touch the real manifest.
 *
 * Run: node test/test-pattern-filter.js
 */

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

const FIXTURES = [
    { id: 'a', name: 'Acid 1',    category: 'bass',   style: ['acid','techno'],   key: 'F min', bpm: 120, bars: 4,  note_count: 16, tags: ['303','rolling'] },
    { id: 'b', name: 'Sub Pulse', category: 'bass',   style: ['techno','deep'],   key: 'A min', bpm: 130, bars: 4,  note_count: 16, tags: ['sub'] },
    { id: 'c', name: 'Lead 8',    category: 'leads',  style: ['psy'],             key: 'D phr', bpm: 140, bars: 8,  note_count: 32, tags: ['phrygian'] },
    { id: 'd', name: 'Chords',    category: 'chords', style: ['ambient'],         key: 'C maj', bpm: 90,  bars: 8,  note_count: 16, tags: ['warm'] },
    { id: 'e', name: 'Kick',      category: 'drums',  style: ['house','techno'],  key: 'C maj', bpm: 120, bars: 1,  note_count: 4,  tags: ['kick'] },
    { id: 'f', name: 'Long Loop', category: 'melodic',style: ['idm'],             key: 'G min', bpm: 100, bars: 16, note_count: 64, tags: ['glitch'] },
    { id: 'g', name: 'Two-Bar',   category: 'bass',   style: ['house'],           key: 'C maj', bpm: 124, bars: 2,  note_count: 8,  tags: [] },
];

console.log('\n── fitsBars (bar-fit math) ────────────────────\n');

test('exact match: 8 fits 8', () => assert(loader.fitsBars(8, 8)));
test('exact match: 4 fits 4', () => assert(loader.fitsBars(4, 4)));
test('shorter loops: 4 fits 8',  () => assert(loader.fitsBars(4, 8)));
test('shorter loops: 2 fits 8',  () => assert(loader.fitsBars(2, 8)));
test('shorter loops: 1 fits 8',  () => assert(loader.fitsBars(1, 8)));
test('shorter loops: 1 fits 4',  () => assert(loader.fitsBars(1, 4)));
test('shorter loops: 4 fits 16', () => assert(loader.fitsBars(4, 16)));
test('non-divisor rejected: 3 not in 8',  () => assert(!loader.fitsBars(3, 8)));
test('non-divisor rejected: 6 not in 8',  () => assert(!loader.fitsBars(6, 8)));
test('non-divisor rejected: 8 not in 12', () => assert(!loader.fitsBars(8, 12)));
test('longer never fits: 16 not in 8',    () => assert(!loader.fitsBars(16, 8)));
test('longer never fits: 8 not in 4',     () => assert(!loader.fitsBars(8, 4)));
test('zero/negative rejected', () => {
    assert(!loader.fitsBars(0, 8));
    assert(!loader.fitsBars(-1, 8));
    assert(!loader.fitsBars(8, 0));
});

console.log('\n── filterPatterns (composite filters) ─────────\n');

test('no filter returns all', () => {
    const r = loader.filterPatterns(FIXTURES, {});
    assertEq(r.length, FIXTURES.length);
});

test('bars=8 returns only patterns that fit 8 bars', () => {
    const r = loader.filterPatterns(FIXTURES, { bars: 8 });
    const ids = r.map(p => p.id).sort();
    // Fits 8: a(4), b(4), c(8), d(8), e(1), g(2). Not: f(16).
    assertEq(JSON.stringify(ids), JSON.stringify(['a','b','c','d','e','g']));
});

test('bars=4 returns patterns that fit 4', () => {
    const r = loader.filterPatterns(FIXTURES, { bars: 4 });
    const ids = r.map(p => p.id).sort();
    // Fits 4: a(4), b(4), e(1), g(2). Not c(8), d(8), f(16).
    assertEq(JSON.stringify(ids), JSON.stringify(['a','b','e','g']));
});

test('bars=1 returns only 1-bar patterns', () => {
    const r = loader.filterPatterns(FIXTURES, { bars: 1 });
    const ids = r.map(p => p.id);
    assertEq(JSON.stringify(ids), JSON.stringify(['e']));
});

test('bars="all" returns everything', () => {
    const r = loader.filterPatterns(FIXTURES, { bars: 'all' });
    assertEq(r.length, FIXTURES.length);
});

test('category=bass narrows to bass patterns', () => {
    const r = loader.filterPatterns(FIXTURES, { category: 'bass' });
    const ids = r.map(p => p.id).sort();
    assertEq(JSON.stringify(ids), JSON.stringify(['a','b','g']));
});

test('style=techno matches any-of', () => {
    const r = loader.filterPatterns(FIXTURES, { style: 'techno' });
    const ids = r.map(p => p.id).sort();
    // a, b, e all have techno
    assertEq(JSON.stringify(ids), JSON.stringify(['a','b','e']));
});

test('key match is case- and whitespace-insensitive', () => {
    const r1 = loader.filterPatterns(FIXTURES, { key: 'f min' });
    const r2 = loader.filterPatterns(FIXTURES, { key: 'F  min' });
    const r3 = loader.filterPatterns(FIXTURES, { key: 'F min' });
    assertEq(r1.length, 1);
    assertEq(r2.length, 1);
    assertEq(r3.length, 1);
});

test('bpmMin/bpmMax range filter', () => {
    const r = loader.filterPatterns(FIXTURES, { bpmMin: 120, bpmMax: 130 });
    const ids = r.map(p => p.id).sort();
    // bpm: a=120, b=130, e=120, g=124
    assertEq(JSON.stringify(ids), JSON.stringify(['a','b','e','g']));
});

test('search matches name', () => {
    const r = loader.filterPatterns(FIXTURES, { search: 'acid' });
    const ids = r.map(p => p.id);
    assertEq(JSON.stringify(ids), JSON.stringify(['a']));
});

test('search matches tags', () => {
    const r = loader.filterPatterns(FIXTURES, { search: '303' });
    const ids = r.map(p => p.id);
    assertEq(JSON.stringify(ids), JSON.stringify(['a']));
});

test('search matches styles', () => {
    const r = loader.filterPatterns(FIXTURES, { search: 'psy' });
    const ids = r.map(p => p.id);
    assertEq(JSON.stringify(ids), JSON.stringify(['c']));
});

test('search is case-insensitive', () => {
    const r = loader.filterPatterns(FIXTURES, { search: 'KICK' });
    const ids = r.map(p => p.id);
    assertEq(JSON.stringify(ids), JSON.stringify(['e']));
});

test('favorites filter restricts to starred ids', () => {
    const favs = new Set(['a', 'c']);
    const r = loader.filterPatterns(FIXTURES, { onlyFavorites: true, favoriteIds: favs });
    const ids = r.map(p => p.id).sort();
    assertEq(JSON.stringify(ids), JSON.stringify(['a','c']));
});

test('combined filters AND together', () => {
    const r = loader.filterPatterns(FIXTURES, {
        category: 'bass', bars: 8, style: 'techno'
    });
    const ids = r.map(p => p.id).sort();
    // bass + fits-8 + techno: a, b (techno+bass+fit), e is drums so out. g is house not techno.
    assertEq(JSON.stringify(ids), JSON.stringify(['a','b']));
});

console.log('\n── expandToCanvasLength (looping) ─────────────\n');

test('4-bar pattern → 8-bar canvas loops twice', () => {
    const notes = [
        { pitch: 36, time: 0, duration: 1, velocity: 100 },
        { pitch: 36, time: 4, duration: 1, velocity: 100 },
        // 4-bar pattern, last note at beat 12 (bar 4)
        { pitch: 36, time: 12, duration: 1, velocity: 100 },
    ];
    const expanded = loader.expandToCanvasLength(notes, 4, 8);
    assertEq(expanded.length, 6, 'expected 2 reps');
    assertEq(expanded[0].time, 0);
    assertEq(expanded[3].time, 16); // 0 + 4 bars*4 beats = 16
    assertEq(expanded[5].time, 28); // 12 + 16
});

test('1-bar pattern → 8-bar canvas loops 8 times', () => {
    const notes = [{ pitch: 36, time: 0, duration: 1, velocity: 100 }];
    const expanded = loader.expandToCanvasLength(notes, 1, 8);
    assertEq(expanded.length, 8);
    assertEq(expanded[0].time, 0);
    assertEq(expanded[7].time, 28); // 7 * 4 beats
});

test('exact match returns notes unchanged in count', () => {
    const notes = [
        { pitch: 60, time: 0, duration: 1, velocity: 100 },
        { pitch: 62, time: 2, duration: 1, velocity: 100 },
    ];
    const expanded = loader.expandToCanvasLength(notes, 8, 8);
    assertEq(expanded.length, 2);
    assertEq(expanded[0].time, 0);
    assertEq(expanded[1].time, 2);
});

test('non-divisor case (3-bar in 8) — partial floor, no overlap past canvas', () => {
    const notes = [{ pitch: 60, time: 0, duration: 1, velocity: 100 }];
    // floor(8/3) = 2 reps, last rep starts at beat 12 (within 32-beat canvas)
    const expanded = loader.expandToCanvasLength(notes, 3, 8);
    assertEq(expanded.length, 2);
    assertEq(expanded[1].time, 12);
});

test('longer pattern truncated to canvas length', () => {
    const notes = [
        { pitch: 60, time: 0, duration: 1, velocity: 100 },
        { pitch: 62, time: 30, duration: 1, velocity: 100 }, // beyond 8-bar (32 beats), within 16-bar
        { pitch: 64, time: 50, duration: 1, velocity: 100 }, // beyond 16-bar truncate
    ];
    const expanded = loader.expandToCanvasLength(notes, 16, 8);
    // 8-bar canvas = 32 beats. Notes at 0 and 30 fit. 50 dropped.
    assertEq(expanded.length, 2);
    assertEq(expanded[0].time, 0);
    assertEq(expanded[1].time, 30);
});

test('truncation clamps note duration to canvas end', () => {
    const notes = [{ pitch: 60, time: 30, duration: 10, velocity: 100 }];
    const expanded = loader.expandToCanvasLength(notes, 16, 8);
    // canvas end = 32 beats. Note starts at 30, duration clamped to 2.
    assertEq(expanded.length, 1);
    assertEq(expanded[0].duration, 2);
});

// ─── Root / Scale / Energy filters (new in this UI pass) ───────────

test('root filter matches the root part of p.key (case-insensitive)', () => {
    const patterns = [
        { id: '1', key: 'F min', style: [], category: 'bass', bars: 4 },
        { id: '2', key: 'A min', style: [], category: 'bass', bars: 4 },
        { id: '3', key: 'C maj', style: [], category: 'bass', bars: 4 },
    ];
    const res = loader.filterPatterns(patterns, { root: 'F' });
    assertEq(res.length, 1); assertEq(res[0].id, '1');
    const res2 = loader.filterPatterns(patterns, { root: 'a' });
    assertEq(res2.length, 1); assertEq(res2[0].id, '2');
});

test('scale filter matches the scale part of p.key', () => {
    const patterns = [
        { id: '1', key: 'F min', style: [], category: 'bass', bars: 4 },
        { id: '2', key: 'A min', style: [], category: 'bass', bars: 4 },
        { id: '3', key: 'C maj', style: [], category: 'bass', bars: 4 },
        { id: '4', key: 'D phr', style: [], category: 'bass', bars: 4 },
    ];
    assertEq(loader.filterPatterns(patterns, { scale: 'min' }).length, 2);
    assertEq(loader.filterPatterns(patterns, { scale: 'maj' }).length, 1);
    assertEq(loader.filterPatterns(patterns, { scale: 'phr' }).length, 1);
});

test('root + scale combined narrows to exactly one match', () => {
    const patterns = [
        { id: '1', key: 'F min', style: [], category: 'bass', bars: 4 },
        { id: '2', key: 'A min', style: [], category: 'bass', bars: 4 },
        { id: '3', key: 'F maj', style: [], category: 'bass', bars: 4 },
    ];
    const res = loader.filterPatterns(patterns, { root: 'F', scale: 'min' });
    assertEq(res.length, 1); assertEq(res[0].id, '1');
});

test('energy filter (numeric exact)', () => {
    const patterns = [
        { id: '1', key: 'C maj', energy: 2, style: [], category: 'bass', bars: 4 },
        { id: '2', key: 'C maj', energy: 3, style: [], category: 'bass', bars: 4 },
        { id: '3', key: 'C maj', energy: 4, style: [], category: 'bass', bars: 4 },
    ];
    assertEq(loader.filterPatterns(patterns, { energy: 2 }).length, 1);
    assertEq(loader.filterPatterns(patterns, { energy: 4 }).length, 1);
    // Empty / undefined energy → no filter applied
    assertEq(loader.filterPatterns(patterns, { energy: '' }).length, 3);
    assertEq(loader.filterPatterns(patterns, {}).length, 3);
});

test('legacy key filter still works (backward compat)', () => {
    const patterns = [
        { id: '1', key: 'F min', style: [], category: 'bass', bars: 4 },
        { id: '2', key: 'A min', style: [], category: 'bass', bars: 4 },
    ];
    const res = loader.filterPatterns(patterns, { key: 'F min' });
    assertEq(res.length, 1); assertEq(res[0].id, '1');
});

console.log(`\nResults: ${passed} passed, ${failed} failed\n`);
if (failed > 0) process.exit(1);
