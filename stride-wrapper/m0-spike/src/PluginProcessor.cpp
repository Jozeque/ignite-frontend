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
                main->enable (true);
        }
    }

}

StrideWrapperProcessor::StrideWrapperProcessor()
    : juce::AudioProcessor (BusesProperties()
        .withOutput ("Output", juce::AudioChannelSet::stereo(), true))
{
    formatManager.addFormat (std::make_unique<juce::VST3PluginFormat>());
    demoMode.store (! stride_license::cachedEntitled());   // start limited unless a cached VST entitlement is present; UI confirms live
    loadDemoCycleState();                                   // restore the demo move/freeze cycle (reload-proof)
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
    const juce::ScopedLock sl (hostLock);
    for (auto& n : chain) if (n.inst) n.inst->removeListener (this);
    chain.clear();
}

// ── lifecycle ──────────────────────────────────────────────────────
void StrideWrapperProcessor::prepareToPlay (double sampleRate, int samplesPerBlock)
{
    currentSampleRate = sampleRate;
    currentBlockSize  = samplesPerBlock;
    const juce::ScopedLock sl (hostLock);
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
    return layouts.getMainOutputChannelSet() == juce::AudioChannelSet::stereo();
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
    double beats = freeRunPhase;
    bool freeRun = (wrapperType == wrapperType_Standalone);
    bool transportPlaying = false;
    if (! freeRun)
    {
        if (auto* ph = getPlayHead())
        {
            if (auto pos = ph->getPosition())
            {
                const bool playing = pos->getIsPlaying();
                transportPlaying = playing;
                if (auto ppq = pos->getPpqPosition()) { beats = *ppq; freeRunPhase = *ppq; }
                else if (playing) freeRun = true;
                // else: stopped with no position -> hold
            }
            else freeRun = true;
        }
        else freeRun = true;
    }
    if (freeRun)
    {
        freeRunPhase += (double) buffer.getNumSamples() / currentSampleRate * 2.0;   // 120 BPM
        beats = freeRunPhase;
        transportPlaying = true;   // standalone / no-transport: treat as playing so the demo cycle advances
    }

    const juce::ScopedTryLock sl (hostLock);
    if (sl.isLocked() && ! chain.empty())
    {
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
                demoResumeSecs.store (0);
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
                    else demoMoveUsedMs.store (used);
                }
            }
            demoFrozen.store (demoFreezeNow);
        }
        else { demoFrozen.store (false); demoResumeSecs.store (0); }

        if (! driveLanes.empty() && ! demoFreezeNow)   // FREEZE skips the drive -> hosted knobs hold their last value
        {
            const double cb = driveClipBeats > 0.0 ? driveClipBeats : 16.0;
            double ph = std::fmod (beats, cb);
            if (ph < 0.0) ph += cb;
            lastModValue.store ((float) (ph / cb));

            for (const auto& lane : driveLanes)
            {
                if (lane.node < 0 || lane.node >= (int) chain.size() || ! chain[(size_t) lane.node].inst) continue;
                auto& ps = chain[(size_t) lane.node].inst->getParameters();
                if (lane.param >= 0 && lane.param < ps.size())
                    if (auto* p = ps[lane.param])
                        p->setValue (interp (lane.times, lane.values, lane.curves, (float) ph));
            }
        }

        // Run the chain in series: node 0 is the instrument (gets the MIDI), the rest
        // process the audio in place. MIDI only goes to the instrument.
        juce::MidiBuffer noMidi;
        for (size_t i = 0; i < chain.size(); ++i)
            if (chain[i].inst && ! chain[i].bypassed)
                chain[i].inst->processBlock (buffer, i == 0 ? midi : noMidi);   // bypassed = skipped (audio passes through)

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
        buffer.clear();
    }
}

// ── hosted chain (message thread) ──────────────────────────────────
void StrideWrapperProcessor::loadPlugin (const juce::File& vst3File)
{
    juce::VST3PluginFormat fmt;
    juce::OwnedArray<juce::PluginDescription> found;
    fmt.findAllTypesForFile (found, vst3File.getFullPathName());

    if (found.isEmpty())
    {
        DBG ("Stride M0: no VST3 plugin found at " << vst3File.getFullPathName());
        return;
    }

    const auto pathStr = vst3File.getFullPathName();
    formatManager.createPluginInstanceAsync (
        *found[0], currentSampleRate, currentBlockSize,
        [this, pathStr] (std::unique_ptr<juce::AudioPluginInstance> instance, const juce::String& error)
        {
            if (instance == nullptr)
            {
                DBG ("Stride M0: load failed - " << error);
                juce::ignoreUnused (error);
                return;
            }

            configureHostedBuses (*instance);   // main-stereo only — no sidechain/aux (prevents the FabFilter crash)
            instance->setRateAndBufferSizeDetails (currentSampleRate, currentBlockSize);
            instance->prepareToPlay (currentSampleRate, currentBlockSize);
            instance->addListener (this);     // so Map can learn this device's knob moves
            const auto name = instance->getName();
            {
                const juce::ScopedLock sl (hostLock);
                chain.push_back ({ std::move (instance), name, pathStr });   // append to the chain
            }
            mapVersion.fetch_add (1);
        });
}

