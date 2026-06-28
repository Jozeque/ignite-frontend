/**
 * quickpanel-core.js — PURE logic for the Stride QuickPanel (no DOM, no Electron).
 *
 * Loadable both in the browser (attaches window.QuickPanelCore) and in Node
 * (module.exports) so test/test-quickpanel.js can exercise it directly.
 *
 * Kept deliberately small and side-effect-free: data normalization, the
 * multi/focus view state machine, lane colors, label hit-zones, and the
 * adjustment-slider math. The DOM/canvas renderer (quickpanel.js) consumes
 * these. NOTHING here imports canvas.js, ws-client.js, or talks to the bridge.
 */
(function (root, factory) {
    if (typeof module !== 'undefined' && module.exports) module.exports = factory();
    else root.QuickPanelCore = factory();
})(typeof self !== 'undefined' ? self : this, function () {
    'use strict';

    // Patch-skin cable colors — 1:1 with SD_SKIN_COLORS.patch.patch in canvas.js.
    // Each lane gets its own stable color by index.
    var PATCH_CABLES = ['198,113,43', '47,116,142', '91,123,85', '163,78,82', '84,75,109'];
    function laneRGB(i) { return PATCH_CABLES[((i % PATCH_CABLES.length) + PATCH_CABLES.length) % PATCH_CABLES.length]; }

    function clamp01(v) { v = +v; if (!isFinite(v)) return 0; return v < 0 ? 0 : v > 1 ? 1 : v; }

    // Geometry — mirrors canvas.js multi-view constants exactly.
    var LANE_H = 64;        // SD_MULTI_LANE_HEIGHT
    var LABEL_W = 120;      // SD_MULTI_LABEL_WIDTH
    var LOCK_HIT_W = 22;    // SD_MULTI_LOCK_HIT_W

    // Normalize a saved canvas_*.json into a flat lane list the panel renders.
    // Tolerant of shape drift (params | canvasParams | lanes). Returns
    //   { params: [{ id, name, points:[{time,value,curve}], locked, selected, min, max }], bars }
    function normalizeState(raw) {
        if (!raw || typeof raw !== 'object') return { params: [], bars: 4 };
        var src = Array.isArray(raw.params) ? raw.params
            : Array.isArray(raw.canvasParams) ? raw.canvasParams
            : Array.isArray(raw.lanes) ? raw.lanes : [];
        var params = src.map(function (p, i) {
            return {
                id: p.envelopeId || p.id || ('lane' + i),
                _path: p._path || null,            // stable LOM key — commands target this
                name: p.name || p.paramName || ('Param ' + (i + 1)),
                points: Array.isArray(p.points) ? p.points.map(function (pt) {
                    return { time: +pt.time || 0, value: clamp01(pt.value), curve: +pt.curve || 0 };
                }) : [],
                locked: !!p.locked,
                selected: !!p.selected,
                min: (typeof p.min === 'number') ? p.min : 0,
                max: (typeof p.max === 'number') ? p.max : 1
            };
        });
        var bars = +(raw.bars || raw.clipBars || raw.clip_bars || 4) || 4;
        return { params: params, bars: bars };
    }

    // View state machine: 'multi' = all lanes (Mockup A); 'focus' = one lane (Mockup B).
    function makeView() { return { mode: 'multi', focusId: null }; }
    function focusLane(view, id) { return { mode: 'focus', focusId: id }; }
    function backToMulti() { return { mode: 'multi', focusId: null }; }

    // Which interactive zone an x (in the 0..LABEL_W label column) hits.
    // Layout, right-to-left at the column's right edge: [ lock ][ focus ] then name.
    // lock glyph ~x=102 (LABEL_W-18), focus glyph just left of it.
    function labelZone(x) {
        if (x >= 96 && x <= 118) return 'lock';   // padlock toggle
        if (x >= 72 && x < 96) return 'focus';     // → single-lane view of this param
        return 'select';                           // name area: activate / select
    }

    // Row index for a y within the lane stack (no scroll offset → pass 0).
    function rowAtY(y, scrollOffset) { return Math.floor(y / LANE_H) + (scrollOffset || 0); }

    // Adjustment sliders — 1:1 names with the canvas sidebar: Smooth / Depth /
    // Curve / Floor / Ceiling. Operates on a point list, preserving time + curve.
    // fx defaults: { smooth:0, depth:100, curve:0, floor:0, ceil:100 }.
    function applyAdjust(points, fx) {
        if (!points || !points.length) return points || [];
        fx = fx || {};
        var vals = points.map(function (p) { return p.value; });
        var k = Math.round((fx.smooth || 0) / 100 * 6);
        if (k > 0) {
            var t = vals.slice();
            for (var i = 0; i < vals.length; i++) {
                var s = 0, c = 0;
                for (var j = -k; j <= k; j++) { var q = i + j; if (q >= 0 && q < t.length) { s += t[q]; c++; } }
                vals[i] = s / c;
            }
        }
        var d = (fx.depth == null ? 100 : fx.depth) / 100;
        vals = vals.map(function (v) { return 0.5 + (v - 0.5) * d; });
        if (fx.curve > 0) {
            var g = 1 + fx.curve / 100 * 1.6;
            vals = vals.map(function (v) {
                return v < 0.5 ? 0.5 * Math.pow(v / 0.5, g) : 1 - 0.5 * Math.pow((1 - v) / 0.5, g);
            });
        }
        var lo = (fx.floor || 0) / 100, hi = (fx.ceil == null ? 100 : fx.ceil) / 100;
        vals = vals.map(function (v) { return lo + v * (hi - lo); });
        return points.map(function (p, i) { return { time: p.time, value: clamp01(vals[i]), curve: p.curve }; });
    }

    function defaultFx() { return { smooth: 0, depth: 100, curve: 0, floor: 0, ceil: 100 }; }

    return {
        PATCH_CABLES: PATCH_CABLES, laneRGB: laneRGB, clamp01: clamp01,
        LANE_H: LANE_H, LABEL_W: LABEL_W, LOCK_HIT_W: LOCK_HIT_W,
        normalizeState: normalizeState,
        makeView: makeView, focusLane: focusLane, backToMulti: backToMulti,
        labelZone: labelZone, rowAtY: rowAtY,
        applyAdjust: applyAdjust, defaultFx: defaultFx
    };
});
