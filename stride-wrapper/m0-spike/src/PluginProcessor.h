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
#include <array>
#include <functional>

class StrideWrapperProcessor : public juce::AudioProcessor,
                               private juce::AudioProcessorListener,
                               private juce::AsyncUpdater
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
    void loadPlugin (const juce::File& pluginFile);   // APPENDS to the chain (.vst3 everywhere; .component AU on macOS)
    void clearChain();
    void removeNode (int index);                      // revoke ONE device (deliberate, from Stride's UI)
    void moveNode (int from, int to);                 // reorder the chain (drag) — reindexes mapped params/lanes so curves stay on their knobs
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
    void setUnlearnMode (bool shouldUnlearn);            // arm "unmap by touch" — touching a mapped knob removes it from the canvas
    bool isUnlearning() const { return unlearnMode.load(); }
    // Touch-unmap drains its removed POSITION here (not a positional rack re-push): the canvas
    // splices that one lane and re-indexes the rest, so every surviving lane keeps its own
    // curve/lock/RANGE. A full re-push keys lanes by the positional _path ("wrap:<i>"), which
    // renumbers on erase and would carry the removed lane's range onto its neighbour. -1 = none.
    int consumeUnmapByTouchPos() { return pendingUnmapPos.exchange (-1); }

    // Demo mode (no VST entitlement): runs but capped (3 params, no save, offline=noise).
    // Set live from the license gate; seeded at construction from the cached entitlement so
    // offline bounces are correct with the UI closed. See docs/stride-demo-mode-spec.md.
    void setDemoMode (bool d) { demoMode.store (d); }
    bool isDemo() const { return demoMode.load(); }
    // Soft lock: after a Discovery Pass expires the EDITOR is locked (no new maps/curves/
    // devices) but the processor KEEPS driving the curves already in the project, so existing
    // work sounds identical. Recomputed NATIVELY from the cached entitlement (can't be lifted
    // by editing the WebView) — the security boundary, not the JS overlay.
    void setEditLocked (bool b) { editLocked.store (b); }
    bool isEditLocked() const { return editLocked.load(); }
    // Whether the processor may DRIVE existing curves. True only if this machine is entitled
    // (paid / active pass) OR holds an EXPIRED pass minted for THIS device (soft lock keeps your
    // own work playing). A shared project opened on a never-passed machine -> false -> no free
    // modulation. Recomputed natively on the editor timer; read on the audio thread (atomic).
    void setDriveAllowed (bool b) { driveAllowed.store (b); }
    bool isDriveAllowed() const { return driveAllowed.load(); }
    bool isDemoFrozen() const { return demoFrozen.load(); }        // in the "freeze" half of the demo cycle
    bool isDemoPlaying() const { return demoPlaying.load(); }      // demo + transport playing + not frozen (= actively modulating)
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

    // ── Host automation: a fixed pool of VST3 macro params so the DAW can automate /
    //    record the hosted knobs (docs/stride-wrapper-host-automation-spec.md). Additive —
    //    does NOT change the plugin identity, so existing projects still load. ──
    static constexpr int kMacroCount = 32;
    enum class DriveMode { Live, Automation };   // global: Stride curves drive vs the DAW drives
    void setDriveMode (DriveMode m);
    DriveMode getDriveMode() const { return driveMode.load(); }
    int  exposedMacroCount() const;              // assigned macro slots (for the panel note)
    void announceMacrosToHost();                 // fire a host gesture on each exposed macro so Ableton's Configure catches them (message thread)
    void pushMacroValuesToHost();                // Live mode: report the live modulation value to the host so Ableton's params FOLLOW it (and record if armed). ~15Hz, gesture-wrapped, OFF under Maschine. Message thread.
    void closeMacroGestures();                   // end any open macro gestures — the editor timer is their only closer, so the editor DTOR must call this (message thread)

    // ── live curve drive ──
    struct DriveLane { int position; std::vector<float> times, values, curves; };
    void setDriveCurves (const std::vector<DriveLane>& lanes, double clipBeats);

    std::atomic<bool>  modEnabled   { true };
    std::atomic<float> lastModValue { 0.0f };       // TRUE loop phase 0..1 (every block, playing or not) — the UI playhead position
    std::atomic<bool>  transportActive { false };   // host transport running (standalone free-run counts) — playhead on/off + trail

    // Interactive load failures surface in the UI instead of a silent DBG — on Mac the
    // #1 real-world cause is an Intel-only bundle inside an arm64 host process (Logic).
    // Message thread only; owned by the editor (set in its ctor, reset in its dtor).
    std::function<void (const juce::String& name, const juce::String& error)> onLoadFailed;

