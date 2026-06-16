#pragma once
#include <juce_audio_processors/juce_audio_processors.h>
#include "SpectralModel.h"
#include <cmath>
#include <atomic>

// ============================================================
// TENDRIL voice — renders the shared painted/morphed SPECTRUM.
// The spectrum (SpectrumEngine) is the creative surface; the voice
// just plays it: band-limited PartialOsc + warp (phase distortion)
// + fold (wavefolder) + glide + ADSR. Legacy dual-osc/FM params are
// retired from the audio path (ids remain for the Stride contract).
// ============================================================

struct TendrilSound : public juce::SynthesiserSound
{
    bool appliesToNote(int) override    { return true; }
    bool appliesToChannel(int) override { return true; }
};

class TendrilVoice : public juce::SynthesiserVoice
{
public:
    TendrilVoice(ModHub& hub,
                 SpectrumEngine* engine,
                 std::atomic<float>* lastNoteShared)
        : eng(engine), lastNote(lastNoteShared)
    {
        auto p = [&hub](const char* id){ return hub.ptr(id); };   // reads effective (modulated) values
        pPitch=p("pitch"); pGlide=p("glide"); pLevel=p("a_level");
        pSub=p("sub_lvl"); pNoise=p("noise_lvl");
        pFold=p("fold_amt"); pWarp=p("warp");
        pAtt=p("amp_attack"); pDec=p("amp_decay"); pSus=p("amp_sustain"); pRel=p("amp_release");
    }

    bool canPlaySound(juce::SynthesiserSound* s) override { return dynamic_cast<TendrilSound*>(s) != nullptr; }

    void setCurrentPlaybackSampleRate(double sr) override
    {
        juce::SynthesiserVoice::setCurrentPlaybackSampleRate(sr);
        if (sr > 0.0)
        {
            adsr.setSampleRate(sr);
            // ramp params per-sample so per-block modulation/automation never steps
            // (zipper/clicks). sr here is the OVERSAMPLED rate, so ms ramp times hold.
            smLevel.reset(sr, 0.008); smSub.reset(sr, 0.010); smNoise.reset(sr, 0.010);
            smFold .reset(sr, 0.015); smWarp.reset(sr, 0.015); smPitch.reset(sr, 0.015);
        }
    }

    void startNote(int midiNoteNumber, float vel, juce::SynthesiserSound*, int) override
    {
        targetMidi = (double) midiNoteNumber;
        velocity = vel;
        const float from = lastNote ? lastNote->exchange((float) midiNoteNumber) : (float) midiNoteNumber;
        curMidi = (ld(pGlide) > 0.001f) ? (double) from : targetMidi;

        phase = phaseSub = 0.0;
        // prime smoothers to the current values so the note starts exact (no ramp-from-stale)
        smLevel.setCurrentAndTargetValue(ld(pLevel));
        smSub  .setCurrentAndTargetValue(ld(pSub));
        smNoise.setCurrentAndTargetValue(ld(pNoise));
        smFold .setCurrentAndTargetValue(ld(pFold));
        smWarp .setCurrentAndTargetValue(ld(pWarp));
        smPitch.setCurrentAndTargetValue(ld(pPitch));
        applyAdsr();                 // set the user envelope before the attack ramp
        adsr.noteOn();
    }

    void stopNote(float, bool allowTailOff) override
    {
        if (allowTailOff) adsr.noteOff();
        else { adsr.reset(); clearCurrentNote(); }
    }

    void pitchWheelMoved(int) override {}
    void controllerMoved(int, int) override {}

