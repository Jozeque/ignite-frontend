#pragma once
#include <juce_audio_processors/juce_audio_processors.h>
#include <juce_dsp/juce_dsp.h>
#include "Params.h"
#include "Routing.h"
#include "Modulation.h"
#include <cmath>

// ============================================================
// TENDRIL — modular post-synth FX rack (focus v1)
// 5 modules: FILTER (Cutoff/Reso/Character + Type), DRIVE (Drive/Character
// + Type), CRUSH, TUNED NOTE-DELAY (Note C0..C2 / Feedback / Mix),
// SPACE (Size/Mix). User-reorderable + two parallel lanes (A/B) with
// equal-power Blend. Routing arrives as a lock-free uint32 word.
// Master: Output gain + continuous soft limiter (modulation-safe ceiling).
// ============================================================
class TendrilFX
{
public:
    void prepare(double sampleRate, int blockSize, int numChannels)
    {
        sr = sampleRate;
        chans = juce::jmin(2, juce::jmax(1, numChannels));
        juce::dsp::ProcessSpec spec { sampleRate,
                                      (juce::uint32) juce::jmax(16, blockSize),
                                      (juce::uint32) 2 };
        delay.prepare(spec);
        reverb.setSampleRate(sampleRate);
        laneBuf.setSize(2, juce::jmax(16, blockSize), false, true, true);

        smCutoff.reset(sampleRate, 0.020); smReso.reset(sampleRate, 0.020);
        smFilterChar.reset(sampleRate, 0.015);
        smDrive.reset(sampleRate, 0.010);  smDriveChar.reset(sampleRate, 0.015);
        smReson.reset(sampleRate, 0.012);  smResonTune.reset(sampleRate, 0.015);
        smDelayFb.reset(sampleRate, 0.015); smDelayMix.reset(sampleRate, 0.012);
        smBlend.reset(sampleRate, 0.010);  smOutput.reset(sampleRate, 0.008);
        smPrimed = false;

        reset();
    }

    void reset()
    {
        delay.reset();
        reverb.reset();
        for (int c = 0; c < 2; ++c)
        {
            ic1[c]=ic2[c]=0.f; crushHold[c]=0.f; crushPhase[c]=0.f;
            dcX[c]=dcY[c]=0.f;
            for (int k = 0; k < 4; ++k) { rs1[k][c]=0.f; rs2[k][c]=0.f; }
        }
    }

    // keytracked resonator follows the last played note
    void setNoteSource(std::atomic<float>* n) noexcept { noteSrc = n; }

    void setState(ModHub& hub)
    {
        ready = true;
        auto p = [&hub](const char* id){ return hub.ptr(id); };   // reads effective (modulated) values
        pCutoff=p("cutoff"); pReso=p("reso"); pFilterChar=p("filter_char"); pFtype=p("ftype");
        pDrive=p("fx_drive"); pDriveChar=p("fx_drivechar"); pDtype=p("dtype");
        pCrush=p("fx_crush");
        pDelayNote=p("delay_note"); pDelayFb=p("fx_motionfb"); pDelayMix=p("delay_mix");
        pSpaceSize=p("fx_spacesize"); pSpaceMix=p("fx_spacemix");
        pReson=p("fx_reson"); pResonTune=p("fx_resontune");
        pBlend=p("fx_blend"); pOutput=p("output"); pOrder=p("fx_order");
    }

    void setRoutingWord(uint32_t w) noexcept { routingWord.store(w, std::memory_order_release); }
    uint32_t getRoutingWord() const noexcept { return routingWord.load(std::memory_order_acquire); }

