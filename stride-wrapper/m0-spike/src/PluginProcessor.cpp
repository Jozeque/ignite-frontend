#include "PluginProcessor.h"
#include "PluginEditor.h"
#include "License.h"          // cachedEntitled() — seeds demo mode at construction

#include <algorithm>
#include <cmath>
#include <memory>

namespace {
    // Encode/decode a curve lane's float arrays as comma-separated text for the
    // saved-state XML (precision is plenty for 0..1 curves; keeps it debuggable).
    juce::String floatsToStr (const std::vector<float>& v)
    {
        juce::StringArray a; for (float f : v) a.add (juce::String (f, 6)); return a.joinIntoString (",");
    }
    void strToFloats (const juce::String& s, std::vector<float>& out)
    {
        out.clear();
        if (s.isEmpty()) return;
        juce::StringArray a; a.addTokens (s, ",", "");
        for (auto& t : a) if (t.isNotEmpty()) out.push_back ((float) t.getDoubleValue());
    }

    // Resolve which registered hosting format owns this file/bundle (VST3 everywhere,
    // AU .components on macOS) and list the plugins inside it. The saved chain stores
    // plain paths, so project restore resolves the format the exact same way — an old
    // VST3-only save and a Logic-side .component both round-trip through here.
    void findPluginTypesForFile (juce::AudioPluginFormatManager& fm, const juce::String& path,
                                 juce::OwnedArray<juce::PluginDescription>& out)
    {
        for (auto* f : fm.getFormats())
            if (f != nullptr && f->fileMightContainThisPluginType (path))
            {
                f->findAllTypesForFile (out, path);
                if (! out.isEmpty()) return;
            }
    }

    // Configure a hosted plugin to MAIN BUS ONLY. enableAllBuses() switches on aux/
    // sidechain buses (e.g. FabFilter Pro-Q 4 / Saturn 2's sidechain input); JUCE then
    // expects the process buffer to carry those extra channels too, but Stride passes
    // only a stereo buffer — so the plugin reads/writes past it and crashes (Mac SIGSEGV
    // in _platform_memmove; undefined-but-survived on Windows). Keep only bus 0 on each
    // side so the plugin never expects more channels than we hand it. Call BEFORE
    // prepareToPlay (bus layout can only change while the plugin is inactive).
    void configureHostedBuses (juce::AudioProcessor& inst)
    {
        for (bool isInput : { true, false })
        {
            for (int b = inst.getBusCount (isInput) - 1; b >= 1; --b)
                if (auto* bus = inst.getBus (isInput, b))
                    bus->enable (false);
            if (auto* main = inst.getBus (isInput, 0))
            {
                main->enable (true);
                // Constrain a WIDER-than-stereo main bus to stereo where the plugin allows it
                // (surround / multi-out orchestral instruments) so it doesn't expect more
                // channels than our stereo host buffer carries. Best effort — processBlock's
                // work buffer is the guaranteed backstop if the plugin refuses a stereo layout.
                if (main->getNumberOfChannels() > 2)
                    main->setCurrentLayout (juce::AudioChannelSet::stereo());
            }
        }
    }

}

// Stride's own buses. 1.2.0 adds a stereo AUDIO INPUT so a guitar/vocal/anything can be
// routed INTO the chain (build an FX-only chain and Stride is a modulated pedalboard;
// with an instrument first, the input is simply overwritten — synth behavior unchanged).
// Bitwig/Reaper feed it natively from the track chain; Live routes via "Audio To ▸
// Stride"; the standalone takes the mic/line in (JUCE auto-mutes it against feedback
// until the user enables it). The AU is EXCLUDED: the aumu identity (aumu/SwM0/Strd)
// is frozen for shipped Logic projects and its validated surface must not change —
// audio-in on Logic waits for its own auval-gated pass.
juce::AudioProcessor::BusesProperties StrideWrapperProcessor::strideBuses()
{
    BusesProperties b;
    if (juce::PluginHostType::getPluginLoadedAs() != wrapperType_AudioUnit)
        b = b.withInput ("Audio In", juce::AudioChannelSet::stereo(), true);
    return b.withOutput ("Output", juce::AudioChannelSet::stereo(), true);
}

StrideWrapperProcessor::StrideWrapperProcessor()
    : juce::AudioProcessor (strideBuses())
{
    formatManager.addFormat (std::make_unique<juce::VST3PluginFormat>());
   #if JUCE_PLUGINHOST_AU && JUCE_MAC
    // Logic users' libraries are often AU-first (some plugins are installed AU-only),
    // so on macOS Stride hosts both formats. Windows stays VST3-only (AU doesn't exist there).
    formatManager.addFormat (std::make_unique<juce::AudioUnitPluginFormat>());
   #endif

    // Publish the fixed macro-parameter pool so the DAW can automate/record the hosted
    // knobs. addParameter takes ownership; we keep raw pointers for the drive loop. This is
    // additive (fixed count, stable order) and does NOT change the plugin identity.
    for (int i = 0; i < kMacroCount; ++i)
    {
        auto* mp = new MacroParameter (i);
        macroParams[(size_t) i] = mp;
        addParameter (mp);
    }

    // Stride's OWN controls, DAW-automatable (2026-08-07): BPM (log-mapped, lives in
    // Manual tempo mode) + the Active sliders. Appended AFTER the macro pool — additive,
    // identity and indices 0..31 untouched (the macro-pool precedent). Defaults are the
    // NEUTRAL slider positions; the editor relays on CHANGE only, so an untouched param
    // never edits anything.
    {
        const struct { const char* name; float def; } ctls[kControlCount] = {
            { "Stride BPM",     ctlBpmToNorm (120.0f) },
            { "Stride Smooth",  0.0f },
            { "Stride Depth",   0.5f },   // Depth (intensity) runs 0..200 with NEUTRAL at 100 — 0.5 normalized
            { "Stride Curve",   0.0f },
            { "Stride Floor",   0.0f },
            { "Stride Ceiling", 1.0f },
        };
        for (int i = 0; i < kControlCount; ++i)
        {
            auto* cp = new ControlParameter (ctls[i].name, ctls[i].def);
            controlParams[(size_t) i] = cp;
            addParameter (cp);
        }
    }

    // Anti-rollback: stamp this launch into the pass clock (untrusted local clock; no-op until a
    // trusted server value bootstraps it) so a rolled-back clock can't revive an expired pass.
    stride_license::raisePassClock (juce::Time::getCurrentTime().toMilliseconds(), false);
    // Native, device-bound entitlement seed (the editor timer keeps these live). editLocked blocks
    // editing unless actively entitled; driveAllowed lets EXISTING curves keep playing only if this
    // machine is/was entitled (paid, active pass, or an expired pass minted for THIS device) —
    // a shared project on a never-passed machine gets no free modulation.
    const bool ent = stride_license::cachedEntitled();
    editLocked.store (! ent);
    driveAllowed.store (ent || stride_license::cachedExpiredPass());
    demoMode.store (false);                                 // the 24h Discovery Pass replaces the freeze demo
    loadDemoCycleState();                                   // (kept; the freeze cycle is dormant with demoMode=false)
}

void StrideWrapperProcessor::loadDemoCycleState()
{
    auto f = stride_license::dataDir().getChildFile ("stride-demo.json");
    if (! f.existsAsFile()) return;
    const auto v = juce::JSON::parse (f.loadFileAsString());
    demoMoveUsedMs.store    ((double) v.getProperty ("moveUsedMs", 0.0));
    demoFreezeUntilMs.store ((double) (juce::int64) v.getProperty ("freezeUntilMs", (juce::int64) 0));
}

void StrideWrapperProcessor::saveDemoCycleState() const
{
    stride_license::dataDir().createDirectory();
    auto* o = new juce::DynamicObject();
    o->setProperty ("moveUsedMs",    demoMoveUsedMs.load());
    o->setProperty ("freezeUntilMs", (juce::int64) demoFreezeUntilMs.load());
    stride_license::dataDir().getChildFile ("stride-demo.json").replaceWithText (juce::JSON::toString (juce::var (o)));
}

StrideWrapperProcessor::~StrideWrapperProcessor()
{
    cancelPendingUpdate();   // no relabel callback can fire into a half-destroyed processor
    const juce::ScopedLock sl (hostLock);
    for (auto& n : chain) if (n.inst) { n.inst->setPlayHead (nullptr); n.inst->removeListener (this); }
    chain.clear();
}

// ── lifecycle ──────────────────────────────────────────────────────
void StrideWrapperProcessor::prepareToPlay (double sampleRate, int samplesPerBlock)
{
    currentSampleRate = sampleRate;
    currentBlockSize  = samplesPerBlock;
    const juce::ScopedLock sl (hostLock);
    hostWorkBuffer.setSize (16, juce::jmax (1, samplesPerBlock), false, false, true);   // pre-size so >2ch instruments don't realloc on the audio thread
    for (int i = 0; i < (int) chain.size(); ++i) prepareNode (i);
}

void StrideWrapperProcessor::releaseResources()
{
    const juce::ScopedLock sl (hostLock);
    for (auto& n : chain) if (n.inst) n.inst->releaseResources();
}

void StrideWrapperProcessor::prepareNode (int i)
{
    if (i >= 0 && i < (int) chain.size() && chain[(size_t) i].inst)
    {
        chain[(size_t) i].inst->setRateAndBufferSizeDetails (currentSampleRate, currentBlockSize);
        chain[(size_t) i].inst->prepareToPlay (currentSampleRate, currentBlockSize);
    }
}

bool StrideWrapperProcessor::isBusesLayoutSupported (const BusesLayout& layouts) const
{
    if (layouts.getMainOutputChannelSet() != juce::AudioChannelSet::stereo()) return false;
    // Input (where the bus exists — see strideBuses): stereo or off. Hosts that route mono
    // sources upmix into a stereo destination themselves; keeping two shapes keeps the
    // in-place processBlock trivial (input arrives in the same 2 channels the chain writes).
    const auto in = layouts.getMainInputChannelSet();
    return in == juce::AudioChannelSet::disabled() || in == juce::AudioChannelSet::stereo();
}

int StrideWrapperProcessor::nodeIndexOf (juce::AudioProcessor* p) const
{
    for (int i = 0; i < (int) chain.size(); ++i)
        if (chain[(size_t) i].inst.get() == p) return i;
    return -1;
}

