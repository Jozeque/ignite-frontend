/**
 * StrideBridge — node.script server inside StrideBridge.amxd
 *
 * The output stage that lets Stride VST modulate Ableton's OWN devices.
 * VST link = JSON-lines TCP on :9102 (the WebView cannot open sockets, the
 * plugin's native side connects). :9101 WebSocket is dev tooling only.
 *
 * NOTHING STREAMS. The VST pushes a lane's curve once per edit; this server
 * rasterizes it with the shared rasterizer (lockstep with the canvas draw
 * math), writes a float32 WAV into the OS temp dir, and tells the patcher's
 * voice to `replace` its buffer~. Playback is phasor~ @lock 1 against Live's
 * transport — sample-accurate, zero scheduler traffic, immune to the ~100ms
 * LOM tick that killed every envelope-based approach.
 *
 * Division of labour:
 *   this file      — protocol, lane identity, voice allocation, rasterize→WAV
 *   bridge_max.js  — everything LiveAPI (map-by-click probe, path→id resolve,
 *                    name search, relink, repath, selection hints, pong);
 *                    node.script cannot touch LiveAPI, [js] can
 *   StrideBridge.maxpat — 32 inline voices + routing fabric + the device face
 *
 * LANE IDENTITY (the portable-rack lesson, 2026-08-26):
 *   A lane remembers its knob by ADDRESS (LOM path) and by NAME (device +
 *   parameter). Addresses are stale the moment a rack is grouped, moved,
 *   copied or duplicated; names are ambiguous the moment the set holds two of
 *   the same device. A plugin cannot learn where it sits in Live, so a rack
 *   COPY next to its original carries the original's addresses and would
 *   happily drive the original's knobs. The rules, in order:
 *     1. resolve the address; verify device + parameter NAME. A mismatch never
 *        binds a stranger's knob.
 *     2. a knob already driven by ANOTHER open Stride window is a conflict:
 *        look for a free twin by name instead of stealing.
 *     3. SELECTION HINT: Live tells us what the user just selected (a rack
 *        drop, a track duplicate, a click on the wrench all select something).
 *        A Stride that connects within HINT_FRESH_MS of a selection and whose
 *        address points at ANOTHER track is treated as a copy: its twin under
 *        the selected device/track is home. Hints apply to a client's FIRST
 *        push only, never to later edits.
 *     4. exactly one free candidate by name: take it. Otherwise say so and
 *        offer RELINK: while MAP LIVE is armed, clicking a device's title bar
 *        moves every lane of that device NAME onto THAT device (forced).
 *   Voices are keyed by the RESOLVED TARGET ID (session-stable), lanes are
 *   per client. Closing the editor orphans its voices (modulation keeps
 *   running); reopening reclaims them by target. Bound targets are re-pathed
 *   every REPATH_MS so the stored address heals in-session (grouping/reorder).
 *
 * MULTI-BRIDGE: only one instance owns :9102, the others stand by (3s retry)
 * and their face says so. The active one binds any knob in the set. A patcher
 * that stops answering pings (a leaked node process) yields the port.
 *
 * THREE DRIVE PATHS, chosen per lane once its target is known (laneMode):
 *   'r' live.remote~   audio rate, NATIVE values (remote~ does not normalize; the
 *                      0..1 era survived only because stock devices mostly report a
 *                      native 0..1). Instruments, audio effects, the mixer. No undo cost.
 *   'q' live.object    menus/enums: NATIVE option index, rounded, written on step
 *                      transitions only. live.remote~ cannot drive enums (field 08-26).
 *   'c' live.object    MIDI-effect parameters (Arpeggiator, Chord, Scale...): NATIVE
 *                      continuous values, log-aware, snapped to CONTROL_STEPS levels and
 *                      sampled at SNAPSHOT_MS. live.remote~ silently does not take those
 *                      params (field 08-27: no movement, no error anywhere).
 * The two live.object paths cost one Live undo step per write, which is why they are
 * rate-limited: the LOM has no undo-grouping call (no begin_gesture, no begin_undo_step).
 */

'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');

const { rasterizeCurve } = require('./rasterizer.js');

// max-api only exists inside node.script. Unit tests inject a stub.
let Max = null;
try { Max = require('max-api'); } catch (e) { Max = null; }

const PORT = 9101;          // WebSocket (dev tooling / future use)
const TCP_PORT = 9102;      // JSON-lines TCP - the VST's C++ transport
const NUM_VOICES = 32;      // rack copies double the bank: 16 was one rack
const SAMPLES_PER_BAR = 2048;          // wave~ interpolates; 2048/bar is dense for modulation
const MAX_SAMPLES = 262144;            // cap: 128 bars worth
const TICKS_PER_BAR = 1920;            // 4 beats * 480 ticks
const MAP_TIMEOUT_MS = 120000;  // idle window while ARMED - slides on every map and every device
                                // click. 30s was too tight: dragging a new device in mid-session
                                // silently disarmed it (field 2026-08-27).
const HINT_FRESH_MS = 10000;    // a selection this recent says WHERE a connecting Stride lives
const PING_MS = 5000;           // patcher liveness + repath cadence
const PONG_TIMEOUT_MS = 20000;  // silent patcher = leaked node process: yield the port
const NO_PONG_BOOT_MS = 30000;  // never answered at all since boot: same verdict, no first pong required
const ARM_ACK_MS = 1500;        // MAP LIVE must be ACKED by the [js] or the bridge admits it is unreachable
const REPATH_MS = PING_MS;      // bound ids -> current paths (heals grouping/reorder in-session)
// Control-rate lanes (MIDI-effect params) are written through Live's own setter, and
// EVERY set costs one undo step + one main-thread hop. Two limits keep that safe: the
// patcher samples those voices at SNAPSHOT_MS, and the curve itself is snapped to
// CONTROL_STEPS levels so [change] drops everything in between. A MIDI effect reads its
// parameters per generated note (an arp at 1/16 = 8 notes/s), so this is not coarse in
// practice. Field 2026-08-27: unquantized values at 33Hz over 3 lanes froze Live.
const CONTROL_STEPS = 48;
const SNAPSHOT_MS = 100;        // must match `snapshot~ <ms>` in build_main_patcher.py (a test pins it)

