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
  function _armUndo(name, msg) {
    _undoArmed = true;
    if (! _undoToast) {
      _undoToast = document.createElement('div');
      _undoToast.style.cssText = 'position:fixed;left:50%;bottom:16px;transform:translateX(-50%);z-index:99998;background:#18181b;border:1px solid #3f3f46;border-radius:8px;padding:8px 12px;display:flex;align-items:center;gap:12px;font:12px Outfit,sans-serif;color:#e4e4e7;box-shadow:0 6px 24px rgba(0,0,0,.5)';
      var msg = document.createElement('span'); msg.id = '_undoMsg'; _undoToast.appendChild(msg);
      var u = document.createElement('button'); u.textContent = 'Undo'; u.style.cssText = 'background:#f97316;color:#000;border:0;border-radius:6px;padding:4px 10px;font-weight:700;cursor:pointer'; u.onclick = _doUndoRemove; _undoToast.appendChild(u);
      (document.body || document.documentElement).appendChild(_undoToast);
    }
    var m = document.getElementById('_undoMsg'); if (m) m.textContent = msg || ('Removed ' + (name || 'device') + ' · Ctrl+Z to undo');
    _undoToast.style.display = 'flex';
    if (_undoTimer) clearTimeout(_undoTimer);
    _undoTimer = setTimeout(_hideUndoToast, 7000);
  }
  window.addEventListener('keydown', function (e) {
    if (e.key === 'Escape' && pluginModal) { e.preventDefault(); e.stopImmediatePropagation(); closePluginBrowser(); return; }
    var z = (e.key === 'z' || e.key === 'Z') && (e.ctrlKey || e.metaKey) && ! e.shiftKey;
    if (z && _undoArmed) { e.preventDefault(); e.stopImmediatePropagation(); _doUndoRemove(); }
  }, true);

  // No clips in the wrapper — drawing modulates the synth live. Hide the Ableton-only
  // "Inject to Clip" rail and the StrideInject setup modal.
  try {
    var hideCss = document.createElement('style');
    hideCss.textContent = '#sd-inject-rail{display:none!important} #sd-strideinject-modal{display:none!important} #link-status{display:none!important} #stride-stale-banner{display:none!important} #sd-install-m4l-overlay{display:none!important} #sd-welcome-overlay{display:none!important}'
      + ' @keyframes sdMapPulse{0%,100%{transform:scale(1);box-shadow:0 0 0 0 rgba(167,139,250,0)}50%{transform:scale(1.07);box-shadow:0 0 10px 2px rgba(167,139,250,.5)}}'
      + ' .sd-map-armed{animation:sdMapPulse 1.15s ease-in-out infinite}';
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
    saveSettings: function (s) { lsSet('stride_settings', s); return P({ success: true }); },
    loadSettings: function () { return P({ success: true, settings: lsGet('stride_settings', {}) }); },
    saveCanvasState: function (rackId, state) {
      lsSet('stride_canvas_' + rackId, state);
      // LIVE drive: the canvas calls this after every edit. state = [{_path, points:[{time,value,curve}]}].
      try {
        emit('sl_send', { type: 'live_curves', clip_bars: (window.sdGetBars ? window.sdGetBars() : 0), parameters: (state || []).map(function (l) {
          var pos = parseInt(String(l._path || '').split(':')[1], 10);
          return { id: isNaN(pos) ? -1 : pos, _path: l._path || null, points: l.points || [] };
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
    openExternal: function () {}, openStrideFolder: function () {}, openGuideFolder: function () {},
    revealInFolder: function () {}, startDrag: function () {}
  };

  // ── window.strideLink (M4L WebSocket) — same surface, routed to JUCE ─────
  var slHandlers = {};
  window.strideLink = {
    connected: true,
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

  // ── window.strideCloud (cloud generation) — offline stub ─────────
  window.strideCloud = {
    isOnline: false, credits: 0,
    signIn: function () { return P({ success: false }); },
    generate: function () { return P({ success: false, error: 'cloud disabled in wrapper' }); },
    refreshCredits: function () { return P({ credits: 0 }); }
  };

  // ── wrapper control bar (built into the in-flow #stride-wrap-controls strip) ─────
  // Favorite synths — stored client-side so the user picks them ONCE.
  function favGet() { return lsGet('stride_fav_synths', []); }                 // [{name, path}]
  function favSet(v) { lsSet('stride_fav_synths', v); }
  function favName(path) { var p = String(path).replace(/\\/g, '/'); var f = p.split('/').pop() || path; return f.replace(/\.vst3$/i, ''); }

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
    var browse = document.createElement('button'); browse.textContent = 'Browse files…'; browse.className = 'text-[10px] uppercase tracking-wider font-bold text-zinc-400 hover:text-orange-400'; browse.title = 'Load any .vst3 from a custom folder'; browse.onclick = function () { closePluginBrowser(); emit('loadSynth'); };
    var cl = document.createElement('button'); cl.textContent = '×'; cl.className = 'text-zinc-500 hover:text-zinc-200 text-xl leading-none'; cl.onclick = closePluginBrowser;
    hright.appendChild(browse); hright.appendChild(cl);
    head.appendChild(title); head.appendChild(hright); panel.appendChild(head);

    var swrap = document.createElement('div'); swrap.className = 'px-4 py-3 border-b border-white/5';
    var search = document.createElement('input'); search.type = 'text'; search.placeholder = 'Search plugins…';
    search.className = 'w-full bg-zinc-900 border border-white/10 rounded-lg px-3 py-2 text-[12px] text-zinc-200 placeholder-zinc-600 focus:outline-none focus:border-orange-500/40';
    swrap.appendChild(search); panel.appendChild(swrap);

    var listEl = document.createElement('div'); listEl.className = 'flex-1 overflow-auto px-2 py-2'; panel.appendChild(listEl);
    function render(filter) {
      listEl.innerHTML = ''; var f = (filter || '').toLowerCase(); var shown = 0;
      plugins.forEach(function (p) {
        if (f && (p.name || '').toLowerCase().indexOf(f) < 0) return; shown++;
        var row = document.createElement('button');
        row.className = 'w-full text-left flex items-center justify-between gap-3 px-3 py-2 rounded-lg hover:bg-white/5 transition-colors group';
        var nm = document.createElement('span'); nm.className = 'text-[12px] text-zinc-200 group-hover:text-white truncate'; nm.textContent = p.name;
        var add = document.createElement('span'); add.className = 'text-[9px] uppercase tracking-wider font-bold text-zinc-600 group-hover:text-orange-400'; add.textContent = 'Add';
        row.appendChild(nm); row.appendChild(add);
        row.onclick = function () {
          emit('loadSynthPath', { path: p.path });
          var favs = favGet(); if (! favs.some(function (x) { return x.path === p.path; })) { favs.push({ name: p.name, path: p.path }); favSet(favs); populateFav(); }
          nm.className = 'text-[12px] text-emerald-400 truncate'; add.textContent = '✓ added'; add.className = 'text-[9px] uppercase tracking-wider font-bold text-emerald-400';
        };
        listEl.appendChild(row);
      });
      if (! shown) { var e = document.createElement('div'); e.className = 'text-[11px] text-zinc-600 px-3 py-6 text-center'; e.textContent = plugins.length ? 'No matches' : 'No VST3 plugins found in the standard folders.'; listEl.appendChild(e); }
    }
    search.oninput = function () { render(search.value); };
    render('');

    var foot = document.createElement('div'); foot.className = 'flex items-center justify-between px-4 py-3 border-t border-white/5';
    var hint = document.createElement('span'); hint.className = 'text-[10px] text-zinc-600'; hint.textContent = plugins.length + ' found in the standard VST3 folder';
    foot.appendChild(hint); panel.appendChild(foot);

    ov.appendChild(panel); document.body.appendChild(ov); pluginModal = ov;
    setTimeout(function () { try { search.focus(); } catch (e) {} }, 30);
  }
  listen('pluginList', function (d) { showPluginBrowser((d && d.plugins) || []); });

  // Stride button styling (Tailwind classes -> skinned colors + Outfit, 1:1 with the app).
  var BTN_BASE = 'px-2 py-0.5 rounded text-[9px] uppercase tracking-wider font-bold transition-colors ';
  var BTN_GHOST = BTN_BASE + 'text-zinc-400 hover:text-zinc-100 border border-white/10';
  var BTN_PRIMARY = BTN_BASE + 'text-orange-400 bg-orange-500/10 hover:bg-orange-500/20 border border-orange-500/20';
  var BTN_ARMED = BTN_BASE + 'text-orange-400 bg-orange-500/20 border border-orange-500/40';
  // Map gets its own slightly-bigger, distinct (violet) treatment so the primary
  // "arm to learn" action reads differently from +Add / Clear.
  var BTN_MAP       = 'px-3 py-1 rounded text-[10px] uppercase tracking-wider font-bold transition-colors text-violet-200 bg-violet-500/20 hover:bg-violet-500/30 border border-violet-400/40';
  var BTN_MAP_ARMED = 'px-3 py-1 rounded text-[10px] uppercase tracking-wider font-bold transition-colors text-white bg-violet-500/60 border border-violet-300 sd-map-armed';

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
      var openBtn = sbtn('⛶', 'openSynth', BTN_GHOST); openBtn.title = 'Open device windows'; openBtn.classList.add('text-[12px]');
      var clearBtn = sbtn('Clear', 'clearChain', BTN_GHOST);
      clearBtn.onclick = function () { emit('clearChain'); _armUndo(null, 'Chain cleared · Ctrl+Z to undo'); };

      var divider = document.createElement('span'); divider.className = 'w-px h-4 bg-white/10'; host.appendChild(divider);

      // Device list — every loaded device, each with a ✕ that is the ONLY way to remove it.
      var chips = document.createElement('div'); chips.id = 'stride-dev-chips'; chips.className = 'flex items-center gap-1.5 flex-wrap'; host.appendChild(chips);

      listen('chainDevices', function (d) {
        var c = document.getElementById('stride-dev-chips'); if (! c) return;
        c.innerHTML = '';
        var names = (d && d.names) || [];
        if (! names.length) { var e = document.createElement('span'); e.className = 'text-[10px] text-zinc-600 uppercase tracking-wider'; e.textContent = 'no devices'; c.appendChild(e); return; }
        var byp = (d && d.bypassed) || [];
        names.forEach(function (nm, i) {
          var off = !!byp[i];   // true = bypassed
          var chip = document.createElement('div'); chip.className = 'flex items-center gap-1.5 bg-zinc-900 border border-white/10 rounded px-2 py-0.5' + (off ? ' opacity-60' : '');
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
          chip.appendChild(x); c.appendChild(chip);
        });
      });

      listen('favoritesPicked', function (d) {
        var favs = favGet(); var have = {};
        favs.forEach(function (f) { have[f.path] = 1; });
        ((d && d.paths) || []).forEach(function (p) { if (! have[p]) { favs.push({ name: favName(p), path: p }); have[p] = 1; } });
        favSet(favs); populateFav();
      });
      listen('learnState', function (d) {
        var on = !!(d && d.on);
        mapBtn.className = on ? BTN_MAP_ARMED : BTN_MAP;
        mapBtn.textContent = on ? '◉ Mapping…' : '◉ Map';
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
