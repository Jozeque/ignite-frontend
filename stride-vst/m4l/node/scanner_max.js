/**
 * Stride Link — Max Patcher JavaScript
 * Runs inside Max's [js] object (NOT Node for Max)
 * Uses the Live Object Model (LOM) to read/write Ableton state
 *
 * USAGE IN MAX PATCHER:
 *   [js scanner_max.js]
 *     inlet 0: messages (scan_rack, get_clip_info, write_automation, etc.)
 *     outlet 0: JSON results to [node.script server.js]
 *     outlet 1: status messages to UI
 */

autowatch = 1;
inlets = 1;
outlets = 2;

// Store original param values for preview restore (keyed by _path)
var originalParamValues = {};

// Global counter for unique parameter IDs across all devices in a scan
var _paramIdCounter = 0;

// ─── READ JSON FROM FILE ─────────────────────────────────
// Max truncates long strings, so Node writes JSON to a temp file
// and we read it here using Max JS's File object
function _readJsonFile(filePath) {
    var f = new File(filePath, "read");
    if (!f.isopen) {
        post("Stride: Cannot open file " + filePath + "\n");
        return null;
    }
    var content = "";
    while (f.position < f.eof) {
        var line = f.readline();
        content += line;
    }
    f.close();
    return content;
}

// ─── COLLECT DEVICE PARAMS ───────────────────────────────
// Recursively walks all devices on the track, including chains inside racks.
// Returns an array of { name, min, max, value, _path } objects.
// filterAutomated: if true, only returns params with automation_state > 0

function _collectParams(basePath, filterAutomated) {
    var params = [];
    try {
        var dev = new LiveAPI(basePath);
        var devName = dev.get("name").toString();
        var className = dev.get("class_name").toString();

        // Skip our own device
        if (devName === "StrideLink") return params;

        // Read this device's parameters
        var paramIds = dev.get("parameters");
        var paramCount = paramIds.length / 2;

        for (var i = 0; i < paramCount; i++) {
            try {
                var paramPath = basePath + " parameters " + i;
                var param = new LiveAPI(paramPath);

                // When filtering, check automation_state FIRST (fast reject).
                // This covers arrangement-view automation — the recommended
                // workflow for Stride. Producers arm automation, play, touch
                // their mapped knobs once, and those params show up here.
                if (filterAutomated) {
                    var automationState = parseInt(param.get("automation_state"));
                    if (automationState === 0) continue;
                }

                var name = param.get("name").toString();
                if (name === "Device On") continue;

                var min = parseFloat(param.get("min"));
                var max = parseFloat(param.get("max"));
                var value = parseFloat(param.get("value"));

                // Detect log-scale params (frequency) via display string
                var isLog = false;
                try {
                    var paramStr = param.get("str").toString();
                    if (/Hz|kHz/.test(paramStr)) isLog = true;
                } catch(e) {}

                var displayName = devName + ": " + name;

                params.push({
                    id: _paramIdCounter++,
                    name: displayName,
                    min: min,
                    max: max,
                    value: value,
                    _path: paramPath,
                    is_log: isLog
                });

                originalParamValues[paramPath] = value;
            } catch (pe) {}
        }

        // If this is a rack, dive into chains and their sub-devices
        var isRack = (className === "InstrumentGroupDevice" ||
                      className === "AudioEffectGroupDevice" ||
                      className === "MidiEffectGroupDevice" ||
                      className === "DrumGroupDevice");

        if (isRack) {
            try {
                var chainIds = dev.get("chains");
                var chainCount = chainIds.length / 2;
                for (var c = 0; c < chainCount; c++) {
                    try {
                        var chainPath = basePath + " chains " + c;
                        var chain = new LiveAPI(chainPath);
                        var chainName = chain.get("name").toString();

                        // Scan chain's mixer_device params (Volume, Pan, Sends)
                        // MixerDevice doesn't have a "parameters" list in LOM —
                        // it exposes volume, panning, sends individually.
                        try {
                            var mixerPath = chainPath + " mixer_device";
                            var mixerProps = ["volume", "panning"];

                            // Also check sends
                            try {
                                var mixerObj = new LiveAPI(mixerPath);
                                var sendIds = mixerObj.get("sends");
                                var sendCount = sendIds.length / 2;
                                for (var si = 0; si < sendCount; si++) {
                                    mixerProps.push("sends " + si);
                                }
                            } catch (se) {}

                            for (var mp = 0; mp < mixerProps.length; mp++) {
                                try {
                                    var mParamPath = mixerPath + " " + mixerProps[mp];
                                    var mParam = new LiveAPI(mParamPath);

                                    if (!mParam.id || mParam.id === "0") continue;

                                    if (filterAutomated) {
                                        var mAutoState = parseInt(mParam.get("automation_state"));
                                        if (mAutoState === 0) continue;
                                    }

                                    var mName = mParam.get("name").toString();
                                    var mMin = parseFloat(mParam.get("min"));
                                    var mMax = parseFloat(mParam.get("max"));
                                    var mValue = parseFloat(mParam.get("value"));

                                    var mIsLog = false;
                                    try {
                                        var mStr = mParam.get("str").toString();
                                        if (/Hz|kHz/.test(mStr)) mIsLog = true;
                                    } catch(e) {}

                                    var mDisplayName = (chainName || "Chain " + c) + ": " + mName;

                                    params.push({
                                        id: _paramIdCounter++,
                                        name: mDisplayName,
                                        min: mMin,
                                        max: mMax,
                                        value: mValue,
                                        _path: mParamPath,
                                        is_log: mIsLog
                                    });

                                    originalParamValues[mParamPath] = mValue;
                                } catch (mpe) {}
                            }
                        } catch (mxe) {}

                        // Scan sub-devices within the chain
                        var chainDevIds = chain.get("devices");
                        var chainDevCount = chainDevIds.length / 2;
                        for (var d = 0; d < chainDevCount; d++) {
                            var subDevPath = chainPath + " devices " + d;
                            var subParams = _collectParams(subDevPath, filterAutomated);
                            for (var s = 0; s < subParams.length; s++) {
                                params.push(subParams[s]);
                            }
                        }
                    } catch (ce) {}
                }
            } catch (re) {}
        }
    } catch (e) {}
    return params;
}

