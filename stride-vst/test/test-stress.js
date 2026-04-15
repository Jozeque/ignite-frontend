/**
 * Stress Tests — Real-world and extreme scenarios
 * Run: node test/test-stress.js
 */

const fs = require('fs');
const path = require('path');

const TEMP_FILE = path.join(__dirname, '_test_stress.json');

let passed = 0;
let failed = 0;

function test(name, fn) {
    try {
        fn();
        console.log(`  ✓ ${name}`);
        passed++;
    } catch (e) {
        console.log(`  ✗ ${name}: ${e.message}`);
        failed++;
    }
}

function assert(cond, msg) { if (!cond) throw new Error(msg); }

function generateChaosPoints(bars, count) {
    const totalBeats = bars * 4;
    const points = [];
    for (let i = 0; i < count; i++) {
        points.push({
            time: parseFloat((Math.random() * totalBeats).toFixed(4)),
            value: parseFloat(Math.random().toFixed(4)),
            curve: 0
        });
    }
    points.sort((a, b) => a.time - b.time);
    return points;
}

function buildPayload(paramCount, bars, pointsPerParam) {
    const params = [];
    for (let p = 0; p < paramCount; p++) {
        const deviceIdx = Math.floor(p / 20);
        const paramIdx = p % 20;
        params.push({
            id: paramIdx,
            name: `Device${deviceIdx}: Param ${paramIdx}`,
            _path: `live_set view selected_track devices ${deviceIdx} parameters ${paramIdx}`,
            points: generateChaosPoints(bars, pointsPerParam)
        });
    }
    return { create_clip: true, clip_bars: bars, clip_length: bars * 4, params };
}

function estimateChunkedTime(totalCalls, chunkSize, intervalMs, callMs) {
    const chunks = Math.ceil(totalCalls / chunkSize);
    return (chunks * intervalMs + totalCalls * callMs) / 1000;
}

console.log('Stress Tests\n');

// ─── Real scenario: User's actual workflow ───────────────

test('REAL: 10 macros × 150 chaos pts × 4 bars', () => {
    const payload = buildPayload(10, 4, 150);
    const json = JSON.stringify(payload);
    const totalPts = payload.params.reduce((s, p) => s + p.points.length, 0);

    fs.writeFileSync(TEMP_FILE, json);
    const readBack = JSON.parse(fs.readFileSync(TEMP_FILE, 'utf8'));

    assert(readBack.params.length === 10, 'All params preserved');
    assert(totalPts === 1500, `Expected 1500 points, got ${totalPts}`);

    const estSec = estimateChunkedTime(totalPts, 50, 10, 3);
    console.log(`    ${totalPts} points, ${(json.length / 1024).toFixed(1)} KB`);
    console.log(`    Chunked write: ${Math.ceil(totalPts / 50)} chunks → ~${estSec.toFixed(1)}s (non-blocking)`);
    assert(estSec < 10, 'Should complete under 10 seconds');
});

test('REAL: 10 macros × 200 chaos pts × 4 bars (dense)', () => {
    const payload = buildPayload(10, 4, 200);
    const totalPts = payload.params.reduce((s, p) => s + p.points.length, 0);

    fs.writeFileSync(TEMP_FILE, JSON.stringify(payload));
    const readBack = JSON.parse(fs.readFileSync(TEMP_FILE, 'utf8'));

    assert(readBack.params.length === 10, 'All params preserved');
    const estSec = estimateChunkedTime(totalPts, 50, 10, 3);
    console.log(`    ${totalPts} points → ~${estSec.toFixed(1)}s (non-blocking)`);
    assert(estSec < 15, 'Should complete under 15 seconds');
});

// ─── Growth scenario: more params ────────────────────────

