/**
 * Generates the v1.2 placeholder pattern set under app/assets/patterns/.
 *
 * These exist so the Library UI has real .mid files to grid-render, audition,
 * and inject during phases 2-5. They get replaced as Joe curates real patterns.
 *
 * Underscore-prefixed so the test runner skips it — this is a build utility,
 * not a test. Run: node test/_gen_placeholder_patterns.js
 */

const fs = require('fs');
const path = require('path');

// ─── Minimal Standard MIDI File encoder ─────────────────────────
// Format 0 (single track), 480 PPQ. Enough for bass/lead/chord/drum patterns.

function vlq(n) {
    if (n < 0) throw new Error('VLQ cannot be negative');
    const bytes = [n & 0x7f];
    n >>= 7;
    while (n > 0) {
        bytes.unshift((n & 0x7f) | 0x80);
        n >>= 7;
    }
    return Buffer.from(bytes);
}

function buildMidi(notes, opts) {
    const tpq = opts.tpq || 480;
    const bpm = opts.bpm || 120;
    const events = [];
    for (const n of notes) {
        events.push({ tick: n.t, status: 0x90, d1: n.p, d2: Math.max(1, Math.min(127, n.v)) });
        events.push({ tick: n.t + n.d, status: 0x80, d1: n.p, d2: 64 });
    }
    events.sort((a, b) => a.tick - b.tick || a.status - b.status);

    const parts = [];
    const us = Math.round(60000000 / bpm);
    parts.push(vlq(0));
    parts.push(Buffer.from([0xff, 0x51, 0x03, (us >> 16) & 0xff, (us >> 8) & 0xff, us & 0xff]));

    let prev = 0;
    for (const e of events) {
        parts.push(vlq(e.tick - prev));
        parts.push(Buffer.from([e.status, e.d1, e.d2]));
        prev = e.tick;
    }
    parts.push(vlq(0));
    parts.push(Buffer.from([0xff, 0x2f, 0x00]));

    const body = Buffer.concat(parts);
    const header = Buffer.alloc(14);
    header.write('MThd', 0);
    header.writeUInt32BE(6, 4);
    header.writeUInt16BE(0, 8);
    header.writeUInt16BE(1, 10);
    header.writeUInt16BE(tpq, 12);

    const trackHdr = Buffer.alloc(8);
    trackHdr.write('MTrk', 0);
    trackHdr.writeUInt32BE(body.length, 4);

    return Buffer.concat([header, trackHdr, body]);
}

// ─── Pattern definitions ─────────────────────────────────────────
// t = start tick, d = duration ticks, p = MIDI pitch, v = velocity
// 1 beat = 480 ticks, 1 bar = 1920 ticks

const T = 480; // ticks per beat (quarter note)
const BAR = T * 4;

// Bass: F minor walking (F2, C3, Eb3, F3 patterns), 4 bars
function acidWalkingBass() {
    const pitches = [41, 48, 51, 53,  51, 48, 41, 48,  53, 51, 48, 41,  48, 51, 53, 51];
    const notes = pitches.map((p, i) => ({ t: i * (T / 2), d: T / 2 - 20, p, v: 100 + (i % 3) * 8 }));
    return buildMidi(notes, { bpm: 120 });
}

// Bass: A1 sub pulse on each beat, 4 bars
function subPulse() {
    const notes = [];
    for (let i = 0; i < 16; i++) {
        notes.push({ t: i * T, d: T - 30, p: 33, v: 110 });
    }
    return buildMidi(notes, { bpm: 130 });
}

// Lead: D phrygian, 8 bars, varied rhythm
function psyLead() {
    // D phrygian scale: D Eb F G A Bb C  =  62 63 65 67 69 70 72
    const scale = [62, 63, 65, 67, 69, 70, 72, 74];
    const notes = [];
    let tick = 0;
    const totalTicks = BAR * 8;
    const rhythm = [T / 2, T / 4, T / 4, T / 2, T, T / 2, T / 4, T / 4];
    let idx = 0;
    while (tick < totalTicks) {
        const dur = rhythm[idx % rhythm.length];
        const pitch = scale[(idx * 3 + Math.floor(idx / 4)) % scale.length];
        notes.push({ t: tick, d: dur - 20, p: pitch, v: 95 + (idx % 4) * 6 });
        tick += dur;
        idx++;
    }
    return buildMidi(notes, { bpm: 140 });
}

// Chords: C major progression, 8 bars (2 bars per chord)
function dreamyChords() {
    const chords = [
        [60, 64, 67, 71], // Cmaj7
        [57, 60, 64, 67], // Am7
        [53, 57, 60, 64], // Fmaj7
        [55, 59, 62, 65], // G7
    ];
    const notes = [];
    chords.forEach((chord, ci) => {
        const tick = ci * BAR * 2;
        for (const p of chord) {
            notes.push({ t: tick, d: BAR * 2 - 60, p, v: 80 });
        }
    });
    return buildMidi(notes, { bpm: 90 });
}

// Drums: 4-on-floor, 1 bar
function fourOnFloor() {
    const notes = [];
    for (let i = 0; i < 4; i++) {
        notes.push({ t: i * T, d: 80, p: 36, v: 120 }); // C2 kick
    }
    return buildMidi(notes, { bpm: 120 });
}

// ─── Write to disk ───────────────────────────────────────────────

const BASE = path.join(__dirname, '..', 'app', 'assets', 'patterns');

const SET = [
    { sub: 'bass',   file: 'acid_walking_01.mid',   data: acidWalkingBass() },
    { sub: 'bass',   file: 'sub_pulse_01.mid',      data: subPulse() },
    { sub: 'leads',  file: 'psy_lead_01.mid',       data: psyLead() },
    { sub: 'chords', file: 'dreamy_chords_01.mid',  data: dreamyChords() },
    { sub: 'drums',  file: 'four_on_floor_01.mid',  data: fourOnFloor() },
];

for (const p of SET) {
    const dir = path.join(BASE, p.sub);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    const full = path.join(dir, p.file);
    fs.writeFileSync(full, p.data);
    console.log(`✓ ${p.sub}/${p.file}  (${p.data.length} bytes)`);
}

// Create empty category subfolders for taxonomy completeness
const ALL_CATS = ['bass', 'leads', 'chords', 'melodic', 'drums', 'ambient', 'sequences'];
for (const cat of ALL_CATS) {
    const dir = path.join(BASE, cat);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    const gitkeep = path.join(dir, '.gitkeep');
    if (!fs.existsSync(gitkeep)) fs.writeFileSync(gitkeep, '');
}

console.log('\nDone. Patterns written to:', BASE);
