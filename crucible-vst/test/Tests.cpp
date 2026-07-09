// Crucible — headless test suite (exit 0 = green).
// Covers: param registry, module-level parity/bounds, full-processor soaks
// (max-everything, fuzz), state roundtrip, scope/display sanity.
#include "../src/PluginProcessor.h"
#include <juce_events/juce_events.h>
#include <cstdio>

static int gFail = 0, gPass = 0;
#define EXPECT(cond, msg)                                                        \
    do { if (cond) { ++gPass; }                                                  \
         else { ++gFail; std::printf("FAIL %s:%d  %s\n", __FILE__, __LINE__, msg); } } while (0)

static void renderBlocks(CrucibleProcessor& p, juce::AudioBuffer<float>& buf,
                         juce::MidiBuffer& midi, int blocks,
                         float& peak, bool& finite)
{
    for (int b = 0; b < blocks; ++b)
    {
        buf.clear();
        p.processBlock(buf, midi);
        midi.clear();
        for (int c = 0; c < buf.getNumChannels(); ++c)
        {
            const float* d = buf.getReadPointer(c);
            for (int i = 0; i < buf.getNumSamples(); ++i)
            {
                if (!std::isfinite(d[i])) { finite = false; return; }
                peak = std::max(peak, std::fabs(d[i]));
            }
        }
    }
}

static void setNorm(CrucibleProcessor& p, const char* id, float norm)
{
    auto* par = p.apvts.getParameter(id);
    if (par) par->setValueNotifyingHost(norm);
}

// ─────────────────────────── module unit tests ───────────────────────────
static void testMorphTable()
{
    const auto& T = cru::MorphTable::get();
    for (int j = 0; j < cru::MorphTable::KP; ++j)
        EXPECT(std::fabs(T.pos[j][0] - 1.0f) < 1e-6f, "fundamental anchored (bin1 == 1) in every position");
    // tent interp continuity
    float a = T.bin(2.999f, 3), b = T.bin(3.001f, 3);
    EXPECT(std::fabs(a - b) < 0.01f, "morph interp continuous across positions");
}

static void testDriveBypass()
{
    for (int t = 0; t < cru::DriveStage::NT; ++t)
    {
        cru::DriveStage d;
        d.sAm.snap(0); d.sMx.snap(1); d.snapPos((float) t, 0);
        bool ok = true;
        for (int i = 0; i < 1000; ++i)
        {
            float x = std::sin(0.1f * (float) i) * 0.5f;
            float y = d.process(x, 0, (float) t, 0, 1, 0);
            if (std::fabs(y - x) > 1e-5f) { ok = false; break; }
        }
        EXPECT(ok, "DRIVE at amount=0 is transparent for every type");
    }
}

static void testDriveTypesDistinct()
{
    float rms[cru::DriveStage::NT];
    for (int t = 0; t < cru::DriveStage::NT; ++t)
    {
        cru::DriveStage d;
        d.sAm.snap(1); d.sMx.snap(1); d.snapPos((float) t, 0);
        double acc = 0;
        bool finite = true;
        for (int i = 0; i < 24000; ++i)
        {
            float x = std::sin(cru::kTwoPi * 55.0f * (float) i / 48000.0f) * 0.6f;
            float y = d.process(x, 1, (float) t, 0, 1, 0);
            if (!std::isfinite(y)) { finite = false; break; }
            if (i > 4000) acc += (double) y * y;
        }
        rms[t] = (float) std::sqrt(acc / 20000.0);
        EXPECT(finite, "drive type finite at full amount");
        EXPECT(rms[t] > 0.05f && rms[t] < 2.0f, "drive type sounds, level sane");
    }
    // pairwise character check on a few obviously-different pairs
    EXPECT(std::fabs(rms[0] - rms[3]) > 1e-4f, "saturator vs rectifier differ");
    EXPECT(std::fabs(rms[0] - rms[5]) > 1e-4f, "saturator vs hardclip differ");
}