const TMP_DIR = path.join(os.tmpdir(), 'stride_bridge');

// ── state ────────────────────────────────────────────────────────────────
// voices[n] = { id, owner, lane, gen, sig, quant, suspended } | null   (n = 1..NUM_VOICES)
//   id     = the bound DeviceParameter id (0 = free slot waiting for a target)
//   owner  = the connected client, or null once its editor closed (orphan: keeps playing)
//   lane   = the lane object driving it
// client.lanes[path] = { client, path, expectName, expectDevice, quant, norm, sig, voice, resolving }
const state = {
    voices: new Array(NUM_VOICES + 1).fill(null),
    clients: new Set(),
    mapping: null,                     // the client that pressed Map, while armed
    mapTimer: null,
    playing: true,                     // transport gate: stopped = continuous binds released
    lastSel: { track: '', device: '', at: 0 },   // gesture-driven selection hint (see header)
    pending: {},                       // rid -> probe context (resolve / find / relink / repath)
    nextRid: 1,
    repathRid: 0,
    pongAt: 0, pongSeen: false, yielded: false, bootAt: 0, armTimer: null,
    active: false,                     // owns the TCP port
};

const listeners = [];                  // port owners: { start(), stop() }

// ── plumbing that tests replace ──────────────────────────────────────────
let _out = function (atoms) { try { if (Max) Max.outlet.apply(Max, atoms); } catch (e) {} };
let _post = function (msg) { try { if (Max) Max.post('[StrideBridge] ' + msg); } catch (e) {} };

function _setIoForTest(outFn, postFn) { _out = outFn; _post = postFn || function () {}; }

// ── math ─────────────────────────────────────────────────────────────────
function ticksFor(bars, speed) {
    const s = (typeof speed === 'number' && speed > 0) ? speed : 1;
    const b = (typeof bars === 'number' && bars > 0) ? bars : 4;
    return Math.max(24, Math.round((b * TICKS_PER_BAR) / s));
}

// The voice runs a FIXED 1-bar phasor~ @lock 1 into rate~ (@sync lock), because a
// float to rate~'s right inlet is certain across Max versions where runtime
// tempo-value messages to phasor~ are not. rate~ scales the ramp PERIOD, so the
// factor for "the whole curve spans `bars`, played at `speed`" is bars/speed.
function rateFor(bars, speed) {
    const s = (typeof speed === 'number' && speed > 0) ? speed : 1;
    const b = (typeof bars === 'number' && bars > 0) ? bars : 4;
    return Math.max(0.0625, b / s);
}

function sampleCountFor(bars) {
    const b = (typeof bars === 'number' && bars > 0) ? bars : 4;
    return Math.min(MAX_SAMPLES, Math.max(SAMPLES_PER_BAR, Math.round(b * SAMPLES_PER_BAR)));
}

// Range baking happens VST-side (shim precedent from the live_curves flow); the
// server receives final 0..1 points and scales them into the parameter's NATIVE
// range - min/max/is_log come from the map-time probe and ride every push.
//
// EVERY drive path wants native values. live.remote~ included: it does NOT
// normalize (field 2026-08-27: a pitch param, -24..24 st, moved between 0 and 1
// semitone). The bridge shipped "normalized" anyway and got away with it because
// Live's stock devices mostly report min 0 max 1 natively - the two readings
// coincide there, byte for byte. scaleValue() is the shared scaling: linear, or a
// log taper for real-Hz ranges (shouldUseLog guards min<=0, so a 0..1 range can
// never be double-scaled no matter what the probe's is_log said).
// The modes differ only in what happens AFTER the scale:
//   'r' remote~     raw native samples, audio rate
//   'q' stepped     rounded to whole option indices (menus/enums via live.object)
//   'c' control     snapped to CONTROL_STEPS levels (MIDI effects via live.object,
//                   every distinct value costs one undo step + one main-thread hop)
function rasterizeLane(lane) {
    const bars = (typeof lane.bars === 'number' && lane.bars > 0) ? lane.bars : 4;
    const count = sampleCountFor(bars);
    const mode = lane.mode || (lane.is_quantized ? 'q' : 'r');
    const lo = (typeof lane.min === 'number' && isFinite(lane.min)) ? lane.min : 0;
    const hi = (typeof lane.max === 'number' && isFinite(lane.max) && lane.max > lo) ? lane.max : lo + 1;
    const buf = rasterizeCurve(lane.points || [], bars * 4, count,
                               { min: lo, max: hi, is_log: mode === 'q' ? false : !!lane.is_log, name: lane.name || '' });
    if (mode === 'q') {
        for (let i = 0; i < buf.length; i++) buf[i] = Math.round(buf[i]);
    } else if (mode === 'c') {
        const span = hi - lo;
        for (let i = 0; i < buf.length; i++)
            buf[i] = lo + Math.round(((buf[i] - lo) / span) * CONTROL_STEPS) * (span / CONTROL_STEPS);
    }
    return buf;
}

const MIDI_EFFECT = 4;   // LOM Device.type: 1 instrument, 2 audio effect, 4 MIDI effect

// Which drive path a lane takes (see rasterizeLane). Decided once the target is known.
function laneMode(lane) {
    if (lane.quant) return 'q';
    if (lane.devType === MIDI_EFFECT) return 'c';
    return 'r';
}

function refreshSig(lane) {
    if (!lane.norm) return;
    lane.norm.mode = laneMode(lane);
    lane.sig = laneSig(lane.norm);
}

// ── WAV writer: float32 mono, values written verbatim ────────────────────
function buildWav(samples) {
    const dataBytes = samples.length * 4;
    const buf = Buffer.alloc(44 + dataBytes);
    buf.write('RIFF', 0); buf.writeUInt32LE(36 + dataBytes, 4); buf.write('WAVE', 8);
    buf.write('fmt ', 12); buf.writeUInt32LE(16, 16);
    buf.writeUInt16LE(3, 20);                    // 3 = IEEE float
    buf.writeUInt16LE(1, 22);                    // mono
    buf.writeUInt32LE(44100, 24);                // nominal; playback is phase-driven
    buf.writeUInt32LE(44100 * 4, 28);
    buf.writeUInt16LE(4, 32); buf.writeUInt16LE(32, 34);
    buf.write('data', 36); buf.writeUInt32LE(dataBytes, 40);
    for (let i = 0; i < samples.length; i++) buf.writeFloatLE(samples[i], 44 + i * 4);
    return buf;
}

