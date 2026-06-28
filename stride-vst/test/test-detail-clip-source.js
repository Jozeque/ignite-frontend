/**
 * test-detail-clip-source.js
 *
 * Proves the "detail_clip is the source of truth" behavior in the REAL
 * scanner_max.js: the resolved target clip (and therefore clip_bars + clip_slot
 * that drive the canvas) comes from the clip open in Live's detail view, falls
 * back to the LAST clip that was in detail view, then to the first slot — and
 * the detail_clip observer emits the right per-clip identity.
 *
 * Runs the shipping scanner in a Node vm with a mocked LiveAPI, like
 * test-scanner-freeze-guard.js.
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

const LIST_PROPS = { parameters: 1, chains: 1, devices: 1, clip_slots: 1, sends: 1 };
function lomList(n) { const a = []; for (let i = 0; i < (n || 0); i++) a.push('id', i + 1); return a; }

// Track with one device (Operator, 1 automated param) and three slots:
//   slot 0 → clip "A", length 16 beats (4 bars)
//   slot 1 → empty
//   slot 2 → clip "C", length 64 beats (16 bars)
// detailSlot (if set) puts that slot's clip into Live's detail view.
function makeTree(detailSlot) {
    const tree = {
        'live_set view': { id: 'view1', props: {} },
        'live_set view selected_track': { id: 't1', unquotedpath: 'live_set tracks 0',
            props: { name: 'Lead', devices: 1, clip_slots: 3 } },
        'live_set tracks 0 devices 0': { id: 'd1',
            props: { name: 'Operator', class_name: 'Operator', parameters: 1, is_active: 1 } },
        'live_set tracks 0 devices 0 parameters 0': { id: 'p1',
            props: { name: 'Volume', min: 0, max: 1, value: 0.5, automation_state: 1 } },
        'live_set view selected_track clip_slots 0': { id: 'cs0', props: { has_clip: 1 } },
        'live_set view selected_track clip_slots 0 clip': { id: 'clipA',
            unquotedpath: 'live_set tracks 0 clip_slots 0 clip', props: { length: 16 } },
        'live_set view selected_track clip_slots 1': { id: 'cs1', props: { has_clip: 0 } },
        'live_set view selected_track clip_slots 2': { id: 'cs2', props: { has_clip: 1 } },
        'live_set view selected_track clip_slots 2 clip': { id: 'clipC',
            unquotedpath: 'live_set tracks 0 clip_slots 2 clip', props: { length: 64 } }
    };
    if (detailSlot != null) {
        const src = tree['live_set view selected_track clip_slots ' + detailSlot + ' clip'];
        tree['live_set view detail_clip'] = { id: src.id, unquotedpath: src.unquotedpath, props: src.props };
    }
    return tree;
}

function makeContext(tree) {
    const idIndex = {};
    Object.keys(tree).forEach(k => { const n = tree[k]; if (n && n.id && !idIndex[n.id]) idIndex[n.id] = n; });

    function LiveAPI(a, b) {
        const p = (typeof a === 'function') ? b : a;     // observer form: new LiveAPI(cb, path)
        this._path = String(p);
        let node = tree[this._path];
        if (!node && this._path.indexOf('id ') === 0) node = idIndex[this._path.slice(3)];
        if (node) { this._id = node.id; this._node = node; this._unquoted = node.unquotedpath || this._path; }
        else { this._id = '0'; this._node = null; this._unquoted = this._path; }
    }
    Object.defineProperty(LiveAPI.prototype, 'id', { get() { return this._id; } });
    Object.defineProperty(LiveAPI.prototype, 'unquotedpath', { get() { return this._unquoted; } });
    Object.defineProperty(LiveAPI.prototype, 'info', { get() { return this._node ? 'info' : ''; } });
    LiveAPI.prototype.get = function (prop) {
        if (!this._node) return undefined;
        const v = this._node.props[prop];
        if (LIST_PROPS[prop]) return lomList(v);
        return v;
    };
    LiveAPI.prototype.call = function (method) {
        if (!this._node) return null;
        if (method === 'str_for_value') return '0.50';
        if (method === 'automation_envelope') return null;
        return null;
    };
    Object.defineProperty(LiveAPI.prototype, 'property', { set() {}, get() { return ''; } });

    const outlets_captured = [];
    const ctx = {
        LiveAPI: LiveAPI,
        post: function () {},
        outlet: function () { outlets_captured.push(Array.prototype.slice.call(arguments)); },
        File: function () { this.isopen = false; },
        Task: function () { this.schedule = function () {}; this.cancel = function () {}; }
    };
    vm.createContext(ctx);
    ctx._outlets = outlets_captured;
    ctx._tree = tree;
    return ctx;
}

function loadScanner(ctx) {
    const src = fs.readFileSync(path.join(__dirname, '..', 'm4l', 'node', 'scanner_max.js'), 'utf8');
    vm.runInContext(src, ctx, { filename: 'scanner_max.js' });
}
function lastOutlet(ctx, selector) {
    for (let i = ctx._outlets.length - 1; i >= 0; i--) if (ctx._outlets[i][1] === selector) return ctx._outlets[i];
    return null;
}

console.log('test-detail-clip-source.js');

// ── _clipSlotFromPath ──
(function () {
    const ctx = makeContext(makeTree(2)); loadScanner(ctx);
    const a = ctx._clipSlotFromPath('live_set tracks 3 clip_slots 5 clip');
    ok('parse path → track 3, slot 5', a.track === 3 && a.slot === 5, JSON.stringify(a));
    const b = ctx._clipSlotFromPath('live_set view detail_clip');
    ok('non-slot path → slot -1', b.slot === -1, JSON.stringify(b));
})();

// ── resolver: detail_clip wins, with its real slot ──
(function () {
    const ctx = makeContext(makeTree(2)); loadScanner(ctx);
    const r = ctx._resolveTargetClip();
    ok('detail_clip resolved', !!r && r.source === 'detail_clip', r && r.source);
    ok('detail_clip slot = 2', !!r && r.slot === 2, r && String(r.slot));
})();

// ── bars come from the DETAIL clip (16 bars), not the first slot (4 bars) ──
(function () {
    const ctx = makeContext(makeTree(2)); loadScanner(ctx);
    const info = ctx._getClipInfo();
    ok('detail slot 2 → clip_bars 16', info.clip_bars === 16, 'bars=' + info.clip_bars);
    ok('detail slot 2 → clip_slot 2', info.clip_slot === 2, 'slot=' + info.clip_slot);
    ok('source = detail_clip', info.clip_source === 'detail_clip', info.clip_source);
})();
(function () {
    const ctx = makeContext(makeTree(0)); loadScanner(ctx);
    const info = ctx._getClipInfo();
    ok('detail slot 0 → clip_bars 4', info.clip_bars === 4, 'bars=' + info.clip_bars);
    ok('detail slot 0 → clip_slot 0', info.clip_slot === 0, 'slot=' + info.clip_slot);
})();

// ── scan_mapped carries the detail clip's slot to the canvas ──
(function () {
    const ctx = makeContext(makeTree(2)); loadScanner(ctx);
    ctx.scan_mapped();
    const o = lastOutlet(ctx, 'rack_params');
    const res = o ? JSON.parse(o[2]) : {};
    ok('scan_mapped clip_slot = 2 (detail clip)', res.clip_slot === 2, 'slot=' + res.clip_slot);
    ok('scan_mapped clip_bars = 16', res.clip_bars === 16, 'bars=' + res.clip_bars);
})();

// ── detail-clip observer emits track_index (drives the canvas same-track fast path) ──
(function () {
    const ctx = makeContext(makeTree(2)); loadScanner(ctx);
    ctx._onDetailClipChange();
    const o = lastOutlet(ctx, 'clip_focus');
    const info = o ? JSON.parse(o[2]) : {};
    ok('clip_focus emits track_index 0 (session clip on track 0)', info.track_index === 0, 'track_index=' + info.track_index);
    ok('clip_focus still carries slot 2 + bars 16', info.clip_slot === 2 && info.clip_bars === 16, JSON.stringify(info));
})();

// ── canvas + server wiring for the same-track fast path (static guards) ──
(function () {
    const canvasSrc = fs.readFileSync(path.join(__dirname, '..', 'app', 'renderer', 'canvas.js'), 'utf8');
    const serverSrc = fs.readFileSync(path.join(__dirname, '..', 'm4l', 'node', 'server.js'), 'utf8');
    ok('canvas: clip_focus same-track skips the scan (fast re-key)', /ti >= 0 && ti === currentTrackIndex/.test(canvasSrc) && /function _sdReKeyClipNoScan/.test(canvasSrc));
    ok('canvas: fast re-key blanks lanes before restore (per-clip variation)', /function _sdReKeyClipNoScan[\s\S]{0,1400}p\.points = \[\]; p\.locked = false; p\.selected = false/.test(canvasSrc));
    ok('canvas: fast re-key restores the clip without a param walk', /function _sdReKeyClipNoScan[\s\S]{0,1600}restoreCanvasState\(\)/.test(canvasSrc));
    ok('server: clip_focus_changed forwards track_index', /clip_focus_changed[\s\S]{0,320}track_index:/.test(serverSrc));
    // A late AUTO-read must not clobber a lane the user just drew (the duplicate-clip
    // "new curves flash then revert to the copy's automation" bug).
    ok('canvas: auto-read fills empty lanes only (no clobber)', /_fillOnly && lane\.points && lane\.points\.length\) return/.test(canvasSrc));
    ok('canvas: auto-read sets fill-only; manual Pull overwrites', /_sdReadFillOnly = true;[\s\S]{0,140}readClipCurves\('A'\)/.test(canvasSrc) && /_sdReadFillOnly = false;[\s\S]{0,140}readClipCurves\('A'\)/.test(canvasSrc));
    // A rescan-merge's async restore must not land ON TOP of a generator you just
    // pressed (duplicate-clip "flash then instantly revert"): pushUndo bumps an epoch,
    // restoreCanvasState bails if it changed during the async disk load.
    ok('canvas: pushUndo bumps the curve epoch', /function pushUndo\(\)[\s\S]{0,160}_sdCurveEpoch\+\+/.test(canvasSrc));
    ok('canvas: restore protects fresh curves but ALWAYS restores locks', /const _epoch = _sdCurveEpoch/.test(canvasSrc) && /const _stale = \(_epoch !== _sdCurveEpoch\)/.test(canvasSrc) && /if \(sp\.locked\) \{[\s\S]{0,90}param\.locked = true/.test(canvasSrc) && /!\(_stale && param\.points && param\.points\.length\)/.test(canvasSrc));
})();

// ── fallback: last clip that was in detail view ──
(function () {
    const ctx = makeContext(makeTree(2)); loadScanner(ctx);
    const r1 = ctx._resolveTargetClip();                      // caches detail clip (clipC, slot 2)
    ok('first resolve = detail_clip', r1.source === 'detail_clip');
    delete ctx._tree['live_set view detail_clip'];            // user clicked away from the clip view
    const r2 = ctx._resolveTargetClip();
    ok('fallback uses LAST detail clip', r2 && r2.source === 'last_detail', r2 && r2.source);
    ok('last_detail keeps slot 2', r2 && r2.slot === 2, r2 && String(r2.slot));
})();

// ── fallback: first slot when no detail clip + no cache ──
(function () {
    const ctx = makeContext(makeTree(null)); loadScanner(ctx);
    const r = ctx._resolveTargetClip();
    ok('no detail, no cache → first slot', r && r.source === 'first_slot', r && r.source);
    ok('first slot = slot 0', r && r.slot === 0, r && String(r.slot));
    const info = ctx._getClipInfo();
    ok('first-slot bars = 4', info.clip_bars === 4, 'bars=' + info.clip_bars);
})();

// ── observer emits per-clip identity, and de-dupes repeats ──
(function () {
    const ctx = makeContext(makeTree(2)); loadScanner(ctx);
    ctx._onDetailClipChange(['detail_clip', 'id', 'clipC']);
    const o = lastOutlet(ctx, 'clip_focus');
    ok('observer emitted clip_focus', !!o);
    const f = o ? JSON.parse(o[2]) : {};
    ok('clip_focus slot = 2', f.clip_slot === 2, 'slot=' + f.clip_slot);
    ok('clip_focus bars = 16', f.clip_bars === 16, 'bars=' + f.clip_bars);
    const before = ctx._outlets.length;
    ctx._onDetailClipChange(['detail_clip', 'id', 'clipC']);   // same clip → de-duped
    ok('observer de-dupes same clip', ctx._outlets.length === before, 'emitted again');
})();

console.log('  ' + passed + ' passed, ' + failed + ' failed');
if (failed > 0) process.exit(1);