    void renderNextBlock(juce::AudioBuffer<float>& out, int startSample, int numSamples) override
    {
        if (!isVoiceActive() || eng == nullptr) return;
        const double sr = getSampleRate();
        if (sr <= 0.0) return;

        // block-start targets (smoothed per-sample below)
        const float tWarp = ld(pWarp);
        const double tOff = (double) ld(pPitch);
        smLevel.setTargetValue(ld(pLevel));
        smSub  .setTargetValue(ld(pSub));
        smNoise.setTargetValue(ld(pNoise));
        smFold .setTargetValue(ld(pFold));
        smPitch.setTargetValue((float) tOff);
        applyAdsr();                 // live envelope tweaks (and Stride can evolve the times)

        // WARP speeds the table read up to ~3.3x at the knee — feed that rate into
        // the band-limit so phase distortion can never alias. Size for the HOTTER of
        // the old/target warp so a ramp-down can't briefly under-band-limit.
        const float warpBL   = juce::jmax(smWarp.getCurrentValue(), tWarp);
        smWarp.setTargetValue(tWarp);
        const float kknee    = 0.5f + juce::jlimit(0.f, 1.f, warpBL) * 0.35f;
        const float warpRate = 0.5f / (1.0f - kknee);          // 1 .. ~3.33
        const double f0 = midiToHz(curMidi + tOff);
        osc.update(*eng, (float)(f0 / sr) * warpRate);
        osc.startBlock(numSamples);

        const float glide = juce::jlimit(0.f, 1.f, ld(pGlide));
        const double glideSec = (double) glide * glide * 0.6;
        const double gcoef = (glideSec > 0.0005) ? 1.0 - std::exp(-1.0 / (glideSec * sr)) : 1.0;

        for (int i = 0; i < numSamples; ++i)
        {
            const float env      = adsr.getNextSample();
            const float level    = smLevel.getNextValue();
            const float subLvl   = smSub.getNextValue();
            const float noiseLvl = smNoise.getNextValue();
            const float fold     = smFold.getNextValue();
            const float warp     = smWarp.getNextValue();
            const double off     = (double) smPitch.getNextValue();

            curMidi += (targetMidi - curMidi) * gcoef;
            const double f = midiToHz(curMidi + off);

            phase = wrap01(phase + f / sr);
            float s = osc.read(warpPhase((float) phase, warp));

            // sub + noise support layers
            phaseSub = wrap01(phaseSub + (f * 0.5) / sr);
            s += std::sin((float) phaseSub * juce::MathConstants<float>::twoPi) * subLvl * 0.8f;
            s += (rng.nextFloat() * 2.0f - 1.0f) * 0.5f * noiseLvl;

            // FOLD: bounded sine wavefolder (now oversampled -> no longer aliases)
            const float drv = 1.0f + fold * 5.0f;
            s += fold * (std::sin(s * drv * 1.1f) - s);

            const float sOut = std::tanh(s * env * velocity * level * 1.2f);
            for (int ch = 0; ch < out.getNumChannels(); ++ch)
                out.addSample(ch, startSample + i, sOut);

            if (!adsr.isActive()) { clearCurrentNote(); break; }
        }
    }

private:
    void applyAdsr() noexcept
    {
        const float a = ld(pAtt), d = ld(pDec), s = ld(pSus), r = ld(pRel);
        adsr.setParameters({ 0.001f + a * a * 3.0f,         // attack  ~1ms .. 3s (skewed)
                             0.005f + d * d * 3.0f,         // decay
                             juce::jlimit(0.f, 1.f, s),     // sustain
                             0.005f + r * r * 4.0f });      // release .. 4s
    }
    static inline double wrap01(double x) noexcept { x -= std::floor(x); return x; }
    static inline double midiToHz(double m) noexcept { return 440.0 * std::exp2((m - 69.0) / 12.0); }
    static inline float  warpPhase(float ph, float w) noexcept
    {
        // knee capped at 0.85 (max ~3.3x read rate) — matched by the
        // warpRate band-limit in renderNextBlock, so warp stays clean
        const float k = 0.5f + juce::jlimit(0.f, 1.f, w) * 0.35f;
        return (ph < k) ? (ph / k) * 0.5f : 0.5f + ((ph - k) / (1.0f - k)) * 0.5f;
    }
    inline float ld(std::atomic<float>* p) const noexcept { return p ? p->load() : 0.0f; }

    SpectrumEngine* eng = nullptr;
    std::atomic<float>* lastNote = nullptr;

    std::atomic<float> *pPitch=nullptr,*pGlide=nullptr,*pLevel=nullptr,
        *pSub=nullptr,*pNoise=nullptr,*pFold=nullptr,*pWarp=nullptr,
        *pAtt=nullptr,*pDec=nullptr,*pSus=nullptr,*pRel=nullptr;

    PartialOsc osc;
    juce::ADSR adsr;
    juce::Random rng;
    // per-sample parameter smoothers (declick block-rate modulation/automation)
    juce::SmoothedValue<float> smLevel, smSub, smNoise, smFold, smWarp, smPitch;
    float  velocity = 1.0f;
    double targetMidi = 60.0, curMidi = 60.0;
    double phase = 0.0, phaseSub = 0.0;
};
