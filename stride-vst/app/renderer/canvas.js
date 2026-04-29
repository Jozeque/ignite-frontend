/**
 * Stride Canvas Engine — Standalone Version
 * Ported from frontend/app.html Sound Design Canvas IIFE
 *
 * Changes from web version:
 * - No Firebase/Firestore — state saved via Electron IPC (window.stride)
 * - No cloud ALC parsing — params come from M4L WebSocket
 * - Apply writes curves to Ableton via M4L instead of generating ALC files
 * - Generate button calls cloud API only when user is signed in
 */

(function() {
    // Cloud generation (Account panel + Generate button) is hidden for v1.
    // The feature exists in code but the backend contract is incomplete and
    // v1 ships as a local-only product. Flip this to true in v2 once the
    // backend handlers for 'generate' / 'check_credits' are shipped.
    const CLOUD_GEN_ENABLED = false;

    // ─── STATE ────────────────────────────────────────────

    let sdCanvasParams = [];
    let sdActiveParamId = null;
    let sdCanvasEl = null;
    let sdCtx = null;
    let sdCanvasRect = null;
    let sdIsDragging = false;
    let sdDraggedPoint = null;
    let sdActiveTool = 'select';
    let sdClipboardPoints = null;
    let sdIsCurveDragging = false;
    let sdCurveDragSegment = null;
    let sdSelectionStart = null;
    let sdSelectionEnd = null;
    let sdIsSelectingRegion = false;
    let sdSelectionDragEdge = null;
    let sdApplyAllMode = false;
    let sdViewZoomX = 1;
    let sdViewPanX = 0;
    let sdIsSpacePressed = false;
    let sdIsPanning = false;
    let sdLastMouseX = 0;
    let _sdSmoothSnapshot = null;
    let _sdSmoothParamId = null;
    let _sdIntensitySnapshot = null;
    let _sdIntensityParamId = null;
    let sdBars = 8;
    let sdCanvasInitialized = false;
    let currentRackId = null; // For local state saving
    let currentDeviceName = null; // For template matching
    let currentTemplatePath = null; // Resolved template file path
    let templateMatchState = 'none'; // 'exact', 'fallback', 'none'

    // ─── MULTI-LANE VIEW ─────────────────────────────────
    // Stride has two canvas view modes:
    //   'multi' = every parameter gets its own horizontal strip stacked
    //             vertically. Default — teaches the tool's purpose
    //             instantly (you see the whole rack modulating at once).
    //   'focus' = one active lane fills the full canvas height. Better
    //             for precise per-lane editing. One click away.
    let sdViewMode = 'multi';
    let sdMultiScrollOffset = 0;              // # of lanes scrolled off the top
    const SD_MULTI_LANE_HEIGHT = 64;          // px per lane in multi view
    const SD_MULTI_LABEL_WIDTH = 120;         // px reserved on the left for the param name

    // ─── UNDO / REDO ─────────────────────────────────────
    let undoStack = [];
    let redoStack = [];
    const MAX_UNDO = 50;

    function pushUndo() {
        const snapshot = sdCanvasParams.map(p => ({
            envelopeId: p.envelopeId,
            points: p.points.map(pt => ({ time: pt.time, value: pt.value, curve: pt.curve || 0 }))
        }));
        undoStack.push(snapshot);
        if (undoStack.length > MAX_UNDO) undoStack.shift();
        redoStack = []; // clear redo on new action
    }

    function applySnapshot(snapshot) {
        snapshot.forEach(sp => {
            const param = sdCanvasParams.find(p => p.envelopeId === sp.envelopeId);
            if (param) param.points = sp.points.map(pt => ({ ...pt }));
        });
        sdResetSliderSnapshots(); sdRenderSidebar(); sdDrawCanvasGrid();
    }

    window.sdUndo = function() {
        if (!undoStack.length) return;
        // Save current state to redo
        const current = sdCanvasParams.map(p => ({
            envelopeId: p.envelopeId,
            points: p.points.map(pt => ({ time: pt.time, value: pt.value, curve: pt.curve || 0 }))
        }));
        redoStack.push(current);
        applySnapshot(undoStack.pop());
        document.getElementById('sd-canvas-status').textContent = 'Undo';
    };

    window.sdRedo = function() {
        if (!redoStack.length) return;
        // Save current state to undo
        const current = sdCanvasParams.map(p => ({
            envelopeId: p.envelopeId,
            points: p.points.map(pt => ({ time: pt.time, value: pt.value, curve: pt.curve || 0 }))
        }));
        undoStack.push(current);
        applySnapshot(redoStack.pop());
        document.getElementById('sd-canvas-status').textContent = 'Redo';
    };

    // ─── BARS ─────────────────────────────────────────────

    function sdGetBars() {
        if (sdBars > 0) return sdBars;
        return 8;
    }

    window.sdSetBars = function(val) {
        sdBars = val;
        document.querySelectorAll('.sd-bars-btn').forEach(btn => {
            const btnVal = parseInt(btn.textContent);
            if (btnVal === val) {
                btn.className = 'sd-bars-btn text-[11px] text-fuchsia-400 bg-fuchsia-500/20 px-3 py-1 rounded font-bold transition-colors';
            } else {
                btn.className = 'sd-bars-btn text-[11px] text-zinc-400 hover:text-fuchsia-400 px-3 py-1 rounded font-bold transition-colors';
            }
        });
        sdDrawCanvasGrid();
    };

    // ─── SCAN MODES ──────────────────────────────────────

    let pendingScanParams = []; // holds all params before user picks
    let scanMode = null; // 'all' or 'mapped'

    // Scan All — shows picker for user to choose which params to load
    window.scanAll = function() {
        scanMode = 'all';
        document.getElementById('sd-canvas-status').textContent = 'Scanning...';
        const btn = document.getElementById('scan-mapped-btn');
        if (btn) {
            btn.textContent = 'Scanning...';
            btn.classList.add('animate-pulse', 'opacity-70');
            btn.disabled = true;
        }
        strideLink.requestScan();
    };

    // Scan Mapped — only loads params that already have automation in the clip
    window.scanMapped = function() {
        scanMode = 'mapped';
        document.getElementById('sd-canvas-status').textContent = 'Scanning mapped...';
        const btn = document.getElementById('scan-mapped-btn');
        if (btn) {
            btn.textContent = 'Scanning...';
            btn.classList.add('animate-pulse', 'opacity-70');
            btn.disabled = true;
        }
        strideLink.send({ type: 'request_scan_mapped' });
    };

    function _resetScanButton() {
        const btn = document.getElementById('scan-mapped-btn');
        if (btn) {
            btn.textContent = 'Scan Mapped';
            btn.classList.remove('animate-pulse', 'opacity-70');
            btn.disabled = false;
        }
    }

    // Param picker UI
    window.togglePickAll = function(checked) {
        document.querySelectorAll('.param-pick-cb').forEach(cb => cb.checked = checked);
    };

    window.confirmParamPick = function() {
        const checkedIds = [...document.querySelectorAll('.param-pick-cb:checked')].map(cb => cb.dataset.id);
        if (!checkedIds.length) {
            document.getElementById('sd-canvas-status').textContent = 'Select at least one parameter';
            return;
        }

        sdCanvasParams = pendingScanParams
            .filter(p => checkedIds.includes(String(p.id)))
            .map(p => ({
                envelopeId: String(p.id),
                name: p.name,
                min: p.min,
                max: p.max,
                id: p.id,
                _path: p._path,
                is_log: p.is_log || false,
                points: []
            }));

        if (sdCanvasParams.length > 0) sdActiveParamId = sdCanvasParams[0].envelopeId;
        document.getElementById('param-picker').classList.add('hidden');
        document.getElementById('sd-param-count').textContent = sdCanvasParams.length + ' params';
        document.getElementById('sd-canvas-status').textContent = 'Editor Ready';
        pendingScanParams = [];

        restoreCanvasState();
        sdRenderSidebar();
        initSdCanvas();
        setTimeout(() => sdResizeCanvas(), 50);
    };

    function showParamPicker(params, rackInfo) {
        pendingScanParams = params;

        // Update rack info
        document.getElementById('rack-info').classList.remove('hidden');
        document.getElementById('no-rack-msg').classList.add('hidden');
        document.getElementById('rack-name').textContent = rackInfo.device_name;
        document.getElementById('rack-track').textContent = 'Track: ' + rackInfo.track_name;

        if (rackInfo.clip_bars && rackInfo.clip_bars > 0) sdSetBars(rackInfo.clip_bars);
        currentRackId = (rackInfo.track_name + '_' + rackInfo.device_name).replace(/[^a-zA-Z0-9]/g, '_');

        // Render checkboxes
        const list = document.getElementById('param-pick-list');
        list.innerHTML = params.map(p => `
            <label class="flex items-center gap-2 px-3 py-1.5 hover:bg-white/5 cursor-pointer">
                <input type="checkbox" class="param-pick-cb accent-fuchsia-500 w-3 h-3" data-id="${p.id}" checked>
                <span class="text-[9px] text-zinc-300 truncate">${p.name}</span>
                <span class="text-[8px] text-zinc-600 ml-auto shrink-0">${p.min} - ${p.max}</span>
            </label>
        `).join('');
        document.getElementById('param-pick-all').checked = true;
        document.getElementById('param-picker').classList.remove('hidden');
        document.getElementById('sd-canvas-status').textContent = params.length + ' params found — pick which to load';
    }

    function loadParamsDirectly(params, rackInfo) {
        sdCanvasParams = params.map(p => ({
            envelopeId: String(p.id),
            name: p.name,
            min: p.min,
            max: p.max,
            id: p.id,
            _path: p._path,
            is_log: p.is_log || false,
            points: []
        }));

        if (sdCanvasParams.length > 0) sdActiveParamId = sdCanvasParams[0].envelopeId;

        document.getElementById('rack-info').classList.remove('hidden');
        document.getElementById('no-rack-msg').classList.add('hidden');
        document.getElementById('rack-name').textContent = rackInfo.device_name;
        document.getElementById('rack-track').textContent = 'Track: ' + rackInfo.track_name;
        document.getElementById('sd-param-count').textContent = sdCanvasParams.length + ' params';

        if (rackInfo.clip_bars && rackInfo.clip_bars > 0) sdSetBars(rackInfo.clip_bars);
        currentRackId = (rackInfo.track_name + '_' + rackInfo.device_name).replace(/[^a-zA-Z0-9]/g, '_');

        if (sdCanvasParams.length > 0) {
            document.getElementById('sd-canvas-status').textContent = 'Editor Ready';
        } else {
            document.getElementById('sd-canvas-status').textContent = 'No automation found — arm automation in Ableton and touch your mapped knobs first';
        }

        restoreCanvasState();
        sdRenderSidebar();
        initSdCanvas();
        setTimeout(() => sdResizeCanvas(), 50);
    }

    // ─── M4L BRIDGE ───────────────────────────────────────

    // Handle rack scan results from M4L
    strideLink.on('rack_scanned', (msg) => {
        _resetScanButton();
        const rackInfo = {
            device_name: msg.device_name,
            track_name: msg.track_name,
            clip_bars: msg.clip_bars
        };

        currentDeviceName = msg.device_name;
        // Check if template exists for this rack
        resolveTemplate();

        // Catch templates dropped while Stride was closed: ask main to walk
        // the User Library for any .alc modified in the last few minutes.
        // The watcher only fires while listening, so prior drops are invisible.
        // If main finds one, it emits the same alc-detected event the watcher
        // uses, and the existing import flow takes over.
        if (window.stride && window.stride.triggerLibraryScan) {
            window.stride.triggerLibraryScan().catch(() => {});
        }

        // Check if canvas already has curves drawn
        const hasExistingCurves = sdCanvasParams.some(p => p.points && p.points.length > 0);

        if (hasExistingCurves) {
            // Show confirmation — don't silently wipe curves
            const curveCount = sdCanvasParams.filter(p => p.points && p.points.length > 0).length;
            const modal = document.getElementById('rescan-confirm-modal');
            document.getElementById('rescan-confirm-msg').textContent =
                `You have curves on ${curveCount} lane${curveCount > 1 ? 's' : ''}. A new scan will replace them.`;
            modal.classList.remove('hidden');

            const _mode = scanMode;

            // "Keep Curves" — merge: load new params but preserve curves for matching names
            window._rescanConfirmKeep = () => {
                modal.classList.add('hidden');
                const oldCurves = {};
                sdCanvasParams.forEach(p => {
                    if (p.points && p.points.length > 0) {
                        oldCurves[p.envelopeId] = { points: JSON.parse(JSON.stringify(p.points)), envelope_index: p.envelope_index };
                    }
                });

                if (_mode === 'all') {
                    showParamPicker(msg.parameters, rackInfo);
                } else {
                    loadParamsDirectly(msg.parameters, rackInfo);
                }

                // Restore curves for params that still exist by envelopeId
                let restored = 0;
                sdCanvasParams.forEach(p => {
                    if (oldCurves[p.envelopeId]) {
                        p.points = oldCurves[p.envelopeId].points;
                        restored++;
                    }
                });
                if (restored > 0) {
                    document.getElementById('sd-canvas-status').textContent =
                        `Editor Ready — ${restored} curve${restored > 1 ? 's' : ''} preserved`;
                    sdRenderSidebar();
                    sdDrawCanvasGrid();
                }
            };

            // "Replace" — load fresh, wipe all curves
            window._rescanConfirmReplace = () => {
                modal.classList.add('hidden');
                if (_mode === 'all') {
                    showParamPicker(msg.parameters, rackInfo);
                } else {
                    loadParamsDirectly(msg.parameters, rackInfo);
                }
            };
        } else {
            // No existing curves — load normally
            if (scanMode === 'all') {
                showParamPicker(msg.parameters, rackInfo);
            } else {
                loadParamsDirectly(msg.parameters, rackInfo);
            }
        }

        scanMode = null;
    });

    // Handle clip changes
    strideLink.on('clip_changed', (msg) => {
        if (msg.clip_bars && msg.clip_bars > 0) {
            sdSetBars(msg.clip_bars);
        }
    });

    // Handle .alc file generated
    strideLink.on('alc_generated', (msg) => {
        // Snapshot the loading-spinner's position BEFORE we hide it, so
        // the fly-to-dock orb (fired from _refreshGenerationsDock below)
        // launches from where the user was just looking.
        const _flyFrom = _captureLoadingCenter();
        _hideLoading();
        const status = document.getElementById('sd-canvas-status');

        if (!msg.template_matched) {
            // Wrong template used — different rack than what was saved
            const usedName = msg.template_matched_name || 'unknown rack';
            status.textContent = `Warning: used template from "${usedName}" — may not match current rack`;
            status.style.color = '#f87171'; // red
            _showMismatchWarning(msg.skipped_count, msg.params_written, msg.requested_count,
                `This template was saved for "${usedName}" but your current rack is different. Automation may be mapped to wrong parameters. Drag the <strong style="color:#e7e5e4;">MIDI clip</strong> (not device) to User Library to create a template for this rack.`);
        } else if (msg.skipped_count > 0) {
            // Params with curves that exceeded available envelopes
            status.textContent = `${msg.params_written}/${msg.requested_count} params written — ${msg.skipped_count} skipped`;
            status.style.color = '#fbbf24'; // amber
            _showMismatchWarning(msg.skipped_count, msg.params_written, msg.requested_count);
        } else if (msg.mismatch_count > 0) {
            // Template has fewer envelopes than current rack — user added params after saving template
            status.textContent = `${msg.params_written} written — rack has ${msg.mismatch_count} more params than template`;
            status.style.color = '#fbbf24'; // amber
            _showMismatchWarning(msg.mismatch_count, msg.params_written, msg.requested_count,
                `Your rack has ${msg.mismatch_count} more parameter${msg.mismatch_count > 1 ? 's' : ''} than the saved template. Those parameters won't have automation in the clip. <strong style="color:#e7e5e4;">Drag a fresh clip to User Library</strong> to update the template with all current parameters.`);
        } else {
            // Quiet success — feedback comes from the LED-border animation
            // on the newest card in the generations dock (handled in
            // _refreshGenerationsDock below). The old big center card
            // and bottom-right toast were too loud after every generation;
            // the dock LED is the single, subtle "your file is ready"
            // signal now. Both helpers (_showApplyToast / _showDragHandle)
            // are kept in the file for potential reuse but no longer fire
            // on a successful Apply.
            status.textContent = '';
            status.style.color = '';
        }
        // Snapshot the canvas for the generations dock thumbnail, then refresh
        // the dock. Both run on every alc_generated event regardless of
        // template-match outcome — even a partial Apply produced a usable .alc.
        if (msg.filePath) {
            _captureAlcThumbnail(msg.filePath);
            // Slight delay so the thumbnail write has a chance to land before
            // the dock re-reads the directory. 250ms is comfortable for local fs.
            // Pass the captured loading-spinner position so the dock can fire
            // a fly-to orb when the new card lands.
            setTimeout(() => _refreshGenerationsDock(_flyFrom), 250);
        }
        // Clear the status after 4 seconds so it doesn't stick permanently
        setTimeout(() => { status.textContent = ''; status.style.color = ''; }, 4000);
    });

    strideLink.on('apply_success', (msg) => {
        _hideLoading();
        document.getElementById('sd-canvas-status').textContent = `Applied ${msg.params_written} params to clip`;
    });

    strideLink.on('apply_error', (msg) => {
        _hideLoading();
        document.getElementById('sd-canvas-status').textContent = 'Error: ' + msg.message;
    });

    // Handle needs_template — guide user to import template .alc
    strideLink.on('needs_template', (msg) => {
        _hideLoading();
        const status = document.getElementById('sd-canvas-status');
        status.textContent = 'Template needed — import a clip first';
        status.style.color = '#fbbf24';
        setTimeout(() => { status.textContent = ''; status.style.color = ''; }, 4000);
        _showTemplateGuide();
    });

    strideLink.on('show_guide', () => {
        document.getElementById('guide-modal').classList.remove('hidden');
    });

    // Connection status
    strideLink.on('connected', () => {
        document.getElementById('link-dot').className = 'w-1.5 h-1.5 rounded-full bg-emerald-400';
        document.getElementById('link-label').textContent = 'M4L Connected';
        document.getElementById('sd-canvas-status').textContent = 'Connected — Click Scan';
    });

    strideLink.on('disconnected', () => {
        document.getElementById('link-dot').className = 'w-1.5 h-1.5 rounded-full bg-zinc-600';
        document.getElementById('link-label').textContent = 'Disconnected';
    });

    // ─── TEMPLATE MANAGEMENT (via Electron IPC) ─────────────

    async function resolveTemplate() {
        if (!window.stride || !window.stride.listTemplates) return;
        const templates = await window.stride.listTemplates();
        resolveActiveTemplate(templates);
    }

    // Load template state on startup
    resolveTemplate();

    // Auto-detect .alc dropped into Ableton's User Library
    if (window.stride && window.stride.onAlcDetected) {
        window.stride.onAlcDetected((data) => {
            _showAlcDetectedToast(data.filename, data.filePath);
        });
    }

    // Auto-connect on startup
    strideLink.connect();

    /**
     * Resolve the active template path from the template list.
     * Matches by device name, or uses the only template if just one exists.
     */
    function resolveActiveTemplate(templates) {
        if (!templates || !templates.length) {
            currentTemplatePath = null;
            templateMatchState = 'none';
            _renderTemplateStatus();
            return;
        }

        // Match by device name — strict only (no fuzzy includes)
        if (currentDeviceName) {
            const dn = currentDeviceName;
            const match = templates.find(t => t.device_name === dn);
            if (match && match.file_path) {
                currentTemplatePath = match.file_path;
                templateMatchState = 'exact';
                _renderTemplateStatus();
                return;
            }
        }

        // No fallback — exact match required
        currentTemplatePath = null;
        templateMatchState = 'none';
        _renderTemplateStatus();
    }

    let _fallbackTemplateName = null;

    function _renderTemplateStatus() {
        const el = document.getElementById('template-status');
        if (!el) return;

        // Only show after a rack has been scanned
        if (!currentDeviceName) {
            el.classList.add('hidden');
            return;
        }

        el.classList.remove('hidden');

        if (templateMatchState === 'exact') {
            el.innerHTML = `<div class="flex items-center gap-1.5 px-2 py-1 rounded bg-emerald-500/10 border border-emerald-500/20">
                <span class="w-1.5 h-1.5 rounded-full bg-emerald-400 shrink-0"></span>
                <span class="text-[8px] text-emerald-400 font-bold uppercase tracking-wider truncate">Template ready</span>
            </div>`;
        } else if (templateMatchState === 'fallback') {
            el.innerHTML = `<div class="flex flex-col gap-1 px-2 py-1.5 rounded bg-amber-500/10 border border-amber-500/20">
                <div class="flex items-center gap-1.5">
                    <span class="w-1.5 h-1.5 rounded-full bg-amber-400 shrink-0"></span>
                    <span class="text-[8px] text-amber-400 font-bold uppercase tracking-wider">Wrong template</span>
                </div>
                <span class="text-[8px] text-zinc-500 leading-tight">Using "${_fallbackTemplateName || '?'}" template — drag a clip from <strong class="text-zinc-300">${currentDeviceName}</strong> track to User Library</span>
            </div>`;
        } else {
            el.innerHTML = `<div class="flex flex-col gap-1 px-2 py-1.5 rounded bg-red-500/10 border border-red-500/20">
                <div class="flex items-center gap-1.5">
                    <span class="w-1.5 h-1.5 rounded-full bg-red-400 shrink-0"></span>
                    <span class="text-[8px] text-red-400 font-bold uppercase tracking-wider">No template</span>
                </div>
                <span class="text-[8px] text-zinc-500 leading-tight">Drag the <strong class="text-zinc-300">MIDI clip</strong> (not the device) to User Library</span>
            </div>`;
        }
    }

    // ─── ALC DETECTED TOAST ─────────────────────────────────

    async function _showAlcDetectedToast(filename, filePath) {
        // Remove existing toast
        const old = document.getElementById('stride-alc-toast');
        if (old) old.remove();

        // Auto-import: use current scanned device name, or fall back to filename
        const name = currentDeviceName || filename.replace('.alc', '').replace(/[_-]/g, ' ');

        const result = await window.stride.importTemplate(name, filePath);
        if (result.success) {
            resolveTemplate();
        }

        // Show brief confirmation toast (no input, no decisions)
        const toast = document.createElement('div');
        toast.id = 'stride-alc-toast';
        toast.style.cssText = 'position:fixed;bottom:24px;right:24px;background:#18181b;border:1px solid #22c55e;border-radius:10px;padding:14px 20px;font-family:Outfit,sans-serif;color:#fff;z-index:9999;max-width:340px;box-shadow:0 8px 32px rgba(0,0,0,0.5);transition:opacity 0.3s;';
        toast.innerHTML = `
            <div style="display:flex;align-items:center;gap:8px;margin-bottom:4px;">
                <span style="width:8px;height:8px;border-radius:50%;background:#22c55e;flex-shrink:0;"></span>
                <span style="font-size:12px;font-weight:600;">Template saved</span>
            </div>
            <p style="font-size:10px;color:#a1a1aa;margin:0;">"${name}" ready for automation</p>
        `;
        document.body.appendChild(toast);
        document.getElementById('sd-canvas-status').textContent = `Template saved — "${name}"`;

        // Auto-dismiss after 4s
        setTimeout(() => {
            if (toast.parentNode) {
                toast.style.opacity = '0';
                setTimeout(() => toast.remove(), 300);
            }
        }, 4000);
    }

    // ─── APPLY-TO-CLIP SUCCESS TOAST ─────────────────────────
    // Bottom-right toast — small persistent confirmation with an "Open
    // folder" escape hatch for users who want to manage the generated .alc
    // files in Explorer/Finder. Auto-fades after 3s, paused on hover.
    let _sdApplyToastTimer = null;
    function _showApplyToast(filename, filePath) {
        const toast = document.getElementById('sd-apply-toast');
        if (!toast) return;
        const msgEl = document.getElementById('sd-apply-toast-msg');
        const openBtn = document.getElementById('sd-apply-toast-open-btn');
        const closeBtn = document.getElementById('sd-apply-toast-close');

        if (msgEl) msgEl.textContent = filename ? `Drag ${filename} onto your clip slot.` : 'Drag it onto your clip slot.';

        openBtn.onclick = async (e) => {
            e.stopPropagation();
            try {
                if (filePath && window.stride && window.stride.revealInFolder) {
                    await window.stride.revealInFolder(filePath);
                }
            } catch (err) { /* silent */ }
        };

        closeBtn.onclick = () => {
            toast.classList.add('hidden');
            if (_sdApplyToastTimer) { clearTimeout(_sdApplyToastTimer); _sdApplyToastTimer = null; }
        };

        toast.onmouseenter = () => {
            if (_sdApplyToastTimer) { clearTimeout(_sdApplyToastTimer); _sdApplyToastTimer = null; }
        };
        toast.onmouseleave = () => {
            if (!_sdApplyToastTimer) {
                _sdApplyToastTimer = setTimeout(() => {
                    toast.classList.add('hidden');
                    _sdApplyToastTimer = null;
                }, 1500);
            }
        };

        toast.classList.remove('hidden');
        if (_sdApplyToastTimer) clearTimeout(_sdApplyToastTimer);
        _sdApplyToastTimer = setTimeout(() => {
            toast.classList.add('hidden');
            _sdApplyToastTimer = null;
        }, 3000);
    }

    // ─── DRAG .ALC INTO ABLETON ─────────────────────────────
    // After Apply succeeds, a floating "Ready to drop" card appears at the
    // bottom-center of the canvas. User drags it directly into an Ableton
    // clip slot — Electron's startDrag() initiates a native OS drag event
    // Ableton picks up as a file drop.
    //
    // Behavior:
    //   - Card auto-dismisses after APPLY_REVEAL_TTL_MS
    //   - Hovering the card PAUSES the timer (so the user can read/drag it)
    //   - Leaving the card RESUMES the timer (shorter remaining budget)
    //   - × button dismisses instantly
    //   - Rapid-fire Apply: each new call replaces the filename in place and
    //     flashes the card (no stacking, no queue — user sees the latest file,
    //     can always re-drag older ones from the ~/Desktop/Stride folder)
    let _lastAlcPath = null;
    let _applyRevealTimer = null;
    let _applyRevealHovered = false;
    const APPLY_REVEAL_TTL_MS = 10000;
    const APPLY_REVEAL_RESUME_MS = 5000;

    function _showDragHandle(filename, filePath) {
        _lastAlcPath = filePath;
        const card = document.getElementById('sd-apply-reveal');
        const nameEl = document.getElementById('sd-apply-reveal-name');
        if (!card || !nameEl) return;
        nameEl.textContent = filename || 'clip.alc';

        const wasVisible = !card.classList.contains('hidden');
        card.classList.remove('hidden');

        if (!wasVisible) {
            // Entry animation: slide up from below + subtle scale pop
            card.style.transition = 'none';
            card.style.opacity = '0';
            card.style.transform = 'translate(-50%, 20px) scale(0.95)';
            requestAnimationFrame(() => {
                requestAnimationFrame(() => {
                    card.style.transition = 'opacity 200ms ease-out, transform 240ms cubic-bezier(0.34, 1.56, 0.64, 1)';
                    card.style.opacity = '1';
                    card.style.transform = 'translate(-50%, 0) scale(1)';
                });
            });
        } else {
            // Already visible (rapid-fire Apply) — flash the outer glow briefly
            // to signal the filename just updated
            try {
                card.animate([
                    { boxShadow: '0 20px 60px rgba(0,0,0,0.6), 0 0 0 1px rgba(16,185,129,0.25), 0 0 50px rgba(16,185,129,0.2)' },
                    { boxShadow: '0 20px 60px rgba(0,0,0,0.6), 0 0 0 2px rgba(16,185,129,0.7), 0 0 80px rgba(16,185,129,0.45)' },
                    { boxShadow: '0 20px 60px rgba(0,0,0,0.6), 0 0 0 1px rgba(16,185,129,0.25), 0 0 50px rgba(16,185,129,0.2)' },
                ], { duration: 450, easing: 'ease-out' });
            } catch (e) { /* WAAPI unavailable — ignore */ }
        }

        _startApplyRevealTimer(APPLY_REVEAL_TTL_MS);
    }

    function _startApplyRevealTimer(ms) {
        const card = document.getElementById('sd-apply-reveal');
        const bar = document.getElementById('sd-apply-reveal-timer');
        if (!card) return;
        if (_applyRevealTimer) { clearTimeout(_applyRevealTimer); _applyRevealTimer = null; }
        // Reset + animate the countdown bar from 100% → 0% over ms
        if (bar) {
            bar.style.transition = 'none';
            bar.style.transform = 'scaleX(1)';
            requestAnimationFrame(() => {
                bar.style.transition = `transform ${ms}ms linear`;
                bar.style.transform = 'scaleX(0)';
            });
        }
        _applyRevealTimer = setTimeout(() => {
            _applyRevealTimer = null;
            if (!_applyRevealHovered) _hideApplyReveal();
        }, ms);
    }

    function _pauseApplyRevealTimer() {
        const bar = document.getElementById('sd-apply-reveal-timer');
        if (_applyRevealTimer) { clearTimeout(_applyRevealTimer); _applyRevealTimer = null; }
        if (bar) {
            // Freeze the bar where it currently sits
            try {
                const cs = getComputedStyle(bar);
                const m = new DOMMatrixReadOnly(cs.transform);
                bar.style.transition = 'none';
                bar.style.transform = `scaleX(${m.a})`;
            } catch (e) {
                bar.style.transition = 'none';
            }
        }
    }

    function _hideApplyReveal() {
        const card = document.getElementById('sd-apply-reveal');
        if (!card || card.classList.contains('hidden')) return;
        card.style.transition = 'opacity 180ms ease-in, transform 180ms ease-in';
        card.style.opacity = '0';
        card.style.transform = 'translate(-50%, 12px) scale(0.98)';
        setTimeout(() => {
            card.classList.add('hidden');
            card.style.transition = '';
            card.style.opacity = '';
            card.style.transform = '';
        }, 200);
        if (_applyRevealTimer) { clearTimeout(_applyRevealTimer); _applyRevealTimer = null; }
    }

    function _wireDragHandle() {
        const card = document.getElementById('sd-apply-reveal');
        if (!card) return;

        // Hover pauses the dismiss timer and bumps the shadow — keep transform
        // as-is so the text doesn't re-rasterize and blur. Earlier version
        // added scale(1.02), which looked like it "lifted" the card but made
        // everything fuzzy on subpixel rounding.
        card.addEventListener('mouseenter', () => {
            _applyRevealHovered = true;
            _pauseApplyRevealTimer();
            card.style.transition = 'box-shadow 180ms ease-out';
            card.style.boxShadow = '0 30px 80px rgba(0,0,0,0.75), 0 0 0 2px rgba(16,185,129,0.7), 0 0 80px rgba(16,185,129,0.45)';
        });
        card.addEventListener('mouseleave', () => {
            _applyRevealHovered = false;
            card.style.transition = 'box-shadow 180ms ease-out';
            card.style.boxShadow = '';
            if (!card.classList.contains('hidden')) {
                _startApplyRevealTimer(APPLY_REVEAL_RESUME_MS);
            }
        });

        // Explicit × button — instant dismiss, don't leak into drag/mousedown
        const closeBtn = document.getElementById('sd-apply-reveal-close');
        if (closeBtn) {
            closeBtn.addEventListener('mousedown', (e) => { e.stopPropagation(); });
            closeBtn.addEventListener('click', (e) => {
                e.stopPropagation();
                _hideApplyReveal();
            });
        }

        // Primary: HTML5 dragstart → Electron native drag
        card.addEventListener('dragstart', (e) => {
            // Let × behave as a normal button, not a drag source
            if (e.target && e.target.closest && e.target.closest('#sd-apply-reveal-close')) {
                e.preventDefault();
                return;
            }
            e.preventDefault();
            if (_lastAlcPath && window.stride && window.stride.startDrag) {
                window.stride.startDrag(_lastAlcPath);
            }
        });

        // Fallback: some Electron builds on Windows don't fire dragstart
        // reliably. mousedown triggers startDrag() directly as a backup.
        card.addEventListener('mousedown', (e) => {
            if (e.button !== 0) return;
            if (e.target && e.target.closest && e.target.closest('#sd-apply-reveal-close')) return;
            if (_lastAlcPath && window.stride && window.stride.startDrag) {
                window.stride.startDrag(_lastAlcPath);
            }
        });
    }

    // ─── TEMPLATE IMPORT ─────────────────────────────────────

    window.browseForTemplate = async function() {
        if (!window.stride || !window.stride.pickAlcFile) {
            document.getElementById('sd-canvas-status').textContent = 'File picker not available';
            return;
        }
        const filePath = await window.stride.pickAlcFile();
        if (!filePath) return;

        const deviceName = currentDeviceName || prompt('Enter rack/device name:');
        if (!deviceName) return;

        const result = await window.stride.importTemplate(deviceName, filePath);
        if (result.success) {
            document.getElementById('sd-canvas-status').textContent = `"${deviceName}" template saved`;
            resolveTemplate();
        } else {
            document.getElementById('sd-canvas-status').textContent = 'Import error: ' + result.error;
        }
    };

    // ─── APPLY TO ABLETON ─────────────────────────────────

    window.applyToAbleton = function() {
        if (!strideLink.connected) {
            document.getElementById('sd-canvas-status').textContent = 'Not connected to M4L';
            return;
        }
        // Assign correct envelope_index from position in full array, then filter
        const paramsWithPoints = sdCanvasParams
            .map((p, idx) => ({ ...p, envelope_index: idx }))
            .filter(p => p.points.length > 0);
        if (paramsWithPoints.length === 0) {
            document.getElementById('sd-canvas-status').textContent = 'Draw some curves first';
            return;
        }

        // Block if no template at all
        if (templateMatchState === 'none') {
            document.getElementById('sd-canvas-status').textContent =
                'No template — drag the MIDI clip (not the device) to User Library';
            _renderTemplateStatus();
            _showTemplateGuide();
            return;
        }

        // Block if using wrong template — no more fallback
        if (templateMatchState === 'fallback') {
            document.getElementById('sd-canvas-status').textContent =
                'Wrong template — drag a MIDI clip from "' + currentDeviceName + '" to User Library';
            _renderTemplateStatus();
            _showTemplateGuide();
            return;
        }

        const totalPoints = paramsWithPoints.reduce((s, p) => s + p.points.length, 0);
        const clipName = (document.getElementById('clip-name-input').value || '').trim();
        paramsWithPoints._totalParamCount = sdCanvasParams.length;
        _showLoading(paramsWithPoints.length, totalPoints);
        console.log('[Stride] Apply: device=' + currentDeviceName + ' template=' + currentTemplatePath + ' name=' + clipName + ' totalParams=' + sdCanvasParams.length);
        strideLink.applyAutomation(paramsWithPoints, sdGetBars(), currentDeviceName, currentTemplatePath, true, clipName || null);
        saveCanvasState();
    };

    // ─── LOADING OVERLAY ─────────────────────────────────

    function _showMismatchWarning(skipped, written, requested, customMsg) {
        // Remove any existing warning
        const existing = document.getElementById('stride-mismatch-warning');
        if (existing) existing.remove();

        const isWrongTemplate = !!customMsg;
        const borderColor = isWrongTemplate ? '#ef444440' : '#f59e0b40';
        const titleColor = isWrongTemplate ? '#f87171' : '#fbbf24';
        const title = isWrongTemplate ? 'WRONG TEMPLATE' : 'RACK CHANGED';

        const bodyText = customMsg ||
            `${skipped} parameter${skipped > 1 ? 's' : ''} couldn't be written — your rack has more params than the saved template. <strong style="color:#e7e5e4;">Drag the clip to User Library again</strong> to update the template, then re-apply.`;

        const toast = document.createElement('div');
        toast.id = 'stride-mismatch-warning';
        toast.style.cssText = 'position:fixed;bottom:24px;left:50%;transform:translateX(-50%);z-index:9999;max-width:480px;';
        toast.innerHTML = `
            <div style="background:#1c1917;border:1px solid ${borderColor};border-radius:12px;padding:14px 20px;font-family:Outfit,sans-serif;box-shadow:0 8px 32px rgba(0,0,0,0.5);">
                <div style="display:flex;align-items:center;gap:8px;margin-bottom:6px;">
                    <span style="color:${titleColor};font-size:14px;">${isWrongTemplate ? '✕' : '⚠'}</span>
                    <span style="color:${titleColor};font-size:12px;font-weight:700;letter-spacing:0.5px;">${title}</span>
                </div>
                <div style="color:#a8a29e;font-size:11px;line-height:1.5;">${bodyText}</div>
                ${written > 0 ? `<div style="color:#78716c;font-size:10px;margin-top:6px;">${written}/${requested} params written</div>` : ''}
                <button onclick="this.parentElement.parentElement.remove()" style="position:absolute;top:8px;right:12px;color:#78716c;background:none;border:none;cursor:pointer;font-size:14px;">✕</button>
            </div>
        `;
        document.body.appendChild(toast);

        setTimeout(() => { if (toast.parentNode) toast.remove(); }, 15000);
    }

    function _showLoading(paramCount, totalPoints) {
        let overlay = document.getElementById('stride-loading');
        if (!overlay) {
            overlay = document.createElement('div');
            overlay.id = 'stride-loading';
            overlay.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,0.75);display:flex;align-items:center;justify-content:center;z-index:9999;';
            overlay.innerHTML = `
                <div style="text-align:center;color:#fff;font-family:Outfit,sans-serif;">
                    <div style="width:48px;height:48px;border:3px solid #333;border-top-color:#f97316;border-radius:50%;animation:stride-spin 0.8s linear infinite;margin:0 auto 16px;"></div>
                    <div id="stride-loading-title" style="font-size:18px;font-weight:600;margin-bottom:6px;">Writing to Ableton...</div>
                    <div id="stride-loading-detail" style="font-size:13px;color:#a1a1aa;"></div>
                </div>
            `;
            const style = document.createElement('style');
            style.textContent = '@keyframes stride-spin{to{transform:rotate(360deg)}}';
            document.head.appendChild(style);
            document.body.appendChild(overlay);
        }
        overlay.style.display = 'flex';
        document.getElementById('stride-loading-detail').textContent = `${paramCount} params · ${totalPoints} points — listen to your sound design`;
        document.getElementById('stride-loading-title').textContent = 'Generating .alc file...';
    }

    function _hideLoading() {
        const overlay = document.getElementById('stride-loading');
        if (overlay) overlay.style.display = 'none';
    }

    function _showTemplateGuide() {
        let modal = document.getElementById('stride-template-guide');
        if (modal) { modal.style.display = 'flex'; return; }

        modal = document.createElement('div');
        modal.id = 'stride-template-guide';
        modal.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,0.8);display:flex;align-items:center;justify-content:center;z-index:9999;';
        modal.innerHTML = `
            <div style="background:#18181b;border:1px solid #333;border-radius:12px;padding:28px 32px;max-width:480px;font-family:Outfit,sans-serif;color:#fff;">
                <h3 style="margin:0 0 16px;font-size:18px;font-weight:600;">One-Time Rack Setup</h3>
                <ol style="margin:0 0 18px;padding-left:20px;line-height:1.8;color:#d4d4d8;font-size:14px;">
                    <li>In Ableton, select the track with your rack</li>
                    <li>Create a <b>MIDI clip</b> (any length)</li>
                    <li>In the clip's Envelopes panel, click <b>Configure</b> and click each parameter you want to automate</li>
                    <li>Draw any value in each envelope (just to "register" them)</li>
                    <li>Drag the <b>MIDI clip</b> to <b>User Library</b> in the browser sidebar</li>
                </ol>
                <p style="margin:0 0 18px;color:#f87171;font-size:13px;font-weight:500;">
                    ⚠ Drag the <b>clip</b>, not the device or group — only .alc files work as templates.
                </p>
                <p style="margin:0 0 18px;color:#a1a1aa;font-size:13px;">
                    One-time per rack. Stride auto-detects it from User Library.
                </p>
                <div style="display:flex;gap:10px;">
                    <button onclick="document.getElementById('stride-template-guide').style.display='none'"
                        style="background:#f97316;color:#fff;border:none;border-radius:6px;padding:8px 20px;font-size:14px;font-weight:500;cursor:pointer;font-family:Outfit,sans-serif;">
                        Got it
                    </button>
                    <button onclick="document.getElementById('stride-template-guide').style.display='none'; browseForTemplate()"
                        style="background:#27272a;color:#d4d4d8;border:1px solid #333;border-radius:6px;padding:8px 20px;font-size:14px;font-weight:500;cursor:pointer;font-family:Outfit,sans-serif;">
                        Browse for .alc
                    </button>
                </div>
            </div>
        `;
        document.body.appendChild(modal);
    }

    // ─── LOCAL STATE PERSISTENCE ──────────────────────────

    async function saveCanvasState() {
        if (!currentRackId || !window.stride) return;
        const state = sdCanvasParams.filter(p => p.points.length > 0).map(p => ({
            envelopeId: p.envelopeId,
            points: p.points.map(pt => ({ time: pt.time, value: pt.value, curve: pt.curve || 0 }))
        }));
        await window.stride.saveCanvasState(currentRackId, state);
    }

    async function restoreCanvasState() {
        if (!currentRackId || !window.stride) return;
        const result = await window.stride.loadCanvasState(currentRackId);
        if (result.success && result.state && Array.isArray(result.state)) {
            result.state.forEach(sp => {
                const param = sdCanvasParams.find(p => p.envelopeId === sp.envelopeId);
                if (param && sp.points) param.points = sp.points;
            });
        }
    }

    // Auto-save periodically
    setInterval(() => {
        if (currentRackId && sdCanvasParams.some(p => p.points.length > 0)) {
            saveCanvasState();
        }
    }, 30000); // every 30 seconds

    // ─── CANVAS INIT ──────────────────────────────────────

    function initSdCanvas() {
        if (sdCanvasInitialized) return;
        sdCanvasEl = document.getElementById('sd-canvas');
        if (!sdCanvasEl) return;
        sdCtx = sdCanvasEl.getContext('2d');
        window.addEventListener('resize', sdResizeCanvas);
        setupSdCanvasInteractions();
        setupSdRulerInteraction();
        sdCanvasInitialized = true;
    }

    function sdResizeCanvas() {
        if (!sdCanvasEl) return;
        const container = document.getElementById('sd-canvas-container');
        const dpr = window.devicePixelRatio || 1;
        sdCanvasEl.width = container.clientWidth * dpr;
        sdCanvasEl.height = container.clientHeight * dpr;
        sdCtx.scale(dpr, dpr);
        sdCanvasEl.style.width = container.clientWidth + 'px';
        sdCanvasEl.style.height = container.clientHeight + 'px';
        sdCanvasRect = sdCanvasEl.getBoundingClientRect();
        sdDrawCanvasGrid();
    }

    // ─── EMPTY-CANVAS CTA ─────────────────────────────────
    // Shows a centered "No lanes yet — press Scan Mapped" card inside the
    // canvas area when sdCanvasParams is empty. Called whenever the param
    // list changes (scan results, session load, clear lane, etc).
    function sdUpdateEmptyState() {
        try {
            const cta = document.getElementById('sd-empty-canvas-cta');
            if (!cta) return;
            const empty = !sdCanvasParams || sdCanvasParams.length === 0;
            cta.classList.toggle('hidden', !empty);
        } catch (e) { /* DOM not ready — will be called again after */ }
    }

    // ─── TOOL AVAILABILITY (gray-out Bloom / Weave / Mutate) ─
    // Bloom, Weave, and Mutate all need the selected parameter to have a
    // curve drawn on it (and Bloom/Weave additionally need ≥2 lanes so
    // there's something to propagate to). Instead of letting users click
    // and hit a modal explaining why it didn't work, we visually dim the
    // buttons when their preconditions aren't met. Clicks still fire the
    // existing requirement modals so the teaching still happens — the dim
    // is just an upfront signal.
    function sdUpdateToolAvailability() {
        try {
            const activeParam = sdActiveParamId
                ? sdCanvasParams.find(p => p.envelopeId === sdActiveParamId)
                : null;
            const activeHasCurve = !!(activeParam && activeParam.points && activeParam.points.length > 0);
            const hasMultipleLanes = sdCanvasParams.length >= 2;

            const dim = (id, disabled, reason) => {
                const btn = document.getElementById(id);
                if (!btn) return;
                if (disabled) {
                    btn.classList.add('opacity-40');
                    btn.setAttribute('data-unavailable', reason);
                } else {
                    btn.classList.remove('opacity-40');
                    btn.removeAttribute('data-unavailable');
                }
            };

            // Bloom and Weave both want active curve + ≥2 lanes
            const bloomWeaveReason = !activeHasCurve
                ? 'Pick a parameter in the sidebar and draw or Chaos a curve first'
                : (!hasMultipleLanes ? 'Need at least 2 lanes' : '');
            dim('sd-bloom-btn', !activeHasCurve || !hasMultipleLanes, bloomWeaveReason);
            dim('sd-weave-btn', !activeHasCurve || !hasMultipleLanes, bloomWeaveReason);

            // Mutate only needs active curve
            dim('sd-mutate-btn', !activeHasCurve,
                'Pick a parameter in the sidebar and draw or Chaos a curve first');
        } catch (e) { /* DOM not ready yet */ }
    }

    // ─── SIDEBAR ──────────────────────────────────────────

    function sdRenderSidebar() {
        const list = document.getElementById('sd-param-list');
        const fmtVal = v => {
            if (!isFinite(v)) return '?';
            if (Math.abs(v) >= 10000) return (v / 1000).toFixed(1) + 'k';
            if (Number.isInteger(v) || Math.abs(v) >= 100) return String(Math.round(v));
            if (Math.abs(v) >= 10) return v.toFixed(1);
            return parseFloat(v.toFixed(3)).toString();
        };
        // Build display names with index suffix for duplicates
        const nameCounts = {};
        const nameIndex = {};
        sdCanvasParams.forEach(p => { nameCounts[p.name] = (nameCounts[p.name] || 0) + 1; });
        sdCanvasParams.forEach(p => { nameIndex[p.name] = (nameIndex[p.name] || 0) + 1; });
        // Reset for second pass
        Object.keys(nameIndex).forEach(k => nameIndex[k] = 0);

        list.innerHTML = sdCanvasParams.map(p => {
            nameIndex[p.name] = (nameIndex[p.name] || 0) + 1;
            const displayName = nameCounts[p.name] > 1 ? `${p.name} (${nameIndex[p.name]})` : p.name;
            return `
            <button onclick="sdSetActiveParam('${p.envelopeId}')" class="w-full text-left px-3 py-2 rounded-lg text-[9px] font-bold uppercase tracking-widest transition-colors ${sdActiveParamId === p.envelopeId ? 'bg-fuchsia-500/20 text-fuchsia-400 border border-fuchsia-500/30' : 'bg-black/20 text-zinc-400 border border-white/5 hover:bg-white/5'}">
                <div class="truncate">${displayName}</div>
                <div class="flex items-center justify-between mt-0.5">
                    <span class="text-[8px] text-zinc-600">${p.points.length} pts${p.is_log ? ' · log' : ''}</span>
                    <span class="text-[8px] text-zinc-600 font-mono">${fmtVal(p.min)} - ${fmtVal(p.max)}</span>
                </div>
            </button>`;
        }).join('');

        // Keep the empty-canvas CTA in sync with the param list
        sdUpdateEmptyState();
        // Keep Bloom/Weave/Mutate gray-out state in sync
        sdUpdateToolAvailability();
    }

    window.sdSetActiveParam = function(id) {
        sdActiveParamId = id;
        sdResetSliderSnapshots();
        // In multi-lane view, scroll the canvas so the clicked param's lane is
        // actually visible. Without this, clicking a param off-screen highlights
        // it in the sidebar but the user has to manually scroll to find its lane.
        if (sdViewMode === 'multi') {
            const idx = sdCanvasParams.findIndex(p => p.envelopeId === id);
            if (idx >= 0) {
                const visible = sdMultiVisibleLaneCount();
                if (idx < sdMultiScrollOffset || idx >= sdMultiScrollOffset + visible) {
                    sdMultiScrollOffset = Math.max(0, idx - Math.floor(visible / 2));
                    sdMultiClampScroll();
                }
            }
        }
        sdRenderSidebar();
        sdDrawCanvasGrid();
    };

    // ─── SELECTION ────────────────────────────────────────

    function sdGetSelection() {
        if (sdSelectionStart === null || sdSelectionEnd === null) return null;
        const s = Math.min(sdSelectionStart, sdSelectionEnd);
        const e = Math.max(sdSelectionStart, sdSelectionEnd);
        if (e - s < 0.1) return null;
        return { startBeat: s, endBeat: e };
    }

    function sdClearSelection() {
        sdSelectionStart = null; sdSelectionEnd = null;
        sdDrawRuler(); sdDrawCanvasGrid();
    }

    function sdGetSelectedPoints(param) {
        const sel = sdGetSelection();
        if (!sel) return param.points;
        return param.points.filter(pt => pt.time >= sel.startBeat && pt.time <= sel.endBeat);
    }

    function sdGetTargetParams() {
        if (sdApplyAllMode) return sdCanvasParams;
        const p = sdCanvasParams.find(p => p.envelopeId === sdActiveParamId);
        return p ? [p] : [];
    }

    // ─── DRAWING ──────────────────────────────────────────

    // ─── MULTI-VIEW HELPERS ──────────────────────────────
    // How many lanes fit visually in the current canvas height.
    function sdMultiVisibleLaneCount() {
        if (!sdCanvasEl) return 0;
        const h = sdCanvasEl.getBoundingClientRect().height;
        return Math.max(1, Math.floor(h / SD_MULTI_LANE_HEIGHT));
    }

    // Clamp scroll offset to legal range whenever lane count changes.
    function sdMultiClampScroll() {
        const visible = sdMultiVisibleLaneCount();
        const maxOffset = Math.max(0, sdCanvasParams.length - visible);
        if (sdMultiScrollOffset > maxOffset) sdMultiScrollOffset = maxOffset;
        if (sdMultiScrollOffset < 0) sdMultiScrollOffset = 0;
    }

    // For a visible row index (0 = topmost visible), return the Y rect on canvas.
    function sdMultiGetVisibleRowRect(rowIdx) {
        const top = rowIdx * SD_MULTI_LANE_HEIGHT;
        return {
            top,
            bottom: top + SD_MULTI_LANE_HEIGHT,
            height: SD_MULTI_LANE_HEIGHT,
        };
    }

    // Given a canvas Y pixel, which param (if any) is under it in multi view?
    function sdMultiGetParamAtY(y) {
        if (y < 0) return null;
        const rowIdx = Math.floor(y / SD_MULTI_LANE_HEIGHT);
        const visible = sdMultiVisibleLaneCount();
        if (rowIdx < 0 || rowIdx >= visible) return null;
        const paramIdx = rowIdx + sdMultiScrollOffset;
        if (paramIdx >= sdCanvasParams.length) return null;
        return {
            param: sdCanvasParams[paramIdx],
            rect: sdMultiGetVisibleRowRect(rowIdx),
            rowIdx,
        };
    }

    function sdDrawCanvasGrid() {
        if (!sdCtx || !sdCanvasEl || !sdCanvasRect) return;
        sdDrawRuler();
        const lw = sdCanvasEl.getBoundingClientRect().width;
        const lh = sdCanvasEl.getBoundingClientRect().height;
        sdCtx.clearRect(0, 0, lw, lh);

        // Multi-lane view branches to its own renderer
        if (sdViewMode === 'multi') {
            sdDrawMultiView(lw, lh);
            return;
        }
        const bars = sdGetBars();
        const totalBeats = bars * 4;
        let gridStep = 0.25;
        if (sdViewZoomX > 3) gridStep = 0.125;
        if (sdViewZoomX > 8) gridStep = 0.0625;

        // Vertical grid lines
        for (let b = 0; b <= totalBeats; b += gridStep) {
            const x = ((b / totalBeats) * lw * sdViewZoomX) - sdViewPanX;
            if (x >= -50 && x <= lw + 50) {
                sdCtx.beginPath();
                if (b % 4 === 0) { sdCtx.strokeStyle = 'rgba(255,255,255,0.2)'; sdCtx.lineWidth = 2; }
                else if (b % 1 === 0) { sdCtx.strokeStyle = 'rgba(255,255,255,0.1)'; sdCtx.lineWidth = 1; }
                else if (b % 0.25 === 0) { sdCtx.strokeStyle = 'rgba(255,255,255,0.03)'; sdCtx.lineWidth = 1; }
                else { sdCtx.strokeStyle = 'rgba(255,255,255,0.015)'; sdCtx.lineWidth = 1; }
                sdCtx.moveTo(x, 0); sdCtx.lineTo(x, lh); sdCtx.stroke();
            }
        }

        // Horizontal grid lines
        for (let v = 0; v <= 1; v += 0.25) {
            const y = lh - (v * lh);
            sdCtx.strokeStyle = v === 0 || v === 1 ? 'rgba(255,255,255,0.15)' : 'rgba(255,255,255,0.05)';
            sdCtx.lineWidth = 1; sdCtx.beginPath(); sdCtx.moveTo(0, y); sdCtx.lineTo(lw, y); sdCtx.stroke();
        }

        // Y-axis labels
        if (sdActiveParamId) {
            const ap = sdCanvasParams.find(p => p.envelopeId === sdActiveParamId);
            if (ap && ap.min !== undefined && ap.max !== undefined) {
                const fv = v => { if (!isFinite(v)) return '?'; if (Math.abs(v) >= 10000) return (v / 1000).toFixed(1) + 'k'; if (Number.isInteger(v) || Math.abs(v) >= 100) return String(Math.round(v)); if (Math.abs(v) >= 10) return v.toFixed(1); return parseFloat(v.toFixed(3)).toString(); };
                sdCtx.font = 'bold 9px Outfit'; sdCtx.textAlign = 'left';
                sdCtx.fillStyle = 'rgba(168,85,247,0.9)'; sdCtx.fillText(fv(ap.max), 4, 13);
                sdCtx.fillStyle = 'rgba(255,255,255,0.25)'; sdCtx.fillText(fv(ap.min + (ap.max - ap.min) * 0.5), 4, lh / 2 + 4);
                sdCtx.fillStyle = 'rgba(255,255,255,0.5)'; sdCtx.fillText(fv(ap.min), 4, lh - 3);
            }
        }

        // Selection overlay
        const sel = sdGetSelection();
        if (sel) {
            const sx = ((sel.startBeat / totalBeats) * lw * sdViewZoomX) - sdViewPanX;
            const ex = ((sel.endBeat / totalBeats) * lw * sdViewZoomX) - sdViewPanX;
            sdCtx.fillStyle = 'rgba(0,0,0,0.45)';
            if (sx > 0) sdCtx.fillRect(0, 0, sx, lh);
            if (ex < lw) sdCtx.fillRect(ex, 0, lw - ex, lh);
            sdCtx.strokeStyle = 'rgba(168,85,247,0.6)'; sdCtx.lineWidth = 2;
            sdCtx.beginPath(); sdCtx.moveTo(sx, 0); sdCtx.lineTo(sx, lh); sdCtx.stroke();
            sdCtx.beginPath(); sdCtx.moveTo(ex, 0); sdCtx.lineTo(ex, lh); sdCtx.stroke();
        }

        // Points
        if (!sdActiveParamId) return;
        const param = sdCanvasParams.find(p => p.envelopeId === sdActiveParamId);
        if (!param || !param.points.length) return;
        param.points.sort((a, b) => a.time - b.time);

        // Draw curve line
        sdCtx.beginPath(); sdCtx.strokeStyle = '#a855f7'; sdCtx.lineWidth = 2;
        for (let i = 0; i < param.points.length; i++) {
            const pt = param.points[i];
            const x = ((pt.time / totalBeats) * lw * sdViewZoomX) - sdViewPanX;
            const y = lh - (pt.value * lh);
            if (i === 0) { sdCtx.moveTo(x, y); }
            else {
                const prev = param.points[i - 1];
                const cv = prev.curve || 0;
                if (cv === 0) { sdCtx.lineTo(x, y); }
                else {
                    const px = ((prev.time / totalBeats) * lw * sdViewZoomX) - sdViewPanX;
                    const py = lh - (prev.value * lh);
                    const mx = (px + x) / 2;
                    const my = (py + y) / 2;
                    const cpY = my - cv * Math.abs(y - py) * 1.2;
                    sdCtx.quadraticCurveTo(mx, cpY, x, y);
                }
            }
        }
        sdCtx.stroke();

        // Draw points and curve indicators
        sdCtx.fillStyle = '#a855f7';
        param.points.forEach(pt => {
            const x = ((pt.time / totalBeats) * lw * sdViewZoomX) - sdViewPanX;
            const y = lh - (pt.value * lh);
            if (x >= -10 && x <= lw + 10) {
                sdCtx.beginPath(); sdCtx.arc(x, y, 3, 0, Math.PI * 2); sdCtx.fill();
                if (sdDraggedPoint === pt) {
                    sdCtx.beginPath(); sdCtx.fillStyle = 'rgba(168,85,247,0.4)'; sdCtx.arc(x, y, 10, 0, Math.PI * 2); sdCtx.fill(); sdCtx.fillStyle = '#a855f7';
                }
                if (pt.curve && pt.curve !== 0) {
                    const idx = param.points.indexOf(pt);
                    if (idx < param.points.length - 1) {
                        const next = param.points[idx + 1];
                        const nx = ((next.time / totalBeats) * lw * sdViewZoomX) - sdViewPanX;
                        const ny = lh - (next.value * lh);
                        const mx = (x + nx) / 2;
                        const my = (y + ny) / 2;
                        const cpY = my - pt.curve * Math.abs(ny - y) * 1.2;
                        sdCtx.fillStyle = 'rgba(251,191,36,0.7)';
                        sdCtx.beginPath(); sdCtx.moveTo(mx, cpY - 3); sdCtx.lineTo(mx + 3, cpY); sdCtx.lineTo(mx, cpY + 3); sdCtx.lineTo(mx - 3, cpY); sdCtx.closePath(); sdCtx.fill();
                        sdCtx.fillStyle = '#a855f7';
                    }
                }
            }
        });
    }

    // ─── MULTI-LANE RENDERER ──────────────────────────────
    // Renders every visible param as a horizontal strip of SD_MULTI_LANE_HEIGHT
    // pixels tall. The left SD_MULTI_LABEL_WIDTH pixels of each row show the
    // parameter name + index. The remaining width shows the curve at the
    // normal time zoom + pan. The active param row has a fuchsia border
    // highlight so the user always knows which lane their tool edits target.
    function sdDrawMultiView(lw, lh) {
        sdMultiClampScroll();
        const bars = sdGetBars();
        const totalBeats = bars * 4;
        const laneDrawLeft = SD_MULTI_LABEL_WIDTH;
        const laneDrawWidth = Math.max(1, lw - SD_MULTI_LABEL_WIDTH);

        // Shared time grid lines — drawn across the whole canvas height so
        // they form vertical rulers connecting all lanes visually.
        let gridStep = 0.25;
        if (sdViewZoomX > 3) gridStep = 0.125;
        if (sdViewZoomX > 8) gridStep = 0.0625;
        sdCtx.save();
        sdCtx.beginPath();
        sdCtx.rect(laneDrawLeft, 0, laneDrawWidth, lh);
        sdCtx.clip();
        for (let b = 0; b <= totalBeats; b += gridStep) {
            const x = laneDrawLeft + ((b / totalBeats) * laneDrawWidth * sdViewZoomX) - sdViewPanX;
            if (x < laneDrawLeft - 50 || x > lw + 50) continue;
            if (b % 4 === 0) { sdCtx.strokeStyle = 'rgba(255,255,255,0.18)'; sdCtx.lineWidth = 2; }
            else if (b % 1 === 0) { sdCtx.strokeStyle = 'rgba(255,255,255,0.09)'; sdCtx.lineWidth = 1; }
            else if (b % 0.25 === 0) { sdCtx.strokeStyle = 'rgba(255,255,255,0.03)'; sdCtx.lineWidth = 1; }
            else { sdCtx.strokeStyle = 'rgba(255,255,255,0.015)'; sdCtx.lineWidth = 1; }
            sdCtx.beginPath(); sdCtx.moveTo(x, 0); sdCtx.lineTo(x, lh); sdCtx.stroke();
        }
        sdCtx.restore();

        // Label column background
        sdCtx.fillStyle = 'rgba(0,0,0,0.35)';
        sdCtx.fillRect(0, 0, laneDrawLeft, lh);
        sdCtx.strokeStyle = 'rgba(255,255,255,0.08)';
        sdCtx.lineWidth = 1;
        sdCtx.beginPath(); sdCtx.moveTo(laneDrawLeft, 0); sdCtx.lineTo(laneDrawLeft, lh); sdCtx.stroke();

        // Build a name counter so duplicates get a numeric suffix
        const nameCounts = {};
        const nameIndex = {};
        sdCanvasParams.forEach(p => { nameCounts[p.name] = (nameCounts[p.name] || 0) + 1; });

        // Per-lane render
        const visible = sdMultiVisibleLaneCount();
        const sel = sdGetSelection();
        for (let row = 0; row < visible; row++) {
            const paramIdx = row + sdMultiScrollOffset;
            if (paramIdx >= sdCanvasParams.length) break;
            const param = sdCanvasParams[paramIdx];
            nameIndex[param.name] = (nameIndex[param.name] || 0) + 1;
            const displayName = nameCounts[param.name] > 1
                ? `${param.name} (${nameIndex[param.name]})`
                : param.name;
            const rect = sdMultiGetVisibleRowRect(row);
            const isActive = sdActiveParamId === param.envelopeId;

            // Row background stripe (alternating to make rows scannable)
            sdCtx.fillStyle = row % 2 === 0 ? 'rgba(255,255,255,0.015)' : 'rgba(0,0,0,0.15)';
            sdCtx.fillRect(laneDrawLeft, rect.top, laneDrawWidth, rect.height);

            // Active-row highlight (fuchsia tint + border)
            if (isActive) {
                sdCtx.fillStyle = 'rgba(168,85,247,0.08)';
                sdCtx.fillRect(0, rect.top, lw, rect.height);
                sdCtx.strokeStyle = 'rgba(168,85,247,0.55)';
                sdCtx.lineWidth = 1.5;
                sdCtx.strokeRect(0.75, rect.top + 0.75, lw - 1.5, rect.height - 1.5);
            }

            // Horizontal lane divider below
            sdCtx.strokeStyle = 'rgba(255,255,255,0.06)';
            sdCtx.lineWidth = 1;
            sdCtx.beginPath(); sdCtx.moveTo(0, rect.bottom); sdCtx.lineTo(lw, rect.bottom); sdCtx.stroke();

            // Center reference line (0.5) — subtle
            const midY = rect.top + rect.height / 2;
            sdCtx.strokeStyle = 'rgba(255,255,255,0.04)';
            sdCtx.beginPath(); sdCtx.moveTo(laneDrawLeft, midY); sdCtx.lineTo(lw, midY); sdCtx.stroke();

            // Param name (label column)
            sdCtx.fillStyle = isActive ? 'rgba(232,121,249,0.95)' : 'rgba(228,228,231,0.75)';
            sdCtx.font = isActive ? 'bold 11px Outfit' : '600 10px Outfit';
            sdCtx.textAlign = 'left';
            sdCtx.textBaseline = 'middle';
            const labelText = displayName.length > 17 ? displayName.slice(0, 16) + '…' : displayName;
            sdCtx.fillText(labelText, 8, midY - 5);

            // Point count + range line
            sdCtx.font = '10px Outfit';
            sdCtx.fillStyle = 'rgba(161,161,170,0.7)';
            sdCtx.fillText(`${param.points.length} pts`, 8, midY + 10);

            // Selection shade inside this lane's drawing area
            if (sel) {
                const sx = laneDrawLeft + ((sel.startBeat / totalBeats) * laneDrawWidth * sdViewZoomX) - sdViewPanX;
                const ex = laneDrawLeft + ((sel.endBeat / totalBeats) * laneDrawWidth * sdViewZoomX) - sdViewPanX;
                sdCtx.save();
                sdCtx.beginPath();
                sdCtx.rect(laneDrawLeft, rect.top, laneDrawWidth, rect.height);
                sdCtx.clip();
                sdCtx.fillStyle = 'rgba(0,0,0,0.35)';
                if (sx > laneDrawLeft) sdCtx.fillRect(laneDrawLeft, rect.top, sx - laneDrawLeft, rect.height);
                if (ex < lw) sdCtx.fillRect(ex, rect.top, lw - ex, rect.height);
                sdCtx.strokeStyle = 'rgba(168,85,247,0.5)';
                sdCtx.lineWidth = 1.5;
                sdCtx.beginPath(); sdCtx.moveTo(sx, rect.top); sdCtx.lineTo(sx, rect.bottom); sdCtx.stroke();
                sdCtx.beginPath(); sdCtx.moveTo(ex, rect.top); sdCtx.lineTo(ex, rect.bottom); sdCtx.stroke();
                sdCtx.restore();
            }

            // Draw this lane's curve
            if (!param.points.length) continue;
            const sortedPts = param.points.slice().sort((a, b) => a.time - b.time);
            const valueToY = (v) => rect.bottom - v * rect.height;
            const timeToX = (t) => laneDrawLeft + ((t / totalBeats) * laneDrawWidth * sdViewZoomX) - sdViewPanX;

            sdCtx.save();
            sdCtx.beginPath();
            sdCtx.rect(laneDrawLeft, rect.top, laneDrawWidth, rect.height);
            sdCtx.clip();

            // Fill under curve (subtle)
            sdCtx.beginPath();
            sdCtx.fillStyle = isActive ? 'rgba(168,85,247,0.12)' : 'rgba(168,85,247,0.06)';
            sdCtx.moveTo(timeToX(sortedPts[0].time), rect.bottom);
            for (let i = 0; i < sortedPts.length; i++) {
                const pt = sortedPts[i];
                const x = timeToX(pt.time);
                const y = valueToY(pt.value);
                if (i === 0) { sdCtx.lineTo(x, y); }
                else {
                    const prev = sortedPts[i - 1];
                    const cv = prev.curve || 0;
                    if (cv === 0) { sdCtx.lineTo(x, y); }
                    else {
                        const px = timeToX(prev.time);
                        const py = valueToY(prev.value);
                        const mx = (px + x) / 2;
                        const my = (py + y) / 2;
                        const cpY = my - cv * Math.abs(y - py) * 1.2;
                        sdCtx.quadraticCurveTo(mx, cpY, x, y);
                    }
                }
            }
            sdCtx.lineTo(timeToX(sortedPts[sortedPts.length - 1].time), rect.bottom);
            sdCtx.closePath();
            sdCtx.fill();

            // Curve stroke
            sdCtx.beginPath();
            sdCtx.strokeStyle = isActive ? '#c084fc' : 'rgba(168,85,247,0.6)';
            sdCtx.lineWidth = isActive ? 2 : 1.5;
            for (let i = 0; i < sortedPts.length; i++) {
                const pt = sortedPts[i];
                const x = timeToX(pt.time);
                const y = valueToY(pt.value);
                if (i === 0) { sdCtx.moveTo(x, y); }
                else {
                    const prev = sortedPts[i - 1];
                    const cv = prev.curve || 0;
                    if (cv === 0) { sdCtx.lineTo(x, y); }
                    else {
                        const px = timeToX(prev.time);
                        const py = valueToY(prev.value);
                        const mx = (px + x) / 2;
                        const my = (py + y) / 2;
                        const cpY = my - cv * Math.abs(y - py) * 1.2;
                        sdCtx.quadraticCurveTo(mx, cpY, x, y);
                    }
                }
            }
            sdCtx.stroke();

            // Point dots (only on active lane to reduce clutter)
            if (isActive) {
                sdCtx.fillStyle = '#a855f7';
                sortedPts.forEach(pt => {
                    const x = timeToX(pt.time);
                    const y = valueToY(pt.value);
                    if (x >= laneDrawLeft - 10 && x <= lw + 10) {
                        sdCtx.beginPath(); sdCtx.arc(x, y, 3, 0, Math.PI * 2); sdCtx.fill();
                    }
                });
            }
            sdCtx.restore();
        }

        // Scroll indicator on the far right (thin track)
        if (sdCanvasParams.length > visible) {
            const trackW = 4;
            const trackX = lw - trackW - 2;
            sdCtx.fillStyle = 'rgba(255,255,255,0.05)';
            sdCtx.fillRect(trackX, 0, trackW, lh);
            const thumbH = Math.max(20, (visible / sdCanvasParams.length) * lh);
            const thumbY = (sdMultiScrollOffset / sdCanvasParams.length) * lh;
            sdCtx.fillStyle = 'rgba(168,85,247,0.55)';
            sdCtx.fillRect(trackX, thumbY, trackW, thumbH);
        }
    }

    function sdDrawRuler() {
        const ruler = document.getElementById('sd-canvas-ruler');
        if (!ruler) return;
        const bars = sdGetBars(); const totalBeats = bars * 4; const rw = ruler.offsetWidth;
        const sel = sdGetSelection();
        // In multi-lane view the grid lives inside the right-hand side of
        // the canvas — the left SD_MULTI_LABEL_WIDTH pixels are reserved
        // for param names. The ruler must match that offset so bar 1
        // sits above the actual start of the grid, not above the labels.
        const xOff = sdViewMode === 'multi' ? SD_MULTI_LABEL_WIDTH : 0;
        const drawW = Math.max(1, rw - xOff);
        const timeToRulerX = (beat) => xOff + ((beat / totalBeats) * drawW * sdViewZoomX) - sdViewPanX;
        let html = '';
        // Label-column background so the ruler visually continues the
        // canvas's own label column
        if (xOff > 0) {
            html += `<div class="absolute top-0 bottom-0 left-0 bg-black/40 border-r border-white/10" style="width:${xOff}px;"></div>`;
        }
        if (sel) {
            const sx = timeToRulerX(sel.startBeat);
            const ex = timeToRulerX(sel.endBeat);
            const clampedLeft = Math.max(xOff, sx);
            const clampedRight = Math.min(rw, ex);
            if (clampedRight > clampedLeft) {
                html += `<div class="absolute top-0 bottom-0 bg-fuchsia-500/20 border-l border-r border-fuchsia-400/50" style="left:${clampedLeft}px;width:${clampedRight - clampedLeft}px;"></div>`;
            }
        }
        for (let bar = 0; bar < bars; bar++) {
            const beat = bar * 4;
            const x = timeToRulerX(beat);
            if (x >= xOff - 40 && x <= rw + 40) {
                html += `<span class="absolute text-[8px] font-bold text-zinc-400 select-none pointer-events-none" style="left:${x + 4}px;top:3px;">${bar + 1}</span>`;
            }
            for (let b = 1; b < 4; b++) {
                const bx = timeToRulerX(beat + b);
                if (bx >= xOff && bx <= rw) {
                    html += `<div class="absolute top-3 w-px h-1.5 bg-white/10" style="left:${bx}px;"></div>`;
                }
            }
            if (x >= xOff && x <= rw) {
                html += `<div class="absolute top-1 w-px h-3.5 bg-white/20" style="left:${x}px;"></div>`;
            }
        }
        ruler.innerHTML = html;
    }

    // ─── RULER INTERACTION ────────────────────────────────

    function setupSdRulerInteraction() {
        const ruler = document.getElementById('sd-canvas-ruler');
        if (!ruler) return;
        function beatFromX(clientX) {
            const rect = ruler.getBoundingClientRect();
            const xOff = sdViewMode === 'multi' ? SD_MULTI_LABEL_WIDTH : 0;
            const drawW = Math.max(1, rect.width - xOff);
            const x = clientX - rect.left - xOff;
            const bars = sdGetBars(); const totalBeats = bars * 4;
            const beat = ((x + sdViewPanX) / (drawW * sdViewZoomX)) * totalBeats;
            return Math.max(0, Math.min(totalBeats, Math.round(beat)));
        }
        ruler.addEventListener('mousedown', e => {
            // Ignore clicks on the label column (only valid above the grid)
            const r0 = ruler.getBoundingClientRect();
            const xOff0 = sdViewMode === 'multi' ? SD_MULTI_LABEL_WIDTH : 0;
            if ((e.clientX - r0.left) < xOff0) return;
            const beat = beatFromX(e.clientX);
            const sel = sdGetSelection();
            if (sel) {
                const rect = ruler.getBoundingClientRect();
                const xOff = sdViewMode === 'multi' ? SD_MULTI_LABEL_WIDTH : 0;
                const drawW = Math.max(1, rect.width - xOff);
                const bars = sdGetBars(); const totalBeats = bars * 4;
                const sxPx = xOff + ((sel.startBeat / totalBeats) * drawW * sdViewZoomX) - sdViewPanX;
                const exPx = xOff + ((sel.endBeat / totalBeats) * drawW * sdViewZoomX) - sdViewPanX;
                const mx = e.clientX - rect.left;
                if (Math.abs(mx - sxPx) < 8) { sdSelectionDragEdge = 'start'; sdIsSelectingRegion = true; return; }
                if (Math.abs(mx - exPx) < 8) { sdSelectionDragEdge = 'end'; sdIsSelectingRegion = true; return; }
            }
            sdSelectionStart = beat; sdSelectionEnd = beat; sdSelectionDragEdge = null; sdIsSelectingRegion = true;
        });
        window.addEventListener('mousemove', e => {
            if (!sdIsSelectingRegion) return;
            const beat = beatFromX(e.clientX);
            if (sdSelectionDragEdge === 'start') sdSelectionStart = beat;
            else if (sdSelectionDragEdge === 'end') sdSelectionEnd = beat;
            else sdSelectionEnd = beat;
            sdDrawRuler(); sdDrawCanvasGrid();
        });
        window.addEventListener('mouseup', () => {
            if (!sdIsSelectingRegion) return;
            sdIsSelectingRegion = false; sdSelectionDragEdge = null;
            if (!sdGetSelection()) { sdSelectionStart = null; sdSelectionEnd = null; }
            sdDrawRuler(); sdDrawCanvasGrid();
        });
    }

    // ─── CANVAS INTERACTIONS ──────────────────────────────

    function sdGetTimeValue(e) {
        const rect = sdCanvasEl.getBoundingClientRect();
        const pos = { x: e.clientX - rect.left, y: e.clientY - rect.top };
        const bars = sdGetBars(); const totalBeats = bars * 4;

        if (sdViewMode === 'multi') {
            // Draw area is offset by the label column on the left. Time math
            // runs against the narrower draw width.
            const drawWidth = Math.max(1, rect.width - SD_MULTI_LABEL_WIDTH);
            const xLocal = pos.x - SD_MULTI_LABEL_WIDTH;
            const time = ((xLocal + sdViewPanX) / (drawWidth * sdViewZoomX)) * totalBeats;

            // Y → value maps against the ACTIVE lane's visible strip, so an
            // in-progress drag doesn't cross into a neighbour lane's space.
            const activeIdx = sdCanvasParams.findIndex(p => p.envelopeId === sdActiveParamId);
            if (activeIdx === -1) return { time, value: 0 };
            const rowIdx = activeIdx - sdMultiScrollOffset;
            if (rowIdx < 0 || rowIdx >= sdMultiVisibleLaneCount()) {
                return { time, value: 0 };
            }
            const laneRect = sdMultiGetVisibleRowRect(rowIdx);
            const value = Math.max(0, Math.min(1, 1 - ((pos.y - laneRect.top) / laneRect.height)));
            return { time, value };
        }

        // Focus mode (original behavior)
        return { time: ((pos.x + sdViewPanX) / (rect.width * sdViewZoomX)) * totalBeats, value: 1 - (pos.y / rect.height) };
    }

    function setupSdCanvasInteractions() {
        if (!sdCanvasEl) return;
        window.addEventListener('keydown', e => {
            if ((e.ctrlKey || e.metaKey) && e.code === 'KeyZ' && !e.shiftKey) { e.preventDefault(); sdUndo(); return; }
            if ((e.ctrlKey || e.metaKey) && e.code === 'KeyZ' && e.shiftKey) { e.preventDefault(); sdRedo(); return; }
            if ((e.ctrlKey || e.metaKey) && e.code === 'KeyY') { e.preventDefault(); sdRedo(); return; }
            if (e.code === 'Escape') { sdClearSelection(); return; }
            if (e.code === 'Space') {
                if (document.activeElement.tagName === 'INPUT' || document.activeElement.tagName === 'TEXTAREA') return;
                e.preventDefault(); sdIsSpacePressed = true; if (sdCanvasEl) sdCanvasEl.style.cursor = 'grab';
            }
        });
        window.addEventListener('keyup', e => {
            if (e.code === 'Space') { sdIsSpacePressed = false; if (sdCanvasEl) sdCanvasEl.style.cursor = 'crosshair'; sdIsPanning = false; }
        });
        sdCanvasEl.addEventListener('wheel', e => {
            e.preventDefault();
            const rect = sdCanvasEl.getBoundingClientRect(); const lw = rect.width;

            // Multi view: plain wheel scrolls the lane list vertically
            if (sdViewMode === 'multi' && !(e.ctrlKey || e.metaKey)) {
                const dir = e.deltaY > 0 ? 1 : -1;
                sdMultiScrollOffset += dir;
                sdMultiClampScroll();
                sdDrawCanvasGrid();
                return;
            }

            if (e.ctrlKey || e.metaKey) {
                const mouseX = e.clientX - rect.left;
                const dir = e.deltaY > 0 ? -1 : 1;
                let nz = sdViewZoomX * (dir > 0 ? 1.1 : 1 / 1.1);
                nz = Math.max(1, Math.min(nz, 20));
                const tAtM = (mouseX + sdViewPanX) / (lw * sdViewZoomX);
                sdViewZoomX = nz; sdViewPanX = (tAtM * lw * sdViewZoomX) - mouseX;
            } else { sdViewPanX += Math.abs(e.deltaX) > Math.abs(e.deltaY) ? e.deltaX : e.deltaY; }
            sdViewPanX = Math.max(0, Math.min((lw * sdViewZoomX) - lw, sdViewPanX));
            sdDrawCanvasGrid();
        });
        sdCanvasEl.addEventListener('mousedown', e => {
            if (sdIsSpacePressed) { sdIsPanning = true; sdLastMouseX = e.clientX; sdCanvasEl.style.cursor = 'grabbing'; return; }

            // Multi view: the clicked Y position decides which lane the tool
            // targets. Clicking a non-active lane just activates it (no draw)
            // so users can safely browse without accidentally dropping points.
            // A second click on the already-active lane performs the draw.
            if (sdViewMode === 'multi') {
                const mrect = sdCanvasEl.getBoundingClientRect();
                const my = e.clientY - mrect.top;
                const mx = e.clientX - mrect.left;
                const hit = sdMultiGetParamAtY(my);
                if (!hit) return;
                const wasActive = sdActiveParamId === hit.param.envelopeId;
                if (!wasActive) {
                    sdActiveParamId = hit.param.envelopeId;
                    sdResetSliderSnapshots();
                    sdRenderSidebar();
                    sdDrawCanvasGrid();
                    return;
                }
                // Click inside the label column on the active lane → no-op
                if (mx < SD_MULTI_LABEL_WIDTH) return;
            }

            if (!sdActiveParamId) return;
            const hd = sdGetTimeValue(e); const param = sdCanvasParams.find(p => p.envelopeId === sdActiveParamId);
            const bars = sdGetBars(); const totalBeats = bars * 4;
            const hitT = (totalBeats * 0.02) / sdViewZoomX; const hitV = 0.05;
            let idx = param.points.findIndex(pt => Math.abs(pt.time - hd.time) < hitT && Math.abs(pt.value - hd.value) < hitV);
            if (e.button === 2) { if (idx !== -1) { pushUndo(); param.points.splice(idx, 1); sdRenderSidebar(); sdDrawCanvasGrid(); } return; }
            // ALT+click on a segment → curve drag
            if (e.altKey && param.points.length >= 2 && sdActiveTool === 'select') {
                const sorted = [...param.points].sort((a, b) => a.time - b.time);
                for (let i = 0; i < sorted.length - 1; i++) {
                    if (hd.time >= sorted[i].time && hd.time <= sorted[i + 1].time) {
                        sdIsCurveDragging = true;
                        sdCurveDragSegment = { point: sorted[i], startY: e.clientY, startCurve: sorted[i].curve || 0 };
                        sdCanvasEl.style.cursor = 'ns-resize';
                        return;
                    }
                }
            }
            if (sdActiveTool === 'freehand') { sdIsDragging = true; sdPaintFreehand(hd.time, hd.value, param, totalBeats); }
            else {
                if (idx !== -1) { sdIsDragging = true; sdDraggedPoint = param.points[idx]; sdDrawCanvasGrid(); }
                else {
                    let snap = 4; if (sdViewZoomX > 3) snap = 8; if (sdViewZoomX > 8) snap = 16;
                    const np = { time: Math.round(hd.time * snap) / snap, value: Math.max(0, Math.min(1, hd.value)) };
                    param.points.push(np); sdIsDragging = true; sdDraggedPoint = np; sdRenderSidebar(); sdDrawCanvasGrid();
                }
            }
        });
        sdCanvasEl.addEventListener('mousemove', e => {
            if (sdIsPanning) {
                sdViewPanX += sdLastMouseX - e.clientX; sdLastMouseX = e.clientX;
                const rect = sdCanvasEl.getBoundingClientRect(); const lw = rect.width;
                sdViewPanX = Math.max(0, Math.min((lw * sdViewZoomX) - lw, sdViewPanX));
                sdDrawCanvasGrid(); return;
            }
            if (sdIsCurveDragging && sdCurveDragSegment) {
                const delta = (sdCurveDragSegment.startY - e.clientY) / 150;
                sdCurveDragSegment.point.curve = Math.max(-1, Math.min(1, sdCurveDragSegment.startCurve + delta));
                sdDrawCanvasGrid(); return;
            }
            if (e.altKey && !sdIsDragging && !sdIsPanning && sdActiveParamId && sdActiveTool === 'select') {
                const hd = sdGetTimeValue(e);
                const param = sdCanvasParams.find(p => p.envelopeId === sdActiveParamId);
                if (param && param.points.length >= 2) {
                    const sorted = [...param.points].sort((a, b) => a.time - b.time);
                    let onSeg = false;
                    for (let i = 0; i < sorted.length - 1; i++) {
                        if (hd.time >= sorted[i].time && hd.time <= sorted[i + 1].time) { onSeg = true; break; }
                    }
                    sdCanvasEl.style.cursor = onSeg ? 'ns-resize' : 'crosshair';
                }
            } else if (!sdIsDragging && !sdIsPanning && !sdIsSpacePressed) {
                sdCanvasEl.style.cursor = 'crosshair';
            }
            if (!sdIsDragging) return;
            const hd = sdGetTimeValue(e); const bars = sdGetBars(); const totalBeats = bars * 4;
            if (sdActiveTool === 'freehand') { const param = sdCanvasParams.find(p => p.envelopeId === sdActiveParamId); sdPaintFreehand(hd.time, hd.value, param, totalBeats); }
            else if (sdDraggedPoint) {
                let snap = 4; if (sdViewZoomX > 3) snap = 8; if (sdViewZoomX > 8) snap = 16;
                sdDraggedPoint.time = Math.max(0, Math.min(totalBeats, Math.round(hd.time * snap) / snap));
                sdDraggedPoint.value = Math.max(0, Math.min(1, hd.value)); sdDrawCanvasGrid();
            }
        });
        window.addEventListener('mouseup', () => {
            if (sdIsPanning) { sdIsPanning = false; if (sdIsSpacePressed && sdCanvasEl) sdCanvasEl.style.cursor = 'grab'; }
            if (sdIsCurveDragging) { pushUndo(); sdIsCurveDragging = false; sdCurveDragSegment = null; if (sdCanvasEl) sdCanvasEl.style.cursor = 'crosshair'; sdDrawCanvasGrid(); }
            if (sdIsDragging) { pushUndo(); sdIsDragging = false; sdDraggedPoint = null; sdRenderSidebar(); sdDrawCanvasGrid(); }
        });
        sdCanvasEl.addEventListener('contextmenu', e => e.preventDefault());
    }

    function sdPaintFreehand(time, value, param, totalBeats) {
        let snap = 8; if (sdViewZoomX > 3) snap = 16;
        let st = Math.max(0, Math.min(totalBeats, Math.round(time * snap) / snap));
        let cv = Math.max(0, Math.min(1, value));
        param.points = param.points.filter(p => p.time !== st);
        param.points.push({ time: st, value: cv });
        sdDrawCanvasGrid();
    }

    // ─── SHAPE INJECTOR ───────────────────────────────────

    function sdInjectShape(param, shape, cB, chunk) {
        const addPt = (t, v) => param.points.push({ time: Math.round(t * 10000) / 10000, value: Math.max(0, Math.min(1, v)) });
        if (shape === 'dotted_ramp') { let pk = 0.4 + Math.random() * 0.6; addPt(cB, 0); addPt(cB + chunk * 0.75, pk); addPt(cB + chunk * 0.75 + 0.01, 0); addPt(cB + chunk, 0); }
        else if (shape === 'mid_value_hold') { let mv = 0.15 + Math.random() * 0.35, pk = 0.7 + Math.random() * 0.3; addPt(cB, 0); addPt(cB + 0.01, pk); addPt(cB + chunk * 0.25, pk); addPt(cB + chunk * 0.25 + 0.01, mv); addPt(cB + chunk * 0.75, mv); addPt(cB + chunk * 0.75 + 0.01, pk); addPt(cB + chunk - 0.01, pk); addPt(cB + chunk, 0); }
        else if (shape === 'offgrid_saw') { let pk = 0.5 + Math.random() * 0.5, og = [0.216, 0.414, 0.618, 0.88][Math.floor(Math.random() * 4)]; addPt(cB, 0); addPt(cB + 0.01, pk); addPt(cB + chunk * og, 0); addPt(cB + chunk, 0); }
        else if (shape === 'hard_chop') { let sub = chunk / 4; for (let i = 0; i < 4; i++) { let val = Math.random() > 0.5 ? (Math.random() > 0.5 ? 1 : 0.3 + Math.random() * 0.5) : 0; if (val > 0) { let t = cB + i * sub; addPt(t, 0); addPt(t + 0.01, val); addPt(t + sub * 0.85, 0); } } addPt(cB + chunk, 0); }
        else if (shape === 'exponential_build') { addPt(cB, 0); addPt(cB + chunk * 0.5, 0.2); addPt(cB + chunk * 0.8, 0.5); addPt(cB + chunk - 0.01, 1); addPt(cB + chunk, 0); }
        else if (shape === 'hyper_stutter') { let ss = Math.random() > 0.5 ? 0.125 : 0.0625, steps = Math.floor(chunk / ss); for (let i = 0; i < steps; i++) { if (i % 2 === 0) { let t = cB + i * ss; addPt(t, 0); addPt(t + 0.001, 0.6 + Math.random() * 0.4); addPt(t + ss * 0.9, 0); } } addPt(cB + chunk, 0); }
        else if (shape === 'rhythmic_gate_build') { let step = [0.125, 0.25, 0.5][Math.floor(Math.random() * 3)], steps = Math.floor(chunk / step), sv = 0.7 + Math.random() * 0.3, ev = Math.random() * 0.3, up = Math.random() > 0.5; for (let i = 0; i < steps; i++) { let t = cB + i * step, pr = i / Math.max(1, steps - 1), cp = up ? ev + (sv - ev) * pr : sv + (ev - sv) * pr; addPt(t, 0); addPt(t + 0.001, cp); addPt(t + step * 0.85, 0); } addPt(cB + chunk, 0); }
        else if (shape === 'syncopated_drops') { let step = 0.25, steps = Math.floor(chunk / step); for (let i = 0; i < steps; i++) { if (Math.random() > 0.3) { let t = cB + i * step, pk = 0.3 + Math.random() * 0.7; addPt(t, 0); addPt(t + 0.001, pk); addPt(t + step * 0.8, pk * 0.8); addPt(t + step * 0.81, 0); } } addPt(cB + chunk, 0); }
    }

    // ─── TOOLS ─────────────────────────────────────────────

    window.sdSetTool = function(tool) {
        sdActiveTool = tool;
        const bS = document.getElementById('sd-tool-select');
        const bF = document.getElementById('sd-tool-freehand');
        if (tool === 'select') { bS.className = "tool-btn bg-fuchsia-500/20 text-fuchsia-400 px-3 py-1 rounded text-[9px] uppercase tracking-wider font-bold transition-colors"; bF.className = "tool-btn text-zinc-400 hover:text-fuchsia-400 px-3 py-1 rounded text-[9px] uppercase tracking-wider font-bold transition-colors"; }
        else { bF.className = "tool-btn bg-fuchsia-500/20 text-fuchsia-400 px-3 py-1 rounded text-[9px] uppercase tracking-wider font-bold transition-colors"; bS.className = "tool-btn text-zinc-400 hover:text-fuchsia-400 px-3 py-1 rounded text-[9px] uppercase tracking-wider font-bold transition-colors"; }
    };

    window.sdApplyGlobalChaos = function() {
        if (!sdCanvasParams.length) return;
        pushUndo();
        const bars = sdGetBars(); const totalBeats = bars * 4;
        const sel = sdGetSelection(); const sB = sel ? sel.startBeat : 0; const eB = sel ? sel.endBeat : totalBeats;
        const pool = ['dotted_ramp', 'mid_value_hold', 'offgrid_saw', 'hard_chop', 'exponential_build', 'hyper_stutter', 'rhythmic_gate_build', 'syncopated_drops'];
        sdCanvasParams.forEach(param => {
            if (sel) param.points = param.points.filter(pt => pt.time < sB || pt.time > eB); else param.points = [];
            let cB = sB;
            while (cB < eB - 0.001) { let chunk = [0.5, 1, 1.5, 2, 4][Math.floor(Math.random() * 5)]; if (cB + chunk > eB) chunk = eB - cB; sdInjectShape(param, pool[Math.floor(Math.random() * pool.length)], cB, chunk); cB = Math.round((cB + chunk) * 10000) / 10000; }
        });
        sdResetSliderSnapshots(); sdRenderSidebar(); sdDrawCanvasGrid();
    };

    window.sdMirrorLane = function() { if (!sdActiveParamId) return; pushUndo(); sdGetTargetParams().forEach(p => { if (!p.points.length) return; sdGetSelectedPoints(p).forEach(pt => { pt.value = 1 - pt.value; if (pt.curve) pt.curve = -pt.curve; }); }); sdRenderSidebar(); sdDrawCanvasGrid(); };
    window.sdFlipLane = function() {
        if (!sdActiveParamId) return;
        pushUndo();
        const sel = sdGetSelection(); const sB = sel ? sel.startBeat : 0; const eB = sel ? sel.endBeat : sdGetBars() * 4;
        sdGetTargetParams().forEach(p => { if (!p.points.length) return; sdGetSelectedPoints(p).forEach(pt => { pt.time = Math.round((sB + eB - pt.time) * 10000) / 10000; }); });
        sdRenderSidebar(); sdDrawCanvasGrid();
    };
    window.sdCopyLane = function() {
        if (!sdActiveParamId) return;
        const param = sdCanvasParams.find(p => p.envelopeId === sdActiveParamId);
        if (!param || !param.points.length) return;
        const sel = sdGetSelection(); const pts = sel ? sdGetSelectedPoints(param) : param.points;
        const minT = sel ? sel.startBeat : 0;
        sdClipboardPoints = pts.map(pt => ({ time: pt.time - minT, value: pt.value, curve: pt.curve || 0 }));
        document.getElementById('sd-canvas-status').textContent = `Copied ${sdClipboardPoints.length} pts`;
    };
    window.sdPasteLane = function(invert) {
        if (!sdActiveParamId || !sdClipboardPoints || !sdClipboardPoints.length) return;
        pushUndo();
        const param = sdCanvasParams.find(p => p.envelopeId === sdActiveParamId); if (!param) return;
        const sel = sdGetSelection(); const tS = sel ? sel.startBeat : 0;
        const cD = Math.max(...sdClipboardPoints.map(p => p.time)); const tD = sel ? (sel.endBeat - sel.startBeat) : cD; const sc = cD > 0 ? tD / cD : 1;
        if (sel) param.points = param.points.filter(pt => pt.time < sel.startBeat || pt.time > sel.endBeat); else param.points = [];
        sdClipboardPoints.forEach(pt => { param.points.push({ time: Math.round((tS + pt.time * sc) * 10000) / 10000, value: invert ? 1 - pt.value : pt.value, curve: invert ? -(pt.curve || 0) : (pt.curve || 0) }); });
        param.points.sort((a, b) => a.time - b.time); sdResetSliderSnapshots(); sdRenderSidebar(); sdDrawCanvasGrid();
    };

    // Paste To... multi-select
    window.sdOpenPasteTo = function() {
        if (!sdClipboardPoints || !sdClipboardPoints.length) { if (sdActiveParamId) sdCopyLane(); }
        if (!sdClipboardPoints || !sdClipboardPoints.length) { document.getElementById('sd-canvas-status').textContent = 'Draw points first, then Copy'; return; }
        if (sdCanvasParams.length < 2) { document.getElementById('sd-canvas-status').textContent = 'Need at least 2 lanes'; return; }
        const pop = document.getElementById('sd-paste-to-popover');
        if (!pop.classList.contains('hidden')) { sdClosePasteTo(); return; }
        const list = document.getElementById('sd-paste-to-list');
        list.innerHTML = sdCanvasParams.filter(p => p.envelopeId !== sdActiveParamId).map(p => `
            <label class="flex items-center gap-2 px-3 py-1.5 hover:bg-white/5 cursor-pointer">
                <input type="checkbox" class="sd-paste-to-cb accent-violet-500 w-3 h-3" data-id="${p.envelopeId}">
                <span class="text-[9px] text-zinc-300 truncate">${p.name}</span>
                <span class="text-[8px] text-zinc-600 ml-auto shrink-0">${p.points.length} pts</span>
            </label>
        `).join('');
        document.getElementById('sd-paste-to-all').checked = false;
        const btn = document.getElementById('sd-paste-to-btn');
        const rect = btn.getBoundingClientRect();
        pop.style.top = (rect.bottom + 4) + 'px';
        pop.style.left = rect.left + 'px';
        pop.classList.remove('hidden');
    };
    window.sdClosePasteTo = function() { document.getElementById('sd-paste-to-popover').classList.add('hidden'); };
    window.sdPasteToToggleAll = function(checked) { document.querySelectorAll('.sd-paste-to-cb').forEach(cb => cb.checked = checked); };
    window.sdPasteToSelected = function(invert) {
        const ids = [...document.querySelectorAll('.sd-paste-to-cb:checked')].map(cb => cb.dataset.id);
        if (!ids.length) return;
        pushUndo();
        const srcPoints = sdClipboardPoints;
        if (!srcPoints || !srcPoints.length) return;
        const sel = sdGetSelection(); const tS = sel ? sel.startBeat : 0;
        const cD = Math.max(...srcPoints.map(p => p.time)); const tD = sel ? (sel.endBeat - sel.startBeat) : cD; const sc = cD > 0 ? tD / cD : 1;
        ids.forEach(id => {
            const param = sdCanvasParams.find(p => p.envelopeId === id); if (!param) return;
            if (sel) param.points = param.points.filter(pt => pt.time < sel.startBeat || pt.time > sel.endBeat); else param.points = [];
            srcPoints.forEach(pt => { param.points.push({ time: Math.round((tS + pt.time * sc) * 10000) / 10000, value: invert ? 1 - pt.value : pt.value, curve: invert ? -(pt.curve || 0) : (pt.curve || 0) }); });
            param.points.sort((a, b) => a.time - b.time);
        });
        sdResetSliderSnapshots(); sdRenderSidebar(); sdDrawCanvasGrid();
        document.getElementById('sd-canvas-status').textContent = `Pasted${invert ? ' inv' : ''} to ${ids.length} lane${ids.length > 1 ? 's' : ''}`;
        sdClosePasteTo();
    };
    document.addEventListener('click', function(e) {
        const pop = document.getElementById('sd-paste-to-popover');
        if (!pop || pop.classList.contains('hidden')) return;
        if (!pop.contains(e.target) && e.target.id !== 'sd-paste-to-btn') sdClosePasteTo();
    });

    // Quantize, Swing, Smooth, Intensity
    window.sdQuantizeLane = function(gridSize) {
        if (!sdActiveParamId) return; pushUndo(); const sel = sdGetSelection();
        const totalBeats = sdGetBars() * 4;
        sdGetTargetParams().forEach(param => {
            if (!param.points.length) return;
            // Snap each point's time to nearest grid line, keep all points & values
            const pts = sel ? sdGetSelectedPoints(param) : param.points;
            pts.forEach(pt => {
                pt.time = Math.round(pt.time / gridSize) * gridSize;
                pt.time = Math.max(0, Math.min(totalBeats, pt.time));
                pt.time = Math.round(pt.time * 10000) / 10000;
            });
            // If multiple points land on same grid line, nudge them apart slightly
            param.points.sort((a, b) => a.time - b.time);
            for (let i = 1; i < param.points.length; i++) {
                if (Math.abs(param.points[i].time - param.points[i - 1].time) < 0.0001) {
                    param.points[i].time = Math.min(totalBeats, param.points[i].time + 0.001);
                }
            }
        });
        sdResetSliderSnapshots(); sdRenderSidebar(); sdDrawCanvasGrid();
    };
    window.sdApplySwing = function() {
        if (!sdActiveParamId) return; pushUndo(); const totalBeats = sdGetBars() * 4; const sw = 0.15;
        sdGetTargetParams().forEach(param => {
            if (!param.points.length) return;
            sdGetSelectedPoints(param).forEach(pt => {
                const m = ((pt.time % 1) + 1) % 1;
                if (Math.abs(m - 0.5) < 0.05) pt.time = Math.min(totalBeats, pt.time + sw * 0.5);
                else if (Math.abs(m - 0.25) < 0.05 || Math.abs(m - 0.75) < 0.05) pt.time = Math.min(totalBeats, pt.time + sw * 0.25);
                pt.time = Math.round(pt.time * 10000) / 10000;
            });
        });
        sdResetSliderSnapshots(); sdRenderSidebar(); sdDrawCanvasGrid();
    };
    window.sdApplySmooth = function(val) {
        document.getElementById('sd-smooth-val').textContent = val + '%';
        if (!sdActiveParamId) return;
        const targets = sdApplyAllMode ? sdCanvasParams.filter(p => p.points.length >= 3) : [];
        if (!sdApplyAllMode) {
            const param = sdCanvasParams.find(p => p.envelopeId === sdActiveParamId);
            if (!param || param.points.length < 3) return;
            targets.push(param);
        }
        if (!targets.length) return;
        const sel = sdGetSelection();
        const snapshotKey = targets.map(p => p.envelopeId).join(',');
        if (_sdSmoothParamId !== snapshotKey || !_sdSmoothSnapshot) {
            _sdSmoothSnapshot = {};
            targets.forEach(p => { _sdSmoothSnapshot[p.envelopeId] = p.points.map(pt => ({ ...pt })); });
            _sdSmoothParamId = snapshotKey;
        }
        const intensity = parseInt(val) / 100;
        targets.forEach(p => {
            const snap = _sdSmoothSnapshot[p.envelopeId];
            if (!snap || snap.length < 3) return;
            if (intensity === 0) { p.points = snap.map(pt => ({ ...pt })); return; }
            let allPts = snap.map(pt => ({ ...pt })); let pts, outPts;
            if (sel) { pts = allPts.filter(pt => pt.time >= sel.startBeat && pt.time <= sel.endBeat); outPts = allPts.filter(pt => pt.time < sel.startBeat || pt.time > sel.endBeat); }
            else { pts = allPts; outPts = []; }
            pts.sort((a, b) => a.time - b.time);
            const passes = Math.round(intensity * 8);
            for (let i = 0; i < passes; i++) { pts = pts.map((pt, j) => { if (j === 0 || j === pts.length - 1) return { ...pt }; return { time: pt.time, value: pts[j - 1].value * 0.25 + pt.value * 0.5 + pts[j + 1].value * 0.25 }; }); }
            if (intensity > 0.4 && pts.length > 4) { const tf = (intensity - 0.4) / 0.6; const mp = Math.max(3, Math.round(pts.length * (1 - tf * 0.8))); while (pts.length > mp) { let md = Infinity, mi = -1; for (let i = 1; i < pts.length - 1; i++) { const t = (pts[i].time - pts[i - 1].time) / (pts[i + 1].time - pts[i - 1].time); const interp = pts[i - 1].value + t * (pts[i + 1].value - pts[i - 1].value); const d = Math.abs(pts[i].value - interp); if (d < md) { md = d; mi = i; } } if (mi === -1) break; pts.splice(mi, 1); } }
            p.points = outPts.concat(pts).sort((a, b) => a.time - b.time);
        });
        sdRenderSidebar(); sdDrawCanvasGrid();
    };
    window.sdApplyIntensity = function(val) {
        document.getElementById('sd-intensity-val').textContent = val + '%';
        if (!sdActiveParamId) return;
        const targets = sdApplyAllMode ? sdCanvasParams.filter(p => p.points.length > 0) : [];
        if (!sdApplyAllMode) {
            const param = sdCanvasParams.find(p => p.envelopeId === sdActiveParamId);
            if (!param) return;
            targets.push(param);
        }
        if (!targets.length) return;
        const sel = sdGetSelection();
        const snapshotKey = targets.map(p => p.envelopeId).join(',');
        if (_sdIntensityParamId !== snapshotKey || !_sdIntensitySnapshot) {
            _sdIntensitySnapshot = {};
            targets.forEach(p => { _sdIntensitySnapshot[p.envelopeId] = p.points.map(pt => ({ ...pt })); });
            _sdIntensityParamId = snapshotKey;
        }
        const factor = parseInt(val) / 100;
        targets.forEach(p => {
            const snap = _sdIntensitySnapshot[p.envelopeId];
            if (!snap) return;
            p.points = snap.map(pt => { const inR = !sel || (pt.time >= sel.startBeat && pt.time <= sel.endBeat); return { time: pt.time, value: inR ? Math.max(0, Math.min(1, 0.5 + (pt.value - 0.5) * factor)) : pt.value }; });
        });
        sdRenderSidebar(); sdDrawCanvasGrid();
    };
    let _sdCurveSnapshot = null;
    let _sdCurveParamId = null;
    let _sdCurveSeed = null;

    window.sdApplyCurve = function(val) {
        document.getElementById('sd-curve-val').textContent = val + '%';
        const amount = parseInt(val) / 100; // 0 to 1

        const targets = sdApplyAllMode ? sdCanvasParams.filter(p => p.points.length >= 2) : [];
        if (!sdApplyAllMode) {
            if (!sdActiveParamId) return;
            const param = sdCanvasParams.find(p => p.envelopeId === sdActiveParamId);
            if (!param || param.points.length < 2) return;
            targets.push(param);
        }
        if (!targets.length) return;

        const sel = sdGetSelection();

        // Snapshot on first touch (per param set)
        const snapshotKey = targets.map(p => p.envelopeId).join(',');
        if (_sdCurveParamId !== snapshotKey || !_sdCurveSnapshot) {
            _sdCurveSnapshot = {};
            targets.forEach(p => {
                _sdCurveSnapshot[p.envelopeId] = p.points.map(pt => ({ ...pt }));
            });
            _sdCurveParamId = snapshotKey;
            // Generate stable random seeds per segment so dragging the slider
            // doesn't re-randomize — just scales the same random pattern
            _sdCurveSeed = {};
            targets.forEach(p => {
                const seeds = [];
                for (let i = 0; i < p.points.length; i++) {
                    // Random direction: -1 or +1, with random magnitude 0.3-1.0
                    const dir = Math.random() > 0.5 ? 1 : -1;
                    const mag = 0.3 + Math.random() * 0.7;
                    seeds.push(dir * mag);
                }
                _sdCurveSeed[p.envelopeId] = seeds;
            });
        }

        if (amount === 0) {
            // Restore original curves
            targets.forEach(p => {
                if (_sdCurveSnapshot[p.envelopeId]) {
                    p.points = _sdCurveSnapshot[p.envelopeId].map(pt => ({ ...pt }));
                }
            });
            sdDrawCanvasGrid();
            return;
        }

        targets.forEach(p => {
            const original = _sdCurveSnapshot[p.envelopeId];
            const seeds = _sdCurveSeed[p.envelopeId];
            if (!original || !seeds) return;

            p.points = original.map((pt, i) => {
                // Only apply to points within selection (if any)
                const inRange = !sel || (pt.time >= sel.startBeat && pt.time <= sel.endBeat);
                if (!inRange || i >= original.length - 1) {
                    return { ...pt };
                }
                // Scale the stable random seed by the slider amount
                const curveVal = seeds[i] * amount;
                return { time: pt.time, value: pt.value, curve: Math.max(-1, Math.min(1, curveVal)) };
            });
        });

        sdRenderSidebar();
        sdDrawCanvasGrid();
    };

    // ─── FLOOR / CEILING ────────────────────────────────────
    let _sdFloorCeilSnapshot = null;
    let _sdFloorCeilKey = null;

    function _getFloorCeilTargets() {
        const targets = sdCanvasParams.filter(p => p.points.length > 0);
        return targets;
    }

    function _ensureFloorCeilSnapshot() {
        const targets = _getFloorCeilTargets();
        if (!targets.length) return null;
        const key = targets.map(p => p.envelopeId).join(',');
        if (_sdFloorCeilKey !== key || !_sdFloorCeilSnapshot) {
            _sdFloorCeilSnapshot = {};
            targets.forEach(p => {
                _sdFloorCeilSnapshot[p.envelopeId] = p.points.map(pt => ({ ...pt }));
            });
            _sdFloorCeilKey = key;
        }
        return targets;
    }

    function _applyFloorCeil() {
        const targets = _ensureFloorCeilSnapshot();
        if (!targets) return;
        const floor = parseInt(document.getElementById('sd-floor-slider').value) / 100;
        const ceil = parseInt(document.getElementById('sd-ceil-slider').value) / 100;
        const range = Math.max(0.001, ceil - floor);
        targets.forEach(p => {
            const snap = _sdFloorCeilSnapshot[p.envelopeId];
            if (!snap) return;
            p.points = snap.map(pt => ({
                time: pt.time,
                value: Math.max(0, Math.min(1, floor + pt.value * range)),
                curve: pt.curve || 0
            }));
        });
        sdRenderSidebar(); sdDrawCanvasGrid();
    }

    window.sdApplyFloor = function(val) {
        document.getElementById('sd-floor-val').textContent = val + '%';
        if (!_sdFloorCeilSnapshot) pushUndo();
        // Clamp ceiling above floor
        const ceilSlider = document.getElementById('sd-ceil-slider');
        if (parseInt(val) > parseInt(ceilSlider.value)) {
            ceilSlider.value = val;
            document.getElementById('sd-ceil-val').textContent = val + '%';
        }
        _applyFloorCeil();
    };

    window.sdApplyCeiling = function(val) {
        document.getElementById('sd-ceil-val').textContent = val + '%';
        if (!_sdFloorCeilSnapshot) pushUndo();
        // Clamp floor below ceiling
        const floorSlider = document.getElementById('sd-floor-slider');
        if (parseInt(val) < parseInt(floorSlider.value)) {
            floorSlider.value = val;
            document.getElementById('sd-floor-val').textContent = val + '%';
        }
        _applyFloorCeil();
    };

    function sdResetSliderSnapshots() {
        _sdSmoothSnapshot = null; _sdSmoothParamId = null;
        _sdIntensitySnapshot = null; _sdIntensityParamId = null;
        _sdCurveSnapshot = null; _sdCurveParamId = null; _sdCurveSeed = null;
        _sdFloorCeilSnapshot = null; _sdFloorCeilKey = null;
        const ss = document.getElementById('sd-smooth-slider'), is2 = document.getElementById('sd-intensity-slider'), cs = document.getElementById('sd-curve-slider');
        if (ss) { ss.value = 0; document.getElementById('sd-smooth-val').textContent = '0%'; }
        if (is2) { is2.value = 100; document.getElementById('sd-intensity-val').textContent = '100%'; }
        if (cs) { cs.value = 0; document.getElementById('sd-curve-val').textContent = '0%'; }
        const fs2 = document.getElementById('sd-floor-slider'), cls = document.getElementById('sd-ceil-slider');
        if (fs2) { fs2.value = 0; document.getElementById('sd-floor-val').textContent = '0%'; }
        if (cls) { cls.value = 100; document.getElementById('sd-ceil-val').textContent = '100%'; }
    }

    // ─── TIME STRETCH ────────────────────────────────────────
    window.sdTimeStretch = function(factor) {
        if (!sdActiveParamId) return;
        pushUndo();
        const totalBeats = sdGetBars() * 4;
        const sel = sdGetSelection();
        sdGetTargetParams().forEach(param => {
            if (!param.points.length) return;
            if (sel) {
                // Stretch only within selection
                const sB = sel.startBeat, eB = sel.endBeat;
                const dur = eB - sB;
                const inside = param.points.filter(pt => pt.time >= sB && pt.time <= eB);
                const outside = param.points.filter(pt => pt.time < sB || pt.time > eB);
                inside.forEach(pt => {
                    const rel = (pt.time - sB) / dur;
                    pt.time = Math.round((sB + rel * dur * factor) * 10000) / 10000;
                });
                // Tile compressed data to fill selection
                if (factor < 1) {
                    const segLen = dur * factor;
                    const compressed = inside.map(pt => ({ time: pt.time, value: pt.value, curve: pt.curve || 0 }));
                    const tiles = Math.ceil(1 / factor);
                    for (let t = 1; t < tiles; t++) {
                        compressed.forEach(pt => {
                            const newTime = Math.round((pt.time + segLen * t) * 10000) / 10000;
                            if (newTime <= eB) inside.push({ time: newTime, value: pt.value, curve: pt.curve || 0 });
                        });
                    }
                }
                param.points = outside.concat(inside.filter(pt => pt.time >= 0 && pt.time <= totalBeats));
            } else {
                // Stretch entire lane
                param.points.forEach(pt => {
                    pt.time = Math.round((pt.time * factor) * 10000) / 10000;
                });
                // Tile compressed data to fill clip
                if (factor < 1) {
                    const segLen = totalBeats * factor;
                    const compressed = param.points.map(pt => ({ time: pt.time, value: pt.value, curve: pt.curve || 0 }));
                    const tiles = Math.ceil(1 / factor);
                    for (let t = 1; t < tiles; t++) {
                        compressed.forEach(pt => {
                            const newTime = Math.round((pt.time + segLen * t) * 10000) / 10000;
                            if (newTime <= totalBeats) param.points.push({ time: newTime, value: pt.value, curve: pt.curve || 0 });
                        });
                    }
                }
                param.points = param.points.filter(pt => pt.time >= 0 && pt.time <= totalBeats);
            }
            param.points.sort((a, b) => a.time - b.time);
        });
        sdResetSliderSnapshots(); sdRenderSidebar(); sdDrawCanvasGrid();
    };
    window.sdClearCurrentCanvas = function() {
        const sel = sdGetSelection();
        const targets = sdApplyAllMode
            ? sdCanvasParams
            : (sdActiveParamId ? [sdCanvasParams.find(p => p.envelopeId === sdActiveParamId)].filter(Boolean) : []);
        if (!targets.length) return;
        pushUndo();
        targets.forEach(param => {
            if (sel) param.points = param.points.filter(pt => pt.time < sel.startBeat || pt.time > sel.endBeat);
            else param.points = [];
        });
        sdResetSliderSnapshots(); sdRenderSidebar(); sdDrawCanvasGrid();
    };
    window.sdToggleApplyAll = function() {
        sdApplyAllMode = !sdApplyAllMode;
        const btn = document.getElementById('sd-apply-all-toggle');
        btn.className = sdApplyAllMode
            ? "text-[9px] text-fuchsia-300 bg-fuchsia-500/20 border border-fuchsia-500/40 hover:bg-fuchsia-500/30 px-2 py-1 rounded uppercase font-bold transition-colors shrink-0 ml-auto shadow-[0_0_8px_rgba(217,70,239,0.2)]"
            : "text-[9px] text-zinc-500 bg-black/50 border border-white/5 hover:border-fuchsia-500/30 px-2 py-1 rounded uppercase font-bold transition-colors shrink-0 ml-auto";
    };

    // ─── VIEW MODE TOGGLE (focus ↔ multi) ─────────────────
    // Flips the canvas between single-lane focus and the stacked multi-lane
    // "god view" where every param gets its own row. Does not touch data —
    // just changes how lanes are drawn and how clicks are routed. Scroll
    // offset resets on toggle so the user always sees the active lane.
    window.sdToggleViewMode = function() {
        sdViewMode = sdViewMode === 'multi' ? 'focus' : 'multi';
        // Reset time pan so multi view starts cleanly — the focus pan math
        // uses full-width whereas multi uses width - label column, so reusing
        // the old pan value can make curves look off-screen at the boundary.
        sdViewPanX = 0;
        // Scroll so the active lane is visible (top of the visible window)
        if (sdViewMode === 'multi' && sdActiveParamId) {
            const idx = sdCanvasParams.findIndex(p => p.envelopeId === sdActiveParamId);
            if (idx >= 0) {
                const visible = sdMultiVisibleLaneCount();
                if (idx < sdMultiScrollOffset || idx >= sdMultiScrollOffset + visible) {
                    sdMultiScrollOffset = Math.max(0, idx - Math.floor(visible / 2));
                }
            }
        }
        sdMultiClampScroll();
        // Update the button appearance
        const btn = document.getElementById('sd-view-mode-toggle');
        if (btn) {
            if (sdViewMode === 'multi') {
                btn.classList.add('bg-fuchsia-500/20', 'border-fuchsia-500/50', 'text-fuchsia-300');
                btn.classList.remove('text-zinc-500', 'border-white/10');
                btn.title = 'Currently in Multi-Lane view — click to return to Focus view';
            } else {
                btn.classList.remove('bg-fuchsia-500/20', 'border-fuchsia-500/50', 'text-fuchsia-300');
                btn.classList.add('text-zinc-500', 'border-white/10');
                btn.title = 'Click to switch to Multi-Lane view — see every parameter at once';
            }
        }
        sdDrawCanvasGrid();
    };

    // ─── TEMPLATES ─────────────────────────────────────────

    function _sdGenTemplatePts(type, sB, eB) {
        const dur = eB - sB; const pts = [];
        if (type === 'sine') { for (let b = 0; b <= dur; b += 0.25) pts.push({ time: sB + b, value: (Math.sin((b / dur) * Math.PI * 2 * Math.max(1, Math.round(dur / 4))) + 1) / 2 }); }
        else if (type === 'pump') { for (let b = 0; b < dur; b++) { pts.push({ time: sB + b, value: 0 }); pts.push({ time: sB + b + 0.5, value: 1 }); pts.push({ time: sB + b + 0.99, value: 0 }); } }
        else if (type === 'glitch') { for (let b = 0; b < dur; b += 0.25) { if (Math.random() > 0.4) { const v = Math.random() > 0.5 ? 1 : 0; pts.push({ time: sB + b, value: v }); pts.push({ time: sB + b + 0.125, value: v }); } } pts.push({ time: eB, value: 0 }); }
        else if (type === 'groove_build') {
            // Sparse → building density → drop → resolve high. Every press re-rolls
            // the specifics (zone boundaries, hit positions, heights, resolve level)
            // so you get a different build each time but the same overall shape.
            const zone1End = dur * (0.42 + Math.random() * 0.12);        // ~42-54%
            const zone2End = dur * (0.68 + Math.random() * 0.10);        // ~68-78%
            const settleT  = dur * (0.86 + Math.random() * 0.08);        // ~86-94%
            // Zone 1: 2-3 sparse accents scattered in the first half
            const numSparse = 2 + Math.floor(Math.random() * 2);
            for (let i = 0; i < numSparse; i++) {
                const t = Math.random() * zone1End;
                const h = 0.6 + Math.random() * 0.4;
                pts.push({ time: sB + t, value: 0 });
                pts.push({ time: sB + t + 0.05, value: h });
                pts.push({ time: sB + t + 0.25, value: 0 });
            }
            // Zone 2: rising density — probability of a hit grows with progress
            for (let b = zone1End; b < zone2End; b += 0.25) {
                const progress = (b - zone1End) / (zone2End - zone1End);
                if (Math.random() < 0.4 + progress * 0.5) {
                    const h = 0.7 + Math.random() * 0.3;
                    pts.push({ time: sB + b, value: 0 });
                    pts.push({ time: sB + b + 0.05, value: h });
                    pts.push({ time: sB + b + 0.18, value: 0 });
                }
            }
            // Drop + resolve: flat silence then a held note at a random high value
            pts.push({ time: sB + zone2End, value: 0 });
            pts.push({ time: sB + settleT, value: 0 });
            pts.push({ time: eB, value: 0.7 + Math.random() * 0.3 });
        }
        else if (type === 'chaos_lfo') {
            // Fully re-rollable chaos: 2-4 random wave layers (freq + amp + phase
            // randomized per press) + variable noise level + random spike injection.
            // Every press produces a genuinely different shape, not just a "noisier
            // version of the same curve."
            const numLayers = 2 + Math.floor(Math.random() * 3);    // 2-4 layers
            const waves = [];
            for (let i = 0; i < numLayers; i++) {
                waves.push({
                    freq:   0.3 + Math.random() * 2.2,               // 0.3-2.5
                    amp:    0.15 + Math.random() * 0.35,             // 0.15-0.5
                    phase:  Math.random() * Math.PI * 2,
                    useCos: Math.random() > 0.5
                });
            }
            const noiseAmt  = 0.1 + Math.random() * 0.25;            // 0.1-0.35
            const spikeProb = 0.08 + Math.random() * 0.15;           // 8-23% per sample
            const raw = [];
            for (let b = 0; b <= dur; b += 0.25) {
                let v = 0.5;
                for (const w of waves) {
                    v += (w.useCos ? Math.cos(b * w.freq + w.phase) : Math.sin(b * w.freq + w.phase)) * w.amp;
                }
                if (Math.random() < spikeProb) {
                    v = Math.random();                                // full random jump
                } else {
                    v += (Math.random() * 2 - 1) * noiseAmt;
                }
                raw.push({ time: sB + b, value: v });
            }
            const rMin = Math.min(...raw.map(p => p.value));
            const rMax = Math.max(...raw.map(p => p.value));
            const rRange = rMax - rMin || 1;
            raw.forEach(p => pts.push({ time: p.time, value: Math.max(0, Math.min(1, (p.value - rMin) / rRange)) }));
        }
        return pts;
    }
    window.sdApplyTemplate = function(type) {
        if (!sdActiveParamId) return;
        pushUndo();
        const sel = sdGetSelection(); const allBeats = sdGetBars() * 4;
        const sB = sel ? sel.startBeat : 0; const eB = sel ? sel.endBeat : allBeats;
        sdGetTargetParams().forEach(param => {
            if (sel) param.points = param.points.filter(pt => pt.time < sB || pt.time > eB); else param.points = [];
            param.points = param.points.concat(_sdGenTemplatePts(type, sB, eB)).sort((a, b) => a.time - b.time);
        });
        sdResetSliderSnapshots(); sdRenderSidebar(); sdDrawCanvasGrid();
    };
    window.sdApplyComplexTemplate = function(type) {
        if (!sdActiveParamId) return;
        pushUndo();
        const sel = sdGetSelection(); const allBeats = sdGetBars() * 4;
        const sB = sel ? sel.startBeat : 0; const eB = sel ? sel.endBeat : allBeats;
        const selBars = Math.max(1, Math.round((eB - sB) / 4));
        sdGetTargetParams().forEach(param => {
            if (sel) param.points = param.points.filter(pt => pt.time < sB || pt.time > eB); else param.points = [];
            if (type === 'neuro') { for (let bar = 0; bar < selBars; bar++) { let start = sB + bar * 4; if (start + 4 > eB) break; sdInjectShape(param, 'syncopated_drops', start, 2); sdInjectShape(param, 'hyper_stutter', start + 2, 1); sdInjectShape(param, 'exponential_build', start + 3, 1); } }
        });
        sdResetSliderSnapshots(); sdRenderSidebar(); sdDrawCanvasGrid();
    };

    // ─── MUTATE ──────────────────────────────────────────────
    // Takes existing curves and produces dramatic variations:
    // cuts segments, relocates them, flips sections, scales amplitude

    // Shared helper: pops a warning modal when Bloom / Weave / Mutate is
    // invoked before the user has drawn any curves to transform.
    window.sdShowRequirement = function(title, msg) {
        const titleEl = document.getElementById('sd-req-title');
        const msgEl = document.getElementById('sd-req-msg');
        if (titleEl) titleEl.textContent = title;
        if (msgEl) msgEl.textContent = msg;
        const modal = document.getElementById('sd-requirement-modal');
        if (modal) modal.classList.remove('hidden');
    };

    window.sdMutate = function() {
        const targets = sdGetTargetParams().filter(p => p.points.length >= 2);
        if (!targets.length) {
            sdShowRequirement(
                'Draw a curve first',
                'Mutate generates dramatic variations of existing curves. Draw a curve on the active lane (or turn on All Lanes to target every lane), then press Mutate again.'
            );
            return;
        }
        pushUndo();

        const sel = sdGetSelection();
        const totalBeats = sdGetBars() * 4;

        targets.forEach(param => {
            const sB = sel ? sel.startBeat : 0;
            const eB = sel ? sel.endBeat : totalBeats;
            const dur = eB - sB;

            // Separate points inside/outside selection
            let pts = param.points.filter(pt => pt.time >= sB && pt.time <= eB);
            const outside = param.points.filter(pt => pt.time < sB || pt.time > eB);

            if (pts.length < 2) return;

            // Normalize to 0-1 time range for manipulation
            let norm = pts.map(pt => ({
                t: (pt.time - sB) / dur,
                v: pt.value,
                curve: pt.curve || 0
            }));

            // ── 1. Segment shuffle: cut into 3-6 chunks, rearrange ──
            const numChunks = 3 + Math.floor(Math.random() * 4);
            const chunkSize = 1.0 / numChunks;
            let chunks = [];
            for (let i = 0; i < numChunks; i++) {
                const cStart = i * chunkSize;
                const cEnd = (i + 1) * chunkSize;
                const chunkPts = norm.filter(p => p.t >= cStart && p.t < cEnd);
                chunks.push(chunkPts.map(p => ({
                    t: (p.t - cStart) / chunkSize, // normalize within chunk
                    v: p.v,
                    curve: p.curve
                })));
            }

            // Shuffle chunks (Fisher-Yates)
            for (let i = chunks.length - 1; i > 0; i--) {
                const j = Math.floor(Math.random() * (i + 1));
                const tmp = chunks[i]; chunks[i] = chunks[j]; chunks[j] = tmp;
            }

            // ── 2. Per-chunk mutations ──
            chunks = chunks.map(chunk => {
                if (chunk.length < 2) return chunk;

                // Random flip (reverse time) — 40% chance
                if (Math.random() < 0.4) {
                    chunk = chunk.map(p => ({ t: 1 - p.t, v: p.v, curve: p.curve ? -p.curve : 0 }));
                    chunk.sort((a, b) => a.t - b.t);
                }

                // Random mirror (invert values) — 30% chance
                if (Math.random() < 0.3) {
                    chunk = chunk.map(p => ({ t: p.t, v: 1 - p.v, curve: p.curve ? -p.curve : 0 }));
                }

                // Amplitude scale — shift whole chunk ±30-50%
                const ampShift = (Math.random() - 0.5) * 0.6;
                const ampScale = 0.6 + Math.random() * 0.8;
                chunk = chunk.map(p => ({
                    t: p.t,
                    v: Math.max(0, Math.min(1, (p.v - 0.5) * ampScale + 0.5 + ampShift)),
                    curve: p.curve
                }));

                // Time stretch/compress within chunk — ±20%
                const timeScale = 0.8 + Math.random() * 0.4;
                const timeOffset = (1 - timeScale) * Math.random();
                chunk = chunk.map(p => ({
                    t: Math.max(0, Math.min(1, p.t * timeScale + timeOffset)),
                    v: p.v,
                    curve: p.curve
                }));

                return chunk;
            });

            // ── 3. Reassemble into timeline ──
            let result = [];
            chunks.forEach((chunk, i) => {
                const cStart = i * chunkSize;
                chunk.forEach(p => {
                    result.push({
                        time: sB + (cStart + p.t * chunkSize) * dur,
                        value: p.v,
                        curve: p.curve
                    });
                });
            });

            // ── 4. Add random new points (10-20% of original count) ──
            const newCount = Math.max(1, Math.floor(pts.length * (0.1 + Math.random() * 0.1)));
            for (let i = 0; i < newCount; i++) {
                const t = sB + Math.random() * dur;
                // Sample nearby value for continuity
                const nearby = result.reduce((best, p) =>
                    Math.abs(p.time - t) < Math.abs(best.time - t) ? p : best, result[0]);
                const v = Math.max(0, Math.min(1, nearby.value + (Math.random() - 0.5) * 0.4));
                result.push({ time: t, value: v, curve: 0 });
            }

            // ── 5. Randomly remove some points (10-15%) for variation ──
            const removeCount = Math.floor(result.length * (0.1 + Math.random() * 0.05));
            for (let i = 0; i < removeCount && result.length > 3; i++) {
                const idx = 1 + Math.floor(Math.random() * (result.length - 2)); // keep first/last
                result.splice(idx, 1);
            }

            // Sort and clamp
            result.sort((a, b) => a.time - b.time);
            result = result.map(p => ({
                time: Math.round(Math.max(sB, Math.min(eB, p.time)) * 10000) / 10000,
                value: Math.max(0, Math.min(1, p.value)),
                curve: p.curve || 0
            }));

            param.points = outside.concat(result).sort((a, b) => a.time - b.time);
        });

        sdResetSliderSnapshots();
        sdRenderSidebar();
        sdDrawCanvasGrid();
        document.getElementById('sd-canvas-status').textContent = 'Mutated';
    };

    // ─── BLOOM ────────────────────────────────────────────────
    // Spread the active lane's curve across all other lanes with
    // deterministic, complementary variations.

    window.sdToggleBloom = function() {
        const pop = document.getElementById('sd-bloom-popover');
        pop.classList.toggle('hidden');
    };

    window.sdApplyBloom = function() {
        if (!sdActiveParamId) {
            sdShowRequirement(
                'Select a lane first',
                'Bloom needs an active lane to copy from. Click one of the lanes in the sidebar, draw a curve on it, then press Bloom.'
            );
            return;
        }
        const masterParam = sdCanvasParams.find(p => p.envelopeId === sdActiveParamId);
        if (!masterParam || !masterParam.points.length) {
            sdShowRequirement(
                'Draw a curve first',
                'Bloom spreads the active lane\u2019s curve across all other lanes with complementary variations. Draw a curve on the active lane, then press Bloom again.'
            );
            return;
        }
        if (sdCanvasParams.length < 2) {
            sdShowRequirement(
                'Need more lanes',
                'Bloom spreads a curve across multiple lanes. Your rack only has one mapped parameter \u2014 Bloom needs at least two lanes to work with.'
            );
            return;
        }

        pushUndo();
        const spread = parseInt(document.getElementById('sd-bloom-spread').value) / 100;
        const totalBeats = sdGetBars() * 4;

        // Normalize master curve to 0-1 time
        const masterPts = masterParam.points.map(pt => ({
            t: pt.time / totalBeats,
            v: pt.value,
            curve: pt.curve || 0
        }));

        // Transformation recipes — each lane gets a unique combo based on index
        // These are musically complementary, not random
        const transforms = [
            // [phaseShift, invertValue, amplitudeScale, amplitudeOffset, timeMirror]
            { phase: 0.125,  invert: false, ampScale: 0.85, ampOff: 0.08, mirror: false },  // subtle shift
            { phase: 0,      invert: true,  ampScale: 1.0,  ampOff: 0,    mirror: false },  // pure inverse
            { phase: 0.25,   invert: false, ampScale: 0.7,  ampOff: 0.15, mirror: false },  // offset + reduced
            { phase: 0,      invert: false, ampScale: 1.0,  ampOff: 0,    mirror: true  },  // reversed time
            { phase: 0.5,    invert: false, ampScale: 0.9,  ampOff: 0.05, mirror: false },  // half-phase
            { phase: 0.125,  invert: true,  ampScale: 0.8,  ampOff: 0.1,  mirror: false },  // shift + inverse
            { phase: 0.375,  invert: false, ampScale: 0.6,  ampOff: 0.2,  mirror: true  },  // reversed + phase
            { phase: 0,      invert: true,  ampScale: 0.75, ampOff: 0.12, mirror: true  },  // reverse + inverse
            { phase: 0.0625, invert: false, ampScale: 0.95, ampOff: 0.03, mirror: false },  // very subtle
            { phase: 0.1875, invert: true,  ampScale: 0.85, ampOff: 0.08, mirror: true  },  // complex
        ];

        let laneIdx = 0;
        sdCanvasParams.forEach(param => {
            if (param.envelopeId === sdActiveParamId) return; // skip master

            const tx = transforms[laneIdx % transforms.length];
            laneIdx++;

            // Start with a copy of master points
            let pts = masterPts.map(p => ({ t: p.t, v: p.v, curve: p.curve }));

            // Apply phase shift (scaled by spread)
            const phaseAmt = tx.phase * spread;
            if (phaseAmt > 0) {
                pts = pts.map(p => ({
                    t: (p.t + phaseAmt) % 1.0,
                    v: p.v,
                    curve: p.curve
                }));
                pts.sort((a, b) => a.t - b.t);
            }

            // Apply time mirror (scaled by spread — blend between original and mirrored)
            if (tx.mirror && spread > 0.2) {
                pts = pts.map(p => ({
                    t: 1.0 - p.t,
                    v: p.v,
                    curve: p.curve ? -p.curve : 0
                }));
                pts.sort((a, b) => a.t - b.t);
            }

            // Apply value inversion (blend toward inverted based on spread)
            if (tx.invert) {
                pts = pts.map(p => ({
                    t: p.t,
                    v: p.v + (1.0 - 2 * p.v) * spread,
                    curve: p.curve ? p.curve * (1 - 2 * spread) : 0
                }));
            }

            // Apply amplitude scale + offset (scaled by spread)
            const scale = 1.0 + (tx.ampScale - 1.0) * spread;
            const offset = tx.ampOff * spread;
            pts = pts.map(p => ({
                t: p.t,
                v: Math.max(0, Math.min(1, (p.v - 0.5) * scale + 0.5 + offset)),
                curve: p.curve
            }));

            // Convert back to beat time and assign
            param.points = pts.map(p => ({
                time: Math.round(p.t * totalBeats * 10000) / 10000,
                value: Math.max(0, Math.min(1, p.v)),
                curve: p.curve || 0
            }));
        });

        document.getElementById('sd-bloom-popover').classList.add('hidden');
        sdResetSliderSnapshots();
        sdRenderSidebar();
        sdDrawCanvasGrid();
        document.getElementById('sd-canvas-status').textContent =
            'Bloom applied — ' + (sdCanvasParams.length - 1) + ' lanes from ' + masterParam.name;
    };

    // ─── WEAVE ────────────────────────────────────────────────
    // Complementary automation: makes lanes work together instead of independently.
    // Chase = same shape, phase-shifted so peaks never overlap (traveling wave).
    // Fill = counterpoint — lanes move where the source is still, hold where it moves.

    window.sdToggleWeave = function() {
        const pop = document.getElementById('sd-weave-popover');
        pop.classList.toggle('hidden');
    };

    let _weaveMode = 'chase'; // 'chase' or 'fill'
    window.sdSetWeaveMode = function(mode) {
        _weaveMode = mode;
        document.getElementById('sd-weave-mode-chase').className = mode === 'chase'
            ? 'flex-1 text-[8px] text-cyan-400 bg-cyan-500/20 border border-cyan-500/40 py-1 rounded-lg uppercase tracking-widest font-bold'
            : 'flex-1 text-[8px] text-zinc-500 bg-transparent border border-white/10 hover:border-white/20 py-1 rounded-lg uppercase tracking-widest font-bold';
        document.getElementById('sd-weave-mode-fill').className = mode === 'fill'
            ? 'flex-1 text-[8px] text-cyan-400 bg-cyan-500/20 border border-cyan-500/40 py-1 rounded-lg uppercase tracking-widest font-bold'
            : 'flex-1 text-[8px] text-zinc-500 bg-transparent border border-white/10 hover:border-white/20 py-1 rounded-lg uppercase tracking-widest font-bold';
        document.getElementById('sd-weave-desc').textContent = mode === 'chase'
            ? 'Same shape, phase-shifted — peaks never overlap'
            : 'Counterpoint — lanes move where the source is still';
    };

    window.sdApplyWeave = function() {
        if (!sdActiveParamId) {
            sdShowRequirement(
                'Select a lane first',
                'Weave needs an active lane as the source. Click one of the lanes in the sidebar, draw a curve on it, then press Weave.'
            );
            return;
        }
        const sourceParam = sdCanvasParams.find(p => p.envelopeId === sdActiveParamId);
        if (!sourceParam || !sourceParam.points.length) {
            sdShowRequirement(
                'Draw a curve first',
                'Weave creates complementary automation across lanes based on a source curve. Draw a curve on the active lane, then press Weave again.'
            );
            return;
        }
        if (sdCanvasParams.length < 2) {
            sdShowRequirement(
                'Need more lanes',
                'Weave builds relationships between lanes. Your rack only has one mapped parameter \u2014 Weave needs at least two lanes to work with.'
            );
            return;
        }

        pushUndo();
        const spread = parseInt(document.getElementById('sd-weave-spread').value) / 100;
        const totalBeats = sdGetBars() * 4;

        if (_weaveMode === 'chase') {
            _weaveChase(sourceParam, spread, totalBeats);
        } else {
            _weaveFill(sourceParam, spread, totalBeats);
        }

        document.getElementById('sd-weave-popover').classList.add('hidden');
        sdResetSliderSnapshots();
        sdRenderSidebar();
        sdDrawCanvasGrid();
        document.getElementById('sd-canvas-status').textContent =
            'Weave ' + _weaveMode + ' applied — ' + (sdCanvasParams.length - 1) + ' lanes from ' + sourceParam.name;
    };

    function _weaveChase(sourceParam, spread, totalBeats) {
        // Normalize source to 0-1 time
        const srcPts = sourceParam.points.map(pt => ({
            t: pt.time / totalBeats,
            v: pt.value,
            curve: pt.curve || 0
        }));

        const targets = sdCanvasParams.filter(p => p.envelopeId !== sdActiveParamId);
        const n = targets.length;

        targets.forEach((param, i) => {
            // Even phase distribution: each lane offset by (i+1)/(n+1) * spread
            const phase = ((i + 1) / (n + 1)) * spread;

            // Shift all points in time, wrap at boundaries
            let pts = srcPts.map(p => ({
                t: (p.t + phase) % 1.0,
                v: p.v,
                curve: p.curve
            }));
            pts.sort((a, b) => a.t - b.t);

            // Subtle amplitude fade: further lanes slightly reduced
            const ampFade = 1.0 - (i / (n + 1)) * 0.15 * spread;
            pts = pts.map(p => ({
                t: p.t,
                v: Math.max(0, Math.min(1, (p.v - 0.5) * ampFade + 0.5)),
                curve: p.curve
            }));

            // Convert back to beat time
            param.points = pts.map(p => ({
                time: Math.round(p.t * totalBeats * 10000) / 10000,
                value: Math.max(0, Math.min(1, p.v)),
                curve: p.curve
            }));
        });
    }

    function _weaveFill(sourceParam, spread, totalBeats) {
        // Sample source curve to find active vs passive zones
        const resolution = 0.25; // quarter-beat intervals
        const sampleCount = Math.floor(totalBeats / resolution);
        const samples = [];

        // Interpolate source at each sample point
        const srcPts = sourceParam.points.slice().sort((a, b) => a.time - b.time);
        for (let s = 0; s < sampleCount; s++) {
            const time = s * resolution;
            let val = 0;
            if (srcPts.length === 0) { val = 0; }
            else if (time <= srcPts[0].time) { val = srcPts[0].value; }
            else if (time >= srcPts[srcPts.length - 1].time) { val = srcPts[srcPts.length - 1].value; }
            else {
                for (let j = 0; j < srcPts.length - 1; j++) {
                    if (time >= srcPts[j].time && time < srcPts[j + 1].time) {
                        const t = (time - srcPts[j].time) / (srcPts[j + 1].time - srcPts[j].time);
                        val = srcPts[j].value + t * (srcPts[j + 1].value - srcPts[j].value);
                        break;
                    }
                }
            }
            samples.push(val);
        }

        // Compute activity per interval (absolute derivative)
        const activity = [];
        for (let s = 0; s < sampleCount; s++) {
            const prev = s > 0 ? samples[s - 1] : samples[s];
            const next = s < sampleCount - 1 ? samples[s + 1] : samples[s];
            activity.push(Math.abs(next - prev));
        }

        // Find threshold: use median activity
        const sorted = activity.slice().sort((a, b) => a - b);
        const threshold = sorted[Math.floor(sorted.length * 0.5)];

        // Classify each interval: active (source moving) or passive (source still)
        const isPassive = activity.map(a => a <= threshold);

        const targets = sdCanvasParams.filter(p => p.envelopeId !== sdActiveParamId);
        const n = targets.length;

        // Shape pool for fill zones
        const fillShapes = [
            (t, seed) => 0.3 + 0.4 * Math.sin(t * Math.PI * (2 + seed)),           // sine sweep
            (t, seed) => 0.1 + 0.8 * t,                                              // ramp up
            (t, seed) => 0.9 - 0.8 * t,                                              // ramp down
            (t, seed) => t < 0.5 ? 0.2 + 1.2 * t : 1.0 - 0.8 * (t - 0.5) * 2,     // triangle
            (t, seed) => 0.5 + 0.4 * Math.cos(t * Math.PI * (1 + seed * 0.5)),      // cosine
        ];

        targets.forEach((param, laneIdx) => {
            const pts = [];
            let inFillZone = false;
            let fillStart = 0;
            const shapeFn = fillShapes[laneIdx % fillShapes.length];
            const seed = (laneIdx + 1) * 0.7;

            // Use spread to control how many passive zones get filled
            // At low spread, only the longest passive zones. At high spread, all of them.
            const passiveRuns = [];
            let runStart = -1;
            for (let s = 0; s <= sampleCount; s++) {
                if (s < sampleCount && isPassive[s]) {
                    if (runStart < 0) runStart = s;
                } else {
                    if (runStart >= 0) {
                        passiveRuns.push({ start: runStart, end: s, len: s - runStart });
                        runStart = -1;
                    }
                }
            }
            // Sort by length descending, pick top N based on spread
            passiveRuns.sort((a, b) => b.len - a.len);
            const fillCount = Math.max(1, Math.round(passiveRuns.length * spread));
            const fillZones = new Set();
            for (let r = 0; r < fillCount && r < passiveRuns.length; r++) {
                for (let s = passiveRuns[r].start; s < passiveRuns[r].end; s++) {
                    fillZones.add(s);
                }
            }

            // Generate points: hold in active zones, move in fill zones
            const holdValue = 0.3 + (laneIdx % 5) * 0.1; // different hold per lane
            let lastWasFill = false;

            for (let s = 0; s < sampleCount; s++) {
                const time = s * resolution;
                const isFill = fillZones.has(s);

                if (isFill) {
                    if (!lastWasFill) {
                        // Entering fill zone — find zone boundaries for normalization
                        fillStart = s;
                    }
                    // Find this zone's end
                    let fillEnd = s + 1;
                    while (fillEnd < sampleCount && fillZones.has(fillEnd)) fillEnd++;
                    const zoneLen = fillEnd - fillStart;
                    const t = zoneLen > 0 ? (s - fillStart) / zoneLen : 0;
                    const val = shapeFn(t, seed);

                    // Only add a point every other sample to keep it cleaner
                    if (s === fillStart || s === fillEnd - 1 || s % 2 === 0) {
                        pts.push({
                            time: Math.round(time * 10000) / 10000,
                            value: Math.max(0, Math.min(1, val)),
                            curve: 0
                        });
                    }
                } else {
                    // Active zone — hold steady (add point at zone boundary only)
                    if (lastWasFill || s === 0) {
                        pts.push({
                            time: Math.round(time * 10000) / 10000,
                            value: holdValue,
                            curve: 0
                        });
                    }
                }
                lastWasFill = isFill;
            }

            // Ensure last point exists
            if (pts.length > 0 && pts[pts.length - 1].time < totalBeats - resolution) {
                pts.push({ time: Math.round((totalBeats - 0.001) * 10000) / 10000, value: holdValue, curve: 0 });
            }

            param.points = pts;
        });
    }

    // ─── PRESET ENGINE ─────────────────────────────────────
    // Generates complementary automation curves for N lanes from preset configs.
    // Each preset defines root shapes + derivation rules. Rack-agnostic.

    // --- Shape Generators ---
    // All return [{time, value, curve}] for the given beat range

    function _shapeEvolve(beats, barShapes) {
        // Different shape per bar. barShapes = array of functions(beatInBar, barBeats) => value
        const pts = [];
        const barBeats = beats / barShapes.length;
        for (let bar = 0; bar < barShapes.length; bar++) {
            const fn = barShapes[bar % barShapes.length];
            for (let b = 0; b <= barBeats; b += 0.25) {
                const t = bar * barBeats + b;
                if (t > beats) break;
                pts.push({ time: Math.round(t * 1000) / 1000, value: Math.max(0, Math.min(1, fn(b, barBeats))), curve: 0 });
            }
        }
        return pts;
    }

    function _shapePulse(beats, rate, decayCurve) {
        // Pump shape. rate = beats per cycle. decayCurve: 'linear'|'exp'|'convex'|'concave'
        const pts = [];
        for (let t = 0; t < beats; t += rate) {
            pts.push({ time: t, value: 0, curve: 0 });
            pts.push({ time: t + 0.01, value: 1, curve: 0 });
            const end = Math.min(t + rate - 0.01, beats);
            if (decayCurve === 'exp') {
                for (let s = 0.25; s < rate - 0.1; s += 0.25) {
                    if (t + s > beats) break;
                    pts.push({ time: t + s, value: Math.exp(-3 * s / rate), curve: 0 });
                }
            }
            pts.push({ time: end, value: 0, curve: 0 });
        }
        return pts;
    }

    function _shapeSweep(beats, from, to, curvature) {
        const pts = [];
        for (let t = 0; t <= beats; t += beats / 16) {
            const n = t / beats;
            let v;
            if (curvature === 'exp') v = from + (to - from) * (n * n * n);
            else if (curvature === 'log') v = from + (to - from) * Math.sqrt(n);
            else if (curvature === 's') v = from + (to - from) * (n < 0.5 ? 2 * n * n : 1 - 2 * (1 - n) * (1 - n));
            else v = from + (to - from) * n;
            pts.push({ time: Math.round(t * 1000) / 1000, value: Math.max(0, Math.min(1, v)), curve: 0 });
        }
        return pts;
    }

    function _shapeBounce(beats, bounces, startHeight) {
        const pts = [{ time: 0, value: 0, curve: 0 }];
        let t = 0;
        for (let i = 0; i < bounces; i++) {
            const h = startHeight * Math.pow(0.55, i);
            const dur = (beats / bounces) * Math.pow(0.7, i);
            if (h < 0.02 || t >= beats) break;
            pts.push({ time: t + 0.01, value: 0, curve: 0 });
            pts.push({ time: t + dur * 0.5, value: h, curve: 0 });
            t += dur;
            pts.push({ time: Math.min(t, beats), value: 0, curve: 0 });
        }
        return pts;
    }

    function _shapeGate(beats, pattern, gateHeight) {
        // pattern = array of 0/1 per step. Generates gate shapes.
        const pts = [];
        const stepLen = beats / pattern.length;
        for (let i = 0; i < pattern.length; i++) {
            const t = i * stepLen;
            if (pattern[i]) {
                pts.push({ time: t, value: 0, curve: 0 });
                pts.push({ time: t + 0.01, value: gateHeight || 1, curve: 0 });
                pts.push({ time: t + stepLen * 0.8, value: gateHeight || 1, curve: 0 });
                pts.push({ time: t + stepLen * 0.81, value: 0, curve: 0 });
            }
        }
        if (pts.length === 0) pts.push({ time: 0, value: 0, curve: 0 });
        return pts;
    }

    function _shapeDampedSpring(beats, frequency, damping) {
        const pts = [];
        for (let t = 0; t <= beats; t += 0.25) {
            const env = Math.exp(-damping * t / beats);
            const osc = Math.sin(2 * Math.PI * frequency * t / beats);
            pts.push({ time: t, value: Math.max(0, Math.min(1, 0.5 + 0.5 * osc * env)), curve: 0 });
        }
        return pts;
    }

    function _shapeStutter(beats, density) {
        // Rapid staccato bursts. density 0-1 controls how many bursts
        const pts = [];
        const step = Math.max(0.125, 0.5 * (1 - density));
        for (let t = 0; t < beats; t += step) {
            if (Math.random() < density) {
                pts.push({ time: t, value: 0, curve: 0 });
                pts.push({ time: t + 0.01, value: 0.7 + Math.random() * 0.3, curve: 0 });
                pts.push({ time: t + step * 0.3, value: 0, curve: 0 });
            }
        }
        if (pts.length === 0) pts.push({ time: 0, value: 0, curve: 0 });
        return pts;
    }

    // Chop envelope character system.
    //
    // Each character is a 5-point shape [tFrac, absoluteValue, curve] where
    // tFrac is a fraction of the allotted length (0..1) and value is the
    // absolute height (NOT scaled by a peak argument). The character alone
    // dictates dynamic range AND envelope shape, which gives us wide y-axis
    // variation (ghost 0.18 → punch 0.95) and distinct curve character per
    // hit type (sharp punches, sustained holds, soft swells, fast stabs).
    //
    // Preset code picks a character per hit position based on its musical
    // role (downbeat = punch, fill = ghost, accent = accent, etc.). Pass
    // `null` for a character to produce deliberate silence.
    const _CHOP_CHARS = {
        // Strong downbeat — sharp attack, quick drop to a tail, fades out fast.
        punch: [
            [0,     0,    0   ],
            [0.005, 0.95, -0.6],
            [0.18,  0.70, -0.5],
            [0.50,  0.25, -0.3],
            [1,     0,    0   ],
        ],
        // Secondary accent — same shape as punch but softer overall.
        accent: [
            [0,     0,    0   ],
            [0.005, 0.75, -0.5],
            [0.22,  0.55, -0.4],
            [0.58,  0.25, -0.3],
            [1,     0,    0   ],
        ],
        // Held note — plateau near peak, then gentler fall.
        sustain: [
            [0,     0,    0   ],
            [0.005, 0.65, -0.3],
            [0.35,  0.60, -0.3],
            [0.80,  0.35, -0.4],
            [1,     0,    0   ],
        ],
        // Soft pad-ish swell — slow attack (convex), broad body, gentle fall.
        swell: [
            [0,     0,     0.4],
            [0.22,  0.50,  0.1],
            [0.60,  0.50, -0.2],
            [0.88,  0.25, -0.3],
            [1,     0,    0   ],
        ],
        // Background fill — low, soft, linear decay.
        ghost: [
            [0,     0,    0 ],
            [0.02,  0.22, 0 ],
            [0.35,  0.18, 0 ],
            [0.65,  0.08, 0 ],
            [1,     0,    0 ],
        ],
        // Staccato punch — sharp peak, cuts off fast, rest of allotted length is silence.
        stab: [
            [0,     0,    0 ],
            [0.003, 0.85, 0 ],
            [0.09,  0.45, 0 ],
            [0.16,  0,    0 ],
            [1,     0,    0 ],
        ],
    };

    // Emit a chop envelope at time t with length len, using the named character.
    // Pass character=null to produce silence (skips all output, effectively a rest).
    function _chopEnv(addTo, t, len, character, clipEnd) {
        if (!character) return; // explicit rest
        const shape = _CHOP_CHARS[character] || _CHOP_CHARS.punch;
        const end = clipEnd != null ? Math.min(t + len, clipEnd) : t + len;
        if (end <= t + 0.001) return;
        const aLen = end - t;
        for (const [tFrac, value, curve] of shape) {
            addTo.push({ time: t + aLen * tFrac, value: value, curve: curve });
        }
    }

    function _shapeSine(beats, cycles, phase) {
        const pts = [];
        for (let t = 0; t <= beats; t += 0.25) {
            const v = 0.5 + 0.5 * Math.sin(2 * Math.PI * cycles * t / beats + (phase || 0));
            pts.push({ time: t, value: v, curve: 0 });
        }
        return pts;
    }

    function _shapeAccent(beats, positions, height) {
        // Sparse spikes at specific beat positions
        const pts = [{ time: 0, value: 0, curve: 0 }];
        (positions || []).forEach(pos => {
            if (pos >= beats) return;
            pts.push({ time: pos - 0.01, value: 0, curve: 0 });
            pts.push({ time: pos, value: height || 1, curve: 0 });
            pts.push({ time: pos + 0.5, value: height || 1, curve: 0 });
            pts.push({ time: pos + 0.51, value: 0, curve: 0 });
        });
        pts.push({ time: beats, value: 0, curve: 0 });
        return pts;
    }

    function _shapeChaosZones(beats, chaosRatio) {
        // Alternating chaos and calm. chaosRatio = fraction that's chaotic
        const pts = [];
        const barBeats = beats / 4;
        for (let bar = 0; bar < 4; bar++) {
            const isChaos = (bar % 2 === 0);
            for (let b = 0; b < barBeats; b += 0.125) {
                const t = bar * barBeats + b;
                if (isChaos) {
                    pts.push({ time: t, value: Math.random(), curve: 0 });
                } else {
                    pts.push({ time: t, value: 0.5, curve: 0 });
                }
            }
        }
        return pts;
    }

    // --- Derivation Functions ---

    function _derivePhaseCascade(srcPts, laneIdx, totalLanes, spread, beats) {
        const offset = ((laneIdx + 1) / (totalLanes + 1)) * spread * beats;
        return srcPts.map(pt => ({
            time: Math.round(((pt.time + offset) % beats) * 1000) / 1000,
            value: pt.value,
            curve: pt.curve || 0
        })).sort((a, b) => a.time - b.time);
    }

    function _deriveCounter(srcPts, intensity) {
        return srcPts.map(pt => ({
            time: pt.time,
            value: Math.max(0, Math.min(1, pt.value + (1 - 2 * pt.value) * intensity)),
            curve: pt.curve ? -pt.curve : 0
        }));
    }

    function _deriveEcho(srcPts, delayBeats, amplitude, beats) {
        return srcPts.map(pt => ({
            time: Math.round(((pt.time + delayBeats) % beats) * 1000) / 1000,
            value: Math.max(0, Math.min(1, (pt.value - 0.5) * amplitude + 0.5)),
            curve: pt.curve || 0
        })).sort((a, b) => a.time - b.time);
    }

    function _deriveMicro(srcPts, amplitude, laneIdx) {
        // Micro-variation: same shape at very low amplitude + slight random offset
        const seed = (laneIdx * 137 + 42) % 100 / 100;
        return srcPts.map(pt => ({
            time: pt.time,
            value: Math.max(0, Math.min(1, 0.5 + (pt.value - 0.5) * amplitude + (seed - 0.5) * 0.02)),
            curve: 0
        }));
    }

    function _deriveHarmonic(srcPts, rate, beats) {
        // Same shape at faster rate
        const pts = [];
        for (let r = 0; r < rate; r++) {
            srcPts.forEach(pt => {
                const t = (pt.time / rate) + (r * beats / rate);
                if (t <= beats) {
                    pts.push({ time: Math.round(t * 1000) / 1000, value: pt.value, curve: pt.curve || 0 });
                }
            });
        }
        return pts.sort((a, b) => a.time - b.time);
    }

    // Bloom-style derivation: same recipe table sdApplyBloom uses.
    // Per-lane unique combo of phase shift / mirror / invert / amp scale+offset.
    const _BLOOM_TX = [
        { phase: 0.125,  invert: false, ampScale: 0.85, ampOff: 0.08, mirror: false },
        { phase: 0,      invert: true,  ampScale: 1.0,  ampOff: 0,    mirror: false },
        { phase: 0.25,   invert: false, ampScale: 0.7,  ampOff: 0.15, mirror: false },
        { phase: 0,      invert: false, ampScale: 1.0,  ampOff: 0,    mirror: true  },
        { phase: 0.5,    invert: false, ampScale: 0.9,  ampOff: 0.05, mirror: false },
        { phase: 0.125,  invert: true,  ampScale: 0.8,  ampOff: 0.1,  mirror: false },
        { phase: 0.375,  invert: false, ampScale: 0.6,  ampOff: 0.2,  mirror: true  },
        { phase: 0,      invert: true,  ampScale: 0.75, ampOff: 0.12, mirror: true  },
        { phase: 0.0625, invert: false, ampScale: 0.95, ampOff: 0.03, mirror: false },
        { phase: 0.1875, invert: true,  ampScale: 0.85, ampOff: 0.08, mirror: true  },
    ];
    function _deriveBloom(srcPts, laneIdx, beats) {
        const cycle = Math.floor(laneIdx / _BLOOM_TX.length);
        const tx = _BLOOM_TX[laneIdx % _BLOOM_TX.length];
        const totalPhase = (tx.phase + cycle * 0.0625) % 1;
        let pts = srcPts.map(p => ({ t: p.time / beats, v: p.value, c: p.curve || 0 }));
        if (totalPhase > 0) {
            pts = pts.map(p => ({ t: (p.t + totalPhase) % 1, v: p.v, c: p.c }));
            pts.sort((a, b) => a.t - b.t);
        }
        if (tx.mirror) {
            pts = pts.map(p => ({ t: 1 - p.t, v: p.v, c: p.c ? -p.c : 0 }));
            pts.sort((a, b) => a.t - b.t);
        }
        if (tx.invert) {
            pts = pts.map(p => ({ t: p.t, v: 1 - p.v, c: p.c ? -p.c : 0 }));
        }
        return pts.map(p => ({
            time: Math.round(p.t * beats * 1000) / 1000,
            value: Math.max(0, Math.min(1, (p.v - 0.5) * tx.ampScale + 0.5 + tx.ampOff)),
            curve: p.c
        }));
    }

    // Multi-lane builder for Chop presets. First N lanes use rootPts as-is
    // (root[0] is the chop pattern, root[1..] are accent layers like sweeps/fills).
    // All other lanes derive from root[0] via Bloom transforms — the rhythm is
    // distributed across the rack with complementary variation per slot.
    function _buildChopLanes(laneCount, beats, rootPts) {
        const lanes = [];
        const rootCount = rootPts.length;
        for (let i = 0; i < laneCount; i++) {
            if (i < rootCount) {
                lanes.push(rootPts[i]);
            } else {
                const bloomIdx = i - rootCount;
                lanes.push(_deriveBloom(rootPts[0], bloomIdx, beats));
            }
        }
        return lanes;
    }

    // --- Preset Definitions ---

    const STRIDE_PRESETS = [
        // GROOVE & CHOP
        { id: 'slicer', name: 'Slicer', cat: 'Groove', gen: (n, b) => {
            const bpb = b / 4;
            const root = _shapeEvolve(b, [
                (t, d) => (Math.floor(t / (d/8)) % 2 === 0) ? 1 : 0,
                (t, d) => (Math.floor(t / (d/4)) % 3 === 0) ? 1 : 0,
                (t, d) => (Math.floor(t / (d/6)) % 2 === 0) ? 1 : 0,
                (t, d) => (Math.floor(t / (d/16)) % 2 === 0) ? 1 : 0
            ]);
            const sweep = _shapeSweep(b, 0.2, 0.8, 'linear');
            return _buildLanes(n, b, [root, sweep], [
                { fn: _deriveCounter, args: [0, 0.6] },
                { fn: _deriveEcho, args: [0, 1, 0.5] },
            ]);
        }},
        { id: 'bounce', name: 'Bounce', cat: 'Groove', gen: (n, b) => {
            const root = _shapeBounce(b / 2, 8, 1);
            const root2 = _shapeBounce(b / 2, 8, 1).map(pt => ({ ...pt, time: pt.time + b / 2 }));
            const combined = [...root, ...root2];
            return _buildLanes(n, b, [combined], [
                { fn: _deriveCounter, args: [0, 0.7] },
                { fn: _deriveEcho, args: [0, 0.5, 0.6] },
            ]);
        }},
        { id: 'pocket', name: 'Pocket', cat: 'Groove', gen: (n, b) => {
            // Fibonacci accents at beats 0, 1, 2, 3, 5, 8 (then repeat)
            const fib = [0, 1, 2, 3, 5, 8, 13, 16, 17, 18, 19, 21, 24];
            const accents = fib.filter(f => f < b);
            const root = _shapeAccent(b, accents, 1);
            return _buildLanes(n, b, [root], [
                { fn: _deriveEcho, args: [0, 0.75, 0.5] },
                { fn: _deriveCounter, args: [0, 0.5] },
            ]);
        }},
        { id: 'shaker', name: 'Shaker', cat: 'Groove', gen: (n, b) => {
            const root = _shapeEvolve(b, [
                (t, d) => (Math.floor(t / (d/4)) % 4 === 0) ? 1 : 0,
                (t, d) => (Math.floor(t / (d/4)) % 2 === 0) ? 1 : 0,
                (t, d) => (Math.floor(t / (d/8)) % 2 === 0) ? 1 : 0,
                (t, d) => (Math.floor(t / (d/16)) % 2 === 0) ? 1 : 0
            ]);
            const anchor = _shapePulse(b, b / 4, 'exp');
            return _buildLanes(n, b, [root, anchor], [
                { fn: _deriveCounter, args: [0, 0.5] },
            ]);
        }},
        { id: 'strut', name: 'Strut', cat: 'Groove', gen: (n, b) => {
            const bpb = b / 4;
            const pts = [];
            for (let bar = 0; bar < 4; bar++) {
                const offset = bar * 0.5; // walks forward by half-beat each bar
                const t = bar * bpb + offset;
                if (t < b) {
                    pts.push({ time: t, value: 0, curve: 0 });
                    pts.push({ time: t + 0.01, value: 1, curve: 0 });
                    pts.push({ time: t + 1, value: 0.3, curve: 0 });
                    pts.push({ time: t + 1.5, value: 0, curve: 0 });
                }
            }
            return _buildLanes(n, b, [pts], [
                { fn: _deriveEcho, args: [0, bpb, 0.4] },
                { fn: _deriveCounter, args: [0, 0.6] },
            ]);
        }},
        { id: 'ricochet', name: 'Ricochet', cat: 'Groove', gen: (n, b) => {
            const bpb = b / 4;
            const call = [];
            const resp = [];
            for (let bar = 0; bar < 4; bar++) {
                const t = bar * bpb;
                if (bar % 2 === 0) {
                    for (let s = 0; s < 3; s++) call.push({ time: t + s * 0.5, value: 0, curve: 0 }, { time: t + s * 0.5 + 0.01, value: 1, curve: 0 }, { time: t + s * 0.5 + 0.3, value: 0, curve: 0 });
                } else {
                    for (let s = 0; s <= bpb; s += bpb / 8) resp.push({ time: t + s, value: 0.5 + 0.5 * Math.sin(Math.PI * s / bpb), curve: 0 });
                }
            }
            return _buildLanes(n, b, [call.length ? call : [{ time: 0, value: 0, curve: 0 }], resp.length ? resp : [{ time: 0, value: 0, curve: 0 }]], [
                { fn: _deriveCounter, args: [0, 0.5] },
            ]);
        }},
        { id: 'wobble', name: 'Wobble', cat: 'Groove', gen: (n, b) => {
            // Variable rate sine: slow → fast → peak → decel
            const pts = [];
            for (let t = 0; t <= b; t += 0.125) {
                const n2 = t / b;
                const rate = 1 + 8 * Math.sin(Math.PI * n2); // peaks at middle
                const v = 0.5 + 0.5 * Math.sin(2 * Math.PI * rate * n2);
                pts.push({ time: t, value: v, curve: 0 });
            }
            return _buildLanes(n, b, [pts], [
                { fn: _deriveCounter, args: [0, 0.5] },
                { fn: _deriveEcho, args: [0, 0.25, 0.6] },
            ]);
        }},
        { id: 'stagger', name: 'Stagger', cat: 'Groove', gen: (n, b) => {
            const patterns = [[1,1,0,1,0,0,1,0], [0,1,1,0,1,0,0,1], [1,0,1,0,0,1,1,0], [0,1,0,1,1,0,1,1]];
            const root = _shapeEvolve(b, patterns.map(pat => (t, d) => {
                const step = Math.floor(t / (d / pat.length));
                return pat[step % pat.length] ? 0.7 + Math.random() * 0.3 : 0;
            }));
            return _buildLanes(n, b, [root], [
                { fn: _deriveCounter, args: [0, 0.4] },
                { fn: _deriveEcho, args: [0, 0.5, 0.5] },
            ]);
        }},
        { id: 'pendulum', name: 'Pendulum', cat: 'Groove', gen: (n, b) => {
            const root = _shapeDampedSpring(b, 4, 3);
            return _buildLanes(n, b, [root], [
                { fn: _deriveCounter, args: [0, 0.6] },
            ]);
        }},
        { id: 'fracture', name: 'Fracture', cat: 'Groove', gen: (n, b) => {
            const root = _shapeEvolve(b, [
                (t, d) => (Math.floor(t / (d/4)) % 2 === 0) ? 1 : 0,
                (t, d) => { const s = Math.floor(t / (d/8)); return (s % 3 !== 0) ? 1 : 0; },
                (t, d) => (Math.random() > 0.5) ? 1 : 0,
                (t, d) => (Math.random() > 0.7) ? 1 : 0,
            ]);
            const reverb = _shapeSweep(b, 0, 0.9, 'exp');
            return _buildLanes(n, b, [root, reverb], [
                { fn: _deriveCounter, args: [0, 0.5] },
            ]);
        }},

        // CHOP — groove-oriented, subdivision-focused
        { id: 'tresillo', name: 'Tresillo', cat: 'Chop', gen: (n, b) => {
            // 3+3+2 pattern with per-hit character maps. Uses deliberate silence
            // in bar 2 (null character) to create negative space that makes
            // bar 3 hit harder. Varied envelope characters give real dynamic range.
            const pts = [];
            const pattern = [0, 1.5, 3];
            // Per-bar character for the 3 hits. `null` = deliberate rest.
            const barChars = [
                ['punch',   'ghost',   'accent' ], // bar 0: big-soft-medium
                ['accent',  'sustain', 'ghost'  ], // bar 1: medium-held-soft
                ['sustain', null,      'punch'  ], // bar 2: held-SILENCE-bang (negative space)
                ['punch',   'accent',  'sustain'], // bar 3: big-medium-held (resolve)
            ];
            // Ghost fills at specific positions (deterministic, not random)
            const ghostFills = [
                null,
                { pos: 2.25 }, // bar 1: ghost fill between hit 2 and 3
                null,
                { pos: 0.75 }, // bar 3: ghost before hit 2
            ];
            for (let bar = 0; bar < 4; bar++) {
                const barStart = bar * (b / 4);
                const chars = barChars[bar];
                pattern.forEach((pos, hitIdx) => {
                    const t = barStart + pos;
                    if (t < b) _chopEnv(pts, t, 0.5, chars[hitIdx], b);
                });
                const g = ghostFills[bar];
                if (g) {
                    const gt = barStart + g.pos;
                    if (gt < b) _chopEnv(pts, gt, 0.35, 'ghost', b);
                }
            }
            // Flam on bar 3's last hit — a quick stab 0.08 beats before the sustain
            const flamT = 3 * (b / 4) + 3 - 0.08;
            if (flamT > 0 && flamT < b) _chopEnv(pts, flamT, 0.15, 'stab', b);
            return _buildChopLanes(n, b, [pts]);
        }},
        { id: 'dotted-bounce', name: 'Dotted Bounce', cat: 'Chop', gen: (n, b) => {
            // Dotted 8ths with character cycling. Every 3rd hit is a punch, the
            // others rotate through softer characters — big y-axis variation.
            const pts = [];
            // 6-step character cycle — creates a phrase that feels unpredictable
            // but still musical (big-small-medium repeating with variation)
            const cycle = ['punch', 'ghost', 'accent', 'sustain', 'ghost', 'punch'];
            let hitIdx = 0;
            for (let t = 0; t < b; t += 0.75) {
                const ch = cycle[hitIdx % cycle.length];
                _chopEnv(pts, t, 0.7, ch, b);
                hitIdx++;
            }
            // Deterministic 16th ghost fills on bars 2 and 4 (adds movement
            // between the dotted pulses — answers the main rhythm softly)
            const barBeats = b / 4;
            const fills = [barBeats * 1 + 2.125, barBeats * 3 + 2.625];
            fills.forEach(t => { if (t < b) _chopEnv(pts, t, 0.35, 'ghost', b); });
            return _buildChopLanes(n, b, [pts]);
        }},
        { id: 'trap-roll', name: 'Trap Roll', cat: 'Chop', gen: (n, b) => {
            // Accelerating density 1/4 → 1/8 → 1/8t → 1/16 with character-
            // driven dynamics. Bar 0 is sparse and dramatic (punch/sustain
            // interplay). Later bars are rolls (mostly ghost-level with
            // punctuating punches on downbeats) — classic trap aesthetic.
            const rates = [1, 0.5, 0.333, 0.25];
            // Character cycle per bar — first hit always punch, rest reflects
            // the "rolling soft texture with occasional big hits" trap feel
            const barCycles = [
                ['punch', 'accent', 'sustain', 'accent'],                                          // bar 0: 4 hits, dramatic
                ['punch', 'ghost', 'accent', 'ghost', 'sustain', 'ghost', 'accent', 'ghost'],      // bar 1: 8 hits
                ['punch', 'ghost', 'ghost', 'accent', 'ghost', 'ghost', 'punch', 'ghost', 'ghost', 'accent', 'ghost', 'ghost'], // bar 2: 12 hits (1/8t)
                ['punch', 'stab', 'ghost', 'stab', 'accent', 'stab', 'ghost', 'stab', 'punch', 'stab', 'ghost', 'stab', 'accent', 'stab', 'ghost', 'stab'], // bar 3: 16 hits of rapid stabs
            ];
            const barBeats = b / 4;
            const pts = [];
            for (let bar = 0; bar < 4; bar++) {
                const rate = rates[Math.min(bar, rates.length - 1)];
                const barStart = bar * barBeats;
                const cycle = barCycles[bar];
                let hitCount = 0;
                for (let t = 0; t < barBeats; t += rate) {
                    const at = barStart + t;
                    if (at >= b) break;
                    const ch = cycle[hitCount % cycle.length];
                    _chopEnv(pts, at, rate * 0.9, ch, b);
                    hitCount++;
                }
            }
            return _buildChopLanes(n, b, [pts]);
        }},
        { id: 'funk-slice', name: 'Funk Slice', cat: 'Chop', gen: (n, b) => {
            // 1/16 gate patterns with character maps per bar. null entries are
            // deliberate rests (negative space). Mix of punches, stabs, accents
            // and ghosts gives full dynamic range per bar without being "busy".
            const barCharPatterns = [
                ['punch',   null,   'ghost',   'accent', null,      'stab',   null,   'accent' ],
                ['punch',   'stab', null,      'accent', null,      null,     'punch','ghost'  ],
                [null,      'punch','stab',    null,     'sustain', 'accent', null,   'ghost'  ],
                ['punch',   null,   'accent',  null,     'sustain', 'stab',   'ghost',null     ],
            ];
            const barBeats = b / 4;
            const root = [];
            for (let bar = 0; bar < 4; bar++) {
                const row = barCharPatterns[bar % barCharPatterns.length];
                const stepLen = barBeats / row.length;
                for (let i = 0; i < row.length; i++) {
                    const t = bar * barBeats + i * stepLen;
                    if (row[i] && t < b) {
                        _chopEnv(root, t, stepLen * 0.85, row[i], b);
                    }
                }
            }
            const sweep = _shapeSweep(b, 0.2, 0.8, 'linear');
            return _buildChopLanes(n, b, [root, sweep]);
        }},
        { id: 'off-beat', name: 'Off-Beat', cat: 'Chop', gen: (n, b) => {
            // Alternating dominance per bar with character variation. Bars 0/2
            // give upbeats big punches while downbeats become ghost murmurs;
            // bars 1/3 flip. Extra variation via sustain hits on specific beats.
            const upbeats = [];
            const downbeats = [];
            const barBeats = b / 4;
            // Per-bar character maps for the 4 downbeats and 4 upbeats
            const upCharsByBar = [
                ['punch',  'accent',  'punch',   'sustain'],
                ['ghost',  'ghost',   'stab',    'ghost'  ],
                ['sustain','punch',   'accent',  'punch'  ],
                ['ghost',  'stab',    'ghost',   'ghost'  ],
            ];
            const downCharsByBar = [
                ['ghost',  'ghost',   'stab',    'ghost'  ],
                ['punch',  'sustain', 'punch',   'accent' ],
                ['ghost',  'stab',    'ghost',   'ghost'  ],
                ['punch',  'accent',  'sustain', 'punch'  ],
            ];
            for (let t = 0; t < b; t += 1) {
                const bar = Math.floor(t / barBeats);
                const beatInBar = Math.floor(t - bar * barBeats);
                const offT = t + 0.5;
                if (offT < b) {
                    _chopEnv(upbeats, offT, 0.45, upCharsByBar[bar][beatInBar], b);
                }
                _chopEnv(downbeats, t, 0.35, downCharsByBar[bar][beatInBar], b);
            }
            return _buildChopLanes(n, b, [upbeats, downbeats]);
        }},
        { id: 'shuffle', name: 'Shuffle', cat: 'Chop', gen: (n, b) => {
            // Swung 8ths with character-driven dynamics. Classic "1-AND-2-AND"
            // with beat 1 as the biggest punch, beat 3 as a secondary accent,
            // beats 2 and 4 as softer held notes. Upbeats are ghosts or stabs.
            // Bar 4 deliberately drops the beat-3 upbeat — negative space
            // makes the loop breathe before looping back.
            const pts = [];
            const swingAmounts = [0.55, 0.55, 0.62, 0.62];
            // Downbeat chars by beat position 0/1/2/3
            const downChars = ['punch', 'sustain', 'accent', 'ghost'];
            // Upbeat chars by beat position 0/1/2/3
            const upChars   = ['accent', 'stab',    'ghost',  'stab' ];
            for (let bar = 0; bar < 4; bar++) {
                const barStart = bar * (b / 4);
                const swing = swingAmounts[Math.min(bar, 3)];
                for (let beat = 0; beat < 4; beat++) {
                    const t = barStart + beat;
                    if (t >= b) break;
                    _chopEnv(pts, t, 0.35, downChars[beat], b);
                    // Bar 4 beat 3 upbeat = deliberate silence
                    if (bar === 3 && beat === 2) continue;
                    const upT = t + swing;
                    if (upT < b) _chopEnv(pts, upT, 0.25, upChars[beat], b);
                }
            }
            return _buildChopLanes(n, b, [pts]);
        }},
        { id: 'razor-chop', name: 'Razor Chop', cat: 'Chop', gen: (n, b) => {
            // 1/32 burst clusters. Each burst opens with a punch (or sustain
            // for the "big drops") followed by stab-stab-ghost rolls. This is
            // the "rapid fire with breath between bursts" razor-chop aesthetic.
            const barBeats = b / 4;
            const pts = [];
            const burstPositions = [
                [0, 2.5],
                [1, 3],
                [0.5, 2, 3.5],
                [0, 1.5, 2.5, 3.5]
            ];
            // Burst character templates — first slot is the attack, rest is the tail.
            // We cycle through these to give each burst a distinct feel.
            const burstTemplates = [
                ['punch',   'stab', 'stab',  'ghost', 'stab', 'ghost', 'stab'],
                ['sustain', 'stab', 'ghost', 'stab',  'stab', 'ghost', 'stab'],
                ['accent',  'stab', 'stab',  'stab',  'ghost','stab',  'ghost'],
                ['punch',   'stab', 'ghost', 'stab',  'stab', 'stab',  'ghost'],
            ];
            let burstIdx = 0;
            for (let bar = 0; bar < 4; bar++) {
                const positions = burstPositions[Math.min(bar, 3)];
                positions.forEach(pos => {
                    const burstStart = bar * barBeats + pos;
                    const burstLen = 4 + bar; // 4-7 hits per burst
                    const tmpl = burstTemplates[burstIdx % burstTemplates.length];
                    burstIdx++;
                    for (let g = 0; g < burstLen; g++) {
                        const t = burstStart + g * 0.125;
                        if (t >= b) break;
                        _chopEnv(pts, t, 0.09, tmpl[g % tmpl.length], b);
                    }
                });
            }
            const voidSweep = _shapeSweep(b, 0.1, 0.6, 's');
            return _buildChopLanes(n, b, [pts, voidSweep]);
        }},
        { id: 'clave', name: 'Clave', cat: 'Chop', gen: (n, b) => {
            // Son clave 2-3 with character map — step 10 (the "3-side" strongest
            // hit in the clave rhythm) is a punch, the others are accent/sustain.
            // null entries = rests, matching the off-beats of the clave pattern.
            const claveChars = [
                'accent', null, null, 'sustain', null, null, 'punch', null,
                null,     null, 'punch', null,   'accent', null, null, null
            ];
            const stepLen = (b / 4 * 2) / claveChars.length; // 2-bar cycle
            const root = [];
            for (let rep = 0; rep < Math.ceil(b / (b / 4 * 2)); rep++) {
                for (let i = 0; i < claveChars.length; i++) {
                    const t = rep * (b / 4 * 2) + i * stepLen;
                    if (t >= b) break;
                    _chopEnv(root, t, stepLen * 0.85, claveChars[i], b);
                }
            }
            // Deterministic ghost fill map — fixed beat positions between clave hits.
            const fills = [];
            const ghostRel = [0.5, 1.25, 2.0, 3.25, 4.5, 5.25, 6.0, 7.25];
            for (const t of ghostRel) {
                if (t < b) _chopEnv(fills, t, 0.25, 'ghost', b);
            }
            return _buildChopLanes(n, b, [root, fills]);
        }},
        { id: 'polyswing', name: 'Polyswing', cat: 'Chop', gen: (n, b) => {
            // 1/8 and dotted 1/8 voices alternating dominance per bar. Uses
            // character cycles per bar so the "dominant" voice gets punches
            // and the "background" voice gets ghosts — classic call-and-response.
            const barBeats = b / 4;
            // Bar index -> character cycle for each voice
            const eighthByBar = [
                ['punch',  'accent', 'sustain','accent', 'punch',  'accent', 'sustain','accent'],
                ['ghost',  'stab',   'ghost',  'stab',   'ghost',  'stab',   'ghost',  'stab'  ],
                ['sustain','punch',  'accent', 'punch',  'sustain','punch',  'accent', 'punch' ],
                ['ghost',  'ghost',  'stab',   'ghost',  'ghost',  'ghost',  'stab',   'ghost' ],
            ];
            const dottedByBar = [
                ['ghost',  'stab',   'ghost'],
                ['punch',  'accent', 'sustain'],
                ['ghost',  'ghost',  'stab'],
                ['sustain','punch',  'accent'],
            ];
            const eighth = [];
            let eIdx = 0;
            for (let t = 0; t < b; t += 0.5) {
                const bar = Math.floor(t / barBeats);
                const cycle = eighthByBar[bar % 4];
                const hitInBar = Math.floor((t - bar * barBeats) / 0.5);
                _chopEnv(eighth, t, 0.45, cycle[hitInBar % cycle.length], b);
                eIdx++;
            }
            const dotted = [];
            let dIdx = 0;
            for (let t = 0; t < b; t += 0.75) {
                const bar = Math.floor(t / barBeats);
                const cycle = dottedByBar[bar % 4];
                _chopEnv(dotted, t, 0.6, cycle[dIdx % cycle.length], b);
                dIdx++;
            }
            return _buildChopLanes(n, b, [eighth, dotted]);
        }},
        { id: 'chop-hold', name: 'Chop & Hold', cat: 'Chop', gen: (n, b) => {
            // Alternating 1/16 stutter zones and sustained holds
            const barBeats = b / 4;
            const pts = [];
            // Bar 1: 2 beats chop, 2 beats hold
            // Bar 2: 1 beat chop, 3 beats hold
            // Bar 3: 3 beats chop, 1 beat hold
            // Bar 4: full chop
            const chopZones = [
                { start: 0, len: 2 },
                { start: barBeats, len: 1 },
                { start: barBeats * 2, len: 3 },
                { start: barBeats * 3, len: barBeats }
            ];
            const holdZones = [
                { start: 2, len: 2 },
                { start: barBeats + 1, len: 3 },
                { start: barBeats * 2 + 3, len: 1 },
            ];
            // Chop zone character cycle — first hit is always punch, then stabs,
            // with the occasional accent for dynamic variation
            const chopCycle = ['punch', 'stab', 'accent', 'stab', 'ghost', 'stab', 'punch', 'stab', 'accent', 'stab', 'ghost', 'stab'];
            chopZones.forEach(zone => {
                let hitIdx = 0;
                for (let t = zone.start; t < zone.start + zone.len && t < b; t += 0.25) {
                    _chopEnv(pts, t, 0.19, chopCycle[hitIdx % chopCycle.length], b);
                    hitIdx++;
                }
            });
            // Hold zones get the 'sustain' character scaled to the full zone length
            holdZones.forEach(zone => {
                if (zone.start < b) {
                    _chopEnv(pts, zone.start, zone.len, 'sustain', b);
                }
            });
            pts.sort((a, c) => a.time - c.time);
            return _buildChopLanes(n, b, [pts]);
        }},

        // PUMPER VARIANTS
        { id: 'pumper-tight', name: 'The Pumper — Tight', cat: 'Pumper', gen: (n, b) => {
            const root = _shapeEvolve(b, [
                (t, d) => { const c = t % 1; return c < 0.05 ? 1 : Math.exp(-5 * c); },
                (t, d) => { const c = t % 1.33; return c < 0.05 ? 1 : Math.exp(-4 * c); },
                (t, d) => { const x = t / d; return 0.3 + 0.5 * Math.sin(Math.PI * x); },
                (t, d) => { const c = t % 0.5; return c < 0.03 ? 1 : Math.exp(-8 * c); },
            ]);
            return _buildLanes(n, b, [root], [
                { fn: _deriveCounter, args: [0, 0.7] },
                { fn: _deriveEcho, args: [0, 1, 0.5] },
            ]);
        }},
        { id: 'pumper-half', name: 'The Pumper — Half-Time', cat: 'Pumper', gen: (n, b) => {
            const root = _shapePulse(b, b / 2, 'exp');
            return _buildLanes(n, b, [root], [
                { fn: _deriveCounter, args: [0, 0.7] },
                { fn: _deriveEcho, args: [0, 2, 0.5] },
            ]);
        }},
        { id: 'pumper-reverse', name: 'The Pumper — Reverse', cat: 'Pumper', gen: (n, b) => {
            const pts = [];
            for (let t = 0; t < b; t += 1) {
                for (let s = 0; s <= 0.95; s += 0.05) {
                    pts.push({ time: t + s, value: Math.pow(s / 0.95, 3), curve: 0 });
                }
                pts.push({ time: t + 0.99, value: 0, curve: 0 });
            }
            return _buildLanes(n, b, [pts], [
                { fn: _deriveCounter, args: [0, 0.6] },
            ]);
        }},
        { id: 'pumper-triplet', name: 'The Pumper — Triplet', cat: 'Pumper', gen: (n, b) => {
            const bpb = b / 4;
            const root = _shapeEvolve(b, [
                (t, d) => { const c = t % (d/3); return c < 0.05 ? 1 : Math.exp(-4 * c); },
                (t, d) => { const c = t % (d/3); return c < 0.05 ? 1 : Math.exp(-4 * c); },
                (t, d) => { const c = t % (d/4); return c < 0.05 ? 1 : Math.exp(-5 * c); },
                (t, d) => { const c = t % (d/4); return c < 0.05 ? 1 : Math.exp(-5 * c); },
            ]);
            return _buildLanes(n, b, [root], [
                { fn: _deriveCounter, args: [0, 0.6] },
                { fn: _deriveEcho, args: [0, 0.67, 0.5] },
            ]);
        }},
        { id: 'pumper-sharkfin', name: 'The Pumper — Shark Fin', cat: 'Pumper', gen: (n, b) => {
            const root = _shapeEvolve(b, [
                (t, d) => { const c = t % 1; return c < 0.1 ? c / 0.1 : 1 - Math.sqrt((c - 0.1) / 0.9); },
                (t, d) => { const c = t % 1; return c < 0.7 ? Math.sqrt(c / 0.7) : 1 - (c - 0.7) / 0.3; },
                (t, d) => { const c = t % 1; return c < 0.3 ? c / 0.3 : 1 - Math.sqrt((c - 0.3) / 0.7); },
                (t, d) => { const c = t % 1; return c < 0.5 ? Math.pow(c / 0.5, 2) : Math.pow(1 - (c - 0.5) / 0.5, 2); },
            ]);
            return _buildLanes(n, b, [root], [
                { fn: _deriveCounter, args: [0, 0.6] },
            ]);
        }},
        { id: 'pumper-decay', name: 'The Pumper — Decay', cat: 'Pumper', gen: (n, b) => {
            const root = _shapeEvolve(b, [
                (t, d) => { const c = t % 1; return c < 0.02 ? 1 : 1 - c; },
                (t, d) => { const c = t % 1; return c < 0.02 ? 1 : c < 0.7 ? 1 - 0.1 * c : 1 - Math.pow((c - 0.3) / 0.7, 0.5); },
                (t, d) => { const c = t % 1; return c < 0.02 ? 1 : Math.pow(1 - c, 3); },
                (t, d) => { const c = t % 1; return c < 0.02 ? 1 : Math.exp(-4 * c); },
            ]);
            return _buildLanes(n, b, [root], [
                { fn: _deriveCounter, args: [0, 0.6] },
                { fn: _deriveEcho, args: [0, 0.5, 0.5] },
            ]);
        }},

        // SWEEP & EVOLVE
        { id: 'slow-burn', name: 'Slow Burn', cat: 'Sweep', gen: (n, b) => {
            const root = _shapeSweep(b, 0.1, 0.9, 's');
            const filter = _shapeSine(b, 2, 0);
            return _buildLanes(n, b, [root, filter], [
                { fn: _deriveCounter, args: [0, 0.6] },
            ]);
        }},
        { id: 'deep-breath', name: 'Deep Breath', cat: 'Sweep', gen: (n, b) => {
            const pts = [];
            for (let t = 0; t <= b; t += 0.25) {
                const n2 = t / b;
                const v = n2 < 0.45 ? Math.sin(Math.PI * n2 / 0.9) : n2 < 0.55 ? 1 : n2 < 0.85 ? Math.cos(Math.PI * (n2 - 0.55) / 0.6) : 0;
                pts.push({ time: t, value: Math.max(0, v), curve: 0 });
            }
            return _buildLanes(n, b, [pts], [
                { fn: _deriveCounter, args: [0, 0.7] },
                { fn: _deriveEcho, args: [0, 2, 0.4] },
            ]);
        }},
        { id: 'tide', name: 'Tide', cat: 'Sweep', gen: (n, b) => {
            const up = _shapeSweep(b, 0.1, 0.9, 'linear');
            const down = _shapeSweep(b, 0.9, 0.1, 'linear');
            return _buildLanes(n, b, [up, down], [
                { fn: _deriveCounter, args: [0, 0.5] },
            ]);
        }},
        { id: 'orbit', name: 'Orbit', cat: 'Sweep', gen: (n, b) => {
            const root1 = _shapeSine(b, 1, 0);
            const root2 = _shapeSine(b, 1.618, 0);
            return _buildLanes(n, b, [root1, root2], [
                { fn: _deriveCounter, args: [0, 0.5] },
                { fn: _deriveEcho, args: [0, 1, 0.5] },
            ]);
        }},
        { id: 'whip', name: 'Whip', cat: 'Sweep', gen: (n, b) => {
            const bpb = b / 4;
            const pts = [];
            for (let bar = 0; bar < 4; bar++) {
                const t = bar * bpb + (bar * 0.5);
                if (t < b) {
                    pts.push({ time: t, value: 0, curve: 0 });
                    pts.push({ time: t + 0.01, value: 1, curve: 0 });
                    for (let s = 0.25; s < bpb - 0.5; s += 0.25) {
                        pts.push({ time: t + s, value: Math.exp(-3 * s / bpb), curve: 0 });
                    }
                    pts.push({ time: Math.min(t + bpb - 0.5, b), value: 0, curve: 0 });
                }
            }
            return _buildLanes(n, b, [pts], [
                { fn: _deriveEcho, args: [0, 1, 0.4] },
                { fn: _deriveCounter, args: [0, 0.5] },
            ]);
        }},

        // BUILD & SURGE
        { id: 'surge', name: 'Surge', cat: 'Build', gen: (n, b) => {
            const pts = [];
            const steps = 8;
            for (let i = 0; i <= steps; i++) {
                const t = (i / steps) * b * 0.7;
                pts.push({ time: t, value: i / steps, curve: 0 });
                if (i < steps) pts.push({ time: t + (b * 0.7 / steps) - 0.01, value: i / steps, curve: 0 });
            }
            // Fake drop
            pts.push({ time: b * 0.72, value: 0, curve: 0 });
            // Rebuild faster
            for (let i = 0; i <= 4; i++) {
                const t = b * 0.72 + (i / 4) * b * 0.26;
                pts.push({ time: t, value: i / 4, curve: 0 });
            }
            pts.push({ time: b * 0.99, value: 0, curve: 0 });
            return _buildLanes(n, b, [pts], [
                { fn: _deriveCounter, args: [0, 0.6] },
                { fn: _deriveEcho, args: [0, 0.5, 0.5] },
            ]);
        }},
        { id: 'ignite', name: 'Ignite', cat: 'Build', gen: (n, b) => {
            const root = _shapeSweep(b, 0, 1, 'exp');
            return _buildLanes(n, b, [root], [
                { fn: _deriveEcho, args: [0, 2, 0.5] },
                { fn: _deriveCounter, args: [0, 0.4] },
            ]);
        }},
        { id: 'collapse', name: 'Collapse', cat: 'Build', gen: (n, b) => {
            // Full → glitching → fragments → dead
            const root = _shapeEvolve(b, [
                (t, d) => 0.9,
                (t, d) => Math.random() > 0.3 ? 0.9 : 0,
                (t, d) => Math.random() > 0.6 ? 0.8 : 0,
                (t, d) => Math.random() > 0.85 ? 0.7 : 0,
            ]);
            const reverb = _shapeSweep(b, 0, 1, 'exp');
            return _buildLanes(n, b, [root, reverb], [
                { fn: _deriveCounter, args: [0, 0.5] },
            ]);
        }},
        { id: 'tension', name: 'Tension', cat: 'Build', gen: (n, b) => {
            const root = _shapeSweep(b, 0, 0.95, 'exp');
            const stutter = [];
            for (let t = 0; t <= b; t += 0.25) {
                const intensity = t / b;
                const wobble = Math.sin(t * (2 + intensity * 20)) * intensity * 0.4;
                stutter.push({ time: t, value: Math.max(0, Math.min(1, 0.5 + wobble)), curve: 0 });
            }
            return _buildLanes(n, b, [root, stutter], [
                { fn: _deriveCounter, args: [0, 0.5] },
            ]);
        }},

        // TEXTURE (EXTREME)
        { id: 'ghost-machine', name: 'Ghost Machine', cat: 'Texture', gen: (n, b) => {
            // Polyrhythmic interlocking gates
            const gate16 = _shapeGate(b, Array.from({length: Math.round(b * 4)}, (_, i) => (i % 2 === 0) ? 1 : 0), 1);
            const gateTriplet = _shapeGate(b, Array.from({length: Math.round(b * 3)}, (_, i) => (i % 2 === 0) ? 1 : 0), 0.9);
            const gateDotted = _shapeGate(b, Array.from({length: Math.round(b * 2.67)}, (_, i) => (i % 2 === 0) ? 1 : 0), 0.85);
            return _buildLanes(n, b, [gate16, gateTriplet, gateDotted], [
                { fn: _deriveCounter, args: [0, 0.5] },
            ]);
        }},
        { id: 'shimmer', name: 'Shimmer', cat: 'Texture', gen: (n, b) => {
            // Cascading staccato bursts, density increases
            const root = _shapeEvolve(b, [
                (t, d) => (t % 2 < 0.1) ? 1 : 0,
                (t, d) => (t % 1 < 0.1) ? 1 : 0,
                (t, d) => (t % 0.5 < 0.08) ? 1 : 0,
                (t, d) => (t % 0.25 < 0.06) ? 1 : 0,
            ]);
            return _buildLanes(n, b, [root], [
                { fn: _deriveEcho, args: [0, 0.125, 0.8] },
            ]);
        }},
        { id: 'murk', name: 'Murk', cat: 'Texture', gen: (n, b) => {
            // Deep slow ducking pressure waves
            const root = [];
            const gateCount = 3;
            for (let i = 0; i < gateCount; i++) {
                const t = (i / gateCount) * b * 0.85;
                root.push({ time: t, value: 0, curve: 0 });
                root.push({ time: t + 0.01, value: 1, curve: 0 });
                for (let s = 0.5; s < b / gateCount * 0.8; s += 0.25) {
                    root.push({ time: t + s, value: Math.exp(-2 * s * gateCount / b), curve: 0 });
                }
            }
            root.push({ time: b, value: 0, curve: 0 });
            const sub = _shapeSine(b, 2, 0);
            return _buildLanes(n, b, [root, sub], [
                { fn: _deriveCounter, args: [0, 0.6] },
            ]);
        }},

        // CASCADE & SPECIAL
        { id: 'cascade', name: 'Cascade', cat: 'Special', gen: (n, b) => {
            const root = _shapeSine(b, 2, 0);
            // All lanes are phase-cascaded with decreasing amplitude
            const lanes = [];
            for (let i = 0; i < n; i++) {
                const amp = 1 - (i / n) * 0.85;
                const phase = (i / n) * Math.PI * 2;
                const pts = [];
                for (let t = 0; t <= b; t += 0.25) {
                    pts.push({ time: t, value: Math.max(0, Math.min(1, 0.5 + 0.5 * amp * Math.sin(2 * Math.PI * 2 * t / b + phase))), curve: 0 });
                }
                lanes.push(pts);
            }
            return lanes;
        }},
        { id: 'chaotic-engine', name: 'Chaotic Engine', cat: 'Special', gen: (n, b) => {
            const root = _shapeChaosZones(b, 0.5);
            const reverb = [];
            const bpb = b / 4;
            for (let bar = 0; bar < 4; bar++) {
                for (let t = 0; t < bpb; t += 0.25) {
                    const bt = bar * bpb + t;
                    reverb.push({ time: bt, value: (bar % 2 === 0) ? 0.1 : 0.5 + 0.4 * Math.sin(Math.PI * t / bpb), curve: 0 });
                }
            }
            return _buildLanes(n, b, [root, reverb], [
                { fn: _deriveCounter, args: [0, 0.4] },
            ]);
        }},
    ];

    // --- Lane Builder ---
    function _buildLanes(laneCount, beats, rootPts, secondaryRules) {
        const lanes = [];
        const rootCount = rootPts.length;
        const secCount = Math.min(secondaryRules.length * rootCount, Math.floor(laneCount * 0.2));

        for (let i = 0; i < laneCount; i++) {
            if (i < rootCount) {
                // Root lane — full intensity
                lanes.push(rootPts[i]);
            } else if (i < rootCount + secCount) {
                // Secondary: apply derivation rules at strong intensity
                const secIdx = i - rootCount;
                const ruleIdx = secIdx % secondaryRules.length;
                const rootIdx = secIdx % rootCount;
                const rule = secondaryRules[ruleIdx];
                const src = rootPts[rootIdx];
                if (rule.fn === _deriveEcho) {
                    lanes.push(rule.fn(src, rule.args[1], rule.args[2], beats));
                } else if (rule.fn === _derivePhaseCascade) {
                    lanes.push(rule.fn(src, i, laneCount, rule.args[1], beats));
                } else {
                    lanes.push(rule.fn(src, rule.args[1]));
                }
            } else {
                // Tertiary: phase-cascaded from roots with REAL amplitude
                const rootIdx = i % rootCount;
                const src = rootPts[rootIdx];

                // Always start with phase cascade for unique timing per lane
                const phase = ((i + 1) / (laneCount + 1)) * 0.9;
                let pts = src.map(pt => ({
                    time: Math.round(((pt.time + phase * beats) % beats) * 1000) / 1000,
                    value: pt.value,
                    curve: pt.curve || 0
                })).sort((a, b) => a.time - b.time);

                // Then apply a variation based on lane index
                const method = i % 3;
                if (method === 1) {
                    // Invert values
                    pts = pts.map(pt => ({ time: pt.time, value: 1 - pt.value, curve: pt.curve ? -pt.curve : 0 }));
                } else if (method === 2) {
                    // Scale amplitude (compress toward random center)
                    const center = 0.3 + (i % 7) * 0.1;
                    const scale = 0.6 + (i % 5) * 0.08;
                    pts = pts.map(pt => ({ time: pt.time, value: Math.max(0, Math.min(1, center + (pt.value - 0.5) * scale)), curve: pt.curve || 0 }));
                }
                // method 0 = pure phase cascade, full amplitude

                lanes.push(pts);
            }
        }
        return lanes;
    }

    // --- Preset UI ---
    // --- Shuffle: randomize which curves land on which params ---
    window.sdShuffleLanes = function() {
        if (sdCanvasParams.length < 2) return;
        const lanesWithPoints = sdCanvasParams.filter(p => p.points.length > 0);
        if (lanesWithPoints.length < 2) {
            document.getElementById('sd-canvas-status').textContent = 'Need curves on at least 2 lanes';
            return;
        }
        pushUndo();
        // Collect all point arrays
        const allPoints = sdCanvasParams.map(p => p.points.slice());
        // Fisher-Yates shuffle
        for (let i = allPoints.length - 1; i > 0; i--) {
            const j = Math.floor(Math.random() * (i + 1));
            [allPoints[i], allPoints[j]] = [allPoints[j], allPoints[i]];
        }
        // Reassign
        sdCanvasParams.forEach((p, i) => { p.points = allPoints[i]; });
        sdResetSliderSnapshots();
        sdRenderSidebar();
        sdDrawCanvasGrid();
        document.getElementById('sd-canvas-status').textContent = 'Shuffled — lanes reassigned randomly';
    };

    window.sdTogglePresets = function() {
        const modal = document.getElementById('sd-preset-modal');
        modal.classList.toggle('hidden');
    };

    window.sdApplyBankPreset = function(presetId) {
        if (!sdCanvasParams.length) {
            document.getElementById('sd-canvas-status').textContent = 'Scan a rack first';
            return;
        }
        const preset = STRIDE_PRESETS.find(p => p.id === presetId);
        if (!preset) {
            document.getElementById('sd-canvas-status').textContent = 'Preset not found: ' + presetId;
            return;
        }

        try {
            pushUndo();
            const beats = sdGetBars() * 4;
            const n = sdCanvasParams.length;
            let lanes = preset.gen(n, beats);

            sdCanvasParams.forEach((param, i) => {
                if (i < lanes.length && lanes[i] && lanes[i].length) {
                    param.points = lanes[i].filter(pt => pt && isFinite(pt.time) && isFinite(pt.value)).map(pt => ({
                        time: Math.max(0, Math.min(beats, pt.time)),
                        value: Math.max(0, Math.min(1, isNaN(pt.value) ? 0 : pt.value)),
                        curve: pt.curve || 0
                    }));
                } else {
                    param.points = [];
                }
            });

            document.getElementById('sd-preset-modal').classList.add('hidden');
            sdResetSliderSnapshots();
            sdRenderSidebar();
            sdDrawCanvasGrid();
            document.getElementById('sd-canvas-status').textContent = 'Preset: ' + preset.name + ' — ' + n + ' lanes';
        } catch (e) {
            console.error('[Stride] Preset error:', e);
            document.getElementById('sd-canvas-status').textContent = 'Preset error: ' + e.message;
        }
    };

    // Generate SVG preview for a preset (runs generator with 5 lanes, renders as mini SVG)
    function _presetPreviewSVG(preset) {
        try {
            const beats = 16; // 4 bars preview
            const lanes = preset.gen(5, beats);
            const w = 200, h = 48;
            const colors = ['#f97316', '#d946ef', '#06b6d4', '#22c55e', '#f59e0b'];
            let paths = '';
            const maxLanes = Math.min(lanes.length, 5);
            for (let li = 0; li < maxLanes; li++) {
                const pts = lanes[li];
                if (!pts || pts.length < 2) continue;
                const opacity = li === 0 ? 1 : (0.7 - li * 0.1);
                const strokeW = li === 0 ? 2 : 1.2;
                let d = '';
                pts.forEach((pt, pi) => {
                    const x = (pt.time / beats) * w;
                    const y = h - pt.value * h;
                    d += (pi === 0 ? 'M' : 'L') + x.toFixed(1) + ',' + y.toFixed(1) + ' ';
                });
                if (d) paths += `<path d="${d}" stroke="${colors[li % colors.length]}" stroke-width="${strokeW}" fill="none" opacity="${opacity}"/>`;
            }
            return `<svg viewBox="0 0 ${w} ${h}" style="width:100%;height:${h}px;display:block;border-radius:6px;background:#0a0a0a">${paths}</svg>`;
        } catch (e) {
            return `<div style="height:48px;background:#0a0a0a;border-radius:6px;display:flex;align-items:center;justify-content:center"><span style="font-size:8px;color:#3f3f46">preview error</span></div>`;
        }
    }

    // Populate preset modal with tabs + preview cards
    function _fillPresetList() {
        const list = document.getElementById('sd-preset-list');
        const tabs = document.getElementById('sd-preset-tabs');
        if (!list || !tabs) return;

        const cats = {};
        STRIDE_PRESETS.forEach(p => { if (!cats[p.cat]) cats[p.cat] = []; cats[p.cat].push(p); });
        const catColors = { Groove: '#d946ef', Pumper: '#f97316', Sweep: '#22c55e', Build: '#f59e0b', Texture: '#a1a1aa', Special: '#ef4444' };
        const catNames = Object.keys(cats);

        // Build tabs
        tabs.innerHTML = '';
        catNames.forEach((cat, ci) => {
            const color = catColors[cat] || '#a1a1aa';
            const tab = document.createElement('button');
            tab.className = 'text-[9px] font-bold uppercase tracking-widest px-3 py-1.5 rounded-lg transition-all shrink-0';
            tab.textContent = cat + ' (' + cats[cat].length + ')';
            tab.style.color = ci === 0 ? '#fff' : color;
            tab.style.background = ci === 0 ? color + '30' : 'transparent';
            tab.style.border = '1px solid ' + (ci === 0 ? color + '60' : '#27272a');
            tab.addEventListener('click', () => {
                _showPresetCategory(cat);
                // Update tab styles
                tabs.querySelectorAll('button').forEach((t, ti) => {
                    const c = catColors[catNames[ti]] || '#a1a1aa';
                    t.style.color = catNames[ti] === cat ? '#fff' : c;
                    t.style.background = catNames[ti] === cat ? c + '30' : 'transparent';
                    t.style.border = '1px solid ' + (catNames[ti] === cat ? c + '60' : '#27272a');
                });
            });
            tabs.appendChild(tab);
        });

        // Show first category
        if (catNames.length) _showPresetCategory(catNames[0]);

        function _showPresetCategory(cat) {
            const color = catColors[cat] || '#a1a1aa';
            const presets = cats[cat] || [];
            list.innerHTML = '';

            const grid = document.createElement('div');
            grid.className = 'grid grid-cols-2 gap-3';

            presets.forEach(p => {
                const card = document.createElement('button');
                card.className = 'text-left rounded-xl bg-black/40 border border-white/5 hover:border-white/20 transition-all overflow-hidden';

                const preview = document.createElement('div');
                preview.className = 'px-2 pt-2';
                preview.innerHTML = _presetPreviewSVG(p);

                const label = document.createElement('div');
                label.className = 'px-3 py-2';
                label.innerHTML = `<div class="text-[11px] font-bold" style="color:${color}">${p.name}</div>`;

                card.appendChild(preview);
                card.appendChild(label);
                card.addEventListener('click', (ev) => {
                    ev.stopPropagation();
                    window.sdApplyBankPreset(p.id);
                });
                grid.appendChild(card);
            });

            list.appendChild(grid);
        }
    }
    _fillPresetList();

    // ─── SAVE / LOAD SESSIONS ──────────────────────────────
    // Sessions store the full canvas state + template reference as
    // JSON files in ~/Desktop/Stride/sessions/

    window.sdSaveSession = function() {
        if (!sdCanvasParams.length) return;
        const nameInput = document.getElementById('session-name-input');
        nameInput.value = currentDeviceName || '';
        document.getElementById('session-save-status').textContent = '';
        document.getElementById('save-session-modal').classList.remove('hidden');
        setTimeout(() => { nameInput.focus(); nameInput.select(); }, 50);
    };

    window.sdConfirmSaveSession = async function() {
        const name = document.getElementById('session-name-input').value.trim();
        if (!name) {
            document.getElementById('session-save-status').textContent = 'Enter a name';
            return;
        }
        if (!window.stride || !window.stride.saveSession) return;

        // Find template filename from currentTemplatePath
        let templateFilename = '';
        if (currentTemplatePath) {
            const parts = currentTemplatePath.replace(/\\/g, '/').split('/');
            templateFilename = parts[parts.length - 1];
        }

        const session = {
            name: name,
            saved_at: new Date().toISOString(),
            device_name: currentDeviceName || '',
            template_filename: templateFilename,
            clip_bars: sdGetBars(),
            params: sdCanvasParams.map(p => ({
                envelopeId: p.envelopeId,
                name: p.name,
                min: p.min,
                max: p.max,
                points: p.points.map(pt => ({
                    time: pt.time,
                    value: pt.value,
                    curve: pt.curve || 0
                }))
            }))
        };

        const result = await window.stride.saveSession(session);
        if (result.success) {
            document.getElementById('session-save-status').textContent = 'Session saved!';
            setTimeout(() => document.getElementById('save-session-modal').classList.add('hidden'), 600);
        } else {
            document.getElementById('session-save-status').textContent = 'Error: ' + (result.error || 'Unknown');
        }
    };

    let _allSessions = [];
    const MAX_VISIBLE_SESSIONS = 20;

    function _renderSessionList(filter) {
        const listEl = document.getElementById('session-list');
        let filtered = _allSessions;
        if (filter) {
            const q = filter.toLowerCase();
            filtered = _allSessions.filter(s =>
                (s.name || '').toLowerCase().includes(q) ||
                (s.device_name || '').toLowerCase().includes(q)
            );
        }
        const shown = filtered.slice(0, MAX_VISIBLE_SESSIONS);
        if (!shown.length) {
            listEl.innerHTML = '<div class="text-[9px] text-zinc-500 text-center py-4">' + (filter ? 'No matches' : 'No saved sessions') + '</div>';
            return;
        }
        listEl.innerHTML = shown.map(s => {
            const date = s.saved_at ? new Date(s.saved_at).toLocaleDateString() : '';
            return '<div class="flex items-center gap-2 bg-black/30 border border-white/5 rounded-lg p-2 hover:border-white/10 transition-colors">' +
                '<div class="flex-1 min-w-0">' +
                    '<div class="text-[10px] text-zinc-200 font-bold truncate">' + (s.name || 'Untitled') + '</div>' +
                    '<div class="text-[8px] text-zinc-500">' + (s.device_name || '') + ' \u00b7 ' + s.param_count + ' params \u00b7 ' + s.clip_bars + ' bars \u00b7 ' + date + '</div>' +
                '</div>' +
                '<button onclick="sdLoadSession(\'' + s.filename.replace(/'/g, "\\'") + '\')" class="text-[8px] text-sky-400 bg-sky-500/10 hover:bg-sky-500/20 border border-sky-500/20 px-2 py-1 rounded uppercase font-bold transition-all shrink-0">Load</button>' +
                '<button onclick="sdDeleteSession(\'' + s.filename.replace(/'/g, "\\'") + '\')" title="Delete" class="text-[8px] text-red-400/60 hover:text-red-400 px-1.5 py-1 transition-colors shrink-0">\u2715</button>' +
            '</div>';
        }).join('');
        if (filtered.length > MAX_VISIBLE_SESSIONS) {
            listEl.innerHTML += '<div class="text-[8px] text-zinc-600 text-center py-1">' + (filtered.length - MAX_VISIBLE_SESSIONS) + ' more — use search to narrow</div>';
        }
    }

    window.sdFilterSessions = function(query) {
        _renderSessionList(query);
    };

    window.sdShowSessions = async function() {
        if (!window.stride || !window.stride.listSessions) return;
        document.getElementById('load-session-modal').classList.remove('hidden');
        document.getElementById('session-load-status').textContent = '';
        const searchInput = document.getElementById('session-search');
        searchInput.value = '';

        _allSessions = await window.stride.listSessions();
        _renderSessionList('');
        setTimeout(() => searchInput.focus(), 50);
    };

    window.sdLoadSession = async function(filename) {
        if (!window.stride || !window.stride.loadSession) return;
        const result = await window.stride.loadSession(filename);
        if (!result.success) {
            document.getElementById('session-load-status').textContent = 'Error: ' + (result.error || 'Unknown');
            return;
        }

        const session = result.session;
        pushUndo();

        // Restore canvas params
        sdCanvasParams.length = 0;
        (session.params || []).forEach(p => {
            sdCanvasParams.push({
                envelopeId: p.envelopeId,
                name: p.name,
                min: p.min,
                max: p.max,
                points: (p.points || []).map(pt => ({
                    time: pt.time,
                    value: pt.value,
                    curve: pt.curve || 0
                }))
            });
        });

        // Restore state
        if (session.clip_bars) sdSetBars(session.clip_bars);
        if (session.device_name) {
            currentDeviceName = session.device_name;
            document.getElementById('rack-name').textContent = session.device_name;
            document.getElementById('rack-info').classList.remove('hidden');
            document.getElementById('no-rack-msg').classList.add('hidden');
            document.getElementById('rack-track').textContent = 'Session: ' + session.name;
        }
        if (sdCanvasParams.length) {
            sdActiveParamId = sdCanvasParams[0].envelopeId;
            document.getElementById('sd-param-count').textContent = sdCanvasParams.length + ' params';
        }

        // Resolve template
        if (session.template_filename) {
            currentTemplatePath = session._template_path || null;
            templateMatchState = session._template_exists ? 'exact' : 'none';
            _renderTemplateStatus();
            if (!session._template_exists) {
                document.getElementById('session-load-status').textContent = 'Template not found — drag the MIDI clip (not device) to User Library';
                document.getElementById('session-load-status').style.color = '#fbbf24';
            }
        }

        sdResetSliderSnapshots();
        sdRenderSidebar();
        sdDrawCanvasGrid();
        document.getElementById('load-session-modal').classList.add('hidden');
        document.getElementById('sd-canvas-status').textContent = 'Session loaded: ' + (session.name || 'Untitled');
    };

    window.sdDeleteSession = async function(filename) {
        if (!window.stride || !window.stride.deleteSession) return;
        await window.stride.deleteSession(filename);
        sdShowSessions(); // refresh list
    };

    // ─── SAVE / LOAD PRESETS ────────────────────────────────
    // Presets store normalized curve data (0-1 time/value) so they
    // can be applied to any parameter regardless of range.

    const PRESET_STORAGE_KEY = 'stride_presets';
    const MAX_INLINE_PRESETS = 10;

    function _loadPresets() {
        try { return JSON.parse(localStorage.getItem(PRESET_STORAGE_KEY) || '[]'); }
        catch (e) { return []; }
    }
    function _savePresets(presets) {
        localStorage.setItem(PRESET_STORAGE_KEY, JSON.stringify(presets));
    }

    // ─── Inline preset bar (toolbar) ────────────────────────

    function _renderPresetBar() {
        const bar = document.getElementById('user-presets-bar');
        if (!bar) return;
        const presets = _loadPresets();

        if (!presets.length) {
            bar.innerHTML = '<span class="text-[8px] text-zinc-600 italic shrink-0">none</span>';
            return;
        }

        const shown = presets.slice(0, MAX_INLINE_PRESETS);
        let html = shown.map((p, i) => {
            const isMulti = p.lanes.length > 1;
            const mode = isMulti ? 'all' : 'lane';
            const color = isMulti ? 'fuchsia' : 'violet';
            return '<button onclick="sdApplyPreset(' + i + ',\'' + mode + '\')" title="' + p.name + ' (' + p.lanes.length + (p.lanes.length === 1 ? ' lane' : ' lanes') + ')" ' +
            'class="text-[9px] text-' + color + '-400 hover:text-' + color + '-300 bg-' + color + '-500/10 hover:bg-' + color + '-500/20 px-2 py-1 rounded uppercase font-bold transition-colors shrink-0 max-w-[80px] truncate">' +
            p.name + '</button>';
        }).join('');

        if (presets.length > MAX_INLINE_PRESETS) {
            html += '<button onclick="sdShowAllPresets()" class="text-[9px] text-zinc-400 hover:text-zinc-200 bg-white/5 hover:bg-white/10 px-2 py-1 rounded font-bold transition-colors shrink-0">More\u2026</button>';
        }

        bar.innerHTML = html;
    }

    // Render on startup
    _renderPresetBar();

    // ─── Save preset ────────────────────────────────────────

    window.sdSavePreset = function() {
        if (!sdCanvasParams.length) return;
        document.getElementById('preset-name-input').value = '';
        document.getElementById('preset-save-status').textContent = '';
        document.getElementById('save-preset-modal').classList.remove('hidden');
        setTimeout(() => document.getElementById('preset-name-input').focus(), 50);
    };

    window.sdConfirmSavePreset = function(scope) {
        const name = document.getElementById('preset-name-input').value.trim();
        if (!name) {
            document.getElementById('preset-save-status').textContent = 'Enter a name';
            return;
        }

        const totalBeats = sdGetBars() * 4;
        const preset = {
            name: name,
            scope: scope,
            bars: sdGetBars(),
            created: new Date().toISOString(),
            lanes: []
        };

        if (scope === 'lane') {
            const param = sdCanvasParams.find(p => p.envelopeId === sdActiveParamId);
            if (!param || !param.points.length) {
                document.getElementById('preset-save-status').textContent = 'Active lane is empty';
                return;
            }
            preset.lanes.push({
                name: param.name,
                points: param.points.map(pt => ({
                    t: pt.time / totalBeats,
                    v: pt.value,
                    curve: pt.curve || 0
                }))
            });
        } else {
            sdCanvasParams.forEach(param => {
                preset.lanes.push({
                    name: param.name,
                    points: param.points.map(pt => ({
                        t: pt.time / totalBeats,
                        v: pt.value,
                        curve: pt.curve || 0
                    }))
                });
            });
        }

        const presets = _loadPresets();
        presets.unshift(preset);
        _savePresets(presets);
        _renderPresetBar();

        document.getElementById('preset-save-status').textContent = 'Saved!';
        setTimeout(() => document.getElementById('save-preset-modal').classList.add('hidden'), 600);
    };

    // ─── All Presets modal ──────────────────────────────────

    window.sdShowAllPresets = function() {
        _renderPresetModal();
        document.getElementById('load-preset-modal').classList.remove('hidden');
    };

    function _renderPresetModal() {
        const presets = _loadPresets();
        const listEl = document.getElementById('preset-list');
        const statusEl = document.getElementById('preset-load-status');
        statusEl.textContent = '';

        if (!presets.length) {
            listEl.innerHTML = '<div class="text-[9px] text-zinc-500 text-center py-4">No saved presets</div>';
            return;
        }

        listEl.innerHTML = presets.map((p, i) => {
            const laneCount = p.lanes.length;
            const scope = p.scope === 'lane' ? '1 lane' : laneCount + ' lanes';
            const date = new Date(p.created).toLocaleDateString();
            return '<div class="flex items-center gap-2 bg-black/30 border border-white/5 rounded-lg p-2 hover:border-white/10 transition-colors">' +
                '<div class="flex-1 min-w-0">' +
                    '<div class="text-[10px] text-zinc-200 font-bold truncate">' + p.name + '</div>' +
                    '<div class="text-[8px] text-zinc-500">' + scope + ' \u00b7 ' + p.bars + ' bars \u00b7 ' + date + '</div>' +
                '</div>' +
                '<button onclick="sdApplyPreset(' + i + ',\'lane\')" title="Load to active lane" class="text-[8px] text-violet-400 bg-violet-500/10 hover:bg-violet-500/20 border border-violet-500/20 px-2 py-1 rounded uppercase font-bold transition-all shrink-0">Lane</button>' +
                (laneCount > 1 ? '<button onclick="sdApplyPreset(' + i + ',\'all\')" title="Load all lanes" class="text-[8px] text-fuchsia-400 bg-fuchsia-500/10 hover:bg-fuchsia-500/20 border border-fuchsia-500/20 px-2 py-1 rounded uppercase font-bold transition-all shrink-0">All</button>' : '') +
                '<button onclick="sdDeletePreset(' + i + ')" title="Delete" class="text-[8px] text-red-400/60 hover:text-red-400 px-1.5 py-1 transition-colors shrink-0">\u2715</button>' +
            '</div>';
        }).join('');
    }

    // ─── Apply preset ───────────────────────────────────────

    window.sdApplyPreset = function(index, mode) {
        const presets = _loadPresets();
        const preset = presets[index];
        if (!preset) return;
        if (!sdCanvasParams.length) return;

        pushUndo();
        const totalBeats = sdGetBars() * 4;

        if (mode === 'lane') {
            const param = sdCanvasParams.find(p => p.envelopeId === sdActiveParamId);
            if (!param) return;
            const srcLane = preset.lanes[0];
            if (!srcLane) return;
            param.points = srcLane.points.map(pt => ({
                time: Math.round(pt.t * totalBeats * 10000) / 10000,
                value: pt.v,
                curve: pt.curve || 0
            }));
        } else {
            preset.lanes.forEach((srcLane, i) => {
                if (i >= sdCanvasParams.length) return;
                sdCanvasParams[i].points = srcLane.points.map(pt => ({
                    time: Math.round(pt.t * totalBeats * 10000) / 10000,
                    value: pt.v,
                    curve: pt.curve || 0
                }));
            });
        }

        sdResetSliderSnapshots();
        sdRenderSidebar();
        sdDrawCanvasGrid();
        document.getElementById('load-preset-modal').classList.add('hidden');
        document.getElementById('sd-canvas-status').textContent = 'Loaded: ' + preset.name;
    };

    // ─── Delete preset ──────────────────────────────────────

    window.sdDeletePreset = function(index) {
        const presets = _loadPresets();
        presets.splice(index, 1);
        _savePresets(presets);
        _renderPresetBar();
        _renderPresetModal(); // refresh modal if open
    };

    // ─── RECENT GENERATIONS DOCK ───────────────────────────
    // Last 5 .alc files in ~/Desktop/Stride/, always visible at the bottom
    // of the canvas, each card draggable straight into Ableton.

    function _captureAlcThumbnail(alcPath) {
        // Snapshot the current canvas at the moment of Apply, scaled to 160×64.
        // Aspect ~2.5:1 matches the dock card's preview area, so object-cover
        // shows ~70% of the horizontal range instead of clipping to the start.
        try {
            const src = document.getElementById('sd-canvas');
            if (!src || !alcPath) return;
            const W = 160, H = 64;
            const off = document.createElement('canvas');
            off.width = W;
            off.height = H;
            const ctx = off.getContext('2d');
            ctx.fillStyle = '#0a0a0c';
            ctx.fillRect(0, 0, W, H);
            ctx.drawImage(src, 0, 0, src.width, src.height, 0, 0, W, H);
            const dataUrl = off.toDataURL('image/png');
            if (window.stride && window.stride.saveGenerationThumbnail) {
                window.stride.saveGenerationThumbnail(alcPath, dataUrl).catch(() => {});
            }
        } catch (e) { /* thumbnail is non-critical, swallow */ }
    }

    function _formatGenerationTime(mtimeMs) {
        try {
            const d = new Date(mtimeMs);
            const hh = String(d.getHours()).padStart(2, '0');
            const mm = String(d.getMinutes()).padStart(2, '0');
            return `${hh}:${mm}`;
        } catch (e) { return ''; }
    }

    // Tracks the mtime of the most recent generation we've already shown
    // in the dock. The leftmost card glows with the LED border ONLY when
    // its mtime exceeds this — otherwise the LED would re-fire on every
    // dock refresh (window focus, tab switch, etc.) which is noise.
    let _lastSeenGenMtime = 0;
    let _ledFadeTimer = null;

    // Snapshot the loading-spinner's center BEFORE we hide it, so the
    // fly-to-dock orb can launch from where the user's eyes were just
    // tracking. Falls back to viewport center if the overlay isn't
    // visible for any reason. Returns {x, y} in viewport coords.
    function _captureLoadingCenter() {
        try {
            const overlay = document.getElementById('stride-loading');
            if (overlay && overlay.style.display !== 'none') {
                const rect = overlay.getBoundingClientRect();
                return { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 };
            }
        } catch (e) {}
        return { x: window.innerWidth / 2, y: window.innerHeight / 2 };
    }

    // Yellow→lime glowing orb that flies from (fromX, fromY) to the
    // center of `targetCard`, scales down, and fades out as it arrives.
    // Visually connects the loading spinner to the new dock entry that
    // the LED border is about to highlight. ~650ms total.
    function _flyOrbToCard(fromX, fromY, targetCard) {
        if (!targetCard) return;
        try {
            const toRect = targetCard.getBoundingClientRect();
            const dx = (toRect.left + toRect.width / 2) - fromX;
            const dy = (toRect.top + toRect.height / 2) - fromY;
            const orb = document.createElement('div');
            orb.style.cssText = [
                'position:fixed',
                `left:${fromX}px`,
                `top:${fromY}px`,
                'width:28px',
                'height:28px',
                'margin-left:-14px',
                'margin-top:-14px',
                'border-radius:50%',
                'background:radial-gradient(circle at 35% 35%, #fef9c3, #facc15 45%, #a3e635 100%)',
                'box-shadow:0 0 18px rgba(250,204,21,0.85), 0 0 36px rgba(163,230,53,0.5)',
                'z-index:10001',
                'pointer-events:none',
                'transform:translate(0,0) scale(1)',
                'transition:transform 650ms cubic-bezier(0.4,0,0.2,1), opacity 200ms ease-out 500ms',
            ].join(';');
            document.body.appendChild(orb);
            requestAnimationFrame(() => {
                orb.style.transform = `translate(${dx}px, ${dy}px) scale(0.2)`;
                orb.style.opacity = '0';
            });
            setTimeout(() => { try { orb.remove(); } catch (e) {} }, 750);
        } catch (e) {}
    }

    async function _refreshGenerationsDock(flyFrom) {
        const cards = document.getElementById('sd-generations-cards');
        const empty = document.getElementById('sd-generations-empty');
        if (!cards) return;
        // Dock is always visible (it hosts the canvas status pills on the right).
        // Toggle between cards list and the "no generations yet" placeholder.
        if (!window.stride || !window.stride.listRecentGenerations) {
            cards.classList.add('hidden');
            if (empty) empty.classList.remove('hidden');
            return;
        }
        let items = [];
        try { items = await window.stride.listRecentGenerations(); } catch (e) {}
        if (!Array.isArray(items) || items.length === 0) {
            cards.classList.add('hidden');
            cards.innerHTML = '';
            if (empty) empty.classList.remove('hidden');
            return;
        }
        cards.classList.remove('hidden');
        if (empty) empty.classList.add('hidden');

        // Decide whether the leftmost card is "fresh" enough to glow.
        // First-load sentinel: if we've never tracked anything, treat the
        // initial render as already-seen so the LED only fires on NEW
        // generations during this session, not on every app startup.
        const newest = items[0];
        let isFresh = false;
        if (newest && _lastSeenGenMtime === 0) {
            _lastSeenGenMtime = newest.mtimeMs;
        } else if (newest && newest.mtimeMs > _lastSeenGenMtime) {
            isFresh = true;
            _lastSeenGenMtime = newest.mtimeMs;
        }

        cards.innerHTML = items.map((it, idx) => {
            const displayName = (it.name || '').replace(/\.alc$/i, '');
            const time = _formatGenerationTime(it.mtimeMs);
            const thumb = it.pngPath
                ? `<img src="file://${it.pngPath.replace(/\\/g, '/')}?t=${it.mtimeMs}" class="w-full h-full object-cover" alt="" draggable="false">`
                : `<div class="w-full h-full flex items-center justify-center text-zinc-600 text-[9px]">no preview</div>`;
            // The LED ring sits on a wrapper div so the inner card keeps
            // its overflow-hidden + rounded corners (clipping the
            // thumbnail) while the ring extends slightly outside the
            // wrapper, where it isn't clipped.
            const ledClass = (idx === 0 && isFresh) ? 'gen-card-led' : '';
            return `
                <div class="${ledClass} shrink-0 w-56 h-full rounded-md">
                    <div class="sd-gen-card relative w-full h-full rounded-md border border-white/5 hover:border-emerald-400/40 bg-black/40 hover:bg-black/60 cursor-grab active:cursor-grabbing overflow-hidden flex group transition-colors"
                         draggable="true"
                         data-idx="${idx}"
                         title="Drag into an empty clip slot in Ableton">
                        <div class="shrink-0 w-28 h-full bg-black/40 border-r border-white/5 overflow-hidden">${thumb}</div>
                        <div class="flex-1 min-w-0 px-2 py-1.5 flex flex-col justify-between">
                            <div class="text-[10px] text-zinc-200 font-bold truncate group-hover:text-emerald-200" title="${displayName}">${displayName}</div>
                            <div class="flex items-center justify-between text-[9px] text-zinc-500">
                                <span>${time}</span>
                                <svg class="w-3 h-3 text-zinc-600 group-hover:text-emerald-400" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M4 8h16M4 16h16"/></svg>
                            </div>
                        </div>
                    </div>
                </div>
            `;
        }).join('');

        // Auto-remove the LED after ~15s so the dock doesn't stay busy
        // forever after an Apply. New generations re-trigger the glow on
        // the next refresh.
        if (isFresh) {
            if (_ledFadeTimer) clearTimeout(_ledFadeTimer);
            _ledFadeTimer = setTimeout(() => {
                const led = cards.querySelector('.gen-card-led');
                if (led) led.classList.remove('gen-card-led');
                _ledFadeTimer = null;
            }, 15000);

            // Fly-from-loading orb. Wait one frame so the new card is
            // actually laid out, then launch from the captured loading
            // center toward the (now-glowing) leftmost card. Skipped if
            // the caller didn't pass a launch point — e.g., dock refreshes
            // triggered by reasons other than a fresh Apply.
            if (flyFrom) {
                requestAnimationFrame(() => {
                    const newCard = cards.querySelector('.gen-card-led');
                    if (newCard) _flyOrbToCard(flyFrom.x, flyFrom.y, newCard);
                });
            }
        }

        // Wire drag-out for each card. Same Electron startDrag bridge that
        // the apply-reveal card used — proven path into Ableton.
        Array.from(cards.querySelectorAll('.sd-gen-card')).forEach((card, idx) => {
            const item = items[idx];
            if (!item) return;
            card.addEventListener('dragstart', (e) => {
                e.preventDefault();
                if (window.stride && window.stride.startDrag) {
                    window.stride.startDrag(item.alcPath);
                }
            });
            // Windows fallback for some Electron builds
            card.addEventListener('mousedown', (e) => {
                if (e.button !== 0) return;
                if (window.stride && window.stride.startDrag) {
                    window.stride.startDrag(item.alcPath);
                }
            });
        });
    }

    // Expose the refresh so external triggers (e.g. settings reset) can call it
    window._refreshGenerationsDock = _refreshGenerationsDock;

    // ─── EXPOSE FOR GENERATION ─────────────────────────────

    window.getSdCanvasParams = function() { return sdCanvasParams; };

    // ─── ONLINE MODE: GENERATE & ACCOUNT ──────────────────

    window.openGeneratePanel = function() {
        if (!strideCloud.isOnline) { toggleAccountPanel(); return; }
        document.getElementById('gen-credits').textContent = strideCloud.credits + ' credits';
        document.getElementById('generate-panel').classList.remove('hidden');
    };
    window.closeGeneratePanel = function() {
        document.getElementById('generate-panel').classList.add('hidden');
    };

    window.runGenerate = async function() {
        const statusEl = document.getElementById('gen-status');
        statusEl.textContent = 'Generating...';
        const settings = {
            bars: sdGetBars(),
            style: document.getElementById('gen-style').value,
            bpm: parseInt(document.getElementById('gen-bpm').value) || 128,
            key: document.getElementById('gen-key').value,
            prompt: document.getElementById('gen-prompt').value,
            include_midi: document.getElementById('gen-midi').checked
        };
        const result = await strideCloud.generate(sdCanvasParams, settings);
        if (result.success) {
            // Apply returned curves to canvas
            if (result.curves && Array.isArray(result.curves)) {
                result.curves.forEach(curve => {
                    const param = sdCanvasParams.find(p => p.envelopeId === curve.envelopeId);
                    if (param) {
                        param.points = (curve.points || []).map(pt => ({ time: pt.time, value: pt.value, curve: pt.curve || 0 }));
                    }
                });
            }
            // If MIDI was generated, send to M4L
            if (result.midi && strideLink.connected) {
                strideLink.applyMidi(result.midi, sdGetBars());
            }
            document.getElementById('gen-credits').textContent = result.credits_remaining + ' credits';
            statusEl.textContent = 'Done!';
            sdRenderSidebar(); sdDrawCanvasGrid();
            setTimeout(() => closeGeneratePanel(), 1000);
        } else {
            statusEl.textContent = result.error || 'Generation failed';
        }
    };

    window.toggleAccountPanel = function() {
        const panel = document.getElementById('account-panel');
        panel.classList.toggle('hidden');
        if (strideCloud.isOnline) {
            document.getElementById('account-signed-out').classList.add('hidden');
            document.getElementById('account-signed-in').classList.remove('hidden');
            document.getElementById('account-name').textContent = strideCloud.user.display_name || strideCloud.user.email;
            document.getElementById('account-email').textContent = strideCloud.user.email;
            document.getElementById('account-credits').textContent = strideCloud.credits + ' credits';
        } else {
            document.getElementById('account-signed-out').classList.remove('hidden');
            document.getElementById('account-signed-in').classList.add('hidden');
        }
    };
    window.closeAccountPanel = function() {
        document.getElementById('account-panel').classList.add('hidden');
    };

    window.signIn = async function() {
        if (!CLOUD_GEN_ENABLED) return; // v1: cloud-gen disabled
        const serial = document.getElementById('auth-serial').value.trim();
        const email = document.getElementById('auth-email').value.trim();
        const statusEl = document.getElementById('auth-status');
        if (!serial || !email) { statusEl.textContent = 'Enter serial and email'; return; }
        statusEl.textContent = 'Validating...';
        const result = await strideCloud.signIn(serial, email);
        if (result.success) {
            statusEl.textContent = '';
            document.getElementById('generate-btn').classList.remove('hidden');
            document.getElementById('account-btn').classList.remove('hidden');
            toggleAccountPanel();
        } else {
            statusEl.textContent = result.error || 'Invalid license';
        }
    };

    window.signOut = async function() {
        if (!CLOUD_GEN_ENABLED) return;
        await strideCloud.signOut();
        document.getElementById('generate-btn').classList.add('hidden');
        document.getElementById('account-btn').classList.add('hidden');
        closeAccountPanel();
    };

    // ─── INIT ON LOAD ─────────────────────────────────────

    // Try restoring cached cloud session on startup (disabled for v1)
    (async () => {
        if (!CLOUD_GEN_ENABLED) return;
        if (window.stride) {
            const result = await window.stride.loadLicense();
            if (result.success && result.license && result.license.token) {
                const r = await strideCloud._tryOfflineAuth();
                if (r.success) {
                    document.getElementById('generate-btn').classList.remove('hidden');
                    document.getElementById('account-btn').classList.remove('hidden');
                }
            }
        }
    })();

    // ─── FIRST-RUN WELCOME ────────────────────────────────
    // Two-step first-launch flow:
    //  1. If StrideLink isn't already in the user's Ableton User Library,
    //     show the Install-to-Ableton overlay. User can Install or Skip.
    //  2. Then show the welcome/intro overlay with "Watch videos" / "Skip".
    // Both overlays fail GRACEFULLY — a missing IPC or read error never
    // traps the user on a modal.
    async function sdCheckFirstRun() {
        try {
            if (!window.stride || typeof window.stride.loadSettings !== 'function') return;
            const result = await window.stride.loadSettings();
            const settings = (result && result.success && result.settings) || {};

            // Step 1: install-to-Ableton modal (only if not already installed and not previously skipped this run)
            if (!settings.first_run_done) {
                let needsInstall = true;
                try {
                    if (window.stride.checkStrideLinkInstalled) {
                        const status = await window.stride.checkStrideLinkInstalled();
                        needsInstall = !(status && status.installed);
                    }
                } catch (e) { /* fall through — still prompt */ }
                if (needsInstall) {
                    sdShowInstallM4LOverlay(true);
                    return; // welcome overlay will chain after install modal closes
                }
                // Already installed — skip straight to welcome overlay
                const overlay = document.getElementById('sd-welcome-overlay');
                if (overlay) overlay.classList.remove('hidden');
            }
        } catch (e) {
            console.warn('First-run check failed (non-fatal):', e);
        }
    }

    // Called from titlebar "Install to Ableton" button or from sdCheckFirstRun
    // When isFirstRun is true, closing the install modal chains into the welcome modal.
    let _sdInstallIsFirstRun = false;
    function sdShowInstallM4LOverlay(isFirstRun) {
        _sdInstallIsFirstRun = !!isFirstRun;
        const overlay = document.getElementById('sd-install-m4l-overlay');
        const status = document.getElementById('sd-install-m4l-status');
        if (status) {
            status.className = 'hidden text-[10px] leading-relaxed px-3 py-2 rounded-lg';
            status.textContent = '';
        }
        if (overlay) overlay.classList.remove('hidden');
    }
    window.sdShowInstallM4LOverlay = sdShowInstallM4LOverlay;

    function sdCloseInstallM4LOverlay() {
        const overlay = document.getElementById('sd-install-m4l-overlay');
        if (overlay) overlay.classList.add('hidden');
        if (_sdInstallIsFirstRun) {
            _sdInstallIsFirstRun = false;
            // Chain into the existing welcome overlay
            const welcome = document.getElementById('sd-welcome-overlay');
            if (welcome) welcome.classList.remove('hidden');
        }
    }

    function sdSetInstallStatus(kind, msg) {
        const el = document.getElementById('sd-install-m4l-status');
        if (!el) return;
        const palette = {
            success: 'text-emerald-300 bg-emerald-500/10 border border-emerald-500/30',
            error:   'text-red-300 bg-red-500/10 border border-red-500/30',
            info:    'text-zinc-300 bg-zinc-500/10 border border-zinc-500/30'
        };
        el.className = `text-[10px] leading-relaxed px-3 py-2 rounded-lg ${palette[kind] || palette.info}`;
        el.textContent = msg;
    }

    function sdWireInstallM4LButtons() {
        const installBtn = document.getElementById('sd-install-m4l-btn');
        const skipBtn = document.getElementById('sd-install-m4l-skip-btn');
        const overlay = document.getElementById('sd-install-m4l-overlay');

        if (installBtn) {
            installBtn.addEventListener('click', async () => {
                installBtn.disabled = true;
                sdSetInstallStatus('info', 'Installing...');
                try {
                    if (!window.stride || !window.stride.installStrideLinkToAbleton) {
                        sdSetInstallStatus('error', 'Install handler not available.');
                        installBtn.disabled = false;
                        return;
                    }
                    let res = await window.stride.installStrideLinkToAbleton();
                    // If User Library auto-detection failed, offer a folder picker
                    if (res && !res.success && res.error === 'userLibraryNotFound') {
                        sdSetInstallStatus('info', "Couldn't find your Ableton User Library. Please choose the folder manually.");
                        const picked = window.stride.pickUserLibraryFolder
                            ? await window.stride.pickUserLibraryFolder()
                            : null;
                        if (!picked) {
                            sdSetInstallStatus('error', 'Cancelled — no folder selected.');
                            installBtn.disabled = false;
                            return;
                        }
                        res = await window.stride.installStrideLinkToAbleton(picked);
                    }
                    if (res && res.success) {
                        sdSetInstallStatus('success', `Installed to ${res.targetDir}. In Ableton, open User Library → Stride → drag StrideLink onto a track.`);
                        // Auto-dismiss after a moment so the user sees the confirmation
                        setTimeout(() => {
                            sdCloseInstallM4LOverlay();
                            // Persist the "first run done" flag so we don't ask again
                            sdMarkFirstRunDone(true);
                        }, 2600);
                    } else {
                        sdSetInstallStatus('error', (res && res.error) || 'Install failed. Please try again.');
                        installBtn.disabled = false;
                    }
                } catch (e) {
                    sdSetInstallStatus('error', e.message || 'Install failed.');
                    installBtn.disabled = false;
                }
            });
        }
        if (skipBtn) {
            skipBtn.addEventListener('click', () => {
                sdCloseInstallM4LOverlay();
                // Don't mark first-run done yet — only skipping THIS step;
                // sdCloseInstallM4LOverlay chains into the welcome modal, which marks done.
            });
        }
        // Backdrop click + Escape to dismiss (never trap the user)
        if (overlay) {
            overlay.addEventListener('click', (e) => {
                if (e.target === overlay) sdCloseInstallM4LOverlay();
            });
        }
        document.addEventListener('keydown', (e) => {
            if (e.key === 'Escape' && overlay && !overlay.classList.contains('hidden')) {
                sdCloseInstallM4LOverlay();
            }
        });
    }

    async function sdMarkFirstRunDone(skipHideOverlay) {
        // Always hide the overlay first, even if the save fails — we never
        // want a user stuck staring at the welcome card because of a
        // background settings-write error.
        // When called from the install success path, the welcome overlay
        // was never opened, so skipHideOverlay=true avoids touching it.
        if (!skipHideOverlay) {
            const overlay = document.getElementById('sd-welcome-overlay');
            if (overlay) overlay.classList.add('hidden');
        }
        try {
            if (!window.stride || typeof window.stride.saveSettings !== 'function') return;
            const result = await window.stride.loadSettings();
            const settings = (result && result.success && result.settings) || {};
            settings.first_run_done = true;
            await window.stride.saveSettings(settings);
        } catch (e) {
            console.warn('Mark first-run done failed (non-fatal):', e);
        }
    }

    function sdWireWelcomeButtons() {
        const overlay = document.getElementById('sd-welcome-overlay');
        const videosBtn = document.getElementById('sd-welcome-videos-btn');
        const skipBtn = document.getElementById('sd-welcome-skip-btn');
        if (videosBtn) {
            videosBtn.addEventListener('click', async () => {
                // Try to open the Guide folder — non-blocking, don't let
                // a folder-open failure trap the user on the welcome screen
                try {
                    if (window.stride && window.stride.openGuideFolder) {
                        await window.stride.openGuideFolder();
                    }
                } catch (e) { /* silent */ }
                sdMarkFirstRunDone();
            });
        }
        if (skipBtn) {
            skipBtn.addEventListener('click', sdMarkFirstRunDone);
        }
        // Escape hatches so the user can NEVER be trapped on this screen:
        //   - click outside the card (on the dim backdrop)
        //   - press Escape
        if (overlay) {
            overlay.addEventListener('click', (e) => {
                if (e.target === overlay) sdMarkFirstRunDone();
            });
        }
        document.addEventListener('keydown', (e) => {
            if (e.key === 'Escape' && overlay && !overlay.classList.contains('hidden')) {
                sdMarkFirstRunDone();
            }
        });
    }

    // Expose sdCheckFirstRun globally so index.html's unlockApp() can call
    // it after the license activation overlay is removed. This ensures the
    // welcome overlay NEVER stacks on top of the license screen — it only
    // appears after the app has been unlocked.
    window.sdCheckFirstRun = sdCheckFirstRun;

    // Init canvas immediately (no need to wait for rack scan — grid shows empty)
    document.addEventListener('DOMContentLoaded', () => {
        initSdCanvas();
        setTimeout(() => sdResizeCanvas(), 100);
        // Wire welcome buttons immediately (so clicks work when the welcome
        // overlay eventually appears), and paint the empty-canvas CTA. We
        // DO NOT call sdCheckFirstRun here — that's triggered by unlockApp()
        // in index.html after the license screen dismisses.
        sdWireWelcomeButtons();
        sdWireInstallM4LButtons();
        sdUpdateEmptyState();
        sdUpdateToolAvailability();
        _wireDragHandle();
        _refreshGenerationsDock();
    });

})();