// ── audio: drive mapped params from curves, then run the chain in series ──
void StrideWrapperProcessor::processBlock (juce::AudioBuffer<float>& buffer, juce::MidiBuffer& midi)
{
    juce::ScopedNoDenormals noDenormals;

    // Transport in BEATS. In the STANDALONE there's no transport, so always free-run at
    // 120 BPM (so curves animate without a Play button). In a DAW: follow the playhead
    // and HOLD when stopped/paused.
    const int tMode = tempoMode.load();   // 0=Project sync / 1=Manual (own BPM, transport-mapped)
    double beats = freeRunPhase;
    bool clockFree = (wrapperType == wrapperType_Standalone);
    bool transportPlaying = false;
    bool transportRec = false;
    double hostBpm = 120.0;
    juce::Optional<juce::AudioPlayHead::PositionInfo> hostPos;   // kept whole — forwarded to hosted devices below
    // Read the playhead whenever the host offers one — recording (the mirror gate) and
    // play-state stay host-truth in every mode.
    if (auto* ph = getPlayHead())
    {
        if (auto pos = ph->getPosition())
        {
            hostPos = pos;
            transportPlaying = pos->getIsPlaying();
            transportRec = pos->getIsRecording();
            if (auto bpm = pos->getBpm()) hostBpm = *bpm;
            if (! clockFree)
            {
                if (auto ppq = pos->getPpqPosition()) { beats = *ppq; freeRunPhase = *ppq; }
                else if (transportPlaying) clockFree = true;
                // else: stopped with no position -> hold
            }
        }
        else clockFree = true;
    }
    else clockFree = true;

    if (clockFree)
    {
        // Standalone / no-transport free-run: classic 120, or the user's BPM in Manual.
        const double frBpm = (tMode == (int) TempoMode::Manual) ? (double) manualBpm.load() : 120.0;
        freeRunPhase += (double) buffer.getNumSamples() / currentSampleRate * (frBpm / 60.0);
        beats = freeRunPhase;
        transportPlaying = true;   // standalone / no-transport: treat as playing so the demo cycle advances
    }
    else if (tMode == (int) TempoMode::Manual)
    {
        // Manual Stride tempo: scale the beat clock (host 140, manual 70 → every lane
        // half-time). A position MAPPING (× ratio), not an integrated clock —
        // deterministic across loops, scrubs and offline renders. Sync (default)
        // never reaches this line: byte-identical to the old behavior.
        beats *= (double) manualBpm.load() / juce::jmax (1.0, hostBpm);
    }

    // Publish the clock the HOSTED devices see (see ChildPlayHead in the header). Project
    // sync with a live host position = that position verbatim, so a hosted arp locks to the
    // DAW exactly. Manual / free-run = the same scaled clock the curves ride, with bpm and
    // bar-start scaled consistently so beat-synced devices stay musical.
    {
        juce::AudioPlayHead::PositionInfo ci;
        if (runMode.load() != (int) RunMode::Transport)
        {
            // Notes-run (both flavors): hosted devices ride the GATE clock (previous block's
            // values — one block of latency, inaudible), so their arps run WITH the motion.
            const double gp = noteGatePhasePub.load();
            ci.setBpm ((tMode == (int) TempoMode::Manual) ? (double) manualBpm.load() : (hostPos ? hostBpm : 120.0));
            ci.setPpqPosition (gp);
            ci.setIsPlaying (noteGateOpenPub.load());
            ci.setTimeSignature (juce::AudioPlayHead::TimeSignature{});          // 4/4
            ci.setPpqPositionOfLastBarStart (std::floor (gp / 4.0) * 4.0);
        }
        else
        {
        if (hostPos) ci = *hostPos;
        const bool manual = (tMode == (int) TempoMode::Manual);
        if (! hostPos || manual || clockFree)
        {
            ci.setBpm (manual ? (double) manualBpm.load() : (hostPos ? hostBpm : 120.0));
            ci.setPpqPosition (beats);
            if (manual && hostPos && ! clockFree)
            {
                if (auto bs = hostPos->getPpqPositionOfLastBarStart())
                    ci.setPpqPositionOfLastBarStart (*bs * ((double) manualBpm.load() / juce::jmax (1.0, hostBpm)));
            }
            else if (! hostPos)
            {
                ci.setIsPlaying (transportPlaying);
                ci.setTimeSignature (juce::AudioPlayHead::TimeSignature{});      // 4/4
                ci.setPpqPositionOfLastBarStart (std::floor (beats / 4.0) * 4.0);
            }
        }
        }
        childPlayHead.publish (ci);
    }

    const juce::ScopedTryLock sl (hostLock);
    if (sl.isLocked() && ! chain.empty())
    {
        // ── MIDI keyswitches (the "playful" octave) ──────────────────
        // While ON, the whole switch octave (notes 0..11, C-2..B-2 in Live's labeling) is
        // CONSUMED before the instrument sees the buffer — Kontakt semantics — and note-ons
        // 0..7 latch action bits the editor drains at 30Hz into the same one-click tools the
        // toolbar fires (Chaos/Neuro/Reflector/S&H/Prism/Bloom/Mutate/Shuffle). Typed QWERTY
        // notes can't collide: their octave base floors at 12.
        if (ksEnabled.load())
        {
            const int kb = ksBase.load();   // bottom of the switch octave (0 / 12 / 24)
            bool hasSwitch = false;
            for (const auto meta : midi)
            {
                const auto m = meta.getMessage();
                if (m.isNoteOnOrOff() && m.getNoteNumber() >= kb && m.getNoteNumber() < kb + 12) { hasSwitch = true; break; }
            }
            if (hasSwitch)
            {
                ksScratch.clear();
                for (const auto meta : midi)
                {
                    const auto m = meta.getMessage();
                    const int  n = m.getNoteNumber();
                    if (m.isNoteOnOrOff() && n >= kb && n < kb + 12)
                    {
                        if (m.isNoteOn() && n - kb < 8)
                            ksPendingMask.fetch_or (1u << (n - kb));
                        continue;   // consumed — the instrument never hears the switch octave
                    }
                    ksScratch.addEvent (m, meta.samplePosition);
                }
                midi.swapWith (ksScratch);
            }
        }

        // Typed QWERTY notes -> the instrument, merged at sample 0 (latency: at most one
        // block). Drained BEFORE the gate scan below (typed jamming must run the Notes
        // clock too) and before the chain, so node 0 hears them this block. Moved up from
        // just-before-the-chain in 1.2.0 — nothing between the old and new spot reads midi.
        {
            if (typedFlush.exchange (false))
                for (int n = 0; n < 128; ++n)
                    if ((typedHeld[n >> 6] & (1ULL << (n & 63))) != 0)
                    {
                        midi.addEvent (juce::MidiMessage::noteOff (1, n), 0);
                        typedHeld[n >> 6] &= ~(1ULL << (n & 63));
                    }
            int s1, n1, s2, n2;
            typedFifo.prepareToRead (typedFifo.getNumReady(), s1, n1, s2, n2);
            auto emitTyped = [&] (int start, int num)
            {
                for (int i = 0; i < num; ++i)
                {
                    const auto& ev = typedEvents[start + i];
                    if (ev.on)
                    {
                        midi.addEvent (juce::MidiMessage::noteOn (1, (int) ev.note, (juce::uint8) ev.vel), 0);
                        typedHeld[ev.note >> 6] |= (1ULL << (ev.note & 63));
                    }
                    else
                    {
                        midi.addEvent (juce::MidiMessage::noteOff (1, (int) ev.note), 0);
                        typedHeld[ev.note >> 6] &= ~(1ULL << (ev.note & 63));
                    }
                }
            };
            emitTyped (s1, n1);
            emitTyped (s2, n2);
            typedFifo.finishedRead (n1 + n2);
        }

        // ── Notes-run gate (RunMode::NotesRetrig / NotesFree) ────────
        // Scanned AFTER the keyswitch filter (switch notes must not gate) and AFTER the
        // typed-note merge (QWERTY jamming gates too).
        //   RETRIG: first note-on from silence restarts the phrase at 0; any held note runs
        //           the clock; releasing everything freezes the knobs (transport-hold feel).
        //   FREE:   the first note only STARTS the clock — from then on it free-runs at the
        //           tempo-mode BPM, deaf to further notes. Switching run modes re-arms it.
        {
            const int rm = runMode.load();
            if (rm != lastRunModeSeen)   // clean slate on every mode switch (also re-arms FREE)
            {
                gateHeld[0] = gateHeld[1] = 0;
                noteGateLatched = false;
                noteGatePhase = 0.0;
                lastRunModeSeen = rm;
            }
            // FREE auto-re-arm (field report 2026-08-04): stopping the HOST transport parks the
            // phrase at zero, so the next clip's first note launches it fresh and it free-runs
            // from there — "the modulation starts where the MIDI starts". Before this, the only
            // re-arm was re-selecting the mode (h: "re-selecting the mode is the way to re-arm"),
            // and the clock kept advancing through the stop, so the next clip started at a
            // wall-clock-random phase. transportPlaying is still HOST truth at this line — the
            // gate overwrites it further down. Retrig needs nothing: silence already re-anchors
            // it. Standalone forces transportPlaying=true, so jam sessions never see an edge.
            if (rm == (int) RunMode::NotesFree && hostWasPlaying && ! transportPlaying)
            {
                noteGateLatched = false;
                noteGatePhase = 0.0;
            }
            hostWasPlaying = transportPlaying;
            if (rm == (int) RunMode::NotesRetrig || rm == (int) RunMode::NotesFree)
            {
                for (const auto meta : midi)
                {
                    const auto m = meta.getMessage();
                    if (m.isNoteOn())
                    {
                        // RETRIG restarts on EVERY note-from-silence; FREE resets only on the
                        // very first start (later notes are ignored by the running clock).
                        const bool fromSilence = (gateHeld[0] | gateHeld[1]) == 0;
                        if (rm == (int) RunMode::NotesRetrig ? fromSilence : ! noteGateLatched)
                            noteGatePhase = 0.0;
                        noteGateLatched = true;
                        const int n = m.getNoteNumber();
                        gateHeld[n >> 6] |= (1ULL << (n & 63));
                    }
                    else if (m.isNoteOff())
                    {
                        const int n = m.getNoteNumber();
                        gateHeld[n >> 6] &= ~(1ULL << (n & 63));
                    }
                    else if (m.isController() && (m.getControllerNumber() == 120 || m.getControllerNumber() == 123))
                        gateHeld[0] = gateHeld[1] = 0;   // host all-sound/all-notes-off = silence (FREE stays latched)
                }
                const bool gateOpen = (rm == (int) RunMode::NotesFree)
                                        ? noteGateLatched                        // FREE: started once = runs forever
                                        : (gateHeld[0] | gateHeld[1]) != 0;      // RETRIG: runs while held
                const double gateBpm = (tMode == (int) TempoMode::Manual) ? (double) manualBpm.load()
                                                                          : (hostPos ? hostBpm : 120.0);
                if (gateOpen)
                    noteGatePhase += (double) buffer.getNumSamples() / currentSampleRate * (gateBpm / 60.0);
                beats = noteGatePhase;         // the motion clock IS the gate clock now
                transportPlaying = gateOpen;   // comet runs / demo budget accrues while the clock runs
                noteGatePhasePub.store (noteGatePhase);
                noteGateOpenPub.store (gateOpen);
            }
        }

        // Demo work/freeze cycle: MOVE for kDemoMoveSecs, then FREEZE (skip the drive so the
        // hosted knobs HOLD their last value) for kDemoFreezeSecs, on the persisted wall-clock
        // (reload can't grant a fresh move window).
        bool demoFreezeNow = false;
        if (demoMode.load())
        {
            const double now = (double) juce::Time::getCurrentTime().toMilliseconds();
            const double freezeUntil = demoFreezeUntilMs.load();
            if (freezeUntil > now)                                    // in the real-time freeze
            {
                demoFreezeNow = true;
                demoResumeSecs.store ((int) std::ceil ((freezeUntil - now) / 1000.0));
            }
            else
            {
                if (freezeUntil > 0.0) { demoFreezeUntilMs.store (0.0); demoMoveUsedMs.store (0.0); }   // freeze ended -> reset move budget
                if (transportPlaying)                                 // move budget accrues ONLY while playing (setup time is free)
                {
                    const double used = demoMoveUsedMs.load() + 1000.0 * (double) buffer.getNumSamples() / currentSampleRate;
                    if (used >= kDemoMoveSecs * 1000.0)               // 10s of PLAYBACK used -> begin the freeze
                    {
                        demoMoveUsedMs.store (kDemoMoveSecs * 1000.0);
                        demoFreezeUntilMs.store (now + kDemoFreezeSecs * 1000.0);
                        demoFreezeNow = true;
                        demoResumeSecs.store ((int) kDemoFreezeSecs);
                    }
                    else
                    {
                        demoMoveUsedMs.store (used);
                        demoResumeSecs.store ((int) std::ceil ((kDemoMoveSecs * 1000.0 - used) / 1000.0));   // "live" countdown 10 -> 1 before the freeze
                    }
                }
                else demoResumeSecs.store ((int) std::ceil ((kDemoMoveSecs * 1000.0 - demoMoveUsedMs.load()) / 1000.0));   // not playing -> hold the remaining move budget
            }
            demoFrozen.store (demoFreezeNow);
            demoPlaying.store (transportPlaying && ! demoFreezeNow);   // actively modulating -> badge "live"
        }
        else { demoFrozen.store (false); demoPlaying.store (false); demoResumeSecs.store (0); }

        // Publish the TRUE loop position + transport state EVERY block (drive or not) — the
        // editor forwards them (≤30Hz, change-detected) so the canvas playhead rides the REAL
        // automation position instead of a wall-clock drift. Stopped = the phase holds and
        // the UI parks the head exactly where the DAW playhead is.
        const double cb = driveClipBeats > 0.0 ? driveClipBeats : 16.0;
        double ph = std::fmod (beats, cb);
        if (ph < 0.0) ph += cb;
        lastModValue.store ((float) (ph / cb));
        lastBeatsPub.store (beats);   // raw phrase beats — the notes-free comet wraps these per lane
        transportActive.store (transportPlaying);
        transportRecording.store (transportRec);

        // Drive existing curves ONLY when this machine is entitled (paid, active pass, or an
        // expired pass minted for THIS device = soft lock). A shared project on a never-passed
        // machine -> driveAllowed false -> the hosted synth plays dry (no free modulation).
        // (demo freeze retired; demoFreezeNow is always false now.)
        if (! demoFreezeNow && driveAllowed.load())
        {
            if (driveMode.load() == DriveMode::Automation)
            {
                // AUTOMATION: the DAW drives. Read each exposed macro's value (set by Ableton
                // automation / manual) and forward it to its hosted param. Curves are ignored.
                for (const auto& m : mapped)
                {
                    if (m.macroSlot < 0 || m.macroSlot >= kMacroCount) continue;
                    if (m.node < 0 || m.node >= (int) chain.size() || ! chain[(size_t) m.node].inst) continue;
                    auto& ps = chain[(size_t) m.node].inst->getParameters();
                    if (m.param >= 0 && m.param < ps.size())
                        if (auto* p = ps[m.param])
                            p->setValue (macroParams[(size_t) m.macroSlot]->getValue());
                }
            }
            else if (! driveLanes.empty())
            {
                // LIVE (default, unchanged): Stride curves drive the hosted params, and we MIRROR
                // the value onto the macro (plain setValue, no host-notify) so the DAW's display
                // follows the modulation without recording it. (cb/ph = the phase published above.)
                // NOTES FREE is ENDLESS (field request 2026-08-04): the phrase clock never wraps
                // globally — each lane wraps the RAW beat clock at its OWN boundary (or the bar
                // length when it has none), so one lane hitting the bar count can no longer
                // reset every other lane mid-cycle. Transport/Retrig keep the clip-anchored
                // phase (the 1.3.0 loop-brace lesson: raw-clock wraps break inside a Live loop).
                const bool freeEndless = (runMode.load() == (int) RunMode::NotesFree);
                for (const auto& lane : driveLanes)
                {
                    if (lane.node < 0 || lane.node >= (int) chain.size() || ! chain[(size_t) lane.node].inst) continue;
                    auto& ps = chain[(size_t) lane.node].inst->getParameters();
                    if (lane.param >= 0 && lane.param < ps.size())
                        if (auto* p = ps[lane.param])
                        {
                            // One lookup for slot + loop + quant (replaces the old macroSlotFor scan — same cost).
                            const MapRef* mr = nullptr;
                            for (const auto& m : mapped)
                                if (m.node == lane.node && m.param == lane.param) { mr = &m; break; }

                            // Per-lane LOOP + SPEED. Transport/Retrig: wrap the CLIP PHASE at the lane's
                            // own boundary, anchored to the canvas origin — the lane restarts the INSTANT
                            // the playhead crosses the drawn boundary (mid-bar included), exactly where
                            // the ghost ticks sit. An earlier build wrapped the absolute host clock:
                            // inside a Live loop brace the wraps landed at fmod(brace-start, L) offsets
                            // (field report 2026-08-02, "waits till the bar end") — so those modes stay
                            // on ph. NOTES FREE: wrap the RAW clock so every lane loops independently,
                            // forever. SPEED scales the lane's clock before the wrap (2x = double-time);
                            // speed 1 + no boundary = fmod(ph, cb) = ph, byte-identical to before.
                            // (The groove-grid quantize that lived here was retired 2026-08-04.)
                            const double spd = (mr != nullptr && mr->speed > 0.001f) ? (double) mr->speed : 1.0;
                            const double lL  = (mr != nullptr && mr->loopBeats > 0.01f) ? (double) mr->loopBeats : cb;
                            double lx = std::fmod ((freeEndless ? beats : ph) * spd, lL);
                            if (lx < 0.0) lx += lL;

                            const float v = interp (lane.times, lane.values, lane.curves, (float) lx);
                            p->setValue (v);
                            const int slot = (mr != nullptr) ? mr->macroSlot : -1;
                            if (slot >= 0) macroParams[(size_t) slot]->setValue (v);   // mirror for the DAW display
                        }
                }
            }
        }

        // Run the chain in series: node 0 is the instrument (gets the MIDI), the rest
        // process the audio in place. MIDI only goes to the instrument.
        juce::MidiBuffer noMidi;

        // A hosted instrument's main bus can be WIDER than our stereo host buffer (surround /
        // multi-out orchestral patches). Passing our 2-ch buffer would make JUCE hand the plugin
        // null channel pointers past ch 2 -> memset(null) -> SIGSEGV (reported on load). If any
        // node needs more channels, run the whole chain in a wider scratch buffer and fold the
        // main stereo pair back. Stereo chains take the unchanged fast path.
        int needCh = buffer.getNumChannels();
        for (const auto& n : chain)
            if (n.inst) needCh = juce::jmax (needCh, n.inst->getTotalNumInputChannels(), n.inst->getTotalNumOutputChannels());

        if (needCh <= buffer.getNumChannels())
        {
            for (size_t i = 0; i < chain.size(); ++i)
                if (chain[i].inst && ! chain[i].bypassed)
                    chain[i].inst->processBlock (buffer, i == 0 ? midi : noMidi);   // bypassed = skipped (audio passes through)
        }
        else
        {
            const int ns = buffer.getNumSamples();
            hostWorkBuffer.setSize (needCh, ns, false, false, true);   // grows once for an unusually wide plugin, then reused
            hostWorkBuffer.clear();
            for (int ch = 0; ch < buffer.getNumChannels(); ++ch)
                hostWorkBuffer.copyFrom (ch, 0, buffer, ch, 0, ns);
            for (size_t i = 0; i < chain.size(); ++i)
                if (chain[i].inst && ! chain[i].bypassed)
                    chain[i].inst->processBlock (hostWorkBuffer, i == 0 ? midi : noMidi);
            for (int ch = 0; ch < buffer.getNumChannels(); ++ch)
                buffer.copyFrom (ch, 0, hostWorkBuffer, ch, 0, ns);   // main L/R back to the host output
        }

        // DEMO: no clean bounces. During OFFLINE render (export/freeze) overwrite the
        // output with low-level noise; real-time playback (evaluation) is untouched.
        if (demoMode.load() && isNonRealtime())
            for (int ch = 0; ch < buffer.getNumChannels(); ++ch)
            {
                auto* wr = buffer.getWritePointer (ch);
                for (int i = 0; i < buffer.getNumSamples(); ++i)
                    wr[i] = (demoRng.nextFloat() * 2.0f - 1.0f) * 0.06f;
            }
    }
    else
    {
        // Locked-but-empty: no instrument to hear typed notes — DROP them (a full queue
        // replayed onto the next loaded synth as a stale burst would be worse). Lock-miss
        // keeps the queue: the events land on the very next block.
        if (sl.isLocked())
        {
            int s1, n1, s2, n2;
            typedFifo.prepareToRead (typedFifo.getNumReady(), s1, n1, s2, n2);
            typedFifo.finishedRead (n1 + n2);
            typedFlush.store (false);
            typedHeld[0] = typedHeld[1] = 0;
        }
        // Audio-in pass-through (1.2.0): with the input bus live, an EMPTY Stride behaves as
        // unity gain — a routed guitar stays audible while the user builds the FX chain.
        // Synth-only users are byte-identical: nothing routed in = the input is silence,
        // and the AU (which has no input bus) still clears. Lock-miss passes the dry block
        // too — a dry blip beats a dropout.
        if (getTotalNumInputChannels() == 0)
            buffer.clear();
    }
}

