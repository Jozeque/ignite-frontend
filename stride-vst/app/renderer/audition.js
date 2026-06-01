/**
 * Stride Pattern Audition — minimal Web Audio polysynth for previewing
 * library patterns inside the app. No external dependency, ~5KB.
 *
 * The synth is intentionally simple: detuned saw + low-pass filter +
 * ADSR envelope, mixed through a soft compressor. Audible across the
 * 30-100 BPM range we care about, and won't draw any attention away
 * from "the real sound" producers will get when they apply the pattern
 * through their own rack. Sound quality is "good enough to choose
 * between options", not "production-ready preview."
 *
 * Public API on window.strideAudition:
 *   - play(notes, bpm, opts) — start playback. Stops any prior playback.
 *       notes: [{pitch, time, duration, velocity}] (time/duration in beats)
 *       opts.loop: boolean — restart at end (default true)
 *       opts.onStop: () => void — fires when playback ends or is stopped
 *   - stop() — cease playback, release resources
 *   - isPlaying()
 *   - testNoteSchedule(notes, bpm, ...) — pure math, exposed for tests
 *
 * Pure-logic helpers (note timing, midi→hz) live at module scope and
 * are testable in node without an AudioContext.
 */

(function (root, factory) {
    if (typeof module !== 'undefined' && module.exports) {
        module.exports = factory();
    } else {
        root.strideAudition = factory();
    }
}(typeof self !== 'undefined' ? self : this, function () {

    // ─── Pure logic (testable in node) ────────────────────────

    /**
     * MIDI pitch → frequency in Hz. Standard equal-temperament A4=440.
     */
    function midiToHz(pitch) {
        return 440 * Math.pow(2, (pitch - 69) / 12);
    }

    /**
     * Convert a beat count to seconds at a given BPM.
     */
    function beatsToSeconds(beats, bpm) {
        return (beats * 60) / bpm;
    }

    /**
     * Build a schedule of {start, end, freq, gain} for each note, in seconds,
     * relative to t0 (=0). Caller adds the audio context's currentTime.
     */
    function buildSchedule(notes, bpm) {
        if (!Array.isArray(notes) || !Number.isFinite(bpm) || bpm <= 0) return [];
        return notes.map(n => ({
            start: beatsToSeconds(n.time, bpm),
            end: beatsToSeconds(n.time + Math.max(0.001, n.duration), bpm),
            freq: midiToHz(n.pitch),
            gain: Math.max(0, Math.min(1, n.velocity / 127)),
        }));
    }

    /**
     * Total loop length in seconds. Determined by the latest note end OR
     * by an explicit clip length in beats (preferred — patterns might
     * not actually use the full bar count).
     */
    function loopSeconds(schedule, clipBeats, bpm) {
        const fromClip = (Number.isFinite(clipBeats) && clipBeats > 0)
            ? beatsToSeconds(clipBeats, bpm)
            : 0;
        let latest = 0;
        for (const n of schedule) {
            if (n.end > latest) latest = n.end;
        }
        return Math.max(fromClip, latest);
    }

    // ─── Audio engine (browser only) ──────────────────────────

    let _ctx = null;
    let _master = null;
    let _activeVoices = [];
    let _loopTimer = null;
    let _onStop = null;
    let _playing = false;

    function ensureContext() {
        if (_ctx) return _ctx;
        if (typeof window === 'undefined') return null;
        const AC = window.AudioContext || window.webkitAudioContext;
        if (!AC) return null;
        _ctx = new AC();
        // Master chain: compressor + final gain. Tames spiky velocities.
        const comp = _ctx.createDynamicsCompressor();
        comp.threshold.value = -18;
        comp.knee.value = 18;
        comp.ratio.value = 4;
        comp.attack.value = 0.005;
        comp.release.value = 0.12;
        _master = _ctx.createGain();
        _master.gain.value = 0.55;
        comp.connect(_master);
        _master.connect(_ctx.destination);
        // Expose where individual voices connect to
        _master._voiceInput = comp;
        return _ctx;
    }

    function scheduleVoice(ctx, voiceTarget, note, atTime) {
        // Two slightly detuned saws → low-pass filter → ADSR amp → master
        const osc1 = ctx.createOscillator();
        const osc2 = ctx.createOscillator();
        osc1.type = 'sawtooth';
        osc2.type = 'sawtooth';
        osc1.frequency.value = note.freq;
        osc2.frequency.value = note.freq;
        osc1.detune.value = -6;
        osc2.detune.value = +6;

        const filt = ctx.createBiquadFilter();
        filt.type = 'lowpass';
        // Open the filter further at high velocity for brightness
        filt.frequency.value = Math.min(8000, 600 + note.gain * 4400);
        filt.Q.value = 1.2;

        const amp = ctx.createGain();
        amp.gain.value = 0;

        osc1.connect(filt);
        osc2.connect(filt);
        filt.connect(amp);
        amp.connect(voiceTarget);

        const dur = Math.max(0.05, note.end - note.start);
        const peak = 0.18 * note.gain;
        const a = 0.005;
        const d = Math.min(0.08, dur * 0.3);
        const sustain = peak * 0.7;
        const r = Math.min(0.15, dur * 0.4);

        // ADSR: attack, decay-to-sustain, release at note end
        amp.gain.setValueAtTime(0, atTime);
        amp.gain.linearRampToValueAtTime(peak, atTime + a);
        amp.gain.linearRampToValueAtTime(sustain, atTime + a + d);
        amp.gain.setValueAtTime(sustain, atTime + dur - r);
        amp.gain.linearRampToValueAtTime(0, atTime + dur + 0.01);

        osc1.start(atTime);
        osc2.start(atTime);
        const stopAt = atTime + dur + 0.05;
        osc1.stop(stopAt);
        osc2.stop(stopAt);

        const voice = { osc1, osc2, filt, amp, stopAt };
        _activeVoices.push(voice);
        return voice;
    }

    function playOnce(ctx, target, schedule, t0) {
        for (const note of schedule) {
            scheduleVoice(ctx, target, note, t0 + note.start);
        }
    }

    function play(notes, bpm, opts) {
        opts = opts || {};
        const ctx = ensureContext();
        if (!ctx || !_master) {
            console.warn('[Stride] AudioContext unavailable for audition');
            return false;
        }
        // Browsers suspend audio context until user gesture — resume.
        if (ctx.state === 'suspended' && typeof ctx.resume === 'function') {
            ctx.resume().catch(() => {});
        }

        stop(); // clear any prior playback

        const schedule = buildSchedule(notes, bpm);
        const loopLen = loopSeconds(schedule, opts.clipBeats, bpm);
        if (loopLen <= 0 || schedule.length === 0) {
            console.warn('[Stride] Empty schedule, nothing to audition');
            return false;
        }

        _onStop = (typeof opts.onStop === 'function') ? opts.onStop : null;
        const shouldLoop = opts.loop !== false;
        _playing = true;

        const startTime = ctx.currentTime + 0.05;
        playOnce(ctx, _master._voiceInput, schedule, startTime);

        if (shouldLoop) {
            const loopMs = loopLen * 1000;
            let nextStart = startTime + loopLen;
            const tick = () => {
                if (!_playing) return;
                playOnce(ctx, _master._voiceInput, schedule, nextStart);
                nextStart += loopLen;
                _loopTimer = setTimeout(tick, loopMs);
            };
            _loopTimer = setTimeout(tick, loopMs);
        } else {
            // Non-loop: schedule a stop callback at end
            _loopTimer = setTimeout(() => {
                if (_playing) stop();
            }, loopLen * 1000 + 100);
        }
        return true;
    }

    function stop() {
        if (_loopTimer) { clearTimeout(_loopTimer); _loopTimer = null; }
        const now = _ctx ? _ctx.currentTime : 0;
        for (const v of _activeVoices) {
            try {
                v.amp.gain.cancelScheduledValues(now);
                v.amp.gain.setValueAtTime(v.amp.gain.value || 0, now);
                v.amp.gain.linearRampToValueAtTime(0, now + 0.02);
                v.osc1.stop(now + 0.05);
                v.osc2.stop(now + 0.05);
            } catch (e) { /* already stopped */ }
        }
        _activeVoices = [];
        const wasPlaying = _playing;
        _playing = false;
        if (wasPlaying && _onStop) {
            try { _onStop(); } catch (e) {}
        }
        _onStop = null;
    }

    function isPlaying() { return _playing; }

    return {
        // Public
        play, stop, isPlaying,
        // Test exports
        midiToHz, beatsToSeconds, buildSchedule, loopSeconds,
    };
}));
