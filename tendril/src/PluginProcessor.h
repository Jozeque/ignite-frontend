#pragma once
#include <juce_audio_processors/juce_audio_processors.h>
#include <juce_dsp/juce_dsp.h>
#include "Params.h"
#include "Modulation.h"
#include "SpectrumEngine.h"
#include "SynthVoice.h"
#include "FXChain.h"
#include "Routing.h"

class TendrilProcessor : public juce::AudioProcessor
{
public:
    TendrilProcessor();
    ~TendrilProcessor() override = default;

    void prepareToPlay(double sampleRate, int samplesPerBlock) override;
    void releaseResources() override {}
    bool isBusesLayoutSupported(const BusesLayout& layouts) const override;
    void processBlock(juce::AudioBuffer<float>&, juce::MidiBuffer&) override;

    juce::AudioProcessorEditor* createEditor() override;
    bool hasEditor() const override { return true; }

    const juce::String getName() const override { return "Tendril"; }
    bool acceptsMidi() const override   { return true; }
    bool producesMidi() const override  { return false; }
    bool isMidiEffect() const override  { return false; }
    double getTailLengthSeconds() const override { return 2.0; }

    int getNumPrograms() override { return 1; }
    int getCurrentProgram() override { return 0; }
    void setCurrentProgram(int) override {}
    const juce::String getProgramName(int) override { return {}; }
    void changeProgramName(int, const juce::String&) override {}

    void getStateInformation(juce::MemoryBlock& destData) override;
    void setStateInformation(const void* data, int sizeInBytes) override;

    // ---- FX routing (plugin state, hidden from automation) ----
    bool applyRoutingVar(const juce::var& v);     // from UI; stores + applies
    void applyRoutingFromState();                 // after state load
    juce::String getRoutingJson() const;

    // ---- Motion (per-param arm = plugin state) ----
    void setModArm(const juce::String& id, bool on);
    bool getModArm(const juce::String& id) const;
    void mutateMotion() { modEngine.mutate(); saveMotionState(); }

    juce::AudioProcessorValueTreeState apvts;
    std::atomic<float> lastNoteMidi { 60.0f };
    ModHub     modHub;           // effective-value layer (DSP reads this)
    ModEngine  modEngine;        // motion generators
    SpectrumEngine spectrum;     // the creative surface (editor paints into it)

private:
    juce::Synthesiser synth;
    TendrilFX fx;
    double currentSampleRate = 44100.0;
    double osSampleRate      = 44100.0;
    static constexpr int kNumVoices    = 8;
    // Oversampling factor is an EXPONENT: 2 -> 4x. The whole voice + FX chain
    // renders at osSampleRate so every nonlinearity (fold / warp / tanh / the
    // waveshaper bank) folds its harmonics above the 4x Nyquist, then the
    // decimation filter strips them -> alias-free. Polyphase-IIR half-band =
    // minimal latency for live play. (4x covers tanh comfortably + handles the
    // hard wavefolders; bump to 3 for an HQ render mode.)
    static constexpr int kOSFactorLog2 = 2;
    std::unique_ptr<juce::dsp::Oversampling<float>> oversampler;
    juce::MidiBuffer osMidi;     // preallocated: MIDI rescaled onto the oversampled timeline

    void saveMotionState();
    void loadMotionState();

    JUCE_DECLARE_NON_COPYABLE_WITH_LEAK_DETECTOR(TendrilProcessor)
};