static void testWidthStage()
{
    // transparent at 0
    {
        cru::WidthStage ws;
        ws.prepare(48000);
        ws.sW.snap(0);
        bool ok = true;
        for (int i = 0; i < 4000; ++i)
        {
            float l0 = std::sin(0.013f * (float) i) * 0.5f;
            float r0 = std::sin(0.021f * (float) i) * 0.4f;
            float l = l0, r = r0;
            ws.process(l, r, 0.0f);
            if (std::fabs(l - l0) > 1e-5f || std::fabs(r - r0) > 1e-5f) { ok = false; break; }
        }
        EXPECT(ok, "WIDTH at 0 is transparent");
    }
    // at max: mono-ish input becomes stereo (L != R), and sub stays mono
    {
        cru::WidthStage ws;
        ws.prepare(48000);
        ws.sW.snap(1);
        cru::OnePoleLP inDiffLP, outDiffLP;                 // isolate the sub band of L-R
        inDiffLP.setHz(120.0f, 48000);
        outDiffLP.setHz(120.0f, 48000);
        double dAll = 0, dInSub = 0, dOutSub = 0;
        for (int i = 0; i < 96000; ++i)
        {
            float hi = std::sin(cru::kTwoPi * 900.0f * i / 48000.0f) * 0.4f;   // mono hi content
            float sb = std::sin(cru::kTwoPi * 60.0f  * i / 48000.0f);
            float l = hi + sb * 0.5f, r = hi + sb * 0.15f;                     // stereo-diff sub in
            float inSub = inDiffLP.step(l - r);
            ws.process(l, r, 1.0f);
            float outSub = outDiffLP.step(l - r);
            if (i > 48000) { dAll += std::fabs(l - r); dInSub += std::fabs(inSub); dOutSub += std::fabs(outSub); }
        }
        EXPECT(dAll > 100.0, "WIDTH at max decorrelates L/R (stereo)");
        EXPECT(dOutSub < dInSub * 0.6, "sub band collapses toward mono");
    }
}

static void testGrindBounded()
{
    cru::GrindStage g;
    g.prepare(48000);
    g.sCr.snap(1); g.sGr.snap(1);
    float peak = 0;
    for (int i = 0; i < 48000; ++i)
    {
        float x = std::sin(0.05f * (float) i) * 4.0f;    // hot input
        float y = g.process(x, 1, 1);
        peak = std::max(peak, std::fabs(y));
        if (!std::isfinite(y)) { peak = 1e9f; break; }
    }
    EXPECT(peak <= 1.0f + 1e-4f, "GRIND output tanh-bounded at max settings");
}

static void testOttPassthrough()
{
    cru::OttChain o;
    o.prepare(48000);
    o.sCol.snap(0);
    bool ok = true;
    for (int i = 0; i < 2000; ++i)
    {
        float x = std::sin(0.07f * (float) i) * 0.6f;
        float l, r;
        o.process(x, x, l, r, 0.0f);
        if (std::fabs(l - x) > 1e-5f || std::fabs(r - x) > 1e-5f) { ok = false; break; }
    }
    EXPECT(ok, "OTT chain at density=0 is transparent");

    cru::OttChain o2;
    o2.prepare(48000);
    o2.sCol.snap(1);
    float peak = 0;
    for (int i = 0; i < 48000; ++i)
    {
        float x = std::sin(0.03f * (float) i) * 3.0f;
        float l, r;
        o2.process(x, x, l, r, 1.0f);
        peak = std::max(peak, std::fabs(l));
        if (!std::isfinite(l)) { peak = 1e9f; break; }
    }
    EXPECT(peak <= 1.0f + 1e-4f, "OTT chain at max is tanh-bounded");
}