// ─── SCAN RACK (ALL PARAMS) ──────────────────────────────

function scan_rack() {
    try {
        _paramIdCounter = 0;
        var track = new LiveAPI("live_set view selected_track");
        var trackName = track.get("name").toString();
        // Resolve to absolute path so params stay valid later
        var trackPath = track.unquotedpath;
        var deviceIds = track.get("devices");
        var deviceCount = deviceIds.length / 2;

        var allParams = [];
        var deviceNames = [];

        for (var i = 0; i < deviceCount; i++) {
            var devPath = trackPath + " devices " + i;
            var dev = new LiveAPI(devPath);
            var dn = dev.get("name").toString();
            if (dn === "StrideLink") continue;
            deviceNames.push(dn);

            var devParams = _collectParams(devPath, false);
            for (var p = 0; p < devParams.length; p++) {
                allParams.push(devParams[p]);
            }
        }

        var clipInfo = _getClipInfo();

        var result = {
            track_name: trackName,
            device_name: deviceNames.join(" + ") || "None",
            clip_bars: clipInfo.clip_bars,
            clip_slot: clipInfo.clip_slot,
            has_clip: clipInfo.has_clip,
            parameters: allParams
        };

        outlet(0, "rack_params", JSON.stringify(result));
        outlet(1, "status", "Scanned " + allParams.length + " params");

    } catch (e) {
        outlet(1, "status", "Scan error: " + e.message);
        post("Stride scan error: " + e.message + "\n");
    }
}

// ─── SCAN MAPPED ─────────────────────────────────────────
// Only returns parameters that have automation (arrangement or clip)

function scan_mapped() {
    try {
        _paramIdCounter = 0;
        var track = new LiveAPI("live_set view selected_track");
        var trackName = track.get("name").toString();
        var trackPath = track.unquotedpath;
        var deviceIds = track.get("devices");
        var deviceCount = deviceIds.length / 2;

        var allParams = [];
        var deviceNames = [];

        for (var i = 0; i < deviceCount; i++) {
            var devPath = trackPath + " devices " + i;
            var dev = new LiveAPI(devPath);
            var dn = dev.get("name").toString();
            if (dn === "StrideLink") continue;
            deviceNames.push(dn);

            var devParams = _collectParams(devPath, true);
            for (var p = 0; p < devParams.length; p++) {
                allParams.push(devParams[p]);
            }
        }

        var clipInfo = _getClipInfo();

        var result = {
            track_name: trackName,
            device_name: deviceNames.join(" + ") || "None",
            clip_bars: clipInfo.clip_bars,
            clip_slot: clipInfo.clip_slot,
            has_clip: clipInfo.has_clip,
            parameters: allParams
        };

        outlet(0, "rack_params", JSON.stringify(result));
        outlet(1, "status", "Found " + allParams.length + " mapped params");

    } catch (e) {
        outlet(1, "status", "Scan mapped error: " + e.message);
        post("Stride scan_mapped error: " + e.message + "\n");
    }
}