function writeVoiceWav(voiceN, gen, samples) {
    if (!fs.existsSync(TMP_DIR)) fs.mkdirSync(TMP_DIR, { recursive: true });
    // Alternate two filenames per voice so a replace never re-reads a file
    // that is being overwritten under it.
    const p = path.join(TMP_DIR, 'v' + voiceN + '_' + (gen % 2) + '.wav');
    fs.writeFileSync(p, buildWav(samples));
    return p;
}

// ── path helpers ─────────────────────────────────────────────────────────
function trackOf(p) {
    const m = /^live_set (tracks \d+|return_tracks \d+|master_track)/.exec(p || '');
    return m ? m[0] : '';
}
function deviceOf(paramPath) { return String(paramPath || '').replace(/ parameters \d+$/, ''); }
function under(p, container) {
    if (!container || !p) return false;
    return p === container || p.indexOf(container + ' ') === 0;
}
function isConnected(c) { return !!c && state.clients.has(c); }
function lanesOf(client) { if (!client.lanes) client.lanes = {}; return client.lanes; }
function laneLabel(lane) {
    return (lane.expectDevice ? lane.expectDevice + ' / ' : '') + (lane.expectName || lane.path);
}

// ── voices ───────────────────────────────────────────────────────────────
function voiceByTarget(id) {
    if (!id) return 0;
    for (let n = 1; n <= NUM_VOICES; n++) if (state.voices[n] && state.voices[n].id === id) return n;
    return 0;
}

function allocVoice() {
    for (let n = 1; n <= NUM_VOICES; n++) {
        if (!state.voices[n]) {
            state.voices[n] = { id: 0, owner: null, lane: null, gen: 0, sig: null, quant: false, suspended: false };
            return n;
        }
    }
    return -1;
}

function freeVoice(n) {
    if (n < 1 || n > NUM_VOICES || !state.voices[n]) return;
    _out(['voice', n, 'unbind']);
    state.voices[n] = null;
}

// The device face: ACTIVE (owns the VST link on :9102) / STANDBY. The lane count that
// used to sit under it is gone (2026-08-27, Yossi: not worth the space).
function _status() {
    _out(['status', 'set', (state.active && !state.yielded) ? 'ACTIVE' : 'STANDBY']);
}

// The stored "bl" blob (canvas save format) -> push lanes. MIRRORS shim.js _sbPush:
// range baked into the points (the bridge only ever sees final 0..1), legacy glyph
// stripped from the device label, pathless lanes dropped. Keep the two in lockstep.
function lanesFromBlob(blob) {
    const src = (blob && Array.isArray(blob.lanes)) ? blob.lanes : [];
    const out = [];
    for (const l of src) {
        if (!l || !l.livePath) continue;
        const rangeOn = !!l.rangeOn && Array.isArray(l.points) && l.points.length > 0;
        const lo = (typeof l.rangeMin === 'number') ? l.rangeMin : 0;
        const hi = (typeof l.rangeMax === 'number') ? l.rangeMax : 1;
        const pts = (Array.isArray(l.points) ? l.points : []).map(pt => ({
            time: pt.time,
            value: rangeOn ? Math.max(0, Math.min(1, lo + pt.value * (hi - lo))) : pt.value,
            curve: pt.curve || 0,
        }));
        out.push({
            path: l.livePath, points: pts,
            speed: (typeof l.speed === 'number' && l.speed > 0) ? l.speed : 1,
            min: l.liveMin, max: l.liveMax,
            is_log: l.liveLog ? 1 : 0, is_quantized: l.liveQuant ? 1 : 0,
            name: l.liveName || '', device: String(l.liveDevice || '').replace(/^⚡ /, ''),
        });
    }
    return out;
}

// A lane's shape signature — decides whether a push actually re-renders.
function laneSig(l) {
    const mode = l.mode || (l.is_quantized ? 'q' : 'r');
    return JSON.stringify([l.bars, l.speed, l.points, mode, [l.min, l.max, l.is_log ? 1 : 0]]);
}

// ── client messaging ─────────────────────────────────────────────────────
function sendTo(client, obj) {
    try { client.send(JSON.stringify(obj)); } catch (e) {}
}

function broadcast(obj) {
    state.clients.forEach(c => sendTo(c, obj));
}

// Lane-scoped messages go to the OWNING client only: two Stride windows may hold
// the same path text (a rack and its copy), a broadcast would heal the wrong one.
function tellLane(lane, obj) {
    if (isConnected(lane.client)) sendTo(lane.client, obj);
}

function report(lane, ok, id, message) {
    tellLane(lane, { type: 'live_bind_result', key: lane.path, ok: !!ok, id: id || 0,
                     name: lane.expectName || '', message: message || '' });
}

// ── lanes ────────────────────────────────────────────────────────────────
function renderLane(lane) {
    const n = lane.voice;
    const v = n ? state.voices[n] : null;
    if (!v || !lane.norm) return;
    if (v.sig === lane.sig) return;
    v.sig = lane.sig;
    v.gen++;
    const wavPath = writeVoiceWav(n, v.gen, rasterizeLane(lane.norm));
    _out(['voice', n, 'replace', wavPath]);
    _out(['voice', n, 'rate', rateFor(lane.norm.bars, lane.norm.speed)]);
}

// continuous -> live.remote~ (audio-rate, takes the knob over);
// quantized  -> live.object stepped setter (remote~ can't drive enums,
//               and it leaves the menu hand-movable while stopped).
// STOP-TO-FIND: while the transport is stopped, continuous binds stay
// SUSPENDED (remote~ swallows clicks + hand moves on bound knobs) - the
// play edge applies them. Menus never lock, so bindq applies right away.
function bindVoice(n) {
    const v = state.voices[n];
    if (!v || !v.id) return;
    const mode = v.mode || (v.quant ? 'q' : 'r');
    if (mode === 'q' || mode === 'c')
    {
        // Live's own setter: never locks the knob (hand-movable while stopped), so it
        // applies right away. Rate is bounded by the patcher's snapshot~ + the value
        // quantization below, because every set here costs one Live undo step.
        _out(['voice', n, 'bindq', v.id]);
        v.suspended = false;
    }
    else if (state.playing) { _out(['voice', n, 'bind', v.id]); v.suspended = false; }
    else v.suspended = true;
}

