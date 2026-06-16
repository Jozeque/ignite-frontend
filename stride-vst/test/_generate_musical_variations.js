/**
 * Musical variation generator — produces new patterns that share the
 * DNA of a source (scale, range, rhythm, density) but have fresh
 * pitch/voicing content. NOT mechanical transposition.
 *
 * Per-category strategy:
 *
 *   chords     → "Voicing Swap": same rhythm + same chord-event positions,
 *                fresh voicings from the source's pitch-class set
 *
 *   bass /     → "Markov Reharm": same rhythm template, new monophonic
 *   leads /     melody. Pitches drawn from a bigram walk over the
 *   melodic     source's actual note transitions, snapped to source scale
 *
 *   drums      → "Groove Shuffle": same percussion pitches (= instruments),
 *                slight time micro-shifts + 10-20% probability of dropping
 *                or doubling a hit to vary the groove
 *
 *   sequences  → "Cell Rotate": rotate the pattern by a random scale degree
 *                and shuffle internal cells while keeping cell length
 *
 *   ambient    → "Drift": same long-tone structure, pitches drifted ±2
 *                steps within scale to create a related but distinct chord
 *
 * Generates one variation per source until target total reached. Runs
 * are deterministic given the same source ordering — seeded RNG.
 *
 * Run: node test/_generate_musical_variations.js [target=500]
 */

const fs = require('fs');
const path = require('path');
const midi = require('../app/renderer/midi-parser.js');
const loader = require('../app/renderer/pattern-loader.js');

const PATTERNS_ROOT = path.join(__dirname, '..', 'app', 'assets', 'patterns');
const MANIFEST_PATH = path.join(PATTERNS_ROOT, 'manifest.json');
const TARGET_TOTAL = parseInt(process.argv[2], 10) || 500;
const T = 480;

// ─── MIDI write (mirrors _gen_placeholder_patterns.js) ──────────

