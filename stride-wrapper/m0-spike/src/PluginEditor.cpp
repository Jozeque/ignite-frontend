#include "PluginEditor.h"
#include "BinaryData.h"
#include "License.h"
#include "MacKeyForward.h"

#include <optional>
#include <vector>
#include <cstring>

#if JUCE_WINDOWS
 #ifndef NOMINMAX
  #define NOMINMAX 1
 #endif
 #ifndef WIN32_LEAN_AND_MEAN
  #define WIN32_LEAN_AND_MEAN 1
 #endif
 #include <windows.h>
#endif

using Resource = juce::WebBrowserComponent::Resource;

static std::optional<Resource> makeResource (const char* data, int size, const char* mime)
{
    std::vector<std::byte> bytes ((size_t) size);
    std::memcpy (bytes.data(), data, (size_t) size);
    return Resource { std::move (bytes), juce::String (mime) };
}

// Serve the bundled UI files by ORIGINAL filename (looked up in BinaryData, so we don't
// hand-mangle symbol names). The page loads from the resource-provider root, so every
// <script src="x.js"> resolves to a request we answer here.
static std::optional<Resource> serveAsset (const juce::String& url)
{
    auto file = url.fromLastOccurrenceOf ("/", false, false)   // strip path
                   .upToFirstOccurrenceOf ("?", false, false);  // strip ?v= cache-bust
    if (file.isEmpty()) file = "index.html";

    const char* mime = file.endsWithIgnoreCase (".html")  ? "text/html"
                     : file.endsWithIgnoreCase (".js")    ? "application/javascript"
                     : file.endsWithIgnoreCase (".css")   ? "text/css"
                     : file.endsWithIgnoreCase (".ttf")   ? "font/ttf"
                     : file.endsWithIgnoreCase (".woff2") ? "font/woff2"
                                                          : "application/octet-stream";

    for (int i = 0; i < BinaryData::namedResourceListSize; ++i)
    {
        if (file.equalsIgnoreCase (BinaryData::originalFilenames[i]))
        {
            int size = 0;
            if (const char* data = BinaryData::getNamedResource (BinaryData::namedResourceList[i], size))
                return makeResource (data, size, mime);
        }
    }
    return std::nullopt;   // favicon / anything unbundled -> 404 (harmless)
}

// ── Transport-key forwarding (Windows) ──────────────────────────────────────
// A hosted synth lives in OUR window, outside Ableton's keyboard handling, so
// Space / Return never reach the transport (you'd have to click the DAW first).
// A thread-local WH_GETMESSAGE hook on the GUI thread catches those keys when
// they target one of our synth windows and forwards them to the DAW's main
// window — so a hosted synth plays / stops like a native plugin window.
#if JUCE_WINDOWS
namespace {
    HHOOK g_strideKeyHook = nullptr;
    std::vector<StrideWrapperEditor*> g_strideKeyOwners;

    LRESULT CALLBACK strideKeyHookProc (int code, WPARAM wParam, LPARAM lParam)
    {
        if (code == HC_ACTION && wParam == PM_REMOVE)
        {
            auto* msg = reinterpret_cast<MSG*> (lParam);
            if (msg != nullptr
                 && (msg->message == WM_KEYDOWN || msg->message == WM_KEYUP
                      || msg->message == WM_SYSKEYDOWN || msg->message == WM_SYSKEYUP)
                 && (msg->wParam == VK_SPACE || msg->wParam == VK_RETURN))
            {
                for (auto* ed : g_strideKeyOwners)
                {
                    if (ed != nullptr && ed->ownsNativeWindow ((void*) msg->hwnd))
                    {
                        if (auto* host = (HWND) ed->hostMainWindow())
                        {
                            ::PostMessage (host, msg->message, msg->wParam, msg->lParam);
                            msg->message = WM_NULL;   // swallow so the synth doesn't double-handle the key
                            msg->hwnd = nullptr;
                        }
                        break;
                    }
                }
            }
        }
        return ::CallNextHookEx (g_strideKeyHook, code, wParam, lParam);
    }
}
#endif

