/**
 * Stride Pattern Library — UI surface.
 *
 * Owns the full-takeover overlay, its open/close lifecycle, hotkeys, and
 * (in later phases) the grid/filters/preview pane. Pure UI — uses
 * window.strideLibrary (built by pattern-loader's bootstrap) as its
 * data source, and emits window.strideLibraryUI.events for callers
 * that need to react (e.g. canvas arming a picked pattern).
 *
 * Phases:
 *   Phase 2 (current): shell + open/close + peek-strip escape
 *   Phase 3: grid + filters + preview pane
 *   Phase 4: Tone.js audition
 *   Phase 5: pick → arm → flows into Apply to Clip
 *   Phase 6: favorites + recent + dock strip
 */

(function () {
    'use strict';

    const OVERLAY_ID = 'sd-pattern-library-overlay';
    const BUTTON_ID = 'sd-pattern-library-btn';
    const PANEL_ID = 'sd-pattern-library-panel';
    const PEEK_ID = 'sd-pattern-library-peek';
    const OPEN_CLASS = 'sd-lib-open';

    let _wired = false;
    let _open = false;

    // ─── Render state ───────────────────────────────────────
    // Held inside the IIFE so it persists across open/close. Filters
    // survive within a session; cleared on app restart.

    const _state = {
        category: 'all',                 // which left-rail tab is active
        filters: {
            bars: 'auto',                // 'auto' | 'all' | number
            style: '',
            root: '',                    // 'A'|'C'|... ('' = any)
            scale: '',                   // 'maj'|'min'|'phr' ('' = any)
            energy: '',                  // '2'|'3'|'4' ('' = any)
            search: '',
        },
        selectedId: null,                // id of pattern shown in preview
        parsedCache: new Map(),          // patternId -> {bpm, ppq, notes}
        parsedInFlight: new Map(),       // patternId -> Promise<parsed>
        favorites: new Set(),            // pattern ids
        recent: [],                      // [{id, used_at}] — MRU order, capped
        prefsLoaded: false,              // settings.json read attempted
    };
    const RECENT_CAP = 20;
    const SAVE_DEBOUNCE_MS = 500;

    function isInputFocused() {
        const el = document.activeElement;
        if (!el) return false;
        const tag = (el.tagName || '').toUpperCase();
        if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return true;
        if (el.isContentEditable) return true;
        return false;
    }

    function open() {
        const overlay = document.getElementById(OVERLAY_ID);
        const button = document.getElementById(BUTTON_ID);
        if (!overlay) return;
        overlay.classList.remove('hidden');
        // next-frame add open class so the CSS transition fires
        requestAnimationFrame(() => overlay.classList.add(OPEN_CLASS));
        if (button) button.setAttribute('data-active', 'true');
        _open = true;
        refresh();
        _emit('open');
    }

    function close() {
        const overlay = document.getElementById(OVERLAY_ID);
        const button = document.getElementById(BUTTON_ID);
        if (!overlay) return;
        overlay.classList.remove(OPEN_CLASS);
        // wait for transition to finish before hiding entirely
        setTimeout(() => {
            if (!overlay.classList.contains(OPEN_CLASS)) {
                overlay.classList.add('hidden');
            }
        }, 220);
        if (button) button.removeAttribute('data-active');
        _open = false;
        _emit('close');
    }

    function toggle() {
        if (_open) close(); else open();
    }

    // ─── Event bus ──────────────────────────────────────────
    // Lightweight, only used by canvas.js (arming) and future audition.

    const _listeners = {};
    function on(event, fn) {
        (_listeners[event] = _listeners[event] || []).push(fn);
    }
    function off(event, fn) {
        if (!_listeners[event]) return;
        _listeners[event] = _listeners[event].filter(h => h !== fn);
    }
    function _emit(event, data) {
        (_listeners[event] || []).forEach(fn => {
            try { fn(data); } catch (e) { console.warn('lib event handler failed', e); }
        });
    }

    // ─── Helpers ────────────────────────────────────────────

    function getCanvasBars() {
        if (typeof window !== 'undefined' && typeof window.sdGetBars === 'function') {
            try { return window.sdGetBars(); } catch (e) {}
        }
        return 8;
    }

    function resolveBarsFilter() {
        const v = _state.filters.bars;
        if (v === 'all') return 'all';
        if (v === 'auto' || v === undefined) return getCanvasBars();
        const n = parseInt(v, 10);
        return Number.isFinite(n) ? n : 'all';
    }

    function applyFiltersToList(library) {
        if (!library) return [];
        const f = _state.filters;
        const cat = _state.category;
        const composed = {
            search: f.search,
            style: f.style || undefined,
            root: f.root || undefined,
            scale: f.scale || undefined,
            energy: f.energy ? parseInt(f.energy, 10) : undefined,
            bars: resolveBarsFilter(),
        };
        if (cat !== 'all' && cat !== 'favorites' && cat !== 'recent') {
            composed.category = cat;
        }
        if (cat === 'favorites') {
            composed.onlyFavorites = true;
            composed.favoriteIds = _state.favorites;
        }
        let results = library.filter(composed);

        // 'recent' category: filter to recently-used ids and preserve MRU order
        if (cat === 'recent') {
            const idSet = new Set(_state.recent.map(r => r.id));
            results = results.filter(p => idSet.has(p.id));
            // Sort by recency
            const order = new Map();
            _state.recent.forEach((r, i) => order.set(r.id, i));
            results.sort((a, b) => (order.get(a.id) || 0) - (order.get(b.id) || 0));
        }
        return results;
    }

    // ─── Favorites + recent state ─────────────────────────────

    async function loadPrefs() {
        if (_state.prefsLoaded) return;
        _state.prefsLoaded = true;
        if (typeof window === 'undefined' || !window.stride || !window.stride.loadSettings) return;
        try {
            const res = await window.stride.loadSettings();
            const settings = (res && res.settings) || {};
            if (Array.isArray(settings.pattern_favorites)) {
                _state.favorites = new Set(settings.pattern_favorites);
            }
            if (Array.isArray(settings.pattern_recent)) {
                _state.recent = settings.pattern_recent
                    .filter(r => r && typeof r.id === 'string')
                    .slice(0, RECENT_CAP);
            }
        } catch (e) {
            console.warn('[Stride] Pattern prefs load failed:', e);
        }
    }

    let _saveTimer = null;
    function savePrefs() {
        if (typeof window === 'undefined' || !window.stride || !window.stride.saveSettings || !window.stride.loadSettings) return;
        if (_saveTimer) clearTimeout(_saveTimer);
        _saveTimer = setTimeout(async () => {
            try {
                const res = await window.stride.loadSettings();
                const settings = (res && res.settings) || {};
                settings.pattern_favorites = Array.from(_state.favorites);
                settings.pattern_recent = _state.recent.slice(0, RECENT_CAP);
                await window.stride.saveSettings(settings);
            } catch (e) {
                console.warn('[Stride] Pattern prefs save failed:', e);
            }
        }, SAVE_DEBOUNCE_MS);
    }

    function toggleFavorite(id) {
        if (!id) return;
        if (_state.favorites.has(id)) _state.favorites.delete(id);
        else _state.favorites.add(id);
        savePrefs();
        // Refresh only what changed — preview pane, card star, and (if
        // we're on the Favorites tab) the grid
        updateStarVisualsFor(id);
        if (_state.category === 'favorites') refresh();
    }

    function recordRecent(id) {
        if (!id) return;
        _state.recent = _state.recent.filter(r => r.id !== id);
        _state.recent.unshift({ id, used_at: Date.now() });
        if (_state.recent.length > RECENT_CAP) _state.recent.length = RECENT_CAP;
        savePrefs();
    }

    function updateStarVisualsFor(id) {
        // Only the cards need to redraw the star icon now that the preview
        // pane is gone. If a Favorites view is active, the card list also
        // updates via the next refresh() call.
        document.querySelectorAll(`.sd-lib-card[data-pattern-id="${cssEscape(id)}"] .sd-lib-card-star`).forEach(el => {
            el.classList.toggle('sd-fav', _state.favorites.has(id));
        });
    }

    // ─── MIDI fetch + parse cache ───────────────────────────
    // Lazy: each pattern's notes parsed on first request. Cached for the
    // session. Returns null if parser is unavailable or file fetch fails.

    async function loadPatternNotes(pattern) {
        if (!pattern) return null;
        if (_state.parsedCache.has(pattern.id)) {
            return _state.parsedCache.get(pattern.id);
        }
        if (_state.parsedInFlight.has(pattern.id)) {
            return _state.parsedInFlight.get(pattern.id);
        }
        const parser = (typeof window !== 'undefined') ? window.strideMidi : null;
        if (!parser) return null;
        // CSP forbids fetch() for local files — read .mid bytes via IPC.
        if (!window.stride || !window.stride.loadPatternFile) return null;
        const p = (async () => {
            try {
                const res = await window.stride.loadPatternFile(pattern.file);
                if (!res || !res.success) throw new Error(res && res.error || 'ipc failed');
                // IPC delivers Uint8Array. midi-parser.parse handles both
                // Uint8Array and ArrayBuffer paths.
                const parsed = parser.parse(res.bytes);
                _state.parsedCache.set(pattern.id, parsed);
                return parsed;
            } catch (e) {
                console.warn('[Stride] Failed to parse', pattern.id, e);
                return null;
            } finally {
                _state.parsedInFlight.delete(pattern.id);
            }
        })();
        _state.parsedInFlight.set(pattern.id, p);
        return p;
    }

    // ─── SVG renderers ──────────────────────────────────────

    function buildPianoRollSvg(parsed, pattern, w, h) {
        if (!parsed || !parsed.notes || parsed.notes.length === 0) {
            return `<svg viewBox="0 0 ${w} ${h}" class="sd-lib-card-thumb"></svg>`;
        }
        const notes = parsed.notes;
        const totalBeats = (pattern.bars || 4) * 4;
        let minP = Infinity, maxP = -Infinity;
        for (const n of notes) {
            if (n.pitch < minP) minP = n.pitch;
            if (n.pitch > maxP) maxP = n.pitch;
        }
        if (minP === maxP) { minP -= 2; maxP += 2; }
        const pad = 2;
        const innerW = w - pad * 2;
        const innerH = h - pad * 2;
        const range = maxP - minP || 1;
        const rects = notes.map(n => {
            const x = pad + (n.time / totalBeats) * innerW;
            const noteW = Math.max(1.5, (n.duration / totalBeats) * innerW);
            const y = pad + ((maxP - n.pitch) / range) * (innerH - 4);
            const op = 0.45 + (n.velocity / 127) * 0.55;
            return `<rect x="${x.toFixed(1)}" y="${y.toFixed(1)}" width="${noteW.toFixed(1)}" height="3" rx="1" style="fill:rgb(var(--o500))" opacity="${op.toFixed(2)}"/>`;
        }).join('');
        return `<svg viewBox="0 0 ${w} ${h}" class="sd-lib-card-thumb" preserveAspectRatio="none">${rects}</svg>`;
    }

    function buildPreviewRollSvg(parsed, pattern) {
        const w = 240, h = 140;
        if (!parsed || !parsed.notes || parsed.notes.length === 0) {
            return `<svg viewBox="0 0 ${w} ${h}" class="sd-lib-preview-roll"><text x="50%" y="50%" text-anchor="middle" fill="#52525b" font-size="11" font-family="Outfit">no notes</text></svg>`;
        }
        const notes = parsed.notes;
        const totalBeats = (pattern.bars || 4) * 4;
        let minP = Infinity, maxP = -Infinity;
        for (const n of notes) {
            if (n.pitch < minP) minP = n.pitch;
            if (n.pitch > maxP) maxP = n.pitch;
        }
        if (minP === maxP) { minP -= 2; maxP += 2; }
        const pad = 6;
        const innerW = w - pad * 2;
        const innerH = h - pad * 2;
        const range = maxP - minP || 1;
        // Bar dividers
        const bars = pattern.bars || 4;
        const barLines = [];
        for (let i = 1; i < bars; i++) {
            const x = pad + (i / bars) * innerW;
            barLines.push(`<line x1="${x}" y1="${pad}" x2="${x}" y2="${pad + innerH}" stroke="rgba(255,255,255,0.04)" stroke-width="1"/>`);
        }
        const rects = notes.map(n => {
            const x = pad + (n.time / totalBeats) * innerW;
            const noteW = Math.max(2, (n.duration / totalBeats) * innerW);
            const y = pad + ((maxP - n.pitch) / range) * (innerH - 6);
            const op = 0.55 + (n.velocity / 127) * 0.45;
            const hue = 18 + (n.velocity / 127) * 280; // orange→fuchsia gradient
            return `<rect x="${x.toFixed(1)}" y="${y.toFixed(1)}" width="${noteW.toFixed(1)}" height="5" rx="1.5" fill="hsl(${hue},90%,55%)" opacity="${op.toFixed(2)}"/>`;
        }).join('');
        return `<svg viewBox="0 0 ${w} ${h}" class="sd-lib-preview-roll" preserveAspectRatio="none">${barLines.join('')}${rects}</svg>`;
    }

    // ─── Renderers ──────────────────────────────────────────

    function refresh() {
        if (!_open) return;
        const library = (typeof window !== 'undefined') ? window.strideLibrary : null;

        if (!library || !Array.isArray(library.patterns)) {
            renderEmpty('Loading patterns…');
            return;
        }
        if (library.patterns.length === 0) {
            renderEmpty('No patterns bundled yet');
            return;
        }

        // First-time: populate style + key dropdowns from manifest data
        populateFilterDropdowns(library);

        // Active category visual
        document.querySelectorAll('.sd-lib-cat').forEach(btn => {
            const cat = btn.getAttribute('data-lib-cat');
            btn.classList.toggle('sd-lib-cat-active', cat === _state.category);
        });

        // Sync filter inputs with state (in case state changed externally)
        syncFilterInputs();

        const matches = applyFiltersToList(library);
        renderGrid(matches);

        const countEl = document.getElementById('sd-lib-count');
        if (countEl) {
            countEl.textContent = matches.length + (matches.length === 1 ? ' pattern' : ' patterns');
        }
    }

    function renderEmpty(msg) {
        const grid = document.getElementById('sd-lib-grid');
        if (grid) grid.innerHTML = `<div class="sd-lib-empty">${escapeHtml(msg)}</div>`;
        const countEl = document.getElementById('sd-lib-count');
        if (countEl) countEl.textContent = '0 patterns';
    }

    let _dropdownsPopulated = false;
    function populateFilterDropdowns(library) {
        if (_dropdownsPopulated) return;
        const styleSet = new Set();
        for (const p of library.patterns) {
            (p.style || []).forEach(s => styleSet.add(s));
        }
        const styleSel = document.getElementById('sd-lib-style');
        if (styleSel) {
            for (const s of Array.from(styleSet).sort()) {
                const opt = document.createElement('option');
                opt.value = s; opt.textContent = capitalize(s);
                styleSel.appendChild(opt);
            }
        }
        // Root, Scale, and Energy dropdowns are populated statically in
        // index.html (fixed option sets — no need to derive from manifest).
        _dropdownsPopulated = true;
    }

    function syncFilterInputs() {
        const setVal = (id, v) => {
            const el = document.getElementById(id);
            if (el && el.value !== String(v)) el.value = String(v);
        };
        setVal('sd-lib-bars', _state.filters.bars);
        setVal('sd-lib-style', _state.filters.style);
        setVal('sd-lib-root', _state.filters.root);
        setVal('sd-lib-scale', _state.filters.scale);
        setVal('sd-lib-energy', _state.filters.energy);
        setVal('sd-lib-search', _state.filters.search);
    }

    function renderGrid(patterns) {
        const grid = document.getElementById('sd-lib-grid');
        if (!grid) return;
        if (patterns.length === 0) {
            grid.innerHTML = '<div class="sd-lib-empty">No patterns match these filters</div>';
            return;
        }
        // Build skeleton cards immediately, fill thumbnails async.
        grid.innerHTML = patterns.map(p => cardSkeletonHtml(p)).join('');
        // Wire click handlers + lazy-load thumbnails
        for (const p of patterns) {
            const cardEl = grid.querySelector('[data-pattern-id="' + cssEscape(p.id) + '"]');
            if (!cardEl) continue;
            cardEl.addEventListener('click', (e) => {
                // Star button clicks shouldn't trigger card selection
                if (e.target && e.target.closest && e.target.closest('.sd-lib-card-star')) return;
                // Instant-pick: click on a pattern arms it on the canvas
                // and closes the library. No separate "Pick Pattern" button
                // anymore — one click does both.
                selectPattern(p.id);
                pickSelected();
            });
            const star = cardEl.querySelector('.sd-lib-card-star');
            if (star) star.addEventListener('click', (e) => {
                e.stopPropagation();
                toggleFavorite(p.id);
            });
            const thumbHolder = cardEl.querySelector('.sd-lib-card-thumb-slot');
            loadPatternNotes(p).then(parsed => {
                if (parsed && thumbHolder) {
                    thumbHolder.innerHTML = buildPianoRollSvg(parsed, p, 200, 44);
                }
            });
        }
    }

    function cardSkeletonHtml(p) {
        const isSelected = p.id === _state.selectedId;
        const isFav = _state.favorites.has(p.id);
        return `
            <div class="sd-lib-card ${isSelected ? 'sd-lib-card-selected' : ''}" data-pattern-id="${escapeAttr(p.id)}">
                <div class="sd-lib-card-title">
                    <span class="truncate min-w-0">${escapeHtml(p.name)}</span>
                    <button class="sd-lib-card-star ${isFav ? 'sd-fav' : ''}" data-fav-id="${escapeAttr(p.id)}" title="Favorite">★</button>
                </div>
                <div class="sd-lib-card-thumb-slot"></div>
                <div class="sd-lib-card-meta">
                    <b>${escapeHtml(p.key || '')}</b>
                    <span>·</span>
                    <span>${escapeHtml(String(p.bpm || ''))} BPM</span>
                    <span>·</span>
                    <span>${escapeHtml(String(p.bars || ''))} ${p.bars === 1 ? 'bar' : 'bars'}</span>
                </div>
            </div>
        `;
    }

    function selectPattern(id) {
        _state.selectedId = id;
        // Toggle card selection styling — the only visual the preview-pane
        // removal left behind. Cards highlight briefly before pickSelected()
        // closes the overlay.
        document.querySelectorAll('.sd-lib-card').forEach(c => {
            c.classList.toggle('sd-lib-card-selected', c.getAttribute('data-pattern-id') === id);
        });
    }

    // ─── Pick pattern → arm on canvas ─────────────────────────

    async function pickSelected() {
        const library = (typeof window !== 'undefined') ? window.strideLibrary : null;
        if (!library) return;
        const p = library.getById(_state.selectedId);
        if (!p) return;
        if (typeof window.sdArmPattern !== 'function') {
            console.warn('[Stride] sdArmPattern not available — canvas not initialized');
            return;
        }
        const parsed = await loadPatternNotes(p);
        if (!parsed || !parsed.notes || parsed.notes.length === 0) {
            console.warn('[Stride] Cannot arm pattern with no notes:', p.id);
            return;
        }
        window.sdArmPattern(p, parsed.notes);
        recordRecent(p.id);
        close();
    }

    // ─── Misc utils ─────────────────────────────────────────

    function capitalize(s) {
        if (!s) return '';
        return s.charAt(0).toUpperCase() + s.slice(1);
    }
    function escapeHtml(s) {
        return String(s).replace(/[&<>"']/g, c => ({
            '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
        }[c]));
    }
    function escapeAttr(s) { return escapeHtml(s); }
    function cssEscape(s) { return String(s).replace(/"/g, '\\"'); }

    // ─── Wiring ─────────────────────────────────────────────

    function init() {
        if (_wired) return;
        _wired = true;

        // Load favorites + recent from settings.json (async, non-blocking).
        // Library renders empty stars/recent until this resolves; refresh()
        // on open() will use whatever's loaded by then.
        loadPrefs();

        // Toolbar button toggle
        const button = document.getElementById(BUTTON_ID);
        if (button) button.addEventListener('click', toggle);

        // Peek strip click → close
        const peek = document.getElementById(PEEK_ID);
        if (peek) peek.addEventListener('click', close);

        // Header back button → close (mirror of the peek strip)
        const backBtn = document.getElementById('sd-lib-back-btn');
        if (backBtn) backBtn.addEventListener('click', close);

        // Category nav buttons
        document.querySelectorAll('.sd-lib-cat').forEach(btn => {
            btn.addEventListener('click', () => {
                const cat = btn.getAttribute('data-lib-cat');
                if (cat) {
                    _state.category = cat;
                    refresh();
                }
            });
        });

        // Filter dropdowns + search
        const wireFilter = (id, key, isNum) => {
            const el = document.getElementById(id);
            if (!el) return;
            const handler = () => {
                _state.filters[key] = isNum ? el.value : el.value;
                refresh();
            };
            el.addEventListener('change', handler);
            el.addEventListener('input', handler);
        };
        wireFilter('sd-lib-bars', 'bars');
        wireFilter('sd-lib-style', 'style');
        wireFilter('sd-lib-root', 'root');
        wireFilter('sd-lib-scale', 'scale');
        wireFilter('sd-lib-energy', 'energy');
        wireFilter('sd-lib-search', 'search');

        // Preview pane is gone — clicking a pattern card arms it and closes
        // the library in one gesture (see card click handler above).
        // Audition (Play button) was disabled-"coming Phase 4" so its
        // removal is genuinely zero loss.

        // Hotkeys: L toggles (when no input focused), ESC closes
        document.addEventListener('keydown', (e) => {
            if (e.key === 'Escape' && _open) {
                close();
                e.preventDefault();
                return;
            }
            if ((e.key === 'l' || e.key === 'L') &&
                !e.ctrlKey && !e.metaKey && !e.altKey &&
                !isInputFocused()) {
                toggle();
                e.preventDefault();
            }
        });
    }

    // Auto-init when DOM is ready (script is loaded at end of body, so
    // DOM is already parsed — but defer to next tick to be safe with
    // later <script> tags in the same file).
    if (typeof window !== 'undefined') {
        if (document.readyState === 'loading') {
            document.addEventListener('DOMContentLoaded', init);
        } else {
            setTimeout(init, 0);
        }

        window.strideLibraryUI = {
            open, close, toggle,
            isOpen: () => _open,
            on, off,
            init,
            refresh,
        };
    }
})();