// Message-thread producer for the typed-note queue (see the header). Full queue = drop:
// 128 pending events means the audio thread is gone anyway.
void StrideWrapperProcessor::queueTypedNote (int midiNote, int velocity, bool isOn)
{
    int s1, n1, s2, n2;
    typedFifo.prepareToWrite (1, s1, n1, s2, n2);
    if (n1 > 0)
    {
        typedEvents[s1] = { (juce::uint8) juce::jlimit (0, 127, midiNote),
                            (juce::uint8) juce::jlimit (1, 127, velocity), isOn };
        typedFifo.finishedWrite (1);
    }
    juce::ignoreUnused (s2, n2);
}

void StrideWrapperProcessor::flushTypedNotes()
{
    typedFlush.store (true);   // audio thread ends every injected note next block
}

// ── hosted chain (message thread) ──────────────────────────────────
void StrideWrapperProcessor::loadPlugin (const juce::File& pluginFile)
{
    juce::OwnedArray<juce::PluginDescription> found;
    findPluginTypesForFile (formatManager, pluginFile.getFullPathName(), found);

    if (found.isEmpty())
    {
        DBG ("Stride M0: no plugin found at " << pluginFile.getFullPathName());
        if (onLoadFailed) onLoadFailed (pluginFile.getFileNameWithoutExtension(), "no loadable plugin at this path");
        return;
    }

    const auto pathStr = pluginFile.getFullPathName();
    formatManager.createPluginInstanceAsync (
        *found[0], currentSampleRate, currentBlockSize,
        [wr = juce::WeakReference<StrideWrapperProcessor> (this), pathStr]
        (std::unique_ptr<juce::AudioPluginInstance> instance, const juce::String& error)
        {
            auto* self = wr.get();
            if (self == nullptr) return;   // processor deleted while the instance was building
            if (instance == nullptr)
            {
                DBG ("Stride M0: load failed - " << error);
                if (self->onLoadFailed) self->onLoadFailed (juce::File (pathStr).getFileNameWithoutExtension(), error);
                return;
            }

            configureHostedBuses (*instance);   // main-stereo only — no sidechain/aux (prevents the FabFilter crash)
            instance->setPlayHead (&self->childPlayHead);   // hosted arps/sequencers/synced FX follow the project clock
            instance->setRateAndBufferSizeDetails (self->currentSampleRate, self->currentBlockSize);
            instance->prepareToPlay (self->currentSampleRate, self->currentBlockSize);
            instance->addListener (self);     // so Map can learn this device's knob moves
            const auto name = instance->getName();
            {
                const juce::ScopedLock sl (self->hostLock);
                self->chain.push_back ({ std::move (instance), name, pathStr });   // append to the chain
            }
            self->mapVersion.fetch_add (1);
            self->hostDirtyPending.store (true);   // chain changed -> the DAW's project is dirty
        });
}

