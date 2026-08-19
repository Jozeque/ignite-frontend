/*
  REPTILE MODE - character overlay for the Stride wrapper.

  Presentation only. This file never touches lanes, curves, mappings, locks, plugin
  state, transport or serialization. It draws a creature over the UI and animates it.

  WRAPPER ONLY. Guarded on window.__STRIDE_WRAPPER__ so the desktop Electron app,
  which shares canvas.js, is completely unaffected.

  WINDOW BOUNDS: a plugin editor cannot paint outside its own bounds, so the creature
  cannot really rise above the Stride window. Instead activating the mode opens a
  CHARACTER ZONE at the top of the window and asks the host to grow the editor by
  exactly that height ('reptileZone' -> C++ setSize), so no canvas height is stolen.
  Deactivating shrinks it back. If the host refuses the resize the zone still opens,
  it just costs a little canvas - the mode degrades instead of breaking.

  ASSETS are swappable by design (see REP_ART): normalized anchors, no hard-coded
  dimensions around any particular drawing. Drop in a new set and nothing else moves.
*/
(function () {
  'use strict';
  if (!window.__STRIDE_WRAPPER__) return;          // desktop app: do nothing at all

  // ── art descriptor. Swap these and the layout follows automatically. ──
  const REP_ART = {
    idle:  'reptile_idle.webp',
    blink: 'reptile_blink.webp',
    blep:  'reptile_blep.webp',                    // tongue-out personality pose
    W: 760, H: 746,                                // natural art size
    EDGE: 661,                                     // wrist line: below it the fingers hang in FRONT of the UI
    MOUTH: [371, 413]                              // where the tongue leaves the face
  };
  const ZONE_H = 132;                              // character zone height at default scale

  const $ = (id) => document.getElementById(id);
  const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
  const easeOut = (t) => 1 - Math.pow(1 - t, 3);
  const easeInOut = (t) => (t < .5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2);
  const easeBack = (t) => { const c = 1.7; return 1 + (c + 1) * Math.pow(t - 1, 3) + c * Math.pow(t - 1, 2); };

  const st = {
    on: false, phase: 'hidden',                    // hidden | rising | idle | leaving
    rise: 1, scale: .30,
    face: { blink: 0, blep: 0 },
    body: { tilt: 0, ttilt: 0, dx: 0, tdx: 0, dy: 0, tdy: 0, fwd: 0 },
    breath: 0,
    tongue: { ext: 0, phase: 'idle', t: 0, ang: -Math.PI / 2, len: 0, hold: 0, target: null, wob: 0 },
    contact: { at: null, t: 0 },
    // floating defaults ON: holding the window from the desktop is the version this was
    // built for, and it costs Stride no height. Right-click the trigger to bring him
    // back inside the window instead.
    nextIdle: 0, track: { on: false, until: 0 }, floating: true, scaleMul: 1
  };
  const anim = [];
  let raf = 0, last = performance.now();
  function tween(dur, fn, done) { anim.push({ t: 0, dur, fn, done }); kick(); }
  function kick() { if (!raf) raf = requestAnimationFrame(frame); }

  /* ── DOM ─────────────────────────────────────────────────────────── */
  let zone, layer, svg, gRep, imgIdle, imgBlink, imgBlep, gTongue, pTongue, gContact;

  function build() {
    zone = document.createElement('div');
    zone.id = 'sd-rep-zone';
    zone.style.cssText = 'height:0;flex:none;overflow:visible;transition:height .32s cubic-bezier(.2,.8,.2,1);pointer-events:none';
    document.body.insertBefore(zone, document.body.firstChild);

    layer = document.createElement('div');
    layer.id = 'sd-rep-layer';
    layer.style.cssText = 'position:fixed;inset:0;z-index:9500;pointer-events:none';
    layer.innerHTML =
      '<svg id="sd-rep-svg" style="width:100%;height:100%;display:block" aria-hidden="true">' +
        '<defs>' +
          '<linearGradient id="sdRepTongue" gradientUnits="userSpaceOnUse">' +
            '<stop offset="0" stop-color="#b5615f"/><stop offset=".3" stop-color="#d07f76"/>' +
            '<stop offset=".75" stop-color="#dd8f57"/><stop offset="1" stop-color="#e0a054"/>' +
          '</linearGradient>' +
          '<filter id="sdRepGlow" x="-70%" y="-70%" width="240%" height="240%">' +
            '<feGaussianBlur stdDeviation="5" result="b"/>' +
            '<feMerge><feMergeNode in="b"/><feMergeNode in="SourceGraphic"/></feMerge>' +
          '</filter>' +
        '</defs>' +
        '<g id="sdRepContact" opacity="0"></g>' +
        '<g id="sdRepChar" opacity="0">' +
          '<image id="sdRepIdle"  x="0" y="0" preserveAspectRatio="none"/>' +
          '<image id="sdRepBlink" x="0" y="0" preserveAspectRatio="none" opacity="0"/>' +
          '<image id="sdRepBlep"  x="0" y="0" preserveAspectRatio="none" opacity="0"/>' +
        '</g>' +
        '<g id="sdRepTongueG" opacity="0"><path id="sdRepTonguePath" fill="url(#sdRepTongue)"/></g>' +
      '</svg>';
    document.body.appendChild(layer);

    svg = $('sd-rep-svg'); gRep = $('sdRepChar');
    imgIdle = $('sdRepIdle'); imgBlink = $('sdRepBlink'); imgBlep = $('sdRepBlep');
    gTongue = $('sdRepTongueG'); pTongue = $('sdRepTonguePath'); gContact = $('sdRepContact');
    [[imgIdle, REP_ART.idle], [imgBlink, REP_ART.blink], [imgBlep, REP_ART.blep]].forEach(([el, src]) => {
      el.setAttribute('href', src);
      el.setAttribute('width', REP_ART.W); el.setAttribute('height', REP_ART.H);
    });
  }

  /* ── placement: paws land on the top edge of the Stride chrome ────── */
  let px = 0, py = 0;
  // The creature's size is the size of the STRIP it adds at the top - that strip is the
  // whole cost of the feature, so it is what gets budgeted. It is deliberately NOT tied to
  // the window's width or height beyond a gentle nudge: a fixed, readable character that
  // stays the same whether Stride is small or maximised. Field report 2026-08-19: window-
  // relative sizing made it a speck on a small window and a poster on a big one.
  const ZONE_WANT = 152;                           // the strip we ask the host for
  let zoneGot = ZONE_WANT;                         // what the host could actually fit
  function place() {
    const w = window.innerWidth || 900;
    st.scale = clamp(zoneGot / REP_ART.EDGE, .10, .42);
    px = w / 2 - (REP_ART.W / 2) * st.scale;
    py = zoneH() - REP_ART.EDGE * st.scale;        // wrist line sits on the zone's bottom edge
    apply();
  }
  const zoneH = () => (st.on ? Math.round(REP_ART.EDGE * st.scale) + 4 : 0);
  // The host grants what fits on the display; scale to that rather than to the request.
  window.sdReptileZoneGranted = function (h) {
    if (!st.on) return;
    zoneGot = clamp(h || 0, 0, ZONE_WANT);
    zone.style.height = zoneGot + 'px';
    place();
  };
  const toScreen = (x, y) => [px + x * st.scale, py + y * st.scale];

  /* ── tongue ribbon ───────────────────────────────────────────────── */
  function tonguePath() {
    const T = st.tongue;
    if (T.ext <= 0.001) return '';
    const [mx, my] = toScreen(REP_ART.MOUTH[0] + st.body.dx, REP_ART.MOUTH[1] + st.body.dy);
    const maxLen = T.target ? Math.hypot(T.target[0] - mx, T.target[1] - my) : T.len;
    const len = maxLen * T.ext;
    const ang = T.target ? Math.atan2(T.target[1] - my, T.target[0] - mx) : T.ang;
    const ex = mx + Math.cos(ang) * len, ey = my + Math.sin(ang) * len;
    const nx = -Math.sin(ang), ny = Math.cos(ang);
    const sag = (48 + T.wob * 26) * st.scale * 2.2;
    const c1x = mx + Math.cos(ang) * len * .3 + nx * sag, c1y = my + Math.sin(ang) * len * .3 + ny * sag + 12;
    const c2x = mx + Math.cos(ang) * len * .7 - nx * sag * .55, c2y = my + Math.sin(ang) * len * .7 - ny * sag * .55 + 5;
    const N = 30, base = 20 * st.scale;
    const top = [], bot = [];
    for (let i = 0; i <= N; i++) {
      const t = i / N, mt = 1 - t;
      const x = mt * mt * mt * mx + 3 * mt * mt * t * c1x + 3 * mt * t * t * c2x + t * t * t * ex;
      const y = mt * mt * mt * my + 3 * mt * mt * t * c1y + 3 * mt * t * t * c2y + t * t * t * ey;
      const dx = 3 * mt * mt * (c1x - mx) + 6 * mt * t * (c2x - c1x) + 3 * t * t * (ex - c2x);
      const dy = 3 * mt * mt * (c1y - my) + 6 * mt * t * (c2y - c1y) + 3 * t * t * (ey - c2y);
      const l = Math.hypot(dx, dy) || 1, ux = -dy / l, uy = dx / l;
      let wdt = base * (1 - .7 * t);
      if (t > .82) wdt = base * (1 - .7 * t) + base * .55 * Math.sin((t - .82) / .18 * Math.PI);
      top.push([x + ux * wdt, y + uy * wdt]); bot.push([x - ux * wdt, y - uy * wdt]);
    }
    const pts = top.concat(bot.reverse());
    const g = document.getElementById('sdRepTongue');
    if (g) { g.setAttribute('x1', mx); g.setAttribute('y1', my); g.setAttribute('x2', ex); g.setAttribute('y2', ey); }
    return 'M' + pts.map(p => p[0].toFixed(1) + ',' + p[1].toFixed(1)).join(' L') + ' Z';
  }

  /* ── actions ─────────────────────────────────────────────────────── */
  function blink() { tween(215, p => { st.face.blink = p < .4 ? p / .4 : 1 - (p - .4) / .6; }, () => { st.face.blink = 0; }); }
  function blep() {                                    // tongue-out personality pose
    tween(900, p => { st.face.blep = p < .18 ? p / .18 : (p > .78 ? (1 - p) / .22 : 1); }, () => { st.face.blep = 0; });
  }
  function look(dir) { st.body.ttilt = dir * 2.6; st.body.tdx = dir * 10; kick();
    setTimeout(() => { st.body.ttilt = 0; st.body.tdx = 0; kick(); }, 1500); }
  function surprise() {
    tween(520, p => { const w = p < .26 ? p / .26 : Math.max(0, 1 - (p - .26) / .74);
      st.body.fwd = w * .05; st.body.tdy = -w * 14; st.face.blep = Math.min(1, w * 1.4); },
      () => { st.body.fwd = 0; st.body.tdy = 0; st.face.blep = 0; });
  }
  function flick() { const T = st.tongue; T.target = null; T.phase = 'flick'; T.t = 0;
    T.ang = -Math.PI / 2 + (Math.random() - .5) * .5; T.len = 150 * st.scale * 2; kick(); }
  function strikeAt(clientX, clientY) {
    const T = st.tongue;
    const [mx] = toScreen(REP_ART.MOUTH[0], REP_ART.MOUTH[1]);
    st.body.ttilt = clamp((clientX - mx) * .006, -3.5, 3.5);
    st.body.tdy = -5;
    setTimeout(() => {
      st.body.tdy = 0;
      T.target = [clientX, clientY]; T.phase = 'strike'; T.t = 0; T.hold = 950;
      st.contact.at = [clientX, clientY]; kick();
    }, 170);
    setTimeout(() => { st.body.ttilt = 0; kick(); }, 1800);
    kick();
  }
  function retract() { if (st.tongue.phase !== 'idle') { st.tongue.phase = 'back'; st.tongue.t = 0; kick(); } }

  /* ── activate / deactivate ───────────────────────────────────────── */
  function requestZone(h) {
    zone.style.height = h + 'px';
    try { if (window.sdReptileZoneRequest) window.sdReptileZoneRequest(h); } catch (e) {}
  }
  function activate() {
    if (st.on) return;
    st.on = true;
    st.face.blink = 0; st.face.blep = 0;
    document.body.classList.add('sd-reptile-on');
    // Turning him on has to HONOUR where he lives. This used to always raise the
    // in-window creature, so switching to floating while he was off left the preference
    // set but the gecko still standing inside Stride (field report 2026-08-19).
    if (st.floating) {
      st.phase = 'idle'; st.rise = 0;
      gRep.setAttribute('opacity', '0');
      requestZone(0);                              // he costs Stride no height out there
      try { if (window.sdReptileFloatRequest) window.sdReptileFloatRequest(true, st.scaleMul); } catch (e) {}
      paintTrigger();
      return;                                      // the native window runs its own climb
    }
    st.phase = 'rising'; st.rise = 1;
    gRep.setAttribute('opacity', '1');
    zoneGot = ZONE_WANT; place(); requestZone(ZONE_WANT);
    tween(1420, p => {
      let y;
      if (p < .17) { y = 1 - easeOut(clamp((p - .07) / .10, 0, 1)) * .42; }
      else if (p < .38) { y = 0.58 - easeInOut((p - .17) / .21) * .24; }
      else if (p < .60) { y = 0.34 - easeInOut((p - .38) / .22) * .15; }
      else if (p < .84) { y = 0.19 - easeInOut((p - .60) / .24) * .15; }
      else { y = 0.04 - easeBack((p - .84) / .16) * .04; }
      st.rise = clamp(y, -.03, 1);
    }, () => { st.rise = 0; st.phase = 'idle'; st.nextIdle = performance.now() + 900; setTimeout(blink, 120); });
  }
  function deactivate() {
    if (!st.on) return;
    st.phase = 'leaving'; retract();
    tween(1020, p => {
      if (p < .16) st.body.tdy = p / .16 * 7;
      else if (p < .74) st.rise = easeInOut((p - .16) / .58) * .60;
      else if (p < .86) st.rise = .60;
      else st.rise = .60 + easeInOut((p - .86) / .14) * .45;
      if (p > .70 && p < .88) { const b = (p - .70) / .18; st.face.blink = b < .5 ? b * 2 : 1 - (b - .5) * 2; }
    }, () => {
      st.on = false; st.phase = 'hidden'; st.rise = 1; st.face.blink = 0; st.body.tdy = 0;
      try { window.sdReptileFloatRequest && window.sdReptileFloatRequest(false); } catch (e) {}
      gRep.setAttribute('opacity', '0');
      requestZone(0);
      document.body.classList.remove('sd-reptile-on');
      paintTrigger();
    });
    paintTrigger();
  }
  function toggle() { st.on ? deactivate() : activate(); paintTrigger(); }

  /* ── OPT-IN: float the character over the desktop ─────────────────
     Off by default. When on, the in-window creature and its strip step aside entirely
     so there is only ever ONE gecko, and a C++ always-on-top window takes over above
     the plugin. The tongue stays behind with the in-window version for now: the
     floating window is drawn natively and has no tongue of its own yet. */
  function setFloating(v) {
    const want = !!v;
    if (want === st.floating) return;
    st.floating = want;
    // While he is OFF this only records the preference - activate() honours it. Firing
    // the host request here instead was the bug that left him standing in the window.
    if (!st.on) { paintTrigger(); return; }
    try { if (window.sdReptileFloatRequest) window.sdReptileFloatRequest(want, st.scaleMul); } catch (e) {}
    if (want) {
      retract();
      gRep.setAttribute('opacity', '0');
      requestZone(0);                              // give the height back to Stride
    } else {
      st.phase = 'idle'; st.rise = 0;              // he walks back in already standing
      gRep.setAttribute('opacity', '1');
      zoneGot = ZONE_WANT; place(); requestZone(ZONE_WANT);
      kick();
    }
    paintTrigger();
    const stt = document.getElementById('sd-canvas-status');
    if (stt) stt.textContent = want ? 'Reptile floating above Stride' : 'Reptile back inside Stride';
  }

  /* ── idle scheduler: mostly stillness ────────────────────────────── */
  function idleTick(now) {
    if (st.phase !== 'idle' || now < st.nextIdle) return;
    const r = Math.random();
    if (r < .38) blink();
    else if (r < .52) look(Math.random() < .5 ? -1 : 1);
    else if (r < .62) flick();
    else if (r < .70) blep();
    else if (r < .78) { st.body.ttilt = (Math.random() < .5 ? -1 : 1) * 2.8;
                        setTimeout(() => { st.body.ttilt = 0; kick(); }, 1500); }
    st.nextIdle = now + 2600 + Math.random() * 4400;
  }

  /* ── frame ───────────────────────────────────────────────────────── */
  let lastTx = '', lastBl = -1, lastBp = -1;
  function apply() {
    const hide = REP_ART.EDGE - 30;
    const s = st.scale, hs = 1 + st.body.fwd;
    const tx = `translate(${(px + st.body.dx * s).toFixed(2)},${(py + (st.rise * hide + st.breath * 2 + st.body.dy) * s).toFixed(2)}) ` +
               `scale(${(s * hs).toFixed(5)}) ` +
               `rotate(${st.body.tilt.toFixed(2)},${REP_ART.W / 2},${REP_ART.EDGE})`;
    if (tx !== lastTx) { gRep.setAttribute('transform', tx); lastTx = tx; }
    const bl = +st.face.blink.toFixed(3), bp = +st.face.blep.toFixed(3);
    if (bl !== lastBl) { imgBlink.setAttribute('opacity', bl); lastBl = bl; }
    if (bp !== lastBp) { imgBlep.setAttribute('opacity', bp); lastBp = bp; }
  }
  function frame(now) {
    raf = 0;
    const dt = Math.min(64, now - last); last = now;
    for (let i = anim.length - 1; i >= 0; i--) {
      const a = anim[i]; a.t += dt; const p = clamp(a.t / a.dur, 0, 1); a.fn(p);
      if (p >= 1) { if (a.done) a.done(); anim.splice(i, 1); }
    }
    idleTick(now);
    st.breath = st.phase === 'idle' ? Math.sin(now / 1800) : 0;
    st.body.tilt += (st.body.ttilt - st.body.tilt) * .07;
    st.body.dx += (st.body.tdx - st.body.dx) * .12;
    st.body.dy += (st.body.tdy - st.body.dy) * .12;
    apply();

    const T = st.tongue;
    if (T.phase !== 'idle') {
      T.t += dt;
      if (T.phase === 'flick') { const D = 250;
        T.ext = T.t < D * .4 ? easeOut(T.t / (D * .4)) : 1 - easeOut(clamp((T.t - D * .4) / (D * .6), 0, 1));
        if (T.t > D) { T.phase = 'idle'; T.ext = 0; }
      } else if (T.phase === 'strike') { const OUT = 135;
        if (T.t < OUT) T.ext = easeOut(T.t / OUT);
        else {
          T.ext = 1 + Math.sin((T.t - OUT) / 90) * .016 * Math.exp(-(T.t - OUT) / 260);
          T.wob = Math.sin((T.t - OUT) / 220) * .5;
          if (st.contact.at) st.contact.t = clamp((T.t - OUT) / 120, 0, 1);
          if (T.t > OUT + T.hold) { T.phase = 'back'; T.t = 0; }
        }
      } else { const B = 170, s2 = clamp(T.t / B, 0, 1);
        T.ext = (1 + .05 * Math.sin(s2 * Math.PI)) * (1 - easeOut(s2));
        if (st.contact.at) st.contact.t = 1 - s2;
        if (T.t > B) { T.phase = 'idle'; T.ext = 0; T.target = null; st.contact.at = null; st.contact.t = 0; T.wob = 0; }
      }
      pTongue.setAttribute('d', tonguePath());
      gTongue.setAttribute('opacity', st.on ? 1 : 0);
    } else if (gTongue.getAttribute('opacity') !== '0') gTongue.setAttribute('opacity', 0);

    const C = st.contact;
    if (C.at && C.t > .01) {
      const r = 13 + C.t * 9;
      gContact.setAttribute('opacity', (C.t * .95).toFixed(2));
      gContact.innerHTML =
        `<circle cx="${C.at[0]}" cy="${C.at[1]}" r="${(r * 1.9).toFixed(1)}" fill="#c6712b" opacity="${(.10 * C.t).toFixed(2)}"/>` +
        `<circle cx="${C.at[0]}" cy="${C.at[1]}" r="${r.toFixed(1)}" fill="none" stroke="#dd9a52" stroke-width="${(1.6 * C.t).toFixed(2)}" opacity="${(.7 * C.t).toFixed(2)}" filter="url(#sdRepGlow)"/>`;
    } else if (gContact.getAttribute('opacity') !== '0') { gContact.setAttribute('opacity', 0); gContact.innerHTML = ''; }

    // park when there is nothing left to do: mode OFF costs literally zero
    if (st.on || anim.length || st.tongue.phase !== 'idle' || st.contact.at) kick();
  }

  /* ── size ────────────────────────────────────────────────────────────
     Only meaningful while he is floating (in-window he is bounded by the strip the host
     granted). Persisted through the prefs FILE, not localStorage alone. */
  function setSize(mul) {
    const v = clamp(Math.round(mul * 100) / 100, .55, 1.5);
    if (v === st.scaleMul) return;
    st.scaleMul = v;
    if (st.on && st.floating) {
      try { if (window.sdReptileFloatRequest) window.sdReptileFloatRequest(true, v); } catch (e) {}
    }
    try { if (window.sdReptileScaleSave) window.sdReptileScaleSave(v); } catch (e) {}
    paintTrigger();
  }
  // Adopted from the prefs file on boot: take the value, do NOT write it back.
  window.sdReptileScaleAdopt = function (v) {
    if (typeof v !== 'number' || !(v > 0)) return;
    st.scaleMul = clamp(Math.round(v * 100) / 100, .55, 1.5);
    if (st.on && st.floating) {
      try { if (window.sdReptileFloatRequest) window.sdReptileFloatRequest(true, st.scaleMul); } catch (e) {}
    }
  };

  /* ── a lick at whatever just got mapped ──────────────────────────────
     canvas.js announces a freshly mapped lane; he points at it. The in-window creature
     owns its tongue in SVG; the floating one is drawn natively, so the host draws that
     one. Either way this is presentation: nothing about the mapping depends on it. */
  function laneTarget(id) {
    const card = document.querySelector('#sd-compact .sdc[data-id="' + String(id).replace(/"/g, '') + '"]');
    if (card) { const r = card.getBoundingClientRect(); return [r.left + r.width * 0.5, r.top + r.height * 0.42]; }
    try {
      const p = window.sdLaneScreenPoint && window.sdLaneScreenPoint(id);
      if (p) return [p.x, p.y];
    } catch (e) {}
    return null;
  }
  function lickAt(id) {
    const t = laneTarget(id);
    if (!t) return;
    if (st.floating) { try { window.sdReptileStrike && window.sdReptileStrike(t[0], t[1]); } catch (e) {} }
    else strikeAt(t[0], t[1]);
  }

  /* ── the hidden trigger ──────────────────────────────────────────── */
  let trigger = null, sizer = null;
  function paintTrigger() {
    if (!trigger) return;
    trigger.style.opacity = st.on ? '.95' : '.28';
    trigger.style.outline = st.floating ? '1px solid rgba(198,113,43,.55)' : 'none';
    trigger.style.background = st.on ? 'rgba(198,113,43,.18)' : 'transparent';
    // The resizer only exists while he is actually out there to resize.
    if (sizer) sizer.style.display = (st.on && st.floating) ? 'flex' : 'none';
  }
  function mountSizer(after) {
    sizer = document.createElement('span');
    sizer.id = 'sd-rep-sizer';
    sizer.className = 'titlebar-no-drag';
    sizer.style.cssText = 'display:none;align-items:center;gap:2px;margin-left:4px;flex:none';
    [['-', -0.12, 'Smaller'], ['+', 0.12, 'Bigger']].forEach(([txt, d, tip]) => {
      const b = document.createElement('button');
      b.type = 'button';
      b.textContent = txt;
      b.title = tip;
      b.className = 'titlebar-no-drag';
      b.style.cssText = 'width:13px;height:13px;line-height:11px;border-radius:3px;font-size:11px;' +
        'font-weight:800;color:#c8c3ba;background:rgba(255,255,255,.06);opacity:.5;' +
        'transition:opacity .2s;flex:none;padding:0';
      b.addEventListener('mouseenter', () => { b.style.opacity = '1'; });
      b.addEventListener('mouseleave', () => { b.style.opacity = '.5'; });
      b.addEventListener('click', (e) => { e.stopPropagation(); setSize(st.scaleMul + d); });
      sizer.appendChild(b);
    });
    if (after && after.parentNode) after.parentNode.insertBefore(sizer, after.nextSibling);
  }
  function mountTrigger() {
    const bar = document.querySelector('.titlebar-drag');
    if (!bar) return;
    trigger = document.createElement('button');
    trigger.id = 'sd-rep-trigger';
    trigger.type = 'button';
    trigger.className = 'titlebar-no-drag';
    trigger.title = '';
    trigger.style.cssText = 'width:16px;height:16px;border-radius:4px;display:flex;align-items:center;' +
      'justify-content:center;opacity:.28;transition:opacity .25s,background .25s;margin-left:10px;flex:none';
    trigger.innerHTML = '<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" ' +
      'stroke-width="1.9" stroke-linecap="round"><path d="M2.6 12.6c2.4-3.4 5.6-5.1 9.4-5.1s7 1.7 9.4 5.1' +
      'c-2.4 3.4-5.6 5.1-9.4 5.1s-7-1.7-9.4-5.1z"/><path d="M12 9.1v7"/></svg>';
    trigger.addEventListener('mouseenter', () => { trigger.style.opacity = '.85'; });
    trigger.addEventListener('mouseleave', paintTrigger);
    trigger.addEventListener('click', toggle);
    trigger.addEventListener('contextmenu', (e) => { e.preventDefault(); setFloating(!st.floating); });
    const fs = document.getElementById('sd-fullscreen-btn');
    if (fs && fs.parentNode) fs.parentNode.insertBefore(trigger, fs.nextSibling); else bar.appendChild(trigger);
    mountSizer(trigger);
    // A freshly mapped param gets a lick. Late-bound so nothing here loads before canvas.js.
    window.addEventListener('sd-lane-mapped', (e) => {
      if (!st.on) return;
      const id = e && e.detail && e.detail.ids && e.detail.ids[0];
      if (id == null) return;
      setTimeout(() => lickAt(id), 110);        // let the new lane paint before pointing at it
    });
  }

  /* ── public surface (dev/test + future wiring) ───────────────────── */
  window.strideReptile = {
    activate, deactivate, toggle, blink, blep, flick, surprise, retract,
    look, strikeAt,
    strikeEl: (el) => { if (!el) return; const r = el.getBoundingClientRect();
                        strikeAt(r.left + r.width / 2, r.top + r.height / 2); },
    isOn: () => st.on,
    setFloating, isFloating: () => st.floating,
    setSize, getSize: () => st.scaleMul, lickAt,
    setArt: (o) => { Object.assign(REP_ART, o || {});
                     [[imgIdle, REP_ART.idle], [imgBlink, REP_ART.blink], [imgBlep, REP_ART.blep]]
                       .forEach(([el, src]) => { el.setAttribute('href', src);
                         el.setAttribute('width', REP_ART.W); el.setAttribute('height', REP_ART.H); });
                     place(); },
    _state: st
  };

  function boot() {
    build(); mountTrigger(); place();
    window.addEventListener('resize', () => { place(); if (st.on) requestZone(zoneH()); });
    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape' && st.tongue.phase !== 'idle') retract();
    });
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot);
  else boot();
})();
