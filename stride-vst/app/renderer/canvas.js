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
    // ─── Lane selection ─────────────────────────────────────
    // Each lane has a `selected: boolean` field (the reverse of `locked`).
    // When any lane is selected, tools target the selection set instead of
    // the active lane. Selection visually highlights the lane the same way
    // the active lane is currently highlighted (brighter opacity).
    //
    // Selection is session-only — not persisted to canvas state on disk.
    // Lock is intent ("don't touch this"); selection is "I'm focusing here
    // right now". Different lifetimes.
    //
    // Multi-select gestures (no mode toggle — always available in multi-view):
    //   - Ctrl/Cmd + click on any lane → toggle that lane's selection
    //   - Ctrl/Cmd + drag through lanes → add every dragged-over lane
    //   - "Select All" toolbar button → all unlocked lanes (click again clears)

    // ─── Drag-select state (multi-view + Ctrl/Cmd) ─────────
    // Click-drag with Ctrl held picks up every lane the cursor passes over.
    // The gesture is decided by WHERE the cursor goes, not by pixels: reaching a
    // DIFFERENT lane promotes to a drag-sweep (additive — the start lane joins and
    // STAYS selected); releasing while still on the start lane is a click (toggle,
    // fired on mouseup, so any amount of in-lane wobble still deselects reliably).
    // Was a 3px promotion threshold — that let a Ctrl+drag that STARTED on a selected
    // lane silently kick it out of the group ("drag is additive" violated for lane #1;
    // field report 2026-07-16). Wired in the multi-view mousedown branch + the global
    // mousemove handler near the wheel/mouseup section.
    let _sdDragSelectPending = null;     // { laneId, startWasSelected } at Ctrl+mousedown (no toggle yet)
    let _sdDragSelectActive = false;     // promoted true once the cursor reaches another lane
    let _sdDragSelectVisited = new Set();
    let _sdEdgeScrollRaf = 0;
    let _sdEdgeScrollLastTickAt = 0;
    let _sdLastMouseClientY = 0;
    const SD_EDGE_SCROLL_ZONE_PX = 40;

    let sdViewZoomX = 1;
    let sdViewPanX = 0;
    // Pan trigger is middle-mouse-button (Ableton convention) — no keyboard
    // state needed. The legacy sdIsSpacePressed variable was removed when
    // pan switched from Space+drag to middle-click+drag.
    let sdIsPanning = false;
    let sdLastMouseX = 0;

    // ─── GRID RESOLUTION (Ableton-style) ─────────────────────────────────
    // Default is ADAPTIVE: sdGridIndex === null means the visual grid AND all
    // snapping follow the zoom level exactly as they always have (nothing
    // changes). The moment the user presses Ctrl/Cmd+1/2/3 the grid locks to a
    // fixed rung and every edit (draw, drag, freehand) snaps to it — 1:1 with
    // Live, where the grid drives snapping. Ctrl/Cmd+5 flips back to adaptive.
    // Session-only; not persisted. Time is in beats (1 beat = a 1/4 note;
    // totalBeats = bars * 4).
    const SD_GRID_LADDER = [
        { beats: 4,      label: '1 bar' },   // 0  coarsest
        { beats: 2,      label: '1/2'   },   // 1
        { beats: 1,      label: '1/4'   },   // 2
        { beats: 0.5,    label: '1/8'   },   // 3
        { beats: 0.25,   label: '1/16'  },   // 4  (matches adaptive at ≤3× zoom)
        { beats: 0.125,  label: '1/32'  },   // 5
        { beats: 0.0625, label: '1/64'  },   // 6  finest
    ];
    const SD_GRID_TRIPLET = 2 / 3;           // triplet spacing = straight × 2/3
    let sdGridIndex = null;                  // null = adaptive
    let sdGridTriplet = false;

    // Zoom-derived step used in adaptive mode (mirrors the historical values).
    function sdAdaptiveGridBeats() {
        let s = 0.25;
        if (sdViewZoomX > 3) s = 0.125;
        if (sdViewZoomX > 8) s = 0.0625;
        return s;
    }
    // Fixed grid spacing in beats (triplet applied), or null when adaptive.
    function sdManualGridBeats() {
        if (sdGridIndex === null) return null;
        return SD_GRID_LADDER[sdGridIndex].beats * (sdGridTriplet ? SD_GRID_TRIPLET : 1);
    }
    // Spacing the visual grid renders at — manual if set, else adaptive.
    function sdVisualGridBeats() {
        const m = sdManualGridBeats();
        return m !== null ? m : sdAdaptiveGridBeats();
    }
    function sdNearestGridIndex(beats) {
        let best = 4, bestErr = Infinity;
        for (let i = 0; i < SD_GRID_LADDER.length; i++) {
            const err = Math.abs(SD_GRID_LADDER[i].beats - beats);
            if (err < bestErr) { bestErr = err; best = i; }
        }
        return best;
    }
    // Snap a beat to an arbitrary grid spacing, rounded to stable precision
    // (triplet spacings are repeating decimals).
    function sdSnapToBeats(t, step) {
        return Math.round((Math.round(t / step) * step) * 10000) / 10000;
    }
    // Edit snap: a manual grid wins; otherwise fall back to the site's existing
    // zoom-derived divisions so adaptive behavior is byte-for-byte unchanged.
    function sdSnapDrawBeat(t) {
        const g = sdManualGridBeats();
        if (g !== null) return sdSnapToBeats(t, g);
        let d = 4; if (sdViewZoomX > 3) d = 8; if (sdViewZoomX > 8) d = 16;
        return Math.round(t * d) / d;
    }
    function sdSnapFreehandBeat(t) {
        const g = sdManualGridBeats();
        if (g !== null) return sdSnapToBeats(t, g);
        let d = 8; if (sdViewZoomX > 3) d = 16;
        return Math.round(t * d) / d;
    }
    function sdGridLabel() {
        if (sdGridIndex === null) return 'Adaptive';
        const lab = SD_GRID_LADDER[sdGridIndex].label;
        if (!sdGridTriplet) return lab;
        return lab.charAt(0) === '1' && lab.charAt(1) === '/' ? lab + 'T' : lab + ' T';
    }
    let _sdGridStatusTimer = null;
    function sdGridChanged() {
        sdDrawCanvasGrid();
        const status = document.getElementById('sd-canvas-status');
        if (!status) return;
        status.textContent = 'Grid: ' + sdGridLabel();
        if (_sdGridStatusTimer) clearTimeout(_sdGridStatusTimer);
        _sdGridStatusTimer = setTimeout(() => {
            if (status.textContent.indexOf('Grid: ') === 0) status.textContent = '';
        }, 1600);
    }
    // First manual change from adaptive seeds the rung nearest the current
    // zoom-derived step, so the switch is visually seamless.
    function sdGridSeedFromAdaptive() {
        if (sdGridIndex === null) sdGridIndex = sdNearestGridIndex(sdAdaptiveGridBeats());
    }
    function sdGridNarrow() {             // Ctrl/Cmd+1 — finer
        sdGridSeedFromAdaptive();
        sdGridIndex = Math.min(SD_GRID_LADDER.length - 1, sdGridIndex + 1);
        sdGridChanged();
    }
    function sdGridWiden() {              // Ctrl/Cmd+2 — coarser
        sdGridSeedFromAdaptive();
        sdGridIndex = Math.max(0, sdGridIndex - 1);
        sdGridChanged();
    }
    function sdGridToggleTriplet() {      // Ctrl/Cmd+3
        sdGridSeedFromAdaptive();
        sdGridTriplet = !sdGridTriplet;
        sdGridChanged();
    }
    function sdGridToggleAdaptive() {     // Ctrl/Cmd+5 — fixed <-> adaptive
        if (sdGridIndex === null) {
            sdGridIndex = sdNearestGridIndex(sdAdaptiveGridBeats());
        } else {
            sdGridIndex = null;
            sdGridTriplet = false;
            _sdPaintTripletUI();          // adaptive clears the lock — the T pill must follow
            _sdSaveTriplet();
        }
        sdGridChanged();
    }

    // ── Triplet grid LOCK (1.1.11) ──────────────────────────────────
    // The triplet grid itself shipped long ago (Ctrl+3, ×2/3 spacing at every ladder
    // rung — drawing/snapping/visual grid all honor it). What was missing: a VISIBLE
    // toggle, persistence, and the motion tools following it. sdMotionStep is the one
    // funnel every generator's hardcoded straight step goes through — 1/16 becomes
    // 1/16T (= 1/24 bar) under the lock, so Sine/Pump/Glitch/S&H/Acid pulse in triplets.
    function sdMotionStep(s) { return sdGridTriplet ? s * SD_GRID_TRIPLET : s; }
    window.sdTripletLocked = function() { return sdGridTriplet; };
    function _sdPaintTripletUI() {
        document.querySelectorAll('.sd-trip-btn').forEach(b => {
            if (sdGridTriplet) { b.style.background = '#e879f9'; b.style.color = '#0a0a0a'; b.style.borderColor = '#e879f9'; }
            else { b.style.background = ''; b.style.color = ''; b.style.borderColor = ''; }
        });
        // Swing is a straight-grid feel — shifting straight subdivisions TOWARD triplets.
        // On a triplet grid it is musically undefined, so the buttons stand down.
        document.querySelectorAll('button[onclick="sdApplySwing()"]').forEach(b => {
            b.style.opacity = sdGridTriplet ? '0.35' : '';
            b.title = sdGridTriplet ? 'Swing is a straight-grid feel — disabled on the triplet grid' : '';
        });
    }
    async function _sdSaveTriplet() {
        try {
            if (!window.stride || !window.stride.saveSettings) return;
            const r = await window.stride.loadSettings();
            const s = (r && r.success && r.settings) || {};
            s.gridTriplet = sdGridTriplet;
            await window.stride.saveSettings(s);
        } catch (e) { /* non-critical */ }
    }
    window.sdToggleTripletLock = function() {
        sdGridToggleTriplet();     // seeds a fixed grid from adaptive + flips the flag + status toast
        _sdPaintTripletUI();
        _sdSaveTriplet();
    };
    // Boot restore — the lock is a workflow mode, so it survives reopen.
    setTimeout(async function() {
        try {
            if (window.stride && window.stride.loadSettings) {
                const r = await window.stride.loadSettings();
                if (r && r.success && r.settings && r.settings.gridTriplet && !sdGridTriplet) {
                    sdGridSeedFromAdaptive();
                    sdGridTriplet = true;
                    sdGridChanged();
                }
            }
        } catch (e) {}
        _sdPaintTripletUI();
    }, 400);

    let _sdSmoothSnapshot = null;
    let _sdSmoothParamId = null;
    let _sdIntensitySnapshot = null;
    let _sdIntensityParamId = null;
    let sdBars = 8;
    let sdCanvasInitialized = false;
    let currentRackId = null; // For local state saving
    let currentDeviceName = null; // For template matching

    // Per-CLIP canvas state. The clip in Live's detail view is the source of
    // truth, so each clip on a track carries its own curves (the variations
    // workflow). Slot 0 keeps the legacy rack key, so every canvas saved before
    // this change still loads as that track's primary clip.
    let currentClipSlot = 0;
    let currentClipKey = null;
    let currentTrackIndex = -1;        // absolute LOM track index — UNIQUE per track
    let currentLegacyKey = null;       // pre-track-index (name-based) key, for migration fallback on restore
    const _sdAutoReadAttempted = {};   // clipKey -> true: auto-read an empty clip's automation only once
    let _sdReadFillOnly = false;       // true while an AUTO-read is in flight: clip_curves_read then fills ONLY empty lanes, so a late read can't clobber curves you just applied (the duplicate-clip "reverts to previous curves" bug). A manual "Pull curves" sets it false → it overwrites.
    let _sdCurveEpoch = 0;             // bumped on every curve edit (pushUndo); lets an in-flight async restoreCanvasState detect that you applied curves mid-load and NOT overwrite them.
    let _sdRangeDrag = null;           // active per-param range boundary drag: {param, edge:'rangeMin'|'rangeMax', rect}
    let _sdRangeIconClick = null;      // {id, t} — for double-click-to-reset on the range icon
    let _sdRangeNumDrag = null;        // scrubbing a numeric min/max field: {param, edge, startY, startVal}
    let _sdRangeFieldRects = [];       // per-render hit rects for the min/max fields: {param, edge, x, y, w, h}
    let _sdRangeFieldClick = null;     // {id, edge, t} — double-click-to-type detection on a field
    let _sdRangeNumInput = null;       // {id, edge, el} — the transient <input> shown while typing a value
    let _sdLoopDrag = null;            // active per-lane loop-boundary drag (wrapper): {param}
    let _sdGlowRAF = 0;                // param-touch glow: RAF handle for the 1s fade repaint loop (wrapper)
    let _sdGlowLast = 0;               //   ... last repaint timestamp (throttles the loop to ~30fps)
    let _sdGlowPaint = false;          //   ... true during glow-driven repaints, so the drive-flush stays silent
    function _sdClipKey(rackId, slot) {
        return (slot && slot > 0) ? (rackId + '_s' + slot) : rackId;
    }
    // A DUPLICATED track shares its name, device, params AND clip slot with the
    // original — so name alone can't tell them apart, and switching back to the
    // original clip looks like "nothing changed". The scanned params carry their
    // absolute LOM path ("live_set tracks N …"), so the track index comes for
    // free; we use it to key per-clip state and to gate the no-op guard.
    function _sdTrackIdxFromParams(params) {
        try {
            const p = (params || [])[0];
            const m = p && p._path && String(p._path).match(/tracks (\d+)/);
            return m ? parseInt(m[1], 10) : -1;
        } catch (e) { return -1; }
    }
    let currentTemplatePath = null; // Resolved template file path
    let templateMatchState = 'none'; // 'exact', 'fallback', 'none'

    // ─── Pattern Library armed state ─────────────────────
    // When the user picks a pattern from the Library overlay, it sits in
    // sdArmedPattern until Apply to Clip runs (or they clear the chip).
    // Notes are pre-expanded to the current canvas bar count by the
    // library UI; if the user changes bars after arming, the chip stays
    // but the next Apply re-expands from rawNotes.
    let sdArmedPattern = null;
    // Shape: {
    //   id, name, bars, key, bpm,
    //   rawNotes: [{pitch, time, duration, velocity}],   // pattern source
    //   expandedNotes: same shape, looped to canvas bars at arm time
    //   expandedForBars: number,                         // bars they were expanded for
    // }

    // ─── MULTI-LANE VIEW ─────────────────────────────────
    // Stride has two canvas view modes:
    //   'multi' = every parameter gets its own horizontal strip stacked
    //             vertically. Default — teaches the tool's purpose
    //             instantly (you see the whole rack modulating at once).
    //   'focus' = one active lane fills the full canvas height. Better
    //             for precise per-lane editing. One click away.
    let sdViewMode = 'multi';
    let _sdFocusBackRect = null;              // hit rect for the focus-view "← All lanes" pill (null in multi)
    let _sdUnmapRects = [];                    // per-lane unmap-× hit rects (wrapper lanes only), rebuilt each multi-view draw
    let _sdColorRects = [];                    // per-lane color-bar hit rects (the 1.1.11 palette popup), rebuilt each multi-view draw
    let _sdHoverUnmapId = null;                // envelopeId of the unmap × under the cursor (grey by default, red on hover)
    let sdDeviceFilter = null;                // multi view: show only this device's lanes (null = all) — set by clicking a chain device
    let sdMultiScrollOffset = 0;              // # of lanes scrolled off the top
    const SD_MULTI_LANE_HEIGHT = 64;          // px per lane in multi view
    const SD_MULTI_LABEL_WIDTH = 148;         // px reserved on the left for the param name (widened for the 1.1.11 big-name header; every icon hit zone derives from this constant, so clicks stay aligned)

    // Case-insensitive name comparator. Used to sort the param list right
    // after a scan so identically-named macros (e.g. multiple "Filter Cutoff"
    // lanes) sit adjacent. Adjacency is what makes Reflector pair like-with-
    // like and what lets the user Ctrl+drag through a group of similar params
    // in one quick gesture. Stable secondary key on envelopeId keeps lane
    // order deterministic across reloads.
    function _sdSortByName(a, b) {
        const cmp = a.name.localeCompare(b.name, undefined, { sensitivity: 'base' });
        if (cmp !== 0) return cmp;
        return String(a.envelopeId).localeCompare(String(b.envelopeId));
    }

    // ─── UNDO / REDO ─────────────────────────────────────
    let undoStack = [];
    let redoStack = [];
    const MAX_UNDO = 50;

    let _sdDirty = false;   // un-injected curve changes exist; drives the "INJECT TO CLIP" shout in the StrideQuick device status
    // One undo entry = points + lane color per lane. colorIdx lives OUTSIDE `points`
    // (motion tools never touch it), so it must be snapshotted explicitly — painting a
    // group then Ctrl+Z restored nothing before 1.1.12 (field report 2026-07-27).
    function _sdUndoSnapshot() {
        return sdCanvasParams.map(p => ({
            envelopeId: p.envelopeId,
            points: p.points.map(pt => ({ time: pt.time, value: pt.value, curve: pt.curve || 0 })),
            colorIdx: (typeof p.colorIdx === 'number' ? p.colorIdx : -1),
            // Ranges ride the undo too (field report 2026-08-11: Ctrl+Z after a band edit
            // left the range where it was — ranges were never snapshotted).
            rangeOn: !!p.rangeOn,
            rangeMin: (typeof p.rangeMin === 'number' ? p.rangeMin : 0),
            rangeMax: (typeof p.rangeMax === 'number' ? p.rangeMax : 1)
        }));
    }

    function pushUndo() {
        _sdDirty = true;    // any curve edit makes the clip stale until the next inject
        _sdCurveEpoch++;    // mark a fresh edit so an in-flight restoreCanvasState won't clobber it
        undoStack.push(_sdUndoSnapshot());
        if (undoStack.length > MAX_UNDO) undoStack.shift();
        redoStack = []; // clear redo on new action
    }

    function applySnapshot(snapshot) {
        snapshot.forEach(sp => {
            const param = sdCanvasParams.find(p => p.envelopeId === sp.envelopeId);
            if (!param) return;
            param.points = sp.points.map(pt => ({ ...pt }));
            // Restore the lane color too — and TELL THE ENGINE. Colors are engine-owned on
            // the wrapper (like ranges): a canvas-only restore would be re-painted by the
            // next rack_scanned echo and persisted wrong into the project. Old snapshots
            // (pre-color builds) carry no colorIdx — leave those lanes untouched.
            if (typeof sp.colorIdx === 'number') {
                const cur = (typeof param.colorIdx === 'number' ? param.colorIdx : -1);
                if (cur !== sp.colorIdx) {
                    param.colorIdx = sp.colorIdx;
                    _sdPushColorToEngine(param);
                }
            }
            // Restore the range band too — engine-owned like colors (a canvas-only
            // restore would be re-painted by the next rack_scanned echo), so TELL THE
            // ENGINE when it actually changed. Old snapshots (pre-range) carry no
            // rangeOn — those lanes stay untouched.
            if (typeof sp.rangeOn === 'boolean') {
                const curMin = (typeof param.rangeMin === 'number' ? param.rangeMin : 0);
                const curMax = (typeof param.rangeMax === 'number' ? param.rangeMax : 1);
                if (!!param.rangeOn !== sp.rangeOn || Math.abs(curMin - sp.rangeMin) > 1e-6 || Math.abs(curMax - sp.rangeMax) > 1e-6) {
                    param.rangeOn = sp.rangeOn;
                    param.rangeMin = sp.rangeMin;
                    param.rangeMax = sp.rangeMax;
                    _sdPushRangeToEngine(param);
                }
            }
        });
        sdResetSliderSnapshots(); sdRenderSidebar(); sdDrawCanvasGrid();
    }

    // Empty-stack clicks ANSWER instead of silently returning — a no-op that looks
    // identical to a dead button reads as "undo is buggy" (field report, Bitwig 2026-07-27).
    window.sdUndo = function() {
        const st = document.getElementById('sd-canvas-status');
        if (!undoStack.length) { if (st) st.textContent = 'Nothing to undo'; return; }
        redoStack.push(_sdUndoSnapshot());   // save current state to redo
        applySnapshot(undoStack.pop());
        if (st) st.textContent = 'Undo';
    };

    window.sdRedo = function() {
        const st = document.getElementById('sd-canvas-status');
        if (!redoStack.length) { if (st) st.textContent = 'Nothing to redo'; return; }
        undoStack.push(_sdUndoSnapshot());   // save current state to undo
        applySnapshot(redoStack.pop());
        if (st) st.textContent = 'Redo';
    };

    // ─── BARS ─────────────────────────────────────────────

    // Valid loop-length values (matches the toolbar pill row).
    const SD_VALID_BARS = [2, 4, 8, 16, 32];
    function sdValidateBars(val) {
        const n = parseInt(val, 10);
        return SD_VALID_BARS.includes(n) ? n : 4;
    }

    function sdGetBars() {
        if (sdBars > 0) return sdBars;
        return 8;
    }
    // Exposed so the Pattern Library overlay can default its bar filter
    // to whatever the canvas currently shows.
    window.sdGetBars = sdGetBars;

    // Debounced settings.json write so rapid-fire bar clicks don't hammer
    // disk. Stride remembers the last bar count the user picked and
    // applies it on next launch / new rack scan.
    let _sdBarsSaveTimer = null;
    function _persistLastUsedBars(val) {
        if (!window.stride || !window.stride.loadSettings || !window.stride.saveSettings) return;
        if (_sdBarsSaveTimer) clearTimeout(_sdBarsSaveTimer);
        _sdBarsSaveTimer = setTimeout(async () => {
            try {
                const res = await window.stride.loadSettings();
                const settings = (res && res.settings) || {};
                settings.lastUsedBars = sdValidateBars(val);
                await window.stride.saveSettings(settings);
            } catch (e) { /* non-critical */ }
        }, 500);
    }

    // Cached sticky value so scan / clip_changed handlers can resolve it
    // synchronously without re-reading settings.json.
    let _sdStickyBars = null;

    // sdSetBars(val, persist=true)
    //   persist=true  → user clicked a bar pill, write to settings.json (sticky)
    //   persist=false → system-driven (rack scan, clip change, session load).
    //                   We must NOT overwrite the user's preference in this case.
    window.sdSetBars = function(val, persist) {
        if (persist === undefined) persist = true;
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
        if (persist) {
            _sdStickyBars = sdValidateBars(val);
            _persistLastUsedBars(val);
        }
    };

    // Exposed for the VST wrapper: read the current bar count (so the live-curve
    // push can tell the host its loop length) + a one-shot "set bars AND push" so
    // a bar-length change updates the hosted synth's loop immediately.
    window.sdGetBars = sdGetBars;
    window.sdSetBarsAndPush = function(n) { window.sdSetBars(n, true); try { saveCanvasState(); } catch (e) {} };

    // Resolve which bar count to use when the system (scan / clip_changed)
    // wants to set bars.
    // WRAPPER: the ENGINE is the single source of truth for the loop length —
    // its clip_bars echo ALWAYS wins, exactly like ranges and colors. A sticky
    // localStorage preference overriding the engine is a split-brain generator:
    // stale/reset WebView storage snaps the canvas to old bars while the engine
    // keeps playing the real loop (field report 2026-07-27: 32-bar lanes
    // "became 4 bars" after adding a device — 4 is both this resolver's fallback
    // and the engine default, so every desync lands there).
    // DESKTOP: unchanged — "system" is the Ableton clip value, and the user's
    // sticky pill choice keeps winning over it as designed.
    function _sdResolveSystemBars(systemVal) {
        if (window.strideLink && window.strideLink._wrapper) return systemVal;   // engine-owned in the wrapper
        if (_sdStickyBars && SD_VALID_BARS.includes(_sdStickyBars)) return _sdStickyBars;
        return systemVal;
    }

    // Read the user's last-used bar count from settings.json and apply it.
    // Called once during canvas init AFTER the toolbar is in the DOM.
    // Skipped silently if the setting is missing/invalid (falls back to
    // whatever the toolbar's default-selected pill was, currently 8).
    // ─────────────────────────────────────────────────────────────────────
    // SKINS — design-only theming. Chrome colors come from CSS vars swapped by
    // the [data-skin] attribute on <html> (see index.html); the canvas (drawn
    // in JS) reads its accent colors from sdSkinColors below. Switching a skin
    // ONLY changes colors — no layout, tools, math, or data are affected.
    // ─────────────────────────────────────────────────────────────────────
    const SD_SKIN_ORDER  = ['copper', 'steel', 'brass', 'teal', 'patch', 'midnight'];
    const SD_SKIN_LABELS = { copper:'Copper', steel:'Steel', brass:'Brass', teal:'Teal', patch:'Patch', midnight:'Midnight' };
    // Per-skin canvas accent colors. `rgb` = curve channels for rgba() builds;
    // `curve`/`hi` = solid stroke + highlight; `labelRGB` = highlighted-lane
    // label. `patch` (multi mode) gives each lane its own color by index.
    const SD_SKIN_COLORS = {
        midnight: { rgb:'168,85,247',  curve:'#a855f7', hi:'#c084fc', labelRGB:'232,121,249' },
        copper:   { rgb:'169,159,194', curve:'#a99fc2', hi:'#c6bce0', labelRGB:'169,159,194' },
        steel:    { rgb:'134,176,203', curve:'#86b0cb', hi:'#b6d6ee', labelRGB:'134,176,203' },
        brass:    { rgb:'159,174,134', curve:'#9fae86', hi:'#c5d3a6', labelRGB:'159,174,134' },
        teal:     { rgb:'147,178,194', curve:'#93b2c2', hi:'#bcd9e8', labelRGB:'147,178,194' },
        patch:    { rgb:'169,159,194', curve:'#a99fc2', hi:'#c6bce0', labelRGB:'169,159,194',
                    patch:['198,113,43','47,116,142','91,123,85','163,78,82','84,75,109'] },
    };
    let sdCurrentSkin = 'copper';
    let sdSkinColors = SD_SKIN_COLORS.copper;
    // Curve channels for a given lane: a multi-color skin (Patch) gives each
    // param its own stable color by index; every other skin uses one color.
    function sdLaneRGB(paramIdx) {
        if (sdSkinColors.patch) return sdSkinColors.patch[paramIdx % sdSkinColors.patch.length];
        return sdSkinColors.rgb;
    }
    // ── per-lane colors (1.1.11) ──────────────────────────────────────
    // 12 fixed swatches: the 5 Patch-skin hues first (so an AUTO color is "pinnable"
    // as-is), then 7 new hues curated for distinctness on the dark canvas. A lane's
    // colorIdx (-1 / absent = AUTO) overrides the positional skin rotation. Engine-owned
    // on the wrapper (set_color / rack_scanned echo) exactly like ranges — positional
    // re-pushes must never wipe or misroute a chosen color.
    const SD_LANE_PALETTE = [
        '198,113,43', '47,116,142', '91,123,85', '163,78,82', '84,75,109',   // = Patch skin
        '227,169,64', '196,90,172', '72,182,164', '126,166,232', '164,196,84', '214,120,96', '226,226,232'
    ];
    function sdLaneColor(param, paramIdx) {
        if (param && typeof param.colorIdx === 'number' && param.colorIdx >= 0 && param.colorIdx < SD_LANE_PALETTE.length)
            return SD_LANE_PALETTE[param.colorIdx];
        return sdLaneRGB(paramIdx);
    }
    // Measured ellipsis truncation for the big lane labels (char counting lies at 17px).
    function _sdFitText(ctx, txt, maxW) {
        if (maxW <= 0) return '';
        if (ctx.measureText(txt).width <= maxW) return txt;
        let lo = 0, hi = txt.length;
        while (lo < hi) {
            const mid = (lo + hi + 1) >> 1;
            if (ctx.measureText(txt.slice(0, mid) + '…').width <= maxW) lo = mid; else hi = mid - 1;
        }
        return lo > 0 ? txt.slice(0, lo) + '…' : '…';
    }
    function sdApplySkin(name, persist) {
        if (!SD_SKIN_COLORS[name]) name = 'copper';
        sdCurrentSkin = name;
        sdSkinColors = SD_SKIN_COLORS[name];
        try { document.documentElement.dataset.skin = name; } catch (e) {}
        const nameEl = document.getElementById('sd-skin-name');
        if (nameEl) nameEl.textContent = SD_SKIN_LABELS[name];
        if (typeof sdDrawCanvasGrid === 'function') sdDrawCanvasGrid();
        if (persist) sdSaveSkin(name);
    }
    // Cycle to the next skin (wired to the title-bar swatch).
    window.strideCycleSkin = function() {
        const i = SD_SKIN_ORDER.indexOf(sdCurrentSkin);
        sdApplySkin(SD_SKIN_ORDER[(i + 1) % SD_SKIN_ORDER.length], true);
    };
    async function sdSaveSkin(name) {
        try {
            if (!window.stride || typeof window.stride.saveSettings !== 'function') return;
            const result = await window.stride.loadSettings();
            const settings = (result && result.success && result.settings) || {};
            settings.skin = name;
            await window.stride.saveSettings(settings);
        } catch (e) { /* non-critical */ }
    }
    async function sdInitSkin() {
        let name = 'copper';
        try {
            if (window.stride && window.stride.loadSettings) {
                const res = await window.stride.loadSettings();
                const saved = res && res.settings && res.settings.skin;
                if (saved && SD_SKIN_COLORS[saved]) name = saved;
            }
        } catch (e) { /* fall back to default */ }
        sdApplySkin(name, false);
    }

    async function sdApplyStickyBars() {
        if (!window.stride || !window.stride.loadSettings) return;
        try {
            const res = await window.stride.loadSettings();
            const last = res && res.settings && res.settings.lastUsedBars;
            if (last && SD_VALID_BARS.includes(parseInt(last, 10))) {
                // Apply WITHOUT triggering the persist write — we just read it.
                sdBars = parseInt(last, 10);
                _sdStickyBars = sdBars;
                document.querySelectorAll('.sd-bars-btn').forEach(btn => {
                    const btnVal = parseInt(btn.textContent);
                    btn.className = btnVal === sdBars
                        ? 'sd-bars-btn text-[11px] text-fuchsia-400 bg-fuchsia-500/20 px-3 py-1 rounded font-bold transition-colors'
                        : 'sd-bars-btn text-[11px] text-zinc-400 hover:text-fuchsia-400 px-3 py-1 rounded font-bold transition-colors';
                });
                sdDrawCanvasGrid();
            }
        } catch (e) { /* non-critical */ }
    }

    // Auto-Rescan toggle for the StrideQuick MOTION buttons. GREEN/ON (default) =
    // rescan-then-apply (the original behavior — always syncs 1:1 to the current
    // rack before applying; silent when the canvas runs hidden). GREY/OFF = apply on
    // the loaded params only, for cranking the same rack repeatedly without a scan.
    // Canvas-owned + persisted (no bridge → no race); the device ↻ button toggles it
    // and its color reflects via quick_state.rescan. SAFETY: even when OFF, a Motion
    // press still rescans if the track/clip changed since the last scan (the
    // _sdContextDirty guard in sdHandleQuickCommand) so it can never apply a stale rack.
    function _sdPaintAutoRescanBtn() {
        const b = document.getElementById('sd-autorescan-btn');
        if (!b) return;
        b.textContent = 'Rescan: ' + (sdAutoRescan ? 'ON' : 'OFF');
        b.className = (sdAutoRescan
            ? 'text-[9px] text-emerald-400/90 hover:text-emerald-300 bg-emerald-500/10 border border-emerald-500/30'
            : 'text-[9px] text-zinc-500 hover:text-zinc-300 bg-white/5 border border-white/10')
            + ' px-2 py-0.5 rounded uppercase tracking-wider font-bold transition-colors shrink-0';
        b.title = sdAutoRescan
            ? 'Auto-rescan ON: Motion buttons rescan the rack before applying. Click to turn OFF to crank the same rack without re-scanning.'
            : 'Auto-rescan OFF: Motion buttons apply on the loaded params only. Turn ON to pull in newly-mapped params (it still rescans automatically if you switch rack/clip).';
    }
    function _sdPersistAutoRescan() {
        (async () => {
            try {
                if (!window.stride || !window.stride.loadSettings) return;
                const res = await window.stride.loadSettings();
                const settings = (res && res.success && res.settings) || {};
                settings.autoRescan = sdAutoRescan;
                await window.stride.saveSettings(settings);
            } catch (e) { /* non-critical */ }
        })();
    }
    window.sdSetAutoRescan = function (on) {
        on = !!on;
        const changed = (on !== sdAutoRescan);
        sdAutoRescan = on;
        _sdPaintAutoRescanBtn();
        if (changed) _sdPersistAutoRescan();
        try { _sdSendQuickState(); } catch (e) {}   // push so the DEVICE button reflects the new value immediately and matches the Motion gate
    };
    window.sdToggleAutoRescan = function () { window.sdSetAutoRescan(!sdAutoRescan); };
    async function sdInitAutoRescan() {
        try {
            if (window.stride && window.stride.loadSettings) {
                const res = await window.stride.loadSettings();
                if (res && res.settings && typeof res.settings.autoRescan === 'boolean') sdAutoRescan = res.settings.autoRescan;
            }
        } catch (e) { /* non-critical */ }
        _sdPaintAutoRescanBtn();
        // Re-push the RESTORED value to the device. The `connected` handler can fire
        // its quick_state (with the default sdAutoRescan=true → green) BEFORE this async
        // restore lands, leaving the device button green while the real value is OFF —
        // so a Motion press (gate reads the real value) wouldn't rescan despite a green
        // button, and a grey→green toggle "fixed" it by re-syncing. Re-push here so the
        // device display and the gate always agree on launch.
        try { _sdSendQuickState(); } catch (e) {}
    }

    // ─── SCAN MODES ──────────────────────────────────────

    let pendingScanParams = []; // holds all params before user picks
    let scanMode = null; // 'all' or 'mapped'

    // Pre-flight: every scan/apply request goes through this. If the WS
    // to M4L is closed, we'd otherwise spin the button forever with no
    // feedback. Returning false here lets the caller bail with a clear,
    // actionable message instead of silent failure.
    function _sdRequireM4LConnection() {
        if (strideLink.connected) return true;
        const status = document.getElementById('sd-canvas-status');
        if (status) {
            status.textContent = 'Not connected to Ableton — open StrideLink in Ableton, then click the status pill (top-right) for help.';
            status.style.color = '#fbbf24';
            setTimeout(() => { if (status) status.style.color = ''; }, 6000);
        }
        // Pulse the titlebar pill so the user knows where to look.
        const pill = document.getElementById('link-status');
        if (pill) {
            pill.classList.add('animate-pulse');
            setTimeout(() => pill.classList.remove('animate-pulse'), 2400);
        }
        return false;
    }

    // After issuing a scan we expect a rack_scanned event back. If M4L's
    // server is up but its scanner doesn't respond (Live API stuck, track
    // empty, or Max patcher silently broken), the spinner would hang.
    // 8s is enough for any real scan; longer means something is wrong.
    let _sdScanTimeoutId = null;
    function _sdArmScanTimeout() {
        if (_sdScanTimeoutId) clearTimeout(_sdScanTimeoutId);
        _sdScanTimeoutId = setTimeout(() => {
            _resetScanButton();
            const status = document.getElementById('sd-canvas-status');
            if (status) {
                status.textContent = 'M4L not responding — make sure StrideLink is loaded on a track with an instrument rack, then try again.';
                status.style.color = '#fbbf24';
                setTimeout(() => { if (status) status.style.color = ''; }, 8000);
            }
        }, 8000);
    }
    function _sdCancelScanTimeout() {
        if (_sdScanTimeoutId) { clearTimeout(_sdScanTimeoutId); _sdScanTimeoutId = null; }
    }

    // ─── AUTOSCAN ─────────────────────────────────────────
    // On open (M4L connect) and on rack switch, silently re-run the MAPPED scan
    // and merge into the canvas: pulls the rack's current mapped params,
    // preserves drawn curves (restoreCanvasState matches by envelopeId within
    // the rack), and surfaces newly-mapped params as empty lanes. No template
    // needed. Stays true to intentional mapping — MAPPED scan, never scan-all.
    let _isAutoScan = false;
    let _sdTrackChangeTimer = null;
    let _sdContextDirty = false;   // true after a track/clip switch until the next scan lands — gates the (main-thread, UI-freezing) rescan-before-inject
    let sdAutoRescan = true;       // GREEN/ON (default) = Motion buttons rescan-then-apply (original behavior). GREY/OFF = apply on loaded params only (crank the same rack). Canvas-owned + persisted; the device ↻ toggles it + reflects via quick_state.rescan.
    let _sdLastAutoScanAt = 0;
    let _sdScanPending = false;       // a request_scan_mapped is in flight (awaiting rack_scanned) — coalesces stacked auto-scans so the launch pile-up doesn't freeze Ableton's single-threaded scanner
    let _sdCurrentTrackName = null;   // for same-track detection across autoscans
    // force === true marks a DELIBERATE user action (the manual re-sync icon or a
    // Motion-button rescan). A forced scan is NEVER coalesced — in Session view
    // clip-focus scans fire constantly, and without this they would eat the user's
    // Motion rescan and leave the generator running on stale lanes. Incidental
    // scans (launch boot, window-focus, clip/track change) call with no arg and so
    // keep the anti-pile-up guard.
    function _sdAutoScan(force) {
        if (!strideLink.connected) return;
        // Coalesce stacked auto-scans: on launch the connect boot-scan, the window-focus
        // scan, and a Motion/inject rescan can all fire within a few hundred ms — that
        // pile-up is what freezes Ableton's single-threaded scanner. The in-flight scan's
        // rack_scanned still runs any queued action, so dropping the duplicate is safe.
        // The 2.5s bound self-heals if a scan never answers (no rack selected → silent).
        if (!force && _sdScanPending && (Date.now() - _sdLastAutoScanAt) < 2500) return;   // deliberate (force) scans are never dropped; incidental ones coalesce
        _sdLastAutoScanAt = Date.now();
        _sdScanPending = true;
        _isAutoScan = true;
        scanMode = 'mapped';
        // Deliberately NO _sdArmScanTimeout(): an auto-scan must stay silent if
        // nothing responds (e.g. no rack selected) — the user can scan manually.
        strideLink.send({ type: 'request_scan_mapped' });
    }

    // "Opening Stride again": when the user switches back to the Stride window
    // (e.g. after adding a device/param in Ableton), silently rescan so new
    // mapped params show up as gaps WITHOUT a manual Scan. Throttled so rapid
    // focus changes don't thrash the scanner. The connect handler covers a cold
    // reopen; this covers the common "edit rack → switch back to Stride" loop.
    function _sdAutoScanOnFocus() {
        if (!strideLink.connected) return;
        if (Date.now() - _sdLastAutoScanAt < 1500) return;   // throttle
        // Re-scan when the user switches back to Stride so params they just
        // mapped in Ableton appear without a manual re-scan. This is cheap now
        // that scanner_max.js caps per-device params (256) — the freeze was the
        // uncapped 2086-param VST3 walk, NOT the autoscan itself.
        Promise.resolve(saveCanvasState()).then(() => _sdAutoScan());
    }
    window.addEventListener('focus', _sdAutoScanOnFocus);
    // Also flush the latest curves the instant Stride loses focus, so switching to
    // the hosted synth / DAW immediately reflects your last edit — no need to click
    // back on Stride. Cheap (a save + curve push); harmless in the desktop app, and
    // the key to "draw → it modulates as it plays" in the VST wrapper.
    window.addEventListener('blur', function () { try { Promise.resolve(saveCanvasState()); } catch (e) {} });
    sdInitAutoRescan();   // restore the persisted Auto-rescan toggle state + paint the on-screen button

    // Manual re-sync (the small refresh icon) — silent curve-preserving merge,
    // same path as autoscan. Insurance for when auto triggers miss something.
    window.sdRefreshSync = function() {
        if (!strideLink.connected) {
            const el = document.getElementById('sd-canvas-status');
            if (el) el.textContent = 'Not connected to Ableton';
            return;
        }
        _sdAutoScan(true);   // deliberate user re-sync (and the Motion-button rescan that calls this) — force past the coalesce guard
    };

    // Scan All — shows picker for user to choose which params to load
    window.scanAll = function() {
        if (!_sdRequireM4LConnection()) return;
        scanMode = 'all';
        document.getElementById('sd-canvas-status').textContent = 'Scanning...';
        const btn = document.getElementById('scan-mapped-btn');
        if (btn) {
            btn.textContent = 'Scanning...';
            btn.classList.add('animate-pulse', 'opacity-70');
            btn.disabled = true;
        }
        _sdArmScanTimeout();
        strideLink.requestScan();
    };

    // Scan Mapped — only loads params that already have automation in the clip
    window.scanMapped = function() {
        if (!_sdRequireM4LConnection()) return;
        scanMode = 'mapped';
        document.getElementById('sd-canvas-status').textContent = 'Scanning mapped...';
        const btn = document.getElementById('scan-mapped-btn');
        if (btn) {
            btn.textContent = 'Scanning...';
            btn.classList.add('animate-pulse', 'opacity-70');
            btn.disabled = true;
        }
        _sdArmScanTimeout();
        strideLink.send({ type: 'request_scan_mapped' });
    };

    function _resetScanButton() {
        _sdCancelScanTimeout();
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
                device: p.device || '',
                min: p.min,
                max: p.max,
                id: p.id,
                _path: p._path,
                is_log: p.is_log || false,
                locked: !!p.locked,   // engine-owned padlock echo (wrapper) — desktop payloads carry none
                selected: false,
                rangeOn: false, rangeMin: 0, rangeMax: 1,   // per-param output range clamp (null-default = full 0..1)
                colorIdx: -1,                               // lane color override (-1 = AUTO skin rotation; 0..11 = SD_LANE_PALETTE)
                loopBeats: 0, speed: 1,                     // per-lane loop boundary + speed multiplier (wrapper; 0 = off / 1 = normal)
                points: []
            }))
            .sort(_sdSortByName);

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

        if (rackInfo.clip_bars && rackInfo.clip_bars > 0) sdSetBars(_sdResolveSystemBars(rackInfo.clip_bars), false);
        currentTrackIndex = _sdTrackIdxFromParams(params);
        const _legacyRackId = (rackInfo.track_name + '_' + rackInfo.device_name).replace(/[^a-zA-Z0-9]/g, '_');
        currentRackId = ((currentTrackIndex >= 0 ? 't' + currentTrackIndex + '_' : '') + rackInfo.track_name + '_' + rackInfo.device_name).replace(/[^a-zA-Z0-9]/g, '_');
        currentClipSlot = (rackInfo.clip_slot != null) ? rackInfo.clip_slot : 0;
        currentClipKey = _sdClipKey(currentRackId, currentClipSlot);
        currentLegacyKey = _sdClipKey(_legacyRackId, currentClipSlot);
        _sdCurrentTrackName = rackInfo.track_name;

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
            device: p.device || '',
            min: p.min,
            max: p.max,
            id: p.id,
            _path: p._path,
            is_log: p.is_log || false,
            locked: !!p.locked,   // engine-owned padlock echo (wrapper) — desktop payloads carry none, so lanes rebuild unlocked exactly as before
            selected: false,
            rangeOn: !!p.rangeOn, rangeMin: (typeof p.rangeMin === 'number' ? p.rangeMin : 0), rangeMax: (typeof p.rangeMax === 'number' ? p.rangeMax : 1),   // carry the range if the engine sent it
            colorIdx: (typeof p.colorIdx === 'number' ? p.colorIdx : -1),   // engine-owned lane color echo (wrapper) — AUTO when absent
            loopBeats: (typeof p.loopBeats === 'number' && p.loopBeats > 0 ? p.loopBeats : 0),   // engine-owned loop/speed echo (wrapper) — off/1x when absent
            speed: (typeof p.speedVal === 'number' && p.speedVal > 0 ? p.speedVal : 1),          // per-lane rate multiplier (replaced the groove grid 2026-08-04)
            points: Array.isArray(p.points) ? p.points : []   // wrapper sends the drawn curve from the engine — reliable across reopen (desktop sends none → empty)
        })).sort(_sdSortByName);

        if (sdCanvasParams.length > 0) sdActiveParamId = sdCanvasParams[0].envelopeId;

        document.getElementById('rack-info').classList.remove('hidden');
        document.getElementById('no-rack-msg').classList.add('hidden');
        document.getElementById('rack-name').textContent = rackInfo.device_name;
        document.getElementById('rack-track').textContent = 'Track: ' + rackInfo.track_name;
        document.getElementById('sd-param-count').textContent = sdCanvasParams.length + ' params';

        if (rackInfo.clip_bars && rackInfo.clip_bars > 0) sdSetBars(_sdResolveSystemBars(rackInfo.clip_bars), false);
        currentTrackIndex = _sdTrackIdxFromParams(params);
        const _legacyRackId = (rackInfo.track_name + '_' + rackInfo.device_name).replace(/[^a-zA-Z0-9]/g, '_');
        currentRackId = ((currentTrackIndex >= 0 ? 't' + currentTrackIndex + '_' : '') + rackInfo.track_name + '_' + rackInfo.device_name).replace(/[^a-zA-Z0-9]/g, '_');
        currentClipSlot = (rackInfo.clip_slot != null) ? rackInfo.clip_slot : 0;
        currentClipKey = _sdClipKey(currentRackId, currentClipSlot);
        currentLegacyKey = _sdClipKey(_legacyRackId, currentClipSlot);
        _sdCurrentTrackName = rackInfo.track_name;

        if (sdCanvasParams.length > 0) {
            document.getElementById('sd-canvas-status').textContent = 'Editor Ready';
        } else {
            // Differentiate the failure cause so the user knows what to fix.
            const status = document.getElementById('sd-canvas-status');
            if (!rackInfo.device_name || rackInfo.device_name === 'None') {
                status.textContent = 'No instrument rack on track "' + (rackInfo.track_name || 'selected') + '". Add a rack with mapped parameters, then Scan Mapped again.';
            } else {
                status.textContent = 'Rack "' + rackInfo.device_name + '" found, but no parameters detected. Map your parameters with Quick Arm + Record to create Quick Automation Lanes, then Scan Mapped again.';
            }
            status.style.color = '#fbbf24';
            setTimeout(() => { if (status) status.style.color = ''; }, 10000);
        }

        restoreCanvasState();
        sdRenderSidebar();
        initSdCanvas();
        setTimeout(() => sdResizeCanvas(), 50);
    }

    // ─── M4L BRIDGE ───────────────────────────────────────

    // M4L self-report — silent path caching.
    //
    // StrideLink lives inside the Ableton User Library, so the M4L device
    // knows exactly where the User Library is and tells us in the handshake.
    // We cache that via the library-path resolver (source: 'm4l') so the
    // watcher, install flow, and template detection benefit from the real
    // path on subsequent runs — regardless of how non-standard the user's
    // setup is.
    //
    // Phase 2 of docs/install-to-ableton-spec.md. Purely additive: no UI,
    // no toast, no behavior change. Silent failure on every error path so
    // a bad cache write can never block the user.
    strideLink.on('m4l_ready', (msg) => {
        if (!msg || !msg.user_library_path) return;
        if (!window.stride || !window.stride.persistLibraryPath) return;
        try {
            window.stride.persistLibraryPath(msg.user_library_path, 'm4l').catch(() => {});
        } catch (e) { /* never let invisible self-healing break anything */ }
    });

    // ─── Read existing curves (Option B, opt-in) ───────────
    // Pulls the open clip's EXISTING automation onto matching lanes. Manual
    // trigger only (never autoscan) so it can't clobber in-progress edits.
    //   Mode A = sampled (value_at_time) · Mode B = breakpoints (events_in_range)
    // Work mode. A (default) = today's behavior, untouched: autosync params,
    // never read clip automation — just draw/edit in Stride and save its own
    // data. B = read the existing automation straight from the open Ableton
    // clip so the user can edit it and inject new curves. Switching to B pulls
    // immediately; the "Pull from clip" button re-reads on demand. The read
    // method (value_at_time sampling) is internal — not a user choice.
    let sdWorkMode = 'A';
    window.sdSetWorkMode = function (m) {
        sdWorkMode = (m === 'B') ? 'B' : 'A';
        const a = document.getElementById('sd-mode-a');
        const b = document.getElementById('sd-mode-b');
        const bc = document.getElementById('sd-mode-b-controls');
        const onCls = 'flex-1 py-1 rounded text-[9px] font-black uppercase tracking-wider bg-fuchsia-500 text-black transition-colors';
        const offCls = 'flex-1 py-1 rounded text-[9px] font-black uppercase tracking-wider text-zinc-400 hover:text-zinc-200 transition-colors';
        if (a) a.className = (sdWorkMode === 'A') ? onCls : offCls;
        if (b) b.className = (sdWorkMode === 'B') ? onCls : offCls;
        if (bc) bc.classList.toggle('hidden', sdWorkMode !== 'B');
        // Entering B pulls the open clip's curves so the user immediately sees
        // what's in Ableton. (Manual only — autosync-on-focus never pulls, so
        // it can't clobber edits.)
        if (sdWorkMode === 'B') window.sdReadCurvesNow();
    };
    window.sdReadCurvesNow = function () {
        const status = document.getElementById('sd-canvas-status');
        if (!strideLink.connected) { if (status) status.textContent = 'Not connected to Ableton'; return; }
        if (!sdCanvasParams || sdCanvasParams.length === 0) { if (status) status.textContent = 'Scan a rack first, then switch to Mode B'; return; }
        if (status) status.textContent = 'Reading curves from Ableton…';
        _sdReadFillOnly = false;   // manual "Pull curves" — overwrite intentionally
        strideLink.readClipCurves('A');   // sampled (value_at_time) — the safe read path
    };

    strideLink.on('clip_curves_read', (msg) => {
        try { console.log('[Stride] clip_curves_read', msg); } catch (e) {}
        const incoming = (msg && msg.params) || [];
        const _fillOnly = _sdReadFillOnly; _sdReadFillOnly = false;   // consume the auto-read flag
        const status = document.getElementById('sd-canvas-status');
        let filled = 0, matched = 0;
        if (typeof pushUndo === 'function' && incoming.length) { try { pushUndo(); } catch (e) {} }
        incoming.forEach(rp => {
            const lane = sdCanvasParams.find(p => p._path && rp._path && p._path === rp._path);
            if (!lane) return;
            matched++;
            // An AUTO-read (clip-switch "source of truth") must NOT overwrite a lane
            // you've already drawn on — a late read would otherwise clobber the curves
            // you just applied (duplicate clip → new curves flash then revert to the
            // copy's automation). Manual "Pull curves" runs with _fillOnly=false and
            // overwrites intentionally.
            if (_fillOnly && lane.points && lane.points.length) return;
            if (rp.points && rp.points.length) {
                lane.points = rp.points.map(pt => ({
                    time: pt.time,
                    value: Math.max(0, Math.min(1, pt.value)),
                    curve: pt.curve || 0
                }));
                filled++;
            }
        });
        if (status) {
            if (filled > 0) status.textContent = 'Pulled ' + filled + ' lane(s) from the clip — edit, then inject';
            else if (incoming.length === 0) status.textContent = 'No automation found on this clip';
            else status.textContent = 'Found ' + incoming.length + ' curve(s) but none matched your lanes';
        }
        try { sdRenderSidebar(); } catch (e) {}
        try { sdDrawCanvasGrid(); } catch (e) {}
        try { if (typeof saveCanvasState === 'function') saveCanvasState(); } catch (e) {}
    });

    // Handle rack scan results from M4L
    strideLink.on('rack_scanned', (msg) => {
        _resetScanButton();
        _sdScanPending = false;    // scan answered — release the coalesce guard for the next auto-scan
        const _wasContextDirty = _sdContextDirty;   // capture BEFORE clearing — the empty-rack clear below needs it
        _sdContextDirty = false;   // a scan landed — loaded params/paths now match the current track/clip
        // StrideQuick readout: remember how many params the chain scan found,
        // then push fresh counts once this handler's lane updates have settled.
        _sdLastChainParamCount = (msg.parameters || []).length;
        setTimeout(_sdSendQuickState, 0);
        const rackInfo = {
            device_name: msg.device_name,
            track_name: msg.track_name,
            clip_bars: msg.clip_bars
        };

        // Auto-scan path (open / rack switch): silent curve-preserving merge,
        // never the rescan modal. loadParamsDirectly swaps the lane set and
        // restoreCanvasState() refills curves for THIS rack by envelopeId (same
        // rack → ids match; different rack → that rack's own saved curves);
        // newly-mapped params arrive as empty lanes, surfaced by the indicator.
        if (_isAutoScan) {
            _isAutoScan = false;
            scanMode = null;
            _resetScanButton();
            const params = msg.parameters || [];
            // No params (e.g. opened with no rack selected): stay quiet, don't
            // wipe whatever is currently loaded.
            if (params.length === 0) {
                currentDeviceName = msg.device_name;
                // A real context SWITCH (connect / track / clip change set _sdContextDirty)
                // that lands on a rack with NO mapped params must CLEAR the previous rack's
                // lanes — otherwise they linger and get injected into the new clip (the
                // "moving 2 / total 4 on a fresh Operator with no mapped params" stale-cache
                // bug). A TRANSIENT empty scan on the SAME rack (not dirty, e.g. a momentary
                // no-selection) still keeps the lanes so in-progress work isn't wiped. The
                // prior rack's curves were already persisted (saveCanvasState runs before
                // every context scan), so returning to that rack reloads them.
                if (_wasContextDirty && sdCanvasParams.length > 0) {
                    sdCanvasParams = [];
                    sdActiveParamId = null;
                    currentRackId = (msg.track_name + '_' + msg.device_name).replace(/[^a-zA-Z0-9]/g, '_');
                    currentClipSlot = (msg.clip_slot != null) ? msg.clip_slot : 0;
                    currentClipKey = _sdClipKey(currentRackId, currentClipSlot);
                    try { sdRenderSidebar(); } catch (e) {}
                    try { sdDrawCanvasGrid(); } catch (e) {}
                    try { _sdSendQuickState(); } catch (e) {}   // push moving 0 / total 0 to the device panel
                }
                resolveTemplate();
                _renderTemplateStatus();
                return;
            }
            // No-op when nothing changed — so a window-focus rescan doesn't
            // disrupt the user's active lane every time they switch back. Only
            // an actual param add/remove (or device change) triggers a merge.
            const newIds = params.map(p => String(p.id)).sort().join(',');
            const curIds = sdCanvasParams.map(p => p.envelopeId).sort().join(',');
            // A clip switch (same rack/params, different detail-view clip) must
            // NOT no-op: we still need to swap in that clip's own curves + bars.
            const _newSlot = (msg.clip_slot != null) ? msg.clip_slot : 0;
            const _newTrackIdx = _sdTrackIdxFromParams(params);
            const _slotSame = (_newSlot === currentClipSlot);
            // A duplicated track shares name/params/slot with its source, so only
            // the track index tells them apart — without it, switching back to the
            // original clip reads as "nothing changed" and never re-syncs.
            const _trackSame = (_newTrackIdx === currentTrackIndex);
            if (newIds === curIds && currentDeviceName === msg.device_name && sdCanvasParams.length > 0 && _slotSame && _trackSame) {
                return;
            }
            // Structural change (param/device added or removed). Merge WITHOUT
            // losing drawn curves. Snapshot the current lanes' curves IN MEMORY
            // by envelopeId and re-apply after the reload — this is
            // rackId-independent, so it survives even when adding a device
            // changes the rack's name (device_name = all device names joined →
            // a new saved-state key). Only carry within the SAME track; a
            // different track is a different rack whose own saved curves load.
            currentDeviceName = msg.device_name;
            resolveTemplate();
            const sameTrack = _trackSame;   // by track INDEX, not name — duplicated tracks share a name but are different tracks
            // Carry BOTH the drawn curve AND the lock flag across the reload,
            // keyed by the param's STABLE LOM _path — NOT the scanner's positional
            // id/envelopeId, which RENUMBERS when params are added/removed and would
            // carry locks/curves onto the WRONG params (the "Chaos hit my locked
            // lanes" bug). loadParamsDirectly rebuilds every lane with locked:false, so
            // without carrying the lock a rescan-before-generate (the Quick Motion
            // flow) would silently unfreeze every locked lane and the generator
            // would overwrite exactly the lanes the user just locked.
            // Carry in-memory curves/locks across the reload ONLY when staying on
            // the SAME clip (e.g. a device was added → params change but it's the
            // same clip's work). On a CLIP SWITCH (slot changed) we must NOT carry
            // — each clip is its own variation; restoreCanvasState loads that
            // clip's saved curves instead (or auto-reads them).
            const carried = {};
            if (sameTrack && _slotSame) {
                sdCanvasParams.forEach(p => {
                    if ((p.points && p.points.length) || p.locked || p.rangeOn || (typeof p.colorIdx === 'number' && p.colorIdx >= 0)
                        || (typeof p.loopBeats === 'number' && p.loopBeats > 0) || (typeof p.speed === 'number' && p.speed !== 1)) {
                        // Key by the stable _path; fall back to NAME for lanes that
                        // have no _path yet (e.g. a just-loaded session) so their
                        // curves/locks survive the first rescan-merge instead of
                        // being dropped. Never the positional envelopeId.
                        const k = p._path || ('n:' + p.name);
                        carried[k] = { points: (p.points && p.points.length) ? p.points : null, locked: !!p.locked,
                                       rangeOn: !!p.rangeOn, rangeMin: p.rangeMin, rangeMax: p.rangeMax,
                                       colorIdx: (typeof p.colorIdx === 'number' ? p.colorIdx : -1),
                                       loopBeats: (typeof p.loopBeats === 'number' ? p.loopBeats : 0),
                                       speed: (typeof p.speed === 'number' ? p.speed : 1) };
                    }
                });
            }
            const prevActive = sdActiveParamId;
            loadParamsDirectly(params, rackInfo);   // updates _sdCurrentTrackName
            let kept = 0;
            if (sameTrack && _slotSame) {
                sdCanvasParams.forEach(p => {
                    const c = (p._path && carried[p._path]) || carried['n:' + p.name];
                    if (c) {
                        // The ENGINE payload wins where it speaks (wrapper: points + ranges come
                        // from the engine, correctly re-indexed) — the positional carry only fills
                        // lanes the payload left empty. Desktop payloads carry neither, so the
                        // carry behaves exactly as before there.
                        if (c.points && !(p.points && p.points.length)) p.points = c.points;
                        if (c.locked) p.locked = true;
                        if (c.rangeOn && !p.rangeOn) { p.rangeOn = true; p.rangeMin = c.rangeMin; p.rangeMax = c.rangeMax; }
                        if (typeof c.colorIdx === 'number' && c.colorIdx >= 0 && !(p.colorIdx >= 0)) p.colorIdx = c.colorIdx;   // payload (engine echo) wins; carry only fills AUTO
                        if (typeof c.loopBeats === 'number' && c.loopBeats > 0 && !(p.loopBeats > 0)) p.loopBeats = c.loopBeats;   // loop/speed: same payload-wins story
                        if (typeof c.speed === 'number' && c.speed !== 1 && !(typeof p.speed === 'number' && p.speed !== 1)) p.speed = c.speed;
                        kept++;
                    }
                });
                // Migrate the curves + locks to the (possibly renamed) rack's saved
                // key so a later cold reopen restores them too.
                if (kept) saveCanvasState();
            }
            if (prevActive && sdCanvasParams.some(p => p.envelopeId === prevActive)) {
                sdActiveParamId = prevActive;
            }
            sdRenderSidebar();
            sdDrawCanvasGrid();
            return;
        }

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

        // A scan that has work to preserve ALWAYS keeps it — a silent,
        // curve-preserving merge. Drawn curves AND locks carry across by the
        // param's stable _path, so a rescan only folds in newly-added params (as
        // empty lanes) and never loses anything. This removes the old
        // "Keep / Replace?" modal: it was unnecessary (the merge already keeps
        // everything), it BLOCKED behind Ableton, and it popped up spuriously via
        // the scan-classification race.
        const hasExistingCurves = sdCanvasParams.some(p => p.points && p.points.length > 0);
        const hasLocks = sdCanvasParams.some(p => p.locked);
        const _newIds = (msg.parameters || []).map(p => String(p.id)).sort().join(',');
        const _curIds = sdCanvasParams.map(p => p.envelopeId).sort().join(',');
        if (scanMode === 'all') {
            // "Scan all" is an explicit pick-your-params action — keep the picker.
            showParamPicker(msg.parameters, rackInfo);
        } else if (_newIds === _curIds && sdCanvasParams.length > 0) {
            // Same params already loaded → nothing structural changed. Keep the lanes
            // (curves + locks intact) WITHOUT a full reload — reloading the whole rack
            // on every (often duplicate) rescan thrashes the main thread and is a big
            // driver of the "stuck" on heavy racks.
            // EXCEPTION: fold in curve points the scan carries for a lane that's
            // currently EMPTY — on a project reload the wrapper's engine finishes
            // restoring its curves a moment after the first (still-empty) scan, and
            // this is what makes those curves appear. Only fills empties, so it never
            // clobbers a curve you're editing.
            (msg.parameters || []).forEach(sp => {
                if (!sp || !Array.isArray(sp.points) || !sp.points.length) return;
                const lane = (sp._path && sdCanvasParams.find(p => p._path === sp._path))
                          || sdCanvasParams.find(p => String(p.id) === String(sp.id));
                if (lane && (!lane.points || !lane.points.length)) lane.points = sp.points;
            });
            sdRenderSidebar();
            sdDrawCanvasGrid();
        } else if (hasExistingCurves || hasLocks) {
            // Snapshot current curves + locks by stable _path, reload, re-apply.
            const oldCurves = {};
            sdCanvasParams.forEach(p => {
                if ((p.points && p.points.length > 0) || p.locked) {
                    const k = p._path || ('n:' + p.name);
                    oldCurves[k] = {
                        points: (p.points && p.points.length > 0) ? JSON.parse(JSON.stringify(p.points)) : null,
                        locked: !!p.locked
                    };
                }
            });
            loadParamsDirectly(msg.parameters, rackInfo);
            let restored = 0;
            sdCanvasParams.forEach(p => {
                const c = (p._path && oldCurves[p._path]) || oldCurves['n:' + p.name];
                if (c) { if (c.points) { p.points = c.points; restored++; } if (c.locked) p.locked = true; }
            });
            sdRenderSidebar();
            sdDrawCanvasGrid();
            if (restored > 0) {
                const _st = document.getElementById('sd-canvas-status');
                if (_st) _st.textContent = `Editor Ready — ${restored} curve${restored > 1 ? 's' : ''} preserved`;
            }
        } else {
            // Nothing drawn or locked — load fresh.
            loadParamsDirectly(msg.parameters, rackInfo);
        }

        scanMode = null;
    });

    // Handle clip changes — Ableton's clip length should NOT clobber the
    // user's sticky preference. _sdResolveSystemBars returns sticky if set.
    strideLink.on('clip_changed', (msg) => {
        if (msg.clip_bars && msg.clip_bars > 0) {
            sdSetBars(_sdResolveSystemBars(msg.clip_bars), false);
        }
    });

    // Rack switch in Ableton → autosync the canvas to the newly selected rack.
    // Debounced so clicking through tracks doesn't thrash the scanner, and the
    // current rack's work is saved before switching so nothing is lost.
    strideLink.on('track_changed', (msg) => {
        if (!msg || msg.has_device === false) return;   // only tracks with a device
        _sdContextDirty = true;   // track changed → loaded param paths may be stale until the next scan
        if (_sdTrackChangeTimer) clearTimeout(_sdTrackChangeTimer);
        _sdTrackChangeTimer = setTimeout(() => {
            _sdTrackChangeTimer = null;
            if (!strideLink.connected) return;
            Promise.resolve(saveCanvasState()).then(() => _sdAutoScan());
        }, 450);
    });

    // Detail-view clip changed — the clip in Live's editor is the source of truth.
    // Re-sync so the canvas shows THIS clip's curves + bars, even when the track
    // selection didn't change (switching clips on the same track).
    //
    // FAST PATH: when the new clip is on the SAME track as the loaded rack (the
    // M4L sends the clip's track_index), the params can't have changed — so skip
    // the heavy LOM param walk and just re-key + restore this clip's curves. Only
    // a real track/rack change (or an arrangement clip / older M4L that sends no
    // track index) falls through to the full debounced scan (today's behavior).
    function _sdReKeyClipNoScan(slot, bars) {
        // Persist the clip we're leaving, THEN re-key to the new slot. Same rack →
        // currentRackId is unchanged; rebuild the legacy migration key from the
        // cached track+device names. Blank the lanes + restore THIS clip's saved
        // curves (restoreCanvasState also auto-reads the clip's real automation when
        // it has none) — mirrors the scan's clip-switch path, minus the param walk.
        Promise.resolve(saveCanvasState()).then(() => {
            currentClipSlot = (slot != null) ? slot : 0;
            currentClipKey = _sdClipKey(currentRackId, currentClipSlot);
            const legacyRackId = ((_sdCurrentTrackName || '') + '_' + (currentDeviceName || '')).replace(/[^a-zA-Z0-9]/g, '_');
            currentLegacyKey = _sdClipKey(legacyRackId, currentClipSlot);
            _sdContextDirty = false;   // same params, just re-keyed to this clip
            sdCanvasParams.forEach(p => { p.points = []; p.locked = false; p.selected = false; p.rangeOn = false; p.rangeMin = 0; p.rangeMax = 1; });
            Promise.resolve(restoreCanvasState()).then(() => {
                if (bars && bars > 0) sdSetBars(_sdResolveSystemBars(bars), false);
                try { sdRenderSidebar(); sdDrawCanvasGrid(); _sdSendQuickState(); } catch (e) {}
            });
        });
    }
    strideLink.on('clip_focus_changed', (msg) => {
        if (!msg) return;
        const ti = (typeof msg.track_index === 'number') ? msg.track_index : -1;
        const slot = (msg.clip_slot != null) ? msg.clip_slot : 0;
        // Same track as the loaded rack → the params can't have changed → SKIP the
        // heavy LOM param scan (the big-rack freeze) for BOTH Session and Arrangement.
        if (ti >= 0 && ti === currentTrackIndex && sdCanvasParams.length > 0) {
            if (_sdTrackChangeTimer) clearTimeout(_sdTrackChangeTimer);
            if (slot === currentClipSlot) {
                // Same clip/slot — and EVERY Arrangement clip (they share slot 0, so
                // there's no per-clip variation to load) — so just sync this clip's
                // bars and KEEP the curves you're working on. No scan, no blank → no
                // freeze, no flicker (mirrors the full-scan path's same-clip no-op).
                if (msg.clip_bars && msg.clip_bars > 0) sdSetBars(_sdResolveSystemBars(msg.clip_bars), false);
                _sdContextDirty = false;
                return;
            }
            // Same track, DIFFERENT Session slot → fast re-key to that clip's curves.
            // Debounced so clicking through clips collapses to the one you land on.
            const _slot = slot, _bars = msg.clip_bars;
            _sdTrackChangeTimer = setTimeout(() => {
                _sdTrackChangeTimer = null;
                if (!strideLink.connected) return;
                _sdReKeyClipNoScan(_slot, _bars);
            }, 150);
            return;
        }
        // Different track / no track index / older M4L → full re-sync (debounced).
        _sdContextDirty = true;   // clip changed → re-key + paths may be stale until the next scan
        if (_sdTrackChangeTimer) clearTimeout(_sdTrackChangeTimer);
        _sdTrackChangeTimer = setTimeout(() => {
            _sdTrackChangeTimer = null;
            if (!strideLink.connected) return;
            Promise.resolve(saveCanvasState()).then(() => _sdAutoScan());
        }, 250);
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
        const params = msg.params_written || 0;
        document.getElementById('sd-canvas-status').textContent = `Applied ${params} params to clip`;
        _sdShowSuccessPopup('Applied to clip', `${params} param${params === 1 ? '' : 's'}`);
    });

    strideLink.on('apply_error', (msg) => {
        _hideLoading();
        document.getElementById('sd-canvas-status').textContent = 'Error: ' + msg.message;
    });

    // Direct-inject result (opt-in path — writes straight into the selected
    // Session clip via StrideInject, no .alc/drag). Separate from apply_*.
    strideLink.on('inject_success', (msg) => {
        _hideLoading();
        if (_sdInjectTimeout) { clearTimeout(_sdInjectTimeout); _sdInjectTimeout = null; }
        // Device status: brief "Injected ✓" flash, then back to ready.
        _sdInjecting = false; _sdJustInjected = true; _sdDirty = false;   // clip now matches the canvas
        if (_sdJustInjectedTimer) clearTimeout(_sdJustInjectedTimer);
        _sdJustInjectedTimer = setTimeout(function () { _sdJustInjected = false; _sdSendQuickState(); }, 2500);
        _sdSendQuickState();
        const params = msg.params_written || 0;
        const pts = msg.points_written || 0;
        const notes = msg.notes_written || 0;
        const el = document.getElementById('sd-canvas-status');
        if (el) {
            el.style.color = '';
            el.textContent = `Injected → clip: ${params} param${(params === 1) ? '' : 's'}${notes ? ', ' + notes + ' notes' : ''} (${msg.mode || 'step'} mode)`;
        }
        const parts = [];
        if (params) parts.push(`${params} param${params === 1 ? '' : 's'}`);
        if (pts) parts.push(`${pts.toLocaleString()} points`);
        if (notes) parts.push(`${notes} note${notes === 1 ? '' : 's'}`);
        _sdShowSuccessPopup('Injected to clip', parts.join(' · ') || 'done');
    });
    strideLink.on('inject_error', (msg) => {
        _hideLoading();
        if (_sdInjectTimeout) { clearTimeout(_sdInjectTimeout); _sdInjectTimeout = null; }
        _sdInjecting = false; _sdJustInjected = false; _sdSendQuickState();
        const el = document.getElementById('sd-canvas-status');
        if (el) {
            el.style.color = '#fbbf24';
            el.textContent = 'Direct inject: ' + (msg.message || 'failed');
            setTimeout(() => { if (el) el.style.color = ''; }, 6000);
        }
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

    // Connection status — pill in titlebar reflects WS state. The pill is
    // clickable; sdToggleConnectionHelp() opens a troubleshooter popover.
    strideLink.on('connected', () => {
        document.getElementById('link-dot').className = 'w-2 h-2 rounded-full bg-green-500';
        const label = document.getElementById('link-label');
        label.textContent = 'M4L Connected';
        label.className = 'text-[10px] text-green-400 uppercase font-bold tracking-widest';   // green stays green in every skin (not remapped)
        document.getElementById('sd-canvas-status').textContent = 'Connected — syncing rack…';
        // Refresh the popover if it happens to be open.
        const help = document.getElementById('sd-connection-help');
        if (help && !help.classList.contains('hidden')) sdRenderConnectionHelp();
        // (Re)connect safety: the lanes we restored are from a prior session/launch and
        // may not match the track you're on NOW. You can switch tracks in Ableton while
        // the canvas is closed — those track_changed events are dropped (no client to
        // receive them) — so on relaunch the canvas can't know the context moved. Treat
        // it as stale until a scan lands, so the first inject rescans-then-writes instead
        // of injecting the previous track's _paths ("nothing to inject"). rack_scanned
        // clears this; once cleared, inject writes directly with NO extra scan — so the
        // normal Motion→Inject flow stays a single scan (Motion already refreshed it).
        _sdContextDirty = true;
        // Autoscan on open — silently pull the rack's mapped params + sync the
        // canvas (persists current work first). Small delay lets the M4L
        // handshake (m4l_ready / clip / track info) settle first.
        setTimeout(() => { Promise.resolve(saveCanvasState()).then(() => _sdAutoScan()); }, 500);
        // StrideQuick: send the initial panel readout (connection + counts).
        _sdSendQuickState();
    });

    strideLink.on('disconnected', () => {
        document.getElementById('link-dot').className = 'w-2 h-2 rounded-full bg-red-500 animate-pulse';
        const label = document.getElementById('link-label');
        label.textContent = 'Disconnected';
        label.className = 'text-[10px] text-red-400 uppercase font-bold tracking-widest';
        const help = document.getElementById('sd-connection-help');
        if (help && !help.classList.contains('hidden')) sdRenderConnectionHelp();
    });

    // ─── StrideQuick — remote control of the canvas from the M4L panel ─────
    // The StrideLink "Quick" panel presses arrive as `quick_command` messages.
    // The dispatcher runs the SAME window.sd* function the on-screen button
    // calls — zero new generator logic, so lane-lock / undo / selection /
    // redraw all behave identically to clicking in the canvas. The canvas
    // updates instantly even when its window is in the background, so the user
    // never has to switch screens. After each action we push fresh counts
    // back to the panel.
    let _sdLastChainParamCount = 0;
    let _sdMoveStack = [];           // moves stacked since the last fresh generation (device status)
    let _sdInjecting = false;        // true while an inject is in flight
    let _sdJustInjected = false;     // brief "Injected" flash after success
    let _sdJustInjectedTimer = null;
    let _sdInjectTimeout = null;     // so "Injecting…" can't hang forever if StrideInject never answers
    const _SD_ACTION_LABELS = { chaos:'Chaos', neuro:'Neuro', reflector:'Reflector', sh:'S&H', prism:'Prism', mutate:'Mutate', shuffle:'Shuffle', double:'2x', half:'0.5x' };
    // Generators REPLACE the curves, so pressing one resets the stack; transforms
    // modify the existing curves, so they append (deduped). bars/rescan/inject
    // leave the stack alone.
    const _SD_GENERATORS = ['chaos','neuro','reflector','sh','prism'];
    // Quick actions that REWRITE lanes in memory (generators + transforms). They
    // must persist immediately — see the saveCanvasState() note in _sdApplyQuickAction.
    const _SD_QUICK_MUTATORS = ['chaos','neuro','reflector','sh','prism','mutate','shuffle','double','half'];

    // A lane "moves" when its curve actually varies (not empty, not a flat
    // baseline). Shared by the moving counter and "Lock current lanes".
    function _sdLaneMoving(p) {
        if (!p.points || p.points.length < 2) return false;
        let lo = p.points[0].value, hi = p.points[0].value;
        for (let i = 1; i < p.points.length; i++) {
            const v = p.points[i].value;
            if (v < lo) lo = v;
            if (v > hi) hi = v;
        }
        return (hi - lo) > 0.001;
    }

    function _sdSendQuickState() {
        const total = sdCanvasParams.length;
        // "Moving" = the curve actually varies. Empty lanes (no points) and flat
        // lanes (a baseline sitting at one value) don't count, only lanes whose
        // automation moves by more than a hair register as having a real curve.
        const moving = sdCanvasParams.filter(_sdLaneMoving).length;
        if (!strideLink || !strideLink.connected) return;
        // Counter = moving vs total loaded; lets the user see e.g. 10 / 20 on the
        // device: 10 params are moving, 10 are still empty and need injection.
        // Live device status line. Combines the loop length + last move so the
        // panel reads e.g. "8 Reflector ready to inject". Plain words and numbers
        // separated by spaces, no commas or dividers.
        const _bars = sdGetBars();
        let status;
        if (_sdInjecting) status = 'Injecting';
        else if (_sdJustInjected) status = 'Injected';
        else if (total === 0) status = 'Scanning';
        else if (moving === 0) { _sdMoveStack = []; status = _bars + ' apply a move'; }
        else if (_sdDirty) status = _bars + (_sdMoveStack.length ? ' ' + _sdMoveStack.join(' ') : '') + ' Ready to Inject ---->';
        else status = _bars + (_sdMoveStack.length ? ' ' + _sdMoveStack.join(' ') : '') + ' Injected';
        strideLink.send({
            type: 'quick_state',
            on_chain: moving,    // first number: lanes with curves
            on_canvas: total,    // second number: total loaded lanes
            bars: sdGetBars(),
            connected: 1,
            locked: sdCanvasParams.filter(function (p) { return p.locked; }).length,  // how many lanes are frozen (device readout under the Lock button)
            rescan: sdAutoRescan ? 1 : 0,   // Auto-rescan state → reflected to the device ↻ button color (green = ON)
            status: status,
        });
    }
    // Keep the device counter live no matter how curves change (Quick buttons,
    // manual draws, clears). Light poll, only actually sends when connected.
    setInterval(_sdSendQuickState, 1200);

    // The actual apply of a Quick action. The wrapper below decides whether to
    // rescan first. Same window.sd* functions the on-screen buttons call.
    function _sdApplyQuickAction(action, arg) {
        switch (action) {
            case 'rescan':    window.sdRefreshSync(); break;
            // StrideLink device ↻ Auto-Rescan toggle. GREEN/ON = Motion rescans first
            // (default); GREY/OFF = Motion applies on the loaded params only. _set
            // carries 0/1 (a toggle-mode device button sends $1); _toggle just flips.
            case 'rescan_set':    window.sdSetAutoRescan(parseInt(arg, 10) === 1); break;
            case 'rescan_toggle': window.sdSetAutoRescan(!sdAutoRescan); break;
            case 'chaos':     window.sdApplyGlobalChaos(); break;
            case 'neuro':     window.sdApplyGlobalNeuro(); break;
            case 'reflector': window.sdApplyGlobalReflector(); break;
            case 'sh':        window.sdApplyGlobalSampleHold(); break;
            case 'prism':     window.sdApplyGlobalPrism(); break;
            // Mutate / 2x / ½x = "select all + transform": force EVERY unlocked
            // lane regardless of the on-canvas selection (per locked decision).
            case 'mutate':    window.sdMutate(sdCanvasParams.filter(p => !p.locked)); break;
            case 'shuffle':   window.sdShuffleLanes(); break;
            case 'double':    window.sdTimeStretch(2, sdCanvasParams.filter(p => !p.locked)); break;   // 2x = stretch (slower / more spread)
            case 'half':      window.sdTimeStretch(0.5, sdCanvasParams.filter(p => !p.locked)); break; // ½x = compress (faster / denser)
            case 'lockcurrent': window.sdLockCurrentLanes(); break;
            case 'unlockall':   window.sdUnlockAllLanes(); break;
            case 'bars':      window.sdSetBars(parseInt(arg) || 4, true); break;
            case 'inject':    window.applyToAbletonDirect(); break;
            default:
                console.warn('[Stride] quick: unknown action', action);
                return;
        }
        // Build the move stack for the status line. A generator starts a fresh
        // recipe; a transform stacks on top (deduped). bars/rescan/inject/lock
        // don't touch it. So Neuro then 2x reads "8 Neuro 2x ready"; a later
        // Chaos resets it to "8 Chaos ready".
        if (_SD_ACTION_LABELS[action]) {
            const lbl = _SD_ACTION_LABELS[action];
            if (_SD_GENERATORS.indexOf(action) !== -1) _sdMoveStack = [lbl];
            else if (_sdMoveStack.indexOf(lbl) === -1) _sdMoveStack.push(lbl);
        }
        // Persist a freshly generated/transformed curve right away. Generators and
        // transforms rewrite lanes IN MEMORY only (no saveCanvasState of their own).
        // With Auto-Rescan ON the device fires a rescan, whose merge can reload
        // canvas_<rackId>.json from disk — and without this it would restore the
        // last SAVED curve OVER the new one (the "S&H keeps the old Chaos/Neuro
        // pattern, but ONLY with Auto-Rescan ON" bug; Auto-Rescan OFF does no
        // rescan so the in-memory curve survived). Saving makes any later reload
        // restore THIS curve. Fire-and-forget: the display is already correct.
        if (_SD_QUICK_MUTATORS.indexOf(action) !== -1) { try { saveCanvasState(); } catch (e) {} }
        _sdSendQuickState();
    }

    // Motion generators AND inject RESCAN first, then apply, pulling in any
    // params you automated since the last sync (curves + locks preserved) and —
    // critically for inject — refreshing each lane's absolute LOM _path so it
    // matches the clip/track you're on NOW. Injecting on a stale _path (from a
    // previously-selected track, before the debounced auto-sync has landed) makes
    // every clip envelope fail in StrideInject ("no envelope" → "nothing to
    // inject"). Transforms / bars / lock still apply directly (they only touch
    // what's already loaded). A fallback timer means a press is never lost if the
    // rescan doesn't answer; the rack_scanned listener runs the queued action
    // once the merge lands.
    let _sdGenAfterScan = null;
    let _sdGenAfterScanTimer = null;
    window.sdHandleQuickCommand = function(action, arg) {
        // Generators always rescan (to pull in params automated since the last
        // sync). Inject only rescans if the track/clip changed since the last scan
        // — otherwise the loaded paths are already fresh, so skip the main-thread,
        // UI-freezing scan and inject directly. Undoes the extra freeze the
        // unconditional rescan-before-inject added, while keeping the stale-path
        // protection right after a switch.
        const _rescanFirst = (_SD_GENERATORS.indexOf(action) !== -1 && (sdAutoRescan || _sdContextDirty)) || (action === 'inject' && _sdContextDirty);
        if (_rescanFirst && strideLink.connected) {
            _sdGenAfterScan = { action: action, arg: arg };
            if (_sdGenAfterScanTimer) clearTimeout(_sdGenAfterScanTimer);
            _sdGenAfterScanTimer = setTimeout(function () {
                _sdGenAfterScanTimer = null;
                if (_sdGenAfterScan) { const q = _sdGenAfterScan; _sdGenAfterScan = null; _sdApplyQuickAction(q.action, q.arg); }
            }, 3000);
            window.sdRefreshSync();   // _sdAutoScan -> request_scan_mapped -> rack_scanned (merges)
            return;
        }
        _sdApplyQuickAction(action, arg);
    };
    // Apply a queued generator once its rescan has merged. on() APPENDS, so this
    // runs AFTER the main rack_scanned handler — sdCanvasParams already holds the
    // new lanes. Fires on merge OR no-change, so the generator always lands.
    strideLink.on('rack_scanned', function () {
        if (!_sdGenAfterScan) return;
        if (_sdGenAfterScanTimer) { clearTimeout(_sdGenAfterScanTimer); _sdGenAfterScanTimer = null; }
        const q = _sdGenAfterScan; _sdGenAfterScan = null;
        _sdApplyQuickAction(q.action, q.arg);
    });

    // ── param-touch glow (wrapper 1.3.0) ─────────────────────────────
    // Touch a MAPPED knob in a hosted plugin's own GUI → its lane flashes for ~1s (and
    // scrolls into view) so you find it without reading names. The engine discriminates
    // user touches from its own drive writes, so playback never triggers this.
    function _sdGlowKick() {
        if (_sdGlowRAF) return;
        const step = (ts) => {
            _sdGlowRAF = 0;
            const now = Date.now();
            const active = sdCanvasParams.some(p => p._glowUntil && p._glowUntil > now);
            if (ts - _sdGlowLast > 28) {   // ~30fps repaint while the glow fades
                _sdGlowLast = ts;
                _sdGlowPaint = true;
                try { sdDrawCanvasGrid(); } finally { _sdGlowPaint = false; }
            }
            if (active) _sdGlowRAF = requestAnimationFrame(step);
            else { _sdGlowPaint = true; try { sdDrawCanvasGrid(); } finally { _sdGlowPaint = false; } }   // one clean final frame
        };
        _sdGlowRAF = requestAnimationFrame(step);
    }
    strideLink.on('param_glow', function (msg) {
        if (!window.strideLink || !window.strideLink._wrapper) return;
        const id = (msg && typeof msg.id === 'number') ? msg.id : -1;
        if (id < 0) return;
        const lane = sdCanvasParams.find(p => p._path === ('wrap:' + id));
        if (!lane) return;
        lane._glowUntil = Date.now() + 1000;
        // Bring the lane on-screen (multi view): the point is finding it fast.
        if (sdViewMode === 'multi') {
            const vis = sdVisibleParams();
            const idx = vis.indexOf(lane);
            if (idx >= 0) {
                const visCount = sdMultiVisibleLaneCount();
                if (idx < sdMultiScrollOffset) sdMultiScrollOffset = idx;
                else if (idx >= sdMultiScrollOffset + visCount) sdMultiScrollOffset = Math.max(0, idx - visCount + 1);
            }
        }
        _sdGlowKick();
    });

    // "Lock current lanes": lock every lane that's actually moving, so the next
    // generator skips them and only modulates the still-empty (newly-added)
    // lanes. Lets the user keep their original movement and bring new params in
    // with a different sound. Empty/flat lanes stay unlocked so they get filled.
    window.sdLockCurrentLanes = function() {
        let n = 0, moving = 0;
        sdCanvasParams.forEach(function (p) {
            if (_sdLaneMoving(p)) { moving++; if (!p.locked) n++; p.locked = true; }
        });
        _sdPushLocksToEngine(sdCanvasParams);   // one batched engine pass (wrapper; desktop no-op)
        sdRenderSidebar();
        sdDrawCanvasGrid();
        const el = document.getElementById('sd-canvas-status');
        if (el) {
            el.style.color = '';
            if (n) el.textContent = 'Locked ' + n + ' lane' + (n === 1 ? '' : 's') + '. Generators now touch only new params';
            else if (moving) el.textContent = 'All ' + moving + ' moving lane' + (moving === 1 ? '' : 's') + ' already locked';
            else el.textContent = 'No moving lanes to lock yet';
        }
        saveCanvasState();
        _sdSendQuickState();
    };

    // "Unlock all": the mirror of Lock current. Clears every lane lock so the
    // next generator modulates everything again (your earlier curves included).
    // This is how you get back to a full-rack move after layering with locks.
    window.sdUnlockAllLanes = function() {
        let n = 0;
        sdCanvasParams.forEach(function (p) {
            if (p.locked) { n++; p.locked = false; }
        });
        _sdPushLocksToEngine(sdCanvasParams);   // one batched engine pass (wrapper; desktop no-op)
        sdRenderSidebar();
        sdDrawCanvasGrid();
        const el = document.getElementById('sd-canvas-status');
        if (el) {
            el.style.color = '';
            el.textContent = n
                ? ('Unlocked ' + n + ' lane' + (n === 1 ? '' : 's') + '. Generators now modulate every lane')
                : 'Nothing was locked';
        }
        saveCanvasState();
        _sdSendQuickState();
    };

    // Lane actions (generators, transforms, inject) need a scanned rack with
    // curves. If the canvas was just auto-launched by this very press, the
    // open-scan has not populated lanes yet, so wait for them (and the restored
    // curves) before running, instead of firing on an empty canvas. rescan/bars
    // do not need lanes, so they run immediately. Gives up quietly after ~10s
    // (no rack mapped, nothing to do).
    const _SD_LANE_ACTIONS = ['chaos','neuro','reflector','sh','prism','mutate','shuffle','double','half','inject','lockcurrent','unlockall'];
    function _sdRunQuickWhenReady(action, arg, tries) {
        if (sdCanvasParams.length > 0) { window.sdHandleQuickCommand(action, arg); return; }
        if (tries <= 0) return;
        setTimeout(function () { _sdRunQuickWhenReady(action, arg, tries - 1); }, 300);
    }
    strideLink.on('quick_command', (m) => {
        if (!m || !m.action) return;
        // Generators self-rescan (sdHandleQuickCommand fires a scan then applies
        // once it merges), so they work even from an empty canvas — route them
        // straight through. Only transforms / inject (which need existing curves)
        // wait for a boot scan to populate lanes first. Without the isGenerator
        // bypass, a generator pressed on a 0-lane canvas would sit in
        // _sdRunQuickWhenReady waiting for lanes that nothing ever scans in.
        const isGenerator = _SD_GENERATORS.indexOf(m.action) !== -1;
        const needsLanes = _SD_LANE_ACTIONS.indexOf(m.action) !== -1;
        if (isGenerator || !needsLanes || sdCanvasParams.length > 0) {
            window.sdHandleQuickCommand(m.action, m.arg);
        } else {
            _sdRunQuickWhenReady(m.action, m.arg, 33);   // 33 x 300ms ~ 10s
        }
    });

    // Troubleshooter popover — opened by clicking the connection pill.
    // Content updates based on current WS state so the user always sees
    // relevant fixes for what's actually wrong.
    window.sdToggleConnectionHelp = function() {
        const help = document.getElementById('sd-connection-help');
        if (!help) return;
        const willOpen = help.classList.contains('hidden');
        if (willOpen) {
            sdRenderConnectionHelp();
            help.classList.remove('hidden');
            // Click outside to close.
            setTimeout(() => {
                const closer = (e) => {
                    if (!help.contains(e.target) && e.target.id !== 'link-status' && !document.getElementById('link-status').contains(e.target)) {
                        help.classList.add('hidden');
                        document.removeEventListener('mousedown', closer);
                    }
                };
                document.addEventListener('mousedown', closer);
            }, 0);
        } else {
            help.classList.add('hidden');
        }
    };

    function sdRenderConnectionHelp() {
        const dot = document.getElementById('sd-help-dot');
        const title = document.getElementById('sd-help-title');
        const body = document.getElementById('sd-help-body');
        if (!dot || !title || !body) return;
        if (strideLink.connected) {
            dot.className = 'w-2.5 h-2.5 rounded-full bg-emerald-400';
            title.textContent = 'Connected to Ableton';
            title.className = 'text-[12px] text-emerald-300 font-bold uppercase tracking-wider';
            body.innerHTML = `
                <p class="text-emerald-300">Stride is talking to StrideLink in Ableton.</p>
                <p>If <strong>Scan Mapped</strong> still doesn't load any params:</p>
                <ul class="list-disc pl-5 space-y-1 text-zinc-400">
                    <li>Make sure the track with your instrument rack is <strong>selected</strong> in Ableton.</li>
                    <li>Map every parameter you want to automate using <strong>Quick Arm + Record</strong> to create Quick Automation Lanes — that's how Stride detects them.</li>
                </ul>
            `;
        } else {
            dot.className = 'w-2.5 h-2.5 rounded-full bg-red-500';
            title.textContent = 'Not Connected to Ableton';
            title.className = 'text-[12px] text-red-400 font-bold uppercase tracking-wider';
            body.innerHTML = `
                <p class="text-red-300">Stride can't reach StrideLink in Ableton on port 9100.</p>
                <p class="font-bold text-zinc-200">Try in this order:</p>
                <ol class="list-decimal pl-5 space-y-1.5 text-zinc-300">
                    <li>Open Ableton and drag <strong>StrideLink</strong> from User Library → Max for Live → Audio Effects onto a MIDI track. The device should appear and Stride will auto-connect within ~3 seconds.</li>
                    <li>If StrideLink is already loaded, <strong>remove it and re-add it</strong> to the track (this restarts its server).</li>
                    <li>If it still won't connect, <strong>quit Stride and Ableton, launch Stride first, then Ableton</strong>.</li>
                    <li>Windows only — check that Windows Defender Firewall isn't blocking Node.js on port 9100. Allow it on private networks.</li>
                </ol>
                <p class="text-zinc-500 text-[10px] pt-2 border-t border-white/5">Stride retries automatically every 3 seconds. The pill will turn green when the connection is established.</p>
            `;
        }
    }

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

        // ── "N Params Empty" — a LIVE count of mapped lanes with no drawn curve
        // yet (locked-empty lanes are intentional, so excluded). Updates on every
        // edit/scan via sdRenderSidebar: ticks DOWN as you fill lanes, back UP
        // when you clear one, hidden when all are filled.
        const emptyCount = sdCanvasParams.filter(p => (!p.points || p.points.length === 0) && !p.locked).length;
        let syncHtml = '';
        if (emptyCount > 0) {
            syncHtml = `<div class="flex items-center gap-1.5 px-2 py-1 rounded bg-amber-500/10 border border-amber-500/20 mb-1">
                <span class="w-1.5 h-1.5 rounded-full bg-amber-400 shrink-0"></span>
                <span class="text-[8px] text-amber-400 font-bold uppercase tracking-wider truncate">${emptyCount} Param${emptyCount === 1 ? '' : 's'} Empty</span>
            </div>`;
        }

        // Stride 2.0: templates are retired from the UI — only the sync notice
        // shows here now (the .alc/template engine still exists for stride-1.x).
        el.innerHTML = syncHtml;
    }

    // ─── SUCCESS POPUP ──────────────────────────────────────
    // Prominent, centered, auto-dismissing confirmation so applies/injects
    // don't go unnoticed in the tiny bottom status line. Self-contained
    // (inline styles, no extra HTML); auto-removes after 2s.
    function _sdShowSuccessPopup(title, detail) {
        const old = document.getElementById('sd-success-popup');
        if (old) old.remove();
        const el = document.createElement('div');
        el.id = 'sd-success-popup';
        el.style.cssText = 'position:fixed;top:50%;left:50%;transform:translate(-50%,-50%) scale(0.96);' +
            'z-index:99999;opacity:0;transition:opacity .18s ease,transform .18s ease;pointer-events:none;';
        el.innerHTML =
            '<div style="background:rgba(9,9,11,.95);border:1px solid rgba(16,185,129,.45);border-radius:16px;' +
            'padding:22px 30px;box-shadow:0 24px 70px rgba(0,0,0,.6);text-align:center;backdrop-filter:blur(10px);">' +
            '<div style="font-size:30px;line-height:1;margin-bottom:8px;">✓</div>' +
            '<div style="color:#34d399;font-size:13px;font-weight:800;letter-spacing:.08em;text-transform:uppercase;">' +
            (title || 'Done') + '</div>' +
            (detail ? '<div style="color:#a1a1aa;font-size:12px;margin-top:7px;">' + detail + '</div>' : '') +
            '</div>';
        document.body.appendChild(el);
        requestAnimationFrame(() => {
            el.style.opacity = '1';
            el.style.transform = 'translate(-50%,-50%) scale(1)';
        });
        setTimeout(() => {
            el.style.opacity = '0';
            el.style.transform = 'translate(-50%,-50%) scale(0.96)';
            setTimeout(() => { if (el && el.parentNode) el.remove(); }, 220);
        }, 2000);
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
        // reliably, so mousedown triggers startDrag() directly as a backup.
        // WINDOWS-ONLY: on macOS dragstart fires reliably, and starting the
        // native drag from mousedown (on the press, before a real drag
        // gesture) makes the clip "stick to the cursor" on trackpads. Mac
        // uses the standard dragstart path above.
        if (window.stride && window.stride.platform === 'win32') {
            card.addEventListener('mousedown', (e) => {
                if (e.button !== 0) return;
                if (e.target && e.target.closest && e.target.closest('#sd-apply-reveal-close')) return;
                if (_lastAlcPath && window.stride && window.stride.startDrag) {
                    window.stride.startDrag(_lastAlcPath);
                }
            });
        }
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
        // Routing index MUST follow the rack's device-parameter order — which
        // is the order envelopes appear in the template .alc, and the order the
        // injector consumes (alc-injector.js maps envelope_index → the Nth
        // template envelope in document order). It must NOT follow the
        // alphabetical DISPLAY sort (_sdSortByName) applied to sdCanvasParams,
        // nor the saved order of a loaded session.
        //
        // envelopeId is the scanner's sequential device-order id (String(p.id)
        // from scanner_max.js) and is preserved across live scans AND session
        // loads, so ranking params by numeric envelopeId reconstructs device
        // order regardless of how lanes are currently displayed or were saved.
        // This reproduces the pre-v1.2 routing that the v1.2 lane sort broke.
        // DO NOT replace this with the array index — see test-envelope-routing.js.
        const _routeRank = new Map(
            sdCanvasParams
                .map(p => p.envelopeId)
                .sort((a, b) => {
                    const na = Number(a), nb = Number(b);
                    if (Number.isFinite(na) && Number.isFinite(nb)) return na - nb;
                    return String(a).localeCompare(String(b));
                })
                .map((eid, i) => [eid, i])
        );
        const paramsWithPoints = sdCanvasParams
            .map(p => ({ ...p, envelope_index: _routeRank.get(p.envelopeId) }))
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
        // If a pattern is armed but the user has since changed bar count,
        // re-expand the raw notes against the current canvas length so the
        // injected notes match the clip we're about to write.
        const currentBars = sdGetBars();
        const midiNotes = _resolveArmedNotesForBars(currentBars);
        console.log('[Stride] Apply: device=' + currentDeviceName +
                    ' template=' + currentTemplatePath +
                    ' name=' + clipName +
                    ' totalParams=' + sdCanvasParams.length +
                    ' pattern=' + (sdArmedPattern ? sdArmedPattern.name : 'none') +
                    ' notes=' + (midiNotes ? midiNotes.length : 0));
        strideLink.applyAutomation(
            paramsWithPoints, currentBars, currentDeviceName,
            currentTemplatePath, true, clipName || null, midiNotes
        );
        saveCanvasState();
    };

    // ─── DIRECT INJECT (opt-in, no .alc / no template / no drag) ──────────
    // Writes automation STRAIGHT into the selected Session clip via the
    // StrideInject Remote Script. Parallel to applyToAbleton (the .alc path),
    // which is left completely UNTOUCHED. Routes by LOM `_path` (so no
    // envelope_index, no template clip needed). Requires StrideInject enabled
    // in Ableton → Preferences → Link/Tempo/MIDI → Control Surface.
    //
    // Automation only — armed MIDI-note patterns still go through the .alc
    // path (StrideInject writes envelopes, not notes).
    window.applyToAbletonDirect = function() {
        const el = document.getElementById('sd-canvas-status');
        if (!strideLink.connected) {
            if (el) el.textContent = 'Not connected to M4L';
            return;
        }
        const params = sdCanvasParams
            .filter(p => p.points && p.points.length > 0)
            .map(p => ({
                id: p.id,
                name: p.name,
                _path: p._path || null,
                min: p.min,
                max: p.max,
                is_log: p.is_log || false,
                points: _sdRangeApply(p),   // host-bound: 0..1 shape scaled into [rangeMin,rangeMax] when the lane is ranged
            }));
        // Armed Pattern Library notes ride the same inject — curves AND notes.
        const notes = _resolveArmedNotesForBars(sdGetBars()) || [];
        if (params.length === 0 && notes.length === 0) {
            if (el) el.textContent = 'Draw some curves or pick a pattern first';
            return;
        }
        // Curve params resolve by their live LOM path; a loaded session has no
        // _path until a fresh sync. (Notes-only injects don't need a path.)
        if (params.length > 0 && !params.some(p => p._path)) {
            if (el) el.textContent = 'Inject needs a fresh sync first';
            return;
        }
        if (el) { el.style.color = ''; el.textContent = 'Injecting into clip…'; }
        _sdInjecting = true; _sdJustInjected = false; _sdSendQuickState();
        strideLink.applyDirectInject(params, sdGetBars(), { createIfMissing: true, notes: notes });
        saveCanvasState();
        // Don't hang on "Injecting…" forever when StrideInject never answers — the
        // #1 cause is the Remote Script not being enabled. Time out with guidance.
        // (inject_success/inject_error clear this; if a slow inject answers late it
        // self-corrects.)
        if (_sdInjectTimeout) clearTimeout(_sdInjectTimeout);
        _sdInjectTimeout = setTimeout(function () {
            _sdInjectTimeout = null;
            _sdInjecting = false; _sdJustInjected = false; _sdSendQuickState();
            const el2 = document.getElementById('sd-canvas-status');
            if (el2) {
                el2.style.color = '#fbbf24';
                el2.textContent = "StrideInject didn't respond. In Live: Preferences → Link/Tempo/MIDI → Control Surface → pick StrideInject (use Install to Ableton first if it isn't listed).";
            }
        }, 15000);
    };

    // ─── Armed pattern: arm / clear / chip render ─────────

    function _renderArmedChip() {
        const chip = document.getElementById('sd-armed-pattern-chip');
        const label = document.getElementById('sd-armed-pattern-label');
        if (!chip || !label) return;
        if (!sdArmedPattern) {
            chip.classList.add('hidden');
            return;
        }
        chip.classList.remove('hidden');
        const p = sdArmedPattern;
        const parts = [p.name];
        if (p.key) parts.push(p.key);
        if (p.bars) parts.push(p.bars + (p.bars === 1 ? ' bar' : ' bars'));
        label.textContent = parts.join(' · ');
    }

    function _expandPatternNotes(rawNotes, patternBars, canvasBars) {
        if (!Array.isArray(rawNotes) || rawNotes.length === 0) return [];
        const canvasBeats = canvasBars * 4;
        if (patternBars >= canvasBars) {
            return rawNotes
                .filter(n => n.time < canvasBeats)
                .map(n => ({
                    ...n,
                    duration: Math.min(n.duration, canvasBeats - n.time),
                }));
        }
        const reps = Math.floor(canvasBars / patternBars);
        const patternBeats = patternBars * 4;
        const out = [];
        for (let r = 0; r < reps; r++) {
            const offset = r * patternBeats;
            for (const n of rawNotes) out.push({ ...n, time: n.time + offset });
        }
        return out;
    }

    function _resolveArmedNotesForBars(canvasBars) {
        if (!sdArmedPattern) return null;
        if (sdArmedPattern.expandedForBars === canvasBars && Array.isArray(sdArmedPattern.expandedNotes)) {
            return sdArmedPattern.expandedNotes;
        }
        // Re-expand from raw against the new canvas length
        const expanded = _expandPatternNotes(
            sdArmedPattern.rawNotes,
            sdArmedPattern.bars,
            canvasBars
        );
        sdArmedPattern.expandedNotes = expanded;
        sdArmedPattern.expandedForBars = canvasBars;
        return expanded;
    }

    /**
     * Arm a pattern from the Library overlay. Called by pattern-library.js
     * when the user clicks "Pick Pattern".
     *
     * @param {Object} pattern    manifest entry (id, name, bars, key, bpm, ...)
     * @param {Array}  rawNotes   parsed notes from the .mid (time/duration in beats)
     */
    window.sdArmPattern = function(pattern, rawNotes) {
        if (!pattern || !Array.isArray(rawNotes)) return false;
        const canvasBars = sdGetBars();
        sdArmedPattern = {
            id: pattern.id,
            name: pattern.name,
            bars: pattern.bars,
            key: pattern.key,
            bpm: pattern.bpm,
            rawNotes: rawNotes,
            expandedNotes: _expandPatternNotes(rawNotes, pattern.bars, canvasBars),
            expandedForBars: canvasBars,
        };
        _renderArmedChip();
        return true;
    };

    window.sdClearPattern = function() {
        sdArmedPattern = null;
        _renderArmedChip();
    };

    window.sdGetArmedPattern = function() {
        return sdArmedPattern ? { id: sdArmedPattern.id, name: sdArmedPattern.name } : null;
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

    // ENGINE-OWNED ranges (VST wrapper only): report every committed band edit to the engine,
    // which persists it in the PROJECT and echoes it back in rack_scanned — so re-pushes and
    // project reloads rebuild the bands from the engine instead of wiping them (client-only
    // ranges were reset by positional re-pushes; field report 2026-07-16). Desktop/M4L has no
    // engine ranges — the flag gates it off there.
    function _sdPushRangeToEngine(p) {
        try {
            if (!p || !window.strideLink || !window.strideLink._wrapper) return;
            window.strideLink.send({ type: 'set_range', id: parseInt(p.envelopeId, 10),
                                     on: !!p.rangeOn,
                                     min: (typeof p.rangeMin === 'number' ? p.rangeMin : 0),
                                     max: (typeof p.rangeMax === 'number' ? p.rangeMax : 1) });
        } catch (e) {}
    }

    // ── RANGE FOR GROUP ── the SELECTION is the group: editing the band of a lane that is
    // SELECTED applies the same absolute band to every selected lane. Locked lanes are
    // skipped (locks mean hands-off — the same contract the generators honor), except the
    // lane you physically edited, which always applies. Editing an unselected lane stays
    // single-lane, exactly as before.
    function _sdRangeGroupTargets(edited) {
        if (!edited) return [edited];
        // The ACTIVE lane is part of the group BOTH WAYS: a plain click "chooses" a lane
        // without setting p.selected (it even clears the selection), so users read it as
        // part of their set. Member: group edits pull it in (2026-07-16: "only changes the
        // other 3"). TRIGGER: editing the active lane itself, while a selection exists,
        // must drive the whole group too (2026-07-17: tweaking the first/active lane moved
        // only itself while B/C edits moved all three). Editing an unselected, non-active
        // lane stays single-lane — the deliberate escape hatch.
        // Pool = VISIBLE lanes only: with a device focused, the group can never
        // reach lanes the filter hides (belt-and-braces under the selected ⊆
        // visible invariant — sdSelectAll and sdSetDeviceFilter maintain it).
        const pool = sdVisibleParams();
        const anySelected = pool.some(p => p && p.selected);
        const isActive = edited.envelopeId === sdActiveParamId;
        if (!(edited.selected || (isActive && anySelected))) return [edited];
        const targets = pool.filter(p => p && p.selected && (p === edited || !p.locked));
        const active = pool.find(p => p && p.envelopeId === sdActiveParamId);
        if (active && !active.locked && targets.indexOf(active) < 0) targets.push(active);
        if (targets.indexOf(edited) < 0) targets.push(edited);   // the physically edited lane always applies (even locked — a direct act)
        return targets.length ? targets : [edited];
    }

    // Copy the edited lane's WHOLE band onto every target, then one batched engine push.
    function _sdRangeApplyGroup(edited) {
        const targets = _sdRangeGroupTargets(edited);
        for (const t of targets) {
            if (t === edited) continue;
            t.rangeOn = edited.rangeOn; t.rangeMin = edited.rangeMin; t.rangeMax = edited.rangeMax;
        }
        _sdPushRangesToEngine(targets);
        return targets;
    }

    // ── lane color popup (1.1.11) ───────────────────────────────────
    // Left-click on a lane's color bar → 12 swatches + AUTO. Paints the whole selection
    // when the clicked lane is part of it, else just that lane. Wrapper: every change is
    // pushed to the engine (set_color) so re-pushes/reopens echo it back — the ranges
    // pattern. Motion tools never touch colorIdx (it lives outside `points`).
    function _sdPushColorToEngine(param) {
        try {
            if (!window.strideLink || !window.strideLink._wrapper) return;
            const id = parseInt(param.envelopeId, 10);
            if (isNaN(id)) return;
            window.strideLink.send({ type: 'set_color', id: id, c: (typeof param.colorIdx === 'number' ? param.colorIdx : -1) });
        } catch (e) {}
    }
    // Per-lane LOCK (wrapper) — engine-owned via set_lock/set_locks, echoed back in
    // rack_scanned: the ranges/colors ownership pattern, closing the LAST client-only
    // lane attribute. Locks lived only in localStorage, and the wrapper's localStorage
    // is ONE shared profile for every instance in the DAW, keyed only by chain summary —
    // so locking lanes in one instance force-loaded its lanes into every other instance
    // hosting the same chain on their next open (field report 2026-08-03).
    function _sdPushLockToEngine(p) {
        try {
            if (!p || !window.strideLink || !window.strideLink._wrapper) return;
            const id = parseInt(p.envelopeId, 10);
            if (isNaN(id)) return;
            window.strideLink.send({ type: 'set_lock', id: id, on: !!p.locked });
        } catch (e) {}
    }
    // Batched wrapper push: one engine lock pass (set_locks) for Lock All / Unlock All /
    // "Lock current lanes" — mirrors _sdPushRangesToEngine; a single lane keeps set_lock.
    function _sdPushLocksToEngine(params) {
        try {
            if (!window.strideLink || !window.strideLink._wrapper) return;
            const items = (params || []).map(function (p) {
                return { id: p ? parseInt(p.envelopeId, 10) : NaN, on: !!(p && p.locked) };
            }).filter(function (it) { return !isNaN(it.id); });
            if (!items.length) return;
            if (items.length === 1) { window.strideLink.send({ type: 'set_lock', id: items[0].id, on: items[0].on }); return; }
            window.strideLink.send({ type: 'set_locks', items: items });
        } catch (e) {}
    }
    // Per-lane LOOP + SPEED (wrapper) — engine-owned via set_loop/set_speed, echoed back
    // in rack_scanned: the exact ranges/colors ownership pattern. Speed replaced the
    // groove grid (2026-08-04): same icon slot, but a press-and-drag rate ladder instead
    // of a picker — "how fast this lane runs compared to the rest".
    function _sdPushLoopToEngine(p) {
        try {
            if (!p || !window.strideLink || !window.strideLink._wrapper) return;
            const id = parseInt(p.envelopeId, 10);
            if (isNaN(id)) return;
            window.strideLink.send({ type: 'set_loop', id: id, beats: (typeof p.loopBeats === 'number' ? p.loopBeats : 0) });
        } catch (e) {}
    }
    function _sdPushSpeedToEngine(p) {
        try {
            if (!p || !window.strideLink || !window.strideLink._wrapper) return;
            const id = parseInt(p.envelopeId, 10);
            if (isNaN(id)) return;
            window.strideLink.send({ type: 'set_speed', id: id, s: (typeof p.speed === 'number' && p.speed > 0 ? p.speed : 1) });
        } catch (e) {}
    }
    // The speed ladder: musical rate steps, dragged through vertically (up = faster).
    // 1x sits mid-ladder so the default is one nudge away from either direction.
    const SD_SPEED_LADDER = [0.25, 0.5, 1, 2, 4];
    function _sdSpeedIdx(s) {
        let best = 2, bd = 1e9;
        for (let i = 0; i < SD_SPEED_LADDER.length; i++) {
            const d = Math.abs(SD_SPEED_LADDER[i] - s);
            if (d < bd) { bd = d; best = i; }
        }
        return best;
    }
    function _sdSpeedLabel(s) {
        // Plain "1/2" / "1/4" below 1x — the unicode fraction glyphs vanished at icon
        // size (field feedback 2026-08-04); above 1x the X reads as "times".
        const v = SD_SPEED_LADDER[_sdSpeedIdx(s)];
        return v === 0.25 ? '1/4' : v === 0.5 ? '1/2' : (v + 'X');
    }
    // Press-and-drag state for the lane speed glyph (no popup — drag up/down, ~24px per step).
    let _sdSpeedDrag = null;   // { param, startY, startIdx, lastIdx }

    let _sdColorPopEl = null, _sdColorPopParam = null;
    function _sdCloseColorPopup() { if (_sdColorPopEl) { _sdColorPopEl.remove(); _sdColorPopEl = null; _sdColorPopParam = null; } }
    function _sdColorTargets(param) {
        // The ACTIVE lane renders exactly as highlighted as the selected ones, so users
        // count it in the group ("select a few" usually starts with a plain click that
        // ACTIVATES lane 1, then Ctrl+clicks that SELECT lanes 2..n — field report
        // 2026-07-26: the first lane wasn't painted). Paint what the highlight shows.
        const act = sdCanvasParams.find(p => p.envelopeId === sdActiveParamId);
        const sel = sdCanvasParams.filter(p => (p.selected || (act && p === act)) && !p.locked);
        if (sel.length > 1 && sel.indexOf(param) >= 0) return sel;
        return [param];
    }
    function _sdOpenColorPopup(param, clientX, clientY) {
        _sdCloseColorPopup();
        _sdColorPopParam = param;
        const targets = _sdColorTargets(param);
        const pop = document.createElement('div');
        pop.id = 'sd-color-popup';
        pop.style.cssText = 'position:fixed;z-index:10070;background:#09090b;border:1px solid rgba(255,255,255,0.12);'
            + 'border-radius:10px;box-shadow:0 18px 50px rgba(0,0,0,0.8);padding:10px;width:168px;'
            + "font-family:'Outfit',sans-serif";
        const title = document.createElement('div');
        title.style.cssText = 'font-size:9px;font-weight:900;letter-spacing:0.14em;text-transform:uppercase;color:#a1a1aa;margin-bottom:8px';
        title.textContent = targets.length > 1 ? ('Paint ' + targets.length + ' lanes') : 'Lane color';
        pop.appendChild(title);
        const grid = document.createElement('div');
        grid.style.cssText = 'display:grid;grid-template-columns:repeat(6,1fr);gap:6px';
        const apply = (idx) => {
            pushUndo();
            targets.forEach(p => { p.colorIdx = idx; _sdPushColorToEngine(p); });
            _sdCloseColorPopup();
            sdDrawCanvasGrid();
            if (typeof sdRenderSidebar === 'function') sdRenderSidebar();
            Promise.resolve(saveCanvasState());
            const st = document.getElementById('sd-canvas-status');
            if (st) st.textContent = idx < 0 ? 'Lane color: auto' : ('Painted ' + targets.length + ' lane' + (targets.length > 1 ? 's' : ''));
        };
        SD_LANE_PALETTE.forEach((rgb, idx) => {
            const b = document.createElement('button');
            b.style.cssText = 'width:21px;height:21px;border-radius:5px;cursor:pointer;border:1px solid rgba(255,255,255,0.15);background:rgb(' + rgb + ')'
                + (param.colorIdx === idx ? ';box-shadow:0 0 0 2px #09090b,0 0 0 3.5px #e879f9' : '');
            b.title = idx < 5 ? ('Patch ' + (idx + 1)) : ('Color ' + (idx + 1));
            b.addEventListener('click', (e) => { e.stopPropagation(); apply(idx); });
            grid.appendChild(b);
        });
        pop.appendChild(grid);
        const auto = document.createElement('button');
        auto.textContent = 'Auto (skin)';
        auto.style.cssText = 'margin-top:8px;width:100%;font-size:9px;font-weight:800;letter-spacing:0.12em;text-transform:uppercase;'
            + 'color:#a1a1aa;background:none;border:1px dashed rgba(255,255,255,0.2);border-radius:5px;padding:4px 0;cursor:pointer';
        auto.addEventListener('click', (e) => { e.stopPropagation(); apply(-1); });
        pop.appendChild(auto);
        document.body.appendChild(pop);
        // Clamp inside the viewport (fixed positioning).
        const r = pop.getBoundingClientRect();
        pop.style.left = Math.max(6, Math.min(clientX + 8, window.innerWidth - r.width - 6)) + 'px';
        pop.style.top = Math.max(6, Math.min(clientY - 20, window.innerHeight - r.height - 6)) + 'px';
        setTimeout(() => {
            const closer = (ev) => { if (_sdColorPopEl && !_sdColorPopEl.contains(ev.target)) { _sdCloseColorPopup(); document.removeEventListener('mousedown', closer, true); } };
            document.addEventListener('mousedown', closer, true);
        }, 0);
        _sdColorPopEl = pop;
    }

    // Batched wrapper push: one engine lock pass, one dirty mark (set_ranges). A single
    // lane keeps the 1.1.5 set_range path unchanged.
    function _sdPushRangesToEngine(params) {
        try {
            if (!window.strideLink || !window.strideLink._wrapper) return;
            const items = (params || []).map(function (p) {
                return { id: parseInt(p.envelopeId, 10), on: !!p.rangeOn,
                         min: (typeof p.rangeMin === 'number' ? p.rangeMin : 0),
                         max: (typeof p.rangeMax === 'number' ? p.rangeMax : 1) };
            }).filter(function (it) { return !isNaN(it.id); });
            if (!items.length) return;
            if (items.length === 1) { _sdPushRangeToEngine(params[0]); return; }
            window.strideLink.send({ type: 'set_ranges', items: items });
        } catch (e) {}
    }

    // Host-bound OUTPUT scale: map the lane's 0..1 shape into [rangeMin,rangeMax] when the lane
    // is ranged (used at inject + live-drive). The stored/edited shape stays 0..1 — this only
    // transforms what the HOST receives, so changing the range instantly rescales the output.
    function _sdRangeApply(p) {
        if (!p || !p.rangeOn) return p.points;
        const lo = p.rangeMin, span = (p.rangeMax - p.rangeMin);
        return p.points.map(pt => ({ time: pt.time, value: Math.max(0, Math.min(1, lo + pt.value * span)), curve: pt.curve || 0 }));
    }
    // Inverse of _sdRangeApply: a click's screen value (0..1) -> the stored 0..1 shape, so
    // drawing/hit-testing on a ranged lane works within the band (clicking the ceiling = 1.0).
    function _sdRangeInv(p, v) {
        if (!p || !p.rangeOn) return v;
        const span = p.rangeMax - p.rangeMin;
        return span > 0 ? Math.max(0, Math.min(1, (v - p.rangeMin) / span)) : v;
    }

    // ─── LOCAL STATE PERSISTENCE ──────────────────────────

    async function saveCanvasState() {
        const key = currentClipKey || currentRackId;
        if (!key || !window.stride) return;
        // Save lanes that either have points OR are explicitly locked OR carry a custom range.
        // A locked-but-empty (or ranged-but-empty) lane is still meaningful intent, preserved
        // across reloads. Points/range are stored as the raw 0..1 shape (non-destructive).
        const state = sdCanvasParams
            .filter(p => p.points.length > 0 || p.locked || p.rangeOn || (typeof p.colorIdx === 'number' && p.colorIdx >= 0)
                      || (typeof p.loopBeats === 'number' && p.loopBeats > 0) || (typeof p.speed === 'number' && p.speed !== 1))
            .map(p => ({
                envelopeId: p.envelopeId,   // legacy / back-compat key
                _path: p._path || null,     // STABLE key — match on this; positional envelopeId renumbers when params are added
                locked: !!p.locked,
                rangeOn: !!p.rangeOn, rangeMin: p.rangeMin, rangeMax: p.rangeMax,   // per-param output range
                colorIdx: (typeof p.colorIdx === 'number' ? p.colorIdx : -1),       // lane color override (-1 = AUTO)
                loopBeats: (typeof p.loopBeats === 'number' ? p.loopBeats : 0),     // per-lane loop boundary (wrapper; 0 = off)
                speed: (typeof p.speed === 'number' ? p.speed : 1),                 // per-lane rate multiplier (wrapper; 1 = normal)
                points: p.points.map(pt => ({ time: pt.time, value: pt.value, curve: pt.curve || 0 }))
            }));
        await window.stride.saveCanvasState(key, state);
    }

    async function restoreCanvasState() {
        // WRAPPER: never apply the saved-state overlay. The engine echo (rack_scanned)
        // already rebuilt every lane per-instance from the PROJECT — curves, ranges,
        // colors, loop, quant AND locks. The wrapper's window.stride store is
        // localStorage: ONE shared profile for every instance in the DAW, keyed only by
        // chain summary — so two instances hosting the same chain shared one slot, and
        // opening one painted the other's saved lanes (and force-restored its LOCKS)
        // over its own echo; the next autosave then pushed that into the engine for
        // real (field report 2026-08-03). The desktop app keeps the full restore below:
        // its keys are per-track (real LOM paths) and it has no engine echo to lean on.
        if (window.strideLink && window.strideLink._wrapper) { _renderTemplateStatus(); return; }
        const key = currentClipKey || currentRackId;
        if (!key || !window.stride) return;
        const _epoch = _sdCurveEpoch;   // detect a curve edit that lands DURING the async load below
        let result = await window.stride.loadCanvasState(key);
        // Migration fallback: states saved before the track-index key change live
        // under the legacy name-based key. If nothing is saved under the current
        // key, load the legacy one (recovers older curves + locks); the next save
        // writes it under the current key, so it self-heals after one cycle.
        if (!(result && result.success && result.state && result.state.length)
            && currentLegacyKey && currentLegacyKey !== key) {
            const legacy = await window.stride.loadCanvasState(currentLegacyKey);
            if (legacy && legacy.success && legacy.state && legacy.state.length) result = legacy;
        }
        // _stale = you applied curves (a generator press / draw) WHILE we were loading
        // from disk. The rescan-merge kicks off this restore (via loadParamsDirectly)
        // BEFORE a queued generator runs, but the disk read resolves just AFTER it.
        const _stale = (_epoch !== _sdCurveEpoch);
        if (result.success && result.state && Array.isArray(result.state)) {
            result.state.forEach(sp => {
                // Match on the STABLE LOM _path; fall back to the positional
                // envelopeId ONLY for legacy saves that predate _path (the
                // positional id renumbers when params are added, so it would restore
                // curves/locks onto the wrong param).
                const param = sp._path
                    ? sdCanvasParams.find(p => p._path && p._path === sp._path)
                    : sdCanvasParams.find(p => p.envelopeId === sp.envelopeId);
                if (!param) return;
                // Range is independent of lock/curve — always restore it.
                if (typeof sp.rangeOn === 'boolean') {
                    param.rangeOn = sp.rangeOn;
                    if (typeof sp.rangeMin === 'number') param.rangeMin = sp.rangeMin;
                    if (typeof sp.rangeMax === 'number') param.rangeMax = sp.rangeMax;
                }
                // Lane color: independent like range. Engine echo (wrapper) wins where it
                // spoke — the saved value only fills lanes still on AUTO.
                if (typeof sp.colorIdx === 'number' && sp.colorIdx >= 0 && !(param.colorIdx >= 0))
                    param.colorIdx = sp.colorIdx;
                // Loop boundary + speed (wrapper): same fill-the-default story — the
                // engine echo already landed via loadParamsDirectly and must win.
                if (typeof sp.loopBeats === 'number' && sp.loopBeats > 0 && !(param.loopBeats > 0))
                    param.loopBeats = sp.loopBeats;
                if (typeof sp.speed === 'number' && sp.speed !== 1 && !(typeof param.speed === 'number' && param.speed !== 1))
                    param.speed = sp.speed;
                // A LOCKED saved lane is ALWAYS restored (curve + lock) — even right
                // after a generator press. loadParamsDirectly rebuilds every lane
                // UNLOCKED, so without this a rescan-before-generate unlocks the lanes
                // you locked and lets the generator overwrite them (the "press Motion →
                // unlock all" bug). An UNLOCKED lane only takes its saved curve when it's
                // empty under a STALE restore, so a late disk read can't clobber curves
                // you just applied (the duplicate-clip flash-then-revert).
                if (sp.locked) {
                    if (sp.points) param.points = sp.points;
                    param.locked = true;
                } else {
                    if (typeof sp.locked === 'boolean') param.locked = sp.locked;
                    if (sp.points && !(_stale && param.points && param.points.length)) param.points = sp.points;
                }
            });
        }
        // Reflect restored curves in the "N Params Empty" indicator (curves are
        // filled here, a tick after loadParamsDirectly swaps the lane set).
        _renderTemplateStatus();

        // Unknown clip — no curves for this clip yet (a fresh clip, or automation
        // drawn directly in Ableton). Auto-read the clip's existing automation
        // onto the matching lanes so the canvas reflects what's really in the
        // clip ("clip is the source of truth"). Once per clip key, and only when
        // the canvas is genuinely empty — we check live lane points (not just
        // restored ones) so a device-added rescan that carried in-memory curves
        // is never clobbered by a read.
        const anyCurves = sdCanvasParams.some(p => p.points && p.points.length > 0);
        if (!anyCurves && !_sdAutoReadAttempted[key]
            && sdCanvasParams.length > 0 && strideLink.connected) {
            _sdAutoReadAttempted[key] = true;
            _sdReadFillOnly = true;   // auto-read: fill empty lanes only, never clobber user curves
            try { strideLink.readClipCurves('A'); } catch (e) {}
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
        sdCanvasFx = document.getElementById('sd-canvas-fx');
        if (sdCanvasFx) {
            sdFxCtx = sdCanvasFx.getContext('2d');
            sdStartFx();
            // Pause the comet when Stride isn't focused/visible — zero CPU while
            // you're in Ableton or the window is minimized.
            window.addEventListener('focus', sdStartFx);
            window.addEventListener('blur', sdStopFx);
            document.addEventListener('visibilitychange', () => { if (document.hidden) sdStopFx(); else sdStartFx(); });
        }
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
        if (sdCanvasFx && sdFxCtx) {     // keep the comet overlay pixel-aligned with the main canvas
            sdCanvasFx.width = container.clientWidth * dpr;
            sdCanvasFx.height = container.clientHeight * dpr;
            sdFxCtx.setTransform(1, 0, 0, 1, 0, 0);
            sdFxCtx.scale(dpr, dpr);
            sdCanvasFx.style.width = container.clientWidth + 'px';
            sdCanvasFx.style.height = container.clientHeight + 'px';
        }
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

    // ─── TOOL AVAILABILITY (gray-out Bloom / Prism / Mutate) ─
    // Bloom, Prism, and Mutate all need the selected parameter to have a
    // curve drawn on it (and Bloom/Prism additionally need ≥2 lanes so
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
                    btn.classList.add('opacity-40', 'cursor-not-allowed');
                    btn.setAttribute('data-unavailable', reason);
                } else {
                    btn.classList.remove('opacity-40', 'cursor-not-allowed');
                    btn.removeAttribute('data-unavailable');
                }
            };

            // Bloom needs an existing curve to copy (it's a one-shot operation
            // that fans out the active lane's current curve to siblings).
            const bloomReason = !activeHasCurve
                ? 'Pick a parameter in the sidebar and draw or Chaos a curve first'
                : (!hasMultipleLanes ? 'Need at least 2 lanes' : '');
            dim('sd-bloom-btn', !activeHasCurve || !hasMultipleLanes, bloomReason);

            // Prism is live-draw — variants react to source as it's drawn,
            // so an empty active lane is fine. Only need a selected lane
            // and ≥2 lanes total to have anything to spread to.
            const hasActive = !!sdActiveParamId;
            const prismReason = !hasActive
                ? 'Pick a parameter in the sidebar to be the source'
                : (!hasMultipleLanes ? 'Need at least 2 lanes' : '');
            dim('sd-prism-btn', !hasActive || !hasMultipleLanes, prismReason);

            // Mutate only needs active curve
            dim('sd-mutate-btn', !activeHasCurve,
                'Pick a parameter in the sidebar and draw or Chaos a curve first');
        } catch (e) { /* DOM not ready yet */ }
    }

    // ─── SIDEBAR ──────────────────────────────────────────

    function sdRenderSidebar() {
        // The sd-param-list element was removed — its space is now used
        // by the context panel (Generative + Edit sliders). The function
        // is kept because many call sites rely on it for downstream
        // effects (empty-state CTA, tool availability). If a future
        // build re-introduces the param list, this guard is harmless.
        const list = document.getElementById('sd-param-list');
        if (!list) {
            sdUpdateEmptyState();
            sdUpdateToolAvailability();
            _renderTemplateStatus();   // keep the "N Params Empty" notice live as lanes fill
            return;
        }
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
            const isActive = sdActiveParamId === p.envelopeId;
            const isLocked = !!p.locked;
            // Lock icon SVG — outline when unlocked (zinc-500), filled with
            // amber when locked. onclick stops propagation so it doesn't
            // also fire the lane's "set active" handler.
            const lockIcon = isLocked
                ? `<svg class="w-3 h-3 text-amber-400 shrink-0" fill="currentColor" viewBox="0 0 24 24"><path d="M12 2a5 5 0 00-5 5v3H6a2 2 0 00-2 2v9a2 2 0 002 2h12a2 2 0 002-2v-9a2 2 0 00-2-2h-1V7a5 5 0 00-5-5zm-3 8V7a3 3 0 016 0v3H9z"/></svg>`
                : `<svg class="w-3 h-3 text-zinc-500 shrink-0" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" d="M8 11V7a4 4 0 118 0m-4 8v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2z"/></svg>`;
            const dim = isLocked ? 'opacity-60' : '';
            const bg = isActive
                ? 'bg-fuchsia-500/20 text-fuchsia-400 border border-fuchsia-500/30'
                : isLocked
                    ? 'bg-amber-500/5 text-zinc-400 border border-amber-500/20'
                    : 'bg-black/20 text-zinc-400 border border-white/5 hover:bg-white/5';
            return `
            <div class="relative ${dim}">
                <button onclick="sdSetActiveParam('${p.envelopeId}')" class="w-full text-left px-3 py-2 pr-9 rounded-lg text-[9px] font-bold uppercase tracking-widest transition-colors ${bg}">
                    <div class="truncate">${displayName}</div>
                    <div class="flex items-center justify-between mt-0.5">
                        <span class="text-[8px] text-zinc-600">${p.points.length} pts${p.is_log ? ' · log' : ''}</span>
                        <span class="text-[8px] text-zinc-600 font-mono">${fmtVal(p.min)} - ${fmtVal(p.max)}</span>
                    </div>
                </button>
                <button onclick="event.stopPropagation(); window.sdToggleLockLane('${p.envelopeId}')" class="absolute top-1.5 right-1.5 p-1 rounded hover:bg-white/10 transition-colors" title="${isLocked ? 'Locked — motion tools and sliders skip this lane. Click to unlock.' : 'Lock this lane — motion tools and sliders will skip it.'}">
                    ${lockIcon}
                </button>
            </div>`;
        }).join('');

        // Keep the empty-canvas CTA in sync with the param list
        sdUpdateEmptyState();
        // Keep Bloom/Prism/Mutate gray-out state in sync
        sdUpdateToolAvailability();
    }

    // Toggle the lock state of a single lane. Locked lanes are skipped
    // by all generative tools, sliders, and manual drawing. The .alc
    // export still includes them — lock is about EDIT protection.
    window.sdToggleLockLane = function(envelopeId) {
        const p = sdCanvasParams.find(p => p.envelopeId === envelopeId);
        if (!p) return;
        p.locked = !p.locked;
        // Locking a lane clears its selection — locked = "off limits", which
        // is incompatible with "in the active selection set".
        if (p.locked) p.selected = false;
        _sdPushLockToEngine(p);   // engine-owned on the wrapper: per-instance + project-persistent (desktop no-op)
        sdRenderSidebar();
        sdDrawCanvasGrid();
        saveCanvasState(); // persist the lock state immediately
        if (typeof _sdUpdateSelectionButtons === 'function') _sdUpdateSelectionButtons();
    };

    // Remove a single lane BY its engine position and re-index the lanes that sat AFTER it,
    // so their positions stay in lockstep with the engine's re-indexed mapping. No full rack
    // rebuild → every surviving lane keeps its exact curve, lock, and RANGE on its own object
    // (a positional rack re-push would key lanes by the "wrap:<i>" _path, which renumbers on
    // erase and carries the removed lane's range onto its neighbour — the unmap-range bug).
    // notifyEngine=true: the × button (engine hasn't dropped it yet). false: touch-unmap (the
    // engine already erased it and told us the position via `unmapped_at`).
    function _sdRemoveLaneByPos(pos, notifyEngine) {
        const idx = sdCanvasParams.findIndex(p => p.id === pos);
        if (idx < 0) return false;
        const removed = sdCanvasParams[idx];
        const activeObj = sdCanvasParams.find(p => p.envelopeId === sdActiveParamId);
        sdCanvasParams.splice(idx, 1);
        // Positions above the removed one shift down by 1 — mirror that on id/_path/envelopeId.
        sdCanvasParams.forEach(p => {
            if (typeof p.id === 'number' && p.id > pos) {
                p.id -= 1; p.envelopeId = String(p.id); p._path = 'wrap:' + p.id;
            }
        });
        sdActiveParamId = (activeObj && sdCanvasParams.indexOf(activeObj) >= 0)
            ? activeObj.envelopeId
            : (sdCanvasParams[0] ? sdCanvasParams[0].envelopeId : null);
        // Emit BEFORE the re-flush in saveCanvasState so the engine re-indexes its
        // mapping first (drops the mapped entry + its drive lane).
        if (notifyEngine) {
            try { if (window.strideLink && window.strideLink.send) window.strideLink.send({ type: 'unmapParam', id: pos }); } catch (e) {}
        }
        sdRenderSidebar();
        sdDrawCanvasGrid();
        try { saveCanvasState(); } catch (e) {}   // persist re-indexed lanes + re-flush remaining curves
        const st = document.getElementById('sd-canvas-status');
        if (st) st.textContent = 'Unmapped ' + (removed.device ? removed.device + ' · ' : '') + (removed.name || 'param');
        return true;
    }

    // Unmap a single lane (the per-lane × — wrapper only).
    window.sdUnmapLane = function(envelopeId) {
        const p = sdCanvasParams.find(x => x.envelopeId === envelopeId);
        if (p) _sdRemoveLaneByPos(p.id, true);
    };

    // Touch-unmap (armed Unmap + touch a knob): the ENGINE removed the mapping and sent us the
    // exact position. Splice that lane the same leak-free way — never a positional re-push.
    strideLink.on('unmapped_at', function(msg) {
        if (msg && typeof msg.position === 'number') _sdRemoveLaneByPos(msg.position, false);
    });

    // ── Per-param RANGE: numeric min/max fields ──────────────────────────────
    // Drawn in the label column beneath the param name when Range is on. Each is a
    // little chip you can (a) press + drag up/down to scrub, or (b) double-click to
    // type an exact %. Both write rangeMin/rangeMax — same effect as dragging the
    // dashed boundary on the lane. Hit rects are recorded into _sdRangeFieldRects for
    // the mousedown/hover handlers; the whole thing is additive/null-default (Range off
    // → not drawn → StrideLink desktop is unchanged).
    const _SD_RANGE_FIELD_W = 47, _SD_RANGE_FIELD_H = 15, _SD_RANGE_FIELD_GAP = 4;
    function _sdDrawRangeFields(ctx, param, x, yTop, paramIdx) {
        const rgb = sdLaneColor(param, paramIdx);
        const fields = [
            { edge: 'rangeMin', cap: 'MIN', val: Math.round((param.rangeMin || 0) * 100) },
            { edge: 'rangeMax', cap: 'MAX', val: Math.round((param.rangeMax || 0) * 100) }
        ];
        for (let i = 0; i < fields.length; i++) {
            const f = fields[i];
            const fx = x + i * (_SD_RANGE_FIELD_W + _SD_RANGE_FIELD_GAP);
            const editing = _sdRangeNumInput && _sdRangeNumInput.id === param.envelopeId && _sdRangeNumInput.edge === f.edge;
            ctx.save();
            ctx.beginPath();
            if (ctx.roundRect) ctx.roundRect(fx, yTop, _SD_RANGE_FIELD_W, _SD_RANGE_FIELD_H, 3);
            else ctx.rect(fx, yTop, _SD_RANGE_FIELD_W, _SD_RANGE_FIELD_H);
            ctx.fillStyle = editing ? 'rgba(' + rgb + ',0.22)' : 'rgba(255,255,255,0.05)';
            ctx.fill();
            ctx.lineWidth = 1; ctx.strokeStyle = 'rgba(' + rgb + ',0.40)'; ctx.stroke();
            ctx.textBaseline = 'middle'; ctx.textAlign = 'left';
            ctx.font = '600 6px Outfit'; ctx.fillStyle = 'rgba(161,161,170,0.85)';
            ctx.fillText(f.cap, fx + 4, yTop + _SD_RANGE_FIELD_H / 2 + 0.5);
            ctx.font = 'bold 9px Outfit'; ctx.fillStyle = 'rgba(' + rgb + ',0.95)';
            ctx.fillText(f.val + '%', fx + 18, yTop + _SD_RANGE_FIELD_H / 2 + 0.5);
            ctx.restore();
            _sdRangeFieldRects.push({ param: param, edge: f.edge, x: fx, y: yTop, w: _SD_RANGE_FIELD_W, h: _SD_RANGE_FIELD_H });
        }
    }

    // Apply a 0..100 % to a lane boundary, keeping min below max (2% floor between).
    function _sdRangeSetPercent(param, edge, pct) {
        let v = Math.max(0, Math.min(1, pct / 100));
        if (edge === 'rangeMax') param.rangeMax = Math.max(v, (param.rangeMin || 0) + 0.02);
        else                     param.rangeMin = Math.min(v, (param.rangeMax || 1) - 0.02);
        _sdRangeApplyGroup(param);   // engine owns ranges (scrub + typed field); selected lanes edit as a GROUP
    }

    // Double-click a field → a tiny <input> in place to type an exact %.
    function _sdOpenRangeFieldInput(field) {
        pushUndo();   // ranges are undoable — checkpoint before a typed exact-% commit
        _sdCloseRangeFieldInput();
        if (!sdCanvasEl) return;
        const cr = sdCanvasEl.getBoundingClientRect();
        const inp = document.createElement('input');
        inp.type = 'text'; inp.inputMode = 'numeric';
        inp.value = String(Math.round((field.param[field.edge] || 0) * 100));
        inp.style.cssText = 'position:fixed;z-index:100000;box-sizing:border-box;'
            + 'width:' + field.w + 'px;height:' + (field.h + 2) + 'px;'
            + 'left:' + (cr.left + field.x) + 'px;top:' + (cr.top + field.y - 1) + 'px;'
            + 'background:#18181b;border:1px solid rgba(255,255,255,0.35);border-radius:3px;'
            + 'color:#fafafa;font:bold 10px Outfit;text-align:center;outline:none;padding:0;';
        document.body.appendChild(inp);
        _sdRangeNumInput = { id: field.param.envelopeId, edge: field.edge, el: inp };
        inp.focus(); inp.select();
        sdDrawCanvasGrid();   // reflect the "editing" chip highlight
        let done = false;
        const commit = (apply) => {
            if (done) return; done = true;
            if (apply) {
                const n = parseInt(inp.value, 10);
                if (!isNaN(n)) { _sdRangeSetPercent(field.param, field.edge, n); Promise.resolve(saveCanvasState()); }
            }
            if (inp.parentNode) inp.parentNode.removeChild(inp);
            _sdRangeNumInput = null;
            sdDrawCanvasGrid();
        };
        inp.addEventListener('keydown', (ev) => {
            ev.stopPropagation();   // don't trigger canvas shortcuts (undo, tool keys) while typing
            if (ev.key === 'Enter') { ev.preventDefault(); commit(true); }
            else if (ev.key === 'Escape') { ev.preventDefault(); commit(false); }
        });
        inp.addEventListener('blur', () => commit(true));
    }
    function _sdCloseRangeFieldInput() {
        if (_sdRangeNumInput && _sdRangeNumInput.el && _sdRangeNumInput.el.parentNode) {
            _sdRangeNumInput.el.parentNode.removeChild(_sdRangeNumInput.el);
        }
        _sdRangeNumInput = null;
    }

    // Toolbar action: lock or unlock every lane at once. If any lane is
    // currently unlocked, the action LOCKS all. If everything is already
    // locked, the action UNLOCKS all. Single-button toggle.
    window.sdToggleLockAll = function() {
        if (!sdCanvasParams.length) return;
        const anyUnlocked = sdCanvasParams.some(p => !p.locked);
        sdCanvasParams.forEach(p => {
            p.locked = anyUnlocked;
            if (p.locked) p.selected = false;
        });
        _sdPushLocksToEngine(sdCanvasParams);   // one batched engine pass (wrapper; desktop no-op)
        sdRenderSidebar();
        sdDrawCanvasGrid();
        saveCanvasState();
        if (typeof _sdUpdateSelectionButtons === 'function') _sdUpdateSelectionButtons();
        const status = document.getElementById('sd-canvas-status');
        if (status) status.textContent = anyUnlocked
            ? `All ${sdCanvasParams.length} lanes locked`
            : `All ${sdCanvasParams.length} lanes unlocked`;
    };

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
        // Selection set wins when non-empty: tools target selected (unlocked)
        // lanes. Otherwise fall back to active lane only (legacy behavior).
        // Locked lanes are always skipped regardless of selection — lock is
        // an absolute "don't touch" contract.
        // When a chain device is focused (sdDeviceFilter), the pool is just that
        // device's lanes, so tools/generators act only on what's on screen.
        const pool = sdVisibleParams();
        const selected = pool.filter(p => p.selected && !p.locked);
        if (selected.length > 0) return selected;
        const p = pool.find(p => p.envelopeId === sdActiveParamId);
        return (p && !p.locked) ? [p] : [];
    }

    // Counts how many lanes are in the active selection set (unlocked only).
    // Used by tools that iterate sdCanvasParams directly to know whether
    // to scope to selected or to all unlocked.
    function sdHasSelection() {
        return sdCanvasParams.some(p => p.selected && !p.locked);
    }

    // Used by tools that iterate sdCanvasParams directly. Returns selected
    // lanes if there's a selection, else all unlocked. Locked are always
    // filtered out.
    function sdGetUnlockedParams() {
        // Focused device only when one is selected (sdDeviceFilter), else all lanes.
        const pool = sdVisibleParams();
        const sel = pool.filter(p => p.selected && !p.locked);
        if (sel.length > 0) return sel;
        return pool.filter(p => !p.locked);
    }
    function sdLockSkipMessage(processedCount) {
        const total = sdCanvasParams.length;
        const locked = sdCanvasParams.filter(p => p.locked).length;
        if (locked === 0) return null;
        return `Applied to ${processedCount}/${total} lanes — ${locked} locked`;
    }

    // ─── DRAWING ──────────────────────────────────────────

    // ─── MULTI-VIEW HELPERS ──────────────────────────────
    // How many lanes fit visually in the current canvas height.
    // Lanes shown in multi view: all, or just one device's when a chain device is
    // selected. PURE view filter — sdCanvasParams stays whole, so curves keep
    // driving every device regardless of what's on screen.
    function sdVisibleParams() {
        if (!sdDeviceFilter) return sdCanvasParams;
        return sdCanvasParams.filter(p => (p.device || '') === sdDeviceFilter);
    }
    window.sdSetDeviceFilter = function(dev) {
        sdDeviceFilter = (dev && dev !== sdDeviceFilter) ? dev : null;   // click a device to focus it; click it again (or pass null) to show all
        const vis = sdVisibleParams();
        if (sdDeviceFilter) {
            // Focusing a device DROPS selection on the lanes it hides. A selection
            // that isn't on screen would silently ride every group edit (ranges,
            // colors, floor/ceiling) — the invariant is: selected ⊆ visible.
            let dropped = false;
            sdCanvasParams.forEach(p => {
                if (p.selected && (p.device || '') !== sdDeviceFilter) { p.selected = false; dropped = true; }
            });
            if (dropped) sdRenderSidebar();
        }
        if (sdDeviceFilter && !vis.some(p => p.envelopeId === sdActiveParamId))
            sdActiveParamId = vis.length ? vis[0].envelopeId : sdActiveParamId;
        sdMultiScrollOffset = 0;
        sdMultiClampScroll();
        _sdUpdateSelectionButtons();   // lit-state follows the pool, which just changed
        sdDrawCanvasGrid();
        return sdDeviceFilter;
    };

    function sdMultiVisibleLaneCount() {
        if (!sdCanvasEl) return 0;
        const h = sdCanvasEl.getBoundingClientRect().height;
        return Math.max(1, Math.floor(h / SD_MULTI_LANE_HEIGHT));
    }

    // Clamp scroll offset to legal range whenever lane count changes.
    function sdMultiClampScroll() {
        const visible = sdMultiVisibleLaneCount();
        const maxOffset = Math.max(0, sdVisibleParams().length - visible);
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
        const vis = sdVisibleParams();
        if (paramIdx >= vis.length) return null;
        return {
            param: vis[paramIdx],
            rect: sdMultiGetVisibleRowRect(rowIdx),
            rowIdx,
        };
    }

    // ─────────────────────────────────────────────────────────────────────
    // LANE COMET (Option C) — a small glowing dot + short trailing tail rides
    // each drawn lane's curve, looping across the bar. A decorative "alive /
    // modulating" cue. Drawn on a SEPARATE FX overlay canvas so the main canvas
    // stays static (no full redraw per frame). Only lanes WITH a curve animate;
    // empty lanes stay still. Multi-view only. Skin-colored (uses sdLaneRGB).
    // ─────────────────────────────────────────────────────────────────────
    let sdCanvasFx = null, sdFxCtx = null;
    let _sdLaneGeom = [];            // per-visible-lane {poly:[{x,y}], rgb} cached on each main draw
    let _sdFxRAF = 0;
    const SD_FX_LOOP = 16800;        // ms per comet pass (slow ambient drift — 4× slower)
    const SD_FX_TRAIL = 12;          // trail length in poly samples

    // Sample a lane's curve into pixel points, matching the draw's per-segment
    // interpolation (linear, or the same quadratic bend). Pixel-space, so the
    // comet rides exactly where the curve is drawn (tracks zoom/pan/scroll).
    function _sdSampleLanePixels(pts, timeToX, valueToY) {
        const out = [];
        if (!pts || pts.length < 2) return out;
        // Walk EVERY segment so the polyline follows the drawn curve 1:1 —
        // straight segments need one step; curved (bezier) segments subdivide.
        // (A flat global sample count under-samples dense generative curves and
        // makes the comet visibly cut corners.)
        for (let i = 0; i < pts.length - 1; i++) {
            const a = pts[i], b = pts[i + 1];
            const ax = timeToX(a.time), ay = valueToY(a.value);
            const bx = timeToX(b.time), by = valueToY(b.value);
            const cv = a.curve || 0;
            const steps = cv === 0 ? 1 : 12;
            for (let s = (i === 0 ? 0 : 1); s <= steps; s++) {   // skip dup join points
                const u = s / steps;
                const x = ax + (bx - ax) * u;                    // x linear in u (matches the draw's midpoint-control quad)
                let y;
                if (cv === 0) {
                    y = ay + (by - ay) * u;
                } else {
                    const my = (ay + by) / 2;
                    const cpY = my - cv * Math.abs(by - ay) * 1.2;
                    y = (1 - u) * (1 - u) * ay + 2 * (1 - u) * u * cpY + u * u * by;
                }
                out.push({ x, y });
            }
        }
        return out;
    }

    // One overlay paint at a given loop phase (0..1). Shared by BOTH drivers: the
    // ambient wall-clock loop (desktop/M4L — no transport feed exists there) and the
    // wrapper's engine-synced playhead. The trail reads as motion, so a parked
    // (stopped-transport) paint draws the head only.
    function _sdFxDraw(phase, withTrail) {
        if (!sdFxCtx || !sdCanvasFx) return;
        // The LANDING ANIMATION owns the overlay while it runs. Without this gate the
        // playing-transport comet (engine kicks, ≤30Hz) — or the desktop's ambient
        // drift (60fps) — clearRects the landing's partial strokes between its frames:
        // visible flicker exactly while the DAW plays (field report 2026-08-13; when
        // stopped nothing repaints, which is why it only glitched during playback).
        // _sdLandEnd hands the overlay back and repaints the freshest phase.
        if (_sdLandAnim) return;
        sdFxCtx.clearRect(0, 0, sdCanvasFx.width, sdCanvasFx.height);
        if (sdViewMode !== 'multi' || !_sdLaneGeom.length) return;
        sdFxCtx.lineCap = 'round';
        for (let li = 0; li < _sdLaneGeom.length; li++) {
            const g = _sdLaneGeom[li], poly = g.poly;
            if (!poly || poly.length < 2) continue;
            const n = poly.length;
            // Position the head by x (time) so the comet keeps an even pace even
            // though curved segments carry more samples than straight ones.
            // LOOPED lanes (wrapper) wrap the phase at their own boundary — the comet
            // restarts exactly on the drawn loop line, in step with the engine's wrap
            // (field report 2026-08-03: "the animation keeps passing it").
            let tx;
            const spd = (g.speed && g.speed > 0) ? g.speed : 1;
            if ((g.loopFrac && g.loopFrac > 0) || spd !== 1) {
                // Lane-local clock: engine time × the lane's speed, wrapped at the lane's
                // own loop fraction (the full canvas when unlooped). In NOTES FREE the
                // phrase is ENDLESS — wrap the RAW beat clock, not the globally-wrapped
                // phase, so boundaries that don't divide the bar count stay in step with
                // the engine (no global reset, field request 2026-08-04).
                const Lf = (g.loopFrac && g.loopFrac > 0) ? g.loopFrac : 1;
                const base = (_sdEngFree && g.tb > 0) ? (_sdEngBeats / g.tb) : phase;
                const lt = ((base * spd) % Lf + Lf) % Lf;
                tx = g.tx0 + lt * g.txSpan;
            } else {
                tx = poly[0].x + phase * (poly[n - 1].x - poly[0].x);
            }
            let idx = 0; while (idx < n - 1 && poly[idx + 1].x <= tx) idx++;
            if (withTrail) for (let k = 0; k < SD_FX_TRAIL; k++) {   // fading trail behind the head
                const i1 = idx - k, i0 = i1 - 1;
                if (i0 < 0) break;
                const a = poly[i0], b = poly[i1];
                sdFxCtx.strokeStyle = 'rgba(' + g.rgb + ',' + ((1 - k / SD_FX_TRAIL) * 0.5).toFixed(3) + ')';
                sdFxCtx.lineWidth = 2;
                sdFxCtx.beginPath(); sdFxCtx.moveTo(a.x, a.y); sdFxCtx.lineTo(b.x, b.y); sdFxCtx.stroke();
            }
            const head = poly[Math.min(idx, n - 1)];        // glowing head dot
            sdFxCtx.save();
            sdFxCtx.shadowBlur = 8;
            sdFxCtx.shadowColor = 'rgba(' + g.rgb + ',0.9)';
            sdFxCtx.fillStyle = 'rgba(' + g.rgb + ',0.95)';
            sdFxCtx.beginPath(); sdFxCtx.arc(head.x, head.y, 2.6, 0, Math.PI * 2); sdFxCtx.fill();
            sdFxCtx.fillStyle = 'rgba(255,255,255,0.9)';
            sdFxCtx.beginPath(); sdFxCtx.arc(head.x, head.y, 1.1, 0, Math.PI * 2); sdFxCtx.fill();
            sdFxCtx.restore();
        }
    }

    function _sdFxFrame(ts) {
        _sdFxRAF = requestAnimationFrame(_sdFxFrame);
        _sdFxDraw((ts % SD_FX_LOOP) / SD_FX_LOOP, true);   // ambient drift — decorative, wall-clock
    }

    // ── ENGINE-SYNCED PLAYHEAD (VST wrapper) ─────────────────────────────
    // The wrapper feeds the REAL transport loop phase from its audio engine (shim
    // 'playhead' events: 0..1 + playing flag, change-detected, ≤30Hz). The FIRST
    // tick retires the ambient wall-clock loop for good — from then on the comet
    // rides the true automation position and repaints ONLY when a fresh phase
    // arrives: no free-running RAF, zero paints while the transport is stopped
    // (the head stays PARKED at the real position; the trail shows only in motion).
    // Desktop/M4L never call this, so nothing changes outside the wrapper.
    let _sdEngMode = false, _sdEngPhase = 0, _sdEngOn = false, _sdEngPend = 0;
    let _sdEngDrawnPhase = -1, _sdEngDrawnOn = null;
    let _sdEngBeats = 0, _sdEngFree = false;   // raw phrase beats + notes-free flag (endless per-lane wraps)
    function _sdEngKick() {
        if (_sdEngPend) return;                             // coalesce bursts into one painted frame
        _sdEngPend = requestAnimationFrame(() => {
            _sdEngPend = 0;
            _sdEngDrawnPhase = _sdEngPhase; _sdEngDrawnOn = _sdEngOn;
            _sdFxDraw(_sdEngPhase, _sdEngOn);
        });
    }
    window.sdSetEnginePlayhead = function (phase, on, beats, free) {
        if (!_sdEngMode) { _sdEngMode = true; sdStopFx(); } // the fake drift never comes back
        _sdEngPhase = Math.min(1, Math.max(0, +phase || 0));
        _sdEngOn = !!on;
        _sdEngBeats = +beats || 0;   // raw (unwrapped) phrase beats — notes-free lanes wrap these at their OWN boundary
        _sdEngFree = !!free;
        // Sub-pixel phase moves don't repaint (a 64-bar loop crawls — painting it at 30Hz
        // would be pure waste; it repaints as soon as the head has actually moved).
        if (_sdEngOn !== _sdEngDrawnOn || Math.abs(_sdEngPhase - _sdEngDrawnPhase) > 0.0015) _sdEngKick();
    };

    // ── LANDING ANIMATION (2026-08-12, Yossi-picked mockup B "draw-on") ─────────────
    // When a motion tool / template prints new curves, each lane's stroke DRAWS ITSELF
    // bar-1 → end with a comet head (the playhead's visual language), lanes 15ms apart
    // (stagger capped so big racks stay ≤ ~240ms total). ONE-SHOT rAF: ~12 frames, then
    // silence — zero idle cost, no timers. The main canvas skips the animating lanes'
    // static print for the duration; the engine-playhead comet pauses on the shared
    // overlay and resumes via _sdEngKick when the landing ends. Honors
    // prefers-reduced-motion (instant print, exactly the pre-animation behavior).
    let _sdLandAnim = null;   // { t0, ids:Set<envelopeId>, order:[envelopeId], dur, stag, raf }
    const _SD_LAND_REDUCED = (function () { try { return window.matchMedia('(prefers-reduced-motion: reduce)').matches; } catch (e) { return false; } })();
    function _sdLandKick(params) {
        try {
            if (_SD_LAND_REDUCED || sdViewMode !== 'multi') return;   // focus view keeps the instant print
            const pool = (params && params.length ? params : sdCanvasParams.filter(p => !p.locked))
                .filter(p => p && p.points && p.points.length > 1);
            if (!pool.length) return;
            if (_sdLandAnim && _sdLandAnim.raf) cancelAnimationFrame(_sdLandAnim.raf);
            const order = pool.map(p => p.envelopeId);
            _sdLandAnim = { t0: performance.now(), ids: new Set(order), order: order,
                            dur: 200, stag: Math.min(15, 240 / order.length), raf: 0 };
            sdDrawCanvasGrid();   // repaint with the animating strokes hidden (geometry rebuilds)
            _sdLandAnim.raf = requestAnimationFrame(_sdLandFrame);
        } catch (e) { _sdLandAnim = null; }
    }
    function _sdLandFrame(now) {
        const a = _sdLandAnim;
        if (!a) return;
        if (!sdFxCtx || !sdCanvasFx || !_sdLaneGeom.length) { _sdLandEnd(); return; }
        sdFxCtx.clearRect(0, 0, sdCanvasFx.width, sdCanvasFx.height);
        sdFxCtx.lineCap = 'round';
        let alive = false;
        for (let gi = 0; gi < _sdLaneGeom.length; gi++) {
            const g = _sdLaneGeom[gi];
            if (!g.id || !a.ids.has(g.id) || !g.poly || g.poly.length < 2) continue;
            const idx = a.order.indexOf(g.id);
            const k = Math.max(0, Math.min(1, (now - a.t0 - idx * a.stag) / a.dur));
            if (k < 1) alive = true;
            const ease = 1 - Math.pow(1 - k, 3);
            const edgeX = g.tx0 + ease * g.txSpan;
            const poly = g.poly;
            sdFxCtx.strokeStyle = 'rgba(' + g.rgb + ',1)';
            sdFxCtx.lineWidth = 1.6;
            sdFxCtx.beginPath();
            let head = null;
            for (let i = 0; i < poly.length; i++) {
                if (poly[i].x > edgeX) break;
                head = poly[i];
                if (i === 0) sdFxCtx.moveTo(poly[i].x, poly[i].y); else sdFxCtx.lineTo(poly[i].x, poly[i].y);
            }
            sdFxCtx.stroke();
            if (k < 1 && head) {   // the writing head — exactly the playhead comet's look
                sdFxCtx.save();
                sdFxCtx.shadowBlur = 8;
                sdFxCtx.shadowColor = 'rgba(' + g.rgb + ',0.9)';
                sdFxCtx.fillStyle = 'rgba(' + g.rgb + ',0.95)';
                sdFxCtx.beginPath(); sdFxCtx.arc(head.x, head.y, 2.6, 0, Math.PI * 2); sdFxCtx.fill();
                sdFxCtx.fillStyle = 'rgba(255,255,255,0.9)';
                sdFxCtx.beginPath(); sdFxCtx.arc(head.x, head.y, 1.1, 0, Math.PI * 2); sdFxCtx.fill();
                sdFxCtx.restore();
            }
        }
        if (alive) a.raf = requestAnimationFrame(_sdLandFrame);
        else _sdLandEnd();
    }
    function _sdLandEnd() {
        const had = !!_sdLandAnim;
        if (_sdLandAnim && _sdLandAnim.raf) cancelAnimationFrame(_sdLandAnim.raf);
        _sdLandAnim = null;
        if (had) {
            if (sdFxCtx && sdCanvasFx) sdFxCtx.clearRect(0, 0, sdCanvasFx.width, sdCanvasFx.height);
            sdDrawCanvasGrid();             // the strokes return to the main canvas
            if (_sdEngMode) _sdEngKick();   // hand the overlay back to the playhead comet
        }
    }

    // Start/stop the FX loop. Paused when Stride is unfocused or hidden so it
    // costs zero CPU while you're working in Ableton (the common case). Inert in
    // engine-playhead mode (focus/visibility must not resurrect the fake drift).
    function sdStartFx() { if (_sdEngMode || _sdFxRAF) return; _sdFxRAF = requestAnimationFrame(_sdFxFrame); }
    function sdStopFx() {
        if (_sdFxRAF) { cancelAnimationFrame(_sdFxRAF); _sdFxRAF = 0; }
        if (sdFxCtx && sdCanvasFx) sdFxCtx.clearRect(0, 0, sdCanvasFx.width, sdCanvasFx.height);
    }

    // ─────────────────────────────────────────────────────────────────────
    // INJECT-RAIL CABLES (Option B) — one cable per lane (with a curve) runs
    // from its right edge into the centered "Inject to Clip" hub on the right.
    // Skin-colored (Patch gives each lane its own color). Rebuilt on every
    // multi-view redraw so cables track scroll/zoom; cleared in single view.
    // SVG (#sd-cables) lives inside the rail; coords are rail-local.
    // ─────────────────────────────────────────────────────────────────────
    function _sdRenderCables() {
        const svg = document.getElementById('sd-cables');
        const rail = document.getElementById('sd-inject-rail');
        if (!svg || !rail) return;
        if (sdViewMode !== 'multi' || !_sdLaneGeom.length) { svg.innerHTML = ''; return; }
        const rw = rail.clientWidth, rh = rail.clientHeight;
        const RULER_H = 20;                              // lane coords start below the ruler
        const JACK_X = 5.5;                              // plug's left edge sits exactly on the lane's end (x=0 = canvas right edge)
        const endX = rw * 0.5 - 48, endY = rh * 0.5;     // hub left edge (CTA centered in rail)
        const k = Math.max(22, (endX - JACK_X) * 0.5);
        let cables = '', jacks = '';
        // A neutral metallic jack (grey in every skin via the --z ramp): dark
        // socket body + grey collar, dark hole, light center pin. cx/cy/r vary.
        const jack = (x, y, r) =>
            '<circle cx="' + x + '" cy="' + y + '" r="' + r + '" style="fill:rgb(var(--z800));stroke:rgb(var(--z500))" stroke-width="1.5"/>' +
            '<circle cx="' + x + '" cy="' + y + '" r="' + (r * 0.42).toFixed(2) + '" style="fill:rgb(var(--z950))"/>' +
            '<circle cx="' + x + '" cy="' + y + '" r="' + (r * 0.16).toFixed(2) + '" style="fill:rgb(var(--z300))"/>';
        for (let i = 0; i < _sdLaneGeom.length; i++) {
            const g = _sdLaneGeom[i];
            const sy = (RULER_H + g.cy).toFixed(1);
            const col = 'rgb(' + g.rgb + ')';
            const d = 'M' + JACK_X + ',' + sy + ' C' + (JACK_X + k).toFixed(1) + ',' + sy + ' ' + (endX - k).toFixed(1) + ',' + endY.toFixed(1) + ' ' + endX.toFixed(1) + ',' + endY.toFixed(1);
            // Cable = dark casing under a colored core, so it reads as a round cable, not a hairline.
            cables += '<path d="' + d + '" fill="none" stroke="rgba(0,0,0,0.4)" stroke-width="5" stroke-linecap="round"/>';
            cables += '<path d="' + d + '" fill="none" stroke="' + col + '" stroke-opacity="0.85" stroke-width="3" stroke-linecap="round"/>';
            jacks += jack(JACK_X, sy, 5.5);             // neutral input plug on the lane's edge
        }
        jacks += jack(endX.toFixed(1), endY.toFixed(1), 7);   // hub input jack (where every cable seats)
        svg.innerHTML = cables + jacks;              // cables under the jacks so plugs sit on top
    }

    // ── Compact mode ────────────────────────────────────────────────────
    // Compact is the SAME real canvas, reflowed — NOT a separate renderer.
    // toggleCompactMode flips body.qp-compact, which (via CSS in index.html)
    // hides the full-only chrome (sidebar, the two big toolbar rows, the inject
    // rail) and shows the slim .sd-compact-only toolbar + slider strip. Those
    // compact controls call the REAL canvas functions directly (sdMirrorLane,
    // sdApplyIntensity, …), so there's ONE source of truth and no mirror to fall
    // out of sync (the bug that lost edits made in the old compact view). Main
    // shrinks + pins the window via the set-compact-mode IPC.
    let _sdCompact = false;   // true while this window is toggled into compact mode
    window.toggleCompactMode = function () {
        _sdCompact = !_sdCompact;
        document.body.classList.toggle('qp-compact', _sdCompact);
        try { if (window.stride && window.stride.setCompactMode) window.stride.setCompactMode(_sdCompact); } catch (e) {}
        // Re-fit the real canvas to the new (smaller/larger) viewport once the
        // layout settles — it resizes to its container on 'resize'. Fires on BOTH
        // directions so the canvas grows back when leaving compact.
        setTimeout(function () { try { window.dispatchEvent(new Event('resize')); } catch (e) {} }, 40);
    };

    // Wrapper-only: coalesce curve changes and push them to the engine shortly after
    // each change, so drawing / generators / sliders modulate the knobs LIVE — no need
    // to click away (blur) to make it fire. Throttled + idempotent, so incidental
    // redraws (pan, hover) cost at most one harmless re-push. No-op in the desktop app.
    let _sdDriveFlushTimer = 0;
    function _sdScheduleDriveFlush() {
        if (!window.__STRIDE_WRAPPER__ || _sdDriveFlushTimer || _sdGlowPaint) return;   // glow repaints are pure cosmetics — no engine traffic
        _sdDriveFlushTimer = setTimeout(function () {
            _sdDriveFlushTimer = 0;
            // NEVER flush an empty canvas. On a project reload the lanes arrive a beat
            // before their curves; a stray empty flush here would push live_curves:[] and
            // wipe the engine's just-restored drive lanes — leaving the reload blank.
            if (!sdCanvasParams.length) return;
            try { Promise.resolve(saveCanvasState()); } catch (e) {}
        }, 150);
    }

    function sdDrawCanvasGrid() {
        if (!sdCtx || !sdCanvasEl || !sdCanvasRect) return;
        _sdScheduleDriveFlush();
        sdDrawRuler();
        const lw = sdCanvasEl.getBoundingClientRect().width;
        const lh = sdCanvasEl.getBoundingClientRect().height;
        sdCtx.clearRect(0, 0, lw, lh);

        // Multi-lane view branches to its own renderer
        if (sdViewMode === 'multi') {
            _sdFocusBackRect = null;     // no back pill in multi view
            sdDrawMultiView(lw, lh);
            _sdRenderCables();
            return;
        }
        { const _cab = document.getElementById('sd-cables'); if (_cab) _cab.innerHTML = ''; }   // single view: no rail cables
        const bars = sdGetBars();
        const totalBeats = bars * 4;
        const gridStep = sdVisualGridBeats();
        const _gm = (v, m) => Math.abs(v / m - Math.round(v / m)) < 1e-6;
        const _gx = (b) => ((b / totalBeats) * lw * sdViewZoomX) - sdViewPanX;

        // Subdivision lines at the active grid resolution (faint; hidden when
        // they'd pack closer than ~5px so dense/triplet grids don't smear).
        if ((gridStep / totalBeats) * lw * sdViewZoomX >= 5) {
            const nSub = Math.floor(totalBeats / gridStep + 1e-6);
            for (let i = 0; i <= nSub; i++) {
                const b = i * gridStep;
                if (_gm(b, 1)) continue;                  // beats drawn in the pass below
                const x = _gx(b);
                if (x < -50 || x > lw + 50) continue;
                sdCtx.strokeStyle = _gm(b, 0.25) ? 'rgba(255,255,255,0.03)' : 'rgba(255,255,255,0.015)';
                sdCtx.lineWidth = 1;
                sdCtx.beginPath(); sdCtx.moveTo(x, 0); sdCtx.lineTo(x, lh); sdCtx.stroke();
            }
        }
        // Bar + beat lines — always drawn so the canvas stays legible at any grid.
        for (let b = 0; b <= totalBeats; b += 1) {
            const x = _gx(b);
            if (x < -50 || x > lw + 50) continue;
            if (b % 4 === 0) { sdCtx.strokeStyle = 'rgba(255,255,255,0.2)'; sdCtx.lineWidth = 2; }
            else { sdCtx.strokeStyle = 'rgba(255,255,255,0.1)'; sdCtx.lineWidth = 1; }
            sdCtx.beginPath(); sdCtx.moveTo(x, 0); sdCtx.lineTo(x, lh); sdCtx.stroke();
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
                sdCtx.fillStyle = 'rgba(' + sdSkinColors.rgb + ',0.9)'; sdCtx.fillText(fv(ap.max), 4, 13);
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
            sdCtx.strokeStyle = 'rgba(' + sdSkinColors.rgb + ',0.6)'; sdCtx.lineWidth = 2;
            sdCtx.beginPath(); sdCtx.moveTo(sx, 0); sdCtx.lineTo(sx, lh); sdCtx.stroke();
            sdCtx.beginPath(); sdCtx.moveTo(ex, 0); sdCtx.lineTo(ex, lh); sdCtx.stroke();
        }

        // Points
        if (!sdActiveParamId) { _sdFocusBackRect = _sdDrawFocusBackBtn(lw, lh); return; }
        const param = sdCanvasParams.find(p => p.envelopeId === sdActiveParamId);
        if (!param || !param.points.length) { _sdFocusBackRect = _sdDrawFocusBackBtn(lw, lh); return; }
        param.points.sort((a, b) => a.time - b.time);

        // Draw curve line
        sdCtx.beginPath(); sdCtx.strokeStyle = sdSkinColors.curve; sdCtx.lineWidth = 2;
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
        sdCtx.fillStyle = sdSkinColors.curve;
        param.points.forEach(pt => {
            const x = ((pt.time / totalBeats) * lw * sdViewZoomX) - sdViewPanX;
            const y = lh - (pt.value * lh);
            if (x >= -10 && x <= lw + 10) {
                sdCtx.beginPath(); sdCtx.arc(x, y, 3, 0, Math.PI * 2); sdCtx.fill();
                if (sdDraggedPoint === pt) {
                    sdCtx.beginPath(); sdCtx.fillStyle = 'rgba(' + sdSkinColors.rgb + ',0.4)'; sdCtx.arc(x, y, 10, 0, Math.PI * 2); sdCtx.fill(); sdCtx.fillStyle = sdSkinColors.curve;
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
                        sdCtx.fillStyle = sdSkinColors.curve;
                    }
                }
            }
        });

        // "← All lanes" pill (focus view only) — one click back to the multi-lane view.
        _sdFocusBackRect = _sdDrawFocusBackBtn(lw, lh);
    }

    // ─── MULTI-LANE RENDERER ──────────────────────────────
    // Renders every visible param as a horizontal strip of SD_MULTI_LANE_HEIGHT
    // Width of the clickable lock-icon zone at the right edge of the
    // multi-view label column. Used both by the renderer (where to draw)
    // and the mousedown hit-test (what counts as a lock click). Keep in
    // sync if the visual layout changes.
    const SD_MULTI_LOCK_HIT_W = 22;
    const SD_MULTI_FOCUS_HIT_W = 20;   // clickable zone for the focus icon, just left of the lock zone

    // Tiny canvas-rendered lock icon used in the multi-lane label column.
    // Two parts: a half-circle shackle + a rectangular body. When locked,
    // the body is filled. When unlocked, the body is just stroked — so
    // users can tell at a glance which lanes are protected and which
    // are clickable-to-lock.
    function _drawLockIcon(ctx, x, y, size, color, locked) {
        ctx.save();
        ctx.strokeStyle = color;
        ctx.fillStyle = color;
        ctx.lineWidth = 1.4;
        // Shackle (top arc)
        ctx.beginPath();
        ctx.arc(x + size / 2, y + size * 0.42, size * 0.27, Math.PI, 0, false);
        ctx.stroke();
        // Body (rounded rect — filled when locked, stroked when unlocked)
        const bx = x + size * 0.16;
        const by = y + size * 0.42;
        const bw = size * 0.68;
        const bh = size * 0.50;
        const r = 1;
        ctx.beginPath();
        ctx.moveTo(bx + r, by);
        ctx.lineTo(bx + bw - r, by);
        ctx.quadraticCurveTo(bx + bw, by, bx + bw, by + r);
        ctx.lineTo(bx + bw, by + bh - r);
        ctx.quadraticCurveTo(bx + bw, by + bh, bx + bw - r, by + bh);
        ctx.lineTo(bx + r, by + bh);
        ctx.quadraticCurveTo(bx, by + bh, bx, by + bh - r);
        ctx.lineTo(bx, by + r);
        ctx.quadraticCurveTo(bx, by, bx + r, by);
        if (locked) ctx.fill();
        else ctx.stroke();
        ctx.restore();
    }

    // Tiny "expand to full canvas" icon (four corner brackets) drawn next to
    // each lane's lock glyph. Click it to blow that one lane up to the whole
    // canvas (single-lane focus view).
    function _drawFocusIcon(ctx, x, y, size, color) {
        ctx.save();
        ctx.strokeStyle = color;
        ctx.lineWidth = 1.4;
        ctx.lineJoin = 'round';
        ctx.lineCap = 'round';
        const a = size * 0.34;            // corner arm length
        const L = x, T = y, R = x + size, B = y + size;
        ctx.beginPath(); ctx.moveTo(L, T + a); ctx.lineTo(L, T); ctx.lineTo(L + a, T); ctx.stroke();   // top-left
        ctx.beginPath(); ctx.moveTo(R - a, T); ctx.lineTo(R, T); ctx.lineTo(R, T + a); ctx.stroke();   // top-right
        ctx.beginPath(); ctx.moveTo(R, B - a); ctx.lineTo(R, B); ctx.lineTo(R - a, B); ctx.stroke();   // bottom-right
        ctx.beginPath(); ctx.moveTo(L + a, B); ctx.lineTo(L, B); ctx.lineTo(L, B - a); ctx.stroke();   // bottom-left
        ctx.restore();
    }

    // Tiny "range" glyph (ceiling + floor bars with a vertical span between them) next to the
    // focus/lock icons. Click to toggle the per-param output range; filled tint when active.
    function _drawRangeIcon(ctx, x, y, size, color, on) {
        ctx.save();
        ctx.strokeStyle = color;
        ctx.lineWidth = 1.4;
        ctx.lineCap = 'round';
        const cx = x + size / 2;
        ctx.beginPath(); ctx.moveTo(x + 1, y + 1.5); ctx.lineTo(x + size - 1, y + 1.5); ctx.stroke();               // ceiling
        ctx.beginPath(); ctx.moveTo(x + 1, y + size - 1.5); ctx.lineTo(x + size - 1, y + size - 1.5); ctx.stroke(); // floor
        ctx.beginPath();
        ctx.moveTo(cx, y + 3); ctx.lineTo(cx, y + size - 3);                                                        // span
        ctx.moveTo(cx - 2, y + 5); ctx.lineTo(cx, y + 3); ctx.lineTo(cx + 2, y + 5);                                // up arrowhead
        ctx.moveTo(cx - 2, y + size - 5); ctx.lineTo(cx, y + size - 3); ctx.lineTo(cx + 2, y + size - 5);           // down arrowhead
        ctx.stroke();
        if (on) { ctx.globalAlpha = 0.16; ctx.fillStyle = color; ctx.fillRect(x + 1, y + 2.5, size - 2, size - 5); }
        ctx.restore();
    }

    // Lane-SPEED slot (wrapper), left of the range icon. At 1x it shows a small
    // METRONOME with the pendulum at rest — "riding the track tempo", the default.
    // Off 1x the VALUE ITSELF becomes the icon ("2X", "½X") in the lane colour, so the
    // state reads at a glance (field feedback 2026-08-04: a glyph plus a tiny
    // under-label collided with the range fields and was hard to parse). Press and
    // drag the slot up/down to step the rate ladder.
    function _drawSpeedIcon(ctx, x, y, size, color) {
        ctx.save();
        ctx.strokeStyle = color;
        ctx.lineWidth = 1.4;
        ctx.lineCap = 'round';
        ctx.lineJoin = 'round';
        ctx.beginPath();                                    // metronome body: narrow top, wide base
        ctx.moveTo(x + size * 0.30, y + 1);
        ctx.lineTo(x + size * 0.70, y + 1);
        ctx.lineTo(x + size - 1, y + size - 1);
        ctx.lineTo(x + 1, y + size - 1);
        ctx.closePath();
        ctx.stroke();
        ctx.beginPath();                                    // pendulum at rest = in step with the track
        ctx.moveTo(x + size / 2, y + size - 3);
        ctx.lineTo(x + size / 2, y + 2.5);
        ctx.stroke();
        ctx.restore();
    }

    // The loop-boundary grip: a small vertical pill riding the boundary line at lane
    // mid-height. Low-alpha at the lane's end when no loop is set (the affordance),
    // bright on the boundary when one is.
    function _sdDrawLoopGrip(ctx, x, cy, rgb, alpha) {
        ctx.save();
        const w = 7, h = 20, r = 3;
        const L = x - w / 2, T = cy - h / 2;
        ctx.fillStyle = 'rgba(24,24,27,' + (0.9 * alpha).toFixed(3) + ')';
        ctx.strokeStyle = 'rgba(' + rgb + ',' + alpha.toFixed(3) + ')';
        ctx.lineWidth = 1.2;
        ctx.beginPath();
        ctx.moveTo(L + r, T); ctx.lineTo(L + w - r, T); ctx.quadraticCurveTo(L + w, T, L + w, T + r);
        ctx.lineTo(L + w, T + h - r); ctx.quadraticCurveTo(L + w, T + h, L + w - r, T + h);
        ctx.lineTo(L + r, T + h); ctx.quadraticCurveTo(L, T + h, L, T + h - r);
        ctx.lineTo(L, T + r); ctx.quadraticCurveTo(L, T, L + r, T);
        ctx.closePath(); ctx.fill(); ctx.stroke();
        ctx.strokeStyle = 'rgba(' + rgb + ',' + (0.8 * alpha).toFixed(3) + ')';
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.moveTo(x - 1.2, cy - 4); ctx.lineTo(x - 1.2, cy + 4);
        ctx.moveTo(x + 1.2, cy - 4); ctx.lineTo(x + 1.2, cy + 4);
        ctx.stroke();
        ctx.restore();
    }

    // Tiny "×" at the top-left of a wrapper lane's label — click to UNMAP that param
    // (remove it from the panel + free the knob in the engine). Dim red so it reads as
    // a remove action, distinct from the neutral lock/focus glyphs.
    function _drawUnmapIcon(ctx, x, y, size, color) {
        ctx.save();
        ctx.strokeStyle = color;
        ctx.lineWidth = 1.5;
        ctx.lineCap = 'round';
        ctx.beginPath();
        ctx.moveTo(x, y); ctx.lineTo(x + size, y + size);
        ctx.moveTo(x + size, y); ctx.lineTo(x, y + size);
        ctx.stroke();
        ctx.restore();
    }

    // The "← All lanes" pill shown in focus view (top-right). Returns its hit
    // rect so the mousedown handler can route a click back to multi-lane view.
    function _sdDrawFocusBackBtn(lw, lh) {
        const w = 92, h = 22, pad = 8;
        const x = Math.max(pad, lw - w - pad), y = pad;
        sdCtx.save();
        sdCtx.fillStyle = 'rgba(24,24,27,0.92)';
        sdCtx.strokeStyle = 'rgba(255,255,255,0.18)';
        sdCtx.lineWidth = 1;
        const r = 7;
        sdCtx.beginPath();
        sdCtx.moveTo(x + r, y);
        sdCtx.lineTo(x + w - r, y);
        sdCtx.quadraticCurveTo(x + w, y, x + w, y + r);
        sdCtx.lineTo(x + w, y + h - r);
        sdCtx.quadraticCurveTo(x + w, y + h, x + w - r, y + h);
        sdCtx.lineTo(x + r, y + h);
        sdCtx.quadraticCurveTo(x, y + h, x, y + h - r);
        sdCtx.lineTo(x, y + r);
        sdCtx.quadraticCurveTo(x, y, x + r, y);
        sdCtx.closePath();
        sdCtx.fill();
        sdCtx.stroke();
        sdCtx.fillStyle = 'rgba(244,244,245,0.95)';
        sdCtx.font = 'bold 11px Outfit';
        sdCtx.textAlign = 'left';
        sdCtx.textBaseline = 'middle';
        sdCtx.fillText('← All lanes', x + 11, y + h / 2 + 0.5);
        sdCtx.restore();
        return { x: x, y: y, w: w, h: h };
    }

    // pixels tall. The left SD_MULTI_LABEL_WIDTH pixels of each row show the
    // parameter name + index. The remaining width shows the curve at the
    // normal time zoom + pan. The active param row has a fuchsia border
    // highlight so the user always knows which lane their tool edits target.
    function sdDrawMultiView(lw, lh) {
        sdMultiClampScroll();
        _sdLaneGeom = [];   // rebuilt below for the comet FX overlay
        _sdUnmapRects = []; // rebuilt below — wrapper lanes get a per-lane unmap ×
        _sdColorRects = []; // rebuilt below — every lane gets a color-bar click zone at the left edge
        _sdRangeFieldRects = []; // rebuilt below — ranged lanes get draggable/typable min/max fields
        const bars = sdGetBars();
        const totalBeats = bars * 4;
        const laneDrawLeft = SD_MULTI_LABEL_WIDTH;
        const laneDrawWidth = Math.max(1, lw - SD_MULTI_LABEL_WIDTH);

        // Shared time grid lines — drawn across the whole canvas height so
        // they form vertical rulers connecting all lanes visually.
        const gridStep = sdVisualGridBeats();
        const _gm = (v, m) => Math.abs(v / m - Math.round(v / m)) < 1e-6;
        const _gx = (b) => laneDrawLeft + ((b / totalBeats) * laneDrawWidth * sdViewZoomX) - sdViewPanX;
        sdCtx.save();
        sdCtx.beginPath();
        sdCtx.rect(laneDrawLeft, 0, laneDrawWidth, lh);
        sdCtx.clip();
        // Subdivision lines at the active grid resolution (faint; hidden when
        // they'd pack closer than ~5px so dense/triplet grids don't smear).
        if ((gridStep / totalBeats) * laneDrawWidth * sdViewZoomX >= 5) {
            const nSub = Math.floor(totalBeats / gridStep + 1e-6);
            for (let i = 0; i <= nSub; i++) {
                const b = i * gridStep;
                if (_gm(b, 1)) continue;                  // beats drawn in the pass below
                const x = _gx(b);
                if (x < laneDrawLeft - 50 || x > lw + 50) continue;
                sdCtx.strokeStyle = _gm(b, 0.25) ? 'rgba(255,255,255,0.03)' : 'rgba(255,255,255,0.015)';
                sdCtx.lineWidth = 1;
                sdCtx.beginPath(); sdCtx.moveTo(x, 0); sdCtx.lineTo(x, lh); sdCtx.stroke();
            }
        }
        // Bar + beat lines — always drawn so lanes stay legible at any grid.
        for (let b = 0; b <= totalBeats; b += 1) {
            const x = _gx(b);
            if (x < laneDrawLeft - 50 || x > lw + 50) continue;
            if (b % 4 === 0) { sdCtx.strokeStyle = 'rgba(255,255,255,0.18)'; sdCtx.lineWidth = 2; }
            else { sdCtx.strokeStyle = 'rgba(255,255,255,0.09)'; sdCtx.lineWidth = 1; }
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
        const vis = sdVisibleParams();
        const nameCounts = {};
        const nameIndex = {};
        vis.forEach(p => { nameCounts[p.name] = (nameCounts[p.name] || 0) + 1; });
        // Wrapper-only lane chrome (quant icon, loop boundary, glow) — the desktop app
        // renders byte-identically without this flag.
        const _isWrapUI = !!(window.strideLink && window.strideLink._wrapper);
        const _glowNow = Date.now();

        // Per-lane render
        const visible = sdMultiVisibleLaneCount();
        const sel = sdGetSelection();
        for (let row = 0; row < visible; row++) {
            const paramIdx = row + sdMultiScrollOffset;
            if (paramIdx >= vis.length) break;
            const param = vis[paramIdx];
            nameIndex[param.name] = (nameIndex[param.name] || 0) + 1;
            const displayName = nameCounts[param.name] > 1
                ? `${param.name} (${nameIndex[param.name]})`
                : param.name;
            const rect = sdMultiGetVisibleRowRect(row);
            const isActive = sdActiveParamId === param.envelopeId;
            // Selected lanes get the same brighter visual treatment as the
            // active lane. A lane can be both — that's fine, isHighlighted
            // unifies them.
            const isHighlighted = isActive || !!param.selected;

            // Row background stripe (alternating to make rows scannable)
            sdCtx.fillStyle = row % 2 === 0 ? 'rgba(255,255,255,0.015)' : 'rgba(0,0,0,0.15)';
            sdCtx.fillRect(laneDrawLeft, rect.top, laneDrawWidth, rect.height);

            // Highlighted row (fuchsia tint + border) — active OR selected.
            // Active lane gets a stronger border; selected-only lanes get
            // a softer accent so the focus distinction is preserved.
            if (isHighlighted) {
                sdCtx.fillStyle = 'rgba(' + sdLaneColor(param, paramIdx) + ',0.08)';
                sdCtx.fillRect(0, rect.top, lw, rect.height);
                sdCtx.strokeStyle = isActive ? 'rgba(' + sdLaneColor(param, paramIdx) + ',0.55)' : 'rgba(' + sdLaneColor(param, paramIdx) + ',0.30)';
                sdCtx.lineWidth = isActive ? 1.5 : 1;
                sdCtx.strokeRect(0.75, rect.top + 0.75, lw - 1.5, rect.height - 1.5);
            }

            // Param-touch glow (wrapper): the touched lane flashes in its own color and
            // fades over ~1s — the "here I am" cue for a knob clicked in the plugin GUI.
            if (_isWrapUI && param._glowUntil) {
                const _gRem = param._glowUntil - _glowNow;
                if (_gRem > 0) {
                    const _gA = Math.max(0, Math.min(1, _gRem / 1000));
                    const _gRGB = sdLaneColor(param, paramIdx);
                    sdCtx.fillStyle = 'rgba(' + _gRGB + ',' + (0.10 * _gA).toFixed(3) + ')';
                    sdCtx.fillRect(0, rect.top, lw, rect.height);
                    sdCtx.strokeStyle = 'rgba(' + _gRGB + ',' + (0.9 * _gA).toFixed(3) + ')';
                    sdCtx.lineWidth = 2.5;
                    sdCtx.strokeRect(1.25, rect.top + 1.25, lw - 2.5, rect.height - 2.5);
                } else param._glowUntil = 0;
            }

            // Horizontal lane divider below
            sdCtx.strokeStyle = 'rgba(255,255,255,0.06)';
            sdCtx.lineWidth = 1;
            sdCtx.beginPath(); sdCtx.moveTo(0, rect.bottom); sdCtx.lineTo(lw, rect.bottom); sdCtx.stroke();

            // Center reference line (0.5) — subtle
            const midY = rect.top + rect.height / 2;
            sdCtx.strokeStyle = 'rgba(255,255,255,0.04)';
            sdCtx.beginPath(); sdCtx.moveTo(laneDrawLeft, midY); sdCtx.lineTo(lw, midY); sdCtx.stroke();

            // Param name (label column). Locked lanes get a small amber
            // lock glyph at the right edge of the label column AND the
            // name itself dims to amber-ish so the row reads as "frozen"
            // even at a quick scan.
            const isLocked = !!param.locked;
            const _labelCol = isLocked
                ? 'rgba(251,191,36,0.85)'   // amber-400
                : (isHighlighted ? 'rgba(' + sdSkinColors.labelRGB + ',0.95)' : 'rgba(228,228,231,0.75)');
            sdCtx.textAlign = 'left';
            sdCtx.textBaseline = 'middle';
            // ── 1.1.11 header (mockup M3, approved): PARAM NAME first and big, device
            // demoted to a small meta line, a full-height COLOR BAR at the left edge
            // (always visible lane identity + the click target for the palette popup).
            // The big line sits at the TOP of the row and the meta/fields at the BOTTOM,
            // so neither collides with the range/focus/lock icons at mid-height on the
            // right — those keep their exact positions and hit zones.
            const _laneRGB = sdLaneColor(param, paramIdx);
            sdCtx.fillStyle = 'rgba(' + _laneRGB + ',' + (param.colorIdx >= 0 ? '0.95' : '0.55') + ')';
            sdCtx.fillRect(0, rect.top, 4, rect.height);
            _sdColorRects.push({ param: param, x: 0, y: rect.top, w: 10, h: rect.height });
            const _iconLeft = _isWrapUI ? laneDrawLeft - 74 : laneDrawLeft - 56;   // left edge of the icon zone (wrapper adds the groove-grid glyph)
            const _short = rect.height < 40;                    // collapsed layout for dense lane stacks
            // The DEVICE NAME IS ALWAYS VISIBLE (field correction 2026-07-26: v1 let the
            // range fields replace the meta line, which erased the device on every ranged
            // lane). Layout by row height:
            //   tall (≥52px): param big on top · meta line under it · range fields at the bottom
            //   mid/short:    param on top · meta under-or-inline · fields where they fit
            // The meta always truncates at the icon zone; the param line takes the full
            // column only when the row is tall enough that it clears the mid-height icons.
            {
                const _isWrap = !!param.device;
                const _tx = _isWrap ? 25 : 10;   // wrapper rows clear the color bar + unmap ×
                if (_isWrap) {
                    _drawUnmapIcon(sdCtx, 12, _short ? midY - 5 : rect.top + 10, 6, param.envelopeId === _sdHoverUnmapId ? 'rgba(248,113,113,0.95)' : 'rgba(161,161,170,0.5)');
                    _sdUnmapRects.push({ envelopeId: param.envelopeId, x: 7, y: _short ? midY - 12 : rect.top + 3, w: 15, h: 15 });
                }
                const _big = rect.height >= 52;
                const _mid = !_big && rect.height >= 34;
                // Meta = the DEVICE NAME, nothing else (pts count dropped 2026-07-26 —
                // noise; locked already reads via the amber name + lock glyph).
                const _meta = _isWrap ? param.device : '';

                // Param name line — sized down ~23% from the 1.1.11 M3 headers (17/18px read
                // too loud in the field, 2026-07-27); short rows floor at 10px so dense
                // stacks stay legible.
                sdCtx.fillStyle = _labelCol;
                const _pxBig = _isWrap ? (isHighlighted ? 14 : 13) : (isHighlighted ? 12 : 11);
                const _px = _big ? _pxBig : (_mid ? (isHighlighted ? 12 : 11) : (isHighlighted ? 11 : 10));
                sdCtx.font = 'bold ' + _px + 'px Outfit';
                const _pY = _big ? rect.top + 13 : (_mid ? rect.top + 11 : midY - 6);
                let _pMaxW = ((_big && rect.height >= 58) ? laneDrawLeft - 6 : _iconLeft - 4) - _tx;
                // Ranged mid/short rows have no free line for the meta — it rides INLINE
                // after the param name, so the device NEVER disappears.
                const _inlineMeta = param.rangeOn && !_big && _meta !== '';
                if (_inlineMeta) _pMaxW = Math.max(34, _pMaxW - 52);
                const _pTxt = _sdFitText(sdCtx, displayName, _pMaxW);
                sdCtx.fillText(_pTxt, _tx, _pY);
                if (_inlineMeta) {
                    const _pEnd = _tx + sdCtx.measureText(_pTxt).width + 6;
                    sdCtx.font = 'bold 10px Outfit';
                    sdCtx.fillStyle = isLocked ? 'rgba(251,191,36,0.7)' : 'rgba(161,161,170,0.9)';
                    sdCtx.fillText(_sdFitText(sdCtx, _meta, _iconLeft - 4 - _pEnd), _pEnd, _pY + 1);
                }

                // DEVICE line — under the param name, bold and readable (field request:
                // "a lil bit bigger or with bold").
                if (!_inlineMeta && _meta !== '') {
                    sdCtx.font = 'bold 11px Outfit';
                    sdCtx.fillStyle = isLocked ? 'rgba(251,191,36,0.7)' : 'rgba(161,161,170,0.9)';
                    const _mY = _big ? rect.top + 30 : (_mid ? rect.bottom - 9 : midY + 8);
                    sdCtx.fillText(_sdFitText(sdCtx, _meta, _iconLeft - 4 - _tx), _tx, _mY);
                }

                // Range fields — bottom of the row (tall), or the remaining slot (mid/short)
                if (param.rangeOn)
                    _sdDrawRangeFields(sdCtx, param, _tx, _big ? rect.bottom - 19 : (_mid ? rect.bottom - 17 : midY + 5), paramIdx);
            }

            // Lock glyph at the right edge of the label column. Always
            // shown so the user can click to LOCK as well as UNLOCK
            // directly from the canvas — not only from the sidebar.
            // Locked = filled amber; unlocked = subtle zinc outline.
            const lockColor = isLocked ? 'rgba(251,191,36,0.9)' : 'rgba(161,161,170,0.45)';
            _drawLockIcon(sdCtx, laneDrawLeft - 18, midY - 6, 12, lockColor, isLocked);

            // Focus icon just left of the lock — click to blow this lane up full-canvas.
            const focusColor = isActive ? 'rgba(' + sdLaneColor(param, paramIdx) + ',0.95)' : 'rgba(161,161,170,0.5)';
            _drawFocusIcon(sdCtx, laneDrawLeft - 36, midY - 6, 12, focusColor);

            // Range toggle just left of the focus icon — click to give this param its own min/max
            // band; drag the boundaries to set it. Lit in the lane colour when on.
            const rangeColor = param.rangeOn ? 'rgba(' + sdLaneColor(param, paramIdx) + ',0.95)' : 'rgba(161,161,170,0.5)';
            _drawRangeIcon(sdCtx, laneDrawLeft - 54, midY - 6, 12, rangeColor, param.rangeOn);

            // Lane-speed slot left of the range icon (wrapper): press and DRAG up/down to
            // step the rate ladder. At 1x = a small metronome ("riding the track tempo");
            // off 1x the VALUE IS the icon ("2X", "½X") in the lane colour — one glance,
            // no under-label to collide with the range fields.
            if (_isWrapUI) {
                const _spdVal = (typeof param.speed === 'number' && param.speed > 0) ? param.speed : 1;
                const _spdOn = Math.abs(_spdVal - 1) > 1e-6;
                if (_spdOn) {
                    sdCtx.save();
                    sdCtx.font = '900 9px Outfit';
                    sdCtx.textAlign = 'center';
                    sdCtx.textBaseline = 'middle';
                    sdCtx.fillStyle = 'rgba(' + sdLaneColor(param, paramIdx) + ',0.95)';
                    sdCtx.fillText(_sdSpeedLabel(_spdVal), laneDrawLeft - 66, midY);
                    sdCtx.restore();
                } else {
                    _drawSpeedIcon(sdCtx, laneDrawLeft - 72, midY - 6, 12, 'rgba(161,161,170,0.5)');
                }
            }

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
                sdCtx.strokeStyle = 'rgba(' + sdLaneColor(param, paramIdx) + ',0.5)';
                sdCtx.lineWidth = 1.5;
                sdCtx.beginPath(); sdCtx.moveTo(sx, rect.top); sdCtx.lineTo(sx, rect.bottom); sdCtx.stroke();
                sdCtx.beginPath(); sdCtx.moveTo(ex, rect.top); sdCtx.lineTo(ex, rect.bottom); sdCtx.stroke();
                sdCtx.restore();
            }

            // Per-param RANGE: shaded dead zone + boundary lines + a "min–max%" tag. Drawn for
            // ANY ranged lane (even empty ones) so the band is always visible; the curve itself
            // is confined into the band via the range-aware valueToY below.
            if (param.rangeOn) {
                const _ry = (v) => rect.bottom - v * rect.height;   // actual 0..1 param value -> screen Y
                const _yMax = _ry(param.rangeMax), _yMin = _ry(param.rangeMin);
                const _rgb = sdLaneColor(param, paramIdx);
                sdCtx.save();
                sdCtx.beginPath(); sdCtx.rect(laneDrawLeft, rect.top, laneDrawWidth, rect.height); sdCtx.clip();
                sdCtx.fillStyle = 'rgba(0,0,0,0.30)';   // dead zone (outside the band)
                if (_yMax > rect.top)    sdCtx.fillRect(laneDrawLeft, rect.top, laneDrawWidth, _yMax - rect.top);
                if (_yMin < rect.bottom) sdCtx.fillRect(laneDrawLeft, _yMin, laneDrawWidth, rect.bottom - _yMin);
                sdCtx.strokeStyle = 'rgba(' + _rgb + ',0.6)';   // boundary lines
                sdCtx.lineWidth = 1; sdCtx.setLineDash([3, 3]);
                sdCtx.beginPath(); sdCtx.moveTo(laneDrawLeft, _yMax); sdCtx.lineTo(laneDrawLeft + laneDrawWidth, _yMax); sdCtx.stroke();
                sdCtx.beginPath(); sdCtx.moveTo(laneDrawLeft, _yMin); sdCtx.lineTo(laneDrawLeft + laneDrawWidth, _yMin); sdCtx.stroke();
                sdCtx.setLineDash([]);
                // (The min–max% readout lives in the MIN/MAX fields under the param name — no on-lane tag.)
                sdCtx.restore();
            }

            // Per-lane LOOP boundary (wrapper): drag the grip at the lane's right end to make
            // this lane wrap early (e.g. 1 bar of a 4-bar canvas). Beyond the boundary the lane
            // is shaded out, faint ghost ticks mark every repeat, and the grip rides the line.
            if (_isWrapUI) {
                const _lbRaw = (typeof param.loopBeats === 'number') ? param.loopBeats : 0;
                const _lb = (_lbRaw > 0 && _lbRaw < totalBeats - 1e-6) ? _lbRaw : 0;
                const _lxAt = (b) => laneDrawLeft + ((b / totalBeats) * laneDrawWidth * sdViewZoomX) - sdViewPanX;
                const _rgbL = sdLaneColor(param, paramIdx);
                sdCtx.save();
                sdCtx.beginPath(); sdCtx.rect(laneDrawLeft, rect.top, laneDrawWidth, rect.height); sdCtx.clip();
                if (_lb) {
                    const _bx = _lxAt(_lb);
                    if (_bx < lw) { sdCtx.fillStyle = 'rgba(0,0,0,0.42)'; sdCtx.fillRect(_bx, rect.top, lw - _bx, rect.height); }
                    sdCtx.strokeStyle = 'rgba(' + _rgbL + ',0.22)';
                    sdCtx.lineWidth = 1;
                    sdCtx.setLineDash([2, 4]);
                    for (let _k = 2; _k * _lb < totalBeats - 1e-6; _k++) {
                        const _gxk = _lxAt(_k * _lb);
                        if (_gxk > laneDrawLeft && _gxk < lw) { sdCtx.beginPath(); sdCtx.moveTo(_gxk, rect.top); sdCtx.lineTo(_gxk, rect.bottom); sdCtx.stroke(); }
                    }
                    sdCtx.setLineDash([]);
                    sdCtx.strokeStyle = 'rgba(' + _rgbL + ',0.85)';
                    sdCtx.lineWidth = 2;
                    sdCtx.beginPath(); sdCtx.moveTo(_bx, rect.top); sdCtx.lineTo(_bx, rect.bottom); sdCtx.stroke();
                    _sdDrawLoopGrip(sdCtx, _bx, rect.top + rect.height / 2, _rgbL, 0.95);
                } else {
                    const _ex = _lxAt(totalBeats);
                    if (_ex > laneDrawLeft && _ex < lw + 8)
                        _sdDrawLoopGrip(sdCtx, Math.min(_ex, lw - 3), rect.top + rect.height / 2, _rgbL, 0.35);
                }
                sdCtx.restore();
            }

            // Draw this lane's curve. Locked lanes render at reduced
            // alpha so the row reads as "frozen" at a quick scan, while
            // still being clearly visible as context. Setting globalAlpha
            // here applies to every stroke/fill until restore() at the
            // end of this row's drawing block.
            if (!param.points.length) continue;
            sdCtx.save();
            if (isLocked) sdCtx.globalAlpha = 0.4;
            const sortedPts = param.points.slice().sort((a, b) => a.time - b.time);
            // Ranged lanes display their 0..1 shape scaled into [rangeMin,rangeMax] (confined to the band).
            const _rangeMap = (v) => param.rangeOn ? (param.rangeMin + v * (param.rangeMax - param.rangeMin)) : v;
            const valueToY = (v) => rect.bottom - _rangeMap(v) * rect.height;
            const timeToX = (t) => laneDrawLeft + ((t / totalBeats) * laneDrawWidth * sdViewZoomX) - sdViewPanX;
            _sdLaneGeom.push({ id: param.envelopeId,   // the landing animation matches lanes by id
                               cy: rect.top + rect.height / 2, rgb: sdLaneColor(param, paramIdx), poly: (param.points.length >= 2 ? _sdSampleLanePixels(sortedPts, timeToX, valueToY) : null),
                               // Looped lanes (wrapper): the comet must wrap where the ENGINE wraps —
                               // beat-precise mapping (tx0/txSpan) + the lane's loop fraction. 0 = ride
                               // the whole curve exactly as before (desktop + unlooped lanes unchanged).
                               tx0: timeToX(0), txSpan: timeToX(totalBeats) - timeToX(0),
                               tb: totalBeats,   // beats across the canvas — the free-mode comet divides raw beats by this
                               speed: (_isWrapUI && typeof param.speed === 'number' && param.speed > 0) ? param.speed : 1,
                               loopFrac: (_isWrapUI && typeof param.loopBeats === 'number' && param.loopBeats > 0 && param.loopBeats < totalBeats - 1e-6)
                                   ? param.loopBeats / totalBeats : 0 });
            if (_sdEngMode) _sdEngKick();   // engine playhead: fresh geometry (zoom/pan/edit) repaints the parked head (coalesced — one frame per redraw)

            // LANDING ANIMATION owns this lane's stroke for ~200ms (the FX overlay draws
            // it progressively — Yossi-picked mockup B, 2026-08-12). Geometry above still
            // built (the overlay needs it); only the static print is skipped, and the
            // final _sdLandEnd repaint restores it.
            if (_sdLandAnim && _sdLandAnim.ids.has(param.envelopeId)) {
                sdCtx.restore();   // balances the locked-alpha save
                continue;
            }

            sdCtx.save();
            sdCtx.beginPath();
            sdCtx.rect(laneDrawLeft, rect.top, laneDrawWidth, rect.height);
            sdCtx.clip();

            // Fill under curve (subtle)
            sdCtx.beginPath();
            sdCtx.fillStyle = isHighlighted ? 'rgba(' + sdLaneColor(param, paramIdx) + ',0.12)' : 'rgba(' + sdLaneColor(param, paramIdx) + ',0.06)';
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
            sdCtx.strokeStyle = isHighlighted ? (sdSkinColors.patch ? 'rgb(' + sdLaneColor(param, paramIdx) + ')' : sdSkinColors.hi) : 'rgba(' + sdLaneColor(param, paramIdx) + ',0.6)';
            sdCtx.lineWidth = isHighlighted ? 2 : 1.5;
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
                sdCtx.fillStyle = sdSkinColors.patch ? 'rgb(' + sdLaneColor(param, paramIdx) + ')' : sdSkinColors.curve;
                sortedPts.forEach(pt => {
                    const x = timeToX(pt.time);
                    const y = valueToY(pt.value);
                    if (x >= laneDrawLeft - 10 && x <= lw + 10) {
                        sdCtx.beginPath(); sdCtx.arc(x, y, 3, 0, Math.PI * 2); sdCtx.fill();
                    }
                });
            }
            // Grey out the NON-MODULATING region — painted OVER the curve. The pre-curve
            // shade alone sat UNDER the full-alpha curve, so the dead zone read as live
            // (field report 2026-08-04: "hard to diagnose where the modulation works").
            // The curve stays ghosted underneath; the boundary line + grip re-stroke on
            // top so the grabbable edge stays crisp.
            if (_isWrapUI) {
                const _lbRaw2 = (typeof param.loopBeats === 'number') ? param.loopBeats : 0;
                const _lb2 = (_lbRaw2 > 0 && _lbRaw2 < totalBeats - 1e-6) ? _lbRaw2 : 0;
                if (_lb2) {
                    const _bx2 = timeToX(_lb2);
                    if (_bx2 < lw) {
                        sdCtx.fillStyle = 'rgba(9,9,11,0.66)';
                        sdCtx.fillRect(_bx2, rect.top, lw - _bx2, rect.height);
                        const _rgb2 = sdLaneColor(param, paramIdx);
                        sdCtx.strokeStyle = 'rgba(' + _rgb2 + ',0.85)';
                        sdCtx.lineWidth = 2;
                        sdCtx.beginPath(); sdCtx.moveTo(_bx2, rect.top); sdCtx.lineTo(_bx2, rect.bottom); sdCtx.stroke();
                        _sdDrawLoopGrip(sdCtx, _bx2, rect.top + rect.height / 2, _rgb2, 0.95);
                    }
                }
            }
            sdCtx.restore();   // closes the clip-region save
            sdCtx.restore();   // closes the locked-alpha save
        }

        // Scroll indicator on the far right (thin track)
        if (sdCanvasParams.length > visible) {
            const trackW = 4;
            const trackX = lw - trackW - 2;
            sdCtx.fillStyle = 'rgba(255,255,255,0.05)';
            sdCtx.fillRect(trackX, 0, trackW, lh);
            const thumbH = Math.max(20, (visible / sdCanvasParams.length) * lh);
            const thumbY = (sdMultiScrollOffset / sdCanvasParams.length) * lh;
            sdCtx.fillStyle = 'rgba(' + sdSkinColors.rgb + ',0.55)';
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
            const value = _sdRangeInv(sdCanvasParams[activeIdx], Math.max(0, Math.min(1, 1 - ((pos.y - laneRect.top) / laneRect.height))));
            return { time, value };
        }

        // Focus mode (original behavior)
        const _fp = sdCanvasParams.find(p => p.envelopeId === sdActiveParamId);
        return { time: ((pos.x + sdViewPanX) / (rect.width * sdViewZoomX)) * totalBeats, value: _sdRangeInv(_fp, 1 - (pos.y / rect.height)) };
    }

    function setupSdCanvasInteractions() {
        if (!sdCanvasEl) return;
        window.addEventListener('keydown', e => {
            // Space would otherwise "click" the last-focused button (re-injecting
            // or re-running it) instead of reaching Ableton for play/stop. Swallow
            // it and drop focus, unless the user is typing in a field.
            if (e.code === 'Space') {
                const _ae = document.activeElement;
                const _typingSp = _ae && (_ae.tagName === 'INPUT' || _ae.tagName === 'TEXTAREA' || _ae.isContentEditable);
                if (!_typingSp) { e.preventDefault(); if (_ae && _ae.blur) _ae.blur(); return; }
            }
            if ((e.ctrlKey || e.metaKey) && e.code === 'KeyZ' && !e.shiftKey) { e.preventDefault(); sdUndo(); return; }
            if ((e.ctrlKey || e.metaKey) && e.code === 'KeyZ' && e.shiftKey) { e.preventDefault(); sdRedo(); return; }
            if ((e.ctrlKey || e.metaKey) && e.code === 'KeyY') { e.preventDefault(); sdRedo(); return; }
            // Copy / paste the active lane's curve. Skipped while typing in a
            // field so native text copy/paste still works.
            {
                const _ae = document.activeElement;
                const _typing = _ae && (_ae.tagName === 'INPUT' || _ae.tagName === 'TEXTAREA' || _ae.isContentEditable);
                if (!_typing && (e.ctrlKey || e.metaKey) && e.code === 'KeyC') { e.preventDefault(); if (window.sdCopyLane) sdCopyLane(); return; }
                if (!_typing && (e.ctrlKey || e.metaKey) && e.code === 'KeyV') { e.preventDefault(); if (window.sdPasteLane) sdPasteLane(false); return; }
                // Ctrl/Cmd+A = Select All lanes (same toggle as the toolbar button).
                // preventDefault keeps the WebView from text-selecting the page.
                if (!_typing && (e.ctrlKey || e.metaKey) && e.code === 'KeyA') { e.preventDefault(); if (window.sdSelectAll) sdSelectAll(); return; }
            }
            // Grid resolution (Ableton-style). Ctrl/Cmd + the physical number
            // row, so it works on any keyboard layout. Skipped while typing so
            // it never eats input. 1 = narrow (finer), 2 = widen (coarser),
            // 3 = triplet toggle, 5 = fixed/adaptive toggle.
            {
                const _ae2 = document.activeElement;
                const _typing2 = _ae2 && (_ae2.tagName === 'INPUT' || _ae2.tagName === 'TEXTAREA' || _ae2.isContentEditable);
                if (!_typing2 && (e.ctrlKey || e.metaKey) && !e.shiftKey && !e.altKey) {
                    if (e.code === 'Digit1') { e.preventDefault(); sdGridNarrow(); return; }
                    if (e.code === 'Digit2') { e.preventDefault(); sdGridWiden(); return; }
                    if (e.code === 'Digit3') { e.preventDefault(); window.sdToggleTripletLock(); return; }
                    if (e.code === 'Digit5') { e.preventDefault(); sdGridToggleAdaptive(); return; }
                }
            }
            if (e.code === 'Escape') { sdClearSelection(); return; }
            // Delete / Backspace: clear the curve on the selected (or active) lane(s).
            // Wipe a lane to redraw it, or empty a duplicated clip's carried-over
            // curve. Skipped while typing in a field. sdClearCurrentCanvas is
            // selection-aware, locked-safe, and persists (so a rescan can't refill it).
            {
                const _aeD = document.activeElement;
                const _typingD = _aeD && (_aeD.tagName === 'INPUT' || _aeD.tagName === 'TEXTAREA' || _aeD.isContentEditable);
                if (!_typingD && (e.code === 'Delete' || e.code === 'Backspace')) {
                    e.preventDefault();
                    if (window.sdClearCurrentCanvas) window.sdClearCurrentCanvas();
                    return;
                }
            }
            // Pan is middle-click + drag now (Ableton-style). Space is free.
        });
        sdCanvasEl.addEventListener('wheel', e => {
            e.preventDefault();
            _sdHideTooltip();
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
            _sdHideTooltip();
            // Middle-mouse-button (mousewheel press) + drag pans the canvas,
            // matching Ableton's convention. preventDefault suppresses the
            // browser's auto-scroll cursor on some platforms.
            if (e.button === 1) {
                e.preventDefault();
                sdIsPanning = true;
                sdLastMouseX = e.clientX;
                sdCanvasEl.style.cursor = 'grabbing';
                return;
            }

            // Multi view: the clicked Y position decides which lane the tool
            // targets. Clicking a non-active lane just activates it (no draw)
            // so users can safely browse without accidentally dropping points.
            // A second click on the already-active lane performs the draw.
            if (sdViewMode === 'multi') {
                const mrect = sdCanvasEl.getBoundingClientRect();
                const my = e.clientY - mrect.top;
                const mx = e.clientX - mrect.left;
                // RIGHT-CLICK in the label column → color popup (selection-aware: select
                // lanes, right-click one of them, paint the whole group). Checked before
                // every other label-column hit so right-click can't unmap/scrub anything.
                // Right-click in the CURVE area keeps its shipped meaning (delete point).
                if (e.button === 2 && mx < SD_MULTI_LABEL_WIDTH) {
                    const _rcHit = sdMultiGetParamAtY(my);
                    if (_rcHit) _sdOpenColorPopup(_rcHit.param, e.clientX, e.clientY);
                    return;
                }
                // Unmap-× click (wrapper lanes only) — remove this param from the panel + engine.
                for (let _ui = 0; _ui < _sdUnmapRects.length; _ui++) {
                    const _r = _sdUnmapRects[_ui];
                    if (mx >= _r.x && mx <= _r.x + _r.w && my >= _r.y && my <= _r.y + _r.h) {
                        if (typeof window.sdUnmapLane === 'function') window.sdUnmapLane(_r.envelopeId);
                        return;
                    }
                }
                // Range min/max numeric field — press+drag to scrub, double-click to type.
                for (let _fi = 0; _fi < _sdRangeFieldRects.length; _fi++) {
                    const _f = _sdRangeFieldRects[_fi];
                    if (mx >= _f.x && mx <= _f.x + _f.w && my >= _f.y && my <= _f.y + _f.h) {
                        const now = (window.performance && performance.now) ? performance.now() : Date.now();
                        if (_sdRangeFieldClick && _sdRangeFieldClick.id === _f.param.envelopeId
                            && _sdRangeFieldClick.edge === _f.edge && (now - _sdRangeFieldClick.t) < 400) {
                            _sdRangeFieldClick = null;
                            _sdOpenRangeFieldInput(_f);            // double-click → type an exact %
                        } else {
                            _sdRangeFieldClick = { id: _f.param.envelopeId, edge: _f.edge, t: now };
                            pushUndo();   // one range-undo checkpoint per field scrub
                            _sdRangeNumDrag = { param: _f.param, edge: _f.edge, startY: my, startVal: _f.param[_f.edge] || 0 };
                            sdCanvasEl.style.cursor = 'ns-resize';
                        }
                        return;
                    }
                }

                const hit = sdMultiGetParamAtY(my);
                if (!hit) return;

                // Color-bar left-click (the ≤10px strip at the lane's left edge) → palette
                // popup. The right-click path is handled at the top of the multi branch.
                if (mx <= 10) {
                    const _cr = sdCanvasEl.getBoundingClientRect();
                    _sdOpenColorPopup(hit.param, _cr.left + mx, _cr.top + my);
                    return;
                }

                // Lock-icon click — anywhere in the right ~22px of the
                // label column toggles the lane's lock state. Works from
                // any lane (active or not), so users don't have to first
                // activate a lane just to lock it.
                const lockHitLeft = SD_MULTI_LABEL_WIDTH - SD_MULTI_LOCK_HIT_W;
                const lockHitRight = SD_MULTI_LABEL_WIDTH;
                if (mx >= lockHitLeft && mx <= lockHitRight) {
                    if (typeof window.sdToggleLockLane === 'function') {
                        window.sdToggleLockLane(hit.param.envelopeId);
                    }
                    return;
                }

                // Focus-icon click — the ~20px zone just left of the lock blows
                // this lane up into full-canvas focus view.
                const focusHitRight = lockHitLeft;
                const focusHitLeft = focusHitRight - SD_MULTI_FOCUS_HIT_W;
                if (mx >= focusHitLeft && mx < focusHitRight) {
                    if (typeof window.sdFocusLane === 'function') window.sdFocusLane(hit.param.envelopeId);
                    return;
                }

                // Range-icon click — just left of the focus icon. Single click toggles the
                // per-param output range (default full 0..1; drag the boundaries to narrow it);
                // double click resets it to full.
                const rangeHitRight = focusHitLeft;
                const rangeHitLeft = rangeHitRight - SD_MULTI_FOCUS_HIT_W;
                if (mx >= rangeHitLeft && mx < rangeHitRight) {
                    const p = hit.param;
                    pushUndo();   // ranges are undoable (checkpoint BEFORE the toggle/reset mutates)
                    const now = (window.performance && performance.now) ? performance.now() : Date.now();
                    if (_sdRangeIconClick && _sdRangeIconClick.id === p.envelopeId && (now - _sdRangeIconClick.t) < 400) {
                        p.rangeOn = false; p.rangeMin = 0; p.rangeMax = 1;   // double-click = reset to full
                        _sdRangeIconClick = null;
                    } else {
                        p.rangeOn = !p.rangeOn;
                        if (p.rangeOn && !(p.rangeMax > p.rangeMin)) { p.rangeMin = 0; p.rangeMax = 1; }
                        _sdRangeIconClick = { id: p.envelopeId, t: now };
                    }
                    // The icon TOGGLE (and double-click reset) is STRICTLY single-lane —
                    // never a group edit. It used to ride the Range-for-Group path, so with
                    // Select All active (e.g. for a Depth pass), toggling one lane's range
                    // copied its band onto every selected lane and wiped their custom bands
                    // (field report 2026-08-12). Group semantics stay where they feel
                    // deliberate: boundary DRAGS and field edits on a selected lane.
                    _sdPushRangeToEngine(p);
                    sdDrawCanvasGrid();
                    Promise.resolve(saveCanvasState());
                    return;
                }

                // Wrapper-only lane chrome: the lane-speed glyph + the loop-boundary grip.
                if (window.strideLink && window.strideLink._wrapper) {
                    // Speed glyph — the ~20px zone left of the range icon arms a vertical
                    // rate-ladder drag (up = faster). No popup; release commits.
                    const speedHitRight = rangeHitLeft;
                    const speedHitLeft = speedHitRight - SD_MULTI_FOCUS_HIT_W;
                    if (mx >= speedHitLeft && mx < speedHitRight) {
                        const _sp0 = (typeof hit.param.speed === 'number' && hit.param.speed > 0) ? hit.param.speed : 1;
                        _sdSpeedDrag = { param: hit.param, startY: my, startIdx: _sdSpeedIdx(_sp0), lastIdx: _sdSpeedIdx(_sp0) };
                        sdCanvasEl.style.cursor = 'ns-resize';
                        const _stS = document.getElementById('sd-canvas-status');
                        if (_stS) _stS.textContent = 'Lane speed: ' + _sdSpeedLabel(_sp0) + ' — drag up or down';
                        return;
                    }
                    // Loop-boundary grip — ±6px around the lane's boundary line (or the lane's
                    // end when no loop is set yet). Vertical target, so it wins over the range
                    // lines near a crossing; checked before the range boundary drag on purpose.
                    const _lw2 = sdCanvasEl.getBoundingClientRect().width;
                    const _ldw = Math.max(1, _lw2 - SD_MULTI_LABEL_WIDTH);
                    const _tb = sdGetBars() * 4;
                    const _lbCur = (typeof hit.param.loopBeats === 'number' && hit.param.loopBeats > 0 && hit.param.loopBeats < _tb - 1e-6)
                        ? hit.param.loopBeats : _tb;
                    const _lxCur = SD_MULTI_LABEL_WIDTH + ((_lbCur / _tb) * _ldw * sdViewZoomX) - sdViewPanX;
                    if (mx > SD_MULTI_LABEL_WIDTH && Math.abs(mx - Math.min(_lxCur, _lw2 - 3)) <= 6) {
                        _sdLoopDrag = { param: hit.param };
                        sdCanvasEl.style.cursor = 'ew-resize';
                        return;
                    }
                }

                // Boundary drag — grabbing a range line (ceiling/floor) on a ranged lane inside
                // the draw area. Applies to every selected lane too, so you can set a group at once.
                if (hit.param.rangeOn && mx > SD_MULTI_LABEL_WIDTH) {
                    const rb = hit.rect.bottom, rh = hit.rect.height;
                    const yMin = rb - hit.param.rangeMin * rh, yMax = rb - hit.param.rangeMax * rh;
                    const edge = (Math.abs(my - yMax) <= 6) ? 'rangeMax' : (Math.abs(my - yMin) <= 6) ? 'rangeMin' : null;
                    if (edge) {
                        pushUndo();   // one range-undo checkpoint per boundary-drag gesture
                        // Capture the group at GRAB time (selection changes mid-drag don't retarget).
                        _sdRangeDrag = { param: hit.param, edge: edge, rect: hit.rect, group: _sdRangeGroupTargets(hit.param) };
                        sdCanvasEl.style.cursor = 'ns-resize';
                        return;
                    }
                }

                // Ctrl/Cmd + click on any lane → toggle that lane's
                // selection. Sets up drag-pending so Ctrl + drag multi-
                // selects every lane the cursor passes over. Ctrl is the
                // only modifier that enters selection-without-activating;
                // the Select All toolbar button is the other entry point.
                if (e.ctrlKey || e.metaKey) {
                    // No toggle here — the gesture decides on its own: reaching another lane
                    // = drag-sweep (start lane joins + STAYS selected); releasing on the
                    // start lane = click (toggle fires on mouseup, wobble-proof).
                    _sdDragSelectArm(e, hit.param.envelopeId);
                    return;
                }

                const wasActive = sdActiveParamId === hit.param.envelopeId;
                if (!wasActive) {
                    // Plain click = clean single-select: this lane becomes the
                    // ONLY selection (also clears any multi-lane selection so a
                    // fresh click never adds to a stuck set).
                    sdCanvasParams.forEach(p => { p.selected = false; });
                    sdActiveParamId = hit.param.envelopeId;
                    sdResetSliderSnapshots();
                    sdRenderSidebar();
                    sdDrawCanvasGrid();
                    return;
                }
                // Click the active lane's label again → DESELECT everything, so
                // the UI goes fully unselected and the next lane you click is the
                // only one selected. (Clicks on the lane body still edit points.)
                if (mx < SD_MULTI_LABEL_WIDTH) {
                    sdCanvasParams.forEach(p => { p.selected = false; });
                    sdActiveParamId = null;
                    sdResetSliderSnapshots();
                    sdRenderSidebar();
                    sdDrawCanvasGrid();
                    return;
                }
            }

            // Focus-view "← All lanes" pill — click returns to the multi-lane view.
            if (sdViewMode === 'focus' && _sdFocusBackRect) {
                const _br = sdCanvasEl.getBoundingClientRect();
                const _fx = e.clientX - _br.left, _fy = e.clientY - _br.top;
                if (_fx >= _sdFocusBackRect.x && _fx <= _sdFocusBackRect.x + _sdFocusBackRect.w &&
                    _fy >= _sdFocusBackRect.y && _fy <= _sdFocusBackRect.y + _sdFocusBackRect.h) {
                    if (typeof window.sdToggleViewMode === 'function') window.sdToggleViewMode();
                    return;
                }
            }

            if (!sdActiveParamId) return;
            const hd = sdGetTimeValue(e); const param = sdCanvasParams.find(p => p.envelopeId === sdActiveParamId);
            // Locked lanes block ALL mouse interactions: no add/move/delete
            // points, no curve drag, no freehand. The toast hint reminds the
            // user how to unlock without being a modal nag.
            if (param && param.locked) {
                const status = document.getElementById('sd-canvas-status');
                if (status) {
                    status.textContent = 'Lane locked — click the lock icon in the sidebar to unlock';
                    setTimeout(() => {
                        if (status.textContent.startsWith('Lane locked')) status.textContent = '';
                    }, 2500);
                }
                return;
            }
            const bars = sdGetBars(); const totalBeats = bars * 4;
            const hitT = (totalBeats * 0.02) / sdViewZoomX; const hitV = 0.05;
            let idx = param.points.findIndex(pt => Math.abs(pt.time - hd.time) < hitT && Math.abs(pt.value - hd.value) < hitV);
            if (e.button === 2) { if (idx !== -1) { pushUndo(); param.points.splice(idx, 1); sdRenderSidebar(); sdDrawCanvasGrid(); if (_sdActiveTool === 'prism' && param.envelopeId === sdActiveParamId) _sdPrismLiveTick(); } return; }
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
                    const np = { time: sdSnapDrawBeat(hd.time), value: Math.max(0, Math.min(1, hd.value)) };
                    // Sort IMMEDIATELY — the array must stay time-ordered. The renderer draws
                    // from sorted COPIES so an appended point LOOKS right, but every consumer of
                    // the raw array (live drive, inject, saved state) walks it in order, and the
                    // engine's interpolator treats the last element as "the end": one mid-time
                    // point appended here froze the parameter from that time onward (field
                    // report 2026-08-03). The drag keeps its reference — sort moves the object,
                    // not its identity.
                    param.points.push(np); param.points.sort((a, b) => a.time - b.time);
                    sdIsDragging = true; sdDraggedPoint = np; sdRenderSidebar(); sdDrawCanvasGrid();
                }
            }
        });
        sdCanvasEl.addEventListener('mousemove', e => {
            _sdMaybeShowLaneTooltip(e);
            if (_sdRangeNumDrag) {   // scrubbing a numeric min/max field — ~1% per 2px
                const mr = sdCanvasEl.getBoundingClientRect();
                const my = e.clientY - mr.top;
                const nd = _sdRangeNumDrag;
                _sdRangeSetPercent(nd.param, nd.edge, (nd.startVal + (nd.startY - my) / 200) * 100);
                sdCanvasEl.style.cursor = 'ns-resize';
                sdDrawCanvasGrid();
                return;
            }
            if (_sdSpeedDrag) {   // dragging the lane-speed ladder — ~24px per step, live apply so you HEAR it
                const mrS = sdCanvasEl.getBoundingClientRect();
                const myS = e.clientY - mrS.top;
                const d = _sdSpeedDrag;
                const idx = Math.max(0, Math.min(SD_SPEED_LADDER.length - 1,
                    d.startIdx + Math.round((d.startY - myS) / 24)));   // up = faster
                if (idx !== d.lastIdx) {
                    d.lastIdx = idx;
                    d.param.speed = SD_SPEED_LADDER[idx];
                    _sdPushSpeedToEngine(d.param);   // engine-owned — live, so the rate change is audible mid-drag
                    const stS = document.getElementById('sd-canvas-status');
                    if (stS) stS.textContent = 'Lane speed: ' + _sdSpeedLabel(d.param.speed)
                        + (d.param.speed === 1 ? ' — riding the track tempo' : (d.param.speed > 1 ? ' — faster than the track' : ' — slower than the track'));
                    sdDrawCanvasGrid();
                }
                sdCanvasEl.style.cursor = 'ns-resize';
                return;
            }
            if (_sdLoopDrag) {   // dragging a lane's loop boundary — snaps to the visible grid, live redraw
                const mr = sdCanvasEl.getBoundingClientRect();
                const mx = e.clientX - mr.left;
                const tb = sdGetBars() * 4;
                const ldw = Math.max(1, mr.width - SD_MULTI_LABEL_WIDTH);
                let b = ((mx - SD_MULTI_LABEL_WIDTH + sdViewPanX) / (ldw * sdViewZoomX)) * tb;
                const st = sdVisualGridBeats();
                b = Math.round(b / st) * st;
                b = Math.max(st, Math.min(tb, b));
                _sdLoopDrag.param.loopBeats = (b >= tb - 1e-6) ? 0 : b;
                sdCanvasEl.style.cursor = 'ew-resize';
                const stEl = document.getElementById('sd-canvas-status');
                if (stEl) {
                    if (!(_sdLoopDrag.param.loopBeats > 0)) stEl.textContent = 'Loop: full length';
                    else if (b >= 4 && Math.abs(b / 4 - Math.round(b / 4)) < 1e-6) stEl.textContent = 'Loop: ' + (b / 4) + ' bar' + (b / 4 === 1 ? '' : 's');
                    else stEl.textContent = 'Loop: ' + (Math.round(b * 100) / 100) + ' beats';
                }
                sdDrawCanvasGrid();
                return;
            }
            if (_sdRangeDrag) {   // dragging a per-param range boundary — the lane's "min–max%" tag updates live
                const mr = sdCanvasEl.getBoundingClientRect();
                const my = e.clientY - mr.top;
                const rd = _sdRangeDrag, v = Math.max(0, Math.min(1, (rd.rect.bottom - my) / rd.rect.height));
                if (rd.edge === 'rangeMax') rd.param.rangeMax = Math.max(v, rd.param.rangeMin + 0.02);
                else                        rd.param.rangeMin = Math.min(v, rd.param.rangeMax - 0.02);
                if (rd.group && rd.group.length > 1)   // group drag: every selected band follows live
                    for (const t of rd.group) {
                        if (t === rd.param) continue;
                        t.rangeOn = rd.param.rangeOn; t.rangeMin = rd.param.rangeMin; t.rangeMax = rd.param.rangeMax;
                    }
                sdDrawCanvasGrid();
                return;
            }
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
            } else if (!sdIsDragging && !sdIsPanning) {
                // Range affordance: hovering a min/max field OR a dashed boundary line on a
                // ranged lane shows the two-arrow (ns-resize) cursor so it reads as grabbable.
                let _rangeCur = false;
                if (sdViewMode === 'multi') {
                    const _mr = sdCanvasEl.getBoundingClientRect();
                    const _mx = e.clientX - _mr.left, _my = e.clientY - _mr.top;
                    for (let _fi = 0; _fi < _sdRangeFieldRects.length; _fi++) {
                        const _f = _sdRangeFieldRects[_fi];
                        if (_mx >= _f.x && _mx <= _f.x + _f.w && _my >= _f.y && _my <= _f.y + _f.h) { _rangeCur = true; break; }
                    }
                    if (!_rangeCur && _mx > SD_MULTI_LABEL_WIDTH) {
                        const _h = sdMultiGetParamAtY(_my);
                        if (_h && _h.param.rangeOn) {
                            const _yMin = _h.rect.bottom - (_h.param.rangeMin || 0) * _h.rect.height;
                            const _yMax = _h.rect.bottom - (_h.param.rangeMax || 0) * _h.rect.height;
                            if (Math.abs(_my - _yMax) <= 6 || Math.abs(_my - _yMin) <= 6) _rangeCur = true;
                        }
                    }
                }
                sdCanvasEl.style.cursor = _rangeCur ? 'ns-resize' : (_sdHoverUnmapId ? 'pointer' : 'crosshair');
            }
            if (!sdIsDragging) return;
            const hd = sdGetTimeValue(e); const bars = sdGetBars(); const totalBeats = bars * 4;
            if (sdActiveTool === 'freehand') { const param = sdCanvasParams.find(p => p.envelopeId === sdActiveParamId); sdPaintFreehand(hd.time, hd.value, param, totalBeats); }
            else if (sdDraggedPoint) {
                sdDraggedPoint.time = Math.max(0, Math.min(totalBeats, sdSnapDrawBeat(hd.time)));
                sdDraggedPoint.value = Math.max(0, Math.min(1, hd.value)); sdDrawCanvasGrid();
            }
            // Prism live-draw: rAF-throttled recompute while user is
            // editing the source lane. The tick restores variants from
            // snapshot first so successive ticks don't compound drift.
            if (_sdActiveTool === 'prism' && sdIsDragging && !_sdPrismRecomputeQueued) {
                _sdPrismRecomputeQueued = true;
                requestAnimationFrame(() => {
                    _sdPrismRecomputeQueued = false;
                    if (_sdActiveTool === 'prism' && sdIsDragging) _sdPrismLiveTick();
                });
            }
        });
        // ─── Drag-select (multi-view + Select Mode) ─────────────
        // Global mousemove so the gesture keeps tracking even when the
        // pointer briefly leaves the canvas. Cheap early-return when no
        // drag is in flight.
        window.addEventListener('mousemove', e => {
            if (!_sdDragSelectPending && !_sdDragSelectActive) return;
            _sdLastMouseClientY = e.clientY;

            // Promote pending → active only when the cursor REACHES A DIFFERENT LANE —
            // the unambiguous "this is a sweep" signal. In-lane wobble (any distance)
            // never promotes, so the mouseup click-toggle stays reliable for deselect.
            // On promotion the START lane joins the sweep: selected and STAYING selected
            // (drag is additive — the old mousedown-toggle used to kick a selected start
            // lane OUT of the group; field report 2026-07-16).
            if (_sdDragSelectPending && !_sdDragSelectActive && sdCanvasEl) {
                const _pr = sdCanvasEl.getBoundingClientRect();
                const _py = e.clientY - _pr.top;
                const _phit = (_py >= 0 && _py <= _pr.height) ? sdMultiGetParamAtY(_py) : null;
                if (_phit && _phit.param.envelopeId !== _sdDragSelectPending.laneId) {
                    _sdDragSelectActive = true;
                    const _start = sdCanvasParams.find(p => p.envelopeId === _sdDragSelectPending.laneId);
                    if (_start && !_start.locked && !_start.selected) {
                        _start.selected = true;
                        if (typeof _sdUpdateSelectionButtons === 'function') _sdUpdateSelectionButtons();
                        sdRenderSidebar();
                        sdDrawCanvasGrid();
                    }
                    _sdEdgeScrollSchedule();
                }
            }

            if (_sdDragSelectActive) {
                _sdDragSelectAddAtClientY(e.clientY);
                _sdEdgeScrollSchedule();
            }
        });

        // Arm a fresh drag-select gesture from a Ctrl+mousedown. NO toggle happens
        // here — the mousemove handler promotes to a sweep when the cursor reaches a
        // different lane, and the mouseup handler fires the click-toggle when it never
        // did. The starting lane is pre-visited so the sweep can't re-add it when the
        // pass crosses back over it.
        function _sdDragSelectArm(e, laneId) {
            _sdDragSelectPending = { laneId };
            _sdDragSelectActive = false;
            _sdDragSelectVisited = new Set([laneId]);
        }

        // Add the lane under the given clientY to the selection. No-op if
        // already visited this drag, locked, or vertically outside canvas.
        function _sdDragSelectAddAtClientY(clientY) {
            if (!sdCanvasEl) return;
            const rect = sdCanvasEl.getBoundingClientRect();
            const localY = clientY - rect.top;
            if (localY < 0 || localY > rect.height) return;
            const hit = sdMultiGetParamAtY(localY);
            if (!hit) return;
            const id = hit.param.envelopeId;
            if (_sdDragSelectVisited.has(id)) return;
            _sdDragSelectVisited.add(id);
            if (hit.param.locked) return;
            if (!hit.param.selected) {
                hit.param.selected = true;
                if (typeof _sdUpdateSelectionButtons === 'function') _sdUpdateSelectionButtons();
                sdRenderSidebar();
                sdDrawCanvasGrid();
            }
        }

        function _sdEdgeScrollSchedule() {
            if (_sdEdgeScrollRaf) return;
            _sdEdgeScrollLastTickAt = 0;
            _sdEdgeScrollRaf = requestAnimationFrame(_sdEdgeScrollTick);
        }

        // rAF-driven auto-scroll while the cursor sits in the top or bottom
        // edge zone during an active drag. Cadence is three-tier by edge
        // proximity (closer = faster). Stops when the cursor leaves the
        // zone; the next mousemove can re-arm it. Stops when drag ends.
        function _sdEdgeScrollTick(timestamp) {
            _sdEdgeScrollRaf = 0;
            if (!_sdDragSelectActive || !sdCanvasEl) return;
            if (sdViewMode !== 'multi') return;

            const rect = sdCanvasEl.getBoundingClientRect();
            const y = _sdLastMouseClientY;
            const distTop = y - rect.top;
            const distBot = rect.bottom - y;

            let dir = 0;
            let cadenceMs = 80;
            if (distTop >= 0 && distTop < SD_EDGE_SCROLL_ZONE_PX) {
                dir = -1;
                cadenceMs = distTop < 10 ? 30 : (distTop < 20 ? 50 : 80);
            } else if (distBot >= 0 && distBot < SD_EDGE_SCROLL_ZONE_PX) {
                dir = 1;
                cadenceMs = distBot < 10 ? 30 : (distBot < 20 ? 50 : 80);
            }
            if (dir === 0) return;

            if (!_sdEdgeScrollLastTickAt) _sdEdgeScrollLastTickAt = timestamp;
            if (timestamp - _sdEdgeScrollLastTickAt >= cadenceMs) {
                const before = sdMultiScrollOffset;
                sdMultiScrollOffset += dir;
                sdMultiClampScroll();
                if (sdMultiScrollOffset !== before) {
                    sdDrawCanvasGrid();
                    // A new lane is now under the cursor — pick it up now,
                    // don't wait for the next mousemove (user may be holding
                    // still in the edge zone).
                    _sdDragSelectAddAtClientY(_sdLastMouseClientY);
                }
                _sdEdgeScrollLastTickAt = timestamp;
            }
            _sdEdgeScrollRaf = requestAnimationFrame(_sdEdgeScrollTick);
        }

        // ─── Lane-name hover tooltip (multi-view label column) ──
        // Custom div tooltip — instant, no browser title delay. Triggers
        // only when the cursor is inside a lane's label column so it
        // doesn't pollute the curve area. Hidden during pan/drag/scroll
        // so the user isn't distracted by it during gestures.
        let _sdTooltipEl = null;
        let _sdTooltipNameNode = null;
        let _sdTooltipRangeNode = null;

        function _sdTooltipInit() {
            if (_sdTooltipEl) return;
            _sdTooltipEl = document.getElementById('sd-canvas-tooltip');
            if (!_sdTooltipEl) return;
            _sdTooltipNameNode = document.createElement('div');
            _sdTooltipRangeNode = document.createElement('div');
            _sdTooltipRangeNode.className = 'text-zinc-500 font-normal mt-0.5 text-[9px]';
            _sdTooltipEl.appendChild(_sdTooltipNameNode);
            _sdTooltipEl.appendChild(_sdTooltipRangeNode);
        }

        function _sdHideTooltip() {
            if (!_sdTooltipEl) _sdTooltipInit();
            if (_sdTooltipEl) _sdTooltipEl.classList.add('hidden');
        }

        function _sdFormatRangeVal(v) {
            if (!isFinite(v)) return '?';
            if (Math.abs(v) >= 10000) return (v / 1000).toFixed(1) + 'k';
            if (Number.isInteger(v) || Math.abs(v) >= 100) return String(Math.round(v));
            if (Math.abs(v) >= 10) return v.toFixed(1);
            return parseFloat(v.toFixed(3)).toString();
        }

        function _sdSetUnmapHover(id) {
            if (_sdHoverUnmapId === id) return;
            _sdHoverUnmapId = id;
            try { sdDrawCanvasGrid(); } catch (e) {}   // recolor the × (grey <-> red)
        }
        function _sdMaybeShowLaneTooltip(e) {
            _sdTooltipInit();
            // Unmap-× hover (wrapper lanes): recolor the × under the cursor grey->red.
            // Computed up front so it works even when the tooltip is suppressed below.
            if (sdCanvasEl && sdViewMode === 'multi' && !(sdIsPanning || sdIsDragging || sdIsCurveDragging || _sdDragSelectActive)) {
                const _ur = sdCanvasEl.getBoundingClientRect();
                const _umx = e.clientX - _ur.left, _umy = e.clientY - _ur.top;
                let _over = null;
                for (let _i = 0; _i < _sdUnmapRects.length; _i++) {
                    const _u = _sdUnmapRects[_i];
                    if (_umx >= _u.x && _umx <= _u.x + _u.w && _umy >= _u.y && _umy <= _u.y + _u.h) { _over = _u.envelopeId; break; }
                }
                _sdSetUnmapHover(_over);
            } else {
                _sdSetUnmapHover(null);
            }
            if (!_sdTooltipEl || !sdCanvasEl) return;
            // Suppress during any active gesture — tooltip would just
            // hover distractingly.
            if (sdIsPanning || sdIsDragging || sdIsCurveDragging || _sdDragSelectActive) {
                _sdHideTooltip();
                return;
            }
            if (sdViewMode !== 'multi') { _sdHideTooltip(); return; }

            const rect = sdCanvasEl.getBoundingClientRect();
            const localX = e.clientX - rect.left;
            const localY = e.clientY - rect.top;
            if (localX < 0 || localX >= SD_MULTI_LABEL_WIDTH) { _sdHideTooltip(); return; }
            if (localY < 0 || localY >= rect.height) { _sdHideTooltip(); return; }

            const hit = sdMultiGetParamAtY(localY);
            if (!hit) { _sdHideTooltip(); return; }

            // Same display-name logic as the canvas renderer: suffix
            // (1)/(2)/... for duplicate names so the tooltip matches what
            // the user expects to see.
            const param = hit.param;
            const sameNamed = sdCanvasParams.filter(p => p.name === param.name);
            let displayName = param.name;
            if (sameNamed.length > 1) {
                const idx = sameNamed.indexOf(param) + 1;
                displayName = `${param.name} (${idx})`;
            }
            const range = `${_sdFormatRangeVal(param.min)} – ${_sdFormatRangeVal(param.max)}${param.is_log ? ' · log' : ''}${param.locked ? ' · locked' : ''}`;

            _sdTooltipNameNode.textContent = displayName;
            _sdTooltipRangeNode.textContent = range;

            // Position relative to the canvas container (the positioned
            // ancestor of the tooltip div). Offset from cursor; clamp to
            // the container right edge so long names don't spill out.
            const container = sdCanvasEl.parentElement;
            if (!container) return;
            const cRect = container.getBoundingClientRect();
            _sdTooltipEl.classList.remove('hidden');
            const tw = _sdTooltipEl.offsetWidth;
            const x = e.clientX - cRect.left + 14;
            const y = e.clientY - cRect.top + 14;
            const maxX = cRect.width - tw - 4;
            _sdTooltipEl.style.left = Math.max(2, Math.min(x, maxX)) + 'px';
            _sdTooltipEl.style.top = y + 'px';
        }

        // Window blur cancels any in-flight drag-select. Catches alt-tab,
        // app-switch, and similar — otherwise the gesture would resume
        // mid-flight when the user returns, which is jarring.
        window.addEventListener('blur', () => {
            if (_sdDragSelectPending || _sdDragSelectActive) {
                _sdDragSelectPending = null;
                _sdDragSelectActive = false;
                _sdDragSelectVisited = new Set();
                if (_sdEdgeScrollRaf) {
                    cancelAnimationFrame(_sdEdgeScrollRaf);
                    _sdEdgeScrollRaf = 0;
                }
            }
        });

        window.addEventListener('mouseup', e => {
            if (_sdRangeNumDrag) {   // finished scrubbing a numeric min/max field — persist + re-drive
                _sdRangeNumDrag = null;
                if (sdCanvasEl) sdCanvasEl.style.cursor = 'crosshair';
                try { Promise.resolve(saveCanvasState()); } catch (err) {}
                sdDrawCanvasGrid();
                return;
            }
            if (_sdSpeedDrag) {   // finished the speed-ladder drag — engine already heard every step; persist
                const _spP = _sdSpeedDrag.param;
                _sdSpeedDrag = null;
                if (sdCanvasEl) sdCanvasEl.style.cursor = 'crosshair';
                _sdPushSpeedToEngine(_spP);   // idempotent re-send: the committed value is the engine value
                try { Promise.resolve(saveCanvasState()); } catch (err) {}
                sdDrawCanvasGrid();
                return;
            }
            if (_sdLoopDrag) {   // finished dragging a loop boundary — the engine owns it from here
                const _lp = _sdLoopDrag.param;
                _sdLoopDrag = null;
                if (sdCanvasEl) sdCanvasEl.style.cursor = 'crosshair';
                _sdPushLoopToEngine(_lp);
                try { Promise.resolve(saveCanvasState()); } catch (err) {}
                sdDrawCanvasGrid();
                return;
            }
            if (_sdRangeDrag) {   // finished dragging a range boundary — persist + re-drive with the new band
                const _rdGroup = _sdRangeDrag.group || [_sdRangeDrag.param];
                _sdRangeDrag = null;
                if (sdCanvasEl) sdCanvasEl.style.cursor = 'crosshair';
                _sdPushRangesToEngine(_rdGroup);   // engine owns ranges (committed drag; batched when it's a group)
                try { Promise.resolve(saveCanvasState()); } catch (err) {}
                sdDrawCanvasGrid();
                return;
            }
            // Only the middle button ends a pan — guards against a stray
            // left/right mouseup interrupting a mid-pan drag.
            if (sdIsPanning && e.button === 1) {
                sdIsPanning = false;
                if (sdCanvasEl) sdCanvasEl.style.cursor = 'crosshair';
            }
            if (sdIsCurveDragging) {
                pushUndo();
                sdIsCurveDragging = false;
                sdCurveDragSegment = null;
                if (sdCanvasEl) sdCanvasEl.style.cursor = 'crosshair';
                sdDrawCanvasGrid();
                if (_sdActiveTool === 'prism') _sdPrismLiveTick();
                try { Promise.resolve(saveCanvasState()); } catch (e) {}   // flush the edit live so the modulation fires on release — no focus switch needed
            }
            if (sdIsDragging) {
                pushUndo();
                // Re-sort the edited lane BEFORE the flush below: dragging a point's time past
                // a neighbour (or a freehand stroke that doubled back) leaves the raw array
                // out of order, and the engine's interpolator freezes past the first
                // out-of-place time (field report 2026-08-03). Cheap: one lane, on release.
                const _mp = sdCanvasParams.find(p => p.envelopeId === sdActiveParamId);
                if (_mp && _mp.points && _mp.points.length > 1) _mp.points.sort((a, b) => a.time - b.time);
                sdIsDragging = false;
                sdDraggedPoint = null;
                sdRenderSidebar();
                sdDrawCanvasGrid();
                // Final Prism pass on release — guarantees variants
                // match the final source curve, not the last rAF tick
                // (which may have skipped the very last mousemove).
                if (_sdActiveTool === 'prism') _sdPrismLiveTick();
                try { Promise.resolve(saveCanvasState()); } catch (e) {}   // flush the edit live so the modulation fires on release — no focus switch needed
            }
            // Drag-select release. Never promoted = a CLICK: the toggle fires HERE
            // (deferred from mousedown, so a sweep that starts on a selected lane can't
            // kick it out of the group — and in-lane wobble still deselects reliably).
            if (_sdDragSelectPending || _sdDragSelectActive) {
                if (_sdDragSelectPending && !_sdDragSelectActive
                     && typeof window.sdToggleLaneSelection === 'function')
                    window.sdToggleLaneSelection(_sdDragSelectPending.laneId);
                _sdFcSyncSliders();   // selection settled (click-toggle or sweep) → floor/ceiling dial rebases (F5)
                _sdDragSelectPending = null;
                _sdDragSelectActive = false;
                _sdDragSelectVisited = new Set();
                if (_sdEdgeScrollRaf) {
                    cancelAnimationFrame(_sdEdgeScrollRaf);
                    _sdEdgeScrollRaf = 0;
                }
            }
        });
        sdCanvasEl.addEventListener('contextmenu', e => e.preventDefault());
        // Hide lane tooltip when the cursor leaves the canvas entirely —
        // mousemove on sdCanvasEl stops firing once out of bounds.
        sdCanvasEl.addEventListener('mouseleave', () => _sdHideTooltip());
    }

    function sdPaintFreehand(time, value, param, totalBeats) {
        let st = Math.max(0, Math.min(totalBeats, sdSnapFreehandBeat(time)));
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
        else if (shape === 'rhythmic_gate_build') { let step = sdMotionStep([0.125, 0.25, 0.5][Math.floor(Math.random() * 3)]), steps = Math.floor(chunk / step), sv = 0.7 + Math.random() * 0.3, ev = Math.random() * 0.3, up = Math.random() > 0.5; for (let i = 0; i < steps; i++) { let t = cB + i * step, pr = i / Math.max(1, steps - 1), cp = up ? ev + (sv - ev) * pr : sv + (ev - sv) * pr; addPt(t, 0); addPt(t + 0.001, cp); addPt(t + step * 0.85, 0); } addPt(cB + chunk, 0); }
        else if (shape === 'syncopated_drops') { let step = sdMotionStep(0.25), steps = Math.floor(chunk / step); for (let i = 0; i < steps; i++) { if (Math.random() > 0.3) { let t = cB + i * step, pk = 0.3 + Math.random() * 0.7; addPt(t, 0); addPt(t + 0.001, pk); addPt(t + step * 0.8, pk * 0.8); addPt(t + step * 0.81, 0); } } addPt(cB + chunk, 0); }
    }

    // ─── TOOLS ─────────────────────────────────────────────

    window.sdSetTool = function(tool) {
        sdActiveTool = tool;
        const bS = document.getElementById('sd-tool-select');
        const bF = document.getElementById('sd-tool-freehand');
        if (tool === 'select') { bS.className = "tool-btn bg-fuchsia-500/20 text-fuchsia-400 px-3 py-1 rounded text-[9px] uppercase tracking-wider font-bold transition-colors"; bF.className = "tool-btn text-zinc-400 hover:text-fuchsia-400 px-3 py-1 rounded text-[9px] uppercase tracking-wider font-bold transition-colors"; }
        else { bF.className = "tool-btn bg-fuchsia-500/20 text-fuchsia-400 px-3 py-1 rounded text-[9px] uppercase tracking-wider font-bold transition-colors"; bS.className = "tool-btn text-zinc-400 hover:text-fuchsia-400 px-3 py-1 rounded text-[9px] uppercase tracking-wider font-bold transition-colors"; }
        // Compact-mode Point/Free mirror the active tool too (own ids; toggle via
        // classList so their smaller sizing is preserved). Without this, clicking
        // Free in compact switched the tool but the button never lit up ("nothing happens").
        const qP = document.getElementById('qpc-tool-point');
        const qF = document.getElementById('qpc-tool-free');
        if (qP && qF) {
            const on = (tool === 'select') ? qP : qF, off = (tool === 'select') ? qF : qP;
            on.classList.add('bg-fuchsia-500/20', 'text-fuchsia-400'); on.classList.remove('text-zinc-400');
            off.classList.remove('bg-fuchsia-500/20', 'text-fuchsia-400'); off.classList.add('text-zinc-400');
        }
    };

    // Neuro: random-pool shape injection across every unlocked lane.
    // Picks random chunks (0.5-4 beats) and fills them with random shapes
    // from an 8-entry pool — gives wildly varied, gnarly modulation that
    // feels chaotic but musical. Originally named sdApplyGlobalChaos;
    // renamed to Neuro when a second, simpler "Chaos = chaos_lfo on all
    // lanes" button was added to the GENERATIVE section (4-button layout).
    window.sdApplyGlobalNeuro = function() {
        const targets = sdGetUnlockedParams();
        if (!targets.length) {
            const status = document.getElementById('sd-canvas-status');
            if (status) status.textContent = sdCanvasParams.length
                ? 'All lanes locked — unlock to generate'
                : 'No lanes loaded';
            return;
        }
        pushUndo();
        const bars = sdGetBars(); const totalBeats = bars * 4;
        const sel = sdGetSelection(); const sB = sel ? sel.startBeat : 0; const eB = sel ? sel.endBeat : totalBeats;
        const pool = ['dotted_ramp', 'mid_value_hold', 'offgrid_saw', 'hard_chop', 'exponential_build', 'hyper_stutter', 'rhythmic_gate_build', 'syncopated_drops'];
        targets.forEach(param => {
            if (sel) param.points = param.points.filter(pt => pt.time < sB || pt.time > eB); else param.points = [];
            let cB = sB;
            while (cB < eB - 0.001) { let chunk = [0.5, 1, 1.5, 2, 4][Math.floor(Math.random() * 5)]; if (cB + chunk > eB) chunk = eB - cB; sdInjectShape(param, pool[Math.floor(Math.random() * pool.length)], cB, chunk); cB = Math.round((cB + chunk) * 10000) / 10000; }
        });
        sdResetSliderSnapshots(); sdRenderSidebar(); sdDrawCanvasGrid();
        _sdLandKick(targets);   // landing animation (mockup B): the comet draws the new curves on
        const skipMsg = sdLockSkipMessage(targets.length);
        if (skipMsg) {
            const status = document.getElementById('sd-canvas-status');
            if (status) {
                status.textContent = skipMsg;
                setTimeout(() => { if (status.textContent === skipMsg) status.textContent = ''; }, 3000);
            }
        }
    };

    // Chaos: applies the SHAPES "Chaos" template (chaos_lfo — multi-layer
    // wave noise across the loop) to every unlocked lane in one click.
    // Collapses the old workflow (Select All → click SHAPES Chaos) into a
    // single button in the GENERATIVE section. The SHAPES toolbar's Chaos
    // button (sdApplyTemplate('chaos_lfo')) still exists and still targets
    // selection/active-lane only — this just adds the global one-shot.
    window.sdApplyGlobalChaos = function() {
        const targets = sdGetUnlockedParams();
        if (!targets.length) {
            const status = document.getElementById('sd-canvas-status');
            if (status) status.textContent = sdCanvasParams.length
                ? 'All lanes locked — unlock to generate'
                : 'No lanes loaded';
            return;
        }
        pushUndo();
        const bars = sdGetBars(); const totalBeats = bars * 4;
        const sel = sdGetSelection(); const sB = sel ? sel.startBeat : 0; const eB = sel ? sel.endBeat : totalBeats;
        targets.forEach(param => {
            if (sel) param.points = param.points.filter(pt => pt.time < sB || pt.time > eB); else param.points = [];
            param.points = param.points.concat(_sdGenTemplatePts('chaos_lfo', sB, eB)).sort((a, b) => a.time - b.time);
        });
        sdResetSliderSnapshots(); sdRenderSidebar(); sdDrawCanvasGrid();
        _sdLandKick(targets);   // landing animation (mockup B): the comet draws the new curves on
        const skipMsg = sdLockSkipMessage(targets.length);
        if (skipMsg) {
            const status = document.getElementById('sd-canvas-status');
            if (status) {
                status.textContent = skipMsg;
                setTimeout(() => { if (status.textContent === skipMsg) status.textContent = ''; }, 3000);
            }
        }
    };

    // S&H (Sample & Hold): per-lane stepped-random staircase across every
    // unlocked lane. Flat held values that jump to a new random level on a
    // rhythmic grid — NO bezier, hard steps only. The rate CHANGES per bar
    // (drawn from a straight + triplet pool, max 1/32), and each lane rolls
    // its own intensity band, so lanes land on mismatched grids and the rack
    // reads as polyrhythmic (e.g. 1/4 against 1/8T = 4-against-3), phase-locked
    // to the bar.
    //
    // Each step = two points at the same value via the ε-gap technique already
    // used by mid_value_hold / hyper_stutter:  addPt(t, v); addPt(t+r-ε, v).
    // The next step's point sits ε beats later → a vertical jump. So S&H steps
    // inject into the .alc identically to the existing stepped shapes — no
    // M4L / injector / writer changes.
    //
    // Selection- and lock-aware (same scaffolding as Neuro/Chaos/Reflector).
    // One click generates; click again rerolls.
    //
    // NOTE: the pure step-math here is mirrored by stride-vst/test/
    // test-sample-hold.js — if you change the rate pool, bands, or stepping,
    // update that spec too.
    // ── S&H MODE (2026-08-07): Poly (classic polyrhythmic, the default) or a FIXED grid
    // division — every step takes a new held value, dead on the chosen division, straight
    // or triplet. A TOOL preference (sticky across sessions), not lane data; both the
    // Motion S&H and the Shapes-row lane S&H honor it, and so does the keyswitch.
    const SD_SH_MODES = [['Poly', 0], ['1/8', 0.5], ['1/8T', 1 / 3], ['1/16', 0.25], ['1/16T', 1 / 6], ['1/32', 0.125], ['1/32T', 1 / 12]];
    let _sdShMode = 0;
    try { const _shm = parseFloat(localStorage.getItem('sd_sh_mode')); if (_shm > 0) _sdShMode = _shm; } catch (e) {}
    let _sdShPopEl = null;
    window.sdOpenShModePopup = function (ev) {
        if (ev && ev.stopPropagation) ev.stopPropagation();
        if (_sdShPopEl) { _sdShPopEl.remove(); _sdShPopEl = null; return; }
        const pop = document.createElement('div');
        pop.style.cssText = 'position:fixed;z-index:10070;background:#09090b;border:1px solid rgba(255,255,255,0.12);'
            + 'border-radius:10px;box-shadow:0 18px 50px rgba(0,0,0,0.8);padding:10px;width:132px;'
            + "font-family:'Outfit',sans-serif";
        const title = document.createElement('div');
        title.style.cssText = 'font-size:9px;font-weight:900;letter-spacing:0.14em;text-transform:uppercase;color:#a1a1aa;margin-bottom:8px';
        title.textContent = 'S&H mode';
        pop.appendChild(title);
        SD_SH_MODES.forEach(([lbl, v]) => {
            const on = Math.abs(_sdShMode - v) < 1e-4;
            const b = document.createElement('button');
            b.textContent = lbl;
            b.style.cssText = 'display:block;width:100%;text-align:left;font-size:10px;font-weight:800;letter-spacing:0.1em;text-transform:uppercase;'
                + 'padding:4px 8px;margin-bottom:2px;border-radius:5px;cursor:pointer;border:1px solid '
                + (on ? 'rgba(249,115,22,0.6);color:#fdba74;background:rgba(249,115,22,0.12)' : 'rgba(255,255,255,0.06);color:#a1a1aa;background:none');
            b.addEventListener('click', (e) => {
                e.stopPropagation();
                _sdShMode = v;
                try { localStorage.setItem('sd_sh_mode', String(v)); } catch (err) {}
                if (_sdShPopEl) { _sdShPopEl.remove(); _sdShPopEl = null; }
                _sdShPaintModeBtns();   // every S&H surface shows the picked timing
                const st = document.getElementById('sd-canvas-status');
                if (st) st.textContent = v > 0 ? ('S&H grid: ' + lbl + ' — every step takes a new value') : 'S&H: Poly — classic polyrhythmic steps';
            });
            pop.appendChild(b);
        });
        document.body.appendChild(pop);
        const cx = (ev && ev.clientX) || 200, cy = (ev && ev.clientY) || 200;
        const r = pop.getBoundingClientRect();
        pop.style.left = Math.max(6, Math.min(cx + 8, window.innerWidth - r.width - 6)) + 'px';
        pop.style.top = Math.max(6, Math.min(cy - 20, window.innerHeight - r.height - 6)) + 'px';
        setTimeout(() => {
            const closer = (e2) => { if (_sdShPopEl && !_sdShPopEl.contains(e2.target)) { _sdShPopEl.remove(); _sdShPopEl = null; document.removeEventListener('mousedown', closer, true); } };
            document.addEventListener('mousedown', closer, true);
        }, 0);
        _sdShPopEl = pop;
    };
    // The picked timing, readable at a glance (field request 2026-08-07): every ▾ across
    // every S&H surface (Shapes row, Motion row, compact, sidebar card) shows the current
    // mode — "1/16T ▾" when a grid is set, a bare "▾" for Poly (the default).
    function _sdShModeLabel() {
        let best = 'Poly', bd = 1e9;
        for (const [l, v] of SD_SH_MODES) { const d0 = Math.abs(v - _sdShMode); if (d0 < bd) { bd = d0; best = l; } }
        return best;
    }
    function _sdShPaintModeBtns() {
        const lbl = _sdShMode > 0 ? (_sdShModeLabel() + ' ▾') : '▾';
        try { document.querySelectorAll('.sd-sh-mode-btn').forEach(b => { b.textContent = lbl; }); } catch (e) {}
    }
    _sdShPaintModeBtns();   // boot: reflect the sticky choice immediately

    // Fixed-grid step emitter shared by BOTH S&H generators: new value every `d` beats,
    // flat ε-gap holds, same MIN_DELTA read guarantee as poly.
    function _sdShGridPts(sB, eB, d, EPS, MIN_DELTA, round4) {
        const pts = [];
        let lastV = null;
        for (let t = sB; t < eB - 1e-4; t += d) {
            const stepEnd = Math.min(t + d, eB);
            let v, tries = 0;
            do { v = Math.random(); tries++; }
            while (lastV !== null && Math.abs(v - lastV) < MIN_DELTA && tries < 12);
            lastV = v;
            const tA = round4(t);
            pts.push({ time: tA, value: v });
            const tB = round4(stepEnd - EPS);
            if (tB > tA) pts.push({ time: tB, value: v });   // flat hold
        }
        return pts;
    }

    window.sdApplyGlobalSampleHold = function() {
        const targets = sdGetUnlockedParams();
        if (!targets.length) {
            const status = document.getElementById('sd-canvas-status');
            if (status) status.textContent = sdCanvasParams.length
                ? 'All lanes locked — unlock to generate'
                : 'No lanes loaded';
            return;
        }
        pushUndo();
        const totalBeats = sdGetBars() * 4;
        const sel = sdGetSelection();
        const sB = sel ? sel.startBeat : 0;
        const eB = sel ? sel.endBeat : totalBeats;
        if (eB <= sB) return;

        // Rate pool in beats (4/4: 1 bar = 4 beats). Every entry tiles a bar
        // evenly — straight 1/2…1/32 plus triplets 1/4T (6/bar), 1/8T (12),
        // 1/16T (24). Smallest = 1/32 (0.125) per the "max 1/32" cap.
        const RATES = sdGridTriplet ? [2, 1, 4 / 6, 2 / 6, 1 / 6] : [2, 1, 0.5, 0.25, 0.125, 4 / 6, 2 / 6, 1 / 6];   // triplet lock: only rates that land on the triplet grid
        // Full-range: every lane spans the ENTIRE 0–1 axis. We deliberately do
        // NOT confine any lane to a sub-band — the user dials individual lanes
        // back afterward with the Intensity edit tool. minDelta only keeps
        // adjacent steps visibly apart.
        const EPS = 0.005;
        const MIN_DELTA = 0.15;
        const round4 = t => Math.round(t * 10000) / 10000;

        // GRID mode (2026-08-07): every lane steps on the SAME fixed division — a new
        // held value every step, dead on the grid. Poly (0, default) keeps the classic
        // per-bar-rate polyrhythm below.
        if (_sdShMode > 0) {
            targets.forEach(param => {
                const pts = _sdShGridPts(sB, eB, _sdShMode, EPS, MIN_DELTA, round4);
                if (sel) {
                    const outside = param.points.filter(pt => pt.time < sB || pt.time > eB);
                    param.points = outside.concat(pts).sort((a, b) => a.time - b.time);
                } else {
                    param.points = pts;
                }
            });
            sdResetSliderSnapshots(); sdRenderSidebar(); sdDrawCanvasGrid();
            _sdLandKick(targets);   // landing animation (mockup B): the comet draws the new curves on
            return;
        }

        targets.forEach(param => {
            const pts = [];
            let lastV = null, prevRate = null;

            // Walk bar-aligned sections so triplet rates tile cleanly and rate
            // changes land on bar lines. First/last sections can be partial if
            // a selection doesn't start/end on a bar boundary.
            let secStart = sB;
            while (secStart < eB - 1e-4) {
                const secEnd = Math.min((Math.floor(secStart / 4) + 1) * 4, eB);
                // ~50% keep the previous rate (stickiness) so it isn't frantic.
                const rate = (prevRate !== null && Math.random() < 0.5)
                    ? prevRate
                    : RATES[Math.floor(Math.random() * RATES.length)];
                prevRate = rate;

                let t = secStart;
                while (t < secEnd - 1e-4) {
                    const stepEnd = Math.min(t + rate, secEnd);
                    // Random value across the FULL 0–1 axis, forced to differ
                    // from the last step so every jump reads.
                    let v, tries = 0;
                    do { v = Math.random(); tries++; }
                    while (lastV !== null && Math.abs(v - lastV) < MIN_DELTA && tries < 12);
                    lastV = v;
                    const cv = Math.max(0, Math.min(1, v));
                    const tA = round4(t);
                    pts.push({ time: tA, value: cv });
                    const tB = round4(stepEnd - EPS);
                    if (tB > tA) pts.push({ time: tB, value: cv });   // flat hold
                    t = stepEnd;
                }
                secStart = secEnd;
            }

            if (sel) {
                const outside = param.points.filter(pt => pt.time < sB || pt.time > eB);
                param.points = outside.concat(pts).sort((a, b) => a.time - b.time);
            } else {
                param.points = pts;
            }
        });

        sdResetSliderSnapshots(); sdRenderSidebar(); sdDrawCanvasGrid();
        _sdLandKick(targets);   // landing animation (mockup B): the comet draws the new curves on
        const skipMsg = sdLockSkipMessage(targets.length);
        if (skipMsg) {
            const status = document.getElementById('sd-canvas-status');
            if (status) {
                status.textContent = skipMsg;
                setTimeout(() => { if (status.textContent === skipMsg) status.textContent = ''; }, 3000);
            }
        }
    };

    // Single-lane Sample & Hold — the SHAPES-row sibling of the Motion-section
    // global S&H. Injects ONE stepped-random S&H pattern onto the selected lane
    // (or every target lane when All-Lanes is on), reusing the same rate pool
    // and ε-gap hold logic as the global version. Click again to reroll.
    window.sdApplySampleHoldLane = function() {
        if (!sdActiveParamId) {
            const status = document.getElementById('sd-canvas-status');
            if (status) status.textContent = 'Select a lane first';
            return;
        }
        pushUndo();
        const sel = sdGetSelection();
        const allBeats = sdGetBars() * 4;
        const sB = sel ? sel.startBeat : 0;
        const eB = sel ? sel.endBeat : allBeats;
        if (eB <= sB) return;

        const RATES = sdGridTriplet ? [2, 1, 4 / 6, 2 / 6, 1 / 6] : [2, 1, 0.5, 0.25, 0.125, 4 / 6, 2 / 6, 1 / 6];   // triplet lock: only rates that land on the triplet grid
        const EPS = 0.005;
        const MIN_DELTA = 0.15;
        const round4 = t => Math.round(t * 10000) / 10000;

        // GRID mode: fixed division, same as the Motion S&H (the sticky ▾ choice).
        if (_sdShMode > 0) {
            sdGetTargetParams().forEach(param => {
                const pts = _sdShGridPts(sB, eB, _sdShMode, EPS, MIN_DELTA, round4);
                if (sel) {
                    const outside = param.points.filter(pt => pt.time < sB || pt.time > eB);
                    param.points = outside.concat(pts).sort((a, b) => a.time - b.time);
                } else {
                    param.points = pts;
                }
            });
            sdResetSliderSnapshots(); sdRenderSidebar(); sdDrawCanvasGrid();
            _sdLandKick(sdGetTargetParams());   // landing animation (mockup B): the comet draws the new curves on
            return;
        }

        sdGetTargetParams().forEach(param => {
            const pts = [];
            let lastV = null, prevRate = null;
            let secStart = sB;
            while (secStart < eB - 1e-4) {
                const secEnd = Math.min((Math.floor(secStart / 4) + 1) * 4, eB);
                const rate = (prevRate !== null && Math.random() < 0.5)
                    ? prevRate
                    : RATES[Math.floor(Math.random() * RATES.length)];
                prevRate = rate;
                let t = secStart;
                while (t < secEnd - 1e-4) {
                    const stepEnd = Math.min(t + rate, secEnd);
                    let v, tries = 0;
                    do { v = Math.random(); tries++; }
                    while (lastV !== null && Math.abs(v - lastV) < MIN_DELTA && tries < 12);
                    lastV = v;
                    const cv = Math.max(0, Math.min(1, v));
                    const tA = round4(t);
                    pts.push({ time: tA, value: cv });
                    const tB = round4(stepEnd - EPS);
                    if (tB > tA) pts.push({ time: tB, value: cv });   // flat hold
                    t = stepEnd;
                }
                secStart = secEnd;
            }
            if (sel) {
                const outside = param.points.filter(pt => pt.time < sB || pt.time > eB);
                param.points = outside.concat(pts).sort((a, b) => a.time - b.time);
            } else {
                param.points = pts;
            }
        });

        sdResetSliderSnapshots(); sdRenderSidebar(); sdDrawCanvasGrid();
        _sdLandKick(sdGetTargetParams());   // landing animation (mockup B): the comet draws the new curves on
    };

    // Reflector: pairs up unlocked lanes into tight base+mirror pairs.
    //
    // Every two consecutive lanes form a base/mirror pair — the fold reads
    // at the smallest possible scale on the canvas, so the visual impact
    // hits immediately instead of requiring the eye to track across half
    // the rack.
    //
    //   For N=20 lanes (the canonical case):
    //     lanes 1-2   = Neuro A   +  mirror(A)
    //     lanes 3-4   = Neuro B   +  mirror(B)
    //     ... (5 neuro pairs total) ...
    //     lanes 9-10  = Neuro E   +  mirror(E)
    //     lanes 11-12 = Chaos F   +  mirror(F)
    //     ... (5 chaos pairs total) ...
    //     lanes 19-20 = Chaos J   +  mirror(J)
    //
    // Non-multiple-of-20 lanes degrade gracefully: pair count = floor(N/2),
    // split into neuroPairs/chaosPairs with a coin flip choosing which side
    // gets the extra pair when pairs is odd. Odd-N leftover lane (if any)
    // gets one extra unpaired random pattern.
    //
    // "Mirror" = value-flip (value = 1 - value, curve negated). Matches the
    // sdMirrorLane vocabulary in the codebase. (sdFlipLane is time-reverse;
    // that's not what we want here.)
    //
    // Selection-aware: when a region is selected, only that region of each
    // lane is touched; the rest is preserved (same pattern as Prism/Bloom/
    // Chaos/Neuro/Stretch).
    window.sdApplyGlobalReflector = function() {
        const targets = sdGetUnlockedParams();
        if (targets.length < 2) {
            const status = document.getElementById('sd-canvas-status');
            if (status) status.textContent = sdCanvasParams.length
                ? 'Reflector needs at least 2 unlocked lanes — unlock more to pair'
                : 'No lanes loaded';
            return;
        }
        pushUndo();
        const totalBeats = sdGetBars() * 4;
        const sel = sdGetSelection();
        const sB = sel ? sel.startBeat : 0;
        const eB = sel ? sel.endBeat : totalBeats;
        if (eB <= sB) return;

        // Pair sizing — every pair = base + mirror. Coin flip decides which
        // type (neuro vs chaos) gets the extra pair when total pairs is odd.
        const N = targets.length;
        const pairs = Math.floor(N / 2);
        const flip = Math.random() < 0.5;
        const neuroPairs = flip ? Math.ceil(pairs / 2) : Math.floor(pairs / 2);
        const chaosPairs = pairs - neuroPairs;

        // Pattern generators — each call produces a fresh random pattern
        // confined to the [sB, eB] range. Same logic as sdApplyGlobalNeuro
        // and sdApplyGlobalChaos respectively.
        const NEURO_POOL = ['dotted_ramp', 'mid_value_hold', 'offgrid_saw', 'hard_chop',
                            'exponential_build', 'hyper_stutter', 'rhythmic_gate_build',
                            'syncopated_drops'];
        function genNeuro() {
            const tmp = { points: [] };
            let cB = sB;
            while (cB < eB - 0.001) {
                let chunk = [0.5, 1, 1.5, 2, 4][Math.floor(Math.random() * 5)];
                if (cB + chunk > eB) chunk = eB - cB;
                sdInjectShape(tmp, NEURO_POOL[Math.floor(Math.random() * NEURO_POOL.length)], cB, chunk);
                cB = Math.round((cB + chunk) * 10000) / 10000;
            }
            return tmp.points;
        }
        function genChaos() {
            return _sdGenTemplatePts('chaos_lfo', sB, eB);
        }
        function mirror(points) {
            return points.map(pt => ({
                time: pt.time,
                value: Math.max(0, Math.min(1, 1 - pt.value)),
                curve: pt.curve ? -pt.curve : 0,
            }));
        }
        function applyToLane(param, newPoints) {
            const sorted = newPoints.slice().sort((a, b) => a.time - b.time);
            if (sel) {
                const outside = param.points.filter(pt => pt.time < sB || pt.time > eB);
                param.points = outside.concat(sorted).sort((a, b) => a.time - b.time);
            } else {
                param.points = sorted;
            }
        }

        // Generate base arrays ONCE so mirrors are exact reflections of
        // their paired base (not independent random patterns).
        const neuroBases = [];
        for (let i = 0; i < neuroPairs; i++) neuroBases.push(genNeuro());
        const chaosBases = [];
        for (let i = 0; i < chaosPairs; i++) chaosBases.push(genChaos());

        // Lay out as tight base+mirror pairs — each mirror sits in the
        // lane IMMEDIATELY below its base (not below the whole base group).
        // Every two consecutive lanes are a visual pair.
        //   Neuro section: [N₁, mirror(N₁), N₂, mirror(N₂), …]
        //   Chaos section: [C₁, mirror(C₁), C₂, mirror(C₂), …]
        //   Leftover (N odd): one unpaired random pattern.
        let idx = 0;
        for (let i = 0; i < neuroPairs; i++) {
            applyToLane(targets[idx++], neuroBases[i]);
            applyToLane(targets[idx++], mirror(neuroBases[i]));
        }
        for (let i = 0; i < chaosPairs; i++) {
            applyToLane(targets[idx++], chaosBases[i]);
            applyToLane(targets[idx++], mirror(chaosBases[i]));
        }
        while (idx < N) {
            applyToLane(targets[idx++], Math.random() < 0.5 ? genNeuro() : genChaos());
        }

        sdResetSliderSnapshots(); sdRenderSidebar(); sdDrawCanvasGrid();
        _sdLandKick(targets);   // landing animation (mockup B): the comet draws the new curves on
        const skipMsg = sdLockSkipMessage(targets.length);
        if (skipMsg) {
            const status = document.getElementById('sd-canvas-status');
            if (status) {
                status.textContent = skipMsg;
                setTimeout(() => { if (status.textContent === skipMsg) status.textContent = ''; }, 3000);
            }
        }
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
        if (!sdClipboardPoints || !sdClipboardPoints.length) return;
        // Honor the Select feature: if any lanes are selected, paste targets
        // them (Inv flips values per-target). Otherwise fall back to the
        // active lane. Locked lanes are filtered out by sdGetTargetParams.
        // Pre-fix bug: this used sdActiveParamId directly, so Copy from lane A
        // → Select lane B → Paste Inv landed back on lane A instead of B.
        const targets = sdGetTargetParams();
        if (!targets.length) {
            const status = document.getElementById('sd-canvas-status');
            if (status) status.textContent = sdHasSelection()
                ? 'All selected lanes are locked — unlock to paste'
                : 'No active lane (or it\'s locked) — pick a lane first';
            return;
        }
        pushUndo();
        const sel = sdGetSelection();
        const tS = sel ? sel.startBeat : 0;
        const cD = Math.max(...sdClipboardPoints.map(p => p.time));
        const tD = sel ? (sel.endBeat - sel.startBeat) : cD;
        const sc = cD > 0 ? tD / cD : 1;
        targets.forEach(param => {
            if (sel) param.points = param.points.filter(pt => pt.time < sel.startBeat || pt.time > sel.endBeat);
            else param.points = [];
            sdClipboardPoints.forEach(pt => {
                param.points.push({
                    time: Math.round((tS + pt.time * sc) * 10000) / 10000,
                    value: invert ? 1 - pt.value : pt.value,
                    curve: invert ? -(pt.curve || 0) : (pt.curve || 0),
                });
            });
            param.points.sort((a, b) => a.time - b.time);
        });
        sdResetSliderSnapshots();
        sdRenderSidebar();
        sdDrawCanvasGrid();
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
        const allIds = [...document.querySelectorAll('.sd-paste-to-cb:checked')].map(cb => cb.dataset.id);
        if (!allIds.length) return;
        // Locked targets are filtered out — paste-to never overwrites a
        // locked lane's curve, even if the user ticked its checkbox.
        const ids = allIds.filter(id => {
            const p = sdCanvasParams.find(p => p.envelopeId === id);
            return p && !p.locked;
        });
        const skippedLocked = allIds.length - ids.length;
        if (!ids.length) {
            const status = document.getElementById('sd-canvas-status');
            if (status) status.textContent = 'All selected lanes locked — unlock to paste';
            sdClosePasteTo();
            return;
        }
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
        const skipNote = skippedLocked > 0 ? ` (${skippedLocked} locked, skipped)` : '';
        document.getElementById('sd-canvas-status').textContent = `Pasted${invert ? ' inv' : ''} to ${ids.length} lane${ids.length > 1 ? 's' : ''}${skipNote}`;
        sdClosePasteTo();
    };
    document.addEventListener('click', function(e) {
        const pop = document.getElementById('sd-paste-to-popover');
        if (!pop || pop.classList.contains('hidden')) return;
        if (!pop.contains(e.target) && e.target.id !== 'sd-paste-to-btn') sdClosePasteTo();
    });

    // Quantize, Swing, Smooth, Intensity
    //
    // sdQuantizeLane is INTENTIONALLY ORPHANED from the UI as of 2026-05-03.
    // The 1/4 / 1/8 / 1/16 / 1/8T / 1/16T toolbar buttons were removed because
    // no one was using them. The function stays compilable here so we can
    // re-wire it later — see project memory: project_quantize_triplet_spec.md
    // for the future direction (triplet-aware preset shapes + Chaos triplet
    // mode rather than raw quantize buttons).
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
        if (sdGridTriplet) {   // swing shifts STRAIGHT subdivisions toward a triplet feel — undefined on a triplet grid
            const st = document.getElementById('sd-canvas-status');
            if (st) st.textContent = 'Swing is a straight-grid feel — disabled on the triplet grid';
            return;
        }
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
        _sdPushCtlParamToEngine('smooth', val);   // the DAW param follows the UI (Configure catches it)
        if (!sdActiveParamId) return;
        // Targets: selected (unlocked) lanes if there's a selection, else
        // active lane only. Smooth needs at least 3 points to do anything.
        const targets = sdGetTargetParams().filter(p => p.points.length >= 3);
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
        _sdPushCtlParamToEngine('depth', val);   // 0..200, neutral 100 — the helper normalizes
        if (!sdActiveParamId) return;
        // Targets: selected (unlocked) lanes if there's a selection, else
        // active lane only. Intensity needs at least 1 point.
        const targets = sdGetTargetParams().filter(p => p.points.length > 0);
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
        _sdPushCtlParamToEngine('curve', val);
        const amount = parseInt(val) / 100; // 0 to 1

        // Targets: selected (unlocked) lanes if there's a selection, else
        // active lane only. Curve needs at least 2 points.
        const targets = sdGetTargetParams().filter(p => p.points.length >= 2);
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
    // 1.1.11 REBASE MECHANICS. The old model was a stateful dial with baseline amnesia:
    // on a target change the snapshot was discarded and the sliders force-reset to 0/100
    // while the points kept their compression — Select All → floor to 30% → select one
    // lane → its slider read 0% and "down" was impossible (field report 2026-07-26).
    // The transform v' = floor + v·(ceil−floor) is linear and invertible (output can't
    // leave 0..1), so the dial can always PICK UP WHERE THE LANES ACTUALLY ARE:
    //   · on target change the sliders initialize from the targets' REAL bounds
    //   · the snapshot stores points NORMALIZED through those bounds
    //   · dragging maps the normalized baseline through the current slider values —
    //     floor goes below an inherited 30% just as easily as above it, losslessly.
    let _sdFloorCeilSnapshot = null;
    let _sdFloorCeilKey = null;

    function _getFloorCeilTargets() {
        // Targets: selected (unlocked) lanes if there's a selection, else
        // active lane only. Floor/Ceiling needs at least 1 point.
        return sdGetTargetParams().filter(p => p.points.length > 0);
    }

    // The current targets' true value bounds (multi-select: min-of-mins / max-of-maxes,
    // preserving relative offsets between lanes). Flat-lane guard: a 1% span keeps the
    // normalize invertible and lets the dial move a flatline around.
    function _sdFcDetectBounds() {
        const targets = _getFloorCeilTargets();
        let mn = 1, mx = 0;
        targets.forEach(p => p.points.forEach(pt => { mn = Math.min(mn, pt.value); mx = Math.max(mx, pt.value); }));
        if (!targets.length || mx < mn) { mn = 0; mx = 1; }
        if (mx - mn < 0.01) { mn = Math.max(0, Math.min(mn, 0.99)); mx = Math.min(1, mn + 0.01); }
        return { targets, mn, mx };
    }

    function _sdFcSetSliders(mnPct, mxPct) {
        [['sd-', 'floor', mnPct], ['sd-', 'ceil', mxPct], ['qpc-', 'floor', mnPct], ['qpc-', 'ceil', mxPct]].forEach(([pre, which, v]) => {
            const s = document.getElementById(pre + which + '-slider');
            if (s) s.value = v;
            const o = document.getElementById(pre + which + '-val');
            if (o) o.textContent = v + '%';
        });
    }

    // Target set changed (lane switch / selection change) → the sliders show the truth.
    // NEVER a dead 0/100 reset.
    function _sdFcSyncSliders() {
        _sdFloorCeilSnapshot = null; _sdFloorCeilKey = null;
        const d = _sdFcDetectBounds();
        _sdFcSetSliders(Math.round(d.mn * 100), Math.round(d.mx * 100));
    }

    function _ensureFloorCeilSnapshot() {
        const d = _sdFcDetectBounds();
        if (!d.targets.length) return null;
        const key = d.targets.map(p => p.envelopeId).join(',');
        if (_sdFloorCeilKey !== key || !_sdFloorCeilSnapshot) {
            _sdFloorCeilSnapshot = {};
            const rg = Math.max(0.0001, d.mx - d.mn);
            d.targets.forEach(p => {
                _sdFloorCeilSnapshot[p.envelopeId] = p.points.map(pt => ({ time: pt.time, value: (pt.value - d.mn) / rg, curve: pt.curve || 0 }));
            });
            _sdFloorCeilKey = key;
        }
        return d.targets;
    }

    // Floor/Ceiling read+write their slider DOM directly (unlike Smooth/Depth/Curve,
    // which take the value as an arg). In compact mode the sidebar EDIT strip is
    // hidden and the #qpc-* strip is what the user drives, so resolve to whichever
    // strip is active — same suffixes, sd-/qpc- prefix. Without this the compact
    // Floor/Ceiling sliders moved nothing (the math read the sidebar's defaults).
    function _sdFcEl(suffix) { return document.getElementById((_sdCompact ? 'qpc-' : 'sd-') + suffix); }
    function _sdFcInt(suffix, dflt) { const el = _sdFcEl(suffix); return el ? parseInt(el.value) : dflt; }
    function _applyFloorCeil() {
        const targets = _ensureFloorCeilSnapshot();
        if (!targets) return;
        const floor = _sdFcInt('floor-slider', 0) / 100;
        const ceil = _sdFcInt('ceil-slider', 100) / 100;
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
        const fv = _sdFcEl('floor-val'); if (fv) fv.textContent = val + '%';
        _sdPushCtlParamToEngine('floor', val);
        if (!_sdFloorCeilSnapshot) pushUndo();
        // Clamp ceiling above floor (on the active strip — sidebar or compact)
        const ceilSlider = _sdFcEl('ceil-slider');
        if (ceilSlider && parseInt(val) > parseInt(ceilSlider.value)) {
            ceilSlider.value = val;
            const cv = _sdFcEl('ceil-val'); if (cv) cv.textContent = val + '%';
        }
        _applyFloorCeil();
    };

    window.sdApplyCeiling = function(val) {
        const cv = _sdFcEl('ceil-val'); if (cv) cv.textContent = val + '%';
        _sdPushCtlParamToEngine('ceil', val);
        if (!_sdFloorCeilSnapshot) pushUndo();
        // Clamp floor below ceiling (on the active strip — sidebar or compact)
        const floorSlider = _sdFcEl('floor-slider');
        if (floorSlider && parseInt(val) < parseInt(floorSlider.value)) {
            floorSlider.value = val;
            const fv = _sdFcEl('floor-val'); if (fv) fv.textContent = val + '%';
        }
        _applyFloorCeil();
    };

    // ── HOST-DRIVEN CONTROLS (wrapper, 2026-08-07): "Stride Smooth/Depth/Curve/Floor/
    // Ceiling" are DAW params a MIDI knob can ride. They drive the SAME snapshot-based
    // slider functions the strip uses, on the same targets (selection, else the active
    // lane). One knob ride = ONE gesture: ≥1s of knob silence re-arms the snapshots (and
    // the undo entry), exactly like releasing a strip slider. BPM never lands here — the
    // engine takes that one directly.
    // UI → param sync (wrapper): moving a Stride slider notifies its DAW param, exactly
    // like a BPM edit does — that's what lets Ableton's CONFIGURE catch the sliders by
    // touching them in Stride (field report 2026-08-07: BPM configured, sliders didn't),
    // and it keeps mappings/written automation honest. The editor updates its relay
    // baseline in the same message, so the change never echoes back as a knob event.
    function _sdPushCtlParamToEngine(k, uiVal) {
        try {
            if (!window.strideLink || !window.strideLink._wrapper) return;
            const denom = (k === 'depth') ? 200 : 100;
            const norm = Math.max(0, Math.min(1, (parseFloat(uiVal) || 0) / denom));
            window.strideLink.send({ type: 'set_ctl_param', k: k, v: norm });
        } catch (e) {}
    }

    let _sdHostCtlLastMs = 0;
    window.sdHostCtl = function (k, v) {
        try {
            const now = Date.now();
            if (now - _sdHostCtlLastMs > 1000) sdResetSliderSnapshots();   // new ride = new gesture + fresh undo entry
            _sdHostCtlLastMs = now;
            const n = Math.max(0, Math.min(1, +v || 0));
            // Depth (intensity) runs 0..200 with NEUTRAL at 100 — the one slider whose
            // range isn't 0..100 (field catch 2026-08-07). Everything else maps 0..100.
            const out = (k === 'depth') ? Math.round(n * 200) : Math.round(n * 100);
            // Move the visible HANDLES too (sidebar + compact strips) — the value applied
            // but a parked handle read as "out of sync" (field report 2026-08-07). The
            // apply functions update the % labels; the compact labels ride here.
            const ids = { smooth: 'smooth-slider', depth: 'intensity-slider', curve: 'curve-slider', floor: 'floor-slider', ceil: 'ceil-slider' }[k];
            if (ids) ['sd-' + ids, 'qpc-' + ids].forEach(id => { const el = document.getElementById(id); if (el) el.value = out; });
            const qv = { smooth: 'qpc-smooth-val', depth: 'qpc-intensity-val', curve: 'qpc-curve-val', floor: 'qpc-floor-val', ceil: 'qpc-ceil-val' }[k];
            if (qv) { const el = document.getElementById(qv); if (el) el.textContent = out + '%'; }
            if (k === 'smooth')      window.sdApplySmooth(out);
            else if (k === 'depth')  window.sdApplyIntensity(out);
            else if (k === 'curve')  window.sdApplyCurve(out);
            else if (k === 'floor')  window.sdApplyFloor(out);
            else if (k === 'ceil')   window.sdApplyCeiling(out);
        } catch (e) {}
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
        // Floor/Ceiling do NOT reset to 0/100 — they REBASE to the new target's real
        // bounds (see the F5 block above). The dead-reset was the "can't bring the
        // floor back down" bug.
        _sdResetCompactSliders();
        _sdFcSyncSliders();
    }
    // Reset the compact slider strip (#qpc-*) to neutral. Separate from the sidebar
    // sliders (different ids); kept in sync via sdResetSliderSnapshots so the compact
    // and full edit strips never drift. No-op if the compact strip isn't in the DOM.
    function _sdResetCompactSliders() {
        const defs = { 'qpc-smooth': 0, 'qpc-intensity': 100, 'qpc-curve': 0 };   // floor/ceil rebase via _sdFcSyncSliders — never a dead 0/100 reset
        Object.keys(defs).forEach(function (k) {
            const sl = document.getElementById(k + '-slider');
            if (sl) sl.value = defs[k];
            const v = document.getElementById(k + '-val');
            if (v) v.textContent = defs[k] + '%';
        });
    }

    // ─── TIME STRETCH ────────────────────────────────────────
    window.sdTimeStretch = function(factor, targetsOverride) {
        // targetsOverride: StrideQuick passes the all-unlocked-lanes set so
        // 2x / ½x affect every lane (select-all + stretch). Omitted = the
        // on-screen button's original active/selected-lane behavior, which
        // requires an active lane.
        if (!targetsOverride && !sdActiveParamId) return;
        pushUndo();
        const totalBeats = sdGetBars() * 4;
        const sel = sdGetSelection();
        (targetsOverride || sdGetTargetParams()).forEach(param => {
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
                // Clip to the SELECTION (not the whole clip). With factor > 1
                // the stretched points can land past eB; without this clamp
                // the overflow leaks outside the selected region — that was
                // the reported bug. Lower bound stays >= sB defensively even
                // though stretched points can't go below sB given factor>0.
                param.points = outside.concat(inside.filter(pt => pt.time >= sB && pt.time <= eB));
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
        // Targets: selected (unlocked) lanes if there's a selection, else
        // active lane only. Locked lanes are protected from clear too —
        // sdGetTargetParams filters them out.
        const targets = sdGetTargetParams();
        if (!targets.length) return;
        pushUndo();
        targets.forEach(param => {
            if (sel) param.points = param.points.filter(pt => pt.time < sel.startBeat || pt.time > sel.endBeat);
            else param.points = [];
        });
        sdResetSliderSnapshots(); sdRenderSidebar(); sdDrawCanvasGrid();
        // Persist the clear so a follow-up rescan-merge's restore (which fills empty
        // lanes from the saved state) can't re-add the curve you just deleted.
        try { if (typeof saveCanvasState === 'function') saveCanvasState(); } catch (e) {}
    };
    // ─── Lane selection actions ─────────────────────────────

    // Select All toggles between "all unlocked lanes selected" and "none".
    // Individual lanes are managed by Ctrl+click (or Ctrl+drag) on the
    // canvas — see the multi-view mousedown branch.

    window.sdSelectAll = function() {
        // "All" means the VISIBLE pool: with a chain device focused (sdDeviceFilter),
        // Select All grabs that device's lanes only — never lanes the filter hides.
        // (2026-08-13: filtered Select All was selecting every device's lanes, so
        // group range edits reached devices that weren't even on screen.)
        const pool = sdVisibleParams();
        const unlocked = pool.filter(p => !p.locked);
        if (!unlocked.length) {
            _sdUpdateSelectionButtons();
            return;
        }
        const allSelected = unlocked.every(p => p.selected);
        if (allSelected) {
            // Already all selected → toggle off. Deselect EVERY lane, not just the
            // pool — deselect is the safe direction and sweeps out stale selection.
            sdCanvasParams.forEach(p => { p.selected = false; });
        } else {
            // Fill: select every visible unlocked lane (locked stay alone)
            pool.forEach(p => {
                if (!p.locked) p.selected = true;
            });
        }
        _sdUpdateSelectionButtons();
        sdRenderSidebar();
        sdDrawCanvasGrid();
        _sdFcSyncSliders();   // floor/ceiling dial rebases to the new target set (F5)
    };

    // Toggle a single lane's selected state. Called from the multi-view
    // mousedown handler on Ctrl+click, by the drag-select gesture, and
    // programmatically by tests.
    window.sdToggleLaneSelection = function(envelopeId) {
        const p = sdCanvasParams.find(p => p.envelopeId === envelopeId);
        if (!p || p.locked) return;
        p.selected = !p.selected;
        _sdUpdateSelectionButtons();
        sdRenderSidebar();
        sdDrawCanvasGrid();
    };

    // Refresh the visual state of the Select All button. Highlighted when
    // every unlocked lane is selected; idle otherwise.
    function _sdUpdateSelectionButtons() {
        const ACTIVE_CLASS = "text-[9px] text-fuchsia-300 bg-fuchsia-500/20 border border-fuchsia-500/40 hover:bg-fuchsia-500/30 px-2 py-1 rounded uppercase font-bold transition-colors shrink-0 shadow-[0_0_8px_rgba(217,70,239,0.2)]";
        const IDLE_CLASS = "text-[9px] text-zinc-500 bg-black/50 border border-white/5 hover:border-fuchsia-500/30 px-2 py-1 rounded uppercase font-bold transition-colors shrink-0";

        // Lit when the VISIBLE pool is fully selected — with a device focused,
        // that's the focused device's lanes (the only ones Select All grabs).
        const unlocked = sdVisibleParams().filter(p => !p.locked);
        const allSelected = unlocked.length > 0 && unlocked.every(p => p.selected);

        const allBtn = document.getElementById('sd-select-all-toggle');
        if (allBtn) {
            allBtn.className = allSelected ? ACTIVE_CLASS : IDLE_CLASS;
        }
    }

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

    // Per-lane focus: jump straight into single-lane view on a specific param
    // (the [] icon beside each lane's lock). The on-canvas "← All lanes" pill
    // or the view-mode toggle returns to the stacked multi view.
    window.sdFocusLane = function(id) {
        const p = sdCanvasParams.find(x => x.envelopeId === id);
        if (!p) return;
        sdCanvasParams.forEach(x => { x.selected = false; });
        sdActiveParamId = id;
        if (sdViewMode !== 'focus') {
            window.sdToggleViewMode();   // multi -> focus (handles pan reset, button state, redraw)
        } else {
            sdViewPanX = 0;
            sdDrawCanvasGrid();
        }
        if (typeof sdRenderSidebar === 'function') sdRenderSidebar();
    };

    // ─── TEMPLATES ─────────────────────────────────────────

    function _sdGenTemplatePts(type, sB, eB) {
        const dur = eB - sB; const pts = [];
        if (type === 'sine') { const _st = sdMotionStep(0.25); for (let b = 0; b <= dur; b += _st) pts.push({ time: sB + b, value: (Math.sin((b / dur) * Math.PI * 2 * Math.max(1, Math.round(dur / 4))) + 1) / 2 }); }
        else if (type === 'pump') { const _st = sdMotionStep(1); for (let b = 0; b < dur - 1e-6; b += _st) { pts.push({ time: sB + b, value: 0 }); pts.push({ time: sB + b + _st * 0.5, value: 1 }); pts.push({ time: sB + b + _st * 0.99, value: 0 }); } }
        else if (type === 'glitch') { const _st = sdMotionStep(0.25); for (let b = 0; b < dur; b += _st) { if (Math.random() > 0.4) { const v = Math.random() > 0.5 ? 1 : 0; pts.push({ time: sB + b, value: v }); pts.push({ time: sB + b + _st * 0.5, value: v }); } } pts.push({ time: eB, value: 0 }); }
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
            for (let b = zone1End; b < zone2End; b += sdMotionStep(0.25)) {
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
            for (let b = 0; b <= dur; b += sdMotionStep(0.25)) {
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
        _sdLandKick(sdGetTargetParams());   // landing animation (mockup B): the comet draws the new curves on
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
        _sdLandKick(sdGetTargetParams());   // landing animation (mockup B): the comet draws the new curves on
    };

    // ─── NEURO v2 VARIANTS ────────────────────────────────────
    // Per-param "less robotic, more alive" generators ported from
    // docs/neuro-variants-mockup.html. Each returns points over [sB, eB],
    // generalized from the mockup's fixed 8 bars to the actual loop length,
    // Math.random in place of the mockup's seeded rng. Applied to the
    // SELECTED/active lane(s) (like the other shapes) via sdApplyNeuroVariant.

    // Curve-aware shape inject (the 8 base neuro shapes + an optional bezier
    // curve per chunk). Distinct from sdInjectShape, which is linear-only.
    function _sdNeuroInject(out, shape, cB, chunk, curveVal) {
        const c = curveVal || 0;
        const add = (t, v, cv) => out.push({ time: Math.round(t * 10000) / 10000, value: Math.max(0, Math.min(1, v)), curve: (cv === undefined ? 0 : cv) });
        if (shape === 'ramp') { const pk = 0.4 + Math.random() * 0.6; add(cB, 0); add(cB + chunk * 0.75, pk, c); add(cB + chunk * 0.75 + 0.01, 0); add(cB + chunk, 0); }
        else if (shape === 'hold') { const mv = 0.15 + Math.random() * 0.35, pk = 0.7 + Math.random() * 0.3; add(cB, 0); add(cB + 0.01, pk); add(cB + chunk * 0.25, pk, c); add(cB + chunk * 0.25 + 0.01, mv); add(cB + chunk * 0.75, mv, c); add(cB + chunk * 0.75 + 0.01, pk); add(cB + chunk - 0.01, pk); add(cB + chunk, 0); }
        else if (shape === 'sawDrop') { const pk = 0.5 + Math.random() * 0.5, og = [0.216, 0.414, 0.618, 0.88][Math.floor(Math.random() * 4)]; add(cB, 0); add(cB + 0.01, pk); add(cB + chunk * og, 0, c); add(cB + chunk, 0); }
        else if (shape === 'chop') { const sub = chunk / 4; for (let i = 0; i < 4; i++) { const val = Math.random() > 0.5 ? (Math.random() > 0.5 ? 1 : 0.3 + Math.random() * 0.5) : 0; if (val > 0) { const t = cB + i * sub; add(t, 0); add(t + 0.01, val); add(t + sub * 0.85, 0, c); } } add(cB + chunk, 0); }
        else if (shape === 'build') { add(cB, 0); add(cB + chunk * 0.5, 0.2, c); add(cB + chunk * 0.8, 0.5, c); add(cB + chunk - 0.01, 1, c); add(cB + chunk, 0); }
        else if (shape === 'stutter') { const ss = Math.random() > 0.5 ? 0.125 : 0.0625, steps = Math.floor(chunk / ss); for (let i = 0; i < steps; i++) { if (i % 2 === 0) { const t = cB + i * ss; add(t, 0); add(t + 0.001, 0.6 + Math.random() * 0.4); add(t + ss * 0.9, 0); } } add(cB + chunk, 0); }
        else if (shape === 'gate') { const step = [0.125, 0.25, 0.5][Math.floor(Math.random() * 3)], steps = Math.floor(chunk / step), sv = 0.7 + Math.random() * 0.3, ev = Math.random() * 0.3, up = Math.random() > 0.5; for (let i = 0; i < steps; i++) { const t = cB + i * step, pr = i / Math.max(1, steps - 1), cp = up ? ev + (sv - ev) * pr : sv + (ev - sv) * pr; add(t, 0); add(t + 0.001, cp); add(t + step * 0.85, 0); } add(cB + chunk, 0); }
        else if (shape === 'syncDrop') { const step = 0.25, steps = Math.floor(chunk / step); for (let i = 0; i < steps; i++) { if (Math.random() > 0.3) { const t = cB + i * step, pk = 0.3 + Math.random() * 0.7; add(t, 0); add(t + 0.001, pk); add(t + step * 0.8, pk * 0.8, c); add(t + step * 0.81, 0); } } add(cB + chunk, 0); }
    }

    // V2 Chaos Build — one contrasting segment emitter (9 types).
    function _sdNeuroEmitSegment(out, type, start, len) {
        if (type === 'denseChop') { for (let i = 0; i < 16; i++) { if (Math.random() > 0.25) { const t = start + i * 0.25, v = 0.65 + Math.random() * 0.35; out.push({ time: t, value: 0.08, curve: 0 }); out.push({ time: t + 0.005, value: v, curve: 0 }); out.push({ time: t + 0.17, value: 0.08, curve: -0.4 }); } } }
        else if (type === 'invertedChop') { out.push({ time: start, value: 0.88, curve: 0 }); for (let i = 0; i < 16; i++) { if (Math.random() > 0.4) { const t = start + i * 0.25; out.push({ time: t, value: 0.88, curve: 0 }); out.push({ time: t + 0.005, value: 0.08, curve: 0 }); out.push({ time: t + 0.17, value: 0.88, curve: 0.4 }); } } out.push({ time: start + len - 0.01, value: 0.88, curve: 0.2 }); }
        else if (type === 'tripletFlurry') { for (let i = 0; i < 12; i++) { const t = start + i * (4 / 12), v = 0.5 + Math.random() * 0.5; out.push({ time: t, value: 0.1, curve: 0 }); out.push({ time: t + 0.005, value: v, curve: 0 }); out.push({ time: t + (4 / 12) * 0.7, value: 0.1, curve: -0.3 }); } }
        else if (type === 'suddenGap') { out.push({ time: start, value: 0, curve: 0 }); out.push({ time: start + 0.04, value: 0.95, curve: 0 }); out.push({ time: start + 0.4, value: 0, curve: -0.4 }); out.push({ time: start + 0.8, value: 0.8, curve: 0 }); out.push({ time: start + 1.1, value: 0, curve: -0.4 }); out.push({ time: start + 3.5, value: 0, curve: 0 }); out.push({ time: start + 3.55, value: 1.0, curve: 0 }); out.push({ time: start + 3.95, value: 0.2, curve: -0.5 }); }
        else if (type === 'glitchStorm') { for (let i = 0; i < 32; i++) { if (Math.random() > 0.35) { const t = start + i * 0.125, v = Math.random() > 0.3 ? (0.55 + Math.random() * 0.45) : 0.25; out.push({ time: t, value: 0.04, curve: 0 }); out.push({ time: t + 0.002, value: v, curve: 0 }); out.push({ time: t + 0.07, value: 0.04, curve: -0.3 }); } } }
        else if (type === 'dropEcho') { out.push({ time: start, value: 0, curve: 0 }); out.push({ time: start + 0.04, value: 1.0, curve: 0 }); out.push({ time: start + 0.4, value: 0.35, curve: -0.55 }); out.push({ time: start + 0.9, value: 0.75, curve: 0.45 }); out.push({ time: start + 1.4, value: 0.18, curve: -0.5 }); out.push({ time: start + 1.9, value: 0.5, curve: 0.4 }); out.push({ time: start + 2.4, value: 0.1, curve: -0.5 }); out.push({ time: start + 2.9, value: 0.3, curve: 0.4 }); out.push({ time: start + 3.4, value: 0.05, curve: -0.5 }); out.push({ time: start + len - 0.01, value: 0.02, curve: -0.4 }); }
        else if (type === 'reverseRamp') { const peaks = [0.95, 0.75, 0.5, 0.2, 0.45, 0.7, 0.95], step = len / peaks.length; for (let i = 0; i < peaks.length; i++) { const t = start + i * step; out.push({ time: t, value: 0.08, curve: 0 }); out.push({ time: t + 0.005, value: peaks[i], curve: 0 }); out.push({ time: t + step * 0.7, value: 0.08, curve: -0.4 }); } }
        else if (type === 'offGridStutter') { const positions = [], numHits = 8 + Math.floor(Math.random() * 5); for (let i = 0; i < numHits; i++) positions.push(Math.random() * (len - 0.2)); positions.sort((a, b) => a - b); let lastT = -1; for (const p of positions) { const t = start + p; if (t - lastT < 0.12) continue; const v = 0.5 + Math.random() * 0.5; out.push({ time: t, value: 0.05, curve: 0 }); out.push({ time: t + 0.005, value: v, curve: 0 }); out.push({ time: t + 0.1, value: 0.05, curve: -0.4 }); lastT = t; } }
        else if (type === 'octaveSlam') { for (let i = 0; i < 16; i++) { const t = start + i * 0.25, v = i % 2 === 0 ? 1.0 : 0.04; out.push({ time: t, value: v, curve: 0 }); out.push({ time: t + 0.23, value: v, curve: 0 }); } }
    }

    function _sdNeuroV1(sB, eB) {   // Smooth — base shapes + random bezier per chunk
        const out = [], pool = ['ramp','hold','sawDrop','chop','build','stutter','gate','syncDrop'];
        let t = sB;
        while (t < eB - 0.001) { let chunk = [0.5, 1, 1.5, 2, 4][Math.floor(Math.random() * 5)]; if (t + chunk > eB) chunk = eB - t; _sdNeuroInject(out, pool[Math.floor(Math.random() * pool.length)], t, chunk, (Math.random() * 1.4) - 0.7); t = Math.round((t + chunk) * 10000) / 10000; }
        return out;
    }
    function _sdNeuroV2(sB, eB) {   // Storm — chained contrasting segments + release
        const out = [], bars = Math.max(1, Math.round((eB - sB) / 4));
        const types = ['denseChop','invertedChop','tripletFlurry','suddenGap','glitchStorm','dropEcho','reverseRamp','offGridStutter','octaveSlam'];
        const n = bars - 1; let last = null;
        for (let bar = 0; bar < n; bar++) { let c; do { c = types[Math.floor(Math.random() * types.length)]; } while (c === last && types.length > 1); _sdNeuroEmitSegment(out, c, sB + bar * 4, 4); last = c; }
        const rs = sB + n * 4;
        out.push({ time: rs, value: 0.05, curve: 0 }); out.push({ time: rs + 0.04, value: 1.0, curve: 0 }); out.push({ time: rs + 0.6, value: 0.35, curve: -0.55 }); out.push({ time: rs + 1.4, value: 0.75, curve: 0.45 }); out.push({ time: rs + 2.2, value: 0.2, curve: -0.5 }); out.push({ time: rs + 3.0, value: 0.45, curve: 0.35 }); out.push({ time: eB, value: 0, curve: -0.7 });
        out.sort((a, b) => a.time - b.time); return out;
    }
    function _sdNeuroV3(sB, eB) {   // Poly — 3-against-4 with bar anchors
        const out = [], bars = Math.max(1, Math.round((eB - sB) / 4)), HI = 0.62, LO = 0.32, AN = 0.10;
        for (let bar = 0; bar < bars; bar++) { const start = sB + bar * 4; out.push({ time: start, value: AN, curve: 0 }); const hits = []; for (let i = 0; i < 3; i++) hits.push({ t: i * (4 / 3), level: 'high' }); for (let i = 0; i < 4; i++) hits.push({ t: 0.5 + i, level: 'low' }); hits.sort((a, b) => a.t - b.t); for (const h of hits) { const t = start + h.t, target = h.level === 'high' ? HI + Math.random() * 0.25 : LO + Math.random() * 0.12; out.push({ time: Math.max(start + 0.001, t - 0.05), value: AN, curve: 0.4 }); out.push({ time: t, value: target, curve: 0 }); out.push({ time: t + 0.16, value: AN + 0.04, curve: -0.5 }); } out.push({ time: start + 3.92, value: AN, curve: 0.25 }); }
        out.push({ time: eB, value: AN, curve: 0 }); out.sort((a, b) => a.time - b.time); return out;
    }
    // Versatile smooth "response" bar for Call & Response — a DIFFERENT musical swell every time
    // (shape, peak height, peak position, ease amount + base value all vary), always bezier-eased
    // (never choppy) and returning home at the bar end so the phrase stays loopable.
    function _sdNeuroResponseBar(out, start, len) {
        const pk = 0.6 + Math.random() * 0.4;              // peak height 0.6..1.0
        const lo = 0.04 + Math.random() * 0.12;            // rest / base
        const j  = () => (Math.random() - 0.5) * 0.35;     // small timing jitter
        const cU = () => 0.25 + Math.random() * 0.5;       // ease up
        const cD = () => -(0.25 + Math.random() * 0.5);    // ease down
        const clamp = (t) => Math.max(start + 0.03, Math.min(start + len - 0.03, t));
        out.push({ time: start, value: lo, curve: 0 });
        switch (Math.floor(Math.random() * 5)) {
            case 0:   // single swell — peak wanders across the bar
                out.push({ time: clamp(start + 1.2 + Math.random() * 1.6), value: pk, curve: cU() });
                out.push({ time: clamp(start + len - 0.4 + j()), value: lo + (pk - lo) * (0.15 + Math.random() * 0.3), curve: cD() });
                break;
            case 1:   // double hump
                out.push({ time: clamp(start + 0.9 + j()), value: pk * (0.6 + Math.random() * 0.35), curve: cU() });
                out.push({ time: clamp(start + 2.0 + j()), value: lo + 0.04, curve: cD() });
                out.push({ time: clamp(start + 3.0 + j()), value: pk * (0.7 + Math.random() * 0.3), curve: cU() });
                break;
            case 2:   // rising build
                out.push({ time: clamp(start + 1.5 + j()), value: lo + (pk - lo) * 0.4, curve: cU() });
                out.push({ time: clamp(start + 3.2 + j()), value: pk, curve: cU() });
                break;
            case 3:   // early peak, long decay
                out.push({ time: clamp(start + 0.35), value: pk, curve: cU() });
                out.push({ time: clamp(start + 2.6 + j()), value: lo + (pk - lo) * 0.35, curve: cD() });
                break;
            default: { // valley / dip (inverse hill)
                const mid = lo + (pk - lo) * (0.5 + Math.random() * 0.3);
                out[out.length - 1].value = mid;           // start from mid, not the floor
                out.push({ time: clamp(start + 1.6 + j()), value: lo, curve: cD() });
                out.push({ time: clamp(start + 3.2 + j()), value: mid, curve: cU() });
            }
        }
        out.push({ time: start + len, value: lo, curve: 0.2 });   // home at the bar line
    }
    function _sdNeuroV4(sB, eB) {   // Call & Response — aggressive chop / versatile smooth response
        const out = [], bars = Math.max(1, Math.round((eB - sB) / 4)), pool = ['chop','stutter','syncDrop'];
        for (let bar = 0; bar < bars; bar++) {
            const start = sB + bar * 4;
            if (bar % 2 === 0) _sdNeuroInject(out, pool[Math.floor(Math.random() * pool.length)], start, 4, 0);   // aggressive (unchanged)
            else               _sdNeuroResponseBar(out, start, 4);                                                // versatile smooth swell
        }
        return out;
    }
    function _sdNeuroV5(sB, eB) {   // Acid — 16th grid, 4-tone scale, bezier slides
        const out = [], range = eB - sB, tones = [0.25, 0.45, 0.65, 0.85], stepBeats = sdMotionStep(0.25), totalSteps = Math.floor(range / stepBeats), events = [];
        for (let s = 0; s < totalSteps; s++) { const isDown = s % 4 === 0, prob = isDown ? 0.96 : 0.55; if (Math.random() < prob) events.push({ step: s, tone: tones[Math.floor(Math.random() * tones.length)], slidesToNext: false }); }
        for (let i = 0; i < events.length - 1; i++) if (events[i + 1].step - events[i].step === 1 && Math.random() < 0.35) events[i].slidesToNext = true;
        let inSlide = false;
        for (let i = 0; i < events.length; i++) { const e = events[i], t = sB + e.step * stepBeats; if (!inSlide) { out.push({ time: Math.max(sB, t - 0.001), value: 0, curve: 0 }); out.push({ time: t, value: e.tone, curve: 0 }); } else { out.push({ time: t, value: e.tone, curve: 0.7 }); } if (e.slidesToNext) { out.push({ time: sB + events[i + 1].step * stepBeats - 0.001, value: e.tone, curve: 0 }); inSlide = true; } else { out.push({ time: t + stepBeats * 0.7, value: e.tone, curve: 0 }); out.push({ time: t + stepBeats * 0.88, value: 0, curve: -0.5 }); inSlide = false; } }
        out.push({ time: eB, value: 0, curve: 0 }); out.sort((a, b) => a.time - b.time); return out;
    }
    function _sdNeuroV6(sB, eB) {   // Anchor & Excursion — phrased bars, always return home
        const out = [], bars = Math.max(1, Math.round((eB - sB) / 4)), HOME = 0.5;
        const pool = ['peakUp','valleyDown','doublePeak','stutterBurst','stutterBurst','sineSwell','octaveJump','octaveJump','glitchSpray','glitchSpray','glitchSpray','asymStab','asymStab','chopGate','chopGate'];
        for (let bar = 0; bar < bars; bar++) {
            const start = sB + bar * 4; out.push({ time: start, value: HOME, curve: 0 }); const ex = pool[Math.floor(Math.random() * pool.length)];
            if (ex === 'peakUp') { out.push({ time: start + 1, value: 0.93, curve: 0.45 }); out.push({ time: start + 2.5, value: 0.7, curve: 0.2 }); out.push({ time: start + 3.5, value: HOME, curve: 0.35 }); }
            else if (ex === 'valleyDown') { out.push({ time: start + 1, value: 0.07, curve: -0.45 }); out.push({ time: start + 2.5, value: 0.28, curve: -0.2 }); out.push({ time: start + 3.5, value: HOME, curve: -0.35 }); }
            else if (ex === 'doublePeak') { out.push({ time: start + 0.5, value: 0.88, curve: 0.5 }); out.push({ time: start + 1.5, value: HOME, curve: -0.4 }); out.push({ time: start + 2.5, value: 0.95, curve: 0.5 }); out.push({ time: start + 3.5, value: HOME, curve: -0.4 }); }
            else if (ex === 'stutterBurst') { for (let i = 0; i < 6; i++) { const t = start + 0.4 + i * 0.45, v = i % 2 === 0 ? 0.85 + Math.random() * 0.1 : 0.18; out.push({ time: t, value: v, curve: 0 }); } out.push({ time: start + 3.7, value: HOME, curve: 0.3 }); }
            else if (ex === 'sineSwell') { for (let i = 1; i < 8; i++) { const t = start + i * 0.5, v = HOME + Math.sin((i / 8) * Math.PI * 2) * 0.38; out.push({ time: t, value: v, curve: 0.55 }); } }
            else if (ex === 'octaveJump') { out.push({ time: start + 0.8, value: 0.04, curve: -0.65 }); out.push({ time: start + 1.5, value: 0.98, curve: 0.65 }); out.push({ time: start + 2.3, value: 0.04, curve: -0.65 }); out.push({ time: start + 3.0, value: 0.94, curve: 0.65 }); out.push({ time: start + 3.7, value: HOME, curve: -0.3 }); }
            else if (ex === 'glitchSpray') { const numHits = 8 + Math.floor(Math.random() * 7), hitTimes = []; for (let i = 0; i < numHits; i++) hitTimes.push(0.3 + Math.random() * 3.2); hitTimes.sort((a, b) => a - b); let lastT = -1; for (const ht of hitTimes) { const t = start + ht; if (t - lastT < 0.1) continue; const v = Math.random() > 0.4 ? (0.75 + Math.random() * 0.25) : 0.1; out.push({ time: t - 0.015, value: HOME, curve: 0 }); out.push({ time: t, value: v, curve: 0 }); out.push({ time: t + 0.05, value: HOME, curve: -0.4 }); lastT = t + 0.05; } }
            else if (ex === 'asymStab') { out.push({ time: start + 0.6, value: HOME, curve: 0 }); out.push({ time: start + 0.62, value: 1.0, curve: 0 }); out.push({ time: start + 3.7, value: HOME, curve: -0.75 }); }
            else if (ex === 'chopGate') { for (let i = 0; i < 8; i++) { const t = start + i * 0.5, v = i % 2 === 0 ? 0.92 : 0.08; out.push({ time: t, value: v, curve: 0 }); out.push({ time: t + 0.47, value: v, curve: 0 }); } }
            if (Math.random() < 0.35) { const numG = 1 + Math.floor(Math.random() * 3); for (let g = 0; g < numG; g++) { const gt = start + 0.4 + Math.random() * 3.2, up = Math.random() > 0.5, gv = up ? (0.92 + Math.random() * 0.08) : (0.02 + Math.random() * 0.1); out.push({ time: gt - 0.015, value: HOME, curve: 0 }); out.push({ time: gt, value: gv, curve: 0 }); out.push({ time: gt + 0.03, value: HOME, curve: 0 }); } }
            const endT = (bar < bars - 1) ? (start + 4) : eB; out.push({ time: endT, value: HOME, curve: 0.25 });
        }
        out.sort((a, b) => a.time - b.time); return out;
    }

    function _sdGenNeuroVariant(variant, sB, eB) {
        switch (variant) {
            case 'smooth': return _sdNeuroV1(sB, eB);
            case 'storm':  return _sdNeuroV2(sB, eB);
            case 'poly':   return _sdNeuroV3(sB, eB);
            case 'call':   return _sdNeuroV4(sB, eB);
            case 'acid':   return _sdNeuroV5(sB, eB);
            case 'anchor': return _sdNeuroV6(sB, eB);
            default:       return [];
        }
    }
    // Apply a neuro variant to the SELECTED/active lane(s) — mirrors sdApplyTemplate
    // (selection-aware, per-param) so it slots into the SHAPES/SEL row.
    window.sdApplyNeuroVariant = function(variant) {
        if (!sdActiveParamId) return;
        pushUndo();
        const sel = sdGetSelection(); const allBeats = sdGetBars() * 4;
        const sB = sel ? sel.startBeat : 0; const eB = sel ? sel.endBeat : allBeats;
        sdGetTargetParams().forEach(param => {
            if (sel) param.points = param.points.filter(pt => pt.time < sB || pt.time > eB); else param.points = [];
            param.points = param.points.concat(_sdGenNeuroVariant(variant, sB, eB)).sort((a, b) => a.time - b.time);
        });
        sdResetSliderSnapshots(); sdRenderSidebar(); sdDrawCanvasGrid();
    };

    // ─── MUTATE ──────────────────────────────────────────────
    // Takes existing curves and produces dramatic variations:
    // cuts segments, relocates them, flips sections, scales amplitude

    // Shared helper: pops a warning modal when Bloom / Prism / Mutate is
    // invoked before the user has drawn any curves to transform.
    window.sdShowRequirement = function(title, msg) {
        const titleEl = document.getElementById('sd-req-title');
        const msgEl = document.getElementById('sd-req-msg');
        if (titleEl) titleEl.textContent = title;
        if (msgEl) msgEl.textContent = msg;
        const modal = document.getElementById('sd-requirement-modal');
        if (modal) modal.classList.remove('hidden');
    };

    window.sdMutate = function(targetsOverride) {
        // targetsOverride: StrideQuick passes the all-unlocked-lanes set so
        // "Mutate" affects every lane (select-all + mutate). Omitted = the
        // on-screen button's original active/selected-lane behavior.
        const base = targetsOverride || sdGetTargetParams();
        const targets = base.filter(p => p.points.length >= 2);
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
        _sdLandKick(targets);   // landing animation (mockup B): the comet draws the new curves on
        document.getElementById('sd-canvas-status').textContent = 'Mutated';
    };

    // ─── TOOL MODE STATE ──────────────────────────────────────
    // Generative tools (Bloom, Prism) operate in two states:
    //   - default: GENERATIVE section shows the Chaos / Bloom / Prism grid
    //   - active: section is replaced by the entered tool's panel with a
    //     live-morph slider. Slider drags write to non-active unlocked
    //     lanes in real time. Commit / Cancel buttons exit.
    // Weave is kept in code as a dormant tool (per Prism spec decision #7)
    // — UI button removed, functions retained for potential future re-wiring.
    let _sdActiveTool = null;        // null | 'bloom' | 'weave' | 'prism'
    let _sdToolSnapshot = null;      // captured at entry
    let _sdToolDirty = false;        // has the user touched the slider?

    function _sdSnapshotAll() {
        return sdCanvasParams.map(p => ({
            envelopeId: p.envelopeId,
            points: p.points.map(pt => ({ time: pt.time, value: pt.value, curve: pt.curve || 0 })),
        }));
    }

    function _sdEnterToolGuard(toolLabel, drawHint) {
        if (!sdActiveParamId) {
            sdShowRequirement('Select a lane first', toolLabel + ' needs an active lane to read from. Click one of the lanes in the canvas, draw a curve on it, then press ' + toolLabel + '.');
            return false;
        }
        const masterParam = sdCanvasParams.find(p => p.envelopeId === sdActiveParamId);
        if (!masterParam || !masterParam.points.length) {
            sdShowRequirement('Draw a curve first', drawHint);
            return false;
        }
        if (sdCanvasParams.length < 2) {
            sdShowRequirement('Need more lanes', toolLabel + ' spreads a curve across multiple lanes. Your rack only has one mapped parameter.');
            return false;
        }
        return true;
    }

    function _sdRenderGenerativeDefault() {
        const sec = document.getElementById('sd-generative-section');
        if (!sec) return;
        // Motion — the 6 all-lanes tools; the SECOND CTA after "Inject to Clip".
        // One unified accent treatment (skin orange) so they read as a single
        // important group (not a rainbow), each kept distinct by its own icon.
        // 1×6 vertical stack — every tool gets its own full-width row.
        const btn = (onclick, id, name, title, icon) =>
            '<button onclick="' + onclick + '"' + (id ? ' id="' + id + '"' : '')
            + ' title="' + title + '" class="flex items-center justify-center gap-1 text-[9px] text-zinc-950 bg-orange-400 hover:bg-orange-300 border border-black/10 shadow-sm px-2 py-2 rounded uppercase tracking-wider font-black transition-colors">'
            + '<svg class="w-3 h-3 shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="' + icon + '"/></svg>'
            + '<span>' + name + '</span></button>';
        sec.innerHTML = '<div class="text-[8px] font-black text-zinc-500 uppercase tracking-[0.2em] mb-1.5 px-1">Motion</div>'
            + '<div class="grid grid-cols-2 gap-1.5">'
            + btn('sdApplyGlobalNeuro()', '', 'Neuro', 'Neuro: gnarly random-pool modulation across every unlocked lane', 'M13 10V3L4 14h7v7l9-11h-7z')
            + btn('sdApplyGlobalChaos()', '', 'Chaos', 'Chaos: apply the Chaos (chaos_lfo) template to every unlocked lane in one click', 'M3 12 Q6 6 9 12 T15 12 T21 12')
            + btn('sdToggleBloom()', 'sd-bloom-btn', 'Bloom', 'Bloom: complementary curves from the active lane', 'M12 3v1m0 16v1m-8-9H3m18 0h-1m-2.636-5.364l-.707.707M6.343 17.657l-.707.707m0-12.728l.707.707m11.314 11.314l.707.707')
            + btn('sdTogglePrism()', 'sd-prism-btn', 'Prism', 'Prism: draw on one lane, every other lane responds live with the same anchors and a different path', 'M12 3 L21 21 L3 21 Z')
            + '<div class="flex gap-0.5">'
            + btn('sdApplyGlobalSampleHold()', '', 'S&amp;H', 'Sample &amp; Hold: stepped random on every unlocked lane. Poly = per-bar rates, each lane unique (polyrhythmic); grid = every step on the ▾ division. Click again to reroll.', 'M3 16 H7 V11 H11 V15 H15 V8 H19 V13').replace('class="flex items-center justify-center gap-1', 'class="flex-1 flex items-center justify-center gap-1')
            + '<button onclick="window.sdOpenShModePopup(event)" title="S&amp;H mode — Poly (classic) or a fixed grid: 1/8, 1/8T, 1/16, 1/16T, 1/32, 1/32T" class="sd-sh-mode-btn shrink-0 flex items-center text-[8px] text-zinc-400 hover:text-zinc-100 bg-zinc-800 hover:bg-zinc-700 border border-black/10 shadow-sm px-1 rounded font-bold transition-colors">▾</button>'
            + '</div>'
            + btn('sdApplyGlobalReflector()', '', 'Reflector', 'Reflector: pairs every unlocked lane into base + mirror — half Neuro, half Chaos, each followed by its value-mirrored twin so the rack folds in on itself', 'M5 8 L11 12 L5 16 M19 8 L13 12 L19 16')
            + '</div>';
        // Re-apply the Bloom/Prism dimming — re-rendering these buttons drops
        // the opacity-40 class, so without this Prism looks enabled even with
        // no lanes loaded.
        sdUpdateToolAvailability();
        _sdShPaintModeBtns();   // the card's ▾ was just re-rendered — repaint its timing label
    }

    function _sdRenderBloomPanel() {
        const sec = document.getElementById('sd-generative-section');
        if (!sec) return;
        sec.innerHTML = ''
            + '<div class="flex items-center justify-between mb-2 px-1">'
            + '<button onclick="sdCancelTool()" title="Cancel and revert" class="text-[9px] text-zinc-500 hover:text-zinc-200 transition-colors flex items-center gap-0.5">'
            + '<svg class="w-3 h-3" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" d="M15 19l-7-7 7-7"/></svg>Back</button>'
            + '<span class="text-[9px] font-black text-amber-400 uppercase tracking-[0.2em]">Bloom</span>'
            + '<span class="text-[8px] text-amber-400/70 uppercase tracking-widest font-bold">Live</span>'
            + '</div>'
            + '<div class="text-[8px] text-zinc-600 leading-relaxed px-1 mb-1">Active lane is the source — other unlocked lanes morph from it.</div>'
            + '<div class="px-1 flex flex-col gap-2">'
            + '<div class="flex items-center gap-2">'
            + '<span class="text-[9px] font-bold text-zinc-500 uppercase w-12 shrink-0">Morph</span>'
            + '<input type="range" id="sd-bloom-spread" min="0" max="100" value="50" class="flex-1 h-1 accent-amber-500 cursor-pointer" oninput="_sdToolMorph(this.value)">'
            + '<span id="sd-bloom-val" class="text-[9px] text-amber-400 font-mono w-9 text-right">50%</span>'
            + '</div>'
            + '<div class="flex gap-1.5 mt-1">'
            + '<button onclick="sdCommitTool()" class="flex-1 text-[9px] text-black bg-amber-500 hover:bg-amber-400 py-1.5 rounded uppercase tracking-wider font-bold transition-colors">Commit</button>'
            + '<button onclick="sdCancelTool()" class="flex-1 text-[9px] text-zinc-400 bg-white/5 hover:bg-white/10 border border-white/10 py-1.5 rounded uppercase tracking-wider font-bold transition-colors">Cancel</button>'
            + '</div>'
            + '</div>';
    }

    function _sdRenderWeavePanel() {
        const sec = document.getElementById('sd-generative-section');
        if (!sec) return;
        const isChase = _weaveMode === 'chase';
        const chaseClass = isChase ? 'text-cyan-400 bg-cyan-500/20 border-cyan-500/40' : 'text-zinc-500 bg-transparent border-white/10 hover:border-white/20';
        const fillClass  = !isChase ? 'text-cyan-400 bg-cyan-500/20 border-cyan-500/40' : 'text-zinc-500 bg-transparent border-white/10 hover:border-white/20';
        const desc = isChase ? 'Same shape, phase-shifted — peaks never overlap' : 'Counterpoint — lanes move where the source is still';
        sec.innerHTML = ''
            + '<div class="flex items-center justify-between mb-2 px-1">'
            + '<button onclick="sdCancelTool()" title="Cancel and revert" class="text-[9px] text-zinc-500 hover:text-zinc-200 transition-colors flex items-center gap-0.5">'
            + '<svg class="w-3 h-3" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" d="M15 19l-7-7 7-7"/></svg>Back</button>'
            + '<span class="text-[9px] font-black text-cyan-400 uppercase tracking-[0.2em]">Weave</span>'
            + '<span class="text-[8px] text-cyan-400/70 uppercase tracking-widest font-bold">Live</span>'
            + '</div>'
            + '<div class="text-[8px] text-zinc-600 leading-relaxed px-1 mb-1">Active lane is the source — other unlocked lanes weave around it.</div>'
            + '<div class="px-1 flex flex-col gap-2">'
            + '<div class="flex gap-1.5">'
            + '<button id="sd-weave-mode-chase" onclick="sdSetWeaveMode(\'chase\')" class="flex-1 text-[8px] ' + chaseClass + ' border py-1 rounded uppercase tracking-widest font-bold">Chase</button>'
            + '<button id="sd-weave-mode-fill" onclick="sdSetWeaveMode(\'fill\')" class="flex-1 text-[8px] ' + fillClass + ' border py-1 rounded uppercase tracking-widest font-bold">Fill</button>'
            + '</div>'
            + '<div id="sd-weave-desc" class="text-[8px] text-zinc-600 leading-relaxed px-0.5">' + desc + '</div>'
            + '<div class="flex items-center gap-2">'
            + '<span class="text-[9px] font-bold text-zinc-500 uppercase w-12 shrink-0">Spread</span>'
            + '<input type="range" id="sd-weave-spread" min="0" max="100" value="50" class="flex-1 h-1 accent-cyan-500 cursor-pointer" oninput="_sdToolMorph(this.value)">'
            + '<span id="sd-weave-val" class="text-[9px] text-cyan-400 font-mono w-9 text-right">50%</span>'
            + '</div>'
            + '<div class="flex gap-1.5 mt-1">'
            + '<button onclick="sdCommitTool()" class="flex-1 text-[9px] text-black bg-cyan-500 hover:bg-cyan-400 py-1.5 rounded uppercase tracking-wider font-bold transition-colors">Commit</button>'
            + '<button onclick="sdCancelTool()" class="flex-1 text-[9px] text-zinc-400 bg-white/5 hover:bg-white/10 border border-white/10 py-1.5 rounded uppercase tracking-wider font-bold transition-colors">Cancel</button>'
            + '</div>'
            + '</div>';
    }

    function _sdRestoreRecipientsFromSnapshot() {
        if (!_sdToolSnapshot) return;
        _sdToolSnapshot.forEach(sp => {
            if (sp.envelopeId === sdActiveParamId) return;
            const param = sdCanvasParams.find(p => p.envelopeId === sp.envelopeId);
            if (param && !param.locked) {
                param.points = sp.points.map(pt => ({ ...pt }));
            }
        });
    }

    window._sdToolMorph = function(val) {
        _sdToolDirty = true;
        if (_sdActiveTool === 'bloom') {
            const valEl = document.getElementById('sd-bloom-val');
            if (valEl) valEl.textContent = val + '%';
            _sdRestoreRecipientsFromSnapshot();
            _sdBloomCompute();
        } else if (_sdActiveTool === 'weave') {
            const valEl = document.getElementById('sd-weave-val');
            if (valEl) valEl.textContent = val + '%';
            _sdRestoreRecipientsFromSnapshot();
            _sdWeaveCompute();
        } else if (_sdActiveTool === 'prism') {
            const valEl = document.getElementById('sd-prism-val');
            if (valEl) valEl.textContent = val + '%';
            _sdRestoreRecipientsFromSnapshot();
            _sdPrismCompute();
        }
        sdRenderSidebar();
        sdDrawCanvasGrid();
    };

    window.sdCommitTool = function() {
        if (!_sdActiveTool) return;
        if (_sdToolDirty && _sdToolSnapshot) {
            undoStack.push(_sdToolSnapshot);
            if (undoStack.length > MAX_UNDO) undoStack.shift();
            redoStack = [];
        }
        _sdActiveTool = null;
        _sdToolSnapshot = null;
        _sdToolDirty = false;
        _sdPrismPerLane = null;
        _sdPrismRngSeed = null;
        _sdRenderGenerativeDefault();
        sdRenderSidebar();
        sdDrawCanvasGrid();
    };

    window.sdCancelTool = function() {
        if (!_sdActiveTool) return;
        if (_sdActiveTool === 'prism') {
            // Per spec: Prism Cancel reverts ONLY the variant lanes —
            // the source lane keeps whatever the user drew during the
            // session (drawing is still a normal canvas action).
            _sdRestoreRecipientsFromSnapshot();
        } else if (_sdToolSnapshot) {
            applySnapshot(_sdToolSnapshot);
        }
        _sdActiveTool = null;
        _sdToolSnapshot = null;
        _sdToolDirty = false;
        _sdPrismPerLane = null;
        _sdPrismRngSeed = null;
        _sdRenderGenerativeDefault();
        sdRenderSidebar();
        sdDrawCanvasGrid();
    };

    document.addEventListener('keydown', e => {
        if (e.key !== 'Escape') return;
        if (!_sdActiveTool) return;
        const tag = (e.target && e.target.tagName) || '';
        if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return;
        window.sdCancelTool();
    });

    // ─── BLOOM ────────────────────────────────────────────────
    // Pure math, no pushUndo. Reads the inline slider sd-bloom-spread
    // and the master from sdActiveParamId; writes to every non-active,
    // non-locked lane.
    function _sdBloomCompute() {
        const slider = document.getElementById('sd-bloom-spread');
        const masterParam = sdCanvasParams.find(p => p.envelopeId === sdActiveParamId);
        if (!slider || !masterParam || !masterParam.points.length) return;
        const spread = parseInt(slider.value) / 100;
        const totalBeats = sdGetBars() * 4;

        // Selection-scoped behavior — same shape as the Prism fix. If the
        // user selected a region, Bloom only touches that region on variant
        // lanes: master points are filtered to the selection, time is
        // renormalized to selection-local 0-1 so internal transforms (phase
        // shift, mirror) wrap within the selection rather than the whole
        // timeline, and variant-lane points outside the selection are
        // preserved (the live-tick restore puts them back, we keep them
        // alongside the new variant). No selection → original behavior.
        const sel = sdGetSelection();
        const sB = sel ? sel.startBeat : 0;
        const eB = sel ? sel.endBeat : totalBeats;
        const spanBeats = eB - sB;
        if (sel && spanBeats <= 0) return;
        const masterInSel = sel
            ? masterParam.points.filter(pt => pt.time >= sB && pt.time <= eB)
            : masterParam.points;
        if (!masterInSel.length) return;
        const masterPts = masterInSel.map(pt => ({
            t: sel ? (pt.time - sB) / spanBeats : pt.time / totalBeats,
            v: pt.value,
            curve: pt.curve || 0,
        }));
        const transforms = [
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
        let laneIdx = 0;
        // Diagnostic — set to true and reload to log per-lane bloom math
        // to DevTools (Ctrl+Shift+I → Console). Useful when a lane
        // appears unresponsive: paste the log to identify the transform
        // that lane is getting and whether its math produces visible
        // change at the current Morph value.
        const DEBUG_BLOOM = false;
        sdCanvasParams.forEach(param => {
            if (param.envelopeId === sdActiveParamId) {
                if (DEBUG_BLOOM) console.log('[Bloom] SKIP master:', param.name);
                return;
            }
            if (param.locked) {
                if (DEBUG_BLOOM) console.log('[Bloom] SKIP locked:', param.name);
                return;
            }
            const tx = transforms[laneIdx % transforms.length];
            if (DEBUG_BLOOM) console.log('[Bloom] lane', laneIdx, param.name, 'tx#' + (laneIdx % transforms.length), tx, 'spread=' + spread);
            laneIdx++;
            let pts = masterPts.map(p => ({ t: p.t, v: p.v, curve: p.curve }));
            const phaseAmt = tx.phase * spread;
            if (phaseAmt > 0) {
                pts = pts.map(p => ({ t: (p.t + phaseAmt) % 1.0, v: p.v, curve: p.curve }));
                pts.sort((a, b) => a.t - b.t);
            }
            if (tx.mirror && spread > 0.2) {
                pts = pts.map(p => ({ t: 1.0 - p.t, v: p.v, curve: p.curve ? -p.curve : 0 }));
                pts.sort((a, b) => a.t - b.t);
            }
            if (tx.invert) {
                pts = pts.map(p => ({
                    t: p.t,
                    v: p.v + (1.0 - 2 * p.v) * spread,
                    curve: p.curve ? p.curve * (1 - 2 * spread) : 0,
                }));
            }
            const scale = 1.0 + (tx.ampScale - 1.0) * spread;
            const offset = tx.ampOff * spread;
            pts = pts.map(p => ({
                t: p.t,
                v: Math.max(0, Math.min(1, (p.v - 0.5) * scale + 0.5 + offset)),
                curve: p.curve,
            }));
            // Convert normalized t back to beat time. When scoped, t=0 maps
            // to selection start and t=1 maps to selection end, so all
            // output lands inside the selection by construction.
            const newPoints = pts.map(p => ({
                time: Math.round((sel ? (sB + p.t * spanBeats) : p.t * totalBeats) * 10000) / 10000,
                value: Math.max(0, Math.min(1, p.v)),
                curve: p.curve || 0,
            }));
            if (sel) {
                // Keep pre-Bloom points outside selection (restore-from-
                // snapshot already put them back this tick), drop anything
                // strictly inside, concat the new variant, sort by time.
                const outside = param.points.filter(pt => pt.time < sB || pt.time > eB);
                param.points = outside.concat(newPoints).sort((a, b) => a.time - b.time);
            } else {
                param.points = newPoints;
            }
        });
    }

    // sdToggleBloom now ENTERS the inline live-morph panel instead of
    // toggling a popover modal. If already in Bloom mode, acts as Cancel.
    window.sdToggleBloom = function() {
        if (_sdActiveTool === 'bloom') { window.sdCancelTool(); return; }
        if (!_sdEnterToolGuard('Bloom', 'Bloom spreads the active lane’s curve across all other lanes with complementary variations. Draw a curve on the active lane, then press Bloom.')) return;
        _sdActiveTool = 'bloom';
        _sdToolSnapshot = _sdSnapshotAll();
        _sdToolDirty = false;
        _sdRenderBloomPanel();
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
        const _bloomSpreadEl = document.getElementById('sd-bloom-spread');   // absent in compact mode
        const spread = (_bloomSpreadEl ? parseInt(_bloomSpreadEl.value) : 50) / 100;   // default 50% spread
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
        sdVisibleParams().forEach(param => {   // when a device is focused, Bloom spreads only across its lanes
            if (param.envelopeId === sdActiveParamId) return; // skip master
            if (param.locked) return; // locked lanes never receive Bloom output

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

        const _bloomPop = document.getElementById('sd-bloom-popover'); if (_bloomPop) _bloomPop.classList.add('hidden');   // absent in compact
        sdResetSliderSnapshots();
        sdRenderSidebar();
        sdDrawCanvasGrid();
        _sdLandKick();   // landing animation (mockup B): the comet draws the new curves on
        const _bloomStatus = document.getElementById('sd-canvas-status');
        if (_bloomStatus) _bloomStatus.textContent = 'Bloom applied — ' + (sdCanvasParams.length - 1) + ' lanes from ' + masterParam.name;
    };

    // ─── WEAVE (DORMANT — superseded by Prism, kept for reference) ─
    // Per Prism spec decision #7: button removed from UI but functions
    // retained in case the chase/fill metaphor is ever revisited. No
    // current callers — sdToggleWeave is unreachable from the UI.
    //
    // Original behavior: complementary automation across lanes.
    // Chase = same shape, phase-shifted so peaks never overlap.
    // Fill = counterpoint — lanes move where the source is still.

    let _weaveMode = 'chase'; // 'chase' or 'fill'

    window.sdToggleWeave = function() {
        if (_sdActiveTool === 'weave') { window.sdCancelTool(); return; }
        if (!_sdEnterToolGuard('Weave', 'Weave creates complementary automation across lanes based on a source curve. Draw a curve on the active lane, then press Weave again.')) return;
        _sdActiveTool = 'weave';
        _sdToolSnapshot = _sdSnapshotAll();
        _sdToolDirty = false;
        _sdRenderWeavePanel();
    };

    window.sdSetWeaveMode = function(mode) {
        _weaveMode = mode;
        // Re-render the panel so the mode buttons reflect the new state,
        // then re-run live morph from the snapshot so the canvas updates.
        if (_sdActiveTool === 'weave') {
            _sdRenderWeavePanel();
            _sdRestoreRecipientsFromSnapshot();
            _sdWeaveCompute();
            _sdToolDirty = true;
            sdRenderSidebar();
            sdDrawCanvasGrid();
        }
    };

    // Pure math, no pushUndo — used by the live-morph slider.
    function _sdWeaveCompute() {
        const slider = document.getElementById('sd-weave-spread');
        const sourceParam = sdCanvasParams.find(p => p.envelopeId === sdActiveParamId);
        if (!slider || !sourceParam || !sourceParam.points.length) return;
        const spread = parseInt(slider.value) / 100;
        const totalBeats = sdGetBars() * 4;
        if (_weaveMode === 'chase') {
            _weaveChase(sourceParam, spread, totalBeats);
        } else {
            _weaveFill(sourceParam, spread, totalBeats);
        }
    }

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

        // Locked lanes never receive Weave output. Source can be locked
        // (read-only seed) — that's the spec: lock = edit protection,
        // not read protection.
        const targets = sdCanvasParams.filter(p => p.envelopeId !== sdActiveParamId && !p.locked);
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

        // Locked lanes never receive Weave fill output.
        const targets = sdCanvasParams.filter(p => p.envelopeId !== sdActiveParamId && !p.locked);
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

    // ─── PRISM ────────────────────────────────────────────────
    // Live-draw multi-lane variant engine. Replaces Weave.
    // Every variant lane shares the source's per-bar peak/valley
    // anchors (musical coherence — peaks land at the same beat
    // across every parameter), but the path BETWEEN anchors mutates
    // per-lane via a "personality" (sonic variety). User draws on
    // source → variants update in real time via rAF-throttled tick.

    const PRISM_PERSONALITIES = [
        'mirror', 'mutate', 'mutateMirror', 'stutter',
        'smooth', 'step',   'drift',        'chase',
    ];
    let _sdPrismRngSeed = null;
    let _sdPrismPerLane = null;
    let _sdPrismRecomputeQueued = false;

    function _sdPrismMakeRng(seed) {
        let a = (seed >>> 0) || 1;
        return function() {
            a = (a + 0x6D2B79F5) >>> 0;
            let t = a;
            t = Math.imul(t ^ (t >>> 15), t | 1);
            t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
            return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
        };
    }

    function _sdPrismHashStr(s) {
        let h = 2166136261;
        for (let i = 0; i < s.length; i++) {
            h ^= s.charCodeAt(i);
            h = Math.imul(h, 16777619);
        }
        return h >>> 0;
    }

    function _sdPrismExtractAnchors(points, totalBeats) {
        if (!points.length) return [];
        const sorted = [...points].sort((a, b) => a.time - b.time);
        const bars = Math.max(1, Math.round(totalBeats / 4));
        const anchors = [];
        for (let b = 0; b < bars; b++) {
            const barStart = b * 4;
            const barEnd = (b + 1) * 4;
            const inBar = sorted.filter(p => p.time >= barStart && p.time < barEnd);
            if (inBar.length === 0) continue;
            if (inBar.length === 1) {
                anchors.push({ time: inBar[0].time, value: inBar[0].value });
                continue;
            }
            let peak = inBar[0], valley = inBar[0];
            for (const p of inBar) {
                if (p.value > peak.value) peak = p;
                if (p.value < valley.value) valley = p;
            }
            if (peak === valley) {
                anchors.push({ time: peak.time, value: peak.value });
            } else if (peak.time < valley.time) {
                anchors.push({ time: peak.time, value: peak.value });
                anchors.push({ time: valley.time, value: valley.value });
            } else {
                anchors.push({ time: valley.time, value: valley.value });
                anchors.push({ time: peak.time, value: peak.value });
            }
        }
        // Bound the path with the actual first/last source points so
        // variants cover the same time range as the source curve.
        const first = sorted[0];
        const last = sorted[sorted.length - 1];
        if (anchors.length === 0 || anchors[0].time > first.time + 0.0001) {
            anchors.unshift({ time: first.time, value: first.value });
        }
        if (anchors[anchors.length - 1].time < last.time - 0.0001) {
            anchors.push({ time: last.time, value: last.value });
        }
        const out = [];
        for (const a of anchors) {
            if (!out.length || a.time > out[out.length - 1].time + 0.0001) out.push(a);
        }
        return out;
    }

    // Personality functions: each takes (anchorA, anchorB, diversity, rng)
    // and returns the MIDPOINTS between A and B (NOT including A or B —
    // the dispatcher emits anchors verbatim). Output values clamp to [0,1].

    function _personalityMirror(a, b, diversity, rng) {
        const midT = (a.time + b.time) / 2;
        const linearV = (a.value + b.value) / 2;
        const flippedV = 1 - linearV;
        const v = linearV + (flippedV - linearV) * diversity;
        return [{ time: midT, value: Math.max(0, Math.min(1, v)), curve: 0 }];
    }

    function _personalityMutate(a, b, diversity, rng) {
        const numChunks = 3 + Math.floor(rng() * 5);
        const dy = b.value - a.value;
        const dx = b.time - a.time;
        const out = [];
        for (let i = 1; i < numChunks; i++) {
            const t = i / numChunks;
            const baseV = a.value + dy * t;
            const wander = (rng() - 0.5) * diversity * 0.6;
            out.push({
                time: a.time + dx * t,
                value: Math.max(0, Math.min(1, baseV + wander)),
                curve: (rng() - 0.5) * diversity * 0.4,
            });
        }
        return out;
    }

    function _personalityMutateMirror(a, b, diversity, rng) {
        return _personalityMutate(a, b, diversity, rng).map(p => ({
            time: p.time,
            value: Math.max(0, Math.min(1, 1 - p.value)),
            curve: -p.curve,
        }));
    }

    function _personalityStutter(a, b, diversity, rng) {
        const numSteps = 4 + Math.floor(rng() * 6);
        const dy = b.value - a.value;
        const dx = b.time - a.time;
        const out = [];
        for (let i = 1; i < numSteps; i++) {
            const t = i / numSteps;
            const baseV = a.value + dy * t;
            const swing = (i % 2 === 0 ? 1 : -1) * diversity * 0.4;
            out.push({
                time: a.time + dx * t,
                value: Math.max(0, Math.min(1, baseV + swing)),
                curve: 0,
            });
        }
        return out;
    }

    function _personalitySmooth(a, b, diversity, rng) {
        const midT = (a.time + b.time) / 2;
        const midV = (a.value + b.value) / 2;
        const sign = rng() < 0.5 ? -1 : 1;
        return [{ time: midT, value: midV, curve: sign * diversity * 0.85 }];
    }

    function _personalityStep(a, b, diversity, rng) {
        const holdT = a.time + (b.time - a.time) * 0.95;
        return [{ time: holdT, value: a.value, curve: 0 }];
    }

    function _personalityDrift(a, b, diversity, rng) {
        const numSteps = 6;
        const dy = b.value - a.value;
        const dx = b.time - a.time;
        const out = [];
        for (let i = 1; i < numSteps; i++) {
            const t = i / numSteps;
            const baseV = a.value + dy * t;
            const wander = (rng() - 0.5) * diversity * 0.3;
            out.push({
                time: a.time + dx * t,
                value: Math.max(0, Math.min(1, baseV + wander)),
                curve: 0,
            });
        }
        return out;
    }

    function _personalityChase(a, b, diversity, rng) {
        const dx = b.time - a.time;
        const offsetFrac = (rng() < 0.5 ? -1 : 1) * 0.25 * diversity;
        const midT = a.time + dx * (0.5 + offsetFrac);
        const midV = (a.value + b.value) / 2;
        const safeT = Math.max(a.time + dx * 0.05, Math.min(b.time - dx * 0.05, midT));
        return [{ time: safeT, value: midV, curve: 0 }];
    }

    const _PRISM_FNS = {
        mirror: _personalityMirror,
        mutate: _personalityMutate,
        mutateMirror: _personalityMutateMirror,
        stutter: _personalityStutter,
        smooth: _personalitySmooth,
        step: _personalityStep,
        drift: _personalityDrift,
        chase: _personalityChase,
    };

    function _sdPrismGenerateVariant(anchors, personality, diversity, rng) {
        if (!anchors.length) return [];
        if (anchors.length === 1) {
            return [{ time: anchors[0].time, value: anchors[0].value, curve: 0 }];
        }
        const fn = _PRISM_FNS[personality] || _personalityMirror;
        const out = [{ time: anchors[0].time, value: anchors[0].value, curve: 0 }];
        for (let i = 0; i < anchors.length - 1; i++) {
            const mids = fn(anchors[i], anchors[i + 1], diversity, rng);
            for (const m of mids) {
                if (m.time > out[out.length - 1].time + 0.0001 && m.time < anchors[i + 1].time - 0.0001) {
                    out.push(m);
                }
            }
            out.push({ time: anchors[i + 1].time, value: anchors[i + 1].value, curve: 0 });
        }
        return out;
    }

    function _sdPrismAssignPersonalities(targets, seed) {
        const rng = _sdPrismMakeRng(seed);
        const order = [...PRISM_PERSONALITIES];
        for (let i = order.length - 1; i > 0; i--) {
            const j = Math.floor(rng() * (i + 1));
            [order[i], order[j]] = [order[j], order[i]];
        }
        const assignment = {};
        targets.forEach((t, i) => {
            assignment[t.envelopeId] = order[i % order.length];
        });
        return assignment;
    }

    function _sdPrismCompute() {
        const slider = document.getElementById('sd-prism-diversity');
        const sourceParam = sdCanvasParams.find(p => p.envelopeId === sdActiveParamId);
        if (!slider || !sourceParam) return;
        const diversity = parseInt(slider.value) / 100;
        const totalBeats = sdGetBars() * 4;

        // Selection-scoped behavior: if the user selected a region, Prism
        // only touches that region on variant lanes. Anchors come from the
        // source's points within the selection (so variants follow whatever
        // is in the selected bars), variant output occupies the selection
        // range only, and each variant lane's points OUTSIDE the selection
        // are preserved (the live-tick restore reset them to pre-Prism
        // state already, so we just keep those alongside the new variant).
        // No selection → full-timeline variant, original behavior.
        const sel = sdGetSelection();
        const sB = sel ? sel.startBeat : 0;
        const eB = sel ? sel.endBeat : totalBeats;
        const sourceForAnchors = sel
            ? sourceParam.points.filter(pt => pt.time >= sB && pt.time <= eB)
            : sourceParam.points;

        const anchors = _sdPrismExtractAnchors(sourceForAnchors, totalBeats);
        const targets = sdCanvasParams.filter(p => p.envelopeId !== sdActiveParamId && !p.locked);
        if (!anchors.length) {
            // Source has nothing to anchor against (in the selection range,
            // if there is one) — leave variants alone. Live-draw may enter
            // with empty source; we don't want that to wipe variants either.
            return;
        }
        targets.forEach(param => {
            const personality = (_sdPrismPerLane && _sdPrismPerLane[param.envelopeId]) || 'mirror';
            const laneSeed = ((_sdPrismRngSeed || 1) ^ _sdPrismHashStr(param.envelopeId)) >>> 0;
            const rng = _sdPrismMakeRng(laneSeed);
            const variant = _sdPrismGenerateVariant(anchors, personality, diversity, rng);
            const newPoints = variant.map(p => ({
                time: Math.round(p.time * 10000) / 10000,
                value: Math.max(0, Math.min(1, p.value)),
                curve: p.curve || 0,
            }));
            if (sel) {
                // Keep pre-Prism points outside selection (restore-from-
                // snapshot already put them back this tick), drop anything
                // strictly inside, concat the new variant, sort by time.
                const outside = param.points.filter(pt => pt.time < sB || pt.time > eB);
                param.points = outside.concat(newPoints).sort((a, b) => a.time - b.time);
            } else {
                param.points = newPoints;
            }
        });
    }

    // StrideQuick one-shot Prism: spread lane[0]'s curve across every other
    // unlocked lane in a single click (no live-draw tool, no mode switch).
    // Per spec the SOURCE is fixed to the first parameter in the canvas.
    // Reuses the exact live-Prism math (_sdPrismExtractAnchors /
    // _sdPrismAssignPersonalities / _sdPrismGenerateVariant) but with LOCAL
    // seed + personalities, so it never disturbs an in-progress live Prism
    // session (_sdPrismRngSeed / _sdPrismPerLane / _sdActiveTool untouched).
    window.sdApplyGlobalPrism = function() {
        const status = document.getElementById('sd-canvas-status');
        const setStatus = (t) => { if (status) status.textContent = t; };
        if (sdCanvasParams.length < 2) {
            setStatus(sdCanvasParams.length ? 'Prism needs at least 2 lanes' : 'No lanes loaded');
            return;
        }
        // Source: same as the canvas tool — the SELECTED lane drives the rest —
        // when the active lane has a moving curve. Quick mode has no live
        // selection step, so if the active lane is bare we auto-pick the lane
        // with the most movement. Any lane works (1, 2, 5...); we just need a
        // REAL moving curve so the spread isn't a flat/single-point wipe (the
        // "80% of the canvas got deleted" bug, from a bare mapping-point source).
        const _laneRange = (p) => {
            if (!p.points || p.points.length < 2) return 0;
            let lo = p.points[0].value, hi = p.points[0].value;
            for (let i = 1; i < p.points.length; i++) { const v = p.points[i].value; if (v < lo) lo = v; if (v > hi) hi = v; }
            return hi - lo;
        };
        let source = sdCanvasParams.find(p => p.envelopeId === sdActiveParamId);
        if (!source || _laneRange(source) <= 0.001) {
            source = null;
            let best = 0.001;
            sdVisibleParams().forEach(p => { const r = _laneRange(p); if (r > best) { best = r; source = p; } });
        }
        if (!source) {
            setStatus('Draw a moving curve on a lane first — Prism spreads it across the rest');
            return;
        }
        const totalBeats = sdGetBars() * 4;
        const sel = sdGetSelection();
        const sB = sel ? sel.startBeat : 0;
        const eB = sel ? sel.endBeat : totalBeats;
        const srcPts = sel ? source.points.filter(pt => pt.time >= sB && pt.time <= eB) : source.points;
        const anchors = _sdPrismExtractAnchors(srcPts, totalBeats);
        const aVals = anchors.map(a => a.value);
        const anchorRange = aVals.length ? (Math.max.apply(null, aVals) - Math.min.apply(null, aVals)) : 0;
        if (anchors.length < 2 || anchorRange <= 0.001) {
            // Selection (if any) leaves the source flat in range — nothing to spread.
            setStatus('No moving curve in range — Prism needs a curve to spread');
            return;
        }
        // Recipients = every unlocked lane EXCEPT the chosen source (focused device only when filtered).
        const targets = sdVisibleParams().filter(p => p !== source && !p.locked);
        if (!targets.length) { setStatus('No unlocked lanes to receive Prism'); return; }
        pushUndo();
        // Local seed + personality map — do NOT touch the live-tool globals.
        const seed = (Math.floor(Math.random() * 0xFFFFFFFF)) >>> 0;
        const perLane = _sdPrismAssignPersonalities(targets, seed);
        // Quick Prism skips the live tool's diversity slider + commit step:
        // roll a lively amount each press (50%-100%).
        const diversity = 0.5 + Math.random() * 0.5;
        targets.forEach(param => {
            const personality = perLane[param.envelopeId] || 'mirror';
            const rng = _sdPrismMakeRng((seed ^ _sdPrismHashStr(param.envelopeId)) >>> 0);
            const variant = _sdPrismGenerateVariant(anchors, personality, diversity, rng);
            const newPoints = variant.map(p => ({
                time: Math.round(p.time * 10000) / 10000,
                value: Math.max(0, Math.min(1, p.value)),
                curve: p.curve || 0,
            }));
            if (sel) {
                const outside = param.points.filter(pt => pt.time < sB || pt.time > eB);
                param.points = outside.concat(newPoints).sort((a, b) => a.time - b.time);
            } else {
                param.points = newPoints;
            }
        });
        sdResetSliderSnapshots(); sdRenderSidebar(); sdDrawCanvasGrid();
        const skipMsg = sdLockSkipMessage(targets.length);
        if (skipMsg) {
            setStatus(skipMsg);
            setTimeout(() => { if (status && status.textContent === skipMsg) status.textContent = ''; }, 3000);
        }
    };

    function _sdPrismLiveTick() {
        if (_sdActiveTool !== 'prism') return;
        // Restore variants from snapshot first so each tick computes
        // from the original variants, not the previous tick's output
        // (no compounding drift across rapid mousemove ticks).
        _sdRestoreRecipientsFromSnapshot();
        _sdPrismCompute();
        _sdToolDirty = true;
        sdRenderSidebar();
        sdDrawCanvasGrid();
    }

    window.sdPrismReroll = function() {
        if (_sdActiveTool !== 'prism') return;
        _sdPrismRngSeed = (Math.floor(Math.random() * 0xFFFFFFFF)) >>> 0;
        const targets = sdCanvasParams.filter(p => p.envelopeId !== sdActiveParamId && !p.locked);
        _sdPrismPerLane = _sdPrismAssignPersonalities(targets, _sdPrismRngSeed);
        _sdPrismLiveTick();
    };

    window.sdTogglePrism = function() {
        if (_sdActiveTool === 'prism') { window.sdCancelTool(); return; }
        // Custom guard — Prism is live-draw, so unlike Bloom/Weave it
        // does NOT require the source lane to already have a curve.
        // User can enter the mode on an empty lane and watch variants
        // generate live as they draw the very first stroke.
        if (!sdActiveParamId) {
            sdShowRequirement('Select a lane first', 'Prism needs an active lane as the source. Click one of the lanes in the sidebar, then press Prism.');
            return;
        }
        if (sdCanvasParams.length < 2) {
            sdShowRequirement('Need more lanes', 'Prism spreads a curve across multiple lanes. Your rack only has one mapped parameter — Prism needs at least two lanes to work with.');
            return;
        }
        _sdActiveTool = 'prism';
        _sdToolSnapshot = _sdSnapshotAll();
        _sdToolDirty = false;
        _sdPrismRngSeed = (Math.floor(Math.random() * 0xFFFFFFFF)) >>> 0;
        const targets = sdCanvasParams.filter(p => p.envelopeId !== sdActiveParamId && !p.locked);
        _sdPrismPerLane = _sdPrismAssignPersonalities(targets, _sdPrismRngSeed);
        _sdRenderPrismPanel();
        // Initial compute so variants snap to source if it already has
        // points. If source is empty, compute is a no-op — variants stay
        // as they were until the user draws the first stroke.
        _sdPrismCompute();
        sdRenderSidebar();
        sdDrawCanvasGrid();
    };

    function _sdRenderPrismPanel() {
        const sec = document.getElementById('sd-generative-section');
        if (!sec) return;
        sec.innerHTML = ''
            + '<div class="flex items-center justify-between mb-2 px-1">'
            + '<button onclick="sdCancelTool()" title="Cancel and revert" class="text-[9px] text-zinc-500 hover:text-zinc-200 transition-colors flex items-center gap-0.5">'
            + '<svg class="w-3 h-3" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" d="M15 19l-7-7 7-7"/></svg>Back</button>'
            + '<span class="text-[9px] font-black text-amber-400 uppercase tracking-[0.2em]">Prism</span>'
            + '<span class="text-[8px] text-amber-400/70 uppercase tracking-widest font-bold">Live</span>'
            + '</div>'
            + '<div class="text-[8px] text-zinc-600 leading-relaxed px-1 mb-1">Draw on the active lane — every other unlocked lane responds with the same anchors, different paths.</div>'
            + '<div class="px-1 flex flex-col gap-2">'
            + '<div class="flex items-center gap-2">'
            + '<span class="text-[9px] font-bold text-zinc-500 uppercase w-12 shrink-0">Diversity</span>'
            + '<input type="range" id="sd-prism-diversity" min="0" max="100" value="100" class="flex-1 h-1 accent-amber-500 cursor-pointer" oninput="_sdToolMorph(this.value)">'
            + '<span id="sd-prism-val" class="text-[9px] text-amber-400 font-mono w-9 text-right">100%</span>'
            + '</div>'
            + '<button onclick="sdPrismReroll()" title="Re-roll personality assignments across variant lanes" class="text-[9px] text-amber-400 bg-amber-500/10 hover:bg-amber-500/20 border border-amber-500/30 hover:border-amber-500/50 py-1.5 rounded uppercase tracking-wider font-bold transition-colors flex items-center justify-center gap-1">'
            + '<svg class="w-3 h-3" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15"/></svg>'
            + 'Reroll</button>'
            + '<div class="flex gap-1.5 mt-1">'
            + '<button onclick="sdCommitTool()" class="flex-1 text-[9px] text-black bg-amber-500 hover:bg-amber-400 py-1.5 rounded uppercase tracking-wider font-bold transition-colors">Commit</button>'
            + '<button onclick="sdCancelTool()" class="flex-1 text-[9px] text-zinc-400 bg-white/5 hover:bg-white/10 border border-white/10 py-1.5 rounded uppercase tracking-wider font-bold transition-colors">Cancel</button>'
            + '</div>'
            + '</div>';
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
        // Shuffle only operates on UNLOCKED lanes. Locked lanes keep
        // their points exactly where they were — that's the user's
        // commitment ("don't touch these").
        const movable = sdCanvasParams.filter(p => !p.locked);
        if (movable.length < 2) {
            const status = document.getElementById('sd-canvas-status');
            if (status) status.textContent = movable.length === 0
                ? 'All lanes locked — unlock to shuffle'
                : 'Need at least 2 unlocked lanes to shuffle';
            return;
        }
        const lanesWithPoints = movable.filter(p => p.points.length > 0);
        if (lanesWithPoints.length < 2) {
            document.getElementById('sd-canvas-status').textContent = 'Need curves on at least 2 unlocked lanes';
            return;
        }
        pushUndo();
        // Collect point arrays from movable lanes only
        const allPoints = movable.map(p => p.points.slice());
        // Fisher-Yates shuffle
        for (let i = allPoints.length - 1; i > 0; i--) {
            const j = Math.floor(Math.random() * (i + 1));
            [allPoints[i], allPoints[j]] = [allPoints[j], allPoints[i]];
        }
        // Reassign back to the same movable lanes
        movable.forEach((p, i) => { p.points = allPoints[i]; });
        sdResetSliderSnapshots();
        sdRenderSidebar();
        sdDrawCanvasGrid();
        _sdLandKick();   // landing animation (mockup B): the comet draws the new curves on
        const lockMsg = sdLockSkipMessage(movable.length);
        document.getElementById('sd-canvas-status').textContent = lockMsg
            || 'Shuffled — lanes reassigned randomly';
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

            let processed = 0;
            sdCanvasParams.forEach((param, i) => {
                if (param.locked) return; // preset never overwrites a locked lane
                if (i < lanes.length && lanes[i] && lanes[i].length) {
                    param.points = lanes[i].filter(pt => pt && isFinite(pt.time) && isFinite(pt.value)).map(pt => ({
                        time: Math.max(0, Math.min(beats, pt.time)),
                        value: Math.max(0, Math.min(1, isNaN(pt.value) ? 0 : pt.value)),
                        curve: pt.curve || 0
                    }));
                } else {
                    param.points = [];
                }
                processed++;
            });

            document.getElementById('sd-preset-modal').classList.add('hidden');
            sdResetSliderSnapshots();
            sdRenderSidebar();
            sdDrawCanvasGrid();
            const lockMsg = sdLockSkipMessage(processed);
            document.getElementById('sd-canvas-status').textContent = lockMsg
                || ('Preset: ' + preset.name + ' — ' + n + ' lanes');
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
                locked: !!p.locked,
                points: (p.points || []).map(pt => ({
                    time: pt.time,
                    value: pt.value,
                    curve: pt.curve || 0
                }))
            });
        });

        // Restore state — session bars apply for THIS session only, do not
        // overwrite the user's sticky preference (per spec).
        if (session.clip_bars) sdSetBars(session.clip_bars, false);
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

    // Inner draggable card markup shared by the Recent Generations dock and
    // the "All Generations" modal, so the two render identically. Caller
    // supplies the outer wrapper (LED ring for the dock, grid cell for the
    // modal). `idx` is the card's position so _wireGenCardDrag can map it
    // back to its item.
    function _genCardInnerHtml(it, idx) {
        const displayName = (it.name || '').replace(/\.alc$/i, '');
        const time = _formatGenerationTime(it.mtimeMs);
        const thumb = it.pngPath
            ? `<img src="file://${it.pngPath.replace(/\\/g, '/')}?t=${it.mtimeMs}" class="w-full h-full object-cover" alt="" draggable="false">`
            : `<div class="w-full h-full flex items-center justify-center text-zinc-600 text-[9px]">no preview</div>`;
        return `
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
            </div>`;
    }

    // Wire native drag-out (and a Windows mousedown fallback) for every
    // .sd-gen-card inside `container`, mapping each to items[idx] by DOM
    // order. Same Electron startDrag bridge proven to land .alc in Ableton.
    function _wireGenCardDrag(container, items) {
        Array.from(container.querySelectorAll('.sd-gen-card')).forEach((card, idx) => {
            const item = items[idx];
            if (!item) return;
            card.addEventListener('dragstart', (e) => {
                e.preventDefault();
                if (window.stride && window.stride.startDrag) {
                    window.stride.startDrag(item.alcPath);
                }
            });
            // Windows fallback for some Electron builds (see apply-reveal
            // note). WINDOWS-ONLY: on macOS dragstart fires reliably, and
            // starting the drag from mousedown sticks the clip to the cursor
            // on trackpads. Mac uses the dragstart path above.
            if (window.stride && window.stride.platform === 'win32') {
                card.addEventListener('mousedown', (e) => {
                    if (e.button !== 0) return;
                    if (window.stride && window.stride.startDrag) {
                        window.stride.startDrag(item.alcPath);
                    }
                });
            }
        });
    }
    // Visual-only dock clear: set when user hits Clear, the dock filters out
    // generations with mtime <= this value. Files remain on disk.
    let _dockClearedAfterMs = 0;

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
    // The moment of arrival also triggers a green-flash pulse on the
    // inner card to mark "this is the new file." LED ring keeps spinning
    // throughout (it's on the wrapper, decoupled from the flash). ~650ms
    // for the flight + 1s for the flash.
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
            // Green-flash pulse on the inner card right as the orb arrives.
            // 600ms matches the orb's transform timing so the flash builds
            // as the orb fades. Auto-removed at 1s so the bg-black/40 base
            // class kicks back in cleanly.
            setTimeout(() => {
                try {
                    const innerCard = targetCard.querySelector('.sd-gen-card') || targetCard;
                    innerCard.classList.add('sd-gen-card-flash');
                    setTimeout(() => {
                        try { innerCard.classList.remove('sd-gen-card-flash'); } catch (e) {}
                    }, 1000);
                } catch (e) {}
            }, 600);
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
        // Visual-only Clear: filter out anything created at or before the
        // last Clear click. Files stay on disk; they're just hidden from the
        // dock until a fresh generation pushes the mtime past the marker.
        if (Array.isArray(items) && _dockClearedAfterMs > 0) {
            items = items.filter(it => (it.mtimeMs || 0) > _dockClearedAfterMs);
        }
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
            // The LED ring sits on a wrapper div so the inner card keeps
            // its overflow-hidden + rounded corners (clipping the
            // thumbnail) while the ring extends slightly outside the
            // wrapper, where it isn't clipped.
            const ledClass = (idx === 0 && isFresh) ? 'gen-card-led' : '';
            return `
                <div class="${ledClass} shrink-0 w-56 h-full rounded-md">
                    ${_genCardInnerHtml(it, idx)}
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
        _wireGenCardDrag(cards, items);
    }

    // Expose the refresh so external triggers (e.g. settings reset) can call it
    window._refreshGenerationsDock = _refreshGenerationsDock;

    // Visual-only clear of the Recent Generations dock. Files in
    // ~/Desktop/Stride/ are NEVER deleted — user can still find every .alc
    // there or via Open Folder. This just sets a session-only timestamp:
    // the dock filters out any generation with mtime <= clearedAfterMs.
    // New generations after this point still appear normally.
    // Doesn't persist across app restarts (intentional — restart = fresh slate).
    window.sdClearGenerations = function() {
        _dockClearedAfterMs = Date.now();
        _lastSeenGenMtime = _dockClearedAfterMs;  // also reset the LED-glow seen-marker
        _refreshGenerationsDock();
        const status = document.getElementById('sd-canvas-status');
        if (status) {
            status.textContent = 'Dock cleared — files still in ~/Desktop/Stride/';
            setTimeout(() => {
                if (status && status.textContent.startsWith('Dock cleared')) status.textContent = '';
            }, 3000);
        }
    };

    // ─── ALL GENERATIONS MODAL ─────────────────────────────
    // Folder button in the dock opens a modal listing EVERY .alc in
    // ~/Desktop/Stride/, newest-first (no 5-card cap, ignores the dock's
    // session Clear). Each card drags into Ableton exactly like the dock.
    window.sdOpenAllGenerations = async function() {
        const overlay = document.getElementById('sd-all-gens-overlay');
        const grid = document.getElementById('sd-all-gens-grid');
        const empty = document.getElementById('sd-all-gens-empty');
        const count = document.getElementById('sd-all-gens-count');
        if (!overlay || !grid) return;

        let items = [];
        if (window.stride && window.stride.listAllGenerations) {
            try { items = await window.stride.listAllGenerations(); } catch (e) {}
        }
        items = Array.isArray(items) ? items : [];

        if (count) count.textContent = items.length ? `· ${items.length}` : '';

        if (items.length === 0) {
            grid.innerHTML = '';
            grid.classList.add('hidden');
            if (empty) empty.classList.remove('hidden');
        } else {
            grid.classList.remove('hidden');
            if (empty) empty.classList.add('hidden');
            // Each grid cell is a fixed-height wrapper so the inner card's
            // h-full resolves the same way it does inside the dock.
            grid.innerHTML = items.map((it, idx) =>
                `<div class="h-16">${_genCardInnerHtml(it, idx)}</div>`
            ).join('');
            _wireGenCardDrag(grid, items);
        }

        overlay.classList.remove('hidden');
    };

    window.sdCloseAllGenerations = function() {
        const overlay = document.getElementById('sd-all-gens-overlay');
        if (overlay) overlay.classList.add('hidden');
    };

    // ESC closes the modal when it's open.
    document.addEventListener('keydown', (e) => {
        if (e.key !== 'Escape') return;
        const overlay = document.getElementById('sd-all-gens-overlay');
        if (overlay && !overlay.classList.contains('hidden')) {
            window.sdCloseAllGenerations();
        }
    });

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

    // Post-install: hand off from the install overlay to the persistent StrideInject
    // Control-Surface popup (the one manual step Ableton can't do for you). Hide the
    // install overlay WITHOUT the first-run welcome chain — that happens after this
    // popup is dismissed (or is skipped if the user opens the full guide instead).
    function sdShowStrideInjectSetup() {
        const overlay = document.getElementById('sd-install-m4l-overlay');
        if (overlay) overlay.classList.add('hidden');
        const m = document.getElementById('sd-strideinject-modal');
        if (m) m.classList.remove('hidden');
    }
    window.sdShowStrideInjectSetup = sdShowStrideInjectSetup;

    function sdDismissStrideInjectSetup() {
        const m = document.getElementById('sd-strideinject-modal');
        if (m) m.classList.add('hidden');
        sdMarkFirstRunDone(true);
        if (_sdInstallIsFirstRun) {
            _sdInstallIsFirstRun = false;
            const welcome = document.getElementById('sd-welcome-overlay');
            if (welcome) welcome.classList.remove('hidden');
        }
    }
    window.sdDismissStrideInjectSetup = sdDismissStrideInjectSetup;

    // Open the full Getting Started / Setup guide (carries the StrideInject Control-
    // Surface step + recommended settings, the workflow, AND the Arrangement-view
    // section). Now fires AUTOMATICALLY right after Install to Ableton succeeds (and
    // from the post-install popup's "Open setup guide" button). Hides the install
    // overlay + the popup, scrolls to the top (so the Control-Surface step shows
    // first), and marks first-run done so the welcome overlay doesn't pop underneath.
    function sdOpenGuideFromInstall() {
        const overlay = document.getElementById('sd-install-m4l-overlay');
        if (overlay) overlay.classList.add('hidden');
        const m = document.getElementById('sd-strideinject-modal');
        if (m) m.classList.add('hidden');
        sdMarkFirstRunDone(true);
        _sdInstallIsFirstRun = false;
        const guide = document.getElementById('guide-modal');
        if (guide) {
            guide.classList.remove('hidden');
            const sc = guide.querySelector('.overflow-y-auto');
            if (sc) sc.scrollTop = 0;   // start at the top — the Control-Surface + settings step
        }
    }
    window.sdOpenGuideFromInstall = sdOpenGuideFromInstall;

    // Maps install-handler responses (from main.js install-stride-link-to-ableton)
    // into status panel text. Knows the new error codes added with the verify
    // patch — source_bundle_incomplete + install_verification_failed — and
    // surfaces actionable next steps instead of raw error codes.
    // Re-enables disabled buttons on failure so the user can retry. On
    // success: green status, auto-dismiss after 2.6s, mark first-run done.
    function _handleInstallResult(res) {
        if (res && res.success) {
            const where = res.targetDir;
            const base = res.alreadyInstalled ? `Stride is installed at ${where}.` : `Installed to ${where}.`;
            if (res.strideInjectInstalled) {
                // Pop the full Setup Guide immediately after install. Its FIRST block is
                // the StrideInject Control-Surface step (with screenshot) + recommended
                // settings — the one manual step Ableton can't do — followed by the
                // workflow and the Arrangement-view section. Brief green confirm, then
                // the guide takes over.
                sdSetInstallStatus('success', base + ' StrideLink + StrideInject copied.');
                setTimeout(() => { sdOpenGuideFromInstall(); }, 350);
            } else {
                sdSetInstallStatus('error', base +
                    " StrideLink is in — but StrideInject didn't copy (Ableton may have it locked). Close the Live project and click Install again. StrideInject powers Inject to Clip.");
                setTimeout(() => { sdCloseInstallM4LOverlay(); sdMarkFirstRunDone(true); }, 5000);
            }
            return true;
        }
        const errCode = res && res.error;
        let msg;
        if (errCode === 'source_bundle_incomplete') {
            msg = (res && res.message) ||
                  "Stride's bundled M4L files aren't accessible. Try re-downloading Stride.";
        } else if (errCode === 'install_verification_failed') {
            msg = (res && res.message) ||
                  `Install ran but files didn't land at ${res && res.targetDir}. Try "Choose folder manually" with a different folder, or copy resources/M4L there by hand.`;
        } else if (errCode === 'target_locked') {
            msg = (res && res.message) ||
                  'Stride is already installed but the files are locked — close Ableton (which has StrideLink loaded) and try again.';
        } else if (errCode === 'userLibraryNotFound') {
            msg = "Couldn't find your Ableton User Library at the default location. Click \"Choose folder manually\" below and point Stride at it.";
        } else {
            msg = (res && (res.message || res.error)) || 'Install failed. Please try again.';
        }
        sdSetInstallStatus('error', msg);
        const installBtn = document.getElementById('sd-install-m4l-btn');
        if (installBtn) installBtn.disabled = false;
        return false;
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
                    // If User Library auto-detection failed, automatically open
                    // the folder picker — same UX as clicking "Choose folder
                    // manually" but triggered as a fallback.
                    if (res && !res.success && res.error === 'userLibraryNotFound') {
                        sdSetInstallStatus('info', "Couldn't find your Ableton User Library. Please choose the folder manually.");
                        const picked = window.stride.pickUserLibraryFolder
                            ? await window.stride.pickUserLibraryFolder()
                            : null;
                        if (!picked) {
                            sdSetInstallStatus('error', 'Cancelled — no folder selected. Click "Choose folder manually" to try again.');
                            installBtn.disabled = false;
                            return;
                        }
                        res = await window.stride.installStrideLinkToAbleton(picked);
                    }
                    _handleInstallResult(res);
                } catch (e) {
                    sdSetInstallStatus('error', e.message || 'Install failed.');
                    installBtn.disabled = false;
                }
            });
        }

        // "Choose folder manually" — opens a folder picker and installs into
        // whatever the user picks. Replaces the old "Skip — I'll do it manually"
        // dead-end (which just dismissed the modal with no guidance). User
        // cancelling the picker = effective skip, dismisses the modal so they
        // can do it later via the titlebar Install to Ableton button.
        if (skipBtn) {
            skipBtn.addEventListener('click', async () => {
                if (!window.stride || !window.stride.pickUserLibraryFolder || !window.stride.installStrideLinkToAbleton) {
                    sdCloseInstallM4LOverlay();
                    return;
                }
                const picked = await window.stride.pickUserLibraryFolder();
                if (!picked) {
                    // Cancelled the picker → treat as a true skip, just close.
                    sdCloseInstallM4LOverlay();
                    return;
                }
                skipBtn.disabled = true;
                if (installBtn) installBtn.disabled = true;
                sdSetInstallStatus('info', 'Installing to selected folder...');
                try {
                    const res = await window.stride.installStrideLinkToAbleton(picked);
                    _handleInstallResult(res);
                } catch (e) {
                    sdSetInstallStatus('error', e.message || 'Install failed.');
                } finally {
                    skipBtn.disabled = false;
                }
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
        // Apply the user's sticky last-used bar count (overrides the
        // toolbar's hardcoded default of 8). No-op for first-run users
        // who haven't picked a bar count yet.
        sdApplyStickyBars();
        sdInitSkin();   // apply saved skin (or default) + paint the swatch
        // Paint the default GENERATIVE section (Chaos / Bloom / Prism grid).
        // Active-tool panels replace this on click and Cancel/Commit
        // restore it via _sdRenderGenerativeDefault.
        _sdRenderGenerativeDefault();
    });

})();
