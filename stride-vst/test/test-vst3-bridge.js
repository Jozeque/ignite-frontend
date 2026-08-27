/**
 * StrideBridge tests — the output stage that lets Stride VST modulate Ableton's
 * own devices (m4l-bridge/).
 *
 * Two layers:
 *   UNIT  — bridge-server.js is executed for real: protocol replies, lane
 *           identity (address + name verify, conflict, selection hint, relink,
 *           repath), voices keyed by resolved target, per-client diffing (a
 *           lane-less second instance must never wipe the first one's voices),
 *           liveness yield, rate math, the float32 WAV writer, and the
 *           rasterize path (which must stay 0..1 — normalized live.remote~).
 *   STRUCT — the pieces that only run inside Max/JUCE/WebView are pinned by
 *           shape: the patcher parses and is fully wired (32 inline voices, the
 *           face readout), shim carries the native-pipe client + the live/hosted
 *           save split, canvas carries the map/adopt/unmap/relink entry points +
 *           rebuild preservation, and the C++ carries the v10 "bl" blob end to end.
 *
 * Run: node test/test-vst3-bridge.js
 */

const fs = require('fs');
const path = require('path');

let passed = 0, failed = 0;
const _asyncQueue = [];
function test(name, fn) {
    try {
        const r = fn();
        if (r && typeof r.then === 'function') {
            _asyncQueue.push(r.then(() => { console.log(`  ✓ ${name}`); passed++; })
                              .catch(e => { console.log(`  ✗ ${name}: ${e.message}`); failed++; }));
            return;
        }
        console.log(`  ✓ ${name}`); passed++;
    }
    catch (e) { console.log(`  ✗ ${name}: ${e.message}`); failed++; }
}
function assert(c, m) { if (!c) throw new Error(m || 'assertion failed'); }
function close(a, b, eps, m) { if (Math.abs(a - b) > (eps || 1e-9)) throw new Error((m || 'not close') + ` — got ${a}, expected ${b}`); }

const ROOT = path.join(__dirname, '..');
const BRIDGE = path.join(ROOT, 'm4l-bridge');
const srv = require(path.join(BRIDGE, 'bridge-server.js'));

// capture Max outlet traffic + fake clients
let outbox = [];
srv._setIoForTest(atoms => outbox.push(atoms), () => {});
function fakeClient() { const c = { sent: [] }; c.send = (raw) => c.sent.push(JSON.parse(raw)); return c; }
function connect(...cs) { cs.forEach(c => srv.state.clients.add(c)); return cs; }
function resetState() {
    srv.state.voices.fill(null);
    srv.state.clients = new Set();
    srv.state.mapping = null;
    if (srv.state.mapTimer) { clearTimeout(srv.state.mapTimer); srv.state.mapTimer = null; }
    srv.state.playing = true;
    srv.state.lastSel = { track: '', device: '', at: 0 };
    srv.state.pending = {};
    srv.state.nextRid = 1;
    srv.state.repathRid = 0;
    srv.state.pongAt = 0; srv.state.pongSeen = false; srv.state.yielded = false; srv.state.active = false;
    srv.listeners.length = 0;
    outbox = [];
}
const enc = o => encodeURIComponent(JSON.stringify(o));
const probes = kind => outbox.filter(a => a[0] === 'probe' && a[1] === kind);
const lastProbe = kind => { const p = probes(kind); return p[p.length - 1]; };
const voiceMsgs = kind => outbox.filter(a => a[0] === 'voice' && a[2] === kind);
function push(client, lanes, bars) { srv.handleClientMessage(client, { type: 'set_live_lanes', bars: bars || 4, lanes }); }
function resolveOk(rid, id, name, device, p) { srv.handleResolved(enc({ rid, ok: 1, id, name: name || '', device: device || '', path: p || '' })); }
function resolveMiss(rid) { srv.handleResolved(enc({ rid, ok: 0, id: 0, message: 'not found' })); }
function found(rid, hits) { srv.handleFound(enc({ rid, count: hits.length, hits })); }
const voiceOf = id => srv.voiceByTarget(id);

const P1 = 'live_set tracks 0 devices 1 parameters 3';
const P2 = 'live_set tracks 2 devices 0 parameters 7';
// the field case: Roar on track 5, saved into a rack, dropped on track 6 next to the original
const ROAR1 = 'live_set tracks 5 devices 0 chains 0 devices 1 parameters 42';
const ROAR2 = 'live_set tracks 6 devices 0 chains 0 devices 1 parameters 42';
const RACK2 = 'live_set tracks 6 devices 0';
const LANE = (p, name, device, extra) => Object.assign({ path: p, points: [], speed: 1, name: name || 'Flt 3 Freq', device: device || 'Roar' }, extra || {});

console.log('\n— unit: math —');

test('rateFor: 4 bars @1x = factor 4 (1-bar phasor stretched 4x)', () => close(srv.rateFor(4, 1), 4));
test('rateFor: 8 bars @2x speed = factor 4', () => close(srv.rateFor(8, 2), 4));
test('rateFor: 1 bar @4x = 0.25, still above the floor', () => close(srv.rateFor(1, 4), 0.25));
test('rateFor: garbage in → sane default (4 bars, 1x)', () => close(srv.rateFor(undefined, 0), 4));
test('ticksFor kept for reference: 4 bars = 7680 ticks', () => close(srv.ticksFor(4, 1), 7680));
test('sampleCountFor scales per bar and caps', () => {
    close(srv.sampleCountFor(4), 4 * srv.SAMPLES_PER_BAR);
    assert(srv.sampleCountFor(100000) === 262144, 'cap');
});
test('path helpers: trackOf / deviceOf / under', () => {
    assert(srv.trackOf(ROAR2) === 'live_set tracks 6', 'track prefix');
    assert(srv.trackOf('live_set return_tracks 1 devices 0 parameters 2') === 'live_set return_tracks 1', 'return track');
    assert(srv.trackOf('live_set master_track devices 0 parameters 1') === 'live_set master_track', 'master');
    assert(srv.deviceOf(ROAR2) === 'live_set tracks 6 devices 0 chains 0 devices 1', 'device of a param');
    assert(srv.under(ROAR2, RACK2), 'param under its rack');
    assert(!srv.under('live_set tracks 6 devices 01 parameters 0', RACK2), 'prefix needs a whole atom');
});

console.log('\n— unit: rasterize (normalized contract) —');

test('empty points → constant 0.5, never silent', () => {
    const buf = srv.rasterizeLane({ bars: 4, points: [] });
    assert(buf.length === srv.sampleCountFor(4), 'length');
    close(buf[0], 0.5); close(buf[buf.length - 1], 0.5);
});
test('two-point ramp rasterizes 0→1 across the loop, stays 0..1', () => {
    const buf = srv.rasterizeLane({ bars: 4, points: [{ time: 0, value: 0 }, { time: 16, value: 1 }] });
    close(buf[0], 0, 1e-6);
    close(buf[buf.length - 1], 1, 2e-3, 'end of ramp');
    close(buf[buf.length >> 1], 0.5, 2e-3, 'midpoint');
    for (const v of buf) assert(v >= 0 && v <= 1, 'normalized bounds');
});
test('QUANTIZED lane rasterizes to NATIVE rounded option indices (live.object path)', () => {
    const buf = srv.rasterizeLane({ bars: 2, is_quantized: 1, min: 0, max: 5,
        points: [{ time: 0, value: 0 }, { time: 8, value: 1 }] });
    assert(buf[0] === 0, 'starts at option 0');
    assert(buf[buf.length - 1] === 5, 'ends at option 5, got ' + buf[buf.length - 1]);
    for (const v of buf) assert(v === Math.round(v) && v >= 0 && v <= 5, 'integer index in range');
    const opts = new Set(buf);
    assert(opts.size === 6, 'walks through ALL 6 options, got ' + opts.size);
});