void StrideWrapperProcessor::clearChain()
{
    const juce::ScopedLock sl (hostLock);

    // Capture a FULL-chain undo snapshot so Ctrl+Z brings the whole chain back (patches + curves).
    lastRemoved = RemovedSnapshot{};
    for (int i = 0; i < (int) chain.size(); ++i)
    {
        RemovedSnapshot::Dev d;
        d.path = chain[(size_t) i].path;
        d.position = i;
        if (chain[(size_t) i].inst) chain[(size_t) i].inst->getStateInformation (d.state);
        for (const auto& m : mapped)     if (m.node == i) d.params.push_back (m.param);
        for (const auto& l : driveLanes) if (l.node == i) d.lanes.push_back (l);
        lastRemoved.devices.push_back (std::move (d));
    }
    lastRemoved.valid = ! lastRemoved.devices.empty();

    for (auto& n : chain) if (n.inst) n.inst->removeListener (this);
    chain.clear();
    mapped.clear();
    driveLanes.clear();
    mapVersion.fetch_add (1);
}

void StrideWrapperProcessor::removeNode (int index)
{
    const juce::ScopedLock sl (hostLock);
    if (index < 0 || index >= (int) chain.size()) return;

    // Capture a single-level undo snapshot: path + patch + this node's mapped params/curves.
    lastRemoved = RemovedSnapshot{};
    {
        RemovedSnapshot::Dev d;
        d.path = chain[(size_t) index].path;
        d.position = index;
        if (chain[(size_t) index].inst) chain[(size_t) index].inst->getStateInformation (d.state);
        for (const auto& m : mapped)     if (m.node == index) d.params.push_back (m.param);
        for (const auto& l : driveLanes) if (l.node == index) d.lanes.push_back (l);
        lastRemoved.devices.push_back (std::move (d));
    }
    lastRemoved.valid = true;

    if (chain[(size_t) index].inst) chain[(size_t) index].inst->removeListener (this);
    chain.erase (chain.begin() + index);

    // Drop mapped params on the removed node; shift indices above it down.
    std::vector<MapRef> nm;
    for (const auto& m : mapped) { if (m.node == index) continue; MapRef x = m; if (x.node > index) --x.node; nm.push_back (x); }
    mapped.swap (nm);

    std::vector<StoredLane> nd;
    for (const auto& l : driveLanes) { if (l.node == index) continue; StoredLane x = l; if (x.node > index) --x.node; nd.push_back (x); }
    driveLanes.swap (nd);

    mapVersion.fetch_add (1);
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

    // Restore front-to-back so each device lands back at its captured position.
    std::sort (devs->begin(), devs->end(),
               [] (const RemovedSnapshot::Dev& a, const RemovedSnapshot::Dev& b) { return a.position < b.position; });
    restoreNextDevice (devs, 0);
}

