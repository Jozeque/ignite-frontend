/**
 * Bulk-import every .mid in ~/Downloads into the Pattern Library under
 * `melodic` (the catch-all category). Joe sorts and tags them later.
 *
 * For each file:
 *   - Parse with midi-parser to validate + extract metadata
 *   - Skip if parse fails or zero notes
 *   - Compute bars from max note end (rounded up to nearest power of 2 in [1..32])
 *   - Try to extract bpm + key from Stride-generation filename pattern
 *   - Copy into app/assets/patterns/melodic/, resolving collisions with -N suffix
 *   - Append a manifest entry (preserves existing placeholders)
 *
 * Underscore prefix → ignored by the test runner. Run by hand:
 *   node test/_import_downloads.js
 */

const fs = require('fs');
const path = require('path');
const os = require('os');
const midi = require('../app/renderer/midi-parser.js');
const loader = require('../app/renderer/pattern-loader.js');

const DOWNLOADS = path.join(os.homedir(), 'Downloads');
const PATTERNS_ROOT = path.join(__dirname, '..', 'app', 'assets', 'patterns');
const TARGET_CATEGORY = 'melodic';
const TARGET_DIR = path.join(PATTERNS_ROOT, TARGET_CATEGORY);
const MANIFEST_PATH = path.join(PATTERNS_ROOT, 'manifest.json');

// ─── Walk ────────────────────────────────────────────────────────

function findMidi(root, depth = 3) {
    const out = [];
    function walk(d, remaining) {
        if (remaining < 0) return;
        let entries;
        try { entries = fs.readdirSync(d, { withFileTypes: true }); }
        catch (e) { return; }
        for (const ent of entries) {
            const full = path.join(d, ent.name);
            if (ent.isDirectory()) {
                walk(full, remaining - 1);
            } else if (ent.isFile() && /\.mid$/i.test(ent.name)) {
                out.push(full);
            }
        }
    }
    walk(root, depth);
    return out;
}

// ─── Metadata extraction ────────────────────────────────────────

function sanitizeFilename(name) {
    return name
        .replace(/\.mid$/i, '')
        .replace(/[^a-zA-Z0-9._-]/g, '_')
        .replace(/_+/g, '_')
        .replace(/^_|_$/g, '')
        .slice(0, 90);
}