// ─── CLIP INFO ────────────────────────────────────────────

function get_clip_info() {
    var info = _getClipInfo();
    outlet(0, "clip_info", JSON.stringify(info));
}

function _getClipInfo() {
    try {
        // Find the first clip slot with a clip, or use slot 0
        var track = new LiveAPI("live_set view selected_track");
        var clipSlots = track.get("clip_slots");
        var slotCount = clipSlots.length / 2;

        for (var i = 0; i < Math.min(slotCount, 8); i++) {
            try {
                var slot = new LiveAPI("live_set view selected_track clip_slots " + i);
                var hasClip = parseInt(slot.get("has_clip"));
                if (hasClip) {
                    var clip = new LiveAPI("live_set view selected_track clip_slots " + i + " clip");
                    var clipLength = parseFloat(clip.get("length"));
                    return {
                        clip_bars: Math.max(1, Math.round(clipLength / 4)),
                        has_clip: true,
                        clip_slot: i
                    };
                }
            } catch (se) {}
        }
    } catch (e) {}

    return { clip_bars: 4, has_clip: false, clip_slot: 0 };
}

// ─── TRACK INFO ───────────────────────────────────────────

function get_track_info() {
    try {
        var track = new LiveAPI("live_set view selected_track");
        var trackName = track.get("name").toString();
        var deviceIds = track.get("devices");
        outlet(0, "track_info", JSON.stringify({
            track_name: trackName,
            has_device: deviceIds && deviceIds.length >= 2
        }));
    } catch (e) {
        outlet(0, "track_info", JSON.stringify({ track_name: "Unknown", has_device: false }));
    }
}

// ─── WRITE AUTOMATION (ARRANGEMENT RECORDING) ────────────
// Records automation to the ARRANGEMENT timeline.
// Temporarily slows tempo for higher accuracy, caches LiveAPI objects
// to avoid creating them every tick, and uses record_mode for arrangement.
//
// ALL LOM changes are deferred to a Task to avoid
// "Changes cannot be triggered by notifications" errors.

var recordTask = null;
var recordData = null;

function write_automation(filePath) {
    try {
        var jsonStr = _readJsonFile(filePath);
        if (!jsonStr) {
            outlet(0, "write_result", JSON.stringify({ success: false, message: "Cannot read payload file" }));
            return;
        }
        var data = JSON.parse(jsonStr);

        recordData = {
            data: data,
            params: null,        // will hold cached param objects
            liveSetObj: null,     // cached LiveAPI for song
            targetLength: 0,
            startPos: 0,
            originalTempo: 120,
            phase: "setup",
            graceTicks: 40,
            logCounter: 0
        };

        post("Stride: Deferring write_automation to Task\n");

        if (recordTask) recordTask.cancel();
        recordTask = new Task(_writeSetup, this);
        recordTask.schedule(50);

    } catch (e) {
        outlet(0, "write_result", JSON.stringify({ success: false, message: e.message }));
        post("Stride write error: " + e.message + "\n");
    }
}