    void process(juce::AudioBuffer<float>& buffer)
    {
        if (!ready) return;
        const int n   = buffer.getNumSamples();
        const int chs = juce::jmin(2, buffer.getNumChannels());
        if (n <= 0 || chs <= 0) return;

        // ---- per-sample smoother targets (prime to value on the first block) ----
        auto setT = [this](juce::SmoothedValue<float>& s, std::atomic<float>* p, float lo, float hi)
        {
            const float v = juce::jlimit(lo, hi, ld(p));
            if (smPrimed) s.setTargetValue(v); else s.setCurrentAndTargetValue(v);
        };
        setT(smCutoff, pCutoff, 0.f, 1.f);     setT(smReso, pReso, 0.f, 1.f);
        setT(smFilterChar, pFilterChar, 0.f, 1.f);
        setT(smDrive, pDrive, 0.f, 1.f);       setT(smDriveChar, pDriveChar, 0.f, 1.f);
        setT(smReson, pReson, 0.f, 1.f);       setT(smResonTune, pResonTune, 0.f, 1.f);
        setT(smDelayFb, pDelayFb, 0.f, 0.97f); setT(smDelayMix, pDelayMix, 0.f, 1.f);
        setT(smBlend, pBlend, 0.f, 1.f);       setT(smOutput, pOutput, 0.f, 1.5f);
        smPrimed = true;

        // Mingle knob: when > 0 it overrides the hand-set routing with a
        // scrambled chain order (deterministic per knob position).
        const float order = juce::jlimit(0.f, 1.f, ld(pOrder));
        const auto r = (order > 0.01f)
                     ? tendril::routingForOrder(order)
                     : tendril::decodeRouting(routingWord.load(std::memory_order_acquire));

        // When the chain ORDER changes (Mingle turned, or routing edited), the
        // stateful FX (delay/reverb/filter/reson) hold tails from their old
        // positions -> reordering them mid-stream clicks and can blow up the
        // feedback path. Clear those states and declick the output so each new
        // order starts clean instead of distorting.
        const uint32_t curWord = tendril::encodeRouting(r);
        if (curWord != activeWord)
        {
            if (activeWord != 0xFFFFFFFFu) { reset(); declick = kDeclick; }
            activeWord = curWord;
        }

        bool laneBUsed = false;
        for (const auto& s : r) laneBUsed |= s.laneB;

        if (laneBUsed)
        {
            if (laneBuf.getNumSamples() < n) laneBuf.setSize(2, n, false, true, true);
            for (int c = 0; c < chs; ++c)
                laneBuf.copyFrom(c, 0, buffer, c, 0, n);
            if (chs == 1) laneBuf.copyFrom(1, 0, buffer, 0, 0, n);
        }

        // process each slot in order, on its lane's buffer
        for (const auto& s : r)
        {
            juce::AudioBuffer<float>& target = (s.laneB ? laneBuf : buffer);
            const int tchs = s.laneB ? 2 : chs;
            processModule(s.module, target, n, tchs);
        }

        // merge lanes (equal-power, per-sample smoothed Blend) when B is used
        if (laneBUsed)
        {
            float* d0 = buffer.getWritePointer(0);
            float* d1 = chs > 1 ? buffer.getWritePointer(1) : nullptr;
            const float* b0 = laneBuf.getReadPointer(0);
            const float* b1 = laneBuf.getReadPointer(1);
            for (int i = 0; i < n; ++i)
            {
                const float blend = smBlend.getNextValue();
                const float gA = std::cos(blend * juce::MathConstants<float>::halfPi);
                const float gB = std::sin(blend * juce::MathConstants<float>::halfPi);
                d0[i] = d0[i] * gA + b0[i] * gB;
                if (d1) d1[i] = d1[i] * gA + b1[i] * gB;
            }
        }

        // master: per-sample smoothed output gain + declick fade-in (order change) + soft limit
        {
            float* d0 = buffer.getWritePointer(0);
            float* d1 = chs > 1 ? buffer.getWritePointer(1) : nullptr;
            int dl = declick;
            for (int i = 0; i < n; ++i)
            {
                const float gg = smOutput.getNextValue()
                               * ((dl > 0) ? (float)(kDeclick - dl) / (float) kDeclick : 1.0f);
                if (dl > 0) --dl;
                d0[i] = softLimit(d0[i] * gg);
                if (d1) d1[i] = softLimit(d1[i] * gg);
            }
            declick = juce::jmax(0, declick - n);
        }
    }

    // continuous, monotonic soft ceiling: linear below 0.9, tanh-bent above, < 1.0 always
    static inline float softLimit(float x) noexcept
    {
        constexpr float th = 0.9f;
        const float ax = std::abs(x);
        if (ax <= th) return x;
        return std::copysign(th + (1.0f - th) * std::tanh((ax - th) / (1.0f - th)), x);
    }

private:
    // ---------- module dispatch ----------
    void processModule(int id, juce::AudioBuffer<float>& buf, int n, int chs)
    {
        switch (id)
        {
            case tendril::ModFilter: filterBlock(buf, n, chs); break;
            case tendril::ModDrive:  driveBlock(buf, n, chs);  break;
            case tendril::ModCrush:  crushBlock(buf, n, chs);  break;
            case tendril::ModDelay:  delayBlock(buf, n, chs);  break;
            case tendril::ModSpace:  spaceBlock(buf, n, chs);  break;
            case tendril::ModReson:  resonBlock(buf, n, chs);  break;
            default: break;
        }
    }

