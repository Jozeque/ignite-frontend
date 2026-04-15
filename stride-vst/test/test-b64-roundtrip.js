/**
 * Test: Base64 encode/decode roundtrip for Max JSON payloads
 * Run: node test/test-b64-roundtrip.js
 */

// Simulate Node side (writer.js) encoding
function nodeEncode(obj) {
    return Buffer.from(JSON.stringify(obj)).toString('base64');
}

// Simulate Max JS side (scanner_max.js) decoding
var B64 = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/=";
function b64decode(input) {
    var output = "";
    var i = 0;
    input = input.replace(/[^A-Za-z0-9\+\/\=]/g, "");
    while (i < input.length) {
        var e1 = B64.indexOf(input.charAt(i++));
        var e2 = B64.indexOf(input.charAt(i++));
        var e3 = B64.indexOf(input.charAt(i++));
        var e4 = B64.indexOf(input.charAt(i++));
        var c1 = (e1 << 2) | (e2 >> 4);
        var c2 = ((e2 & 15) << 4) | (e3 >> 2);
        var c3 = ((e3 & 3) << 6) | e4;
        output += String.fromCharCode(c1);
        if (e3 !== 64) output += String.fromCharCode(c2);
        if (e4 !== 64) output += String.fromCharCode(c3);
    }
    return output;
}

// ─── Tests ───────────────────────────────────────────────

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

function assert(condition, msg) {
    if (!condition) throw new Error(msg || 'Assertion failed');
}

console.log('Base64 Roundtrip Tests\n');

test('Simple automation payload roundtrips correctly', () => {
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

    const encoded = nodeEncode(payload);
    assert(!encoded.includes(' '), 'Base64 should have no spaces');

    const decoded = JSON.parse(b64decode(encoded));
    assert(decoded.clip_bars === 4, 'clip_bars mismatch');
    assert(decoded.params.length === 1, 'params count mismatch');
    assert(decoded.params[0].name === "Serum: Cutoff", 'param name mismatch');
    assert(decoded.params[0]._path === "live_set view selected_track devices 1 parameters 3", '_path mismatch');
    assert(decoded.params[0].points.length === 3, 'points count mismatch');
    assert(decoded.params[0].points[1].value === 0.8, 'point value mismatch');
});

test('Multi-device payload with special chars', () => {
    const payload = {
        create_clip: true,
        clip_bars: 8,
        clip_length: 32,
        params: [
            {
                id: 2, name: "Serum: Filter Cutoff",
                _path: "live_set view selected_track devices 1 chains 0 devices 0 parameters 2",
                points: [{ time: 0, value: 0.0 }, { time: 16, value: 1.0 }]
            },
            {
                id: 5, name: "Saturator: Drive",
                _path: "live_set view selected_track devices 1 chains 0 devices 1 parameters 5",
                points: [{ time: 0, value: 0.5 }, { time: 8, value: 0.9 }, { time: 24, value: 0.1 }]
            }
        ]
    };

    const encoded = nodeEncode(payload);
    const decoded = JSON.parse(b64decode(encoded));

    assert(decoded.params.length === 2, 'Should have 2 params');
    assert(decoded.params[0]._path.includes('chains 0 devices 0'), 'First param path should include chain');
    assert(decoded.params[1].name === "Saturator: Drive", 'Second param name mismatch');
    assert(decoded.params[1].points.length === 3, 'Second param should have 3 points');
});

test('Empty params payload', () => {
    const payload = { create_clip: false, clip_bars: 4, clip_length: 16, params: [] };
    const encoded = nodeEncode(payload);
    const decoded = JSON.parse(b64decode(encoded));
    assert(decoded.params.length === 0, 'Should have 0 params');
});

test('Large payload with many points', () => {
    const points = [];
    for (let i = 0; i < 200; i++) {
        points.push({ time: i * 0.08, value: Math.random(), curve: 0 });
    }
    const payload = {
        create_clip: true, clip_bars: 4, clip_length: 16,
        params: [{ id: 1, name: "Test: Param", _path: "live_set view selected_track devices 2 parameters 1", points }]
    };

    const encoded = nodeEncode(payload);
    assert(!encoded.includes(' '), 'Large base64 should have no spaces');

    const decoded = JSON.parse(b64decode(encoded));
    assert(decoded.params[0].points.length === 200, 'Should preserve all 200 points');
});

test('MIDI payload roundtrips correctly', () => {
    const payload = {
        create_clip: true, clip_bars: 4, clip_length: 16,
        notes: [
            { pitch: 60, time: 0, duration: 0.5, velocity: 100 },
            { pitch: 64, time: 1, duration: 0.25, velocity: 80 },
            { pitch: 67, time: 2, duration: 1.0, velocity: 120 }
        ]
    };

    const encoded = nodeEncode(payload);
    const decoded = JSON.parse(b64decode(encoded));
    assert(decoded.notes.length === 3, 'Should have 3 notes');
    assert(decoded.notes[0].pitch === 60, 'First note pitch mismatch');
    assert(decoded.notes[2].velocity === 120, 'Last note velocity mismatch');
});

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed > 0 ? 1 : 0);
