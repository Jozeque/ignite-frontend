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
    void  forwardTransportKey (const juce::String& key);   // WebView Space/Return -> post to the host (play/stop)
   #endif

private:
    void timerCallback() override;
    void chooseAndLoad();
    void toggleSynthWindow();
    void openOneSynthWindow (int node);   // open/raise just one device's window (per-chip ⛶)
   #if JUCE_WINDOWS
    void installKeyHook();                // forward Space/Return from hosted synth windows to the DAW
    void removeKeyHook();
   #endif
    void openMissingSynthWindows();   // auto-open a window for each newly-added chain node
    void handleStrideLinkSend (const juce::var& msg);
    void pushRackScanned();     // mapped lanes -> canvas (as the rack_scanned the UI expects)
    void pushUnmappedAt (int pos);   // touch-unmap: splice ONE lane on the canvas (no positional re-push -> lanes keep their ranges)
    void pushLearnState();      // -> wrapper toolbar Map button
    void pushChainDevices();    // -> wrapper device chips (the deliberate per-device remove)
    void handleLicense (const juce::var& msg);   // license gate bridge (load/save/validate)
    void scanPluginsToWeb();    // -> Stride-styled plugin browser (the "+ Add" picker)

    StrideWrapperProcessor& proc;

    std::unique_ptr<juce::WebBrowserComponent> web;
    std::unique_ptr<juce::FileChooser> chooser;

    struct HostedWindow;
    std::vector<std::unique_ptr<HostedWindow>> synthWindows;   // one per hosted chain node

    juce::String lastSummary;
    int          lastMapVersion = -1;
    bool         lastLearn      = false;   // so the Map button reflects EVERY learn-mode change (incl. auto-leave)
    bool         lastUnlearn    = false;   // same, for the Unmap button
    int lastTickW = 0, lastTickH = 0;      // window-size settle detector (persist only once resizing stops)
    int savedW = 0, savedH = 0;            // last size written to wrapper-window.json
    bool lastDemoFrozen = false; int lastDemoSecs = -1; bool lastDemoPlaying = false;   // throttle for pushing the demo freeze/live state to the badge
    bool sdFullscreen = false; int preFsW = 0, preFsH = 0;   // fullscreen (maximize) toggle — remembers the pre-fullscreen size to restore
    int  demoSaveTick = 0;                                // persist the demo cycle every ~2s (move budget changes silently)
    int  licTick = 0;                                     // re-derive editLocked/driveAllowed natively ~every 2s (mid-session expiry)
    bool lastLicEntitled = true;                          // detect an entitled->expired transition to pop the ended overlay live

    JUCE_DECLARE_NON_COPYABLE_WITH_LEAK_DETECTOR (StrideWrapperEditor)
};
