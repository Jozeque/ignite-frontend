#pragma once

#include "PluginProcessor.h"
#include <juce_gui_extra/juce_gui_extra.h>

/*
  M1b UI — the REAL Stride canvas (index.html + canvas.js + helpers) in a JUCE WebView.
  shim.js provides window.stride / strideLink / strideCloud routed to this bridge:

    page -> C++ : "wrapperReady"  {}            -> push connected + rack_scanned
                  "sl_send"       {type,...}    -> strideLink traffic (request_scan_mapped, apply_automation, …)
                  "loadSynth"     {}            -> host a .vst3
                  "openSynth"     {}            -> hosted synth's own GUI window
                  "toggleLearn"   {}            -> arm/disarm "Map" (learn by wiggling a knob)
    C++ -> page : "sl_event" {type:'rack_scanned', parameters:[lanes], …}  -> canvas builds lanes
                  "sl_event" {type:'connected'}
                  "learnState" {on}             -> wrapper toolbar Map button
*/
class StrideWrapperEditor : public juce::AudioProcessorEditor,
                            private juce::Timer
{
public:
    explicit StrideWrapperEditor (StrideWrapperProcessor&);
    ~StrideWrapperEditor() override;

    void paint (juce::Graphics&) override;
    void resized() override;

   #if JUCE_WINDOWS
    bool  ownsNativeWindow (void* hwnd) const;   // is hwnd inside a hosted synth window? (transport-key hook)
    void* hostMainWindow() const;                // the DAW's top-level window (key-forward target)
   #endif
    // WebView Space/Return -> hand to the host (play/stop). ALL platforms: the WebView
    // "transportKey" listener references it unconditionally (Windows: PostMessage;
    // macOS: MacKeyForward.mm; others: no-op).
    void forwardTransportKey (const juce::String& key);
    // WebView note keys (Ableton's computer-MIDI keyboard) -> re-posted to the host as
    // REAL down/up pairs. ALL platforms for the same reason as forwardTransportKey;
    // inside it's Ableton-only — other DAWs treat bare letters as single-key commands.
    void forwardMusicKey (const juce::String& key, bool down);
    // MESSAGE THREAD. Close every hosted-device window NOW (destroys their editors). The
    // processor calls this right before tearing the chain down (host setState) — a hosted
    // editor must never outlive its instance, and the 30Hz reconcile is a tick too late.
    void closeAllSynthWindows();
    // Pin modes: snap the HOST's plugin window to exactly half the screen — "bottom"
    // (full width × half height, anchored bottom) or "side" (half width × full height,
    // anchored right). Anything else unpins and restores the pre-pin size.
    void applyPinMode (const juce::String& mode);

private:
    void timerCallback() override;
    void chooseAndLoad();
    void saveChainToFile();               // chain preset OUT — the project state chunk verbatim (.stridechain)
    void loadChainFromFile();             // chain preset IN — rides the project-open restore machinery
    void emitChainNote (const juce::String& title, const juce::String& detail);   // save/load feedback toast
    void toggleSynthWindow();
    void openOneSynthWindow (int node);   // open/raise just one device's window (per-chip ⛶)
   #if JUCE_WINDOWS
    void installKeyHook();                // forward Space/Return from hosted synth windows to the DAW
    void removeKeyHook();
   #endif
    void openMissingSynthWindows (int firstIndex = 0);   // auto-open a window per empty chain slot FROM firstIndex on (0 = "Synth UI", open everything)
    void handleStrideLinkSend (const juce::var& msg);
    void pushRackScanned();     // mapped lanes -> canvas (as the rack_scanned the UI expects)
    void pushUnmappedAt (int pos);   // touch-unmap: splice ONE lane on the canvas (no positional re-push -> lanes keep their ranges)
    void pushHostInfo();        // -> page: which DAW we're in. Gates the note-letter reservation (Ableton only —
                                //    in any other host we give the letters no note behavior, so swallowing them would be pure loss)
    void pushPrefs();           // native wrapper-prefs.json (favorites…) -> page on boot (localStorage is only a cache)
    void savePrefs (const juce::var& prefs);   // page -> write-through to wrapper-prefs.json (survives profile resets)
    void pushLearnState();      // -> wrapper toolbar Map button
    void pushKeysState();       // -> wrapper toolbar KEYS pill (MIDI keyswitch on/off)
    void pushPinState();        // -> title-bar pin buttons (which half-screen mode is active)
    void pushBridgeLanes();     // -> StrideBridge live-lane blob (the shim adopts it once the bridge link is up)

    // StrideBridge TCP link (:9102) is PROCESSOR-owned (BridgeLink.h): the page CANNOT
    // open the socket itself (WebView2 blocks localhost from the plugin page, verified on
    // the rig 2026-08-26), and the window must not be what wakes the lanes up. The editor
    // subscribes via proc.setBridgeSinks() while open and sends via proc.bridgeSend().
    void pushChainDevices();    // -> wrapper device chips (the deliberate per-device remove)
    void handleLicense (const juce::var& msg);   // license gate bridge (load/save/validate)
    void scanPluginsToWeb();    // -> Stride-styled plugin browser (the "+ Add" picker)

    StrideWrapperProcessor& proc;

    std::unique_ptr<juce::WebBrowserComponent> web;
    std::unique_ptr<juce::FileChooser> chooser;
    // Stride control-param relay (2026-08-07): last values SENT into the engine/canvas,
    // seeded from the params' current values on the first tick so opening an editor
    // never re-applies parked knob positions. Message thread only.
    float lastCtlSent[StrideWrapperProcessor::kControlCount] {};
    bool  ctlSeeded = false;

    struct HostedWindow;
    std::vector<std::unique_ptr<HostedWindow>> synthWindows;   // one per hosted chain node

    juce::String lastSummary;
    int          lastMapVersion = -1;
    // Alt+drag duplicate: where the copy will land in the chain. The insert happens ASYNC
    // (restoreNextDevice), so the timer's summary-change branch consumes this to insert a
    // nullptr window slot at the same position — keeping synthWindows aligned to the chain
    // without closing every open device window (the undoRemove clear-all approach would).
    // Deadline-stamped: a failed duplicate must not misalign the NEXT unrelated device add.
    int          pendingDupInsertAt = -1;
    juce::uint32 pendingDupSetMs = 0;
    bool         lastLearn      = false;   // so the Map button reflects EVERY learn-mode change (incl. auto-leave)
    bool         lastUnlearn    = false;   // same, for the Unmap button
    juce::uint32 lastTransportKeyMs = 0;   // forwardTransportKey debounce — one transport toggle per press
    int lastTickW = 0, lastTickH = 0;      // window-size settle detector (persist only once resizing stops)
    int savedW = 0, savedH = 0;            // last size written to wrapper-window.json
    bool lastDemoFrozen = false; int lastDemoSecs = -1; bool lastDemoPlaying = false;   // throttle for pushing the demo freeze/live state to the badge
    float lastPhSent = -1.0f; bool lastPhOn = false;   // playhead push change-detect (stopped transport = zero bridge traffic)
    juce::uint32 lastDirtyNotifyMs = 0;                // host setDirty throttle (one notify per 3s max)
    bool sdFullscreen = false; int preFsW = 0, preFsH = 0;   // fullscreen (maximize) toggle — remembers the pre-fullscreen size to restore
    juce::String pinMode;      // "" = unpinned / "bottom" / "side" (session-only, like fullscreen)
    int prePinW = 0, prePinH = 0;   // restore size for unpin (kept across pin->pin switches)
    // REPTILE MODE character zone: a plugin editor can't paint outside its bounds, so the
    // creature gets a strip at the TOP of the window and we grow the editor by exactly that
    // height - the canvas keeps its size instead of paying for the character. preRepH is the
    // height to fall back to on deactivate (session-only, same story as fullscreen/pin).
    int repZoneH = 0, preRepH = 0;
    // OPT-IN floating character window (see ReptileOverlay.h). Owned here, destroyed with
    // the editor. Null unless the user turns it on, so the default path is untouched.
    std::unique_ptr<class ReptileOverlay> repOverlay;
   #if JUCE_MAC
    void* lastForwardView = nullptr;       // the NSView WE registered with the key forwarder — the dtor unregisters exactly this (multi-instance safe)
   #endif
   #if JUCE_WINDOWS
    // First-open DPI nudge (1.3.0). Mixed-DPI setups (field: Shawn 2026-07-30; in-house
    // repro: the HP second screen 2026-08-03) open with the frame sized for one scale and
    // the first layout run at another — UI at exactly 80% with an L-shaped margin until
    // ANY resize replays the host scale handshake. So replay it ourselves once, ~200ms
    // after open: grow 1px for one tick, restore the next. phase 0 = waiting, 1 = grown,
    // 2 = done. Invisible; the size persistence is untouched (its settle detector waits
    // for stillness and the final size equals the original).
    int dpiNudgeTick = 0, dpiNudgePhase = 0, dpiNudgeH = 0;
   #endif
    int  demoSaveTick = 0;                                // persist the demo cycle every ~2s (move budget changes silently)
    int  licTick = 0;                                     // re-derive editLocked/driveAllowed natively ~every 2s (mid-session expiry)
    bool lastLicEntitled = true;                          // detect an entitled->expired transition to pop the ended overlay live

    JUCE_DECLARE_NON_COPYABLE_WITH_LEAK_DETECTOR (StrideWrapperEditor)
};
