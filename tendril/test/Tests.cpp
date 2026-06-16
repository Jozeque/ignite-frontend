// ============================================================
// TENDRIL — headless test suite (console app)
// Run: build target TendrilTests, execute the exe; exit 0 = all green.
// Covers: wavetable load, note names, Stride 49-param contract order,
// render sanity, all-param sweep (finite/bounded), tuned-delay echo
// timing, routing parse + parallel processing, state round-trip,
// polyphony, glide, master soft-limit ceiling.
// ============================================================
#include "../src/PluginProcessor.h"
#include "../src/SpectralModel.h"
#include <iostream>
#include <cmath>
#include <vector>
#include <cstdio>
#include <memory>

static int failures = 0;
static int passes   = 0;
#define CHECK(cond, msg) do { \
    if (cond) { ++passes;   std::cout << "  ok   " << msg << "\n"; } \
    else      { ++failures; std::cout << "  FAIL " << msg << "\n"; } } while (0)

// ---------- helpers ----------
static constexpr double kSR = 48000.0;
static constexpr int    kBlock = 512;

static void renderBlocks(TendrilProcessor& p, juce::AudioBuffer<float>& out,
                         int numBlocks, juce::MidiBuffer* firstBlockMidi = nullptr)
{
    out.setSize(2, numBlocks * kBlock);
    out.clear();
    juce::AudioBuffer<float> blk(2, kBlock);
    for (int b = 0; b < numBlocks; ++b)
    {
        blk.clear();
        juce::MidiBuffer midi;
        if (b == 0 && firstBlockMidi != nullptr) midi = *firstBlockMidi;
        p.processBlock(blk, midi);
        for (int c = 0; c < 2; ++c)
            out.copyFrom(c, b * kBlock, blk, c, 0, kBlock);
    }
}

static bool allFinite(const juce::AudioBuffer<float>& b)
{
    for (int c = 0; c < b.getNumChannels(); ++c)
    {
        const float* d = b.getReadPointer(c);
        for (int i = 0; i < b.getNumSamples(); ++i)
            if (!std::isfinite(d[i])) return false;
    }
    return true;
}

static float peakOf(const juce::AudioBuffer<float>& b)
{
    float pk = 0.f;
    for (int c = 0; c < b.getNumChannels(); ++c)
        pk = juce::jmax(pk, b.getMagnitude(c, 0, b.getNumSamples()));
    return pk;
}

static void setNorm(TendrilProcessor& p, const char* id, float norm)
{
    if (auto* par = p.apvts.getParameter(id))
        par->setValueNotifyingHost(juce::jlimit(0.f, 1.f, norm));
}

static juce::MidiBuffer noteOnBuf(int note, int vel = 100)
{
    juce::MidiBuffer mb;
    mb.addEvent(juce::MidiMessage::noteOn(1, note, (juce::uint8) vel), 0);
    return mb;
}