private:
    void audioProcessorParameterChanged (juce::AudioProcessor*, int parameterIndex, float newValue) override;
    void audioProcessorParameterChangeGestureBegin (juce::AudioProcessor*, int parameterIndex) override;   // click-to-map (touch w/o moving)
    void audioProcessorChanged (juce::AudioProcessor*, const juce::AudioProcessorListener::ChangeDetails&) override {}

    void prepareNode (int i);                 // (re)prepare one chain node (under lock)
    int  nodeIndexOf (juce::AudioProcessor*) const;   // which chain slot a processor is (under lock)
    void mapParam (juce::AudioProcessor*, int parameterIndex);   // map a param if in learn mode (shared by value-change + touch)
    void unmapParamByTouch (juce::AudioProcessor*, int parameterIndex);   // remove a param if in unlearn mode (touch-to-unmap)

    // Host-automation macro layer (all caller-holds-hostLock unless noted).
    void reassignMacros();                        // stable (re)assign of macro slots to mapped params — keeps valid slots, fills -1/dup
    int  macroSlotFor (int node, int param) const;// the macro slot driving this hosted param, or -1
    void refreshMacroLabels();                    // MESSAGE THREAD: relabel macros from mapped names + updateHostDisplay
    void handleAsyncUpdate() override;            // coalesced relabel trigger (message thread)

    juce::AudioPluginFormatManager formatManager;
    juce::CriticalSection hostLock;           // guards chain + mapped + driveLanes

    struct Node { std::unique_ptr<juce::AudioPluginInstance> inst; juce::String name; juce::String path; bool bypassed = false; };
    std::vector<Node> chain;                  // [0] = instrument, [1..] = effects, in series

    struct MapRef { int node; int param; int macroSlot = -1; };   // macroSlot = DAW-facing param slot (-1 = not exposed)
    std::vector<MapRef> mapped;               // user-mapped params across the chain

    // A relabelable VST3 parameter. A free slot reads "Stride N"; an assigned slot takes the
    // hosted param's real name ("Serum: Cutoff"). These are what the DAW automates/records.
    class MacroParameter : public juce::AudioProcessorParameter
    {
    public:
        explicit MacroParameter (int slotIndex) : slot (slotIndex) {}
        float getValue() const override                    { return value.load(); }
        void  setValue (float v) override                  { value.store (juce::jlimit (0.0f, 1.0f, v)); }
        float getDefaultValue() const override             { return 0.0f; }
        juce::String getName (int maxLen) const override   { const juce::String l = label; return (l.isNotEmpty() ? l : ("Stride " + juce::String (slot + 1))).substring (0, maxLen); }
        juce::String getLabel() const override             { return {}; }
        float getValueForText (const juce::String& t) const override { return t.getFloatValue(); }
        juce::String getText (float v, int) const override { return juce::String (v, 3); }
        bool isAutomatable() const override                { return true; }
        juce::String label;                    // "" = free (message-thread writes; host reads names on the message thread)
        std::atomic<float> value { 0.0f };     // audio-thread safe
        float lastPushed = -1.0f;              // last value host-notified (message thread only; change-detect for the drive push)
        bool  gestureOpen = false;             // an OPEN host gesture spans each moving stretch (message thread only)
        juce::uint32 lastEditMs = 0;           // last host-notify time — stillness ends the gesture (message thread only)
        const int slot;
    };
    std::array<MacroParameter*, kMacroCount> macroParams {};   // owned by the AudioProcessor (addParameter)
    juce::uint32 lastMirrorPushMs = 0;                          // Live-mode mirror pacing (~15Hz cap; message thread only)
    std::atomic<DriveMode> driveMode { DriveMode::Live };
    std::atomic<bool> learnMode  { false };
    std::atomic<bool> unlearnMode { false };   // Map (add-by-touch) and Unmap (remove-by-touch) are mutually exclusive
    std::atomic<int>  mapVersion { 0 };
    std::atomic<int>  pendingUnmapPos { -1 };   // touch-unmap: removed position, drained by the editor (see consumeUnmapByTouchPos)
    std::atomic<bool> demoMode   { true };   // fail-safe default: limited until proven entitled
    std::atomic<bool> editLocked   { false };  // Discovery Pass expired -> block edits, keep audio (soft lock)
    std::atomic<bool> driveAllowed { false };  // fail-safe: no curve drive until entitlement is confirmed (this device)
    juce::Random demoRng;                    // offline-render noise in demo
    // Demo move/freeze cycle, TIED TO TRANSPORT: move budget accrues only while playing
    // (setup time doesn't burn it); the freeze runs on real-time. Both persisted -> a reload
    // can't grant a fresh move window. See docs/stride-demo-mode-spec.md.
    std::atomic<double> demoMoveUsedMs    { 0.0 };   // playback ms used in the current move window (0..kDemoMoveSecs*1000)
    std::atomic<double> demoFreezeUntilMs { 0.0 };   // absolute real-time ms until which we're frozen (0 = not frozen)
    std::atomic<bool>   demoFrozen        { false };
    std::atomic<bool>   demoPlaying       { false };   // demo + playing + not frozen -> badge shows "live"
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
                     std::vector<int> params; std::vector<int> slots; std::vector<StoredLane> lanes; bool bypassed = false; };
        std::vector<Dev> devices;          // 1 for a single ✕, the whole chain for Clear
    };
    RemovedSnapshot lastRemoved;
    void restoreNextDevice (std::shared_ptr<std::vector<RemovedSnapshot::Dev>> devs, size_t i);  // sequential async restore (keeps order)
    static float interp (const std::vector<float>& xs, const std::vector<float>& ys, const std::vector<float>& cs, float x);

    double currentSampleRate = 44100.0;
    int    currentBlockSize  = 512;
    double freeRunPhase = 0.0;
    juce::AudioBuffer<float> hostWorkBuffer;   // wide scratch for hosted plugins whose main bus is >2ch (prevents the null-channel memset crash)

    JUCE_DECLARE_NON_COPYABLE_WITH_LEAK_DETECTOR (StrideWrapperProcessor)
};