// TWO-PHASE teardown (field report 2026-08-09: "several lanes open + Clear froze Live",
// force-quit): the old shape held hostLock on Live's MAIN thread while calling INTO every
// hosted plugin (getStateInformation for the undo snapshot) and then DESTROYING the
// instances. A plugin whose getState/destructor waits on its own worker or GUI closes
// the same freeze cycle as the Wave Shift hang. Now: the cheap half (paths + mapped meta
// + curves — plain data) is captured under the lock and the chain is SWAPPED OUT, so the
// audio thread sees an empty chain from its next try-lock on; the plugin calls and the
// destructors run AFTER the lock is released, free to wait on whatever they like.
void StrideWrapperProcessor::clearChain()
{
    // Wedged audio thread (a hosted plugin stuck in processBlock holding hostLock):
    // refuse the Clear instead of freezing Live behind it.
    if (! hostLockFreeBounded (8)) return;

    std::vector<Node> doomed;
    {
    const juce::ScopedLock sl (hostLock);

    // Capture a FULL-chain undo snapshot so Ctrl+Z brings the whole chain back — the
    // CHEAP half only (no plugin calls under the lock; patches captured below).
    lastRemoved = RemovedSnapshot{};
    for (int i = 0; i < (int) chain.size(); ++i)
    {
        RemovedSnapshot::Dev d;
        d.path = chain[(size_t) i].path;
        d.position = i;
        for (const auto& m : mapped)     if (m.node == i) { d.params.push_back (m.param); d.slots.push_back (m.macroSlot);
                                                            d.ron.push_back (m.rangeOn ? 1 : 0); d.rlo.push_back (m.rangeLo); d.rhi.push_back (m.rangeHi); d.col.push_back (m.colorIdx);
                                                            d.lpb.push_back (m.loopBeats); d.qst.push_back (m.quantStep); d.lkd.push_back (m.locked ? 1 : 0); d.spd.push_back (m.speed); }
        for (const auto& l : driveLanes) if (l.node == i) d.lanes.push_back (l);
        lastRemoved.devices.push_back (std::move (d));
    }
    lastRemoved.valid = ! lastRemoved.devices.empty();

    for (auto& n : chain) if (n.inst) { n.inst->setPlayHead (nullptr); n.inst->removeListener (this); }
    doomed.swap (chain);   // audio sees an EMPTY chain from its next try-lock on
    mapped.clear();
    driveLanes.clear();
    reassignMacros();
    mapVersion.fetch_add (1);
    hostDirtyPending.store (true);
    }

    // OUTSIDE the lock: the hosted patch captures for undo + the destructors.
    for (size_t i = 0; i < doomed.size() && i < lastRemoved.devices.size(); ++i)
        if (doomed[i].inst) doomed[i].inst->getStateInformation (lastRemoved.devices[i].state);
    doomed.clear();
    triggerAsyncUpdate();
}

void StrideWrapperProcessor::removeNode (int index)
{
    // Same two-phase teardown as clearChain (the 2026-08-09 freeze class): meta under
    // the lock, hosted getState + the destructor outside it.
    if (! hostLockFreeBounded (8)) return;

    Node doomed;
    {
    const juce::ScopedLock sl (hostLock);
    if (index < 0 || index >= (int) chain.size()) return;

    // Capture a single-level undo snapshot: path + this node's mapped params/curves
    // (the PATCH is captured outside the lock, from the detached node).
    lastRemoved = RemovedSnapshot{};
    {
        RemovedSnapshot::Dev d;
        d.path = chain[(size_t) index].path;
        d.position = index;
        for (const auto& m : mapped)     if (m.node == index) { d.params.push_back (m.param); d.slots.push_back (m.macroSlot);
                                                                d.ron.push_back (m.rangeOn ? 1 : 0); d.rlo.push_back (m.rangeLo); d.rhi.push_back (m.rangeHi); d.col.push_back (m.colorIdx);
                                                                d.lpb.push_back (m.loopBeats); d.qst.push_back (m.quantStep); d.lkd.push_back (m.locked ? 1 : 0); d.spd.push_back (m.speed); }
        for (const auto& l : driveLanes) if (l.node == index) d.lanes.push_back (l);
        lastRemoved.devices.push_back (std::move (d));
    }
    lastRemoved.valid = true;

    if (chain[(size_t) index].inst) { chain[(size_t) index].inst->setPlayHead (nullptr); chain[(size_t) index].inst->removeListener (this); }
    doomed = std::move (chain[(size_t) index]);
    chain.erase (chain.begin() + index);

    // Drop mapped params on the removed node; shift indices above it down.
    std::vector<MapRef> nm;
    for (const auto& m : mapped) { if (m.node == index) continue; MapRef x = m; if (x.node > index) --x.node; nm.push_back (x); }
    mapped.swap (nm);

    std::vector<StoredLane> nd;
    for (const auto& l : driveLanes) { if (l.node == index) continue; StoredLane x = l; if (x.node > index) --x.node; nd.push_back (x); }
    driveLanes.swap (nd);

    reassignMacros();          // remaining params keep their slots (stable); the removed node's slots free up
    mapVersion.fetch_add (1);
    hostDirtyPending.store (true);
    }

    // OUTSIDE the lock: the hosted patch capture for undo + the destructor (see clearChain).
    if (doomed.inst != nullptr && ! lastRemoved.devices.empty())
        doomed.inst->getStateInformation (lastRemoved.devices[0].state);
    doomed = {};
    triggerAsyncUpdate();
}

// Reorder the chain (drag). Moving a device shifts node indices, so every mapped param and
// drive lane is reindexed to keep pointing at the SAME device — curves/locks/bypass/macro
// assignments all follow their device. Under the lock, so processBlock never sees a torn chain.
void StrideWrapperProcessor::moveNode (int from, int to)
{
    const juce::ScopedLock sl (hostLock);
    const int n = (int) chain.size();
    if (from < 0 || from >= n || to < 0 || to >= n || from == to) return;

    Node node = std::move (chain[(size_t) from]);
    chain.erase (chain.begin() + from);
    chain.insert (chain.begin() + to, std::move (node));

    // New index for any node index after moving element `from` to `to`.
    auto remap = [from, to] (int idx) -> int
    {
        if (idx == from) return to;
        if (from < to)  return (idx > from && idx <= to) ? idx - 1 : idx;   // moved right: those it passed shift left
        return              (idx >= to && idx < from) ? idx + 1 : idx;      // moved left:  those it passed shift right
    };
    for (auto& m : mapped)     m.node = remap (m.node);
    for (auto& l : driveLanes) l.node = remap (l.node);

    reassignMacros();          // slots are keyed to the entry (unchanged); refresh labels for the new order
    mapVersion.fetch_add (1);
    hostDirtyPending.store (true);
    triggerAsyncUpdate();
}

void StrideWrapperProcessor::undoRemove()
{
    auto devs = std::make_shared<std::vector<RemovedSnapshot::Dev>>();
    {
        const juce::ScopedLock sl (hostLock);
        if (! lastRemoved.valid) return;
        *devs = lastRemoved.devices;     // copy out
        lastRemoved.valid = false;       // consume (single level)
    }
    if (devs->empty()) return;
    hostDirtyPending.store (true);   // user-initiated restore (Ctrl+Z) — unlike project load, this IS an edit

    // Restore front-to-back so each device lands back at its captured position. A fresh
    // generation supersedes any restore still in flight (e.g. a project load racing the undo).
    std::sort (devs->begin(), devs->end(),
               [] (const RemovedSnapshot::Dev& a, const RemovedSnapshot::Dev& b) { return a.position < b.position; });
    restoreNextDevice (devs, 0, restoreGeneration.fetch_add (1) + 1);
}

// Re-instantiate one snapshot device, then chain to the next (async completes on the message
// thread, so restoring sequentially is what keeps the chain order intact).
void StrideWrapperProcessor::restoreNextDevice (std::shared_ptr<std::vector<RemovedSnapshot::Dev>> devs, size_t i, int gen)
{
    if (devs == nullptr || i >= devs->size()) return;
    if (gen != restoreGeneration.load()) return;   // superseded by a newer setState/undo wave — abandon
    const auto d = (*devs)[i];

    if (d.path.isEmpty()) { restoreNextDevice (devs, i + 1, gen); return; }

    juce::OwnedArray<juce::PluginDescription> found;
    findPluginTypesForFile (formatManager, d.path, found);
    if (found.isEmpty()) { restoreNextDevice (devs, i + 1, gen); return; }   // skip a missing plugin, keep going

    formatManager.createPluginInstanceAsync (
        *found[0], currentSampleRate, currentBlockSize,
        [wr = juce::WeakReference<StrideWrapperProcessor> (this), devs, i, d, gen]
        (std::unique_ptr<juce::AudioPluginInstance> inst, const juce::String& err)
        {
            auto* self = wr.get();
            if (self == nullptr) return;                          // processor deleted mid-restore (project closed)
            if (gen != self->restoreGeneration.load()) return;    // superseded — must not insert a stale device
            if (inst != nullptr)
            {
                configureHostedBuses (*inst);   // main-stereo only — no sidechain/aux (prevents the FabFilter crash)
                inst->setPlayHead (&self->childPlayHead);   // hosted arps/sequencers/synced FX follow the project clock
                inst->setRateAndBufferSizeDetails (self->currentSampleRate, self->currentBlockSize);
                if (d.state.getSize() > 0) inst->setStateInformation (d.state.getData(), (int) d.state.getSize());
                inst->prepareToPlay (self->currentSampleRate, self->currentBlockSize);
                inst->addListener (self);
                const auto name = inst->getName();
                {
                    const juce::ScopedLock sl (self->hostLock);
                    const int p = juce::jlimit (0, (int) self->chain.size(), d.position);
                    for (auto& m : self->mapped)     if (m.node >= p) ++m.node;   // make room at p
                    for (auto& l : self->driveLanes) if (l.node >= p) ++l.node;
                    self->chain.insert (self->chain.begin() + p, Node { std::move (inst), name, d.path, d.bypassed });
                    for (size_t k = 0; k < d.params.size(); ++k)                      // restore this device's lanes (+ their range bands + locks + speed)
                        self->mapped.push_back ({ p, d.params[k], k < d.slots.size() ? d.slots[k] : -1,
                                                  k < d.ron.size() && d.ron[k] != 0,
                                                  k < d.rlo.size() ? d.rlo[k] : 0.0f,
                                                  k < d.rhi.size() ? d.rhi[k] : 1.0f,
                                                  k < d.col.size() ? d.col[k] : -1,
                                                  k < d.lpb.size() ? d.lpb[k] : 0.0f,
                                                  k < d.qst.size() ? d.qst[k] : 0.0f,
                                                  k < d.lkd.size() && d.lkd[k] != 0,
                                                  k < d.spd.size() ? d.spd[k] : 1.0f });
                    for (auto l : d.lanes) { l.node = p; self->driveLanes.push_back (l); }  // and their curves
                    self->reassignMacros();      // keep restored slots where valid; fill any gaps (old saves had none)
                }
                self->mapVersion.fetch_add (1);
                self->triggerAsyncUpdate();
            }
            else juce::ignoreUnused (err);

            self->restoreNextDevice (devs, i + 1, gen);   // next device, in order
        });
}

int StrideWrapperProcessor::numHosted() const
{
    const juce::ScopedLock sl (hostLock);
    return (int) chain.size();
}

