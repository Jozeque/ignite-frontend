#include "PluginEditor.h"
#include "BinaryData.h"

static std::optional<juce::WebBrowserComponent::Resource> makeResource(const char* data, int size, const char* mime)
{
    std::vector<std::byte> bytes((size_t) size);
    std::memcpy(bytes.data(), data, (size_t) size);
    return juce::WebBrowserComponent::Resource { std::move(bytes), juce::String(mime) };
}

TendrilEditor::TendrilEditor(TendrilProcessor& p)
    : juce::AudioProcessorEditor(p), proc(p)
{
    // ---- param registry (id list + dirty flags) ----
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

    // ---- web view ----
    auto userData = juce::File::getSpecialLocation(juce::File::tempDirectory)
                        .getChildFile("TendrilWebView2");
    userData.createDirectory();

    auto options = juce::WebBrowserComponent::Options{}
        .withBackend(juce::WebBrowserComponent::Options::Backend::webview2)
        .withWinWebView2Options(juce::WebBrowserComponent::Options::WinWebView2{}
                                    .withUserDataFolder(userData))
        .withNativeIntegrationEnabled()
        .withResourceProvider([](const juce::String& url)
            -> std::optional<juce::WebBrowserComponent::Resource>
        {
            // single-page app: serve the UI for every request except icons,
            // regardless of how the host/WebView formats the path
            if (url.containsIgnoreCase("favicon"))
                return std::nullopt;
            return makeResource(BinaryData::tendril_webui_html,
                                BinaryData::tendril_webui_htmlSize, "text/html");
        })
        .withEventListener("uiReady", [this](juce::var) { pushInit(); })
        .withEventListener("paramChanged", [this](juce::var v) { handleParamChanged(v); })
        .withEventListener("routingChanged", [this](juce::var v) { handleRoutingChanged(v); })
        .withEventListener("paint", [this](juce::var v)
        {
            proc.spectrum.paintPartial((int) v.getProperty("k", 0),
                                       (float)(double) v.getProperty("v", 0.0));
        })
        .withEventListener("scene", [this](juce::var v)
        {
            const auto op = v.getProperty("op", "select").toString();
            const int  i  = (int) v.getProperty("i", 0);
            if (op == "select")    proc.spectrum.selectScene(i);
            else if (op == "copy") proc.spectrum.copySceneTo(i);
        })
        .withEventListener("gesture", [this](juce::var v)
        {
            const auto op = v.getProperty("op", "").toString();
            const bool on = (bool) v.getProperty("on", false);
            if (op == "rec")   proc.spectrum.setGestureRecord(on);
            if (op == "play")  proc.spectrum.setGesturePlay(on);
            if (op == "clear") proc.spectrum.clearGesture();
        })
        .withEventListener("modToggle", [this](juce::var v)
        {
            proc.setModArm(v.getProperty("id", "").toString(), (bool) v.getProperty("on", false));
        })
        .withEventListener("motionMutate", [this](juce::var) { proc.mutateMotion(); });

    web = std::make_unique<juce::WebBrowserComponent>(options);
    addAndMakeVisible(*web);
    // cache-bust per LAUNCH (runtime value): the WebView2 profile persists on disk and
    // an incremental build may not recompile this file, so a build-time token can go stale
    // and serve an old UI. A unique-per-launch query forces a fresh load of the embedded HTML.
    web->goToURL(juce::WebBrowserComponent::getResourceProviderRoot()
                 + "index.html?v=" + juce::String(juce::Time::currentTimeMillis()));

    setResizable(true, true);
    setResizeLimits(900, 540, 2200, 1400);
    setSize(1120, 660);
    startTimerHz(30);
}

TendrilEditor::~TendrilEditor()
{
    stopTimer();
    for (const auto& id : paramIDs)
        proc.apvts.removeParameterListener(id, this);
}

void TendrilEditor::paint(juce::Graphics& g)
{
    g.fillAll(juce::Colour(0xff141310));   // Patchbay charcoal behind the view
}

void TendrilEditor::resized()
{
    if (web)      web->setBounds(getLocalBounds());
    if (fallback) fallback->setBounds(getLocalBounds());
}

// ---- C++ -> page ----------------------------------------------------------
void TendrilEditor::parameterChanged(const juce::String& parameterID, float)
{
    auto it = paramIndex.find(parameterID);
    if (it != paramIndex.end())
        dirty[(size_t) it->second]->store(true, std::memory_order_relaxed);
}

