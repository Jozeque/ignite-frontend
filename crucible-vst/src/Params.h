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
        // ---- appended (keep order: PIdx in PluginProcessor.cpp mirrors it) ----
        // OSC A/B mixer + FM (bipolar: center off, right A→B, left B→A)
        { "osca_vol",   "Osc A Vol",    1.00f },
        { "oscb_vol",   "Osc B Vol",    1.00f },
        { "fm",         "FM",           0.50f },
        // sync delay
        { "dly_mix",    "Delay Mix",    0.00f },
        { "dly_time",   "Delay Time",   0.40f },
        { "dly_fb",     "Delay FB",     0.35f },
        // master filter (Serum-style, pre-drive)
        { "filt_cutoff","Cutoff",       1.00f },
        { "filt_res",   "Resonance",    0.15f },
        { "filt_mix",   "Filter Mix",   1.00f },
        // drive focus filter (what gets driven)
        { "drv_flt_cut","Drive F Cut",  0.50f },
        { "drv_flt_res","Drive F Res",  0.10f },
        // per-osc amp envelopes: existing attack/decay/sustain/release = OSC A
        { "curve",      "A Curve",      0.50f },
        { "attack_b",   "B Attack",     0.02f },
        { "decay_b",    "B Decay",      0.25f },
        { "sustain_b",  "B Sustain",    0.70f },
        { "release_b",  "B Release",    0.30f },
        { "curve_b",    "B Curve",      0.50f },
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
        { "dly_on",   "Delay On"   },
        { "filt_on",  "Filter On"  },
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

inline const juce::StringArray& waveNames()
{
    static const juce::StringArray n { "Sine", "Triangle", "Square", "Saw" };
    return n;
}
inline const juce::StringArray& octaveNames()
{
    static const juce::StringArray n { "-2", "-1", "0", "+1", "+2" };
    return n;
}
inline const juce::StringArray& syncNames()
{
    static const juce::StringArray n { "Free", "1/1", "1/2", "1/2 D", "1/2 T",
                                       "1/4", "1/4 D", "1/4 T", "1/8", "1/8 D", "1/8 T",
                                       "1/16", "1/16 D", "1/16 T", "1/32" };
    return n;
}
// beat multipliers per syncNames index (index 0 = free/unused)
inline const float* syncBeats()
{
    static const float b[15] = { 0.0f, 4.0f, 2.0f, 3.0f, 4.0f / 3.0f,
                                 1.0f, 1.5f, 2.0f / 3.0f, 0.5f, 0.75f, 1.0f / 3.0f,
                                 0.25f, 0.375f, 1.0f / 6.0f, 0.125f };
    return b;
}
inline const juce::StringArray& filterTypeNames()
{
    static const juce::StringArray n { "LP 12", "LP 24", "BP", "HP", "Notch" };
    return n;
}
inline const juce::StringArray& driveFocusNames()
{
    static const juce::StringArray n { "All", "Low", "Band", "High" };
    return n;
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
    layout.add(std::make_unique<juce::AudioParameterChoice>(
        juce::ParameterID { "osca_wave", 1 }, "Osc A Wave", waveNames(), 0));
    layout.add(std::make_unique<juce::AudioParameterChoice>(
        juce::ParameterID { "oscb_wave", 1 }, "Osc B Wave", waveNames(), 0));
    layout.add(std::make_unique<juce::AudioParameterChoice>(
        juce::ParameterID { "osca_oct", 1 }, "Osc A Octave", octaveNames(), 2));
    layout.add(std::make_unique<juce::AudioParameterChoice>(
        juce::ParameterID { "oscb_oct", 1 }, "Osc B Octave", octaveNames(), 2));
    layout.add(std::make_unique<juce::AudioParameterChoice>(
        juce::ParameterID { "dly_sync", 1 }, "Delay Sync", syncNames(), 0));
    layout.add(std::make_unique<juce::AudioParameterChoice>(
        juce::ParameterID { "filt_type", 1 }, "Filter Type", filterTypeNames(), 0));
    layout.add(std::make_unique<juce::AudioParameterChoice>(
        juce::ParameterID { "drv_flt_type", 1 }, "Drive Focus", driveFocusNames(), 0));

    for (const auto& t : toggleDefs())
        layout.add(std::make_unique<juce::AudioParameterBool>(
            juce::ParameterID { t.id, 1 }, t.name, true));

    // voice modes + osc powers + delay ping-pong
    layout.add(std::make_unique<juce::AudioParameterBool>(
        juce::ParameterID { "mono", 1 }, "Mono", false));
    layout.add(std::make_unique<juce::AudioParameterBool>(
        juce::ParameterID { "legato", 1 }, "Legato", false));
    layout.add(std::make_unique<juce::AudioParameterBool>(
        juce::ParameterID { "osca_on", 1 }, "Osc A On", true));
    layout.add(std::make_unique<juce::AudioParameterBool>(
        juce::ParameterID { "oscb_on", 1 }, "Osc B On", true));
    layout.add(std::make_unique<juce::AudioParameterBool>(
        juce::ParameterID { "dly_pp", 1 }, "Delay Ping-Pong", false));

    layout.add(std::make_unique<juce::AudioParameterFloat>(
        juce::ParameterID { kGainID, 1 }, "Gain",
        juce::NormalisableRange<float>(-70.0f, 6.0f, 0.01f), kGainDefDb,
        juce::AudioParameterFloatAttributes().withLabel("dB")));
    return layout;
}

} // namespace cru
