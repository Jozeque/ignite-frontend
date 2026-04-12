/**
 * Stride M4L — Automation & MIDI Writer
 * Sends curve data and MIDI notes to the Max patcher for writing into Ableton clips.
 *
 * The Max patcher uses Live API's clip methods:
 *   - clip.call("clear_envelope", paramId)
 *   - clip.call("insert_step", paramId, time, duration, value)
 *   - clip.call("set_notes") for MIDI
 */

const Max = require('max-api');
const fs = require('fs');
const path = require('path');

// Temp file for passing large JSON payloads to Max JS
const TEMP_DIR = path.join(__dirname);
const AUTO_FILE = path.join(TEMP_DIR, '_stride_auto.json');
const MIDI_FILE = path.join(TEMP_DIR, '_stride_midi.json');

/**
 * Write automation curves to clip via Max patcher.
 * All points are preserved (no downsampling) — chunked writer in Max JS
 * keeps Ableton responsive even with thousands of points.
 */
function writeAutomation(msg) {
    const params = msg.parameters || [];
    const clipBars = msg.clip_bars || 4;
    const createIfMissing = msg.create_clip_if_missing !== false;

    if (params.length === 0) {
        Max.post('Stride: No parameters to write');
        return;
    }

    let totalPoints = 0;
    const payload = {
        create_clip: createIfMissing,
        clip_bars: clipBars,
        clip_length: clipBars * 4,
        params: params.map(p => {
            const pts = (p.points || []).map(pt => ({
                time: pt.time,
                value: pt.value,
                curve: pt.curve || 0
            }));
            totalPoints += pts.length;
            return {
                id: p.id,
                name: p.name,
                _path: p._path || null,
                points: pts
            };
        })
    };

    fs.writeFileSync(AUTO_FILE, JSON.stringify(payload));
    Max.outlet('write_automation', AUTO_FILE);
    Max.post(`Stride: Sending ${params.length} params, ${totalPoints} points (${clipBars} bars)`);
}

/**
 * Write MIDI notes to clip via Max patcher.
 *
 * @param {Object} msg - The apply_midi message from the canvas app
 * @param {boolean} msg.create_clip_if_missing
 * @param {number} msg.clip_bars
 * @param {Array} msg.notes - Array of { pitch, time, duration, velocity }
 */
function writeMidi(msg) {
    const notes = msg.notes || [];
    const clipBars = msg.clip_bars || 4;
    const createIfMissing = msg.create_clip_if_missing !== false;

    if (notes.length === 0) {
        Max.post('Stride: No MIDI notes to write');
        return;
    }

    const payload = {
        create_clip: createIfMissing,
        clip_bars: clipBars,
        clip_length: clipBars * 4,
        notes: notes.map(n => ({
            pitch: n.pitch,
            time: n.time,
            duration: n.duration,
            velocity: n.velocity || 100
        }))
    };

    fs.writeFileSync(MIDI_FILE, JSON.stringify(payload));
    Max.outlet('write_midi', MIDI_FILE);
    Max.post(`Stride: Sending ${notes.length} MIDI notes to write (${clipBars} bars)`);
}

module.exports = { writeAutomation, writeMidi };

/*
 * ──────────────────────────────────────────────────────────
 * MAX PATCHER JAVASCRIPT REFERENCE
 * ──────────────────────────────────────────────────────────
 *
 * The following runs INSIDE the Max patcher to write envelopes:
 *
 * // ── write_automation ──
 * function write_automation(jsonStr) {
 *     var data = JSON.parse(jsonStr);
 *     var track = new LiveAPI("live_set view selected_track");
 *
 *     // Ensure clip exists
 *     var clipSlot = new LiveAPI("live_set view selected_track clip_slots 0");
 *     if (!parseInt(clipSlot.get("has_clip"))) {
 *         if (data.create_clip) {
 *             clipSlot.call("create_clip", data.clip_length);
 *         } else {
 *             outlet(0, "write_result", JSON.stringify({
 *                 success: false,
 *                 message: "No clip in slot"
 *             }));
 *             return;
 *         }
 *     }
 *
 *     var clip = new LiveAPI("live_set view selected_track clip_slots 0 clip");
 *
 *     // Resize clip if needed
 *     var currentLength = parseFloat(clip.get("length"));
 *     if (currentLength !== data.clip_length) {
 *         clip.set("length", data.clip_length);
 *     }
 *
 *     var paramsWritten = 0;
 *
 *     for (var p = 0; p < data.params.length; p++) {
 *         var param = data.params[p];
 *         var paramId = param.id;
 *
 *         // Clear existing envelope for this param
 *         clip.call("clear_envelope", paramId);
 *
 *         // Write each point as a step
 *         // insert_step(param_id, time, duration, value)
 *         for (var i = 0; i < param.points.length; i++) {
 *             var pt = param.points[i];
 *             var nextTime = (i + 1 < param.points.length)
 *                 ? param.points[i + 1].time
 *                 : data.clip_length;
 *             var duration = nextTime - pt.time;
 *
 *             if (duration > 0) {
 *                 clip.call("insert_step", paramId, pt.time, duration, pt.value);
 *             }
 *         }
 *
 *         paramsWritten++;
 *     }
 *
 *     outlet(0, "write_result", JSON.stringify({
 *         success: true,
 *         params_written: paramsWritten,
 *         clip_bars: data.clip_bars
 *     }));
 * }
 *
 * // ── write_midi ──
 * function write_midi(jsonStr) {
 *     var data = JSON.parse(jsonStr);
 *     var clipSlot = new LiveAPI("live_set view selected_track clip_slots 0");
 *
 *     if (!parseInt(clipSlot.get("has_clip"))) {
 *         if (data.create_clip) {
 *             clipSlot.call("create_clip", data.clip_length);
 *         } else {
 *             outlet(0, "write_result", JSON.stringify({
 *                 success: false,
 *                 message: "No clip in slot"
 *             }));
 *             return;
 *         }
 *     }
 *
 *     var clip = new LiveAPI("live_set view selected_track clip_slots 0 clip");
 *
 *     // Clear existing notes
 *     clip.call("select_all_notes");
 *     clip.call("replace_selected_notes");
 *     clip.call("notes", data.notes.length);
 *
 *     for (var i = 0; i < data.notes.length; i++) {
 *         var n = data.notes[i];
 *         clip.call("note", n.pitch, n.time, n.duration, n.velocity, 0);
 *     }
 *
 *     clip.call("done");
 *
 *     outlet(0, "write_result", JSON.stringify({
 *         success: true,
 *         params_written: 0,
 *         notes_written: data.notes.length,
 *         clip_bars: data.clip_bars
 *     }));
 * }
 */
