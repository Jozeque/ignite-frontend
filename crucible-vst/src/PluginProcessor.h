#pragma once
#include <juce_audio_processors/juce_audio_processors.h>
#include <juce_audio_utils/juce_audio_utils.h>
#include <juce_audio_devices/juce_audio_devices.h>
#include "Params.h"
#include "dsp/VoiceCore.h"
#include "dsp/Fx.h"
#include <set>

class CrucibleProcessor;

struct CrucibleSound : public juce::SynthesiserSound
{
    bool appliesToNote(int) override    { return true; }
    bool appliesToChannel(int) override { return true; }
};

class CrucibleVoice : public juce::SynthesiserVoice
{
public:
    explicit CrucibleVoice(CrucibleProcessor& p) : proc(p) {}
    bool canPlaySound(juce::SynthesiserSound*) override { return true; }
    void startNote(int midiNoteNumber, float velocity, juce::SynthesiserSound*, int) override;
    void stopNote(float velocity, bool allowTailOff) override;
    void pitchWheelMoved(int newPitchWheelValue) override;
    void controllerMoved(int, int) override {}
    void setCurrentPlaybackSampleRate(double newRate) override;
    void renderNextBlock(juce::AudioBuffer<float>&, int startSample, int numSamples) override;

    // mono-mode note change on the sounding voice: retune (osc glides via its
    // smoothed f0), retrigger the env unless legato, keep the gate on
    void monoChange(int newNote, bool legato);

    cru::VoiceCore core;
    int monoNote = -1;   // our own note bookkeeping (base's is private + fixed at startNote)
private:
    CrucibleProcessor& proc;
};

// Synthesiser with a proper mono/legato mode: last-note priority, held-note
// stack (release falls back to what's still held), env retrigger rules owned
// by the voice. Poly path is stock JUCE.
class CrucibleSynth : public juce::Synthesiser
{
public:
    std::atomic<bool> monoMode { false }, legatoMode { false };
    void setModes(bool mono, bool legato);
    void noteOn(int midiChannel, int midiNoteNumber, float velocity) override;
    void noteOff(int midiChannel, int midiNoteNumber, float velocity, bool allowTailOff) override;
private:
    std::vector<int> heldNotes;
};

class CrucibleProcessor : public juce::AudioProcessor
{
public:
    CrucibleProcessor();
    ~CrucibleProcessor() override;

    void prepareToPlay(double sampleRate, int samplesPerBlock) override;
    void releaseResources() override {}
    bool isBusesLayoutSupported(const BusesLayout& layouts) const override;
    void processBlock(juce::AudioBuffer<float>&, juce::MidiBuffer&) override;

    juce::AudioProcessorEditor* createEditor() override;
    bool hasEditor() const override { return true; }

    const juce::String getName() const override { return "Crucible"; }
    bool acceptsMidi() const override  { return true; }
    bool producesMidi() const override { return false; }
    bool isMidiEffect() const override { return false; }
    double getTailLengthSeconds() const override { return 12.0; }

    int getNumPrograms() override { return 1; }
    int getCurrentProgram() override { return 0; }
    void setCurrentProgram(int) override {}
    const juce::String getProgramName(int) override { return {}; }
    void changeProgramName(int, const juce::String&) override {}

    void getStateInformation(juce::MemoryBlock& destData) override;
    void setStateInformation(const void* data, int sizeInBytes) override;

    juce::AudioProcessorValueTreeState apvts;

    // shared voice targets (audio thread writes each block, voices read)
    cru::VoiceParams voiceParams;
    cru::BusChain    bus;
    cru::DisplayOsc  display;

    std::atomic<float> lastF0 { 55.0f };
    float glideF0 = 55.0f;                 // previous note pitch (audio thread only)
    std::atomic<bool>  editorOpen { false };
    std::atomic<float> envNow { 0.0f };    // loudest voice envelope (UI animation)

    // rolling post-master output ring for the oscilloscope
    static constexpr int kOutRing = 8192;
    float outRing[kOutRing] = {};
    std::atomic<int> outWi { 0 };
    std::atomic<float> outPeak { 0.0f };   // true peak since the UI last read (clip meter)
    std::atomic<int>   lastBend { 8192 };  // last MIDI pitch-wheel value (UI wheel mirror)

    CrucibleSynth synth;

    // Standalone only: the desktop wrapper doesn't open MIDI inputs by itself,
    // so we open every hardware device ourselves (message thread; no-op in a DAW).
    void rescanMidiInputs();

private:
    juce::MidiMessageCollector midiCollector;
    std::vector<std::unique_ptr<juce::MidiInput>> midiInputs;
    std::set<juce::String> openMidiIds;
    juce::AudioBuffer<float> voiceBuf;     // mono voice-sum scratch
    std::vector<std::atomic<float>*> prm;  // cached raw param values (paramDefs order)
    std::atomic<float>* prmGain = nullptr;
    std::atomic<float>* prmDriveType = nullptr;
    std::atomic<float>* prmMono = nullptr;
    std::atomic<float>* prmLegato = nullptr;
    std::atomic<float>* prmOscAWave = nullptr;
    std::atomic<float>* prmOscBWave = nullptr;
    std::atomic<float>* prmOscAOn = nullptr;
    std::atomic<float>* prmOscBOn = nullptr;
    std::atomic<float>* prmDlySync = nullptr;
    std::atomic<float>* prmDlyPP = nullptr;
    std::atomic<float>* prmFiltType = nullptr;
    std::atomic<float>* prmDrvFltType = nullptr;
    std::atomic<float>* prmOscAOct = nullptr;
    std::atomic<float>* prmOscBOct = nullptr;
    float bpmNow = 120.0f;   // audio thread only (host playhead)
    float masterLin = 0.501187f;           // smoothed master gain (-6 dB)
    double currentSR = 48000.0;

    JUCE_DECLARE_NON_COPYABLE_WITH_LEAK_DETECTOR(CrucibleProcessor)
};
