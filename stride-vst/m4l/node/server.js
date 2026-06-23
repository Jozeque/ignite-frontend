/**
 * Stride M4L — WebSocket Server
 * Runs inside Node for Max, bridges Ableton ↔ Canvas App
 *
 * Max patcher sends/receives via node.script:
 *   - Inlets: messages from Max (scan results, clip info, write confirmations)
 *   - Outlets: messages to Max (scan requests, write commands, preview)
 */

const { WebSocketServer } = require('ws');
const scanner = require('./scanner');
const writer = require('./writer');
const inject = require('./inject-writer');
const alcGen = require('./alc-generator');
const Max = require('max-api');
const fs = require('fs');
const path = require('path');
const os = require('os');

const PORT = 9100;
const VERSION = '1.0.0';

// Remote Script file-based communication
const TRIGGER_FILE = path.join(os.homedir(), '_stride_trigger.json');
const RESULT_FILE = path.join(os.homedir(), '_stride_result.json');
// StrideQuick command relay. A button press may be received by a DIFFERENT
// node.script instance than the one holding the canvas WebSocket (multiple
// StrideLink bridges can co-exist — the known node-leak). The press is written
// here; whichever instance actually has the canvas picks it up in the relay
// poll and forwards it. Makes Quick robust to the split-brain.
const QUICK_FILE = path.join(os.homedir(), '_stride_quick_cmd.json');
const STATE_FILE = path.join(os.homedir(), '_stride_quick_state.json');  // canvas->device readout, relayed so EVERY StrideLink instance shows it (fixes "Disconnected" on a duplicated track)
const BRIDGE_ALIVE_FILE = path.join(os.homedir(), '_stride_bridge_alive.json');  // port-holder heartbeat: lets a 2nd bridge tell a LIVE holder (coexist as relay) from a dead/leaked node (clear + take over)


let wss = null;
let appSocket = null;
let _lastQuickNonce = null;  // StrideQuick relay: last command nonce forwarded to the canvas
let _revealOnConnect = false;  // Open Canvas pressed during a silent boot: reveal once connected
let _lastStateNonce = null;    // StrideQuick state relay: last readout ts this bridge outlet
let _relayOnly = false;        // true when another LIVE StrideLink bridge owns port 9100 — we run as a command/status relay instead of fighting for it
let _bridgeHeartbeatTimer = null;
let _rebindTimer = null;

// ─── Port Conflict Recovery ───────────────────────────────
// Max for Live on Windows sometimes leaks the node.script child process when
// the device is reloaded (track change, device swap, project re-open). The
// old Node keeps port 9100 bound and the new Node can't listen. We detect
// this EADDRINUSE case and kill the offending Node PID — ONLY if it's
// actually a Node process, never anything else (defensive: don't kill a
// user's printer daemon if it happens to grab 9100).
function killNodeOnPort(port, callback) {
    const { exec } = require('child_process');
    const isWin = process.platform === 'win32';

    if (isWin) {
        exec(`netstat -ano | findstr :${port}`, (err, stdout) => {
            if (err || !stdout) return callback(false, 'nothing listening on port');
            const pids = new Set();
            stdout.split(/\r?\n/).forEach(line => {
                const m = line.match(/LISTENING\s+(\d+)/);
                if (m) pids.add(m[1]);
            });
            if (pids.size === 0) return callback(false, 'no listener PID found');
            let remaining = pids.size;
            let killedAny = false;
            pids.forEach(pid => {
                exec(`tasklist /FI "PID eq ${pid}" /FO CSV /NH`, (e, out) => {
                    const isNode = !e && /"node\.exe"/i.test(out);
                    if (isNode) {
                        exec(`taskkill /PID ${pid} /F`, (ke) => {
                            if (!ke) killedAny = true;
                            if (--remaining === 0) callback(killedAny, killedAny ? null : 'kill failed');
                        });
                    } else {
                        if (--remaining === 0) callback(killedAny, killedAny ? null : 'port held by non-Node process');
                    }
                });
            });
        });
    } else {
        exec(`lsof -ti:${port}`, (err, stdout) => {
            if (err || !stdout) return callback(false, 'nothing listening on port');
            const pids = stdout.trim().split(/\s+/).filter(Boolean);
            if (pids.length === 0) return callback(false, 'no listener PID found');
            let remaining = pids.length;
            let killedAny = false;
            pids.forEach(pid => {
                exec(`ps -p ${pid} -o comm=`, (e, out) => {
                    const isNode = !e && /node/i.test(out);
                    if (isNode) {
                        exec(`kill -9 ${pid}`, (ke) => {
                            if (!ke) killedAny = true;
                            if (--remaining === 0) callback(killedAny, killedAny ? null : 'kill failed');
                        });
                    } else {
                        if (--remaining === 0) callback(killedAny, killedAny ? null : 'port held by non-Node process');
                    }
                });
            });
        });
    }
}

// ─── Max API Handlers ─────────────────────────────────────

/**
 * Max patcher calls these handlers via node.script messages.
 * The M4L patcher uses Live Object Model (LOM) to read/write Ableton state
 * and forwards results here as JSON.
 */

Max.addHandler('rack_params', (jsonStr) => {
    // Max patcher scanned the rack and sends params as JSON
    try {
        const data = JSON.parse(jsonStr);
        const msg = {
            type: 'rack_scanned',
            track_name: data.track_name || 'Unknown',
            device_name: data.device_name || 'Instrument Rack',
            clip_bars: data.clip_bars || 4,
            clip_slot: data.clip_slot || 0,
            parameters: data.parameters || []
        };
        sendToApp(msg);
        Max.post(`Stride: Scanned ${msg.parameters.length} params from "${msg.device_name}"`);
    } catch (e) {
        Max.post(`Stride: Error parsing rack params — ${e.message}`);
    }
});