// Stride-generation filename: <prefix>_<style>_<key>_..._<bpm>BPM_<...>.mid
// Best-effort parse. Returns {bpm, key, style, nameHint} — any can be undefined.
function parseStrideName(filename) {
    const result = {};
    const stem = filename.replace(/\.mid$/i, '').replace(/ \(\d+\)$/, '');

    const bpmMatch = stem.match(/(\d{2,3})BPM/i);
    if (bpmMatch) result.bpm = parseInt(bpmMatch[1], 10);

    // Stride pattern: "Stride_<style>_<key>_<bpm>BPM_<time>_<id>"
    const stride = stem.match(/^Stride_([A-Za-z0-9-]+)_([A-Za-z#]+)_\d+BPM/);
    if (stride) {
        result.style = stride[1];
        result.key = normalizeKey(stride[2]);
        result.nameHint = stride[1].replace(/-/g, ' ');
    }

    // generations pattern: "generations_<uid>_<style>_<key>_..."
    const gens = stem.match(/^generations_[A-Za-z0-9]+_([A-Za-z0-9-]+)_([A-Z]b?#?)_/);
    if (gens && !result.style) {
        result.style = gens[1];
        result.key = normalizeKey(gens[2]);
        result.nameHint = gens[1].replace(/-/g, ' ');
    }

    return result;
}

function normalizeKey(k) {
    if (!k) return null;
    // Single letter → "X maj" default
    if (/^[A-G][#b]?$/.test(k)) return k.replace('b', '#') + ' maj';
    // "EPhryg" → "E phr"; "FPhr" → "F phr"; etc.
    const mode = k.match(/^([A-G][#b]?)(maj|min|phr|phryg|dor|lyd|mix|loc|harm|mel)/i);
    if (mode) {
        const root = mode[1].replace('b', '#');
        let m = mode[2].toLowerCase().slice(0, 3);
        if (m === 'phr' || m === 'phr') m = 'phr';
        return root + ' ' + m;
    }
    return null;
}

function computeBars(maxBeat) {
    if (!Number.isFinite(maxBeat) || maxBeat <= 0) return 1;
    const raw = Math.max(1, Math.ceil(maxBeat / 4));
    const valid = [1, 2, 4, 8, 16, 32];
    for (const b of valid) if (raw <= b) return b;
    return 32;
}

// ─── Main ────────────────────────────────────────────────────────

console.log(`\nScanning ${DOWNLOADS} …\n`);
const files = findMidi(DOWNLOADS, 3);
console.log(`Found ${files.length} .mid files\n`);

if (!fs.existsSync(TARGET_DIR)) fs.mkdirSync(TARGET_DIR, { recursive: true });

const manifest = JSON.parse(fs.readFileSync(MANIFEST_PATH, 'utf8'));
const existingIds = new Set(manifest.patterns.map(p => p.id));
const existingFiles = new Set(manifest.patterns.map(p => p.file));

let imported = 0;
let skippedParse = 0;
let skippedEmpty = 0;
let skippedDuplicate = 0;
let skippedLarge = 0;
let seq = 1;

// Find next available sequence number for "melodic_unsorted_NNN" ids
const usedSeqs = new Set();
for (const id of existingIds) {
    const m = id.match(/^melodic_unsorted_(\d+)$/);
    if (m) usedSeqs.add(parseInt(m[1], 10));
}
function nextSeq() {
    while (usedSeqs.has(seq)) seq++;
    usedSeqs.add(seq);
    return seq;
}

for (const src of files) {
    const baseName = path.basename(src);
    // Stride generations / very large files → skip the giants
    let buf;
    try { buf = fs.readFileSync(src); }
    catch (e) { console.warn(`✗ read fail: ${baseName}`); continue; }
    if (buf.length > 200 * 1024) {
        skippedLarge++;
        continue;
    }

    let parsed;
    try { parsed = midi.parse(buf); }
    catch (e) { skippedParse++; continue; }

    if (!parsed.notes || parsed.notes.length === 0) { skippedEmpty++; continue; }
    if (!Number.isFinite(parsed.durationBeats) || parsed.durationBeats < 0.5) { skippedEmpty++; continue; }

    // Filename → safe storage name + collision handling
    let safe = sanitizeFilename(baseName);
    let candidate = safe + '.mid';
    let n = 1;
    while (fs.existsSync(path.join(TARGET_DIR, candidate)) || existingFiles.has(TARGET_CATEGORY + '/' + candidate)) {
        candidate = `${safe}-${n}.mid`;
        n++;
    }
    const dest = path.join(TARGET_DIR, candidate);

    // Extract metadata
    const hint = parseStrideName(baseName);
    const bpm = hint.bpm || Math.round(parsed.bpm || 120);
    const bars = computeBars(parsed.durationBeats);
    const noteCount = parsed.notes.length;
    const key = hint.key || 'C maj';
    const idNum = String(nextSeq()).padStart(3, '0');
    const id = `melodic_unsorted_${idNum}`;
    const displayName = (hint.nameHint || safe.replace(/_/g, ' '))
        .slice(0, 60)
        .replace(/\b\w/g, c => c.toUpperCase());

    // Copy file
    fs.copyFileSync(src, dest);

    // Manifest entry — style left empty so it doesn't clash with the
    // controlled vocab. User retags in manifest later. Tags free-form
    // get the user's filename hint so they can grep visually.
    const entry = {
        id,
        name: displayName,
        file: TARGET_CATEGORY + '/' + candidate,
        category: TARGET_CATEGORY,
        style: [],
        key,
        bpm,
        bars,
        note_count: noteCount,
        energy: 2,
        complexity: 2,
        tags: hint.style ? [hint.style.toLowerCase()] : [],
        added_in: 'v1.2.0-import',
    };
    manifest.patterns.push(entry);
    existingFiles.add(entry.file);
    imported++;
}

// Re-validate before writing
const v = loader.validateManifest(manifest);
if (!v.ok) {
    console.error('\n✗ Manifest validation failed after merge:');
    for (const e of v.errors) console.error('  - ' + e);
    process.exit(1);
}

manifest.generated_at = new Date().toISOString().slice(0, 10);
fs.writeFileSync(MANIFEST_PATH, JSON.stringify(manifest, null, 2));

console.log(`Imported:        ${imported}`);
console.log(`Skipped (parse): ${skippedParse}`);
console.log(`Skipped (empty): ${skippedEmpty}`);
console.log(`Skipped (large): ${skippedLarge}`);
console.log(`Duplicates:      ${skippedDuplicate}`);
console.log(`\nManifest now has ${manifest.patterns.length} patterns total.`);
console.log(`Saved: ${MANIFEST_PATH}`);
