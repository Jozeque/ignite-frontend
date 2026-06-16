#pragma once
#include <juce_audio_processors/juce_audio_processors.h>
#include "Modulation.h"
#include <array>
#include <atomic>
#include <cmath>
#include <cstring>

// ============================================================
// TENDRIL — SpectrumEngine (the creative surface)
// ============================================================
// One 80-partial harmonic spectrum is the instrument's primary surface:
//   - 5 painted SCENES, morphed by one control (sqrt-amplitude domain)
//   - PAINT with INTER-HARMONIC RULES applied in-engine (spread / odd-even
//     / energy-conserve) so a single bar-edit cascades — and the cascaded
//     result is pushed back to the canvas
//   - GESTURE recorder: the act of drawing captured as 30 Hz full-vector
//     frames; loops; rate 0.25x..4x; blended over the live morph
//   - MACRO SHAPERS on top: Tilt / Spread / Skew / Density / Comb
//   - per-block FEATURES (centroid, active density, energy) — the spectrum
//     as a modulation source for the grain/FX cascade (next phases)
// Audio thread renders master[] once per block; voices read it versioned.
// ============================================================
class SpectrumEngine
{
public:
    static constexpr int NP        = 80;     // partials
    static constexpr int NSCENES   = 5;
    static constexpr int GFPS      = 30;     // gesture frames / sec
    static constexpr int GMAXSEC   = 12;
    static constexpr int GMAXFRAME = GFPS * GMAXSEC;

    SpectrumEngine()
    {
        // factory scenes: five distinct, musical starting spectra
        for (int s = 0; s < NSCENES; ++s)
            for (int k = 1; k <= NP; ++k)
            {
                const float h = (float) k;
                float a = 0.f;
                switch (s)
                {
                    case 0: a = 1.0f / h; break;                                   // saw
                    case 1: a = (k % 2 == 1) ? 1.0f / h : 0.0f; break;             // square/odd
                    case 2: a = std::exp(-(h - 6.f)*(h - 6.f) / 30.f)
                              + 0.6f * std::exp(-(h - 20.f)*(h - 20.f) / 60.f); break; // vowel-ish
                    case 3: a = (k % 5 == 1) ? 0.9f / std::sqrt(h) : 0.05f / h; break; // organ/comb
                    case 4: a = 1.0f / (h * h) + (k > 40 ? 0.25f / h : 0.f); break;    // dark + air
                }
                scenes[(size_t) s][(size_t)(k - 1)] = juce::jlimit(0.f, 1.f, a);
            }
        scenes[0][0] = 1.0f;
        bumpVersion();
    }

    void setState(ModHub& hub)
    {
        auto p = [&hub](const char* id){ return hub.ptr(id); };   // reads effective (modulated) values
        pMorph=p("scene_morph"); pTilt=p("tilt"); pSpread=p("spread"); pSkew=p("skew");
        pDensity=p("density"); pComb=p("comb");
        pRulesAmt=p("rules_amt"); pRMode=p("rmode");
        pGestAmt=p("gest_amt"); pGestRate=p("gest_rate");
    }

    // ---------- painting (message thread) ----------
    // paint partial k (0..NP-1) to value v in the ACTIVE scene, applying the
    // selected inter-harmonic rule. Returns via getScene() for UI echo.
    void paintPartial(int k, float v)
    {
        if (k < 0 || k >= NP) return;
        const juce::SpinLock::ScopedLockType sl(lock);
        auto& sc = scenes[(size_t) activeScene];
        const float oldV = sc[(size_t) k];
        const float newV = juce::jlimit(0.f, 1.f, v);
        const float dv = newV - oldV;
        sc[(size_t) k] = newV;

        const float amt = ld(pRulesAmt);
        if (amt > 0.001f && std::abs(dv) > 1.0e-5f)
        {
            const int mode = (int) std::lround(ld(pRMode));
            switch (mode)
            {
                case 0: // SPREAD: neighbors follow with gaussian falloff
                {
                    const float sigma = 1.5f + amt * 6.0f;
                    for (int j = 0; j < NP; ++j)
                    {
                        if (j == k) continue;
                        const float d = (float)(j - k);
                        const float w = std::exp(-(d * d) / (2.0f * sigma * sigma));
                        sc[(size_t) j] = juce::jlimit(0.f, 1.f, sc[(size_t) j] + dv * amt * w);
                    }
                    break;
                }
                case 1: // ODD/EVEN: same-parity partials follow, fading with distance
                {
                    for (int j = (k % 2); j < NP; j += 2)
                    {
                        if (j == k) continue;
                        const float w = 1.0f / (1.0f + 0.15f * std::abs((float)(j - k)));
                        sc[(size_t) j] = juce::jlimit(0.f, 1.f, sc[(size_t) j] + dv * amt * 0.6f * w);
                    }
                    break;
                }
                case 2: // CONSERVE: total energy stays put — others give way
                {
                    float others = 1.0e-6f;
                    for (int j = 0; j < NP; ++j) if (j != k) others += sc[(size_t) j];
                    const float scale = juce::jmax(0.f, 1.0f - (dv * amt) / others);
                    for (int j = 0; j < NP; ++j)
                        if (j != k) sc[(size_t) j] = juce::jlimit(0.f, 1.f, sc[(size_t) j] * scale);
                    break;
                }
                default: break;
            }
        }
        bumpVersion();
    }

