/**
 * Stride M4L — Rack Scanner
 * Reads instrument rack parameters via Max's Live Object Model
 *
 * This module provides helper functions that the Max patcher calls.
 * The actual LOM calls happen in the Max patcher (JavaScript in Max or live.object),
 * results are forwarded here via Max.addHandler in server.js.
 *
 * This file contains the scanning logic outline for the Max patcher's JS.
 */

const Max = require('max-api');

/**
 * Request a full rack scan from the Max patcher.
 * The Max patcher will:
 *   1. Get the selected track
 *   2. Find the first instrument rack (or grouped device)
 *   3. Iterate all parameters
 *   4. Read clip info from the first clip slot
 *   5. Send results back via 'rack_params' handler
 */
function requestScan() {
    Max.outlet('command', 'scan_rack');
    Max.post('Stride: Scan requested');
}

/**
 * Request clip info update (e.g. after user changes clip or resizes).
 */
function requestClipInfo() {
    Max.outlet('command', 'get_clip_info');
}

/**
 * Request track info (name, has device).
 */
function requestTrackInfo() {
    Max.outlet('command', 'get_track_info');
}

module.exports = { requestScan, requestClipInfo, requestTrackInfo };

/*
 * ──────────────────────────────────────────────────────────
 * MAX PATCHER JAVASCRIPT REFERENCE
 * ──────────────────────────────────────────────────────────
 *
 * The following is the JavaScript that runs INSIDE the Max patcher
 * (not in Node for Max). It uses the Live API to access Ableton's LOM.
 * This is placed here as reference for building the .amxd patcher.
 *
 * // ── scan_rack ──
 * function scan_rack() {
 *     var track = new LiveAPI("live_set view selected_track");
 *     var trackName = track.get("name").toString();
 *
 *     // Find first device (the instrument rack)
 *     var devices = track.get("devices");
 *     if (!devices || devices.length < 2) {
 *         outlet(0, "error", "No devices on track");
 *         return;
 *     }
 *
 *     var device = new LiveAPI("live_set view selected_track devices 0");
 *     var deviceName = device.get("name").toString();
 *     var paramCount = device.get("parameters").length / 2; // LOM returns [id, id, ...]
 *
 *     var params = [];
 *     for (var i = 0; i < paramCount; i++) {
 *         var param = new LiveAPI("live_set view selected_track devices 0 parameters " + i);
 *         var name = param.get("name").toString();
 *         var min = parseFloat(param.get("min"));
 *         var max = parseFloat(param.get("max"));
 *         var value = parseFloat(param.get("value"));
 *         var isEnabled = parseInt(param.get("is_enabled"));
 *
 *         if (isEnabled) {
 *             params.push({
 *                 id: i,
 *                 name: name,
 *                 min: min,
 *                 max: max,
 *                 value: value
 *             });
 *         }
 *     }
 *
 *     // Read clip from first clip slot
 *     var clipSlot = new LiveAPI("live_set view selected_track clip_slots 0");
 *     var hasClip = parseInt(clipSlot.get("has_clip"));
 *     var clipBars = 4;
 *     if (hasClip) {
 *         var clip = new LiveAPI("live_set view selected_track clip_slots 0 clip");
 *         var clipLength = parseFloat(clip.get("length"));
 *         clipBars = Math.round(clipLength / 4); // 4 beats per bar
 *     }
 *
 *     var result = JSON.stringify({
 *         track_name: trackName,
 *         device_name: deviceName,
 *         clip_bars: clipBars,
 *         clip_slot: 0,
 *         has_clip: !!hasClip,
 *         parameters: params
 *     });
 *
 *     // Send to Node server
 *     outlet(0, "rack_params", result);
 * }
 *
 * // ── get_clip_info ──
 * function get_clip_info() {
 *     var clipSlot = new LiveAPI("live_set view selected_track clip_slots 0");
 *     var hasClip = parseInt(clipSlot.get("has_clip"));
 *     var clipBars = 4;
 *     var clipSlotIdx = 0;
 *
 *     if (hasClip) {
 *         var clip = new LiveAPI("live_set view selected_track clip_slots 0 clip");
 *         clipBars = Math.round(parseFloat(clip.get("length")) / 4);
 *     }
 *
 *     outlet(0, "clip_info", JSON.stringify({
 *         clip_bars: clipBars,
 *         has_clip: !!hasClip,
 *         clip_slot: clipSlotIdx
 *     }));
 * }
 */