function migrateLane(lane, newPath) {
    const oldPath = lane.path;
    if (!newPath || newPath === oldPath) return;
    const c = lane.client;
    if (c && c.lanes && c.lanes[oldPath] === lane) {
        delete c.lanes[oldPath];
        c.lanes[newPath] = lane;
    }
    lane.path = newPath;
    tellLane(lane, { type: 'live_lane_healed', oldPath, newPath, name: lane.expectName || '' });
}

// Give a lane its target. holderN = the voice already bound to that target (an
// orphan from a closed editor, this very lane, or a loser being displaced), else 0.
function adopt(lane, target, holderN) {
    let n = holderN || 0;
    if (n) {
        const hv = state.voices[n];
        if (hv.lane && hv.lane !== lane) {
            const loser = hv.lane;
            loser.voice = 0;
            loser.taken = true;
            const dev = loser.expectDevice || 'that device';
            report(loser, false, 0, '"' + dev + '" is now driven by another Stride window: press MAP LIVE and click the ' + dev + ' you mean');
        }
    } else if (lane.voice && state.voices[lane.voice]) {
        n = lane.voice;                                   // re-aim the voice this lane already has
    } else {
        n = allocVoice();
        if (n < 0) {
            const message = 'All ' + NUM_VOICES + ' bridge voices are in use.';
            tellLane(lane, { type: 'bridge_error', message });
            report(lane, false, 0, message);
            return false;
        }
    }
    if (lane.voice && lane.voice !== n) freeVoice(lane.voice);   // moved onto another voice: release the old knob
    const v = state.voices[n];
    if (typeof target.devType === 'number') lane.devType = target.devType;
    refreshSig(lane);                                             // the drive path is known now (remote / stepped / control)
    v.lane = lane;
    v.owner = lane.client;
    v.quant = !!lane.quant;
    v.mode = laneMode(lane);
    v.id = target.id;
    lane.voice = n;
    lane.taken = false;
    lane.ambiguous = false;
    if (target.path && target.path !== lane.path) migrateLane(lane, target.path);
    renderLane(lane);
    bindVoice(n);
    report(lane, true, target.id, v.mode === 'c' ? 'bound (control-rate)' : 'bound');
    return true;
}

function releaseLane(lane) {
    lane.dead = true;
    if (lane.client && lane.client.lanes && lane.client.lanes[lane.path] === lane) delete lane.client.lanes[lane.path];
    if (lane.voice) { freeVoice(lane.voice); lane.voice = 0; }
}

function laneAlive(lane) {
    if (!lane || lane.dead) return false;
    if (lane.client) return lanesOf(lane.client)[lane.path] === lane;
    return true;
}

function freshHint(now) {
    const t = now || Date.now();
    const s = state.lastSel;
    if (!s.at || t - s.at > HINT_FRESH_MS) return null;
    return { track: s.track, device: s.device };
}

function noteSel(devPath, trackPath, now) {
    state.lastSel = { track: trackPath || trackOf(devPath), device: devPath || '', at: now || Date.now() };
}

// ── resolution state machine ─────────────────────────────────────────────
function startResolve(lane, hint) {
    if (lane.resolving) return;
    lane.resolving = true;
    const rid = state.nextRid++;
    state.pending[rid] = { kind: 'resolve', lane, hint: hint || null };
    _out(['probe', 'resolve', String(rid), lane.path]);
}

function goFind(lane, opts) {
    if (!lane.expectName) {
        lane.resolving = false;
        report(lane, false, 0, 'Couldn\'t find ' + laneLabel(lane) + ' in this set: was the device removed?');
        return;
    }
    const rid = state.nextRid++;
    state.pending[rid] = { kind: 'find', lane, opts: opts || {} };
    _out(['probe', 'find', String(rid), encodeURIComponent(lane.expectDevice || ''), encodeURIComponent(lane.expectName)]);
}

function takeCtx(r, kind) {
    const rid = parseInt(r.rid != null ? r.rid : r.voice, 10);
    const ctx = state.pending[rid];
    if (!ctx || ctx.kind !== kind) return null;
    delete state.pending[rid];
    return ctx;
}

// Is this target driven by a lane of ANOTHER open Stride window?
function takenByOther(id, lane) {
    const n = voiceByTarget(id);
    if (!n) return false;
    const v = state.voices[n];
    return v.lane !== lane && !!v.owner && v.owner !== lane.client && isConnected(v.owner);
}