Max.addHandler('clip_info', (jsonStr) => {
    try {
        const data = JSON.parse(jsonStr);
        sendToApp({
            type: 'clip_changed',
            clip_bars: data.clip_bars || 4,
            has_clip: data.has_clip !== false,
            clip_slot: data.clip_slot || 0
        });
    } catch (e) {
        Max.post(`Stride: Error parsing clip info — ${e.message}`);
    }
});

Max.addHandler('track_info', (jsonStr) => {
    try {
        const data = JSON.parse(jsonStr);
        sendToApp({
            type: 'track_changed',
            track_name: data.track_name || 'Unknown',
            has_device: data.has_device !== false
        });
    } catch (e) {
        Max.post(`Stride: Error parsing track info — ${e.message}`);
    }
});

// Detail-view clip changed — the clip in Live's editor is the source of truth.
// Pushed by scanner_max.js's detail_clip observer so the canvas re-syncs to the
// open clip (bars + per-clip curves) the moment it changes, even on the same track.
Max.addHandler('clip_focus', (jsonStr) => {
    try {
        const data = JSON.parse(jsonStr);
        sendToApp({
            type: 'clip_focus_changed',
            clip_slot: data.clip_slot || 0,
            clip_bars: data.clip_bars || 4,
            has_clip: data.has_clip !== false,
            clip_id: data.clip_id || null,
            source: data.source || ''
        });
    } catch (e) {
        Max.post(`Stride: Error parsing clip focus — ${e.message}`);
    }
});

Max.addHandler('write_result', (jsonStr) => {
    try {
        const data = JSON.parse(jsonStr);
        if (data.success) {
            sendToApp({
                type: 'apply_success',
                params_written: data.params_written || 0,
                clip_bars: data.clip_bars || 4
            });
            Max.post(`Stride: Wrote automation for ${data.params_written} params`);
        } else {
            sendToApp({
                type: 'apply_error',
                message: data.message || 'Unknown write error'
            });
            Max.post(`Stride: Write error — ${data.message}`);
        }
    } catch (e) {
        Max.post(`Stride: Error parsing write result — ${e.message}`);
    }
});

// ─── Gate Feature Handlers ────────────────────────────────

Max.addHandler('all_devices', (jsonStr) => {
    try {
        const data = JSON.parse(jsonStr);
        sendToApp({
            type: 'devices_scanned',
            track_name: data.track_name || 'Unknown',
            devices: data.devices || []
        });
        Max.post(`Stride: Scanned ${(data.devices || []).length} devices for Gate`);
    } catch (e) {
        Max.post(`Stride: Error parsing all_devices — ${e.message}`);
    }
});

Max.addHandler('gate_result', (jsonStr) => {
    try {
        const data = JSON.parse(jsonStr);
        sendToApp({
            type: 'gate_status',
            success: data.success !== false,
            stopped: data.stopped === true,
            message: data.message || null,
            devices_playing: data.devices_playing || 0,
            resolution: data.resolution || null,
            bars: data.bars || null,
            record_mode: data.record_mode === true
        });
    } catch (e) {
        Max.post(`Stride: Error parsing gate_result — ${e.message}`);
    }
});

Max.addHandler('gate_position', (jsonStr) => {
    try {
        const data = JSON.parse(jsonStr);
        sendToApp({
            type: 'gate_position',
            step: data.step,
            cycle_time: data.cycle_time,
            song_time: data.song_time
        });
    } catch (e) {
        // silently ignore malformed position updates
    }
});

// ─── Read-Probe Result (diagnostic) ───────────────────────
// scanner_max.js's read-only envelope probe sends its findings here. We
// write them to a file in the user's home dir so they're easy to inspect,
// and forward to the app so they also show in the DevTools console.
Max.addHandler('read_probe_result', (jsonStr) => {
    try {
        const outPath = path.join(os.homedir(), '_stride_read_probe_result.json');
        let pretty = jsonStr;
        try { pretty = JSON.stringify(JSON.parse(jsonStr), null, 2); } catch (e) {}
        fs.writeFileSync(outPath, pretty);
        Max.post(`Stride: read-probe result written to ${outPath}`);
        sendToApp({ type: 'read_probe_result', data: jsonStr });
    } catch (e) {
        Max.post(`Stride: failed to write read-probe result — ${e.message}`);
    }
});

// ─── Read Existing Curves (feature) ───────────────────────
// scanner_max.js's read_clip_curves sends the clip's existing automation here
// (already normalized to canvas space). Forward straight to the app, which
// drops each curve onto its matching lane by _path.
Max.addHandler('clip_curves', (jsonStr) => {
    try {
        const data = JSON.parse(jsonStr);
        // Diagnostic: write the full result to a file we can inspect (Max device
        // post() output isn't captured in Ableton's Log.txt).
        try {
            const dbgPath = path.join(os.homedir(), '_stride_read_curves_result.json');
            fs.writeFileSync(dbgPath, JSON.stringify(data, null, 2));
            Max.post(`Stride: read-curves diagnostic → ${dbgPath}`);
        } catch (we) {}
        sendToApp({
            type: 'clip_curves_read',
            ok: data.ok !== false,
            mode: data.mode || 'A',
            clip_source: data.clip_source || '',
            lanes_found: data.lanes_found || 0,
            params: data.params || [],
            notes: data.notes || [],
        });
        Max.post(`Stride: read ${data.lanes_found || 0} existing lane(s) from clip (mode ${data.mode || 'A'})`);
    } catch (e) {
        Max.post(`Stride: error parsing clip_curves — ${e.message}`);
    }
});

