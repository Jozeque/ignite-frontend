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
    // Range bands are ENGINE-OWNED (project-persistent) like the curves: client-only ranges
    // were wiped/misrouted by positional rack re-pushes (field report 2026-07-16). The canvas
    // reports every committed edit via set_range; rack_scanned echoes them back so every
    // rebuild — re-push OR project reopen — restores the bands from the source of truth.
    void setMappedRange (int pos, bool on, float lo, float hi);   // message thread (editor bridge)
    void setMappedRanges (const juce::Array<juce::var>& items);   // Range-for-Group: batch of {id,on,min,max} — ONE lock pass, ONE dirty mark
    juce::Array<juce::var> getMappedRanges() const;               // {on,lo,hi} per mapped param, mapped order
    // Lane colors - same ownership story as ranges (1.1.11): the canvas reports each
    // pick via set_color; rack_scanned echoes them back so every rebuild restores them.
    void setMappedColor (int pos, int idx);                       // message thread (editor bridge); -1 = back to AUTO
    juce::Array<int> getMappedColors() const;                     // colorIdx per mapped param, mapped order
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

    // ── Tempo: Sync-to-project (default) / Manual BPM ──
    // Sync   = follow the host exactly (byte-identical to the old behavior).
    // Manual = the motion clock runs at ITS OWN tempo but stays TRANSPORT-MAPPED
    //          (beats × manual/host — one multiply, deterministic: loops/scrubs/renders
    //          stay aligned; 70 on a 140 set = every lane half-time, any 5–999 value).
    enum class TempoMode { Project = 0, Manual = 1 };
    void setTempoMode (int mode, float bpm);             // bridge (message thread); persisted; host-dirty
    int   getTempoMode() const { return tempoMode.load(); }
    float getManualBpm() const { return manualBpm.load(); }

    // ── live curve drive ──
    struct DriveLane { int position; std::vector<float> times, values, curves; };
    void setDriveCurves (const std::vector<DriveLane>& lanes, double clipBeats);

    // ── MIDI keyswitches (the "playful" octave) ─────────────────────
    // Kontakt-style: while ON, MIDI notes 0..11 (C-2..B-2 in Live's labeling) are CONSUMED —
    // the instrument never hears them — and note-ons 0..7 fire the one-click tools (the six
    // Motion generators + Mutate + Shuffle, same functions as the toolbar). Playable from a
    // pad row, recordable into a clip, automatable like any performance. OFF by default and
    // per-project persisted, so an existing bassline in the switch octave can't fire tools
    // until the user opts in. Notes 8..11 are reserved (consumed, no action yet).
    void setKeyswitchEnabled (bool on)  { ksEnabled.store (on); hostDirtyPending.store (true); }
    bool isKeyswitchEnabled() const     { return ksEnabled.load(); }
    // The switch octave's bottom note: 0 (C-2, unreachable by hands — pads/clips, zero
    // collision risk), 12 (C-1) or 24 (C0, on every keyboard — may sit on real bass notes;
    // the user's informed choice, since the whole mode is opt-in). Anything else clamps to 0.
    void setKeyswitchBase (int base)    { ksBase.store (base == 12 || base == 24 ? base : 0); hostDirtyPending.store (true); }
    int  getKeyswitchBase() const       { return ksBase.load(); }
    juce::uint32 consumeKeyswitchMask() { return ksPendingMask.exchange (0); }   // editor timer drains (bit n = note base+n)

    // ── typed-note input (the QWERTY piano, macOS) ──
    // Relaying keystrokes to Live proved unwinnable on macOS: Live's typing piano only
    // accepts keys when the KEY window is one of Live's own, and AppKit routes keyboard
    // events to the key window regardless of the event's windowNumber — so any synthetic
    // key posted while Stride (or a hosted synth) is focused either boomerangs into our
    // own WebView or dies in the hosted window's responder chain. So we stop relaying:
    // the NSEvent monitor consumes the note keys and enqueues REAL MIDI here, and
    // processBlock merges it into the instrument's MidiBuffer at the next block — tight,
    // deterministic, chord-safe, and independent of Live's window gating entirely.
    // (While Live is RECORDING the monitor stands down instead, so the notes go through
    // Live's own piano and land in the clip — recording keeps working.)
    void queueTypedNote (int midiNote, int velocity, bool isOn);   // message thread (SPSC producer)
    void flushTypedNotes();                                        // any thread: note-off everything injected (blur/close/teardown)

    std::atomic<bool>  modEnabled   { true };
    std::atomic<float> lastModValue { 0.0f };       // TRUE loop phase 0..1 (every block, playing or not) — the UI playhead position
    std::atomic<bool>  transportActive { false };   // host transport running (standalone free-run counts) — playhead on/off + trail
    std::atomic<bool>  transportRecording { false }; // host RECORDING — gates the macro mirror (every notified edit is a DAW undo entry)

    // Interactive load failures surface in the UI instead of a silent DBG — on Mac the
    // #1 real-world cause is an Intel-only bundle inside an arm64 host process (Logic).
    // Message thread only; owned by the editor (set in its ctor, reset in its dtor).
    std::function<void (const juce::String& name, const juce::String& error)> onLoadFailed;

    // Host dirty-flag: edits INSIDE Stride (chain, mapping, curves, hosted-knob tweaks)
    // live in OUR chunk and are invisible to the DAW — without this the set never shows
    // "unsaved changes" and crash recovery has no reason to re-capture Stride's state
    // (a user lost an unsaved chain to a Live crash, 2026-07-16). Mutation sites set the
    // flag (any thread); the editor timer consumes it and fires the actual host notify
    // on the message thread, throttled. Restore-from-project paths deliberately DON'T set it.
    bool consumeHostDirty() { return hostDirtyPending.exchange (false); }