static void testFreqShifterUnity()
{
    cru::FreqShifter fs;
    fs.prepare(48000);
    // steady sine at 440, zero shift -> output should stay near unity magnitude
    float peak = 0;
    for (int i = 0; i < 48000; ++i)
    {
        float x = std::sin(cru::kTwoPi * 440.0f * (float) i / 48000.0f);
        float y = fs.process(x, 0.0f);
        if (i > 4000) peak = std::max(peak, std::fabs(y));
        if (!std::isfinite(y)) { peak = 1e9f; break; }
    }
    EXPECT(peak > 0.8f && peak < 1.2f, "freq shifter ~unity gain at zero shift");
}

static void testFeedbackLoopBounded()
{
    cru::FeedbackLoop fb;
    fb.prepare(48000);
    fb.sAmt.snap(1); fb.sTone.snap(0.5f); fb.sTim.snap(0.2f); fb.sShf.snap(0.75f);
    fb.control(0);
    float peak = 0;
    for (int i = 0; i < 96000; ++i)
    {
        if (i % 32 == 0) fb.control(0);
        float burst = (i < 4800) ? std::sin(0.2f * (float) i) : 0.0f;
        float y = fb.process(burst + fb.meterTap * 0.0f, 1.0f, 0.5f, 0.2f, 0.75f);
        peak = std::max(peak, std::fabs(y));
        if (!std::isfinite(y)) { peak = 1e9f; break; }
    }
    EXPECT(peak <= 0.75f, "global feedback loop output hard-bounded");
}

static void testDelayKeytrack()
{
    cru::TonalDelay d;
    d.prepare(48000);
    d.sTrk.snap(1.0f); d.sTim.snap(0.5f); d.sCol.snap(0.5f); d.sFb.snap(0.3f); d.sMix.snap(1.0f);
    d.control(110.0f, 0.0f, 1.0f);
    float expect = 48000.0f / 110.0f;
    EXPECT(std::fabs(d.tTgt[0] - expect) < 2.0f, "delay keytrack locks to the note period");
}

static void testSwarmFilters()
{
    // mix 0 -> parallel layer fully absent, dry untouched
    {
        cru::SwarmFilters sw;
        sw.prepare(48000);
        sw.sMix.snap(0); sw.sFrq.snap(0.5f); sw.sRate.snap(0.5f); sw.sDep.snap(0.5f); sw.sShp.snap(0);
        bool ok = true;
        for (int i = 0; i < 4000; ++i)
        {
            if (i % 32 == 0) sw.control(1.0f);
            float x = std::sin(0.05f * (float) i) * 0.5f;
            float l, r;
            sw.process(x, l, r, 0, 0.5f, 0.5f, 0.5f, 0, 1.0f);
            if (std::fabs(l - x) > 1e-6f || std::fabs(r - x) > 1e-6f) { ok = false; break; }
        }
        EXPECT(ok, "SWARM at mix=0 leaves the dry signal untouched");
    }
    // engaged: layer present, stereo, finite, and MOVING (windows differ over time)
    {
        cru::SwarmFilters sw;
        sw.prepare(48000);
        // pure bandpass, slow LFO: the two windows land on different sweep phases
        sw.sMix.snap(1); sw.sFrq.snap(0.5f); sw.sRate.snap(0.15f); sw.sDep.snap(1.0f); sw.sShp.snap(0);
        double dLR = 0, winA = 0, winB = 0;
        bool finite = true;
        for (int i = 0; i < 96000; ++i)
        {
            if (i % 32 == 0) sw.control(1.0f);
            float x = std::sin(cru::kTwoPi * 110.0f * i / 48000.0f) * 0.5f;
            float l, r;
            sw.process(x, l, r, 1, 0.5f, 0.15f, 1.0f, 0, 1.0f);
            if (!std::isfinite(l) || !std::isfinite(r)) { finite = false; break; }
            dLR += std::fabs(l - r);
            float lay = l - x;                       // the layer itself
            if (i >= 24000 && i < 36000) winA += std::fabs(lay);
            if (i >= 60000 && i < 72000) winB += std::fabs(lay);
        }
        EXPECT(finite, "SWARM engaged stays finite");
        EXPECT(dLR > 50.0, "SWARM layer is stereo (panned filters)");
        EXPECT(std::fabs(winA - winB) > winA * 0.02, "SWARM layer moves over time (LFOs)");
    }
    // full-notch shape also safe
    {
        cru::SwarmFilters sw;
        sw.prepare(48000);
        sw.sMix.snap(1); sw.sFrq.snap(0.4f); sw.sRate.snap(0.4f); sw.sDep.snap(1.0f); sw.sShp.snap(1.0f);
        bool finite = true;
        float peak = 0;
        for (int i = 0; i < 48000; ++i)
        {
            if (i % 32 == 0) sw.control(1.0f);
            float x = std::sin(0.09f * (float) i) * 0.8f;
            float l, r;
            sw.process(x, l, r, 1, 0.4f, 0.4f, 1.0f, 1.0f, 1.0f);
            if (!std::isfinite(l)) { finite = false; break; }
            peak = std::max(peak, std::fabs(l));
        }
        EXPECT(finite && peak < 4.0f, "SWARM notch mode finite + bounded");
    }
}