function vlq(n) {
    const bytes = [n & 0x7f];
    n >>= 7;
    while (n > 0) { bytes.unshift((n & 0x7f) | 0x80); n >>= 7; }
    return Buffer.from(bytes);
}
function buildMidi(notes, bpm) {
    const events = [];
    for (const n of notes) {
        const t = Math.max(0, Math.round(n.time * T));
        const d = Math.max(1, Math.round(n.duration * T));
        events.push({ tick: t, status: 0x90, d1: clamp(n.pitch, 0, 127), d2: clamp(n.velocity, 1, 127) });
        events.push({ tick: t + d, status: 0x80, d1: clamp(n.pitch, 0, 127), d2: 64 });
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
function clamp(v, lo, hi) { return Math.max(lo, Math.min(hi, Math.round(v))); }

// ─── Seeded RNG (deterministic re-runs) ─────────────────────────

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
function pick(arr, rng) {
    return arr[Math.floor(rng() * arr.length)];
}
function shuffle(arr, rng) {
    const out = arr.slice();
    for (let i = out.length - 1; i > 0; i--) {
        const j = Math.floor(rng() * (i + 1));
        [out[i], out[j]] = [out[j], out[i]];
    }
    return out;
}

// ─── Scale + pitch helpers ──────────────────────────────────────

function analyzeScale(notes) {
    const pcSet = new Set();
    for (const n of notes) pcSet.add(((n.pitch % 12) + 12) % 12);
    return [...pcSet].sort((a, b) => a - b);
}

function snapToScale(pitch, scale, minP, maxP) {
    if (scale.length === 0) return clamp(pitch, minP, maxP);
    pitch = clamp(pitch, minP, maxP);
    const targetPc = ((pitch % 12) + 12) % 12;
    if (scale.includes(targetPc)) return pitch;
    // Find nearest scale degree
    let best = pitch;
    let bestDist = 99;
    for (let off = 0; off <= 6; off++) {
        for (const dir of [+1, -1]) {
            const p = pitch + dir * off;
            const pc = ((p % 12) + 12) % 12;
            if (scale.includes(pc) && p >= minP && p <= maxP) {
                if (off < bestDist) { best = p; bestDist = off; }
            }
        }
        if (bestDist < 99) break;
    }
    return best;
}

// Group simultaneous notes into "chord events" (notes within ε beats of
// each other on the time axis). Used by chord-category generation.
function chordEvents(notes, epsilon) {
    if (notes.length === 0) return [];
    const sorted = [...notes].sort((a, b) => a.time - b.time);
    const out = [{ time: sorted[0].time, notes: [sorted[0]] }];
    for (let i = 1; i < sorted.length; i++) {
        const last = out[out.length - 1];
        if (sorted[i].time - last.time <= epsilon) {
            last.notes.push(sorted[i]);
        } else {
            out.push({ time: sorted[i].time, notes: [sorted[i]] });
        }
    }
    return out;
}

// ─── Strategy: chords (voicing swap) ────────────────────────────
// Keep all chord-event positions + per-event chord sizes. For each
// event, pick a fresh voicing from the source's scale within source's
// pitch range. Root note (lowest pitch) is kept 50% of the time to
// preserve the harmonic skeleton; the rest of the notes are sampled
// fresh from the scale.

function variantChords(srcNotes, src, rng) {
    const scale = analyzeScale(srcNotes);
    const minP = Math.min(...srcNotes.map(n => n.pitch));
    const maxP = Math.max(...srcNotes.map(n => n.pitch));
    const events = chordEvents(srcNotes, 0.05);
    const scalePitches = [];
    for (let p = minP; p <= maxP; p++) {
        if (scale.includes(((p % 12) + 12) % 12)) scalePitches.push(p);
    }
    if (scalePitches.length < 3) return null; // not enough scale material

    const out = [];
    for (const ev of events) {
        const size = ev.notes.length;
        const oldPitches = ev.notes.map(n => n.pitch).sort((a, b) => a - b);
        const keepRoot = rng() < 0.5;
        const fresh = new Set();
        if (keepRoot) fresh.add(oldPitches[0]);
        // Pick remaining (size - fresh.size) pitches with stratification
        // so we hit different parts of the range (no all-clustered chord)
        const layers = size;
        for (let i = 0; i < layers && fresh.size < size; i++) {
            const lo = minP + Math.floor((maxP - minP) * (i / layers));
            const hi = minP + Math.ceil((maxP - minP) * ((i + 1) / layers));
            const candidates = scalePitches.filter(p => p >= lo && p <= hi && !fresh.has(p));
            if (candidates.length === 0) continue;
            fresh.add(pick(candidates, rng));
        }
        // Top up if stratification didn't fill
        while (fresh.size < size) {
            const p = pick(scalePitches, rng);
            if (!fresh.has(p)) fresh.add(p);
            if (fresh.size === scalePitches.length) break;
        }
        const newPitches = [...fresh];
        // Map back to notes preserving each note's individual time + duration + velocity
        for (let i = 0; i < ev.notes.length && i < newPitches.length; i++) {
            const ref = ev.notes[i];
            out.push({
                pitch: newPitches[i],
                time: ref.time,
                duration: ref.duration,
                velocity: Math.round(ref.velocity * (0.85 + 0.3 * rng())),
            });
        }
    }
    return out;
}

// ─── Strategy: melodic / bass / leads (Markov reharm) ───────────
// Build a bigram transition table on the source's note order. Walk it
// from a random source pitch for the SAME number of notes. Keep each
// note's rhythm (time/duration/velocity) from the source — only the
// pitch is regenerated. Snap to source scale.

function variantMarkov(srcNotes, src, rng) {
    const scale = analyzeScale(srcNotes);
    const minP = Math.min(...srcNotes.map(n => n.pitch));
    const maxP = Math.max(...srcNotes.map(n => n.pitch));
    const sorted = [...srcNotes].sort((a, b) => a.time - b.time);

    // Bigram transitions
    const trans = new Map();
    for (let i = 0; i < sorted.length - 1; i++) {
        const a = sorted[i].pitch, b = sorted[i + 1].pitch;
        if (!trans.has(a)) trans.set(a, []);
        trans.get(a).push(b);
    }
    if (trans.size === 0) return null;

    // Start: pick a random source pitch from the first quarter of the pattern
    const startCandidates = sorted.slice(0, Math.max(1, Math.floor(sorted.length / 4))).map(n => n.pitch);
    let cur = pick(startCandidates, rng);

    const out = [];
    for (let i = 0; i < sorted.length; i++) {
        const ref = sorted[i];
        let nextPitch;
        if (i === 0) {
            nextPitch = cur;
        } else {
            const opts = trans.get(cur);
            if (opts && opts.length > 0) {
                // Bias slightly toward steps over leaps (musical preference)
                const sorted_opts = opts.slice().sort((a, b) => Math.abs(a - cur) - Math.abs(b - cur));
                // 60% step (closest 2), 40% leap (any)
                if (rng() < 0.6 && sorted_opts.length >= 2) {
                    nextPitch = pick(sorted_opts.slice(0, 2), rng);
                } else {
                    nextPitch = pick(opts, rng);
                }
            } else {
                // Dead end — pick anything from sorted unique source pitches
                const allP = Array.from(new Set(sorted.map(n => n.pitch)));
                nextPitch = pick(allP, rng);
            }
        }
        nextPitch = snapToScale(nextPitch, scale, minP, maxP);
        out.push({
            pitch: nextPitch,
            time: ref.time,
            duration: ref.duration,
            velocity: Math.round(ref.velocity * (0.9 + 0.2 * rng())),
        });
        cur = nextPitch;
    }
    return out;
}

// ─── Strategy: drums (groove shuffle) ───────────────────────────
// Drums are positional — pitches map to specific instruments, so we
// preserve them. We vary the timing (micro-shifts) and the density
// (probability of dropping or doubling a hit) to create a related
// groove. Total note count stays within 80-130% of the source.

function variantDrumGroove(srcNotes, src, rng) {
    const out = [];
    const sorted = [...srcNotes].sort((a, b) => a.time - b.time);
    for (const n of sorted) {
        // Drop probability: 12% — leaves space, makes variants feel less crowded
        if (rng() < 0.12) continue;
        // Micro-timing shift: ±25ms equivalent at 120 BPM ~ ±0.05 beats
        const shift = (rng() - 0.5) * 0.06;
        const newTime = Math.max(0, n.time + shift);
        out.push({
            pitch: n.pitch,
            time: newTime,
            duration: n.duration,
            velocity: clamp(n.velocity + Math.round((rng() - 0.5) * 30), 1, 127),
        });
        // Double-hit probability: 18% — adds ghost notes 1/32 later
        if (rng() < 0.18) {
            out.push({
                pitch: n.pitch,
                time: newTime + 0.125,
                duration: Math.min(n.duration, 0.125),
                velocity: clamp(Math.round(n.velocity * 0.55), 1, 127),
            });
        }
    }
    return out;
}

// ─── Strategy: sequences (cell rotate + scale lock) ─────────────
// Treat the source as one or more rhythmic cells. Rotate the pitch
// sequence by some offset within the scale to give a "transposed
// motif" feel — but keep ALL timing exact.

function variantSequence(srcNotes, src, rng) {
    const scale = analyzeScale(srcNotes);
    const minP = Math.min(...srcNotes.map(n => n.pitch));
    const maxP = Math.max(...srcNotes.map(n => n.pitch));
    if (scale.length === 0) return null;
    // Rotate by 2-4 scale degrees up
    const degrees = 2 + Math.floor(rng() * 3);
    // Compute semitone offset = degree count walked along the scale's cycle
    const idx0 = 0;
    const idx1 = (idx0 + degrees) % scale.length;
    const semitoneShift = (scale[idx1] - scale[idx0] + 12) % 12;
    // Apply shift, snap, clamp
    return srcNotes.map(n => {
        const p = snapToScale(n.pitch + semitoneShift, scale, minP, maxP);
        return { ...n, pitch: p };
    });
}

// ─── Strategy: ambient (drift) ──────────────────────────────────
// For long-sustained patterns, shift random notes ±1-2 scale degrees
// to create a related-but-distinct atmospheric chord. Keep most notes
// intact (mood preservation) — only ~40% of notes get drifted.

function variantAmbient(srcNotes, src, rng) {
    const scale = analyzeScale(srcNotes);
    const minP = Math.min(...srcNotes.map(n => n.pitch));
    const maxP = Math.max(...srcNotes.map(n => n.pitch));
    if (scale.length === 0) return null;
    return srcNotes.map(n => {
        if (rng() < 0.4) {
            const driftSemitones = (1 + Math.floor(rng() * 2)) * (rng() < 0.5 ? -1 : 1);
            return {
                ...n,
                pitch: snapToScale(n.pitch + driftSemitones, scale, minP, maxP),
            };
        }
        return n;
    });
}

// ─── Strategy dispatch ──────────────────────────────────────────

function generateVariation(srcNotes, src, rng) {
    if (!srcNotes || srcNotes.length === 0) return null;
    const cat = src.category;
    if (cat === 'chords')    return { notes: variantChords(srcNotes, src, rng),    label: 'Reharm' };
    if (cat === 'drums')     return { notes: variantDrumGroove(srcNotes, src, rng), label: 'Groove' };
    if (cat === 'sequences') return { notes: variantSequence(srcNotes, src, rng),  label: 'Rotate' };
    if (cat === 'ambient')   return { notes: variantAmbient(srcNotes, src, rng),   label: 'Drift' };
    // Default: monophonic-ish Markov reharm
    return { notes: variantMarkov(srcNotes, src, rng), label: 'Reharm' };
}

// ─── Main ───────────────────────────────────────────────────────

const manifest = JSON.parse(fs.readFileSync(MANIFEST_PATH, 'utf8'));
const sources = manifest.patterns.filter(p =>
    (p.added_in === 'v1.2.0-import' || p.added_in === 'v1.2.0') &&
    p.note_count >= 4
);
const existingGen = manifest.patterns.filter(p => p.added_in === 'v1.2.0-gen');
const others = manifest.patterns.filter(p =>
    p.added_in !== 'v1.2.0-import' && p.added_in !== 'v1.2.0' && p.added_in !== 'v1.2.0-gen'
);

const need = TARGET_TOTAL - manifest.patterns.length;
console.log(`\nCurrent: ${manifest.patterns.length}  Sources: ${sources.length}  Target: ${TARGET_TOTAL}  Need: ${need}\n`);
if (need <= 0) {
    console.log('Already at target — nothing to do.');
    process.exit(0);
}

// Per-category id counters (continue from current manifest)
const seqByCat = {};
for (const p of manifest.patterns) {
    const m = (p.id || '').match(/^([a-z]+)_var_(\d+)$/);
    if (m) seqByCat[m[1]] = Math.max(seqByCat[m[1]] || 0, parseInt(m[2], 10) + 1);
}
for (const cat of ['bass','leads','chords','melodic','drums','ambient','sequences']) {
    if (!seqByCat[cat]) seqByCat[cat] = 1;
}

const generated = [];
const counts = {};
let attempts = 0;
const maxAttempts = need * 5;

// Round-robin by category so every category gets variations even though
// chords dominates the source pool. Build a per-category queue, then
// rotate across queues — one source per category per round.
const srcByCat = {};
for (const s of sources) {
    if (!srcByCat[s.category]) srcByCat[s.category] = [];
    srcByCat[s.category].push(s);
}
// Shuffle each category's queue with a fixed-seed RNG so reruns are
// deterministic but the first-N selection isn't always the same lexical
// chunk of one category.
const shuffleRng = makeRng(0xC0FFEE);
for (const cat of Object.keys(srcByCat)) {
    srcByCat[cat] = shuffle(srcByCat[cat], shuffleRng);
}
const cycleCats = Object.keys(srcByCat);
let cycleIdx = 0;
let perCatIdx = {};
for (const cat of cycleCats) perCatIdx[cat] = 0;

function nextSource() {
    for (let tries = 0; tries < cycleCats.length; tries++) {
        const cat = cycleCats[cycleIdx % cycleCats.length];
        cycleIdx++;
        const queue = srcByCat[cat];
        if (!queue || queue.length === 0) continue;
        const i = perCatIdx[cat] % queue.length;
        perCatIdx[cat]++;
        return queue[i];
    }
    return null;
}

while (generated.length < need && attempts < maxAttempts) {
    attempts++;
    const src = nextSource();
    if (!src) break;

    // Seed RNG from source id + attempt for diversity yet reproducibility
    const rng = makeRng(hashStr(src.id + '|' + attempts));

    const srcFull = path.join(PATTERNS_ROOT, src.file);
    let srcParsed;
    try { srcParsed = midi.parse(fs.readFileSync(srcFull)); }
    catch (e) { continue; }
    if (!srcParsed.notes || srcParsed.notes.length === 0) continue;

    const variant = generateVariation(srcParsed.notes, src, rng);
    if (!variant || !variant.notes || variant.notes.length === 0) continue;

    // Don't write a copy that's identical to the source
    if (sameNotes(variant.notes, srcParsed.notes)) continue;

    // Build filename + id
    const cat = src.category;
    const seq = seqByCat[cat]++;
    const id = `${cat}_var_${String(seq).padStart(3, '0')}`;
    const srcBase = path.basename(src.file).replace(/\.mid$/i, '').slice(0, 60);
    const outFile = `${srcBase}_${variant.label.toLowerCase()}-${seq}.mid`;
    const outFull = path.join(PATTERNS_ROOT, cat, outFile);
    if (fs.existsSync(outFull)) continue;

    fs.writeFileSync(outFull, buildMidi(variant.notes, src.bpm));

    const entry = {
        id,
        name: `${src.name} · ${variant.label}`.slice(0, 60),
        file: cat + '/' + outFile,
        category: cat,
        style: src.style || [],
        key: src.key || 'C maj',
        bpm: src.bpm,
        bars: src.bars,
        note_count: variant.notes.length,
        energy: src.energy || 2,
        complexity: src.complexity || 2,
        tags: Array.from(new Set([...(src.tags || []), variant.label.toLowerCase()])).slice(0, 8),
        added_in: 'v1.2.0-gen',
    };
    generated.push(entry);
    counts[cat] = (counts[cat] || 0) + 1;
}

function sameNotes(a, b) {
    if (a.length !== b.length) return false;
    for (let i = 0; i < a.length; i++) {
        if (a[i].pitch !== b[i].pitch) return false;
        if (Math.abs(a[i].time - b[i].time) > 0.001) return false;
    }
    return true;
}

// Save
const final = {
    version: 1,
    generated_at: new Date().toISOString().slice(0, 10),
    patterns: [...manifest.patterns, ...generated],
};

const v = loader.validateManifest(final);
if (!v.ok) {
    console.error('\n✗ Manifest validation failed:');
    for (const e of v.errors) console.error('  - ' + e);
    process.exit(1);
}
fs.writeFileSync(MANIFEST_PATH, JSON.stringify(final, null, 2));

console.log(`Generated ${generated.length} musical variations:`);
for (const [cat, n] of Object.entries(counts)) console.log(`  ${cat.padEnd(11)} ${n}`);
console.log(`\nTotal patterns: ${final.patterns.length}`);
