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

        // Send handshake
        sendToApp({ type: 'm4l_ready', version: VERSION });
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
                Max.post(`Stride: Port ${PORT} in use — retrying in 2s (attempt ${retryCount + 1}/3)`);
                wss.close();
                // Kill stale process and retry
                const { exec } = require('child_process');
                exec(`npx kill-port ${PORT}`, () => {
                    setTimeout(() => startServer(retryCount + 1), 2000);
                });
            } else {
                Max.post(`Stride: Port ${PORT} in use — giving up after 3 retries. Close other Max instances.`);
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

            // Open Explorer with the file selected (no hunting)
            try {
                const { exec } = require('child_process');
                const cmd = process.platform === 'win32'
                    ? `explorer /select,"${result.filePath}"`
                    : `open -R "${result.filePath}"`;
                exec(cmd, (err) => {
                    if (err) Max.post(`Stride: Could not open folder — ${err.message}`);
                });
            } catch (e) {
                Max.post(`Stride: Could not open folder — ${e.message}`);
            }
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

    // Locate the packaged app (one level up from M4L/) — .exe on Windows, .app on Mac
    let distArtifact, processName, checkCmd, launchCmd;

    if (isWin) {
        distArtifact = path.join(__dirname, '..', 'Stride.exe');
        const isDist = fs.existsSync(distArtifact);
        processName = isDist ? 'Stride.exe' : 'electron.exe';
        checkCmd = `tasklist /FI "IMAGENAME eq ${processName}" /NH`;
        if (isDist) {
            launchCmd = `start "" "${distArtifact}"`;
        } else {
            const appDir = path.join(__dirname, '..', '..', 'app');
            launchCmd = `cd /d "${appDir}" && start /b npm start`;
        }
    } else if (isMac) {
        distArtifact = path.join(__dirname, '..', 'Stride.app');
        const isDist = fs.existsSync(distArtifact);
        processName = isDist ? 'Stride' : 'Electron';
        // pgrep -x returns PID + exit 0 if running, nothing + exit 1 if not
        checkCmd = `pgrep -x "${processName}"`;
        if (isDist) {
            // `open` launches the .app detached from Max's process tree
            launchCmd = `open "${distArtifact}"`;
        } else {
            const appDir = path.join(__dirname, '..', '..', 'app');
            launchCmd = `cd "${appDir}" && nohup npm start > /dev/null 2>&1 &`;
        }
    } else {
        Max.post(`Stride: Unsupported platform ${process.platform}`);
        return;
    }

    exec(checkCmd, (err, stdout) => {
        // Windows: tasklist prints matching process line if found (err is null)
        // Mac:     pgrep prints PID if found (err is null), empty + err on miss
        const isRunning = !err && stdout && stdout.trim().length > 0 && (
            isWin ? stdout.toLowerCase().includes(processName.toLowerCase()) : true
        );
        if (isRunning) {
            Max.post('Stride: Canvas already running');
            return;
        }
        Max.post('Stride: Launching canvas...');
        exec(launchCmd, (launchErr) => {
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

// ─── Start ────────────────────────────────────────────────

startServer();
Max.post('Stride Link: Node server initialized');
