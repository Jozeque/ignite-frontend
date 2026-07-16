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
  listen('fullscreenState', function (d) {
    var ic = document.getElementById('sd-fs-icon'), btn = document.getElementById('sd-fullscreen-btn');
    if (! ic) return;
    var on = !!(d && d.on);
    ic.setAttribute('d', on ? 'M9 4v5H4 M15 4v5h5 M9 20v-5H4 M15 20v-5h5'      // restore (corners in)
                            : 'M4 9V4h5 M20 9V4h-5 M4 15v5h5 M20 15v5h-5');    // maximize (corners out)
    if (btn) btn.title = on ? 'Exit fullscreen (restore size)' : 'Fullscreen (maximize)';
  });

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
  }, true);

  // No clips in the wrapper — drawing modulates the synth live. Hide the Ableton-only
  // "Inject to Clip" rail and the StrideInject setup modal.
  try {
    var hideCss = document.createElement('style');
    hideCss.textContent = '#sd-inject-rail{display:none!important} #sd-strideinject-modal{display:none!important} #link-status{display:none!important} #stride-stale-banner{display:none!important} #sd-install-m4l-overlay{display:none!important} #sd-welcome-overlay{display:none!important}'
      + ' @keyframes sdMapPulse{0%,100%{transform:scale(1);box-shadow:0 0 0 0 rgba(250,204,21,0)}50%{transform:scale(1.07);box-shadow:0 0 12px 3px rgba(250,204,21,.6)}}'
      + ' .sd-map-armed{animation:sdMapPulse 1.15s ease-in-out infinite}'
      + ' @keyframes sdUnmapPulse{0%,100%{transform:scale(1);box-shadow:0 0 0 0 rgba(244,63,94,0)}50%{transform:scale(1.07);box-shadow:0 0 12px 3px rgba(244,63,94,.6)}}'
      + ' .sd-unmap-armed{animation:sdUnmapPulse 1.15s ease-in-out infinite}';
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
      // LIVE drive: the canvas calls this after every edit. state = [{_path, rangeOn, rangeMin, rangeMax, points}].
      // A ranged lane sends its 0..1 shape SCALED into [rangeMin,rangeMax] so the live-drive matches the inject.
      try {
        emit('sl_send', { type: 'live_curves', clip_bars: (window.sdGetBars ? window.sdGetBars() : 0), parameters: (state || []).map(function (l) {
          var pos = parseInt(String(l._path || '').split(':')[1], 10);
          var pts = (l.rangeOn && (l.points || []).length)
            ? l.points.map(function (pt) { return { time: pt.time, value: Math.max(0, Math.min(1, l.rangeMin + pt.value * (l.rangeMax - l.rangeMin))), curve: pt.curve || 0 }; })
            : (l.points || []);
          return { id: isNaN(pos) ? -1 : pos, _path: l._path || null, points: pts };
        }) });
      } catch (e) {}
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

  // C++ -> JS : C++ emits 'sl_event' {type, ...}; dispatch to strideLink handlers by type.
  listen('sl_event', function (msg) {
    try { window.strideLink._emit(msg && msg.type, msg); } catch (e) { showErr('sl_event: ' + e.message); }
  });

  // TRUE playhead: the engine's real loop phase (0..1 + playing flag) drives the lane
  // comets — canvas.js retires its ambient wall-clock drift on the first tick and then
  // repaints only when the phase actually moves (zero cost while stopped).
  listen('playhead', function (d) {
    try { if (window.sdSetEnginePlayhead) window.sdSetEnginePlayhead((d && d.p) || 0, !!(d && d.on)); } catch (e) { showErr('playhead: ' + e.message); }
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
  function favSet(v) { lsSet('stride_fav_synths', v); emit('prefsSave', { prefs: { favorites: v } }); }

  // Boot sync with the native prefs file (sent by C++ right before 'connected'):
  //   native has favorites -> adopt them (they survive profile resets / temp cleanup)
  //   native empty but the local cache has favorites -> seed the native file from the
  //   cache (first run after this update — the one-time rescue direction)
  listen('prefsState', function (d) {
    try {
      var nat = (d && d.prefs && d.prefs.favorites) || [];
      if (nat.length) { lsSet('stride_fav_synths', nat); populateFav(); }
      else { var loc = lsGet('stride_fav_synths', []); if (loc.length) emit('prefsSave', { prefs: { favorites: loc } }); }
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
  function closePluginBrowser() { if (pluginModal) { pluginModal.remove(); pluginModal = null; } }
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
        if (multiFmt && p.fmt) {
          var fc = document.createElement('span');
          fc.className = 'text-[8px] uppercase tracking-wider font-bold px-1.5 py-0.5 rounded border shrink-0 ' + (p.fmt === 'AU' ? 'text-sky-400/90 border-sky-400/25' : 'text-zinc-500 border-white/10');
          fc.textContent = p.fmt;
          left.appendChild(fc);
        }
        var add = document.createElement('span'); add.className = 'text-[9px] uppercase tracking-wider font-bold text-zinc-600 group-hover:text-orange-400 shrink-0'; add.textContent = 'Add';
        row.appendChild(left); row.appendChild(add);
        row.onclick = function () {
          emit('loadSynthPath', { path: p.path });
          var favs = favGet(); if (! favs.some(function (x) { return x.path === p.path; })) { favs.push({ name: (p.fmt === 'AU' ? p.name + ' (AU)' : p.name), path: p.path }); favSet(favs); populateFav(); }
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
  function closeFavManager() { if (favModal) { favModal.remove(); favModal = null; } }
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
        var load = document.createElement('button'); load.textContent = 'Load'; load.className = 'text-[9px] uppercase tracking-wider font-bold text-zinc-500 hover:text-fuchsia-400 opacity-0 group-hover:opacity-100 shrink-0'; load.title = 'Load this device now'; load.onclick = function () { emit('loadSynthPath', { path: f.path }); };
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
  var BTN_BASE = 'px-2 py-0.5 rounded text-[9px] uppercase tracking-wider font-bold transition-colors ';
  var BTN_GHOST = BTN_BASE + 'text-zinc-400 hover:text-zinc-100 border border-white/10';
  var BTN_PRIMARY = BTN_BASE + 'text-orange-400 bg-orange-500/10 hover:bg-orange-500/20 border border-orange-500/20';
  var BTN_ARMED = BTN_BASE + 'text-orange-400 bg-orange-500/20 border border-orange-500/40';
  // Map gets its own slightly-bigger, distinct (violet) treatment so the primary
  // "arm to learn" action reads differently from +Add / Clear.
  var BTN_MAP       = 'px-3 py-1 rounded text-[10px] uppercase tracking-wider font-bold transition-colors text-violet-200 bg-violet-500/20 hover:bg-violet-500/30 border border-violet-400/40';
  // Armed = bright YELLOW + pulse so you can't forget it's on and press it off. (Default
  // Tailwind yellow, not amber — amber is remapped to orange in the copper skin.)
  var BTN_MAP_ARMED = 'px-3 py-1 rounded text-[10px] uppercase tracking-wider font-bold transition-colors text-black bg-yellow-400 hover:bg-yellow-300 border border-yellow-300 sd-map-armed';
  // Unmap = the inverse of Map (touch a mapped knob to remove it). Rose/red so it reads as "remove".
  var BTN_UNMAP       = 'px-3 py-1 rounded text-[10px] uppercase tracking-wider font-bold transition-colors text-rose-300/90 bg-rose-500/15 hover:bg-rose-500/25 border border-rose-400/40';
  var BTN_UNMAP_ARMED = 'px-3 py-1 rounded text-[10px] uppercase tracking-wider font-bold transition-colors text-white bg-rose-500 hover:bg-rose-400 border border-rose-300 sd-unmap-armed';

  function buildBar() {
    try {
      var host = document.getElementById('stride-wrap-controls');
      if (! host) return;
      host.innerHTML = '';

      // Favorites dropdown — one-click load, no path-hunting.
      favSelect = document.createElement('select');
      favSelect.title = 'Favorite synths';
      favSelect.className = 'bg-zinc-900 border border-white/10 text-zinc-300 text-[11px] rounded px-2 py-1 cursor-pointer max-w-[180px]';
      favSelect.onchange = function () { if (favSelect.value) emit('loadSynthPath', { path: favSelect.value }); };
      populateFav();
      host.appendChild(favSelect);

      // Small "manage favorites" button — opens the organizer modal (reorder/delete/add).
      // Keeps the dropdown usable even with 50+ favorites.
      var favMgrBtn = document.createElement('button');
      favMgrBtn.textContent = '☰';
      favMgrBtn.title = 'Manage favorites (reorder, delete, add)';
      favMgrBtn.className = 'text-[12px] text-zinc-400 hover:text-orange-400 border border-white/10 rounded px-1.5 py-0.5 transition-colors';
      favMgrBtn.onclick = function () { showFavManager(); };
      host.appendChild(favMgrBtn);

      function sbtn(label, ev, cls) {
        var b = document.createElement('button');
        b.textContent = label;
        b.className = cls;
        b.onclick = function () { emit(ev); };
        host.appendChild(b);
        return b;
      }
      sbtn('+ Add', 'browsePlugins', BTN_PRIMARY);      // opens the Stride-styled plugin browser
      var mapBtn = sbtn('◉ Map', 'toggleLearn', BTN_MAP);
      var unmapBtn = sbtn('⊘ Unmap', 'toggleUnlearn', BTN_UNMAP); unmapBtn.title = 'Arm Unmap, then touch a mapped knob in the synth to remove it from the canvas';
      var openBtn = sbtn('⛶', 'openSynth', BTN_GHOST); openBtn.title = 'Open device windows'; openBtn.classList.add('text-[12px]');
      var clearBtn = sbtn('Clear', 'clearChain', BTN_GHOST);
      clearBtn.onclick = function () { emit('clearChain'); _armUndo(null, 'Chain cleared · Ctrl+Z to undo'); };

      // Host automation — folded under ONE automation icon (only needed when routing to the
      // DAW, so it stays out of the way). Click it for a popover with the Live/DAW drive
      // toggle + "Send to Ableton" (exposes the mapped knobs to the DAW's Configure list).
      var _driveMode = 0, _exposedMacros = 0, _macroPool = 32;
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
        + '<button id="sd-auto-send" class="w-full text-[10px] font-black uppercase tracking-wider text-cyan-300 bg-cyan-500/10 hover:bg-cyan-500/20 border border-cyan-400/30 rounded px-2 py-1 transition-colors mb-1.5">↱ Send to DAW</button>'
        + '<p class="text-[9px] text-zinc-500 leading-snug">In Ableton: click <b class="text-zinc-400">Configure</b> on the Stride device, then <b class="text-zinc-400">Send</b> — your mapped knobs appear. Other DAWs list them automatically.</p>';
      autoWrap.appendChild(pop);

      var liveSeg = pop.querySelector('#sd-auto-live');
      var dawSeg  = pop.querySelector('#sd-auto-daw');
      var sendSeg = pop.querySelector('#sd-auto-send');
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
        autoBtn.className = BTN_BASE + 'flex items-center gap-0.5 ' + (daw
          ? 'text-cyan-300 bg-cyan-500/15 border border-cyan-400/40'
          : 'text-zinc-400 hover:text-cyan-300 border border-white/10');
        liveSeg.className = 'flex-1 text-[10px] font-bold uppercase tracking-wider px-2 py-1 rounded transition-colors ' + (!daw ? 'text-white bg-white/15 border border-white/20' : 'text-zinc-500 hover:text-zinc-300 border border-transparent');
        dawSeg.className  = 'flex-1 text-[10px] font-bold uppercase tracking-wider px-2 py-1 rounded transition-colors ' + (daw ? 'text-cyan-200 bg-cyan-500/20 border border-cyan-400/40' : 'text-zinc-500 hover:text-zinc-300 border border-transparent');
        if (countEl) countEl.textContent = _exposedMacros ? (_exposedMacros + '/' + _macroPool + ' exposed') : 'none exposed';
        document.body.classList.toggle('sd-daw-mode', daw);           // dims the canvas
        if (dawBanner) dawBanner.classList.toggle('hidden', ! daw);   // shows the "DAW driving" banner
      }
      liveSeg.onclick = function () { if (_driveMode !== 0) emit('setDriveMode', { mode: 0 }); };
      dawSeg.onclick  = function () { if (_driveMode !== 1) emit('setDriveMode', { mode: 1 }); };
      sendSeg.onclick = function () { emit('announceMacros'); var t = sendSeg.textContent; sendSeg.textContent = '✓ Sent ' + (_exposedMacros || 0); setTimeout(function () { sendSeg.textContent = t; }, 1500); };
      autoBtn.onclick = function (e) { e.stopPropagation(); pop.classList.toggle('hidden'); };
      document.addEventListener('click', function (e) { if (! autoWrap.contains(e.target)) pop.classList.add('hidden'); });
      paintAuto();

      listen('sl_event', function (msg) {
        // rack_scanned (full) AND unmapped_at (one-lane splice) both carry the macro counts.
        if (! msg || (msg.type !== 'rack_scanned' && msg.type !== 'unmapped_at')) return;
        if (typeof msg.drive_mode     !== 'undefined') _driveMode     = msg.drive_mode | 0;
        if (typeof msg.exposed_macros !== 'undefined') _exposedMacros = msg.exposed_macros | 0;
        if (typeof msg.macro_pool     !== 'undefined') _macroPool     = msg.macro_pool | 0;
        paintAuto();
      });

      var divider = document.createElement('span'); divider.className = 'w-px h-4 bg-white/10'; host.appendChild(divider);

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
          chip.draggable = true;   // drag to reorder the chain
          var grip = document.createElement('span'); grip.textContent = '⠿'; grip.title = 'Drag to reorder'; grip.className = 'text-zinc-600 text-[11px] shrink-0 -ml-0.5 select-none';
          chip.appendChild(grip);
          var dot = document.createElement('button');
          dot.title = off ? 'Bypassed, click to enable' : 'Active, click to bypass';
          dot.className = 'w-2.5 h-2.5 rounded-full shrink-0 transition-colors ' + (off ? 'bg-zinc-600 hover:bg-zinc-500' : 'bg-emerald-400 hover:bg-emerald-300 shadow-[0_0_6px_rgba(52,211,153,0.7)]');
          dot.onclick = function () { emit('setBypass', { i: i, on: off }); };   // off now? send on=true to enable; active now? send on=false to bypass
          chip.appendChild(dot);
          chip.dataset.dev = nm || '';
          if (_devFilter && _devFilter === (nm || '')) chip.classList.add('ring-1', 'ring-fuchsia-400/70');
          var s = document.createElement('button'); s.className = 'text-[11px] text-zinc-300 hover:text-fuchsia-300 max-w-[140px] truncate text-left'; s.textContent = nm || ('Device ' + (i + 1)); s.title = 'Show only this device’s lanes on the canvas (click again for all)';
          s.onclick = function () {
            _devFilter = (window.sdSetDeviceFilter ? window.sdSetDeviceFilter(nm) : null);
            var kids = c.children;
            for (var k = 0; k < kids.length; k++) {
              var sel = !!(_devFilter && kids[k].dataset && kids[k].dataset.dev === _devFilter);
              kids[k].classList.toggle('ring-1', sel);
              kids[k].classList.toggle('ring-fuchsia-400/70', sel);
            }
          };
          chip.appendChild(s);
          var op = document.createElement('button'); op.textContent = '⛶'; op.title = 'Open this device’s window'; op.className = 'text-zinc-500 hover:text-fuchsia-400 text-[11px] font-bold';
          op.onclick = function () { emit('openSynthOne', { i: i }); };
          chip.appendChild(op);
          var x = document.createElement('button'); x.textContent = '✕'; x.title = 'Remove this device from Stride'; x.className = 'text-zinc-500 hover:text-orange-400 text-[10px] font-bold';
          x.onclick = function () { emit('removeDevice', { i: i }); _armUndo(nm); };
          chip.appendChild(x);
          // Drag to reorder the chain (reverb before OTT, etc.). Outline (not ring) for the drop
          // hover so it never clashes with the fuchsia device-filter ring.
          chip.addEventListener('dragstart', function (e) { dragFrom = i; try { e.dataTransfer.effectAllowed = 'move'; e.dataTransfer.setData('text/plain', String(i)); } catch (x2) {} chip.style.opacity = '0.4'; });
          chip.addEventListener('dragend',   function () { chip.style.opacity = ''; chip.style.outline = ''; dragFrom = null; });
          chip.addEventListener('dragover',  function (e) { if (dragFrom == null || dragFrom === i) return; e.preventDefault(); try { e.dataTransfer.dropEffect = 'move'; } catch (x2) {} chip.style.outline = '2px solid rgba(34,211,238,0.7)'; chip.style.outlineOffset = '1px'; });
          chip.addEventListener('dragleave', function () { chip.style.outline = ''; });
          chip.addEventListener('drop',      function (e) { e.preventDefault(); chip.style.outline = ''; var from = dragFrom; dragFrom = null; if (from == null || from === i) return; emit('moveDevice', { from: from, to: i }); });
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
