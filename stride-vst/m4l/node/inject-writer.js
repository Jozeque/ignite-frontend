/**
 * Stride M4L — Direct-Inject Bridge
 *
 * Bridges the canvas app's `apply_inject` message to the StrideInject
 * Remote Script via file-based IPC:
 *
 *   - Writes the canvas payload to ~/_stride_inject_trigger.json
 *   - Polls ~/_stride_inject_result.json for the Remote Script's response
 *   - Reports back via the supplied { onSuccess, onError } callbacks
 *
 * This module is intentionally separate from writer.js so the existing
 * .alc-drag path (apply_automation -> alc-generator) and the legacy
 * Max-patcher LiveAPI path (writer.writeAutomation, currently dormant)
 * remain untouched. Removing this file removes the direct-inject path
 * cleanly with zero impact elsewhere.
 *
 * Requires StrideInject installed in Ableton's MIDI Remote Scripts dir
 * and enabled in Preferences -> Link/Tempo/MIDI -> Control Surface.
 */

const Max = require('max-api');
const fs = require('fs');
const path = require('path');
const os = require('os');

const TRIGGER_FILE = path.join(os.homedir(), '_stride_inject_trigger.json');
const RESULT_FILE = path.join(os.homedir(), '_stride_inject_result.json');

const POLL_INTERVAL_MS = 200;
// StrideInject now writes steps in chunks across Ableton's scheduler (so it
// never blocks the UI). A big multi-lane 32-bar clip can take a while to drain;
// give it generous headroom so the bridge doesn't time out mid-write.
const POLL_TIMEOUT_MS = 120000;
const FIRST_CHECK_DELAY_MS = 400;

function _safeUnlink(p) {
    try { fs.unlinkSync(p); } catch (e) { /* not present — fine */ }
}

/**
 * Send a direct-inject request to the StrideInject Remote Script.
 *
 * @param {Object}   msg                              The apply_inject message from the canvas app
 * @param {Array}    msg.parameters                   [{ id, name, _path, min, max, is_log, points: [{ time, value, curve }] }]
 * @param {number}   [msg.clip_bars=4]
 * @param {number}   [msg.clip_slot=0]
 * @param {boolean}  [msg.create_clip_if_missing=true]
 * @param {boolean}  [msg.force_legacy_step=false]    Force insert_step subdivision even if bezier API is available
 * @param {Object}   callbacks
 * @param {Function} callbacks.onSuccess  (result) => void   result: { success, mode, params_written, points_written, message }
 * @param {Function} callbacks.onError    (errorMessage) => void
 */
function writeInject(msg, callbacks) {
    const onSuccess = (callbacks && callbacks.onSuccess) || function () {};
    const onError = (callbacks && callbacks.onError) || function () {};

    const params = (msg && msg.parameters) || [];
    const notes = (msg && msg.notes) || [];
    if (params.length === 0 && notes.length === 0) {
        onError('Nothing to inject');
        return;
    }

    const payload = {
        create_clip: msg.create_clip_if_missing !== false,
        clip_bars: msg.clip_bars || 4,
        clip_slot: msg.clip_slot || 0,
        force_legacy_step: msg.force_legacy_step === true,
        params: params.map(p => ({
            id: p.id,
            name: p.name,
            _path: p._path || null,
            min: p.min != null ? p.min : 0,
            max: p.max != null ? p.max : 1,
            is_log: p.is_log || false,
            points: (p.points || []).map(pt => ({
                time: pt.time,
                value: pt.value,
                curve: pt.curve || 0,
            })),
        })),
        // Armed Pattern Library notes ride along — StrideInject writes them into
        // the same clip as the envelopes (unify patterns with Direct Inject).
        notes: notes.map(n => ({
            pitch: n.pitch,
            time: n.time,
            duration: n.duration,
            velocity: n.velocity != null ? n.velocity : 100,
        })),
    };

    let totalPoints = 0;
    payload.params.forEach(p => { totalPoints += p.points.length; });

    // Clear any stale result before writing the new trigger — otherwise the
    // poller can race and report the previous run's result against this one.
    _safeUnlink(RESULT_FILE);

    try {
        fs.writeFileSync(TRIGGER_FILE, JSON.stringify(payload));
        Max.post(`Stride: inject trigger written — ${params.length} params, ${totalPoints} points, ${notes.length} notes`);
    } catch (e) {
        onError('Failed to write inject trigger: ' + e.message);
        return;
    }

    const deadline = Date.now() + POLL_TIMEOUT_MS;

    const check = () => {
        try {
            if (fs.existsSync(RESULT_FILE)) {
                let raw;
                try {
                    raw = fs.readFileSync(RESULT_FILE, 'utf8');
                } catch (e) {
                    // File appeared but isn't readable yet — retry
                    if (Date.now() >= deadline) {
                        onError('Result file unreadable: ' + e.message);
                        return;
                    }
                    setTimeout(check, POLL_INTERVAL_MS);
                    return;
                }
                let data;
                try {
                    data = JSON.parse(raw);
                } catch (e) {
                    // Mid-write — retry
                    if (Date.now() >= deadline) {
                        onError('Result file corrupt: ' + e.message);
                        return;
                    }
                    setTimeout(check, POLL_INTERVAL_MS);
                    return;
                }
                _safeUnlink(RESULT_FILE);
                if (data && data.success) {
                    onSuccess(data);
                } else {
                    onError((data && data.message) || 'StrideInject reported failure');
                }
                return;
            }
        } catch (e) {
            // Filesystem hiccup — keep trying until deadline
        }
        if (Date.now() >= deadline) {
            onError('Timeout waiting for StrideInject. Install the Remote Script and enable it in Ableton Preferences -> Link/Tempo/MIDI -> Control Surface.');
            return;
        }
        setTimeout(check, POLL_INTERVAL_MS);
    };

    setTimeout(check, FIRST_CHECK_DELAY_MS);
}

module.exports = { writeInject };