// ── the protocol ─────────────────────────────────────────────────────────
function handleClientMessage(client, msg) {
    const type = msg && msg.type;

    if (type === 'bridge_hello') {
        sendTo(client, { type: 'bridge_ready', voices: NUM_VOICES, version: 2 });
        return;
    }

    if (type === 'map_live_start') {
        state.mapping = client;
        slideMapTimer();
        _out(['probe', 'map_start']);
        sendTo(client, { type: 'map_live_armed' });
        // ...and then PROVE it armed. The button used to light on the strength of a
        // message being SENT: nothing checked that a live patcher was behind this
        // process. A leaked node.script that still owns :9102 accepts the arm, drops the
        // probe into a dead end, and clicking knobs in Live does nothing at all, with no
        // way to tell (field 2026-08-27: "the mapping is just not reacting and I have to
        // remove StrideBridge and re-drag it"). The [js] now acks; no ack = say so.
        if (state.armTimer) clearTimeout(state.armTimer);
        state.armTimer = setTimeout(() => {
            state.armTimer = null;
            if (state.mapping !== client) return;
            state.mapping = null;
            if (state.mapTimer) { clearTimeout(state.mapTimer); state.mapTimer = null; }
            sendTo(client, { type: 'bridge_unreachable',
                             message: 'StrideBridge is not responding: remove the device from the track and drag it back in.' });
        }, ARM_ACK_MS);
        return;
    }

    if (type === 'map_live_cancel') {
        if (state.mapTimer) { clearTimeout(state.mapTimer); state.mapTimer = null; }
        state.mapping = null;
        _out(['probe', 'map_cancel']);
        return;
    }

    // Headless push from the plugin's PROCESSOR (project load / rack drop, no window):
    // the stored v10 "bl" blob, mapped here exactly like the shim maps it, then handled
    // as a normal full-set push. Same client identity as the window's later pushes.
    if (type === 'set_live_blob') {
        let blob = null;
        try { blob = JSON.parse(typeof msg.blob === 'string' ? msg.blob : JSON.stringify(msg.blob || {})); } catch (e) { blob = null; }
        handleClientMessage(client, { type: 'set_live_lanes', bars: msg.bars, lanes: lanesFromBlob(blob) });
        return;
    }

    // Full-set upsert: the one message that adds, updates AND removes.
    // The client sends its complete live-lane list; the server diffs PER CLIENT.
    if (type === 'set_live_lanes') {
        const incoming = Array.isArray(msg.lanes) ? msg.lanes : [];
        const mine = lanesOf(client);
        const seen = {};
        // the selection hint answers "which Stride is this?" once, on the first push
        const hint = client.firstPushDone ? null : freshHint();

        for (const l of incoming) {
            if (!l || !l.path) continue;
            const key = l.path;
            if (seen[key]) continue;
            seen[key] = true;

            let lane = mine[key];
            if (!lane) lane = mine[key] = { client, path: key, voice: 0, resolving: false, sig: null };
            lane.expectName = l.name || '';                        // bind-time identity check (portable racks)
            lane.expectDevice = l.device || '';
            lane.quant = !!l.is_quantized;

            const bars = (typeof msg.bars === 'number' && msg.bars > 0) ? msg.bars : (l.bars || 4);
            lane.norm = { bars, speed: l.speed || 1, points: l.points || [], min: l.min, max: l.max, is_log: l.is_log, name: l.name || '', is_quantized: l.is_quantized || 0 };
            refreshSig(lane);

            if (lane.voice && state.voices[lane.voice]) {
                const v = state.voices[lane.voice];
                const mode = laneMode(lane);
                if (v.mode !== mode) { v.mode = mode; v.quant = lane.quant; v.sig = null; if (v.id) bindVoice(lane.voice); }
                renderLane(lane);                                  // bound: an edit only re-renders
            } else if (!lane.resolving) {
                lane.voice = 0;
                startResolve(lane, hint);                          // new, reopened, displaced or ambiguous: (re)resolve
            }
        }

        // Anything THIS CLIENT had and no longer lists is gone. Per-client on
        // purpose: a lane-less second instance must never wipe the first one's voices.
        Object.keys(mine).forEach(key => { if (!seen[key]) releaseLane(mine[key]); });
        client.firstPushDone = true;

        sendTo(client, {
            type: 'live_lanes_state',
            lanes: Object.keys(mine).map(k => ({
                key: k, voice: mine[k].voice,
                bound: !!(mine[k].voice && state.voices[mine[k].voice] && state.voices[mine[k].voice].id),
            })),
        });
        return;
    }

    if (type === 'clear_all') {
        const mine = lanesOf(client);
        Object.keys(mine).forEach(key => releaseLane(mine[key]));
        return;
    }

    _post('unknown message type: ' + type);
}

function slideMapTimer() {
    if (state.mapTimer) clearTimeout(state.mapTimer);
    state.mapTimer = setTimeout(() => {
        if (state.mapping) {
            sendTo(state.mapping, { type: 'map_live_timeout' });
            state.mapping = null;
            _out(['probe', 'map_cancel']);
        }
    }, MAP_TIMEOUT_MS);
}

function handleDisconnect(client) {
    state.clients.delete(client);
    // A window that closes while ARMED must take the probe down with it. Leaving the
    // [js] armed meant the next knob click in Live was still read as a map, with nobody
    // to give it to (field 2026-08-27, the ghost-lane report).
    if (state.mapping === client) {
        state.mapping = null;
        if (state.mapTimer) { clearTimeout(state.mapTimer); state.mapTimer = null; }
        _out(['probe', 'map_cancel']);
    }
    // Deliberately NOT clearing voices — modulation outlives the editor window.
    // Bound lanes become orphans (owner null) and are reclaimed by target on reopen;
    // lanes that never bound die with the socket.
    const mine = lanesOf(client);
    Object.keys(mine).forEach(k => {
        const lane = mine[k];
        if (lane.voice && state.voices[lane.voice] && state.voices[lane.voice].id) {
            state.voices[lane.voice].owner = null;
            lane.client = null;
        } else {
            if (lane.voice) freeVoice(lane.voice);
            lane.dead = true;
        }
    });
    client.lanes = {};
}

// ── messages arriving FROM the [js] LiveAPI probe ────────────────────────
function handleMapped(encoded) {
    _alive();
    let info;
    try { info = JSON.parse(decodeURIComponent(encoded)); } catch (e) { return; }
    // A mapped knob belongs to the window that ARMED. It is never broadcast: with two
    // Stride windows open, a broadcast grew a lane in the innocent one (field 2026-08-27:
    // "params from an arp I never mapped here"). No armed window = the click was not a
    // map at all, so drop it and make sure the probe is disarmed.
    const target = isConnected(state.mapping) ? state.mapping : null;
    if (!target) {
        state.mapping = null;
        if (state.mapTimer) { clearTimeout(state.mapTimer); state.mapTimer = null; }
        _out(['probe', 'map_cancel']);
        return;
    }
    sendTo(target, { type: 'live_mapped', ...info });
    if (info && info.path) noteSel(deviceOf(info.path));

    // STAY ARMED - the VST-style flow: press Map Live once, click knob after knob,
    // press again to stop. The [js] observer disarms itself after each hit, so
    // re-probe; the NEXT selection change maps the next knob. The idle timeout slides.
    slideMapTimer();
    _out(['probe', 'map_start']);
}

