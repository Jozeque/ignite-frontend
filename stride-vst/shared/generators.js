/**
 * Stride — Pure generator math (templates, presets, generators)
 *
 * Single source of truth for every preset / generator that produces a curve.
 * Both the canvas (renderer/canvas.js) and StrideQuick (m4l-quick/) consume
 * this module so the two paths can never drift.
 *
 * All functions are pure: they take seeded randomness via an optional `rng`
 * argument and return point arrays — no DOM, no side effects, no globals.
 *
 * Point format:
 *   { time: number, value: number, curve?: number }
 *   - time:  beats from start (0 to lengthBeats)
 *   - value: 0..1 normalized
 *   - curve: -1..1 quadratic bezier curvature on the leading segment (optional, default 0)
 *
 * The math here mirrors the canvas's _sdGenTemplatePts (canvas.js:2689-2761)
 * line-for-line as of 2026-04-30. Lock with unit tests in test/test-generators.js.
 *
 * POC scope: sine + a deterministic seeded RNG only. Other templates and
 * generators land in Phase 1 once the rasterizer + live.remote~ chain is
 * proven.
 */

/**
 * Mulberry32 — deterministic, seedable PRNG.
 * Used everywhere a generator needs randomness so seeds reproduce identically
 * across the canvas and StrideQuick. Don't use Math.random in any generator.
 */
function makeRng(seed) {
    let s = (seed >>> 0) || 1;
    return function rng() {
        s |= 0;
        s = (s + 0x6D2B79F5) | 0;
        let t = Math.imul(s ^ (s >>> 15), 1 | s);
        t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
        return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
}

/**
 * Sine — simplest preset, perfect POC anchor.
 * Mirrors canvas.js:2691.
 *
 * Frequency scales with duration so a 1-bar loop has 1 cycle, 2-bar = 2,
 * 4-bar = 4, etc. Floor of dur/4 with min 1.
 *
 * No randomness — deterministic, identical every call.
 */
function genSine(lengthBeats) {
    const dur = lengthBeats;
    const cycles = Math.max(1, Math.round(dur / 4));
    const pts = [];
    for (let b = 0; b <= dur; b += 0.25) {
        const v = (Math.sin((b / dur) * Math.PI * 2 * cycles) + 1) / 2;
        pts.push({ time: b, value: v });
    }
    return pts;
}

/**
 * Pump — three-point pulse per beat (0 → 1 → 0).
 * Mirrors canvas.js:2692.
 */
function genPump(lengthBeats) {
    const dur = lengthBeats;
    const pts = [];
    for (let b = 0; b < dur; b++) {
        pts.push({ time: b, value: 0 });
        pts.push({ time: b + 0.5, value: 1 });
        pts.push({ time: b + 0.99, value: 0 });
    }
    return pts;
}

if (typeof module !== 'undefined') {
    module.exports = { makeRng, genSine, genPump };
}
