/**
 * test-scanner-freeze-guard.js
 *
 * Proves the scanner can't flood Ableton ("no valid object set" → freeze) when a
 * rack OVER-REPORTS its child counts (the documented Mac freeze class, and the
 * customer's "freezes when I rescan the automated params" report).
 *
 * Approach: load the REAL scanner_max.js into a Node vm with a mocked LiveAPI
 * backed by a simulated Live tree where some reported indices (devices 1,
 * parameters 2, chains 1) DON'T resolve. The mock counts every .get()/.call()/
 * .info on an unresolved object as a "flood" — exactly the call that spams the
 * Max window and freezes Live. With the id-guards in place the scanner must hit
 * those bad indices (unresolvedConstructed > 0) yet never read them (flood == 0).
 *
 * This executes the shipping scanner code, so removing any guard fails the test.
 */
'use strict';
const vm = require('vm');
const fs = require('fs');
const path = require('path');

let passed = 0, failed = 0;
function ok(name, cond, extra) {
    if (cond) { passed++; }
    else { failed++; console.log('  ✗ ' + name + (extra ? '  — ' + extra : '')); }
}

// ── Instrumentation (closed over by the mock) ──
let floodCount = 0;            // .get()/.call()/.info on an UNRESOLVED object = the freeze flood
let floodDetail = [];
let unresolvedConstructed = 0; // new LiveAPI() on a path that doesn't resolve

// Which props return a LOM id-list ["id",n,"id",n,...] — code reads .length/2.
const LIST_PROPS = { parameters: 1, chains: 1, devices: 1, clip_slots: 1, sends: 1 };
function lomList(n) { const a = []; for (let i = 0; i < (n || 0); i++) a.push('id', i + 1); return a; }

// An OVER-REPORTING rack: parent counts claim more children than resolve.
//   track.devices = 2  but devices 1 is MISSING
//   rack.parameters = 3 but parameters 2 is MISSING
//   rack.chains = 2     but chains 1 is MISSING
function makeTree() {
    return {
        'live_app': { id: 'app1', props: {} },   // always resolves in real Live
        'live_set view selected_track': { id: 't1', unquotedpath: 'live_set tracks 0',
            props: { name: 'Audio', devices: 2, clip_slots: 1 } },
        'live_set tracks 0 devices 0': { id: 'd1',
            props: { name: 'MegaRack', class_name: 'AudioEffectGroupDevice', class_display_name: 'Audio Effect Rack',
                     parameters: 3, chains: 2, is_active: 1 } },
        'live_set tracks 0 devices 0 parameters 0': { id: 'p1',
            props: { name: 'Macro 1', min: 0, max: 127, value: 64, automation_state: 1 } },
        'live_set tracks 0 devices 0 parameters 1': { id: 'p2',
            props: { name: 'Macro 2', min: 0, max: 127, value: 0, automation_state: 0 } },
        // parameters 2 → MISSING (over-reported)
        'live_set tracks 0 devices 0 chains 0': { id: 'c1', props: { name: 'Chain A', devices: 1 } },
        // chains 1 → MISSING (over-reported)
        'live_set tracks 0 devices 0 chains 0 mixer_device': { id: 'm1', props: { sends: 0 } },
        'live_set tracks 0 devices 0 chains 0 mixer_device volume': { id: 'mv',
            props: { name: 'Volume', min: 0, max: 1, value: 0.8, automation_state: 1 } },
        'live_set tracks 0 devices 0 chains 0 mixer_device panning': { id: 'mp',
            props: { name: 'Pan', min: -1, max: 1, value: 0, automation_state: 0 } },
        'live_set tracks 0 devices 0 chains 0 devices 0': { id: 'sd1',
            props: { name: 'Reverb', class_name: 'Reverb', parameters: 1, is_active: 1 } },
        'live_set tracks 0 devices 0 chains 0 devices 0 parameters 0': { id: 'sp1',
            props: { name: 'Dry/Wet', min: 0, max: 1, value: 0.3, automation_state: 1 } },
        // devices 1 → MISSING (over-reported)
        'live_set view selected_track clip_slots 0': { id: 'cs1', props: { has_clip: 1 } },
        'live_set view selected_track clip_slots 0 clip': { id: 'clip1', props: { length: 16 } },
        'live_set view detail_clip': { id: 'clip1d', props: { length: 16 } }
    };
}

function makeContext(tree) {
    function LiveAPI(p) {
        this._path = String(p);
        const node = tree[this._path];
        if (node) { this._id = node.id; this._node = node; this._unquoted = node.unquotedpath || this._path; }
        else { this._id = '0'; this._node = null; this._unquoted = this._path; unresolvedConstructed++; }
    }
    Object.defineProperty(LiveAPI.prototype, 'id', { get() { return this._id; } });
    Object.defineProperty(LiveAPI.prototype, 'unquotedpath', { get() { return this._unquoted; } });
    Object.defineProperty(LiveAPI.prototype, 'info', { get() {
        if (!this._node) { floodCount++; floodDetail.push(this._path + ' .info'); return ''; }
        return 'info';
    } });
    LiveAPI.prototype.get = function (prop) {
        if (!this._node) { floodCount++; floodDetail.push(this._path + ' .get(' + prop + ')'); return undefined; }
        const v = this._node.props[prop];
        if (LIST_PROPS[prop]) return lomList(v);
        return v;
    };
    LiveAPI.prototype.call = function (method) {
        if (!this._node) { floodCount++; floodDetail.push(this._path + ' .call(' + method + ')'); return null; }
        if (method === 'str_for_value') return '0.00 dB';   // no Hz → not log-scaled
        if (method === 'automation_envelope') return null;  // no clip envelope in this fixture
        return null;
    };

    const outlets_captured = [];
    const ctx = {
        LiveAPI: LiveAPI,
        post: function () {},
        outlet: function () { outlets_captured.push(Array.prototype.slice.call(arguments)); },
        File: function () { this.isopen = false; },
        Task: function () { this.schedule = function () {}; this.cancel = function () {}; this.repeat = function () {}; }
    };
    vm.createContext(ctx);
    ctx._outlets = outlets_captured;
    return ctx;
}

