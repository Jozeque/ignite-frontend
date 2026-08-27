/**
 * StrideBridge — the LiveAPI half.
 *
 * Runs in a [js] object because node.script cannot touch LiveAPI.
 * Every verb is driven by bridge-server.js through the patcher fabric:
 *
 *   map_start / map_cancel
 *       Arm the persistent `live_set view` selected_parameter observer. While
 *       armed, the next change = the knob the user clicked -> probe it fully
 *       (name, device, min/max, is_quantized, log detection, canonical path)
 *       and hand the JSON back to node. Same gesture as the VST's own mapping.
 *       If the wanted knob is ALREADY selected, clicking it fires no change:
 *       click another knob first (matches Live's own Map buttons).
 *
 *   resolve <rid> <path...>
 *       Stored LOM path -> fresh id (ids are session-scoped), plus the param's
 *       NAME, its DEVICE name and its CANONICAL path (identity check + heal).
 *
 *   find <rid> <encDevice> <encParam>
 *       Every (device name, param name) match in the whole set, racks and
 *       chains included. The server picks (hint, uniqueness) or reports.
 *
 *   relink <rid> <encDevicePath> <encNamesJson>
 *       For ONE device (the title bar the user clicked while MAP LIVE is armed):
 *       the ids of the named params on it. The server moves the lanes there.
 *
 *   repath <rid> <id ...>
 *       Bound ids -> their CURRENT paths (grouping/reordering moves addresses
 *       under a live bind; the stored path heals in-session).
 *
 *   ping -> pong
 *       Liveness: a node process whose patcher is gone stops getting these
 *       answered and yields the port.
 *
 * Selection HINTS (gesture-driven only): the server learns what the user just
 * selected (track, device) so a Stride that connects right after a rack drop or
 * a wrench click can be placed. Attach echoes at init are NOT hints: on a set
 * load the restored selection says nothing about who is who.
 *
 * Payloads cross to node encodeURIComponent'd so Max's atom splitting can
 * never mangle a JSON with spaces in it (device names, track names).
 *
 * ES5 only - Max's js object. Idioms borrowed from m4l/node/scanner_max.js.
 */

autowatch = 0;
outlets = 1;

var _obs = null;          // PERSISTENT LiveAPI observer (created by init, lives with the device)
var _armed = false;       // armed = map flow; idle = touched probe (lane-finder glow)
var _skipFirst = true;    // the attach echo at init - that's whatever was selected at load

function _enc(o) { return encodeURIComponent(JSON.stringify(o)); }
function _upath(o) { return String(o.unquotedpath || o.path || "").replace(/^"|"$/g, ""); }
function _trackOf(p) {
    var m = /^live_set (tracks \d+|return_tracks \d+|master_track)/.exec(String(p || ""));
    return m ? m[0] : "";
}
function _deviceNameOf(paramPath) {
    try {
        var dp = String(paramPath || "").replace(/ parameters \d+$/, "");
        if (dp && dp !== paramPath) {
            var d = new LiveAPI(dp);
            if (d && parseInt(d.id, 10) !== 0) return String(d.get("name"));
        }
    } catch (e) {}
    return "";
}

function _probeSelected() {
    try {
        var p = new LiveAPI("live_set view selected_parameter");
        if (!p || !p.id || parseInt(p.id, 10) === 0) return null;

        var name = String(p.get("name"));
        var min = parseFloat(p.get("min"));
        var max = parseFloat(p.get("max"));
        var isQuant = 0;
        try { isQuant = parseInt(p.get("is_quantized"), 10) || 0; } catch (eq) {}

        // Log detection - same trick as scanner_max.js: a Hz/kHz readout
        // means Live scales this one logarithmically.
        var isLog = false;
        try {
            var s = p.call("str_for_value", p.get("value")).toString();
            if (/Hz|kHz/.test(s)) isLog = true;
        } catch (el) {}

        var upath = _upath(p);
        var devName = _deviceNameOf(upath);

        return {
            name: name, device: devName, path: upath,
            id: parseInt(p.id, 10),
            min: isNaN(min) ? 0 : min, max: isNaN(max) ? 1 : max,
            is_quantized: isQuant ? 1 : 0, is_log: isLog ? 1 : 0
        };
    } catch (e) {
        post("StrideBridge probe error: " + e.message + "\n");
        return null;
    }
}