juce::StringArray StrideWrapperProcessor::getChainNames() const
{
    juce::StringArray names;
    const juce::ScopedLock sl (hostLock);
    for (const auto& n : chain) names.add (n.name);
    return names;
}

void StrideWrapperProcessor::setNodeBypassed (int index, bool shouldBypass)
{
    const juce::ScopedLock sl (hostLock);
    if (index >= 0 && index < (int) chain.size())
    {
        chain[(size_t) index].bypassed = shouldBypass;
        hostDirtyPending.store (true);
    }
}

juce::Array<bool> StrideWrapperProcessor::getChainBypassed() const
{
    juce::Array<bool> out;
    const juce::ScopedLock sl (hostLock);
    for (const auto& n : chain) out.add (n.bypassed);
    return out;
}

juce::AudioProcessorEditor* StrideWrapperProcessor::getHostedEditor (int node)
{
    const juce::ScopedLock sl (hostLock);
    if (node >= 0 && node < (int) chain.size() && chain[(size_t) node].inst && chain[(size_t) node].inst->hasEditor())
        return chain[(size_t) node].inst->createEditorAndMakeActive();
    return nullptr;
}

juce::String StrideWrapperProcessor::getChainSummary() const
{
    const juce::ScopedLock sl (hostLock);
    juce::StringArray names;
    for (auto& n : chain) names.add (n.name);
    return names.isEmpty() ? juce::String() : names.joinIntoString (" + ");
}

bool StrideWrapperProcessor::hasHostedPlugin() const
{
    const juce::ScopedLock sl (hostLock);
    return ! chain.empty();
}

// ── persistence: the hosted chain survives DAW save/reload ───────────
// getStateInformation returned nothing before, so reopening a project came
// back with an empty Stride (you had to re-add the synth). Now each plugin's
// path + patch, the mapped params, and the drawn curves are all serialized
// and restored. (Standalone never reloads mid-session, so this is DAW-only.)
void StrideWrapperProcessor::getStateInformation (juce::MemoryBlock& dest)
{
    if (demoMode.load()) return;   // DEMO: persist nothing — a project can't be built on the demo (blank state on reload)
    juce::XmlElement root ("STRIDE_WRAP");
    const juce::ScopedLock sl (hostLock);
    root.setAttribute ("version", 6);                                   // v6: + per-param speed ("sp"); v5 added lock ("lk") - attr-based, so older projects load unchanged
    root.setAttribute ("clipBeats", driveClipBeats);
    root.setAttribute ("driveMode", (int) driveMode.load());            // 0=Live, 1=Automation
    root.setAttribute ("tempoMode", tempoMode.load());                  // 0=Project sync (default) / 1=Manual
    root.setAttribute ("manualBpm", (double) manualBpm.load());
    root.setAttribute ("keysOn", ksEnabled.load() ? 1 : 0);             // MIDI keyswitches (attr-based: old builds/projects ignore it)
    root.setAttribute ("keysBase", ksBase.load());                      // switch-octave bottom note (0=C-2 / 12=C-1 / 24=C0)
    root.setAttribute ("runMode", runMode.load());                      // 0=Transport (default) / 1=Notes (MIDI-gated clock)

    auto* chainXml = root.createNewChildElement ("CHAIN");
    for (int i = 0; i < (int) chain.size(); ++i)
    {
        auto* dev = chainXml->createNewChildElement ("DEV");
        dev->setAttribute ("path", chain[(size_t) i].path);
        dev->setAttribute ("bypassed", chain[(size_t) i].bypassed ? 1 : 0);
        if (chain[(size_t) i].inst)
        {
            juce::MemoryBlock mb;
            chain[(size_t) i].inst->getStateInformation (mb);
            if (mb.getSize() > 0) dev->setAttribute ("state", mb.toBase64Encoding());
        }
    }
    auto* mapXml = root.createNewChildElement ("MAPPED");
    for (const auto& m : mapped)
    {
        auto* e = mapXml->createNewChildElement ("M");
        e->setAttribute ("n", m.node); e->setAttribute ("p", m.param);
        e->setAttribute ("s", m.macroSlot);   // stable DAW-facing slot -> Ableton automation stays on the right knob across reload
        if (m.rangeOn)                        // range band: absent = full 0..1 (old projects load unchanged; old builds ignore the attrs)
        {
            e->setAttribute ("ro", 1);
            e->setAttribute ("rl", (double) m.rangeLo);
            e->setAttribute ("rh", (double) m.rangeHi);
        }
        if (m.colorIdx >= 0) e->setAttribute ("cl", m.colorIdx);   // lane color: absent = AUTO (same back-compat story as the range attrs)
        if (m.loopBeats > 0.0f) e->setAttribute ("lb", (double) m.loopBeats);   // loop boundary: absent = full clip (v4; older builds ignore it)
        if (m.quantStep > 0.0f) e->setAttribute ("qs", (double) m.quantStep);   // quant step: absent = off
        if (m.locked) e->setAttribute ("lk", 1);                                // lane lock: absent = unlocked (v5; older builds ignore it)
        if (m.speed > 0.0f && std::abs (m.speed - 1.0f) > 1.0e-4f)
            e->setAttribute ("sp", (double) m.speed);                           // lane speed: absent = 1x (v6; older builds ignore it)
    }
    auto* laneXml = root.createNewChildElement ("LANES");
    for (const auto& l : driveLanes)
    {
        auto* e = laneXml->createNewChildElement ("L");
        e->setAttribute ("n", l.node); e->setAttribute ("p", l.param);
        e->setAttribute ("t", floatsToStr (l.times));
        e->setAttribute ("v", floatsToStr (l.values));
        e->setAttribute ("c", floatsToStr (l.curves));
    }
    copyXmlToBinary (root, dest);
}

void StrideWrapperProcessor::setStateInformation (const void* data, int sizeInBytes)
{
    auto xml = getXmlFromBinary (data, sizeInBytes);
    if (xml == nullptr || ! xml->hasTagName ("STRIDE_WRAP")) return;

    // Everything below is parse-only (pure XML, safe on any thread). The actual teardown +
    // rebuild is marshalled onto the MESSAGE THREAD at the bottom — hosts may call setState
    // from anywhere (Bitwig restores DAW-undo state off the message thread), and hosted
    // instances/editors may only be touched on the message thread.
    const double clipBeats = xml->getDoubleAttribute ("clipBeats", 16.0);
    const int    newDriveMode = xml->getIntAttribute ("driveMode", 0);   // default Live (0) for old projects
    const int    newTempoMode = juce::jlimit (0, 1, xml->getIntAttribute ("tempoMode", 0));   // old projects: sync (byte-identical)
    const double newManualBpm = juce::jlimit (5.0, 999.0, xml->getDoubleAttribute ("manualBpm", 120.0));
    const bool   newKeysOn    = xml->getIntAttribute ("keysOn", 0) != 0; // old projects: keyswitches off
    const int    newKeysBase  = xml->getIntAttribute ("keysBase", 0);    // old projects: bottom octave (setter clamps)
    const int    newRunMode   = xml->getIntAttribute ("runMode", 0);     // old projects: transport-run (byte-identical)

    // Rebuild the restore list in the SAME shape the undo path consumes, then
    // re-instantiate sequentially (keeps chain order + restores patch/curves).
    auto devs = std::make_shared<std::vector<RemovedSnapshot::Dev>>();
    if (auto* chainXml = xml->getChildByName ("CHAIN"))
    {
        int idx = 0;
        for (auto* dev : chainXml->getChildIterator())
        {
            RemovedSnapshot::Dev d;
            d.path = dev->getStringAttribute ("path");
            d.position = idx++;
            d.bypassed = dev->getIntAttribute ("bypassed", 0) != 0;
            const auto b64 = dev->getStringAttribute ("state");
            if (b64.isNotEmpty()) d.state.fromBase64Encoding (b64);
            devs->push_back (std::move (d));
        }
    }

    if (auto* mapXml = xml->getChildByName ("MAPPED"))
        for (auto* e : mapXml->getChildIterator())
        {
            const int n = e->getIntAttribute ("n", -1);
            if (n >= 0 && n < (int) devs->size())
            {
                (*devs)[(size_t) n].params.push_back (e->getIntAttribute ("p"));
                (*devs)[(size_t) n].slots.push_back (e->getIntAttribute ("s", -1));   // -1 for pre-macro projects -> reassigned on restore
                (*devs)[(size_t) n].ron.push_back ((char) (e->getIntAttribute ("ro", 0) != 0 ? 1 : 0));
                (*devs)[(size_t) n].rlo.push_back ((float) e->getDoubleAttribute ("rl", 0.0));
                (*devs)[(size_t) n].rhi.push_back ((float) e->getDoubleAttribute ("rh", 1.0));
                (*devs)[(size_t) n].col.push_back (e->getIntAttribute ("cl", -1));
                (*devs)[(size_t) n].lpb.push_back ((float) e->getDoubleAttribute ("lb", 0.0));
                (*devs)[(size_t) n].qst.push_back ((float) e->getDoubleAttribute ("qs", 0.0));
                (*devs)[(size_t) n].lkd.push_back ((char) (e->getIntAttribute ("lk", 0) != 0 ? 1 : 0));
                (*devs)[(size_t) n].spd.push_back ((float) e->getDoubleAttribute ("sp", 1.0));
            }
        }
    if (auto* laneXml = xml->getChildByName ("LANES"))
        for (auto* e : laneXml->getChildIterator())
        {
            const int n = e->getIntAttribute ("n", -1);
            if (n < 0 || n >= (int) devs->size()) continue;
            StoredLane l; l.node = n; l.param = e->getIntAttribute ("p");
            strToFloats (e->getStringAttribute ("t"), l.times);
            strToFloats (e->getStringAttribute ("v"), l.values);
            strToFloats (e->getStringAttribute ("c"), l.curves);
            sortLaneByTime (l.times, l.values, l.curves);   // heal lanes saved unsorted by older builds (see the helper)
            (*devs)[(size_t) n].lanes.push_back (l);
        }

    // Teardown + rebuild, exclusively on the MESSAGE THREAD. Order inside `apply` is the
    // whole fix for the Bitwig Cmd+Z crash (field report 2026-07-26, Serum + Diva):
    //   1) close the hosted-device windows FIRST — an AudioProcessorEditor (and its GUI
    //      timers) must never outlive its processor. The old code chain.clear()'d with the
    //      windows open, and the synth's own CFRunLoop timer fired into the freed instance
    //      on the very next runloop turn (SIGSEGV inside Serum/Diva, zero Stride frames).
    //   2) only then delete the instances, on the thread they were built on.
    // A generation stamp makes rapid setStates (undo-scrubbing) supersede each other
    // instead of interleaving their async restores into a duplicated chain.
    const int gen = restoreGeneration.fetch_add (1) + 1;
    auto apply = [wr = juce::WeakReference<StrideWrapperProcessor> (this), devs, gen,
                  clipBeats, newDriveMode, newTempoMode, newManualBpm, newKeysOn, newKeysBase, newRunMode]
    {
        auto* self = wr.get();
        if (self == nullptr) return;                        // processor deleted before the hop landed
        if (gen != self->restoreGeneration.load()) return;  // a newer state superseded this one

        self->closeHostedEditorsForTeardown();              // editors die BEFORE their instances

        std::vector<Node> doomed;                           // destroyed OUTSIDE the lock (the 2026-08-09 freeze class — see clearChain)
        {
            const juce::ScopedLock sl (self->hostLock);
            for (auto& n : self->chain) if (n.inst) { n.inst->setPlayHead (nullptr); n.inst->removeListener (self); }
            doomed.swap (self->chain); self->mapped.clear(); self->driveLanes.clear();
            self->driveClipBeats = clipBeats;
            self->driveMode.store ((DriveMode) newDriveMode);
            self->tempoMode.store (newTempoMode);
            self->manualBpm.store ((float) newManualBpm);
            self->ksEnabled.store (newKeysOn);
            self->ksBase.store (newKeysBase == 12 || newKeysBase == 24 ? newKeysBase : 0);
            self->runMode.store (juce::jlimit (0, 2, newRunMode));
        }
        doomed.clear();                                     // hosted destructors run lock-free on the message thread
        self->mapVersion.fetch_add (1);

        if (! devs->empty())
            self->restoreNextDevice (devs, 0, gen);
    };
    if (juce::MessageManager::getInstance()->isThisTheMessageThread()) apply();   // Live loads on the message thread — same-timing behavior as before
    else juce::MessageManager::callAsync (std::move (apply));
}