function _writeSetup() {
    try {
        var data = recordData.data;
        var targetLength = (data.clip_bars || 4) * 4;

        // ── Build param list with CACHED LiveAPI objects ──
        var paramsList = [];
        for (var p = 0; p < data.params.length; p++) {
            var paramData = data.params[p];
            var points = paramData.points || [];
            if (points.length === 0) continue;

            try {
                var paramPath = paramData._path || ("live_set view selected_track devices 0 parameters " + paramData.id);
                var param = new LiveAPI(paramPath);

                if (!param.id || param.id === "0") {
                    post("Stride: Skipping invalid param " + paramData.name + "\n");
                    continue;
                }

                var paramMin = parseFloat(param.get("min"));
                var paramMax = parseFloat(param.get("max"));

                points.sort(function(a, b) { return a.time - b.time; });

                paramsList.push({
                    paramObj: param,   // CACHED — no new LiveAPI per tick
                    name: paramData.name,
                    min: paramMin,
                    max: paramMax,
                    is_log: paramData.is_log || false,
                    points: points
                });

                post("Stride: Param " + paramData.name + " — " + points.length + " pts [" + paramMin.toFixed(1) + "–" + paramMax.toFixed(1) + "]\n");
            } catch (pe) {
                post("Stride: Error reading param " + paramData.name + ": " + pe.message + "\n");
            }
        }

        if (paramsList.length === 0) {
            outlet(0, "write_result", JSON.stringify({ success: false, message: "No valid params" }));
            recordData = null;
            return;
        }

        recordData.params = paramsList;
        recordData.targetLength = targetLength;
        recordData.phase = "recording";

        // ── Cache the song object ──
        var liveSet = new LiveAPI("live_set");
        recordData.liveSetObj = liveSet;

        // ── Save and slow tempo for accuracy ──
        var origTempo = parseFloat(liveSet.get("tempo"));
        recordData.originalTempo = origTempo;

        // Slow to 40 BPM — gives ~6x more samples per beat at 120 BPM default
        // 16 beats at 40 BPM = 24 seconds (user said 10-20s is fine)
        var recordTempo = 40;
        liveSet.set("tempo", recordTempo);
        post("Stride: Tempo " + origTempo + " → " + recordTempo + " BPM (will restore after)\n");

        // ── Get current position ──
        var startPos = parseFloat(liveSet.get("current_song_time"));
        recordData.startPos = startPos;

        post("Stride: Start: " + startPos.toFixed(2) + " beats, length: " + targetLength + " beats\n");

        // ── Enable ARRANGEMENT recording ──
        // record_mode = arrangement record (the big red button)
        liveSet.set("record_mode", 1);
        post("Stride: record_mode (arrangement) = " + liveSet.get("record_mode") + "\n");

        // Also enable session_automation_record (automation arm)
        try {
            liveSet.set("session_automation_record", 1);
            post("Stride: session_automation_record = " + liveSet.get("session_automation_record") + "\n");
        } catch (ae) {
            post("Stride: session_automation_record not available\n");
        }

        // ── Start arrangement playback ──
        liveSet.call("start_playing");
        post("Stride: Playing — recording " + paramsList.length + " params to arrangement\n");
        outlet(1, "status", "Recording automation...");

        // ── Start tick — 5ms interval for max accuracy ──
        recordTask = new Task(_recordTick, this);
        recordTask.interval = 5;
        recordTask.repeat();

    } catch (e) {
        // Restore tempo on error
        try {
            var ls = new LiveAPI("live_set");
            ls.set("tempo", recordData.originalTempo);
        } catch (te) {}
        outlet(0, "write_result", JSON.stringify({ success: false, message: "Setup error: " + e.message }));
        post("Stride setup error: " + e.message + "\n");
        recordData = null;
    }
}

function _recordTick() {
    if (!recordData || recordData.phase !== "recording") {
        if (recordTask) recordTask.cancel();
        return;
    }

    try {
        // Grace period
        if (recordData.graceTicks > 0) {
            recordData.graceTicks--;
            return;
        }

        // Use CACHED song object
        var currentTime = parseFloat(recordData.liveSetObj.get("current_song_time"));
        var elapsed = currentTime - recordData.startPos;

        if (elapsed >= recordData.targetLength) {
            _stopRecording(true, null);
            return;
        }

        if (elapsed < -1) {
            _stopRecording(false, "Transport moved backwards");
            return;
        }
        if (elapsed < 0) elapsed = 0;

        recordData.logCounter++;
        var shouldLog = (recordData.logCounter <= 5) || (recordData.logCounter % 200 === 0);

        // Set each parameter using CACHED LiveAPI objects
        for (var p = 0; p < recordData.params.length; p++) {
            var pd = recordData.params[p];
            var normValue = _interpolateValue(pd.points, elapsed, recordData.targetLength);
            var actualValue;
            if (pd.is_log && pd.min > 0 && pd.max > pd.min) {
                actualValue = pd.min * Math.pow(pd.max / pd.min, normValue);
            } else {
                actualValue = pd.min + normValue * (pd.max - pd.min);
            }

            try {
                pd.paramObj.set("value", actualValue);
            } catch (pe) {}

            if (p === 0 && shouldLog) {
                post("Stride: t=" + elapsed.toFixed(3) + " norm=" + normValue.toFixed(3) + " val=" + actualValue.toFixed(3) + "\n");
            }
        }

    } catch (e) {
        _stopRecording(false, "Tick error: " + e.message);
    }
}