function _onSelChange() {
    if (_skipFirst) { _skipFirst = false; return; }   // attach echo at init, not a click
    if (_armed) {
        var info = _probeSelected();
        if (!info) return;                             // clicked something non-automatable - stay armed
        _armed = false;                                // server re-arms for the next knob
        _stampTouch(_touchP, info.id);
        outlet(0, "mapped", _enc(info));
        return;
    }
    // Idle: the lane-finder. A click on any param in Live -> hand the path to the
    // server; the VST flashes the matching lane (if any) through the same glow the
    // hosted-plugin touch uses. Lightweight probe: path + name only.
    try {
        var p = new LiveAPI("live_set view selected_parameter");
        if (!p || !p.id || parseInt(p.id, 10) === 0) return;
        var upath = _upath(p);
        if (!upath) return;
        _stampTouch(_touchP, parseInt(p.id, 10));
        outlet(0, "touched", _enc({ path: upath, name: String(p.get("name")) }));
    } catch (e) {}
}

// ── re-click finder ──────────────────────────────────────────────────────
// Live's selected_parameter observer is CHANGE-driven: clicking the already-selected
// knob fires nothing (field report 2026-08-27). The patcher's [mousestate] reports
// every mouse-down globally as "mdown x y"; a down within a knob's width of where the
// current selection was last clicked, with the selection unchanged, is that knob
// again -> flash it again. Same for a device header. Live's state is never touched.
var RECLICK_PX = 26;                                   // about a Live knob's width
var _lastDown = { x: 0, y: 0, t: 0 };
var _touchP = { id: 0, x: null, y: null, t: 0 };       // last flashed PARAM + where it was clicked
var _touchD = { id: 0, x: null, y: null, t: 0 };       // last flashed DEVICE header
var _mdTask = null;

function _now() { return new Date().getTime(); }

function _stampTouch(rec, id) {
    rec.id = id;
    rec.t = _now();
    // the down that caused this selection change usually landed a few ms earlier;
    // if it has not arrived yet, the next down within 300ms fills the spot in (mdown)
    if (rec.t - _lastDown.t < 300) { rec.x = _lastDown.x; rec.y = _lastDown.y; }
    else { rec.x = null; rec.y = null; }
}

function _near(rec) {
    if (rec.x === null || rec.y === null) return false;
    var dx = _lastDown.x - rec.x, dy = _lastDown.y - rec.y;
    return (dx * dx + dy * dy) <= RECLICK_PX * RECLICK_PX;
}

function mdown(x, y) {
    _lastDown = { x: parseInt(x, 10) || 0, y: parseInt(y, 10) || 0, t: _now() };
    // a selection change that fired just before this down belongs to it: remember the spot
    if (_touchP.x === null && _lastDown.t - _touchP.t < 300) { _touchP.x = _lastDown.x; _touchP.y = _lastDown.y; return; }
    if (_touchD.x === null && _lastDown.t - _touchD.t < 300) { _touchD.x = _lastDown.x; _touchD.y = _lastDown.y; return; }
    // otherwise decide after Live had a moment to process the click (a real selection
    // change flashes through the observer and stamps a newer time, which cancels this)
    try { if (_mdTask) _mdTask.cancel(); } catch (e) {}
    try { _mdTask = new Task(_checkReclick); _mdTask.schedule(140); } catch (e2) {}
}

function _checkReclick() {
    if (_armed) return;                                // the mapping flow owns clicks while armed
    var down = _lastDown;
    if (_touchP.t >= down.t - 20 || _touchD.t >= down.t - 20) return;   // this down changed the selection: already flashed
    try {
        var p = new LiveAPI("live_set view selected_parameter");
        var pid = (p && p.id) ? parseInt(p.id, 10) : 0;
        if (pid && pid === _touchP.id && _near(_touchP)) {
            _touchP.t = down.t; _touchP.x = down.x; _touchP.y = down.y;
            outlet(0, "touched", _enc({ path: _upath(p), name: String(p.get("name")), again: 1 }));
            return;
        }
    } catch (e) {}
    try {
        var d = new LiveAPI("live_set view selected_track view selected_device");
        var did = (d && d.id) ? parseInt(d.id, 10) : 0;
        if (did && did === _touchD.id && _near(_touchD)) {
            _touchD.t = down.t; _touchD.x = down.x; _touchD.y = down.y;
            outlet(0, "touched_dev", _enc({ path: _upath(d), name: String(d.get("name")), again: 1 }));
        }
    } catch (e2) {}
}

// Device-level finder + selection hints. Clicking a remote-BOUND knob never changes
// selected_parameter (Live swallows interaction on remote-controlled params), but
// clicking the DEVICE header always selects it. selected_device lives under the
// selected TRACK's view, so the device observer is rebuilt whenever the track
// selection changes. The rebuild's attach echo reports the device that is selected
// on the newly picked track: after a USER track change that is a hint (a dropped
// rack is selected on its new track), after init it is noise.
var _obsTrack = null;
var _obsDev = null;
var _skipDev = true;
var _hintDevEcho = false;
var _skipTrack = true;
var _skipTrackTask = null;
var _obsPlay = null;
var _lastPlay = -1;

