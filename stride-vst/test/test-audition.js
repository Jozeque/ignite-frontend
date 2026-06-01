/**
 * Tests for audition.js — covers the pure-math helpers (midiToHz,
 * beatsToSeconds, buildSchedule, loopSeconds). Web Audio output isn't
 * testable in node; integration with the renderer is verified manually.
 *
 * Run: node test/test-audition.js
 */

const audition = require('../app/renderer/audition.js');

let passed = 0;
let failed = 0;

function test(name, fn) {
    try { fn(); console.log(`  ✓ ${name}`); passed++; }
    catch (e) { console.log(`  ✗ ${name}: ${e.message}`); failed++; }
}
function assert(cond, msg) { if (!cond) throw new Error(msg); }
function assertClose(a, b, tol, msg) {
    if (Math.abs(a - b) > (tol || 0.001)) throw new Error((msg || 'not close') + ` — got ${a}, expected ≈ ${b}`);
}

console.log('\n── Audition math ───────────────────────────────\n');

test('midiToHz: A4 (69) = 440', () => {
    assertClose(audition.midiToHz(69), 440, 0.01);
});
test('midiToHz: C4 (60) ≈ 261.63', () => {
    assertClose(audition.midiToHz(60), 261.63, 0.05);
});
test('midiToHz: A5 (81) = 880 (one octave up)', () => {
    assertClose(audition.midiToHz(81), 880, 0.01);
});
test('midiToHz: A3 (57) = 220 (one octave down)', () => {
    assertClose(audition.midiToHz(57), 220, 0.01);
});

test('beatsToSeconds: 4 beats at 120 BPM = 2 seconds', () => {
    assertClose(audition.beatsToSeconds(4, 120), 2.0);
});
test('beatsToSeconds: 1 beat at 60 BPM = 1 second', () => {
    assertClose(audition.beatsToSeconds(1, 60), 1.0);
});
test('beatsToSeconds: 8 beats at 90 BPM ≈ 5.33s', () => {
    assertClose(audition.beatsToSeconds(8, 90), 5.333, 0.01);
});

test('buildSchedule: empty notes → empty schedule', () => {
    assert(audition.buildSchedule([], 120).length === 0);
    assert(audition.buildSchedule(null, 120).length === 0);
});

test('buildSchedule: maps pitch → freq and time → seconds', () => {
    const notes = [
        { pitch: 69, time: 0, duration: 1, velocity: 127 },
        { pitch: 60, time: 2, duration: 0.5, velocity: 64 },
    ];
    const s = audition.buildSchedule(notes, 120);
    assert(s.length === 2);
    assertClose(s[0].freq, 440, 0.01);
    assertClose(s[0].start, 0);
    assertClose(s[0].end, 0.5); // 1 beat = 0.5s at 120 BPM
    assertClose(s[0].gain, 1.0);
    assertClose(s[1].freq, 261.63, 0.05);
    assertClose(s[1].start, 1.0);
    assertClose(s[1].end, 1.25);
    assertClose(s[1].gain, 64 / 127, 0.01);
});

test('buildSchedule: zero-duration clamped to 1ms', () => {
    const s = audition.buildSchedule(
        [{ pitch: 60, time: 0, duration: 0, velocity: 100 }],
        120
    );
    assert(s[0].end - s[0].start >= 0.0001);
});

test('buildSchedule: velocity out-of-range clamped to [0,1]', () => {
    const s = audition.buildSchedule(
        [{ pitch: 60, time: 0, duration: 1, velocity: 999 }],
        120
    );
    assertClose(s[0].gain, 1.0);
    const s2 = audition.buildSchedule(
        [{ pitch: 60, time: 0, duration: 1, velocity: -10 }],
        120
    );
    assertClose(s2[0].gain, 0);
});

test('buildSchedule: empty / invalid BPM → empty schedule', () => {
    assert(audition.buildSchedule([{pitch:60,time:0,duration:1,velocity:100}], 0).length === 0);
    assert(audition.buildSchedule([{pitch:60,time:0,duration:1,velocity:100}], -1).length === 0);
    assert(audition.buildSchedule([{pitch:60,time:0,duration:1,velocity:100}], NaN).length === 0);
});

test('loopSeconds: uses clipBeats when supplied', () => {
    const schedule = audition.buildSchedule(
        [{ pitch: 60, time: 0, duration: 1, velocity: 100 }],
        120
    );
    assertClose(audition.loopSeconds(schedule, 16, 120), 8.0);
});

test('loopSeconds: falls back to last note end when no clipBeats', () => {
    const schedule = audition.buildSchedule(
        [{ pitch: 60, time: 0, duration: 1, velocity: 100 }],
        120
    );
    assertClose(audition.loopSeconds(schedule, null, 120), 0.5);
});

test('loopSeconds: clipBeats wins if larger than last note end', () => {
    const schedule = audition.buildSchedule(
        [{ pitch: 60, time: 0, duration: 1, velocity: 100 }],
        120
    );
    // 32 beats = 16s at 120 BPM, dominates the 0.5s schedule
    assertClose(audition.loopSeconds(schedule, 32, 120), 16.0);
});

test('loopSeconds: schedule wins if patterns notes extend past clip', () => {
    const schedule = audition.buildSchedule(
        [{ pitch: 60, time: 0, duration: 10, velocity: 100 }],
        120
    );
    // Note ends at beat 10 = 5s, clip says 4 beats = 2s — schedule wins
    assertClose(audition.loopSeconds(schedule, 4, 120), 5.0);
});

console.log(`\nResults: ${passed} passed, ${failed} failed\n`);
if (failed > 0) process.exit(1);
