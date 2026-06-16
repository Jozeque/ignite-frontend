#pragma once
#include <juce_audio_processors/juce_audio_processors.h>
#include "Params.h"
#include <array>
#include <vector>
#include <atomic>
#include <unordered_map>
#include <cmath>

// ============================================================
// TENDRIL — Motion (Tendril self-modulates: Stride, built in)
// ============================================================
// ModHub  : a central "effective value" per parameter. The DSP reads
//           hub.eff[] instead of the raw APVTS atomics, so modulation can
//           orbit the knob without ever writing host params. Each block the
//           processor copies base->eff, then ModEngine overlays armed params.
//
// ModEngine: 4 curve generators (Reflector / S&H / Neuro / Chaos), ported
//           1:1 from Stride's canvas.js. The whole loop is LENGTH BARS long
//           (4/8/16/32) and every BAR is independently re-rolled -> the motion
//           evolves for the full phrase before it repeats, exactly like Stride
//           (a 32-bar S&H = 32 unique bars). Each ARMED param gets its own
//           seeded curve. Mutate = reseed (fresh per-bar rolls everywhere).
//           effective = base*(1-depth) + curve*depth.
// ============================================================

class ModHub
{
public:
    static constexpr int MAX = 96;

    // engines call this once (in setState) -> stable pointer into eff[]
    std::atomic<float>* ptr(const juce::String& id) { return &eff[(size_t) reg(id)]; }
    int indexOf(const juce::String& id) const
    {
        auto it = index.find(id);
        return it == index.end() ? -1 : it->second;
    }
    int size() const noexcept { return count; }
    float minOf(int i) const noexcept { return pmin[(size_t) i]; }
    float maxOf(int i) const noexcept { return pmax[(size_t) i]; }

    // bind base sources + ranges from the APVTS (after params exist)
    void bind(juce::AudioProcessorValueTreeState& apvts)
    {
        for (const auto& sp : tendril::specs())
        {
            const int i = reg(sp.id);
            base[(size_t) i] = apvts.getRawParameterValue(sp.id);
            pmin[(size_t) i] = sp.min; pmax[(size_t) i] = sp.max;
        }
        for (const char* cid : { "ftype", "dtype", "rmode" })
        {
            const int i = reg(cid);
            base[(size_t) i] = apvts.getRawParameterValue(cid);
            pmin[(size_t) i] = 0.f; pmax[(size_t) i] = 1.f;
        }
    }

    // copy base -> eff for every registered param (call at block start)
    void copyBase() noexcept
    {
        for (int i = 0; i < count; ++i)
            if (base[(size_t) i]) eff[(size_t) i].store(base[(size_t) i]->load(std::memory_order_relaxed),
                                                        std::memory_order_relaxed);
    }
    float baseValue(int i) const noexcept
    {
        return base[(size_t) i] ? base[(size_t) i]->load(std::memory_order_relaxed) : 0.0f;
    }
    void setEff(int i, float v) noexcept { eff[(size_t) i].store(v, std::memory_order_relaxed); }
    float effValue(int i) const noexcept
    {
        return (i >= 0 && i < MAX) ? eff[(size_t) i].load(std::memory_order_relaxed) : 0.0f;
    }

private:
    int reg(const juce::String& id)
    {
        auto it = index.find(id);
        if (it != index.end()) return it->second;
        const int i = count < MAX ? count++ : MAX - 1;
        index[id] = i;
        eff[(size_t) i].store(0.f); base[(size_t) i] = nullptr; pmin[(size_t) i] = 0.f; pmax[(size_t) i] = 1.f;
        return i;
    }

    std::atomic<float> eff[MAX] {};
    std::atomic<float>* base[MAX] {};
    float pmin[MAX] {}, pmax[MAX] {};
    std::unordered_map<juce::String, int> index;
    int count = 0;
};

// ────────────────────────────────────────────────────────────
class ModEngine
{
public:
    // Resolution of the per-param loop table. Covers the WHOLE phrase
    // (up to 32 bars = 128 beats -> 32 samples/beat), so per-bar detail
    // and fast S&H/stutter steps survive. Regenerated only on
    // arm / mutate / type / length change (never per audio block).
    static constexpr int TBL = 4096;

    enum Type { Reflector = 0, SampleHold = 1, Neuro = 2, Chaos = 3 };

    void prepare(double sr) { sampleRate = juce::jmax(1.0, sr); }