function _interpolateValue(points, time, clipLength) {
    if (points.length === 0) return 0;
    if (time <= points[0].time) return points[0].value;
    if (time >= points[points.length - 1].time) return points[points.length - 1].value;

    for (var i = 0; i < points.length - 1; i++) {
        if (time >= points[i].time && time < points[i + 1].time) {
            var t = (time - points[i].time) / (points[i + 1].time - points[i].time);
            return points[i].value + t * (points[i + 1].value - points[i].value);
        }
    }
    return points[points.length - 1].value;
}

function _stopRecording(success, errorMsg) {
    if (recordTask) {
        recordTask.cancel();
        recordTask = null;
    }

    // Restore tempo FIRST
    try {
        var liveSet = new LiveAPI("live_set");
        if (recordData && recordData.originalTempo) {
            liveSet.set("tempo", recordData.originalTempo);
            post("Stride: Tempo restored to " + recordData.originalTempo + " BPM\n");
        }
        liveSet.set("record_mode", 0);
        liveSet.call("stop_playing");
    } catch (e) {}

    var paramCount = recordData && recordData.params ? recordData.params.length : 0;
    recordData = null;

    if (success) {
        outlet(0, "write_result", JSON.stringify({
            success: true,
            params_written: paramCount
        }));
        outlet(1, "status", "Recorded " + paramCount + " params");
        post("Stride: Recording complete — " + paramCount + " params to arrangement\n");
    } else {
        outlet(0, "write_result", JSON.stringify({
            success: false,
            message: errorMsg || "Recording failed"
        }));
        outlet(1, "status", "Recording failed");
        post("Stride: Recording failed — " + errorMsg + "\n");
    }
}

// ─── WRITE MIDI ───────────────────────────────────────────

function write_midi(filePath) {
    try {
        var jsonStr = _readJsonFile(filePath);
        if (!jsonStr) {
            outlet(0, "write_result", JSON.stringify({ success: false, message: "Cannot read payload file" }));
            return;
        }
        var data = JSON.parse(jsonStr);
        var slotIdx = data.clip_slot || 0;
        var clipSlot = new LiveAPI("live_set view selected_track clip_slots " + slotIdx);
        var hasClip = parseInt(clipSlot.get("has_clip"));

        if (!hasClip) {
            if (data.create_clip) {
                clipSlot.call("create_clip", data.clip_length || 16);
            } else {
                outlet(0, "write_result", JSON.stringify({ success: false, message: "No clip" }));
                return;
            }
        }

        var clip = new LiveAPI("live_set view selected_track clip_slots " + slotIdx + " clip");

        // Clear existing notes
        clip.call("select_all_notes");
        clip.call("replace_selected_notes");
        clip.call("notes", data.notes.length);

        for (var i = 0; i < data.notes.length; i++) {
            var n = data.notes[i];
            clip.call("note", n.pitch, n.time.toFixed(4), n.duration.toFixed(4), n.velocity, 0);
        }

        clip.call("done");

        outlet(0, "write_result", JSON.stringify({
            success: true,
            notes_written: data.notes.length,
            clip_bars: data.clip_bars
        }));
        outlet(1, "status", "Wrote " + data.notes.length + " notes");

    } catch (e) {
        outlet(0, "write_result", JSON.stringify({ success: false, message: e.message }));
        post("Stride MIDI write error: " + e.message + "\n");
    }
}

// ─── PREVIEW ──────────────────────────────────────────────

function preview_param(path, value) {
    try {
        var param = new LiveAPI(path);
        var min = parseFloat(param.get("min"));
        var max = parseFloat(param.get("max"));
        // Detect log-scale (frequency) params for accurate preview
        var isLog = false;
        try {
            var pStr = param.get("str").toString();
            if (/Hz|kHz/.test(pStr)) isLog = true;
        } catch(e) {}
        var actualValue;
        if (isLog && min > 0 && max > min) {
            actualValue = min * Math.pow(max / min, value);
        } else {
            actualValue = min + value * (max - min);
        }
        param.set("value", actualValue);
    } catch (e) {
        post("Stride preview error: " + e.message + "\n");
    }
}

