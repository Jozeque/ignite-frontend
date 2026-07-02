/*
  Stride Wrapper — engine (M0/M1 spike)
  =====================================
  Hosts a CHAIN of plugins inside Stride (instrument -> effects, in series) and
  modulates a curated set of their parameters from drawn curves.

  Why a chain: a VST3 plugin CANNOT see or touch other plugins sitting next to it
  in the DAW's track chain (the sandbox forbids it). The way to modulate "the synth
  AND its effects" is to host them INSIDE Stride — then Stride owns them all and the
  Map-by-touch + curve drive span the whole chain.
*/

#pragma once

#include <juce_audio_utils/juce_audio_utils.h>
#include <vector>

class StrideWrapperProcessor : public juce::AudioProcessor,
                               private juce::AudioProcessorListener
{
public:
    StrideWrapperProcessor();
    ~StrideWrapperProcessor() override;

    // ── AudioProcessor ──
    void prepareToPlay (double sampleRate, int samplesPerBlock) override;
    void releaseResources() override;
    bool isBusesLayoutSupported (const BusesLayout&) const override;
    void processBlock (juce::AudioBuffer<float>&, juce::MidiBuffer&) override;

    juce::AudioProcessorEditor* createEditor() override;
    bool hasEditor() const override { return true; }
    const juce::String getName() const override { return "StrideWrapperM0"; }
    bool acceptsMidi() const override  { return true; }
    bool producesMidi() const override { return false; }
    bool isMidiEffect() const override { return false; }
    double getTailLengthSeconds() const override { return 0.0; }
    int getNumPrograms() override { return 1; }
    int getCurrentProgram() override { return 0; }
    void setCurrentProgram (int) override {}
    const juce::String getProgramName (int) override { return {}; }
    void changeProgramName (int, const juce::String&) override {}
    void getStateInformation (juce::MemoryBlock& d) override;          // persist the hosted chain (DAW save/reload)
    void setStateInformation (const void* data, int sizeInBytes) override;

    // ── hosted chain (instrument + effects, all inside Stride) ──
    void loadPlugin (const juce::File& vst3File);     // APPENDS to the chain
    void clearChain();
    void removeNode (int index);                      // revoke ONE device (deliberate, from Stride's UI)
    void undoRemove();                                // restore the last-removed device (Ctrl+Z)
    int  numHosted() const;
    juce::AudioProcessorEditor* getHostedEditor (int node);
    juce::String getChainSummary() const;             // "Serum + Reverb + ..."
    juce::StringArray getChainNames() const;          // per-device names (for the Stride device list)
    void setNodeBypassed (int index, bool shouldBypass);   // bypass a device without removing it
    juce::Array<bool> getChainBypassed() const;            // per-device bypass state (for the device-list dots)
    bool hasHostedPlugin() const;

    // ── Map (learn by touch — across the whole chain) ──
    void setLearnMode (bool shouldLearn);
    bool isLearning() const { return learnMode.load(); }

    // Demo mode (no VST entitlement): runs but capped (3 params, no save, offline=noise).
    // Set live from the license gate; seeded at construction from the cached entitlement so
    // offline bounces are correct with the UI closed. See docs/stride-demo-mode-spec.md.
    void setDemoMode (bool d) { demoMode.store (d); }
    bool isDemo() const { return demoMode.load(); }
    bool isDemoFrozen() const { return demoFrozen.load(); }        // in the "freeze" half of the demo cycle
    int  demoSecsUntilResume() const { return demoResumeSecs.load(); }
    void saveDemoCycleState() const;   // persist move-used + freeze-until (call from the MESSAGE thread, e.g. editor timer)
    static constexpr double kDemoMoveSecs   = 10.0;   // demo cycle: modulation MOVES for this much PLAYBACK time,
    static constexpr double kDemoFreezeSecs = 60.0;   // then FREEZES (knobs hold) for this long (real-time), repeating
    juce::StringArray getMappedParamNames() const;    // "Device: Param", in mapped order
    juce::Array<juce::var> getMappedCurves() const;   // drive curve [{time,value,curve}...] per mapped param — so a reopen SHOWS the curves (not localStorage-dependent)
    double getClipBeats() const { return driveClipBeats; }   // loop length in beats (bars*4) — for the canvas bar count on load
    void removeMappedAt (int pos);
    void clearMapping();
    int  mappingVersion() const { return mapVersion.load(); }

    // ── live curve drive ──
    struct DriveLane { int position; std::vector<float> times, values, curves; };
    void setDriveCurves (const std::vector<DriveLane>& lanes, double clipBeats);

    std::atomic<bool>  modEnabled   { true };
    std::atomic<float> lastModValue { 0.0f };

private:
    void audioProcessorParameterChanged (juce::AudioProcessor*, int parameterIndex, float newValue) override;
    void audioProcessorParameterChangeGestureBegin (juce::AudioProcessor*, int parameterIndex) override;   // click-to-map (touch w/o moving)
    void audioProcessorChanged (juce::AudioProcessor*, const juce::AudioProcessorListener::ChangeDetails&) override {}

    void prepareNode (int i);                 // (re)prepare one chain node (under lock)
    int  nodeIndexOf (juce::AudioProcessor*) const;   // which chain slot a processor is (under lock)
    void mapParam (juce::AudioProcessor*, int parameterIndex);   // map a param if in learn mode (shared by value-change + touch)

    juce::AudioPluginFormatManager formatManager;
    juce::CriticalSection hostLock;           // guards chain + mapped + driveLanes

    struct Node { std::unique_ptr<juce::AudioPluginInstance> inst; juce::String name; juce::String path; bool bypassed = false; };
    std::vector<Node> chain;                  // [0] = instrument, [1..] = effects, in series

    struct MapRef { int node; int param; };
    std::vector<MapRef> mapped;               // user-mapped params across the chain
    std::atomic<bool> learnMode  { false };
    std::atomic<int>  mapVersion { 0 };
    std::atomic<bool> demoMode   { true };   // fail-safe default: limited until proven entitled
    juce::Random demoRng;                    // offline-render noise in demo
    // Demo move/freeze cycle, TIED TO TRANSPORT: move budget accrues only while playing
    // (setup time doesn't burn it); the freeze runs on real-time. Both persisted -> a reload
    // can't grant a fresh move window. See docs/stride-demo-mode-spec.md.
    std::atomic<double> demoMoveUsedMs    { 0.0 };   // playback ms used in the current move window (0..kDemoMoveSecs*1000)
    std::atomic<double> demoFreezeUntilMs { 0.0 };   // absolute real-time ms until which we're frozen (0 = not frozen)
    std::atomic<bool>   demoFrozen        { false };
    std::atomic<int>    demoResumeSecs    { 0 };
    void loadDemoCycleState();               // read the persisted cycle at construction

    struct StoredLane { int node; int param; std::vector<float> times, values, curves; };
    std::vector<StoredLane> driveLanes;
    double driveClipBeats = 16.0;

    // single-level undo for device removal AND full-chain Clear (restores patches + mapped lanes/curves)
    struct RemovedSnapshot
    {
        bool valid = false;
        struct Dev { juce::String path; juce::MemoryBlock state; int position = 0;
                     std::vector<int> params; std::vector<StoredLane> lanes; bool bypassed = false; };
        std::vector<Dev> devices;          // 1 for a single ✕, the whole chain for Clear
    };
    RemovedSnapshot lastRemoved;
    void restoreNextDevice (std::shared_ptr<std::vector<RemovedSnapshot::Dev>> devs, size_t i);  // sequential async restore (keeps order)
    static float interp (const std::vector<float>& xs, const std::vector<float>& ys, const std::vector<float>& cs, float x);

    double currentSampleRate = 44100.0;
    int    currentBlockSize  = 512;
    double freeRunPhase = 0.0;

    JUCE_DECLARE_NON_COPYABLE_WITH_LEAK_DETECTOR (StrideWrapperProcessor)
};