static void testVerbDecays()
{
    cru::ShimmerVerb v;
    v.prepare(48000);
    v.sSpace.snap(0.4f); v.sShim.snap(0.0f);
    v.control(0, 0);
    // impulse in, energy must decay (not blow up) over 4 s
    float tail1 = 0, tail2 = 0;
    for (int i = 0; i < 192000; ++i)
    {
        if (i % 32 == 0) v.control(0, 0);
        float x = (i == 0) ? 1.0f : 0.0f;
        float l, r;
        v.process(x, x, l, r, 0.4f, 0.0f);
        float e = std::fabs(l) + std::fabs(r);
        if (i >= 48000 && i < 96000)  tail1 += e;
        if (i >= 144000)              tail2 += e;
        if (!std::isfinite(e)) { tail2 = 1e9f; break; }
    }
    EXPECT(tail2 < tail1, "reverb tail decays");
    EXPECT(tail2 < 1e6f, "reverb finite");
}

static float renderNoteRms(const char* tweakId, float tweakVal)
{
    CrucibleProcessor p;
    p.prepareToPlay(48000, 512);
    if (tweakId) setNorm(p, tweakId, tweakVal);
    juce::AudioBuffer<float> buf(2, 512);
    juce::MidiBuffer midi;
    midi.addEvent(juce::MidiMessage::noteOn(1, 36, (juce::uint8) 100), 0);
    double acc = 0; int nAcc = 0;
    for (int b = 0; b < 40; ++b)
    {
        buf.clear();
        p.processBlock(buf, midi);
        midi.clear();
        if (b >= 20)   // steady-state window
        {
            const float* d = buf.getReadPointer(0);
            for (int i = 0; i < 512; ++i) { acc += (double) d[i] * d[i]; ++nAcc; }
        }
    }
    return (float) std::sqrt(acc / std::max(1, nAcc));
}

static void testDriftStretchWired()
{
    // deterministic engine: identical settings -> identical output, so a knob
    // that changes nothing is a wiring bug
    float base  = renderNoteRms(nullptr, 0);
    float base2 = renderNoteRms(nullptr, 0);
    EXPECT(std::fabs(base - base2) < 1e-9f, "engine deterministic (test premise)");
    float st = renderNoteRms("stretch", 1.0f);
    float dr = renderNoteRms("drift", 1.0f);
    float fc = renderNoteRms("fractal", 1.0f);
    float wd = renderNoteRms("width", 1.0f);
    float fm = renderNoteRms("flt_mix", 1.0f);
    EXPECT(std::isfinite(st) && st > 1e-4f, "stretch=max still sounds, finite");
    EXPECT(std::isfinite(dr) && dr > 1e-4f, "drift=max still sounds, finite");
    EXPECT(std::isfinite(fc) && fc > 1e-4f, "fractal=max still sounds, finite");
    EXPECT(std::isfinite(wd) && wd > 1e-4f, "width=max still sounds, finite");
    EXPECT(std::fabs(st - base) > 1e-6f, "STRETCH is wired (changes the output)");
    EXPECT(std::fabs(dr - base) > 1e-6f, "DRIFT is wired (changes the output)");
    EXPECT(std::fabs(fc - base) > 1e-6f, "FRACTAL is wired (changes the output)");
    EXPECT(std::fabs(wd - base) > 1e-6f, "WIDTH is wired (changes the output)");
    EXPECT(std::isfinite(fm) && std::fabs(fm - base) > 1e-6f, "SWARM mix is wired (changes the output)");
}