// ─── Read-Probe Result (diagnostic) ───────────────────────
//
// StrideLink lives INSIDE the Ableton User Library:
//   <UserLibrary>/Stride/server.js
// So __dirname is <UserLibrary>/Stride and its parent is the real User
// Library — with zero guessing, zero detection, zero ambiguity. We send
// this on the m4l_ready handshake; the Electron app caches it via the
// library-path resolver (source: 'm4l') so the watcher, install flow,
// and template detection use the real path regardless of how
// non-standard the user's setup is.
//
// Returns null in dev mode (parent is the repo, not a library) and on
// any error — the handshake still completes with user_library_path=null,
// so this code is purely additive.  See docs/install-to-ableton-spec.md.
//
// Computed once at server start since server.js's file location doesn't
// change at runtime. Keep the function defined for clarity / future tests.
function computeUserLibraryPath() {
    try {
        const parent = path.dirname(__dirname);
        if (!parent) return null;

        // Definitive: Ableton's User Library folder is literally named
        // "User Library" — even when relocated via Live's preferences.
        if (path.basename(parent) === 'User Library') return parent;

        // Paranoia fallback: a renamed parent that still has Ableton-shaped
        // siblings. Two marker subdirectories = plausible. Mirrors the
        // marker list in app/lib/library-path.js (keep both in sync).
        const markers = ['Presets', 'Samples', 'Sounds', 'Defaults', 'Templates'];
        let hits = 0;
        for (const m of markers) {
            try {
                if (fs.statSync(path.join(parent, m)).isDirectory()) {
                    hits++;
                    if (hits >= 2) return parent;
                }
            } catch (e) { /* marker absent — keep counting */ }
        }
        return null;
    } catch (e) {
        return null;
    }
}

const USER_LIBRARY_PATH = computeUserLibraryPath();
if (USER_LIBRARY_PATH) {
    Max.post(`Stride: Self-located in User Library at ${USER_LIBRARY_PATH}`);
}

// ─── Multi-bridge coexistence ─────────────────────────────
// Two live StrideLink devices (e.g. a duplicated track) used to fight over port
// 9100: the 2nd bridge would KILL the 1st's node, leaving that device's panel
// dead (Unlock/commands do nothing) while the survivor showed "Connected". Now
// the port-holder writes a heartbeat; a 2nd bridge that finds the port taken
// checks it — a LIVE holder means coexist as a relay (commands already route via
// the command-relay file, status via the state-relay file), and we only clear a
// holder that looks dead/leaked. A relay bridge watches the heartbeat and takes
// over the port if the holder closes.
function _startBridgeHeartbeat() {
    if (_bridgeHeartbeatTimer) return;
    const beat = () => {
        try { fs.writeFileSync(BRIDGE_ALIVE_FILE, JSON.stringify({ pid: process.pid, ts: Date.now() })); } catch (e) {}
    };
    beat();
    _bridgeHeartbeatTimer = setInterval(beat, 2000);
}
// Is a DIFFERENT, live bridge currently holding the port? Fresh (<6s) heartbeat
// from another pid = yes. Missing/stale/our-own = no (treat as dead/leaked).
function _bridgeHolderFresh() {
    try {
        const h = JSON.parse(fs.readFileSync(BRIDGE_ALIVE_FILE, 'utf8'));
        return !!(h && h.ts && h.pid !== process.pid && (Date.now() - h.ts) < 6000);
    } catch (e) { return false; }
}
// While relay-only, watch the holder; if its heartbeat goes stale (device removed
// / Ableton closed it), grab the port so the canvas keeps working.
function _scheduleRebind() {
    if (_rebindTimer) return;
    _rebindTimer = setInterval(() => {
        if (!_relayOnly) { clearInterval(_rebindTimer); _rebindTimer = null; return; }
        if (!_bridgeHolderFresh()) {
            _relayOnly = false;
            clearInterval(_rebindTimer); _rebindTimer = null;
            try { startServer(0); } catch (e) {}
        }
    }, 4000);
}

// ─── WebSocket Server ─────────────────────────────────────

