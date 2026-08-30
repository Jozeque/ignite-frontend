/**
 * quickpanel.js — Stride QuickPanel renderer (DOM + canvas).
 *
 * Mockup A (Lane Stack) as the default multi-lane view, drawn 1:1 with
 * canvas.js's sdDrawMultiView (64px lanes, 120px label column, canvas-painted
 * lock glyphs). A per-lane FOCUS glyph sits next to the lock; clicking it
 * switches to a single-lane (Mockup B) view of that param. Back returns to A.
 *
 * READ-ONLY companion: it loads the latest saved canvas_*.json (via the
 * isolated quickpanel-preload bridge) and re-reads when that file changes.
 * It does NOT connect to the M4L bridge or mutate canvas state — so it can't
 * affect the main canvas, app logic, or StrideQuick. (Slider moves preview the
 * adjustment on screen; committing edits back to the canvas is the next step.)
 */
(function () {
    'use strict';
    var Core = window.QuickPanelCore;

    // ── state ──
    var params = [];
    var bars = 4;
    var activeId = null;
    var selected = {};                 // id -> true (the "select few" set)
    var view = Core.makeView();        // { mode:'multi'|'focus', focusId }
    var fx = Core.defaultFx();
    var scrollOffset = 0;
    var usingSample = false;
    var gotLive = false;        // a live canvas push has arrived → file/sample no longer used
    var tool = 'point';         // panel draw mode: 'point' | 'freehand'
    var drawState = null;       // in-progress draw (suppresses live clobber mid-edit)
    var deviceName = null;      // rack/device name shown on each lane

    var LANE_H = Core.LANE_H, LABEL_W = Core.LABEL_W;

    // ── DOM ──
    var cv = document.getElementById('qp-canvas');
    var ctx = cv.getContext('2d');
    var wrap = document.getElementById('qp-canvas-wrap');
    var emptyEl = document.getElementById('qp-empty');
    var backBtn = document.getElementById('qp-back');
    var focusTitle = document.getElementById('qp-focus-title');
    var selectAllBtn = document.getElementById('qp-select-all');
    var lockAllBtn = document.getElementById('qp-lock-all');
    var unlockAllBtn = document.getElementById('qp-unlock-all');
    var statusMode = document.getElementById('qp-status-mode');
    var statusCount = document.getElementById('qp-status-count');
    var adjustLabel = document.getElementById('qp-adjust-label');

    function rgb(c) { return 'rgb(' + c + ')'; }
    function rgba(c, a) { return 'rgba(' + c + ',' + a + ')'; }

    // ── sample data (shown until a real rack is scanned, or when opened standalone) ──
    function lcg(seed) { var s = seed >>> 0; return function () { s = (s * 1664525 + 1013904223) >>> 0; return s / 4294967296; }; }
    function sample(type, totalBeats) {
        var n = 49, pts = [], r = lcg({ sine: 7, ramp: 11, pump: 23, exp: 31, sh: 53, glitch: 71, sineslow: 97, groove: 131 }[type] || 5);
        var hold = 0.5, seg = -1;
        for (var i = 0; i < n; i++) {
            var t = i / (n - 1), v = 0.5;
            if (type === 'sine') v = 0.5 + 0.42 * Math.sin(t * Math.PI * 4);
            else if (type === 'sineslow') v = 0.5 + 0.36 * Math.sin(t * Math.PI * 2 + 0.7);
            else if (type === 'ramp') v = 0.12 + 0.80 * Math.pow(t, 0.85);
            else if (type === 'pump') { var p = (t * 4) % 1; v = 0.14 + 0.80 * Math.pow(p, 0.5); }
            else if (type === 'exp') v = 0.10 + 0.86 * Math.pow(t, 2.1);
            else if (type === 'sh') { var s2 = Math.floor(t * 16); if (s2 !== seg) { seg = s2; hold = 0.18 + 0.64 * r(); } v = hold; }
            else if (type === 'glitch') { v = 0.30 + 0.06 * (r() - 0.5); if (r() > 0.86) v = 0.9; if (r() > 0.92) v = 0.08; }
            else if (type === 'groove') { var env = 0.5 + 0.3 * Math.sin(t * Math.PI * 2); v = env * (0.5 + 0.5 * Math.sin(t * Math.PI * 16)) * 0.6 + 0.2; }
            pts.push({ time: t * totalBeats, value: Math.max(0, Math.min(1, v)), curve: 0 });
        }
        return pts;
    }
    function sampleLanes() {
        var tb = 16, defs = [
            ['Filter Cutoff', 'sine'], ['Resonance', 'ramp'], ['Drive', 'pump'], ['Reverb Wet', 'exp'],
            ['Delay Feedback', 'sh'], ['Osc Morph', 'glitch'], ['Pan', 'sineslow'], ['Volume', 'groove']
        ];
        return defs.map(function (d, i) {
            return { id: 'sample' + i, name: d[0], points: sample(d[1], tb), locked: i === 4, selected: i === 0 || i === 2 || i === 3, min: 0, max: 1 };
        });
    }

    // ── data: the live canvas push is authoritative (shows the SAME rack 1:1);
    //         the saved-file snapshot is only a fallback before the first push. ──
    function applyState(raw, fromLive) {
        if (drawState) return;      // don't clobber an in-progress draw with a live push
        if (fromLive) gotLive = true;
        deviceName = (raw && typeof raw.deviceName !== 'undefined') ? raw.deviceName : deviceName;
        var norm = Core.normalizeState(raw);
        if (norm.params.length) {
            params = norm.params; bars = norm.bars; usingSample = false;
        } else if (fromLive && raw && Array.isArray(raw.params)) {
            params = []; bars = norm.bars; usingSample = false;   // live empty rack → "No lanes yet", not sample
        } else {
            params = sampleLanes(); bars = 4; usingSample = true; deviceName = 'Sample Rack';
        }
        // seed selection from the data; honor the canvas's active lane if given
        selected = {};
        params.forEach(function (p) { if (p.selected) selected[p.id] = true; });
        if (raw && raw.activeId && params.some(function (p) { return p.id === raw.activeId; })) activeId = raw.activeId;
        if (!params.some(function (p) { return p.id === activeId; })) activeId = params.length ? params[0].id : null;
        if (view.mode === 'focus' && !params.some(function (p) { return p.id === view.focusId; })) view = Core.backToMulti();
        fit();
    }
    async function load() {
        if (gotLive) return;   // never clobber live canvas data with the file snapshot
        var state = null;
        try {
            if (window.strideQuick && window.strideQuick.loadLatestCanvas) {
                var r = await window.strideQuick.loadLatestCanvas();
                if (r && r.success) state = r.state;
            }
        } catch (e) { /* fall back to sample */ }
        applyState(state, false);
    }

    // ── targets for the adjustment sliders: the selected set, else the active lane ──
    function targetIds() {
        var ids = Object.keys(selected).filter(function (id) { return selected[id]; });
        if (ids.length) return ids;
        return activeId ? [activeId] : [];
    }
    function displayPoints(p, isTarget) { return isTarget ? Core.applyAdjust(p.points, fx) : p.points; }
    // send an edit command back to the canvas (it executes + re-pushes the result)
    function cmd(obj) { try { if (window.strideQuick && window.strideQuick.sendCommand) window.strideQuick.sendCommand(obj); } catch (e) {} }

    // ── sizing ── (only re-allocate the bitmap when the size actually changes;
    //              live pushes call this ~15Hz and shouldn't reset the canvas)
    var _lastW = 0, _lastH = 0;
    function fit() {
        var w = wrap.clientWidth, h = wrap.clientHeight;
        if (w !== _lastW || h !== _lastH) {
            _lastW = w; _lastH = h;
            var dpr = window.devicePixelRatio || 1;
            cv.width = Math.round(w * dpr); cv.height = Math.round(h * dpr);
            cv.style.width = w + 'px'; cv.style.height = h + 'px';
            ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
        }
        draw();
    }

    // ── glyphs ──
    function drawLock(c, x, y, s, color, locked) {
        c.save(); c.strokeStyle = color; c.fillStyle = color; c.lineWidth = 1.5;
        var bw = s, bh = s * 0.7, bx = x, by = y + s * 0.42;
        c.strokeRect(bx, by, bw, bh);
        if (locked) { c.globalAlpha = 0.25; c.fillRect(bx, by, bw, bh); c.globalAlpha = 1; }
        c.beginPath();
        var sw = s * 0.62, sx = x + (bw - sw) / 2, top = by;
        c.moveTo(sx, top); c.lineTo(sx, top - s * 0.34);
        c.arc(x + bw / 2, top - s * 0.34, sw / 2, Math.PI, 0); c.lineTo(sx + sw, top);
        c.stroke(); c.restore();
    }
    // focus = "expand this lane" — a rounded rect with corner ticks
    function drawFocus(c, x, y, s, color) {
        c.save(); c.strokeStyle = color; c.lineWidth = 1.5; c.lineCap = 'round';
        var r = s * 0.5, cx = x + s / 2, cy = y + s * 0.55, g = s * 0.30;
        // four corner brackets
        c.beginPath();
        c.moveTo(cx - r, cy - r + g); c.lineTo(cx - r, cy - r); c.lineTo(cx - r + g, cy - r);
        c.moveTo(cx + r - g, cy - r); c.lineTo(cx + r, cy - r); c.lineTo(cx + r, cy - r + g);
        c.moveTo(cx + r, cy + r - g); c.lineTo(cx + r, cy + r); c.lineTo(cx + r - g, cy + r);
        c.moveTo(cx - r + g, cy + r); c.lineTo(cx - r, cy + r); c.lineTo(cx - r, cy + r - g);
        c.stroke(); c.restore();
    }

    // ── draw dispatch ──
    function draw() {
        var w = wrap.clientWidth, h = wrap.clientHeight;
        ctx.clearRect(0, 0, w, h);
        var hasLanes = params.length > 0;
        emptyEl.classList.toggle('hidden', hasLanes);
        if (!hasLanes) { updateChrome(); return; }
        if (view.mode === 'focus') drawFocusView(w, h); else drawMulti(w, h);
        updateChrome();
    }

    // ── Mockup A — multi-lane stack (1:1 with sdDrawMultiView) ──
    function drawMulti(lw, lh) {
        var totalBeats = bars * 4;
        var hasScroll = false;
        var visible = Math.max(1, Math.floor(lh / LANE_H));
        if (params.length > visible) hasScroll = true;
        scrollOffset = Math.max(0, Math.min(scrollOffset, params.length - visible));
        var laneDrawLeft = LABEL_W;
        var laneDrawWidth = lw - LABEL_W - (hasScroll ? 8 : 0);
        var tids = {}; targetIds().forEach(function (id) { tids[id] = true; });

        // shared time grid (bar/beat lines) + label-column backdrop — 1:1 with sdDrawMultiView
        ctx.fillStyle = 'rgba(0,0,0,0.35)';
        ctx.fillRect(0, 0, laneDrawLeft, lh);
        ctx.save();
        ctx.beginPath(); ctx.rect(laneDrawLeft, 0, laneDrawWidth, lh); ctx.clip();
        for (var b = 0; b <= totalBeats; b++) {
            var gx = laneDrawLeft + (b / totalBeats) * laneDrawWidth;
            if (b % 4 === 0) { ctx.strokeStyle = 'rgba(255,255,255,0.18)'; ctx.lineWidth = 2; }
            else { ctx.strokeStyle = 'rgba(255,255,255,0.09)'; ctx.lineWidth = 1; }
            ctx.beginPath(); ctx.moveTo(gx, 0); ctx.lineTo(gx, lh); ctx.stroke();
        }
        ctx.restore();
        ctx.strokeStyle = 'rgba(255,255,255,0.08)'; ctx.lineWidth = 1;
        ctx.beginPath(); ctx.moveTo(laneDrawLeft, 0); ctx.lineTo(laneDrawLeft, lh); ctx.stroke();

        for (var row = 0; row < visible; row++) {
            var idx = scrollOffset + row;
            if (idx >= params.length) break;
            var p = params[idx];
            var top = row * LANE_H, height = LANE_H, bottom = top + height, midY = top + height / 2;
            var lc = Core.laneRGB(idx);
            var isActive = p.id === activeId;
            var isHi = isActive || !!selected[p.id];
            var isLocked = !!p.locked;

            // alternating row stripe
            ctx.fillStyle = row % 2 === 0 ? 'rgba(255,255,255,0.015)' : 'rgba(0,0,0,0.15)';
            ctx.fillRect(laneDrawLeft, top, laneDrawWidth, height);

            // highlight (active OR selected)
            if (isHi) {
                ctx.fillStyle = rgba(lc, 0.08);
                ctx.fillRect(0, top, lw, height);
                ctx.strokeStyle = isActive ? rgba(lc, 0.55) : rgba(lc, 0.30);
                ctx.lineWidth = isActive ? 1.5 : 1;
                ctx.strokeRect(0.75, top + 0.75, lw - 1.5, height - 1.5);
            }
            // divider + center line
            ctx.strokeStyle = 'rgba(255,255,255,0.06)'; ctx.lineWidth = 1;
            ctx.beginPath(); ctx.moveTo(0, bottom); ctx.lineTo(lw, bottom); ctx.stroke();
            ctx.strokeStyle = 'rgba(255,255,255,0.04)';
            ctx.beginPath(); ctx.moveTo(laneDrawLeft, midY); ctx.lineTo(lw, midY); ctx.stroke();

            // label — 3 lines: device name · param name · point count (small so all fit in 64px)
            ctx.textAlign = 'left'; ctx.textBaseline = 'middle';
            var clip = function (s, n) { return (s && s.length > n) ? s.slice(0, n - 1) + '…' : (s || ''); };
            // line 1 — device name (dim)
            ctx.font = '600 8px Outfit';
            ctx.fillStyle = 'rgba(161,161,170,0.55)';
            if (deviceName) ctx.fillText(clip(deviceName, 16), 8, midY - 16);
            // line 2 — param name (bold / highlighted), clipped clear of the glyphs
            ctx.fillStyle = isLocked ? 'rgba(251,191,36,0.9)' : (isHi ? 'rgba(169,159,194,0.98)' : 'rgba(228,228,231,0.85)');
            ctx.font = isHi ? 'bold 11px Outfit' : '600 10px Outfit';
            ctx.fillText(clip(p.name, 12), 8, midY - 2);
            // line 3 — point count
            ctx.font = '9px Outfit';
            ctx.fillStyle = isLocked ? 'rgba(251,191,36,0.55)' : 'rgba(161,161,170,0.62)';
            ctx.fillText(p.points.length + ' points' + (isLocked ? ' · locked' : ''), 8, midY + 12);

            // focus glyph + lock glyph at the right of the label column
            drawFocus(ctx, laneDrawLeft - 36, midY - 6, 12, 'rgba(161,161,170,0.5)');
            drawLock(ctx, laneDrawLeft - 18, midY - 6, 12, isLocked ? 'rgba(251,191,36,0.9)' : 'rgba(161,161,170,0.45)', isLocked);

            // curve
            if (p.points.length) {
                var pts = displayPoints(p, !!tids[p.id]).slice().sort(function (a, b) { return a.time - b.time; });
                var valueToY = function (v) { return bottom - v * height; };
                var timeToX = function (t) { return laneDrawLeft + (t / totalBeats) * laneDrawWidth; };
                ctx.save();
                if (isLocked) ctx.globalAlpha = 0.4;
                ctx.save(); ctx.beginPath(); ctx.rect(laneDrawLeft, top, laneDrawWidth, height); ctx.clip();
                strokeCurve(pts, timeToX, valueToY, bottom, lc, isHi, isActive, laneDrawLeft, lw);
                ctx.restore(); ctx.restore();
            }
        }

        if (hasScroll) {
            var trackW = 4, trackX = lw - trackW - 2;
            ctx.fillStyle = 'rgba(255,255,255,0.05)'; ctx.fillRect(trackX, 0, trackW, lh);
            var thumbH = Math.max(20, (visible / params.length) * lh);
            var thumbY = (scrollOffset / params.length) * lh;
            ctx.fillStyle = rgba('169,159,194', 0.55); ctx.fillRect(trackX, thumbY, trackW, thumbH);
        }
    }

    function strokeCurve(pts, timeToX, valueToY, bottom, lc, isHi, isActive, leftEdge, lw) {
        // fill under
        ctx.beginPath();
        ctx.fillStyle = isHi ? rgba(lc, 0.12) : rgba(lc, 0.06);
        ctx.moveTo(timeToX(pts[0].time), bottom);
        pathThrough(pts, timeToX, valueToY);
        ctx.lineTo(timeToX(pts[pts.length - 1].time), bottom);
        ctx.closePath(); ctx.fill();
        // stroke
        ctx.beginPath();
        ctx.strokeStyle = isHi ? rgb(lc) : rgba(lc, 0.6);
        ctx.lineWidth = isHi ? 2 : 1.5;
        ctx.moveTo(timeToX(pts[0].time), valueToY(pts[0].value));
        pathThrough(pts, timeToX, valueToY);
        ctx.stroke();
        // points on active lane
        if (isActive) {
            ctx.fillStyle = rgb(lc);
            pts.forEach(function (pt) {
                var x = timeToX(pt.time), y = valueToY(pt.value);
                if (x >= leftEdge - 10 && x <= lw + 10) { ctx.beginPath(); ctx.arc(x, y, 3, 0, Math.PI * 2); ctx.fill(); }
            });
        }
    }
    function pathThrough(pts, timeToX, valueToY) {
        for (var i = 1; i < pts.length; i++) {
            var pt = pts[i], x = timeToX(pt.time), y = valueToY(pt.value);
            var prev = pts[i - 1], cvv = prev.curve || 0;
            if (cvv === 0) { ctx.lineTo(x, y); }
            else {
                var px = timeToX(prev.time), py = valueToY(prev.value);
                var mx = (px + x) / 2, my = (py + y) / 2, cpY = my - cvv * Math.abs(y - py) * 1.2;
                ctx.quadraticCurveTo(mx, cpY, x, y);
            }
        }
    }

    // ── Mockup B — single-lane focus view (1:1 with single-view canvas) ──
    function drawFocusView(lw, lh) {
        var p = params.find(function (q) { return q.id === view.focusId; });
        if (!p) { view = Core.backToMulti(); drawMulti(lw, lh); return; }
        var idx = params.indexOf(p), lc = Core.laneRGB(idx);
        var totalBeats = bars * 4;
        var padT = 24, padB = 8, plotH = lh - padT - padB;
        var leftPad = 34;

        // vertical bar/beat lines
        for (var b = 0; b <= totalBeats; b++) {
            var x = leftPad + (b / totalBeats) * (lw - leftPad - 6);
            ctx.strokeStyle = (b % 4 === 0) ? 'rgba(255,255,255,0.2)' : 'rgba(255,255,255,0.06)';
            ctx.lineWidth = (b % 4 === 0) ? 2 : 1;
            ctx.beginPath(); ctx.moveTo(x, padT); ctx.lineTo(x, padT + plotH); ctx.stroke();
        }
        // horizontal + y labels
        ctx.textAlign = 'left'; ctx.textBaseline = 'middle'; ctx.font = 'bold 9px Outfit';
        for (var v = 0; v <= 1.0001; v += 0.25) {
            var y = padT + plotH - v * plotH;
            ctx.strokeStyle = (v === 0 || v === 1) ? 'rgba(255,255,255,0.15)' : 'rgba(255,255,255,0.05)';
            ctx.lineWidth = 1; ctx.beginPath(); ctx.moveTo(leftPad, y); ctx.lineTo(lw - 6, y); ctx.stroke();
        }
        var fmt = function (val) { if (Math.abs(val) >= 1000) return (val / 1000).toFixed(1) + 'k'; return (Number.isInteger(val) ? val : parseFloat(val.toFixed(2))).toString(); };
        ctx.fillStyle = rgba(lc, 0.9); ctx.fillText(fmt(p.max), 4, padT + 4);
        ctx.fillStyle = 'rgba(255,255,255,0.4)'; ctx.fillText(fmt(p.min + (p.max - p.min) * 0.5), 4, padT + plotH / 2);
        ctx.fillStyle = 'rgba(255,255,255,0.5)'; ctx.fillText(fmt(p.min), 4, padT + plotH - 2);

        if (!p.points.length) return;
        var pts = Core.applyAdjust(p.points, fx).slice().sort(function (a, b) { return a.time - b.time; });
        var timeToX = function (t) { return leftPad + (t / totalBeats) * (lw - leftPad - 6); };
        var valueToY = function (val) { return padT + plotH - val * plotH; };
        // fill
        ctx.save(); ctx.beginPath();
        ctx.fillStyle = rgba(lc, 0.12);
        ctx.moveTo(timeToX(pts[0].time), padT + plotH);
        pathThrough(pts, timeToX, valueToY);
        ctx.lineTo(timeToX(pts[pts.length - 1].time), padT + plotH); ctx.closePath(); ctx.fill();
        // stroke
        ctx.beginPath(); ctx.strokeStyle = rgb(lc); ctx.lineWidth = 2.4;
        ctx.moveTo(timeToX(pts[0].time), valueToY(pts[0].value));
        pathThrough(pts, timeToX, valueToY); ctx.stroke();
        // points
        ctx.fillStyle = rgb(lc);
        pts.forEach(function (pt) { ctx.beginPath(); ctx.arc(timeToX(pt.time), valueToY(pt.value), 3.2, 0, Math.PI * 2); ctx.fill(); });
        ctx.restore();
    }

    // ── chrome (toolbar/status reflect the current view) ──
    function updateChrome() {
        var inFocus = view.mode === 'focus';
        backBtn.classList.toggle('hidden', !inFocus);
        focusTitle.classList.toggle('hidden', !inFocus);
        selectAllBtn.classList.toggle('hidden', inFocus);
        lockAllBtn.classList.toggle('hidden', inFocus);
        if (unlockAllBtn) unlockAllBtn.classList.toggle('hidden', inFocus);
        if (inFocus) {
            var p = params.find(function (q) { return q.id === view.focusId; });
            focusTitle.textContent = p ? (p.name + ' — ' + p.points.length + ' pts') : '';
            statusMode.textContent = 'Focus · 1 lane';
            adjustLabel.textContent = 'This lane';
        } else {
            statusMode.textContent = 'All lanes';
            var n = targetIds().length;
            adjustLabel.textContent = Object.keys(selected).some(function (k) { return selected[k]; }) ? 'Sel ' + n : 'Active';
        }
        statusCount.textContent = params.length + ' lanes' + (usingSample ? ' · sample data' : '');
    }

    // ── mouse ──
    function canvasXY(e) {
        var r = cv.getBoundingClientRect();
        return { x: e.clientX - r.left, y: e.clientY - r.top };
    }
    // ── geometry (mouse ↔ time/value) ──
    function multiLaneGeom(idx) {
        var lw = wrap.clientWidth, lh = wrap.clientHeight;
        var visible = Math.max(1, Math.floor(lh / LANE_H));
        var hasScroll = params.length > visible;
        var row = idx - scrollOffset;
        if (row < 0 || row >= visible) return null;
        return { left: LABEL_W, width: Math.max(1, lw - LABEL_W - (hasScroll ? 8 : 0)), top: row * LANE_H, height: LANE_H, totalBeats: bars * 4 };
    }
    function focusGeom() {
        var lw = wrap.clientWidth, lh = wrap.clientHeight;
        return { left: 34, width: Math.max(1, lw - 40), top: 24, height: Math.max(1, lh - 32), totalBeats: bars * 4 };
    }
    function xyToTV(g, x, y) {
        return {
            t: Math.max(0, Math.min(g.totalBeats, ((x - g.left) / g.width) * g.totalBeats)),
            v: Math.max(0, Math.min(1, 1 - (y - g.top) / g.height))
        };
    }
    function byTime(a, b) { return a.time - b.time; }
    function nearestPoint(p, t, g) {
        var win = (g.totalBeats / g.width) * 9, best = null, bd = win;
        p.points.forEach(function (pt) { var d = Math.abs(pt.time - t); if (d < bd) { bd = d; best = pt; } });
        return best;
    }
    function paintFree(p, t, v, totalBeats) {
        var win = totalBeats / 96;
        p.points = p.points.filter(function (pt) { return Math.abs(pt.time - t) > win; });
        p.points.push({ time: t, value: v, curve: 0 });
        p.points.sort(byTime);
    }
    function startDraw(p, g, pos) {
        var tv = xyToTV(g, pos.x, pos.y);
        drawState = { p: p, g: g, grab: null };
        if (tool === 'freehand') { paintFree(p, tv.t, tv.v, g.totalBeats); }
        else {
            var near = nearestPoint(p, tv.t, g);
            if (near) { drawState.grab = near; near.value = tv.v; }
            else { var np = { time: tv.t, value: tv.v, curve: 0 }; p.points.push(np); p.points.sort(byTime); drawState.grab = np; }
        }
        draw();
    }
    function moveDraw(pos) {
        if (!drawState) return;
        var tv = xyToTV(drawState.g, pos.x, pos.y);
        if (tool === 'freehand') paintFree(drawState.p, tv.t, tv.v, drawState.g.totalBeats);
        else if (drawState.grab) drawState.grab.value = tv.v;
        draw();
    }
    function endDraw() {
        if (!drawState) return;
        var p = drawState.p; drawState = null;
        p.points.sort(byTime);
        cmd({ type: 'setPoints', id: p.id, _path: p._path, points: p.points });
        draw();
    }

    cv.addEventListener('mousemove', function (e) {
        var pos = canvasXY(e);
        if (view.mode === 'focus') { cv.style.cursor = 'crosshair'; cv.title = ''; return; }
        var z = pos.x <= LABEL_W ? Core.labelZone(pos.x) : 'curve';
        cv.style.cursor = (z === 'lock' || z === 'focus') ? 'pointer' : (z === 'curve' ? 'crosshair' : 'default');
        // hover a lane label → native tooltip with the FULL param name (clipped on the canvas)
        if (pos.x <= LABEL_W) {
            var vis = Math.max(1, Math.floor(wrap.clientHeight / LANE_H));
            var rr = Math.floor(pos.y / LANE_H), ii = scrollOffset + rr;
            var lp = (ii >= 0 && ii < params.length && rr < vis) ? params[ii] : null;
            cv.title = lp ? lp.name : '';
        } else { cv.title = ''; }
    });
    cv.addEventListener('mousedown', function (e) {
        var pos = canvasXY(e);
        if (view.mode === 'focus') {
            var fp = params.find(function (q) { return q.id === view.focusId; });
            if (fp && !fp.locked) startDraw(fp, focusGeom(), pos);
            return;
        }
        var visible = Math.max(1, Math.floor(wrap.clientHeight / LANE_H));
        var row = Math.floor(pos.y / LANE_H);
        var idx = scrollOffset + row;
        if (idx < 0 || idx >= params.length || row >= visible) return;
        var p = params[idx];
        if (pos.x <= LABEL_W) {
            var z = Core.labelZone(pos.x);
            if (z === 'lock') { cmd({ type: 'toggleLock', id: p.id, _path: p._path }); return; }   // → canvas locks
            if (z === 'focus') { view = Core.focusLane(view, p.id); activeId = p.id; draw(); return; } // panel-only view
            if (e.ctrlKey || e.metaKey || e.shiftKey) cmd({ type: 'toggleSelect', id: p.id, _path: p._path });
            else cmd({ type: 'setActive', id: p.id, _path: p._path });
            return;
        }
        // curve area → draw on this lane (Point adds/moves a point, Free paints); makes it active
        if (p.locked) return;
        var g = multiLaneGeom(idx);
        if (!g) return;
        if (activeId !== p.id) { activeId = p.id; cmd({ type: 'setActive', id: p.id, _path: p._path }); }
        startDraw(p, g, pos);
    });
    window.addEventListener('mousemove', function (e) { if (drawState) moveDraw(canvasXY(e)); });
    window.addEventListener('mouseup', function () { endDraw(); });
    wrap.addEventListener('wheel', function (e) {
        if (view.mode !== 'multi') return;
        var visible = Math.max(1, Math.floor(wrap.clientHeight / LANE_H));
        if (params.length <= visible) return;
        scrollOffset = Math.max(0, Math.min(params.length - visible, scrollOffset + (e.deltaY > 0 ? 1 : -1)));
        e.preventDefault(); draw();
    }, { passive: false });

    // ── controls ──
    backBtn.addEventListener('click', function () { view = Core.backToMulti(); draw(); });
    selectAllBtn.addEventListener('click', function () { cmd({ type: 'selectAll' }); });
    lockAllBtn.addEventListener('click', function () { cmd({ type: 'lockAll' }); });
    if (unlockAllBtn) unlockAllBtn.addEventListener('click', function () { cmd({ type: 'unlockAll' }); });
    // draw-tool segment (Point / Free) — sets the panel's local draw mode
    Array.prototype.forEach.call(document.querySelectorAll('[data-tool]'), function (btn) {
        btn.addEventListener('click', function () {
            tool = btn.dataset.tool;
            document.querySelectorAll('[data-tool]').forEach(function (b) {
                b.classList.remove('is-on');
            });
            btn.classList.add('is-on');
        });
    });
    // action tools (Mirror/Flip/Copy/Paste/Inv/Paste To/Swing/Quantize/Mutate) →
    // run on the canvas's target/selected lanes; the canvas re-pushes the result.
    Array.prototype.forEach.call(document.querySelectorAll('[data-act]'), function (btn) {
        btn.addEventListener('click', function () { cmd({ type: 'tool', tool: btn.dataset.act }); });
    });
    // sliders: drag = live preview (local); release = commit the adjustment to
    // the canvas for each target lane, then reset to neutral (the committed curve
    // becomes the new baseline → no cumulative drift).
    Array.prototype.forEach.call(document.querySelectorAll('input[data-fx]'), function (sl) {
        sl.addEventListener('input', function () {
            fx[sl.dataset.fx] = +sl.value;
            var valEl = document.querySelector('[data-val="' + sl.dataset.fx + '"]');
            if (valEl) valEl.textContent = sl.value + '%';
            draw();
        });
        sl.addEventListener('change', commitAdjust);
    });
    function commitAdjust() {
        targetIds().forEach(function (id) {
            var p = params.find(function (q) { return q.id === id; });
            if (!p || p.locked || !p.points.length) return;
            var pts = Core.applyAdjust(p.points, fx);
            p.points = pts;                       // optimistic local update (no flicker before re-push)
            cmd({ type: 'setPoints', id: p.id, _path: p._path, points: pts });
        });
        fx = Core.defaultFx();
        resetSliders();
        draw();
    }
    function resetSliders() {
        var defs = { smooth: 0, depth: 100, curve: 0, floor: 0, ceil: 100 };
        Array.prototype.forEach.call(document.querySelectorAll('input[data-fx]'), function (sl) {
            sl.value = defs[sl.dataset.fx];
            var valEl = document.querySelector('[data-val="' + sl.dataset.fx + '"]');
            if (valEl) valEl.textContent = defs[sl.dataset.fx] + '%';
        });
    }

    // pin toggle
    var pinBtn = document.getElementById('qp-pin');
    var pinned = true;
    pinBtn.addEventListener('click', function () {
        pinned = !pinned;
        if (window.strideQuick && window.strideQuick.setPin) window.strideQuick.setPin(pinned);
        pinBtn.textContent = pinned ? '● Pinned' : '○ Unpinned';
        pinBtn.classList.toggle('is-on', pinned);
    });
    document.getElementById('qp-refresh').addEventListener('click', load);

    // live snapshot pushed from the canvas → render the SAME rack, 1:1 + live
    if (window.strideQuick && window.strideQuick.onState) {
        window.strideQuick.onState(function (s) { applyState(s, true); });
    }
    // fallback: re-read the saved file when it changes (only matters pre-live)
    if (window.strideQuick && window.strideQuick.onCanvasChanged) {
        window.strideQuick.onCanvasChanged(function () { load(); });
    }
    // live window-size readout in the titlebar (so you can dial in the default)
    var sizeEl = document.getElementById('qp-size');
    function updateSize() { if (sizeEl) sizeEl.textContent = Math.round(window.outerWidth || window.innerWidth) + ' × ' + Math.round(window.outerHeight || window.innerHeight); }
    window.addEventListener('resize', function () { fit(); updateSize(); });
    if (window.ResizeObserver) new ResizeObserver(fit).observe(wrap);
    window.addEventListener('focus', load);
    updateSize();

    // boot
    load();

    // expose a tiny hook for manual testing in devtools (no effect on the app)
    window.__qp = { reload: load, state: function () { return { params: params, view: view, activeId: activeId, selected: selected }; } };
})();
