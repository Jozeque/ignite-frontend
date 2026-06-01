/**
 * Tests for midi-parser.js — parses the placeholder .mid files and asserts
 * the note list matches what the generator wrote.
 *
 * Run: node test/test-midi-parser.js
 */

const fs = require('fs');
const path = require('path');
const midi = require('../app/renderer/midi-parser.js');

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
function assertClose(a, b, tol, msg) {
    if (Math.abs(a - b) > (tol || 0.001)) throw new Error((msg || 'not close') + ` — got ${a}, expected ≈ ${b}`);
}

const PATTERNS = path.join(__dirname, '..', 'app', 'assets', 'patterns');

console.log('\n── MIDI parser ─────────────────────────────────\n');

test('parse four_on_floor_01 — 4 kicks at C2 on beats 0,1,2,3', () => {
    const buf = fs.readFileSync(path.join(PATTERNS, 'drums/four_on_floor_01.mid'));
    const r = midi.parse(buf);
    assertEq(r.notes.length, 4, 'note count');
    assertClose(r.bpm, 120, 0.5, 'bpm');
    for (let i = 0; i < 4; i++) {
        assertEq(r.notes[i].pitch, 36, `note ${i} pitch`);
        assertClose(r.notes[i].time, i, 0.01, `note ${i} time`);
        assertEq(r.notes[i].velocity, 120, `note ${i} velocity`);
    }
});

test('parse sub_pulse_01 — 16 notes at A1 (pitch 33)', () => {
    const buf = fs.readFileSync(path.join(PATTERNS, 'bass/sub_pulse_01.mid'));
    const r = midi.parse(buf);
    assertEq(r.notes.length, 16, 'note count');
    assertClose(r.bpm, 130, 0.5, 'bpm');
    for (const n of r.notes) {
        assertEq(n.pitch, 33);
        assertEq(n.velocity, 110);
    }
});

test('parse acid_walking_01 — 16 notes, varied pitches', () => {
    const buf = fs.readFileSync(path.join(PATTERNS, 'bass/acid_walking_01.mid'));
    const r = midi.parse(buf);
    assertEq(r.notes.length, 16);
    assertClose(r.bpm, 120, 0.5);
    // First note in the F minor walking pattern should be F2 (pitch 41)
    assertEq(r.notes[0].pitch, 41);
});

test('parse dreamy_chords_01 — 16 notes (4 chords × 4 voices)', () => {
    const buf = fs.readFileSync(path.join(PATTERNS, 'chords/dreamy_chords_01.mid'));
    const r = midi.parse(buf);
    assertEq(r.notes.length, 16);
    assertClose(r.bpm, 90, 0.5);
    // First Cmaj7 chord: 60, 64, 67, 71 all starting at time 0
    const tZero = r.notes.filter(n => Math.abs(n.time) < 0.01);
    assertEq(tZero.length, 4, 'expected 4 simultaneous notes at t=0');
    const pitches = tZero.map(n => n.pitch).sort((a,b)=>a-b);
    assertEq(JSON.stringify(pitches), JSON.stringify([60, 64, 67, 71]));
});

test('parse psy_lead_01 — note count matches generator', () => {
    const buf = fs.readFileSync(path.join(PATTERNS, 'leads/psy_lead_01.mid'));
    const r = midi.parse(buf);
    assert(r.notes.length > 0, 'no notes parsed');
    assertClose(r.bpm, 140, 0.5);
    // All notes in D phrygian range; should be in range [60, 90]
    for (const n of r.notes) {
        assert(n.pitch >= 60 && n.pitch <= 90, `out-of-range pitch ${n.pitch}`);
    }
});

test('time and duration in beats, not ticks', () => {
    const buf = fs.readFileSync(path.join(PATTERNS, 'drums/four_on_floor_01.mid'));
    const r = midi.parse(buf);
    // ppq=480 means tick 480 = beat 1. So 4 kicks span beats 0..3.
    assert(r.notes[3].time < 4, 'last kick should be at beat 3, not 1440');
});

test('throws on bad header', () => {
    let threw = false;
    try {
        midi.parse(Buffer.from([0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13]));
    } catch (e) { threw = true; }
    assert(threw, 'expected throw on bad header');
});

test('throws on truncated buffer', () => {
    let threw = false;
    try { midi.parse(Buffer.from([0, 1, 2])); }
    catch (e) { threw = true; }
    assert(threw, 'expected throw on truncated buffer');
});

test('handles ArrayBuffer input (browser path)', () => {
    const buf = fs.readFileSync(path.join(PATTERNS, 'drums/four_on_floor_01.mid'));
    const ab = buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength);
    const r = midi.parse(ab);
    assertEq(r.notes.length, 4);
});

console.log(`\nResults: ${passed} passed, ${failed} failed\n`);
if (failed > 0) process.exit(1);