// MESSAGE THREAD. Close every hosted-device window before a chain teardown — the active
// editor owns them (and their AudioProcessorEditors); no editor open = nothing to do.
void StrideWrapperProcessor::closeHostedEditorsForTeardown()
{
    if (auto* ed = dynamic_cast<StrideWrapperEditor*> (getActiveEditor()))
        ed->closeAllSynthWindows();
}

// ── Map: learn by touch across the chain ───────────────────────────
void StrideWrapperProcessor::mapParam (juce::AudioProcessor* proc, int parameterIndex)
{
    if (editLocked.load() || ! learnMode.load()) return;   // soft lock: no new mapping even if a mode was latched before expiry

    // BOUNDED probe, then a normal lock: param listeners fire from whatever thread the
    // hosted plugin notifies on, and blocking behind a WEDGED audio thread froze that
    // thread too (Wave Shift hang, 2026-08-06). Single-try lost learn touches at the
    // lock's duty cycle (2026-08-07); the bounded probe rides out normal contention and
    // only gives up on a true wedge. Same-thread re-entry (a plugin notifying from our
    // own audio callback) passes instantly - the lock is recursive.
    if (! hostLockFreeBounded (3)) return;
    const juce::ScopedLock sl (hostLock);
    const int node = nodeIndexOf (proc);
    if (node < 0) return;
    for (const auto& m : mapped)
        if (m.node == node && m.param == parameterIndex) return;   // already mapped
    mapped.push_back ({ node, parameterIndex, -1 });
    reassignMacros();          // claim a free macro slot for the DAW
    mapVersion.fetch_add (1);
    hostDirtyPending.store (true);
    triggerAsyncUpdate();      // relabel the macro on the message thread
}

void StrideWrapperProcessor::audioProcessorParameterChanged (juce::AudioProcessor* proc, int parameterIndex, float)
{
    mapParam (proc, parameterIndex);            // each guards its own mode; the modes are mutually exclusive
    unmapParamByTouch (proc, parameterIndex);
    noteParamTouched (proc, parameterIndex);    // glow fallback for plugins that never emit gestures (fires on the first value move)
}

// Touching a control (gesture begin) maps/unmaps it too — so a single CLICK on a knob
// works without having to move it.
void StrideWrapperProcessor::audioProcessorParameterChangeGestureBegin (juce::AudioProcessor* proc, int parameterIndex)
{
    hostDirtyPending.store (true);   // a HUMAN touched a hosted knob (the drive uses plain setValue — no gestures)
    mapParam (proc, parameterIndex);
    unmapParamByTouch (proc, parameterIndex);
    noteParamTouched (proc, parameterIndex);    // glow: clicking a mapped knob lights its lane on the canvas
}

// Inverse of mapParam: while UNLEARN mode is armed, touching a mapped knob removes it from the
// canvas (drops its lanes, frees its macro slot). Same learn-by-touch flow, opposite result.
void StrideWrapperProcessor::unmapParamByTouch (juce::AudioProcessor* proc, int parameterIndex)
{
    if (editLocked.load() || ! unlearnMode.load()) return;   // soft lock: no unmap-by-touch even if a mode was latched before expiry

    if (! hostLockFreeBounded (3)) return;     // bounded probe - see mapParam (the hang guard)
    const juce::ScopedLock sl (hostLock);
    const int node = nodeIndexOf (proc);
    if (node < 0) return;
    for (int pos = 0; pos < (int) mapped.size(); ++pos)
        if (mapped[(size_t) pos].node == node && mapped[(size_t) pos].param == parameterIndex)
        {
            for (int k = (int) driveLanes.size() - 1; k >= 0; --k)   // stop driving the freed knob
                if (driveLanes[(size_t) k].node == node && driveLanes[(size_t) k].param == parameterIndex)
                    driveLanes.erase (driveLanes.begin() + k);
            mapped.erase (mapped.begin() + (size_t) pos);
            reassignMacros();          // free the macro slot; others keep theirs
            pendingUnmapPos.store (pos);   // editor splices THIS lane instead of a positional re-push (keeps each lane's range)
            mapVersion.fetch_add (1);
            hostDirtyPending.store (true);
            triggerAsyncUpdate();
            return;
        }
    // touched knob wasn't mapped -> nothing to remove
}

void StrideWrapperProcessor::setLearnMode (bool shouldLearn)
{
    learnMode.store (shouldLearn);
    if (shouldLearn) unlearnMode.store (false);   // Map and Unmap are mutually exclusive
    mapVersion.fetch_add (1);
}

void StrideWrapperProcessor::setUnlearnMode (bool shouldUnlearn)
{
    unlearnMode.store (shouldUnlearn);
    if (shouldUnlearn) learnMode.store (false);
    mapVersion.fetch_add (1);
}

juce::StringArray StrideWrapperProcessor::getMappedParamNames() const
{
    juce::StringArray names;
    const juce::ScopedLock sl (hostLock);
    for (const auto& m : mapped)
    {
        if (m.node >= 0 && m.node < (int) chain.size() && chain[(size_t) m.node].inst)
        {
            auto& ps = chain[(size_t) m.node].inst->getParameters();
            const juce::String pn = (m.param >= 0 && m.param < ps.size()) ? ps[m.param]->getName (48) : juce::String ("?");
            names.add (chain[(size_t) m.node].name + ": " + pn);
        }
        else names.add ("?");
    }
    return names;
}

// Drive curves per mapped param (in mapped order), as [{time,value,curve}...]. Empty
// array for a param with no curve yet. Sent in rack_scanned so reopening Stride shows
// the drawn curves straight from the engine — the reliable source of truth (persisted
// in the project state + live in the running instance), independent of localStorage.
// RANGED lanes: the stored drive values are HOST-BOUND (the canvas/shim scale the 0..1
// shape into [lo,hi] before pushing — that's what actually drives the knob). The canvas
// wants the RAW shape back (it re-applies the band for display and on the next push), so
// the echo inverse-maps by the lane's band. Bands off = byte-identical to before.
juce::Array<juce::var> StrideWrapperProcessor::getMappedCurves() const
{
    juce::Array<juce::var> out;
    const juce::ScopedLock sl (hostLock);
    for (const auto& m : mapped)
    {
        juce::Array<juce::var> pts;
        const float span    = m.rangeHi - m.rangeLo;
        const bool  unscale = m.rangeOn && span > 0.0001f;
        for (const auto& L : driveLanes)
            if (L.node == m.node && L.param == m.param)
            {
                for (size_t i = 0; i < L.times.size(); ++i)
                {
                    float v = i < L.values.size() ? L.values[i] : 0.0f;
                    if (unscale) v = juce::jlimit (0.0f, 1.0f, (v - m.rangeLo) / span);
                    auto* o = new juce::DynamicObject();
                    o->setProperty ("time",  (double) L.times[i]);
                    o->setProperty ("value", (double) v);
                    o->setProperty ("curve", (double) (i < L.curves.size() ? L.curves[i] : 0.0f));
                    pts.add (juce::var (o));
                }
                break;
            }
        out.add (juce::var (pts));
    }
    return out;
}

// Record a lane's output band on its mapped entry — ENGINE-OWNED so it persists in the
// project and every rack re-push rebuilds the canvas bands from the source of truth
// (client-only ranges were wiped/misrouted by positional re-pushes; report 2026-07-16).
// No mapVersion bump: the canvas already shows the edit — a re-push here would fight the
// very drag that produced it. Message thread (editor bridge).
void StrideWrapperProcessor::setMappedRange (int pos, bool on, float lo, float hi)
{
    const juce::ScopedLock sl (hostLock);
    if (pos < 0 || pos >= (int) mapped.size()) return;
    auto& m = mapped[(size_t) pos];
    m.rangeOn = on;
    m.rangeLo = juce::jlimit (0.0f, 1.0f, lo);
    m.rangeHi = juce::jlimit (0.0f, 1.0f, juce::jmax (hi, m.rangeLo));
    hostDirtyPending.store (true);
}

// Range-for-Group: apply a batch of {id,on,min,max} band edits atomically — one lock pass,
// one dirty mark. Same semantics per item as setMappedRange (clamped, no mapVersion bump).
void StrideWrapperProcessor::setMappedRanges (const juce::Array<juce::var>& items)
{
    const juce::ScopedLock sl (hostLock);
    for (const auto& it : items)
    {
        const int pos = (int) it.getProperty ("id", -1);
        if (pos < 0 || pos >= (int) mapped.size()) continue;
        auto& m = mapped[(size_t) pos];
        m.rangeOn = (bool) it.getProperty ("on", false);
        m.rangeLo = juce::jlimit (0.0f, 1.0f, (float) (double) it.getProperty ("min", 0.0));
        m.rangeHi = juce::jlimit (0.0f, 1.0f, juce::jmax ((float) (double) it.getProperty ("max", 1.0), m.rangeLo));
    }
    hostDirtyPending.store (true);
}

// {on,lo,hi} per mapped param, mapped order — pushRackScanned sends these so every canvas
// rebuild (re-push or project reopen) restores the bands.
juce::Array<juce::var> StrideWrapperProcessor::getMappedRanges() const
{
    juce::Array<juce::var> out;
    const juce::ScopedLock sl (hostLock);
    for (const auto& m : mapped)
    {
        auto* o = new juce::DynamicObject();
        o->setProperty ("on", m.rangeOn);
        o->setProperty ("lo", (double) m.rangeLo);
        o->setProperty ("hi", (double) m.rangeHi);
        out.add (juce::var (o));
    }
    return out;
}

// Lane color (1.1.11) - the range pattern verbatim: engine-owned so a positional
// re-push can never wipe or misroute a chosen color. No mapVersion bump (the canvas
// already painted itself; the echo exists for REBUILDS, not for this edit).
void StrideWrapperProcessor::setMappedColor (int pos, int idx)
{
    const juce::ScopedLock sl (hostLock);
    if (pos < 0 || pos >= (int) mapped.size()) return;
    mapped[(size_t) pos].colorIdx = juce::jlimit (-1, 11, idx);
    hostDirtyPending.store (true);
}

juce::Array<int> StrideWrapperProcessor::getMappedColors() const
{
    juce::Array<int> out;
    const juce::ScopedLock sl (hostLock);
    for (const auto& m : mapped) out.add (m.colorIdx);
    return out;
}