// Transport gate for stop-to-find: while STOPPED the server releases the
// continuous live.remote~ binds, so knobs become clickable (and hand-movable);
// on PLAY they re-bind and modulation resumes from the transport-locked phase.
function _onPlayChange() {
    try {
        var ls = new LiveAPI("live_set");
        var on = parseInt(ls.get("is_playing"), 10) ? 1 : 0;
        if (on === _lastPlay) return;
        _lastPlay = on;
        outlet(0, "transport", on);
    } catch (e) {}
}

function _emitDevSel() {
    try {
        var d = new LiveAPI("live_set view selected_track view selected_device");
        var dp = (d && d.id && parseInt(d.id, 10) !== 0) ? _upath(d) : "";
        var t = new LiveAPI("live_set view selected_track");
        var tp = (t && t.id && parseInt(t.id, 10) !== 0) ? _upath(t) : _trackOf(dp);
        outlet(0, "sel", _enc({ track: tp, device: dp }));
    } catch (e) {}
}

function _onDevChange() {
    if (_skipDev) {
        _skipDev = false;
        if (_hintDevEcho) { _hintDevEcho = false; _emitDevSel(); }
        return;
    }
    try {
        var d = new LiveAPI("live_set view selected_track view selected_device");
        if (!d || !d.id || parseInt(d.id, 10) === 0) return;
        var upath = _upath(d);
        if (!upath) return;
        _stampTouch(_touchD, parseInt(d.id, 10));
        outlet(0, "touched_dev", _enc({ path: upath, name: String(d.get("name")) }));
    } catch (e) {}
}

function _watchDevice(gesture) {
    if (_obsDev) { try { _obsDev.property = ""; } catch (e) {} _obsDev = null; }
    _skipDev = true;
    _hintDevEcho = !!gesture;
    try {
        _obsDev = new LiveAPI(_onDevChange, "live_set view selected_track view");
        _obsDev.property = "selected_device";
    } catch (e) {}
}

function _onTrackChange() {
    if (_skipTrack) {                 // attach echo at init: re-anchor silently
        _skipTrack = false;
        _watchDevice(false);
        return;
    }
    try {                             // a user picked a track: that is a hint
        var t = new LiveAPI("live_set view selected_track");
        var tp = (t && t.id && parseInt(t.id, 10) !== 0) ? _upath(t) : "";
        if (tp) outlet(0, "sel", _enc({ track: tp, device: "" }));
    } catch (e) {}
    _watchDevice(true);               // its echo names the selected device on that track
}

// Called by [live.thisdevice] bang once the Live API is ready - a loadbang-time
// LiveAPI is the classic M4L trap (the set is not up yet).
function init() {
    if (_obs) return;
    _skipFirst = true;
    _skipTrack = true;
    try {
        _obs = new LiveAPI(_onSelChange, "live_set view");
        _obs.property = "selected_parameter";
    } catch (e) {
        post("StrideBridge observer failed: " + e.message + "\n");
    }
    try {
        _obsTrack = new LiveAPI(_onTrackChange, "live_set view");
        _obsTrack.property = "selected_track";
    } catch (e2) {}
    try {
        _obsPlay = new LiveAPI(_onPlayChange, "live_set");
        _obsPlay.property = "is_playing";
    } catch (e3) {}
    _watchDevice(false);
    // if the track observer never echoes, the first REAL track change must not be eaten
    try {
        _skipTrackTask = new Task(function () { _skipTrack = false; });
        _skipTrackTask.schedule(1500);
    } catch (e4) { _skipTrack = false; }
}

function map_start() {
    init();               // belt + braces if the device loaded oddly
    _armed = true;        // persistent observer: no attach echo, no skip needed
}

function map_cancel() { _armed = false; }

function ping() { outlet(0, "pong", 1); }

// find <rid> <encDevice> <encParam> - every device named X carrying a param named Y,
// the WHOLE set (racks and chains included). Names arrive encodeURIComponent'd -
// two multi-word names cannot survive Max's atom splitting any other way.
var FIND_CAP = 16;

