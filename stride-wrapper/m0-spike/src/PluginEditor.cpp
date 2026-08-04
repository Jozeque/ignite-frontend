#include "PluginEditor.h"
#include "BinaryData.h"
#include "License.h"
#include "MacKeyForward.h"

#include <cmath>
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

// Global (cross-project) editor-size memory, stored beside the license so Stride
// reopens at whatever size the user left it — a big/"fullscreen" window stays big
// instead of snapping back to the compact default.
static juce::File strideWrapperWindowFile()
{
    return stride_license::dataDir().getChildFile ("wrapper-window.json");
}

// USER DATA (favorites, future prefs) — the native SOURCE OF TRUTH, beside the license.
// The WebView's localStorage is only a cache: a Chromium profile reset ate a user's
// favorites for real (2026-07-16), so every change writes through to this file and boot
// re-seeds whichever side still has the data. Shared across DAWs (and Mac hosts).
static juce::File strideWrapperPrefsFile()
{
    return stride_license::dataDir().getChildFile ("wrapper-prefs.json");
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

// ── Transport + note-key forwarding (Windows) ───────────────────────────────
// A hosted synth lives in OUR window, outside Ableton's keyboard handling, so
// Space / Return never reach the transport — and with keyboard mode ON, the
// computer-MIDI note keys go equally dead. A thread-local WH_GETMESSAGE hook on
// the GUI thread catches those keys when they target one of our synth windows
// and forwards them to the DAW's main window, so a hosted synth plays / stops /
// notes like a native plugin window. Transport keys are swallowed after the
// forward (the synth must not double-handle them); note keys pass through
// (Ableton only) so the synth's own UI — preset search boxes — keeps them too.
#if JUCE_WINDOWS
namespace {
    HHOOK g_strideKeyHook = nullptr;
    std::vector<StrideWrapperEditor*> g_strideKeyOwners;

    // Windows note forwarding. ON: PostMessage'ing the letters to the DAW's main window
    // DOES play — confirmed in the field, from a hosted synth window and from Stride's
    // own WebView.
    //
    // KNOWN OPEN BUG (2026-07-25): after certain focus transitions between the hosted
    // synth window, Stride and Live, the very same forward starts landing on Live's
    // single-key SHORTCUTS instead (the control bar visibly lights up) and STAYS there.
    // Sticky, like the macOS main-window theft this file's Mac counterpart fixes — so the
    // suspect is the same shape: a host-side "which of my windows is active" gate that our
    // unowned, always-on-top hosted synth window disturbs. Root cause not yet identified;
    // needs a minimal repro before anything is changed here.
    //
    // Do NOT "fix" this by switching the flag off. That was tried (and reverted the same
    // day): it removes working functionality and leaves note keys inert everywhere on
    // Windows, which is worse than a bug that only appears after a focus dance.
    //
    // macOS never uses this path — the NSEvent monitor intercepts note keys natively,
    // ahead of the WebView (see MacKeyForward.mm).
    //
    // Deliberately NOT constexpr: it reads as the runtime switch it is, can be flipped in
    // a debugger while chasing the repro, and keeps MSVC from warning about a constant
    // condition (C4127) at both use sites.
    bool g_strideWinNoteForward = true;

    // Ableton only: posting bare letters into other DAWs would fire their single-key
    // ACTIONS (Reaper/FL bind half the alphabet) with no keyboard mode to serve.
    bool strideHostIsAbletonLive()
    {
        static const bool isLive = juce::PluginHostType().isAbletonLive();
        return isLive;
    }

    // The VKs of Live's computer-MIDI keyboard: A-row notes + Z/X octave + C/V velocity.
    bool strideIsNoteVk (WPARAM vk)
    {
        switch (vk)
        {
            case 'A': case 'W': case 'S': case 'E': case 'D': case 'F': case 'T': case 'G':
            case 'Y': case 'H': case 'U': case 'J': case 'K': case 'L':
            case 'Z': case 'X': case 'C': case 'V': return true;
            default:                                return false;
        }
    }

    juce::uint32 g_strideNoteVksDown = 0;   // bit per letter we forwarded a DOWN for — its UP always forwards (else: stuck note in Live)

    LRESULT CALLBACK strideKeyHookProc (int code, WPARAM wParam, LPARAM lParam)
    {
        if (code == HC_ACTION && wParam == PM_REMOVE)
        {
            auto* msg = reinterpret_cast<MSG*> (lParam);
            if (msg != nullptr
                 && (msg->message == WM_KEYDOWN || msg->message == WM_KEYUP
                      || msg->message == WM_SYSKEYDOWN || msg->message == WM_SYSKEYUP))
            {
                const bool isDown      = (msg->message == WM_KEYDOWN || msg->message == WM_SYSKEYDOWN);
                const bool isTransport = (msg->wParam == VK_SPACE || msg->wParam == VK_RETURN);

                // Keyboard-mode notes from a hosted synth window. A DOWN forwards only
                // unmodified — Live reads the PHYSICAL modifier state when the re-post
                // arrives, so forwarding 'A' under a held Ctrl would land as Ctrl+A
                // (select-all). An UP we owe forwards regardless of what's held by then.
                bool isNote = false;
                if (g_strideWinNoteForward
                     && ! isTransport && strideIsNoteVk (msg->wParam) && strideHostIsAbletonLive())
                {
                    if (isDown)
                        isNote = ::GetKeyState (VK_CONTROL) >= 0 && ::GetKeyState (VK_MENU) >= 0
                              && ::GetKeyState (VK_SHIFT)   >= 0
                              && ::GetKeyState (VK_LWIN)    >= 0 && ::GetKeyState (VK_RWIN) >= 0;
                    else
                        isNote = (g_strideNoteVksDown & (1u << (msg->wParam - 'A'))) != 0;
                }

                if (isTransport || isNote)
                {
                    for (auto* ed : g_strideKeyOwners)
                    {
                        if (ed != nullptr && ed->ownsNativeWindow ((void*) msg->hwnd))
                        {
                            if (auto* host = (HWND) ed->hostMainWindow())
                            {
                                ::PostMessage (host, msg->message, msg->wParam, msg->lParam);
                                if (isTransport)
                                {
                                    msg->message = WM_NULL;   // swallow so the synth doesn't double-handle the key
                                    msg->hwnd = nullptr;
                                }
                                else
                                {
                                    // Note keys are NOT swallowed (the synth keeps its own
                                    // keys) — lParam went through verbatim, so Live filters
                                    // auto-repeats off the previous-state bit as usual.
                                    const auto bit = 1u << (msg->wParam - 'A');
                                    if (isDown) g_strideNoteVksDown |= bit;
                                    else        g_strideNoteVksDown &= ~bit;
                                }
                            }
                            break;
                        }
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
    // The WebView profile holds UI state in its localStorage, so it must NOT live in
    // %TEMP% where OS cleanup or a browser-profile reset can eat it (it did, 2026-07-16 —
    // wrapper-prefs.json is the real safety net for favorites; this keeps the rest stable).
    auto userData = stride_license::dataDir().getChildFile ("webview2");
    {
        const auto legacy = juce::File::getSpecialLocation (juce::File::tempDirectory)
                                .getChildFile ("StrideWrapperWebView2");
        if (! userData.exists() && legacy.isDirectory())
            if (! legacy.copyDirectoryTo (userData))   // one-time migration — usually clean (no instance running = profile unlocked)
            {
                // Partial copy (another instance still holds a lock?): HALF a Chromium profile
                // is worse than none — it reads as corruption and gets reset, which is exactly
                // the data loss this update exists to end. Discard it, run THIS session on the
                // legacy profile (byte-identical to the old behavior), retry next open.
                userData.deleteRecursively();
                userData = legacy;
            }
    }
    userData.createDirectory();

    auto options = juce::WebBrowserComponent::Options{}
        .withBackend (juce::WebBrowserComponent::Options::Backend::webview2)
        .withWinWebView2Options (juce::WebBrowserComponent::Options::WinWebView2{}
                                     .withUserDataFolder (userData))
        .withNativeIntegrationEnabled()
        .withResourceProvider ([] (const juce::String& url) { return serveAsset (url); })
        .withEventListener ("wrapperReady", [this] (juce::var)     { pushHostInfo(); pushPrefs(); web->emitEventIfBrowserIsVisible ("sl_event", []{ auto* o = new juce::DynamicObject(); o->setProperty ("type", "connected"); return juce::var (o); }()); pushRackScanned(); pushLearnState(); pushKeysState(); pushPinState(); pushChainDevices(); })
        .withEventListener ("prefsSave",    [this] (juce::var v)   { savePrefs (v.getProperty ("prefs", juce::var())); })
        .withEventListener ("saveChain",    [this] (juce::var)     { saveChainToFile(); })
        .withEventListener ("loadChain",    [this] (juce::var)     { loadChainFromFile(); })
        .withEventListener ("sl_send",      [this] (juce::var v)   { handleStrideLinkSend (v); })
        .withEventListener ("loadSynth",    [this] (juce::var)     { if (proc.isEditLocked()) return; chooseAndLoad(); })
        .withEventListener ("loadSynthPath",[this] (juce::var v)   { if (proc.isEditLocked()) return; proc.loadPlugin (juce::File (v.getProperty ("path", "").toString())); })
        .withEventListener ("browsePlugins",[this] (juce::var)     { if (proc.isEditLocked()) return; scanPluginsToWeb(); })
        .withEventListener ("openSynth",    [this] (juce::var)     { toggleSynthWindow(); })
        .withEventListener ("openSynthOne", [this] (juce::var v)   { openOneSynthWindow ((int) v.getProperty ("i", -1)); })
        .withEventListener ("transportKey", [this] (juce::var v)   { forwardTransportKey (v.getProperty ("key", "space").toString()); })
        .withEventListener ("musicKey",     [this] (juce::var v)   { forwardMusicKey (v.getProperty ("key", "").toString(), (bool) v.getProperty ("down", false)); })
        .withEventListener ("textFocus",    [this] (juce::var v)   {
            // A text field in the page took/lost focus. macOS intercepts note keys ahead of
            // the WebView, so it has to stand down while the user is typing a license key,
            // a plugin search or a BPM — otherwise those letters would play notes instead
            // of landing in the field.
            juce::ignoreUnused (v);
           #if JUCE_MAC
            strideMacKeyForward_setTextFocus ((bool) v.getProperty ("on", false));
           #endif
        })
        .withEventListener ("clearChain",   [this] (juce::var)     { if (proc.isEditLocked()) return; synthWindows.clear(); proc.clearChain(); pushRackScanned(); pushChainDevices(); })
        .withEventListener ("removeDevice", [this] (juce::var v)   { if (proc.isEditLocked()) return; const int i = (int) v.getProperty ("i", -1); if (i >= 0 && i < (int) synthWindows.size()) synthWindows.erase (synthWindows.begin() + i); proc.removeNode (i); pushRackScanned(); pushChainDevices(); })   // close ONLY the removed device's window; keep the rest as-is (was: clear all -> timer reopened them all)
        .withEventListener ("moveDevice",   [this] (juce::var v)   {
            if (proc.isEditLocked()) return;
            const int from = (int) v.getProperty ("from", -1), to = (int) v.getProperty ("to", -1);
            if (from >= 0 && to >= 0 && from != to)
            {
                const int need = juce::jmax (from, to) + 1;   // pad so both indices are valid, then move the window with its device
                while ((int) synthWindows.size() < need) synthWindows.push_back (nullptr);
                auto w = std::move (synthWindows[(size_t) from]);
                synthWindows.erase (synthWindows.begin() + from);
                synthWindows.insert (synthWindows.begin() + to, std::move (w));
                proc.moveNode (from, to);
                pushRackScanned(); pushChainDevices();
            }
        })
        .withEventListener ("setBypass",    [this] (juce::var v)   { if (proc.isEditLocked()) return; proc.setNodeBypassed ((int) v.getProperty ("i", -1), ! (bool) v.getProperty ("on", true)); pushChainDevices(); })
        .withEventListener ("duplicateDevice", [this] (juce::var v) {
            // Alt+drag a chip = duplicate that device (same patch + mapped params, EMPTY
            // lanes) at the drop position. The engine inserts asynchronously; the timer's
            // summary-change branch aligns synthWindows via pendingDupInsertAt (see .h).
            if (proc.isEditLocked()) return;
            const int from = (int) v.getProperty ("from", -1), to = (int) v.getProperty ("to", -1);
            if (from < 0) return;
            pendingDupInsertAt = juce::jmax (0, to);
            pendingDupSetMs    = juce::Time::getMillisecondCounter();
            proc.duplicateNode (from, pendingDupInsertAt);
        })
        .withEventListener ("license",      [this] (juce::var v)   { handleLicense (v); })
        .withEventListener ("undoRemove",   [this] (juce::var)     { if (proc.isEditLocked()) return; synthWindows.clear(); proc.undoRemove(); })
        .withEventListener ("setKeys",      [this] (juce::var v)   {
            proc.setKeyswitchEnabled ((bool) v.getProperty ("on", proc.isKeyswitchEnabled()));
            if (v.hasProperty ("base")) proc.setKeyswitchBase ((int) v.getProperty ("base", 0));   // setter clamps to {0,12,24}
            pushKeysState();
        })
        .withEventListener ("toggleLearn",  [this] (juce::var)     { if (proc.isEditLocked()) return; proc.setLearnMode (! proc.isLearning()); pushLearnState(); })
        .withEventListener ("toggleUnlearn",[this] (juce::var)     { if (proc.isEditLocked()) return; proc.setUnlearnMode (! proc.isUnlearning()); pushLearnState(); })
        .withEventListener ("setDriveMode", [this] (juce::var v)   { if (proc.isEditLocked()) return; proc.setDriveMode ((int) v.getProperty ("mode", 0) == 1 ? StrideWrapperProcessor::DriveMode::Automation : StrideWrapperProcessor::DriveMode::Live); pushRackScanned(); })
        .withEventListener ("announceMacros", [this] (juce::var)    { if (proc.isEditLocked()) return; proc.announceMacrosToHost(); })
        .withEventListener ("setPin",       [this] (juce::var v)   { applyPinMode (v.getProperty ("mode", "").toString()); })
        .withEventListener ("toggleFullscreen", [this] (juce::var)  {
            pinMode.clear(); pushPinState();                   // fullscreen replaces any pin
            if (! sdFullscreen)
            {
                preFsW = getWidth(); preFsH = getHeight();     // remember the working size
                auto* disp = juce::Desktop::getInstance().getDisplays().getDisplayForRect (getScreenBounds());
                if (disp == nullptr) disp = juce::Desktop::getInstance().getDisplays().getPrimaryDisplay();
                const auto ua = (disp != nullptr) ? disp->userArea : juce::Rectangle<int> (0, 0, 1600, 1000);
                sdFullscreen = true;
                setSize (ua.getWidth(), ua.getHeight());       // clamped to the resize limits by JUCE
            }
            else
            {
                sdFullscreen = false;
                setSize (preFsW > 0 ? preFsW : 940, preFsH > 0 ? preFsH : 620);   // restore
            }
            if (web != nullptr)
            {
                auto* o = new juce::DynamicObject(); o->setProperty ("on", sdFullscreen);
                web->emitEventIfBrowserIsVisible ("fullscreenState", juce::var (o));   // update the button icon
            }
        })
        .withEventListener ("setDemoMode",  [this] (juce::var)     {
            // SECURITY: recompute NATIVELY — never trust the WebView flag to LIFT the gate
            // (devtools / a bridge call could send it). Entitled (paid or an ACTIVE Discovery
            // Pass) -> full. Otherwise (no pass yet, or an EXPIRED pass) -> the editor is locked;
            // the processor keeps driving the curves already in the project so audio is untouched.
            // Live activation/pass-start unlocks instantly because the JS writes license.json
            // BEFORE emitting this and it uses the SAME computeEntitled.
            const bool ent = stride_license::cachedEntitled();
            proc.setEditLocked (! ent);
            proc.setDriveAllowed (ent || stride_license::cachedExpiredPass());
            proc.setDemoMode (false);   // the 24h Discovery Pass replaces the old freeze demo
        })
        .withEventListener ("checkUpdate",  [this] (juce::var)     {
            // One-click update: a signed LS download when the backend can mint one, the
            // My Orders portal for every failure path. Either way the browser opens —
            // no email hunt, no login.
            juce::Component::SafePointer<StrideWrapperEditor> safe (this);
            stride_license::fetchUpdateLink ([safe] (juce::var r)
            {
                const bool ok = r.isObject() && (bool) r.getProperty ("ok", false);
                const auto url = ok ? r.getProperty ("url", "").toString()
                                    : r.getProperty ("portal", "https://app.lemonsqueezy.com/my-orders").toString();
                if (url.isNotEmpty()) juce::URL (url).launchInDefaultBrowser();
                if (auto* self = safe.getComponent())
                    if (self->web != nullptr)
                    {
                        auto* o = new juce::DynamicObject();
                        o->setProperty ("ok", ok);
                        self->web->emitEventIfBrowserIsVisible ("updateReply", juce::var (o));
                    }
            });
        })
        .withEventListener ("openExternal", [this] (juce::var v)   { const auto u = v.getProperty ("url", "").toString(); if (u.isNotEmpty()) juce::URL (u).launchInDefaultBrowser(); });

    web = std::make_unique<juce::WebBrowserComponent> (options);
    addAndMakeVisible (*web);
    web->goToURL (juce::WebBrowserComponent::getResourceProviderRoot()
                  + "index.html?v=" + juce::String (juce::Time::currentTimeMillis()));

    setResizable (true, true);
    setResizeLimits (380, 280, 5120, 2880);   // upper bound raised so the Fullscreen toggle can fill large monitors
    // Reopen at the size the user last left Stride (global preference), else the compact
    // default. Clamped to the resize limits so a stale/garbage file can't break layout.
    int initW = 680, initH = 480;   // compact-device default
    {
        const auto f = strideWrapperWindowFile();
        if (f.existsAsFile())
        {
            const auto v = juce::JSON::parse (f.loadFileAsString());
            const int w = (int) v.getProperty ("w", 0), h = (int) v.getProperty ("h", 0);
            if (w >= 380 && w <= 2200 && h >= 280 && h <= 1400) { initW = w; initH = h; }
        }
    }
    setSize (initW, initH);
    savedW = lastTickW = initW;
    savedH = lastTickH = initH;
    startTimerHz (30);   // 30Hz: smooth enough for the exposed macros to follow the modulation in Ableton
    proc.consumeKeyswitchMask();   // drop switch notes that piled up while no editor was open — stale triggers must not fire on open

    // Surface interactive load failures as a UI toast (the silent-DBG version was a support
    // ticket: on Mac the usual cause is an Intel-only bundle inside an arm64 host process).
    proc.onLoadFailed = [this] (const juce::String& name, const juce::String& error)
    {
        if (web == nullptr) return;
        auto* o = new juce::DynamicObject();
        o->setProperty ("name", name);
        o->setProperty ("error", error);
        web->emitEventIfBrowserIsVisible ("loadFailed", juce::var (o));
    };

   #if JUCE_WINDOWS
    installKeyHook();     // forward Space/Return from hosted synth windows to the DAW transport
   #endif
   #if JUCE_MAC
    strideMacKeyForward_install();   // same, via an NSEvent monitor
    // Logic/GarageBand host AUs OUT-OF-PROCESS (AUHostingService): no DAW window exists in
    // this process to re-post into, and Logic's own key handling already sees unconsumed
    // keys — a synthetic re-post could only misfire or double-toggle the transport.
    strideMacKeyForward_setSuppressed (juce::PluginHostType().isLogic() || juce::PluginHostType().isGarageBand());
    // Typed notes are INJECTED into our own processBlock (no synthetic events into the
    // host — see MacKeyForward.mm case 3), so unlike the old relay this is safe in every
    // host: consumed letters can't leak into anyone's shortcut table, and the wrapped
    // instrument simply becomes playable wherever Stride is focused.
    strideMacKeyForward_setNoteForwardEnabled (true);
    strideMacKeyForward_setNoteSink (this, [] (void* ctx, int note, int vel, bool isDown)
    {
        static_cast<StrideWrapperEditor*> (ctx)->proc.queueTypedNote (note, vel, isDown);
    });
   #endif
}

StrideWrapperEditor::~StrideWrapperEditor()
{
    proc.onLoadFailed = nullptr;   // the processor outlives us — never leave a dangling capture
    proc.closeMacroGestures();     // our timer was the only gesture-closer — a window closed mid-play must not leave params "touched"
   #if JUCE_WINDOWS
    removeKeyHook();
   #endif
   #if JUCE_MAC
    strideMacKeyForward_remove();                          // refcounted — the monitor survives for other open Stride instances
    strideMacKeyForward_unregisterEditorView (lastForwardView);   // drop only OUR view (never another instance's)
    strideMacKeyForward_setNoteSink (nullptr, nullptr);    // we may be mid-teardown — no more injections into a dying editor
    proc.flushTypedNotes();                                // and end every note we injected (the processor outlives us)
    lastForwardView = nullptr;
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

// Space/Return pressed while Stride's WebView has focus. WebView keys never reach the
// DAW on their own (WebView2/WKWebView consume them), so the page JS forwards them here
// and we hand them to the host natively — PostMessage on Windows, NSEvent re-post on
// macOS (MacKeyForward.mm). Compiled on ALL platforms: the WebView "transportKey"
// listener references it unconditionally, so it must exist outside any platform guard.
void StrideWrapperEditor::forwardTransportKey (const juce::String& key)
{
    // One toggle per press: swallows key auto-repeat from any path and breaks any
    // conceivable synthetic-event bounce (posted key -> our own WebView -> re-forward)
    // after a single cycle.
    const auto nowMs = juce::Time::getMillisecondCounter();
    if (nowMs - lastTransportKeyMs < 150) return;
    lastTransportKeyMs = nowMs;

   #if JUCE_WINDOWS
    // "save" posts a bare 'S' keydown — the user is PHYSICALLY holding Ctrl right now, so the
    // host's accelerator table (GetKeyState) reads it as Ctrl+S and saves the project.
    const WPARAM vk = (key == "enter") ? VK_RETURN : (key == "save") ? (WPARAM) 'S' : VK_SPACE;
    if (auto* host = (HWND) hostMainWindow())
    {
        ::PostMessage (host, WM_KEYDOWN, vk, (LPARAM) 0x00000001);
        ::PostMessage (host, WM_KEYUP,   vk, (LPARAM) 0xC0000001);
    }
   #elif JUCE_MAC
    if (key == "save")
        strideMacKeyForward_postSave();          // synthesized Cmd+S (flags carried in the event)
    else
        strideMacKeyForward_post (key == "enter");
   #else
    juce::ignoreUnused (key);
   #endif
}

// A note key (Ableton's computer-MIDI keyboard) pressed/released while Stride's WebView
// has focus. The JS filters to Live's note set, unmodified and outside text fields; the
// letter check here is the native backstop.
//
// macOS deliberately does NOTHING here. Anything routed through the page is already too
// late: WKWebView hands the key to the web process and only releases it once that process
// answers, so keyDown and keyUp arrive with independent, variable delays and a short tap
// came out as a random mid/long note. macOS intercepts note keys in the NSEvent monitor,
// BEFORE the WebView ever sees them (MacKeyForward.mm), which is the only way to get the
// timing the player actually played.
void StrideWrapperEditor::forwardMusicKey (const juce::String& key, bool down)
{
    if (key.length() != 1) return;

   #if JUCE_WINDOWS
    // g_strideWinNoteForward: see the flag's comment — this path currently fires Live
    // SHORTCUTS rather than notes. Other DAWs treat bare letters as commands, not notes.
    if (! g_strideWinNoteForward || ! strideHostIsAbletonLive()) return;
    const auto letter = (char) key.toLowerCase()[0];
    if (letter < 'a' || letter > 'z') return;

    // Live's computer-MIDI piano maps notes by SCAN CODE (it's positional — AZERTY players
    // get the same piano shape), so the bare-VK/scancode-0 post the transport keys get away
    // with plays NOTHING here (proven live: the hook path, which relays the real lParam,
    // played; this path with scancode 0 stayed silent). Post a replica of the real press:
    // the physical key's scancode + the layout's VK for it.
    static const juce::uint8 kUsScan[26] = {
        0x1E, 0x30, 0x2E, 0x20, 0x12, 0x21, 0x22, 0x23, 0x17, 0x24,   // a b c d e f g h i j
        0x25, 0x26, 0x32, 0x31, 0x18, 0x19, 0x10, 0x13, 0x1F, 0x14,   // k l m n o p q r s t
        0x16, 0x2F, 0x11, 0x2D, 0x15, 0x2C };                         // u v w x y z
    const UINT scan = kUsScan[letter - 'a'];
    UINT vk = ::MapVirtualKeyW (scan, MAPVK_VSC_TO_VK);   // layout-correct VK for that physical key
    if (vk == 0) vk = (UINT) (letter - 'a') + 'A';

    if (auto* host = (HWND) hostMainWindow())
    {
        const auto lp = (LPARAM) ((scan << 16) | 1u);   // repeat count 1 + scancode, like a real press
        if (down) ::PostMessage (host, WM_KEYDOWN, (WPARAM) vk, lp);
        else      ::PostMessage (host, WM_KEYUP,   (WPARAM) vk, lp | (LPARAM) 0xC0000000);   // + previous-state/transition bits
    }
   #else
    juce::ignoreUnused (key, down);   // macOS: handled natively in the monitor (see above)
   #endif
}

void StrideWrapperEditor::paint (juce::Graphics& g) { g.fillAll (juce::Colour (0xff09090b)); }

void StrideWrapperEditor::resized() { if (web) web->setBounds (getLocalBounds()); }

// ── Chain presets (.stridechain) ─────────────────────────────────────────────
// Save/load the ENTIRE instance — hosted chain (paths + patches), mapped lanes,
// curves, ranges/colors/loop/speed/locks — as a file, so a sound-design setup
// travels between tracks and projects (field request 2026-08-04). The file IS
// the project state chunk verbatim (getState/setStateInformation), so loading
// rides the exact teardown/rebuild machinery a DAW project-open uses (restore
// generations, editors-die-before-instances) and nothing new can drift.
static juce::File strideChainDir()
{
    auto dir = juce::File::getSpecialLocation (juce::File::userDocumentsDirectory)
                   .getChildFile ("Stride").getChildFile ("chains");
    dir.createDirectory();
    return dir;
}

void StrideWrapperEditor::emitChainNote (const juce::String& title, const juce::String& detail)
{
    if (web == nullptr) return;
    auto* o = new juce::DynamicObject();
    o->setProperty ("t", title);
    o->setProperty ("d", detail);
    web->emitEventIfBrowserIsVisible ("chainNote", juce::var (o));
}

void StrideWrapperEditor::saveChainToFile()
{
    // The demo persists NOTHING (getStateInformation returns empty there) — gate with a
    // note instead of silently writing a husk of a file.
    if (proc.isEditLocked() || proc.isDemo())
    {
        emitChainNote ("Chain save needs a full license", "The demo can't persist a chain. Activate first.");
        return;
    }
    chooser = std::make_unique<juce::FileChooser> ("Save chain",
                                                   strideChainDir().getChildFile ("MyChain.stridechain"),
                                                   "*.stridechain");
    chooser->launchAsync (juce::FileBrowserComponent::saveMode | juce::FileBrowserComponent::canSelectFiles
                            | juce::FileBrowserComponent::warnAboutOverwriting,
        [this] (const juce::FileChooser& fc)
        {
            auto f = fc.getResult();
            if (f == juce::File()) return;                                       // cancelled
            if (! f.hasFileExtension ("stridechain")) f = f.withFileExtension ("stridechain");
            juce::MemoryBlock mb;
            proc.getStateInformation (mb);
            if (mb.getSize() == 0 || ! f.replaceWithData (mb.getData(), mb.getSize()))
                emitChainNote ("Couldn't save the chain", "Nothing was written. Check the folder is writable.");
            else
                emitChainNote ("Chain saved", f.getFileName() + " — load it on any track, in any project.");
        });
}

void StrideWrapperEditor::loadChainFromFile()
{
    if (proc.isEditLocked() || proc.isDemo())
    {
        emitChainNote ("Chain load needs a full license", "The demo can't restore a chain. Activate first.");
        return;
    }
    chooser = std::make_unique<juce::FileChooser> ("Load chain", strideChainDir(), "*.stridechain");
    chooser->launchAsync (juce::FileBrowserComponent::openMode | juce::FileBrowserComponent::canSelectFiles,
        [this] (const juce::FileChooser& fc)
        {
            const auto f = fc.getResult();
            if (! f.existsAsFile()) return;                                      // cancelled
            juce::MemoryBlock mb;
            if (! f.loadFileAsData (mb) || mb.getSize() == 0)
            {
                emitChainNote ("Couldn't load the chain", "The file was unreadable or empty.");
                return;
            }
            proc.setStateInformation (mb.getData(), (int) mb.getSize());
            emitChainNote ("Chain loaded", f.getFileNameWithoutExtension() + " — rebuilding the devices…");
        });
}

void StrideWrapperEditor::chooseAndLoad()
{
   #if JUCE_MAC
    // macOS also hosts AU: .component bundles live in /Library/Audio/Plug-Ins/Components.
    chooser = std::make_unique<juce::FileChooser> ("Select synth(s) - VST3 or AU, pick one or many", juce::File(), "*.vst3;*.component");
   #else
    chooser = std::make_unique<juce::FileChooser> ("Select VST3 synth(s) - pick one or many", juce::File(), "*.vst3");
   #endif
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

// Teardown hook (see PluginEditor.h): hosted editors must die BEFORE their instances.
// The 30Hz timer's own `n == 0 -> synthWindows.clear()` runs up to a tick (~33ms) AFTER
// a chain teardown — a hosted GUI timer firing inside that gap reads a freed instance
// (the Bitwig Cmd+Z crash). This closes them synchronously, ahead of the teardown; the
// timer's `n > size` branch lazily reopens windows as restored devices land.
void StrideWrapperEditor::closeAllSynthWindows()
{
    synthWindows.clear();
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

    // Stride tempo: Project / Manual BPM / Free (engine-owned + project-persistent).
    if (type == "set_tempo_mode")
    {
        if (proc.isEditLocked()) return;
        proc.setTempoMode ((int) msg.getProperty ("mode", 0),
                           (float) (double) msg.getProperty ("bpm", 0.0));
        return;
    }

    // Run mode: Transport (default) / Notes — MIDI input gates the motion clock
    // (engine-owned + project-persistent, same story as the tempo mode).
    if (type == "set_run_mode")
    {
        if (proc.isEditLocked()) return;
        proc.setRunMode ((int) msg.getProperty ("mode", 0));
        return;
    }

    // Range-for-Group: one batched band edit for every selected lane (one lock pass, atomic).
    if (type == "set_ranges")
    {
        if (proc.isEditLocked()) return;
        if (auto* arr = msg.getProperty ("items", juce::var()).getArray())
            proc.setMappedRanges (*arr);
        return;
    }

    // Range band edit (icon toggle / boundary drag / MIN-MAX fields). ENGINE-OWNED: persists
    // in the project and rack_scanned echoes it back — so re-pushes/reopens can't wipe it.
    if (type == "set_range")
    {
        if (proc.isEditLocked()) return;
        proc.setMappedRange ((int) msg.getProperty ("id", -1),
                             (bool) msg.getProperty ("on", false),
                             (float) (double) msg.getProperty ("min", 0.0),
                             (float) (double) msg.getProperty ("max", 1.0));
        return;
    }

    // Unmap ONE param (the per-lane × in Stride). Deliberately does NOT re-push:
    // the canvas re-indexes its own lanes to match the erase, so a positional
    // re-push here would misroute the other lanes' drawn curves.
    // Lane color pick (1.1.11) - engine-owned like set_range, same locking policy.
    if (type == "set_color")
    {
        if (proc.isEditLocked()) return;
        proc.setMappedColor ((int) msg.getProperty ("id", -1),
                             (int) msg.getProperty ("c", -1));
        return;
    }

    // Per-lane loop boundary (1.3.0) - engine-owned like set_range, same locking policy.
    if (type == "set_loop")
    {
        if (proc.isEditLocked()) return;
        proc.setMappedLoop ((int) msg.getProperty ("id", -1),
                            (float) (double) msg.getProperty ("beats", 0.0));
        return;
    }

    // Per-lane grid-quantize step - RETIRED 2026-08-04 (route kept so nothing throws;
    // no shipped canvas sends it anymore). Speed took its slot:
    if (type == "set_quant")
    {
        if (proc.isEditLocked()) return;
        proc.setMappedQuant ((int) msg.getProperty ("id", -1),
                             (float) (double) msg.getProperty ("step", 0.0));
        return;
    }

    // Per-lane SPEED (the groove grid's replacement) - engine-owned like set_range,
    // same locking policy. s = rate multiplier, 1 = ride the track.
    if (type == "set_speed")
    {
        if (proc.isEditLocked()) return;
        proc.setMappedSpeed ((int) msg.getProperty ("id", -1),
                             (float) (double) msg.getProperty ("s", 1.0));
        return;
    }

    // Per-lane padlock - engine-owned like set_range, same locking policy. Locks were the
    // last client-only lane attribute: they lived in the WebView's ONE shared localStorage
    // profile, so locking lanes in one instance leaked them into every other instance
    // hosting the same chain (field report 2026-08-03).
    if (type == "set_lock")
    {
        if (proc.isEditLocked()) return;
        proc.setMappedLock ((int) msg.getProperty ("id", -1),
                            (bool) msg.getProperty ("on", false));
        return;
    }

    // Lock All / Unlock All / "Lock current lanes": one batched pass (the set_ranges pattern).
    if (type == "set_locks")
    {
        if (proc.isEditLocked()) return;
        if (auto* arr = msg.getProperty ("items", juce::var()).getArray())
            proc.setMappedLocks (*arr);
        return;
    }

    if (type == "unmapParam")
    {
        proc.removeMappedAt ((int) msg.getProperty ("id", -1));
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
        // SOFT LOCK: an expired pass (or no pass) can't push NEW curves — even a bypassed
        // WebView firing live_curves is refused here, so the modulation can't be changed.
        // Existing driveLanes are untouched, so the project keeps sounding the same.
        if (proc.isEditLocked()) return;
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
                // interp() needs ascending times; a mid-drag flush (or a state saved by an
                // older build) can arrive out of order and freeze the lane past that point.
                StrideWrapperProcessor::sortLaneByTime (lane.times, lane.values, lane.curves);
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
    const auto curves = proc.getMappedCurves();   // drive curves so a reopen SHOWS them, not just an empty canvas
    const auto ranges = proc.getMappedRanges();   // range bands too — engine-owned, so a re-push/reopen can't wipe them
    const auto colors = proc.getMappedColors();   // lane colors - engine-owned for exactly the same reason (1.1.11)
    const auto loops  = proc.getMappedLoops();    // per-lane loop boundaries (1.3.0) - same ownership story
    const auto speeds = proc.getMappedSpeeds();   // per-lane rate multipliers (the groove grid's replacement, 2026-08-04)
    const auto locks  = proc.getMappedLocks();    // per-lane padlocks - engine-owned so instances can't share them via localStorage
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
        if (i < curves.size()) o->setProperty ("points", curves[i]);   // restore the drawn curve onto this lane
        if (i < ranges.size() && (bool) ranges[i].getProperty ("on", false))
        {
            o->setProperty ("rangeOn",  true);                          // canvas rebuilds the band from these
            o->setProperty ("rangeMin", ranges[i].getProperty ("lo", 0.0));
            o->setProperty ("rangeMax", ranges[i].getProperty ("hi", 1.0));
        }
        if (i < colors.size() && colors[i] >= 0)
            o->setProperty ("colorIdx", colors[i]);                     // lane color echo - canvas repaints the pick on every rebuild
        if (i < loops.size() && (double) loops[i] > 0.0)
            o->setProperty ("loopBeats", loops[i]);                     // loop boundary echo (1.3.0) - absent = full clip
        if (i < speeds.size() && std::abs ((double) speeds[i] - 1.0) > 1.0e-4)
            o->setProperty ("speedVal", speeds[i]);                     // lane-speed echo - absent = 1x (quantStep echo retired 2026-08-04)
        if (i < locks.size() && locks[i] != 0)
            o->setProperty ("locked", true);                            // padlock echo - absent = unlocked (canvas rebuilds from THIS, never from localStorage)
        params.add (juce::var (o));
    }

    auto* msg = new juce::DynamicObject();
    msg->setProperty ("type", "rack_scanned");
    msg->setProperty ("parameters", juce::var (params));
    const auto summary = proc.getChainSummary();
    msg->setProperty ("device_name", summary.isNotEmpty() ? summary : juce::String ("No synth"));
    msg->setProperty ("track_name", "Stride");
    msg->setProperty ("clip_bars", juce::jmax (1, juce::roundToInt (proc.getClipBeats() / 4.0)));   // real loop length so restored curves show at the right scale
    msg->setProperty ("has_clip", true);
    // Host automation: current global mode + how many params are exposed to the DAW.
    msg->setProperty ("drive_mode", (int) proc.getDriveMode());           // 0=Live (Stride drives), 1=Automation (DAW drives)
    msg->setProperty ("exposed_macros", proc.exposedMacroCount());        // N of kMacroCount exposed
    msg->setProperty ("macro_pool", StrideWrapperProcessor::kMacroCount);
    msg->setProperty ("tempo_mode", proc.getTempoMode());                 // 0=Project / 1=Manual / 2=Free (bar UI rebuilds from here)
    msg->setProperty ("manual_bpm", (double) proc.getManualBpm());
    msg->setProperty ("run_mode", proc.getRunMode());                     // 0=Transport / 1=Notes (the run pill rebuilds from here)
    web->emitEventIfBrowserIsVisible ("sl_event", juce::var (msg));
}

// Touch-unmap: tell the canvas to splice exactly ONE lane (by its engine position) and
// re-index the rest — the same leak-free path as the per-lane × button. Carries the fresh
// macro counts so the "Automation" readout stays correct without a full rack re-push.
void StrideWrapperEditor::pushUnmappedAt (int pos)
{
    if (web == nullptr) return;
    auto* o = new juce::DynamicObject();
    o->setProperty ("type", "unmapped_at");
    o->setProperty ("position", pos);
    o->setProperty ("drive_mode", (int) proc.getDriveMode());
    o->setProperty ("exposed_macros", proc.exposedMacroCount());
    o->setProperty ("macro_pool", StrideWrapperProcessor::kMacroCount);
    web->emitEventIfBrowserIsVisible ("sl_event", juce::var (o));
}

// Which DAW we're in. The page uses this for ONE thing: whether the computer-MIDI note
// letters are reserved. In Live they are (a note letter must never also trigger something
// in Stride — the old L = pattern-library hotkey ate a note every time). In every other
// host we provide no note behavior, so the letters are left completely alone.
void StrideWrapperEditor::pushHostInfo()
{
    if (web == nullptr) return;
    auto* o = new juce::DynamicObject();
    o->setProperty ("ableton", juce::PluginHostType().isAbletonLive());
    // The COMPILED-IN version, shown in the title bar — testers/support read the running
    // build off the UI instead of guessing from zip names (version mismatches cost a full
    // debugging round twice: Matt on 1.0.4, the mac Audio-In confusion).
   #ifdef JucePlugin_VersionString
    o->setProperty ("ver", JucePlugin_VersionString);
   #endif
   #if JUCE_MAC
    // The pin buttons hide on mac until a mac tester validates the window-move math
    // (untested Y-flip; prime suspect in the 2026-07-28 window-chaos report).
    o->setProperty ("mac", true);
   #endif
    web->emitEventIfBrowserIsVisible ("hostInfo", juce::var (o));
}

// Send the native prefs (favorites…) to the page on boot. The shim adopts them when
// non-empty (they survive profile resets); when the file doesn't exist yet but the
// page's localStorage cache has favorites, the shim seeds this file right back.
void StrideWrapperEditor::pushPrefs()
{
    if (web == nullptr) return;
    juce::var prefs;
    const auto f = strideWrapperPrefsFile();
    if (f.existsAsFile()) prefs = juce::JSON::parse (f.loadFileAsString());
    auto* o = new juce::DynamicObject();
    o->setProperty ("prefs", prefs);
    web->emitEventIfBrowserIsVisible ("prefsState", juce::var (o));
}

// Write-through from the page (every favorites change). Whole-object replace — prefs
// are small and this keeps the file debuggable.
void StrideWrapperEditor::savePrefs (const juce::var& prefs)
{
    if (! prefs.isObject()) return;
    stride_license::dataDir().createDirectory();
    strideWrapperPrefsFile().replaceWithText (juce::JSON::toString (prefs));
}

void StrideWrapperEditor::pushLearnState()
{
    if (web == nullptr) return;
    auto* o = new juce::DynamicObject();
    o->setProperty ("on", proc.isLearning());
    o->setProperty ("unmap", proc.isUnlearning());   // reflect BOTH the Map and Unmap buttons
    web->emitEventIfBrowserIsVisible ("learnState", juce::var (o));
}

void StrideWrapperEditor::pushKeysState()
{
    if (web == nullptr) return;
    auto* o = new juce::DynamicObject();
    o->setProperty ("on", proc.isKeyswitchEnabled());
    o->setProperty ("base", proc.getKeyswitchBase());   // switch-octave bottom note (0/12/24) — the legend renders from it
    web->emitEventIfBrowserIsVisible ("keysState", juce::var (o));
}

void StrideWrapperEditor::pushPinState()
{
    if (web == nullptr) return;
    auto* o = new juce::DynamicObject();
    o->setProperty ("mode", pinMode);
    web->emitEventIfBrowserIsVisible ("pinState", juce::var (o));
}

// ── Pin modes: snap the HOST's plugin window to exactly half the screen ─────
// The editor's setSize drives the host's frame SIZE (every host re-frames around its
// plugin's content); the frame POSITION is ours to move natively. Frame overhead
// (host title bar + borders) is measured and subtracted so content + host chrome
// together land exactly on the half-screen rectangle from the mock (pin bottom =
// full width × half height at the bottom; pin side = half width × full height on
// the right — Live stays visible in the other half).
void StrideWrapperEditor::applyPinMode (const juce::String& mode)
{
    if (mode != "bottom" && mode != "side")
    {
        if (pinMode.isNotEmpty() && prePinW > 0 && prePinH > 0) setSize (prePinW, prePinH);
        pinMode.clear();
        pushPinState();
        return;
    }

    auto& displays = juce::Desktop::getInstance().getDisplays();
    auto* disp = displays.getDisplayForRect (getScreenBounds());
    if (disp == nullptr) disp = displays.getPrimaryDisplay();
    if (disp == nullptr) return;
    const auto ua = disp->userArea;

    if (pinMode.isEmpty()) { prePinW = getWidth(); prePinH = getHeight(); }   // pin->pin switches keep the ORIGINAL restore size
    sdFullscreen = false;                                                     // pin replaces fullscreen

    const auto target = (mode == "bottom")
        ? juce::Rectangle<int> (ua.getX(), ua.getY() + ua.getHeight() / 2, ua.getWidth(),      ua.getHeight() - ua.getHeight() / 2)
        : juce::Rectangle<int> (ua.getX() + ua.getWidth() / 2, ua.getY(),  ua.getWidth() - ua.getWidth() / 2, ua.getHeight());

    // Host-frame overhead in LOGICAL units (Windows measures in physical px — divide by
    // the display scale so the setSize math stays in JUCE's coordinate space).
    int ovW = 0, ovH = 0;
   #if JUCE_WINDOWS
    if (auto* peer = getPeer())
    {
        HWND root = GetAncestor ((HWND) peer->getNativeHandle(), GA_ROOT);
        RECT rr, cr;
        if (root != nullptr && GetWindowRect (root, &rr) && GetWindowRect ((HWND) peer->getNativeHandle(), &cr))
        {
            const double sc = disp->scale > 0 ? disp->scale : 1.0;
            ovW = juce::roundToInt (((rr.right - rr.left) - (cr.right - cr.left)) / sc);
            ovH = juce::roundToInt (((rr.bottom - rr.top) - (cr.bottom - cr.top)) / sc);
        }
    }
   #elif JUCE_MAC
    if (auto* peer = getPeer())
        ovH = strideMacHostWindowFrameOverhead (peer->getNativeHandle());   // title-bar points; modern macOS has no side borders
   #endif

    setSize (juce::jmax (380, target.getWidth() - ovW), juce::jmax (280, target.getHeight() - ovH));

    // Move the host frame AFTER it re-framed around the new content size (one tick later —
    // moving first would let the resize shift it again).
    juce::Component::SafePointer<StrideWrapperEditor> safe (this);
    const int tx = target.getX(), ty = target.getY();
    juce::Timer::callAfterDelay (60, [safe, tx, ty]
    {
        if (safe == nullptr) return;
       #if JUCE_WINDOWS
        if (auto* peer = safe->getPeer())
        {
            HWND root = GetAncestor ((HWND) peer->getNativeHandle(), GA_ROOT);
            if (root != nullptr)
            {
                const auto phys = juce::Desktop::getInstance().getDisplays()
                                      .logicalToPhysical (juce::Point<int> (tx, ty));
                SetWindowPos (root, nullptr, phys.getX(), phys.getY(), 0, 0, SWP_NOSIZE | SWP_NOZORDER | SWP_NOACTIVATE);
            }
        }
       #elif JUCE_MAC
        if (auto* peer = safe->getPeer())
            strideMacMoveHostWindow (peer->getNativeHandle(), tx, ty);
       #else
        juce::ignoreUnused (tx, ty);
       #endif
    });

    pinMode = mode;
    pushPinState();
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

    if (op == "load")           reply (stride_license::load());
    else if (op == "save")      reply (stride_license::save (msg.getProperty ("license", juce::var())));
    else if (op == "validate")  stride_license::validate (msg.getProperty ("key", "").toString(), reply);
    else if (op == "start_pass") stride_license::startPass (msg.getProperty ("email", "").toString(), reply);
    else                        reply (juce::var());
}

// Scan the standard plugin locations and hand the list to the WebView's Stride-styled
// plugin browser. VST3 (all platforms): top level + one vendor-folder deep, not into
// bundles. AU (macOS): the two Components folders. Names come from the bundle filename —
// nothing is instantiated, so the scan stays fast and can't crash on a broken plugin.
void StrideWrapperEditor::scanPluginsToWeb()
{
    if (web == nullptr) return;

    juce::Array<juce::var> list;

    // One browser entry per (format, name); dedup inside a format (system vs per-user
    // folder). "fmt" drives the little format chip — the shim only shows chips when a
    // list actually mixes formats, so Windows (VST3-only) renders exactly as before.
    auto addHits = [&list] (const juce::Array<juce::File>& hits, const char* fmt)
    {
        juce::StringArray seen;
        for (const auto& f : hits)
        {
            const auto name = f.getFileNameWithoutExtension();
            if (seen.contains (name)) continue;
            seen.add (name);
            auto* o = new juce::DynamicObject();
            o->setProperty ("name", name);
            o->setProperty ("path", f.getFullPathName());
            o->setProperty ("fmt",  fmt);
            list.add (juce::var (o));
        }
    };

    {
        juce::VST3PluginFormat fmt;
        auto search = fmt.getDefaultLocationsToSearch();
       #if JUCE_MAC
        // A sandboxed host (Logic/GarageBand) expands "~" into its container, which hides
        // the user's real per-user VST3 folder — put the real one back in the search set.
        if (stride_license::hostIsSandboxed())
            search.addIfNotAlreadyThere (stride_license::realUserHome().getChildFile ("Library/Audio/Plug-Ins/VST3"));
       #endif

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
        addHits (hits, "VST3");
    }

   #if JUCE_PLUGINHOST_AU && JUCE_MAC
    {
        juce::Array<juce::File> auRoots { juce::File ("/Library/Audio/Plug-Ins/Components"),
                                          juce::File ("~/Library/Audio/Plug-Ins/Components") };
        if (stride_license::hostIsSandboxed())
            auRoots.addIfNotAlreadyThere (stride_license::realUserHome().getChildFile ("Library/Audio/Plug-Ins/Components"));

        juce::Array<juce::File> hits;
        for (const auto& root : auRoots)
            if (root.isDirectory())
                root.findChildFiles (hits, juce::File::findFilesAndDirectories, false, "*.component");   // AUs never nest in vendor folders
        addHits (hits, "AU");
    }
   #endif

    auto* msg = new juce::DynamicObject();
    msg->setProperty ("plugins", juce::var (list));
    web->emitEventIfBrowserIsVisible ("pluginList", juce::var (msg));
}

void StrideWrapperEditor::timerCallback()
{
    proc.pushMacroValuesToHost();   // Live mode: Ableton's exposed params follow the modulation (+ record when armed)

   #if JUCE_MAC
    // Keep OUR entry in the forwarder's editor-view REGISTRY fresh — key forwarding uses it
    // to tell every Stride instance's plugin frame window (ours, don't sendEvent into those)
    // from the DAW's real windows. Idempotent 30Hz refresh; the dtor unregisters exactly this.
    if (auto* peer = getPeer())
    {
        lastForwardView = peer->getNativeHandle();
        strideMacKeyForward_registerEditorView (lastForwardView);
    }
    // Re-assert the typed-note sink too (pointer writes, no AppKit calls — safe at 30Hz):
    // a closing instance clears it in its dtor, so the surviving editor must reclaim it
    // or typed notes die with the closed window. Last ticking editor wins.
    strideMacKeyForward_setNoteSink (this, [] (void* ctx, int note, int vel, bool isDown)
    {
        static_cast<StrideWrapperEditor*> (ctx)->proc.queueTypedNote (note, vel, isDown);
    });
    // Live rolling in record: the monitor stands down so the keys travel Live's own
    // piano and RECORD into the clip (organic path, WebView latency and all). Gated on
    // Ableton — no other host has a typing piano to yield to.
    {
        static const bool sdHostIsLive = juce::PluginHostType().isAbletonLive();
        strideMacKeyForward_setRecording (sdHostIsLive && proc.transportRecording.load());
    }
    // NOTE: hosted synth windows are tagged ONCE, where they are created — never from
    // here. A previous revision re-tagged them every tick as "cheap insurance" against a
    // peer recreation that this code path never actually performs, and tagging carries a
    // hand-main-window-back step: any tick where our window held main fired makeMainWindow
    // at 30Hz, storming the host with resign/become-main notifications. It crashed Live
    // (2026-07-25). Speculative hardening on a hot path is not free.
   #endif

   #if JUCE_WINDOWS
    // First-open DPI nudge (see the .h note): one programmatic 1px grow-and-restore ~200ms
    // after open replays the same host scale handshake a manual corner-drag does, so a
    // mixed-DPI first open never sits at 80% with the L-shaped margin. Hosted-window
    // handshake only — the standalone owns its window and has nothing to reconcile.
    if (dpiNudgePhase < 2 && proc.wrapperType != juce::AudioProcessor::wrapperType_Standalone)
    {
        if (dpiNudgePhase == 0)
        {
            if (++dpiNudgeTick >= 6 && getPeer() != nullptr && pinMode.isEmpty() && ! sdFullscreen)
            {
                dpiNudgePhase = 1;
                dpiNudgeH = getHeight();
                setSize (getWidth(), dpiNudgeH + 1);
            }
        }
        else   // phase 1: restore on the very next tick
        {
            dpiNudgePhase = 2;
            setSize (getWidth(), dpiNudgeH);
        }
    }
   #endif

    // Re-derive the native entitlement gates (~every 2s) so a Discovery Pass expiring MID-SESSION
    // locks the editor + stops the drive WITHOUT waiting on the JS gate. Both are device-bound.
    if (++licTick >= 60)
    {
        licTick = 0;
        const bool ent = stride_license::cachedEntitled();
        const bool expd = stride_license::cachedExpiredPass();
        proc.setEditLocked (! ent);
        proc.setDriveAllowed (ent || expd);
        // Mid-session Discovery Pass expiry: if it lapsed while Stride stayed open, pop the
        // "ended" overlay IMMEDIATELY (don't wait for a reload) so editing never freezes
        // without the explanation showing.
        if (lastLicEntitled && ! ent && expd && web != nullptr)
            web->emitEventIfBrowserIsVisible ("passExpired", juce::var (new juce::DynamicObject()));
        lastLicEntitled = ent;
    }

    // Host dirty-flag: edits inside Stride (chain/mapping/curves/hosted-knob tweaks) are
    // invisible to the DAW — its chunk of us only changes when IT saves. Consume the pending
    // flag (set by the mutation sites, any thread) and tell the host on the MESSAGE thread
    // (VST3 setDirty via nonParameterStateChanged): "unsaved changes" turns honest and crash
    // recovery gets every chance to re-capture fresh state. Throttled to one notify per 3s.
    {
        const auto nowMs = juce::Time::getMillisecondCounter();
        if (nowMs - lastDirtyNotifyMs > 3000 && proc.consumeHostDirty())
        {
            lastDirtyNotifyMs = nowMs;
            proc.updateHostDisplay (juce::AudioProcessorListener::ChangeDetails{}.withNonParameterStateChanged (true));
        }
    }

    if (web == nullptr) return;

    // MIDI keyswitches → the one-click tools. The audio thread latches note-on bits (0..7);
    // this drains them at 30Hz and the shim fires the SAME functions the toolbar buttons
    // call. Bits collapse within a tick (two C-2 hits in 33ms = one Chaos — a feature, not
    // a loss). Gated on the soft lock: an expired pass must not keep generating curves.
    {
        const juce::uint32 ksm = proc.consumeKeyswitchMask();
        if (ksm != 0 && web != nullptr && ! proc.isEditLocked())
        {
            auto* o = new juce::DynamicObject();
            o->setProperty ("mask", (int) ksm);
            web->emitEventIfBrowserIsVisible ("keyswitch", juce::var (o));
        }
    }

    // TRUE playhead → canvas. The comet rides the REAL loop position (the ambient wall-clock
    // drift retires on the first tick). Change-detected: a stopped transport sends ONE parking
    // event and then goes silent — zero bridge traffic, zero paints. Live mode only (in
    // Automation mode the DAW drives arbitrary values; a loop-phase head would lie).
    {
        const bool on = proc.transportActive.load()
                          && proc.getDriveMode() == StrideWrapperProcessor::DriveMode::Live
                          && proc.hasHostedPlugin();
        const float ph = proc.lastModValue.load();
        if (on != lastPhOn || (on && std::abs (ph - lastPhSent) > 0.0005f))
        {
            lastPhOn = on; lastPhSent = ph;
            auto* o = new juce::DynamicObject();
            o->setProperty ("p", (double) ph);
            o->setProperty ("on", on);
            o->setProperty ("b", proc.lastBeatsPub.load());             // raw phrase beats - notes-free lane comets wrap these at their OWN boundary
            o->setProperty ("free", proc.getRunMode() == 2);            // endless mode flag (NotesFree)
            web->emitEventIfBrowserIsVisible ("playhead", juce::var (o));
        }
    }

    const auto summary = proc.getChainSummary();
    if (summary != lastSummary)
    {
        lastSummary = summary;
        const int n = proc.numHosted();
        // Alt+drag duplicate landed: insert the window slot at the SAME position the device
        // went in, so every open device window stays aligned to its chain index (the
        // clear-all alternative would slam every window shut and reopen the lot). The
        // deadline keeps a failed duplicate from misaligning a later unrelated add.
        if (pendingDupInsertAt >= 0)
        {
            const bool fresh = juce::Time::getMillisecondCounter() - pendingDupSetMs < 5000;
            if (fresh && n == (int) synthWindows.size() + 1)
                synthWindows.insert (synthWindows.begin() + juce::jmin ((size_t) pendingDupInsertAt, synthWindows.size()), nullptr);
            pendingDupInsertAt = -1;
        }
        if (n == 0) synthWindows.clear();                                                    // chain cleared
        else if (n > (int) synthWindows.size()) openMissingSynthWindows();                   // device ADDED -> auto-open the new one(s)
        else if (n < (int) synthWindows.size()) { while ((int) synthWindows.size() > n) synthWindows.pop_back(); }   // shrank (safety) -> trim, don't reopen
        // n == size: a removal was already handled by the targeted erase in removeDevice — do NOT reopen (that was the "delete pops up all windows" bug)
        pushRackScanned();
        pushChainDevices();
    }

    const int v = proc.mappingVersion();
    if (v != lastMapVersion)
    {
        lastMapVersion = v;
        // A touch-unmap removed ONE lane: splice it on the canvas by position instead of a
        // full rack re-push. The re-push keys lanes by the positional _path ("wrap:<i>"),
        // which renumbers on erase and would carry the removed lane's RANGE onto its neighbour.
        const int unmappedPos = proc.consumeUnmapByTouchPos();
        if (unmappedPos >= 0) pushUnmappedAt (unmappedPos);
        else                  pushRackScanned();
        pushLearnState();
    }

    // Param-touch glow: a hosted-GUI touch on a mapped knob -> flash that lane on the
    // canvas (drained here like the keyswitch mask; last touch wins within a tick).
    {
        const int gp = proc.consumeGlowPos();
        if (gp >= 0 && web != nullptr)
        {
            auto* o = new juce::DynamicObject();
            o->setProperty ("type", "param_glow");
            o->setProperty ("id", gp);
            web->emitEventIfBrowserIsVisible ("sl_event", juce::var (o));
        }
    }

    // Reflect EVERY learn-mode change on the Map button — including the auto-leave
    // that fires when a moving curve is applied (which doesn't bump mapVersion).
    const bool learning = proc.isLearning();
    const bool unlearning = proc.isUnlearning();
    if (learning != lastLearn || unlearning != lastUnlearn)
    {
        lastLearn = learning; lastUnlearn = unlearning;
        pushLearnState();
    }

    // Push the demo move/freeze state to the badge (live countdown during the freeze).
    if (web != nullptr)
    {
        const bool df = proc.isDemoFrozen();
        const int  ds = proc.demoSecsUntilResume();
        const bool dp = proc.isDemoPlaying();
        if (df != lastDemoFrozen || ds != lastDemoSecs || dp != lastDemoPlaying)
        {
            const bool freezeEdge = (df != lastDemoFrozen);
            lastDemoFrozen = df; lastDemoSecs = ds; lastDemoPlaying = dp;
            auto* o = new juce::DynamicObject();
            o->setProperty ("frozen", df);
            o->setProperty ("secs", ds);
            o->setProperty ("playing", dp);
            web->emitEventIfBrowserIsVisible ("demo_freeze", juce::var (o));
            if (proc.isDemo() && freezeEdge) proc.saveDemoCycleState();   // persist on freeze enter/exit only (not every play/stop)
        }
    }
    // Persist the move budget periodically too — it changes silently during the move window
    // (where the freeze state doesn't), so a reload can't rewind more than ~2s of it.
    if (proc.isDemo() && ++demoSaveTick >= 60) { demoSaveTick = 0; proc.saveDemoCycleState(); }   // ~2s at 30Hz

    // Persist the editor size once it settles (unchanged for one 10Hz tick), so
    // launching Stride reopens it where the user left it — big/"fullscreen" stays big.
    const int cw = getWidth(), ch = getHeight();
    if (cw != lastTickW || ch != lastTickH) { lastTickW = cw; lastTickH = ch; }   // still resizing — wait for it to settle
    else if (! sdFullscreen && cw > 0 && ch > 0 && (cw != savedW || ch != savedH))   // don't persist the fullscreen size — keep the working size
    {
        savedW = cw; savedH = ch;
        auto* o = new juce::DynamicObject();
        o->setProperty ("w", cw);
        o->setProperty ("h", ch);
        stride_license::dataDir().createDirectory();
        strideWrapperWindowFile().replaceWithText (juce::JSON::toString (juce::var (o)));
    }
}