function startServer(retryCount) {
    retryCount = retryCount || 0;

    wss = new WebSocketServer({ port: PORT });

    wss.on('listening', () => {
        _relayOnly = false;
        _startBridgeHeartbeat();   // we own the port — advertise liveness so a sibling bridge coexists instead of killing us
        Max.post(`Stride: WebSocket server running on localhost:${PORT}`);
        Max.outlet('status', 'server_ready');
    });

    wss.on('connection', (ws) => {
        Max.post('Stride: Canvas app connected');
        appSocket = ws;
        // Reconcile the relay command on connect. A STALE press (left from a
        // previous session) must not replay, so mark it seen. A FRESH press (the
        // one that just auto-launched this canvas, seconds old) SHOULD run once
        // we are connected, so leave it unseen and let _pollQuickRelay() forward
        // it after the open-scan settles.
        try {
            if (fs.existsSync(QUICK_FILE)) {
                const c = JSON.parse(fs.readFileSync(QUICK_FILE, 'utf8'));
                const fresh = c && c.ts && (Date.now() - c.ts < 30000);
                if (!fresh) {
                    _lastQuickNonce = (c && c.nonce) ? c.nonce : null;
                }
            }
        } catch (e) { /* ignore */ }

        // Send handshake — user_library_path is the spine of the
        // install-to-ableton fix (see docs/install-to-ableton-spec.md
        // Phase 2). Sent on every connect so reconnects also refresh
        // the persisted path if it moves.
        sendToApp({
            type: 'm4l_ready',
            version: VERSION,
            user_library_path: USER_LIBRARY_PATH,
        });
        Max.outlet('status', 'app_connected');
        // If Open Canvas was pressed while the canvas was still booting hidden,
        // reveal it now that it's connected.
        if (_revealOnConnect) { _revealOnConnect = false; sendToApp({ type: 'focus_window' }); }

        ws.on('message', (raw) => {
            try {
                const msg = JSON.parse(raw);
                handleAppMessage(msg);
            } catch (e) {
                Max.post(`Stride: Invalid message from app — ${e.message}`);
            }
        });

        ws.on('close', () => {
            Max.post('Stride: Canvas app disconnected');
            appSocket = null;
            _canvasLaunchAt = 0;   // canvas died — allow an immediate relaunch (the debounce was only for the boot window)
            Max.outlet('status', 'app_disconnected');
            // Write the idle readout to the relay so ALL instances update.
            // "Connected" not "Disconnected": the device is still wired into
            // Ableton and a press spins the engine up — reads as ready, not
            // broken. Preserve the last counts so they don't flash to 0.
            try {
                let prev = {};
                try { prev = JSON.parse(fs.readFileSync(STATE_FILE, 'utf8')); } catch (e) {}
                fs.writeFileSync(STATE_FILE, JSON.stringify({
                    on_chain: prev.on_chain || 0, on_canvas: prev.on_canvas || 0,
                    bars: prev.bars || 4, connected: 0, locked: prev.locked || 0,
                    rescan: (typeof prev.rescan === 'number' ? prev.rescan : 1),
                    status: 'Connected', ts: Date.now(),
                }));
            } catch (e) { /* ignore */ }
        });

        ws.on('error', (err) => {
            Max.post(`Stride: WebSocket error — ${err.message}`);
        });
    });

    wss.on('error', (err) => {
        if (err.code === 'EADDRINUSE') {
            wss.close();
            // Is a LIVE StrideLink bridge holding the port (a sibling device — e.g.
            // a duplicated track)? Then DON'T kill it: killing the sibling is what
            // left that device's panel dead while this one showed "Connected".
            // Coexist as a relay — panel presses already route through the
            // command-relay file (the holder forwards them) and status comes via
            // the state-relay — and take over only if the holder closes. We clear
            // the port only when the holder looks dead/leaked (stale heartbeat),
            // which preserves the original reload-leak recovery.
            if (_bridgeHolderFresh()) {
                _relayOnly = true;
                Max.post(`Stride: Port ${PORT} held by a live StrideLink — running as a relay (commands + status still work; will take over if it closes).`);
                Max.outlet('status', 'app_connected');
                _scheduleRebind();
            } else if (retryCount < 3) {
                Max.post(`Stride: Port ${PORT} held by a stale/dead process — clearing (attempt ${retryCount + 1}/3)`);
                killNodeOnPort(PORT, (killed, reason) => {
                    if (killed) {
                        Max.post(`Stride: Cleared stale Node process on port ${PORT}`);
                    } else {
                        Max.post(`Stride: Could not clear port — ${reason || 'reason unknown'}`);
                    }
                    setTimeout(() => startServer(retryCount + 1), 1500);
                });
            } else {
                Max.post(`Stride: Port ${PORT} in use — giving up after 3 retries. ` +
                         `Another app is holding the port. Try: close Ableton fully, ` +
                         `reboot, then reopen the project.`);
                Max.outlet('status', 'port_in_use');
            }
        } else {
            Max.post(`Stride: Server error — ${err.message}`);
        }
    });
}

// ─── Handle Messages from Canvas App ──────────────────────