    void selectScene(int s) { activeScene = juce::jlimit(0, NSCENES - 1, s); bumpVersion(); }
    int  getActiveScene() const noexcept { return activeScene; }

    void copySceneTo(int dst)   // store current ACTIVE scene into another slot
    {
        dst = juce::jlimit(0, NSCENES - 1, dst);
        const juce::SpinLock::ScopedLockType sl(lock);
        scenes[(size_t) dst] = scenes[(size_t) activeScene];
        bumpVersion();
    }

    // ---------- gesture (record the act of drawing) ----------
    // looper-style: starting record clears + stops playback; STOPPING auto-loops what you captured
    void setGestureRecord(bool on) noexcept
    {
        gRecArm = on;
        if (on) { gLen = 0; gPlay = false; gFrameAcc = 0.0; }
        else if (gLen > 1) { gPlay = true; gPos = 0.0; }
    }
    void setGesturePlay(bool on) noexcept   { gPlay = on; gPos = 0.0; }
    void clearGesture() noexcept            { gRecArm = false; gPlay = false; gLen = 0; gPos = 0.0; gFrameAcc = 0.0; }
    bool isGestureRecording() const noexcept { return gRecArm; }
    bool isGesturePlaying()  const noexcept { return gPlay; }
    int  gestureFrames()     const noexcept { return gLen; }

    // ---------- audio thread: render master spectrum once per block ----------
    void processBlock(double sampleRate, int numSamples)
    {
        sampleRate = juce::jmax(1.0, sampleRate);   // guard: never divide by zero / infinite-loop
        const juce::SpinLock::ScopedTryLockType sl(lock);
        if (!sl.isLocked()) return;                 // painter mid-edit: keep last master

        // 1) scene morph (sqrt-amplitude domain = perceptually smoother)
        const float m = juce::jlimit(0.f, 1.f, ld(pMorph)) * (NSCENES - 1);
        const int s0 = juce::jlimit(0, NSCENES - 1, (int) m);
        const int s1 = juce::jlimit(0, NSCENES - 1, s0 + 1);
        const float f = m - (float) s0;
        float work[NP];
        for (int k = 0; k < NP; ++k)
        {
            const float a = std::sqrt(scenes[(size_t) s0][(size_t) k]);
            const float b = std::sqrt(scenes[(size_t) s1][(size_t) k]);
            const float v = a + f * (b - a);
            work[k] = v * v;
        }

        // 2) gesture record / replay
        if (gRecArm)
        {
            gFrameAcc += numSamples;
            const double frameLen = sampleRate / (double) GFPS;
            while (gFrameAcc >= frameLen && gLen < GMAXFRAME)
            {
                gFrameAcc -= frameLen;
                std::memcpy(gFrames[(size_t) gLen].data(), work, sizeof(work));
                ++gLen;
            }
            if (gLen >= GMAXFRAME) { gRecArm = false; gPlay = true; gPos = 0.0; }   // ring full -> auto stop + loop
        }
        const float gAmt = ld(pGestAmt);
        if (gPlay && gLen > 1 && gAmt > 0.001f)
        {
            const float rate = std::pow(2.0f, (ld(pGestRate) - 0.5f) * 4.0f);  // 0.25x..4x
            gPos += (double) numSamples / sampleRate * GFPS * rate;
            gPos = std::fmod(gPos, (double) gLen);                             // loop (bounded)
            if (gPos < 0.0) gPos += (double) gLen;
            const int i0 = (int) gPos, i1 = (i0 + 1) % gLen;
            const float ff = (float)(gPos - (double) i0);
            for (int k = 0; k < NP; ++k)
            {
                const float gv = gFrames[(size_t) i0][(size_t) k]
                               + ff * (gFrames[(size_t) i1][(size_t) k] - gFrames[(size_t) i0][(size_t) k]);
                work[k] += gAmt * (gv - work[k]);
            }
        }

        // 3) macro shapers
        const float spread = juce::jlimit(0.f, 1.f, pSpread ? ld(pSpread) : 0.5f);
        const float skew   = juce::jlimit(0.f, 1.f, pSkew   ? ld(pSkew)   : 0.5f);
        const float dens   = juce::jlimit(0.f, 1.f, ld(pDensity));
        const float comb   = juce::jlimit(0.f, 1.f, ld(pComb));
        const float tilt   = juce::jlimit(0.f, 1.f, ld(pTilt));

        // spread+skew: gaussian window over the series; spread=1 -> fully open
        if (spread < 0.999f)
        {
            const float c = 1.0f + skew * (NP - 1);
            const float w = 2.0f + spread * spread * 220.0f;     // narrow .. wide
            for (int k = 0; k < NP; ++k)
            {
                const float d = ((float)(k + 1) - c) / w;
                work[k] *= std::exp(-d * d * 3.0f);
            }
        }
        // density: soft gate — fewer partials engaged as it closes
        if (dens < 0.999f)
        {
            float mx = 1.0e-6f;
            for (int k = 0; k < NP; ++k) mx = juce::jmax(mx, work[k]);
            const float th = (1.0f - dens) * mx * 0.92f;
            for (int k = 0; k < NP; ++k)
            {
                const float t = (work[k] - th) / (mx * 0.18f + 1.0e-6f);
                work[k] *= juce::jlimit(0.f, 1.f, t * 0.5f + 0.5f);
            }
        }
        // comb: fractional-period sieve
        if (comb > 0.001f)
        {
            const float per = 2.0f + comb * 14.0f;
            const float dep = juce::jmin(1.0f, comb * 1.4f);
            for (int k = 0; k < NP; ++k)
                work[k] *= 1.0f - dep * (0.5f + 0.5f * std::cos(2.0f * juce::MathConstants<float>::pi * (float)(k + 1) / per));
        }
        // tilt: bounded spectral slope
        {
            const float e = (tilt - 0.5f) * 1.2f;
            for (int k = 0; k < NP; ++k)
                work[k] *= std::pow((float)(k + 1), e);
        }

        // 4) soft headroom (NO normalization — painting dynamics + the
        //    conserve rule must stay meaningful; just cap hot spectra)
        float energy = 1.0e-9f;
        for (int k = 0; k < NP; ++k) energy += work[k] * work[k];
        const float rms = std::sqrt(energy);
        const float cap = (rms > 1.2f) ? 1.2f / rms : 1.0f;

        // 5) publish master + features
        float cw = 0.f, cwk = 0.f; int active = 0;
        for (int k = 0; k < NP; ++k)
        {
            const float v = work[k] * cap * 0.55f;
            master[(size_t) k] = v;
            cw += v; cwk += v * (float)(k + 1);
            if (v > 0.01f) ++active;
        }
        featCentroid.store(cw > 1.0e-6f ? (cwk / cw) / (float) NP : 0.f);  // 0..1 brightness
        featDensity.store((float) active / (float) NP);
        featEnergy.store(juce::jmin(1.0f, rms));

        // version bump only when audible content changed
        float diff = 0.f;
        for (int k = 0; k < NP; ++k) diff = juce::jmax(diff, std::abs(master[(size_t) k] - lastPub[(size_t) k]));
        if (diff > 1.0e-4f)
        {
            lastPub = master;
            renderVersion.fetch_add(1, std::memory_order_release);
        }
    }

