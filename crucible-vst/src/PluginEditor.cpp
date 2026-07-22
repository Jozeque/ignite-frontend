#include "PluginEditor.h"
#include "BinaryData.h"

static std::optional<juce::WebBrowserComponent::Resource> makeResource(const char* data, int size, const char* mime)
{
    std::vector<std::byte> bytes((size_t) size);
    std::memcpy(bytes.data(), data, (size_t) size);
    return juce::WebBrowserComponent::Resource { std::move(bytes), juce::String(mime) };
}

static juce::String b64FromFloats(const float* src, int n)
{
    juce::HeapBlock<juce::int16> tmp((size_t) n);
    for (int i = 0; i < n; ++i)
        tmp[i] = (juce::int16) juce::jlimit(-32000.0f, 32000.0f, src[i] * 30000.0f);
    return juce::Base64::toBase64(tmp.getData(), (size_t) n * sizeof(juce::int16));
}

CrucibleEditor::CrucibleEditor(CrucibleProcessor& p)
    : juce::AudioProcessorEditor(p), proc(p)
{
    for (auto* ap : proc.getParameters())
        if (auto* withID = dynamic_cast<juce::AudioProcessorParameterWithID*>(ap))
            paramIDs.push_back(withID->paramID);

    dirty.reserve(paramIDs.size());
    for (size_t i = 0; i < paramIDs.size(); ++i)
    {
        paramIndex[paramIDs[i]] = (int) i;
        dirty.push_back(std::make_unique<std::atomic<bool>>(false));
        proc.apvts.addParameterListener(paramIDs[i], this);
    }

    auto userData = juce::File::getSpecialLocation(juce::File::tempDirectory)
                        .getChildFile("CrucibleWebView2");
    userData.createDirectory();

    auto options = juce::WebBrowserComponent::Options{}
        .withBackend(juce::WebBrowserComponent::Options::Backend::webview2)
        .withWinWebView2Options(juce::WebBrowserComponent::Options::WinWebView2{}
                                    .withUserDataFolder(userData))
        .withNativeIntegrationEnabled()
        .withResourceProvider([](const juce::String& url)
            -> std::optional<juce::WebBrowserComponent::Resource>
        {
            if (url.containsIgnoreCase("favicon"))
                return std::nullopt;
            if (url.containsIgnoreCase("outfit"))
                return makeResource(BinaryData::Outfit_ttf, BinaryData::Outfit_ttfSize, "font/ttf");
            return makeResource(BinaryData::crucible_webui_html,
                                BinaryData::crucible_webui_htmlSize, "text/html");
        })
        .withEventListener("uiReady",      [this](juce::var)   { pushInit(); })
        .withEventListener("paramChanged", [this](juce::var v) { handleParamChanged(v); })
        .withEventListener("note",         [this](juce::var v)  // audition keys (kslider parity)
        {
            const int  n  = (int) v.getProperty("n", 48);
            const bool on = (bool) v.getProperty("on", false);
            if (on) proc.synth.noteOn(1, juce::jlimit(0, 127, n), 0.9f);
            else    proc.synth.noteOff(1, juce::jlimit(0, 127, n), 0.7f, true);
        })
        .withEventListener("bend",         [this](juce::var v)  // on-screen pitch wheel
        {
            proc.synth.handlePitchWheel(1, juce::jlimit(0, 16383, (int) v.getProperty("v", 8192)));
        });

    web = std::make_unique<juce::WebBrowserComponent>(options);
    addAndMakeVisible(*web);
    // cache-bust per launch: the WebView2 profile persists on disk and can serve
    // a stale embedded UI after an update otherwise
    web->goToURL(juce::WebBrowserComponent::getResourceProviderRoot()
                 + "index.html?v=" + juce::String(juce::Time::currentTimeMillis()));

    setResizable(true, true);
    setResizeLimits(980, 630, 2400, 1560);
    setSize(1180, 760);
    proc.editorOpen.store(true, std::memory_order_relaxed);
    proc.rescanMidiInputs();
    startTimerHz(30);
}

CrucibleEditor::~CrucibleEditor()
{
    proc.editorOpen.store(false, std::memory_order_relaxed);
    stopTimer();
    for (const auto& id : paramIDs)
        proc.apvts.removeParameterListener(id, this);
}

void CrucibleEditor::paint(juce::Graphics& g)
{
    g.fillAll(juce::Colour(0xff0d0b09));   // forge charcoal behind the view
}

void CrucibleEditor::resized()
{
    if (web) web->setBounds(getLocalBounds());
}

// ---- C++ -> page ----------------------------------------------------------
void CrucibleEditor::parameterChanged(const juce::String& parameterID, float)
{
    auto it = paramIndex.find(parameterID);
    if (it != paramIndex.end())
        dirty[(size_t) it->second]->store(true, std::memory_order_relaxed);
}

