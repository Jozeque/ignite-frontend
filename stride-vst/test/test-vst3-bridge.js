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
    if (srv.state.armTimer) { clearTimeout(srv.state.armTimer); srv.state.armTimer = null; }
    srv.state.bootAt = Date.now();
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

test('remote~ lanes render NATIVE ranges: the pitch case that exposed the 0..1 era', () => {
    // Field 2026-08-27: a formant-mode cutoff is PITCH, -24..24 st, and the knob moved
    // between 0 and 1 semitone. live.remote~ does not normalize; it wants native values.
    const pitch = srv.rasterizeLane({ bars: 2, min: -24, max: 24, points: [{ time: 0, value: 0 }, { time: 8, value: 1 }] });
    close(pitch[0], -24, 1e-4, 'starts at native min');
    close(pitch[pitch.length - 1], 24, 0.5, 'ends at native max: the full sweep, not one semitone');
    close(pitch[pitch.length >> 1], 0, 0.5, 'midpoint of the curve = middle of the range');
});

test('NO-REGRESSION: a native-0..1 param renders byte-identically to the 0..1 era (every field-validated lane)', () => {
    // Roar's knobs and filter freqs all report native min 0 max 1 (verified in the saved
    // rack), which is exactly why "normalized" survived so long. min<=0 also disarms the
    // log flag (shouldUseLog), so Roar's is_log freqs cannot get double-scaled.
    const pts = [{ time: 0, value: 0.3, curve: 0.4 }, { time: 4, value: 0.9 }, { time: 8, value: 0.1 }];
    const before = srv.rasterizeLane({ bars: 2, points: pts });                                  // the old behavior (no range known)
    const after = srv.rasterizeLane({ bars: 2, points: pts, min: 0, max: 1, is_log: 1, name: 'Flt 3 Freq' });
    for (let i = 0; i < before.length; i++) if (before[i] !== after[i]) throw new Error('diverged at ' + i);
});

test('a native-Hz range takes the log taper so the drawn curve sweeps musically', () => {
    const hz = srv.rasterizeLane({ bars: 2, min: 20, max: 20000, is_log: 1, points: [{ time: 0, value: 0.5 }] });
    close(hz[0], 632.45, 1.0, 'curve midpoint = geometric middle of 20..20k, not the arithmetic 10k');
});