test('CONTROL-RATE lane (MIDI effects) rasterizes NATIVE continuous values, unrounded, log-aware', () => {
    const lin = srv.rasterizeLane({ bars: 2, mode: 'c', min: 1, max: 16, points: [{ time: 0, value: 0 }, { time: 8, value: 1 }] });
    close(lin[0], 1, 1e-6, 'starts at native min');
    close(lin[lin.length - 1], 16, 0.4, 'ends at native max');
    assert(lin.some(v => v !== Math.round(v)), 'NOT rounded to integers (Live rounds integer params itself)');
    // THE FREEZE GUARD: every distinct value is one live.object set = one undo step + one
    // main-thread hop, so a control curve is snapped to CONTROL_STEPS levels and [change]
    // drops the rest. Unquantized values at 33Hz over 3 lanes froze Live (field 08-27).
    const levels = new Set(Array.from(lin));
    assert(levels.size <= srv.CONTROL_STEPS + 1, 'at most CONTROL_STEPS+1 distinct values, got ' + levels.size);
    assert(levels.size > 8, 'still a real sweep, not a staircase of 3, got ' + levels.size);
    const step = 15 / srv.CONTROL_STEPS;
    for (const v of levels) close(Math.round((v - 1) / step) * step + 1, v, 1e-6, 'value sits ON a level');
    const lg = srv.rasterizeLane({ bars: 2, mode: 'c', min: 1, max: 100, is_log: 1, points: [{ time: 0, value: 0.5 }] });
    close(lg[0], 10, 2.5, 'log taper: the middle of the curve sits near the geometric middle of the range');
    assert(srv.laneMode({ quant: false, devType: srv.MIDI_EFFECT }) === 'c', 'MIDI-effect param -> control path');
    assert(srv.laneMode({ quant: true, devType: srv.MIDI_EFFECT }) === 'q', 'menu on a MIDI effect -> stepped path');
    assert(srv.laneMode({ quant: false, devType: 2 }) === 'r' && srv.laneMode({ quant: false }) === 'r', 'audio effects / instruments / mixer -> remote~');
});

test('NORMALIZED_OUTPUT is on: min/max on the lane must NOT rescale the buffer', () => {
    assert(srv.NORMALIZED_OUTPUT === true, 'contract flag');
    const a = srv.rasterizeLane({ bars: 2, points: [{ time: 0, value: 0.25 }], min: 20, max: 20000 });
    close(a[0], 0.25, 1e-6, 'still 0..1 despite native min/max present');
});

console.log('\n— unit: WAV writer —');

test('float32 mono WAV: header fields + payload roundtrip', () => {
    const wav = srv.buildWav(Float32Array.from([0, 0.25, 0.5, 1]));
    assert(wav.toString('ascii', 0, 4) === 'RIFF' && wav.toString('ascii', 8, 12) === 'WAVE', 'container');
    assert(wav.readUInt16LE(20) === 3, 'format 3 = IEEE float');
    assert(wav.readUInt16LE(22) === 1, 'mono');
    assert(wav.readUInt32LE(24) === 44100, 'sample rate');
    assert(wav.readUInt16LE(34) === 32, '32-bit');
    assert(wav.readUInt32LE(40) === 16, 'data bytes');
    close(wav.readFloatLE(44 + 4), 0.25, 1e-7, 'sample verbatim');
});
test('writeVoiceWav alternates two filenames per voice (replace never re-reads a file mid-write)', () => {
    const a = srv.writeVoiceWav(3, 1, Float32Array.from([0.5]));
    const b = srv.writeVoiceWav(3, 2, Float32Array.from([0.5]));
    assert(a !== b, 'gen alternation');
    assert(fs.existsSync(a) && fs.existsSync(b), 'files exist');
    assert(a.indexOf(srv.TMP_DIR) === 0, 'in the bridge temp dir');
});

console.log('\n— unit: protocol + voices —');

test('bridge_hello → bridge_ready with the voice count (32)', () => {
    resetState();
    const c = fakeClient();
    srv.handleClientMessage(c, { type: 'bridge_hello', version: 1 });
    assert(c.sent.length === 1 && c.sent[0].type === 'bridge_ready' && c.sent[0].voices === 32, JSON.stringify(c.sent));
    assert(srv.NUM_VOICES === 32, 'rack copies double the bank');
});

test('set_live_lanes: asks the [js] to resolve the address; no voice until the target is known', () => {
    resetState();
    const c = fakeClient();
    push(c, [{ path: P1, points: [{ time: 0, value: 0 }, { time: 16, value: 1 }], speed: 1 }]);
    const probe = lastProbe('resolve');
    assert(probe && probe[3] === P1, 'resolve requested with the path');
    assert(!voiceMsgs('replace').length && !voiceMsgs('bind').length, 'nothing rendered or bound before the target is known');
    const stateMsg = c.sent.find(m => m.type === 'live_lanes_state');
    assert(stateMsg && stateMsg.lanes.length === 1 && stateMsg.lanes[0].bound === false && stateMsg.lanes[0].voice === 0, 'unbound, unvoiced until resolve echoes');
});

test('verified resolve: allocates a voice, renders (replace + rate), binds, tells the OWNER only', () => {
    resetState();
    const [a, b] = connect(fakeClient(), fakeClient());
    push(a, [{ path: P1, points: [{ time: 0, value: 0 }, { time: 16, value: 1 }], speed: 1, name: 'Frequency', device: 'Auto Filter' }]);
    resolveOk(lastProbe('resolve')[2], 1017, 'Frequency', 'Auto Filter', P1);
    assert(voiceMsgs('replace').length === 1, 'replace emitted');
    close(voiceMsgs('rate')[0][3], 4, 1e-9, 'rate factor bars/speed');
    const bind = voiceMsgs('bind')[0];
    assert(bind && bind[1] === 1 && bind[3] === 1017, 'bind emitted to voice 1');
    assert(srv.voiceByTarget(1017) === 1, 'voice keyed by the RESOLVED TARGET id');
    const res = a.sent.find(m => m.type === 'live_bind_result');
    assert(res && res.ok === true && res.id === 1017, 'owner told');
    assert(!b.sent.some(m => m.type === 'live_bind_result'), 'a bystander window hears nothing');
});

test('unchanged push is a no-op (signature diff), changed shape re-renders without re-binding', () => {
    resetState();
    const [c] = connect(fakeClient());
    const lane = { path: P1, points: [{ time: 0, value: 0 }, { time: 16, value: 1 }], speed: 1 };
    push(c, [lane]);
    resolveOk(lastProbe('resolve')[2], 55, '', '', P1);
    const before = voiceMsgs('replace').length;
    push(c, [lane]);
    assert(voiceMsgs('replace').length === before, 'no re-render on identical push');
    assert(probes('resolve').length === 1, 'a bound lane is never re-resolved by an edit');
    push(c, [{ ...lane, speed: 2 }]);
    assert(voiceMsgs('replace').length === before + 1, 're-render on change');
    const rates = voiceMsgs('rate');
    close(rates[rates.length - 1][3], 2, 1e-9, 'new rate = 4 bars / 2x');
    assert(voiceMsgs('bind').length === 1, 'still one bind');
});

test('resolve routes by kind: continuous -> bind (remote~), quantized -> bindq (live.object)', () => {
    resetState();
    const [c] = connect(fakeClient());
    push(c, [{ path: P1, points: [], speed: 1 }, { path: P2, points: [], speed: 1, is_quantized: 1 }]);
    const [r1, r2] = probes('resolve');
    resolveOk(r1[2], 111, '', '', P1);
    resolveOk(r2[2], 222, '', '', P2);
    const b1 = outbox.find(a => a[0] === 'voice' && a[1] === voiceOf(111) && (a[2] === 'bind' || a[2] === 'bindq'));
    const b2 = outbox.find(a => a[0] === 'voice' && a[1] === voiceOf(222) && (a[2] === 'bind' || a[2] === 'bindq'));
    assert(b1 && b1[2] === 'bind', 'continuous voice got bind, got ' + JSON.stringify(b1));
    assert(b2 && b2[2] === 'bindq', 'quantized voice got bindq, got ' + JSON.stringify(b2));
});

test('MIDI-effect parameter (Arpeggiator): the Live setter path, native values, never locks the knob', () => {
    resetState();
    const [c] = connect(fakeClient());
    const ARP = 'live_set tracks 1 devices 0 parameters 5';
    push(c, [{ path: ARP, points: [{ time: 0, value: 0 }, { time: 16, value: 1 }], speed: 1, min: 1, max: 16, name: 'Steps', device: 'Arpeggiator' }]);
    srv.handleResolved(enc({ rid: lastProbe('resolve')[2], ok: 1, id: 500, name: 'Steps', device: 'Arpeggiator', devType: 4, path: ARP }));
    const b = outbox.filter(a => a[0] === 'voice' && (a[2] === 'bind' || a[2] === 'bindq'));
    assert(b.length === 1 && b[0][2] === 'bindq' && b[0][3] === 500, 'NOT live.remote~: the setter path, got ' + JSON.stringify(b));
    assert(!outbox.some(a => a[0] === 'probe' && a[1] === 'gesture'), 'no gesture verb: the LOM has NO undo-grouping call (begin_gesture does not exist - field 08-27)');
    const v = srv.state.voices[voiceOf(500)];
    assert(v.mode === 'c' && v.lane.norm.mode === 'c', 'voice + lane know the drive path');
    // the buffer written for it holds NATIVE 1..16 values (not 0..1)
    const wav = fs.readFileSync(voiceMsgs('replace')[voiceMsgs('replace').length - 1][3]);
    const n = (wav.length - 44) / 4;
    const vals = []; for (let i = 0; i < n; i++) vals.push(wav.readFloatLE(44 + i * 4));
    close(vals[0], 1, 1e-5, 'native min in the WAV'); close(vals[n - 1], 16, 0.4, 'native max in the WAV');
    assert(new Set(vals).size <= srv.CONTROL_STEPS + 1, 'rate-limited by quantization');
    outbox = [];
    srv.handleTransport('0');                      // STOP: stays hand-movable, nothing to release
    assert(!outbox.some(a => a[0] === 'voice'), 'the setter path never locks the knob, so a transport edge does nothing');
    srv.handleTransport('1');
    assert(!outbox.some(a => a[0] === 'voice'), 'and nothing on play either (the phasor is transport-locked already)');
    // a menu on the same device: stepped path, integers
    const ARP2 = 'live_set tracks 1 devices 0 parameters 6';
    push(c, [{ path: ARP, points: [{ time: 0, value: 0 }, { time: 16, value: 1 }], speed: 1, min: 1, max: 16, name: 'Steps', device: 'Arpeggiator' },
             { path: ARP2, points: [], speed: 1, min: 0, max: 5, is_quantized: 1, name: 'Style', device: 'Arpeggiator' }]);
    srv.handleResolved(enc({ rid: lastProbe('resolve')[2], ok: 1, id: 501, name: 'Style', device: 'Arpeggiator', devType: 4, path: ARP2 }));
    assert(srv.state.voices[voiceOf(501)].mode === 'q', 'menu on a MIDI effect stays stepped');
});

