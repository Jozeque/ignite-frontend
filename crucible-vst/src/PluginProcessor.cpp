#include "PluginProcessor.h"
#if !defined(CRUCIBLE_TESTS)
#include "PluginEditor.h"
#endif

// ═══════════════════════════════ voice ═══════════════════════════════
void CrucibleVoice::startNote(int midiNoteNumber, float, juce::SynthesiserSound*, int)
{
    monoNote = midiNoteNumber;
    const float f0 = (float) juce::MidiMessage::getMidiNoteInHertz(midiNoteNumber);
    const bool wasSilent = !core.active();
    core.noteOn(f0, proc.glideF0, wasSilent);      // silent voices glide from the previous
    proc.glideF0 = f0;                             // note's pitch — mono-device parity
    proc.lastF0.store(f0, std::memory_order_relaxed);
    proc.bus.retune(f0);                           // metal bank keytracks the newest note
}

void CrucibleVoice::stopNote(float, bool allowTailOff)
{
    if (allowTailOff) core.noteOff();
    else { core.kill(); clearCurrentNote(); }
}

void CrucibleVoice::setCurrentPlaybackSampleRate(double newRate)
{
    juce::SynthesiserVoice::setCurrentPlaybackSampleRate(newRate);
    if (newRate > 0) core.prepare((float) newRate);
}

void CrucibleVoice::renderNextBlock(juce::AudioBuffer<float>& out, int startSample, int numSamples)
{
    if (!core.active()) return;
    auto* d = out.getWritePointer(0);
    for (int i = 0; i < numSamples; ++i)
    {
        d[startSample + i] += core.render(proc.voiceParams);
        if (!core.active()) { clearCurrentNote(); break; }
    }
}

void CrucibleVoice::monoChange(int newNote, bool legato)
{
    monoNote = newNote;
    const float f0 = (float) juce::MidiMessage::getMidiNoteInHertz(newNote);
    core.noteF0 = f0;                       // osc target: fsm glides there (built-in porta)
    if (!legato && core.gate)
        core.env.stg = 1;                   // re-attack from the current level (click-free)
    core.gate = true;                       // off→on transitions retrigger via the env's own edge
    proc.glideF0 = f0;
    proc.lastF0.store(f0, std::memory_order_relaxed);
    proc.bus.retune(f0);
}

// ═══════════════════════════════ mono synth ═══════════════════════════════
void CrucibleSynth::setModes(bool mono, bool legato)
{
    legatoMode.store(legato, std::memory_order_relaxed);
    if (mono != monoMode.exchange(mono, std::memory_order_relaxed))
    {
        {
            const juce::ScopedLock sl(lock);
            heldNotes.clear();
        }
        allNotesOff(0, true);   // mode flip releases held notes — clean bookkeeping
    }
}

void CrucibleSynth::noteOn(int midiChannel, int midiNoteNumber, float velocity)
{
    if (!monoMode.load(std::memory_order_relaxed))
    {
        juce::Synthesiser::noteOn(midiChannel, midiNoteNumber, velocity);
        return;
    }
    const juce::ScopedLock sl(lock);
    heldNotes.erase(std::remove(heldNotes.begin(), heldNotes.end(), midiNoteNumber), heldNotes.end());
    heldNotes.push_back(midiNoteNumber);

    CrucibleVoice* target = nullptr;
    for (int i = 0; i < getNumVoices(); ++i)
        if (auto* cv = dynamic_cast<CrucibleVoice*>(getVoice(i)))
            if (cv->isVoiceActive())
            {
                if (target == nullptr) target = cv;
                else cv->stopNote(0.0f, true);      // collapse any leftover poly voices
            }

    if (target != nullptr)
        target->monoChange(midiNoteNumber, legatoMode.load(std::memory_order_relaxed) && target->core.gate);
    else
        juce::Synthesiser::noteOn(midiChannel, midiNoteNumber, velocity);
}

void CrucibleSynth::noteOff(int midiChannel, int midiNoteNumber, float velocity, bool allowTailOff)
{
    if (!monoMode.load(std::memory_order_relaxed))
    {
        juce::Synthesiser::noteOff(midiChannel, midiNoteNumber, velocity, allowTailOff);
        return;
    }
    const juce::ScopedLock sl(lock);
    heldNotes.erase(std::remove(heldNotes.begin(), heldNotes.end(), midiNoteNumber), heldNotes.end());

    CrucibleVoice* v = nullptr;
    for (int i = 0; i < getNumVoices(); ++i)
        if (auto* cv = dynamic_cast<CrucibleVoice*>(getVoice(i)))
            if (cv->isVoiceActive() && cv->monoNote == midiNoteNumber)
            { v = cv; break; }
    if (v == nullptr) return;                        // a stacked (not sounding) note lifted

    if (!heldNotes.empty())
        v->monoChange(heldNotes.back(),              // fall back to the still-held note
                      legatoMode.load(std::memory_order_relaxed));
    else
        v->stopNote(velocity, allowTailOff);
}

