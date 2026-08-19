/*
  COMPACT VIEW - parameter-card grid for the Stride wrapper.

  A SECOND VIEW of the existing lanes. It owns no state: every frame it reads
  window.sdCompactSnapshot() (read-only, defined in canvas.js) and draws. Switching
  views cannot reroll a curve, move a value, change a mapping, unlock anything or
  restart motion, because there is nothing here to change them with.

  Full view asks "what is this lane doing across time".
  Compact asks "what do I have mapped, what is moving, what can I grab".

  Each card: parameter name, source plugin, knob (value right now), lock, lane menu,
  and a MINI MOTION WINDOW - the real lane curve travelling through a clipped viewport
  under a fixed playhead. Deliberately nothing else: every shape/motion tool already
  lives in the toolbars above, and duplicating them per card would rebuild the density
  this mode exists to remove.

  WRAPPER ONLY (window.__STRIDE_WRAPPER__). The desktop app is untouched.

  CPU: one rAF for the whole grid, and it PARKS whenever compact is closed or the
  transport is stopped and nothing has moved. Per visible card per frame it writes at
  most 4 attributes, and only when the rounded value actually changed.
*/
(function () {
  'use strict';
  if (!window.__STRIDE_WRAPPER__) return;

  const $ = (id) => document.getElementById(id);
  const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);

  const MVP_W = 132, MVP_H = 30, LOOP_W = MVP_W * 2;   // half the loop in view
  const KN = 44, KR = 17.5;                            // knob box / arc radius
  const A0 = -138, A1 = 138;                           // knob sweep in degrees

  let host = null, wrap = null, on = false, raf = 0;
  let cards = [], lastRev = '', lastPhase = -1, lastEpoch = -1;

  /* ── curve sampling: value of a lane at loop position t (0..1) ───── */
  function laneValue(p, t) {
    const pts = p.points;
    if (!pts || !pts.length) return 0;
    const span = pts[pts.length - 1].time || 1;
    const x = t * span;
    if (x <= pts[0].time) return raw(p, pts[0].value);
    for (let i = 1; i < pts.length; i++) {
      if (x <= pts[i].time) {
        const a = pts[i - 1], b = pts[i];
        const d = (b.time - a.time) || 1;
        let u = (x - a.time) / d;
        const cv = a.curve || 0;
        if (cv) u = u + cv * u * (1 - u);          // match the canvas bend
        return raw(p, a.value + (b.value - a.value) * clamp(u, 0, 1));
      }
    }
    return raw(p, pts[pts.length - 1].value);
  }
  // a ranged lane outputs inside its band, exactly like the engine drive does
  function raw(p, v) { return p.rangeOn ? (p.rangeMin + v * (p.rangeMax - p.rangeMin)) : v; }

  function lanePath(p, w, h) {
    const pts = p.points;
    if (!pts || pts.length < 2) return 'M0,' + (h / 2).toFixed(1) + ' L' + w + ',' + (h / 2).toFixed(1);
    const N = 96, out = [];
    for (let i = 0; i <= N; i++) {
      const t = i / N;
      out.push((t * w).toFixed(1) + ',' + (h - clamp(laneValue(p, t), 0, 1) * h).toFixed(1));
    }
    return 'M' + out.join(' L');
  }
  function arc(cx, cy, r, v) {
    const a0 = A0 * Math.PI / 180, a1 = (A0 + (A1 - A0) * clamp(v, 0, 1)) * Math.PI / 180;
    const x0 = cx + Math.sin(a0) * r, y0 = cy - Math.cos(a0) * r;
    const x1 = cx + Math.sin(a1) * r, y1 = cy - Math.cos(a1) * r;
    const big = ((A1 - A0) * clamp(v, 0, 1)) > 180 ? 1 : 0;
    return `M${x0.toFixed(2)},${y0.toFixed(2)} A${r},${r} 0 ${big} 1 ${x1.toFixed(2)},${y1.toFixed(2)}`;
  }

  /* ── the knob. Dark machined body, dotted track, lane-coloured value arc,
        soft inner shadow and a lit bevel. Restrained, not an EDM glow. ── */
  function knobSvg(rgb, uid) {
    let ticks = '';
    for (let i = 0; i <= 22; i++) {
      const a = (A0 + (A1 - A0) * (i / 22)) * Math.PI / 180;
      const r0 = KR + 2.6, r1 = KR + (i % 11 === 0 ? 5.4 : 4.2);
      ticks += `<line x1="${(KN / 2 + Math.sin(a) * r0).toFixed(2)}" y1="${(KN / 2 - Math.cos(a) * r0).toFixed(2)}"
                      x2="${(KN / 2 + Math.sin(a) * r1).toFixed(2)}" y2="${(KN / 2 - Math.cos(a) * r1).toFixed(2)}"
                      stroke="rgb(${rgb})" stroke-opacity="${i % 11 === 0 ? .42 : .17}" stroke-width="1"
                      stroke-linecap="round"/>`;
    }
    return `<svg class="sdk" width="${KN}" height="${KN}" viewBox="0 0 ${KN} ${KN}">
      <defs>
        <radialGradient id="kb${uid}" cx=".38" cy=".32" r=".78">
          <stop offset="0" stop-color="#2b2c30"/><stop offset=".55" stop-color="#17181b"/>
          <stop offset="1" stop-color="#0b0c0e"/>
        </radialGradient>
        <linearGradient id="kr${uid}" x1=".2" y1="0" x2=".8" y2="1">
          <stop offset="0" stop-color="#5a5c62" stop-opacity=".85"/>
          <stop offset=".5" stop-color="#26272b" stop-opacity=".5"/>
          <stop offset="1" stop-color="#0a0a0c" stop-opacity=".9"/>
        </linearGradient>
      </defs>
      <g class="kticks">${ticks}</g>
      <path d="${arc(KN / 2, KN / 2, KR, 1)}" fill="none" stroke="#232428" stroke-width="2.2" stroke-linecap="round"/>
      <path class="karc" d="" fill="none" stroke="rgb(${rgb})" stroke-width="2.2" stroke-linecap="round"/>
      <circle cx="${KN / 2}" cy="${KN / 2}" r="${KR - 3}" fill="url(#kr${uid})"/>
      <circle cx="${KN / 2}" cy="${KN / 2}" r="${KR - 4.1}" fill="url(#kb${uid})"/>
      <circle cx="${KN / 2}" cy="${KN / 2 - 1}" r="${KR - 5.4}" fill="none" stroke="#ffffff" stroke-opacity=".05" stroke-width="1"/>
      <g class="kind">
        <line x1="${KN / 2}" y1="${KN / 2 - 3.5}" x2="${KN / 2}" y2="${KN / 2 - KR + 4.6}"
              stroke="#f1ede4" stroke-opacity=".92" stroke-width="1.9" stroke-linecap="round"/>
        <circle cx="${KN / 2}" cy="${KN / 2 - KR + 4.6}" r="1.15" fill="rgb(${rgb})"/>
      </g>
    </svg>`;
  }

  function cardHtml(p, i) {
    const seg = `<path class="mfill" d="" fill="rgb(${p.rgb})" opacity="${p.locked ? .05 : .12}"/>
                 <path class="mline" d="" fill="none" stroke="rgb(${p.rgb})" stroke-width="1.5"
                       stroke-linejoin="round" stroke-linecap="round" opacity="${p.locked ? .45 : .95}"/>`;
    return `<div class="sdc${p.locked ? ' lk' : ''}" data-id="${p.id}" style="--lc:rgb(${p.rgb})">
      <div class="sdc-h">
        <div class="sdc-t">
          <div class="sdc-n" title="${esc(p.name)}">${esc(p.name)}</div>
          <div class="sdc-d" title="${esc(p.device)}">${esc(p.device)}</div>
        </div>
        <button class="sdc-m" title="Lane menu" tabindex="-1">&#8942;</button>
      </div>
      <div class="sdc-b">
        <button class="sdc-lk" title="${p.locked ? 'Locked - motion tools skip this lane. Click to unlock.' : 'Lock this lane'}">
          ${p.locked ? lockOn() : lockOff()}
        </button>
        ${knobSvg(p.rgb, i)}
        <div class="sdc-v"><b>0%</b></div>
      </div>
      <div class="sdc-w">
        <svg viewBox="0 0 ${MVP_W} ${MVP_H}" preserveAspectRatio="none">
          <g class="msc"><g class="s0">${seg}</g>
            <g class="s1" transform="translate(${LOOP_W},0)">${seg}</g>
            <g class="s2" transform="translate(${-LOOP_W},0)">${seg}</g></g>
          <line x1="${MVP_W / 2}" y1="0" x2="${MVP_W / 2}" y2="${MVP_H}" stroke="#f1ede4" stroke-opacity=".2" stroke-width="1"/>
          <circle class="mdot" cx="${MVP_W / 2}" cy="${MVP_H / 2}" r="2" fill="rgb(${p.rgb})" opacity="${p.locked ? .5 : 1}"/>
        </svg>
      </div>
    </div>`;
  }
  const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, c =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const lockOn = () => '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2">' +
    '<rect x="5" y="11" width="14" height="9" rx="2"/><path d="M8 11V7a4 4 0 0 1 8 0v4"/></svg>';
  const lockOff = () => '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2">' +
    '<rect x="5" y="11" width="14" height="9" rx="2"/><path d="M8 11V7a4 4 0 0 1 7.5-2"/></svg>';

  /* ── build / rebuild ─────────────────────────────────────────────── */
  function rebuild(snap) {
    wrap.innerHTML = snap.params.map(cardHtml).join('') ||
      '<div class="sdc-empty">No mapped parameters yet. Press <b>Map</b>, then touch a knob in your plugin.</div>';
    cards = [...wrap.querySelectorAll('.sdc')].map((el, i) => ({
      el, p: snap.params[i],
      arc: el.querySelector('.karc'), ind: el.querySelector('.kind'),
      val: el.querySelector('.sdc-v b'), msc: el.querySelector('.msc'),
      dot: el.querySelector('.mdot'), lv: -1
    }));
    cards.forEach(c => {
      c.el.querySelectorAll('.s0,.s1,.s2').forEach(n => n.setAttribute('transform',
        n.classList.contains('s1') ? `translate(${LOOP_W},3)` :
        n.classList.contains('s2') ? `translate(${-LOOP_W},3)` : 'translate(0,3)'));
      // the REAL lock action, not a private copy of the concept
      const lk = c.el.querySelector('.sdc-lk');
      if (lk) lk.addEventListener('click', () => {
        if (typeof window.sdToggleLockLane === 'function') window.sdToggleLockLane(c.p.id);
        sync(true);
      });
    });
    drawCurves();
  }

  // Curve geometry changes far less often than the playhead, and a curve edit must NOT
  // tear the grid down mid-drag - so paths are redrawn in place, keyed off the canvas's
  // own edit counter, while the DOM survives.
  function drawCurves() {
    for (let i = 0; i < cards.length; i++) {
      const c = cards[i];
      const d = lanePath(c.p, LOOP_W, MVP_H - 6);
      c.el.querySelectorAll('.mline').forEach(n => n.setAttribute('d', d));
      c.el.querySelectorAll('.mfill').forEach(n => n.setAttribute('d',
        d + ` L${LOOP_W},${MVP_H - 6} L0,${MVP_H - 6} Z`));
    }
  }

  /* ── per-frame ───────────────────────────────────────────────────── */
  function paint(snap) {
    const ph = snap.phase;
    for (let i = 0; i < cards.length; i++) {
      const c = cards[i];
      const v = clamp(laneValue(c.p, ph), 0, 1);
      const q = Math.round(v * 1000);
      if (q !== c.lv) {
        c.lv = q;
        c.arc.setAttribute('d', arc(KN / 2, KN / 2, KR, v));
        c.ind.setAttribute('transform', `rotate(${(A0 + (A1 - A0) * v).toFixed(1)},${KN / 2},${KN / 2})`);
        c.val.textContent = Math.round(v * 100) + '%';
        c.dot.setAttribute('cy', (3 + (1 - v) * (MVP_H - 6)).toFixed(2));
      }
      c.msc.setAttribute('transform', `translate(${(MVP_W / 2 - ph * LOOP_W).toFixed(2)},0)`);
    }
  }
  function sync(force) {
    if (!on || typeof window.sdCompactSnapshot !== 'function') return;
    const rev = window.sdCompactRevision();
    const snap = window.sdCompactSnapshot();
    if (force || rev !== lastRev) {
      lastRev = rev; rebuild(snap); lastPhase = -1; lastEpoch = snap.epoch;
    } else {
      for (let i = 0; i < cards.length; i++) cards[i].p = snap.params[i] || cards[i].p;
      if (snap.epoch !== lastEpoch) { lastEpoch = snap.epoch; drawCurves(); lastPhase = -1; }
    }
    if (force || Math.abs(snap.phase - lastPhase) > 0.0004) { lastPhase = snap.phase; paint(snap); }
    return snap;
  }
  function tick() {
    raf = 0;
    const snap = sync(false);
    if (!on) return;
    // Playing: follow the transport at frame rate. Stopped: a still transport means a
    // still grid, so drop off rAF entirely and just poll slowly, which keeps edits and
    // locks live while costing effectively nothing during a long mixing session.
    if (snap && snap.playing) kick();
    else raf = setTimeout(() => { raf = 0; tick(); }, 200);
  }
  function kick() { if (!raf && on) raf = requestAnimationFrame(tick); }

  /* ── mount ───────────────────────────────────────────────────────── */
  function mount() {
    host = document.getElementById('sd-canvas-container');
    if (!host || !host.parentNode) return false;
    wrap = document.createElement('div');
    wrap.id = 'sd-compact';
    wrap.style.display = 'none';
    host.parentNode.insertBefore(wrap, host.nextSibling);
    return true;
  }
  function setCompact(v) {
    if (!wrap && !mount()) return;
    on = !!v;
    document.body.classList.toggle('sd-compact-view', on);
    wrap.style.display = on ? 'grid' : 'none';
    if (host) host.style.display = on ? 'none' : '';
    const rail = document.getElementById('sd-inject-rail');
    if (rail) rail.style.display = on ? 'none' : '';
    if (on) { lastRev = ''; sync(true); kick(); }
    const st = document.getElementById('sd-canvas-status');
    if (st) st.textContent = on ? 'Compact view' : st.textContent;
  }

  window.strideCompact = {
    set: setCompact,
    toggle: () => setCompact(!on),
    isOn: () => on,
    refresh: () => sync(true),
    _cards: () => cards
  };

  function boot() {
    mount();
    // curves change without the lane set changing (draw, motion tool, motion load),
    // so re-read on the same beat the canvas persists. Cheap: a signature compare.
    window.addEventListener('sd-compact-refresh', () => sync(true));
    document.addEventListener('visibilitychange', () => { if (!document.hidden) kick(); });
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot);
  else boot();
})();
