/**
 * Stride WebSocket Protocol — Message Types
 * Shared between M4L device and Canvas app
 * All messages are JSON over WebSocket on localhost:9100
 */

// ─── M4L → App ────────────────────────────────────────────

/** Sent after scanning a rack's parameters */
const RACK_SCANNED = 'rack_scanned';
// { type, track_name, device_name, clip_bars, clip_slot, parameters: [{ id, name, min, max, value }] }

/** Sent when clip changes (selected, resized, deleted) */
const CLIP_CHANGED = 'clip_changed';
// { type, clip_bars, has_clip, clip_slot }

/** Sent after automation is successfully written */
const APPLY_SUCCESS = 'apply_success';
// { type, params_written, clip_bars }

/** Sent when writing automation fails */
const APPLY_ERROR = 'apply_error';
// { type, message }

/** Connection handshake from M4L */
const M4L_READY = 'm4l_ready';
// { type, version }

/** Sent when track or device selection changes in Ableton */
const TRACK_CHANGED = 'track_changed';
// { type, track_name, has_device }

// ─── App → M4L ────────────────────────────────────────────

/** Request M4L to scan the current rack */
const REQUEST_SCAN = 'request_scan';
// { type }

/** Send automation curves to write into clip */
const APPLY_AUTOMATION = 'apply_automation';
// { type, create_clip_if_missing, clip_bars, parameters: [{ id, name, points: [{ time, value, curve }] }] }

/** Send MIDI notes to write into clip */
const APPLY_MIDI = 'apply_midi';
// { type, create_clip_if_missing, clip_bars, notes: [{ pitch, time, duration, velocity }] }

/** Temporarily set a parameter value for preview */
const PREVIEW_PARAM = 'preview_param';
// { type, id, value }

/** Restore all params to their original values */
const STOP_PREVIEW = 'stop_preview';
// { type }

/** Ask M4L to create an empty clip */
const REQUEST_CREATE_CLIP = 'request_create_clip';
// { type, bars, slot_index }

/** App handshake response */
const APP_READY = 'app_ready';
// { type, version }

// ─── Export ────────────────────────────────────────────────

if (typeof module !== 'undefined') {
    module.exports = {
        RACK_SCANNED, CLIP_CHANGED, APPLY_SUCCESS, APPLY_ERROR,
        M4L_READY, TRACK_CHANGED,
        REQUEST_SCAN, APPLY_AUTOMATION, APPLY_MIDI,
        PREVIEW_PARAM, STOP_PREVIEW, REQUEST_CREATE_CLIP, APP_READY
    };
}