// Re-instantiate one snapshot device, then chain to the next (async completes on the message
// thread, so restoring sequentially is what keeps the chain order intact).
void StrideWrapperProcessor::restoreNextDevice (std::shared_ptr<std::vector<RemovedSnapshot::Dev>> devs, size_t i)
{
    if (devs == nullptr || i >= devs->size()) return;
    const auto d = (*devs)[i];

    if (d.path.isEmpty()) { restoreNextDevice (devs, i + 1); return; }

    juce::VST3PluginFormat fmt;
    juce::OwnedArray<juce::PluginDescription> found;
    fmt.findAllTypesForFile (found, d.path);
    if (found.isEmpty()) { restoreNextDevice (devs, i + 1); return; }   // skip a missing plugin, keep going

    formatManager.createPluginInstanceAsync (
        *found[0], currentSampleRate, currentBlockSize,
        [this, devs, i, d] (std::unique_ptr<juce::AudioPluginInstance> inst, const juce::String& err)
        {
            if (inst != nullptr)
            {
                configureHostedBuses (*inst);   // main-stereo only — no sidechain/aux (prevents the FabFilter crash)
                inst->setRateAndBufferSizeDetails (currentSampleRate, currentBlockSize);
                if (d.state.getSize() > 0) inst->setStateInformation (d.state.getData(), (int) d.state.getSize());
                inst->prepareToPlay (currentSampleRate, currentBlockSize);
                inst->addListener (this);
                const auto name = inst->getName();
                {
                    const juce::ScopedLock sl (hostLock);
                    const int p = juce::jlimit (0, (int) chain.size(), d.position);
                    for (auto& m : mapped)     if (m.node >= p) ++m.node;   // make room at p
                    for (auto& l : driveLanes) if (l.node >= p) ++l.node;
                    chain.insert (chain.begin() + p, Node { std::move (inst), name, d.path, d.bypassed });
                    for (int pr : d.params) mapped.push_back ({ p, pr });             // restore this device's lanes
                    for (auto l : d.lanes) { l.node = p; driveLanes.push_back (l); }  // and their curves
                }
                mapVersion.fetch_add (1);
            }
            else juce::ignoreUnused (err);

            restoreNextDevice (devs, i + 1);   // next device, in order
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
    if (index >= 0 && index < (int) chain.size()) chain[(size_t) index].bypassed = shouldBypass;
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
    root.setAttribute ("clipBeats", driveClipBeats);

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

    // Tear down whatever is hosted now (this is a load, not an undoable removal).
    {
        const juce::ScopedLock sl (hostLock);
        for (auto& n : chain) if (n.inst) n.inst->removeListener (this);
        chain.clear(); mapped.clear(); driveLanes.clear();
        driveClipBeats = xml->getDoubleAttribute ("clipBeats", 16.0);
    }
    mapVersion.fetch_add (1);

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
    if (devs->empty()) return;

    if (auto* mapXml = xml->getChildByName ("MAPPED"))
        for (auto* e : mapXml->getChildIterator())
        {
            const int n = e->getIntAttribute ("n", -1);
            if (n >= 0 && n < (int) devs->size()) (*devs)[(size_t) n].params.push_back (e->getIntAttribute ("p"));
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
            (*devs)[(size_t) n].lanes.push_back (l);
        }

    // createPluginInstanceAsync must run on the message thread; hop there in case
    // a host restores state from a loader thread.
    juce::MessageManager::callAsync ([this, devs] { restoreNextDevice (devs, 0); });
}

// ── Map: learn by touch across the chain ───────────────────────────
void StrideWrapperProcessor::mapParam (juce::AudioProcessor* proc, int parameterIndex)
{
    if (! learnMode.load()) return;

    const juce::ScopedLock sl (hostLock);
    const int node = nodeIndexOf (proc);
    if (node < 0) return;
    for (const auto& m : mapped)
        if (m.node == node && m.param == parameterIndex) return;   // already mapped
    mapped.push_back ({ node, parameterIndex });
    mapVersion.fetch_add (1);
}

void StrideWrapperProcessor::audioProcessorParameterChanged (juce::AudioProcessor* proc, int parameterIndex, float)
{
    mapParam (proc, parameterIndex);
}

// Touching a control (gesture begin) maps it too — so a single CLICK on a knob
// maps it without having to move it.
void StrideWrapperProcessor::audioProcessorParameterChangeGestureBegin (juce::AudioProcessor* proc, int parameterIndex)
{
    mapParam (proc, parameterIndex);
}

void StrideWrapperProcessor::setLearnMode (bool shouldLearn)
{
    learnMode.store (shouldLearn);
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
juce::Array<juce::var> StrideWrapperProcessor::getMappedCurves() const
{
    juce::Array<juce::var> out;
    const juce::ScopedLock sl (hostLock);
    for (const auto& m : mapped)
    {
        juce::Array<juce::var> pts;
        for (const auto& L : driveLanes)
            if (L.node == m.node && L.param == m.param)
            {
                for (size_t i = 0; i < L.times.size(); ++i)
                {
                    auto* o = new juce::DynamicObject();
                    o->setProperty ("time",  (double) L.times[i]);
                    o->setProperty ("value", (double) (i < L.values.size() ? L.values[i] : 0.0f));
                    o->setProperty ("curve", (double) (i < L.curves.size() ? L.curves[i] : 0.0f));
                    pts.add (juce::var (o));
                }
                break;
            }
        out.add (juce::var (pts));
    }
    return out;
}

void StrideWrapperProcessor::removeMappedAt (int pos)
{
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
        mapVersion.fetch_add (1);
    }
}

void StrideWrapperProcessor::clearMapping()
{
    const juce::ScopedLock sl (hostLock);
    mapped.clear();
    mapVersion.fetch_add (1);
}

// ── live curve drive ───────────────────────────────────────────────
void StrideWrapperProcessor::setDriveCurves (const std::vector<DriveLane>& lanes, double clipBeats)
{
    const juce::ScopedLock sl (hostLock);
    if (clipBeats > 0.0) driveClipBeats = clipBeats;   // <=0 = keep last
    driveLanes.clear();
    for (const auto& L : lanes)
        if (L.position >= 0 && L.position < (int) mapped.size())
            driveLanes.push_back ({ mapped[(size_t) L.position].node, mapped[(size_t) L.position].param, L.times, L.values, L.curves });
}

// Quadratic-bezier-per-segment matching the canvas render (cp = midV + curve*|dv|*1.2 at
// the midpoint time; time param stays linear). Linear when curve == 0.
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