// ═══════════════════════════════ processor ═══════════════════════════════
CrucibleProcessor::CrucibleProcessor()
    : juce::AudioProcessor(BusesProperties().withOutput("Output", juce::AudioChannelSet::stereo(), true)),
      apvts(*this, nullptr, "PARAMS", cru::createParameterLayout())
{
    for (const auto& d : cru::paramDefs())
        prm.push_back(apvts.getRawParameterValue(d.id));
    for (const auto& t : cru::toggleDefs())
        prm.push_back(apvts.getRawParameterValue(t.id));   // toggles follow the floats
    prmGain = apvts.getRawParameterValue(cru::kGainID);
    prmDriveType = apvts.getRawParameterValue(cru::kDriveTypeID);   // raw value = index 0..5
    prmMono = apvts.getRawParameterValue("mono");
    prmLegato = apvts.getRawParameterValue("legato");

    for (int i = 0; i < 8; ++i) synth.addVoice(new CrucibleVoice(*this));
    synth.addSound(new CrucibleSound());
}

CrucibleProcessor::~CrucibleProcessor()
{
    for (auto& in : midiInputs)
        if (in) in->stop();
    midiInputs.clear();
}

void CrucibleProcessor::rescanMidiInputs()
{
    if (wrapperType != juce::AudioProcessor::wrapperType_Standalone)
        return;
    for (const auto& d : juce::MidiInput::getAvailableDevices())
    {
        if (!openMidiIds.insert(d.identifier).second)
            continue;
        if (auto in = juce::MidiInput::openDevice(d.identifier, &midiCollector))
        {
            in->start();
            midiInputs.push_back(std::move(in));
        }
        else
        {
            openMidiIds.erase(d.identifier);   // failed — retry on the next rescan
        }
    }
}

namespace
{
    // paramDefs() order — keep in sync with Params.h
    enum PIdx : int
    {
        iMorph = 0, iMorph2, iPulsar, iFormant, iRips, iRipshape, iDrift, iStretch, iFractal,
        iAttack, iDecay, iSustain, iRelease,
        iModalRes, iModalTune, iModalRing,
        iDriveAmt, iDriveMorph, iDriveMix,
        iCrush, iGrind,
        iMetal, iMaterial,
        iFltMix, iFltFreq, iFltRate, iFltDepth, iFltShape,
        iSpace, iShimmer,
        iFbAmt, iFbTone, iFbTime, iFbShift,
        iOtt, iMove, iWidth, iTilt, iOutDrive, iMix,
        // toggles (appended after the float defs in prm)
        iDriveOn, iGrindOn, iMetalOn, iFltOn, iVerbOn, iFbOn, iOttOn
    };
}

static void pullParams(const std::vector<std::atomic<float>*>& prm,
                       cru::VoiceParams& vp, cru::FxParams& fx, const cru::BusChain& bus,
                       float driveTypeIdx)
{
    auto v = [&prm](int i) { return prm[(size_t) i]->load(std::memory_order_relaxed); };

    const float drift = bus.chaos.morphDrift();     // MOVE animates the morph itself
    vp.morph     = cru::clampf(v(iMorph)  + drift,          0.0f, 1.0f);
    vp.morph2    = cru::clampf(v(iMorph2) - drift * 0.7f,   0.0f, 1.0f);
    vp.pulsar    = v(iPulsar);   vp.formant  = v(iFormant);
    vp.rips      = v(iRips);     vp.ripshape = v(iRipshape);
    vp.drift     = v(iDrift);    vp.fractal  = v(iFractal);
    vp.stretch   = cru::clampf(v(iStretch) + bus.chaos.stretchDrift(), 0.0f, 1.0f);
    vp.attack    = v(iAttack);   vp.decay    = v(iDecay);
    vp.sustain   = v(iSustain);  vp.release  = v(iRelease);
    vp.modalRes  = v(iModalRes); vp.modalTune = v(iModalTune); vp.modalRing = v(iModalRing);

    fx.driveAmt = v(iDriveAmt); fx.driveMorph = v(iDriveMorph); fx.driveMix = v(iDriveMix);
    fx.driveType = driveTypeIdx;
    fx.crush = v(iCrush); fx.grind = v(iGrind);
    fx.width = v(iWidth);
    fx.metal = v(iMetal); fx.material = v(iMaterial);
    fx.fltMix = v(iFltMix); fx.fltFreq = v(iFltFreq); fx.fltRate = v(iFltRate);
    fx.fltDepth = v(iFltDepth); fx.fltShape = v(iFltShape);
    fx.space = v(iSpace); fx.shimmer = v(iShimmer);
    fx.fbAmt = v(iFbAmt); fx.fbTone = v(iFbTone); fx.fbTime = v(iFbTime); fx.fbShift = v(iFbShift);
    fx.ott = v(iOtt); fx.move = v(iMove); fx.tilt = v(iTilt);
    fx.outDrive = v(iOutDrive); fx.mix = v(iMix);
    fx.driveOn = v(iDriveOn); fx.grindOn = v(iGrindOn); fx.metalOn = v(iMetalOn);
    fx.fltOn = v(iFltOn); fx.verbOn = v(iVerbOn); fx.fbOn = v(iFbOn); fx.ottOn = v(iOttOn);
}