    void filterBlock(juce::AudioBuffer<float>& buf, int n, int chs)
    {
        const int ftype = (int) std::lround(ld(pFtype));   // selector: per block
        const float pi  = juce::MathConstants<float>::pi;
        float* d0 = buf.getWritePointer(0);
        float* d1 = chs > 1 ? buf.getWritePointer(1) : nullptr;

        for (int i = 0; i < n; ++i)
        {
            // smoothed cutoff/reso/char -> recompute coeffs per sample (declicks modulation)
            const float cutoff = smCutoff.getNextValue();
            const float reso   = smReso.getNextValue();
            const float fchar  = smFilterChar.getNextValue();

            const float fc = 20.0f * std::pow(900.0f, cutoff);
            const float g  = std::tan(pi * juce::jlimit(20.f, 18000.f, fc) / (float) sr);
            const float k  = juce::jmax(0.03f, 2.0f - 1.97f * reso);
            const float a1 = 1.0f / (1.0f + g * (g + k)), a2 = g * a1, a3 = g * a2;
            const float fdrive = 1.0f + fchar * 4.0f;
            const float fcomp  = 1.0f / (1.0f + fchar * 0.6f);

            for (int c = 0; c < chs; ++c)
            {
                float* d = (c == 0) ? d0 : d1;
                const float x = d[i];
                // Character: blend in tanh drive before the filter (analog push)
                const float driven = std::tanh(x * fdrive) * fcomp;
                const float fin = x + fchar * (driven - x);

                const float v3 = fin - ic2[c];
                const float v1 = a1 * ic1[c] + a2 * v3;
                const float v2 = ic2[c] + a2 * ic1[c] + a3 * v3;
                ic1[c] = 2.0f * v1 - ic1[c];
                ic2[c] = 2.0f * v2 - ic2[c];

                const float lp = v2, bp = v1, hp = fin - k * v1 - v2;
                const float notch = fin - k * v1, peak = lp - hp;
                d[i] = (ftype == 0) ? lp : (ftype == 1) ? lp : (ftype == 2) ? hp
                     : (ftype == 3) ? bp : (ftype == 4) ? notch : peak;
            }
        }
    }

    void driveBlock(juce::AudioBuffer<float>& buf, int n, int chs)
    {
        // skip cleanly when fully off and not mid-ramp (the default state)
        if (smDrive.getCurrentValue() < 0.0005f && ! smDrive.isSmoothing()) return;
        const int dtype = juce::jlimit(0, 8, (int) std::lround(ld(pDtype)));

        // per-type pre-gain / makeup so every character lands at a
        // consistent loudness (tightened by ear-feedback 2026-06-11)
        static constexpr float pre[9] = { 1.0f, 1.6f, 1.2f, 0.9f, 0.8f, 1.0f, 1.1f, 1.3f, 1.2f };
        static constexpr float mk [9] = { 1.0f, 1.10f,1.0f, 1.10f,1.05f,0.90f,1.05f,1.05f,1.0f };

        float* d0 = buf.getWritePointer(0);
        float* d1 = chs > 1 ? buf.getWritePointer(1) : nullptr;

        for (int i = 0; i < n; ++i)
        {
            const float drive = smDrive.getNextValue();
            const float dchar = smDriveChar.getNextValue();
            const float gain = (1.0f + drive * drive * 14.0f) * pre[dtype];
            const float comp = mk[dtype] / (1.0f + drive * 2.6f);   // auto makeup
            const float bias = dchar * 0.22f * drive;                // asymmetry scales with drive

            for (int c = 0; c < chs; ++c)
            {
                float* d = (c == 0) ? d0 : d1;
                const float x = d[i];
                const float w = shape(x * gain + bias, dtype) * comp;   // oversampled -> alias-free

                // DC blocker (the asymmetry bias creates offset -> remove it)
                const float hp = w - dcX[c] + 0.9995f * dcY[c];
                dcX[c] = w; dcY[c] = hp;

                d[i] = x + drive * (hp - x);                 // dry/wet by drive
            }
        }
    }

