/**
 * Stride M4L Bezier Probe — bonus test
 *
 * Tests whether M4L's LiveAPI can call the bezier write API directly
 * (no Python Remote Script needed). LiveAPI marshals args as primitives,
 * so passing EnvelopeEvent / ControlCoefficients class instances is
 * unlikely to work — but maybe Ableton accepts a flat-arg overload.
 *
 * USAGE (in StrideLink.amxd or a scratch patcher):
 *   1. Add a [js bezier_probe.js] object
 *   2. Add a [button] -> message to its inlet
 *   3. Open the Max console (Window menu)
 *   4. Set up Ableton like for the Python probe:
 *        - device with continuous param on selected track
 *        - MIDI clip is the detail clip
 *   5. Click the button — read results in the Max console
 */

autowatch = 1;
inlets = 1;
outlets = 1;

function bang() { run(); }
function msg_int() { run(); }

function _line(s) { post(s + "\n"); }

function run() {
    _line("");
    _line("──── M4L Bezier Probe ────");

    // 1) Detail clip
    var clip = new LiveAPI("live_set view detail_clip");
    if (!clip || !clip.id || clip.id == 0) {
        _line("FAIL: no detail_clip — double-click a MIDI clip first");
        return;
    }
    _line("clip id=" + clip.id + " name=" + clip.get("name") + " len=" + clip.get("length"));

    // 2) Continuous param on selected track
    var track = new LiveAPI("live_set view selected_track");
    var devCount = track.getcount("devices");
    var paramPath = null, paramId = null, paramName = "";
    for (var d = 0; d < devCount && !paramPath; d++) {
        var dev = new LiveAPI("live_set view selected_track devices " + d);
        var pCount = dev.getcount("parameters");
        for (var p = 0; p < pCount; p++) {
            var par = new LiveAPI("live_set view selected_track devices " + d + " parameters " + p);
            var name = ("" + par.get("name"));
            if (parseInt(par.get("is_quantized")) !== 0) continue;
            if (name === "Device On") continue;
            paramPath = "live_set view selected_track devices " + d + " parameters " + p;
            paramId = par.id;
            paramName = name;
            break;
        }
    }
    if (!paramPath) {
        _line("FAIL: no continuous DeviceParameter on selected track");
        return;
    }
    _line("param: " + paramName + " id=" + paramId + " path=" + paramPath);

    // 3) Get/create envelope. M4L surface returns "id N"; we then bind a new LiveAPI to it.
    var envIdRaw;
    try {
        envIdRaw = clip.call("create_automation_envelope", paramId);
        _line("clip.call('create_automation_envelope', " + paramId + ") -> " + envIdRaw);
    } catch (e) {
        _line("FAIL create_automation_envelope: " + e.message);
        return;
    }

    var env = null;
    if (envIdRaw) {
        try {
            var idNum = parseInt(("" + envIdRaw).replace(/^id\s+/, ""));
            if (idNum && idNum > 0) {
                env = new LiveAPI();
                env.id = idNum;
                _line("envelope path=" + env.unquotedpath);
                _line("envelope info BEGIN");
                _line("" + env.info);
                _line("envelope info END");
            } else {
                _line("envelope id not parseable from: " + envIdRaw);
            }
        } catch (e) {
            _line("could not bind to envelope id: " + e.message);
        }
    }

    // 4) Try the new write API from M4L with positional primitives
    if (env) {
        // (time, value)
        try {
            var r1 = env.call("create_event", 0.0, 0.5);
            _line("env.call('create_event', t, v) -> " + r1);
        } catch (e) {
            _line("env.call('create_event', t, v) raised: " + e.message);
        }
        // (time, value, x1, y1, x2, y2) — flat-arg bezier guess
        try {
            var r2 = env.call("create_event", 1.0, 0.8, 0.25, 0.9, 0.75, 0.1);
            _line("env.call('create_event', t,v,x1,y1,x2,y2) -> " + r2);
        } catch (e) {
            _line("env.call('create_event', t,v,x1,y1,x2,y2) raised: " + e.message);
        }
        // read-back
        try {
            var evs = env.call("events_in_range", 0.0, 4.0);
            _line("env.call('events_in_range', 0, 4) -> " + evs);
        } catch (e) {
            _line("env.call('events_in_range') raised: " + e.message);
        }
    } else {
        _line("skipping env.call probes — no envelope handle");
    }

    // 5) Sanity baseline: insert_step (known-good through clip)
    try {
        clip.call("clear_envelope", paramId);
        clip.call("insert_step", paramId, 0.0, 1.0, parseFloat(("" + clip.get("length"))) > 0 ? 0.5 : 0);
        _line("baseline insert_step OK");
    } catch (e) {
        _line("baseline insert_step FAIL: " + e.message);
    }

    _line("──── done ────");
}