function handleAppMessage(msg) {
    switch (msg.type) {
        case 'app_ready':
            Max.post(`Stride: App v${msg.version} ready`);
            break;

        case 'request_scan':
            // Tell Max patcher to scan the rack
            Max.outlet('command', 'scan_rack');
            break;

        case 'request_scan_mapped':
            // Tell Max patcher to scan only params with automation envelopes
            Max.outlet('command', 'scan_mapped');
            break;

        case 'apply_automation':
            // Generate .alc file with FloatEvent breakpoints (1:1 accuracy)
            applyViaAlcFile(msg);
            break;

        case 'apply_inject':
            // v.next direct-inject path: writes envelopes straight into the
            // selected clip via the StrideInject Remote Script. No .alc, no
            // drag. Opt-in — apply_automation is still the default.
            inject.writeInject(msg, {
                onSuccess: (data) => {
                    const mode = data && data.mode ? data.mode : 'unknown';
                    Max.post(`Stride: inject success — ${data.params_written || 0} params, ${data.points_written || 0} events, ${data.notes_written || 0} notes (${mode} mode)`);
                    sendToApp({
                        type: 'inject_success',
                        params_written: (data && data.params_written) || 0,
                        points_written: (data && data.points_written) || 0,
                        notes_written: (data && data.notes_written) || 0,
                        mode: mode,
                        clip_bars: msg.clip_bars || 4,
                    });
                },
                onError: (message) => {
                    Max.post(`Stride: inject error — ${message}`);
                    sendToApp({ type: 'inject_error', message: message });
                },
            });
            break;

        case 'apply_midi':
            // Forward MIDI notes to Max patcher
            writer.writeMidi(msg);
            break;

        case 'preview_param':
            // Set a single param value temporarily
            Max.outlet('preview', msg._path || '', msg.value);
            break;

        case 'stop_preview':
            // Restore original param values
            Max.outlet('command', 'stop_preview');
            break;

        case 'request_create_clip':
            // Ask Max to create a clip
            Max.outlet('create_clip', msg.bars || 4, msg.slot_index || 0);
            break;

        case 'request_scan_devices':
            // Gate feature: enumerate every device on the selected track
            Max.outlet('command', 'scan_all_devices');
            break;

        case 'start_gate':
            // Gate feature: begin real-time Device On/Off sequencing.
            // Pattern payload written to a temp file (Max truncates long messages).
            try {
                const gateTempPath = path.join(os.tmpdir(), 'stride_gate_pattern.json');
                fs.writeFileSync(gateTempPath, JSON.stringify({
                    resolution: msg.resolution || 16,
                    bars: msg.bars || 4,
                    record_mode: msg.record_mode === true,
                    devices: msg.devices || []
                }));
                Max.outlet('command', 'start_gate_playback', gateTempPath);
            } catch (e) {
                Max.post(`Stride: Error writing gate pattern — ${e.message}`);
                sendToApp({
                    type: 'gate_status',
                    success: false,
                    message: 'Failed to write gate pattern file'
                });
            }
            break;

        case 'stop_gate':
            Max.outlet('command', 'stop_gate_playback');
            break;

        case 'start_gate_test':
            // Smoke test: hardcoded pattern on first non-StrideLink device
            Max.outlet('command', 'start_gate_test');
            break;

        case 'scan_read_test':
            // Diagnostic: probe whether Max JS can READ a clip automation
            // envelope (gate for the "read existing curves" feature). Read-only.
            Max.post('Stride: read-probe requested');
            Max.outlet('command', 'scan_read_envelopes');
            break;

        case 'read_clip_curves':
            // "Read existing curves" feature: pull the open clip's automation
            // onto the canvas lanes. mode A = sampled, B = breakpoints. Read-only.
            Max.outlet('command', 'read_clip_curves', (msg.mode === 'B' ? 'B' : 'A'));
            break;

        case 'quick_state':
            // StrideQuick panel readout: chain/canvas counts, loop bars, status.
            // Relay it through a file instead of outletting directly, so EVERY
            // StrideLink bridge (not only the one holding the canvas) can show
            // it: _pollQuickStateRelay in each bridge picks it up and outlets to
            // its own device. Fixes a duplicated track showing "Disconnected".
            try {
                fs.writeFileSync(STATE_FILE, JSON.stringify({
                    on_chain: msg.on_chain || 0, on_canvas: msg.on_canvas || 0,
                    bars: msg.bars || 4, connected: msg.connected ? 1 : 0,
                    locked: msg.locked || 0,
                    rescan: msg.rescan ? 1 : 0,
                    status: msg.status || '', ts: Date.now(),
                }));
            } catch (e) { /* mid-write, retry next readout */ }
            break;

        default:
            Max.post(`Stride: Unknown message type — ${msg.type}`);
    }
}

// ─── .alc File Generation ────────────────────────────────

function applyViaAlcFile(msg) {
    const params = msg.parameters || [];
    const clipBars = msg.clip_bars || 4;

    if (params.length === 0) {
        Max.post('Stride: No parameters to write');
        sendToApp({ type: 'apply_error', message: 'No parameters' });
        return;
    }

    Max.post(`Stride: Injecting automation — ${params.length} params, ${clipBars} bars`);
    Max.post(`Stride: device_name="${msg.device_name || '(none)'}" template_path="${msg.template_path || '(none)'}"`);
    // Confirms the pattern payload arrived intact at the m4l side. If this
    // line is missing after Apply when the canvas log shows notes=N, the
    // m4l device is running stale code — reload StrideLink.amxd.
    if (Array.isArray(msg.midi_notes) && msg.midi_notes.length > 0) {
        Max.post(`Stride: received armed pattern with ${msg.midi_notes.length} notes (will replace template's notes)`);
    } else {
        Max.post(`Stride: no pattern armed — keeping template's notes as-is`);
    }

    try {
        const result = alcGen.createAlcFile(msg);

        if (result.success) {
            // Note-inject result is surfaced loudly so silent failure of
            // injectMidiNotes can't masquerade as "everything worked" — a
            // common confusion when the user picks a pattern, gets a green
            // toast, and Live shows the wrong notes.
            const notesPart = (result.notesWritten || 0) > 0
                ? `, notes=${result.notesWritten} (${result.pitchCount || 0} pitches)`
                : '';
            Max.post(`Stride: .alc saved → ${result.filename} (${result.paramsWritten}/${result.requestedCount} params, ${result.skippedCount} skipped, template_matched=${result.templateMatched}${notesPart})`);
            if (result.noteInjectError) {
                Max.post(`Stride: !! MIDI note inject FAILED — ${result.noteInjectError}`);
            }
            sendToApp({
                type: 'alc_generated',
                success: true,
                filename: result.filename,
                filePath: result.filePath,
                params_written: result.paramsWritten,
                skipped_count: result.skippedCount || 0,
                requested_count: result.requestedCount || 0,
                mismatch_count: result.mismatchCount || 0,
                template_matched: result.templateMatched !== false,
                template_matched_name: result.templateMatchedName || null,
                notes_written: result.notesWritten || 0,
                pitch_count: result.pitchCount || 0,
                note_inject_error: result.noteInjectError || null,
            });

            // Folder auto-open removed — the canvas now shows a drag handle
            // that lets the user drag the .alc directly into Ableton. The
            // "Open folder" button in the success toast is still available
            // as a fallback if the user prefers the old workflow.
        } else if (result.needsTemplate) {
            // No template — guide user to import one via My Racks
            Max.post('Stride: No template — user needs to import a rack template');
            sendToApp({
                type: 'needs_template',
                message: result.error,
                device_name: msg.device_name || null,
            });
        } else {
            Max.post(`Stride: .alc generation failed — ${result.error}`);
            sendToApp({
                type: 'apply_error',
                message: result.error,
            });
        }
    } catch (e) {
        Max.post(`Stride: .alc generation error — ${e.message}`);
        sendToApp({
            type: 'apply_error',
            message: 'Failed to generate .alc: ' + e.message,
        });
    }
}