void CrucibleEditor::timerCallback()
{
    if (web == nullptr) return;

    auto* obj = new juce::DynamicObject();
    bool any = false;
    for (size_t i = 0; i < paramIDs.size(); ++i)
    {
        if (dirty[i]->exchange(false, std::memory_order_relaxed))
        {
            if (auto* par = proc.apvts.getParameter(paramIDs[i]))
            {
                obj->setProperty(paramIDs[i], (double) par->getValue());
                any = true;
            }
        }
    }
    if (any)
        web->emitEventIfBrowserIsVisible("params", juce::var(obj));
    else
        delete obj;

    if (++midiScanDiv >= 60)   // rescan for hot-plugged MIDI keyboards every ~2 s
    {
        midiScanDiv = 0;
        proc.rescanMidiInputs();
    }

    pushFrame();
}

void CrucibleEditor::pushFrame()
{
    // ---- 1-cycle morph trace (the WAVE display) ----
    float wave[512];
    {
        const auto& d = proc.display;
        const int p0 = d.phase0.load(std::memory_order_relaxed);
        for (int j = 0; j < 512; ++j)
            wave[j] = d.ring[(p0 + j) & 511];
    }

    // ---- output oscilloscope: keytracked window, rising-zero-cross trigger ----
    const int N = CrucibleProcessor::kOutRing;
    ringCopy.resize((size_t) N);
    {
        const int wi = proc.outWi.load(std::memory_order_relaxed);
        for (int k = 0; k < N; ++k)
            ringCopy[(size_t) k] = proc.outRing[(wi + k) & (N - 1)];
    }
    const double sr = proc.getSampleRate() > 0 ? proc.getSampleRate() : 48000.0;
    const float f0  = proc.lastF0.load(std::memory_order_relaxed);
    const int   win = juce::jlimit(256, 4096, (int) (1.0 * sr / juce::jmax(20.0f, f0)));   // ONE cycle
    int start = N - win;
    {
        const int span = juce::jmin(2048, start - 1);
        for (int back = 0; back < span; ++back)
        {
            const int i = start - back;
            if (ringCopy[(size_t) (i - 1)] <= 0.0f && ringCopy[(size_t) i] > 0.0f)
            { start = i; break; }
        }
    }
    float scope[512];
    for (int j = 0; j < 512; ++j)
    {
        const float pos = (float) start + (float) j * (float) (win - 1) / 511.0f;
        const int   i0  = (int) pos;
        const float fr  = pos - (float) i0;
        const int   i1  = juce::jmin(i0 + 1, N - 1);
        scope[j] = ringCopy[(size_t) i0] + (ringCopy[(size_t) i1] - ringCopy[(size_t) i0]) * fr;
    }

    juce::Array<juce::var> meterArr;
    for (int i = 0; i < cru::BusChain::kNumMeters; ++i)
        meterArr.add((double) proc.bus.meters[i].load(std::memory_order_relaxed));

    auto* fr = new juce::DynamicObject();
    fr->setProperty("w",   b64FromFloats(wave, 512));
    fr->setProperty("o",   b64FromFloats(scope, 512));
    fr->setProperty("m",   juce::var(meterArr));
    fr->setProperty("env", (double) proc.envNow.load(std::memory_order_relaxed));
    fr->setProperty("acc", (double) proc.bus.accent.load(std::memory_order_relaxed));
    fr->setProperty("f0",  (double) f0);
    fr->setProperty("pk",  (double) proc.outPeak.exchange(0.0f));
    fr->setProperty("bend", ((double) proc.lastBend.load(std::memory_order_relaxed) - 8192.0) / 8191.0);
    web->emitEventIfBrowserIsVisible("frame", juce::var(fr));
}

juce::var CrucibleEditor::collectAllParams() const
{
    auto* obj = new juce::DynamicObject();
    for (const auto& id : paramIDs)
        if (auto* par = proc.apvts.getParameter(id))
            obj->setProperty(id, (double) par->getValue());
    return juce::var(obj);
}

void CrucibleEditor::pushInit()
{
    if (web == nullptr) return;
    auto* obj = new juce::DynamicObject();
    obj->setProperty("params", collectAllParams());
    obj->setProperty("version", JucePlugin_VersionString);
    web->emitEventIfBrowserIsVisible("init", juce::var(obj));
}

// ---- page -> C++ ----------------------------------------------------------
void CrucibleEditor::handleParamChanged(const juce::var& payload)
{
    const auto  id    = payload.getProperty("id", {}).toString();
    const float val   = (float) (double) payload.getProperty("value", 0.0);
    const auto  phase = payload.getProperty("phase", "move").toString();

    auto* par = proc.apvts.getParameter(id);
    if (par == nullptr) return;

    if (phase == "tap")   // one-shot (power buttons): full gesture in one event
    {
        par->beginChangeGesture();
        par->setValueNotifyingHost(juce::jlimit(0.0f, 1.0f, val));
        par->endChangeGesture();
    }
    else
    {
        if (phase == "begin") par->beginChangeGesture();
        par->setValueNotifyingHost(juce::jlimit(0.0f, 1.0f, val));
        if (phase == "end")   par->endChangeGesture();
    }

    // don't echo the user's own drag back at them
    auto it = paramIndex.find(id);
    if (it != paramIndex.end())
        dirty[(size_t) it->second]->store(false, std::memory_order_relaxed);
}