function stop_preview() {
    for (var path in originalParamValues) {
        try {
            var param = new LiveAPI(path);
            param.set("value", originalParamValues[path]);
        } catch (e) {}
    }
    outlet(1, "status", "Preview stopped");
}

// ─── CREATE CLIP ──────────────────────────────────────────

function create_clip(bars, slotIdx) {
    try {
        var slot = new LiveAPI("live_set view selected_track clip_slots " + (slotIdx || 0));
        var hasClip = parseInt(slot.get("has_clip"));
        if (hasClip) {
            outlet(1, "status", "Clip already exists");
            return;
        }
        slot.call("create_clip", (bars || 4) * 4);
        outlet(1, "status", "Created " + bars + " bar clip");
        // Send updated clip info
        get_clip_info();
    } catch (e) {
        post("Stride create clip error: " + e.message + "\n");
    }
}

// ─── SCAN ALL DEVICES (Gate feature) ──────────────────────
// Returns the full device tree of the selected track: one entry per device,
// including nested rack chain devices. Each entry carries the LOM path of the
// device's "Device On" parameter (always device.parameters 0), ready for
// boolean automation from the Gate step-grid.

function scan_all_devices() {
    try {
        var track = new LiveAPI("live_set view selected_track");
        var trackName = track.get("name").toString();
        var trackPath = track.unquotedpath;
        var deviceIds = track.get("devices");
        var deviceCount = deviceIds.length / 2;

        var devices = [];
        var idCounter = 0;

        function walkDevices(basePath, depth, chainName) {
            try {
                var dev = new LiveAPI(basePath);
                var devName = dev.get("name").toString();
                if (devName === "StrideLink") return;

                var className = dev.get("class_name").toString();
                var classDisplayName = devName;
                try {
                    var cdn = dev.get("class_display_name");
                    if (cdn) classDisplayName = cdn.toString();
                } catch (e) {}

                var isRack = (className === "InstrumentGroupDevice" ||
                              className === "AudioEffectGroupDevice" ||
                              className === "MidiEffectGroupDevice" ||
                              className === "DrumGroupDevice");

                var isActive = 1;
                try { isActive = parseInt(dev.get("is_active")); } catch (e) {}

                devices.push({
                    id: idCounter++,
                    name: devName,
                    class_display_name: classDisplayName,
                    class_name: className,
                    is_rack: isRack,
                    is_active: isActive,
                    depth: depth,
                    chain_name: chainName,
                    _path: basePath,
                    device_on_path: basePath + " parameters 0"
                });

                if (isRack) {
                    try {
                        var chainIds = dev.get("chains");
                        var chainCount = chainIds.length / 2;
                        for (var c = 0; c < chainCount; c++) {
                            var chainPath = basePath + " chains " + c;
                            try {
                                var chain = new LiveAPI(chainPath);
                                var chName = chain.get("name").toString();
                                var chainDevIds = chain.get("devices");
                                var chainDevCount = chainDevIds.length / 2;
                                for (var d = 0; d < chainDevCount; d++) {
                                    walkDevices(chainPath + " devices " + d, depth + 1, chName || ("Chain " + c));
                                }
                            } catch (ce) {}
                        }
                    } catch (re) {}
                }
            } catch (e) {}
        }

        for (var i = 0; i < deviceCount; i++) {
            walkDevices(trackPath + " devices " + i, 0, null);
        }

        var result = {
            track_name: trackName,
            devices: devices
        };

        outlet(0, "all_devices", JSON.stringify(result));
        outlet(1, "status", "Found " + devices.length + " devices");

    } catch (e) {
        outlet(1, "status", "scan_all_devices error: " + e.message);
        post("Stride scan_all_devices error: " + e.message + "\n");
    }
}

// ─── GATE PLAYBACK (real-time device on/off sequencer) ────
// Drives Device On parameters from a step pattern synced to Ableton's
// transport. Polls current_song_time at 5ms, computes the current step,
// and calls param.set("value", 0|1) only when a device's state changes.
//
// Live mode (default): just plays, Ableton hears the toggles but records
// nothing.
//
// Record mode (record_mode:true in pattern): enables arrangement record
// and session_automation_record before starting. Ableton captures the
// boolean changes into an arrangement automation lane — the user's
// "bake the variation" button.