    void setState(juce::AudioProcessorValueTreeState& apvts, ModHub* h)
    {
        hub = h;
        pType   = apvts.getRawParameterValue("motion_type");
        pLength = apvts.getRawParameterValue("motion_length");
        pRate   = apvts.getRawParameterValue("motion_rate");
        pOn     = apvts.getRawParameterValue("motion_on");
        pDepth  = apvts.getRawParameterValue("motion_depth");
        tables.assign(ModHub::MAX, std::array<float, TBL>{});
        tblSeed.assign(ModHub::MAX, 0);
        tblType.assign(ModHub::MAX, -1);
        tblBars.assign(ModHub::MAX, -1);
    }

    // arming (by hub param index)
    void setArmed(int idx, bool on) { if (idx >= 0 && idx < ModHub::MAX) armed[(size_t) idx] = on; }
    bool isArmed(int idx) const { return idx >= 0 && idx < ModHub::MAX && armed[(size_t) idx]; }
    uint64_t armedMask() const
    {
        uint64_t m = 0; for (int i = 0; i < 64 && i < ModHub::MAX; ++i) if (armed[(size_t) i]) m |= (1ull << i);
        return m;
    }
    void setArmedMask(uint64_t m) { for (int i = 0; i < 64 && i < ModHub::MAX; ++i) armed[(size_t) i] = (m >> i) & 1ull; }

    bool isOn() const noexcept { return pOn && pOn->load() > 0.5f; }
    void mutate() { ++seed; }                 // reseed -> all armed curves regenerate
    uint32_t getSeed() const { return seed; }
    void setSeed(uint32_t s) { seed = s; }

    // per audio block
    void process(int numSamples, juce::AudioPlayHead* ph)
    {
        if (hub == nullptr) return;
        const bool on = pOn && pOn->load() > 0.5f;
        if (!on) return;                       // motion off -> eff stays = base

        const int type = pType ? (int) std::lround(pType->load()) : 0;
        const float depth = pDepth ? juce::jlimit(0.f, 1.f, pDepth->load()) : 0.5f;
        static const int   barsTbl[4] = { 4, 8, 16, 32 };          // LOOP LENGTH IN BARS (== Stride)
        static const float rateMul[3] = { 0.5f, 1.0f, 2.0f };
        const int   bars = barsTbl[juce::jlimit(0, 3, pLength ? (int) std::lround(pLength->load()) : 1)];
        const float rate = rateMul [juce::jlimit(0, 2, pRate   ? (int) std::lround(pRate->load())   : 1)];
        const float lenB = (float) bars * 4.0f;                    // phrase length in beats

        // ---- transport phase (0..1 over the whole phrase) ----
        double bpm = 120.0; bool playing = false; double ppq = 0.0;
        if (ph != nullptr)
        {
            if (auto pos = ph->getPosition())
            {
                if (auto b = pos->getBpm())          bpm = *b;
                if (auto q = pos->getPpqPosition())  ppq = *q;
                playing = pos->getIsPlaying();
            }
        }
        float phase;
        if (playing)
            phase = (float) wrap01(ppq / (double) lenB * (double) rate);
        else
        {
            freePhase += (double) numSamples / sampleRate * (bpm / 60.0) / (double) lenB * (double) rate;
            freePhase = wrap01(freePhase);
            phase = (float) freePhase;
        }

        // ---- overlay each armed param ----
        const float fidx = phase * (TBL - 1);
        const int   i0 = (int) fidx;
        const float fr = fidx - (float) i0;
        const int   i1 = juce::jmin(TBL - 1, i0 + 1);

        for (int p = 0; p < hub->size(); ++p)
        {
            if (!armed[(size_t) p]) continue;
            if (tblType[(size_t) p] != type || tblSeed[(size_t) p] != seed || tblBars[(size_t) p] != bars)
                regen(p, type, bars);

            const float curve = tables[(size_t) p][(size_t) i0]
                              + fr * (tables[(size_t) p][(size_t) i1] - tables[(size_t) p][(size_t) i0]);

            const float lo = hub->minOf(p), hi = hub->maxOf(p);
            const float span = (hi - lo);
            const float baseN = span > 1.0e-9f ? (hub->baseValue(p) - lo) / span : 0.f;
            const float effN  = juce::jlimit(0.f, 1.f, baseN * (1.0f - depth) + curve * depth);
            hub->setEff(p, lo + effN * span);
        }
    }

private:
    static inline double wrap01(double x) noexcept { x -= std::floor(x); return x; }

