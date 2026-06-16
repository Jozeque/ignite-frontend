/**
 * Two-phase library curation:
 *
 *   PHASE A: Re-categorize the 275 "melodic" imports by analyzing each
 *            .mid's note content. Drums/bass/leads/chords/melodic/
 *            ambient/sequences picked by heuristics on pitch range,
 *            polyphony, note duration, and density. Files physically
 *            move into the new category folder; manifest IDs renumbered.
 *
 *   PHASE B: Generate musical variations of existing patterns until the
 *            library has 500 total. Each variation is a transposition,
 *            time-reverse, octave layer, half-/double-time, or velocity
 *            humanize of an existing pattern — same vibe, more material.
 *
 * Idempotent within a single run: each invocation rebuilds the manifest
 * from disk + the placeholder header, so it's safe to re-run while
 * tweaking the heuristics. The 5 v1.2 placeholders are preserved unchanged.
 *
 * Run: node test/_organize_and_generate.js
 */

const fs = require('fs');
const path = require('path');
const midi = require('../app/renderer/midi-parser.js');
const loader = require('../app/renderer/pattern-loader.js');

const PATTERNS_ROOT = path.join(__dirname, '..', 'app', 'assets', 'patterns');
const MANIFEST_PATH = path.join(PATTERNS_ROOT, 'manifest.json');
const TARGET_TOTAL = 500;

const CATEGORIES = ['bass', 'leads', 'chords', 'melodic', 'drums', 'ambient', 'sequences'];

// ─── MIDI encoder (mirrors _gen_placeholder_patterns.js) ────────

const T = 480; // ticks per beat

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

function buildMidi(notes, bpm) {
    const events = [];
    for (const n of notes) {
        const t = Math.max(0, Math.round(n.time * T));
        const d = Math.max(1, Math.round(n.duration * T));
        events.push({ tick: t, status: 0x90, d1: clampInt(n.pitch, 0, 127), d2: clampInt(n.velocity, 1, 127) });
        events.push({ tick: t + d, status: 0x80, d1: clampInt(n.pitch, 0, 127), d2: 64 });
    }
    events.sort((a, b) => a.tick - b.tick || a.status - b.status);

    const parts = [];
    const us = Math.round(60000000 / (bpm || 120));
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
    header.writeUInt16BE(T, 12);

    const trackHdr = Buffer.alloc(8);
    trackHdr.write('MTrk', 0);
    trackHdr.writeUInt32BE(body.length, 4);

    return Buffer.concat([header, trackHdr, body]);
}

function clampInt(v, lo, hi) {
    return Math.max(lo, Math.min(hi, Math.round(v)));
}

// ─── Categorization heuristics ──────────────────────────────────

function categorize(parsed, bars) {
    const notes = parsed.notes;
    if (!notes || notes.length === 0) return 'melodic';

    const pitches = notes.map(n => n.pitch);
    const minP = Math.min(...pitches);
    const maxP = Math.max(...pitches);
    const meanP = pitches.reduce((s, p) => s + p, 0) / pitches.length;

    // Density: notes per beat
    const totalBeats = Math.max(1, bars * 4);
    const density = notes.length / totalBeats;

    // Mean duration in beats
    const meanDur = notes.reduce((s, n) => s + n.duration, 0) / notes.length;

    // Max simultaneous polyphony
    const events = [];
    for (const n of notes) {
        events.push({ t: n.time, kind: 'on' });
        events.push({ t: n.time + n.duration, kind: 'off' });
    }
    events.sort((a, b) => a.t - b.t || (a.kind === 'on' ? -1 : 1));
    let cur = 0, maxPoly = 0;
    for (const e of events) {
        if (e.kind === 'on') { cur++; if (cur > maxPoly) maxPoly = cur; }
        else cur--;
    }

    // Drums: very low pitch range, multiple hits, almost always staccato
    if (maxP <= 60 && meanDur < 0.3 && density >= 0.8) return 'drums';
    // Pure drum-like even if longer: pitches clustered at GM drum range
    if (minP >= 35 && maxP <= 51 && pitches.every(p => p <= 60)) return 'drums';

    // Chords: high polyphony + sustained
    if (maxPoly >= 3 && meanDur >= 1.0) return 'chords';
    if (maxPoly >= 4) return 'chords';

    // Ambient: very sustained, low density
    if (meanDur >= 4.0 && density < 1.0) return 'ambient';
    if (meanDur >= 8.0) return 'ambient';

    // Sequences: very rhythmic / repetitive (high density staccato monophonic)
    if (density >= 4.0 && meanDur < 0.5 && maxPoly <= 2) return 'sequences';

    // Bass: monophonic-ish, low pitches
    if (maxPoly <= 2 && meanP <= 50) return 'bass';
    if (maxPoly <= 2 && maxP <= 56) return 'bass';

    // Leads: monophonic-ish, high pitches
    if (maxPoly <= 2 && meanP >= 64) return 'leads';
    if (maxPoly <= 2 && minP >= 60) return 'leads';

    // Default: general melodic
    return 'melodic';
}