function handleResolved(encoded) {
    _alive();
    let r;
    try { r = JSON.parse(decodeURIComponent(encoded)); } catch (e) { return; }
    const ctx = takeCtx(r, 'resolve');
    if (!ctx) return;
    const lane = ctx.lane;
    if (!laneAlive(lane)) return;

    // IDENTITY CHECK before binding: a rack/chain saved on one track and loaded on
    // another leaves paths pointing at whatever sits there NOW. A name mismatch
    // must never bind - it would drive a stranger's knob. Miss -> name search.
    const nameOk = !lane.expectName || !r.name || r.name === lane.expectName;
    const devOk = !lane.expectDevice || !r.device || r.device === lane.expectDevice;
    const verified = !!(r.ok && r.id && nameOk && devOk);
    if (!verified) {
        goFind(lane, { reason: 'miss', hint: ctx.hint });
        return;
    }

    const target = { id: r.id, path: r.path || lane.path, devType: (typeof r.devType === 'number') ? r.devType : undefined };
    const holderN = voiceByTarget(r.id);
    const holder = holderN ? state.voices[holderN] : null;

    // CONFLICT: another OPEN Stride window drives this exact knob. A rack copy's
    // stale address lands here (the copy remembers the original's knob). Look for
    // a free twin by name instead of stealing.
    if (holder && holder.lane !== lane && holder.owner && holder.owner !== lane.client && isConnected(holder.owner)) {
        goFind(lane, { reason: 'conflict', hint: ctx.hint, excludeId: r.id });
        return;
    }

    // SUSPECT: the user just selected another track and this Stride connected
    // right after, yet its address points elsewhere. If a twin lives under the
    // selection, that is home; if not, the address stands.
    const hint = ctx.hint;
    const tTrack = trackOf(target.path);
    if (hint && hint.track && tTrack && hint.track !== tTrack) {
        goFind(lane, { reason: 'hint', hint, fallback: target });
        return;
    }

    lane.resolving = false;
    adopt(lane, target, holderN);
}

// Name-search verdict. Candidates = every (device, param) name match in the set
// that no OTHER open window drives. Hint narrows, uniqueness decides, otherwise
// the user is told and RELINK (armed device click) settles it.
function handleFound(encoded) {
    _alive();
    let f;
    try { f = JSON.parse(decodeURIComponent(encoded)); } catch (e) { return; }
    const ctx = takeCtx(f, 'find');
    if (!ctx) return;
    const lane = ctx.lane;
    if (!laneAlive(lane)) return;
    const opts = ctx.opts || {};

    let hits = Array.isArray(f.hits) ? f.hits.filter(h => h && h.id && h.path) : [];
    if (!hits.length && f.count === 1 && f.path && f.id) hits = [{ path: f.path, id: f.id }];
    const total = (typeof f.count === 'number') ? f.count : hits.length;
    const cands = hits.filter(h => h.id !== opts.excludeId && !takenByOther(h.id, lane));

    let pick = null;
    const hint = opts.hint;
    if (hint && cands.length) {
        const underDev = hint.device ? cands.filter(h => under(h.path, hint.device)) : [];
        const underTrack = hint.track ? cands.filter(h => trackOf(h.path) === hint.track) : [];
        if (underDev.length === 1) pick = underDev[0];
        else if (underTrack.length === 1) pick = underTrack[0];
    }
    if (!pick && opts.fallback) pick = opts.fallback;       // the verified address stands when the hint has no twin
    if (!pick && cands.length === 1) pick = cands[0];

    lane.resolving = false;
    if (pick) { adopt(lane, pick, voiceByTarget(pick.id)); return; }

    const dev = lane.expectDevice || 'that device';
    let message;
    if (total === 0) message = 'Couldn\'t find ' + laneLabel(lane) + ' in this set: was the device removed?';
    else if (cands.length === 0) message = '"' + dev + '" is driven by another Stride window: press MAP LIVE and click the ' + dev + ' you mean';
    else message = '"' + dev + '" is in ' + total + ' places: press MAP LIVE and click the ' + dev + ' you mean';
    lane.ambiguous = true;
    report(lane, false, 0, message);
}

// RELINK: while MAP LIVE is armed, a click on a device's title bar moves every
// lane of that device NAME (of the armed window) onto THAT device. Forced: an
// explicit click beats any earlier claim, the displaced window is told.
function handleTouchedDev(encoded) {
    _alive();
    let t;
    try { t = JSON.parse(decodeURIComponent(encoded)); } catch (e) { return; }
    if (!t || !t.path) return;
    noteSel(t.path, trackOf(t.path));
    // Device-level lane finder: clicking a BOUND knob never reaches Live's selection
    // (remote-controlled params swallow clicks - same reason they can't be hand-moved),
    // but clicking the DEVICE always selects it. Flash every lane that device owns.
    broadcast({ type: 'live_touched_dev', path: t.path, name: t.name || '' });

    const c = state.mapping;
    if (!c || !t.name) return;
    const mine = lanesOf(c);
    const lanes = Object.keys(mine).map(k => mine[k]).filter(l => l.expectDevice === t.name && l.expectName);
    if (!lanes.length) return;
    const rid = state.nextRid++;
    state.pending[rid] = { kind: 'relink', client: c, lanes, devPath: t.path, devName: t.name };
    _out(['probe', 'relink', String(rid), encodeURIComponent(t.path),
          encodeURIComponent(JSON.stringify(lanes.map(l => l.expectName)))]);
    slideMapTimer();
}

function handleRelinked(encoded) {
    _alive();
    let f;
    try { f = JSON.parse(decodeURIComponent(encoded)); } catch (e) { return; }
    const ctx = takeCtx(f, 'relink');
    if (!ctx) return;
    const items = Array.isArray(f.items) ? f.items : [];
    let moved = 0;
    ctx.lanes.forEach(lane => {
        if (!laneAlive(lane)) return;
        const it = items.find(i => i && i.name === lane.expectName && i.id && i.path);
        if (!it) return;
        const holderN = voiceByTarget(it.id);
        if (holderN && lane.voice === holderN) { moved++; return; }   // already on that knob
        lane.resolving = false;
        if (adopt(lane, { id: it.id, path: it.path, devType: (typeof it.devType === 'number') ? it.devType : undefined }, holderN)) moved++;
    });
    sendTo(ctx.client, { type: 'live_relinked', device: ctx.devName, count: moved, path: ctx.devPath });
}

// REPATH sweep: every bound id -> its CURRENT path. Grouping, reordering or
// inserting devices moves addresses under a live bind; the stored path heals
// in-session so the next save (and the next rack) carries a valid address.
function repathSweep() {
    if (state.repathRid) return;                 // one in flight
    const ids = [];
    for (let n = 1; n <= NUM_VOICES; n++) if (state.voices[n] && state.voices[n].id) ids.push(state.voices[n].id);
    if (!ids.length) return;
    const rid = state.nextRid++;
    state.pending[rid] = { kind: 'repath' };
    state.repathRid = rid;
    _out(['probe', 'repath', String(rid)].concat(ids));
}