    // deterministic per-(param,seed) RNG  (xorshift, 24-bit mantissa)
    struct XOr { uint32_t s; inline float f01() { s ^= s<<13; s ^= s>>17; s ^= s<<5; return (s & 0xFFFFFF) / 16777215.0f; } };
    static inline uint32_t keyOf(uint32_t seed, int p)
    { return (seed * 2654435761u) ^ (uint32_t)(p + 1) * 40503u ^ 0xABCDu; }

    // ---- table writers (beat-space -> sample index) ----
    static inline int b2i(float beat, float s2b) noexcept
    { return juce::jlimit(0, TBL, (int) std::lround(beat * s2b)); }

    static void stepFill(float* t, float s2b, float a, float b, float v) noexcept
    { const int i1 = b2i(b, s2b); for (int i = b2i(a, s2b); i < i1; ++i) t[(size_t) i] = v; }

    static void rampFill(float* t, float s2b, float a, float b, float va, float vb) noexcept
    {
        const int i0 = b2i(a, s2b), i1 = b2i(b, s2b);
        if (i1 <= i0) { if (i0 >= 0 && i0 < TBL) t[(size_t) i0] = vb; return; }
        for (int i = i0; i < i1; ++i)
            t[(size_t) i] = va + (vb - va) * ((float)(i - i0) / (float)(i1 - i0));
    }

    static void normalize(float* t, float lo, float hi)
    {
        float mn = 1.0e9f, mx = -1.0e9f;
        for (int i = 0; i < TBL; ++i) { mn = juce::jmin(mn, t[i]); mx = juce::jmax(mx, t[i]); }
        const float sp = (mx - mn) > 1.0e-6f ? (mx - mn) : 1.0f;
        for (int i = 0; i < TBL; ++i) t[i] = lo + (t[i] - mn) / sp * (hi - lo);
    }

    // ========================================================
    // GENERATORS — ports of Stride's canvas.js curve makers.
    // Each fills the table across the FULL phrase (totalBeats),
    // re-rolling per bar / per chunk so it never repeats within
    // the loop. s2b = samples per beat.
    // ========================================================

    // SAMPLE & HOLD  (canvas.js sdApplyGlobalSampleHold)
    // bar-aligned sections; rate pool (straight + triplets); 50% rate
    // stickiness; full-range values with a 0.15 min jump; hard steps.
    static void genSampleHold(XOr& r, float* t, float totalBeats, float s2b)
    {
        static const float RATES[8] = { 2.f, 1.f, 0.5f, 0.25f, 0.125f, 4.f/6.f, 2.f/6.f, 1.f/6.f };
        const float MIN_DELTA = 0.15f;
        float lastV = -1.0f, prevRate = -1.0f, secStart = 0.0f;
        while (secStart < totalBeats - 1.0e-4f)
        {
            const float secEnd = juce::jmin((std::floor(secStart / 4.0f) + 1.0f) * 4.0f, totalBeats);
            const float rate = (prevRate > 0.0f && r.f01() < 0.5f)
                             ? prevRate : RATES[(int)(r.f01() * 8.0f) & 7];
            prevRate = rate;
            float tt = secStart;
            while (tt < secEnd - 1.0e-4f)
            {
                const float stepEnd = juce::jmin(tt + rate, secEnd);
                float v = 0.5f; int tries = 0;
                do { v = r.f01(); ++tries; }
                while (lastV >= 0.0f && std::abs(v - lastV) < MIN_DELTA && tries < 12);
                lastV = v;
                stepFill(t, s2b, tt, stepEnd, v);
                tt = stepEnd;
            }
            secStart = secEnd;
        }
    }

    // NEURO  (canvas.js sdApplyGlobalNeuro + sdInjectShape)
    // fill timeline with random 0.5..4 beat chunks, each a random shape
    // from an 8-entry pool -> dense, ever-changing aggressive motion.
    static void genNeuro(XOr& r, float* t, float totalBeats, float s2b)
    {
        static const float chunks[5] = { 0.5f, 1.0f, 1.5f, 2.0f, 4.0f };
        float cB = 0.0f;
        while (cB < totalBeats - 1.0e-3f)
        {
            float chunk = chunks[(int)(r.f01() * 5.0f) % 5];
            if (cB + chunk > totalBeats) chunk = totalBeats - cB;
            injectNeuroShape(r, t, s2b, cB, chunk, (int)(r.f01() * 8.0f) % 8);
            cB += chunk;
        }
    }