test('failed resolve with no name to search by: named report, never binds', () => {
    resetState();
    const [c] = connect(fakeClient());
    push(c, [{ path: P1, points: [], speed: 1 }]);
    resolveMiss(lastProbe('resolve')[2]);
    assert(!voiceMsgs('bind').length, 'no bind');
    const res = c.sent.find(m => m.type === 'live_bind_result');
    assert(res && res.ok === false && /removed/.test(res.message), 'failure surfaced: ' + (res && res.message));
});

test('removing a lane from the set releases its voice and unbinds the knob', () => {
    resetState();
    const [c] = connect(fakeClient());
    push(c, [{ path: P1, points: [], speed: 1 }, { path: P2, points: [], speed: 1 }]);
    const [r1, r2] = probes('resolve');
    resolveOk(r1[2], 11, '', '', P1); resolveOk(r2[2], 22, '', '', P2);
    assert(Object.keys(srv.lanesOf(c)).length === 2, 'two lanes');
    outbox = [];
    push(c, [{ path: P1, points: [], speed: 1 }]);
    assert(Object.keys(srv.lanesOf(c)).length === 1, 'one left');
    assert(voiceMsgs('unbind').length === 1, 'unbind emitted — the knob is released');
    assert(!voiceOf(22) && voiceOf(11), 'voice 22 freed, 11 kept');
});

test('PER-CLIENT removal: a second, lane-less instance cannot wipe the first one\'s voices', () => {
    resetState();
    const [a, b] = connect(fakeClient(), fakeClient());
    push(a, [{ path: P1, points: [], speed: 1 }]);
    resolveOk(lastProbe('resolve')[2], 77, '', '', P1);
    push(b, [] );
    assert(srv.lanesOf(a)[P1] && voiceOf(77), 'instance A\'s lane + voice survive instance B\'s empty push');
});

test('clear_all (the Discovery Pass lock-down) releases EVERY drive path, and only that window\'s', () => {
    // The processor sends this the moment driveAllowed goes false (pass never held on this
    // machine / entitlement withdrawn). Every knob this instance drives must come back to
    // Live, whichever path drives it - including the control-rate one added for MIDI effects.
    resetState();
    const [a, b] = connect(fakeClient(), fakeClient());
    push(a, [{ path: P1, points: [], speed: 1, name: 'Cutoff', device: 'Auto Filter' },
             { path: P2, points: [], speed: 1, is_quantized: 1, min: 0, max: 5, name: 'Style', device: 'Roar' },
             { path: 'live_set tracks 1 devices 0 parameters 5', points: [], speed: 1, min: 1, max: 16, name: 'Steps', device: 'Arpeggiator' }]);
    const rs = probes('resolve');
    srv.handleResolved(enc({ rid: rs[0][2], ok: 1, id: 601, name: 'Cutoff', device: 'Auto Filter', devType: 2, path: P1 }));
    srv.handleResolved(enc({ rid: rs[1][2], ok: 1, id: 602, name: 'Style', device: 'Roar', devType: 2, path: P2 }));
    srv.handleResolved(enc({ rid: rs[2][2], ok: 1, id: 603, name: 'Steps', device: 'Arpeggiator', devType: 4, path: 'live_set tracks 1 devices 0 parameters 5' }));
    const modes = [601, 602, 603].map(id => srv.state.voices[voiceOf(id)].mode);
    assert(JSON.stringify(modes) === '["r","q","c"]', 'one lane per drive path bound, got ' + JSON.stringify(modes));
    // a second window keeps its own lane through the first one's lock-down
    push(b, [{ path: 'live_set tracks 3 devices 0 parameters 1', points: [], speed: 1, name: 'Drive', device: 'Saturator' }]);
    srv.handleResolved(enc({ rid: lastProbe('resolve')[2], ok: 1, id: 700, name: 'Drive', device: 'Saturator', devType: 2, path: 'live_set tracks 3 devices 0 parameters 1' }));
    outbox = [];
    srv.handleClientMessage(a, { type: 'clear_all' });
    const released = voiceMsgs('unbind').length;
    assert(released === 3, 'all three knobs released (remote, menu, control), got ' + released);
    assert(!voiceOf(601) && !voiceOf(602) && !voiceOf(603), 'voices freed');
    assert(Object.keys(srv.lanesOf(a)).length === 0, 'the locked window holds no lanes');
    assert(voiceOf(700) && srv.state.voices[voiceOf(700)].owner === b, 'the OTHER window is untouched');
});

test('33rd lane is refused with a bridge_error naming the cap, first 32 keep working', () => {
    resetState();
    const [c] = connect(fakeClient());
    const lanes = [];
    for (let i = 0; i < 33; i++) lanes.push({ path: 'live_set tracks ' + i + ' devices 0 parameters 0', points: [], speed: 1 });
    push(c, lanes);
    probes('resolve').forEach((p, i) => resolveOk(p[2], 1000 + i, '', '', p[3]));
    let bound = 0; for (let n = 1; n <= 32; n++) if (srv.state.voices[n] && srv.state.voices[n].id) bound++;
    assert(bound === 32, 'exactly 32 bound, got ' + bound);
    assert(c.sent.some(m => m.type === 'bridge_error' && /32/.test(m.message)), 'refusal names the cap');
});

test('set_live_blob (headless push from the processor): the stored blob maps exactly like the shim push', () => {
    resetState();
    const [c] = connect(fakeClient());
    const blob = JSON.stringify({ v: 1, lanes: [
        { _live: true, livePath: ROAR1, liveName: 'Flt 3 Freq', liveDevice: '⚡ Roar', liveQuant: false, liveMin: 20, liveMax: 20000, liveLog: true,
          rangeOn: true, rangeMin: 0.25, rangeMax: 0.75, speed: 2, points: [{ time: 0, value: 0 }, { time: 16, value: 1 }] },
        { _live: true, livePath: P2, liveName: 'Style', liveDevice: 'Roar', liveQuant: true, liveMin: 0, liveMax: 5, points: [] },
        { livePath: null, points: [] },
    ] });
    srv.handleClientMessage(c, { type: 'set_live_blob', bars: 4, blob });
    const lanes = srv.lanesFromBlob(JSON.parse(blob));
    assert(lanes.length === 2, 'pathless lanes dropped');
    assert(lanes[0].device === 'Roar' && lanes[0].name === 'Flt 3 Freq' && lanes[0].is_log === 1 && lanes[0].speed === 2, 'identity + flags carried, legacy glyph stripped');
    close(lanes[0].points[0].value, 0.25, 1e-9, 'range baked: low');
    close(lanes[0].points[1].value, 0.75, 1e-9, 'range baked: high');
    assert(lanes[1].is_quantized === 1 && lanes[1].min === 0 && lanes[1].max === 5, 'menu lane keeps its native range');
    assert(probes('resolve').length === 2 && probes('resolve')[0][3] === ROAR1, 'both lanes take the normal resolve path');
    assert(c.sent.some(m => m.type === 'live_lanes_state' && m.lanes.length === 2), 'state reply like a normal push');
    srv.handleClientMessage(c, { type: 'set_live_blob', bars: 4, blob: '{not json' });
    assert(Object.keys(srv.lanesOf(c)).length === 0, 'garbage blob = empty push (lanes released, nothing crashes)');
});

