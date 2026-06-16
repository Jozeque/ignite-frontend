#include "PluginProcessor.h"
#if !TENDRIL_TESTS
 #include "PluginEditor.h"
#endif
#include "BinaryData.h"

TendrilProcessor::TendrilProcessor()
    : juce::AudioProcessor(BusesProperties()
        .withOutput("Output", juce::AudioChannelSet::stereo(), true)),
      apvts(*this, nullptr, "PARAMS", tendril::createLayout())
{
    spectrum.setState(modHub);

    synth.addSound(new TendrilSound());
    for (int i = 0; i < kNumVoices; ++i)
        synth.addVoice(new TendrilVoice(modHub, &spectrum, &lastNoteMidi));

    fx.setState(modHub);
    fx.setNoteSource(&lastNoteMidi);

    modHub.bind(apvts);              // bind base sources + ranges (after engines registered ids)
    modEngine.setState(apvts, &modHub);

    if (!apvts.state.hasProperty("fxRouting"))
        apvts.state.setProperty("fxRouting",
            tendril::routingToJson(tendril::defaultRouting()), nullptr);
    applyRoutingFromState();
    loadMotionState();
}

void TendrilProcessor::prepareToPlay(double sampleRate, int samplesPerBlock)
{
    currentSampleRate = (sampleRate > 0.0) ? sampleRate : 44100.0;
    const int factor  = 1 << kOSFactorLog2;                 // 4x
    osSampleRate      = currentSampleRate * factor;

    const int nch = juce::jmax(1, getTotalNumOutputChannels());
    oversampler = std::make_unique<juce::dsp::Oversampling<float>>(
        (size_t) nch, (size_t) kOSFactorLog2,
        juce::dsp::Oversampling<float>::filterHalfBandPolyphaseIIR,
        /*isMaxQuality*/ true, /*useIntegerLatency*/ true);
    oversampler->initProcessing((size_t) juce::jmax(16, samplesPerBlock));
    oversampler->reset();

    // voices + FX run in the oversampled domain (smoothers ramp at osSampleRate)
    synth.setCurrentPlaybackSampleRate(osSampleRate);
    fx.prepare(osSampleRate, samplesPerBlock * factor, nch);
    modEngine.prepare(currentSampleRate);                   // motion phase is control-rate (host)

    setLatencySamples(juce::roundToInt(oversampler->getLatencyInSamples()));
}

bool TendrilProcessor::isBusesLayoutSupported(const BusesLayout& layouts) const
{
    const auto out = layouts.getMainOutputChannelSet();
    return out == juce::AudioChannelSet::stereo()
        || out == juce::AudioChannelSet::mono();
}

void TendrilProcessor::processBlock(juce::AudioBuffer<float>& buffer, juce::MidiBuffer& midi)
{
    juce::ScopedNoDenormals noDenormals;
    buffer.clear();

    const int hostN = buffer.getNumSamples();
    modHub.copyBase();                                  // eff = base for all params (control rate)
    modEngine.process(hostN, getPlayHead());            // overlay armed params (control rate)
    spectrum.processBlock(currentSampleRate, hostN);    // render the surface once (control rate)

    if (oversampler == nullptr)                         // safety: not prepared -> base-rate path
    {
        synth.renderNextBlock(buffer, midi, 0, hostN);
        fx.process(buffer);
        return;
    }

    // ---- oversampled audio render (generator pattern) ----
    const int factor = (int) oversampler->getOversamplingFactor();   // 4
    juce::dsp::AudioBlock<float> hostBlock(buffer);
    auto osBlock = oversampler->processSamplesUp(hostBlock);          // upsample the (cleared) block

    const int osN = (int) osBlock.getNumSamples();
    const int nch = juce::jmin(2, (int) osBlock.getNumChannels());
    float* osPtrs[2] = { nullptr, nullptr };
    for (int c = 0; c < nch; ++c) osPtrs[c] = osBlock.getChannelPointer((size_t) c);
    juce::AudioBuffer<float> osBuf(osPtrs, nch, osN);    // wrap os-block memory (never resized)

    // MIDI events are at HOST sample positions -> rescale onto the oversampled timeline,
    // otherwise every note fires `factor`x early (timing compressed to the block front).
    osMidi.clear();
    for (const auto meta : midi)
        osMidi.addEvent(meta.getMessage(), meta.samplePosition * factor);

    synth.renderNextBlock(osBuf, osMidi, 0, osN);        // voices render at osSampleRate
    fx.process(osBuf);                                   // FX + nonlinearities at osSampleRate

    oversampler->processSamplesDown(hostBlock);          // anti-alias filter + decimate -> host rate

    // final host-rate safety ceiling (decimation can overshoot the OS-rate soft limit)
    for (int c = 0; c < buffer.getNumChannels(); ++c)
    {
        float* d = buffer.getWritePointer(c);
        for (int i = 0; i < hostN; ++i) d[i] = TendrilFX::softLimit(d[i]);
    }
}