    static void injectNeuroShape(XOr& r, float* t, float s2b, float cB, float c, int shape)
    {
        const float end = cB + c;
        switch (shape)
        {
            case 0: { // dotted_ramp: rise to a peak at 75%, hard drop
                const float pk = 0.4f + r.f01() * 0.6f;
                rampFill(t, s2b, cB, cB + c * 0.75f, 0.0f, pk);
                stepFill(t, s2b, cB + c * 0.75f, end, 0.0f);
            } break;
            case 1: { // mid_value_hold: sustained mid + two accents
                const float mid = 0.15f + r.f01() * 0.35f;
                const float p1 = 0.7f + r.f01() * 0.3f, p2 = 0.7f + r.f01() * 0.3f;
                stepFill(t, s2b, cB, end, mid);
                stepFill(t, s2b, cB + c * 0.22f, cB + c * 0.30f, p1);
                stepFill(t, s2b, cB + c * 0.70f, cB + c * 0.78f, p2);
            } break;
            case 2: { // offgrid_saw: golden-ratio sawtooth breakpoints
                static const float bp[4] = { 0.216f, 0.414f, 0.618f, 0.88f };
                float prev = 0.0f;
                for (int k = 0; k < 4; ++k)
                { rampFill(t, s2b, cB + prev * c, cB + bp[k] * c, 0.0f, 0.5f + r.f01() * 0.5f); prev = bp[k]; }
                rampFill(t, s2b, cB + prev * c, end, 0.0f, 0.5f + r.f01() * 0.5f);
            } break;
            case 3: { // hard_chop: 4 sub-steps, 50% active
                for (int k = 0; k < 4; ++k)
                {
                    float v = 0.0f;
                    if (r.f01() < 0.5f) v = (r.f01() < 0.5f) ? (0.3f + r.f01() * 0.5f) : 1.0f;
                    stepFill(t, s2b, cB + (float) k * c * 0.25f, cB + (float)(k + 1) * c * 0.25f, v);
                }
            } break;
            case 4: { // exponential_build: accelerating rise then hard drop
                rampFill(t, s2b, cB,            cB + c * 0.5f,  0.0f, 0.2f);
                rampFill(t, s2b, cB + c * 0.5f, cB + c * 0.8f,  0.2f, 0.5f);
                rampFill(t, s2b, cB + c * 0.8f, end - 0.02f,    0.5f, 1.0f);
                stepFill(t, s2b, end - 0.02f,   end,            0.0f);
            } break;
            case 5: { // hyper_stutter: fast 1/8 or 1/16 grid, alternating gate
                const float rate = (r.f01() < 0.5f) ? 0.125f : 0.0625f;
                int j = 0;
                for (float tt = cB; tt < end - 1.0e-4f; tt += rate, ++j)
                    stepFill(t, s2b, tt, juce::jmin(tt + rate, end), (j % 2 == 0) ? (0.6f + r.f01() * 0.4f) : 0.0f);
            } break;
            case 6: { // rhythmic_gate_build: probability ramps across the chunk
                static const float rs[3] = { 0.125f, 0.25f, 0.5f };
                const float rate = rs[(int)(r.f01() * 3.0f) % 3];
                const bool inv = r.f01() < 0.5f;
                for (float tt = cB; tt < end - 1.0e-4f; tt += rate)
                {
                    const float prog = (tt - cB) / juce::jmax(1.0e-4f, c);
                    const float gate = inv ? (1.0f - prog) : prog;
                    const float v = (r.f01() < 0.4f + gate * 0.5f) ? (0.7f + r.f01() * 0.3f) : 0.0f;
                    stepFill(t, s2b, tt, juce::jmin(tt + rate, end), v);
                }
            } break;
            default: { // syncopated_drops: sparse 1/4 accents that drop early
                const float rate = 0.25f;
                for (float tt = cB; tt < end - 1.0e-4f; tt += rate)
                {
                    if (r.f01() > 0.7f)
                    {
                        const float v = 0.3f + r.f01() * 0.7f;
                        stepFill(t, s2b, tt, juce::jmin(tt + rate * 0.8f, end), v);
                        stepFill(t, s2b, tt + rate * 0.8f, juce::jmin(tt + rate, end), 0.0f);
                    }
                    else stepFill(t, s2b, tt, juce::jmin(tt + rate, end), 0.0f);
                }
            } break;
        }
    }

