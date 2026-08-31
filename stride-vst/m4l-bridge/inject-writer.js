/**
 * StrideBridge - Inject to Clip (file IPC to the StrideInject Remote Script)
 *
 * The bridge's live lanes already hold everything a clip envelope needs: a LOM
 * parameter path, 0..1 points in beats, min/max/is_log from the map-time probe.
 * This module hands that to StrideInject, the Python Remote Script that owns all
 * of the actual envelope work (clip targeting, create/clear, bezier coefficients,
 * chunked insert_step, the arrangement path, undo):
 *
 *   - writes the payload to ~/_stride_inject_trigger.json
 *   - polls ~/_stride_inject_result.json for the answer
 *   - reports back through { onSuccess, onError }
 *
 * WHY A SECOND COPY OF THIS (m4l/node/inject-writer.js is the StrideLink one):
 * the two Max devices ship as separate self-contained User Library folders
 * (README-StrideBridge.txt: "Keep the files together"), so a cross-folder require
 * cannot resolve on a user machine, and StrideBridge must not need StrideLink in
 * the set. What is NOT duplicated is the part that matters: StrideInject itself is
 * a single shared install in Ableton's Remote Scripts, used by both paths, and its
 * _busy guard means a desktop-app inject and a bridge inject can never race.
 *
 * Requires StrideInject installed and enabled in Ableton:
 * Preferences -> Link/Tempo/MIDI -> Control Surface -> StrideInject.
 */

'use strict';

const fs = require('fs');
const path = require('path');
const os = require('os');

let TRIGGER_FILE = path.join(os.homedir(), '_stride_inject_trigger.json');
let RESULT_FILE = path.join(os.homedir(), '_stride_inject_result.json');

// StrideInject writes steps in chunks across Ableton's scheduler so it never
// blocks the UI. A big multi-lane 32-bar clip takes a while to drain, so the
// timeout is generous: it is a "StrideInject is not there" detector, not a
// progress bar.
let POLL_INTERVAL_MS = 200;
let POLL_TIMEOUT_MS = 120000;
let FIRST_CHECK_DELAY_MS = 400;

let _post = function () {};

// Tests replace the paths, the log sink and the timings (see bridge-server's
// _setIoForTest for the same pattern).
function _setIoForTest(opts) {
    const o = opts || {};
    if (o.post) _post = o.post;
    if (o.trigger) TRIGGER_FILE = o.trigger;
    if (o.result) RESULT_FILE = o.result;
    if (typeof o.first === 'number') FIRST_CHECK_DELAY_MS = o.first;
    if (typeof o.poll === 'number') POLL_INTERVAL_MS = o.poll;
    if (typeof o.timeout === 'number') POLL_TIMEOUT_MS = o.timeout;
}

function _paths() { return { trigger: TRIGGER_FILE, result: RESULT_FILE }; }

function _safeUnlink(p) {
    try { fs.unlinkSync(p); } catch (e) { /* not present - fine */ }
}

/**
 * @param {Object}   msg
 * @param {Array}    msg.parameters  [{ id, name, _path, min, max, is_log, points: [{time,value,curve}] }]
 * @param {number}   [msg.clip_bars=4]
 * @param {Object}   callbacks
 * @param {Function} callbacks.onSuccess  (result) => void
 * @param {Function} callbacks.onError    (message) => void
 */
function writeInject(msg, callbacks) {
    const onSuccess = (callbacks && callbacks.onSuccess) || function () {};
    const onError = (callbacks && callbacks.onError) || function () {};

    const params = (msg && msg.parameters) || [];
    if (params.length === 0) {
        onError('Nothing to inject');
        return;
    }

    const payload = {
        // The bridge never creates clips: the user picks the clip in Live first,
        // then presses the button on the device. StrideInject targets
        // song.view.detail_clip, which is exactly "the clip you have open".
        create_clip: false,
        clip_bars: msg.clip_bars || 4,
        clip_slot: 0,
        force_legacy_step: msg.force_legacy_step === true,
        params: params.map(p => ({
            id: p.id != null ? p.id : 0,
            name: p.name || '',
            _path: p._path || null,
            // Hosted lanes have no LOM path: they are Stride's own DAW-facing macro,
            // resolved by NAME against the clip's track (see StrideInject).
            macro_name: p.macro_name || null,
            min: p.min != null ? p.min : 0,
            max: p.max != null ? p.max : 1,
            is_log: p.is_log || false,
            points: (p.points || []).map(pt => ({
                time: pt.time,
                value: pt.value,
                curve: pt.curve || 0,
            })),
        })),
        notes: [],
    };

    let totalPoints = 0;
    payload.params.forEach(p => { totalPoints += p.points.length; });

    // Clear any stale result before writing the trigger - otherwise the poller
    // can race and report the previous run's answer against this one.
    _safeUnlink(RESULT_FILE);

    try {
        fs.writeFileSync(TRIGGER_FILE, JSON.stringify(payload));
        _post('inject trigger written - ' + params.length + ' params, ' + totalPoints + ' points');
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
                    if (Date.now() >= deadline) { onError('Result file unreadable: ' + e.message); return; }
                    setTimeout(check, POLL_INTERVAL_MS);
                    return;
                }
                let data;
                try {
                    data = JSON.parse(raw);
                } catch (e) {
                    // mid-write - retry
                    if (Date.now() >= deadline) { onError('Result file corrupt: ' + e.message); return; }
                    setTimeout(check, POLL_INTERVAL_MS);
                    return;
                }
                _safeUnlink(RESULT_FILE);
                if (data && data.success) onSuccess(data);
                else onError((data && data.message) || 'StrideInject reported failure');
                return;
            }
        } catch (e) {
            // filesystem hiccup - keep trying until the deadline
        }
        if (Date.now() >= deadline) {
            onError('StrideInject is not answering. In Ableton: Preferences -> Link/Tempo/MIDI '
                  + '-> Control Surface -> choose StrideInject, then restart Live.');
            return;
        }
        setTimeout(check, POLL_INTERVAL_MS);
    };

    setTimeout(check, FIRST_CHECK_DELAY_MS);
}

module.exports = { writeInject, _setIoForTest, _paths };
