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

// ─── DETAIL-CLIP SOURCE OF TRUTH ──────────────────────────
// The clip open in Live's detail view is the single source of truth for bars,
// reading existing automation, and inject. We remember the last clip that WAS
// in detail view, so a momentarily-empty detail view (the user clicked away)
// still resolves to the clip they're working on.
var _lastDetailClipId = null;   // id of the most recent valid detail_clip
var _clipObs = null;            // LiveAPI observer on `live_set view` detail_clip
var _lastFocusEmitId = null;    // de-dupe repeated detail_clip fires

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
        // Guard: a path that didn't resolve (e.g. a chain/device over-reporting
        // its child count, so a trailing index points at nothing) floods the Max
        // window with "no valid object set" on every .get() and freezes Live.
        // Skip it — an unresolved device has no params to collect anyway. Same
        // proven guard as the param/mixer loops, just one level up.
        if (!dev.id || dev.id === "0") return params;
        var devName = dev.get("name").toString();
        var className = dev.get("class_name").toString();

        // Skip our own device
        if (devName === "StrideLink") return params;

        // Read this device's parameters
        var paramIds = dev.get("parameters");
        var paramCount = paramIds.length / 2;

        // VST3 plugins can expose THOUSANDS of internal automatable params to
        // the host (e.g. kHs Transient Shaper reports 2086 even though its UI
        // shows ~5 knobs). Walking them all blocks Ableton's main thread on
        // every scan -> freeze. Cap the per-device scan; real/mapped params are
        // virtually always within the first couple hundred entries.
        if (paramCount > 500) {
            post("Stride: '" + devName + "' exposes " + paramCount + " params (likely a VST3); scanning first 500 to avoid freezing Ableton.\n");
            paramCount = 500;
        }

        for (var i = 0; i < paramCount; i++) {
            try {
                var paramPath = basePath + " parameters " + i;
                var param = new LiveAPI(paramPath);

                // Skip params whose path didn't resolve to a real object (id 0).
                // Some AU/VST plugins report a `parameters` count larger than the
                // objects Live actually exposes, so the trailing indices resolve to
                // nothing. Calling .get() on an unresolved object floods the Max
                // window with "jsliveapi get: no valid object set" AND burns a
                // main-thread LOM round-trip per bad index -> Ableton freezes on
                // every (auto)scan. Mirrors the guard in the mixer_device loop below.
                // Output-neutral: these params were already dropped by the catch,
                // just noisily and expensively.
                if (!param.id || param.id === "0") continue;

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
                    var paramStr = param.call("str_for_value", value).toString();
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
                        // Same guard for the chain object: a rack can report more
                        // chains than exist, so a trailing index resolves to nothing.
                        if (!chain.id || chain.id === "0") continue;
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
                                // Guard the mixer object before reading sends.
                                if (mixerObj.id && mixerObj.id !== "0") {
                                    var sendIds = mixerObj.get("sends");
                                    var sendCount = sendIds.length / 2;
                                    for (var si = 0; si < sendCount; si++) {
                                        mixerProps.push("sends " + si);
                                    }
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
                                        var mStr = mParam.call("str_for_value", mValue).toString();
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
            if (!dev.id || dev.id === "0") continue;
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
            if (!dev.id || dev.id === "0") continue;
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

        // Install the detail-clip observer once LiveAPI is warm (first scan).
        _setupClipObserver();

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

function _validClip(api) {
    return api && api.id && api.id != 0;
}

// "live_set tracks N clip_slots M clip" -> { track: N, slot: M }; -1 if unknown
function _clipSlotFromPath(p) {
    var m = String(p).match(/tracks (\d+) clip_slots (\d+)/);
    if (m) return { track: parseInt(m[1]), slot: parseInt(m[2]) };
    return { track: -1, slot: -1 };
}

// Resolve the target clip — the single source of truth used by scan/read/inject.
//   1) detail_clip (the clip open in Live's editor)
//   2) the LAST clip that was in detail view (cached) — survives clicking away
//   3) the selected track's first non-empty clip slot
// Returns { clip, track, slot, source } or null.
function _resolveTargetClip() {
    try {
        var dc = new LiveAPI("live_set view detail_clip");
        if (_validClip(dc)) {
            _lastDetailClipId = dc.id;
            var loc = _clipSlotFromPath(dc.unquotedpath);
            return { clip: dc, track: loc.track, slot: loc.slot, source: "detail_clip" };
        }
    } catch (e) {}

    if (_lastDetailClipId) {
        try {
            var lc = new LiveAPI("id " + _lastDetailClipId);
            if (_validClip(lc)) {
                var loc2 = _clipSlotFromPath(lc.unquotedpath);
                return { clip: lc, track: loc2.track, slot: loc2.slot, source: "last_detail" };
            }
        } catch (e2) {}
        _lastDetailClipId = null;   // cached clip is gone
    }

    try {
        var trk = new LiveAPI("live_set view selected_track");
        var slots = trk.get("clip_slots"); var sc = slots.length / 2;
        for (var s = 0; s < Math.min(sc, 16); s++) {
            var slot = new LiveAPI("live_set view selected_track clip_slots " + s);
            if (parseInt(slot.get("has_clip"))) {
                var clip = new LiveAPI("live_set view selected_track clip_slots " + s + " clip");
                if (_validClip(clip)) {
                    var loc3 = _clipSlotFromPath(clip.unquotedpath);
                    return { clip: clip, track: loc3.track, slot: (loc3.slot >= 0 ? loc3.slot : s), source: "first_slot" };
                }
            }
        }
    } catch (e3) {}
    return null;
}

function _getClipInfo() {
    try {
        var r = _resolveTargetClip();
        if (r && r.clip) {
            var clipLength = parseFloat(r.clip.get("length"));
            return {
                clip_bars: Math.max(1, Math.round(clipLength / 4)),
                has_clip: true,
                clip_slot: (r.slot >= 0 ? r.slot : 0),
                clip_source: r.source
            };
        }
    } catch (e) {}

    return { clip_bars: 4, has_clip: false, clip_slot: 0, clip_source: "none" };
}

// ─── DETAIL-CLIP OBSERVER ─────────────────────────────────
// Watches the clip in Live's detail view so Stride re-syncs the moment you
// open a different clip — even on the same track (no window refocus needed).
// Lightweight: it only reports the clip's identity + bars; the canvas drives
// the (debounced) param scan. Installed lazily on the first scan, once.
function _onDetailClipChange(args) {
    try {
        var r = _resolveTargetClip();
        var id = (r && r.clip) ? String(r.clip.id) : "0";
        if (id === _lastFocusEmitId) return;     // de-dupe repeated fires
        _lastFocusEmitId = id;
        var info = { has_clip: false, clip_slot: 0, clip_bars: 4, clip_id: id, source: (r ? r.source : "none") };
        if (r && r.clip) {
            info.has_clip = true;
            info.clip_slot = (r.slot >= 0 ? r.slot : 0);
            var len = parseFloat(r.clip.get("length"));
            info.clip_bars = Math.max(1, Math.round(len / 4));
        }
        outlet(0, "clip_focus", JSON.stringify(info));
    } catch (e) { post("Stride clip_focus error: " + e.message + "\n"); }
}

function _setupClipObserver() {
    if (_clipObs) return;
    try {
        _clipObs = new LiveAPI(_onDetailClipChange, "live_set view");
        _clipObs.property = "detail_clip";
        post("Stride: detail_clip observer installed\n");
    } catch (e) { post("Stride: clip observer setup failed: " + e.message + "\n"); }
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
            var pStr = param.call("str_for_value", param.get("value")).toString();
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
                // Guard: a chain/device over-reporting its child count yields a
                // trailing index that resolves to nothing; reading it floods the
                // Max window with "no valid object set" and freezes Live. Skip.
                if (!dev.id || dev.id === "0") return;
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
                                if (!chain.id || chain.id === "0") continue;
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

// ─── READ-PROBE (diagnostic, READ-ONLY) ───────────────────
// Tests whether Max JS LiveAPI can READ an existing clip automation
// envelope — the gate for the "read existing curves" feature. This NEVER
// creates, sets, or clears anything: it only calls the getter
// `automation_envelope`, plus `value_at_time` / `events_in_range` / `.get`
// / `.info` (all read). Safe to run on a real project.
//
// Trigger: app sends {type:'scan_read_test'} → server.js emits the
// "scan_read_envelopes" command. Result: outlet 0 "read_probe_result" →
// server.js writes ~/_stride_read_probe_result.json.

function _extractEnvId(ret) {
    try {
        if (ret === null || ret === undefined) return null;
        if (typeof ret === "number") return ret > 0 ? ret : null;
        if (typeof ret === "string") { var n = parseInt(ret); return (n > 0) ? n : null; }
        if (ret instanceof Array) {
            for (var i = 0; i < ret.length; i++) {
                if (ret[i] === "id" && i + 1 < ret.length) {
                    var v = parseInt(ret[i + 1]); if (v > 0) return v;
                }
            }
            var last = parseInt(ret[ret.length - 1]); if (last > 0) return last;
        }
    } catch (e) {}
    return null;
}

function scan_read_envelopes() {
    var R = { ok: true, live_version: "", clip_source: "none", clip_id: "", clip_length: 0,
              params_with_automation: 0, attempts: [], envelope: null, notes: [] };
    function note(s) { R.notes.push(s); post("Stride ReadProbe: " + s + "\n"); }

    try {
        try {
            var app = new LiveAPI("live_app");
            R.live_version = app.call("get_major_version") + "." + app.call("get_minor_version") + "." + app.call("get_bugfix_version");
        } catch (ve) { R.live_version = "unknown (" + ve.message + ")"; }
        note("Live " + R.live_version);

        // ── Target clip: detail_clip first (the clip open in Live's editor),
        //    else the selected track's first clip slot that holds a clip ──
        var clip = null;
        try {
            var dc = new LiveAPI("live_set view detail_clip");
            if (dc && dc.id && dc.id != 0) { clip = dc; R.clip_source = "detail_clip"; }
        } catch (de) {}
        if (!clip) {
            try {
                var trk0 = new LiveAPI("live_set view selected_track");
                var slots = trk0.get("clip_slots"); var sc = slots.length / 2;
                for (var s = 0; s < Math.min(sc, 16); s++) {
                    var slot = new LiveAPI("live_set view selected_track clip_slots " + s);
                    if (parseInt(slot.get("has_clip"))) {
                        clip = new LiveAPI("live_set view selected_track clip_slots " + s + " clip");
                        R.clip_source = "selected_track clip_slots " + s;
                        break;
                    }
                }
            } catch (fe) {}
        }
        if (!clip || !clip.id || clip.id == 0) {
            R.ok = false; note("No clip found — open a clip in Live's detail view (or put one on the selected track).");
            outlet(0, "read_probe_result", JSON.stringify(R)); return;
        }
        R.clip_id = String(clip.id);
        R.clip_length = parseFloat(clip.get("length"));
        note("clip via " + R.clip_source + " id=" + R.clip_id + " length=" + R.clip_length + " beats");

        // ── Walk selected-track params; find one with a clip envelope ──
        var track = new LiveAPI("live_set view selected_track");
        var trackPath = track.unquotedpath;
        var devIds = track.get("devices"); var devCount = devIds.length / 2;
        var foundEnvId = null, foundSig = "", foundParam = "";

        var TRY_CAP = 200;   // bound automation_envelope attempts (probe safety on big racks)
        var tried = 0;
        for (var i = 0; i < devCount && !foundEnvId; i++) {
            var devPath = trackPath + " devices " + i;
            var dev = new LiveAPI(devPath);
            if (!dev.id || dev.id === "0") continue;
            if (dev.get("name").toString() === "StrideLink") continue;
            var pIds = dev.get("parameters"); var pCount = pIds.length / 2;
            if (pCount > 300) pCount = 300;

            for (var p = 0; p < pCount && !foundEnvId && tried < TRY_CAP; p++) {
                var prm;
                try { prm = new LiveAPI(devPath + " parameters " + p); } catch (pe) { continue; }
                if (!prm.id || prm.id === "0") continue;
                var autoState = 0;
                try { autoState = parseInt(prm.get("automation_state")); } catch (ae) {}
                if (autoState > 0) R.params_with_automation++;

                var pName = prm.get("name").toString();
                var pid = prm.id;
                tried++;

                // Try the getter regardless of automation_state — a hand-drawn
                // clip envelope doesn't always raise automation_state, and the
                // getter is non-destructive (returns None when there's no
                // envelope, never creates one).
                var aRet = null, aErr = null;
                try { aRet = clip.call("automation_envelope", pid); } catch (eA) { aErr = eA.message; }
                var aId = _extractEnvId(aRet);

                var bRet = null, bErr = null, bId = null;
                if (!aId) {
                    try { bRet = clip.call("automation_envelope", "id", pid); } catch (eB) { bErr = eB.message; }
                    bId = _extractEnvId(bRet);
                }

                // Keep the result readable: log the first few attempts (to show the
                // raw return shape for non-automated params), plus anything that
                // errored or actually yielded an envelope.
                if (R.attempts.length < 6 || aId || bId || aErr || bErr) {
                    R.attempts.push({ param: pName, auto_state: autoState,
                                      A_raw: String(aRet), A_err: aErr, A_id: aId,
                                      B_raw: (aId ? "(skipped)" : String(bRet)), B_err: bErr, B_id: bId });
                }

                if (aId) { foundEnvId = aId; foundSig = "call(name,id)"; foundParam = pName; }
                else if (bId) { foundEnvId = bId; foundSig = "call(name,'id',id)"; foundParam = pName; }
            }
        }

        note("params tried: " + tried + ", with automation_state>0: " + R.params_with_automation);
        if (!foundEnvId) {
            note("Could not obtain an envelope from Max JS — either no param has a CLIP envelope, or automation_envelope isn't reachable here. (Try a clip where you drew automation by hand.)");
            outlet(0, "read_probe_result", JSON.stringify(R)); return;
        }
        note("GOT envelope id=" + foundEnvId + " via " + foundSig + " for '" + foundParam + "'");

        var env = new LiveAPI("id " + foundEnvId);
        var envInfo = "";
        try { envInfo = String(env.info); } catch (ie) { envInfo = "info error: " + ie.message; }

        var E = { env_id: String(foundEnvId), via: foundSig, param: foundParam,
                  info_excerpt: envInfo.substring(0, 700),
                  value_at_time: null, value_at_time_err: null,
                  events_in_range_raw: null, events_in_range_err: null };

        // value_at_time sampling — the Max-JS-friendly read path (returns plain numbers)
        try {
            var len = R.clip_length || 4;
            var samples = [];
            for (var sIdx = 0; sIdx <= 8; sIdx++) {
                var t = len * sIdx / 8;
                samples.push({ t: Math.round(t * 1000) / 1000, v: env.call("value_at_time", t) });
            }
            E.value_at_time = samples;
            note("value_at_time OK: " + JSON.stringify(samples));
        } catch (sErr) { E.value_at_time_err = sErr.message; note("value_at_time FAILED: " + sErr.message); }

        // events_in_range — the breakpoint-enumeration path (may not survive Max JS)
        try {
            var evs = env.call("events_in_range", 0.0, R.clip_length || 4);
            E.events_in_range_raw = String(evs);
            note("events_in_range returned: " + String(evs).substring(0, 300));
        } catch (eErr) { E.events_in_range_err = eErr.message; note("events_in_range FAILED: " + eErr.message); }

        R.envelope = E;
        outlet(0, "read_probe_result", JSON.stringify(R));
        outlet(1, "status", "Read probe done — see _stride_read_probe_result.json");

    } catch (e) {
        R.ok = false; R.fatal = e.message;
        note("FATAL: " + e.message);
        try { outlet(0, "read_probe_result", JSON.stringify(R)); } catch (oe) {}
    }
}

// ─── READ EXISTING CURVES (feature, Option B) ─────────────
// Pulls the existing automation off the synced clip and returns it as canvas
// points (time in beats, value normalized 0-1) keyed by LOM _path so the
// canvas can drop each curve onto its matching lane. READ-ONLY.
//   mode "A" — value_at_time sampling (dense samples; the Max-JS-safe path)
//   mode "B" — events_in_range breakpoints (exact points; may not survive Max JS)

function _normValue(v, min, max, isLog) {
    if (max === min) return 0;
    var n;
    if (isLog && min > 0 && max > min && v > 0) {
        n = Math.log(v / min) / Math.log(max / min);
    } else {
        n = (v - min) / (max - min);
    }
    return n < 0 ? 0 : (n > 1 ? 1 : n);
}

function _callAutoEnv(clip, pid) {
    var r = null;
    try { r = clip.call("automation_envelope", pid); } catch (e) {}
    if (_extractEnvId(r)) return r;
    try { r = clip.call("automation_envelope", "id", pid); } catch (e) {}
    return r;
}

// events_in_range shape from Max JS is uncertain — coerce a flat [t,v,t,v,...]
// number array if that's what we get; otherwise return [] (mode B not usable).
function _coerceEvents(evs) {
    var out = [];
    try {
        if (evs instanceof Array && evs.length >= 2) {
            var nums = [];
            for (var i = 0; i < evs.length; i++) {
                var f = parseFloat(evs[i]);
                if (f !== f) return out;   // non-number → can't interpret
                nums.push(f);
            }
            for (var j = 0; j + 1 < nums.length; j += 2) {
                out.push({ time: nums[j], value: nums[j + 1] });
            }
        }
    } catch (e) {}
    return out;
}

function read_clip_curves(mode) {
    mode = (mode === "B") ? "B" : "A";
    var out = { ok: true, mode: mode, clip_source: "none", clip_length: 0,
                params: [], lanes_found: 0, walked: 0, notes: [] };
    function note(s) { out.notes.push(s); post("Stride ReadCurves: " + s + "\n"); }

    try {
        // Target clip via the shared resolver: detail_clip → last clip that was
        // in detail view → selected track's first slot. Same source of truth as
        // scan/bars and inject, so all three always agree.
        var _r = _resolveTargetClip();
        var clip = _r ? _r.clip : null;
        if (_r) out.clip_source = _r.source;
        if (!clip || !clip.id || clip.id == 0) {
            out.ok = false; note("no clip (open a clip in the detail view)");
            outlet(0, "clip_curves", JSON.stringify(out)); return;
        }
        var clipLen = parseFloat(clip.get("length"));
        out.clip_length = clipLen;
        note("clip via " + out.clip_source + " length=" + clipLen + " beats, mode " + mode);

        var track = new LiveAPI("live_set view selected_track");
        var trackPath = track.unquotedpath;
        var devIds = track.get("devices"); var devCount = devIds.length / 2;
        var SAMPLES = 48;   // mode A resolution across the clip
        var CAP = 300;      // bound total params walked
        var dbgCount = 0;   // raw automation_envelope returns for the first N params

        for (var i = 0; i < devCount; i++) {
            var devPath = trackPath + " devices " + i;
            var dev = new LiveAPI(devPath);
            if (!dev.id || dev.id === "0") continue;
            var devName = dev.get("name").toString();
            if (devName === "StrideLink") continue;
            var pIds = dev.get("parameters"); var pCount = pIds.length / 2;
            if (pCount > 300) pCount = 300;

            for (var p = 0; p < pCount && out.walked < CAP; p++) {
                out.walked++;
                var prm;
                try { prm = new LiveAPI(devPath + " parameters " + p); } catch (pe) { continue; }
                if (!prm.id || prm.id === "0") continue;
                var pName = prm.get("name").toString();
                if (pName === "Device On") continue;

                // Read the clip envelope for this param. Capture the raw returns
                // for the first dozen params so we can see whether Max JS gets an
                // envelope object back at all (the open question).
                var pid = prm.id;
                var aRaw = null, aErr = null, bRaw = null, bErr = null;
                try { aRaw = clip.call("automation_envelope", pid); } catch (ae) { aErr = ae.message; }
                var envId = _extractEnvId(aRaw);
                if (!envId) {
                    try { bRaw = clip.call("automation_envelope", "id", pid); } catch (be) { bErr = be.message; }
                    envId = _extractEnvId(bRaw);
                }
                if (dbgCount < 12) {
                    dbgCount++;
                    out.notes.push("p['" + pName + "'] A=" + String(aRaw) + (aErr ? (" Aerr=" + aErr) : "") +
                                   " B=" + String(bRaw) + (bErr ? (" Berr=" + bErr) : "") + " envId=" + envId);
                }
                if (!envId) continue;          // no envelope on this param for this clip

                var env = new LiveAPI("id " + envId);
                var pmin = parseFloat(prm.get("min"));
                var pmax = parseFloat(prm.get("max"));
                var pIsLog = false;
                try { var ps = prm.call("str_for_value", prm.get("value")).toString(); if (/Hz|kHz/.test(ps)) pIsLog = true; } catch (le) {}

                var pts = [];
                if (mode === "A") {
                    for (var sIdx = 0; sIdx <= SAMPLES; sIdx++) {
                        var t = clipLen * sIdx / SAMPLES;
                        var raw;
                        try { raw = parseFloat(env.call("value_at_time", t)); } catch (ve) { raw = NaN; }
                        if (raw !== raw) continue;
                        pts.push({ time: Math.round(t * 1000) / 1000, value: _normValue(raw, pmin, pmax, pIsLog), curve: 0 });
                    }
                } else {
                    try {
                        var evs = env.call("events_in_range", 0.0, clipLen);
                        var arr = _coerceEvents(evs);
                        for (var k = 0; k < arr.length; k++) {
                            pts.push({ time: Math.round(arr[k].time * 1000) / 1000, value: _normValue(arr[k].value, pmin, pmax, pIsLog), curve: 0 });
                        }
                        if (arr.length === 0) note("events_in_range gave no usable points for '" + pName + "' (raw: " + String(evs).substring(0, 80) + ")");
                    } catch (ee) { note("events_in_range failed for '" + pName + "': " + ee.message); }
                }

                if (pts.length) {
                    out.params.push({ _path: devPath + " parameters " + p, name: devName + ": " + pName, points: pts });
                    out.lanes_found++;
                }
            }
        }

        note("lanes with curves: " + out.lanes_found + " (walked " + out.walked + " params)");
        outlet(0, "clip_curves", JSON.stringify(out));
        outlet(1, "status", "Read " + out.lanes_found + " existing lanes (mode " + mode + ")");

    } catch (e) {
        out.ok = false; out.fatal = e.message; note("FATAL: " + e.message);
        try { outlet(0, "clip_curves", JSON.stringify(out)); } catch (oe) {}
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
    else if (cmd === "scan_read_envelopes") scan_read_envelopes();
    else if (cmd === "read_clip_curves") read_clip_curves(args[0] ? args[0].toString() : "A");
    else post("Stride: Unknown command '" + cmd + "'\n");
}