var _gateTask = null;
var _gateData = null;

function start_gate_playback(filePath) {
    try {
        var jsonStr = _readJsonFile(filePath);
        if (!jsonStr) {
            outlet(0, "gate_result", JSON.stringify({ success: false, message: "Cannot read pattern file" }));
            return;
        }
        var data = JSON.parse(jsonStr);
        _startGateWithData(data);
    } catch (e) {
        outlet(0, "gate_result", JSON.stringify({ success: false, message: e.message }));
        post("Stride Gate start error: " + e.message + "\n");
    }
}

function _startGateWithData(data) {
    // Stop any previous session first (restores original device states)
    stop_gate_playback();

    var resolution = parseInt(data.resolution) || 16;
    var bars = parseInt(data.bars) || 4;
    var inputDevices = data.devices || [];

    // Cache LiveAPI objects for each device's Device On parameter
    var devices = [];
    for (var d = 0; d < inputDevices.length; d++) {
        var devData = inputDevices[d];
        if (!devData.device_on_path) continue;
        try {
            var paramObj = new LiveAPI(devData.device_on_path);
            if (!paramObj.id || paramObj.id === "0") continue;

            var originalValue = parseFloat(paramObj.get("value"));
            devices.push({
                name: devData.name || "Device",
                paramObj: paramObj,
                steps: devData.steps || [],
                originalValue: originalValue,
                lastSetValue: -1  // force first-tick write
            });
        } catch (pe) {
            post("Stride Gate: failed to bind " + devData.name + " — " + pe.message + "\n");
        }
    }

    if (devices.length === 0) {
        outlet(0, "gate_result", JSON.stringify({ success: false, message: "No valid devices in pattern" }));
        return;
    }

    _gateData = {
        devices: devices,
        resolution: resolution,
        bars: bars,
        totalSteps: resolution * bars,
        beatsPerStep: 4.0 / resolution,
        cycleBeats: 4.0 * bars,
        liveSetObj: new LiveAPI("live_set"),
        recordMode: data.record_mode === true,
        positionTickCounter: 0
    };

    // Optionally arm Ableton automation recording (bake mode)
    if (_gateData.recordMode) {
        try {
            _gateData.liveSetObj.set("record_mode", 1);
            _gateData.liveSetObj.set("session_automation_record", 1);
            post("Stride Gate: Record mode ON\n");
        } catch (re) {}
    }

    _gateTask = new Task(_gateTick, this);
    _gateTask.interval = 5;
    _gateTask.repeat();

    outlet(0, "gate_result", JSON.stringify({
        success: true,
        devices_playing: devices.length,
        resolution: resolution,
        bars: bars,
        record_mode: _gateData.recordMode
    }));
    outlet(1, "status", "Gate playing " + devices.length + " devices");
    post("Stride Gate: Started — " + devices.length + " devices, 1/" + resolution + " steps, " + bars + " bars\n");
}

function _gateTick() {
    if (!_gateData) return;
    try {
        var isPlaying = parseInt(_gateData.liveSetObj.get("is_playing"));
        if (!isPlaying) {
            // Transport stopped — hold last state, don't spam param.set
            return;
        }

        var currentTime = parseFloat(_gateData.liveSetObj.get("current_song_time"));
        var cycleTime = currentTime % _gateData.cycleBeats;
        if (cycleTime < 0) cycleTime += _gateData.cycleBeats;

        var currentStep = Math.floor(cycleTime / _gateData.beatsPerStep);
        if (currentStep >= _gateData.totalSteps) currentStep = _gateData.totalSteps - 1;
        if (currentStep < 0) currentStep = 0;

        for (var d = 0; d < _gateData.devices.length; d++) {
            var dev = _gateData.devices[d];
            var targetValue = dev.steps[currentStep] ? 1 : 0;
            if (dev.lastSetValue !== targetValue) {
                try {
                    dev.paramObj.set("value", targetValue);
                    dev.lastSetValue = targetValue;
                } catch (pe) {}
            }
        }

        // Emit playhead position every ~10 ticks (50ms) for canvas indicator
        _gateData.positionTickCounter++;
        if (_gateData.positionTickCounter >= 10) {
            _gateData.positionTickCounter = 0;
            outlet(0, "gate_position", JSON.stringify({
                step: currentStep,
                cycle_time: cycleTime,
                song_time: currentTime
            }));
        }
    } catch (e) {
        post("Stride Gate tick error: " + e.message + "\n");
    }
}