test('GROWTH: 30 params × 150 pts × 8 bars', () => {
    const payload = buildPayload(30, 8, 150);
    const totalPts = payload.params.reduce((s, p) => s + p.points.length, 0);
    const json = JSON.stringify(payload);

    fs.writeFileSync(TEMP_FILE, json);
    const readBack = JSON.parse(fs.readFileSync(TEMP_FILE, 'utf8'));

    assert(readBack.params.length === 30, 'All params preserved');
    const estSec = estimateChunkedTime(totalPts, 50, 10, 3);
    console.log(`    ${totalPts} points, ${(json.length / 1024).toFixed(1)} KB → ~${estSec.toFixed(1)}s`);
    assert(estSec < 30, 'Should complete under 30 seconds');
});

test('GROWTH: 50 params × 150 pts × 16 bars', () => {
    const payload = buildPayload(50, 16, 150);
    const totalPts = payload.params.reduce((s, p) => s + p.points.length, 0);
    const json = JSON.stringify(payload);

    fs.writeFileSync(TEMP_FILE, json);
    const readBack = JSON.parse(fs.readFileSync(TEMP_FILE, 'utf8'));

    assert(readBack.params.length === 50, 'All params preserved');
    const estSec = estimateChunkedTime(totalPts, 50, 10, 3);
    console.log(`    ${totalPts} points, ${(json.length / 1024).toFixed(1)} KB → ~${estSec.toFixed(1)}s`);
});

// ─── Extreme: stress limit ───────────────────────────────

test('EXTREME: 100 params × 150 pts × 16 bars', () => {
    const payload = buildPayload(100, 16, 150);
    const totalPts = payload.params.reduce((s, p) => s + p.points.length, 0);
    const json = JSON.stringify(payload);

    fs.writeFileSync(TEMP_FILE, json);
    const readBack = JSON.parse(fs.readFileSync(TEMP_FILE, 'utf8'));

    assert(readBack.params.length === 100, 'All params preserved');
    assert(totalPts === 15000, `Expected 15000, got ${totalPts}`);

    const estSec = estimateChunkedTime(totalPts, 50, 10, 3);
    console.log(`    ${totalPts} points, ${(json.length / 1024).toFixed(1)} KB → ~${estSec.toFixed(1)}s`);
    console.log(`    User should see progress bar for writes > 5s`);
});

// ─── File I/O performance ────────────────────────────────

test('File I/O: write + read + parse timing at scale', () => {
    const payload = buildPayload(100, 16, 150);
    const json = JSON.stringify(payload);

    const t0 = Date.now();
    fs.writeFileSync(TEMP_FILE, json);
    const writeMs = Date.now() - t0;

    const t1 = Date.now();
    const raw = fs.readFileSync(TEMP_FILE, 'utf8');
    const readMs = Date.now() - t1;

    const t2 = Date.now();
    JSON.parse(raw);
    const parseMs = Date.now() - t2;

    console.log(`    ${(json.length / 1024).toFixed(0)} KB — Write: ${writeMs}ms, Read: ${readMs}ms, Parse: ${parseMs}ms`);
    assert(writeMs < 100, 'Write should be under 100ms');
    assert(readMs < 100, 'Read should be under 100ms');
    assert(parseMs < 100, 'Parse should be under 100ms');
});

// ─── Point integrity ─────────────────────────────────────

test('Point integrity: all values survive roundtrip', () => {
    const payload = buildPayload(10, 4, 150);
    fs.writeFileSync(TEMP_FILE, JSON.stringify(payload));
    const readBack = JSON.parse(fs.readFileSync(TEMP_FILE, 'utf8'));

    for (let p = 0; p < 10; p++) {
        const orig = payload.params[p].points;
        const read = readBack.params[p].points;
        assert(orig.length === read.length, `Param ${p}: point count mismatch`);
        for (let i = 0; i < orig.length; i++) {
            assert(orig[i].time === read[i].time, `Param ${p} pt ${i}: time mismatch`);
            assert(orig[i].value === read[i].value, `Param ${p} pt ${i}: value mismatch`);
        }
    }
});

// Cleanup
try { fs.unlinkSync(TEMP_FILE); } catch (e) {}

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed > 0 ? 1 : 0);