function _scanChain(basePath, devName, parName, hits) {
    var count = 0;
    try { count = parseInt(new LiveAPI(basePath).getcount("devices"), 10) || 0; } catch (e) { return; }
    for (var i = 0; i < count; i++) {
        if (hits.length >= FIND_CAP) return;
        var dPath = basePath + " devices " + i;
        var d;
        try { d = new LiveAPI(dPath); } catch (e2) { continue; }
        if (!d || parseInt(d.id, 10) === 0) continue;
        var dn = "";
        try { dn = String(d.get("name")); } catch (e3) {}
        if (dn === devName) {
            var pc = 0;
            try { pc = parseInt(d.getcount("parameters"), 10) || 0; } catch (e4) {}
            for (var j = 0; j < pc; j++) {
                try {
                    var pp = new LiveAPI(dPath + " parameters " + j);
                    if (pp && parseInt(pp.id, 10) !== 0 && String(pp.get("name")) === parName) {
                        hits.push({ path: _upath(pp), id: parseInt(pp.id, 10) });
                        break;
                    }
                } catch (e5) {}
            }
        }
        // racks nest: instrument/audio/drum racks all expose chains
        var cc = 0;
        try { cc = parseInt(d.getcount("chains"), 10) || 0; } catch (e6) {}
        for (var c = 0; c < cc; c++) _scanChain(dPath + " chains " + c, devName, parName, hits);
    }
}

function find(rid, encDev, encPar) {
    var devName = "", parName = "";
    try { devName = decodeURIComponent(String(encDev)); parName = decodeURIComponent(String(encPar)); } catch (e) {}
    var hits = [];
    try {
        var nT = parseInt(new LiveAPI("live_set").getcount("tracks"), 10) || 0;
        for (var t = 0; t < nT; t++) _scanChain("live_set tracks " + t, devName, parName, hits);
        var nR = parseInt(new LiveAPI("live_set").getcount("return_tracks"), 10) || 0;
        for (var r = 0; r < nR; r++) _scanChain("live_set return_tracks " + r, devName, parName, hits);
        _scanChain("live_set master_track", devName, parName, hits);
    } catch (e2) {}
    var out = { rid: rid, count: hits.length, hits: hits };
    if (hits.length === 1) { out.path = hits[0].path; out.id = hits[0].id; }
    outlet(0, "found", _enc(out));
}

// relink <rid> <encDevicePath> <encNamesJson> - the named params on ONE device
function relink(rid, encDevPath, encNames) {
    var devPath = "", names = [];
    try { devPath = decodeURIComponent(String(encDevPath)); } catch (e) {}
    try { names = JSON.parse(decodeURIComponent(String(encNames))) || []; } catch (e2) {}
    var items = [];
    try {
        var d = new LiveAPI(devPath);
        if (d && parseInt(d.id, 10) !== 0) {
            var pc = 0;
            try { pc = parseInt(d.getcount("parameters"), 10) || 0; } catch (e3) {}
            var byName = {};
            for (var j = 0; j < pc; j++) {
                try {
                    var pp = new LiveAPI(devPath + " parameters " + j);
                    if (!pp || parseInt(pp.id, 10) === 0) continue;
                    var nm = String(pp.get("name"));
                    if (!byName[nm]) byName[nm] = { id: parseInt(pp.id, 10), path: _upath(pp) };
                } catch (e4) {}
            }
            for (var k = 0; k < names.length; k++) {
                var hit = byName[String(names[k])];
                if (hit) items.push({ name: String(names[k]), id: hit.id, path: hit.path });
            }
        }
    } catch (e5) {}
    outlet(0, "relinked", _enc({ rid: rid, devPath: devPath, items: items }));
}

// repath <rid> <id ...> - bound ids -> current canonical paths (ok:0 = gone)
function repath() {
    var a = arrayfromargs(arguments);
    var rid = a[0];
    var items = [];
    for (var i = 1; i < a.length; i++) {
        var id = parseInt(a[i], 10);
        if (!id) continue;
        var it = { id: id, ok: 0, path: "" };
        try {
            var o = new LiveAPI("id " + id);
            if (o && parseInt(o.id, 10) === id && String(o.type) === "DeviceParameter") {
                it.ok = 1;
                it.path = _upath(o);
            }
        } catch (e) {}
        items.push(it);
    }
    outlet(0, "repathed", _enc({ rid: rid, items: items }));
}

// resolve <rid> <path atoms...> - rejoin because Max splits symbols on spaces.
function resolve() {
    var a = arrayfromargs(arguments);
    var rid = a[0];
    var p = a.slice(1).join(" ");
    var out = { rid: rid, ok: 0, id: 0, name: "", device: "", path: "", message: "" };
    try {
        var la = new LiveAPI(p);
        var id = la ? parseInt(la.id, 10) : 0;
        if (id && String(la.type) === "DeviceParameter") {
            out.ok = 1; out.id = id; out.name = String(la.get("name"));
            out.path = _upath(la) || p;
            out.device = _deviceNameOf(out.path);
        } else {
            out.message = "not found";
        }
    } catch (e) {
        out.message = e.message;
    }
    outlet(0, "resolved", _enc(out));
}