test('map arm flow: STAYS armed across hits (map knob after knob), cancel ends it', () => {
    resetState();
    const [armer, other] = connect(fakeClient(), fakeClient());
    srv.handleClientMessage(armer, { type: 'map_live_start' });
    assert(probes('map_start').length === 1, 'probe armed');
    assert(armer.sent.some(m => m.type === 'map_live_armed'), 'armer acked');
    srv.handleMapped(enc({ name: 'Cutoff', device: 'Auto Filter', path: P1, id: 9, min: 20, max: 20000, is_quantized: 0, is_log: 1 }));
    assert(armer.sent.some(m => m.type === 'live_mapped' && m.name === 'Cutoff' && m.is_log === 1), 'mapped → armer');
    assert(!other.sent.some(m => m.type === 'live_mapped'), 'not the bystander');
    assert(srv.state.mapping === armer, 'still ARMED after the first hit');
    assert(probes('map_start').length === 2, 'observer re-armed for the next knob');
    srv.handleMapped(enc({ name: 'Resonance', device: 'Auto Filter', path: P2, id: 10, min: 0, max: 1, is_quantized: 0, is_log: 0 }));
    assert(armer.sent.filter(m => m.type === 'live_mapped').length === 2, 'second knob mapped in the same session');
    srv.handleClientMessage(armer, { type: 'map_live_cancel' });
    assert(srv.state.mapping === null, 'cancel disarms');
    assert(probes('map_cancel').length === 1, 'probe told to stand down');
    if (srv.state.mapTimer) { clearTimeout(srv.state.mapTimer); srv.state.mapTimer = null; }
});

console.log('\n— unit: lane identity (portable racks) —');

test('a name MISMATCH at the stored address never binds: it searches by name, a unique hit heals (owner only)', () => {
    resetState();
    const [c, other] = connect(fakeClient(), fakeClient());
    push(c, [LANE(P1, 'Style', 'Roar')]);
    resolveOk(lastProbe('resolve')[2], 999, 'Frequency', 'Auto Filter', P1);   // the rack moved: a stranger sits there now
    assert(!voiceMsgs('bind').length && !voiceMsgs('bindq').length, 'never binds a stranger\'s knob');
    const probe = lastProbe('find');
    assert(probe && decodeURIComponent(probe[3]) === 'Roar' && decodeURIComponent(probe[4]) === 'Style', 'searches by (device, param) name');
    const NEW = 'live_set tracks 7 devices 0 parameters 12';
    found(probe[2], [{ path: NEW, id: 777 }]);
    assert(voiceMsgs('bind').some(a => a[3] === 777), 'bound at the healed home');
    assert(!srv.lanesOf(c)[P1] && srv.lanesOf(c)[NEW], 'lane migrated to the new key');
    assert(voiceOf(777) && srv.state.voices[voiceOf(777)].lane === srv.lanesOf(c)[NEW], 'voice follows');
    assert(c.sent.some(m => m.type === 'live_lane_healed' && m.oldPath === P1 && m.newPath === NEW), 'client told to heal its blob');
    assert(!other.sent.some(m => m.type === 'live_lane_healed'), 'the OTHER window (same path text) is not rewritten');
});

test('zero or many free matches -> named report with the RELINK instruction, nothing bound', () => {
    resetState();
    const [c] = connect(fakeClient());
    push(c, [LANE(P1, 'Cutoff', 'Auto Filter')]);
    resolveMiss(lastProbe('resolve')[2]);
    found(lastProbe('find')[2], [{ path: 'a 1', id: 1 }, { path: 'b 2', id: 2 }, { path: 'c 3', id: 3 }]);
    const res = c.sent.find(m => m.type === 'live_bind_result' && m.ok === false);
    assert(res && /3 places/.test(res.message) && /MAP LIVE/.test(res.message), 'ambiguity named + the way out: ' + (res && res.message));
    assert(!voiceMsgs('bind').length, 'nothing bound');
    push(c, [LANE(P1, 'Cutoff', 'Auto Filter')]);
    assert(probes('resolve').length === 2, 'an ambiguous lane is retried on the next push');
});

test('RACK COPY, original window OPEN: the copy\'s stale address is a CONFLICT -> its free twin, original untouched', () => {
    resetState();
    const [a, b] = connect(fakeClient(), fakeClient());
    push(a, [LANE(ROAR1)]);
    resolveOk(lastProbe('resolve')[2], 100, 'Flt 3 Freq', 'Roar', ROAR1);
    assert(voiceOf(100) === 1, 'original bound on voice 1');
    // the copy carries the ORIGINAL's address (the field bug): it resolves to the same knob
    push(b, [LANE(ROAR1)]);
    resolveOk(lastProbe('resolve')[2], 100, 'Flt 3 Freq', 'Roar', ROAR1);
    assert(voiceMsgs('bind').length === 1, 'the copy never steals the original\'s knob');
    const fp = lastProbe('find');
    assert(fp, 'conflict -> search for a twin');
    found(fp[2], [{ path: ROAR1, id: 100 }, { path: ROAR2, id: 200 }]);
    assert(voiceOf(200) === 2 && srv.state.voices[2].owner === b, 'copy bound to the twin on its own voice');
    assert(srv.state.voices[1].id === 100 && srv.state.voices[1].owner === a, 'original untouched');
    assert(b.sent.some(m => m.type === 'live_lane_healed' && m.oldPath === ROAR1 && m.newPath === ROAR2), 'copy heals its address');
    assert(!a.sent.some(m => m.type === 'live_lane_healed'), 'original not rewritten');
    assert(srv.lanesOf(b)[ROAR2] && !srv.lanesOf(b)[ROAR1], 'copy\'s lane keyed by its new address');
});

test('RACK COPY, original window CLOSED, fresh selection on the new track -> twin under the selection; the orphan keeps playing', () => {
    resetState();
    const [a] = connect(fakeClient());
    push(a, [LANE(ROAR1)]);
    resolveOk(lastProbe('resolve')[2], 100, 'Flt 3 Freq', 'Roar', ROAR1);
    srv.handleDisconnect(a);
    assert(srv.state.voices[1].id === 100 && srv.state.voices[1].owner === null, 'orphan voice keeps its knob');
    // the user dropped the rack on track 6 (Live selects it), the copy's window opened
    srv.handleSel(enc({ track: 'live_set tracks 6', device: RACK2 }));
    const [b] = connect(fakeClient());
    push(b, [LANE(ROAR1)]);
    resolveOk(lastProbe('resolve')[2], 100, 'Flt 3 Freq', 'Roar', ROAR1);   // verified, but on track 5
    const fp = lastProbe('find');
    assert(fp, 'hint on another track -> suspect -> search');
    found(fp[2], [{ path: ROAR1, id: 100 }, { path: ROAR2, id: 200 }]);
    assert(voiceOf(200) && srv.state.voices[voiceOf(200)].owner === b, 'copy bound under the selected rack');
    assert(srv.state.voices[1].id === 100 && srv.state.voices[1].owner === null, 'the orphan still plays the original');
    assert(b.sent.some(m => m.type === 'live_lane_healed' && m.newPath === ROAR2), 'copy healed');
});

test('a STALE selection (older than the hint window) is ignored: the verified address stands', () => {
    resetState();
    srv.noteSel(RACK2, 'live_set tracks 6', Date.now() - srv.HINT_FRESH_MS - 5000);
    const [b] = connect(fakeClient());
    push(b, [LANE(ROAR1)]);
    resolveOk(lastProbe('resolve')[2], 100, 'Flt 3 Freq', 'Roar', ROAR1);
    assert(!lastProbe('find'), 'no search');
    assert(voiceOf(100) && srv.state.voices[voiceOf(100)].owner === b, 'bound at the address (set load with a restored selection must not re-home)');
});

test('hints apply to the FIRST push only: later edits never re-home a lane', () => {
    resetState();
    const [b] = connect(fakeClient());
    push(b, [LANE(ROAR1)]);
    resolveOk(lastProbe('resolve')[2], 100, 'Flt 3 Freq', 'Roar', ROAR1);
    srv.handleSel(enc({ track: 'live_set tracks 6', device: RACK2 }));
    push(b, [LANE(ROAR1), LANE(P2, 'Dry/Wet', 'Reverb')]);          // an edit that adds a lane elsewhere
    resolveOk(lastProbe('resolve')[2], 300, 'Dry/Wet', 'Reverb', P2);
    assert(!lastProbe('find'), 'fresh hint ignored after the first push');
    assert(voiceOf(300), 'new lane bound at its address');
});

test('hint with no twin under the selection: the verified address stands (fallback)', () => {
    resetState();
    srv.handleSel(enc({ track: 'live_set tracks 6', device: RACK2 }));
    const [b] = connect(fakeClient());
    push(b, [LANE(P2, 'Dry/Wet', 'Reverb')]);                       // a lane on a return-ish elsewhere, unique in the set
    resolveOk(lastProbe('resolve')[2], 300, 'Dry/Wet', 'Reverb', P2);
    found(lastProbe('find')[2], [{ path: P2, id: 300 }]);
    assert(voiceOf(300) && srv.state.voices[voiceOf(300)].owner === b, 'bound at the original address');
    assert(!b.sent.some(m => m.type === 'live_lane_healed'), 'no heal: nothing moved');
});

