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


let wss = null;
let appSocket = null;

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

// ─── User Library Self-Report ─────────────────────────────
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

// ─── WebSocket Server ─────────────────────────────────────

function startServer(retryCount) {
    retryCount = retryCount || 0;

    wss = new WebSocketServer({ port: PORT });

    wss.on('listening', () => {
        Max.post(`Stride: WebSocket server running on localhost:${PORT}`);
        Max.outlet('status', 'server_ready');
    });

    wss.on('connection', (ws) => {
        Max.post('Stride: Canvas app connected');
        appSocket = ws;

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
            Max.outlet('status', 'app_disconnected');
        });

        ws.on('error', (err) => {
            Max.post(`Stride: WebSocket error — ${err.message}`);
        });
    });

    wss.on('error', (err) => {
        if (err.code === 'EADDRINUSE') {
            if (retryCount < 3) {
                Max.post(`Stride: Port ${PORT} in use — trying to clear stale process (attempt ${retryCount + 1}/3)`);
                wss.close();
                // Native OS kill — npx kill-port isn't available in Max's Node env
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

    try {
        const result = alcGen.createAlcFile(msg);

        if (result.success) {
            Max.post(`Stride: .alc saved → ${result.filename} (${result.paramsWritten}/${result.requestedCount} params, ${result.skippedCount} skipped, template_matched=${result.templateMatched})`);
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

Max.addHandler('open_canvas', () => {
    // If canvas is already connected, just tell it to focus
    if (appSocket && appSocket.readyState === 1) {
        Max.post('Stride: Canvas already connected — focusing window');
        sendToApp({ type: 'focus_window' });
        return;
    }

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
                 ' so its location is registered, then click Open Canvas again.');
        return;
    }

    // Is Stride already running? pgrep (Mac) / tasklist (Win).
    const checkCmd = isWin
        ? `tasklist /FI "IMAGENAME eq ${resolved.processName}" /NH`
        : `pgrep -x "${resolved.processName}"`;

    exec(checkCmd, (err, stdout) => {
        const isRunning = !err && stdout && stdout.trim().length > 0 && (
            isWin ? stdout.toLowerCase().includes(resolved.processName.toLowerCase()) : true
        );
        if (isRunning) {
            Max.post('Stride: Canvas already running — focusing...');
            // Focus via WebSocket if we have a socket, else the open/start commands
            // will bring the window forward on both platforms.
            exec(resolved.launchCmd, () => {});
            return;
        }
        Max.post('Stride: Launching canvas...');
        exec(resolved.launchCmd, (launchErr) => {
            if (launchErr) Max.post(`Stride: Launch error — ${launchErr.message}`);
        });
    });
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
    } catch {}
}
process.on('exit', shutdown);
process.on('SIGINT', () => { shutdown(); process.exit(0); });
process.on('SIGTERM', () => { shutdown(); process.exit(0); });

// ─── Start ────────────────────────────────────────────────

startServer();
Max.post('Stride Link: Node server initialized');
