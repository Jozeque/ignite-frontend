/**
 * Stride Pattern Library — loader + filter logic.
 *
 * Exposes a small pure-logic API used by both:
 *   - the renderer (window.strideLibrary, built from a fetched manifest)
 *   - node tests (require()'d directly, fed a manifest object from fs)
 *
 * No DOM, no fetch, no Electron dependencies — kept testable.
 *
 * Browser bootstrap lives at the bottom (under `if (typeof window…)`).
 */

(function (root, factory) {
    if (typeof module !== 'undefined' && module.exports) {
        module.exports = factory();
    } else {
        root.strideLibraryModule = factory();
    }
}(typeof self !== 'undefined' ? self : this, function () {

    // ─── Controlled vocabularies ─────────────────────────────────
    // Adding to these requires a code release — UI controls reference them.

    const VALID_CATEGORIES = [
        'bass', 'leads', 'chords', 'melodic',
        'drums', 'ambient', 'sequences',
    ];

    const VALID_STYLES = [
        'acid', 'ambient', 'breaks', 'deep', 'downtempo',
        'drumandbass', 'dub', 'electronica', 'experimental',
        'garage', 'glitch', 'house', 'idm', 'jungle',
        'neosoul', 'psy', 'techno', 'trance', 'trap', 'world',
    ];

    const REQUIRED_FIELDS = [
        'id', 'name', 'file', 'category',
        'key', 'bpm', 'bars', 'note_count',
    ];

    // ─── Manifest validation ─────────────────────────────────────

    /**
     * Validate manifest shape and per-pattern integrity.
     * Returns { ok, errors } — does NOT throw. Tests + UI both call this.
     *
     * Does not check file existence on disk (caller's job in node).
     */
    function validateManifest(manifest) {
        const errors = [];
        if (!manifest || typeof manifest !== 'object') {
            return { ok: false, errors: ['manifest is not an object'] };
        }
        if (manifest.version !== 1) {
            errors.push(`manifest.version must be 1, got ${manifest.version}`);
        }
        if (!Array.isArray(manifest.patterns)) {
            return { ok: false, errors: ['manifest.patterns must be an array'] };
        }

        const seenIds = new Set();
        manifest.patterns.forEach((p, i) => {
            const tag = `patterns[${i}] (${p && p.id ? p.id : 'no-id'})`;
            for (const f of REQUIRED_FIELDS) {
                if (p[f] === undefined || p[f] === null || p[f] === '') {
                    errors.push(`${tag}: missing required field "${f}"`);
                }
            }
            if (p.id) {
                if (seenIds.has(p.id)) errors.push(`${tag}: duplicate id`);
                seenIds.add(p.id);
            }
            if (p.category && !VALID_CATEGORIES.includes(p.category)) {
                errors.push(`${tag}: invalid category "${p.category}"`);
            }
            if (Array.isArray(p.style)) {
                for (const s of p.style) {
                    if (!VALID_STYLES.includes(s)) {
                        errors.push(`${tag}: unknown style "${s}"`);
                    }
                }
            }
            if (typeof p.bpm === 'number' && (p.bpm < 30 || p.bpm > 300)) {
                errors.push(`${tag}: bpm ${p.bpm} out of range [30,300]`);
            }
            if (typeof p.bars === 'number' && p.bars < 1) {
                errors.push(`${tag}: bars must be >= 1`);
            }
        });

        return { ok: errors.length === 0, errors };
    }

    // ─── Bar-fit logic ───────────────────────────────────────────

    /**
     * Does a pattern of `patternBars` length fit a canvas of `canvasBars`?
     * Rules:
     *   - Exact match: always fits.
     *   - Shorter pattern: fits if canvasBars is a multiple (loopable).
     *   - Longer pattern: never fits this filter (would require canvas resize).
     */
    function fitsBars(patternBars, canvasBars) {
        if (!Number.isFinite(patternBars) || !Number.isFinite(canvasBars)) return false;
        if (patternBars <= 0 || canvasBars <= 0) return false;
        if (patternBars > canvasBars) return false;
        if (patternBars === canvasBars) return true;
        return (canvasBars % patternBars) === 0;
    }

    /**
     * Expand a short pattern's notes to fill a longer canvas by looping.
     * Long-pattern truncation included as a defensive fallback (filter
     * should prevent this case from reaching here).
     *
     * @param {Array} notes      [{pitch, time, duration, velocity}] in beats
     * @param {number} patternBars
     * @param {number} canvasBars
     * @returns {Array} expanded note list, sorted by time
     */
    function expandToCanvasLength(notes, patternBars, canvasBars) {
        if (!Array.isArray(notes)) return [];
        const canvasBeats = canvasBars * 4;
        if (patternBars >= canvasBars) {
            return notes
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
            for (const n of notes) {
                out.push({ ...n, time: n.time + offset });
            }
        }
        return out;
    }

    // ─── Filtering ───────────────────────────────────────────────

    /**
     * Apply filters to a pattern list. All filters AND-combined.
     *
     * @param {Array} patterns
     * @param {Object} filters
     *   - bars          number (exact canvas bars to fit) | 'all' | undefined
     *   - category      string | undefined
     *   - style         string | undefined  (matches if pattern.style includes it)
     *   - key           string | undefined  (exact match, normalized — legacy)
     *   - root          string | undefined  ('A'|'C'|... — matches root part of p.key)
     *   - scale         string | undefined  ('maj'|'min'|'phr' — matches scale part of p.key)
     *   - energy        number | undefined  (2 | 3 | 4 — exact match on p.energy)
     *   - bpmMin        number | undefined
     *   - bpmMax        number | undefined
     *   - search        string | undefined  (matched against name + tags + style)
     *   - favoriteIds   Set<string> | undefined
     *   - onlyFavorites boolean | undefined
     */
    function filterPatterns(patterns, filters) {
        const f = filters || {};
        const q = (f.search || '').trim().toLowerCase();
        const favSet = f.favoriteIds instanceof Set ? f.favoriteIds : null;

        return patterns.filter(p => {
            if (f.category && p.category !== f.category) return false;

            if (f.bars !== undefined && f.bars !== 'all') {
                if (!fitsBars(p.bars, f.bars)) return false;
            }

            if (f.style && (!Array.isArray(p.style) || !p.style.includes(f.style))) {
                return false;
            }

            if (f.key && normalizeKey(p.key) !== normalizeKey(f.key)) {
                return false;
            }

            // Root / Scale — split p.key on whitespace. p.key shape is "F min"
            // (root + scale). Either filter can be applied alone or together.
            if (f.root || f.scale) {
                const [pRoot, pScale] = splitKey(p.key);
                if (f.root && pRoot.toLowerCase() !== String(f.root).toLowerCase()) return false;
                if (f.scale && pScale.toLowerCase() !== String(f.scale).toLowerCase()) return false;
            }

            if (f.energy !== undefined && f.energy !== null && f.energy !== '') {
                if (Number(p.energy) !== Number(f.energy)) return false;
            }

            if (Number.isFinite(f.bpmMin) && p.bpm < f.bpmMin) return false;
            if (Number.isFinite(f.bpmMax) && p.bpm > f.bpmMax) return false;

            if (f.onlyFavorites) {
                if (!favSet || !favSet.has(p.id)) return false;
            }

            if (q) {
                const hay = (p.name + ' ' +
                             (p.tags || []).join(' ') + ' ' +
                             (p.style || []).join(' ')).toLowerCase();
                if (!hay.includes(q)) return false;
            }

            return true;
        });
    }

    function splitKey(k) {
        if (!k) return ['', ''];
        const parts = String(k).trim().split(/\s+/);
        return [parts[0] || '', parts.slice(1).join(' ') || ''];
    }

    function normalizeKey(k) {
        if (!k) return '';
        return String(k).trim().toLowerCase().replace(/\s+/g, ' ');
    }

    // ─── Library factory ─────────────────────────────────────────

    function createLibrary(manifest) {
        const v = validateManifest(manifest);
        const patterns = (manifest && Array.isArray(manifest.patterns)) ? manifest.patterns : [];
        const byId = {};
        for (const p of patterns) {
            if (p && p.id) byId[p.id] = p;
        }

        return {
            valid: v.ok,
            errors: v.errors,
            patterns,
            byId,
            getById: (id) => byId[id] || null,
            filter: (filters) => filterPatterns(patterns, filters),
            listCategories: () => {
                const c = {};
                for (const p of patterns) {
                    c[p.category] = (c[p.category] || 0) + 1;
                }
                return c;
            },
        };
    }

    // ─── Browser bootstrap ───────────────────────────────────────
    // Renderer side calls window.strideLibraryModule.bootstrap() after
    // the manifest is fetched, which builds a singleton at
    // window.strideLibrary. Kept out of the node test path.

    function bootstrap(manifestObj) {
        if (typeof window !== 'undefined') {
            window.strideLibrary = createLibrary(manifestObj);
        }
        return createLibrary(manifestObj);
    }

    return {
        VALID_CATEGORIES,
        VALID_STYLES,
        REQUIRED_FIELDS,
        validateManifest,
        fitsBars,
        expandToCanvasLength,
        filterPatterns,
        normalizeKey,
        createLibrary,
        bootstrap,
    };
}));