function handleRepathed(encoded) {
    _alive();
    let f;
    try { f = JSON.parse(decodeURIComponent(encoded)); } catch (e) { return; }
    const ctx = takeCtx(f, 'repath');
    state.repathRid = 0;
    if (!ctx) return;
    (Array.isArray(f.items) ? f.items : []).forEach(it => {
        if (!it || !it.id) return;
        const n = voiceByTarget(it.id);
        if (!n) return;
        const v = state.voices[n];
        const lane = v.lane;
        if (!lane) return;
        if (!it.ok) {
            // A failed lookup is NOT proof the knob is gone - the sweep exists to HEAL
            // paths, never to kill working binds. Field 2026-08-28 (Mac): bound lanes
            // dropped out on a ~5s rhythm and re-linked on the next push - a probe that
            // flakes must leave the bind alone. If the device truly left the set, the
            // bound remote/setter just goes inert, which costs nothing.
            if (!v.missCount) v.missCount = 0;
            v.missCount++;
            if (v.missCount === 3) report(lane, true, v.id, 'target not answering the path probe (bind kept)');
            return;
        }
        v.missCount = 0;
        if (it.path && it.path !== lane.path) migrateLane(lane, it.path);
    });
}

// Transport edge from the [js] observer: stopped -> release every continuous bind
// (keep id, mark suspended); playing -> re-apply them. The knob under a
// stopped transport is clickable (the finder works on the EXACT param) and
// hand-movable; play snaps it back onto its curve.
function handleTransport(on) {
    _alive();
    const playing = !!parseInt(on, 10);
    if (playing === state.playing) return;
    state.playing = playing;
    for (let n = 1; n <= NUM_VOICES; n++) {
        const v = state.voices[n];
        if (!v || !v.id) continue;
        const mode = v.mode || (v.quant ? 'q' : 'r');
        if (mode !== 'r') continue;             // the setter paths never lock the knob, so a transport edge is nothing to them
        if (!playing) { _out(['voice', n, 'unbind']); v.suspended = true; }
        else if (v.suspended) { _out(['voice', n, 'bind', v.id]); v.suspended = false; }
    }
}

function handleTouched(encoded) {
    _alive();
    let t;
    try { t = JSON.parse(decodeURIComponent(encoded)); } catch (e) { return; }
    if (!t || !t.path) return;
    noteSel(deviceOf(t.path));
    // The lane-finder: every client checks the path against its own live lanes and
    // flashes the match. Tiny traffic (one message per user click in Live).
    broadcast({ type: 'live_touched', path: t.path, name: t.name || '' });
}

// Selection hint from the [js] (gesture-driven only: init echoes are filtered there).
function handleSel(encoded) {
    _alive();
    let s;
    try { s = JSON.parse(decodeURIComponent(encoded)); } catch (e) { return; }
    if (!s) return;
    noteSel(s.device || '', s.track || trackOf(s.device || ''));
}

// ── liveness: ping/pong with the patcher ─────────────────────────────────
// Ableton's node.script can leak a process across device reloads. A leaked
// server still owns :9102 and swallows every push while its outlet goes nowhere.
// The [js] answers pings; a silent patcher makes this process YIELD the port
// (a standby bridge takes it within 3s) and resume if the patcher ever answers.
function handlePong() {
    state.pongAt = Date.now();
    state.pongSeen = true;
    if (state.yielded) resumeFromYield();
}

// EVERY message from the [js] proves the patcher lives, not just pongs. On a busy Max
// scheduler pings can starve while resolves/touches still flow - yielding the port then
// releases every working bind for nothing (field 2026-08-28, Mac: modulation dropping
// out and re-linking in waves). Liveness = any inbound traffic.
function _alive() {
    state.pongAt = Date.now();
    state.pongSeen = true;
}

// The [js] answering `armed` is the same proof a pong is: a live patcher is behind us.
function handleArmed() {
    if (state.armTimer) { clearTimeout(state.armTimer); state.armTimer = null; }
    handlePong();
}

function tick(now) {
    const t = now || Date.now();
    _out(['probe', 'ping']);
    // A listener with no live patcher behind it must not keep the port. Two ways to be
    // that: the patcher went away (pongs stop), or it was never there (a process that has
    // answered NOTHING since boot - the old guard required a pong first, so exactly that
    // case held :9102 forever and every Stride talked into a dead end).
    if (!state.yielded && state.pongSeen && t - state.pongAt > PONG_TIMEOUT_MS) yieldPort();
    else if (!state.yielded && !state.pongSeen && state.bootAt && t - state.bootAt > NO_PONG_BOOT_MS) yieldPort();
    if (!state.yielded) repathSweep();
}

function yieldPort() {
    state.yielded = true;
    _post('patcher silent for ' + (PONG_TIMEOUT_MS / 1000) + 's: releasing :' + TCP_PORT + ' for another StrideBridge');
    for (let n = 1; n <= NUM_VOICES; n++) {
        if (!state.voices[n]) continue;
        if (state.voices[n].id) _out(['voice', n, 'unbind']);
        state.voices[n] = null;
    }
    state.clients.forEach(c => { try { if (c.close) c.close(); } catch (e) {} });
    state.clients = new Set();
    state.pending = {};
    state.repathRid = 0;
    state.mapping = null;
    listeners.forEach(l => { try { l.stop(); } catch (e) {} });
    _status();
}

function resumeFromYield() {
    state.yielded = false;
    _post('patcher answered again: re-listening');
    listeners.forEach(l => { try { l.start(); } catch (e) {} });
    _status();
}

