#pragma once
#include <juce_gui_extra/juce_gui_extra.h>
#include "PluginProcessor.h"
#include <map>
#include <set>

class CrucibleEditor : public juce::AudioProcessorEditor,
                       private juce::Timer,
                       private juce::AudioProcessorValueTreeState::Listener
{
public:
    explicit CrucibleEditor(CrucibleProcessor&);
    ~CrucibleEditor() override;

    void paint(juce::Graphics&) override;
    void resized() override;

private:
    void parameterChanged(const juce::String& parameterID, float newValue) override;
    void timerCallback() override;
    void pushInit();
    void pushFrame();
    juce::var collectAllParams() const;
    void handleParamChanged(const juce::var& payload);

    CrucibleProcessor& proc;
    std::unique_ptr<juce::WebBrowserComponent> web;
    std::vector<juce::String> paramIDs;
    std::map<juce::String, int> paramIndex;
    std::vector<std::unique_ptr<std::atomic<bool>>> dirty;
    std::vector<float> ringCopy, winCopy;
    int midiScanDiv = 0;

    JUCE_DECLARE_NON_COPYABLE_WITH_LEAK_DETECTOR(CrucibleEditor)
};