    void resonBlock(juce::AudioBuffer<float>& buf, int n, int chs)
    {
        if (smReson.getCurrentValue() < 0.0005f && ! smReson.isSmoothing()) return;
        const float tune = juce::jlimit(0.f, 1.f, smResonTune.skip(n));   // smoothed, block-rate coeffs

        // keytracked modal bank: partial ratios of a struck bar (Corpus-like
        // metallic), rooted on the LAST PLAYED NOTE so it's always in key.
        static constexpr float ratio[4] = { 1.0f, 2.756f, 5.404f, 8.933f };
        static constexpr float pgain[4] = { 1.0f, 0.55f, 0.34f, 0.20f };
        const float baseNote = noteSrc ? noteSrc->load() : 48.0f;
        const float baseHz   = 440.0f * std::exp2((baseNote - 69.0f) / 12.0f)
                             * std::exp2((tune - 0.5f) * 2.0f);   // +/- 1 octave

        // per-partial SVF-bandpass coefficients (bounded Q: sings, never screams)
        float g[4], A1[4], A2[4];
        for (int k = 0; k < 4; ++k)
        {
            const float f = juce::jlimit(40.0f, 15000.0f, baseHz * ratio[k]);
            g[k]  = std::tan(juce::MathConstants<float>::pi * f / (float) sr);
            const float kk = 0.08f;                          // high resonance, bounded
            A1[k] = 1.0f / (1.0f + g[k] * (g[k] + kk));
            A2[k] = g[k] * A1[k];
        }

        float* d0 = buf.getWritePointer(0);
        float* d1 = chs > 1 ? buf.getWritePointer(1) : nullptr;

        for (int i = 0; i < n; ++i)
        {
            const float amount = smReson.getNextValue();
            for (int c = 0; c < chs; ++c)
            {
                float* d = (c == 0) ? d0 : d1;
                const float x = d[i];
                float wet = 0.0f;
                for (int k = 0; k < 4; ++k)
                {
                    const float v3 = x - rs2[k][c];
                    const float v1 = A1[k] * rs1[k][c] + A2[k] * v3;
                    const float v2 = rs2[k][c] + A2[k] * rs1[k][c] + g[k] * A2[k] * v3;
                    rs1[k][c] = 2.0f * v1 - rs1[k][c];
                    rs2[k][c] = 2.0f * v2 - rs2[k][c];
                    wet += v1 * pgain[k];                    // bandpass output
                }
                // equal-ish loudness blend; tanh keeps extreme settings musical
                d[i] = x + amount * (std::tanh(wet * 2.4f) - x * 0.30f);
            }
        }
    }

    void crushBlock(juce::AudioBuffer<float>& buf, int n, int chs)
    {
        const float crush = juce::jlimit(0.f, 1.f, ld(pCrush));
        if (crush < 0.0005f) return;
        const float bits    = 16.0f - crush * 13.0f;         // 16 -> 3 bits
        const float levels  = std::pow(2.0f, bits);
        const float rateDiv = 1.0f + crush * crush * 40.0f;  // sample-rate divide

        for (int c = 0; c < chs; ++c)
        {
            float* d = buf.getWritePointer(c);
            for (int i = 0; i < n; ++i)
            {
                crushPhase[c] += 1.0f;
                if (crushPhase[c] >= rateDiv)
                {
                    crushPhase[c] -= rateDiv;
                    crushHold[c] = std::round(d[i] * levels) / levels;
                }
                d[i] = crushHold[c];
            }
        }
    }

    void delayBlock(juce::AudioBuffer<float>& buf, int n, int chs)
    {
        // tuned note-delay: time = period of the note frequency (C0..C2)
        const float note = juce::jlimit(0.f, 24.f, ld(pDelayNote));
        const float freq = 16.351597f * std::pow(2.0f, note / 12.0f);   // C0 = 16.35 Hz
        const float dSamp = juce::jlimit(2.0f, (float)(0.08 * sr),
                                         (1000.0f / freq) * (float) sr / 1000.0f);
        delay.setDelay(dSamp);

        for (int i = 0; i < n; ++i)
        {
            const float fb  = smDelayFb.getNextValue();
            const float mix = smDelayMix.getNextValue();
            for (int c = 0; c < chs; ++c)
            {
                const float dry = buf.getSample(c, i);
                const float wet = delay.popSample(c);
                // self-limited regeneration: tanh keeps runaway musical
                delay.pushSample(c, std::tanh(dry + wet * fb));
                buf.setSample(c, i, dry + mix * (wet - dry));
            }
        }
    }