struct StrideWrapperEditor::HostedWindow : public juce::DocumentWindow
{
    HostedWindow (const juce::String& title, juce::AudioProcessorEditor* editor)
        : juce::DocumentWindow (title.isNotEmpty() ? title : juce::String ("Hosted Device"), juce::Colours::black,
                                juce::DocumentWindow::minimiseButton | juce::DocumentWindow::maximiseButton | juce::DocumentWindow::closeButton)
    {
        setUsingNativeTitleBar (true);
        setContentOwned (editor, true);   // OWN it: deleted when the window dies, so reopening builds a fresh editor (not a stale leaked one)
        setResizable (editor->isResizable(), false);
        centreWithSize (juce::jmax (240, editor->getWidth()),
                        juce::jmax (160, editor->getHeight()));
        setAlwaysOnTop (true);   // float above Stride so the synth stays visible while you Map / draw
        setVisible (true);
    }
    // X = hide (keep the instance + its state alive); "Synth UI" restores it with its patch.
    void closeButtonPressed() override { setVisible (false); }
    // Minimize must beat always-on-top, or the OS can't park the window in the taskbar.
    void minimiseButtonPressed() override { setAlwaysOnTop (false); setMinimised (true); }
    // Returning from the taskbar (or any re-focus) re-floats it above Stride.
    void broughtToFront() override
    {
        juce::DocumentWindow::broughtToFront();
        if (! isAlwaysOnTop() && ! isMinimised()) setAlwaysOnTop (true);
    }
    JUCE_DECLARE_NON_COPYABLE_WITH_LEAK_DETECTOR (HostedWindow)
};

StrideWrapperEditor::StrideWrapperEditor (StrideWrapperProcessor& p)
    : juce::AudioProcessorEditor (&p), proc (p)
{
    auto userData = juce::File::getSpecialLocation (juce::File::tempDirectory)
                        .getChildFile ("StrideWrapperWebView2");
    userData.createDirectory();

    auto options = juce::WebBrowserComponent::Options{}
        .withBackend (juce::WebBrowserComponent::Options::Backend::webview2)
        .withWinWebView2Options (juce::WebBrowserComponent::Options::WinWebView2{}
                                     .withUserDataFolder (userData))
        .withNativeIntegrationEnabled()
        .withResourceProvider ([] (const juce::String& url) { return serveAsset (url); })
        .withEventListener ("wrapperReady", [this] (juce::var)     { web->emitEventIfBrowserIsVisible ("sl_event", []{ auto* o = new juce::DynamicObject(); o->setProperty ("type", "connected"); return juce::var (o); }()); pushRackScanned(); pushLearnState(); pushChainDevices(); })
        .withEventListener ("sl_send",      [this] (juce::var v)   { handleStrideLinkSend (v); })
        .withEventListener ("loadSynth",    [this] (juce::var)     { chooseAndLoad(); })
        .withEventListener ("loadSynthPath",[this] (juce::var v)   { proc.loadPlugin (juce::File (v.getProperty ("path", "").toString())); })
        .withEventListener ("browsePlugins",[this] (juce::var)     { scanPluginsToWeb(); })
        .withEventListener ("openSynth",    [this] (juce::var)     { toggleSynthWindow(); })
        .withEventListener ("openSynthOne", [this] (juce::var v)   { openOneSynthWindow ((int) v.getProperty ("i", -1)); })
        .withEventListener ("clearChain",   [this] (juce::var)     { synthWindows.clear(); proc.clearChain(); pushRackScanned(); pushChainDevices(); })
        .withEventListener ("removeDevice", [this] (juce::var v)   { synthWindows.clear(); proc.removeNode ((int) v.getProperty ("i", -1)); pushRackScanned(); pushChainDevices(); })
        .withEventListener ("setBypass",    [this] (juce::var v)   { proc.setNodeBypassed ((int) v.getProperty ("i", -1), ! (bool) v.getProperty ("on", true)); pushChainDevices(); })
        .withEventListener ("license",      [this] (juce::var v)   { handleLicense (v); })
        .withEventListener ("undoRemove",   [this] (juce::var)     { synthWindows.clear(); proc.undoRemove(); })
        .withEventListener ("toggleLearn",  [this] (juce::var)     { proc.setLearnMode (! proc.isLearning()); pushLearnState(); });

    web = std::make_unique<juce::WebBrowserComponent> (options);
    addAndMakeVisible (*web);
    web->goToURL (juce::WebBrowserComponent::getResourceProviderRoot()
                  + "index.html?v=" + juce::String (juce::Time::currentTimeMillis()));

    setResizable (true, true);
    setResizeLimits (380, 280, 2200, 1400);
    setSize (680, 480);   // compact-device sized (the wrapper opens in compact mode)
    startTimerHz (10);
   #if JUCE_WINDOWS
    installKeyHook();     // forward Space/Return from hosted synth windows to the DAW transport
   #endif
   #if JUCE_MAC
    strideMacKeyForward_install();   // same, via an NSEvent monitor
   #endif
}

