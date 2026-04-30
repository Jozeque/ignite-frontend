/**
 * Stride — Log scaling for parameter values
 *
 * Single source of truth for how Stride converts a normalized [0..1] curve
 * value into the parameter's native range. Used by:
 *   - alc-injector.js (writes baked .alc XML; legacy desktop path)
 *   - StrideQuick rasterizer (writes audio-rate buffer~ samples)
 *
 * If these ever diverge, .alc playback and StrideQuick modulation will sound
 * different. Keep the math here, never copy it inline elsewhere.
 *
 * The detection rules below match alc-injector.js:403-417 line-for-line as
 * of 2026-04-30. Any change there must mirror here.
 */

/**
 * Decide whether a parameter should be log-scaled.
 *
 * @param {object} param  { name, min, max, is_log }
 * @returns {boolean}
 *
 * Three-tier detection (first hit wins):
 *   1. Scanner-provided is_log flag (from LOM)
 *   2. Name heuristic — "cutoff" or "freq" in the param name
 *   3. Range heuristic — classic audio frequency band (10 Hz..20 kHz, ratio ≥ 100)
 *
 * Returns false if min/max are degenerate (≤0 or max≤min).
 */
function shouldUseLog(param) {
    const min = Number(param.min);
    const max = Number(param.max);
    if (!isFinite(min) || !isFinite(max)) return false;
    if (min <= 0 || max <= min) return false;
    if (param.is_log) return true;
    const pName = String(param.name || '').toLowerCase();
    if (/cutoff|freq/.test(pName)) return true;
    const ratio = max / min;
    if (ratio >= 100 && min >= 10 && max >= 5000) return true;
    return false;
}

/**
 * Scale a normalized [0..1] value into the parameter's native range.
 *
 * @param {number} v       value in [0..1]
 * @param {object} param   { min, max, is_log? }  (or pass useLog flag directly)
 * @param {boolean} [useLogOverride]  if provided, skip detection
 * @returns {number}       value in [min..max]
 *
 * Linear: min + v * (max - min)
 * Log:    min * (max/min)^v
 *
 * Clamps v to [0..1] before scaling.
 */
function scaleValue(v, param, useLogOverride) {
    const min = Number(param.min);
    const max = Number(param.max);
    const clamped = Math.max(0, Math.min(1, Number(v)));
    const useLog = (useLogOverride !== undefined) ? !!useLogOverride : shouldUseLog(param);
    if (useLog) {
        return min * Math.pow(max / min, clamped);
    }
    return min + clamped * (max - min);
}

/**
 * Inverse of scaleValue — useful for testing and for converting an Ableton
 * native value back into [0..1] canvas-space.
 */
function unscaleValue(nativeV, param, useLogOverride) {
    const min = Number(param.min);
    const max = Number(param.max);
    const useLog = (useLogOverride !== undefined) ? !!useLogOverride : shouldUseLog(param);
    if (useLog) {
        if (min <= 0 || max <= 0 || nativeV <= 0) return 0;
        return Math.log(nativeV / min) / Math.log(max / min);
    }
    return (nativeV - min) / (max - min);
}

if (typeof module !== 'undefined') {
    module.exports = { shouldUseLog, scaleValue, unscaleValue };
}