// ─────────────────────────── processor-level tests ───────────────────────────
static void testRegistry(CrucibleProcessor& p)
{
    EXPECT((int) cru::paramDefs().size() == 40, "40 character params defined");
    int count = 0;
    for (auto* ap : p.getParameters())
        if (dynamic_cast<juce::AudioProcessorParameterWithID*>(ap)) ++count;
    EXPECT(count == 51, "51 params registered (40 + drive_type + 7 toggles + mono + legato + gain)");
    EXPECT(p.apvts.getRawParameterValue(cru::kDriveTypeID) != nullptr, "drive_type registered");
    for (const auto& t : cru::toggleDefs())
    {
        auto* raw = p.apvts.getRawParameterValue(t.id);
        EXPECT(raw != nullptr && raw->load() > 0.5f, "toggle exists and defaults ON");
    }
    for (const auto& d : cru::paramDefs())
    {
        auto* raw = p.apvts.getRawParameterValue(d.id);
        EXPECT(raw != nullptr, "param id resolves");
        if (raw) EXPECT(std::fabs(raw->load() - d.def) < 1e-4f, "default matches M4L");
    }
}

static void testSilence(CrucibleProcessor& p)
{
    juce::AudioBuffer<float> buf(2, 512);
    juce::MidiBuffer midi;
    float peak = 0; bool finite = true;
    renderBlocks(p, buf, midi, 40, peak, finite);
    EXPECT(finite, "silence render finite");
    EXPECT(peak < 1e-3f, "no self-noise with no notes at defaults");
}

static void testNoteAndRelease(CrucibleProcessor& p)
{
    juce::AudioBuffer<float> buf(2, 512);
    juce::MidiBuffer midi;
    midi.addEvent(juce::MidiMessage::noteOn(1, 36, (juce::uint8) 100), 0);
    float peak = 0; bool finite = true;
    renderBlocks(p, buf, midi, 50, peak, finite);           // ~0.5 s held
    EXPECT(finite, "note render finite");
    EXPECT(peak > 0.005f, "note produces audio");

    midi.addEvent(juce::MidiMessage::noteOff(1, 36), 0);
    float peakOff = 0;
    renderBlocks(p, buf, midi, 700, peakOff, finite);       // ~7.5 s tail
    juce::MidiBuffer none;
    float tailPeak = 0;
    renderBlocks(p, buf, none, 20, tailPeak, finite);
    EXPECT(finite, "release render finite");
    EXPECT(tailPeak < 0.02f, "voice decays to (near) silence after release");
}

static void testMaxSoak(CrucibleProcessor& p)
{
    for (const auto& d : cru::paramDefs()) setNorm(p, d.id, 1.0f);
    setNorm(p, cru::kDriveTypeID, 1.0f);   // HardClip
    setNorm(p, cru::kGainID, 1.0f);
    juce::AudioBuffer<float> buf(2, 512);
    juce::MidiBuffer midi;
    float peak = 0; bool finite = true;
    for (int rep = 0; rep < 20; ++rep)
    {
        midi.addEvent(juce::MidiMessage::noteOn(1, 30 + rep % 24, (juce::uint8) 127), 0);
        renderBlocks(p, buf, midi, 20, peak, finite);
        midi.addEvent(juce::MidiMessage::noteOff(1, 30 + rep % 24), 0);
        renderBlocks(p, buf, midi, 25, peak, finite);
        if (!finite) break;
    }
    EXPECT(finite, "max-everything soak stays finite");
    EXPECT(peak < 16.0f, "max-everything soak stays sane");
    EXPECT(peak > 0.01f, "max-everything soak actually makes sound");
}