// ── boot (only under Max) ────────────────────────────────────────────────
// EADDRINUSE is NEVER fatal — the StrideLink port lesson. Ableton's node.script
// leaks processes across device reloads, and a set shuffle can briefly run two
// bridges: the loser STANDS BY and retries every 3s, taking the port over the
// moment the holder dies. Give-up-forever is what leaves a set with a bridge
// device present and nobody listening.
function startServer(WebSocketServerCtor) {
    let live = null;          // the server instance that actually owns the port
    let retryTimer = null;
    let stopped = false;

    function schedule() {
        if (retryTimer || stopped) return;
        retryTimer = setTimeout(() => { retryTimer = null; tryListen(); }, 3000);
    }

    function tryListen() {
        if (live || stopped) return;
        let s;
        try { s = new WebSocketServerCtor({ port: PORT }); }
        catch (e) { _post('listen failed: ' + e.message + ' — retrying'); schedule(); return; }

        s.on('listening', () => { live = s; _post('listening on :' + PORT); });
        s.on('error', (e) => {
            if (e && e.code === 'EADDRINUSE')
                _post('port :' + PORT + ' is held (another StrideBridge, or a leaked node process) — standing by, retrying every 3s');
            else
                _post('WS error: ' + e.message + ' — retrying');
            try { s.close(); } catch (e2) {}
            if (live === s) live = null;
            schedule();
        });
        s.on('connection', (ws) => {
            ws.lanes = {}; ws.firstPushDone = false;
            ws.close2 = ws.close;
            state.clients.add(ws);
            _post('client connected (' + state.clients.size + ')');
            ws.on('message', (raw) => {
                let msg; try { msg = JSON.parse(raw.toString()); } catch (e) { return; }
                try { handleClientMessage(ws, msg); } catch (e) { _post('handler error: ' + e.message); }
            });
            ws.on('close', () => handleDisconnect(ws));
            ws.on('error', () => {});
        });
    }

    function stop() {
        stopped = true;
        if (retryTimer) { clearTimeout(retryTimer); retryTimer = null; }
        if (live) { try { live.close(); } catch (e) {} live = null; }
    }
    function start() { stopped = false; tryListen(); }

    tryListen();
    const ctl = { get wss() { return live; }, stop, start };
    listeners.push(ctl);
    return ctl;
}

// ── TCP JSON-lines listener (:9102) — same protocol, newline-framed ─────────
// Each client is wrapped so handleClientMessage's client.send(jsonString) just
// works: the wrapper appends the newline framing.
function startTcpServer(netModule, portOverride) {
    const port = portOverride || TCP_PORT;   // tests pass their own port so a live rig never collides
    let live = null;
    let retryTimer = null;
    let stopped = false;

    function schedule() {
        if (retryTimer || stopped) return;
        retryTimer = setTimeout(() => { retryTimer = null; tryListen(); }, 3000);
    }

    function tryListen() {
        if (live || stopped) return;
        const srv = netModule.createServer((sock) => {
            const client = {
                send: (str) => { try { sock.write(str + '\n'); } catch (e) {} },
                close: () => { try { sock.destroy(); } catch (e) {} },
                lanes: {}, firstPushDone: false,
            };
            state.clients.add(client);
            _post('VST connected via TCP (' + state.clients.size + ')');
            let buf = '';
            sock.on('data', (chunk) => {
                buf += chunk.toString('utf8');
                let nl;
                while ((nl = buf.indexOf('\n')) >= 0) {
                    const line = buf.slice(0, nl); buf = buf.slice(nl + 1);
                    if (!line.trim()) continue;
                    let msg; try { msg = JSON.parse(line); } catch (e) { continue; }
                    try { handleClientMessage(client, msg); } catch (e) { _post('handler error: ' + e.message); }
                }
            });
            const drop = () => { if (state.clients.has(client)) handleDisconnect(client); };
            sock.on('close', drop);
            sock.on('error', drop);
        });
        srv.on('error', (e) => {
            if (e && e.code === 'EADDRINUSE')
                _post('tcp :' + port + ' is held (another StrideBridge, or a leaked node process) — standing by, retrying every 3s');
            else _post('tcp error: ' + e.message + ' — retrying');
            try { srv.close(); } catch (e2) {}
            if (live === srv) live = null;
            state.active = false;
            _status();
            schedule();
        });
        srv.listen(port, () => { live = srv; state.active = true; _status(); _post('VST link listening on tcp :' + port); });
    }

    function stop() {
        stopped = true;
        if (retryTimer) { clearTimeout(retryTimer); retryTimer = null; }
        if (live) { try { live.close(); } catch (e) {} live = null; }
        state.active = false;
    }
    function start() { stopped = false; tryListen(); }

    tryListen();
    const ctl = { get server() { return live; }, stop, start };
    listeners.push(ctl);
    return ctl;
}

if (Max) {
    Max.addHandler('mapped', handleMapped);
    Max.addHandler('touched', handleTouched);
    Max.addHandler('touched_dev', handleTouchedDev);
    Max.addHandler('sel', handleSel);
    Max.addHandler('transport', handleTransport);
    Max.addHandler('found', handleFound);
    Max.addHandler('resolved', handleResolved);
    Max.addHandler('relinked', handleRelinked);
    Max.addHandler('repathed', handleRepathed);
    Max.addHandler('pong', handlePong);
    Max.addHandler('armed', handleArmed);
    state.bootAt = Date.now();
    startTcpServer(require('net'));   // the VST transport — zero dependencies
    try {
        const { WebSocketServer } = require('ws');
        startServer(WebSocketServer);
    } catch (e) {
        _post('ws module missing (dev tooling only — the VST link works without it). ' + e.message);
    }
    setInterval(() => tick(), PING_MS);
    _status();
}

module.exports = {
    PORT, TCP_PORT, NUM_VOICES, TICKS_PER_BAR, SAMPLES_PER_BAR, TMP_DIR,
    HINT_FRESH_MS, PING_MS, PONG_TIMEOUT_MS, NO_PONG_BOOT_MS, ARM_ACK_MS, REPATH_MS,
    state, listeners, ticksFor, rateFor, sampleCountFor, rasterizeLane, buildWav, writeVoiceWav,
    allocVoice, freeVoice, voiceByTarget, lanesOf, laneSig, laneMode, lanesFromBlob, MIDI_EFFECT,
    CONTROL_STEPS, SNAPSHOT_MS, trackOf, deviceOf, under, freshHint, noteSel,
    handleClientMessage, handleDisconnect, handleMapped, handleResolved, handleFound, handleRelinked,
    handleRepathed, handleTouched, handleTouchedDev, handleSel, handleTransport, handlePong, handleArmed, tick,
    startServer, startTcpServer, _setIoForTest,
};
