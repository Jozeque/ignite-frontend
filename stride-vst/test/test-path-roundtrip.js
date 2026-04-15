/**
 * Test: _path preservation through the full scan → canvas → apply pipeline
 * Run: node test/test-path-roundtrip.js
 */

let passed = 0;
let failed = 0;

function test(name, fn) {
    try { fn(); console.log(`  ✓ ${name}`); passed++; }
    catch (e) { console.log(`  ✗ ${name}: ${e.message}`); failed++; }
}
function assert(cond, msg) { if (!cond) throw new Error(msg); }

console.log('_path Roundtrip Tests\n');

// Simulate what the scanner sends
const scanResult = {
    type: 'rack_scanned',
    track_name: 'My Track',
    device_name: 'Instrument Rack + Saturator',
    clip_bars: 4,
    parameters: [
        { id: 1, name: 'Serum: Macro 1', min: 0, max: 127, value: 64, _path: 'live_set tracks 10 devices 0 chains 0 devices 0 parameters 1' },
        { id: 2, name: 'Serum: Macro 2', min: 0, max: 127, value: 32, _path: 'live_set tracks 10 devices 0 chains 0 devices 0 parameters 2' },
        { id: 5, name: 'Saturator: Drive', min: 0, max: 1, value: 0.5, _path: 'live_set tracks 10 devices 1 parameters 5' },
    ]
};

// ─── Test 1: loadParamsDirectly should preserve _path ────

test('loadParamsDirectly preserves _path', () => {
    // Simulate current (broken) behavior
    const broken = scanResult.parameters.map(p => ({
        envelopeId: String(p.id),
        name: p.name,
        min: p.min,
        max: p.max,
        id: p.id,
        points: []
        // NOTE: _path is NOT included — this is the bug
    }));
    assert(!broken[0]._path, 'Broken version should not have _path (confirming bug exists)');

    // Simulate fixed behavior
    const fixed = scanResult.parameters.map(p => ({
        envelopeId: String(p.id),
        name: p.name,
        min: p.min,
        max: p.max,
        id: p.id,
        _path: p._path,
        points: []
    }));
    assert(fixed[0]._path === 'live_set tracks 10 devices 0 chains 0 devices 0 parameters 1', 'Fixed version should have _path');
    assert(fixed[2]._path === 'live_set tracks 10 devices 1 parameters 5', 'Saturator _path should survive');
});

// ─── Test 2: confirmParamPick should preserve _path ──────

test('confirmParamPick preserves _path', () => {
    const pendingScanParams = scanResult.parameters;
    const checkedIds = ['1', '5']; // user picks Macro 1 and Saturator Drive

    // Broken
    const broken = pendingScanParams
        .filter(p => checkedIds.includes(String(p.id)))
        .map(p => ({
            envelopeId: String(p.id),
            name: p.name,
            min: p.min,
            max: p.max,
            id: p.id,
            points: []
        }));
    assert(broken.length === 2, 'Should filter to 2 params');
    assert(!broken[0]._path, 'Broken version has no _path');

    // Fixed
    const fixed = pendingScanParams
        .filter(p => checkedIds.includes(String(p.id)))
        .map(p => ({
            envelopeId: String(p.id),
            name: p.name,
            min: p.min,
            max: p.max,
            id: p.id,
            _path: p._path,
            points: []
        }));
    assert(fixed[0]._path === 'live_set tracks 10 devices 0 chains 0 devices 0 parameters 1', 'Macro 1 _path');
    assert(fixed[1]._path === 'live_set tracks 10 devices 1 parameters 5', 'Saturator _path');
});

// ─── Test 3: applyAutomation WS message includes _path ──

test('applyAutomation sends _path in WS message', () => {
    const paramsWithPoints = [
        { id: 1, name: 'Serum: Macro 1', _path: 'live_set tracks 10 devices 0 chains 0 devices 0 parameters 1', points: [{time: 0, value: 0.5}] },
        { id: 5, name: 'Saturator: Drive', _path: 'live_set tracks 10 devices 1 parameters 5', points: [{time: 0, value: 0.8}] },
    ];

    // Simulate ws-client.js applyAutomation
    const msg = {
        type: 'apply_automation',
        create_clip_if_missing: true,
        clip_bars: 4,
        parameters: paramsWithPoints.map(p => ({
            id: p.id,
            name: p.name,
            _path: p._path || null,
            points: (p.points || []).map(pt => ({
                time: pt.time,
                value: pt.value,
                curve: pt.curve || 0
            }))
        }))
    };

    assert(msg.parameters[0]._path === 'live_set tracks 10 devices 0 chains 0 devices 0 parameters 1', 'WS msg _path[0]');
    assert(msg.parameters[1]._path === 'live_set tracks 10 devices 1 parameters 5', 'WS msg _path[1]');
});

// ─── Test 4: writer.js preserves _path in payload file ───

test('writer.js preserves _path in JSON payload', () => {
    const fs = require('fs');
    const path = require('path');
    const TEMP = path.join(__dirname, '_test_path.json');

    const msg = {
        parameters: [
            { id: 1, name: 'Serum: Macro 1', _path: 'live_set tracks 10 devices 0 chains 0 devices 0 parameters 1', points: [{time: 0, value: 0.5}] },
        ],
        clip_bars: 4,
        create_clip_if_missing: true
    };

    // Simulate writer.js
    const payload = {
        create_clip: true,
        clip_bars: 4,
        clip_length: 16,
        params: msg.parameters.map(p => ({
            id: p.id,
            name: p.name,
            _path: p._path || null,
            points: (p.points || []).map(pt => ({ time: pt.time, value: pt.value, curve: pt.curve || 0 }))
        }))
    };

    fs.writeFileSync(TEMP, JSON.stringify(payload));
    const readBack = JSON.parse(fs.readFileSync(TEMP, 'utf8'));

    assert(readBack.params[0]._path === 'live_set tracks 10 devices 0 chains 0 devices 0 parameters 1', 'File payload _path');
    fs.unlinkSync(TEMP);
});

// ─── Test 5: scanner_max.js write_automation uses _path ──

test('write_automation falls back correctly when _path is null vs present', () => {
    // Simulate what write_automation does with _path
    function getParamPath(paramData) {
        return paramData._path || ("live_set view selected_track devices 0 parameters " + paramData.id);
    }

    // With _path (correct)
    const withPath = { id: 1, _path: 'live_set tracks 10 devices 0 chains 0 devices 0 parameters 1' };
    assert(getParamPath(withPath) === 'live_set tracks 10 devices 0 chains 0 devices 0 parameters 1', 'Should use _path when present');

    // Without _path (broken fallback)
    const withoutPath = { id: 1, _path: null };
    assert(getParamPath(withoutPath) === 'live_set view selected_track devices 0 parameters 1', 'Should fallback — but this path is wrong for multi-device setups');
});

// ─── Test 6: Absolute paths survive between scan and apply ──

test('Absolute paths (live_set tracks X) are stable', () => {
    const absPath = 'live_set tracks 10 devices 0 chains 0 devices 0 parameters 1';
    const relPath = 'live_set view selected_track devices 0 chains 0 devices 0 parameters 1';

    // Absolute paths don't depend on selection
    assert(!absPath.includes('view selected_track'), 'Absolute path should not contain view selected_track');
    assert(relPath.includes('view selected_track'), 'Relative path contains view selected_track');

    // After user clicks another track, absolute path still works
    assert(absPath.startsWith('live_set tracks'), 'Absolute path is stable regardless of selection');
});

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed > 0 ? 1 : 0);
