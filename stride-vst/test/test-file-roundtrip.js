/**
 * Test: File-based JSON payload passing (Node → temp file → Max JS reads)
 * Run: node test/test-file-roundtrip.js
 */

const fs = require('fs');
const path = require('path');

const TEMP_FILE = path.join(__dirname, '_test_payload.json');

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

console.log('File-based Payload Tests\n');

test('Automation payload writes and reads back correctly', () => {
    const payload = {
        create_clip: true,
        clip_bars: 4,
        clip_length: 16,
        params: [{
            id: 1,
            name: "Serum: Cutoff",
            _path: "live_set view selected_track devices 1 parameters 3",
            points: [
                { time: 0, value: 0.2, curve: 0 },
                { time: 4, value: 0.8, curve: 0 },
                { time: 8, value: 0.5, curve: 0 }
            ]
        }]
    };

    fs.writeFileSync(TEMP_FILE, JSON.stringify(payload));
    const readBack = JSON.parse(fs.readFileSync(TEMP_FILE, 'utf8'));

    assert(readBack.clip_bars === 4, 'clip_bars mismatch');
    assert(readBack.params[0]._path === payload.params[0]._path, '_path mismatch');
    assert(readBack.params[0].points.length === 3, 'points count mismatch');
});

test('Multi-device payload with chain paths', () => {
    const payload = {
        create_clip: true, clip_bars: 8, clip_length: 32,
        params: [
            { id: 2, name: "Serum: Filter", _path: "live_set view selected_track devices 1 chains 0 devices 0 parameters 2", points: Array(50).fill(null).map((_, i) => ({ time: i * 0.64, value: Math.random() })) },
            { id: 5, name: "Saturator: Drive", _path: "live_set view selected_track devices 2 parameters 5", points: Array(30).fill(null).map((_, i) => ({ time: i * 1.07, value: Math.random() })) }
        ]
    };

    fs.writeFileSync(TEMP_FILE, JSON.stringify(payload));
    const readBack = JSON.parse(fs.readFileSync(TEMP_FILE, 'utf8'));

    assert(readBack.params.length === 2, 'Should have 2 params');
    assert(readBack.params[0].points.length === 50, 'First param should have 50 points');
    assert(readBack.params[1].points.length === 30, 'Second param should have 30 points');
    assert(readBack.params[0]._path.includes('chains 0'), 'Should preserve chain path');
});

test('Large chaos-style payload (12 params, 200 points each)', () => {
    const params = [];
    for (let p = 0; p < 12; p++) {
        const points = [];
        for (let i = 0; i < 200; i++) {
            points.push({ time: i * 0.08, value: Math.random(), curve: 0 });
        }
        params.push({
            id: p, name: `Device: Param ${p}`,
            _path: `live_set view selected_track devices 1 parameters ${p}`,
            points
        });
    }

    const payload = { create_clip: true, clip_bars: 4, clip_length: 16, params };
    const json = JSON.stringify(payload);

    fs.writeFileSync(TEMP_FILE, json);
    const readBack = JSON.parse(fs.readFileSync(TEMP_FILE, 'utf8'));

    assert(readBack.params.length === 12, 'Should have 12 params');
    assert(readBack.params[11].points.length === 200, 'Last param should have 200 points');
    console.log(`    (payload size: ${(json.length / 1024).toFixed(1)} KB)`);
});

test('MIDI payload', () => {
    const payload = {
        create_clip: true, clip_bars: 4, clip_length: 16,
        notes: Array(64).fill(null).map((_, i) => ({
            pitch: 36 + Math.floor(Math.random() * 48),
            time: i * 0.25,
            duration: 0.25,
            velocity: 60 + Math.floor(Math.random() * 67)
        }))
    };

    fs.writeFileSync(TEMP_FILE, JSON.stringify(payload));
    const readBack = JSON.parse(fs.readFileSync(TEMP_FILE, 'utf8'));

    assert(readBack.notes.length === 64, 'Should have 64 notes');
});

// Cleanup
try { fs.unlinkSync(TEMP_FILE); } catch (e) {}

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed > 0 ? 1 : 0);
