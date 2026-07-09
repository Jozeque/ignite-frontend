// Crucible — parameter registry.
// All character params are 0..1 floats (like the M4L live.dials) so Stride's
// wrapper + host automation can drive every one of them. Defaults match the
// M4L device where the param existed there.
#pragma once
#include <juce_audio_processors/juce_audio_processors.h>
#include <vector>

namespace cru {

struct ParamDef { const char* id; const char* name; float def; };

// UI/section order. IDs are frozen — they are the automation identity.
inline const std::vector<ParamDef>& paramDefs()
{
    static const std::vector<ParamDef> defs = {
        // OSC — spectral morph (per voice)
        { "morph",      "Morph 1",     0.00f },
        { "morph2",     "Morph 2",     0.35f },
        { "pulsar",     "Pulsar",      0.00f },
        { "formant",    "Formant",     0.50f },
        { "rips",       "Rips",        0.00f },
        { "ripshape",   "Rip Shape",   0.30f },
        { "drift",      "Drift",       0.00f },
        { "stretch",    "Stretch",     0.50f },
        { "fractal",    "Fractal",     0.00f },
        // AMP — ADSR (per voice)
        { "attack",     "Attack",      0.02f },
        { "decay",      "Decay",       0.25f },
        { "sustain",    "Sustain",     0.70f },
        { "release",    "Release",     0.30f },
        // MODAL — resonator bank (per voice, keytracked)
        { "modal_res",  "Resonate",    0.00f },
        { "modal_tune", "Modal Tune",  0.00f },
        { "modal_ring", "Ring",        0.50f },
        // DRIVE v2 — typed shaper bank (bus); type itself is a choice param
        { "drive_amt",  "Drive",       0.00f },
        { "drive_morph","Drive Morph", 0.00f },
        { "drive_mix",  "Drive Mix",   1.00f },
        // GRIND — multiband crush + band-OTTs (bus)
        { "crush",      "Crush",       0.00f },
        { "grind",      "Grind",       0.00f },
        // METAL — keytracked comb resonator bank (new)
        { "metal",      "Metallize",   0.00f },
        { "material",   "Material",    0.35f },
        // SWARM — parallel moving filter bank (took the delay's slot)
        { "flt_mix",    "Filters Mix",   0.00f },
        { "flt_freq",   "Filters Freq",  0.50f },
        { "flt_rate",   "Filters Rate",  0.30f },
        { "flt_depth",  "Filters Depth", 0.40f },
        { "flt_shape",  "Filters Shape", 0.00f },
        // SPACE — shimmer FDN reverb (new)
        { "verb_space", "Space",       0.00f },
        { "verb_shimmer","Shimmer",    0.00f },
        // LOOP — global bounded feedback loop w/ frequency shifter (new)
        { "fb_amt",     "Feedback",    0.00f },
        { "fb_tone",    "FB Color",    0.50f },
        { "fb_time",    "FB Time",     0.25f },
        { "fb_shift",   "FB Shift",    0.50f },
        // FORGE — density + master shape (new)
        { "ott",        "Density",     0.00f },
        { "move",       "Move",        0.00f },
        { "width",      "Width",       0.00f },
        { "tilt",       "Tilt",        0.50f },
        { "out_drive",  "Output",      0.35f },
        { "mix",        "Mix",         1.00f },
    };
    return defs;
}

constexpr const char* kGainID     = "gain";
constexpr float       kGainDefDb  = -6.0f;

// per-stage power switches (default ON, host-automatable)
struct ToggleDef { const char* id; const char* name; };
inline const std::vector<ToggleDef>& toggleDefs()
{
    static const std::vector<ToggleDef> defs = {
        { "drive_on", "Drive On"   },
        { "grind_on", "Grind On"   },
        { "metal_on", "Metal On"   },
        { "flt_on",   "Filters On" },
        { "verb_on",  "Space On"   },
        { "fb_on",    "Loop On"    },
        { "ott_on",   "Density On" },
    };
    return defs;
}

constexpr const char* kDriveTypeID = "drive_type";
inline const juce::StringArray& driveTypeNames()
{
    static const juce::StringArray names { "Saturator", "Overdrive", "Downsample",
                                           "Rectifier", "Asym", "HardClip" };
    return names;
}

inline juce::AudioProcessorValueTreeState::ParameterLayout createParameterLayout()
{
    juce::AudioProcessorValueTreeState::ParameterLayout layout;
    for (const auto& d : paramDefs())
        layout.add(std::make_unique<juce::AudioParameterFloat>(
            juce::ParameterID { d.id, 1 }, d.name,
            juce::NormalisableRange<float>(0.0f, 1.0f, 0.0f), d.def));

    layout.add(std::make_unique<juce::AudioParameterChoice>(
        juce::ParameterID { kDriveTypeID, 1 }, "Drive Type", driveTypeNames(), 0));

    for (const auto& t : toggleDefs())
        layout.add(std::make_unique<juce::AudioParameterBool>(
            juce::ParameterID { t.id, 1 }, t.name, true));

    // voice modes
    layout.add(std::make_unique<juce::AudioParameterBool>(
        juce::ParameterID { "mono", 1 }, "Mono", false));
    layout.add(std::make_unique<juce::AudioParameterBool>(
        juce::ParameterID { "legato", 1 }, "Legato", false));

    layout.add(std::make_unique<juce::AudioParameterFloat>(
        juce::ParameterID { kGainID, 1 }, "Gain",
        juce::NormalisableRange<float>(-70.0f, 6.0f, 0.01f), kGainDefDb,
        juce::AudioParameterFloatAttributes().withLabel("dB")));
    return layout;
}

} // namespace cru
