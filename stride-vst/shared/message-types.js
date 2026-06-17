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

/** v.next direct-inject path — sent after StrideInject Remote Script
 *  writes envelopes directly into the selected clip (no .alc file, no
 *  drag). mode = 'bezier' when the script used Live 12's native bezier
 *  envelope API, 'step' when it fell back to insert_step subdivision. */
const INJECT_SUCCESS = 'inject_success';
// { type, params_written, points_written, mode, clip_bars }

/** v.next direct-inject path — sent when the inject flow fails (Remote
 *  Script not installed, target clip missing, write error, etc.). The
 *  legacy .alc path is unaffected — clients should fall back to
 *  apply_automation if they want a drag-based result. */
const INJECT_ERROR = 'inject_error';
// { type, message }

/** Connection handshake from M4L */
const M4L_READY = 'm4l_ready';
// { type, version, user_library_path }
// user_library_path: string | null — added in Phase 2 of the
// install-to-ableton fix. The M4L device knows where it lives (which IS
// the User Library), so it tells the app. Null in dev mode and on any
// path-computation error. Optional/backwards-compatible: older app
// builds that don't read it just ignore the field.

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

/** v.next direct-inject path — write envelopes straight into the selected
 *  clip via the StrideInject Remote Script. No .alc file, no drag.
 *  Same parameter shape as apply_automation, plus optional force_legacy_step. */
const APPLY_INJECT = 'apply_inject';
// { type, create_clip_if_missing, clip_bars, clip_slot, force_legacy_step,
//   parameters: [{ id, name, _path, min, max, is_log, points: [{ time, value, curve }] }] }

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

// ─── StrideQuick (M4L quick-control panel) ────────────────

/** M4L → App: a StrideQuick panel button was pressed. The app runs the
 *  matching canvas shortcut — the SAME function the on-screen button calls,
 *  so the canvas stays the single source of truth and updates instantly. */
const QUICK_COMMAND = 'quick_command';
// { type, action, arg }
//   action: 'rescan'|'chaos'|'neuro'|'reflector'|'sh'|'prism'|'mutate'
//           |'shuffle'|'double'|'half'|'bars'|'inject'
//   arg: bar count for 'bars' (4|8|16|32), else null

/** App → M4L: current canvas readout for the panel (param counts, loop
 *  length, connection). Pushed after every quick action and on each scan. */
const QUICK_STATE = 'quick_state';
// { type, on_chain, on_canvas, bars, connected }

// ─── Export ────────────────────────────────────────────────

if (typeof module !== 'undefined') {
    module.exports = {
        RACK_SCANNED, CLIP_CHANGED, APPLY_SUCCESS, APPLY_ERROR,
        INJECT_SUCCESS, INJECT_ERROR,
        M4L_READY, TRACK_CHANGED,
        REQUEST_SCAN, APPLY_AUTOMATION, APPLY_INJECT, APPLY_MIDI,
        PREVIEW_PARAM, STOP_PREVIEW, REQUEST_CREATE_CLIP, APP_READY,
        QUICK_COMMAND, QUICK_STATE
    };
}