juce::AudioProcessorEditor* TendrilProcessor::createEditor()
{
#if TENDRIL_TESTS
    return new juce::GenericAudioProcessorEditor(*this);   // tests build without the WebView
#else
    return new TendrilEditor(*this);
#endif
}

// ---- routing -------------------------------------------------
bool TendrilProcessor::applyRoutingVar(const juce::var& v)
{
    tendril::Routing r {};
    if (!tendril::routingFromVar(v, r))
        return false;
    fx.setRoutingWord(tendril::encodeRouting(r));
    apvts.state.setProperty("fxRouting", tendril::routingToJson(r), nullptr);
    return true;
}

void TendrilProcessor::applyRoutingFromState()
{
    const auto json = apvts.state.getProperty("fxRouting").toString();
    if (json.isEmpty()) return;
    tendril::Routing r {};
    if (tendril::routingFromVar(juce::JSON::parse(json), r))
        fx.setRoutingWord(tendril::encodeRouting(r));
}

juce::String TendrilProcessor::getRoutingJson() const
{
    auto json = apvts.state.getProperty("fxRouting").toString();
    if (json.isEmpty()) json = tendril::routingToJson(tendril::defaultRouting());
    return json;
}

// ---- motion (arm bitmask + seed) ----------------------------
void TendrilProcessor::setModArm(const juce::String& id, bool on)
{
    const int idx = modHub.indexOf(id);
    if (idx >= 0) { modEngine.setArmed(idx, on); saveMotionState(); }
}

bool TendrilProcessor::getModArm(const juce::String& id) const
{
    const int idx = modHub.indexOf(id);
    return idx >= 0 && modEngine.isArmed(idx);
}

void TendrilProcessor::saveMotionState()
{
    apvts.state.setProperty("motionArm", juce::String((juce::int64) modEngine.armedMask()), nullptr);
    apvts.state.setProperty("motionSeed", (int) modEngine.getSeed(), nullptr);
}

void TendrilProcessor::loadMotionState()
{
    const auto m = apvts.state.getProperty("motionArm").toString();
    if (m.isNotEmpty()) modEngine.setArmedMask((uint64_t) m.getLargeIntValue());
    const int sd = (int) apvts.state.getProperty("motionSeed");
    if (sd != 0) modEngine.setSeed((uint32_t) sd);
}

// ---- state ---------------------------------------------------
void TendrilProcessor::getStateInformation(juce::MemoryBlock& destData)
{
    apvts.state.setProperty("scenes", spectrum.scenesToString(), nullptr);   // painted spectra persist
    saveMotionState();
    if (auto state = apvts.copyState(); state.isValid())
        if (auto xml = state.createXml())
            copyXmlToBinary(*xml, destData);
}

void TendrilProcessor::setStateInformation(const void* data, int sizeInBytes)
{
    if (auto xml = getXmlFromBinary(data, sizeInBytes))
    {
        apvts.replaceState(juce::ValueTree::fromXml(*xml));
        applyRoutingFromState();
        loadMotionState();
        const auto sc = apvts.state.getProperty("scenes").toString();
        if (sc.isNotEmpty()) spectrum.scenesFromString(sc);
    }
}

juce::AudioProcessor* JUCE_CALLTYPE createPluginFilter()
{
    return new TendrilProcessor();
}