StrideWrapperEditor::~StrideWrapperEditor()
{
   #if JUCE_WINDOWS
    removeKeyHook();
   #endif
   #if JUCE_MAC
    strideMacKeyForward_remove();
   #endif
    stopTimer();
    synthWindows.clear();
}

#if JUCE_WINDOWS
// Walk the focused HWND up its parent chain; true if it sits inside one of our
// hosted synth windows (so the transport-key hook only fires for those).
bool StrideWrapperEditor::ownsNativeWindow (void* hwndPtr) const
{
    auto target = (HWND) hwndPtr;
    for (auto& w : synthWindows)
        if (w != nullptr)
            if (auto* peer = w->getPeer())
            {
                auto sw = (HWND) peer->getNativeHandle();
                for (HWND cur = target; cur != nullptr; cur = ::GetParent (cur))
                    if (cur == sw) return true;
            }
    return false;
}

// The DAW's top-level window (root owner of our plugin editor's window).
void* StrideWrapperEditor::hostMainWindow() const
{
    if (auto* peer = getPeer())
    {
        auto me = (HWND) peer->getNativeHandle();
        if (auto root = ::GetAncestor (me, GA_ROOTOWNER)) return (void*) root;
        return (void*) ::GetAncestor (me, GA_ROOT);
    }
    return nullptr;
}

void StrideWrapperEditor::installKeyHook()
{
    g_strideKeyOwners.push_back (this);
    if (g_strideKeyHook == nullptr)
        g_strideKeyHook = ::SetWindowsHookEx (WH_GETMESSAGE, strideKeyHookProc, nullptr, ::GetCurrentThreadId());
}

void StrideWrapperEditor::removeKeyHook()
{
    for (size_t i = 0; i < g_strideKeyOwners.size(); ++i)
        if (g_strideKeyOwners[i] == this) { g_strideKeyOwners.erase (g_strideKeyOwners.begin() + (long) i); break; }
    if (g_strideKeyOwners.empty() && g_strideKeyHook != nullptr)
    {
        ::UnhookWindowsHookEx (g_strideKeyHook);
        g_strideKeyHook = nullptr;
    }
}
#endif

void StrideWrapperEditor::paint (juce::Graphics& g) { g.fillAll (juce::Colour (0xff09090b)); }

void StrideWrapperEditor::resized() { if (web) web->setBounds (getLocalBounds()); }

void StrideWrapperEditor::chooseAndLoad()
{
    chooser = std::make_unique<juce::FileChooser> ("Select VST3 synth(s) - pick one or many", juce::File(), "*.vst3");
    const auto chooserFlags = juce::FileBrowserComponent::openMode
                            | juce::FileBrowserComponent::canSelectFiles
                            | juce::FileBrowserComponent::canSelectDirectories
                            | juce::FileBrowserComponent::canSelectMultipleItems;   // add several favorites at once
    chooser->launchAsync (chooserFlags, [this] (const juce::FileChooser& fc)
    {
        auto results = fc.getResults();
        if (results.isEmpty()) return;

        // Remember everything picked as a favorite (the shim persists them client-side).
        juce::Array<juce::var> paths;
        for (const auto& f : results) paths.add (f.getFullPathName());
        auto* o = new juce::DynamicObject();
        o->setProperty ("paths", juce::var (paths));
        web->emitEventIfBrowserIsVisible ("favoritesPicked", juce::var (o));

        proc.loadPlugin (results[0]);   // load the first now
    });
}