// Per-lane loop boundary (1.3.0) - the range/color pattern verbatim: engine-owned, no
// mapVersion bump (the canvas already shows the edit; the echo exists for REBUILDS).
void StrideWrapperProcessor::setMappedLoop (int pos, float beats)
{
    const juce::ScopedLock sl (hostLock);
    if (pos < 0 || pos >= (int) mapped.size()) return;
    mapped[(size_t) pos].loopBeats = juce::jlimit (0.0f, 1024.0f, beats);
    hostDirtyPending.store (true);
}

// Per-lane grid-quantize step (1.3.0) - same story. Clamped to a bar (4 beats) max.
void StrideWrapperProcessor::setMappedQuant (int pos, float step)
{
    const juce::ScopedLock sl (hostLock);
    if (pos < 0 || pos >= (int) mapped.size()) return;
    mapped[(size_t) pos].quantStep = juce::jlimit (0.0f, 4.0f, step);
    hostDirtyPending.store (true);
}

juce::Array<juce::var> StrideWrapperProcessor::getMappedLoops() const
{
    juce::Array<juce::var> out;
    const juce::ScopedLock sl (hostLock);
    for (const auto& m : mapped) out.add ((double) m.loopBeats);
    return out;
}

juce::Array<juce::var> StrideWrapperProcessor::getMappedQuants() const
{
    juce::Array<juce::var> out;
    const juce::ScopedLock sl (hostLock);
    for (const auto& m : mapped) out.add ((double) m.quantStep);
    return out;
}

// Per-lane SPEED (the groove grid's replacement, 2026-08-04) - the range/color/lock
// ownership pattern once more. A rate multiplier on the lane's clock: 2 = double-time,
// 0.5 = half-time, 1 = ride the track. Clamped so a wild client value can't park a
// lane (0) or spin it into noise. No mapVersion bump (the canvas already painted it).
void StrideWrapperProcessor::setMappedSpeed (int pos, float s)
{
    const juce::ScopedLock sl (hostLock);
    if (pos < 0 || pos >= (int) mapped.size()) return;
    mapped[(size_t) pos].speed = juce::jlimit (0.1f, 8.0f, s);
    hostDirtyPending.store (true);
}

juce::Array<juce::var> StrideWrapperProcessor::getMappedSpeeds() const
{
    juce::Array<juce::var> out;
    const juce::ScopedLock sl (hostLock);
    for (const auto& m : mapped) out.add ((double) m.speed);
    return out;
}

// Per-lane LOCK - the range/color pattern once more, closing the LAST client-only lane
// attribute. Locks lived ONLY in the WebView's localStorage, which is one SHARED profile
// for every wrapper instance in the DAW, keyed by chain summary alone - so locking lanes
// in one instance force-loaded its lanes into every other instance hosting the same chain
// on their next editor open (field report 2026-08-03). Engine ownership makes locks
// per-instance and project-persistent like curves/ranges/colors/loop/quant.
// No mapVersion bump (the canvas already painted the padlock; the echo exists for REBUILDS).
void StrideWrapperProcessor::setMappedLock (int pos, bool on)
{
    const juce::ScopedLock sl (hostLock);
    if (pos < 0 || pos >= (int) mapped.size()) return;
    mapped[(size_t) pos].locked = on;
    hostDirtyPending.store (true);
}

// Lock All / Unlock All / "Lock current lanes": one batched pass - ONE lock take,
// ONE dirty mark (the set_ranges pattern).
void StrideWrapperProcessor::setMappedLocks (const juce::Array<juce::var>& items)
{
    const juce::ScopedLock sl (hostLock);
    for (const auto& it : items)
    {
        const int pos = (int) it.getProperty ("id", -1);
        if (pos < 0 || pos >= (int) mapped.size()) continue;
        mapped[(size_t) pos].locked = (bool) it.getProperty ("on", false);
    }
    hostDirtyPending.store (true);
}

juce::Array<int> StrideWrapperProcessor::getMappedLocks() const
{
    juce::Array<int> out;
    const juce::ScopedLock sl (hostLock);
    for (const auto& m : mapped) out.add (m.locked ? 1 : 0);
    return out;
}

// Duplicate ONE device (Alt+drag a chip). Captures the source's patch + mapped params +
// lane meta (ranges/colors/loop/quant/locks) but NO curves — the copy starts with clean lanes.
// Fresh macro slots (-1 -> reassign): the SOURCE keeps its DAW automation binding.
// Rides restoreNextDevice, the same async instantiate->setState->insert machinery as
// undo/project-load, so index shifting and re-preparation follow the proven path.
void StrideWrapperProcessor::duplicateNode (int index, int insertAt)
{
    auto devs = std::make_shared<std::vector<RemovedSnapshot::Dev>>();
    juce::AudioPluginInstance* srcInst = nullptr;   // patch captured OUTSIDE the lock (the 2026-08-09 freeze class — see clearChain)
    {
        const juce::ScopedLock sl (hostLock);
        if (index < 0 || index >= (int) chain.size()) return;
        RemovedSnapshot::Dev d;
        d.path     = chain[(size_t) index].path;
        d.bypassed = chain[(size_t) index].bypassed;
        d.position = juce::jlimit (0, (int) chain.size(), insertAt);
        srcInst    = chain[(size_t) index].inst.get();
        for (const auto& m : mapped)
            if (m.node == index)
            {
                d.params.push_back (m.param);
                d.slots.push_back (-1);
                d.ron.push_back (m.rangeOn ? 1 : 0); d.rlo.push_back (m.rangeLo); d.rhi.push_back (m.rangeHi);
                d.col.push_back (m.colorIdx);
                d.lpb.push_back (m.loopBeats); d.qst.push_back (m.quantStep);
                d.lkd.push_back (m.locked ? 1 : 0);
                d.spd.push_back (m.speed);
            }
        // d.lanes stays empty on purpose: "everything except the modulation itself".
        devs->push_back (std::move (d));
    }
    if (devs->empty() || (*devs)[0].path.isEmpty()) return;
    // The source instance stays alive and owned; reading its patch lock-free is exactly
    // what hosts do on every save. Doing it under hostLock built the freeze cycle.
    if (srcInst != nullptr) srcInst->getStateInformation ((*devs)[0].state);
    hostDirtyPending.store (true);   // user edit — unlike a project load, this IS a change
    restoreNextDevice (devs, 0, restoreGeneration.fetch_add (1) + 1);
}

// Param-touch glow: a hosted-GUI touch on a MAPPED param latches its position for the
// editor to drain. Skipped while Map/Unmap are armed (those modes own the touch), and
// our own drive writes can never land here (they use plain setValue — no listener fires).
void StrideWrapperProcessor::noteParamTouched (juce::AudioProcessor* proc, int parameterIndex)
{
    if (learnMode.load() || unlearnMode.load()) return;
    const juce::ScopedTryLock sl (hostLock);   // TRY, never block - glow is cosmetic; see mapParam (the hang guard)
    if (! sl.isLocked()) return;
    const int node = nodeIndexOf (proc);
    if (node < 0) return;
    for (int pos = 0; pos < (int) mapped.size(); ++pos)
        if (mapped[(size_t) pos].node == node && mapped[(size_t) pos].param == parameterIndex)
        {
            pendingGlowPos.store (pos);
            return;
        }
}

void StrideWrapperProcessor::removeMappedAt (int pos)
{
    if (editLocked.load()) return;   // soft lock: no unmapping/editing while locked
    const juce::ScopedLock sl (hostLock);
    if (pos >= 0 && pos < (int) mapped.size())
    {
        // Stop driving the param we're unmapping: driveLanes hold the RESOLVED
        // node/param, so drop the one that matches — otherwise the freed knob keeps
        // moving to its last curve after the user removed it from the panel.
        const int n = mapped[(size_t) pos].node, pr = mapped[(size_t) pos].param;
        for (int k = (int) driveLanes.size() - 1; k >= 0; --k)
            if (driveLanes[(size_t) k].node == n && driveLanes[(size_t) k].param == pr)
                driveLanes.erase (driveLanes.begin() + k);
        mapped.erase (mapped.begin() + pos);
        reassignMacros();      // frees this param's macro slot; other slots keep theirs (Ableton automation stays put)
        mapVersion.fetch_add (1);
        hostDirtyPending.store (true);
        triggerAsyncUpdate();
    }
}

void StrideWrapperProcessor::clearMapping()
{
    const juce::ScopedLock sl (hostLock);
    mapped.clear();
    reassignMacros();
    mapVersion.fetch_add (1);
    hostDirtyPending.store (true);
    triggerAsyncUpdate();
}

// ── Host-automation macro layer ────────────────────────────────────
// Stable (re)assignment: KEEP every valid, unique slot; (re)assign only entries that are
// free (-1), out of range, or duplicated. So unmapping/removing a param frees its slot WITHOUT
// shuffling the others — the DAW's automation stays bound to the same knob. Caller holds hostLock.
void StrideWrapperProcessor::reassignMacros()
{
    std::array<bool, kMacroCount> used {};
    for (auto& m : mapped)
    {
        if (m.macroSlot < 0 || m.macroSlot >= kMacroCount || used[(size_t) m.macroSlot])
            m.macroSlot = -1;
        else
            used[(size_t) m.macroSlot] = true;
    }
    for (auto& m : mapped)
        if (m.macroSlot < 0)
            for (int s = 0; s < kMacroCount; ++s)
                if (! used[(size_t) s]) { m.macroSlot = s; used[(size_t) s] = true; break; }
    // entries left at -1 = pool full -> still driven in Stride, just not exposed to the DAW
}

int StrideWrapperProcessor::macroSlotFor (int node, int param) const
{
    for (const auto& m : mapped)
        if (m.node == node && m.param == param) return m.macroSlot;
    return -1;
}

int StrideWrapperProcessor::exposedMacroCount() const
{
    const juce::ScopedLock sl (hostLock);
    int n = 0;
    for (const auto& m : mapped) if (m.macroSlot >= 0) ++n;
    return n;
}

void StrideWrapperProcessor::setDriveMode (DriveMode m)
{
    driveMode.store (m);   // persisted in getStateInformation; takes effect next processBlock
}

// ── Stride control params (2026-08-07) ─────────────────────────────
float StrideWrapperProcessor::getControlValue (int idx) const
{
    if (idx < 0 || idx >= kControlCount || controlParams[(size_t) idx] == nullptr) return 0.0f;
    return controlParams[(size_t) idx]->getValue();
}

// A tempo edit in Stride's UI → the DAW's "Stride BPM" lane follows. Gesture-wrapped so
// hosts treat it as one deliberate move. MESSAGE THREAD (the bridge). The editor's relay
// change-detects, so the echo applying the same bpm back is a harmless no-op.
void StrideWrapperProcessor::syncBpmParamFromUI (float bpm)
{
    auto* cp = controlParams[(size_t) ctlBpm];
    if (cp == nullptr || bpm <= 0.0f) return;
    const float n = ctlBpmToNorm (bpm);
    if (std::abs (n - cp->getValue()) < 1.0e-4f) return;
    cp->beginChangeGesture();
    cp->setValueNotifyingHost (n);
    cp->endChangeGesture();
}

// Generalized UI → param sync (the syncBpmParamFromUI story for the sliders): a Stride
// slider move notifies its DAW param, which is what lets Ableton's Configure catch the
// sliders by touching them in Stride. Gesture-wrapped; change-guarded so repeated
// oninput ticks at an unchanged value cost nothing. MESSAGE THREAD (the bridge).
void StrideWrapperProcessor::syncControlParamFromUI (int idx, float norm)
{
    if (idx < 0 || idx >= kControlCount) return;
    auto* cp = controlParams[(size_t) idx];
    if (cp == nullptr) return;
    const float v = juce::jlimit (0.0f, 1.0f, norm);
    if (std::abs (v - cp->getValue()) < 1.0e-4f) return;
    cp->beginChangeGesture();
    cp->setValueNotifyingHost (v);
    cp->endChangeGesture();
}