void CrucibleProcessor::prepareToPlay(double sampleRate, int samplesPerBlock)
{
    currentSR = sampleRate;
    synth.setCurrentPlaybackSampleRate(sampleRate);
    voiceBuf.setSize(1, juce::jmax(64, samplesPerBlock));
    midiCollector.reset(sampleRate);
    rescanMidiInputs();

    bus.prepare((float) sampleRate);
    display.prepare((float) sampleRate);

    cru::FxParams fx;
    pullParams(prm, voiceParams, fx, bus, prmDriveType->load());
    bus.snapParams(fx);
    display.snapParams(voiceParams);
    for (int i = 0; i < synth.getNumVoices(); ++i)
        if (auto* cv = dynamic_cast<CrucibleVoice*>(synth.getVoice(i)))
        {
            cv->core.prepare((float) sampleRate);
            cv->core.snapParams(voiceParams);
        }
    masterLin = juce::Decibels::decibelsToGain(prmGain->load(), -70.0f);
}

bool CrucibleProcessor::isBusesLayoutSupported(const BusesLayout& layouts) const
{
    auto out = layouts.getMainOutputChannelSet();
    return out == juce::AudioChannelSet::stereo() || out == juce::AudioChannelSet::mono();
}

void CrucibleProcessor::processBlock(juce::AudioBuffer<float>& buffer, juce::MidiBuffer& midi)
{
    juce::ScopedNoDenormals noDenormals;
    const int n = buffer.getNumSamples();
    if (n == 0) return;

    if (wrapperType == juce::AudioProcessor::wrapperType_Standalone)
        midiCollector.removeNextBlockOfMessages(midi, n);   // hardware keyboards

    cru::FxParams fx;
    pullParams(prm, voiceParams, fx, bus, prmDriveType->load(std::memory_order_relaxed));
    synth.setModes(prmMono->load(std::memory_order_relaxed) > 0.5f,
                   prmLegato->load(std::memory_order_relaxed) > 0.5f);

    if (voiceBuf.getNumSamples() < n) voiceBuf.setSize(1, n, false, false, true);
    voiceBuf.clear(0, 0, n);
    synth.renderNextBlock(voiceBuf, midi, 0, n);

    float envMax = 0.0f;
    for (int i = 0; i < synth.getNumVoices(); ++i)
        if (auto* cv = dynamic_cast<CrucibleVoice*>(synth.getVoice(i)))
            envMax = std::max(envMax, cv->core.env.env);
    envNow.store(envMax, std::memory_order_relaxed);

    const bool  ui = editorOpen.load(std::memory_order_relaxed);
    const float f0 = lastF0.load(std::memory_order_relaxed);
    const auto* mono = voiceBuf.getReadPointer(0);
    auto* L = buffer.getWritePointer(0);
    auto* R = buffer.getNumChannels() > 1 ? buffer.getWritePointer(1) : nullptr;

    const float gTarget = juce::Decibels::decibelsToGain(prmGain->load(std::memory_order_relaxed), -70.0f);
    int wi = outWi.load(std::memory_order_relaxed);
    float pkLocal = 0.0f;

    for (int i = 0; i < n; ++i)
    {
        if (ui) display.process(voiceParams, f0);
        float l, r;
        bus.processSample(mono[i], l, r, fx, f0);
        masterLin += 0.002f * (gTarget - masterLin);
        l *= masterLin; r *= masterLin;
        L[i] = l;
        if (R) R[i] = r;
        outRing[wi] = (l + r) * 0.5f;
        wi = (wi + 1) & (kOutRing - 1);
        float ap = std::max(std::fabs(l), std::fabs(r));
        if (ap > pkLocal) pkLocal = ap;
    }
    outWi.store(wi, std::memory_order_relaxed);
    if (pkLocal > outPeak.load(std::memory_order_relaxed))
        outPeak.store(pkLocal, std::memory_order_relaxed);
    bus.publishMeters();

    for (int ch = 2; ch < buffer.getNumChannels(); ++ch)
        buffer.clear(ch, 0, n);

    // a runaway/NaN state resets the forge instead of latching silence forever
    if (!std::isfinite(L[n - 1]))
    {
        bus.reset();
        buffer.clear();
    }
}

void CrucibleProcessor::getStateInformation(juce::MemoryBlock& destData)
{
    auto state = apvts.copyState();
    state.setProperty("version", 1, nullptr);
    if (auto xml = state.createXml())
        copyXmlToBinary(*xml, destData);
}

void CrucibleProcessor::setStateInformation(const void* data, int sizeInBytes)
{
    if (auto xml = getXmlFromBinary(data, sizeInBytes))
        if (xml->hasTagName(apvts.state.getType()))
            apvts.replaceState(juce::ValueTree::fromXml(*xml));
}

juce::AudioProcessorEditor* CrucibleProcessor::createEditor()
{
#if defined(CRUCIBLE_TESTS)
    return new juce::GenericAudioProcessorEditor(*this);
#else
    return new CrucibleEditor(*this);
#endif
}

juce::AudioProcessor* JUCE_CALLTYPE createPluginFilter()
{
    return new CrucibleProcessor();
}