// ============================================================
int main()
{
    std::cout << std::unitbuf;   // unbuffered: last printed line survives a crash
    juce::ScopedJuceInitialiser_GUI juceInit;
    std::cout << "TENDRIL test suite\n==================\n";

    // ---- 1. spectrum engine + partial renderer core ----
    {
        std::cout << "[spectrum engine]\n";
        auto hostUP = std::make_unique<TendrilProcessor>(); auto& host = *hostUP;                  // provides the APVTS the engine reads
        auto& eng = host.spectrum;
        eng.processBlock(kSR, kBlock);

        PartialOsc osc;
        osc.update(eng, 110.0f / 48000.0f);
        osc.startBlock(512);
        bool fin = true; float pk = 0.f;
        for (int i = 0; i < 2048; ++i)
        {
            const float s = osc.read((float)(i % 512) / 512.0f);
            if (!std::isfinite(s)) fin = false;
            pk = juce::jmax(pk, std::abs(s));
        }
        CHECK(fin, "rendered cycle finite");
        CHECK(pk > 0.005f && pk < 1.5f, "rendered cycle audible & bounded");

        // high note: band-limit must hold with hot macros
        setNorm(host, "density", 1.0f); setNorm(host, "comb", 1.0f);
        setNorm(host, "tilt", 1.0f);
        eng.processBlock(kSR, kBlock);
        osc.update(eng, 2000.0f / 48000.0f);
        osc.startBlock(512);
        fin = true;
        for (int i = 0; i < 1024; ++i)
            if (!std::isfinite(osc.read((float)(i % 512) / 512.0f))) fin = false;
        CHECK(fin, "high-note band-limited regen finite");
    }

    // ---- 1b. scenes: paint, morph, persistence ----
    {
        std::cout << "[scenes]\n";
        auto hostUP = std::make_unique<TendrilProcessor>(); auto& host = *hostUP;
        auto& eng = host.spectrum;

        // paint scene 0 (no rules), then check it lands
        setNorm(host, "rules_amt", 0.0f);
        eng.selectScene(0);
        eng.paintPartial(4, 0.9f);
        float snap[SpectrumEngine::NP];
        eng.getSceneSnapshot(snap);
        CHECK(std::abs(snap[4] - 0.9f) < 1.0e-4f, "paint writes the partial");

        // morph across scenes renders finite & audible
        host.prepareToPlay(kSR, kBlock);
        for (float m : { 0.0f, 0.4f, 1.0f })
        {
            setNorm(host, "scene_morph", m);
            auto mb = noteOnBuf(48);
            juce::AudioBuffer<float> out;
            renderBlocks(host, out, 5, &mb);
            CHECK(allFinite(out) && peakOf(out) > 1.0e-4f && peakOf(out) <= 1.01f,
                  ("scene morph " + juce::String(m, 1) + " renders").toStdString());
        }

        // persistence round-trip
        const auto s = eng.scenesToString();
        eng.paintPartial(4, 0.1f);
        eng.scenesFromString(s);
        eng.getSceneSnapshot(snap);
        CHECK(std::abs(snap[4] - 0.9f) < 1.0e-3f, "scenes survive state round-trip");
    }

    // ---- 1c. inter-harmonic rules ----
    {
        std::cout << "[rules]\n";
        auto hostUP = std::make_unique<TendrilProcessor>(); auto& host = *hostUP;
        auto& eng = host.spectrum;

        // CONSERVE: pushing one partial up takes energy from the others
        setNorm(host, "rules_amt", 1.0f);
        setNorm(host, "rmode", 1.0f);            // 3 options -> norm 1.0 = Conserve
        host.modHub.copyBase();                  // sync eff<-base (audio block does this live)
        float before[SpectrumEngine::NP];
        eng.getSceneSnapshot(before);
        float sumBefore = 0.f; for (float v : before) sumBefore += v;
        eng.paintPartial(10, 0.95f);
        float after[SpectrumEngine::NP];
        eng.getSceneSnapshot(after);
        float others = 0.f, othersBefore = 0.f;
        for (int k = 0; k < SpectrumEngine::NP; ++k)
            if (k != 10) { others += after[k]; othersBefore += before[k]; }
        CHECK(others < othersBefore, "conserve rule trades energy from neighbors");

        // SPREAD: neighbors follow
        setNorm(host, "rmode", 0.0f);
        host.modHub.copyBase();
        eng.getSceneSnapshot(before);
        eng.paintPartial(40, 0.95f);
        eng.getSceneSnapshot(after);
        CHECK(after[39] > before[39] && after[41] > before[41], "spread rule pulls neighbors");
    }

    // ---- 1d. gesture record/replay ----
    {
        std::cout << "[gesture]\n";
        auto hostUP = std::make_unique<TendrilProcessor>(); auto& host = *hostUP;
        host.prepareToPlay(kSR, kBlock);
        auto& eng = host.spectrum;

        eng.setGestureRecord(true);
        for (int b = 0; b < 30; ++b)            // ~0.32s of capture
        {
            eng.paintPartial(b % SpectrumEngine::NP, 0.2f + 0.6f * (b % 3) / 2.0f);
            eng.processBlock(kSR, kBlock);
        }
        eng.setGestureRecord(false);
        CHECK(eng.gestureFrames() > 3, "gesture frames captured");

        eng.setGesturePlay(true);
        setNorm(host, "gest_amt", 1.0f);
        auto mb = noteOnBuf(50);
        juce::AudioBuffer<float> out;
        renderBlocks(host, out, 6, &mb);
        CHECK(allFinite(out) && peakOf(out) <= 1.01f, "gesture replay renders finite & limited");
    }

    // ---- 2. note names (tuned delay display) ----
    {
        std::cout << "[note names]\n";
        CHECK(tendril::noteName(0.f)  == "C0",  "0 -> C0");
        CHECK(tendril::noteName(12.f) == "C1",  "12 -> C1");
        CHECK(tendril::noteName(24.f) == "C2",  "24 -> C2");
        CHECK(tendril::noteName(13.f) == "C#1", "13 -> C#1");
        CHECK(tendril::noteName(7.f)  == "G0",  "7 -> G0");
    }

    // ---- 3. Stride contract: first 49 param ids, exact order ----
    {
        std::cout << "[stride contract]\n";
        static const char* expected[49] = {
            "pitch","glide","cutoff","reso",
            "a_tone","a_body","a_air","a_bank","a_level","a_oct","a_fine",
            "b_tone","b_body","b_air","b_bank","b_level","b_oct","b_fine",
            "fm_amt","ring_amt","sync_amt","sub_lvl","noise_lvl",
            "density","comb","fold_amt","tilt","formant","warp",
            "fx_reson","fx_resontune","fx_drive","fx_drivechar","fx_crush","fx_crushrate",
            "fx_glue","fx_spacesize","fx_spacemix","fx_motionfb","fx_motiontime","env_mod",
            "fx_blend","fx_fbamt","rsv1","rsv2",
            "macro1","macro2","macro3","macro4" };
        const auto& sp = tendril::specs();
        bool orderOk = sp.size() >= 49;
        for (int i = 0; i < 49 && orderOk; ++i)
            orderOk = (juce::String(sp[(size_t) i].id) == expected[i]);
        CHECK(orderOk, "first 49 spec ids match the frozen Stride order");

        auto procUP = std::make_unique<TendrilProcessor>(); auto& proc = *procUP;
        int withID = 0;
        for (auto* ap : proc.getParameters())
            if (dynamic_cast<juce::AudioProcessorParameterWithID*>(ap)) ++withID;
        CHECK(withID >= 55, "all params exposed to host (49 + additions + 2 selectors)");
    }

    // ---- 4. silence with no input ----
    {
        std::cout << "[silence]\n";
        auto procUP = std::make_unique<TendrilProcessor>(); auto& proc = *procUP;
        proc.prepareToPlay(kSR, kBlock);
        juce::AudioBuffer<float> out;
        renderBlocks(proc, out, 6);
        CHECK(allFinite(out), "no-input render finite");
        CHECK(peakOf(out) < 1.0e-6f, "no notes -> digital silence");
    }

    // ---- 5. renders audio on noteOn ----
    {
        std::cout << "[render]\n";
        auto procUP = std::make_unique<TendrilProcessor>(); auto& proc = *procUP;
        proc.prepareToPlay(kSR, kBlock);
        auto mb = noteOnBuf(48);
        juce::AudioBuffer<float> out;
        renderBlocks(proc, out, 10, &mb);
        CHECK(allFinite(out), "render finite");
        const float pk = peakOf(out);
        CHECK(pk > 1.0e-4f, "audible output on noteOn");
        CHECK(pk <= 1.01f,  "master ceiling respected (<= 1.0)");
    }

    // ---- 5b. aliasing: spectral purity measurement ----
    // Render a steady note, FFT it, mask everything that belongs to the
    // harmonic series of f0, and measure what's left. Aliased/imaged junk
    // is inharmonic, so it lands in the residual. dB-quantified guard.
    {
        std::cout << "[aliasing]\n";
        auto residualDb = [](int note, float warpNorm, float tiltNorm) -> double
        {
            auto pUP = std::make_unique<TendrilProcessor>(); auto& p = *pUP;
            p.prepareToPlay(kSR, kBlock);
            // neutralize everything around the bare oscillator
            setNorm(p, "cutoff", 1.0f); setNorm(p, "reso", 0.0f); setNorm(p, "filter_char", 0.0f);
            setNorm(p, "fx_drive", 0.0f); setNorm(p, "fx_crush", 0.0f); setNorm(p, "fx_reson", 0.0f);
            setNorm(p, "fx_spacemix", 0.0f); setNorm(p, "delay_mix", 0.0f); setNorm(p, "fx_motionfb", 0.0f);
            setNorm(p, "sub_lvl", 0.0f); setNorm(p, "noise_lvl", 0.0f); setNorm(p, "fold_amt", 0.0f);
            setNorm(p, "glide", 0.0f);
            setNorm(p, "output", 1.0f / 1.5f);
            setNorm(p, "tilt", tiltNorm);          // bright = worst case
            setNorm(p, "density", 0.7f);
            setNorm(p, "warp", warpNorm);

            auto mb = noteOnBuf(note);
            juce::AudioBuffer<float> out;
            renderBlocks(p, out, 36, &mb);          // long render -> fully steady tail

            constexpr int NFFT = 8192;
            const int off = out.getNumSamples() - NFFT;
            const float* d = out.getReadPointer(0);
            std::vector<float> fb(2 * NFFT, 0.0f);
            for (int i = 0; i < NFFT; ++i)
            {
                const float w = 0.5f * (1.0f - std::cos(2.0f * juce::MathConstants<float>::pi * i / (NFFT - 1)));
                fb[(size_t) i] = d[off + i] * w;
            }
            juce::dsp::FFT fft(13);
            fft.performRealOnlyForwardTransform(fb.data());

            const double f0 = 440.0 * std::pow(2.0, (note - 69) / 12.0);
            const double f0bin = f0 * NFFT / kSR;
            double tot = 1.0e-12, res = 1.0e-12;
            for (int b = 6; b < NFFT / 2; ++b)
            {
                const double re = fb[(size_t)(2 * b)], im = fb[(size_t)(2 * b + 1)];
                const double m = re * re + im * im;
                tot += m;
                const double kf = (double) b / f0bin;
                const double distBins = std::abs(kf - std::round(kf)) * f0bin;
                if (distBins > 3.0) res += m;       // not near any harmonic -> residual
            }
            return 10.0 * std::log10(res / tot);
        };

        const double dMid  = residualDb(84, 0.0f, 0.8f);   // C6, bright, no warp
        const double dHigh = residualDb(96, 0.0f, 0.8f);   // C7, bright, no warp
        const double dWarp = residualDb(84, 1.0f, 0.8f);   // C6, full warp
        CHECK(dMid  < -25.0, ("C6 bright inharmonic residual " + juce::String(dMid, 1)  + " dB (< -25)").toStdString());
        CHECK(dHigh < -25.0, ("C7 bright inharmonic residual " + juce::String(dHigh, 1) + " dB (< -25)").toStdString());
        CHECK(dWarp < -20.0, ("C6 full-warp inharmonic residual " + juce::String(dWarp, 1) + " dB (< -20)").toStdString());
    }

    // ---- 6. all-param sweep: min/def/max each, while holding a note ----
    {
        std::cout << "[param sweep]\n";
        auto procUP = std::make_unique<TendrilProcessor>(); auto& proc = *procUP;
        proc.prepareToPlay(kSR, kBlock);
        bool sweepOk = true;
        juce::String firstBad;
        for (auto* ap : proc.getParameters())
        {
            auto* par = dynamic_cast<juce::AudioProcessorParameterWithID*>(ap);
            if (par == nullptr) continue;
            const float prev = par->getValue();
            for (float v : { 0.0f, 0.5f, 1.0f })
            {
                par->setValueNotifyingHost(v);
                auto mb = noteOnBuf(52);
                juce::AudioBuffer<float> out;
                renderBlocks(proc, out, 4, &mb);
                if (!allFinite(out) || peakOf(out) > 2.0f)
                {
                    sweepOk = false;
                    if (firstBad.isEmpty())
                        firstBad = par->paramID + " @ " + juce::String(v, 2);
                }
            }
            par->setValueNotifyingHost(prev);
        }
        CHECK(sweepOk, juce::String("every param min/mid/max stays finite & bounded")
                         .toStdString() + (sweepOk ? "" : ("  [first bad: " + firstBad.toStdString() + "]")));
    }

    // ---- 7. tuned delay: echo lands at the note period (C1) ----
    {
        std::cout << "[tuned delay]\n";
        auto procUP = std::make_unique<TendrilProcessor>(); auto& proc = *procUP;          // host for the APVTS
        ModHub hub; hub.bind(proc.apvts);
        TendrilFX fxu;
        fxu.setState(hub);
        fxu.prepare(kSR, 1024, 2);

        // neutralize everything around the delay
        setNorm(proc, "cutoff", 1.0f);          // filter wide open
        setNorm(proc, "reso",   0.0f);
        setNorm(proc, "filter_char", 0.0f);
        setNorm(proc, "fx_drive", 0.0f);
        setNorm(proc, "fx_crush", 0.0f);
        setNorm(proc, "fx_spacemix", 0.0f);
        setNorm(proc, "fx_reson", 0.0f);
        setNorm(proc, "fx_motionfb", 0.0f);
        setNorm(proc, "delay_mix", 1.0f);       // wet only
        setNorm(proc, "output", 1.0f / 1.5f);   // unity (range 0..1.5)
        setNorm(proc, "delay_note", 12.0f / 24.0f);   // C1 = 32.7032 Hz
        hub.copyBase();                          // push apvts values into eff (fxu reads eff)

        const int N = 4096;
        juce::AudioBuffer<float> buf(2, N);
        buf.clear();
        buf.setSample(0, 0, 1.0f); buf.setSample(1, 0, 1.0f);

        // process in chunks like a host
        for (int pos = 0; pos < N; pos += 1024)
        {
            juce::AudioBuffer<float> view(buf.getArrayOfWritePointers(), 2, pos, 1024);
            fxu.process(view);
        }

        const double expect = (1000.0 / 32.7032) * kSR / 1000.0;   // ~1467.7 samples
        int firstIdx = -1;
        const float* d = buf.getReadPointer(0);
        for (int i = 16; i < N; ++i)
            if (std::abs(d[i]) > 1.0e-3f) { firstIdx = i; break; }

        CHECK(firstIdx > 0, "delay produces a wet echo");
        CHECK(firstIdx > 0 && std::abs(firstIdx - expect) <= 8.0,
              ("echo at note period (got " + juce::String(firstIdx)
               + ", expect ~" + juce::String((int) expect) + ")").toStdString());
    }

    // ---- 8. routing: parse, reorder, parallel ----
    {
        std::cout << "[routing]\n";
        auto procUP = std::make_unique<TendrilProcessor>(); auto& proc = *procUP;
        proc.prepareToPlay(kSR, kBlock);

        // good routing: delay->drive first in lane A, space alone in lane B
        auto v = juce::JSON::parse(R"({"a":["delay","drive","filter","crush","reson"],"b":["space"]})");
        CHECK(proc.applyRoutingVar(v), "valid routing accepted");
        CHECK(proc.getRoutingJson().contains("\"b\":[\"space\"]"), "routing persisted to state");

        // invalid: duplicate module
        auto bad = juce::JSON::parse(R"({"a":["delay","delay","filter","crush","reson"],"b":["space"]})");
        CHECK(!proc.applyRoutingVar(bad), "duplicate module rejected");

        // invalid: unknown name
        auto bad2 = juce::JSON::parse(R"({"a":["delay","wat","filter","crush","reson"],"b":["space"]})");
        CHECK(!proc.applyRoutingVar(bad2), "unknown module rejected");

        // parallel render stays sane
        setNorm(proc, "fx_blend", 0.5f);
        setNorm(proc, "fx_spacemix", 0.6f);
        auto mb = noteOnBuf(50);
        juce::AudioBuffer<float> out;
        renderBlocks(proc, out, 8, &mb);
        CHECK(allFinite(out) && peakOf(out) <= 1.01f, "parallel routing renders finite & limited");

        // encode/decode round trip (6 modules / 24-bit word)
        auto r0 = tendril::defaultRouting();
        r0[5].laneB = true;
        CHECK(tendril::decodeRouting(tendril::encodeRouting(r0))[5].laneB, "routing word round-trips");
    }

    // ---- 9. state save/load round trip (params + routing) ----
    {
        std::cout << "[state]\n";
        auto procUP = std::make_unique<TendrilProcessor>(); auto& proc = *procUP;
        proc.prepareToPlay(kSR, kBlock);
        setNorm(proc, "cutoff", 0.123f);
        setNorm(proc, "delay_note", 6.0f / 24.0f);
        proc.applyRoutingVar(juce::JSON::parse(R"({"a":["drive","filter","crush","reson","delay"],"b":["space"]})"));

        juce::MemoryBlock blob;
        proc.getStateInformation(blob);

        setNorm(proc, "cutoff", 0.9f);
        proc.applyRoutingVar(juce::JSON::parse(R"({"a":["filter","drive","crush","reson","delay","space"],"b":[]})"));

        proc.setStateInformation(blob.getData(), (int) blob.getSize());
        const float restored = proc.apvts.getParameter("cutoff")->getValue();
        CHECK(std::abs(restored - 0.123f) < 1.0e-3f, "param restored after state load");
        CHECK(proc.getRoutingJson().contains("\"b\":[\"space\"]"), "routing restored after state load");
    }

    // ---- 9b. resonator: keytracked modal bank stays musical ----
    {
        std::cout << "[resonate]\n";
        auto procUP = std::make_unique<TendrilProcessor>(); auto& proc = *procUP;
        proc.prepareToPlay(kSR, kBlock);
        setNorm(proc, "fx_reson", 1.0f);
        for (float tune : { 0.0f, 0.5f, 1.0f })
        {
            setNorm(proc, "fx_resontune", tune);
            auto mb = noteOnBuf(45);
            juce::AudioBuffer<float> out;
            renderBlocks(proc, out, 6, &mb);
            CHECK(allFinite(out) && peakOf(out) <= 1.01f,
                  ("resonate tune " + juce::String(tune, 1) + " finite & limited").toStdString());
        }
    }

    // ---- 9c. spectral engine: all spectral knobs at extremes together ----
    {
        std::cout << "[spectral extremes]\n";
        auto procUP = std::make_unique<TendrilProcessor>(); auto& proc = *procUP;
        proc.prepareToPlay(kSR, kBlock);
        for (float v : { 0.0f, 1.0f })
        {
            setNorm(proc, "density", v); setNorm(proc, "comb", v);
            setNorm(proc, "formant", v); setNorm(proc, "tilt", v);
            setNorm(proc, "a_tone", v);  setNorm(proc, "a_body", 1.0f - v);
            setNorm(proc, "a_air", v);   setNorm(proc, "a_bank", v);
            auto mb = noteOnBuf(50);
            juce::AudioBuffer<float> out;
            renderBlocks(proc, out, 6, &mb);
            CHECK(allFinite(out), ("spectral extremes " + juce::String(v, 0) + " finite").toStdString());
            CHECK(peakOf(out) > 1.0e-4f && peakOf(out) <= 1.01f,
                  ("spectral extremes " + juce::String(v, 0) + " audible & limited").toStdString());
        }
    }

    // ---- 9d. Mingle FX-order knob ----
    {
        std::cout << "[mingle]\n";
        const auto r0 = tendril::routingForOrder(0.0f);
        const auto r1 = tendril::routingForOrder(0.5f);
        const auto r2 = tendril::routingForOrder(1.0f);
        CHECK(tendril::routingValid(r0) && tendril::routingValid(r1) && tendril::routingValid(r2),
              "all mingle permutations are valid");
        bool diff = false;
        for (int i = 0; i < tendril::kNumModules; ++i) if (r0[(size_t) i].module != r1[(size_t) i].module) diff = true;
        CHECK(diff, "mingle changes the chain order");

        auto pUP = std::make_unique<TendrilProcessor>(); auto& p = *pUP; p.prepareToPlay(kSR, kBlock);
        bool ok = true;
        for (float o : { 0.0f, 0.25f, 0.6f, 1.0f })
        {
            setNorm(p, "fx_order", o);
            setNorm(p, "fx_spacemix", 0.4f); setNorm(p, "fx_drive", 0.5f);
            auto mb = noteOnBuf(48);
            juce::AudioBuffer<float> out; renderBlocks(p, out, 6, &mb);
            ok = ok && allFinite(out) && peakOf(out) <= 1.01f;
        }
        CHECK(ok, "every mingle position renders finite & limited");
    }

    // ---- 9e. Motion engine (Tendril self-modulates) ----
    {
        std::cout << "[motion]\n";
        auto pUP = std::make_unique<TendrilProcessor>(); auto& p = *pUP; p.prepareToPlay(kSR, kBlock);
        const int ci = p.modHub.indexOf("cutoff");
        const int ri = p.modHub.indexOf("reso");
        CHECK(ci >= 0 && ri >= 0, "params registered in ModHub");

        setNorm(p, "cutoff", 0.5f);
        setNorm(p, "reso", 0.2f);
        p.setModArm("cutoff", true);                 // arm cutoff only
        CHECK(p.getModArm("cutoff") && !p.getModArm("reso"), "arm flags set per-param");

        for (float ty : { 0.0f, 1.0f/3, 2.0f/3, 1.0f })   // each generator type
        {
            setNorm(p, "motion_type", ty);
            setNorm(p, "motion_on", 1.0f);
            setNorm(p, "motion_depth", 1.0f);
            juce::AudioBuffer<float> blk(2, kBlock); juce::MidiBuffer m;
            float mn = 1e9f, mx = -1e9f; bool fin = true;
            for (int b = 0; b < 256; ++b)             // free-run advances phase (~5 beats — crosses S&H steps)
            {
                blk.clear(); p.processBlock(blk, m);
                const float v = p.modHub.effValue(ci);
                mn = juce::jmin(mn, v); mx = juce::jmax(mx, v);
                if (!std::isfinite(v)) fin = false;
            }
            CHECK(fin && (mx - mn) > 0.02f,
                  ("type " + juce::String(ty,2) + ": armed cutoff moves (range " + juce::String(mx-mn,3) + ")").toStdString());
        }

        // non-armed param stays at its base
        CHECK(std::abs(p.modHub.effValue(ri) - 0.2f) < 1.0e-3f, "un-armed param is NOT modulated");

        // motion OFF -> armed param returns to base
        setNorm(p, "motion_on", 0.0f);
        juce::AudioBuffer<float> blk(2, kBlock); juce::MidiBuffer m; blk.clear(); p.processBlock(blk, m);
        // correct invariant: motion off -> effective value == the param's base
        // (compare to base, not a hardcoded number — cutoff is log-skewed)
        CHECK(std::abs(p.modHub.effValue(ci) - p.modHub.baseValue(ci)) < 1.0e-3f,
              "motion off -> param back to base");

        // mutate doesn't crash and stays musical
        setNorm(p, "motion_on", 1.0f);
        p.mutateMotion();
        auto mb = noteOnBuf(50);
        juce::AudioBuffer<float> out; renderBlocks(p, out, 6, &mb);
        CHECK(allFinite(out) && peakOf(out) <= 1.01f, "mutate renders finite & limited");
    }

    // ---- 10. polyphony: 8-note chord ----
    {
        std::cout << "[polyphony]\n";
        auto procUP = std::make_unique<TendrilProcessor>(); auto& proc = *procUP;
        proc.prepareToPlay(kSR, kBlock);
        juce::MidiBuffer mb;
        for (int i = 0; i < 8; ++i)
            mb.addEvent(juce::MidiMessage::noteOn(1, 40 + i * 3, (juce::uint8) 100), 0);
        juce::AudioBuffer<float> out;
        renderBlocks(proc, out, 10, &mb);
        CHECK(allFinite(out), "8-voice chord finite");
        CHECK(peakOf(out) > 1.0e-4f, "8-voice chord audible");
        CHECK(peakOf(out) <= 1.01f, "8-voice chord limited");
    }

    // ---- 11. glide param renders fine ----
    {
        std::cout << "[glide]\n";
        auto procUP = std::make_unique<TendrilProcessor>(); auto& proc = *procUP;
        proc.prepareToPlay(kSR, kBlock);
        setNorm(proc, "glide", 0.6f);
        auto mb1 = noteOnBuf(36);
        juce::AudioBuffer<float> o1; renderBlocks(proc, o1, 4, &mb1);
        auto mb2 = noteOnBuf(72);
        juce::AudioBuffer<float> o2; renderBlocks(proc, o2, 6, &mb2);
        CHECK(allFinite(o1) && allFinite(o2), "glide render finite");
    }

    // ---- 12. worst-case loudness: ceiling holds ----
    {
        std::cout << "[limiter]\n";
        auto procUP = std::make_unique<TendrilProcessor>(); auto& proc = *procUP;
        proc.prepareToPlay(kSR, kBlock);
        setNorm(proc, "fx_drive", 1.0f);
        setNorm(proc, "reso", 1.0f);
        setNorm(proc, "fold_amt", 1.0f);
        setNorm(proc, "density", 1.0f);
        setNorm(proc, "output", 1.0f);          // max gain (1.5x)
        setNorm(proc, "fx_motionfb", 1.0f);
        setNorm(proc, "delay_mix", 1.0f);
        juce::MidiBuffer mb;
        for (int i = 0; i < 8; ++i)
            mb.addEvent(juce::MidiMessage::noteOn(1, 36 + i * 2, (juce::uint8) 127), 0);
        juce::AudioBuffer<float> out;
        renderBlocks(proc, out, 12, &mb);
        CHECK(allFinite(out), "worst-case settings finite");
        CHECK(peakOf(out) <= 1.01f, "soft limiter holds the ceiling at max everything");
    }

    std::cout << "==================\n"
              << passes << " passed, " << failures << " failed\n";
    return failures == 0 ? 0 : 1;
}