// Tempo mode (bridge). Clamped at the door so the audio thread never divides by nonsense;
// bpm <= 0 = "keep the stored value" (a mode switch alone doesn't carry a number).
void StrideWrapperProcessor::setTempoMode (int mode, float bpm)
{
    tempoMode.store (juce::jlimit (0, 1, mode));
    if (bpm > 0.0f) manualBpm.store (juce::jlimit (5.0f, 999.0f, bpm));
    hostDirtyPending.store (true);
}

// Ableton's "Configure" mode adds a VST3 param to the device only when that param fires a
// host-visible gesture. Wiggling a hosted synth knob fires ITS gesture to us (we're its host),
// never to Ableton — so the macros stay invisible. This fires a real begin/setValueNotifyingHost/
// end gesture on every EXPOSED macro so, while Ableton is in Configure, they all pop into the
// list. A tiny nudge-then-restore guarantees a detectable delta without a lasting audio change
// (in Live mode the macro is a display mirror; it doesn't drive the hosted param). MESSAGE THREAD.
void StrideWrapperProcessor::announceMacrosToHost()
{
    std::vector<int> slots;
    {
        const juce::ScopedLock sl (hostLock);
        for (const auto& m : mapped)
            if (m.macroSlot >= 0 && m.macroSlot < kMacroCount) slots.push_back (m.macroSlot);
    }
    for (int slot : slots)
        if (auto* mp = macroParams[(size_t) slot])
        {
            const float v = mp->getValue();
            const float nudged = (v <= 0.5f) ? juce::jmin (1.0f, v + 0.02f) : juce::jmax (0.0f, v - 0.02f);
            mp->beginChangeGesture();
            mp->setValueNotifyingHost (nudged);
            mp->setValueNotifyingHost (v);        // restore
            mp->endChangeGesture();
        }

    // The Stride CONTROL params ride the same announce (2026-08-07): they have no UI
    // inside Stride to "touch", so Ableton's Configure would never catch them otherwise.
    // The nudge-and-restore happens inside ONE message-thread call — the editor's 30Hz
    // relay can't observe the transient, so nothing is ever applied to the curves.
    for (auto* cp : controlParams)
        if (cp != nullptr)
        {
            const float v = cp->getValue();
            const float nudged = (v <= 0.5f) ? juce::jmin (1.0f, v + 0.02f) : juce::jmax (0.0f, v - 0.02f);
            cp->beginChangeGesture();
            cp->setValueNotifyingHost (nudged);
            cp->setValueNotifyingHost (v);        // restore
            cp->endChangeGesture();
        }
}

// Live-mode mirror pacing (message thread). 66ms ≈ 15Hz — half the editor tick: a watched
// knob still reads as continuous, the host-event load halves (and it multiplies per open
// instance). 400ms of stillness ends a slot's host gesture (touch semantics).
static constexpr juce::uint32 kMirrorIntervalMs = 66;
static constexpr juce::uint32 kGestureQuietMs   = 400;

// In LIVE mode the macro is normally a silent display mirror. To make Ableton's exposed params
// actually MOVE with the drawn curve (0..1 Y over the loop's X) — and record into an automation
// lane when armed — report the live value to the host via setValueNotifyingHost. Change-detected,
// capped to ~15Hz, and each moving stretch is WRAPPED IN A HOST GESTURE (begin on first move,
// end after 400ms of stillness): an un-gestured edit stream reads as thousands of one-off
// automation writes — the expensive path in every host. NOT in Automation mode (there the host
// drives us).
// NI EXCEPTION: Maschine 2 (Mac report 2026-07, 4-5 instances) never drains a sustained edit
// stream — its UI thread backlogs until the whole app hangs mid-playback. Maschine's browser
// doesn't surface these params usefully anyway, so under Maschine the mirror is OFF entirely;
// Automation mode (Maschine driving our macros) still works.
// Message thread (driven by the editor timer).
void StrideWrapperProcessor::pushMacroValuesToHost()
{
    static const bool niHost = juce::PluginHostType().isMaschine();
    if (niHost) return;

    const auto now = juce::Time::getMillisecondCounter();

    for (auto* mp : macroParams)                    // end gestures on slots that went still
        if (mp != nullptr && mp->gestureOpen && now - mp->lastEditMs > kGestureQuietMs)
        {
            mp->endChangeGesture();
            mp->gestureOpen = false;
        }

    if (driveMode.load() != DriveMode::Live) return;

    // RECORD-FOLLOW ONLY: every notified edit lands in the DAW's UNDO HISTORY. A plain
    // playback stretch used to bury the user's own edits under invisible "param change"
    // entries — Ctrl+Z after a timeline edit undid Stride noise instead (field report
    // 2026-07-16). While the host RECORDS, following/writing automation is the point;
    // otherwise stay silent (the canvas playhead shows the motion, and the macros still
    // track via plain setValue so a save captures current values).
    if (! transportRecording.load()) return;

    if (now - lastMirrorPushMs < kMirrorIntervalMs) return;
    lastMirrorPushMs = now;

    std::vector<int> slots;
    {
        const juce::ScopedTryLock sl (hostLock);   // TRY, never block - a skipped mirror tick is invisible; see the hang guard
        if (! sl.isLocked()) return;
        for (const auto& m : mapped)
            if (m.macroSlot >= 0 && m.macroSlot < kMacroCount) slots.push_back (m.macroSlot);
    }
    for (int slot : slots)
        if (auto* mp = macroParams[(size_t) slot])
        {
            const float v = mp->getValue();
            if (std::abs (v - mp->lastPushed) > 0.0005f)
            {
                if (! mp->gestureOpen)
                {
                    mp->beginChangeGesture();       // opens the touch — the host coalesces edits inside it
                    mp->gestureOpen = true;
                }
                mp->setValueNotifyingHost (v);      // Ableton's param follows the modulation
                mp->lastPushed = v;
                mp->lastEditMs = now;
            }
        }
}

// End any still-open macro gestures. The editor timer is the only thing that closes them on
// stillness, so the editor DESTRUCTOR calls this — otherwise closing Stride's window mid-play
// leaves the host thinking those params are still touched (Live would latch them while recording).
void StrideWrapperProcessor::closeMacroGestures()
{
    for (auto* mp : macroParams)
        if (mp != nullptr && mp->gestureOpen)
        {
            mp->endChangeGesture();
            mp->gestureOpen = false;
        }
}

// MESSAGE THREAD: give each macro the real name of the param it drives ("Serum: Cutoff"), or
// clear it (a free slot then reads "Stride N"), then ask the host to re-read the param titles.
void StrideWrapperProcessor::refreshMacroLabels()
{
    std::array<juce::String, kMacroCount> labels;
    {
        const juce::ScopedLock sl (hostLock);
        for (const auto& m : mapped)
        {
            if (m.macroSlot < 0 || m.macroSlot >= kMacroCount) continue;
            juce::String nm = "Stride";
            if (m.node >= 0 && m.node < (int) chain.size() && chain[(size_t) m.node].inst)
            {
                auto& ps = chain[(size_t) m.node].inst->getParameters();
                const juce::String pn = (m.param >= 0 && m.param < ps.size()) ? ps[m.param]->getName (32) : juce::String ("?");
                nm = chain[(size_t) m.node].name + ": " + pn;
            }
            labels[(size_t) m.macroSlot] = nm;
        }
    }
    for (int i = 0; i < kMacroCount; ++i)
        if (macroParams[(size_t) i] != nullptr)
            macroParams[(size_t) i]->label = labels[(size_t) i];   // "" -> the param falls back to "Stride i+1"

    // VST3 kParamTitlesChanged — tells the host to re-read parameter names live.
    updateHostDisplay (juce::AudioProcessorListener::ChangeDetails{}.withParameterInfoChanged (true));
}

void StrideWrapperProcessor::handleAsyncUpdate()
{
    refreshMacroLabels();
}

// ── live curve drive ───────────────────────────────────────────────
void StrideWrapperProcessor::setDriveCurves (const std::vector<DriveLane>& lanes, double clipBeats)
{
    if (editLocked.load()) return;   // SOFT LOCK (defense-in-depth): no NEW curves — even a bypassed
                                     // WebView can't reach here; existing driveLanes keep playing.
    const juce::ScopedLock sl (hostLock);
    if (clipBeats > 0.0) driveClipBeats = clipBeats;   // <=0 = keep last
    driveLanes.clear();
    for (const auto& L : lanes)
        if (L.position >= 0 && L.position < (int) mapped.size())
            driveLanes.push_back ({ mapped[(size_t) L.position].node, mapped[(size_t) L.position].param, L.times, L.values, L.curves });
    hostDirtyPending.store (true);   // drawn curves are project state too
}

// Quadratic-bezier-per-segment matching the canvas render (cp = midV + curve*|dv|*1.2 at
// the midpoint time; time param stays linear). Linear when curve == 0.
// See the header note: interp() below treats the LAST element as "the end", so one
// mid-array time freezes the value from that time onward. Ascending-check first — the
// overwhelmingly common case pays one linear scan and allocates nothing.
void StrideWrapperProcessor::sortLaneByTime (std::vector<float>& ts, std::vector<float>& vs, std::vector<float>& cs)
{
    const size_t n = ts.size();
    bool sorted = true;
    for (size_t i = 1; i < n; ++i) if (ts[i] < ts[i - 1]) { sorted = false; break; }
    if (sorted) return;
    std::vector<size_t> idx (n);
    for (size_t i = 0; i < n; ++i) idx[i] = i;
    std::stable_sort (idx.begin(), idx.end(), [&ts] (size_t a, size_t b) { return ts[a] < ts[b]; });
    std::vector<float> t2, v2, c2;
    t2.reserve (n); v2.reserve (n); c2.reserve (n);
    for (const size_t i : idx)
    {
        t2.push_back (ts[i]);
        v2.push_back (i < vs.size() ? vs[i] : 0.0f);
        c2.push_back (i < cs.size() ? cs[i] : 0.0f);
    }
    ts = std::move (t2); vs = std::move (v2); cs = std::move (c2);
}

float StrideWrapperProcessor::interp (const std::vector<float>& xs, const std::vector<float>& ys, const std::vector<float>& cs, float x)
{
    if (xs.empty()) return 0.0f;
    if (x <= xs.front()) return ys.front();
    if (x >= xs.back())  return ys.back();
    for (size_t i = 0; i + 1 < xs.size(); ++i)
        if (x >= xs[i] && x <= xs[i + 1])
        {
            const float d = xs[i + 1] - xs[i];
            const float s = d > 0.0f ? (x - xs[i]) / d : 0.0f;
            const float cv = (i < cs.size()) ? cs[i] : 0.0f;
            if (cv == 0.0f)
                return ys[i] + s * (ys[i + 1] - ys[i]);

            const float cp = (ys[i] + ys[i + 1]) * 0.5f + cv * std::abs (ys[i + 1] - ys[i]) * 1.2f;
            const float u  = 1.0f - s;
            return u * u * ys[i] + 2.0f * u * s * cp + s * s * ys[i + 1];
        }
    return ys.back();
}

juce::AudioProcessorEditor* StrideWrapperProcessor::createEditor()
{
    return new StrideWrapperEditor (*this);
}

juce::AudioProcessor* JUCE_CALLTYPE createPluginFilter()
{
    return new StrideWrapperProcessor();
}