function computeBars(maxBeat) {
    if (!Number.isFinite(maxBeat) || maxBeat <= 0) return 1;
    const raw = Math.max(1, Math.ceil(maxBeat / 4));
    const valid = [1, 2, 4, 8, 16, 32];
    for (const b of valid) if (raw <= b) return b;
    return 32;
}

// ─── Variation generators ───────────────────────────────────────

function transpose(notes, semitones) {
    return notes
        .map(n => ({ ...n, pitch: n.pitch + semitones }))
        .filter(n => n.pitch >= 0 && n.pitch <= 127);
}

function reverseTime(notes, totalBeats) {
    return notes.map(n => ({
        ...n,
        time: Math.max(0, totalBeats - (n.time + n.duration)),
    }));
}

function halfTime(notes) {
    return notes.map(n => ({ ...n, time: n.time * 2, duration: n.duration * 2 }));
}

function doubleTime(notes) {
    return notes.map(n => ({ ...n, time: n.time / 2, duration: Math.max(0.01, n.duration / 2) }));
}

function octaveLayer(notes, semitones) {
    const layer = notes
        .map(n => ({ ...n, pitch: n.pitch + semitones, velocity: Math.round(n.velocity * 0.7) }))
        .filter(n => n.pitch >= 0 && n.pitch <= 127);
    return [...notes, ...layer];
}

function humanize(notes, rng) {
    return notes.map(n => ({
        ...n,
        time: Math.max(0, n.time + (rng() - 0.5) * 0.06),
        velocity: clampInt(n.velocity + Math.round((rng() - 0.5) * 24), 1, 127),
    }));
}

const VARIATIONS = [
    { suffix: 'oct-up',   fn: (n) => transpose(n, 12),        name: 'Oct Up',     keyDelta: 0 },
    { suffix: 'oct-dn',   fn: (n) => transpose(n, -12),       name: 'Oct Down',   keyDelta: 0 },
    { suffix: 'fifth-up', fn: (n) => transpose(n, 7),         name: 'Fifth Up',   keyDelta: 7 },
    { suffix: 'fifth-dn', fn: (n) => transpose(n, -7),        name: 'Fifth Down', keyDelta: -7 },
    { suffix: 'fourth-up',fn: (n) => transpose(n, 5),         name: 'Fourth Up',  keyDelta: 5 },
    { suffix: 'reverse',  fn: (n, b) => reverseTime(n, b * 4), name: 'Reverse',   keyDelta: 0 },
    { suffix: 'halftime', fn: (n) => halfTime(n),             name: 'Half-time',  keyDelta: 0, barMul: 2 },
    { suffix: 'doubled',  fn: (n) => doubleTime(n),           name: 'Doubled',    keyDelta: 0, barMul: 0.5 },
    { suffix: 'octstack', fn: (n) => octaveLayer(n, 12),      name: 'Oct Stack',  keyDelta: 0 },
    { suffix: 'subwide',  fn: (n) => octaveLayer(n, -12),     name: 'Sub Wide',   keyDelta: 0 },
];