static void testFuzz(CrucibleProcessor& p)
{
    juce::Random rng(0xC0FFEE);
    juce::AudioBuffer<float> buf(2, 256);
    juce::MidiBuffer midi;
    float peak = 0; bool finite = true;
    for (int it = 0; it < 250 && finite; ++it)
    {
        for (const auto& d : cru::paramDefs()) setNorm(p, d.id, rng.nextFloat());
        for (const auto& t : cru::toggleDefs()) setNorm(p, t.id, rng.nextBool() ? 1.0f : 0.0f);
        setNorm(p, cru::kDriveTypeID, rng.nextFloat());
        setNorm(p, cru::kGainID, rng.nextFloat());
        if (rng.nextBool())
            midi.addEvent(juce::MidiMessage::noteOn(1, 24 + rng.nextInt(48), (juce::uint8)(1 + rng.nextInt(127))), 0);
        if (rng.nextBool())
            midi.addEvent(juce::MidiMessage::noteOff(1, 24 + rng.nextInt(48)), 0);
        renderBlocks(p, buf, midi, 8, peak, finite);
    }
    EXPECT(finite, "250-setting random fuzz stays finite");
    EXPECT(peak < 8.0f, "fuzz peak sane (dry anchor + wet ceiling + gain headroom)");
}

static void testMonoLegato()
{
    CrucibleProcessor p;
    p.prepareToPlay(48000, 512);
    setNorm(p, "mono", 1.0f);
    juce::AudioBuffer<float> buf(2, 512);
    juce::MidiBuffer midi;
    float peak = 0; bool finite = true;
    midi.addEvent(juce::MidiMessage::noteOn(1, 36, (juce::uint8) 100), 0);
    renderBlocks(p, buf, midi, 10, peak, finite);
    midi.addEvent(juce::MidiMessage::noteOn(1, 43, (juce::uint8) 100), 0);   // overlap
    renderBlocks(p, buf, midi, 10, peak, finite);

    int active = 0;
    for (int i = 0; i < p.synth.getNumVoices(); ++i)
        if (auto* cv = dynamic_cast<CrucibleVoice*>(p.synth.getVoice(i)))
            if (cv->isVoiceActive()) ++active;
    EXPECT(active == 1, "mono: overlapping notes share one voice");
    EXPECT(std::fabs(p.lastF0.load() - (float) juce::MidiMessage::getMidiNoteInHertz(43)) < 0.1f,
           "mono: pitch moved to the new note");

    midi.addEvent(juce::MidiMessage::noteOff(1, 43), 0);
    renderBlocks(p, buf, midi, 5, peak, finite);
    EXPECT(std::fabs(p.lastF0.load() - (float) juce::MidiMessage::getMidiNoteInHertz(36)) < 0.1f,
           "mono: falls back to the still-held note");
    EXPECT(finite, "mono render finite");

    // legato: overlapping change keeps the envelope running (no dip to zero)
    setNorm(p, "legato", 1.0f);
    midi.addEvent(juce::MidiMessage::noteOff(1, 36), 0);
    renderBlocks(p, buf, midi, 60, peak, finite);                            // fully released
    midi.addEvent(juce::MidiMessage::noteOn(1, 36, (juce::uint8) 100), 0);
    renderBlocks(p, buf, midi, 20, peak, finite);
    midi.addEvent(juce::MidiMessage::noteOn(1, 41, (juce::uint8) 100), 0);   // legato overlap
    float pk2 = 0;
    renderBlocks(p, buf, midi, 10, pk2, finite);
    EXPECT(finite && pk2 > 0.003f, "legato overlap keeps sounding");
}

