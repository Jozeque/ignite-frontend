#pragma once
#include <juce_core/juce_core.h>
#include "SpectrumEngine.h"
#include <cmath>
#include <cstring>

// ============================================================
// TENDRIL — PartialOsc: per-voice renderer of the shared spectrum
// ============================================================
// Reads SpectrumEngine's master[80] and renders one band-limited
// single-cycle frame (512 samples) by integer-exact LUT additive
// synthesis. Re-renders only when the engine version or the note's
// octave bucket changes; crossfades frames per block (click-free).
// Harmonics above Nyquist for the playing note are dropped -> the
// oscillator cannot alias by construction.
// ============================================================
class PartialOsc
{
public:
    static constexpr int N    = 1024;   // 2x table resolution (anti-imaging)
    static constexpr int LUTN = 2048;

    PartialOsc()
    {
        std::memset(frameA, 0, sizeof(frameA));
        std::memset(frameB, 0, sizeof(frameB));
        cur = frameA; prv = frameB;
    }

    // call at block start; regenerates if the spectrum or pitch range moved
    void update(const SpectrumEngine& eng, float f0overSr)
    {
        const uint32_t v = eng.getVersion();
        const float bucket = std::floor(std::log2(juce::jmax(1.0e-5f, f0overSr)) * 4.0f);
        if (v == lastVersion && bucket == lastBucket) return;
        lastVersion = v; lastBucket = bucket;
        regen(eng.getMaster(), f0overSr);
    }

    void startBlock(int numSamples) noexcept
    {
        fadeInc = 1.0f / (float) juce::jmax(32, numSamples);
    }

    inline float read(float ph) noexcept
    {
        const float idx = ph * N;
        int i1 = (int) idx;
        const float t = idx - (float) i1;
        i1 &= (N - 1);
        const int i0 = (i1 - 1) & (N - 1);
        const int i2 = (i1 + 1) & (N - 1);
        const int i3 = (i1 + 2) & (N - 1);

        // Catmull-Rom (4-point cubic): far lower imaging than linear interp
        const float a = crRead(cur, i0, i1, i2, i3, t);
        if (fade >= 1.0f) return a;
        const float b = prv[i1] + t * (prv[i2] - prv[i1]);   // fading-out frame: linear is fine
        const float m = a * fade + b * (1.0f - fade);
        fade = juce::jmin(1.0f, fade + fadeInc);
        return m;
    }

private:
    static const float* sineLut()
    {
        static float lut[LUTN];
        static bool init = false;
        if (!init)
        {
            for (int i = 0; i < LUTN; ++i)
                lut[i] = std::sin(2.0 * juce::MathConstants<double>::pi * i / LUTN);
            init = true;
        }
        return lut;
    }

    static inline float crRead(const float* f, int i0, int i1, int i2, int i3, float t) noexcept
    {
        const float p0 = f[i0], p1 = f[i1], p2 = f[i2], p3 = f[i3];
        const float a0 = -0.5f*p0 + 1.5f*p1 - 1.5f*p2 + 0.5f*p3;
        const float a1 =        p0 - 2.5f*p1 + 2.0f*p2 - 0.5f*p3;
        const float a2 = -0.5f*p0            + 0.5f*p2;
        return ((a0 * t + a1) * t + a2) * t + p1;
    }

    void regen(const float* amps, float f0overSr)
    {
        // 0.378 = 0.45 with /1.19 headroom: the regen pitch-bucket is a
        // quarter-octave wide, so a note can run ~19% above the regen
        // reference — the margin keeps the top harmonic under Nyquist
        // across the whole bucket (no aliasing window).
        const int nyq = (int) (0.378f / juce::jmax(1.0e-5f, f0overSr));
        const int K = juce::jlimit(1, SpectrumEngine::NP, nyq);

        std::swap(cur, prv);
        std::memset(cur, 0, sizeof(float) * N);
        const float* lut = sineLut();
        for (int h = 1; h <= K; ++h)
        {
            const float a = amps[h - 1];
            if (a < 1.0e-5f) continue;
            const int step = h * (LUTN / N);   // N=1024, LUTN=2048 -> step=2h, integer-exact
            int idx = 0;
            for (int i = 0; i < N; ++i)
            {
                cur[i] += a * lut[idx];
                idx = (idx + step) & (LUTN - 1);
            }
        }
        fade = 0.0f;
    }

    float frameA[N], frameB[N];
    float* cur = nullptr;
    float* prv = nullptr;
    float fade = 1.0f, fadeInc = 1.0f / 64.0f;
    uint32_t lastVersion = 0;
    float lastBucket = -999.0f;
};