// Open a window for any chain node that doesn't have one yet (keeps existing windows).
void StrideWrapperEditor::openMissingSynthWindows()
{
    const int n = proc.numHosted();
    const auto names = proc.getChainNames();
    while ((int) synthWindows.size() < n) synthWindows.push_back (nullptr);   // grow, aligned to the chain
    for (int i = 0; i < n; ++i)
        if (synthWindows[(size_t) i] == nullptr)
            if (auto* ed = proc.getHostedEditor (i))
            {
                auto w = std::make_unique<HostedWindow> (i < names.size() ? names[i] : juce::String(), ed);
                w->setTopLeftPosition (90 + i * 40, 90 + i * 40);   // stack / cascade
                synthWindows[(size_t) i] = std::move (w);
               #if JUCE_MAC
                if (auto* pr = synthWindows[(size_t) i]->getPeer()) strideMacKeyForward_tagWindow (pr->getNativeHandle());
               #endif
            }
}

void StrideWrapperEditor::toggleSynthWindow()
{
    // "Synth UI" = ensure every device has a window and RAISE them all (rescues any that
    // got minimized or buried). We never auto-hide — devices stay stacked.
    openMissingSynthWindows();
    for (auto& w : synthWindows)
        if (w) { w->setVisible (true); w->setMinimised (false); w->toFront (false); }
}

// Open / raise JUST ONE device's window (the per-chip ⛶) — for picking a single
// plugin out of a long chain, without forcing all the others open.
void StrideWrapperEditor::openOneSynthWindow (int i)
{
    const int n = proc.numHosted();
    if (i < 0 || i >= n) return;
    while ((int) synthWindows.size() < n) synthWindows.push_back (nullptr);   // pad; leave the others as-is
    if (synthWindows[(size_t) i] == nullptr)
        if (auto* ed = proc.getHostedEditor (i))
        {
            const auto names = proc.getChainNames();
            auto w = std::make_unique<HostedWindow> (i < names.size() ? names[i] : juce::String(), ed);
            w->setTopLeftPosition (90 + i * 40, 90 + i * 40);
            synthWindows[(size_t) i] = std::move (w);
           #if JUCE_MAC
            if (auto* pr = synthWindows[(size_t) i]->getPeer()) strideMacKeyForward_tagWindow (pr->getNativeHandle());
           #endif
        }
    if (synthWindows[(size_t) i]) { synthWindows[(size_t) i]->setVisible (true); synthWindows[(size_t) i]->setMinimised (false); synthWindows[(size_t) i]->toFront (true); }
}