static void testTogglesBypass()
{
    // all stages powered off -> the dry voice still speaks (wet-path kill is safe)
    CrucibleProcessor p;
    p.prepareToPlay(48000, 512);
    for (const auto& t : cru::toggleDefs()) setNorm(p, t.id, 0.0f);
    juce::AudioBuffer<float> buf(2, 512);
    juce::MidiBuffer midi;
    midi.addEvent(juce::MidiMessage::noteOn(1, 36, (juce::uint8) 100), 0);
    float peak = 0; bool finite = true;
    renderBlocks(p, buf, midi, 40, peak, finite);
    EXPECT(finite, "all-off render finite");
    EXPECT(peak > 0.005f, "note still sounds with every stage bypassed");
}

static void testStateRoundtrip()
{
    CrucibleProcessor a;
    a.prepareToPlay(48000, 512);
    juce::Random rng(42);
    std::map<juce::String, float> want;
    for (const auto& d : cru::paramDefs())
    {
        float v = rng.nextFloat();
        setNorm(a, d.id, v);
        want[d.id] = v;
    }
    juce::MemoryBlock blob;
    a.getStateInformation(blob);

    CrucibleProcessor b;
    b.prepareToPlay(48000, 512);
    b.setStateInformation(blob.getData(), (int) blob.getSize());
    bool ok = true;
    for (const auto& d : cru::paramDefs())
    {
        auto* par = b.apvts.getParameter(d.id);
        if (par == nullptr || std::fabs(par->getValue() - want[d.id]) > 1e-3f) { ok = false; break; }
    }
    EXPECT(ok, "state save/load roundtrip preserves every param");
}

static void testDisplayRing(CrucibleProcessor& p)
{
    p.editorOpen.store(true);
    juce::AudioBuffer<float> buf(2, 512);
    juce::MidiBuffer midi;
    midi.addEvent(juce::MidiMessage::noteOn(1, 40, (juce::uint8) 100), 0);
    float peak = 0; bool finite = true;
    renderBlocks(p, buf, midi, 20, peak, finite);
    float wavePeak = 0; bool waveFinite = true;
    for (int i = 0; i < 512; ++i)
    {
        if (!std::isfinite(p.display.ring[i])) waveFinite = false;
        wavePeak = std::max(wavePeak, std::fabs(p.display.ring[i]));
    }
    EXPECT(waveFinite, "wave display trace finite");
    EXPECT(wavePeak > 0.05f, "wave display trace alive");
    p.editorOpen.store(false);
    midi.addEvent(juce::MidiMessage::noteOff(1, 40), 0);
    renderBlocks(p, buf, midi, 4, peak, finite);
}

int main()
{
    juce::ScopedJuceInitialiser_GUI juceInit;

    testMorphTable();
    testDriveBypass();
    testDriveTypesDistinct();
    testWidthStage();
    testGrindBounded();
    testOttPassthrough();
    testFreqShifterUnity();
    testFeedbackLoopBounded();
    testDelayKeytrack();     // TonalDelay is parked but stays verified
    testSwarmFilters();
    testVerbDecays();
    testDriftStretchWired();

    {
        CrucibleProcessor p;
        p.prepareToPlay(48000, 512);
        testRegistry(p);
        testSilence(p);
        testNoteAndRelease(p);
        testDisplayRing(p);
    }
    {
        CrucibleProcessor p;
        p.prepareToPlay(48000, 512);
        testMaxSoak(p);
    }
    {
        CrucibleProcessor p;
        p.prepareToPlay(44100, 256);
        testFuzz(p);
    }
    testMonoLegato();
    testTogglesBypass();
    testStateRoundtrip();

    std::printf("\nCrucible tests: %d passed, %d failed\n", gPass, gFail);
    return gFail == 0 ? 0 : 1;
}