function stop_gate_playback() {
    if (_gateTask) {
        _gateTask.cancel();
        _gateTask = null;
    }

    if (_gateData) {
        // Restore each device to its original Device On state
        for (var d = 0; d < _gateData.devices.length; d++) {
            var dev = _gateData.devices[d];
            try {
                dev.paramObj.set("value", dev.originalValue);
            } catch (pe) {}
        }

        // Clear recording arm if we set it
        if (_gateData.recordMode) {
            try {
                _gateData.liveSetObj.set("record_mode", 0);
                _gateData.liveSetObj.set("session_automation_record", 0);
            } catch (re) {}
        }

        _gateData = null;
    }

    outlet(0, "gate_result", JSON.stringify({ success: true, stopped: true }));
    outlet(1, "status", "Gate stopped");
    post("Stride Gate: Stopped\n");
}

// Hardcoded smoke-test pattern — picks the first non-StrideLink device on the
// selected track and toggles it ON for beat 1, OFF for beat 2, ON for beat 3,
// OFF for beat 4 (one bar, 1/16 resolution). Useful to verify the LOM/transport
// wiring without the canvas UI. Trigger via message: "start_gate_test".

function start_gate_test() {
    try {
        var track = new LiveAPI("live_set view selected_track");
        var trackPath = track.unquotedpath;
        var deviceIds = track.get("devices");
        var deviceCount = deviceIds.length / 2;

        var testDevice = null;
        for (var i = 0; i < deviceCount; i++) {
            var devPath = trackPath + " devices " + i;
            var dev = new LiveAPI(devPath);
            var devName = dev.get("name").toString();
            if (devName !== "StrideLink") {
                testDevice = { name: devName, device_on_path: devPath + " parameters 0" };
                break;
            }
        }

        if (!testDevice) {
            post("Stride Gate Test: No non-StrideLink device found on track\n");
            outlet(1, "status", "Gate test: no target device");
            return;
        }

        // 1 bar of 1/16 steps = 16 cells. ON for beats 1+3, OFF for beats 2+4.
        var testPattern = {
            resolution: 16,
            bars: 1,
            record_mode: false,
            devices: [{
                name: testDevice.name,
                device_on_path: testDevice.device_on_path,
                steps: [1,1,1,1, 0,0,0,0, 1,1,1,1, 0,0,0,0]
            }]
        };

        post("Stride Gate Test: Targeting '" + testDevice.name + "' — press Play in Ableton\n");
        _startGateWithData(testPattern);

    } catch (e) {
        post("Stride Gate Test error: " + e.message + "\n");
        outlet(1, "status", "Gate test error: " + e.message);
    }
}

// ─── MESSAGE ROUTER ───────────────────────────────────────

function anything() {
    var cmd = messagename;
    var args = arrayfromargs(arguments);

    // node.script sends "command <actual_cmd>" — unwrap it
    if (cmd === "command" && args.length > 0) {
        cmd = args[0].toString();
        args = args.slice(1);
    }

    // Ignore status messages from node.script
    if (cmd === "status") return;

    if (cmd === "scan_rack") scan_rack();
    else if (cmd === "scan_mapped") scan_mapped();
    else if (cmd === "get_clip_info") get_clip_info();
    else if (cmd === "get_track_info") get_track_info();
    else if (cmd === "write_automation") write_automation(args.join(" "));
    else if (cmd === "write_midi") write_midi(args.join(" "));
    else if (cmd === "preview") {
        // Last arg is value, everything before is the LOM path
        var previewValue = parseFloat(args[args.length - 1]);
        var previewPath = args.slice(0, args.length - 1).join(" ");
        preview_param(previewPath, previewValue);
    }
    else if (cmd === "stop_preview") stop_preview();
    else if (cmd === "create_clip") create_clip(parseInt(args[0]) || 4, parseInt(args[1]) || 0);
    else if (cmd === "scan_all_devices") scan_all_devices();
    else if (cmd === "start_gate_playback") start_gate_playback(args.join(" "));
    else if (cmd === "stop_gate_playback") stop_gate_playback();
    else if (cmd === "start_gate_test") start_gate_test();
    else post("Stride: Unknown command '" + cmd + "'\n");
}
