#pragma once
#include <juce_audio_processors/juce_audio_processors.h>
#include <juce_gui_extra/juce_gui_extra.h>
#include "PluginProcessor.h"
#include <vector>
#include <memory>

// ============================================================
// TENDRIL editor — JUCE 8 WebView UI (Patchbay skin, embedded HTML)
//
// Bridge (events both ways, no external JS framework):
//   page -> C++ : "uiReady" {}                       -> editor pushes init
//                 "paramChanged" {id,value,phase}    -> setValueNotifyingHost
//                 "routingChanged" {a:[..],b:[..]}   -> processor.applyRoutingVar
//   C++ -> page : "init"   {params:{id:norm,..}, routing:"json"}
//                 "params" {id:norm,..}              (30 Hz diff push)
// Falls back to the generic editor if the WebView can't be created.
// ============================================================
class TendrilEditor : public juce::AudioProcessorEditor,
                      private juce::Timer,
                      private juce::AudioProcessorValueTreeState::Listener
{
public:
    explicit TendrilEditor(TendrilProcessor&);
    ~TendrilEditor() override;

    void paint(juce::Graphics&) override;
    void resized() override;

private:
    void timerCallback() override;
    void parameterChanged(const juce::String& parameterID, float newValue) override;

    void handleParamChanged(const juce::var& payload);
    void handleRoutingChanged(const juce::var& payload);
    void pushInit();
    juce::var collectAllParams() const;

    TendrilProcessor& proc;
    std::unique_ptr<juce::WebBrowserComponent> web;
    std::unique_ptr<juce::GenericAudioProcessorEditor> fallback;

    std::vector<juce::String> paramIDs;
    std::unordered_map<juce::String, int> paramIndex;
    std::vector<std::unique_ptr<std::atomic<bool>>> dirty;
    int specDiv = 0;        // divider for the spectrum push
    bool modWasOn = false;  // motion-viz: emit one clearing push when motion turns off

    JUCE_DECLARE_NON_COPYABLE_WITH_LEAK_DETECTOR(TendrilEditor)
};