private:
    void audioProcessorParameterChanged (juce::AudioProcessor*, int parameterIndex, float newValue) override;
    void audioProcessorParameterChangeGestureBegin (juce::AudioProcessor*, int parameterIndex) override;   // click-to-map (touch w/o moving)
    void audioProcessorChanged (juce::AudioProcessor*, const juce::AudioProcessorListener::ChangeDetails& d) override
    {
        // A hosted plugin loaded a preset / rewrote its own state — that state lives in OUR
        // chunk, so the DAW's project just became dirty too.
        if (d.programChanged || d.nonParameterStateChanged) hostDirtyPending.store (true);
    }

    static BusesProperties strideBuses();     // stereo out everywhere; stereo AUDIO IN except the AU (frozen aumu surface)
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

    // The clock HOSTED devices see. JUCE gives a hosted instance NO playhead unless its host
    // sets one — so every arp/sequencer/synced-LFO/delay inside Stride free-ran at the plugin's
    // own default tempo, deaf to the project (field report: Bitwig, 2026-07-26). processBlock
    // publishes the block-accurate clock the engine itself runs on (host-verbatim in Project
    // sync, the scaled clock in Manual, the free-run clock standalone) and every instance is
    // wired to it at creation (setPlayHead). Declared BEFORE `chain` so it outlives every
    // hosted instance during destruction.
    struct ChildPlayHead : juce::AudioPlayHead
    {
        juce::Optional<PositionInfo> getPosition() const override
        {
            const juce::SpinLock::ScopedLockType g (lock);
            return info;
        }
        void publish (const PositionInfo& p)
        {
            const juce::SpinLock::ScopedLockType g (lock);
            info = p;
        }
        mutable juce::SpinLock lock;              // audio thread writes, plugin GUI threads may read — tiny copy, uncontended
        juce::Optional<PositionInfo> info;
    };
    ChildPlayHead childPlayHead;

    struct Node { std::unique_ptr<juce::AudioPluginInstance> inst; juce::String name; juce::String path; bool bypassed = false; };
    std::vector<Node> chain;                  // [0] = instrument, [1..] = effects, in series

    struct MapRef { int node; int param; int macroSlot = -1;      // macroSlot = DAW-facing param slot (-1 = not exposed)
                    bool rangeOn = false; float rangeLo = 0.0f, rangeHi = 1.0f;      // per-param output band (engine-owned, project-persistent)
                    int colorIdx = -1; };                                            // lane color (-1 = AUTO; 0..11 = canvas palette). ENGINE-OWNED like
                                                                                    // the range: positional re-pushes must never wipe or misroute it
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
    std::atomic<int>   tempoMode { 0 };             // 0=Project sync (default, byte-identical) / 1=Manual (own bpm, transport-mapped)
    std::atomic<float> manualBpm { 120.0f };        // Stride's own motion tempo in Manual (clamped 5..999)
    std::atomic<bool> hostDirtyPending { false };   // see consumeHostDirty()
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

    // Keyswitch state (see setKeyswitchEnabled). ksScratch is AUDIO THREAD ONLY — the
    // filtered MidiBuffer swapped in when a block actually contains switch-octave events
    // (clear() keeps its heap, so steady-state filtering allocates nothing).
    std::atomic<bool>         ksEnabled { false };
    std::atomic<int>          ksBase { 0 };        // bottom note of the switch octave (0 / 12 / 24)
    std::atomic<juce::uint32> ksPendingMask { 0 };
    juce::MidiBuffer          ksScratch;

    // Typed-note queue (see queueTypedNote). Fixed-size lock-free SPSC: message thread
    // writes, audio thread drains into the instrument's MidiBuffer. typedHeld tracks the
    // injected notes currently sounding (AUDIO THREAD ONLY) so a flush can end them all.
    struct TypedEvent { juce::uint8 note, vel; bool on; };
    juce::AbstractFifo typedFifo { 128 };
    TypedEvent typedEvents[128] = {};
    juce::uint64 typedHeld[2] = { 0, 0 };
    std::atomic<bool> typedFlush { false };

    // single-level undo for device removal AND full-chain Clear (restores patches + mapped lanes/curves)
    struct RemovedSnapshot
    {
        bool valid = false;
        struct Dev { juce::String path; juce::MemoryBlock state; int position = 0;
                     std::vector<int> params; std::vector<int> slots; std::vector<StoredLane> lanes; bool bypassed = false;
                     std::vector<char> ron; std::vector<float> rlo, rhi;
                     std::vector<int> col; };                                 // per-param lane colors (parallel to params; -1 = AUTO)   // per-param range bands (parallel to params; char ≠ vector<bool>)
        std::vector<Dev> devices;          // 1 for a single ✕, the whole chain for Clear
    };
    RemovedSnapshot lastRemoved;
    // Sequential async restore (keeps order). `gen` stamps which restore wave a step belongs
    // to: any newer setState/undo bumps restoreGeneration, and stale steps see the mismatch
    // and abandon instead of interleaving their inserts with the new wave's (undo-scrubbing
    // in Bitwig queues several full restores back-to-back).
    void restoreNextDevice (std::shared_ptr<std::vector<RemovedSnapshot::Dev>> devs, size_t i, int gen);
    std::atomic<int> restoreGeneration { 0 };
    // MESSAGE THREAD. Closes every hosted-device window (destroying their editors) via the
    // active editor — hosted editors must die BEFORE their instances (see setStateInformation).
    void closeHostedEditorsForTeardown();
    static float interp (const std::vector<float>& xs, const std::vector<float>& ys, const std::vector<float>& cs, float x);

    double currentSampleRate = 44100.0;
    int    currentBlockSize  = 512;
    double freeRunPhase = 0.0;
    juce::AudioBuffer<float> hostWorkBuffer;   // wide scratch for hosted plugins whose main bus is >2ch (prevents the null-channel memset crash)

    // Async work (setState marshal, instance-restore callbacks) holds WeakReferences, never a
    // raw `this` — a host can delete the processor while a restore is still in flight.
    JUCE_DECLARE_WEAK_REFERENCEABLE (StrideWrapperProcessor)
    JUCE_DECLARE_NON_COPYABLE_WITH_LEAK_DETECTOR (StrideWrapperProcessor)
};