// ─── Remote Script Automation Writer (legacy) ────────────

function applyViaRemoteScript(msg) {
    const params = msg.parameters || [];
    const clipBars = msg.clip_bars || 4;

    if (params.length === 0) {
        Max.post('Stride: No parameters to write');
        sendToApp({ type: 'apply_error', message: 'No parameters' });
        return;
    }

    let totalPoints = 0;
    const payload = {
        create_clip: msg.create_clip_if_missing !== false,
        clip_bars: clipBars,
        clip_slot: 0,
        params: params.map(p => {
            const pts = (p.points || []).map(pt => ({
                time: pt.time,
                value: pt.value,
            }));
            totalPoints += pts.length;
            return {
                id: p.id,
                name: p.name,
                _path: p._path || null,
                min: p.min,
                max: p.max,
                points: pts
            };
        })
    };

    // Write trigger file for the Remote Script
    try {
        fs.writeFileSync(TRIGGER_FILE, JSON.stringify(payload));
        Max.post(`Stride: Wrote trigger file — ${params.length} params, ${totalPoints} points`);
    } catch (e) {
        Max.post(`Stride: Error writing trigger: ${e.message}`);
        sendToApp({ type: 'apply_error', message: 'Failed to write trigger file' });
        return;
    }

    // Clean up any old result file
    try { fs.unlinkSync(RESULT_FILE); } catch (e) {}

    // Poll for result from the Remote Script (checks every 200ms, up to 30s)
    let attempts = 0;
    const maxAttempts = 150;  // 150 × 200ms = 30s timeout

    const checkResult = () => {
        attempts++;
        try {
            if (fs.existsSync(RESULT_FILE)) {
                const result = JSON.parse(fs.readFileSync(RESULT_FILE, 'utf8'));
                fs.unlinkSync(RESULT_FILE);

                if (result.success) {
                    Max.post(`Stride: Remote Script wrote ${result.params_written} params`);
                    sendToApp({
                        type: 'apply_success',
                        params_written: result.params_written
                    });
                } else {
                    Max.post(`Stride: Remote Script error — ${result.message}`);
                    sendToApp({
                        type: 'apply_error',
                        message: result.message || 'Remote Script failed'
                    });
                }
                return;
            }
        } catch (e) {}

        if (attempts >= maxAttempts) {
            Max.post('Stride: Timeout waiting for Remote Script — is StrideWriter installed?');
            sendToApp({
                type: 'apply_error',
                message: 'Timeout — StrideWriter Remote Script not responding. Install it in Ableton Preferences.'
            });
            return;
        }

        setTimeout(checkResult, 200);
    };

    setTimeout(checkResult, 500);  // First check after 500ms
}

// ─── Utility ──────────────────────────────────────────────

function sendToApp(msg) {
    if (appSocket && appSocket.readyState === 1) {
        appSocket.send(JSON.stringify(msg));
    }
}

// ─── Open Canvas App ─────────────────────────────────────

// Stride's Electron main process writes its own executable path to this file
// on every launch, so we can find the app no matter where the user installed
// it (especially important on Mac where Stride.app lives in /Applications
// while the M4L folder is in the Ableton User Library, and on Windows when
// the user unzips Stride.exe somewhere non-standard).
//
// File format:
//   Line 1: exe path (Stride.exe / Stride.app in prod, electron.exe in dev)
//   Line 2 (optional): "MODE=dev"   — indicates dev-launch via `npm start`
//   Line 3 (optional): "APP_DIR=…"  — absolute path to the source app dir
//
// Returns: { exe, mode: 'prod'|'dev', appDir: string|null } or null if missing.
function readAppPathMarker() {
    try {
        const home = os.homedir();
        const dataDir = process.platform === 'win32'
            ? path.join(home, 'AppData', 'Roaming', 'stride-canvas', 'stride-data')
            : process.platform === 'darwin'
                ? path.join(home, 'Library', 'Application Support', 'stride-canvas', 'stride-data')
                : path.join(home, '.config', 'stride-canvas', 'stride-data');
        const marker = path.join(dataDir, 'app-path.txt');
        if (!fs.existsSync(marker)) return null;
        const raw = fs.readFileSync(marker, 'utf8').trim();
        if (!raw) return null;
        const lines = raw.split(/\r?\n/);
        const exe = lines[0];
        if (!exe || !fs.existsSync(exe)) return null;
        let mode = 'prod';
        let appDir = null;
        for (const line of lines.slice(1)) {
            if (line === 'MODE=dev') mode = 'dev';
            else if (line.startsWith('APP_DIR=')) appDir = line.slice('APP_DIR='.length);
        }
        return { exe, mode, appDir };
    } catch (e) {
        return null;
    }
}