    void spaceBlock(juce::AudioBuffer<float>& buf, int n, int chs)
    {
        const float size = juce::jlimit(0.f, 1.f, ld(pSpaceSize));
        const float mix  = juce::jlimit(0.f, 1.f, ld(pSpaceMix));
        juce::Reverb::Parameters rp;
        rp.roomSize = size; rp.damping = 0.45f;
        rp.wetLevel = mix;  rp.dryLevel = 1.0f - mix * 0.4f;  // wet adds, dry mostly kept
        rp.width = 1.0f;    rp.freezeMode = 0.0f;
        reverb.setParameters(rp);

        if (chs >= 2) reverb.processStereo(buf.getWritePointer(0), buf.getWritePointer(1), n);
        else          reverb.processMono(buf.getWritePointer(0), n);
    }

    // ---------- distortion shapes (asymmetry handled by caller's bias) ----------
    static inline float shape(float x, int type) noexcept
    {
        switch (type)
        {
            case 0:  return std::tanh(x);                                        // Tube
            case 1:  return x / (1.0f + std::abs(x));                            // Tape
            case 2:  return std::tanh(x) + 0.28f * std::tanh(x * 3.0f);          // Diode (edge)
            case 3:  return std::sin(x);                                         // Wavefold
            case 4:  { float t = std::fmod(std::abs(x) + 1.0f, 4.0f);            // Foldback
                       float y = (t > 2.0f ? 4.0f - t : t) - 1.0f;
                       return (x < 0.0f ? -y : y); }
            case 5:  return juce::jlimit(-1.0f, 1.0f, x);                        // HardClip
            case 6:  return std::sin(juce::jlimit(-2.2f, 2.2f, x * 1.2f));       // Sine (bounded)
            case 7:  return x > 0.0f ? std::tanh(x) : std::tanh(x * 0.55f);      // Asym
            default: return std::tanh(x) + 0.12f * std::sin(x * 3.0f);           // Grit (texture)
        }
    }

    inline float ld(std::atomic<float>* p) const noexcept { return p ? p->load() : 0.0f; }

    // ---------- state ----------
    bool ready = false;
    // per-sample smoothers (declick block-rate param steps). reset() at prepare with
    // the running (oversampled) sample rate so the ms ramp times hold. smPrimed snaps
    // them to target on the first block so first-block behaviour stays exact.
    juce::SmoothedValue<float> smCutoff, smReso, smFilterChar, smDrive, smDriveChar,
        smReson, smResonTune, smDelayFb, smDelayMix, smBlend, smOutput;
    bool smPrimed = false;
    std::atomic<float> *pCutoff=nullptr,*pReso=nullptr,*pFilterChar=nullptr,*pFtype=nullptr,
        *pDrive=nullptr,*pDriveChar=nullptr,*pDtype=nullptr,*pCrush=nullptr,
        *pDelayNote=nullptr,*pDelayFb=nullptr,*pDelayMix=nullptr,
        *pSpaceSize=nullptr,*pSpaceMix=nullptr,
        *pReson=nullptr,*pResonTune=nullptr,*pBlend=nullptr,*pOutput=nullptr,*pOrder=nullptr;
    std::atomic<float>* noteSrc = nullptr;

    std::atomic<uint32_t> routingWord { tendril::encodeRouting(tendril::defaultRouting()) };

    // declick on chain-order change (Mingle): reset stateful FX + short fade-in
    static constexpr int kDeclick = 256;        // ~5 ms @ 48k
    uint32_t activeWord = 0xFFFFFFFFu;
    int declick = 0;

    double sr = 44100.0;
    int chans = 2;
    float ic1[2]={0,0}, ic2[2]={0,0}, crushHold[2]={0,0}, crushPhase[2]={0,0};
    float dcX[2]={0,0}, dcY[2]={0,0};
    float rs1[4][2]={}, rs2[4][2]={};
    juce::AudioBuffer<float> laneBuf;
    juce::dsp::DelayLine<float, juce::dsp::DelayLineInterpolationTypes::Linear> delay { 1 << 16 };
    juce::Reverb reverb;
};