void StrideWrapperEditor::handleStrideLinkSend (const juce::var& msg)
{
    const auto type = msg.getProperty ("type", {}).toString();

    if (type == "request_scan" || type == "request_scan_mapped")
    {
        pushRackScanned();
        return;
    }

    // The drawn curves drive the hosted synth. Three sources, same effect:
    //   "live_curves"     — every canvas edit (saveCanvasState hook): drive AS you draw
    //   "apply_inject"    — the "Inject to Clip" button
    //   "apply_automation"— the .alc apply button
    const bool isApply = (type == "apply_inject" || type == "apply_automation");
    const bool isLive  = (type == "live_curves");
    if (isApply || isLive)
    {
        std::vector<StrideWrapperProcessor::DriveLane> lanes;
        if (auto* arr = msg.getProperty ("parameters", juce::var()).getArray())
            for (const auto& pv : *arr)
            {
                StrideWrapperProcessor::DriveLane lane;
                lane.position = (int) pv.getProperty ("id", -1);
                if (lane.position < 0)
                    lane.position = pv.getProperty ("_path", "").toString()
                                      .fromFirstOccurrenceOf ("wrap:", false, false).getIntValue();

                if (auto* pts = pv.getProperty ("points", juce::var()).getArray())
                    for (const auto& ptv : *pts)
                    {
                        lane.times.push_back  ((float) (double) ptv.getProperty ("time",  0.0));
                        lane.values.push_back ((float) (double) ptv.getProperty ("value", 0.0));
                        lane.curves.push_back ((float) (double) ptv.getProperty ("curve", 0.0));
                    }
                if (! lane.times.empty())
                    lanes.push_back (std::move (lane));
            }

        // Bar count → loop length. Apply always carries it; live edits now carry it
        // too, so the Bars pills retune the host loop immediately. 0 = keep last.
        double clipBeats = 0.0;
        if (isApply) clipBeats = (double) msg.getProperty ("clip_bars", 4) * 4.0;
        else { const int lb = (int) msg.getProperty ("clip_bars", 0); if (lb > 0) clipBeats = (double) lb * 4.0; }
        proc.setDriveCurves (lanes, clipBeats);

        if (isApply)   // tell the canvas Inject worked → cancels the StrideInject timeout
        {
            auto* ok = new juce::DynamicObject();
            ok->setProperty ("type", "inject_success");
            ok->setProperty ("params_written", (int) lanes.size());
            ok->setProperty ("points_written", 0);
            ok->setProperty ("mode", "wrapper");
            web->emitEventIfBrowserIsVisible ("sl_event", juce::var (ok));

            auto* ok2 = new juce::DynamicObject();
            ok2->setProperty ("type", "apply_success");
            ok2->setProperty ("params_written", (int) lanes.size());
            web->emitEventIfBrowserIsVisible ("sl_event", juce::var (ok2));
        }
        return;
    }

    // preview_param / stop_preview / others: ignored in the wrapper.
}

void StrideWrapperEditor::pushRackScanned()
{
    if (web == nullptr) return;

    juce::Array<juce::var> params;
    const auto names = proc.getMappedParamNames();
    for (int i = 0; i < names.size(); ++i)
    {
        auto* o = new juce::DynamicObject();
        o->setProperty ("id", i);
        const auto _full = names[i];                       // "Device: Param"
        const int _sep = _full.indexOfChar (':');
        o->setProperty ("device", _sep > 0 ? _full.substring (0, _sep).trim() : juce::String());
        o->setProperty ("name",   _sep > 0 ? _full.substring (_sep + 1).trim() : _full);
        o->setProperty ("min", 0.0);
        o->setProperty ("max", 1.0);
        o->setProperty ("_path", "wrap:" + juce::String (i));   // stable enough for v1
        o->setProperty ("is_log", false);
        params.add (juce::var (o));
    }

    auto* msg = new juce::DynamicObject();
    msg->setProperty ("type", "rack_scanned");
    msg->setProperty ("parameters", juce::var (params));
    const auto summary = proc.getChainSummary();
    msg->setProperty ("device_name", summary.isNotEmpty() ? summary : juce::String ("No synth"));
    msg->setProperty ("track_name", "Stride");
    msg->setProperty ("clip_bars", 4);
    msg->setProperty ("has_clip", true);
    web->emitEventIfBrowserIsVisible ("sl_event", juce::var (msg));
}

void StrideWrapperEditor::pushLearnState()
{
    if (web == nullptr) return;
    auto* o = new juce::DynamicObject();
    o->setProperty ("on", proc.isLearning());
    web->emitEventIfBrowserIsVisible ("learnState", juce::var (o));
}

void StrideWrapperEditor::pushChainDevices()
{
    if (web == nullptr) return;
    juce::Array<juce::var> names;
    for (const auto& n : proc.getChainNames()) names.add (n);
    juce::Array<juce::var> byp;
    for (bool b : proc.getChainBypassed()) byp.add (b);
    auto* o = new juce::DynamicObject();
    o->setProperty ("names", juce::var (names));
    o->setProperty ("bypassed", juce::var (byp));
    web->emitEventIfBrowserIsVisible ("chainDevices", juce::var (o));
}