// Deterministic seeded RNG so reruns produce identical output
function makeRng(seed) {
    let a = (seed >>> 0) || 1;
    return function () {
        a = (a + 0x6D2B79F5) >>> 0;
        let t = a;
        t = Math.imul(t ^ (t >>> 15), t | 1);
        t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
        return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
}

function hashStr(s) {
    let h = 2166136261;
    for (let i = 0; i < s.length; i++) {
        h ^= s.charCodeAt(i);
        h = Math.imul(h, 16777619);
    }
    return h >>> 0;
}

// ─── Key shifting helper (preserves quality) ────────────────────

const NOTE_NAMES = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];
function shiftKey(key, semitones) {
    if (!key) return key;
    const m = key.match(/^([A-G][#b]?)\s*(\S*)$/);
    if (!m) return key;
    let root = m[1].replace('b', '#');
    let quality = m[2] || 'maj';
    let idx = NOTE_NAMES.indexOf(root);
    if (idx < 0) return key;
    idx = (idx + semitones + 120) % 12;
    return NOTE_NAMES[idx] + ' ' + quality;
}

// ─── Phase A: re-categorize ─────────────────────────────────────

const manifest = JSON.parse(fs.readFileSync(MANIFEST_PATH, 'utf8'));

// Separate the placeholders from imports by their added_in tag — robust
// to re-runs after Phase A has already renumbered the IDs.
const placeholders = manifest.patterns.filter(p => p.added_in === 'v1.2.0');
const imports = manifest.patterns.filter(p => p.added_in === 'v1.2.0-import');
const existingVariations = manifest.patterns.filter(p => p.added_in === 'v1.2.0-gen');

console.log(`Existing: ${placeholders.length} placeholder + ${imports.length} import + ${existingVariations.length} prior variation = ${manifest.patterns.length} total\n`);
console.log('Phase A: re-categorizing imports …');

// Per-category seq counter for renumbering
const seqByCat = {};
for (const c of CATEGORIES) seqByCat[c] = 1;

// Pre-bump for placeholder ids that already use a category (e.g. drums_four_floor_1_001)
for (const p of placeholders) {
    const m = p.id.match(/^([a-z]+)_/);
    if (m && seqByCat[m[1]] !== undefined) seqByCat[m[1]] = Math.max(seqByCat[m[1]], 2);
}

const recategorized = [];
const catCounts = {};
for (const c of CATEGORIES) catCounts[c] = 0;

for (const p of imports) {
    const oldFull = path.join(PATTERNS_ROOT, p.file);
    if (!fs.existsSync(oldFull)) {
        console.warn(`  ✗ missing: ${p.file}`);
        continue;
    }

    let parsed;
    try { parsed = midi.parse(fs.readFileSync(oldFull)); }
    catch (e) { console.warn(`  ✗ parse fail: ${p.file}`); continue; }

    const newCat = categorize(parsed, p.bars || 4);
    catCounts[newCat]++;

    // Move file to new category folder if changed
    const filename = path.basename(p.file);
    const newRel = newCat + '/' + filename;
    const newFull = path.join(PATTERNS_ROOT, newCat, filename);
    if (newRel !== p.file) {
        if (!fs.existsSync(path.dirname(newFull))) fs.mkdirSync(path.dirname(newFull), { recursive: true });
        // If a same-named file already exists in target, suffix it
        let finalFull = newFull;
        let finalRel = newRel;
        let n = 1;
        while (fs.existsSync(finalFull) && finalFull !== oldFull) {
            const base = filename.replace(/\.mid$/i, '');
            const dedup = `${base}-${n}.mid`;
            finalFull = path.join(PATTERNS_ROOT, newCat, dedup);
            finalRel = newCat + '/' + dedup;
            n++;
        }
        if (finalFull !== oldFull) {
            fs.renameSync(oldFull, finalFull);
        }
        p.file = finalRel;
    }

    // Renumber ID
    const seq = seqByCat[newCat]++;
    p.id = `${newCat}_imp_${String(seq).padStart(3, '0')}`;
    p.category = newCat;
    recategorized.push(p);
}

console.log('  Category distribution after Phase A:');
for (const c of CATEGORIES) console.log(`    ${c.padEnd(11)} ${catCounts[c]}`);

// ─── Phase B: generate variations ───────────────────────────────

console.log(`\nPhase B: generating variations to reach ${TARGET_TOTAL} total …`);

const allCurrent = [...placeholders, ...recategorized, ...existingVariations];
const need = TARGET_TOTAL - allCurrent.length;
console.log(`  Need to generate: ${need}`);

const variations = []; // hoisted so the flush() below can see it

if (need <= 0) {
    console.log('  Already at or above target — no generation needed.');
} else {
    // For seedable iteration order, sort sources by id
    const sources = [...recategorized].sort((a, b) => a.id.localeCompare(b.id));
    // Filter out tiny patterns (note count < 4) — variations would be musically weak
    const viableSources = sources.filter(p => p.note_count >= 4);
    console.log(`  Viable variation sources: ${viableSources.length}`);

    let generated = 0;
    let sourceIdx = 0;
    let variationIdx = 0;
    let attempts = 0;
    const maxAttempts = need * 4;

    while (generated < need && attempts < maxAttempts) {
        attempts++;
        const src = viableSources[sourceIdx % viableSources.length];
        const variant = VARIATIONS[variationIdx % VARIATIONS.length];
        sourceIdx++;
        if (sourceIdx % viableSources.length === 0) variationIdx++;

        // Load source notes
        const srcFull = path.join(PATTERNS_ROOT, src.file);
        let srcParsed;
        try { srcParsed = midi.parse(fs.readFileSync(srcFull)); }
        catch (e) { continue; }

        // Apply variation
        let newNotes;
        try { newNotes = variant.fn(srcParsed.notes, src.bars); }
        catch (e) { continue; }
        if (!newNotes || newNotes.length === 0) continue;

        // Compute new bars (some variations stretch/compress)
        let newBars = src.bars;
        if (variant.barMul) {
            newBars = Math.max(1, Math.min(32, Math.round(src.bars * variant.barMul)));
            // Round to nearest power of 2 in valid set
            const valid = [1, 2, 4, 8, 16, 32];
            newBars = valid.reduce((best, b) => Math.abs(b - newBars) < Math.abs(best - newBars) ? b : best, 8);
        }

        // Build .mid bytes
        const bytes = buildMidi(newNotes, src.bpm);

        // Filename + ID — variation stays in same category as source
        const cat = src.category;
        const srcBase = path.basename(src.file).replace(/\.mid$/i, '');
        let outFile = `${srcBase}_${variant.suffix}.mid`;
        let outFull = path.join(PATTERNS_ROOT, cat, outFile);
        let dedup = 1;
        while (fs.existsSync(outFull)) {
            outFile = `${srcBase}_${variant.suffix}-${dedup}.mid`;
            outFull = path.join(PATTERNS_ROOT, cat, outFile);
            dedup++;
        }

        fs.writeFileSync(outFull, bytes);

        const newId = `${cat}_var_${String(seqByCat[cat]++).padStart(3, '0')}`;
        const newKey = variant.keyDelta ? shiftKey(src.key, variant.keyDelta) : src.key;
        const entry = {
            id: newId,
            name: `${src.name} · ${variant.name}`.slice(0, 60),
            file: cat + '/' + outFile,
            category: cat,
            style: src.style || [],
            key: newKey || 'C maj',
            bpm: src.bpm,
            bars: newBars,
            note_count: newNotes.length,
            energy: src.energy || 2,
            complexity: src.complexity || 2,
            tags: Array.from(new Set([...(src.tags || []), variant.suffix.replace(/[-_]/g, ' ')])).slice(0, 8),
            added_in: 'v1.2.0-gen',
        };
        variations.push(entry);
        generated++;
        catCounts[cat] = (catCounts[cat] || 0) + 1;
    }

    console.log(`  Generated: ${generated} variations`);
}

// ─── Save manifest ──────────────────────────────────────────────

const finalPatterns = [...placeholders, ...recategorized, ...existingVariations, ...variations];

const out = {
    version: 1,
    generated_at: new Date().toISOString().slice(0, 10),
    patterns: finalPatterns,
};

const v = loader.validateManifest(out);
if (!v.ok) {
    console.error('\n✗ Manifest validation failed:');
    for (const e of v.errors) console.error('  - ' + e);
    process.exit(1);
}

fs.writeFileSync(MANIFEST_PATH, JSON.stringify(out, null, 2));

console.log(`\n──────────────────────────────────────────────`);
console.log(`Total patterns: ${out.patterns.length}`);
console.log(`Distribution:`);
const finalDist = {};
for (const p of out.patterns) finalDist[p.category] = (finalDist[p.category] || 0) + 1;
for (const c of CATEGORIES) console.log(`  ${c.padEnd(11)} ${finalDist[c] || 0}`);
console.log(`──────────────────────────────────────────────`);