function loadScanner(ctx) {
    const src = fs.readFileSync(path.join(__dirname, '..', 'm4l', 'node', 'scanner_max.js'), 'utf8');
    vm.runInContext(src, ctx, { filename: 'scanner_max.js' });
}
function lastOutlet(ctx, selector) {
    for (let i = ctx._outlets.length - 1; i >= 0; i--) { if (ctx._outlets[i][1] === selector) return ctx._outlets[i]; }
    return null;
}
function reset() { floodCount = 0; floodDetail = []; unresolvedConstructed = 0; }

console.log('test-scanner-freeze-guard.js');

// ── Sanity: the mock MUST detect a flood, else every zero-flood assert is vacuous ──
(function () {
    reset();
    const ctx = makeContext(makeTree());
    loadScanner(ctx);
    const bad = new ctx.LiveAPI('live_set tracks 0 devices 99');   // unresolved
    ok('mock: unresolved object reports id "0"', bad.id === '0', 'id=' + bad.id);
    bad.get('name');                                                // an UNGUARDED read would do this
    ok('mock: reading an unresolved object floods', floodCount === 1, 'floodCount=' + floodCount);
})();

// ── scan_rack (the "scan all" path) ──
(function () {
    reset();
    const ctx = makeContext(makeTree());
    loadScanner(ctx);
    ctx.scan_rack();
    ok('scan_rack: ZERO flood on over-reporting rack', floodCount === 0, floodDetail.join(' | '));
    ok('scan_rack: actually hit the over-reported indices', unresolvedConstructed >= 3, 'unresolved=' + unresolvedConstructed);
    const o = lastOutlet(ctx, 'rack_params');
    ok('scan_rack: emitted rack_params', !!o);
    const res = o ? JSON.parse(o[2]) : {};
    ok('scan_rack: collected all 5 real params', (res.parameters || []).length === 5, 'got ' + (res.parameters || []).length);
    ok('scan_rack: device_name = MegaRack only (skipped bad device)', res.device_name === 'MegaRack', String(res.device_name));
})();

// ── scan_mapped (the customer's rescan/sync path, automation_state filter) ──
(function () {
    reset();
    const ctx = makeContext(makeTree());
    loadScanner(ctx);
    ctx.scan_mapped();
    ok('scan_mapped: ZERO flood (the reported freeze path)', floodCount === 0, floodDetail.join(' | '));
    ok('scan_mapped: hit over-reported indices', unresolvedConstructed >= 3, 'unresolved=' + unresolvedConstructed);
    const o = lastOutlet(ctx, 'rack_params');
    const res = o ? JSON.parse(o[2]) : {};
    // automated only: Macro 1, Volume, Dry/Wet = 3
    ok('scan_mapped: 3 automated params (filtered)', (res.parameters || []).length === 3, 'got ' + (res.parameters || []).length);
})();

// ── scan_all_devices (Gate device tree — newly guarded) ──
(function () {
    reset();
    const ctx = makeContext(makeTree());
    loadScanner(ctx);
    ctx.scan_all_devices();
    ok('scan_all_devices: ZERO flood', floodCount === 0, floodDetail.join(' | '));
    // walks devices+chains only (not params): hits chains 1 + devices 1 = 2 bad indices
    ok('scan_all_devices: hit over-reported indices', unresolvedConstructed >= 2, 'unresolved=' + unresolvedConstructed);
    const o = lastOutlet(ctx, 'all_devices');
    const res = o ? JSON.parse(o[2]) : {};
    ok('scan_all_devices: 2 devices (rack + sub-device)', (res.devices || []).length === 2, 'got ' + (res.devices || []).length);
})();

// ── read_clip_curves (Read mode — newly guarded) ──
(function () {
    reset();
    const ctx = makeContext(makeTree());
    loadScanner(ctx);
    ctx.read_clip_curves('A');
    ok('read_clip_curves: ZERO flood', floodCount === 0, floodDetail.join(' | '));
    ok('read_clip_curves: hit over-reported indices', unresolvedConstructed >= 2, 'unresolved=' + unresolvedConstructed);
})();

// ── scan_read_envelopes (read probe — newly guarded) ──
(function () {
    reset();
    const ctx = makeContext(makeTree());
    loadScanner(ctx);
    ctx.scan_read_envelopes();
    ok('scan_read_envelopes: ZERO flood', floodCount === 0, floodDetail.join(' | '));
})();

console.log('  ' + passed + ' passed, ' + failed + ' failed');
if (failed > 0) process.exit(1);