// License gate bridge — load/save read+write the SHARED license.json (so an
// already-activated desktop user is auto-unlocked); validate hits the built-in
// keys then the Lemon Squeezy proxy. SafePointer guards the async validate reply.
void StrideWrapperEditor::handleLicense (const juce::var& msg)
{
    const int reqId = (int) msg.getProperty ("reqId", -1);
    const auto op = msg.getProperty ("op", "").toString();

    juce::Component::SafePointer<StrideWrapperEditor> safe (this);
    auto reply = [safe, reqId] (juce::var result)
    {
        if (auto* self = safe.getComponent())
            if (self->web != nullptr)
            {
                auto* o = new juce::DynamicObject();
                o->setProperty ("reqId", reqId);
                o->setProperty ("result", result);
                self->web->emitEventIfBrowserIsVisible ("licenseReply", juce::var (o));
            }
    };

    if (op == "load")          reply (stride_license::load());
    else if (op == "save")     reply (stride_license::save (msg.getProperty ("license", juce::var())));
    else if (op == "validate") stride_license::validate (msg.getProperty ("key", "").toString(), reply);
    else                       reply (juce::var());
}

// Scan the standard VST3 locations (top level + one vendor-folder deep, not into bundles)
// and hand the list to the WebView's Stride-styled plugin browser.
void StrideWrapperEditor::scanPluginsToWeb()
{
    if (web == nullptr) return;

    juce::VST3PluginFormat fmt;
    auto search = fmt.getDefaultLocationsToSearch();

    juce::Array<juce::File> hits;
    for (int i = 0; i < search.getNumPaths(); ++i)
    {
        auto root = search[i];
        if (! root.isDirectory()) continue;
        root.findChildFiles (hits, juce::File::findFilesAndDirectories, false, "*.vst3");   // top-level plugins
        juce::Array<juce::File> subs;
        root.findChildFiles (subs, juce::File::findDirectories, false, "*");                 // vendor sub-folders
        for (const auto& s : subs)
            if (! s.getFileName().endsWithIgnoreCase (".vst3"))
                s.findChildFiles (hits, juce::File::findFilesAndDirectories, false, "*.vst3");
    }

    juce::Array<juce::var> list;
    juce::StringArray seen;
    for (const auto& f : hits)
    {
        const auto name = f.getFileNameWithoutExtension();
        if (seen.contains (name)) continue;   // dedup (system vs per-user folder)
        seen.add (name);
        auto* o = new juce::DynamicObject();
        o->setProperty ("name", name);
        o->setProperty ("path", f.getFullPathName());
        list.add (juce::var (o));
    }

    auto* msg = new juce::DynamicObject();
    msg->setProperty ("plugins", juce::var (list));
    web->emitEventIfBrowserIsVisible ("pluginList", juce::var (msg));
}

void StrideWrapperEditor::timerCallback()
{
    if (web == nullptr) return;

    const auto summary = proc.getChainSummary();
    if (summary != lastSummary)
    {
        lastSummary = summary;
        const int n = proc.numHosted();
        if (n == 0) synthWindows.clear();                                                              // chain cleared
        else if (n < (int) synthWindows.size()) { synthWindows.clear(); openMissingSynthWindows(); }  // device removed -> rebuild remaining
        else openMissingSynthWindows();                                                                // device added -> keep existing
        pushRackScanned();
        pushChainDevices();
    }

    const int v = proc.mappingVersion();
    if (v != lastMapVersion)
    {
        lastMapVersion = v;
        pushRackScanned();
        pushLearnState();
    }

    // Reflect EVERY learn-mode change on the Map button — including the auto-leave
    // that fires when a moving curve is applied (which doesn't bump mapVersion).
    const bool learning = proc.isLearning();
    if (learning != lastLearn)
    {
        lastLearn = learning;
        pushLearnState();
    }
}