test('reopening the editor RECLAIMS its orphan voices by target (no new voice, no double modulation)', () => {
    resetState();
    const [a] = connect(fakeClient());
    push(a, [LANE(ROAR1)]);
    resolveOk(lastProbe('resolve')[2], 100, 'Flt 3 Freq', 'Roar', ROAR1);
    srv.handleDisconnect(a);
    const [a2] = connect(fakeClient());
    push(a2, [LANE(ROAR1)]);
    resolveOk(lastProbe('resolve')[2], 100, 'Flt 3 Freq', 'Roar', ROAR1);
    assert(voiceOf(100) === 1 && srv.state.voices[1].owner === a2, 'same voice, new owner');
    assert(!srv.state.voices[2], 'no second voice allocated');
    assert(a2.sent.some(m => m.type === 'live_bind_result' && m.ok), 'reopened window told it is bound');
});

test('an unbound lane dies with its socket; a bound one becomes an orphan', () => {
    resetState();
    const [a] = connect(fakeClient());
    push(a, [LANE(ROAR1), LANE(P2, 'Dry/Wet', 'Reverb')]);
    const [r1] = probes('resolve');
    resolveOk(r1[2], 100, 'Flt 3 Freq', 'Roar', ROAR1);            // P2 still resolving
    srv.handleDisconnect(a);
    assert(srv.state.voices[1] && srv.state.voices[1].owner === null, 'bound lane orphaned');
    const r2 = probes('resolve')[1];
    resolveOk(r2[2], 300, 'Dry/Wet', 'Reverb', P2);                  // late echo for the dead lane
    assert(!voiceOf(300), 'a late resolve for a dead lane binds nothing');
});

test('RELINK: armed device click moves every lane of that device NAME onto it, forced, displaced window told', () => {
    resetState();
    const [a, b] = connect(fakeClient(), fakeClient());
    // b legitimately drives Roar #2 (track 6); a has two Roar lanes stuck ambiguous
    push(b, [LANE(ROAR2)]);
    resolveOk(lastProbe('resolve')[2], 200, 'Flt 3 Freq', 'Roar', ROAR2);
    push(a, [LANE(ROAR1, 'Flt 3 Freq'), LANE('live_set tracks 5 devices 0 chains 0 devices 1 parameters 47', 'Fb Amt')]);
    probes('resolve').slice(1).forEach(p => resolveMiss(p[2]));
    probes('find').forEach(p => found(p[2], [{ path: 'x 1', id: 1 }, { path: 'y 2', id: 2 }]));
    assert(a.sent.filter(m => m.type === 'live_bind_result' && !m.ok).length === 2, 'both ambiguous');
    // the user presses MAP LIVE in window a and clicks Roar #2's title bar
    srv.handleClientMessage(a, { type: 'map_live_start' });
    srv.handleTouchedDev(enc({ path: 'live_set tracks 6 devices 0 chains 0 devices 1', name: 'Roar' }));
    const rp = lastProbe('relink');
    assert(rp && decodeURIComponent(rp[3]) === 'live_set tracks 6 devices 0 chains 0 devices 1', 'relink probe for THAT device');
    const names = JSON.parse(decodeURIComponent(rp[4]));
    assert(names.length === 2 && names.indexOf('Fb Amt') >= 0, 'asks for the lane names of that device');
    srv.handleRelinked(enc({ rid: rp[2], items: [
        { name: 'Flt 3 Freq', id: 200, path: ROAR2 },
        { name: 'Fb Amt', id: 201, path: 'live_set tracks 6 devices 0 chains 0 devices 1 parameters 47' },
    ] }));
    assert(voiceOf(200) && srv.state.voices[voiceOf(200)].owner === a, 'a now drives Flt 3 Freq on Roar #2 (forced)');
    assert(voiceOf(201) && srv.state.voices[voiceOf(201)].owner === a, 'a drives Fb Amt on Roar #2');
    assert(b.sent.some(m => m.type === 'live_bind_result' && !m.ok && /another Stride window/.test(m.message)), 'b told it lost the knob');
    assert(a.sent.some(m => m.type === 'live_relinked' && m.count === 2 && m.device === 'Roar'), 'a gets the summary');
    assert(a.sent.filter(m => m.type === 'live_lane_healed').length === 2, 'both addresses healed');
    assert(srv.state.mapping === a, 'still armed');
    if (srv.state.mapTimer) { clearTimeout(srv.state.mapTimer); srv.state.mapTimer = null; }
});

test('REPATH sweep: a bound id whose address moved heals the owner; an id that left the set releases + tells', () => {
    resetState();
    const [a] = connect(fakeClient());
    push(a, [LANE(P1), LANE(P2, 'Dry/Wet', 'Reverb')]);
    const [r1, r2] = probes('resolve');
    resolveOk(r1[2], 100, 'Flt 3 Freq', 'Roar', P1); resolveOk(r2[2], 300, 'Dry/Wet', 'Reverb', P2);
    srv.tick(Date.now());
    const rp = lastProbe('repath');
    assert(rp && rp.slice(3).indexOf(100) >= 0 && rp.slice(3).indexOf(300) >= 0, 'sweep asks for every bound id');
    assert(probes('repath').length === 1 && (srv.tick(Date.now()), probes('repath').length === 1), 'one sweep in flight at a time');
    srv.handleRepathed(enc({ rid: rp[2], items: [{ id: 100, ok: 1, path: ROAR1 }, { id: 300, ok: 0, path: '' }] }));
    assert(srv.lanesOf(a)[ROAR1] && !srv.lanesOf(a)[P1], 'grouped in-session: key migrated');
    assert(a.sent.some(m => m.type === 'live_lane_healed' && m.oldPath === P1 && m.newPath === ROAR1), 'owner rewrites its blob');
    assert(!voiceOf(300), 'deleted device: voice released');
    assert(a.sent.some(m => m.type === 'live_bind_result' && !m.ok && /left the set/.test(m.message)), 'told');
});

test('LIVENESS: a silent patcher (leaked node process) yields the port; a pong resumes', () => {
    resetState();
    const calls = [];
    srv.listeners.push({ stop: () => calls.push('stop'), start: () => calls.push('start') });
    const [a] = connect(fakeClient());
    push(a, [LANE(P1)]);
    resolveOk(lastProbe('resolve')[2], 100, 'Flt 3 Freq', 'Roar', P1);
    const t0 = Date.now();
    srv.handlePong();
    srv.tick(t0 + 1000);
    assert(!srv.state.yielded, 'answering patcher: nothing happens');
    srv.state.pongAt = t0 - srv.PONG_TIMEOUT_MS - 1;
    outbox = [];
    srv.tick(t0);
    assert(srv.state.yielded && calls.indexOf('stop') >= 0, 'yielded: listeners stopped');
    assert(voiceMsgs('unbind').length === 1 && !srv.state.voices[1], 'knobs released, bank cleared');
    assert(srv.state.clients.size === 0, 'clients dropped (they reconnect to the standby)');
    srv.handlePong();
    assert(!srv.state.yielded && calls.indexOf('start') >= 0, 'pong resumes: re-listening');
    assert(outbox.some(a2 => a2[0] === 'status' && a2[1] === 'set'), 'face readout updated');
});

test('stop-to-find: transport stop releases continuous binds, play re-applies; menus untouched', () => {
    resetState();
    const [c] = connect(fakeClient());
    push(c, [{ path: P1, points: [], speed: 1 }, { path: P2, points: [], speed: 1, is_quantized: 1 }]);
    const [r1, r2] = probes('resolve');
    resolveOk(r1[2], 111, '', '', P1); resolveOk(r2[2], 222, '', '', P2);
    outbox = [];
    srv.handleTransport('0');                       // STOP
    const stops = outbox.filter(a => a[0] === 'voice');
    assert(stops.length === 1 && stops[0][1] === voiceOf(111) && stops[0][2] === 'unbind', 'only the continuous voice released: ' + JSON.stringify(stops));
    assert(srv.state.voices[voiceOf(111)].id === 111, 'target survives the suspension');
    outbox = [];
    srv.handleTransport('1');                       // PLAY
    const starts = outbox.filter(a => a[0] === 'voice');
    assert(starts.length === 1 && starts[0][2] === 'bind' && starts[0][3] === 111, 're-bound with the kept id');
    srv.handleTransport('1');                       // duplicate edge: no churn
    assert(outbox.filter(a => a[0] === 'voice').length === 1, 'edge-triggered, not level-spammed');
});