    // voices read these (audio thread)
    const float* getMaster() const noexcept { return master.data(); }
    uint32_t getVersion() const noexcept { return renderVersion.load(std::memory_order_acquire); }

    // spectrum-as-modulation-source (cascade wiring in later phases)
    float centroid() const noexcept { return featCentroid.load(); }
    float densityFeature() const noexcept { return featDensity.load(); }
    float energyFeature() const noexcept { return featEnergy.load(); }

    // UI echo (message thread)
    void getSceneSnapshot(float* out80) const
    {
        const juce::SpinLock::ScopedLockType sl(lock);
        std::memcpy(out80, scenes[(size_t) activeScene].data(), sizeof(float) * NP);
    }
    void getMasterSnapshot(float* out80) const { std::memcpy(out80, master.data(), sizeof(float) * NP); }

    // ---------- persistence ----------
    juce::String scenesToString() const
    {
        const juce::SpinLock::ScopedLockType sl(lock);
        juce::StringArray all;
        for (const auto& sc : scenes)
            for (float v : sc) all.add(juce::String(v, 5));
        return all.joinIntoString(",");
    }
    void scenesFromString(const juce::String& s)
    {
        juce::StringArray t; t.addTokens(s, ",", "");
        if (t.size() < NP * NSCENES) return;
        const juce::SpinLock::ScopedLockType sl(lock);
        int i = 0;
        for (auto& sc : scenes)
            for (auto& v : sc) v = juce::jlimit(0.f, 1.f, t[i++].getFloatValue());
        bumpVersion();
    }

private:
    void bumpVersion() noexcept { renderVersion.fetch_add(1, std::memory_order_release); }
    inline float ld(std::atomic<float>* p) const noexcept { return p ? p->load() : 0.0f; }

    std::atomic<float> *pMorph=nullptr,*pTilt=nullptr,*pSpread=nullptr,*pSkew=nullptr,
        *pDensity=nullptr,*pComb=nullptr,*pRulesAmt=nullptr,*pRMode=nullptr,
        *pGestAmt=nullptr,*pGestRate=nullptr;

    mutable juce::SpinLock lock;
    std::array<std::array<float, NP>, NSCENES> scenes {};
    int activeScene = 0;

    // gesture ring (preallocated — no audio-thread allocation)
    std::array<std::array<float, NP>, GMAXFRAME> gFrames {};
    int gLen = 0;
    bool gRecArm = false, gPlay = false;
    double gPos = 0.0, gFrameAcc = 0.0;

    std::array<float, NP> master {};
    std::array<float, NP> lastPub {};
    std::atomic<uint32_t> renderVersion { 1 };
    std::atomic<float> featCentroid { 0.f }, featDensity { 0.f }, featEnergy { 0.f };
};