// Multi-step locator — tries every strategy we know before giving up.
// Returns { launchCmd, processName } or null if nothing is found.
function findStrideExecutable() {
    const isWin = process.platform === 'win32';
    const isMac = process.platform === 'darwin';

    // Step 1 — portable mode: Stride sitting right next to the M4L folder
    // (the unzipped Windows dist layout, or a developer running from the repo)
    const portable = path.join(__dirname, '..', isWin ? 'Stride.exe' : 'Stride.app');
    if (fs.existsSync(portable)) {
        return isWin
            ? { launchCmd: `start "" "${portable}"`, processName: 'Stride.exe' }
            : { launchCmd: `open "${portable}"`, processName: 'Stride' };
    }

    // Step 2 — canonical path written by Stride itself on every launch
    const recorded = readAppPathMarker();
    if (recorded) {
        if (recorded.mode === 'dev') {
            // Dev mode: the recorded exe is electron.exe itself. Launching it
            // alone would just show the default "To run a local app" window.
            // We need `electron.exe <app-dir>` so Electron loads our source.
            if (recorded.appDir && fs.existsSync(recorded.appDir)) {
                return isWin
                    ? { launchCmd: `start "" "${recorded.exe}" "${recorded.appDir}"`, processName: 'electron.exe' }
                    : { launchCmd: `"${recorded.exe}" "${recorded.appDir}" &`, processName: 'Electron' };
            }
            // Dev marker but no usable app-dir — skip, let later steps try
        } else {
            return isWin
                ? { launchCmd: `start "" "${recorded.exe}"`, processName: 'Stride.exe' }
                : { launchCmd: `open "${recorded.exe}"`, processName: 'Stride' };
        }
    }

    // Step 3 — Mac: LaunchServices bundle-ID lookup (finds it anywhere on the system)
    if (isMac) {
        return { launchCmd: `open -b io.stridehub.canvas`, processName: 'Stride' };
    }

    // Step 4 — Windows: common install locations
    if (isWin) {
        const candidates = [
            path.join(process.env.LOCALAPPDATA || '', 'Programs', 'Stride', 'Stride.exe'),
            path.join(process.env.ProgramFiles || 'C:\\Program Files', 'Stride', 'Stride.exe'),
            path.join(process.env['ProgramFiles(x86)'] || 'C:\\Program Files (x86)', 'Stride', 'Stride.exe'),
        ];
        for (const c of candidates) {
            if (c && fs.existsSync(c)) {
                return { launchCmd: `start "" "${c}"`, processName: 'Stride.exe' };
            }
        }
    }

    return null;
}

// Launch the Stride canvas app. Resolves its location, skips relaunch if the
// canvas is already connected, and debounces so a burst of presses cannot spawn
// two windows. Shared by the Open Canvas button and the auto-launch path that
// fires when a device button is pressed with no canvas connected.
let _canvasLaunchAt = 0;       // when we last kicked off a launch
function launchCanvasApp(hidden) {
    const { exec } = require('child_process');
    const isWin = process.platform === 'win32';
    const isMac = process.platform === 'darwin';

    if (!isWin && !isMac) {
        Max.post(`Stride: Unsupported platform ${process.platform}`);
        return;
    }

    const resolved = findStrideExecutable();
    if (!resolved) {
        Max.post('Stride: Could not find Stride app. Launch Stride once from your ' +
                 (isMac ? 'Applications folder' : 'Start Menu or the folder you unzipped it to') +
                 ' so its location is registered, then try again.');
        return;
    }

    // Already connected: never relaunch. A hidden (feature) press just lets its
    // command flow through; a visible (Open Canvas) press focuses the window.
    if (appSocket && appSocket.readyState === 1) {
        if (!hidden) sendToApp({ type: 'focus_window' });
        return;
    }

    // Not connected. Guard against double-launching while a previous launch is
    // still booting. We deliberately do NOT use tasklist/pgrep: in dev the
    // process is a generic 'electron.exe' that matches OTHER Electron apps (VS
    // Code, etc.), so it false-positives and wrongly skips the launch (that was
    // the "pressed a feature, nothing opened" bug). Debounce on our own launch
    // timestamp instead; Stride's single-instance lock is the final backstop.
    const now = Date.now();
    if (now - _canvasLaunchAt < 15000) return;
    _canvasLaunchAt = now;

    // A hidden launch passes STRIDE_START_HIDDEN=1 so main.js starts the window
    // with show:false (feature presses run silently; Open Canvas reveals it).
    const opts = hidden ? { env: Object.assign({}, process.env, { STRIDE_START_HIDDEN: '1' }) } : {};
    Max.post(hidden ? 'Stride: Launching canvas (background)...' : 'Stride: Launching canvas...');
    exec(resolved.launchCmd, opts, (launchErr) => {
        if (launchErr) Max.post(`Stride: Launch error — ${launchErr.message}`);
    });
}

Max.addHandler('open_canvas', () => {
    // If canvas is already connected, just tell it to focus
    if (appSocket && appSocket.readyState === 1) {
        Max.post('Stride: Canvas already connected — focusing window');
        sendToApp({ type: 'focus_window' });
        return;
    }
    // Not connected: the user explicitly wants the window, so reveal it once it
    // connects (covers a feature press that already booted it hidden).
    _revealOnConnect = true;
    launchCanvasApp(false);
});

// ─── Show Guide ──────────────────────────────────────────

Max.addHandler('show_guide', () => {
    if (appSocket && appSocket.readyState === 1) {
        sendToApp({ type: 'show_guide' });
        Max.post('Stride: Showing guide in canvas');
    } else {
        Max.post('Stride: Canvas not connected — cannot show guide');
    }
});

// A canvas connected to ANY bridge (this one OR a sibling on a duplicated track)
// writes connected:1 to STATE_FILE every ~1.2s. If one is alive, a relay-only
// bridge (appSocket null) must NOT auto-launch a SECOND instance on a feature/
// Motion press — that launch hits the single-instance lock and POPS the hidden
// canvas over Ableton. The press still reaches the canvas via the relay file, so
// gating the launch loses nothing. (4s window tolerates a crashed canvas whose
// connected:0 never got written — its STATE_FILE ts goes stale.)
function _aCanvasIsConnectedAnywhere() {
    try {
        const s = JSON.parse(fs.readFileSync(STATE_FILE, 'utf8'));
        return !!(s && s.connected === 1 && s.ts && (Date.now() - s.ts < 4000));
    } catch (e) { return false; }
}