test('stop-to-find: a resolve that lands while STOPPED defers its bind to the play edge', () => {
    resetState();
    srv.state.playing = false;
    const [c] = connect(fakeClient());
    push(c, [{ path: P1, points: [], speed: 1 }]);
    resolveOk(lastProbe('resolve')[2], 333, '', '', P1);
    assert(!voiceMsgs('bind').length, 'no bind while stopped');
    srv.handleTransport('1');
    assert(voiceMsgs('bind').some(a => a[3] === 333), 'applied on play');
    srv.state.playing = true;   // restore for later tests
});

test('device-click relay: touched_dev broadcasts live_touched_dev AND records the selection hint', () => {
    resetState();
    const [a] = connect(fakeClient());
    srv.handleTouchedDev(enc({ path: 'live_set tracks 0 devices 1', name: 'Roar' }));
    assert(a.sent.some(m => m.type === 'live_touched_dev' && m.name === 'Roar'), 'broadcast');
    const h = srv.freshHint();
    assert(h && h.device === 'live_set tracks 0 devices 1' && h.track === 'live_set tracks 0', 'hint recorded');
    assert(!lastProbe('relink'), 'not armed: no relink');
});

test('touched relay: an Ableton knob click broadcasts live_touched to every client', () => {
    resetState();
    const [a, b] = connect(fakeClient(), fakeClient());
    srv.handleTouched(enc({ path: P1, name: 'Cutoff' }));
    assert(a.sent.some(m => m.type === 'live_touched' && m.path === P1), 'client A flashed');
    assert(b.sent.some(m => m.type === 'live_touched'), 'client B too (each matches its own lanes)');
    srv.handleTouched('%%%not-json');
    assert(a.sent.filter(m => m.type === 'live_touched').length === 1, 'garbage ignored');
});

console.log('\n— struct: patchers —');

function loadPatcher(f) {
    const d = JSON.parse(fs.readFileSync(path.join(BRIDGE, f), 'utf8'));
    const boxes = {}; d.patcher.boxes.forEach(b => boxes[b.box.id] = b.box);
    return { d, boxes, lines: d.patcher.lines.map(l => l.patchline) };
}

test('StrideBridge.maxpat: 32 INLINE voices, literal buffers, fully wired (no abstractions)', () => {
    const { boxes, lines } = loadPatcher('StrideBridge.maxpat');
    const texts = Object.values(boxes).map(b => b.text || '');
    assert(texts.some(t => /node\.script bridge-server\.js/.test(t)), 'node.script');
    assert(texts.some(t => /js bridge_max\.js/.test(t)), 'LiveAPI js');
    assert(texts.some(t => t === 'live.thisdevice'), 'observer init waits for the Live API (live.thisdevice)');
    // the rig lesson: abstraction voices collapsed onto one buffer (four verified-distinct
    // WAVs, one movement). Inline voices with literal names leave Max nothing to resolve.
    assert(!texts.some(t => /^stride_voice/.test(t)), 'NO abstraction refs');
    assert(texts.filter(t => t === 'live.remote~').length === 32, '32 live.remote~');
    const bufs = new Set(texts.filter(t => /^buffer~ sb_buf_\d+ /.test(t)).map(t => t.split(' ')[1]));
    assert(bufs.size === 32, '32 DISTINCT literal buffer names, got ' + bufs.size);
    const waves = new Set(texts.filter(t => /^wave~ sb_buf_\d+$/.test(t)).map(t => t.split(' ')[1]));
    assert(waves.size === 32, 'each wave~ reads its own buffer');
    bufs.forEach(b => assert(waves.has(b), 'wave~ pairs with ' + b));
    assert(texts.filter(t => t === 'live.object').length === 32, '32 stepped setters (menus)');
    assert(texts.filter(t => t === 'snapshot~ ' + srv.SNAPSHOT_MS).length === 32, '32 transport-locked samplers at the rate the server assumes (the live.object write rate = the freeze guard)');
    assert(texts.filter(t => /route replace rate bind unbind bindq/.test(t)).length === 32, 'six-way voice routes');
    assert(texts.some(t => t === 'route voice probe status'), 'top route carries the face readout verb');
    // the branded face: Live shows presentation, and it must be Stride, not Max-grey
    const pres = Object.values(boxes).filter(b => b.presentation === 1);
    assert(pres.some(b => b.maxclass === 'panel'), 'face ground panel');
    assert(pres.some(b => b.fontname === 'Outfit' && b.text === 'STRIDE'), 'STRIDE in Outfit');
    assert(boxes['obj-face-st'] && boxes['obj-face-st'].presentation === 1, 'ACTIVE/STANDBY on the face');
    assert(!boxes['obj-face-n'], 'NO lane count on the face (removed 2026-08-27)');
    const has = (src, so, dst, di) => lines.some(l => l.source[0] === src && l.source[1] === so && l.destination[0] === dst && l.destination[1] === di);
    assert(has('obj-6', 2, 'obj-face-st', 0), 'readout wired from the route');
    assert(has('obj-6', 3, 'obj-8', 0), 'the unmatched outlet still lands on the debug print');
    // re-click finder: the selection observer is change-driven, so a second click on the
    // same knob needs the mouse itself -> mousestate -> "mdown x y" -> js
    assert(boxes['obj-ms'] && boxes['obj-ms'].text === 'mousestate', 'mousestate present');
    assert(boxes['obj-ms-init'].text === 'mode 0, poll' && has('obj-11', 0, 'obj-ms-init', 0) && has('obj-ms-init', 0, 'obj-ms', 0), 'polling starts with the device (screen coordinates)');
    assert(has('obj-ms', 0, 'obj-ms-sel', 0) && has('obj-ms', 1, 'obj-ms-x', 1) && has('obj-ms', 2, 'obj-ms-y', 1), 'button -> sel, x/y stored cold');
    assert(has('obj-ms-t', 1, 'obj-ms-y', 0) && has('obj-ms-t', 0, 'obj-ms-x', 0) && has('obj-ms-y', 0, 'obj-ms-pack', 1) && has('obj-ms-x', 0, 'obj-ms-pack', 0), 'y then x into pack (hot inlet last)');
    assert(boxes['obj-ms-pre'].text === 'prepend mdown' && has('obj-ms-pack', 0, 'obj-ms-pre', 0) && has('obj-ms-pre', 0, 'obj-7', 0), 'mdown reaches the js');
    for (let i = 1; i <= 32; i++) {
        assert(has('obj-9', i - 1, 'v' + i + '-route', 0), 'fan-out to voice ' + i);
        assert(has('v' + i + '-phasor', 0, 'v' + i + '-rate', 0), 'phasor→rate v' + i);
        assert(has('v' + i + '-rate', 0, 'v' + i + '-wave', 0), 'rate→wave v' + i);
        assert(has('v' + i + '-wave', 0, 'v' + i + '-remote', 0), 'wave→remote v' + i);
        assert(has('v' + i + '-bind', 0, 'v' + i + '-remote', 1), 'bind→remote v' + i);
        assert(has('v' + i + '-unbind', 0, 'v' + i + '-remote', 1), 'unbind releases v' + i);
    }
    // audio passthrough - a Max Audio Effect WITHOUT plugin~ -> plugout~ EATS its
    // track's audio (field report: bridge on = hosted Serum silent)
    assert(texts.some(t => t === 'plugin~') && texts.some(t => t === 'plugout~'), 'passthrough objects');
    assert(has('obj-in', 0, 'obj-out', 0) && has('obj-in', 1, 'obj-out', 1), 'stereo passthrough wired');
    const ids = new Set(Object.keys(boxes));
    lines.forEach(l => assert(ids.has(l.source[0]) && ids.has(l.destination[0]), 'no dangling lines'));
});

test('bridge_max.js: every verb the server emits has a handler, hints are gesture-only', () => {
    const js = fs.readFileSync(path.join(BRIDGE, 'bridge_max.js'), 'utf8');
    for (const fn of ['init', 'map_start', 'map_cancel', 'resolve', 'find', 'relink', 'repath', 'ping'])
        assert(new RegExp('function ' + fn + '\\(').test(js), 'verb ' + fn);
    for (const out of ['"mapped"', '"resolved"', '"found"', '"relinked"', '"repathed"', '"pong"', '"touched"', '"touched_dev"', '"transport"', '"sel"'])
        assert(js.indexOf('outlet(0, ' + out) >= 0, 'emits ' + out);
    assert(/_skipTrack/.test(js) && /_hintDevEcho/.test(js), 'init echoes are filtered out of the selection hint');
    assert(/function mdown\(x, y\)/.test(js) && /function _checkReclick\(\)/.test(js), 're-click finder verbs');
    // the arm must never trust an observer that may have gone deaf (field 2026-08-27:
    // mapping died mid-session and only a device reload brought it back)
    assert(/function map_start\(\)[\s\S]{0,200}_rearmObserver\(\)/.test(js), 'arming REBUILDS the selection observer');
    assert(/_skipFirstTask[\s\S]{0,200}schedule\(250\)/.test(js), 'a missing attach echo cannot eat the next real click');
    assert(/function ping\(\)[\s\S]{0,400}rebuilding/.test(js), 'ping watchdog rebuilds a lost observer');
    assert(!/begin_gesture|end_gesture/.test(js), 'NO gesture calls: they do not exist in the LOM and Live logs a Python error per call (field 08-27)');
    assert(/out\.devType = di\.type/.test(js) && /devType: dt/.test(js) && /dev_type: dev\.type/.test(js), 'device TYPE travels with resolve, find, relink and map (MIDI effects take the setter path)');
    assert(/again: 1/.test(js) && /RECLICK_PX/.test(js), 're-click re-emits touched/touched_dev within a knob width');
    assert(/if \(_armed\) return;\s+\/\/ the mapping flow owns clicks while armed/.test(js), 'no re-click flashes while MAP LIVE is armed');
    assert(/_stampTouch\(_touchP, parseInt\(p\.id, 10\)\)/.test(js) && /_stampTouch\(_touchD, parseInt\(d\.id, 10\)\)/.test(js), 'every flash records where it was clicked');
    assert(/new LiveAPI\("id " \+ id\)/.test(js), 'repath resolves by id');
    assert(!/\bconst\b|\blet\b|=>/.test(js), 'ES5 only (Max js)');
});

