#pragma once
#include <juce_audio_processors/juce_audio_processors.h>
#include <vector>
#include <cmath>

// ============================================================
// TENDRIL — parameter contract (C++ mirror of tendril-params.js)
// ============================================================
// ORDER IS THE API. Stride targets parameters by position. Append only,
// never insert. These become VST3 automatable params (proper floats, so
// no Bool/Int "on/off" problem — that was an Ableton-M4L-specific issue).
// ============================================================
namespace tendril {

struct ParamSpec {
    const char* id;     // stable param id (== scripting name)
    const char* name;   // display label (Stride lane name)
    float min, max, def;
    bool  isLog;        // skew toward low end (freq / time params)
    bool  noteDisplay = false; // show value as a musical note (C0..C2) — tuned delay
};

inline const std::vector<ParamSpec>& specs()
{
    static const std::vector<ParamSpec> s = {
        // GLOBAL
        {"pitch",        "Pitch",          -24.f, 24.f, 0.f,   false},
        {"glide",        "Glide",            0.f,  1.f, 0.05f, true },
        {"cutoff",       "Filter Cutoff",    0.f,  1.f, 0.70f, true },
        {"reso",         "Filter Reso",      0.f,  1.f, 0.20f, false},
        // OSC A
        {"a_tone",       "A Tone",           0.f,  1.f, 0.50f, false},
        {"a_body",       "A Body",           0.f,  1.f, 0.50f, false},
        {"a_air",        "A Air",            0.f,  1.f, 0.50f, false},
        {"a_bank",       "A Bank",           0.f,  1.f, 0.00f, false},
        {"a_level",      "A Level",          0.f,  1.f, 0.85f, false},
        {"a_oct",        "A Octave",        -2.f,  2.f, 0.f,   false},
        {"a_fine",       "A Fine",         -50.f, 50.f, 0.f,   false},
        // OSC B
        {"b_tone",       "B Tone",           0.f,  1.f, 0.50f, false},
        {"b_body",       "B Body",           0.f,  1.f, 0.50f, false},
        {"b_air",        "B Air",            0.f,  1.f, 0.50f, false},
        {"b_bank",       "B Bank",           0.f,  1.f, 0.40f, false},
        {"b_level",      "B Level",          0.f,  1.f, 0.50f, false},
        {"b_oct",        "B Octave",        -2.f,  2.f, 0.f,   false},
        {"b_fine",       "B Fine",         -50.f, 50.f, 0.f,   false},
        // CROSS-MOD
        {"fm_amt",       "FM Amount",        0.f,  1.f, 0.00f, false},
        {"ring_amt",     "Ring Amount",      0.f,  1.f, 0.00f, false},
        {"sync_amt",     "Sync",             0.f,  1.f, 0.00f, false},
        {"sub_lvl",      "Sub Level",        0.f,  1.f, 0.30f, false},
        {"noise_lvl",    "Noise Level",      0.f,  1.f, 0.00f, false},
        // SPECTRAL
        {"density",      "Density",          0.f,  1.f, 0.15f, false},
        {"comb",         "Comb",             0.f,  1.f, 0.00f, false},
        {"fold_amt",     "Fold",             0.f,  1.f, 0.00f, false},
        {"tilt",         "Tilt",             0.f,  1.f, 0.50f, false},
        {"formant",      "Formant",          0.f,  1.f, 0.00f, false},
        {"warp",         "Warp",             0.f,  1.f, 0.00f, false},
        // FX MODULE MACROS
        {"fx_reson",     "Resonate",         0.f,  1.f, 0.00f, false},
        {"fx_resontune", "Reson Tune",       0.f,  1.f, 0.50f, true },
        {"fx_drive",     "Drive",            0.f,  1.f, 0.00f, false},
        {"fx_drivechar", "Drive Char",       0.f,  1.f, 0.50f, false},
        {"fx_crush",     "Crush",            0.f,  1.f, 0.00f, false},
        {"fx_crushrate", "Crush Rate",       0.f,  1.f, 1.00f, true },
        {"fx_glue",      "Glue Amount",      0.f,  1.f, 0.00f, false},
        {"fx_spacesize", "Space Size",       0.f,  1.f, 0.40f, false},
        {"fx_spacemix",  "Space Mix",        0.f,  1.f, 0.20f, false},
        {"fx_motionfb",  "Motion Fb",        0.f,  1.f, 0.00f, false},
        {"fx_motiontime","Motion Time",      0.f,  1.f, 0.30f, true },
        {"env_mod",      "Amp Env Mod",      0.f,  1.f, 0.50f, false},
        // FX ROUTING
        {"fx_blend",     "Parallel Blend",   0.f,  1.f, 0.50f, false},
        {"fx_fbamt",     "Feedback Amount",  0.f, 0.98f,0.00f, false},
        {"rsv1",         "Reserved 1",       0.f,  1.f, 0.00f, false},
        {"rsv2",         "Reserved 2",       0.f,  1.f, 0.00f, false},
        // META MACROS
        {"macro1",       "Macro 1",          0.f,  1.f, 0.00f, false},
        {"macro2",       "Macro 2",          0.f,  1.f, 0.00f, false},
        {"macro3",       "Macro 3",          0.f,  1.f, 0.00f, false},
        {"macro4",       "Macro 4",          0.f,  1.f, 0.00f, false},
        // --- focus-v1 additions (FX character + tuned note-delay + output) ---
        {"filter_char",  "Filter Character", 0.f,  1.f, 0.30f, false},
        {"delay_note",   "Delay Note",       0.f, 24.f, 12.0f, false, true}, // C0..C2, snaps to semitone
        {"delay_mix",    "Delay Mix",        0.f,  1.f, 0.00f, false},
        {"output",       "Output",           0.f,  1.5f,1.00f, false},
        // --- spectral-morphing-osc spec (append-only; all Stride lanes) ---
        {"spread",       "Spread",           0.f,  1.f, 1.00f, false},  // active band width
        {"skew",         "Skew",             0.f,  1.f, 0.50f, false},  // energy center
        {"scene_morph",  "Scene Morph",      0.f,  1.f, 0.00f, false},  // across the 5 scenes
        {"rules_amt",    "Rules Amount",     0.f,  1.f, 0.00f, false},  // inter-harmonic cascade
        {"gest_amt",     "Gesture Amount",   0.f,  1.f, 0.50f, false},  // recorded-drawing blend (audible loop by default)
        {"gest_rate",    "Gesture Rate",     0.f,  1.f, 0.50f, false},  // 0.25x .. 4x loop speed
        {"fx_order",     "FX Order",         0.f,  1.f, 0.00f, false},  // Mingle: scramble chain order
        {"motion_depth", "Motion Depth",     0.f,  1.f, 0.50f, false},  // global motion-injection depth
        // --- amp envelope (per-note shape; Stride-automatable like everything else) ---
        {"amp_attack",   "Amp Attack",       0.f,  1.f, 0.04f, true },  // ~1ms .. 3s
        {"amp_decay",    "Amp Decay",        0.f,  1.f, 0.30f, true },
        {"amp_sustain",  "Amp Sustain",      0.f,  1.f, 0.70f, false},
        {"amp_release",  "Amp Release",      0.f,  1.f, 0.30f, true },  // .. 4s
    };
    return s;
}

// musical-note name for the tuned delay (semitone index 0..24 -> C0..C2)
inline juce::String noteName(float v)
{
    static const char* nm[] = {"C","C#","D","D#","E","F","F#","G","G#","A","A#","B"};
    const int s = (int) std::lround(juce::jlimit(0.0f, 24.0f, v));
    return juce::String(nm[s % 12]) + juce::String(s / 12);
}

inline juce::AudioProcessorValueTreeState::ParameterLayout createLayout()
{
    juce::AudioProcessorValueTreeState::ParameterLayout layout;

    for (const auto& p : specs())
    {
        if (p.noteDisplay)
        {
            // snap to semitones (interval 1) and display the note name
            juce::NormalisableRange<float> range(p.min, p.max, 1.0f);
            layout.add(std::make_unique<juce::AudioParameterFloat>(
                juce::ParameterID{p.id, 1}, p.name, range, p.def,
                juce::AudioParameterFloatAttributes()
                    .withStringFromValueFunction([](float v, int){ return noteName(v); })));
            continue;
        }

        juce::NormalisableRange<float> range(p.min, p.max);
        if (p.isLog)
            range.setSkewForCentre(p.min + (p.max - p.min) * 0.2f); // perceptual skew

        layout.add(std::make_unique<juce::AudioParameterFloat>(
            juce::ParameterID{p.id, 1}, p.name, range, p.def));
    }

    // Selectors (hand-set, not Stride lanes)
    layout.add(std::make_unique<juce::AudioParameterChoice>(
        juce::ParameterID{"ftype", 1}, "Filter Type",
        juce::StringArray{"LP24","LP12","HP","BP","Notch","Peak"}, 0));
    layout.add(std::make_unique<juce::AudioParameterChoice>(
        juce::ParameterID{"dtype", 1}, "Distortion Type",
        juce::StringArray{"Tube","Tape","Diode","Wavefold","Foldback","HardClip","Sine","Asym","Grit"}, 0));
    layout.add(std::make_unique<juce::AudioParameterChoice>(
        juce::ParameterID{"rmode", 1}, "Rule Mode",
        juce::StringArray{"Spread","OddEven","Conserve"}, 0));

    // --- Motion (the built-in Stride) ---
    layout.add(std::make_unique<juce::AudioParameterChoice>(
        juce::ParameterID{"motion_type", 1}, "Motion Type",
        juce::StringArray{"Reflector","S&H","Neuro","Chaos"}, 0));
    layout.add(std::make_unique<juce::AudioParameterChoice>(
        juce::ParameterID{"motion_length", 1}, "Motion Length",
        juce::StringArray{"4","8","16","32"}, 1));
    layout.add(std::make_unique<juce::AudioParameterChoice>(
        juce::ParameterID{"motion_rate", 1}, "Motion Rate",
        juce::StringArray{"0.5X","1X","2X"}, 1));
    layout.add(std::make_unique<juce::AudioParameterChoice>(
        juce::ParameterID{"motion_on", 1}, "Motion On",
        juce::StringArray{"Off","On"}, 0));

    return layout;
}

} // namespace tendril