    // CHAOS LFO  (canvas.js chaos_lfo)
    // 2..4 incommensurate sine/cosine layers + per-0.25-beat noise & spikes,
    // smoothstep-interpolated. Layers never line up -> long evolving wander.
    static void genChaos(XOr& r, float* t, float totalBeats, float s2b)
    {
        const int layers = juce::jlimit(2, 4, 2 + (int)(r.f01() * 3.0f));
        float fq[4] = {0}, am[4] = {0}, ph[4] = {0}; int uc[4] = {0};
        for (int k = 0; k < layers; ++k)
        { fq[k] = 0.3f + r.f01() * 2.2f; am[k] = 0.15f + r.f01() * 0.35f;
          ph[k] = r.f01() * 6.2831853f;  uc[k] = r.f01() > 0.5f ? 1 : 0; }
        const float noiseAmt = 0.1f + r.f01() * 0.25f;
        const float spikeProb = 0.08f + r.f01() * 0.15f;

        float node[520];
        const int nn = juce::jlimit(2, 519, (int) std::lround(totalBeats / 0.25) + 1);
        for (int g = 0; g < nn; ++g)
        {
            const float beat = (float) g * 0.25f;
            float v = 0.5f;
            for (int k = 0; k < layers; ++k)
                v += (uc[k] ? std::cos(beat * fq[k] + ph[k]) : std::sin(beat * fq[k] + ph[k])) * am[k];
            if (r.f01() < spikeProb) v = r.f01();
            else                     v += (r.f01() * 2.0f - 1.0f) * noiseAmt;
            node[g] = v;
        }
        for (int i = 0; i < TBL; ++i)
        {
            const float beat = (float) i / s2b;
            const float gp = beat / 0.25f;
            int gi = (int) gp; gi = juce::jlimit(0, nn - 2, gi);
            float gf = gp - (float) gi; gf = juce::jlimit(0.0f, 1.0f, gf);
            gf = gf * gf * (3.0f - 2.0f * gf);                 // smoothstep
            const float a = node[gi], b = node[juce::jmin(nn - 1, gi + 1)];
            t[(size_t) i] = a + (b - a) * gf;
        }
    }

    // REFLECTOR  (canvas.js sdApplyGlobalReflector)
    // consecutive armed params form tight base+mirror pairs; pairs alternate
    // neuro / chaos. The mirror is the exact value-inversion of its partner.
    void regen(int p, int type, int bars)
    {
        const float totalBeats = (float) bars * 4.0f;
        const float s2b = (float) TBL / totalBeats;
        auto& t = tables[(size_t) p];
        for (auto& x : t) x = 0.5f;

        if (type == Reflector)
        {
            const int  pair    = p & ~1;                 // even index of the pair
            const bool mirror  = (p & 1) != 0;
            const bool useChaos = ((pair >> 1) & 1) != 0; // pair 0->neuro, 1->chaos, ...
            XOr rr { keyOf(seed, pair) };                // both members share the base
            for (auto& x : scratch) x = 0.5f;
            if (useChaos) genChaos (rr, scratch.data(), totalBeats, s2b);
            else          genNeuro (rr, scratch.data(), totalBeats, s2b);
            normalize(scratch.data(), 0.03f, 0.97f);
            for (int i = 0; i < TBL; ++i)
                t[(size_t) i] = mirror ? (1.0f - scratch[(size_t) i]) : scratch[(size_t) i];
        }
        else
        {
            XOr r { keyOf(seed, p) };
            switch (type)
            {
                case SampleHold: genSampleHold(r, t.data(), totalBeats, s2b); break;
                case Neuro:      genNeuro     (r, t.data(), totalBeats, s2b); break;
                default:         genChaos     (r, t.data(), totalBeats, s2b); break;
            }
            normalize(t.data(), 0.03f, 0.97f);
        }

        tblType[(size_t) p] = type;
        tblSeed[(size_t) p] = seed;
        tblBars[(size_t) p] = bars;
    }

    ModHub* hub = nullptr;
    std::atomic<float> *pType=nullptr,*pLength=nullptr,*pRate=nullptr,*pOn=nullptr,*pDepth=nullptr;

    std::vector<std::array<float, TBL>> tables;     // per-param curve (heap)
    std::vector<uint32_t> tblSeed;
    std::vector<int> tblType, tblBars;
    std::array<float, TBL> scratch {};              // reflector base scratch
    std::array<bool, ModHub::MAX> armed {};
    uint32_t seed = 1;
    double sampleRate = 44100.0, freePhase = 0.0;
};