test('a lane with no range info falls back to 0..1 (old blobs keep working)', () => {
    const a = srv.rasterizeLane({ bars: 2, points: [{ time: 0, value: 0.25 }] });
    close(a[0], 0.25, 1e-6, 'identity when min/max are absent');
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

test('a listener that has answered NOTHING since boot yields the port (the old guard needed a pong first)', () => {
    resetState();
    const calls = [];
    srv.listeners.push({ stop: () => calls.push('stop'), start: () => calls.push('start') });
    const t0 = Date.now();
    srv.state.bootAt = t0;
    srv.state.pongSeen = false;
    srv.tick(t0 + 5000);
    assert(!srv.state.yielded, 'a young process is given time to answer');
    srv.tick(t0 + srv.NO_PONG_BOOT_MS + 1000);
    assert(srv.state.yielded && calls.indexOf('stop') >= 0, 'never answered = never had a patcher: release :9102');
});

test('a mapped knob NEVER reaches a window that did not arm, and a closing window disarms the probe', () => {
    // Field 2026-08-27 ("params from an arp I never mapped here"): mapped used to be
    // BROADCAST when nobody was armed, and a window closing mid-map left the [js] armed,
    // so the next knob click in Live grew a lane in every other open Stride.
    resetState();
    const [armer, bystander] = connect(fakeClient(), fakeClient());
    srv.handleClientMessage(armer, { type: 'map_live_start' });
    srv.handleMapped(enc({ name: 'Gate', device: 'Arpeggiator', path: P1, id: 9, min: 1, max: 200, is_quantized: 0, is_log: 0 }));
    assert(armer.sent.some(m => m.type === 'live_mapped'), 'the armed window gets it');
    assert(!bystander.sent.some(m => m.type === 'live_mapped'), 'the bystander does not');
    // the armed window closes: the probe must come down with it
    outbox = [];
    srv.handleDisconnect(armer);
    assert(srv.state.mapping === null, 'server disarmed');
    assert(probes('map_cancel').length === 1, 'the [js] observer is told to stand down');
    // a knob click that still slips through reaches NOBODY (it was not a map)
    bystander.sent.length = 0;
    outbox = [];
    srv.handleMapped(enc({ name: 'Steps', device: 'Arpeggiator', path: P2, id: 10, min: 1, max: 16, is_quantized: 0, is_log: 0 }));
    assert(!bystander.sent.some(m => m.type === 'live_mapped'), 'no ghost lane in an innocent window');
    assert(probes('map_cancel').length === 1, 'and it disarms again rather than re-arming');
    assert(!probes('map_start').length, 'never re-arms with nobody listening');
    if (srv.state.mapTimer) { clearTimeout(srv.state.mapTimer); srv.state.mapTimer = null; }
});

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

test('REPATH sweep heals movers and NEVER kills a working bind on a failed lookup', () => {
    // Field 2026-08-28 (Mac): bound lanes dropped out in waves and re-linked on the next
    // push. The old sweep RELEASED a voice whenever `id N` failed to resolve - a flaky
    // probe strangled healthy binds every 5s. A miss now leaves the bind alone.
    resetState();
    const [a] = connect(fakeClient());
    push(a, [LANE(P1), LANE(P2, 'Dry/Wet', 'Reverb')]);
    const [r1, r2] = probes('resolve');
    resolveOk(r1[2], 100, 'Flt 3 Freq', 'Roar', P1); resolveOk(r2[2], 300, 'Dry/Wet', 'Reverb', P2);
    srv.tick(Date.now());
    const rp = lastProbe('repath');
    assert(rp && rp.slice(3).indexOf(100) >= 0 && rp.slice(3).indexOf(300) >= 0, 'sweep asks for every bound id');
    outbox = [];
    srv.handleRepathed(enc({ rid: rp[2], items: [{ id: 100, ok: 1, path: ROAR1 }, { id: 300, ok: 0, path: '' }] }));
    assert(srv.lanesOf(a)[ROAR1] && !srv.lanesOf(a)[P1], 'grouped in-session: key migrated');
    assert(a.sent.some(m => m.type === 'live_lane_healed' && m.oldPath === P1 && m.newPath === ROAR1), 'owner rewrites its blob');
    assert(voiceOf(300) && srv.state.voices[voiceOf(300)].id === 300, 'failed lookup: the voice KEEPS its knob');
    assert(!outbox.some(x => x[0] === 'voice' && x[2] === 'unbind'), 'and nothing is released');
    for (let k = 0; k < 3; k++) {
        srv.state.repathRid = 0;
        srv.tick(Date.now());
        const rpN = lastProbe('repath');
        srv.handleRepathed(enc({ rid: rpN[2], items: [{ id: 300, ok: 0, path: '' }] }));
    }
    assert(voiceOf(300), 'still bound after repeated misses');
});

test('LIVENESS: ANY inbound [js] message proves the patcher (pings can starve on a busy Max)', () => {
    resetState();
    const calls = [];
    srv.listeners.push({ stop: () => calls.push('stop'), start: () => calls.push('start') });
    const t0 = Date.now();
    srv.state.bootAt = t0 - srv.NO_PONG_BOOT_MS - 5000;   // long past the boot window
    srv.state.pongSeen = false;                            // no pong ever...
    srv.handleTouched(enc({ path: P1, name: 'Cutoff' }));  // ...but a knob click flowed
    srv.tick(Date.now());
    assert(!srv.state.yielded && calls.indexOf('stop') < 0, 'traffic = alive: the port is kept');
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
    assert(texts.some(t => t === 'route voice probe status injected'), 'top route carries the face readout + inject verbs');
    // the branded face: Live shows presentation, and it must be Stride, not Max-grey
    const pres = Object.values(boxes).filter(b => b.presentation === 1);
    assert(pres.some(b => b.maxclass === 'panel'), 'face ground panel');
    assert(pres.some(b => b.fontname === 'Outfit' && b.text === 'STRIDE'), 'STRIDE in Outfit');
    assert(boxes['obj-face-st'] && boxes['obj-face-st'].presentation === 1, 'ACTIVE/STANDBY on the face');
    assert(!boxes['obj-face-n'], 'NO lane count on the face (removed 2026-08-27)');
    const has = (src, so, dst, di) => lines.some(l => l.source[0] === src && l.source[1] === so && l.destination[0] === dst && l.destination[1] === di);
    assert(has('obj-6', 2, 'obj-face-st', 0), 'readout wired from the route');
    assert(has('obj-6', 4, 'obj-8', 0), 'the unmatched outlet (now 4, after `injected`) still lands on the debug print');
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
    // Max draws EARLIER boxes ON TOP: the ground panel first in the array covered the
    // whole face (field 2026-08-28, Mac: "stride bridge is full black"). It must be LAST.
    const rawDoc = JSON.parse(fs.readFileSync(path.join(BRIDGE, 'StrideBridge.maxpat'), 'utf8'));
    const lastBox = rawDoc.patcher.boxes[rawDoc.patcher.boxes.length - 1].box;
    assert(lastBox.id === 'obj-face-bg', 'face ground appended LAST = drawn at the BACK, got ' + lastBox.id);
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

test('canvas: an engine echo cannot leave the selection holding only the Ableton lanes', () => {
    // Field 2026-08-27: "fire a motion on all lanes and it fires on the Ableton device
    // only, the VST lanes stay still even though they are not locked." An echo rebuilt
    // every hosted lane with selected:false while live lanes were carried verbatim WITH
    // their selection, so a rescan between Select All and the motion left the tool
    // targeting live lanes alone. Selection + focus must survive an echo.
    const i = canvas.indexOf('function loadParamsDirectly');
    const seg = canvas.slice(i, canvas.indexOf('function ', i + 40));
    assert(/const _selBefore = \{\};/.test(seg), 'selection snapshotted before the rebuild');
    assert(/if \(p\.selected && !p\._live && p\._path\) _selBefore\[p\._path\] = 1;/.test(seg), 'keyed by the stable _path, hosted lanes only (live ones are carried whole)');
    assert(/_selBefore\[p\._path\] && !p\.locked\) p\.selected = true;/.test(seg), 'restored after the rebuild, never onto a locked lane');
    assert(/const _activeBefore = sdActiveParamId;/.test(seg) && /!sdCanvasParams\.some\(p => p\.envelopeId === _activeBefore\)/.test(seg), 'the focused lane survives an echo too');
    assert(seg.indexOf('_selBefore = {}') < seg.indexOf('sdCanvasParams = params.map'), 'the snapshot is taken BEFORE the lanes are rebuilt');
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

console.log('\n— unit: the arm must be earned (runs last: it awaits real timers) —');

test('MAP LIVE must be EARNED: no ack from the [js] and the bridge says it is unreachable', async () => {
    // Field 2026-08-27: "the mapping is just not reacting and I need to remove StrideBridge
    // and re-drag it." The button lit on a message SENT and the server acked as soon as it
    // emitted the probe - neither proves a live patcher is behind this process. A leaked
    // node that still owns :9102 swallowed the arm silently.
    // NO resetState here: this test awaits real timers, and the other async test is live
    // at the same time - wiping shared state would pull the rug out from under it.
    const live = fakeClient();   // deliberately NOT added to state.clients: nothing here needs
    srv.handleClientMessage(live, { type: 'map_live_start' });   // it, and the other async test counts them
    assert(live.sent.some(m => m.type === 'map_live_armed'), 'still acks instantly, so the button stays responsive');
    assert(srv.state.armTimer !== null, 'a proof timer is running until the [js] answers');
    srv.handleArmed();                                   // a LIVE patcher answers
    assert(srv.state.armTimer === null, 'ack clears the proof timer');
    assert(srv.state.pongSeen, 'and counts as liveness, like a pong');
    assert(srv.state.mapping === live, 'armed at the server');

    // ...and a DEAD patcher: nothing acks. (Only client-visible facts are asserted after
    // the await - other tests run during it and reset the shared server state.)
    const dead = fakeClient();
    srv.handleClientMessage(dead, { type: 'map_live_start' });
    assert(srv.state.armTimer !== null, 'the proof timer is running');
    await new Promise(r => setTimeout(r, srv.ARM_ACK_MS + 400));
    const u = dead.sent.find(m => m.type === 'bridge_unreachable');
    assert(u && /drag it back in/.test(u.message), 'named AND actionable: ' + (u && u.message));
    assert(!live.sent.some(m => m.type === 'bridge_unreachable'), 'the window that got an ack is never accused');
    if (srv.state.mapTimer) { clearTimeout(srv.state.mapTimer); srv.state.mapTimer = null; }
    if (srv.state.armTimer) { clearTimeout(srv.state.armTimer); srv.state.armTimer = null; }
});


console.log('\n— unit: inject — speed tiling —');

test('tileForSpeed: speed 1 passes the shape through untouched (curves included)', () => {
    const pts = [{ time: 0, value: 0, curve: 0 }, { time: 8, value: 1, curve: 0.4 }, { time: 16, value: 0.25, curve: -0.2 }];
    const out = srv.tileForSpeed(pts, 1, 4);
    assert(out.length === 3, 'same count');
    out.forEach((p, i) => { close(p.time, pts[i].time); close(p.value, pts[i].value); close(p.curve, pts[i].curve); });
    assert(out !== pts && out[0] !== pts[0], 'copied, never the caller-owned array');
});

test('tileForSpeed: speed 2 over 4 bars = two cycles inside 16 beats, boundary de-duped', () => {
    // the bridge plays this lane at rate bars/speed, so it cycles twice per 4 bars;
    // a 1:1 clip inject has to lay both cycles down.
    const pts = [{ time: 0, value: 0, curve: 0 }, { time: 8, value: 1, curve: 0.5 }, { time: 16, value: 0, curve: 0 }];
    const out = srv.tileForSpeed(pts, 2, 4);
    const times = out.map(p => p.time);
    assert(times.length === 5, 'two cycles minus the shared boundary point, got ' + times.length);
    [0, 4, 8, 12, 16].forEach((t, i) => close(times[i], t, 1e-6, 'tile time ' + i));
    close(out[1].value, 1, 1e-9, 'peak of cycle 1 survives');
    close(out[1].curve, 0.5, 1e-9, 'curve rides along');
    close(out[3].value, 1, 1e-9, 'peak of cycle 2');
    assert(times.every((t, i) => i === 0 || t > times[i - 1]), 'strictly ascending: no zero-length bezier segment');
});

test('tileForSpeed: speed 4 over 2 bars = four cycles inside 8 beats', () => {
    const out = srv.tileForSpeed([{ time: 0, value: 0 }, { time: 8, value: 1 }], 4, 2);
    assert(out.length === 5, 'four cycles, boundaries shared: ' + out.length);
    [0, 2, 4, 6, 8].forEach((t, i) => close(out[i].time, t, 1e-6));
});

test('tileForSpeed: a fractional speed cannot tile without resampling, so it injects one cycle', () => {
    const pts = [{ time: 0, value: 0, curve: 0 }, { time: 16, value: 1, curve: 0 }];
    const out = srv.tileForSpeed(pts, 1.5, 4);
    assert(out.length === 2, 'one cycle, curves intact');
    close(out[1].time, 16);
});

test('tileForSpeed: garbage speed falls back to 1x', () => {
    const pts = [{ time: 0, value: 0.5 }];
    close(srv.tileForSpeed(pts, 0, 4)[0].time, 0);
    close(srv.tileForSpeed(pts, undefined, 4).length, 1);
    assert(srv.tileForSpeed(null, 2, 4).length === 0, 'no points, no crash');
});

console.log('\n— unit: inject — the lane to param mapping is a rename, not a conversion —');

function injLane(p, name, pts, extra) {
    return Object.assign({ path: p, name: name, device: 'Roar', points: pts, speed: 1 }, extra || {});
}

test('collectInjectParams: every field carries over 1:1 (times in beats, values 0..1)', () => {
    const c = fakeClient(); const mine = new Set([c]);
    const pts = [{ time: 0, value: 0, curve: 0 }, { time: 4.5, value: 0.75, curve: 0.3 }, { time: 16, value: 1, curve: 0 }];
    push(c, [injLane(P1, 'Filter Freq', pts, { min: 20, max: 20000, is_log: 1 })], 4);

    const r = srv.collectInjectParams(mine);
    assert(r.params.length === 1, 'one lane, one param');
    const p = r.params[0];
    assert(p._path === P1, '_path is the LOM path verbatim');
    assert(p.name === 'Filter Freq', 'name');
    close(p.min, 20, 1e-9, 'min'); close(p.max, 20000, 1e-9, 'max');
    assert(p.is_log === true, 'is_log');
    assert(p.points.length === pts.length, 'point count unchanged');
    p.points.forEach((q, i) => {
        close(q.time, pts[i].time, 1e-9, 'time ' + i + ' stays in beats');
        close(q.value, pts[i].value, 1e-9, 'value ' + i + ' stays 0..1');
        close(q.curve, pts[i].curve, 1e-9, 'curve ' + i);
    });
    close(r.bars, 4, 1e-9, 'clip_bars from the push');
});

test('collectInjectParams: lanes with no drawn points are not injected', () => {
    const c = fakeClient(); const mine = new Set([c]);
    push(c, [injLane(P1, 'A', []), injLane(P2, 'B', [{ time: 0, value: 1, curve: 0 }])], 4);
    const r = srv.collectInjectParams(mine);
    assert(r.params.length === 1 && r.params[0]._path === P2, 'only the drawn one');
});

test('collectInjectParams: two Strides holding the same path yield ONE param (a clip has one envelope per knob)', () => {
    const a = fakeClient(), b = fakeClient(); const mine = new Set([a, b]);
    const pts = [{ time: 0, value: 0.2, curve: 0 }];
    push(a, [injLane(P1, 'A', pts)], 4);
    push(b, [injLane(P1, 'A copy', pts), injLane(P2, 'B', pts)], 4);
    const r = srv.collectInjectParams(mine);
    assert(r.params.length === 2, 'deduped by path: ' + r.params.length);
    assert(r.params.filter(p => p._path === P1).length === 1, 'P1 once');
});

test('collectInjectParams: bars is the widest lane, fractional speeds are counted for the report', () => {
    const c = fakeClient(); const mine = new Set([c]);
    const pts = [{ time: 0, value: 0, curve: 0 }, { time: 8, value: 1, curve: 0 }];
    push(c, [injLane(P1, 'A', pts, { speed: 1.5 }), injLane(P2, 'B', pts, { speed: 2 })], 8);
    const r = srv.collectInjectParams(mine);
    close(r.bars, 8, 1e-9, 'bars');
    assert(r.fractional === 1, 'one fractional-speed lane flagged');
});

console.log('\n— integration: the INJECT button end to end (no Ableton) —');

const _os = require('os');
const TRIG = path.join(_os.tmpdir(), 'sb_test_trigger.json');
const RES = path.join(_os.tmpdir(), 'sb_test_result.json');
srv.injectWriter._setIoForTest({ trigger: TRIG, result: RES, first: 5, poll: 5, timeout: 300 });
const rmq = p => { try { fs.unlinkSync(p); } catch (e) {} };
const settle = ms => new Promise(r => setTimeout(r, ms));

// A private face log. outbox is rebound by every resetState(), and the other async
// tests in this file reset it while we are awaiting, so face assertions cannot read
// it. This array is ours and nothing clears it.
const injFace = [];
srv._setIoForTest(atoms => { outbox.push(atoms); if (atoms[0] === 'injected') injFace.push(atoms[2]); }, () => {});

// ONE async test on purpose: the four scenarios share the module-level injectBusy
// latch and the trigger file, so they must run in sequence. And it never calls
// resetState() - it swaps state.clients and puts it back - because the TCP and MAP
// LIVE tests are parked on real timers while this runs.
test('inject: the button, end to end - payload, partial write, failure, no StrideInject', async () => {
    const face = () => injFace[injFace.length - 1];
    const lane = (p, name, pts, extra) => ({
        path: p, expectName: name, expectDevice: 'Roar',
        norm: Object.assign({ bars: 4, speed: 1, points: pts, min: 0, max: 1, is_log: 0, name: name }, extra || {}),
    });
    // an isolated set, never srv.state.clients: the TCP and MAP LIVE tests are
    // parked on real timers asserting the size of the real one while this runs.
    let mine = new Set();
    const withLanes = ls => {
        const c = fakeClient();
        c.lanes = {}; ls.forEach(l => { c.lanes[l.path] = l; });
        mine = new Set([c]);
        return c;
    };
    const pts = [{ time: 0, value: 0, curve: 0 }, { time: 8, value: 1, curve: 0.25 }, { time: 16, value: 0.5, curve: 0 }];

    try {
        // ── 1. nothing mapped ────────────────────────────────────────────
        rmq(TRIG); rmq(RES);
        let c = withLanes([]);
        srv.handleInject(mine);
        assert(face() === 'NO LANES', 'face says NO LANES, got ' + face());
        let r = c.sent.find(m => m.type === 'inject_result');
        assert(r && r.ok === false && r.total === 0, 'client told, nothing written');
        assert(!fs.existsSync(TRIG), 'no trigger file written for an empty set');

        // ── 2. the happy path: the trigger file IS the lanes ─────────────
        rmq(TRIG); rmq(RES);
        c = withLanes([
            lane(P1, 'Filter Freq', pts, { min: 20, max: 20000, is_log: 1 }),
            lane(P2, 'Drive', pts),
        ]);
        srv.handleInject(mine);
        assert(face() === 'WORKING', 'face shows progress immediately, got ' + face());
        assert(fs.existsSync(TRIG), 'trigger written synchronously');

        const payload = JSON.parse(fs.readFileSync(TRIG, 'utf8'));
        // the schema StrideInject documents (remote_script/StrideInject/__init__.py)
        assert(payload.create_clip === false, 'the bridge never creates clips: the user picked one');
        close(payload.clip_bars, 4, 1e-9, 'clip_bars');
        assert(Array.isArray(payload.params) && payload.params.length === 2, 'two params');
        const fp = payload.params.find(p => p._path === P1);
        assert(fp, 'P1 present, addressed by its LOM path');
        assert(fp.name === 'Filter Freq' && fp.is_log === true, 'name + is_log carried');
        close(fp.min, 20, 1e-9, 'min'); close(fp.max, 20000, 1e-9, 'max');
        assert(fp.points.length === 3, 'point count 1:1');
        fp.points.forEach((q, i) => {
            close(q.time, pts[i].time, 1e-9, 'beat time survives the hop');
            close(q.value, pts[i].value, 1e-9, 'value stays 0..1 - StrideInject scales it, not us');
            close(q.curve, pts[i].curve, 1e-9, 'curve survives');
        });

        fs.writeFileSync(RES, JSON.stringify({ success: true, params_written: 2, points_written: 6, mode: 'bezier',
                                               message: 'OK', written_paths: [P1, P2] }));
        await settle(90);
        assert(face() === '2 OF 2 >LIVE', 'face reports the write and the hand-over, got ' + face());
        r = c.sent.find(m => m.type === 'inject_result');
        assert(r && r.ok === true && r.written === 2 && r.total === 2, 'VST told the same numbers');

        // ── 3. a lane on another track: Live skips it, we say so ─────────
        rmq(TRIG); rmq(RES);
        c = withLanes([lane(P1, 'A', pts), lane(P2, 'B', pts), lane(ROAR1, 'C', pts)]);
        srv.handleInject(mine);
        // StrideInject's _get_or_create_envelope returns None for a foreign-track
        // param and skips it, so params_written is the truth from Live, not a guess.
        fs.writeFileSync(RES, JSON.stringify({ success: true, params_written: 2, points_written: 4,
                                               mode: 'bezier', written_paths: [P1, P2] }));
        await settle(90);
        assert(face() === '2 OF 3 >LIVE', 'partial write reported honestly, got ' + face());
        r = c.sent.find(m => m.type === 'inject_result');
        assert(r && r.written === 2 && r.total === 3, 'VST gets both numbers');

        // ── 4. Live refuses: the commonest mistake gets its own word ─────
        rmq(TRIG); rmq(RES);
        c = withLanes([lane(P1, 'A', pts)]);
        srv.handleInject(mine);
        fs.writeFileSync(RES, JSON.stringify({ success: false, message: 'No clip selected. Open or select a clip in Live' }));
        await settle(90);
        assert(face() === 'NO CLIP', 'face names it, got ' + face());
        r = c.sent.find(m => m.type === 'inject_result');
        assert(r && r.ok === false && /No clip selected/.test(r.message), 'the full sentence reaches the VST');

        // ── 5. no StrideInject at all: a named answer, never a hang ──────
        rmq(TRIG); rmq(RES);
        c = withLanes([lane(P1, 'A', pts)]);
        srv.handleInject(mine);
        assert(face() === 'WORKING', 'not stuck busy after the previous failure');
        await settle(500);                               // no result file ever appears
        assert(face() === 'STRIDEINJECT?', 'face names the missing piece, got ' + face());
        r = c.sent.find(m => m.type === 'inject_result');
        assert(r && r.ok === false && /Control Surface/.test(r.message),
               'the message says where to click: ' + (r && r.message));

        // 6. hand-over: park exactly what Live wrote, nothing else
        rmq(TRIG); rmq(RES);
        c = withLanes([lane(P1, 'A', pts), lane(P2, 'B', pts), lane(ROAR1, 'C', pts)]);
        outbox.length = 0;
        srv.handleInject(mine);
        // Live wrote two of three: the third is on another track, which
        // _get_or_create_envelope skips by design.
        fs.writeFileSync(RES, JSON.stringify({ success: true, params_written: 2, points_written: 4,
                                               mode: 'bezier', written_paths: [P1, P2] }));
        await settle(90);
        assert(c.lanes[P1].printed === true && c.lanes[P2].printed === true, 'the two Live wrote are handed over');
        assert(!c.lanes[ROAR1].printed, 'the skipped lane KEEPS modulating - handing it over would silence it for nothing');
        assert(c.lanes[P1].voice === 0, 'and the knob is released');
        const lp = c.sent.find(m => m.type === 'lane_printed' && m.printed === true);
        assert(lp && lp.paths.length === 2, 'client told which two, so the flag persists across a save');
        assert(face() === '2 OF 3 >LIVE', 'face reports the write AND the hand-over, got ' + face());
        r = c.sent.find(m => m.type === 'inject_result');
        assert(r && r.parked === 2, 'inject_result carries the parked count');
        assert(outbox.some(a => a[0] === 'probe' && a[1] === 'reenable'),
               'Live is asked to re-enable automation - without it the fresh envelope sits overridden');

        // 7. a failed inject hands nothing over
        rmq(TRIG); rmq(RES);
        c = withLanes([lane(P1, 'A', pts)]);
        outbox.length = 0;
        srv.handleInject(mine);
        fs.writeFileSync(RES, JSON.stringify({ success: false, message: 'No clip selected. Open or select a clip in Live' }));
        await settle(90);
        assert(!c.lanes[P1].printed, 'still modulating after a failed inject');
        assert(!outbox.some(a => a[0] === 'probe' && a[1] === 'reenable'), 'and Live was not touched');

        // 8. an OLD StrideInject: writes envelopes, reports no paths.
        // The field case, 2026-08-31: a June copy under ProgramData\Ableton\...\MIDI
        // Remote Scripts shadowed the fresh one in the User Library. Automation appeared
        // correctly, written_paths came back empty, and the hand-over silently did
        // nothing. "wrote 2, handed over 0" must never read as success.
        rmq(TRIG); rmq(RES);
        c = withLanes([lane(P1, 'A', pts)]);
        srv.handleInject(mine);
        fs.writeFileSync(RES, JSON.stringify({ success: true, params_written: 1, points_written: 2, mode: 'bezier' }));
        await settle(90);
        assert(face() === 'OLD SI?', 'the face names it, got ' + face());
        assert(!c.lanes[P1].printed, 'and nothing was parked on a claim we cannot verify');

        // 9. the SAME stale answer, but we replaced StrideInject ourselves this launch.
        // The user coming from StrideLink: Control Surface pick right, script on disk right,
        // Live simply imported the old one at launch. OLD SI? would send them hunting a
        // ProgramData shadow copy that is not there. Name the fix instead.
        rmq(TRIG); rmq(RES);
        srv.state.siPlaced = 'updated';
        c = withLanes([lane(P1, 'A', pts)]);
        srv.handleInject(mine);
        fs.writeFileSync(RES, JSON.stringify({ success: true, params_written: 1, points_written: 2, mode: 'bezier' }));
        await settle(90);
        assert(face() === 'RESTART LIVE', 'the face names the actual fix, got ' + face());
        assert(!c.lanes[P1].printed, 'still nothing parked');

        // and when the old script does not answer at all, same instruction
        rmq(TRIG); rmq(RES);
        c = withLanes([lane(P1, 'A', pts)]);
        srv.handleInject(mine);
        await settle(500);
        assert(face() === 'RESTART LIVE', 'same answer when it never replies, got ' + face());
    } finally {
        srv.state.siPlaced = '';
        rmq(TRIG); rmq(RES);
    }
});

console.log('\n— struct: the INJECT button on the device face —');

test('StrideBridge.maxpat: INJECT button wired to node.script, result routed back to the face', () => {
    const pat = loadPatcher('StrideBridge.maxpat');
    const boxes = pat.boxes, lines = pat.lines;
    const has = (s, so, d, di) => lines.some(l => l.source[0] === s && l.source[1] === so &&
                                                 l.destination[0] === d && l.destination[1] === di);
    const btn = boxes['obj-face-inject'];
    assert(btn && btn.maxclass === 'textbutton', 'a textbutton on the face');
    assert(btn.text === 'INJECT', 'labelled INJECT');
    assert(btn.presentation === 1, 'visible in the device face, not just the patching view');
    assert(btn.parameter_enable === 0, 'a command, never an automatable Live parameter');

    assert(boxes['obj-inject-msg'] && boxes['obj-inject-msg'].text === 'inject', 'the message the node handler is keyed on');
    assert(has('obj-face-inject', 0, 'obj-inject-msg', 0), 'button -> message');
    assert(has('obj-inject-msg', 0, 'obj-3', 0), 'message -> node.script');

    assert(/route voice probe status injected/.test(boxes['obj-6'].text), 'route carries the injected result');
    assert(boxes['obj-6'].numoutlets === 5, 'four matches + reject');
    assert(has('obj-6', 3, 'obj-face-st', 0), 'injected result shares the ACTIVE/STANDBY line');
    assert(!boxes['obj-face-msg'], 'no second readout comment: Live caps the device at 169px, the buttons need that space');
    const tk = boxes['obj-face-take'];
    assert(tk && tk.maxclass === 'textbutton' && tk.text === 'TAKE BACK', 'TAKE BACK button on the face');
    assert(tk.parameter_enable === 0, 'a command, not an automatable Live parameter');
    assert(boxes['obj-take-msg'] && boxes['obj-take-msg'].text === 'takeback', 'the message the handler is keyed on');
    assert(has('obj-face-take', 0, 'obj-take-msg', 0) && has('obj-take-msg', 0, 'obj-3', 0), 'TAKE BACK -> node.script');
    assert(has('obj-6', 4, 'obj-8', 0), 'the reject outlet moved 3 -> 4 with it');
    assert(has('obj-6', 2, 'obj-face-st', 0), 'ACTIVE/STANDBY still on outlet 2');
    assert(has('obj-6', 1, 'obj-7', 0) && has('obj-6', 0, 'obj-9', 0), 'probe + voices untouched');
});

test('StrideBridge.maxpat: both buttons fit the 90x169 ground and nothing overlaps', () => {
    // Live gives a Max device a FIXED ~169px of height and clips the rest, so this is
    // not a style check: a box past the edge is simply invisible in the device chain.
    const boxes = loadPatcher('StrideBridge.maxpat').boxes;
    const bg = boxes['obj-face-bg'].presentation_rect;
    const inside = r => r[0] >= bg[0] && r[1] >= bg[1] && r[0] + r[2] <= bg[0] + bg[2] && r[1] + r[3] <= bg[1] + bg[3];
    const st = boxes['obj-face-st'].presentation_rect;
    const btn = boxes['obj-face-inject'].presentation_rect;
    const tk = boxes['obj-face-take'].presentation_rect;
    [['status', st], ['inject', btn], ['take back', tk]].forEach(([n, r]) => assert(inside(r), n + ' inside the ground panel'));
    const rows = [st, btn, tk].sort((a, b) => a[1] - b[1]);
    for (let i = 0; i + 1 < rows.length; i++)
        assert(rows[i][1] + rows[i][3] <= rows[i + 1][1], 'row ' + i + ' does not overlap the next');
    // the z-order rule the face already depends on
    const raw = JSON.parse(fs.readFileSync(path.join(BRIDGE, 'StrideBridge.maxpat'), 'utf8'));
    assert(raw.patcher.boxes[raw.patcher.boxes.length - 1].box.id === 'obj-face-bg',
           'ground panel still last = drawn at the back');
});

test('shipping: inject-writer.js exists and both CI stage lists carry it (or the device will not load)', () => {
    assert(fs.existsSync(path.join(BRIDGE, 'inject-writer.js')), 'inject-writer.js in m4l-bridge/');
    const wf = fs.readFileSync(path.join(ROOT, '..', '.github', 'workflows', 'build-vst3.yml'), 'utf8');
    assert(/log-scaling\.js inject-writer\.js/.test(wf), 'windows stage list');
    const mac = fs.readFileSync(path.join(ROOT, '..', 'stride-wrapper', 'm0-spike', 'ci', 'build-mac-vst3.sh'), 'utf8');
    assert(/log-scaling\.js inject-writer\.js/.test(mac), 'mac stage list');
    const readme = fs.readFileSync(path.join(BRIDGE, 'README-StrideBridge.txt'), 'utf8');
    assert(/INJECT TO CLIP/.test(readme), 'README documents the button');
    assert(!/^- Nothing is written into clips/m.test(readme), 'the old "never writes clips" line is gone');
    assert(readme.indexOf('—') < 0, 'README: no em dashes');
});

test('shipping: build_main_patcher.py writes the .amxd too, so a face change cannot ship stale', () => {
    const gen = fs.readFileSync(path.join(BRIDGE, 'build_main_patcher.py'), 'utf8');
    assert(/StrideBridge\.amxd/.test(gen) && /ampf/.test(gen) && /ptch/.test(gen),
           'the generator packs the ampf container itself');
});

console.log('\n— unit: printed — Stride hands the knob to Live —');

// These drive the server for real but never touch srv.state.clients: the TCP and
// MAP LIVE tests are parked on real timers asserting its size while these run.
function printedRig() {
    const c = fakeClient();
    const mine = new Set([c]);
    const pushMine = (lanes, bars) => srv.handleClientMessage(c, { type: 'set_live_lanes', bars: bars || 4, lanes: lanes });
    const laneOf = p => srv.lanesOf(c)[p];
    return { c, mine, pushMine, laneOf };
}
const PTS = [{ time: 0, value: 0, curve: 0 }, { time: 16, value: 1, curve: 0 }];
const PTS2 = [{ time: 0, value: 0, curve: 0 }, { time: 8, value: 0.5, curve: 0.4 }, { time: 16, value: 1, curve: 0 }];
const lnA = (pts, extra) => Object.assign({ path: P1, points: pts, speed: 1, name: 'A', device: 'Roar' }, extra || {});

test('parkLane: frees the voice and keeps the lane, its curve and its identity', () => {
    const r = printedRig();
    r.pushMine([lnA(PTS)]);
    const lane = r.laneOf(P1);
    assert(lane, 'lane exists');
    lane.voice = srv.allocVoice();
    srv.state.voices[lane.voice].id = 4242;
    srv.parkLane(lane);
    assert(lane.printed === true, 'printed');
    assert(lane.voice === 0, 'voice released - the knob is Live’s again');
    assert(r.laneOf(P1) === lane, 'the lane itself is NOT deleted');
    assert(lane.norm && lane.norm.points.length === 2, 'the curve is still there');
    assert(srv.voiceByTarget(4242) === 0, 'no voice still bound to that target');
});

test('printed lane ignores a push that did not change the shape', () => {
    const r = printedRig();
    r.pushMine([lnA(PTS)]);
    srv.parkLane(r.laneOf(P1));
    const before = srv.state.pending && Object.keys(srv.state.pending).length;
    r.pushMine([lnA(PTS)]);                                  // same curve, e.g. a reconnect flush
    assert(r.laneOf(P1).printed === true, 'still printed');
    assert(r.laneOf(P1).voice === 0, 'still not driving');
    assert((Object.keys(srv.state.pending).length) === before, 'and it did not start a resolve');
});

test('drawing on a printed lane takes it back, and the client is told so the flag clears', () => {
    const r = printedRig();
    r.pushMine([lnA(PTS)]);
    srv.parkLane(r.laneOf(P1));
    r.c.sent.length = 0;
    r.pushMine([lnA(PTS2)]);                                 // the user drew
    assert(r.laneOf(P1).printed === false, 'back on Stride');
    const m = r.c.sent.find(x => x.type === 'lane_printed');
    assert(m && m.printed === false && m.paths.indexOf(P1) >= 0, 'client told to clear its saved flag');
});

test('a persisted printed flag survives a reload: the first push must NOT grab the knob back', () => {
    // This is the one that would silently break a project: without it, reopening the
    // set re-binds every knob and overrides the automation printed yesterday.
    const r = printedRig();
    const before = Object.keys(srv.state.pending).length;
    r.pushMine([lnA(PTS, { printed: true })]);               // fresh client, blob says printed
    const lane = r.laneOf(P1);
    assert(lane.printed === true, 'honoured on the first push');
    assert(lane.voice === 0, 'no voice');
    assert(Object.keys(srv.state.pending).length === before, 'and no resolve was started');
});

test('lanesFromBlob carries livePrinted through the v10 blob', () => {
    const lanes = srv.lanesFromBlob({ lanes: [
        { livePath: P1, points: PTS, liveMin: 0, liveMax: 1, livePrinted: true },
        { livePath: P2, points: PTS, liveMin: 0, liveMax: 1 },
    ] });
    assert(lanes.length === 2, 'two lanes');
    assert(lanes.find(l => l.path === P1).printed === true, 'printed rides the blob');
    assert(lanes.find(l => l.path === P2).printed === false, 'absent = not printed');
});

test('TAKE BACK re-arms every printed lane in one press, and says how many', () => {
    const r = printedRig();
    r.pushMine([lnA(PTS), Object.assign(lnA(PTS), { path: P2, name: 'B' })]);
    srv.parkLane(r.laneOf(P1));
    srv.parkLane(r.laneOf(P2));
    r.c.sent.length = 0;
    outbox.length = 0;
    srv.handleTakeBack(r.mine);
    assert(r.laneOf(P1).printed === false && r.laneOf(P2).printed === false, 'both back on Stride');
    const m = r.c.sent.find(x => x.type === 'lane_printed');
    assert(m && m.printed === false && m.paths.length === 2, 'client told about both');
    const tb = r.c.sent.find(x => x.type === 'take_back_result');
    assert(tb && tb.count === 2, 'count reported');
    const face = outbox.filter(a => a[0] === 'injected');
    assert(face.length && face[face.length - 1][2] === 'BACK 2', 'face says BACK 2, got ' + (face.length && face[face.length - 1][2]));
});

test('TAKE BACK with nothing printed is a message, not a no-op mystery', () => {
    const r = printedRig();
    r.pushMine([lnA(PTS)]);
    outbox.length = 0;
    srv.handleTakeBack(r.mine);
    const face = outbox.filter(a => a[0] === 'injected');
    assert(face.length && face[face.length - 1][2] === 'NONE PRINTED', 'face says so, got ' + (face.length && face[face.length - 1][2]));
});


console.log('\n— struct: the printed flag survives a save —');

test('StrideInject reports WHICH paths it wrote, on both the session and arrangement paths', () => {
    const py = fs.readFileSync(path.join(ROOT, 'remote_script', 'StrideInject', '__init__.py'), 'utf8');
    assert(/"written_paths": written_paths or \[\]/.test(py), 'result payload carries it');
    assert((py.match(/written_paths\.append\(/g) || []).length === 4,
           'appended in all four write branches (session bezier/step, arrangement bezier/step)');
    assert(/written_paths\.append\(pd\.get\("_path"\) or \("macro:"/.test(py),
           'a hosted lane is reported by the macro key the bridge asked for, not a null path');
    assert(/return params_written, points_written, written_paths/.test(py), '_apply_curves_sync returns it');
    assert(!/self\._ok\(params_written, points_written, notes_written\)/.test(py), 'every _ok call passes the paths');
});

test('bridge_max.js: reenable calls Live re_enable_automation', () => {
    const js = fs.readFileSync(path.join(BRIDGE, 'bridge_max.js'), 'utf8');
    assert(/function reenable\(\)/.test(js), 'handler exists');
    assert(/re_enable_automation/.test(js), 'calls the LOM method');
});

test('shim + canvas: livePrinted rides the push and the save', () => {
    const shim = fs.readFileSync(path.join(ROOT, '..', 'stride-wrapper', 'm0-spike', 'ui', 'shim.js'), 'utf8');
    assert(/printed: !!l\.livePrinted/.test(shim), 'the push carries it, so a reopened set does not re-bind');
    assert(/lane_printed/.test(shim) && /sdBridgePrinted/.test(shim), 'the bridge notification reaches the canvas');
    const canvas = fs.readFileSync(path.join(ROOT, 'app', 'renderer', 'canvas.js'), 'utf8');
    assert(/livePrinted: !!p\.livePrinted/.test(canvas), 'serialized into the v10 blob');
    assert(/window\.sdBridgePrinted = function/.test(canvas), 'canvas records the bridge decision');
    assert(/saveCanvasState\(\);/.test(canvas), 'and saves it');
});

console.log('\n— unit: hosted (macro) lanes reach the inject —');

function macroRig() {
    const c = fakeClient();
    return { c, mine: new Set([c]),
             push: (lanes, bars) => srv.handleClientMessage(c, { type: 'set_macro_lanes', bars: bars || 4, lanes: lanes }) };
}
const MPTS = [{ time: 0, value: 0, curve: 0 }, { time: 8, value: 1, curve: 0.3 }, { time: 16, value: 0.5, curve: 0 }];

test('set_macro_lanes: hosted lanes are kept OFF client.lanes, so no voice machinery can see them', () => {
    const r = macroRig();
    r.push([{ pos: 0, macro: 'Serum: WT Pos', points: MPTS, speed: 1 }]);
    assert(Object.keys(srv.lanesOf(r.c)).length === 0, 'not a live lane: it must never take a voice or a knob');
    assert(r.c.macros && r.c.macros[0] && r.c.macros[0].macro === 'Serum: WT Pos', 'held separately');
});

test('set_macro_lanes: pathless, pointless and negative-pos entries are dropped', () => {
    const r = macroRig();
    r.push([{ pos: 0, macro: '', points: MPTS },
            { pos: 1, macro: 'Serum: Cutoff', points: [] },
            { pos: -1, macro: 'Serum: Res', points: MPTS },
            { pos: 2, macro: 'Serum: Drive', points: MPTS }]);
    const keys = Object.keys(r.c.macros);
    assert(keys.length === 1 && r.c.macros[2].macro === 'Serum: Drive', 'only the complete one survives: ' + keys);
});

test('collectInjectParams: a hosted lane is addressed by macro NAME, never by a LOM path', () => {
    const r = macroRig();
    r.push([{ pos: 3, macro: 'Serum: WT Pos', points: MPTS, speed: 1 }], 4);
    const out = srv.collectInjectParams(r.mine);
    assert(out.params.length === 1, 'one param');
    const p = out.params[0];
    assert(p._path === null, 'no LOM path: Stride is the device, the knob is inside it');
    assert(p.macro_name === 'Serum: WT Pos', 'resolved by name on the clip track instead');
    assert(p.points.length === 3, 'points 1:1');
    p.points.forEach((q, i) => {
        close(q.time, MPTS[i].time, 1e-9, 'time ' + i);
        close(q.value, MPTS[i].value, 1e-9, 'value ' + i);
        close(q.curve, MPTS[i].curve, 1e-9, 'curve ' + i);
    });
});

test('collectInjectParams: hosted and Ableton lanes ride ONE payload', () => {
    const c = fakeClient();
    const mine = new Set([c]);
    srv.handleClientMessage(c, { type: 'set_live_lanes', bars: 4, lanes: [
        { path: P1, points: MPTS, speed: 1, name: 'Roar Drive', device: 'Roar' } ] });
    srv.handleClientMessage(c, { type: 'set_macro_lanes', bars: 4, lanes: [
        { pos: 0, macro: 'Serum: WT Pos', points: MPTS, speed: 1 } ] });
    const out = srv.collectInjectParams(mine);
    assert(out.params.length === 2, 'both kinds: ' + out.params.length);
    assert(out.params.some(p => p._path === P1), 'the Ableton knob');
    assert(out.params.some(p => p.macro_name === 'Serum: WT Pos'), 'the hosted knob');
});

test('collectInjectParams: an already-printed hosted lane is not injected again', () => {
    const r = macroRig();
    r.push([{ pos: 0, macro: 'Serum: WT Pos', points: MPTS, printed: true },
            { pos: 1, macro: 'Serum: Cutoff', points: MPTS }]);
    const out = srv.collectInjectParams(r.mine);
    assert(out.params.length === 1 && out.params[0].macro_name === 'Serum: Cutoff', 'only the unprinted one');
});

test('collectInjectParams: hosted lanes tile for speed like every other lane', () => {
    const r = macroRig();
    r.push([{ pos: 0, macro: 'Serum: WT Pos', speed: 2,
              points: [{ time: 0, value: 0, curve: 0 }, { time: 16, value: 1, curve: 0 }] }], 4);
    const p = srv.collectInjectParams(r.mine).params[0];
    assert(p.points.length === 3, 'two cycles, boundary shared: ' + p.points.length);
    [0, 8, 16].forEach((t, i) => close(p.points[i].time, t, 1e-6, 'tile ' + i));
});

console.log('\n— struct: the hosted-lane pipeline end to end —');

test('StrideInject: resolves a macro by name against the CLIP\'S OWN track, and walks racks', () => {
    const py = fs.readFileSync(path.join(ROOT, 'remote_script', 'StrideInject', '__init__.py'), 'utf8');
    assert(/def _resolve_macro/.test(py), 'the resolver exists');
    assert(/self\._resolve_clip_track\(clip\)/.test(py), 'scoped to the clip track: the only place an envelope can reach');
    assert(/for attr in \("chains", "return_chains"\)/.test(py), 'racks nest, so chains are walked too');
    assert((py.match(/if param is None and pd\.get\("macro_name"\)/g) || []).length === 2,
           'wired into BOTH write paths (session + arrangement)');
    assert(/Send to DAW/.test(py), 'an unresolvable macro says what to do about it');
});

test('bridge + shim: hosted lanes are pushed, printed, and flipped to DAW drive', () => {
    const srvJs = fs.readFileSync(path.join(BRIDGE, 'bridge-server.js'), 'utf8');
    assert(/type === 'set_macro_lanes'/.test(srvJs), 'the bridge accepts them');
    assert(/macro_printed/.test(srvJs), 'and reports which were printed');
    const shim = fs.readFileSync(path.join(ROOT, '..', 'stride-wrapper', 'm0-spike', 'ui', 'shim.js'), 'utf8');
    assert(/set_macro_lanes/.test(shim), 'the shim pushes them');
    assert(/setLanesPrinted/.test(shim), 'and forwards the result to the ENGINE, not just the canvas');
    assert(/_sb\.announced/.test(shim), 'announce fires ONCE: the nudge is a real gesture and would litter undo');
});

test('wrapper: per-lane DAW drive, persisted, and never a global mode switch', () => {
    const h = fs.readFileSync(path.join(ROOT, '..', 'stride-wrapper', 'm0-spike', 'src', 'PluginProcessor.h'), 'utf8');
    const cpp = fs.readFileSync(path.join(ROOT, '..', 'stride-wrapper', 'm0-spike', 'src', 'PluginProcessor.cpp'), 'utf8');
    assert(/bool hostDriven = false; \};/.test(h), 'MapRef carries it, LAST so the restore aggregate-inits still compile');
    assert(/std::vector<char> hdr; \};/.test(h), 'and the remove/undo snapshot carries it');
    assert(/setLaneHostDrivenAt \(int mappedIndex, bool on\)/.test(h), 'addressed by the same lane id the canvas uses');
    assert(/mr->hostDriven/.test(cpp), 'the drive loop reads it per lane');
    assert(/setAttribute \("hd", 1\)/.test(cpp) && /getIntAttribute \("hd", 0\)/.test(cpp),
           'persisted both ways: reopening a set must not put Stride back on a printed knob');
    assert(/clearAllHostDriven/.test(cpp), 'TAKE BACK returns every lane');
});

test('bug: the transport is re-read before anything re-binds (the Ctrl+Z lock)', () => {
    const srvJs = fs.readFileSync(path.join(BRIDGE, 'bridge-server.js'), 'utf8');
    const maxJs = fs.readFileSync(path.join(BRIDGE, 'bridge_max.js'), 'utf8');
    assert(/function transportnow/.test(maxJs), 'an UNCONDITIONAL report exists');
    assert(!/if \(on === _lastPlay\) return;[\s\S]{0,120}function transportnow/.test(maxJs),
           'and it is not gated by the change latch');
    // handleTakeBack must ask BEFORE it unparks, or a stale "playing" takes a
    // live.remote~ lock and the knob cannot be moved or undone by hand.
    const tb = srvJs.slice(srvJs.indexOf('function handleTakeBack'));
    const probeAt = tb.indexOf("_out(['probe', 'transportnow'])");
    const unparkAt = tb.indexOf('unparkLane(');
    assert(probeAt > 0 && probeAt < unparkAt, 'asked before the first unpark');
    assert(/function tick[\s\S]{0,200}transportnow/.test(srvJs), 'and the ping refreshes it, so staleness cannot outlive one tick');
});

test('canvas: Stride refuses to map its OWN macro as a second lane', () => {
    const canvas = fs.readFileSync(path.join(ROOT, 'app', 'renderer', 'canvas.js'), 'utf8');
    const fn = canvas.slice(canvas.indexOf('window.sdBridgeMapped ='), canvas.indexOf('window.sdBridgeAdoptLanes'));
    assert(/x\.device \? x\.device \+ ': ' \+ x\.name/.test(fn),
           'matches the DAW-facing macro name "<device>: <param>"');
    assert(/press Inject to print it/.test(fn), 'and points at the thing that actually does the job');
    assert(fn.indexOf('—') < 0, 'no em dashes in the copy');
});

test('canvas save: a HOSTED lane carries the identity the macro inject needs', () => {
    // The bug, 2026-08-31: the state handed to saveCanvasState carried name/device only
    // for _live lanes. For hosted lanes both were undefined, so the shim built an EMPTY
    // macro name ("<device>: <param>") and its own filter dropped every hosted lane. The
    // inject then looked like it worked and silently printed only the Ableton knobs.
    const canvas = fs.readFileSync(path.join(ROOT, 'app', 'renderer', 'canvas.js'), 'utf8');
    const i = canvas.indexOf('await window.stride.saveCanvasState');
    assert(i > 0, 'found the save call');
    const block = canvas.slice(canvas.lastIndexOf('const state = sdCanvasParams', i), i);
    assert(/\.\.\.\(p\._live \? \{\} : \{ name: p\.name/.test(block),
           'hosted lanes carry name + device, or the macro name comes out empty');
    assert(/hostPrinted/.test(block), 'and their printed flag, so it survives a save');
    // the shim builds the DAW-facing name from exactly those two fields
    const shim = fs.readFileSync(path.join(ROOT, '..', 'stride-wrapper', 'm0-spike', 'ui', 'shim.js'), 'utf8');
    assert(/macro: \(l\.device \? l\.device \+ ': ' : ''\) \+ \(l\.name \|\| ''\)/.test(shim),
           'shim composes "<device>: <param>" from the fields the canvas now sends');
    assert(/window\.sdMacroPrinted = function/.test(canvas), 'and the canvas records the hosted printed echo');
});

test('diagnostic: last_inject.json says whether hosted lanes were pushed at all', () => {
    // Without this the two failure modes look identical from the outside: "the shim never
    // pushed it" and "Live could not resolve the macro" both end as a short count.
    const srvJs = fs.readFileSync(path.join(BRIDGE, 'bridge-server.js'), 'utf8');
    assert(/macrosPushed:/.test(srvJs), 'records how many hosted lanes reached the bridge');
    assert(/macros: \(\(\) =>/.test(srvJs), 'and names them');
});

console.log('\n— unit: a hosted lane comes BACK from the DAW —');

test('drawing on a printed hosted lane takes it back (the bridge owns the flag, not the client)', () => {
    // The bug, 2026-08-31: set_macro_lanes copied `printed` straight from the client on
    // every push, so the flag only ever changed when the bridge said so. Drawing on a
    // printed Serum lane left it stuck on the injected automation, while the Ableton
    // lanes (which DO compare a shape signature) came back correctly.
    const c = fakeClient(); const mine = new Set([c]);
    const push = ls => srv.handleClientMessage(c, { type: 'set_macro_lanes', bars: 4, lanes: ls });
    const A = [{ time: 0, value: 0, curve: 0 }, { time: 16, value: 1, curve: 0 }];
    const B = [{ time: 0, value: 0, curve: 0 }, { time: 8, value: 0.5, curve: 0 }, { time: 16, value: 1, curve: 0 }];

    push([{ pos: 0, macro: 'Serum: WT Pos', points: A, speed: 1 }]);
    c.macros[0].printed = true; c.macros[0].printedSig = srv.macroSig('Serum: WT Pos', 4, 1, A);
    c.sent.length = 0;

    push([{ pos: 0, macro: 'Serum: WT Pos', points: A, speed: 1 }]);        // same shape
    assert(c.macros[0].printed === true, 'an unchanged push leaves it with the DAW');
    assert(!c.sent.some(m => m.type === 'macro_printed'), 'and says nothing');

    push([{ pos: 0, macro: 'Serum: WT Pos', points: B, speed: 1 }]);        // the user drew
    assert(c.macros[0].printed === false, 'a redraw takes the knob back');
    const m = c.sent.find(x => x.type === 'macro_printed' && x.printed === false);
    assert(m && m.pos.indexOf(0) >= 0, 'and the ENGINE is told, or Stride never resumes driving it');
});

test('a persisted hosted printed flag is honoured ONCE, on the first push after a reload', () => {
    const c = fakeClient();
    srv.handleClientMessage(c, { type: 'set_macro_lanes', bars: 4, lanes: [
        { pos: 0, macro: 'Serum: WT Pos', points: [{ time: 0, value: 0, curve: 0 }], printed: true } ] });
    assert(c.macros[0].printed === true, 'reopening a set must not put Stride back on a printed knob');
});

test('TAKE BACK returns EVERY hosted lane, including ones printed in an earlier session', () => {
    const c = fakeClient(); const mine = new Set([c]);
    srv.handleClientMessage(c, { type: 'set_macro_lanes', bars: 4, lanes: [
        { pos: 0, macro: 'Serum: WT Pos', points: [{ time: 0, value: 0, curve: 0 }], printed: true },
        { pos: 1, macro: 'Serum: Cutoff', points: [{ time: 0, value: 1, curve: 0 }], printed: true } ] });
    c.sent.length = 0;
    srv.handleTakeBack(mine);
    assert(!c.macros[0].printed && !c.macros[1].printed, 'both back on Stride');
    const m = c.sent.find(x => x.type === 'macro_printed');
    assert(m && m.printed === false, 'told');
    assert(Array.isArray(m.pos) && m.pos.length === 0,
           'an EMPTY list on purpose: "return everything", so the engine never has to trust '
         + 'this side about which indices are printed');
});

console.log('\n— struct: the inject never destroys MIDI —');

test('arrangement inject: the clip is NEVER shortened, and no note is dropped', () => {
    // The bug: the replacement was built at exactly the requested bar count, so injecting
    // a 4-bar curve onto an 8-bar part shortened the clip and discarded every note past
    // bar 4. Silent MIDI loss.
    const py = fs.readFileSync(path.join(ROOT, 'remote_script', 'StrideInject', '__init__.py'), 'utf8');
    assert(/L_clip = max\(L_new, orig_len\)/.test(py), 'the replacement is at least as long as the original');
    assert(/slot\.create_clip\(_d\(L_clip\)\)/.test(py), 'and is BUILT at that length');
    assert(/self\._read_clip_notes\(original_clip, L_clip\)/.test(py), 'notes are read across the whole clip');
    assert(/float\(n\.get\("time", 0\)\) < L_clip - 1e-6/.test(py), 'and filtered against it, never the drawn window');
    assert(!/< L_new - 1e-6/.test(py), 'the old requested-length cut is gone');
    // the curves still map across the DRAWN window, not the whole clip
    assert(/_apply_curves_sync\(temp, data\.get\("params", \[\]\), L_new\)/.test(py),
           'curves keep mapping across the drawn window, so the shape means what it looked like');
});

test('take back beats the GLOBAL DAW mode, or a hosted lane can never come home', () => {
    // DriveMode::Automation makes EVERY hosted lane read its macro, so a lane un-printed
    // underneath it still follows the DAW: take back and redraw both look like no-ops.
    // That is the "Serum param has a life of its own" report (2026-08-31).
    const ed = fs.readFileSync(path.join(ROOT, '..', 'stride-wrapper', 'm0-spike', 'src', 'PluginEditor.cpp'), 'utf8');
    const fn = ed.slice(ed.indexOf('"setLanesPrinted"'), ed.indexOf('"setPin"'));
    assert(/if \(! on\) proc\.setDriveMode \(StrideWrapperProcessor::DriveMode::Live\);/.test(fn),
           'un-printing anything returns the global mode to Live');
    assert(fn.indexOf('setDriveMode') < fn.indexOf('clearAllHostDriven'),
           'and does it BEFORE clearing, so no block can run in the wrong mode');
});

test('diagnostic: last_inject.json reports the global drive mode', () => {
    // Without it, "stuck hosted lane" and "the whole plugin is in DAW mode" look identical.
    const srvJs = fs.readFileSync(path.join(BRIDGE, 'bridge-server.js'), 'utf8');
    assert(/driveMode: \(\(\) =>/.test(srvJs), 'recorded');
    assert(/client\.driveMode = msg\.drive_mode/.test(srvJs), 'from the VST push');
    const shim = fs.readFileSync(path.join(ROOT, '..', 'stride-wrapper', 'm0-spike', 'ui', 'shim.js'), 'utf8');
    assert(/drive_mode: _sb\.driveMode \| 0/.test(shim), 'the shim sends it');
    assert(/_sb\.driveMode = _driveMode/.test(shim), 'mirrored where every scope can read it');
});

test('bars pills: EVERY loop-length button tells the engine, not just the compact ones', () => {
    // Field report via Giorgio, 2026-08-31: "generate lanes for 4 bars, extend to 32, the
    // modulation stops". The wrapper had TWO bar toolbars: the compact one called
    // sdSetBarsAndPush (which saves, so the engine's driveClipBeats follows), the main one
    // called plain sdSetBars, which only redraws the grid. The engine then kept wrapping the
    // clip phase at the OLD length while the canvas drew the new one, so what played had
    // nothing to do with what was on screen.
    const html = fs.readFileSync(path.join(ROOT, '..', 'stride-wrapper', 'm0-spike', 'ui', 'index.html'), 'utf8');
    const bare = html.match(/onclick="sdSetBars\(\d+\)"/g) || [];
    assert(bare.length === 0, 'a bars pill that does not push: ' + bare.join(', '));
    const pushing = html.match(/onclick="sdSetBarsAndPush\(\d+\)"/g) || [];
    assert(pushing.length >= 9, 'both toolbars still wired: ' + pushing.length);
});

test('a printed hosted lane does not un-print itself on a float round trip', () => {
    // THE bug, 2026-08-31: printing a hosted lane called pushRackScanned(), which rebuilds
    // every canvas lane from the engine's payload. A hosted lane's POINTS are replaced from
    // the engine's stored curve on that rebuild (live lanes are preserved, which is why the
    // Ableton half never showed it). The echoed floats differ in the last digit, the next
    // push looked like a redraw, and the bridge took the lane straight back - so the knob in
    // Ableton parked while Stride kept modulating the hosted Serum underneath.
    const c = fakeClient();
    const push = ls => srv.handleClientMessage(c, { type: 'set_macro_lanes', bars: 4, lanes: ls });
    const drawn  = [{ time: 0, value: 0.25, curve: 0 }, { time: 16, value: 0.75, curve: 0.5 }];
    // the same curve after a float round trip through the engine
    const echoed = [{ time: 0.000000012, value: 0.25000003, curve: 0 }, { time: 16, value: 0.74999997, curve: 0.5 }];

    push([{ pos: 0, macro: 'Serum: WT Pos', points: drawn, speed: 1 }]);
    c.macros[0].printed = true;
    c.macros[0].printedSig = srv.macroSig('Serum: WT Pos', 4, 1, drawn);
    c.sent.length = 0;

    push([{ pos: 0, macro: 'Serum: WT Pos', points: echoed, speed: 1 }]);
    assert(c.macros[0].printed === true,
           'a float-identical echo is NOT an edit: the lane stays with the DAW');
    assert(!c.sent.some(m => m.type === 'macro_printed'), 'and nothing is sent back');

    // a REAL edit still takes it back
    push([{ pos: 0, macro: 'Serum: WT Pos', points: [{ time: 0, value: 0.9, curve: 0 }, { time: 16, value: 0.1, curve: 0 }], speed: 1 }]);
    assert(c.macros[0].printed === false, 'a genuine redraw still returns the lane to Stride');
});

test('printing a lane never triggers a canvas rebuild', () => {
    const ed = fs.readFileSync(path.join(ROOT, '..', 'stride-wrapper', 'm0-spike', 'src', 'PluginEditor.cpp'), 'utf8');
    const fn = ed.slice(ed.indexOf('"setLanesPrinted"'), ed.indexOf('"setPin"'));
    const code = fn.split('\n').filter(l => !l.trim().startsWith('//')).join('\n');
    assert(!/pushRackScanned\s*\(\)\s*;/.test(code),
           'pushRackScanned in setLanesPrinted replaces hosted lane points and un-prints the lane');
});

test('inject never drops a first-bar note on a non-integer-length clip', () => {
    // Field report 2026-08-31: "inject over a 4 bar loop deleted the 1st bar midi,
    // sometimes". The clip was at start_time 63.99 with length 16.01, so a note at the
    // very start reads back a hair BELOW zero, and the validator threw it away as
    // out of range. Intermittent because it depends on where the rounding lands.
    const py = fs.readFileSync(path.join(ROOT, 'remote_script', 'StrideInject', '__init__.py'), 'utf8');
    assert(/if -0\.02 < start < 0\.0:/.test(py), 'a hair-negative start is nudged onto the grid');
    assert((py.match(/if -0\.02 < start < 0\.0:/g) || []).length === 2,
           'in BOTH note writers (fresh clip + shared), or one path still eats notes');
    assert(/dropped an out-of-range note/.test(py), 'and a genuine drop is logged, never silent');
    assert(/_d\(-0\.25\)/.test(py),
           'the read starts BEFORE zero: a clip that does not begin on a beat boundary can hold '
         + 'its first note at a marginally negative content time, invisible to a read from 0.0');
    assert(/_d\(float\(length\) \+ 0\.50\)/.test(py), 'and runs past the end for the same reason');
    assert(/arr read %d note\(s\)/.test(py), 'read count is logged next to the written count');
});

test('the print ack carries counts but never lane data', () => {
    const ed = fs.readFileSync(path.join(ROOT, '..', 'stride-wrapper', 'm0-spike', 'src', 'PluginEditor.cpp'), 'utf8');
    const fn = ed.slice(ed.indexOf('"setLanesPrinted"'), ed.indexOf('"setPin"'));
    const code = fn.split('\n').filter(l => !l.trim().startsWith('//')).join('\n');
    assert(/lanes_printed_ack/.test(code), 'a light ack exists');
    assert(!/pushRackScanned\s*\(\)\s*;/.test(code), 'and it is NOT a rack rebuild');
    assert(!/points/.test(code), 'the ack carries no lane points, so it cannot disturb a curve');
    const shim = fs.readFileSync(path.join(ROOT, '..', 'stride-wrapper', 'm0-spike', 'ui', 'shim.js'), 'utf8');
    assert(/lanes_printed_ack/.test(shim), 'the shim consumes it');
});

test('a curve shorter than the loop REPEATS, it does not freeze', () => {
    // Field report 2026-08-31, reproduced precisely by Yossi: playing a 4-bar loop with
    // 4 bars in Stride, press 16 bars mid-playback and the modulation dies instantly.
    // ph = fmod(beats, clipBeats) now spans 64 beats while the drawn curve covers 16, so
    // wherever the playhead sits it is usually past the end and interp() holds the final
    // value forever. It did not degrade after bar 4, it stopped on the spot.
    const cpp = fs.readFileSync(path.join(ROOT, '..', 'stride-wrapper', 'm0-spike', 'src', 'PluginProcessor.cpp'), 'utf8');
    const drive = cpp.slice(cpp.indexOf('double lx = std::fmod'), cpp.indexOf('const float v = interp'));
    assert(/const double span = lane\.times\.empty\(\) \? 0\.0 : \(double\) lane\.times\.back\(\);/.test(drive),
           'the curve span is measured');
    assert(/while \(wrap < span - 1\.0e-6 && wrap < lL\) wrap \*= 2\.0;/.test(drive),
           'the wrap is a Stride BAR option, not the raw span: a curve ending at bar 3.5 must '
         + 'still cycle every 4 bars, not every 3.5');
    assert(/if \(wrap < lL - 0\.01\)/.test(drive),
           'a curve that already fills the loop is untouched, so existing projects are unchanged');
    assert(/lx = std::fmod \(lx, wrap\);/.test(drive), 'and the phase wraps at it');
});

test('a lane whose device left the set is MARKED, never deleted', () => {
    // Deleting the lane would take its drawn curve with it, and the repath probe is
    // known to flake (see the Mac field note in handleRepathed, 2026-08-28). So a
    // vanished device greys the row out and keeps everything: undo the delete in
    // Ableton, or drag the device back, and the lane rebinds with its motion intact.
    //
    // Runs fully SYNCHRONOUSLY and puts state.clients back, so the TCP and MAP LIVE
    // tests parked on real timers never observe this client.
    const c = fakeClient();
    const savedClients = srv.state.clients;
    srv.state.clients = new Set([c]);
    try {
        srv.handleClientMessage(c, { type: 'set_live_lanes', bars: 4, lanes: [LANE(P1, 'Drive', 'Roar')] });
        const lane = srv.lanesOf(c)[P1];
        lane.voice = srv.allocVoice();
        const v = srv.state.voices[lane.voice];
        v.id = 777; v.lane = lane;
        c.sent.length = 0;

        const sweep = ok => {
            const rid = srv.state.nextRid++;
            srv.state.pending[rid] = { kind: 'repath' };
            srv.state.repathRid = rid;
            srv.handleRepathed(enc({ rid: rid, items: [{ id: 777, ok: ok, path: ok ? P1 : undefined }] }));
        };

        sweep(0);
        assert(!lane.missing, 'a single flake must never mark a lane');

        for (let i = 0; i < 8; i++) sweep(0);
        assert(lane.missing === true, 'a device that stays gone is marked');

        // and an id that STILL RESOLVES but now reports a different device is gone too:
        // a stale LOM id can keep answering after its device is deleted, so "it answered"
        // was never proof the knob is in the set (field 2026-08-31: lanes stayed bright).
        lane.missing = false; v.missCount = 0;
        for (let i = 0; i < 8; i++) {
            const rid = srv.state.nextRid++;
            srv.state.pending[rid] = { kind: 'repath' };
            srv.state.repathRid = rid;
            srv.handleRepathed(enc({ rid: rid, items: [{ id: 777, ok: 1, path: P1,
                                                         name: 'Flt 3 Freq', dev: 'Some Other Device' }] }));
        }
        assert(lane.missing === true, 'resolved, but it is a different device now: still gone');
        const m = c.sent.find(x => x.type === 'lane_missing' && x.missing === true);
        assert(m && m.path === P1, 'and the canvas is told which lane');
        assert(srv.lanesOf(c)[P1] === lane, 'the lane itself is NOT deleted');
        assert(lane.voice !== 0, 'and the bind is kept, so it heals the moment the device answers');

        c.sent.length = 0;
        sweep(1);
        assert(lane.missing === false, 'reconnected');
        assert(c.sent.some(x => x.type === 'lane_missing' && x.missing === false), 'and the canvas is told');
    } finally {
        srv.state.clients = savedClients;
    }
});

test('a suspected removal is confirmed FAST, not once per 5s ping', () => {
    // Confirming at the ping rate cost MISS_TO_MISSING * 5s = 25s before the row greyed,
    // which reads as broken (field 2026-08-31: "it took around 20 seconds"). The probe
    // rate goes up the moment something stops answering, so the verdict lands in about
    // 3 seconds while still needing the same number of agreeing probes.
    const srvJs = fs.readFileSync(path.join(BRIDGE, 'bridge-server.js'), 'utf8');
    assert(/const FAST_REPATH_MS = 600;/.test(srvJs), 'a fast confirmation rate exists');
    assert(/function scheduleFastRepath\(\)/.test(srvJs), 'and a scheduler for it');
    assert(/v\.missCount > 0 && v\.missCount < MISS_TO_MISSING\) \{ scheduleFastRepath\(\); break; \}/.test(srvJs),
           'armed only while a lane is mid-confirmation, so an idle set never polls faster');
    assert(/const MISS_TO_MISSING = 5;/.test(srvJs),
           'the number of agreeing probes is UNCHANGED: speed must not buy false positives');
    // and the burst must not re-probe healthy lanes: every item costs two LiveAPI
    // lookups on Live's MAIN thread, so a 32-voice sweep at 600ms is real UI load.
    assert(/function repathSweep \(?\(suspectsOnly\)/.test(srvJs.replace('repathSweep(suspectsOnly)', 'repathSweep (suspectsOnly)')),
           'the sweep can be narrowed');
    assert(/repathSweep\(true\);\s+\/\/ the suspects only/.test(srvJs),
           'and the fast path narrows it, so an unrelated lane is never re-probed at 600ms');
    // 5 probes at 600ms is a few seconds, not half a minute
    const budget = 5 * 600;
    assert(budget < 5000, 'confirmation budget is seconds, not tens of seconds');
});

test('the missing lane fades with the SAME treatment as the loop cutoff', () => {
    const canvas = fs.readFileSync(path.join(ROOT, 'app', 'renderer', 'canvas.js'), 'utf8');
    assert(/if \(param\._missing\) \{[\s\S]{0,400}rgba\(0,0,0,0\.42\)/.test(canvas),
           'same scrim colour/alpha the loop boundary uses past its cutoff');
    assert(/if \(param\._missing\) sdCtx\.globalAlpha = 0\.22;/.test(canvas),
           'and the curve itself dims, so the whole row reads as dead');
    assert(/window\.sdBridgeMissing = function/.test(canvas), 'the canvas records the bridge verdict');
    const shim = fs.readFileSync(path.join(ROOT, '..', 'stride-wrapper', 'm0-spike', 'ui', 'shim.js'), 'utf8');
    assert(/lane_missing/.test(shim), 'the shim routes it');
});

test('StrideBridge places StrideInject itself: the ship has NO installer in it', () => {
    // The VST3 download is Stride.vst3 + StrideBridge + StrideInject and nothing else:
    // no Stride.exe, so the desktop app's "Install to Ableton" does not exist for these
    // users. Hand-copying a Python folder into Remote Scripts as step one is a bad first
    // run, and getting it wrong just makes INJECT say STRIDEINJECT? with no clue why.
    const os_ = require('os');
    const root = fs.mkdtempSync(path.join(os_.tmpdir(), 'sb_ul_'));
    const bridgeDir = path.join(root, 'StrideBridge');
    fs.mkdirSync(path.join(bridgeDir, 'StrideInject'), { recursive: true });
    fs.writeFileSync(path.join(bridgeDir, 'StrideInject', '__init__.py'), 'NEW SCRIPT\n');
    fs.writeFileSync(path.join(bridgeDir, 'StrideInject', '_curve.py'), 'curve\n');

    const dst = path.join(root, 'Remote Scripts', 'StrideInject');

    const wasPlaced = srv.state.siPlaced;
    srv.state.siPlaced = '';

    // 1. fresh machine: nothing there yet
    srv.installStrideInject(bridgeDir);
    assert(fs.readFileSync(path.join(dst, '__init__.py'), 'utf8') === 'NEW SCRIPT\n', 'installed');
    assert(fs.existsSync(path.join(dst, '_curve.py')), 'every .py comes along, not just __init__');
    assert(srv.state.siPlaced === 'new', 'recorded as a first install, got ' + srv.state.siPlaced);

    // 2. an OLD copy from the desktop app is updated IN PLACE under the same folder
    //    name, so the user's Control Surface choice keeps pointing at it
    fs.writeFileSync(path.join(dst, '__init__.py'), 'OLD SCRIPT\n');
    fs.mkdirSync(path.join(dst, '__pycache__'), { recursive: true });
    fs.writeFileSync(path.join(dst, '__pycache__', 'stale.pyc'), 'x');
    srv.installStrideInject(bridgeDir);
    assert(fs.readFileSync(path.join(dst, '__init__.py'), 'utf8') === 'NEW SCRIPT\n', 'updated in place');
    assert(!fs.existsSync(path.join(dst, '__pycache__')),
           'stale bytecode cleared, or Live keeps importing the OLD script after the source is replaced');
    // This is the existing StrideLink user. Live is still running the copy it imported at
    // launch, so INJECT has to say "restart" rather than send them hunting a shadow copy.
    assert(srv.state.siPlaced === 'updated', 'recorded as an update, got ' + srv.state.siPlaced);

    // 3. already current: a no-op, and it must not throw
    srv.state.siPlaced = '';
    srv.installStrideInject(bridgeDir);
    assert(fs.readFileSync(path.join(dst, '__init__.py'), 'utf8') === 'NEW SCRIPT\n', 'still current');

    // Every launch AFTER the update runs this path, so a sticky flag here would leave the
    // face telling the user to restart Live forever.
    assert(srv.state.siPlaced === '', 'a no-op claims nothing, got ' + srv.state.siPlaced);

    // 4. a dev checkout with nothing bundled beside it does nothing at all
    const bare = fs.mkdtempSync(path.join(os_.tmpdir(), 'sb_bare_'));
    srv.installStrideInject(path.join(bare, 'StrideBridge'));
    assert(!fs.existsSync(path.join(bare, 'Remote Scripts')), 'no bundle, no install, no crash');
    srv.state.siPlaced = wasPlaced;   // the inject test reads it when it resumes

    fs.rmSync(root, { recursive: true, force: true });
    fs.rmSync(bare, { recursive: true, force: true });
});

test('both zips carry StrideInject, or there is no way to get it', () => {
    const wf = fs.readFileSync(path.join(ROOT, '..', '.github', 'workflows', 'build-vst3.yml'), 'utf8');
    assert(/StrideBridge\/StrideInject/.test(wf) && /remote_script\/StrideInject\/__init__\.py/.test(wf),
           'windows zip ships the Remote Script');
    const mac = fs.readFileSync(path.join(ROOT, '..', 'stride-wrapper', 'm0-spike', 'ci', 'build-mac-vst3.sh'), 'utf8');
    assert(/StrideBridge\/StrideInject/.test(mac) && /remote_script\/StrideInject\/__init__\.py/.test(mac),
           'mac zip ships it too');

    // A substring grep is not enough: v2.0.7 shipped with one ../ too many in exactly
    // these lines, sailed through build, sign, notarize and staple, then died on the
    // final copy after three minutes of CI. Resolve every source path the mac script
    // reads out of the repo, from the SCRIPT_DIR it defines, and check it is there.
    const macDir = path.join(ROOT, '..', 'stride-wrapper', 'm0-spike');    // = SCRIPT_DIR
    const srcs = [...mac.matchAll(/cp\s+"\$SCRIPT_DIR(\/[^"]+)"/g)].map(m => m[1]);
    assert(srcs.length >= 3, 'found the SCRIPT_DIR-relative copies, got ' + srcs.length);
    srcs.forEach(rel => {
        assert(fs.existsSync(path.join(macDir, rel)),
               'build-mac-vst3.sh copies $SCRIPT_DIR' + rel + ' which is not there: check the ../ depth');
    });
    const readme = fs.readFileSync(path.join(BRIDGE, 'README-StrideBridge.txt'), 'utf8');
    assert(/Control Surface > StrideInject/.test(readme), 'README covers the one manual step left');
    assert(readme.indexOf('—') < 0, 'README: no em dashes');
});

test('LOCAL BUILD FRESHNESS: a built Stride.vst3 must embed the CURRENT shim.js', () => {
    // shim.js and canvas.js are compiled into the plugin by juce_add_binary_data, so
    // editing them and shipping an older binary fails SILENTLY: the plugin loads, the
    // UI looks right, and the new messages are simply never sent. That happened on
    // 2026-08-31 (macro lanes edited at 12:13, binary built 12:11) and cost a full
    // test round trip in Live. Skipped when there is no local build, so CI is unaffected.
    const vst = path.join(ROOT, '..', 'stride-wrapper', 'm0-spike', 'build',
                          'StrideWrapperM0_artefacts', 'Release', 'VST3', 'Stride.vst3',
                          'Contents', 'x86_64-win', 'Stride.vst3');
    if (!fs.existsSync(vst)) return;                       // no local build: nothing to check

    const shim = path.join(ROOT, '..', 'stride-wrapper', 'm0-spike', 'ui', 'shim.js');
    const canvas = path.join(ROOT, 'app', 'renderer', 'canvas.js');
    const built = fs.statSync(vst).mtimeMs;
    [shim, canvas].forEach(f => {
        assert(fs.statSync(f).mtimeMs <= built,
               path.basename(f) + ' is NEWER than the built Stride.vst3: rebuild before deploying, '
             + 'or the plugin ships without those UI changes');
    });

    // and the binary really does carry the markers, not just a newer timestamp
    const bin = fs.readFileSync(vst, 'latin1');
    ['set_macro_lanes', 'setLanesPrinted', 'lane_printed'].forEach(marker => {
        assert(bin.indexOf(marker) >= 0, 'built binary is missing "' + marker + '" from shim.js');
    });
});

Promise.all(_asyncQueue).then(() => {
    console.log(`\n${passed} passed, ${failed} failed\n`);
    process.exit(failed);
});