// ─── StrideQuick — quick-control panel ────────────────────
// The StrideLink device's folding "Quick" panel sends `quick <action> [arg]`
// here. We forward it to the canvas app, which runs the matching shortcut
// (the SAME function the on-screen button calls — no new logic, the canvas
// stays the single source of truth). Inert when the app isn't connected.
Max.addHandler('quick', (action, arg) => {
    if (action === undefined || action === null) return;
    // Write the press to the shared relay file. We do NOT sendToApp directly:
    // this instance may not be the one holding the canvas. The canvas-holding
    // instance forwards it from _pollQuickRelay(). Single path, no double-apply.
    // `ts` lets a just-connected canvas tell a fresh press (run it) from a stale
    // one left over from a previous session (skip it).
    try {
        const payload = {
            action: String(action),
            arg: (arg !== undefined ? arg : null),
            nonce: Date.now() + '_' + Math.random().toString(36).slice(2),
            ts: Date.now(),
        };
        fs.writeFileSync(QUICK_FILE, JSON.stringify(payload));
        Max.post(`Stride quick: ${action}${arg !== undefined ? (' ' + arg) : ''} (relayed)`);
    } catch (e) {
        Max.post(`Stride quick: relay write failed — ${e.message}`);
    }
    // Auto-launch: if no canvas is connected to this bridge, start it so the
    // press is not a silent no-op. launchCanvasApp() no-ops if Stride is already
    // running; the press waits in the relay file and runs once the canvas
    // connects and scans (the connection handler forwards a fresh press).
    // BUT skip it if a canvas is already connected to ANOTHER bridge (duplicated
    // track) — launching a second instance there pops the hidden canvas; the
    // press relays to the canvas-holding bridge instead.
    if ((!appSocket || appSocket.readyState !== 1) && !_aCanvasIsConnectedAnywhere()) {
        launchCanvasApp(true);
    }
});

// Relay poll — the instance that actually holds the canvas connection forwards
// queued Quick commands to it. Runs in every instance, but only the one with a
// live appSocket forwards, so the command reaches the canvas no matter which
// bridge received the button press.
function _pollQuickRelay() {
    if (!appSocket || appSocket.readyState !== 1) return;
    let cmd;
    try {
        if (!fs.existsSync(QUICK_FILE)) return;
        cmd = JSON.parse(fs.readFileSync(QUICK_FILE, 'utf8'));
    } catch (e) {
        return;  // mid-write or transient — retry next tick
    }
    if (cmd && cmd.nonce && cmd.nonce !== _lastQuickNonce) {
        _lastQuickNonce = cmd.nonce;
        sendToApp({ type: 'quick_command', action: cmd.action, arg: cmd.arg });
    }
}
setInterval(_pollQuickRelay, 75);

// State/status relay — the mirror of the command relay, other direction. The
// canvas-holding bridge writes the readout to STATE_FILE (the 'quick_state'
// case + on ws close); EVERY bridge polls it and outlets to its own device, so
// a duplicated StrideLink shows the same live status/counter instead of a stale
// "Disconnected".
function _pollQuickStateRelay() {
    let s;
    try {
        if (!fs.existsSync(STATE_FILE)) return;
        s = JSON.parse(fs.readFileSync(STATE_FILE, 'utf8'));
    } catch (e) { return; }
    if (s && s.ts && s.ts !== _lastStateNonce) {
        _lastStateNonce = s.ts;
        Max.outlet('quick_state', s.on_chain || 0, s.on_canvas || 0, s.bars || 4, s.connected ? 1 : 0);
        Max.outlet('quick_locked', s.locked || 0);   // separate outlet so the Lock readout wires in without touching the existing unpack
        Max.outlet('quick_rescan', (typeof s.rescan === 'number' ? s.rescan : 1));   // separate outlet → drives the device ↻ Auto-Rescan button color (canvas-owned, reflected via quick_state)
        if (s.status) Max.outlet('quick_status', String(s.status));
    }
}
setInterval(_pollQuickStateRelay, 100);

// (bridge-owned Auto-Rescan setting removed — reverted; the canvas's Motion buttons always rescan-then-apply.)

// ─── Error Safety Net ────────────────────────────────────
// Prevent uncaught exceptions from crashing Node for Max
// (which would kill the WebSocket server and disconnect the canvas)

process.on('uncaughtException', (err) => {
    Max.post(`Stride: Uncaught error (recovered) — ${err.message}`);
});

process.on('unhandledRejection', (reason) => {
    Max.post(`Stride: Unhandled promise rejection (recovered) — ${reason}`);
});

// ─── Clean Port Release on Exit ───────────────────────────
// Max sometimes terminates node.script without giving us time to gracefully
// close. Try to close wss on the common signals so the next Node instance
// doesn't hit EADDRINUSE. Best-effort — if Max kills us hard, the auto-kill
// retry logic above will clean up the next run.
function shutdown() {
    try {
        if (appSocket) { try { appSocket.close(); } catch {} }
        if (wss) { try { wss.close(); } catch {} }
        // Stop advertising as the port-holder and clear our heartbeat so a sibling
        // bridge takes over the port immediately instead of waiting for it to go stale.
        if (_bridgeHeartbeatTimer) { try { clearInterval(_bridgeHeartbeatTimer); } catch {} _bridgeHeartbeatTimer = null; }
        if (!_relayOnly) { try { fs.unlinkSync(BRIDGE_ALIVE_FILE); } catch {} }
    } catch {}
}
process.on('exit', shutdown);
process.on('SIGINT', () => { shutdown(); process.exit(0); });
process.on('SIGTERM', () => { shutdown(); process.exit(0); });

// ─── Start ────────────────────────────────────────────────

startServer();
Max.post('Stride Link: Node server initialized');