void TendrilEditor::timerCallback()
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

    // ---- spectrum push (paint canvas live view, ~15 Hz) ----
    if (++specDiv >= 2)
    {
        specDiv = 0;
        float sceneV[SpectrumEngine::NP], masterV[SpectrumEngine::NP];
        proc.spectrum.getSceneSnapshot(sceneV);
        proc.spectrum.getMasterSnapshot(masterV);

        juce::Array<juce::var> sArr, mArr;
        for (int k = 0; k < SpectrumEngine::NP; ++k)
        {
            sArr.add((double) sceneV[k]);
            mArr.add((double) masterV[k]);
        }
        auto* sp = new juce::DynamicObject();
        sp->setProperty("scene", juce::var(sArr));
        sp->setProperty("master", juce::var(mArr));
        sp->setProperty("active", proc.spectrum.getActiveScene());
        sp->setProperty("rec",  proc.spectrum.isGestureRecording());
        sp->setProperty("play", proc.spectrum.isGesturePlaying());
        sp->setProperty("frames", proc.spectrum.gestureFrames());
        sp->setProperty("centroid", (double) proc.spectrum.centroid());
        web->emitEventIfBrowserIsVisible("spectrum", juce::var(sp));
    }

    // ---- modulation viz (Serum-style): live modulated value + range per armed param ----
    // base pointer stays where the user set it; the page draws a range arc (lo..hi) and a
    // moving dot (current modulated value), all normalised through the param's own skew so
    // the angles line up with the knob.
    const bool motionOn = proc.modEngine.isOn();
    if (motionOn || modWasOn)
    {
        juce::Array<juce::var> items;
        if (motionOn)
        {
            auto* dp = proc.apvts.getRawParameterValue("motion_depth");
            const float depth = dp ? dp->load() : 0.5f;
            for (const auto& id : paramIDs)
            {
                if (! proc.getModArm(id)) continue;
                const int idx = proc.modHub.indexOf(id);
                auto* rp = proc.apvts.getParameter(id);
                if (idx < 0 || rp == nullptr) continue;

                const float mn = proc.modHub.minOf(idx), mx = proc.modHub.maxOf(idx);
                const float span = mx - mn;
                const float base = proc.modHub.baseValue(idx);   // the user's knob value (real)
                const float cur  = proc.modHub.effValue(idx);    // live modulated value (real)
                // curve table is normalised to [0.03, 0.97]; modulation blends base -> curve by depth
                const float loR  = base * (1.0f - depth) + (mn + 0.03f * span) * depth;
                const float hiR  = base * (1.0f - depth) + (mn + 0.97f * span) * depth;

                auto* o = new juce::DynamicObject();
                o->setProperty("id", id);
                o->setProperty("v",  (double) rp->convertTo0to1(cur));
                o->setProperty("lo", (double) rp->convertTo0to1(loR));
                o->setProperty("hi", (double) rp->convertTo0to1(hiR));
                items.add(juce::var(o));
            }
        }
        auto* mv = new juce::DynamicObject();
        mv->setProperty("on", motionOn);
        mv->setProperty("m", juce::var(items));
        web->emitEventIfBrowserIsVisible("modviz", juce::var(mv));
    }
    modWasOn = motionOn;
}

juce::var TendrilEditor::collectAllParams() const
{
    auto* obj = new juce::DynamicObject();
    for (const auto& id : paramIDs)
        if (auto* par = proc.apvts.getParameter(id))
            obj->setProperty(id, (double) par->getValue());
    return juce::var(obj);
}

void TendrilEditor::pushInit()
{
    if (web == nullptr) return;
    auto* obj = new juce::DynamicObject();
    obj->setProperty("params", collectAllParams());
    obj->setProperty("routing", proc.getRoutingJson());

    juce::Array<juce::var> armed;
    for (const auto& id : paramIDs)
        if (proc.getModArm(id)) armed.add(id);
    obj->setProperty("armed", juce::var(armed));

    web->emitEventIfBrowserIsVisible("init", juce::var(obj));
}

// ---- page -> C++ ----------------------------------------------------------
void TendrilEditor::handleParamChanged(const juce::var& payload)
{
    const auto id    = payload.getProperty("id", {}).toString();
    const float val  = (float) (double) payload.getProperty("value", 0.0);
    const auto phase = payload.getProperty("phase", "move").toString();

    auto* par = proc.apvts.getParameter(id);
    if (par == nullptr) return;

    if (phase == "begin") par->beginChangeGesture();
    par->setValueNotifyingHost(juce::jlimit(0.0f, 1.0f, val));
    if (phase == "end")   par->endChangeGesture();

    // don't echo the user's own drag back at them
    auto it = paramIndex.find(id);
    if (it != paramIndex.end())
        dirty[(size_t) it->second]->store(false, std::memory_order_relaxed);
}

void TendrilEditor::handleRoutingChanged(const juce::var& payload)
{
    proc.applyRoutingVar(payload);
}
