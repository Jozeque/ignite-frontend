/*
  JUCE WebView shim for the Stride wrapper.
  Replaces the three globals the real Stride UI expects:
    window.stride       (Electron IPC)      -> localStorage + no-ops
    window.strideLink   (M4L WebSocket)     -> JUCE bridge (emitEvent 'sl_send' / addEventListener 'sl_event')
    window.strideCloud  (cloud generation)  -> offline stub
  Plus: an on-screen error readout, single-level device-remove undo, and the wrapper
  control bar (favorites / add / map / open / clear + device list) built into the
  in-flow #stride-wrap-controls strip so nothing floats over the canvas.

  Loaded in <head> BEFORE everything else, so the globals exist when the inline
  activation script and the bottom scripts (canvas.js et al.) run.
*/
(function () {
  'use strict';

  // Mark this as the VST wrapper so the shared canvas.js can enable wrapper-only
  // behavior (e.g. the live drive-flush on every curve change) without touching
  // the desktop app.
  window.__STRIDE_WRAPPER__ = true;

  // ── on-screen error readout ──────────────────────────────────────
  var errBox = null;
  function showErr(msg) {
    try {
      if (!errBox) {
        errBox = document.createElement('div');
        errBox.style.cssText = 'position:fixed;left:0;right:0;bottom:0;z-index:99999;background:#7f1d1d;color:#fff;font:11px/1.4 monospace;padding:6px 10px;white-space:pre-wrap;max-height:35%;overflow:auto';
        (document.body || document.documentElement).appendChild(errBox);
      }
      errBox.textContent = 'JS: ' + msg;
    } catch (e) {}
  }
  window.addEventListener('error', function (e) {
    showErr((e && e.message ? e.message : String(e)) + '  @' + ((e && e.filename) || '') + ':' + ((e && e.lineno) || ''));
  });
  window.addEventListener('unhandledrejection', function (e) {
    showErr('promise: ' + (e && e.reason ? (e.reason.message || e.reason) : 'unknown'));
  });

  // ── JUCE backend ─────────────────────────────────────────────────
  var B = (window.__JUCE__ && window.__JUCE__.backend) || null;
  function emit(name, payload) { try { if (B) B.emitEvent(name, payload || {}); } catch (e) {} }
  function listen(name, fn) { try { if (B) B.addEventListener(name, fn); } catch (e) {} }

  // Demo mode: the license gate (index.html) tells the engine whether to run capped
  // (no VST entitlement) or full. Native code enforces the caps; this just relays the flag.
  window.strideSetDemoMode = function (d) { emit('setDemoMode', { demo: !!d }); };

  // Fullscreen (maximize) toggle -> the C++ editor resizes the window; the icon reflects state.
  window.sdToggleFullscreen = function () { emit('toggleFullscreen'); };

  // REPTILE MODE character zone. A plugin editor cannot paint outside its own bounds,
  // so the creature gets a strip at the top of the window and the host GROWS by exactly
  // that height - the canvas keeps its size instead of paying for the character. h=0
  // restores the original height. If a host refuses the resize the strip still opens,
  // it just costs a little canvas, so the mode degrades rather than breaks.
  window.sdReptileZoneRequest = function (h) { emit('reptileZone', { h: Math.max(0, h | 0) }); };
  // OPT-IN: float the character over the desktop instead of inside the window. Creates a
  // second always-on-top window in C++, which is why it is off by default - see the risk
  // note at the top of ReptileOverlay.h.
  window.sdReptileFloatRequest = function (on, s, c) {
    emit('reptileFloat', { on: !!on, s: (typeof s === 'number' && s > 0 ? s : 1),
                           c: (typeof c === 'number' ? c : 0) });
  };
  // Flick the tongue at a point in THIS page's coordinates; the host converts to screen.
  window.sdReptileStrike = function (x, y) { emit('reptileStrike', { x: x | 0, y: y | 0 }); };
  // Move the target of a tongue already in flight, without restarting it.
  window.sdReptileAim    = function (x, y) { emit('reptileAim',    { x: x | 0, y: y | 0 }); };
  // His size is a preference, so it belongs in the prefs FILE, not only in the WebView's
  // localStorage (which is one shared profile across every instance in the session).
  window.sdReptileScaleSave = function (v) { try { prefsWrite('repScale', v); } catch (e) {} };
  window.sdReptileCharSave  = function (v) { try { prefsWrite('repChar', v); } catch (e) {} };
  // Which VIEW you were last in - the lane canvas or the parameter cards.
  window.sdCompactSave      = function (v) { try { prefsWrite('compactOn', !!v); } catch (e) {} };

  // The host answers with the strip it could actually FIT (a tall window near the bottom
  // of the display gets less than it asked for). The character scales to what it got.
  listen('reptileZoneState', function (d) {
    try { if (window.sdReptileZoneGranted) window.sdReptileZoneGranted(Math.max(0, (d && d.h) | 0)); }
    catch (e) { showErr('reptileZoneState: ' + e.message); }
  });
  listen('fullscreenState', function (d) {
    var ic = document.getElementById('sd-fs-icon'), btn = document.getElementById('sd-fullscreen-btn');
    if (! ic) return;
    var on = !!(d && d.on);
    ic.setAttribute('d', on ? 'M9 4v5H4 M15 4v5h5 M9 20v-5H4 M15 20v-5h5'      // restore (corners in)
                            : 'M4 9V4h5 M20 9V4h-5 M4 15v5h5 M20 15v5h-5');    // maximize (corners out)
    if (btn) btn.title = on ? 'Exit fullscreen (restore size)' : 'Fullscreen (maximize)';
  });

  // Pin modes: snap the host window to EXACTLY half the screen (bottom half / right half),
  // the C++ editor does the geometry. Clicking the active pin again unpins (restores size).
  var _pinMode = '';
  window.sdSetPin = function (mode) { emit('setPin', { mode: _pinMode === mode ? 'off' : mode }); };
  listen('pinState', function (d) {
    _pinMode = (d && d.mode) || '';
    var b = document.getElementById('sd-pin-bottom-btn'), s = document.getElementById('sd-pin-side-btn');
    if (b) b.className = 'titlebar-no-drag transition-colors mr-2 ' + (_pinMode === 'bottom' ? 'text-orange-400' : 'text-zinc-500 hover:text-orange-400');
    if (s) s.className = 'titlebar-no-drag transition-colors mr-2 ' + (_pinMode === 'side'   ? 'text-orange-400' : 'text-zinc-500 hover:text-orange-400');
  });

  // ── Collapse the top bar → MORE CANVAS ──────────────────────────
  // Hides both toolbar rows outright; the device/control bar (chain chips + Add/Map/
  // Keys/Unmap/Clear) stays whole so mapping keeps working. Nothing moves, nothing is
  // added — every freed pixel goes to the lanes. KEYS keyswitches keep firing the tools
  // while collapsed (they call the functions, not the hidden buttons). Persisted.
  var _tcOn = false;
  window.sdSetTopCollapsed = function (on) {
    _tcOn = !! on;
    // THREE toolbars, because the wrapper BOOTS INTO COMPACT (setupCompact below): the
    // visible top bar in the wrapper's default state is #sd-compact-toolbar, not the
    // full-mode rows — hiding only rows 1+2 read as "does nothing" (field report
    // 2026-07-27). All three get the inline treatment so collapse holds in BOTH modes.
    var r1 = document.getElementById('sd-toolbar-row1'), r2 = document.getElementById('sd-toolbar-row2');
    var ct = document.getElementById('sd-compact-toolbar');
    var ic = document.getElementById('sd-collapse-icon'), btn = document.getElementById('sd-collapse-btn');
    // INLINE display, not the `hidden` class: the rows carry Tailwind's `flex` utility and
    // the CDN runtime can order `.flex` after `.hidden`, which silently wins — the class
    // toggle did nothing (field report 2026-07-27). Inline style outranks any utility.
    // '' on expand falls back to the stylesheet, so each bar returns only in its own mode.
    if (r1) r1.style.display = _tcOn ? 'none' : '';
    if (r2) r2.style.display = _tcOn ? 'none' : '';
    if (ct) ct.style.display = _tcOn ? 'none' : '';
    if (ic) ic.setAttribute('d', _tcOn ? 'M5 9l7 5 7-5' : 'M5 15l7-5 7 5');   // chevron flips
    if (btn) btn.title = _tcOn ? 'Show the toolbar' : 'Hide the toolbar — full-height canvas (the device bar stays)';
    try { window.dispatchEvent(new Event('resize')); } catch (e) {}            // canvas re-measures its container
    if (window.sdDrawCanvasGrid) try { window.sdDrawCanvasGrid(); } catch (e) {}   // lanes reflow into the freed space
    try { localStorage.setItem('sd_top_collapsed', _tcOn ? '1' : '0'); } catch (e) {}
  };
  window.sdToggleTopCollapse = function () { window.sdSetTopCollapsed(! _tcOn); };
  // Boot: restore the persisted state once the DOM is up (shim loads at end of body).
  try { if (localStorage.getItem('sd_top_collapsed') === '1') window.sdSetTopCollapsed(true); } catch (e) {}

  // Discovery Pass expired mid-session (Stride stayed open) -> pop the "ended" overlay live.
  listen('passExpired', function () { if (window.sdPassExpired) window.sdPassExpired(); });

  // Demo move/freeze countdown -> the badge status text (engine pushes it every ~second).
  listen('demo_freeze', function (d) {
    var s = document.getElementById('sd-demo-status');
    var b = document.getElementById('sd-demo-badge');
    if (! s) return;
    if (d && d.frozen) {                                               // FROZEN — the countdown replaces "live"
      s.textContent = '⏸ resumes in ' + (d.secs || 0) + 's';
      s.style.cssText = 'font-size:16px;font-weight:800;color:#fb923c;letter-spacing:.01em';
      if (b) b.style.borderColor = 'rgba(251,146,60,.9)';
    } else if (d && d.playing) {                                       // PLAYING — actively modulating (counts 10s -> 0 to the freeze)
      s.textContent = '● live ' + (d.secs || 0) + 's';
      s.style.cssText = 'font-size:12px;font-weight:800;color:#4ade80;letter-spacing:.05em';
      if (b) b.style.borderColor = 'rgba(74,222,128,.6)';
    } else {                                                          // IDLE — nothing moving yet
      s.textContent = 'press play';
      s.style.cssText = 'font-size:10px;font-weight:600;color:#71717a;letter-spacing:.04em';
      if (b) b.style.borderColor = 'rgba(249,115,22,.4)';
    }
  });

  // ── license gate bridge (request/response to the C++ gate) ───────
  var _licPending = {}, _licSeq = 0;
  function _licCall(op, payload) {
    return new Promise(function (resolve) {
      var id = ++_licSeq; _licPending[id] = resolve;
      emit('license', Object.assign({ reqId: id, op: op }, payload || {}));
      setTimeout(function () { if (_licPending[id]) { delete _licPending[id]; resolve({ success: false, valid: false, error: 'License check timed out' }); } }, 13000);
    });
  }
  listen('licenseReply', function (d) {
    if (! d) return; var r = _licPending[d.reqId];
    if (r) { delete _licPending[d.reqId]; r(d.result || {}); }
  });

  // Single-level undo for device removal: Ctrl+Z right after removing (while the toast is up),
  // or click the toast's Undo. Outside that window Ctrl+Z falls through to the canvas curve-undo.
  var _undoArmed = false, _undoToast = null, _undoTimer = 0;
  var _devFilter = null;   // which chain device the canvas is filtered to (null = all)
  function _hideUndoToast() { _undoArmed = false; if (_undoToast) _undoToast.style.display = 'none'; if (_undoTimer) { clearTimeout(_undoTimer); _undoTimer = 0; } }
  function _doUndoRemove() { if (! _undoArmed) return; _undoArmed = false; emit('undoRemove'); _hideUndoToast(); }
  // Arm the single-level device-undo window SILENTLY — no toast/popup. Users just
  // hit Ctrl+Z right after a remove/clear if they want it back; no need to prompt.
  function _armUndo(name, msg) {
    _undoArmed = true;
    if (_undoTimer) clearTimeout(_undoTimer);
    _undoTimer = setTimeout(_hideUndoToast, 7000);   // Ctrl+Z window (invisible)
  }
  // ── Ableton computer-MIDI-keyboard keys ──────────────────────────
  // Live's QWERTY note set (A W S E D F T G Y H U J K O L P + Z/X octave, C/V velocity).
  // What this block does is RESERVE them: with the keyboard mode on, a note letter must
  // never also trigger something in Stride. Delivery is NOT done here —
  //   macOS   : the NSEvent monitor takes these keys before the WebView can even see them.
  //             Anything routed through the page is already too late: WKWebView round-trips
  //             every unhandled key through the web process, which is what made notes
  //             arrive late and with random lengths (down and up are delayed separately).
  //   Windows : delivery is currently OFF (see g_strideWinNoteForward in PluginEditor.cpp) —
  //             the PostMessage'd letters were reaching Live's SHORTCUT handler, not its
  //             typing keyboard. The emit below stays so flipping that flag is all it takes.
  var NOTE_KEYS = { a:1, w:1, s:1, e:1, d:1, f:1, t:1, g:1, y:1, h:1, u:1, j:1, k:1, o:1, l:1, p:1, z:1, x:1, c:1, v:1 };
  var _notesDown = {};   // keys we sent a DOWN for — their UP always forwards, whatever is held by then (else: stuck note)
  // Are the note letters RESERVED for the DAW's typing keyboard? Ableton only — native
  // tells us on boot. In any other host we leave the letters completely alone: we give
  // them no note behavior there, so swallowing 20 keys would be pure loss.
  var _noteKeysReserved = false;
  listen('hostInfo', function (d) {
    _noteKeysReserved = !!(d && d.ableton);
    // Show the COMPILED-IN version in the title bar — the running build identifies itself.
    try {
      var vEl = document.getElementById('sd-version');
      if (vEl && d && d.ver) vEl.textContent = 'v' + String(d.ver);
    } catch (e) {}
    // Stride Bundle: reveal the tab strip. The Tendril tab hands the CANVAS AREA to
    // the embedded Tendril editor - Stride's titlebar/toolbars stay live above it, so
    // the strip is always reachable. The page reports the lanes region's rect.
    try {
      if (d && d.bundle) {
        var bt = document.getElementById('sd-bundle-tabs');
        if (bt) bt.style.display = 'flex';
        var _rq = function () {
          var el = document.getElementById('sd-canvas-container');
          if (!el) return null;
          var r = el.getBoundingClientRect();
          return { x: Math.round(r.left), y: Math.round(r.top), w: Math.round(r.width), h: Math.round(r.height) };
        };
        var _paint = function (t) {
          var base = 'text-[9px] font-black uppercase tracking-widest px-2 py-0.5 rounded-sm ';
          var a = document.getElementById('sd-tab-stride'), b = document.getElementById('sd-tab-tendril');
          if (a) a.className = base + (t === 'stride' ? 'text-orange-400 bg-white/5' : 'text-zinc-500 hover:text-orange-400 transition-colors');
          if (b) b.className = base + (t === 'tendril' ? 'text-orange-400 bg-white/5' : 'text-zinc-500 hover:text-orange-400 transition-colors');
        };
        window._sbTendrilOn = false;
        window._sbTendrilRect = _rq;
        // THE WALL (2026-08-30): Tendril's UI lives in THIS page as an iframe over the
        // canvas area - one webview, no native-window seams. The tab pair swaps views
        // in pure DOM; C++ only hears the bridge events relayed below.
        var _twFrame = null;
        var _twShow = function (on) {
          try {
            if (on && !_twFrame) {
              var host = document.getElementById('sd-canvas-container');
              if (!host) return;
              _twFrame = document.createElement('iframe');
              _twFrame.id = 'sd-tendril-wall';
              _twFrame.src = 'crucible_webui.html?v=' + Date.now();
              _twFrame.style.cssText = 'position:absolute;inset:0;width:100%;height:100%;border:0;z-index:70;background:#0d0b09;display:block';
              host.appendChild(_twFrame);
              if (!window._twPump) {
                window._twPump = 1;
                ['init', 'params', 'frame'].forEach(function (n) {
                  listen(n, function (d) { try { if (_twFrame && _twFrame.contentWindow) _twFrame.contentWindow.postMessage({ t: n, d: d }, '*'); } catch (e) {} });
                });
                window.addEventListener('message', function (ev) {
                  var m = ev && ev.data;
                  if (m && m.emit) emit(m.emit, m.payload || {});
                });
              }
            }
            if (_twFrame) _twFrame.style.display = on ? 'block' : 'none';
          } catch (e) {}
        };
        var _paint = function (t) {
          var base = 'text-[9px] font-black uppercase tracking-widest px-2 py-0.5 rounded-sm ';
          var a = document.getElementById('sd-tab-stride'), b = document.getElementById('sd-tab-tendril');
          if (a) a.className = base + (t === 'stride' ? 'text-orange-400 bg-white/5' : 'text-zinc-500 hover:text-orange-400 transition-colors');
          if (b) b.className = base + (t === 'tendril' ? 'text-orange-400 bg-white/5' : 'text-zinc-500 hover:text-orange-400 transition-colors');
        };
        var tT = document.getElementById('sd-tab-tendril');
        if (tT && !tT._sbWired) { tT._sbWired = 1; tT.onclick = function () { _paint('tendril'); _twShow(true); }; }
        var tS = document.getElementById('sd-tab-stride');
        if (tS && !tS._sbWired) { tS._sbWired = 1; tS.style.display = ''; tS.onclick = function () { _paint('stride'); _twShow(false); }; }
        window._sbTendrilWall = _twShow;   // the device chip reuses this
        if (!window._sbTendrilRsz) {
          window._sbTendrilRsz = 1;
          var _rt = 0;
          window.addEventListener('resize', function () {
            if (!window._sbTendrilOn) return;
            clearTimeout(_rt);
            _rt = setTimeout(function () { emit('bundleTab', { tab: 'tendril', rect: _rq() }); }, 120);
          });
        }
      }
    } catch (e) {}
    // Pins are hidden on mac until the window-move math is mac-tester-validated
    // (untested Y-flip; prime suspect in the 2026-07-28 window-chaos report).
    try {
      if (d && d.mac) {
        var pb = document.getElementById('sd-pin-bottom-btn'), ps = document.getElementById('sd-pin-side-btn');
        if (pb) pb.style.display = 'none';
        if (ps) ps.style.display = 'none';
      }
    } catch (e) {}
  });
  // macOS NEVER swallows a note key in the page. Native takes them ahead of the WebView,
  // so if one still reaches us it means native deliberately stood down — and swallowing it
  // then is fatal: preventDefault tells WebKit the page handled the key, which suppresses
  // the re-injection that is the ONLY way it would otherwise reach Live. The key would
  // simply vanish. Getting out of the way costs a late note; swallowing costs the note.
  var _macNoSwallow = /Mac/i.test(navigator.platform || '');
  function _noteTyping() {
    var el = document.activeElement;
    return !!(el && (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.tagName === 'SELECT' || el.isContentEditable));
  }
  // Tell native when a text field has focus. macOS takes note keys BEFORE the WebView can
  // see them, so it has to stand down while the user is typing a license key / plugin
  // search / BPM — otherwise those letters would play notes instead of landing in the field.
  var _textFocusOn = false;
  function _pushTextFocus() {
    var on = _noteTyping();
    if (on === _textFocusOn) return;
    _textFocusOn = on;
    emit('textFocus', { on: on });
  }
  document.addEventListener('focusin', _pushTextFocus, true);
  // focusout fires BEFORE the next element takes focus — settle first, then read.
  document.addEventListener('focusout', function () { setTimeout(_pushTextFocus, 0); }, true);
  // Self-heal: focus can die WITHOUT any focus event (a focused node removed from the
  // DOM fires nothing in WebKit). A stale textFocus=true silently kills note keys on
  // macOS — cheap periodic re-sync (change-detected in _pushTextFocus) makes any such
  // latch heal within 1.5s instead of lasting until reload.
  setInterval(_pushTextFocus, 1500);
  function _noteKeyOf(e) {
    // Live's piano is POSITIONAL (scan codes — AZERTY/Hebrew get the same piano shape),
    // so filter by the PHYSICAL key; native converts it to the real scancode. The typed
    // character is only a fallback for events that don't carry a code.
    var c = e.code || '';
    if (c.indexOf('Key') === 0 && c.length === 4) { var p = c.charAt(3).toLowerCase(); return NOTE_KEYS[p] ? p : ''; }
    var k = e.key || '';
    if (/^[a-zA-Z]$/.test(k)) { k = k.toLowerCase(); return NOTE_KEYS[k] ? k : ''; }
    return '';
  }
  // canvas.js calls this when a key belongs to the DAW rather than to Stride: today only
  // undo and redo, when the user has not been working in Stride. Wrapper-only, so the
  // desktop app's canvas simply finds nothing to call.
  window.sdForwardKeyToHost = function (k) {
    try { emit('transportKey', { key: k }); } catch (e) {}
  };

  window.addEventListener('keydown', function (e) {
    if (e.key === 'Escape' && pluginModal) { e.preventDefault(); e.stopImmediatePropagation(); closePluginBrowser(); return; }
    var z = (e.key === 'z' || e.key === 'Z') && (e.ctrlKey || e.metaKey) && ! e.shiftKey;
    if (z && _undoArmed) { e.preventDefault(); e.stopImmediatePropagation(); _doUndoRemove(); }
    // Ctrl/Cmd+S = SAVE THE PROJECT. Muscle memory fires it over Stride constantly, but the
    // WebView eats it (WebView2 would even pop a browser "save page" dialog) — the DAW never
    // saves, and an unsaved chain died in a crash exactly this way (2026-07-16). Forward it
    // natively. Works even while typing — Ctrl+S never inserts text.
    if ((e.key === 's' || e.key === 'S') && (e.ctrlKey || e.metaKey) && ! e.shiftKey && ! e.altKey) {
      e.preventDefault(); e.stopImmediatePropagation();
      if (! e.repeat) emit('transportKey', { key: 'save' });
      return;
    }
    // Space = host transport (play/stop). Once you draw or inject, Stride's WebView holds
    // keyboard focus, and WebView2 keys never reach the DAW on their own — so Space would
    // die here instead of toggling transport. Forward it to native (which posts it to the
    // host window). Skipped while typing so license/search/range fields keep the key.
    if ((e.code === 'Space' || e.key === ' ') && ! e.repeat) {   // !repeat: one toggle per press, not while held
      var ae = document.activeElement;
      var typing = ae && (ae.tagName === 'INPUT' || ae.tagName === 'TEXTAREA' || ae.isContentEditable);
      if (! typing) emit('transportKey', { key: 'space' });
    }
    // Keyboard-mode notes (NOTE_KEYS above). Plain presses only: any modifier means a
    // shortcut, ours or the DAW's. While typing the keys stay in the field — naming a
    // range must not play a chord.
    var nk = _noteKeyOf(e);
    if (nk && ! e.ctrlKey && ! e.metaKey && ! e.altKey && ! e.shiftKey && ! _noteTyping()) {
      // A note letter must never do anything else in Stride. This is what retired the
      // L = pattern-library hotkey: L is a D in Live's layout, so the library opened
      // every time you played that note. The library still has its button.
      if (! _macNoSwallow && (_noteKeysReserved || nk === 'l')) { e.preventDefault(); e.stopImmediatePropagation(); }
      // Repeats retrigger nothing (the UP is what ends the note), but they stay swallowed.
      if (_noteKeysReserved && ! e.repeat) {
        _notesDown[nk] = true;
        emit('musicKey', { key: nk, down: true });
      }
    }
  }, true);
  window.addEventListener('keyup', function (e) {
    var nk = _noteKeyOf(e);
    if (! nk) return;
    if (! _macNoSwallow && (_noteKeysReserved || nk === 'l') && ! _noteTyping()) { e.preventDefault(); e.stopImmediatePropagation(); }
    if (_notesDown[nk]) {   // only keys WE pressed down — and those unconditionally (a skipped UP = a stuck note in Live)
      delete _notesDown[nk];
      emit('musicKey', { key: nk, down: false });
    }
  }, true);
  // Focus leaving Stride mid-hold (click into the DAW / another app) strands the UP —
  // release everything still down so Live never keeps a phantom note ringing.
  window.addEventListener('blur', function () {
    for (var nk in _notesDown) emit('musicKey', { key: nk, down: false });
    _notesDown = {};
    if (_textFocusOn) { _textFocusOn = false; emit('textFocus', { on: false }); }   // don't leave native standing down
  });

  // No clips in the wrapper — drawing modulates the synth live. Hide the Ableton-only
  // "Inject to Clip" rail and the StrideInject setup modal.
  try {
    var hideCss = document.createElement('style');
    hideCss.textContent = '#sd-inject-rail{display:none!important} #sd-strideinject-modal{display:none!important} #link-status{display:none!important} #stride-stale-banner{display:none!important} #sd-install-m4l-overlay{display:none!important} #sd-welcome-overlay{display:none!important}'
      // ARMED pulse. Map armed is just .is-on (the copper plate, same as every
      // other active state) plus this animation, so it belongs to the system
      // instead of being a yellow one-off.
      //
      // It animates FILTER, not box-shadow: .sbtn sets box-shadow !important,
      // and an author !important beats an animation declaration in the cascade,
      // so the old keyframes' glow never rendered at all. What survived was the
      // transform, which is why the button just jumped 7% in size. Nothing sets
      // filter, so brightness animates cleanly. No scale: a toolbar button that
      // changes size shoves its neighbours around.
      + ' @keyframes sdArmPulse{0%,100%{filter:brightness(1)}50%{filter:brightness(1.34)}}'
      + ' .sd-map-armed,.sd-unmap-armed{animation:sdArmPulse 1.15s ease-in-out infinite}'
      + ' @media (prefers-reduced-motion:reduce){.sd-map-armed,.sd-unmap-armed{animation:none}}'
      // Unmap armed is the same PLATE geometry as .is-on, in rose, so "armed to
      // remove" stays distinct from "armed to add" without leaving the system.
      // Rose is hardcoded because the vintage skins alias --ro* onto the greys.
      + ' .sbtn.sd-unmap-armed{color:#2a0d10!important;'
      + '   background:linear-gradient(180deg,#c5807f 0%,#a34e52 100%)!important;'
      + '   border-color:rgb(235 191 192 / .5)!important;border-top-color:rgb(245 221 221 / .55)!important;'
      + '   text-shadow:0 1px 0 rgb(245 221 221 / .4)!important;'
      + '   box-shadow:inset 0 1px 0 rgba(255,255,255,.3), 0 2px 9px -3px rgb(163 78 82 / .85)!important}'
      + ' .sbtn.sd-unmap-armed::after{opacity:0}';
    (document.head || document.documentElement).appendChild(hideCss);
  } catch (e) {}

  // ── window.stride (Electron IPC) ─────────────────────────────────
  var LS = window.localStorage;
  function lsGet(k, d) { try { var v = LS.getItem(k); return v == null ? d : JSON.parse(v); } catch (e) { return d; } }
  function lsSet(k, v) { try { LS.setItem(k, JSON.stringify(v)); } catch (e) {} }
  var P = function (v) { return Promise.resolve(v); };

  window.stride = {
    platform: 'win32',
    loadLicense: function () { return _licCall('load'); },
    validateLicenseKey: function (key) { return _licCall('validate', { key: key }); },
    saveLicense: function (lic) { return _licCall('save', { license: lic }); },
    // 24h Discovery Pass: one click, signed pass ent back. The DEVICE hash (computed natively
    // in C++, never in JS) is the credential + guard — no email needed. The UI caches the
    // result like a validate reply. (email is optional lead-capture; normally omitted.)
    startPass: function (email) { return _licCall('start_pass', { email: email || '' }); },
    saveSettings: function (s) { lsSet('stride_settings', s); return P({ success: true }); },
    loadSettings: function () { return P({ success: true, settings: lsGet('stride_settings', {}) }); },
    saveCanvasState: function (rackId, state) {
      lsSet('stride_canvas_' + rackId, state);   // persist the 0..1 shape + per-param range (authority on reopen)
      // StrideBridge lanes (_live) target Ableton's own devices - they never ride the
      // engine's live_curves (no hosted param behind them); they go to the :9101 bridge
      // instead, and persist through the engine as an opaque blob (set_bridge_lanes -> v10 "bl").
      var _liveLanes = (state || []).filter(function (l) { return l && l._live; });
      var _hostedLanes = (state || []).filter(function (l) { return !(l && l._live); });
      // LIVE drive: the canvas calls this after every edit. state = [{_path, rangeOn, rangeMin, rangeMax, points}].
      // A ranged lane sends its 0..1 shape SCALED into [rangeMin,rangeMax] so the live-drive matches the inject.
      try {
        emit('sl_send', { type: 'live_curves', clip_bars: (window.sdGetBars ? window.sdGetBars() : 0), parameters: _hostedLanes.map(function (l) {
          var pos = parseInt(String(l._path || '').split(':')[1], 10);
          var pts = (l.rangeOn && (l.points || []).length)
            ? l.points.map(function (pt) { return { time: pt.time, value: Math.max(0, Math.min(1, l.rangeMin + pt.value * (l.rangeMax - l.rangeMin))), curve: pt.curve || 0 }; })
            : (l.points || []);
          return { id: isNaN(pos) ? -1 : pos, _path: l._path || null, points: pts };
        }) });
      } catch (e) {}
      try { _sbOnSave(_liveLanes); } catch (e) {}
      // MACRO lanes: the hosted knobs (Serum and friends) are ALSO published to the DAW
      // as Stride's own parameters, named "<device>: <param>". The bridge cannot drive
      // those, but it can INJECT them: StrideInject resolves the name against the clip's
      // own track, so a Serum curve lands in the same clip as the Ableton ones. Pushed
      // on the same edit tick as the live lanes so the two never disagree.
      try { _sbOnSaveMacros(_hostedLanes); } catch (e) {}
      return P({ success: true });
    },
    loadCanvasState: function (rackId) { return P({ success: true, state: lsGet('stride_canvas_' + rackId, null) }); },
    getVersion: function () { return P('wrapper-0.1'); },
    listTemplates: function () { return P([]); },
    importTemplate: function () { return P({ success: false }); },
    deleteTemplate: function () { return P({ success: true }); },
    saveSession: function () { return P({ success: true }); },
    listSessions: function () { return P([]); },
    loadSession: function () { return P({ success: false }); },
    deleteSession: function () { return P({ success: true }); },
    loadPatternManifest: function () { return P({ patterns: [] }); },
    loadPatternFile: function () { return P(null); },
    listRecentGenerations: function () { return P([]); },
    listAllGenerations: function () { return P([]); },
    saveGenerationThumbnail: function () { return P({ success: true }); },
    checkStrideLinkInstalled: function () { return P({ installed: true }); },
    checkStrideInjectInstalled: function () { return P({ installed: true }); },
    checkStrideLinkStale: function () { return P({ stale: false }); },
    installStrideLinkToAbleton: function () { return P({ success: true }); },
    pickUserLibraryFolder: function () { return P(null); },
    persistLibraryPath: function () { return P({ success: true }); },
    getCachedLibraryPath: function () { return P(null); },
    triggerLibraryScan: function () { return P(); },
    pickAlcFile: function () { return P(null); },
    onAlcDetected: function () {},
    onQuickPanelCommand: function () {},
    focusWindow: function () {}, openQuickPanel: function () {}, quickPanelPush: function () {},
    setCompactMode: function () {}, setCompactPin: function () {},
    openExternal: function (url) { try { emit('openExternal', { url: url }); } catch (e) {} }, openStrideFolder: function () {}, openGuideFolder: function () {},
    revealInFolder: function () {}, startDrag: function () {}
  };

  // ── window.strideLink (M4L WebSocket) — same surface, routed to JUCE ─────
  var slHandlers = {};
  window.strideLink = {
    connected: true,
    _wrapper: true,   // canvas.js gates wrapper-only messages (e.g. set_range) on this — the desktop's WS strideLink doesn't have it
    connect: function () {},
    disconnect: function () {},
    on: function (ev, fn) { (slHandlers[ev] = slHandlers[ev] || []).push(fn); return this; },
    off: function (ev, fn) { if (slHandlers[ev]) slHandlers[ev] = slHandlers[ev].filter(function (h) { return h !== fn; }); },
    _emit: function (ev, data) { (slHandlers[ev] || []).forEach(function (h) { try { h(data); } catch (e) { showErr('handler ' + ev + ': ' + e.message); } }); },
    send: function (msg) { emit('sl_send', msg); return true; },
    requestScan: function () { return this.send({ type: 'request_scan' }); },
    requestScanMapped: function () { return this.send({ type: 'request_scan_mapped' }); },
    applyAutomation: function (params, clipBars) {
      return this.send({
        type: 'apply_automation',
        clip_bars: clipBars,
        parameters: (params || []).map(function (p) {
          return { id: p.id, name: p.name, _path: p._path || null, min: p.min, max: p.max, is_log: !!p.is_log,
                   points: (p.points || []).map(function (pt) { return { time: pt.time, value: pt.value, curve: pt.curve || 0 }; }) };
        })
      });
    },
    applyDirectInject: function (params, clipBars, opts) {   // "Inject to Clip" -> drive the hosted synth live
      return this.send({
        type: 'apply_inject',
        clip_bars: clipBars,
        parameters: (params || []).map(function (p) {
          return { id: p.id, name: p.name, _path: p._path || null, min: p.min, max: p.max, is_log: !!p.is_log,
                   points: (p.points || []).map(function (pt) { return { time: pt.time, value: pt.value, curve: pt.curve || 0 }; }) };
        })
      });
    },
    applyMidi: function () { return false; },
    previewParam: function (id, value) { return this.send({ type: 'preview_param', id: id, value: value }); },
    stopPreview: function () { return this.send({ type: 'stop_preview' }); },
    requestCreateClip: function () { return false; },
    readClipCurves: function () { return false; }
  };

  // The engine's own counts after a print / take back, with no lane rebuild attached.
  listen('sl_event', function (msg) {
    if (!msg || msg.type !== 'lanes_printed_ack') return;
    if (typeof msg.host_driven !== 'undefined') _sb.hostDriven = msg.host_driven | 0;
    if (typeof msg.drive_lanes !== 'undefined') _sb.driveLanes = msg.drive_lanes | 0;
  });

  // C++ -> JS : C++ emits 'sl_event' {type, ...}; dispatch to strideLink handlers by type.
  listen('sl_event', function (msg) {
    try { window.strideLink._emit(msg && msg.type, msg); } catch (e) { showErr('sl_event: ' + e.message); }
  });

  // == window.strideBridge - StrideBridge.amxd client (Ableton devices as lanes) ==
  // The page does NOT open the socket: WebView2 blocks localhost connections from
  // the plugin page (Local Network Access policy - verified on the rig 2026-08-26:
  // instant CLOSED, no exception, no console line). The editor's native BridgeLink
  // thread owns a TCP connection to the bridge (:9102) and relays newline-framed
  // JSON through the same listen/emit pipe everything else already uses:
  //   C++ -> page : 'bridgeState' {on}   link up/down (drives the MAP LIVE button)
  //                 'bridgeMsg'   {json} one message from the bridge
  //   page -> C++ : sl_send {type:'bridge_send', json} one message to the bridge
  var _sb = {
    open: false, handlers: {},
    lastLanes: null, lastSig: '', hadLive: false, pushTimer: null,
    blobShadow: null, pendingBlob: undefined, adoptDone: false, adoptWait: null,
    mapArmed: false, mapBtn: null
  };

  window.strideBridge = {
    _wrapper: true,
    get connected() { return _sb.open; },
    on: function (t, fn) { (_sb.handlers[t] = _sb.handlers[t] || []).push(fn); },
    send: function (o) {
      if (!_sb.open) return;
      try { emit('sl_send', { type: 'bridge_send', json: JSON.stringify(o) }); } catch (e) {}
    }
  };

  listen('bridgeState', function (d) {
    var on = !!(d && d.on);
    if (on === _sb.open) { if (on) _sbButton(true); return; }
    _sb.open = on;
    _sbButton(on);
    if (on) {
      window.strideBridge.send({ type: 'bridge_hello', version: 1 });
      _sbAdopt();
      _sb.lastSig = '';                       // force a full flush: the bridge may be fresh
      if (_sb.lastLanes && _sb.lastLanes.length) _sbPush(_sb.lastLanes);
    } else {
      _sbSetMapUi(false);
    }
  });

  listen('bridgeMsg', function (d) {
    var m; try { m = JSON.parse((d && d.json) || ''); } catch (e) { return; }
    _sbRoute(m);
  });

  function _sbRoute(m) {
    var t = m && m.type;
    if (t === 'live_mapped') {
      // stays ARMED - map knob after knob; the button press (or the 30s idle
      // timeout) is what ends the session, exactly like the hosted Map flow
      try { if (window.sdBridgeMapped) window.sdBridgeMapped(m); } catch (e) { showErr('bridge map: ' + e.message); }
    } else if (t === 'map_live_timeout') {
      _sbSetMapUi(false);
    } else if (t === 'live_touched') {
      try { if (window.sdBridgeTouched) window.sdBridgeTouched(m); } catch (e) {}
    } else if (t === 'live_touched_dev') {
      try { if (window.sdBridgeTouchedDev) window.sdBridgeTouchedDev(m); } catch (e) {}
    } else if (t === 'live_lane_healed') {
      try { if (window.sdBridgeHealed) window.sdBridgeHealed(m); } catch (e) {}
    } else if (t === 'live_bind_result') {
      try { if (window.sdBridgeBindResult) window.sdBridgeBindResult(m); } catch (e) {}
    } else if (t === 'live_relinked') {
      // armed device-click in Live re-homed every lane of that device name
      try { if (window.sdBridgeRelinked) window.sdBridgeRelinked(m); } catch (e) {}
    } else if (t === 'bridge_unreachable') {
      // The device is in the set and the socket is up, but nothing answered the arm:
      // a leaked node process is holding the port. Drop the armed look (it would be a
      // lie) and say what actually fixes it.
      _sbSetMapUi(false);
      try { if (window.sdBridgeError) window.sdBridgeError(m.message || 'StrideBridge is not responding'); } catch (e) {}
    } else if (t === 'bridge_error') {
      try { if (window.sdBridgeError) window.sdBridgeError(m.message || 'bridge error'); } catch (e) {}
    } else if (t === 'lane_printed') {
      // INJECT handed these knobs to Live, or a redraw / TAKE BACK returned them.
      // The canvas records it so the flag rides the save.
      try { if (window.sdBridgePrinted) window.sdBridgePrinted(m); } catch (e) {}
    } else if (t === 'lane_missing') {
      // The lane's device left the set (or came back). Marked, never deleted.
      try { if (window.sdBridgeMissing) window.sdBridgeMissing(m); } catch (e) {}
    } else if (t === 'macro_printed') {
      // Same, for HOSTED lanes. Two receivers on purpose: the canvas records the flag
      // for the save, and the ENGINE switches that lane to DAW drive so Ableton's
      // automation on "Serum: WT Pos" actually reaches Serum instead of being
      // overwritten by the curve every block.
      try { emit('setLanesPrinted', { pos: m.pos || [], printed: !!m.printed }); } catch (e) {}
      try { if (window.sdMacroPrinted) window.sdMacroPrinted(m); } catch (e) {}
    }
    var hs = _sb.handlers[t] || [];
    for (var i = 0; i < hs.length; i++) { try { hs[i](m); } catch (e) {} }
  }

  // The MAP LIVE button doubles as the presence indicator: visible only while the link is up.
  function _sbButton(on) {
    if (_sb.mapBtn) _sb.mapBtn.style.display = on ? '' : 'none';
  }
  function _sbSetMapUi(armed) {
    _sb.mapArmed = armed;
    if (_sb.mapBtn) {
      _sb.mapBtn.textContent = armed ? '\u25c9 Click a knob in Live\u2026' : '\u25c9 Map Live';
      // Same treatment as the hosted Map button: plain metal at rest, and the
      // shared .is-on copper plate + a brightness pulse while armed, so you
      // cannot forget it is on (and press it off). BTN_MAP/BTN_MAP_ARMED are the
      // shared bar styles (hoisted vars, same scope).
      _sb.mapBtn.className = armed ? BTN_MAP_ARMED : BTN_MAP;
      _sb.mapBtn.style.opacity = '';
    }
  }
  window.sdBridgeMapToggle = function () {
    if (!_sb.open) return;
    if (_sb.mapArmed) { window.strideBridge.send({ type: 'map_live_cancel' }); _sbSetMapUi(false); }
    else { window.strideBridge.send({ type: 'map_live_start' }); _sbSetMapUi(true); }
  };

  // Curve push: debounced, signature-diffed, range baked HERE (same precedent as the
  // live_curves flush above) - the bridge only ever sees final 0..1 points.
  function _sbOnSave(liveLanes) {
    // persistence blob -> engine (v10 "bl"), only when it actually changed
    var blob = JSON.stringify({ v: 1, lanes: liveLanes || [] });
    if (blob !== _sb.blobShadow && ((liveLanes && liveLanes.length) || _sb.blobShadow !== null)) {
      _sb.blobShadow = blob;
      try { emit('sl_send', { type: 'set_bridge_lanes', json: blob }); } catch (e) {}
    }
    if ((liveLanes && liveLanes.length) || _sb.hadLive) {
      _sb.hadLive = !!(liveLanes && liveLanes.length);
      _sbPush(liveLanes || []);
    }
  }
  // Hosted lanes -> the bridge, for INJECT only. They are addressed by the DAW-facing
  // macro NAME ("Serum: WT Pos"), never by a LOM path: a LOM path would point at
  // Stride's own device slot, which moves the moment the chain is reordered, whereas
  // the macro name is what Ableton actually shows and what StrideInject can match on
  // the clip's track. `pos` rides along so the wrapper can flip that exact lane to DAW
  // drive once Live confirms the write.
  function _sbOnSaveMacros(hostedLanes) {
    if (!_sb.open) { _sb.lastMacros = hostedLanes || []; return; }
    if (_sb.macroTimer) clearTimeout(_sb.macroTimer);
    _sb.lastMacros = hostedLanes || [];
    _sb.macroTimer = setTimeout(function () {
      if (!_sb.open) return;
      var bars = (window.sdGetBars ? window.sdGetBars() : 4) || 4;
      var lanes = (_sb.lastMacros || []).map(function (l) {
        var pos = parseInt(String(l._path || '').split(':')[1], 10);
        var pts = (l.rangeOn && (l.points || []).length)
          ? l.points.map(function (pt) { return { time: pt.time, value: Math.max(0, Math.min(1, l.rangeMin + pt.value * (l.rangeMax - l.rangeMin))), curve: pt.curve || 0 }; })
          : (l.points || []);
        return { pos: isNaN(pos) ? -1 : pos,
                 macro: (l.device ? l.device + ': ' : '') + (l.name || ''),
                 points: pts, speed: (typeof l.speed === 'number' && l.speed > 0 ? l.speed : 1),
                 min: 0, max: 1, is_log: 0, printed: !!l.hostPrinted };
      }).filter(function (x) { return x.pos >= 0 && x.macro && x.points.length; });
      var sig = JSON.stringify([bars, lanes]);
      if (sig === _sb.lastMacroSig) return;
      _sb.lastMacroSig = sig;
      // Ableton does not expose a VST3's parameters to the LOM until the plugin has
      // announced them (the "Configure, then wiggle the knob" dance). announceMacros
      // fires that gesture for us, so INJECT can resolve the macro by name without the
      // user ever visiting Configure. ONCE per session: the nudge is a real parameter
      // gesture and repeating it on every edit would litter the DAW's undo history.
      if (lanes.length && !_sb.announced) { _sb.announced = true; try { emit('announceMacros'); } catch (e) {} }
      // drive_mode rides along purely so last_inject.json can show it: a GLOBAL 'DAW
      // driving' mode makes every hosted lane read its macro, which no per-lane take
      // back can override, and from the outside that looks exactly like a stuck lane.
      window.strideBridge.send({ type: 'set_macro_lanes', bars: bars, lanes: lanes,
                                 drive_mode: _sb.driveMode | 0, host_driven: _sb.hostDriven | 0,
                                 drive_lanes: _sb.driveLanes | 0 });
    }, 120);
  }

  function _sbPush(liveLanes) {
    _sb.lastLanes = liveLanes;
    if (_sb.pushTimer) clearTimeout(_sb.pushTimer);
    _sb.pushTimer = setTimeout(function () {
      if (!_sb.open) return;                          // reconnect flushes
      var bars = (window.sdGetBars ? window.sdGetBars() : 4) || 4;
      var lanes = (_sb.lastLanes || []).map(function (l) {
        var pts = (l.rangeOn && (l.points || []).length)
          ? l.points.map(function (pt) { return { time: pt.time, value: Math.max(0, Math.min(1, l.rangeMin + pt.value * (l.rangeMax - l.rangeMin))), curve: pt.curve || 0 }; })
          : (l.points || []);
        return { path: l.livePath, points: pts, speed: (typeof l.speed === 'number' && l.speed > 0 ? l.speed : 1),
                 min: l.liveMin, max: l.liveMax, is_log: l.liveLog ? 1 : 0, is_quantized: l.liveQuant ? 1 : 0,
                 // Handed to Live by an earlier inject. Rides every push so a reopened
                 // set does not re-bind the knob and override the printed automation.
                 printed: !!l.livePrinted,
                 name: l.liveName || '', device: (l.liveDevice || '').replace(/^\u26a1 /, '') };
      }).filter(function (x) { return !!x.path; });
      var sig = JSON.stringify([bars, lanes]);
      if (sig === _sb.lastSig) return;
      _sb.lastSig = sig;
      window.strideBridge.send({ type: 'set_live_lanes', bars: bars, lanes: lanes });
    }, 120);
  }

  // Project blob from C++ (v10 "bl") -> adopt once the link AND canvas are both ready.
  listen('bridgeLanes', function (d) {
    _sb.pendingBlob = (d && d.json) || '';
    _sb.blobShadow = _sb.pendingBlob || null;
    _sbAdopt();
  });
  function _sbAdopt() {
    if (!_sb.open || _sb.adoptDone || _sb.pendingBlob === undefined) return;
    if (!window.sdBridgeAdoptLanes) {
      if (!_sb.adoptWait) _sb.adoptWait = setInterval(function () {
        if (window.sdBridgeAdoptLanes) { clearInterval(_sb.adoptWait); _sb.adoptWait = null; _sbAdopt(); }
      }, 250);
      return;
    }
    _sb.adoptDone = true;
    var blob = _sb.pendingBlob; _sb.pendingBlob = undefined;
    var lanes = [];
    try { lanes = (JSON.parse(blob || '{}').lanes) || []; } catch (e) {}
    if (lanes.length) { try { window.sdBridgeAdoptLanes(lanes); } catch (e) { showErr('bridge adopt: ' + e.message); } }
  }

  // TRUE playhead: the engine's real loop phase (0..1 + playing flag) drives the lane
  // comets — canvas.js retires its ambient wall-clock drift on the first tick and then
  // repaints only when the phase actually moves (zero cost while stopped).
  listen('playhead', function (d) {
    try { if (window.sdSetEnginePlayhead) window.sdSetEnginePlayhead((d && d.p) || 0, !!(d && d.on), (d && d.b) || 0, !!(d && d.free)); } catch (e) { showErr('playhead: ' + e.message); }
  });

  // Stride's own DAW params (Smooth/Depth/Curve/Floor/Ceiling on a MIDI knob) → the
  // canvas receiver, which drives the SAME snapshot-based slider functions the strip uses.
  listen('strideCtl', function (d) {
    try { if (window.sdHostCtl) window.sdHostCtl((d && d.k) || '', (d && d.v) || 0); } catch (e) { showErr('strideCtl: ' + e.message); }
  });

  // A device failed to load (bad path, wrong format, or — the common Mac case — an
  // Intel-only bundle inside an arm64 host process). Silent DBG was a support ticket;
  // show a small toast with the actionable cause instead.
  var _loadFailToast = null, _loadFailTimer = 0;
  listen('loadFailed', function (d) {
    try {
      var nm = (d && d.name) || 'That plugin';
      var isMac = /Mac/i.test(navigator.platform || '');
      var hint = isMac ? 'It may be Intel-only (this host runs Apple Silicon-native), a broken install, or an unsupported format.'
                       : 'The file may be missing, 32-bit, or not a VST3.';
      if (!_loadFailToast) {
        _loadFailToast = document.createElement('div');
        _loadFailToast.className = 'fixed bottom-6 right-6 bg-zinc-900 border border-orange-500/40 rounded-xl shadow-2xl z-[9999] max-w-sm p-4';
        _loadFailToast.style.fontFamily = "'Outfit',sans-serif";
        document.body.appendChild(_loadFailToast);
      }
      _loadFailToast.innerHTML = '';
      var t1 = document.createElement('div'); t1.className = 'text-[11px] text-orange-400 font-black uppercase tracking-wider'; t1.textContent = 'Couldn’t load ' + nm;
      var t2 = document.createElement('div'); t2.className = 'text-[10px] text-zinc-400 mt-1 leading-snug'; t2.textContent = hint;
      _loadFailToast.appendChild(t1); _loadFailToast.appendChild(t2);
      _loadFailToast.style.display = '';
      if (_loadFailTimer) clearTimeout(_loadFailTimer);
      _loadFailTimer = setTimeout(function () { if (_loadFailToast) _loadFailToast.style.display = 'none'; }, 8000);
    } catch (e) { showErr('loadFailed: ' + e.message); }
  });

  // Chain-preset feedback (saved / loaded / demo gate) — the loadFailed toast pattern.
  var _chainToast = null, _chainToastTimer = 0;
  listen('chainNote', function (d) {
    try {
      if (!_chainToast) {
        _chainToast = document.createElement('div');
        _chainToast.className = 'fixed bottom-6 right-6 bg-zinc-900 border border-orange-500/40 rounded-xl shadow-2xl z-[9999] max-w-sm p-4';
        _chainToast.style.fontFamily = "'Outfit',sans-serif";
        document.body.appendChild(_chainToast);
      }
      _chainToast.innerHTML = '';
      var c1 = document.createElement('div'); c1.className = 'text-[11px] text-orange-400 font-black uppercase tracking-wider'; c1.textContent = (d && d.t) || 'Chain';
      var c2 = document.createElement('div'); c2.className = 'text-[10px] text-zinc-400 mt-1 leading-snug'; c2.textContent = (d && d.d) || '';
      _chainToast.appendChild(c1); _chainToast.appendChild(c2);
      _chainToast.style.display = '';
      if (_chainToastTimer) clearTimeout(_chainToastTimer);
      _chainToastTimer = setTimeout(function () { if (_chainToast) _chainToast.style.display = 'none'; }, 6000);
    } catch (e) { showErr('chainNote: ' + e.message); }
  });

  // ── window.strideCloud (cloud generation) — offline stub ─────────
  window.strideCloud = {
    isOnline: false, credits: 0,
    signIn: function () { return P({ success: false }); },
    generate: function () { return P({ success: false, error: 'cloud disabled in wrapper' }); },
    refreshCredits: function () { return P({ credits: 0 }); }
  };

  // ── wrapper control bar (built into the in-flow #stride-wrap-controls strip) ─────
  // Favorite synths — USER DATA. localStorage is only a CACHE: a Chromium profile reset
  // wiped it for real (2026-07-16), so every change writes through to the native
  // stride-data/wrapper-prefs.json via the engine ('prefsSave'), and boot adopts
  // whichever side still has the data ('prefsState' below).
  function favGet() { return lsGet('stride_fav_synths', []); }                 // [{name, path}]
  // savePrefs on the C++ side is a WHOLE-OBJECT replace, so every write must carry every
  // key — a favorites-only payload would wipe the motions (and vice versa). _natPrefs is
  // the merged view: seeded from prefsState on boot, updated per-key on every save.
  var _natPrefs = {};
  function prefsWrite(key, val) { _natPrefs[key] = val; emit('prefsSave', { prefs: _natPrefs }); }
  function favSet(v) { lsSet('stride_fav_synths', v); prefsWrite('favorites', v); }

  // Motions (saved lane curves) — STRONGER than the favorites story: the wrapper's
  // WebView localStorage only flushes to disk on browser-process shutdown, so a plugin
  // teardown can silently drop cached writes (field bug 2026-08-17: a saved motion was
  // in wrapper-prefs.json but Mine rendered empty). So the FILE is the source of truth,
  // the cache is best-effort, and the two writes are try'd SEPARATELY — a cache failure
  // must never kill the file write that follows it.
  window.sdMotionsPersist = function (list) {
    try { lsSet('sd_motions', list || []); } catch (e) {}
    try { prefsWrite('motions', list || []); } catch (e) {}
  };

  // Boot sync with the native prefs file (sent by C++ right before 'connected'):
  //   native has data -> adopt it (it survives profile resets / temp cleanup)
  //   native empty but the local cache has data -> seed the native file from the
  //   cache (first run after this update — the one-time rescue direction)
  listen('prefsState', function (d) {
    try {
      // typeof null === 'object': a fresh install (no prefs file yet) delivers prefs
      // as null — it must land as {}, not null, or every prefsWrite after it throws.
      _natPrefs = (d && d.prefs && typeof d.prefs === 'object' && !Array.isArray(d.prefs)) ? d.prefs : {};
      var nat = _natPrefs.favorites || [];
      if (nat.length) { lsSet('stride_fav_synths', nat); populateFav(); }
      else { var loc = lsGet('stride_fav_synths', []); if (loc.length) prefsWrite('favorites', loc); }
      // Motions: adopt-native, or rescue the cache into the file. The adopted list
      // rides IN the event detail — canvas.js swaps its in-memory library to it
      // directly, so a broken/stale localStorage layer can never hide saved motions.
      var natM = _natPrefs.motions || [];
      if (natM.length) { try { lsSet('sd_motions', natM); } catch (e3) {} }
      else { var locM = lsGet('sd_motions', []); if (locM.length) { natM = locM; prefsWrite('motions', locM); } }
      try { window.dispatchEvent(new CustomEvent('sd-motions-adopted', { detail: { motions: natM } })); } catch (e2) {}
      // The character's size, if he has ever been resized. Absent = his default stature.
      try {
        if (typeof _natPrefs.repScale === 'number' && window.sdReptileScaleAdopt)
          window.sdReptileScaleAdopt(_natPrefs.repScale);
        if (typeof _natPrefs.repChar === 'number' && window.sdReptileCharAdopt)
          window.sdReptileCharAdopt(_natPrefs.repChar);
        if (typeof _natPrefs.compactOn === 'boolean' && window.sdCompactAdopt)
          window.sdCompactAdopt(_natPrefs.compactOn);
      } catch (e4) {}
    } catch (e) { showErr('prefsState: ' + e.message); }
  });
  function favName(path) { var p = String(path).replace(/\\/g, '/'); var f = p.split('/').pop() || path; return f.replace(/\.(vst3|component)$/i, ''); }
  // Display label for a favorite: AU devices (.component, macOS) carry an "(AU)" suffix so
  // the same synth installed in both formats stays tellable-apart in the dropdown.
  function favLabel(path) { return /\.component$/i.test(String(path)) ? favName(path) + ' (AU)' : favName(path); }

  var favSelect = null;
  function populateFav() {
    if (! favSelect) return;
    var cur = favSelect.value; favSelect.innerHTML = '';
    var ph = document.createElement('option'); ph.value = ''; ph.textContent = '★ Favorites…'; favSelect.appendChild(ph);
    favGet().forEach(function (f) { var o = document.createElement('option'); o.value = f.path; o.textContent = f.name; favSelect.appendChild(o); });
    if (cur) favSelect.value = cur;
  }

  // ── Stride-styled plugin browser (the "+ Add" picker) ──
  var pluginModal = null;
  function closePluginBrowser() {
    if (pluginModal) { pluginModal.remove(); pluginModal = null; }
    // Removing a focused node does NOT reliably fire focusout in WebKit — the search
    // input's focus dies silently and the textFocus latch would stay stuck ON (native
    // standing down = note keys dead). Blur whatever is focused and re-sync explicitly.
    try { if (document.activeElement && document.activeElement.blur) document.activeElement.blur(); } catch (e) {}
    setTimeout(_pushTextFocus, 0);
  }
  function showPluginBrowser(plugins) {
    closePluginBrowser();
    plugins = (plugins || []).slice().sort(function (a, b) { return ((a.name || '').toLowerCase() < (b.name || '').toLowerCase()) ? -1 : 1; });

    var ov = document.createElement('div');
    ov.className = 'fixed inset-0 z-[10050] flex items-center justify-center p-4';
    ov.style.background = 'rgba(0,0,0,.7)'; ov.style.backdropFilter = 'blur(6px)';
    ov.onclick = function (e) { if (e.target === ov) closePluginBrowser(); };

    var panel = document.createElement('div');
    panel.className = 'bg-zinc-950 border border-white/10 rounded-xl shadow-2xl w-[460px] max-h-[72vh] flex flex-col overflow-hidden';

    var head = document.createElement('div'); head.className = 'flex items-center justify-between px-4 py-3 border-b border-white/5';
    var title = document.createElement('span'); title.className = 'text-[12px] text-zinc-100 font-black uppercase tracking-[0.15em]'; title.textContent = 'Add a device';
    var hright = document.createElement('div'); hright.className = 'flex items-center gap-3';
    var browse = document.createElement('button'); browse.textContent = 'Browse files…'; browse.className = 'text-[10px] uppercase tracking-wider font-bold text-zinc-400 hover:text-orange-400'; browse.title = (/Mac/i.test(navigator.platform || '') ? 'Load any .vst3 / .component from a custom folder' : 'Load any .vst3 from a custom folder'); browse.onclick = function () { closePluginBrowser(); emit('loadSynth'); };
    var cl = document.createElement('button'); cl.textContent = '×'; cl.className = 'text-zinc-500 hover:text-zinc-200 text-xl leading-none'; cl.onclick = closePluginBrowser;
    hright.appendChild(browse); hright.appendChild(cl);
    head.appendChild(title); head.appendChild(hright); panel.appendChild(head);

    var swrap = document.createElement('div'); swrap.className = 'px-4 py-3 border-b border-white/5';
    var search = document.createElement('input'); search.type = 'text'; search.placeholder = 'Search plugins…';
    search.className = 'w-full bg-zinc-900 border border-white/10 rounded-lg px-3 py-2 text-[12px] text-zinc-200 placeholder-zinc-600 focus:outline-none focus:border-orange-500/40';
    swrap.appendChild(search); panel.appendChild(swrap);

    var listEl = document.createElement('div'); listEl.className = 'flex-1 overflow-auto px-2 py-2'; panel.appendChild(listEl);
    // Format chips only when the list actually mixes formats (VST3 + AU on Mac) — a
    // VST3-only list (Windows, or a Mac with no AUs) renders exactly like before.
    var multiFmt = plugins.some(function (x) { return x.fmt && x.fmt !== 'VST3'; });
    function render(filter) {
      listEl.innerHTML = ''; var f = (filter || '').toLowerCase(); var shown = 0;
      plugins.forEach(function (p) {
        if (f && (p.name || '').toLowerCase().indexOf(f) < 0) return; shown++;
        var row = document.createElement('button');
        row.className = 'w-full text-left flex items-center justify-between gap-3 px-3 py-2 rounded-lg hover:bg-white/5 transition-colors group';
        var left = document.createElement('span'); left.className = 'flex items-center gap-2 min-w-0';
        var nm = document.createElement('span'); nm.className = 'text-[12px] text-zinc-200 group-hover:text-white truncate'; nm.textContent = p.name;
        left.appendChild(nm);
        // One .vst3 can hold several plugins (Serum2.vst3 is "Serum 2" AND "Serum 2 FX").
        // Mark the effect ONLY when this bundle contributed more than one row, the same way
        // the format chip only appears when the list actually mixes formats: a lone effect
        // needs no disambiguating.
        if (p.multi && p.isFx) {
          var xc = document.createElement('span');
          xc.className = 'text-[8px] uppercase tracking-wider font-bold px-1.5 py-0.5 rounded border shrink-0 text-fuchsia-400/90 border-fuchsia-400/25';
          xc.textContent = 'FX';
          left.appendChild(xc);
        }
        if (multiFmt && p.fmt) {
          var fc = document.createElement('span');
          fc.className = 'text-[8px] uppercase tracking-wider font-bold px-1.5 py-0.5 rounded border shrink-0 ' + (p.fmt === 'AU' ? 'text-sky-400/90 border-sky-400/25' : 'text-zinc-500 border-white/10');
          fc.textContent = p.fmt;
          left.appendChild(fc);
        }
        var add = document.createElement('span'); add.className = 'text-[9px] uppercase tracking-wider font-bold text-zinc-600 group-hover:text-orange-400 shrink-0'; add.textContent = 'Add';
        row.appendChild(left); row.appendChild(add);
        row.onclick = function () {
          // cls says WHICH plugin in the bundle. Favourites key on path+cls for the same
          // reason: two entries from one file must not collapse into one favourite.
          emit('loadSynthPath', { path: p.path, cls: p.cls || '' });
          var favs = favGet();
          if (! favs.some(function (x) { return x.path === p.path && (x.cls || '') === (p.cls || ''); })) {
            favs.push({ name: (p.fmt === 'AU' ? p.name + ' (AU)' : p.name), path: p.path, cls: p.cls || '' });
            favSet(favs); populateFav();
          }
          nm.className = 'text-[12px] text-emerald-400 truncate'; add.textContent = '✓ added'; add.className = 'text-[9px] uppercase tracking-wider font-bold text-emerald-400 shrink-0';
        };
        listEl.appendChild(row);
      });
      if (! shown) { var e = document.createElement('div'); e.className = 'text-[11px] text-zinc-600 px-3 py-6 text-center'; e.textContent = plugins.length ? 'No matches' : 'No plugins found in the standard folders.'; listEl.appendChild(e); }
    }
    search.oninput = function () { render(search.value); };
    render('');

    var foot = document.createElement('div'); foot.className = 'flex items-center justify-between px-4 py-3 border-t border-white/5';
    var hint = document.createElement('span'); hint.className = 'text-[10px] text-zinc-600'; hint.textContent = plugins.length + ' found in the standard plugin folders';
    foot.appendChild(hint); panel.appendChild(foot);

    ov.appendChild(panel); document.body.appendChild(ov); pluginModal = ov;
    setTimeout(function () { try { search.focus(); } catch (e) {} }, 30);
  }
  listen('pluginList', function (d) { showPluginBrowser((d && d.plugins) || []); });

  // ── Favorites manager (organize: reorder / delete / add) — for users with lots of
  // favorites the single dropdown gets unwieldy; this modal keeps them tidy. Same look
  // as the plugin browser. Changes persist to favSet() + refresh the dropdown live. ──
  var favModal = null;
  function closeFavManager() {
    if (favModal) { favModal.remove(); favModal = null; }
    try { if (document.activeElement && document.activeElement.blur) document.activeElement.blur(); } catch (e) {}
    setTimeout(_pushTextFocus, 0);   // same silent-focus-death hazard as the plugin browser
  }
  function showFavManager() {
    closeFavManager();
    var ov = document.createElement('div');
    ov.className = 'fixed inset-0 z-[10050] flex items-center justify-center p-4';
    ov.style.background = 'rgba(0,0,0,.7)'; ov.style.backdropFilter = 'blur(6px)';
    ov.onclick = function (e) { if (e.target === ov) closeFavManager(); };

    var panel = document.createElement('div');
    panel.className = 'bg-zinc-950 border border-white/10 rounded-xl shadow-2xl w-[460px] max-h-[72vh] flex flex-col overflow-hidden';

    var head = document.createElement('div'); head.className = 'flex items-center justify-between px-4 py-3 border-b border-white/5';
    var title = document.createElement('span'); title.className = 'text-[12px] text-zinc-100 font-black uppercase tracking-[0.15em]'; title.textContent = 'Manage favorites';
    var hright = document.createElement('div'); hright.className = 'flex items-center gap-3';
    var addBtn = document.createElement('button'); addBtn.textContent = '+ Add'; addBtn.className = 'text-[10px] uppercase tracking-wider font-bold text-orange-400 hover:text-orange-300'; addBtn.title = 'Add a plugin to favorites'; addBtn.onclick = function () { closeFavManager(); emit('browsePlugins'); };
    var cl = document.createElement('button'); cl.textContent = '×'; cl.className = 'text-zinc-500 hover:text-zinc-200 text-xl leading-none'; cl.onclick = closeFavManager;
    hright.appendChild(addBtn); hright.appendChild(cl);
    head.appendChild(title); head.appendChild(hright); panel.appendChild(head);

    var listEl = document.createElement('div'); listEl.className = 'flex-1 overflow-auto px-2 py-2 custom-scroll'; panel.appendChild(listEl);

    var dragFrom = null;
    function render() {
      listEl.innerHTML = '';
      var favs = favGet();
      if (! favs.length) {
        var e = document.createElement('div'); e.className = 'text-[11px] text-zinc-600 px-3 py-8 text-center'; e.textContent = 'No favorites yet. Use + Add to add plugins.'; listEl.appendChild(e); return;
      }
      favs.forEach(function (f, i) {
        var row = document.createElement('div');
        row.className = 'flex items-center gap-2 px-2 py-2 rounded-lg hover:bg-white/5 group cursor-grab select-none';
        row.draggable = true;
        var grip = document.createElement('span'); grip.textContent = '⠿'; grip.className = 'text-zinc-600 group-hover:text-zinc-400 text-[13px] shrink-0'; grip.title = 'Drag to reorder';
        var nm = document.createElement('span'); nm.className = 'flex-1 min-w-0 text-[12px] text-zinc-200 truncate pointer-events-none'; nm.textContent = f.name; nm.title = f.path;
        var load = document.createElement('button'); load.textContent = 'Load'; load.className = 'text-[9px] uppercase tracking-wider font-bold text-zinc-500 hover:text-fuchsia-400 opacity-0 group-hover:opacity-100 shrink-0'; load.title = 'Load this device now'; load.onclick = function () { emit('loadSynthPath', { path: f.path, cls: f.cls || '' }); };
        var del = document.createElement('button'); del.textContent = '✕'; del.className = 'text-zinc-600 hover:text-orange-400 text-[11px] font-bold w-5 shrink-0'; del.title = 'Remove from favorites'; del.onclick = function () { var a = favGet(); a.splice(i, 1); favSet(a); populateFav(); render(); };
        row.appendChild(grip); row.appendChild(nm); row.appendChild(load); row.appendChild(del);

        // Drag to reorder (HTML5 DnD). Drop onto a row = move there; persists + refreshes the dropdown.
        row.addEventListener('dragstart', function (e) { dragFrom = i; try { e.dataTransfer.effectAllowed = 'move'; e.dataTransfer.setData('text/plain', String(i)); } catch (x) {} row.classList.add('opacity-40'); });
        row.addEventListener('dragend',   function ()  { row.classList.remove('opacity-40'); dragFrom = null; });
        row.addEventListener('dragover',  function (e) { e.preventDefault(); try { e.dataTransfer.dropEffect = 'move'; } catch (x) {} row.classList.add('ring-1', 'ring-fuchsia-400/60'); });
        row.addEventListener('dragleave', function ()  { row.classList.remove('ring-1', 'ring-fuchsia-400/60'); });
        row.addEventListener('drop',      function (e) {
          e.preventDefault(); row.classList.remove('ring-1', 'ring-fuchsia-400/60');
          var from = dragFrom; if (from == null || from === i) return;
          var a = favGet(); var moved = a.splice(from, 1)[0]; a.splice(i, 0, moved);
          favSet(a); populateFav(); render();
        });
        listEl.appendChild(row);
      });
    }
    render();

    var foot = document.createElement('div'); foot.className = 'px-4 py-3 border-t border-white/5';
    var hint = document.createElement('span'); hint.className = 'text-[10px] text-zinc-600'; hint.textContent = 'Reorder with ↑ ↓ · ✕ removes · changes save automatically';
    foot.appendChild(hint); panel.appendChild(foot);

    ov.appendChild(panel); document.body.appendChild(ov); favModal = ov;
  }

  // Stride button styling (Tailwind classes -> skinned colors + Outfit, 1:1 with the app).
  // Geometry, type and every state now come from .sbtn (see index.html). These
  // stay as names because 26 call sites use them.
  var BTN_BASE = 'sbtn ';
  var BTN_GHOST = BTN_BASE;
  var BTN_PRIMARY = BTN_BASE;
  var BTN_ARMED = BTN_BASE + 'is-on';
  // Map gets its own slightly-bigger, distinct (violet) treatment so the primary
  // "arm to learn" action reads differently from +Add / Clear.
  var BTN_MAP       = 'sbtn';
  // Armed = bright YELLOW + pulse so you can't forget it's on and press it off. (Default
  // Tailwind yellow, not amber — amber is remapped to orange in the copper skin.)
  var BTN_MAP_ARMED = 'sbtn is-on sd-map-armed';
  // Unmap = the inverse of Map (touch a mapped knob to remove it). Rose/red so it reads as "remove".
  var BTN_UNMAP       = 'sbtn sbtn--danger';
  var BTN_UNMAP_ARMED = 'sbtn sd-unmap-armed';

  function buildBar() {
    try {
      var host = document.getElementById('stride-wrap-controls');
      if (! host) return;
      host.innerHTML = '';

      // Favorites dropdown — one-click load, no path-hunting.
      favSelect = document.createElement('select');
      favSelect.title = 'Favorite synths';
      favSelect.className = 'bg-zinc-900 border border-white/10 text-zinc-300 text-[11px] rounded px-2 py-1 cursor-pointer max-w-[180px]';
      favSelect.onchange = function () {
        if (favSelect.value) {
          // The select carries the path; find the favourite to recover its class too.
          var fv = favGet().filter(function (x) { return x.path === favSelect.value; })[0];
          emit('loadSynthPath', { path: favSelect.value, cls: (fv && fv.cls) || '' });
        }
        // BLUR, always. A mac WebKit <select> KEEPS keyboard focus after use (clicking
        // the canvas doesn't move focus), and a focused select turns every letter into
        // type-ahead over the plugin list — the field report was literally "letter F is
        // looking for plugins with letter F" — while the SELECT branch of _noteTyping()
        // told native to stand down, killing note keys until a reload. One blur ends
        // the whole failure class; same reason the modals blur on close below.
        try { favSelect.blur(); } catch (e) {}
      };
      // ── group titles for the device bar ─────────────────────────────────
      // Same inline treatment as the compact toolbar: a tiny title at the head
      // of each family, and a hairline between families. Zero added height, the
      // labels sit on the existing row.
      function _grpLabel(t) {
        var e = document.createElement('span');
        e.className = 'sgrp-l'; e.textContent = t; host.appendChild(e); return e;
      }
      function _grpDiv() {
        var e = document.createElement('span');
        e.className = 'sdiv'; host.appendChild(e); return e;
      }
      _grpLabel('Browser');
      populateFav();
      host.appendChild(favSelect);

      // Small "manage favorites" button — opens the organizer modal (reorder/delete/add).
      // Keeps the dropdown usable even with 50+ favorites.
      var favMgrBtn = document.createElement('button');
      favMgrBtn.textContent = '☰';
      favMgrBtn.title = 'Manage favorites (reorder, delete, add)';
      favMgrBtn.className = 'sbtn sbtn--icon';
      favMgrBtn.onclick = function () { showFavManager(); };
      host.appendChild(favMgrBtn);

      // (Chain preset buttons moved to the TITLEBAR next to Compact — static markup in
      // index.html, wired below with the Update button. Field feedback 2026-08-04: the
      // control-bar glyphs read as mystery icons; worded Save/Load in the top row don't.)

      function sbtn(label, ev, cls) {
        var b = document.createElement('button');
        b.textContent = label;
        b.className = cls;
        b.onclick = function () { emit(ev); };
        host.appendChild(b);
        return b;
      }
      sbtn('+ Add', 'browsePlugins', BTN_PRIMARY);      // opens the Stride-styled plugin browser
      _grpDiv(); _grpLabel('Map');
      var mapBtn = sbtn('◉ Map', 'toggleLearn', BTN_MAP);
      var unmapBtn = sbtn('⊘ Unmap', 'toggleUnlearn', BTN_UNMAP); unmapBtn.title = 'Arm Unmap, then touch a mapped knob in the synth to remove it from the canvas';

      // == MAP LIVE: StrideBridge - Ableton's own devices as lanes. Hidden until the
      // :9101 socket answers; the button appearing IS the "bridge detected" indicator.
      var mapLiveBtn = document.createElement('button');
      mapLiveBtn.id = 'sd-maplive-btn';
      mapLiveBtn.textContent = '◉ Map Live';
      mapLiveBtn.className = BTN_MAP;
      mapLiveBtn.style.display = 'none';
      mapLiveBtn.title = 'Map a parameter of any Ableton device: press, then click a knob in Live. If that knob is already selected, click another knob first. Needs the StrideBridge device in the set.';
      mapLiveBtn.onclick = function () { if (window.sdBridgeMapToggle) window.sdBridgeMapToggle(); };
      host.appendChild(mapLiveBtn);
      _sb.mapBtn = mapLiveBtn;
      if (_sb.open) mapLiveBtn.style.display = '';

      // ── KEYSWITCH MODE: MIDI keyswitches (the "playful" octave) ────
      // An opt-in performance MODE, never a default: the pill toggles it, the ▾ picks which
      // octave is the switch zone. Sits AFTER the Map/Unmap pair (field request 2026-07-28:
      // the mapping pair stays adjacent). State is ENGINE-owned (persists with the project);
      // the pill just mirrors keysState {on, base}.
      var _keysOn = false, _keysBase = 0;
      var KS_NAMES = ['Chaos', 'Neuro', 'Reflector', 'S&H', 'Prism', 'Bloom', 'Mutate', 'Shuffle'];
      var KS_SEMIS = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G'];
      function _ksOct(base) { return base === 24 ? '0' : (base === 12 ? '-1' : '-2'); }  // Live labeling (C3 = middle C)
      function _keysLegend() {
        var o = _ksOct(_keysBase), parts = [];
        for (var i = 0; i < 8; i++) parts.push(KS_SEMIS[i] + o + ' ' + KS_NAMES[i]);
        return 'MIDI keyswitches - play the tools from the ' + KS_SEMIS[0] + o + ' octave:\n'
          + parts.join(' · ') + '\n'
          + 'While ON, that whole octave is consumed - your instrument never hears it. Works live or from notes in a clip.';
      }
      var keysWrap = document.createElement('div'); keysWrap.className = 'relative flex items-center'; host.appendChild(keysWrap);
      var keysBtn = document.createElement('button');
      keysBtn.textContent = 'Keyswitch Mode';
      keysBtn.className = BTN_GHOST;
      function _paintKeysBtn() {
        keysBtn.className = _keysOn
          ? 'text-[11px] font-bold uppercase tracking-wider text-fuchsia-300 bg-fuchsia-500/20 border border-fuchsia-400/50 rounded px-2 py-0.5 transition-colors'
          : BTN_GHOST;
        keysBtn.title = _keysLegend();
      }
      keysBtn.onclick = function () { emit('setKeys', { on: !_keysOn }); };
      keysWrap.appendChild(keysBtn);

      // Octave picker (the ▾): which octave IS the switch zone. C-2 = below any keyboard's
      // last key (pads/clips only, can never sit on real notes); C0 = hand-reachable on any
      // keyboard but overlaps real bass range - the user's informed trade.
      var keysOctBtn = document.createElement('button');
      keysOctBtn.innerHTML = '<span style="font-size:9px;line-height:1">▾</span>';
      keysOctBtn.title = 'Choose the keyswitch octave';
      keysOctBtn.className = 'sbtn sbtn--icon ml-0.5';
      keysWrap.appendChild(keysOctBtn);
      var keysPop = document.createElement('div');
      keysPop.className = 'hidden absolute left-0 top-full mt-1 z-[10060] bg-zinc-950 border border-white/10 rounded-lg shadow-2xl p-2 w-[230px]';
      keysPop.style.fontFamily = "'Outfit',sans-serif";
      keysWrap.appendChild(keysPop);
      function _renderKeysPop() {
        var rows = [
          [0,  'C-2 octave', 'Pads & clip notes - below every keyboard, never collides'],
          [12, 'C-1 octave', 'One octave up - reachable with one octave-shift'],
          [24, 'C0 octave',  'On any keyboard - careful: real bass notes live here']
        ];
        var h = '<div class="text-[9px] font-black uppercase tracking-[0.15em] text-zinc-300 mb-1.5">Keyswitch octave</div>';
        for (var i = 0; i < rows.length; i++) {
          var on = _keysBase === rows[i][0];
          h += '<button data-ksbase="' + rows[i][0] + '" class="w-full text-left rounded px-1.5 py-1 mb-0.5 border '
            + (on ? 'border-fuchsia-400/50 bg-fuchsia-500/15 text-fuchsia-200' : 'border-white/5 text-zinc-400 hover:text-zinc-200 hover:border-white/15')
            + '"><span class="text-[10px] font-bold uppercase tracking-wider">' + rows[i][1] + '</span>'
            + '<span class="block text-[9px] text-zinc-500 leading-tight">' + rows[i][2] + '</span></button>';
        }
        keysPop.innerHTML = h;
        var btns = keysPop.querySelectorAll('button[data-ksbase]');
        for (var j = 0; j < btns.length; j++) (function (b) {
          b.onclick = function () { emit('setKeys', { on: _keysOn, base: parseInt(b.getAttribute('data-ksbase'), 10) }); keysPop.classList.add('hidden'); };
        })(btns[j]);
      }
      keysOctBtn.onclick = function (e) { e.stopPropagation(); _renderKeysPop(); keysPop.classList.toggle('hidden'); };
      document.addEventListener('click', function (e) { if (!keysWrap.contains(e.target)) keysPop.classList.add('hidden'); });
      listen('keysState', function (d) { _keysOn = !!(d && d.on); _keysBase = (d && (d.base === 12 || d.base === 24)) ? d.base : 0; _paintKeysBtn(); });

      // Keyswitch triggers -> the SAME one-click tools the toolbar fires. Bit n = MIDI note n.
      var KS_ACTIONS = [
        ['Chaos',     function () { window.sdApplyGlobalChaos      && window.sdApplyGlobalChaos(); }],
        ['Neuro',     function () { window.sdApplyGlobalNeuro      && window.sdApplyGlobalNeuro(); }],
        ['Reflector', function () { window.sdApplyGlobalReflector  && window.sdApplyGlobalReflector(); }],
        ['S&H',       function () { window.sdApplyGlobalSampleHold && window.sdApplyGlobalSampleHold(); }],
        ['Prism',     function () { window.sdApplyGlobalPrism      && window.sdApplyGlobalPrism(); }],
        ['Bloom',     function () { window.sdApplyBloom            && window.sdApplyBloom(); }],
        ['Mutate',    function () { window.sdMutate                && window.sdMutate(); }],
        ['Shuffle',   function () { window.sdShuffleLanes          && window.sdShuffleLanes(); }]
      ];
      listen('keyswitch', function (d) {
        var mask = (d && d.mask) | 0;
        var fired = [];
        for (var i = 0; i < KS_ACTIONS.length; i++)
          if (mask & (1 << i)) { try { KS_ACTIONS[i][1](); fired.push(KS_ACTIONS[i][0]); } catch (e) {} }
        if (fired.length) {
          var st = document.getElementById('sd-canvas-status');
          if (st) st.textContent = '🎹 ' + fired.join(' + ');
        }
      });
      _grpDiv(); _grpLabel('Chain');
      var openBtn = sbtn('⛶', 'openSynth', BTN_GHOST); openBtn.title = 'Open device windows'; openBtn.classList.add('text-[12px]');
      var closeBtn = sbtn('⊟', 'closeSynth', BTN_GHOST); closeBtn.title = 'Close all device windows'; closeBtn.classList.add('text-[12px]');
      var clearBtn = sbtn('Clear', 'clearChain', BTN_GHOST);
      clearBtn.onclick = function () { emit('clearChain'); _armUndo(null, 'Chain cleared · Ctrl+Z to undo'); };

      // Host automation — folded under ONE automation icon (only needed when routing to the
      // DAW, so it stays out of the way). Click it for a popover with the Live/DAW drive
      // toggle + "Send to Ableton" (exposes the mapped knobs to the DAW's Configure list).
      var _driveMode = 0, _exposedMacros = 0, _macroPool = 32, _followMode = false;
      var autoWrap = document.createElement('div'); autoWrap.className = 'relative'; host.appendChild(autoWrap);

      var autoBtn = document.createElement('button');
      autoBtn.title = 'DAW automation — expose the mapped knobs to your DAW and switch Live / DAW drive';
      autoBtn.innerHTML = '<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 16 H8 L14 8 H21"/><circle cx="8" cy="16" r="1.7" fill="currentColor" stroke="none"/><circle cx="14" cy="8" r="1.7" fill="currentColor" stroke="none"/></svg><span style="font-size:9px;line-height:1">▾</span>';
      autoWrap.appendChild(autoBtn);

      var pop = document.createElement('div');
      pop.className = 'hidden absolute left-0 top-full mt-1 z-[10060] bg-zinc-950 border border-white/10 rounded-lg shadow-2xl p-2 w-[220px]';
      pop.style.fontFamily = "'Outfit',sans-serif";
      pop.innerHTML =
        '<div class="flex items-center justify-between mb-1.5">'
        + '<span class="text-[9px] font-black uppercase tracking-[0.15em] text-zinc-300">DAW Automation</span>'
        + '<span id="sd-auto-count" class="text-[9px] font-bold text-zinc-500"></span>'
        + '</div>'
        + '<div class="flex items-center gap-1 mb-2">'
        + '<button id="sd-auto-live" class="flex-1 text-[10px] font-bold uppercase tracking-wider px-2 py-1 rounded transition-colors" title="Stride’s curves drive the knobs (params follow in the DAW).">▶ Stride</button>'
        + '<button id="sd-auto-daw" class="flex-1 text-[10px] font-bold uppercase tracking-wider px-2 py-1 rounded transition-colors" title="The DAW’s automation drives the knobs; Stride steps back.">◆ DAW</button>'
        + '</div>'
        + '<button id="sd-auto-send" class="sbtn sbtn--go w-full mb-1.5">↱ Send to DAW</button>'
        + '<button id="sd-auto-follow" class="w-full text-[10px] font-bold uppercase tracking-wider rounded px-2 py-1 transition-colors mb-1.5 border" title="ON: the exposed params visibly ride the motion during plain playback — and the DAW logs those moves into its UNDO history (the trade). OFF: they follow only while recording; undo stays clean.">Follow playback · off</button>'
        + '<p class="text-[9px] text-zinc-500 leading-snug">In Ableton: click <b class="text-zinc-400">Configure</b> on the Stride device, then <b class="text-zinc-400">Send</b> — your mapped knobs appear. Other DAWs list them automatically.</p>';
      autoWrap.appendChild(pop);

      var liveSeg = pop.querySelector('#sd-auto-live');
      var dawSeg  = pop.querySelector('#sd-auto-daw');
      var sendSeg = pop.querySelector('#sd-auto-send');
      var followSeg = pop.querySelector('#sd-auto-follow');
      var countEl = pop.querySelector('#sd-auto-count');

      // DAW-mode signal: in ◆ DAW the DAW's automation drives the knobs and Stride's curve
      // engine is OFF — so dim the canvas + show a banner. It's Stride-drives OR DAW-drives.
      if (! document.getElementById('sd-daw-style')) {
        var st = document.createElement('style'); st.id = 'sd-daw-style';
        st.textContent = '#sd-canvas-container > canvas{transition:opacity .2s} body.sd-daw-mode #sd-canvas-container > canvas{opacity:.22}';
        document.head.appendChild(st);
      }
      var dawBanner = null;
      (function () {
        var cc = document.getElementById('sd-canvas-container');
        if (! cc) return;
        dawBanner = document.createElement('div');
        dawBanner.className = 'hidden absolute top-2 left-1/2 -translate-x-1/2 z-[45] flex items-center gap-2 bg-cyan-950/90 border border-cyan-400/40 rounded-full px-3.5 py-1.5 shadow-xl';
        dawBanner.style.backdropFilter = 'blur(6px)';
        dawBanner.innerHTML = '<span class="text-[10px] font-black uppercase tracking-[0.16em] text-cyan-300">◆ DAW driving</span>'
          + '<span class="text-[10px] text-cyan-100/70 font-medium">Stride curves paused — switch to ▶ Stride to edit</span>';
        cc.appendChild(dawBanner);
      })();

      function paintAuto() {
        var daw = (_driveMode === 1);
        autoBtn.className = BTN_BASE + (daw ? 'is-on sbtn--alt' : '');
        liveSeg.className = 'sbtn flex-1' + (!daw ? ' is-on' : '');
        dawSeg.className  = 'sbtn flex-1' + (daw ? ' is-on sbtn--alt' : '');
        if (countEl) countEl.textContent = _exposedMacros ? (_exposedMacros + '/' + _macroPool + ' exposed') : 'none exposed';
        if (followSeg) {
          followSeg.textContent = 'Follow playback · ' + (_followMode ? 'ON' : 'off');
          followSeg.className = 'sbtn w-full mb-1.5' + (_followMode
            ? ' is-on'
            : '');
        }
        document.body.classList.toggle('sd-daw-mode', daw);           // dims the canvas
        if (dawBanner) dawBanner.classList.toggle('hidden', ! daw);   // shows the "DAW driving" banner
      }
      liveSeg.onclick = function () { if (_driveMode !== 0) emit('setDriveMode', { mode: 0 }); };
      dawSeg.onclick  = function () { if (_driveMode !== 1) emit('setDriveMode', { mode: 1 }); };
      sendSeg.onclick = function () { emit('announceMacros'); var t = sendSeg.textContent; sendSeg.textContent = '✓ Sent ' + (_exposedMacros || 0); setTimeout(function () { sendSeg.textContent = t; }, 1500); };
      if (followSeg) followSeg.onclick = function () {
        _followMode = ! _followMode;   // optimistic — the rack_scanned echo is the reopen truth
        paintAuto();
        try { window.strideLink.send({ type: 'set_follow', on: _followMode }); } catch (e) {}
      };
      autoBtn.onclick = function (e) { e.stopPropagation(); pop.classList.toggle('hidden'); };
      document.addEventListener('click', function (e) { if (! autoWrap.contains(e.target)) pop.classList.add('hidden'); });
      paintAuto();

      // ── Tempo — ON the bar, no popup. An on/off toggle: SYNC (default, follows the
      // project exactly) ↔ MANUAL (Stride's own BPM: 70 on a 140 set = half-time
      // everything, any 5–999 value). In manual, the number sits right next to the
      // toggle and SCRUBS like the range MIN/MAX fields (press + drag up/down, ~1 BPM
      // per 2px); double-click it to type an exact value. Engine-owned + project-saved.
      var _tempoMode = 0, _manualBpm = 120;   // 0=sync 1=manual
      var tempoBtn = document.createElement('button');
      tempoBtn.title = 'Stride tempo — SYNC follows the project; MANUAL runs all motion at your own BPM';
      _grpDiv(); _grpLabel('Play');
      host.appendChild(tempoBtn);

      var bpmEl = document.createElement('div');
      bpmEl.title = 'Drag up/down to set the BPM · double-click to type';
      bpmEl.style.cursor = 'ns-resize';
      bpmEl.style.userSelect = 'none';
      host.appendChild(bpmEl);

      var _bpmDrag = null;   // { startY, startVal } while scrubbing
      var _bpmTyping = false;

      function paintTempo() {
        var synced = (_tempoMode === 0);
        tempoBtn.className = BTN_BASE + (synced ? '' : 'is-on');
        tempoBtn.textContent = synced ? '♪ sync' : '♪ manual';
        bpmEl.className = 'text-[11px] font-bold rounded px-2 py-1 border transition-colors '
          + (synced ? 'hidden' : 'text-orange-200 bg-zinc-900 border-orange-400/40 hover:border-orange-300/70');
        if (! _bpmTyping) bpmEl.textContent = Math.round(_manualBpm) + ' bpm';
      }
      function pushTempo() { try { window.strideLink.send({ type: 'set_tempo_mode', mode: _tempoMode, bpm: _manualBpm }); } catch (e) {} }
      function clampBpm(v) { v = parseFloat(v); return isNaN(v) ? _manualBpm : Math.max(5, Math.min(999, v)); }

      tempoBtn.onclick = function () { _tempoMode = (_tempoMode === 0 ? 1 : 0); paintTempo(); pushTempo(); };

      // Scrub: press + drag up/down, ~1 BPM per 2px (the range-field feel). Commit rides
      // along live so the motion re-times under your finger.
      bpmEl.addEventListener('mousedown', function (e) {
        if (_bpmTyping) return;
        _bpmDrag = { startY: e.clientY, startVal: _manualBpm };
        e.preventDefault();
      });
      window.addEventListener('mousemove', function (e) {
        if (! _bpmDrag) return;
        _manualBpm = clampBpm(Math.round(_bpmDrag.startVal + (_bpmDrag.startY - e.clientY) * 0.5));
        paintTempo(); pushTempo();
      });
      window.addEventListener('mouseup', function () { _bpmDrag = null; });

      // Double-click = type an exact value (keeps the writing path). Enter/blur commits,
      // Escape cancels.
      bpmEl.addEventListener('dblclick', function () {
        if (_bpmTyping) return;
        _bpmTyping = true;
        var prev = Math.round(_manualBpm);
        bpmEl.textContent = '';
        var inp = document.createElement('input');
        inp.type = 'text'; inp.inputMode = 'numeric'; inp.value = String(prev);
        inp.className = 'w-[44px] bg-transparent text-[11px] font-bold text-orange-200 focus:outline-none';
        bpmEl.appendChild(inp);
        inp.focus(); inp.select();
        function done(commit) {
          if (! _bpmTyping) return;
          _bpmTyping = false;
          if (commit) { _manualBpm = clampBpm(inp.value); pushTempo(); }
          paintTempo();
        }
        inp.onkeydown = function (ev) {
          if (ev.key === 'Enter') { ev.preventDefault(); done(true); }
          else if (ev.key === 'Escape') { ev.preventDefault(); done(false); }
          ev.stopPropagation();
        };
        inp.onblur = function () { done(true); };
      });
      paintTempo();

      // ── Run — what makes the motion clock RUN, a 3-state cycle:
      // TRANSPORT (default): the DAW playhead, as always.
      // NOTES · RETRIG: MIDI-gated — every note from silence restarts the phrase at bar 1,
      //   motion moves while notes are held, letting go freezes it. The performance mode.
      // NOTES · FREE: the first note just STARTS the clock — from then on it keeps running
      //   at Stride's tempo (project sync or your manual BPM), deaf to further notes.
      //   Stopping the DAW transport re-arms it (parks at bar 1), so every clip you play
      //   after a stop starts the motion from the beginning; re-selecting the mode still
      //   re-arms too. No Play button needed in either.
      // Engine-owned + project-saved, echoed via rack_scanned like the tempo mode.
      var _runMode = 0;
      var runBtn = document.createElement('button');
      runBtn.title = 'Run mode (click to cycle) — TRANSPORT: follows the DAW playhead. '
        + 'NOTES RETRIG: every note from silence restarts the phrase; motion runs while notes are held. '
        + 'NOTES FREE: the first note starts the motion from the beginning and it keeps running through rests; stopping the DAW restarts it for the next clip. No Play needed.';
      host.appendChild(runBtn);
      function paintRun() {
        if (_runMode === 0) {
          runBtn.className = BTN_BASE;
          runBtn.textContent = '▸ transport';
        } else if (_runMode === 1) {
          runBtn.className = BTN_BASE + 'is-on';
          runBtn.textContent = '▸ notes retrig';
        } else {
          runBtn.className = BTN_BASE + 'is-on sbtn--alt';
          runBtn.textContent = '▸ notes free';
        }
      }
      runBtn.onclick = function () {
        _runMode = (_runMode + 1) % 3;
        paintRun();
        try { window.strideLink.send({ type: 'set_run_mode', mode: _runMode }); } catch (e) {}
      };
      paintRun();

      listen('sl_event', function (msg) {
        if (! msg || msg.type !== 'rack_scanned') return;
        if (typeof msg.tempo_mode !== 'undefined') _tempoMode = msg.tempo_mode | 0;
        if (typeof msg.manual_bpm !== 'undefined' && msg.manual_bpm > 0) _manualBpm = msg.manual_bpm;
        if (typeof msg.run_mode !== 'undefined') _runMode = msg.run_mode | 0;
        paintTempo();
        paintRun();
      });
      // Which build am I? Stride and Stride FX share this exact page (one BinaryData for
      // both targets), so the page has to be told. Once, on the first rack_scanned that
      // says so: the title bar and the activation card say STRIDE FX, and nothing else
      // in the UI differs, because nothing else about the plugin does.
      var _fxNamed = false;
      listen('sl_event', function (msg) {
        if (! msg || msg.type !== 'rack_scanned' || _fxNamed || ! msg.is_fx) return;
        _fxNamed = true;
        try {
          document.title = 'STRIDE FX';
          var brands = document.querySelectorAll('.text-gradient');
          for (var i = 0; i < brands.length; i++)
            if ((brands[i].textContent || '').trim().toUpperCase() === 'STRIDE')
              brands[i].textContent = 'STRIDE FX';
        } catch (e) {}
      });

      // Host-driven BPM (the "Stride BPM" DAW param on a MIDI knob) — a light live echo
      // so the tempo pill follows the knob without a heavy rack re-push.
      listen('bpmEcho', function (d) {
        if (d && d.bpm > 0) { _manualBpm = Math.round(d.bpm * 10) / 10; paintTempo(); }
      });

      // ── Check for updates — the TITLEBAR button next to Guide (static markup in
      // index.html, wired here). One click: the engine asks the backend for a SIGNED
      // direct download (license-gated, per-platform, always the files currently on
      // Lemon Squeezy); any failure lands on the My Orders portal instead. Either way
      // the browser opens — no email hunt, no login.
      // Chain presets (titlebar, next to Compact) — static markup in index.html, wired
      // here like the Update button. Native side owns the choosers + the demo gate.
      var svChainBtn = document.getElementById('sd-save-chain-btn');
      if (svChainBtn) svChainBtn.onclick = function () { emit('saveChain'); };
      var ldChainBtn = document.getElementById('sd-load-chain-btn');
      if (ldChainBtn) ldChainBtn.onclick = function () { emit('loadChain'); };

      var updBtn = document.getElementById('sd-update-btn');
      if (updBtn) {
        updBtn.onclick = function () { updBtn.textContent = '…'; emit('checkUpdate'); };
        listen('updateReply', function (d) {
          updBtn.textContent = (d && d.ok) ? '✓ downloading' : '↗ opened';
          setTimeout(function () { updBtn.textContent = 'Update'; }, 2500);
        });
      }

      listen('sl_event', function (msg) {
        // rack_scanned (full) AND unmapped_at (one-lane splice) both carry the macro counts.
        if (! msg || (msg.type !== 'rack_scanned' && msg.type !== 'unmapped_at')) return;
        if (typeof msg.drive_mode     !== 'undefined') { _driveMode = msg.drive_mode | 0; _sb.driveMode = _driveMode; }
        if (typeof msg.host_driven    !== 'undefined') _sb.hostDriven = msg.host_driven | 0;   // the ENGINE's own count, not ours
        if (typeof msg.drive_lanes    !== 'undefined') _sb.driveLanes = msg.drive_lanes | 0;   // curves the ENGINE holds
        if (typeof msg.exposed_macros !== 'undefined') _exposedMacros = msg.exposed_macros | 0;
        if (typeof msg.macro_pool     !== 'undefined') _macroPool     = msg.macro_pool | 0;
        if (typeof msg.follow_mode    !== 'undefined') _followMode    = !! msg.follow_mode;
        paintAuto();
      });

      var divider = document.createElement('span'); divider.className = 'sdiv'; host.appendChild(divider);
      _grpLabel('Devices');

      // Device list — every loaded device, each with a ✕ that is the ONLY way to remove it.
      var chips = document.createElement('div'); chips.id = 'stride-dev-chips'; chips.className = 'flex items-center gap-1.5 flex-wrap'; host.appendChild(chips);

      listen('chainDevices', function (d) {
        var c = document.getElementById('stride-dev-chips'); if (! c) return;
        c.innerHTML = '';
        var names = (d && d.names) || [];
        if (! names.length) { var e = document.createElement('span'); e.className = 'text-[10px] text-zinc-600 uppercase tracking-wider'; e.textContent = 'no devices'; c.appendChild(e); return; }
        var byp = (d && d.bypassed) || [];
        var dragFrom = null;   // shared across chips — the device being dragged
        names.forEach(function (nm, i) {
          var off = !!byp[i];   // true = bypassed
          var chip = document.createElement('div'); chip.className = 'flex items-center gap-1.5 bg-zinc-900 border border-white/10 rounded px-2 py-0.5 cursor-grab' + (off ? ' opacity-60' : '');
          chip.draggable = true;   // drag to reorder the chain; Alt+drag to duplicate
          var grip = document.createElement('span'); grip.textContent = '⠿'; grip.title = 'Drag to reorder · Alt+drag to duplicate this device'; grip.className = 'text-zinc-600 text-[11px] shrink-0 -ml-0.5 select-none';
          chip.appendChild(grip);
          var dot = document.createElement('button');
          dot.title = off ? 'Bypassed, click to enable' : 'Active, click to bypass';
          dot.className = 'w-2.5 h-2.5 rounded-full shrink-0 transition-colors ' + (off ? 'bg-zinc-600 hover:bg-zinc-500' : 'bg-emerald-400 hover:bg-emerald-300 shadow-[0_0_6px_rgba(52,211,153,0.7)]');
          dot.onclick = function () { emit('setBypass', { i: i, on: off }); };   // off now? send on=true to enable; active now? send on=false to bypass
          chip.appendChild(dot);
          // Focus by chain SLOT, not by name: the same plugin can sit in the chain twice, and
          // focusing one used to show the lanes of BOTH (field report 2026-08-20).
          chip.dataset.slot = String(i);
          if (_devFilter === i) chip.classList.add('ring-1', 'ring-fuchsia-400/70');
          // ...and when a name IS repeated, number the copies so they can be told apart.
          var dupTotal = 0, dupIdx = 0;
          names.forEach(function (o, k) { if ((o || '') === (nm || '')) { dupTotal++; if (k <= i) dupIdx++; } });
          var s = document.createElement('button'); s.className = 'text-[11px] text-zinc-300 hover:text-fuchsia-300 max-w-[140px] truncate text-left'; s.textContent = (nm || ('Device ' + (i + 1))) + (dupTotal > 1 ? ' ' + dupIdx : ''); s.title = 'Show only this device’s lanes on the canvas (click again for all)';
          s.onclick = function () {
            _devFilter = (window.sdSetDeviceFilter ? window.sdSetDeviceFilter(i) : null);
            var kids = c.children;
            for (var k = 0; k < kids.length; k++) {
              var sel = (typeof _devFilter === 'number' && kids[k].dataset
                         && parseInt(kids[k].dataset.slot, 10) === _devFilter);
              kids[k].classList.toggle('ring-1', sel);
              kids[k].classList.toggle('ring-fuchsia-400/70', sel);
            }
          };
          chip.appendChild(s);
          var op = document.createElement('button'); op.textContent = '⛶'; op.title = 'Open this device’s window'; op.className = 'text-zinc-500 hover:text-fuchsia-400 text-[11px] font-bold';
          op.onclick = function () {
            // the built-in Tendril lives on the wall - route there instead of a floating window
            if (d && d.builtin && d.builtin[i]) { var tb = document.getElementById('sd-tab-tendril'); if (tb) { tb.click(); return; } }
            emit('openSynthOne', { i: i });
          };
          chip.appendChild(op);
          var x = document.createElement('button'); x.textContent = '✕'; x.title = 'Remove this device from Stride'; x.className = 'text-zinc-500 hover:text-orange-400 text-[10px] font-bold';
          x.onclick = function () { emit('removeDevice', { i: i }); _armUndo(nm); };
          chip.appendChild(x);
          // Drag to reorder the chain (reverb before OTT, etc.). Outline (not ring) for the drop
          // hover so it never clashes with the fuchsia device-filter ring.
          // ALT+drag = DUPLICATE: drop with Alt held clones the dragged device (same patch,
          // same mapped params, EMPTY lanes) right after the chip it lands on — so Alt+drop
          // on the device itself is the classic "duplicate next to it". Modifier read at
          // hover/drop time, so pressing/releasing Alt mid-drag switches the action live.
          chip.addEventListener('dragstart', function (e) { dragFrom = i; try { e.dataTransfer.effectAllowed = 'copyMove'; e.dataTransfer.setData('text/plain', String(i)); } catch (x2) {} chip.style.opacity = '0.4'; });
          chip.addEventListener('dragend',   function () { chip.style.opacity = ''; chip.style.outline = ''; dragFrom = null; });
          chip.addEventListener('dragover',  function (e) {
            if (dragFrom == null || (dragFrom === i && ! e.altKey)) return;   // same-chip drop only means something with Alt (duplicate-in-place)
            e.preventDefault();
            try { e.dataTransfer.dropEffect = e.altKey ? 'copy' : 'move'; } catch (x2) {}
            chip.style.outline = e.altKey ? '2px solid rgba(52,211,153,0.8)' : '2px solid rgba(34,211,238,0.7)';   // emerald = copy, cyan = move
            chip.style.outlineOffset = '1px';
          });
          chip.addEventListener('dragleave', function () { chip.style.outline = ''; });
          chip.addEventListener('drop',      function (e) {
            e.preventDefault(); chip.style.outline = '';
            var from = dragFrom; dragFrom = null;
            if (from == null) return;
            if (e.altKey) { emit('duplicateDevice', { from: from, to: i + 1 }); return; }   // copy lands right AFTER the chip it dropped on
            if (from === i) return;
            emit('moveDevice', { from: from, to: i });
          });
          c.appendChild(chip);
        });
      });

      listen('favoritesPicked', function (d) {
        var favs = favGet(); var have = {};
        favs.forEach(function (f) { have[f.path] = 1; });
        ((d && d.paths) || []).forEach(function (p) { if (! have[p]) { favs.push({ name: favLabel(p), path: p }); have[p] = 1; } });
        favSet(favs); populateFav();
      });
      listen('learnState', function (d) {
        var on = !!(d && d.on), unmap = !!(d && d.unmap);
        mapBtn.className = on ? BTN_MAP_ARMED : BTN_MAP;
        mapBtn.textContent = on ? '◉ Mapping…' : '◉ Map';
        unmapBtn.className = unmap ? BTN_UNMAP_ARMED : BTN_UNMAP;
        unmapBtn.textContent = unmap ? '⊘ Unmapping…' : '⊘ Unmap';
      });
    } catch (e) { showErr('bar: ' + e.message); }
  }

  // Present the wrapper as the COMPACT device (same canvas, reflowed). Motion buttons are
  // now native in the compact toolbar markup, so nothing to inject here.
  function setupCompact() {
    try {
      if (window.toggleCompactMode && ! document.body.classList.contains('qp-compact'))
        window.toggleCompactMode();
    } catch (e) { showErr('compact: ' + e.message); }
  }

  function onReady() {
    buildBar();
    setTimeout(function () { setupCompact(); emit('wrapperReady'); }, 350);   // after canvas.js init
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', onReady);
  else onReady();
})();