console.log('\n— struct: VST side —');

const shim = fs.readFileSync(path.join(ROOT, '..', 'stride-wrapper', 'm0-spike', 'ui', 'shim.js'), 'utf8');
const canvas = fs.readFileSync(path.join(ROOT, 'app', 'renderer', 'canvas.js'), 'utf8');
const proc = fs.readFileSync(path.join(ROOT, '..', 'stride-wrapper', 'm0-spike', 'src', 'PluginProcessor.cpp'), 'utf8');
const procH = fs.readFileSync(path.join(ROOT, '..', 'stride-wrapper', 'm0-spike', 'src', 'PluginProcessor.h'), 'utf8');
const editor = fs.readFileSync(path.join(ROOT, '..', 'stride-wrapper', 'm0-spike', 'src', 'PluginEditor.cpp'), 'utf8');

test('shim: native-pipe transport (NO page-side socket - WebView2 blocks localhost)', () => {
    assert(!/new WebSocket/.test(shim), 'page must NOT open sockets: WebView2 Local Network Access blocks them');
    assert(/type: 'bridge_send'/.test(shim), 'outbound rides sl_send');
    assert(/listen\('bridgeMsg'/.test(shim), 'inbound rides bridgeMsg');
    assert(/listen\('bridgeState'/.test(shim), 'presence rides bridgeState');
    assert(/bridge_hello/.test(shim), 'hello on link-up');
    assert(/_liveLanes = \(state \|\| \[\]\)\.filter\(function \(l\) \{ return l && l\._live; \}\)/.test(shim), 'live split');
    assert(/_hostedLanes\.map\(/.test(shim), 'live_curves now maps HOSTED lanes only');
    assert(/set_bridge_lanes/.test(shim), 'persistence blob emit');
    assert(/set_live_lanes/.test(shim), 'curve push');
    assert(/sd-maplive-btn/.test(shim), 'MAP LIVE button');
    assert(/listen\('bridgeLanes'/.test(shim), 'adopt listener');
    assert(/live_touched/.test(shim), 'lane-finder routed');
    assert(/t === 'live_relinked'/.test(shim) && /sdBridgeRelinked/.test(shim), 'relink summary routed');
    const ui = shim.slice(shim.indexOf('function _sbSetMapUi'), shim.indexOf('window.sdBridgeMapToggle'));
    assert(/className = armed \? BTN_MAP_ARMED : BTN_MAP/.test(ui), 'armed Map Live = the hosted Map button\'s yellow pulse (same class)');
    assert(/name: l\.liveName \|\| ''/.test(shim) && /device: \(l\.liveDevice \|\| ''\)/.test(shim), 'push carries names (identity check needs them)');
});

const editorH = fs.readFileSync(path.join(ROOT, '..', 'stride-wrapper', 'm0-spike', 'src', 'PluginEditor.h'), 'utf8');
const linkH = fs.readFileSync(path.join(ROOT, '..', 'stride-wrapper', 'm0-spike', 'src', 'BridgeLink.h'), 'utf8');

test('C++: BridgeLink is PROCESSOR-owned (:9102): stored lanes reach the bridge on state restore, window or not', () => {
    assert(/class BridgeLink : private juce::Thread/.test(linkH) && !/class BridgeLink/.test(editor), 'class lives in BridgeLink.h, not the editor');
    assert(/connect \("127\.0\.0\.1", 9102/.test(linkH), 'TCP 9102');
    assert(/String framed = line \+ "\\n";/.test(linkH), 'outgoing frames are newline-terminated');
    assert(/std::unique_ptr<BridgeLink> bridgeLink;/.test(procH) && !/bridgeLink/.test(editorH) && !/bridgeLink/.test(editor), 'owned by the processor only');
    assert(/#include "BridgeLink\.h"/.test(proc), 'processor includes the link');
    assert(/bridgeLink\.reset\(\);\s+\/\/ socket thread down FIRST/.test(proc), 'processor tears the thread down first (the Bitwig lesson)');
    assert(/self->ensureBridgeLink\(\);\s+self->pushBridgeBlob\(\);/.test(proc), 'setState pushes the stored lanes (the first-open report)');
    assert(/if \(on\) pushBridgeBlob\(\);/.test(proc), 'link up-edge pushes too (fresh bridge after takeover)');
    assert(/"set_live_blob"/.test(proc) && /roundToInt \(driveClipBeats \/ 4\.0\)/.test(proc), 'headless push = set_live_blob with the canvas bar count');
    assert(/live_lane_healed/.test(proc) && /applyBridgeHeal/.test(proc), 'heals rewrite the stored blob with no window open');
    assert(/WeakReference<StrideWrapperProcessor> wr \(this\);/.test(proc.slice(proc.indexOf('::ensureBridgeLink'))), 'callbacks hold a WeakReference, never raw this');
    assert(/proc\.setBridgeSinks \(nullptr, nullptr\);\s+\/\/ unhook FIRST/.test(editor), 'editor unhooks before its WebView dies');
    assert(/proc\.ensureBridgeLink\(\);\s+proc\.setBridgeSinks \(/.test(editor), 'editor subscribes');
    assert(/proc\.bridgeSend \(/.test(editor) && /type == "bridge_send"/.test(editor), 'outbound rides the processor link');
    assert(/emitEventIfBrowserIsVisible \("bridgeMsg"/.test(editor), 'inbound event');
    assert(/emitEventIfBrowserIsVisible \("bridgeState"/.test(editor), 'presence event');
    assert(/proc\.bridgeIsUp\(\)/.test(editor), 'presence gate reads the processor link');
});

test('C++: the Discovery Pass lock covers the bridge lanes exactly like hosted lanes (2.0.1)', () => {
    // expired pass: no new maps / curve pushes from the page (native gate, not the overlay)
    assert(/type == "bridge_send"\)\s*\{\s*if \(proc\.isEditLocked\(\)\) return;/.test(editor), 'bridge_send gated on editLocked');
    assert(/type == "set_bridge_lanes"\)\s*\{\s*proc\.bridgeLanesJson =/.test(editor), 'persistence of the blob stays UNgated (lanes are never lost)');
    // never-passed machine: hosted curves stay silent, so must the Ableton lanes
    const pb = proc.slice(proc.indexOf('void StrideWrapperProcessor::pushBridgeBlob()'));
    assert(/^[\s\S]{0,300}if \(! driveAllowed\.load\(\)\) return;/.test(pb), 'headless push follows driveAllowed');
    const sd = proc.slice(proc.indexOf('void StrideWrapperProcessor::setDriveAllowed (bool b)'));
    assert(/^[\s\S]{0,700}clear_all/.test(sd) && /^[\s\S]{0,700}pushBridgeBlob\(\)/.test(sd), 'entitlement edge: down releases the knobs, up pushes the lanes');
    assert(!/void setDriveAllowed \(bool b\) \{ driveAllowed\.store \(b\); \}/.test(procH), 'the inline setter is gone (edge logic lives in the .cpp)');
});

test('TCP transport: newline framing survives chunked delivery, listening flips the face to ACTIVE', async () => {
    resetState();
    const net = require('net');
    const TEST_PORT = 9199;   // never the real :9102 - a live rig may be running
    const tcp = srv.startTcpServer(net, TEST_PORT);
    await new Promise(r => setTimeout(r, 150));
    assert(tcp.server, 'tcp listener up on ' + TEST_PORT);
    assert(outbox.some(a => a[0] === 'status' && a[1] === 'set' && a[2] === 'ACTIVE'), 'face reads ACTIVE once the port is owned');
    const replies = [];
    const sock = net.connect(TEST_PORT, '127.0.0.1');
    await new Promise(res => sock.on('connect', res));
    let rbuf = '';
    sock.on('data', c => {
        rbuf += c.toString();
        let nl; while ((nl = rbuf.indexOf(String.fromCharCode(10))) >= 0) {
            replies.push(JSON.parse(rbuf.slice(0, nl))); rbuf = rbuf.slice(nl + 1);
        }
    });
    // hello split across two TCP writes mid-JSON: framing must reassemble it
    const line = JSON.stringify({ type: 'bridge_hello', version: 1 }) + String.fromCharCode(10);
    sock.write(line.slice(0, 9));
    await new Promise(r => setTimeout(r, 40));
    sock.write(line.slice(9));
    await new Promise(r => setTimeout(r, 250));
    assert(replies.some(m => m.type === 'bridge_ready' && m.voices === 32), 'ready reply framed back: ' + JSON.stringify(replies));
    assert(srv.state.clients.size === 1, 'client registered');
    sock.destroy();
    await new Promise(r => setTimeout(r, 100));
    assert(srv.state.clients.size === 0, 'socket close = disconnect bookkeeping');
    tcp.stop();
    await new Promise(r => setTimeout(r, 100));
    assert(!tcp.server, 'stop() releases the port (the liveness yield path)');
});

test('shim: range is baked into the bridge push (bridge only ever sees final 0..1)', () => {
    const i = shim.indexOf('function _sbPush');
    assert(i > 0 && /rangeMin \+ pt\.value \* \(l\.rangeMax - l\.rangeMin\)/.test(shim.slice(i, i + 900)), 'bake in _sbPush');
});

test('canvas: map/adopt/unmap/relink entry points, bridge-composed status lines, no em dashes in bridge copy', () => {
    assert(/window\.sdBridgeMapped = function/.test(canvas), 'sdBridgeMapped');
    assert(/window\.sdBridgeAdoptLanes = function/.test(canvas), 'sdBridgeAdoptLanes');
    assert(/window\.sdBridgeBindResult = function/.test(canvas), 'sdBridgeBindResult');
    assert(/window\.sdBridgeRelinked = function/.test(canvas), 'sdBridgeRelinked');
    assert(/if \(m\.message\) \{ _sdBridgeStatus\(m\.message\); return; \}/.test(canvas), 'bridge-composed report shown verbatim');
    assert(/window\.sdBridgeTouched = function/.test(canvas), 'sdBridgeTouched (the lane-finder)');
    assert(/function _sdTouchGlowLane/.test(canvas), 'ONE glow doorway shared by hosted + live touches');
    assert(/window\.sdBridgeTouchedDev = function/.test(canvas), 'device-level finder (bound knobs swallow clicks)');
    assert(/window\.sdBridgeHealed = function/.test(canvas), 'heal adoption (portable racks)');
    assert(/is_quantized/.test(canvas), 'quantized handling');
    assert(/id: -1,\s+\/\/ NEVER a hosted position/.test(canvas), 'live lanes carry id -1');
    const i = canvas.indexOf('// ── StrideBridge: Ableton\'s own devices as lanes');
    const seg = canvas.slice(i, canvas.indexOf('// ── Per-param RANGE', i));
    assert(i > 0 && seg.length > 1000 && seg.indexOf('\u2014') < 0, 'no em dashes in the bridge status copy');
});

test('canvas: live lanes survive every rebuild site', () => {
    assert(/_keepLive = sdCanvasParams\.filter\(p => p\._live\)/.test(canvas), 'loadParamsDirectly keep');
    assert(/_keepLiveOnPick/.test(canvas), 'param-pick keep');
    assert(/sdCanvasParams\.filter\(p => p\._live\);\s+\/\/ a rack switch never clears StrideBridge lanes/.test(canvas), 'empty-rack clear keeps live lanes');
    assert(/\|\| p\._live\)\s+\/\/ a StrideBridge lane is meaningful/.test(canvas), 'save filter includes empty live lanes');
});

test('canvas: unmapping a live lane never renumbers hosted positions', () => {
    const i = canvas.indexOf('window.sdUnmapLane = function');
    const seg = canvas.slice(i, i + 1200);
    assert(/if \(p\._live\)/.test(seg), 'live branch exists');
    assert(seg.indexOf('if (p._live)') < seg.indexOf('_sdRemoveLaneByPos(p.id, true)'), 'live branch runs BEFORE the positional remove');
});

test('C++: v10 "bl" blob rides getState/setState and reaches the shim', () => {
    assert(/setAttribute \("version", 10\)/.test(proc), 'state v10');
    assert(/setAttribute \("bl", bridgeLanesJson\)/.test(proc), 'save');
    assert(/getStringAttribute \("bl", ""\)/.test(proc), 'load');
    assert(/bridgeLanesJson = newBridgeLanes/.test(proc), 'applied on the message thread');
    assert(/juce::String bridgeLanesJson/.test(procH), 'member');
    assert(/type == "set_bridge_lanes"/.test(editor), 'store handler');
    assert(/pushBridgeLanes\(\)/.test(editor), 'pushed on wrapperReady');
    assert(/emitEventIfBrowserIsVisible \("bridgeLanes"/.test(editor), 'event name matches the shim listener');
});

test('shipping: repo StrideBridge.amxd matches the generated patcher (no stale device in the zip)', () => {
    const raw = fs.readFileSync(path.join(BRIDGE, 'StrideBridge.amxd'));
    assert(raw.slice(0, 4).toString('ascii') === 'ampf' && raw.slice(24, 28).toString('ascii') === 'ptch', 'ampf container');
    const size = raw.readUInt32LE(28);
    const js = raw.slice(32, 32 + size).toString('utf8');
    const amxd = JSON.parse(js.slice(0, js.lastIndexOf('}') + 1));
    const pat = JSON.parse(fs.readFileSync(path.join(BRIDGE, 'StrideBridge.maxpat'), 'utf8'));
    const sig = d => JSON.stringify({
        boxes: d.patcher.boxes.map(b => [b.box.id, b.box.maxclass, b.box.text || '']).sort(),
        lines: d.patcher.lines.map(l => [l.patchline.source, l.patchline.destination]).sort(),
    });
    assert(sig(amxd) === sig(pat), 'repo .amxd drifted from the generator - re-patch + re-copy it');
});

test('shipping: every file the zip stages exists in m4l-bridge/, docs carry the rack + relink story', () => {
    for (const f of ['StrideBridge.amxd', 'bridge-server.js', 'bridge_max.js',
                     'rasterizer.js', 'log-scaling.js', 'README-StrideBridge.txt'])
        assert(fs.existsSync(path.join(BRIDGE, f)), f + ' missing');
    assert(fs.existsSync(path.join(ROOT, '..', 'docs', '_fonts', 'Outfit.ttf')), 'Outfit.ttf');
    const wf = fs.readFileSync(path.join(ROOT, '..', '.github', 'workflows', 'build-vst3.yml'), 'utf8');
    assert(/StrideBridge\.amxd bridge-server\.js bridge_max\.js rasterizer\.js log-scaling\.js/.test(wf), 'windows stage list');
    const mac = fs.readFileSync(path.join(ROOT, '..', 'stride-wrapper', 'm0-spike', 'ci', 'build-mac-vst3.sh'), 'utf8');
    assert(/StrideBridge\.amxd bridge-server\.js/.test(mac), 'mac stage list');
    const readme = fs.readFileSync(path.join(BRIDGE, 'README-StrideBridge.txt'), 'utf8');
    assert(/ACTIVE or STANDBY/.test(readme) && /click the title bar of the one/.test(readme), 'README: standby face + relink');
    assert(readme.indexOf('\u2014') < 0, 'README: no em dashes');
    const guide = fs.readFileSync(path.join(ROOT, '..', 'stride-wrapper', 'm0-spike', 'ui', 'index.html'), 'utf8');
    assert(/click the title bar of the one you mean/.test(guide), 'in-app guide: relink');
});

test('sync rule: bridge rasterizer copy matches shared/ (canvas parity contract)', () => {
    const strip = t => t.replace(/^\/\/ SYNCED COPY[^\n]*\n/, '');
    const a = strip(fs.readFileSync(path.join(BRIDGE, 'rasterizer.js'), 'utf8'));
    const b = fs.readFileSync(path.join(ROOT, 'shared', 'rasterizer.js'), 'utf8');
    assert(a === b, 'rasterizer.js drifted from shared/ — re-copy');
    const c = strip(fs.readFileSync(path.join(BRIDGE, 'log-scaling.js'), 'utf8'));
    const d = fs.readFileSync(path.join(ROOT, 'shared', 'log-scaling.js'), 'utf8');
    assert(c === d, 'log-scaling.js drifted from shared/ — re-copy');
});

Promise.all(_asyncQueue).then(() => {
    console.log(`\n${passed} passed, ${failed} failed\n`);
    process.exit(failed);
});
