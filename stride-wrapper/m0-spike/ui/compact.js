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
  const KN = 56, KR = 17.5;                            // knob box / value-arc radius
  const RR = KR + 7.0;                                 // range band ring, clear of the ticks
  const A0 = -138, A1 = 138;                           // knob sweep in degrees
  const DRAG_FULL = 170;                               // px of vertical travel = 0..100%

  let host = null, wrap = null, on = false, raf = 0;
  let cards = [], lastRev = '', lastPhase = -1, lastEpoch = -1;
  let drag = null;                                     // active band-boundary drag
  let cardDrag = null;                                 // active card reorder / click-to-select

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

  /* ── where a lane actually IS right now ──────────────────────────────
     Matches the engine's own drive: it scales the lane's clock by SPEED and wraps that at
     the lane's loop boundary - fmod(ph * speed, laneLoop) - rather than riding the shared
     playhead. Sampling the raw phase made every knob move at 1X no matter what rate the
     lane was set to (field report 2026-08-20), and it ignored per-lane loops the same way.
     Returns a fraction of the CURVE, because that is what laneValue() takes. */
  function lanePhase(p, ph, bars) {
    const cb = Math.max(1, (bars > 0 ? bars : 4) * 4);              // clip length in beats
    const spd = (typeof p.speed === 'number' && p.speed > 0) ? p.speed : 1;
    const lL = (typeof p.loopBeats === 'number' && p.loopBeats > 0.01) ? p.loopBeats : cb;
    let lx = (ph * cb * spd) % lL;
    if (lx < 0) lx += lL;
    return lx / cb;
  }

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
  // Arc between two positions on the sweep, each 0..1. arc(...,v) = "from zero to v".
  function arcAB(cx, cy, r, v0, v1) {
    const p0 = clamp(v0, 0, 1), p1 = clamp(v1, 0, 1);
    const a0 = (A0 + (A1 - A0) * p0) * Math.PI / 180, a1 = (A0 + (A1 - A0) * p1) * Math.PI / 180;
    const x0 = cx + Math.sin(a0) * r, y0 = cy - Math.cos(a0) * r;
    const x1 = cx + Math.sin(a1) * r, y1 = cy - Math.cos(a1) * r;
    const big = ((A1 - A0) * Math.abs(p1 - p0)) > 180 ? 1 : 0;
    return `M${x0.toFixed(2)},${y0.toFixed(2)} A${r},${r} 0 ${big} ${p1 >= p0 ? 1 : 0} ${x1.toFixed(2)},${y1.toFixed(2)}`;
  }
  const arc = (cx, cy, r, v) => arcAB(cx, cy, r, 0, v);
  // a short radial tick across the band ring, marking exactly where a boundary sits
  function capAt(v) {
    const a = (A0 + (A1 - A0) * clamp(v, 0, 1)) * Math.PI / 180, c = KN / 2, T = 2.6;
    return { x1: (c + Math.sin(a) * (RR - T)).toFixed(2), y1: (c - Math.cos(a) * (RR - T)).toFixed(2),
             x2: (c + Math.sin(a) * (RR + T)).toFixed(2), y2: (c - Math.cos(a) * (RR + T)).toFixed(2) };
  }
  // Where on the sweep a pointer is, 0..1 — used to decide WHICH boundary a grab means.
  function angleValue(dx, dy) {
    let deg = Math.atan2(dx, -dy) * 180 / Math.PI;      // 0 at 12 o'clock, + clockwise
    return clamp((deg - A0) / (A1 - A0), 0, 1);
  }

  /* ── the knob. Dark machined body, dotted track, lane-coloured value arc,
        soft inner shadow and a lit bevel. Restrained, not an EDM glow. ── */
  function knobSvg(rgb, uid) {
    let ticks = '';
    for (let i = 0; i <= 22; i++) {
      const a = (A0 + (A1 - A0) * (i / 22)) * Math.PI / 180;
      const r0 = KR + 1.8, r1 = KR + (i % 11 === 0 ? 4.2 : 3.2);
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
      <!-- RANGE BAND: the outer ring is the lane's output band, Serum-style. Grab it and
           drag to move the nearer boundary. The faint full ring is the grab affordance. -->
      <path class="krail" d="${arc(KN / 2, KN / 2, RR, 1)}" fill="none" stroke="#ffffff"
            stroke-opacity=".08" stroke-width="3" stroke-linecap="round"/>
      <path class="krng" d="" fill="none" stroke="rgb(${rgb})" stroke-opacity=".75"
            stroke-width="3" stroke-linecap="butt" display="none"/>
      <g class="kcap" display="none">
        <line class="kcapa" x1="0" y1="0" x2="0" y2="0" stroke="rgb(${rgb})" stroke-width="1.6" stroke-linecap="round"/>
        <line class="kcapb" x1="0" y1="0" x2="0" y2="0" stroke="rgb(${rgb})" stroke-width="1.6" stroke-linecap="round"/>
      </g>
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
      <circle class="khit" cx="${KN / 2}" cy="${KN / 2}" r="21.5" fill="none"
              stroke="rgba(0,0,0,0)" stroke-width="12" pointer-events="stroke"/>
    </svg>`;
  }

  function cardHtml(p, i) {
    const seg = `<path class="mfill" d="" fill="rgb(${p.rgb})" opacity="${p.locked ? .05 : .12}"/>
                 <path class="mline" d="" fill="none" stroke="rgb(${p.rgb})" stroke-width="1.5"
                       stroke-linejoin="round" stroke-linecap="round" opacity="${p.locked ? .45 : .95}"/>`;
    return `<div class="sdc${p.locked ? ' lk' : ''}${p.rangeOn ? ' rng' : ''}${p.selected ? ' sel' : ''}" data-id="${p.id}" style="--lc:rgb(${p.rgb})">
      <div class="sdc-h">
        <div class="sdc-t">
          <div class="sdc-n" title="${esc(p.name)}">${esc(p.name)}</div>
          <div class="sdc-d" title="${esc(p.device)}">${esc(p.device)}</div>
        </div>
        <button class="sdc-m" title="Lane menu" tabindex="-1">&#8942;</button>
        <button class="sdc-x" title="Remove this lane">&#215;</button>
      </div>
      <div class="sdc-b">
        <button class="sdc-lk" title="${p.locked ? 'Locked - motion tools skip this lane. Click to unlock.' : 'Lock this lane'}">
          ${p.locked ? lockOn() : lockOff()}
        </button>
        <button class="sdc-rg${p.rangeOn ? ' on' : ''}" title="${p.rangeOn
          ? 'Range on - the lane moves inside its band. Drag the knob ring to set it. Double-click to reset.'
          : 'Range - hold this lane inside a band. Or just drag the knob ring.'}">${rangeIcon()}</button>
        <button class="sdc-sp${(p.speed && p.speed !== 1) ? ' on' : ''}"
          title="Lane speed: how fast this lane runs compared to the rest. Click to step up, right-click for 1X."
          >${esc(p.speedLabel || '1X')}</button>
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
  // two limits with travel between them - the same idea the lane canvas's range icon draws
  const rangeIcon = () => '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" ' +
    'stroke-width="2.2" stroke-linecap="round"><path d="M5 6h14M5 18h14M12 9v6"/></svg>';

  /* ── build / rebuild ─────────────────────────────────────────────── */
  function rebuild(snap) {
    wrap.innerHTML = snap.params.map(cardHtml).join('') ||
      '<div class="sdc-empty">No mapped parameters yet. Press <b>Map</b>, then touch a knob in your plugin.</div>';
    cards = [...wrap.querySelectorAll('.sdc')].map((el, i) => ({
      el, p: snap.params[i],
      arc: el.querySelector('.karc'), ind: el.querySelector('.kind'),
      rng: el.querySelector('.krng'), capg: el.querySelector('.kcap'),
      capa: el.querySelector('.kcapa'), capb: el.querySelector('.kcapb'),
      val: el.querySelector('.sdc-v b'), msc: el.querySelector('.msc'),
      dot: el.querySelector('.mdot'), lv: -1, lr: ''
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
      // ── RANGE ─────────────────────────────────────────────────────────────
      // Same two gestures the lane canvas already gives this feature: click the icon to
      // arm the band, double-click to reset it to full. Single-lane on purpose.
      const rg = c.el.querySelector('.sdc-rg');
      if (rg) {
        let clickT = 0;
        rg.addEventListener('click', () => {
          const now = Date.now(), dbl = (now - clickT) < 400; clickT = dbl ? 0 : now;
          if (typeof window.sdCompactToggleRange === 'function')
            window.sdCompactToggleRange(c.p.id, dbl);
          sync(true);
        });
      }
      // lane SPEED - the same ladder and the same engine push the lane canvas uses
      const sp = c.el.querySelector('.sdc-sp');
      if (sp) {
        const step = (dir) => {
          if (typeof window.sdCompactSetSpeed === 'function') window.sdCompactSetSpeed(c.p.id, dir);
          lastRev = ''; sync(true);
        };
        sp.addEventListener('click', () => step(1));
        sp.addEventListener('contextmenu', (e) => { e.preventDefault(); step(0); });
      }
      // remove the lane - the same action the lane canvas's ✕ performs
      const rm = c.el.querySelector('.sdc-x');
      if (rm) rm.addEventListener('click', () => {
        if (typeof window.sdUnmapLane === 'function') window.sdUnmapLane(c.p.id);
        lastRev = ''; sync(true);
      });
      bindRing(c);
      bindCard(c);
    });
    drawCurves();
  }

  /* ── the card itself: click selects, drag reorders ───────────────────
     One gesture, split by intent: under a few pixels of travel it is a click and the
     lane joins the SELECTION (so the toolbars' motion tools apply to it); past that it
     is a drag and the card moves. Controls inside the card keep their own gestures. */
  function bindCard(c) {
    c.el.addEventListener('pointerdown', (e) => {
      if (e.button !== 0) return;
      if (e.target.closest && e.target.closest('button, .sdk')) return;
      const r = c.el.getBoundingClientRect();
      cardDrag = { c, x: e.clientX, y: e.clientY, moved: false, ph: null,
                   ox: e.clientX - r.left, oy: e.clientY - r.top, w: r.width, h: r.height };
      // Listen on the WINDOW, not via pointer capture on the card: the drag moves
      // elements around inside the grid, and moving the CAPTURED element in the DOM
      // drops its capture, which killed the drag after the first reorder.
      window.addEventListener('pointermove', dragMove);
      window.addEventListener('pointerup', dragEnd);
      window.addEventListener('pointercancel', dragEnd);
    });
  }

  // The card LIFTS OUT of the grid and follows the cursor, and a placeholder holds the
  // slot it would drop into. Only the placeholder moves while dragging, so the grid
  // never reflows under the pointer and the card the cursor is over stays stable.
  function dragMove(e) {
    const d = cardDrag;
    if (!d) return;
    const el = d.c.el;
    if (!d.moved) {
      if (Math.abs(e.clientX - d.x) + Math.abs(e.clientY - d.y) < 6) return;
      d.moved = true;
      d.ph = document.createElement('div');
      d.ph.className = 'sdc-ph';
      d.ph.style.height = d.h + 'px';
      wrap.insertBefore(d.ph, el);
      el.classList.add('dragging');
      el.style.position = 'fixed';
      el.style.width = d.w + 'px';
      el.style.height = d.h + 'px';
      el.style.pointerEvents = 'none';
    }
    el.style.left = (e.clientX - d.ox) + 'px';
    el.style.top  = (e.clientY - d.oy) + 'px';
    const over = slotUnder(e.clientX, e.clientY, el, d.ph);
    if (over) {
      const r = over.getBoundingClientRect();
      wrap.insertBefore(d.ph, e.clientX > r.left + r.width / 2 ? over.nextSibling : over);
    }
  }
  function dragEnd() {
    const d = cardDrag;
    if (!d) return;
    window.removeEventListener('pointermove', dragMove);
    window.removeEventListener('pointerup', dragEnd);
    window.removeEventListener('pointercancel', dragEnd);
    cardDrag = null;
    const el = d.c.el;
    if (d.moved) {
      el.classList.remove('dragging');
      el.style.position = el.style.left = el.style.top = '';
      el.style.width = el.style.height = el.style.pointerEvents = '';
      if (d.ph && d.ph.parentNode) { wrap.insertBefore(el, d.ph); d.ph.remove(); }
      const ids = [].map.call(wrap.querySelectorAll('.sdc'), n => n.getAttribute('data-id'));
      if (typeof window.sdCompactSetOrder === 'function') window.sdCompactSetOrder(ids);
    } else if (typeof window.sdToggleLaneSelection === 'function') {
      window.sdToggleLaneSelection(d.c.p.id);       // locked lanes decline it, exactly as on the canvas
    }
    lastRev = ''; sync(true);
  }
  function slotUnder(x, y, self, ph) {
    const all = wrap.children;
    for (let i = 0; i < all.length; i++) {
      if (all[i] === self || all[i] === ph) continue;
      const r = all[i].getBoundingClientRect();
      if (x >= r.left && x <= r.right && y >= r.top && y <= r.bottom) return all[i];
    }
    return null;
  }

  /* ── the knob ring IS the band control (Serum-style) ─────────────────
     Grab the outer ring and drag vertically: the boundary you grabbed nearest follows.
     Grabbing an unbanded lane arms the band first, because reaching for the ring is
     already the intent. The knob body is deliberately inert - a card shows what a lane
     is doing, and every shape/motion tool lives in the toolbars above. */
  function bindRing(c) {
    const hit = c.el.querySelector('.khit');
    if (!hit) return;
    hit.addEventListener('pointerdown', (e) => {
      if (e.button !== 0) return;
      e.preventDefault();
      const r = hit.getBoundingClientRect();
      const av = angleValue(e.clientX - (r.left + r.width / 2), e.clientY - (r.top + r.height / 2));
      const on = !!c.p.rangeOn;
      const mn = on ? c.p.rangeMin : 0, mx = on ? c.p.rangeMax : 1;
      const edge = Math.abs(av - mn) <= Math.abs(av - mx) ? 'rangeMin' : 'rangeMax';
      drag = { c, edge, y0: e.clientY, pct: (edge === 'rangeMin' ? mn : mx) * 100 };
      try { hit.setPointerCapture(e.pointerId); } catch (_) {}
      c.el.classList.add('drag');
      callRange(c, edge, drag.pct, 'start');
      paintNow();
      showEdge(c, edge, drag.pct);
    });
    hit.addEventListener('pointermove', (e) => {
      if (!drag || drag.c !== c) return;
      drag.pct = clamp(drag.pct + (drag.y0 - e.clientY) * (100 / DRAG_FULL), 0, 100);
      drag.y0 = e.clientY;
      callRange(c, drag.edge, drag.pct, 'move');
      paintNow();
      showEdge(c, drag.edge, drag.pct);   // after paintNow, which owns the value label
    });
    const end = (e) => {
      if (!drag || drag.c !== c) return;
      try { hit.releasePointerCapture(e.pointerId); } catch (_) {}
      callRange(c, drag.edge, drag.pct, 'end');
      c.el.classList.remove('drag');
      drag = null;
      c.lv = -1; c.lr = '';        // let the next paint restore the live value readout
      lastRev = '';                // the band may have armed: let the grid re-key now
      sync(true);
    };
    hit.addEventListener('pointerup', end);
    hit.addEventListener('pointercancel', end);
  }
  function callRange(c, edge, pct, phase) {
    if (typeof window.sdCompactRangeDrag === 'function')
      window.sdCompactRangeDrag(c.p.id, edge, pct, phase);
  }
  function showEdge(c, edge, pct) {
    c.val.textContent = (edge === 'rangeMin' ? 'MIN ' : 'MAX ') + Math.round(pct) + '%';
  }
  function paintNow() {
    if (typeof window.sdCompactSnapshot !== 'function') return;
    const snap = window.sdCompactSnapshot();
    for (let i = 0; i < cards.length; i++) cards[i].p = snap.params[i] || cards[i].p;
    paint(snap);
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
      const lph = lanePhase(c.p, ph, snap.bars);   // this lane's own clock, not the shared one
      const v = clamp(laneValue(c.p, lph), 0, 1);
      const q = Math.round(v * 1000);
      if (q !== c.lv) {
        c.lv = q;
        c.arc.setAttribute('d', arc(KN / 2, KN / 2, KR, v));
        c.ind.setAttribute('transform', `rotate(${(A0 + (A1 - A0) * v).toFixed(1)},${KN / 2},${KN / 2})`);
        c.val.textContent = Math.round(v * 100) + '%';
        c.dot.setAttribute('cy', (3 + (1 - v) * (MVP_H - 6)).toFixed(2));
      }
      // the band ring, redrawn only when the band itself moved
      if (c.rng) {
        const sig = c.p.rangeOn ? (Math.round(c.p.rangeMin * 1000) + ':' + Math.round(c.p.rangeMax * 1000)) : '';
        if (sig !== c.lr) {
          c.lr = sig;
          if (sig) {
            c.rng.setAttribute('d', arcAB(KN / 2, KN / 2, RR, c.p.rangeMin, c.p.rangeMax));
            c.rng.removeAttribute('display');
            const a = capAt(c.p.rangeMin), b = capAt(c.p.rangeMax);
            for (const k in a) c.capa.setAttribute(k, a[k]);
            for (const k in b) c.capb.setAttribute(k, b[k]);
            c.capg.removeAttribute('display');
          } else { c.rng.setAttribute('display', 'none'); c.capg.setAttribute('display', 'none'); }
        }
      }
      // the curve travels at the LANE's rate too, so the dot and the scroll agree
      c.msc.setAttribute('transform', `translate(${(MVP_W / 2 - lph * LOOP_W).toFixed(2)},0)`);
    }
  }
  function sync(force) {
    if (!on || typeof window.sdCompactSnapshot !== 'function') return;
    const rev = window.sdCompactRevision();
    const snap = window.sdCompactSnapshot();
    // A rebuild replaces the DOM, which would kill an in-flight pointer capture, so any
    // live gesture holds the grid still. Arming a band changes the revision on the FIRST
    // frame of the drag, and a card drag reorders the DOM by hand - without this the grid
    // would tear itself down under the cursor in both cases.
    if (drag || cardDrag) {
      for (let i = 0; i < cards.length; i++) cards[i].p = snap.params[i] || cards[i].p;
      paint(snap); lastPhase = snap.phase;
      if (drag) showEdge(drag.c, drag.edge, drag.pct);   // paint owns the label; the drag wins it back
      return snap;
    }
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
  function setCompact(v, silent) {
    if (!wrap && !mount()) return;
    on = !!v;
    // Which view you were in is remembered, so reopening Stride puts you back where you
    // left off instead of always landing on the lane canvas (field report).
    if (!silent) { try { if (window.sdCompactSave) window.sdCompactSave(on); } catch (e) {} }
    document.body.classList.toggle('sd-compact-view', on);
    wrap.style.display = on ? 'grid' : 'none';
    if (host) host.style.display = on ? 'none' : '';
    const rail = document.getElementById('sd-inject-rail');
    if (rail) rail.style.display = on ? 'none' : '';
    if (on) { lastRev = ''; sync(true); kick(); }
    else if (typeof window.sdResizeCanvasNow === 'function') {
      // The canvas could not measure itself while it was hidden. Re-measure it NOW that it
      // is back on screen, then once more after layout settles, so leaving compact shows
      // the lanes immediately instead of a blank canvas waiting for a window resize.
      window.sdResizeCanvasNow();
      requestAnimationFrame(() => window.sdResizeCanvasNow());
    }
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

  // Restoring the remembered view. The prefs file can land either side of DOMContentLoaded,
  // so whichever arrives second does the work. Adopted silently: reading the preference
  // must never look like the user just chose it.
  let pendingOn = null, adopted = false;
  window.sdCompactAdopt = function (v) {
    pendingOn = !!v;
    applyPending();
  };
  function applyPending() {
    if (adopted || pendingOn === null) return;
    if (!wrap && !mount()) return;             // DOM not ready yet - boot() will retry
    adopted = true;
    const want = pendingOn;
    pendingOn = null;
    if (want) setCompact(true, true);
  }

  function boot() {
    mount();
    applyPending();
    // curves change without the lane set changing (draw, motion tool, motion load),
    // so re-read on the same beat the canvas persists. Cheap: a signature compare.
    window.addEventListener('sd-compact-refresh', () => sync(true));
    document.addEventListener('visibilitychange', () => { if (!document.hidden) kick(); });
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot);
  else boot();
})();
