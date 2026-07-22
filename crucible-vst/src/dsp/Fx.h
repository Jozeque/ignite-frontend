// Crucible — the bus FX chain ("the forge").
//
//   voices → DRIVE → GRIND → METAL → [+loop] → TONAL DELAY → SHIMMER VERB
//          → OTT×6 → (loop tap → COLOR SVF → FREQ SHIFT → bound → FB delay)
//          → TILT → SOFT-CLIP → MIX(dry anchor)
//
// DRIVE / GRIND / OTT are 1:1 ports of the gen~ codeboxes in
// crucible/build_crucible.py. The rest realises the multi-FX spec
// (docs/crucible-multifx-spec.md) + the research additions: keytracked comb
// bank, Mimeophon-style LP→BP→HP loop color, Niemitalo Hilbert frequency
// shifter (barberpole riser), Dattorro 2-tap shimmer, Lorenz MOVE, and a fixed
// cross-coupling matrix. Every loop is bounded (saturator + damping + DC block
// + HP bass anchor) so the edge screams but can never run away.
#pragma once
#include "DspUtil.h"
#include <atomic>

namespace cru {

constexpr int kCtrlInterval = 32;   // control-rate tick (expensive coefficient math)

struct FxParams   // raw per-block targets (0..1), written by the processor
{
    float driveAmt = 0, driveType = 0 /*0..5*/, driveMorph = 0, driveMix = 1;
    float drvFltCut = 0.5f, drvFltRes = 0.1f; int drvFltType = 0;   // drive focus filter
    float crush = 0, grind = 0;
    float width = 0;
    float metal = 0, material = 0.35f;
    float fltMix = 0, fltFreq = 0.5f, fltRate = 0.3f, fltDepth = 0.4f, fltShape = 0;
    float filtCutoff = 1.0f, filtRes = 0.15f, filtMix = 1.0f; int filtType = 0;   // master filter
    float dlyMix = 0, dlyTime = 0.4f, dlyFb = 0.35f;                 // sync delay
    float dlySyncBeats = 0;   // 0 = free, else beat multiplier
    float dlyPP = 0, bpm = 120.0f;
    float space = 0, shimmer = 0;
    float fbAmt = 0, fbTone = 0.5f, fbTime = 0.25f, fbShift = 0.5f;
    float ott = 0, move = 0, tilt = 0.5f, outDrive = 0.35f, mix = 1.0f;
    // per-stage power switches (0/1, crossfaded in the chain)
    float driveOn = 1, grindOn = 1, metalOn = 1, fltOn = 1, verbOn = 1, fbOn = 1, ottOn = 1;
    float dlyOn = 1, filtOn = 1;
};

// ════════════════════════════════ DRIVE v2 ════════════════════════════════
// Six selectable shaper types + MORPH: a continuous position on the type
// circle glides at the gen~ smoothing rate, so knob morphs AND hard type
// switches sweep click-free (output crossfade — no added aliasing beyond the
// shapers themselves). Types keep the M4L characters alive: 0 Saturator is the
// old tanh, 4 Asym is the old diode. Every shape is amplitude-bounded and the
// wet path is DC-blocked (rectifier). Feedback knob removed (cut by ear).
struct DriveStage
{
    static constexpr int NT = 6;   // Saturator Overdrive Downsample Rectifier Asym HardClip
    Smooth sAm, sMx;
    float pos = 0;                 // smoothed continuous type position [0..6)
    float dsPh = 0, dsHold = 0;    // downsample state (always runs: warm morph entry)
    DCBlock dc;

    // focus filter: choose WHAT gets driven (All/Low/Band/High); the clean
    // residual recombines after the shaper — drive only the lows, mids, etc.
    int   fType = 0;
    float fic1 = 0, fic2 = 0, fa1 = 0, fa2 = 0, fa3 = 0, fkq = 1;
    Smooth sFc, sFq;
    float srD = 48000;

    void prepare(float s) { srD = s; control(fType); }
    void control(int typ)
    {
        fType = typ;
        float fc = 30.0f * std::pow(600.0f, sFc.y);       // 30 Hz → 18 kHz
        float q  = 0.6f + sFq.y * sFq.y * 8.0f;
        fkq = 1.0f / q;
        float g = std::tan(kPi * clampf(fc, 20.0f, 0.45f * srD) / srD);
        fa1 = 1.0f / (1.0f + g * (g + fkq));
        fa2 = g * fa1;
        fa3 = g * fa2;
    }

    void reset() { dc.reset(); dsPh = 0; dsHold = 0; fic1 = fic2 = 0; }
    void snapPos(float typeIdx, float morph) { pos = typeIdx + clampf(morph, 0, 1); }

    // Each type has its own internal gain so real program levels actually hit
    // its knee, and the shapes are tuned APART — switching types should be a
    // character jump, not a flavor hint.
    float shape(int t, float x) const
    {
        switch (t)
        {
            default:
            case 0: return std::tanh(x);                                     // SATURATOR — warm (the M4L tanh)
            case 1: { float c = clampf(x * 2.2f, -1.5f, 1.5f);               // OVERDRIVE — hot cubic crunch
                      return (c - c * c * c / 6.75f) * 0.85f; }
            case 2: return dsHold;                                           // DOWNSAMPLE — SR + bit wreck
            case 3: return std::fabs(std::tanh(x * 1.4f)) * 1.25f;           // RECTIFIER — octave-up buzz
            case 4: return (std::tanh(x * 1.6f + 0.6f) - 0.53705f) * 1.1f;   // ASYM — hard bias, even harmonics
            case 5: return clampf(x, -0.45f, 0.45f) * 2.0f;                  // HARDCLIP — brutal wall
        }
    }

    float process(float in, float amT, float typeIdx, float morphT, float mixT,
                  float fcT, float fqT, float transient)
    {
        float am = sAm.step(amT);
        float mx = sMx.step(mixT);
        sFc.step(fcT); sFq.step(fqT);

        // glide the position toward type+morph along the shortest path on the circle
        float tgt = typeIdx + clampf(morphT, 0, 1);
        float dd = tgt - pos;
        dd -= 6.0f * std::floor(dd / 6.0f + 0.5f);
        pos += 0.0022f * dd;
        pos -= 6.0f * std::floor(pos / 6.0f);

        // focus split (state always runs so type switches are warm)
        float v3 = in - fic2;
        float v1 = fa1 * fic1 + fa2 * v3;
        float v2 = fic2 + fa2 * fic1 + fa3 * v3;
        fic1 = 2.0f * v1 - fic1;
        fic2 = 2.0f * v2 - fic2;
        float sel = (fType == 1) ? v2
                  : (fType == 2) ? v1
                  : (fType == 3) ? (in - fkq * v1 - v2)
                                 : in;
        float resid = (fType == 0) ? 0.0f : in - sel;

        float drv = 1.0f + am * am * 6.0f;
        drv *= 1.0f + transient * 0.8f * am;
        float x = sel * drv;

        // downsample: rate curve that actually bites mid-knob (48k→~1k) + bit crush
        dsPh += 0.02f + std::pow(1.0f - am, 2.5f) * 0.9f;
        if (dsPh >= 1.0f)
        {
            dsPh -= std::floor(dsPh);
            float lev = std::pow(2.0f, 10.0f - am * 8.0f);
            dsHold = std::round(std::tanh(x) * lev) / lev;
        }

        int   i0 = (int) pos; if (i0 > NT - 1) i0 = NT - 1;
        float frv = pos - (float) i0;
        int   i1 = (i0 + 1) % NT;
        float sh = shape(i0, x);
        sh += (shape(i1, x) - sh) * frv;
        sh = dc.step(sh);

        float wet = sh * (0.7f + 0.3f / drv) + resid;   // driven band + clean remainder
        return in + (wet - in) * clampf(am * 2.5f, 0, 1) * mx;   // full wet by 40% — no dead zone
    }
};

// ════════════════════════════════ WIDTH ════════════════════════════════
// Sub-anchored Haas. A TPT-SVF Linkwitz-Riley-style crossover at 200 Hz gives
// a REAL 12 dB highpass (a subtractive one-pole split leaks >50% of 60 Hz into
// the hi path via phase mismatch — caught by the sub-mono test), and LP−HP
// recombines allpass-flat. Lows collapse to mono, the high band gets two
// differently-delayed copies (L ≤ 23 ms, R ≤ 47 ms). The whole stage
// crossfades in with the knob, so zero = bit-transparent. Sits AFTER the loop
// tap so the feedback bus never sees the Haas comb.
struct WidthStage
{
    struct LR2   // TPT SVF, k=2 (two real poles) — lo and inverted hi
    {
        float ic1 = 0, ic2 = 0, a1 = 0, a2 = 0, a3 = 0;
        void set(float fc, float sr)
        {
            float g = std::tan(kPi * fc / sr);
            a1 = 1.0f / (1.0f + g * (g + 2.0f));
            a2 = g * a1;
            a3 = g * a2;
        }
        void step(float x, float& lo, float& hi)
        {
            float v3 = x - ic2;
            float v1 = a1 * ic1 + a2 * v3;
            float v2 = ic2 + a2 * ic1 + a3 * v3;
            ic1 = 2.0f * v1 - ic1;
            ic2 = 2.0f * v2 - ic2;
            lo = v2;
            hi = -(x - 2.0f * v1 - v2);   // inverted: lo + hi sums allpass-flat
        }
        void reset() { ic1 = ic2 = 0; }
    };

    LR2 split[2];
    DelayLine dHi;
    Smooth sW;
    float tCur[2] = { 1, 1 };
    float sr = 48000;

    void prepare(float s)
    {
        sr = s;
        for (int c = 0; c < 2; ++c) split[c].set(200.0f, s);
        dHi.prepare((int)(0.06f * s) + 8);
    }
    void reset()
    {
        for (int c = 0; c < 2; ++c) split[c].reset();
        dHi.reset(); tCur[0] = tCur[1] = 1;
    }

    void process(float& L, float& R, float wT)
    {
        float w = sW.step(wT);
        float lo0, hi0, lo1, hi1;
        split[0].step(L, lo0, hi0);
        split[1].step(R, lo1, hi1);

        float loMono = (lo0 + lo1) * 0.5f;
        float engage = std::min(w * 4.0f, 1.0f);       // sub-lock + stage engage

        dHi.write((hi0 + hi1) * 0.5f);
        float tT0 = 1.0f + w * 0.023f * sr;
        float tT1 = 1.0f + w * 0.047f * sr;
        tCur[0] += 0.0008f * (tT0 - tCur[0]);
        tCur[1] += 0.0008f * (tT1 - tCur[1]);

        float g = w * 0.85f, dg = 1.0f - w * 0.35f;
        float oL = lerpf(lo0, loMono, engage) + hi0 * dg + dHi.readLin(tCur[0]) * g;
        float oR = lerpf(lo1, loMono, engage) + hi1 * dg + dHi.readLin(tCur[1]) * g;
        L = lerpf(L, oL, engage);
        R = lerpf(R, oR, engage);
    }
};

// ════════════════════════════════ GRIND ════════════════════════════════
// Parallel multiband crush + per-band OTTs — exact port of build_grind_code().
// Note: tanh(0.9x) at the output is part of the shipped M4L sound even at zero.
struct GrindStage
{
    Smooth sCr, sGr;
    float xlo = 0, xhi = 0;
    float phlo = 0, phmid = 0, phhi = 0;
    float shlo = 0, shmid = 0, shhi = 0;
    float elo = 0, emid = 0, ehi = 0;
    float loc = 0.01f, hic = 0.1f;

    void prepare(float sr)
    {
        loc = 1.0f - std::exp(-kTwoPi * 200.0f  / sr);
        hic = 1.0f - std::exp(-kTwoPi * 2000.0f / sr);
    }
    void reset() { xlo = xhi = phlo = phmid = phhi = shlo = shmid = shhi = elo = emid = ehi = 0; }

    float process(float in, float crT, float grT)
    {
        float cr = sCr.step(crT), gr = sGr.step(grT);
        const float atk = 0.01f, rel = 0.0009f, tgt = 0.2f;
        xlo += loc * (in - xlo); float blo = xlo;
        xhi += hic * (in - xhi); float bml = xhi;
        float bhi = in - bml, bmid = bml - blo;

        float srl = 1.0f - cr * 0.92f;
        phlo += srl; bool tlo = phlo >= 1.0f; if (tlo) phlo -= std::floor(phlo);
        float levlo = std::pow(2.0f, 12.0f - cr * 10.0f);
        if (tlo) shlo = std::round(blo * levlo) / levlo;

        float srm = 1.0f - cr * 0.7f;
        phmid += srm; bool tmid = phmid >= 1.0f; if (tmid) phmid -= std::floor(phmid);
        float levmid = std::pow(2.0f, 12.0f - cr * 7.0f);
        if (tmid) shmid = std::round(bmid * levmid) / levmid;

        float srh = 1.0f - cr * 0.4f;
        phhi += srh; bool thi = phhi >= 1.0f; if (thi) phhi -= std::floor(phhi);
        float levhi = std::pow(2.0f, 12.0f - cr * 4.0f);
        if (thi) shhi = std::round(bhi * levhi) / levhi;

        float ael = std::fabs(shlo);  elo  += (ael > elo  ? atk : rel) * (ael - elo);
        float aem = std::fabs(shmid); emid += (aem > emid ? atk : rel) * (aem - emid);
        float aeh = std::fabs(shhi);  ehi  += (aeh > ehi  ? atk : rel) * (aeh - ehi);

        float ex = gr * 0.7f;
        float glo  = clampf(std::pow((tgt + 1e-4f) / (elo  + 1e-4f), ex), 0.3f, 6.0f);
        float gmid = clampf(std::pow((tgt + 1e-4f) / (emid + 1e-4f), ex), 0.3f, 6.0f);
        float ghi  = clampf(std::pow((tgt + 1e-4f) / (ehi  + 1e-4f), ex), 0.3f, 6.0f);
        float sig = shlo * glo + shmid * gmid + shhi * ghi;
        return std::tanh(sig * 0.9f);
    }
};

// ════════════════════════════════ METAL ════════════════════════════════
// Keytracked comb resonator bank (research §4): 4 feedback combs tuned to the
// last note, MATERIAL morphs string→bell ratios + damping + decay. Combs stay
// linear inside; one shared tanh bounds the summed output.
struct MetalBank
{
    static constexpr int NC = 4;
    DelayLine d[NC];
    OnePoleLP damp[NC];
    DCBlock   dc[NC];
    float dLen[NC] = { 400, 200, 133, 95 }, dTgt[NC] = { 400, 200, 133, 95 };
    float g[NC] = {};
    float sr = 48000, maxLen = 1900;
    Smooth sMet, sMat;
    float f0 = 55;

    void prepare(float s)
    {
        sr = s; maxLen = 0.04f * sr;
        for (int i = 0; i < NC; ++i) { d[i].prepare((int) maxLen + 64); dc[i] = {}; }
        retune(55.0f);
        control();
    }
    void reset() { for (int i = 0; i < NC; ++i) { d[i].reset(); damp[i].reset(); dc[i].reset(); } }
    void retune(float newF0) { f0 = clampf(newF0, 25.0f, 2000.0f); }

    void control()
    {
        static constexpr float ratS[NC] = { 1.0f, 2.0f,    3.0f,    4.2f   };
        static constexpr float ratB[NC] = { 1.0f, 2.756f,  5.404f,  8.933f };
        float mat = sMat.y, met = sMet.y;
        float t60 = 0.25f + (1.0f - mat) * 1.75f + met * 0.5f;
        float cut = 1500.0f + mat * 8000.0f;
        for (int i = 0; i < NC; ++i)
        {
            float rat = lerpf(ratS[i], ratB[i], mat);
            dTgt[i] = clampf(sr / (f0 * rat), 8.0f, maxLen);
            g[i] = std::min(std::pow(0.001f, dTgt[i] / (t60 * sr)), 0.995f);
            damp[i].setHz(cut, sr);
        }
    }

    float process(float x, float metT, float matT)
    {
        float met = sMet.step(metT); sMat.step(matT);
        float sum = 0;
        for (int i = 0; i < NC; ++i)
        {
            dLen[i] += 0.0015f * (dTgt[i] - dLen[i]);     // ~14 ms retune slew
            float r = d[i].readLin(dLen[i]);
            r = damp[i].step(r);
            r = dc[i].step(r);
            d[i].write(x * 0.25f + r * g[i]);
            sum += r;
        }
        sum = std::tanh(sum * 0.8f) * 1.25f;
        return x + (sum * 0.5f - x) * met;
    }
};

// ═══════════════════════════════ TONAL DELAY ═══════════════════════════════
// PARKED — removed from the chain (replaced by SwarmFilters below) but kept
// compiled + unit-tested for an easy return.
// Musical-interval delay: log time sweep snapping to semitone periods in the
// comb zone, optional keytrack lock to the played note, filter + saturator in
// the feedback path (each repeat darker + grittier), slight R-channel detune
// for width, slewed time = tape-style repitch. Couplings: reverb tail ducks
// the feedback; loop energy darkens the damping (both stabilising).
struct TonalDelay
{
    DelayLine dl[2];
    OnePoleLP lp[2];
    OnePoleHP hp[2];
    Smooth sMix, sFb, sCol, sTim, sTrk;
    EnvFollow loopEF;
    float sr = 48000;
    float tCur[2] = { 4800, 4800 }, tTgt[2] = { 4800, 4800 };
    float gFb = 0, drv = 1.6f, lpK = 0.5f;
    float meterTap = 0;

    void prepare(float s)
    {
        sr = s;
        for (int c = 0; c < 2; ++c) { dl[c].prepare((int)(1.2f * sr)); hp[c].setHz(90.0f, sr); }
        loopEF.setTimes(0.03f, 0.4f, sr);
    }
    void reset() { for (int c = 0; c < 2; ++c) { dl[c].reset(); lp[c].reset(); hp[c].reset(); } loopEF.reset(); }

    void control(float lastF0, float verbTailN, float wobble)
    {
        float x = sTim.y;
        float p = 0.6f * std::pow(2.0f / 600.0f, x);          // 600 ms → 2 ms log sweep
        if (p < 0.08f)                                        // snap to semitone periods in the comb zone
        {
            float f = 1.0f / p;
            float n = std::round(69.0f + 12.0f * std::log2(f / 440.0f));
            float ps = 1.0f / (440.0f * std::pow(2.0f, (n - 69.0f) / 12.0f));
            float w = clampf((0.08f - p) / 0.04f, 0, 1);
            p = lerpf(p, ps, w);
        }
        float pk = clampf(1.0f / clampf(lastF0, 20.0f, 2000.0f), 0.0005f, 1.0f / 30.0f);
        p = lerpf(p, pk, sTrk.y) * wobble;
        tTgt[0] = clampf(p * sr, 40.0f, (float) dl[0].size - 8.0f);
        tTgt[1] = clampf(tTgt[0] * 1.011f, 40.0f, (float) dl[1].size - 8.0f);

        float dropN = norm01(loopEF.e);
        float col = sCol.y;
        float cut = 500.0f * std::pow(24.0f, col) * (1.0f - 0.5f * dropN);
        lpK = 1.0f - std::exp(-kTwoPi * clampf(cut, 200.0f, 0.45f * sr) / sr);
        drv = 1.3f + (1.0f - col) * 1.3f;
        float fbv = sFb.y;
        gFb = fbv * fbv * 0.97f * (1.0f - 0.30f * verbTailN);
    }

    void process(float in, float& outL, float& outR,
                 float mixT, float fbT, float colT, float timT, float trkT)
    {
        float mixv = sMix.step(mixT);
        sFb.step(fbT); sCol.step(colT); sTim.step(timT); sTrk.step(trkT);
        float wet[2];
        for (int c = 0; c < 2; ++c)
        {
            tCur[c] += 0.0008f * (tTgt[c] - tCur[c]);
            float v = dl[c].readCubic(tCur[c]);
            lp[c].setK(lpK); v = lp[c].step(v);
            v = hp[c].step(v);
            v = std::tanh(v * drv) / drv;
            wet[c] = v;
        }
        for (int c = 0; c < 2; ++c)
            dl[c].write(in + wet[c] * gFb * 0.7f + wet[1 - c] * gFb * 0.3f);
        outL = in + wet[0] * mixv;
        outR = in + wet[1] * mixv;
        loopEF.step(std::fabs(wet[0]) + std::fabs(wet[1]));
        meterTap = (std::fabs(wet[0]) + std::fabs(wet[1])) * 0.5f * mixv;
    }
};

// ════════════════════════════════ SWARM ════════════════════════════════
// Parallel moving filter bank (took the delay's slot in the chain). The dry
// path passes untouched; four TPT-SVF filters add a layer on top — each with
// its own octave offset around FREQ, its own LFO rate multiplier + phase (one
// RATE knob = four different movements), and its own stereo pan so the layer
// swirls. SHAPE morphs the bank bandpass→notch. The layer is soft-bounded and
// fully removed by MIX 0 or the section power. Lives inside the feedback
// circle, so the loop breathes through the moving filters.
struct SwarmFilters
{
    static constexpr int NF = 4;
    float ic1[NF] = {}, ic2[NF] = {};
    float a1[NF] = {}, a2[NF] = {}, a3[NF] = {};
    float ph[NF] = { 0.0f, 0.37f, 0.71f, 0.13f };
    Smooth sMix, sFrq, sRate, sDep, sShp;
    float sr = 48000, meterTap = 0;
    float wLP = 1, wBP = 0, wNT = 0;            // SHAPE zones: lowpass → bandpass → notch
    static constexpr float kq = 0.5f;           // Q = 2: wide enough to carry real body

    void prepare(float s) { sr = s; control(1.0f); }
    void reset() { for (int i = 0; i < NF; ++i) ic1[i] = ic2[i] = 0; }

    void control(float drift)
    {
        static constexpr float octOff[NF]  = { -1.0f, -0.33f, 0.33f, 1.0f };
        static constexpr float rateMul[NF] = { 1.0f, 0.62f, 1.41f, 0.27f };
        float base = 60.0f * std::pow(100.0f, sFrq.y) * drift;    // 60 Hz → 6 kHz
        float dep  = sDep.y * 2.0f;                               // ± up to 2 octaves
        float rate = sRate.y * sRate.y * 8.0f;                    // 0..8 Hz, fine low end
        float s2 = sShp.y * 2.0f;
        wLP = clampf(1.0f - s2, 0, 1);
        wBP = 1.0f - std::fabs(s2 - 1.0f);
        wNT = clampf(s2 - 1.0f, 0, 1);
        for (int i = 0; i < NF; ++i)
        {
            ph[i] += rate * rateMul[i] * ((float) kCtrlInterval / sr);
            ph[i] -= std::floor(ph[i]);
            float fc = base * std::pow(2.0f, octOff[i] + dep * sinTurns(ph[i]));
            fc = clampf(fc, 40.0f, 0.4f * sr);
            float g = std::tan(kPi * fc / sr);
            a1[i] = 1.0f / (1.0f + g * (g + kq));
            a2[i] = g * a1[i];
            a3[i] = g * a2[i];
        }
    }

    // mono in → dry + panned moving layer (engage = smoothed power switch)
    void process(float in, float& L, float& R,
                 float mixT, float frqT, float rateT, float depT, float shpT, float engage)
    {
        static constexpr float panL[NF] = { 0.85f, 0.35f, 0.65f, 0.15f };
        static constexpr float panR[NF] = { 0.15f, 0.65f, 0.35f, 0.85f };
        float mixv = sMix.step(mixT);
        sFrq.step(frqT); sRate.step(rateT); sDep.step(depT); sShp.step(shpT);
        float layL = 0, layR = 0;
        for (int i = 0; i < NF; ++i)
        {
            float v3 = in - ic2[i];
            float v1 = a1[i] * ic1[i] + a2[i] * v3;
            float v2 = ic2[i] + a2[i] * ic1[i] + a3[i] * v3;
            ic1[i] = 2.0f * v1 - ic1[i];
            ic2[i] = 2.0f * v2 - ic2[i];
            float low   = v2;                    // resonant LP: the classic audible sweep
            float band  = v1;
            float notch = in - kq * v1;
            float y = low * wLP * 1.3f + band * wBP * 2.2f + notch * wNT;
            layL += y * panL[i];
            layR += y * panR[i];
        }
        layL = std::tanh(layL * 0.6f) * (1.0f / 0.6f);
        layR = std::tanh(layR * 0.6f) * (1.0f / 0.6f);
        float gv = mixv * 1.2f * engage;         // slight over-unity presence at full MIX
        L = in + layL * gv;
        R = in + layR * gv;
        meterTap = (std::fabs(layL) + std::fabs(layR)) * 0.5f * gv;
    }
};

// ═══════════════════════════════ SYNC DELAY ═══════════════════════════════
// The industry delay: FREE 1..1000 ms (log) or tempo divisions from the host
// BPM (1/1..1/32 incl. dotted + triplet). Damped, DC-safe, tanh-bounded
// feedback; ping-pong crossfeed; slewed time = tape-style repitch on changes.
struct SyncDelay
{
    DelayLine dl[2];
    OnePoleLP damp[2];
    OnePoleHP hpf[2];
    Smooth sMix, sTim, sFb;
    float sr = 48000;
    float tCur[2] = { 4800, 4800 }, tTgt = 4800;
    float gFb = 0;
    bool  pp = false;
    float meterTap = 0;

    void prepare(float s)
    {
        sr = s;
        for (int c = 0; c < 2; ++c)
        {
            dl[c].prepare((int)(2.2f * s));
            damp[c].setHz(9000.0f, s);
            hpf[c].setHz(60.0f, s);
        }
    }
    void reset()
    {
        for (int c = 0; c < 2; ++c) { dl[c].reset(); damp[c].reset(); hpf[c].reset(); }
    }

    void control(float syncBeats, float bpm, bool pingpong)
    {
        pp = pingpong;
        float sec = (syncBeats <= 0.0f)
            ? 0.001f * std::pow(1000.0f, sTim.y)                       // 1 ms → 1 s
            : (60.0f / clampf(bpm, 20.0f, 999.0f)) * syncBeats;
        tTgt = clampf(sec * sr, 32.0f, (float) dl[0].size - 8.0f);
        gFb = clampf(sFb.y, 0.0f, 1.0f) * 0.92f;
    }

    void process(float& L, float& R, float mixT, float timT, float fbT)
    {
        float mixv = sMix.step(mixT);
        sTim.step(timT); sFb.step(fbT);
        float wet[2];
        for (int c = 0; c < 2; ++c)
        {
            tCur[c] += 0.0008f * (tTgt - tCur[c]);
            float v = dl[c].readCubic(tCur[c]);
            v = damp[c].step(v);
            v = hpf[c].step(v);
            wet[c] = std::tanh(v * 1.1f) * (1.0f / 1.1f);
        }
        if (pp)
        {
            // true ping-pong: mono input feeds ONLY the left line; its echo
            // crosses to the right line, and back — L, R, L, R...
            // (cross-feeding identical L/R inputs is inaudible — the old bug)
            dl[0].write((L + R) * 0.5f + wet[1] * gFb);
            dl[1].write(wet[0] * gFb);
        }
        else
        {
            dl[0].write(L + wet[0] * gFb);
            dl[1].write(R + wet[1] * gFb);
        }
        L += wet[0] * mixv;
        R += wet[1] * mixv;
        meterTap = (std::fabs(wet[0]) + std::fabs(wet[1])) * 0.5f * mixv;
    }
};

// ═══════════════════════════════ FILTER ═══════════════════════════════
// The master filter (Serum-style): TPT SVF — LP12 / LP24 / BP / HP / Notch,
// cutoff 20 Hz..20 kHz, resonance to the edge of self-oscillation, mix.
// Sits between the voice sum and DRIVE (classic subtractive order).
struct FilterStage
{
    float ic1a = 0, ic2a = 0, ic1b = 0, ic2b = 0;
    float a1 = 0, a2 = 0, a3 = 0, kq = 1;
    int   type = 0;
    Smooth sCut, sRes, sMix;
    float sr = 48000;
    float meterTap = 0;

    void prepare(float s) { sr = s; control(0); }
    void reset() { ic1a = ic2a = ic1b = ic2b = 0; }

    void control(int typ)
    {
        type = typ;
        float fc = 20.0f * std::pow(1000.0f, sCut.y);          // 20 Hz → 20 kHz
        float q  = 0.5f + sRes.y * sRes.y * 11.5f;             // fine at the bottom
        kq = 1.0f / q;
        float g = std::tan(kPi * clampf(fc, 20.0f, 0.47f * sr) / sr);
        a1 = 1.0f / (1.0f + g * (g + kq));
        a2 = g * a1;
        a3 = g * a2;
    }

    void svf(float x, float& ic1, float& ic2, float& lo, float& bp, float& hi)
    {
        float v3 = x - ic2;
        float v1 = a1 * ic1 + a2 * v3;
        float v2 = ic2 + a2 * ic1 + a3 * v3;
        ic1 = 2.0f * v1 - ic1;
        ic2 = 2.0f * v2 - ic2;
        lo = v2; bp = v1; hi = x - kq * v1 - v2;
    }

    float process(float x, float cutT, float resT, float mixT, float engage)
    {
        sCut.step(cutT); sRes.step(resT);
        float mixv = sMix.step(mixT);
        float lo, bp, hi;
        svf(x, ic1a, ic2a, lo, bp, hi);
        float y;
        switch (type)
        {
            default:
            case 0: y = lo; break;                                   // LP 12
            case 1: { float l2, b2, h2; svf(lo, ic1b, ic2b, l2, b2, h2); y = l2; } break;   // LP 24
            case 2: y = bp * (1.0f / (1.0f + (1.0f / kq - 0.5f) * 0.06f)); break;           // BP (comped)
            case 3: y = hi; break;                                   // HP
            case 4: y = x - kq * bp; break;                          // Notch
        }
        float out = x + (y - x) * mixv * engage;
        meterTap = std::fabs(out);
        return out;
    }
};

// ══════════════════════════════ SHIMMER VERB ══════════════════════════════
// 8-line Householder FDN, two modulated lines, Dattorro 2-tap +1-octave
// shimmer injected into the feedback (LP in the loop = structural decay
// guarantee — energy walks up an octave per pass and out of the passband).
struct ShimmerVerb
{
    static constexpr int NL = 8;
    DelayLine line[NL];
    OnePoleLP damp[NL];
    float len[NL] = {};
    float g[NL] = {};
    // input diffusers (Schroeder allpass, w[n] = x + g*w[n-D]; y = w[n-D] - g*w[n])
    DelayLine ap1, ap2; float ap1Len = 245, ap2Len = 610;
    DelayLine shimBuf;
    OnePoleHP shimHP; OnePoleLP shimLP;
    Smooth sSpace, sShim;
    EnvFollow tailEF;
    float sr = 48000, shimW = 3600;
    float shPh = 0, ph1 = 0, ph2 = 0;
    float wet = 0, gShim = 0, modDepth = 6;
    float meterTap = 0;

    void prepare(float s)
    {
        sr = s;
        static constexpr int base[NL] = { 1123, 1459, 1721, 2081, 2467, 2833, 3253, 3701 };
        float k = sr / 48000.0f;
        for (int i = 0; i < NL; ++i)
        {
            len[i] = std::floor(base[i] * k);
            line[i].prepare((int) len[i] + 64);
        }
        ap1Len = std::floor(245 * k); ap2Len = std::floor(610 * k);
        ap1.prepare((int) ap1Len + 8); ap2.prepare((int) ap2Len + 8);
        shimW = std::floor(3600 * k);
        shimBuf.prepare((int) shimW + 8);
        shimHP.setHz(250.0f, sr); shimLP.setHz(5000.0f, sr);
        tailEF.setTimes(0.03f, 0.5f, sr);
        control(0.0f, 0.0f);
    }
    void reset()
    {
        for (int i = 0; i < NL; ++i) { line[i].reset(); damp[i].reset(); }
        ap1.reset(); ap2.reset(); shimBuf.reset(); tailEF.reset();
    }

    void control(float bloom, float moveExtra)
    {
        float space = sSpace.y, shim = sShim.y;
        float t60 = 0.4f + space * space * 11.0f;
        float cut = 6500.0f - space * 2500.0f;
        for (int i = 0; i < NL; ++i)
        {
            g[i] = std::pow(10.0f, -3.0f * len[i] / (t60 * sr));
            damp[i].setHz(cut, sr);
        }
        wet = std::min(space * 1.5f, 1.0f) * 0.7f;
        gShim = shim * shim * 0.55f * (1.0f + bloom * 0.4f);
        modDepth = (6.0f + shim * 10.0f + moveExtra * 8.0f) * (sr / 48000.0f);
    }

    static float apStep(DelayLine& d, float lenS, float x)
    {
        float w = d.readLin(lenS);
        float in = x + 0.62f * w;
        d.write(in);
        return w - 0.62f * in;
    }

    void process(float inL, float inR, float& outL, float& outR, float spaceT, float shimT)
    {
        sSpace.step(spaceT); sShim.step(shimT);
        float xin = (inL + inR) * 0.5f;
        xin = apStep(ap2, ap2Len, apStep(ap1, ap1Len, xin));

        ph1 += 0.31f / sr; ph1 -= std::floor(ph1);
        ph2 += 0.47f / sr; ph2 -= std::floor(ph2);

        float y[NL];
        for (int i = 0; i < NL; ++i)
        {
            float dlen = len[i];
            if (i == 1) dlen += modDepth * sinTurns(ph1);
            if (i == 4) dlen += modDepth * sinTurns(ph2);
            y[i] = damp[i].step(line[i].readLin(dlen)) * g[i];
        }
        float sum = 0; for (int i = 0; i < NL; ++i) sum += y[i];
        float s = 0.25f * sum;                                  // 2/N Householder term

        // shimmer: +1 octave (read head at 2x write rate = shrinking delay)
        shimBuf.write((y[0] + y[3] + y[5]) * 0.333f);
        shPh += 1.0f / shimW; shPh -= std::floor(shPh);
        float fA = shPh, fB = fracf(shPh + 0.5f);
        float sh = shimBuf.readLin((1.0f - fA) * shimW + 1.0f) * sinTurns(fA * 0.5f)
                 + shimBuf.readLin((1.0f - fB) * shimW + 1.0f) * sinTurns(fB * 0.5f);
        sh = shimLP.step(shimHP.step(sh));
        sh = std::tanh(sh * 1.2f) * (1.0f / 1.2f) * gShim;

        // all-positive input + grouped all-positive taps: alternating signs
        // pair-cancelled correlated LOW content (bass reverb vanished, -26 dB —
        // caught by the level diagnostic). Diversity of delay lengths still
        // decorrelates mids/highs; bass now sums constructively like a real hall.
        static constexpr float shsgn[NL]  = { 1, 1, -1, 1, -1, -1, 1, -1 };
        for (int i = 0; i < NL; ++i)
            line[i].write(xin * 0.6f + (y[i] - s) + sh * 0.25f * shsgn[i]);

        float wetL = (y[0] + y[2] + y[4] + y[6]) * 0.3f;
        float wetR = (y[1] + y[3] + y[5] + y[7]) * 0.3f;
        outL = inL + wetL * wet;
        outR = inR + wetR * wet;
        tailEF.step(std::fabs(wetL) + std::fabs(wetR));
        meterTap = (std::fabs(wetL) + std::fabs(wetR)) * 0.5f * wet;
    }
};

// ════════════════════════════════ OTT ×6 ════════════════════════════════
// Exact port of build_ott_code(6): one macro drives density + tone, stages
// engage progressively, alternating band-tilt. Stereo with linked envelopes
// (identical to the mono genexpr when L==R). The genexpr's always-on
// tanh(0.8x) output is crossfaded in so zero = clean bypass in the chain.
struct OttChain
{
    static constexpr int NS = 6;
    Smooth sCol;
    float xlo[NS][2] = {}, xhi[NS][2] = {};
    float elo[NS] = {}, emid[NS] = {}, ehi[NS] = {};
    float loc = 0.03f, hic = 0.25f;
    float meterTap = 0;

    void prepare(float sr)
    {
        loc = 1.0f - std::exp(-kTwoPi * 250.0f  / sr);
        hic = 1.0f - std::exp(-kTwoPi * 2500.0f / sr);
    }
    void reset()
    {
        for (int i = 0; i < NS; ++i)
        {
            xlo[i][0] = xlo[i][1] = xhi[i][0] = xhi[i][1] = 0;
            elo[i] = emid[i] = ehi[i] = 0;
        }
    }

    void process(float inL, float inR, float& outL, float& outR, float ottT)
    {
        float mo = sCol.step(ottT);
        float am = mo;
        float tgt = 0.10f + mo * 0.14f;
        const float atk = 0.01f, rel = 0.0008f;
        float sig[2] = { inL, inR };
        for (int i = 0; i < NS; ++i)
        {
            float blo[2], bmid[2], bhi[2];
            for (int c = 0; c < 2; ++c)
            {
                xlo[i][c] += loc * (sig[c] - xlo[i][c]); blo[c] = xlo[i][c];
                xhi[i][c] += hic * (sig[c] - xhi[i][c]);
                bhi[c]  = sig[c] - xhi[i][c];
                bmid[c] = xhi[i][c] - blo[c];
            }
            float al  = (std::fabs(blo[0])  + std::fabs(blo[1]))  * 0.5f;
            float am2 = (std::fabs(bmid[0]) + std::fabs(bmid[1])) * 0.5f;
            float ah  = (std::fabs(bhi[0])  + std::fabs(bhi[1]))  * 0.5f;
            elo[i]  += (al  > elo[i]  ? atk : rel) * (al  - elo[i]);
            emid[i] += (am2 > emid[i] ? atk : rel) * (am2 - emid[i]);
            ehi[i]  += (ah  > ehi[i]  ? atk : rel) * (ah  - ehi[i]);

            float wetv = clampf((am - (float) i * 0.07f) * 1.8f, 0, 1);
            float dep  = 0.18f + am * 0.5f + mo * 0.15f;
            float tb   = (mo - 0.5f) * ((i % 2 == 0) ? 1.0f : -1.0f);
            float gl = clampf(std::pow((tgt + 1e-4f) / (elo[i]  + 1e-4f), dep), 0.2f, 10.0f);
            float gm = clampf(std::pow((tgt + 1e-4f) / (emid[i] + 1e-4f), dep), 0.2f, 10.0f);
            float gh = clampf(std::pow((tgt + 1e-4f) / (ehi[i]  + 1e-4f), dep), 0.2f, 10.0f);
            for (int c = 0; c < 2; ++c)
            {
                float ott = blo[c] * gl * (1.0f - tb * 0.6f) + bmid[c] * gm + bhi[c] * gh * (1.0f + tb * 0.6f);
                sig[c] += (ott - sig[c]) * wetv;
            }
        }
        float byp = clampf(mo * 4.0f, 0, 1);
        outL = inL + (std::tanh(sig[0] * 0.8f) - inL) * byp;
        outR = inR + (std::tanh(sig[1] * 0.8f) - inR) * byp;
        meterTap = (std::fabs(outL - inL) + std::fabs(outR - inR)) * 0.5f;
    }
};

// ═══════════════════════════ FREQUENCY SHIFTER ═══════════════════════════
// Niemitalo IIR Hilbert pair (two 4-section allpass cascades in z^-2, one path
// delayed a sample) + quadrature NCO → single-sideband shift. 8 mults/sample.
struct AP2z
{
    float x1 = 0, x2 = 0, y1 = 0, y2 = 0, c = 0;
    float step(float x)
    {
        float y = c * (x + y2) - x2;
        x2 = x1; x1 = x; y2 = y1; y1 = y;
        return y;
    }
    void reset() { x1 = x2 = y1 = y2 = 0; }
};

struct FreqShifter
{
    AP2z A[4], B[4];
    float bDel = 0, ph = 0, sr = 48000;

    void prepare(float s)
    {
        sr = s;
        static constexpr double aA[4] = { 0.6923877778065452, 0.9360654322959357, 0.9882295226860673, 0.9987488452737023 };
        static constexpr double aB[4] = { 0.4021921162426724, 0.8561710882420683, 0.9722909545651805, 0.9952884791278212 };
        for (int i = 0; i < 4; ++i) { A[i].c = (float)(aA[i] * aA[i]); B[i].c = (float)(aB[i] * aB[i]); }
    }
    void reset() { for (int i = 0; i < 4; ++i) { A[i].reset(); B[i].reset(); } bDel = 0; }

    float process(float x, float hz)
    {
        float i = x, q = x;
        for (int k = 0; k < 4; ++k) { i = A[k].step(i); q = B[k].step(q); }
        float qd = bDel; bDel = q;
        ph += hz / sr; ph -= std::floor(ph);
        return i * sinTurns(ph + 0.25f) - qd * sinTurns(ph);
    }
};

// ═══════════════════════════ GLOBAL FEEDBACK LOOP ═══════════════════════════
// tap(post-OTT) → HP 120 (bass anchor: sub never loops) → gain (≤0.92)
// → COLOR TPT-SVF morphing LP→BP→HP along its cutoff sweep (Mimeophon-style)
// → frequency shifter (±12 Hz, cubic taper: barberpole risers)
// → tanh bound → DC block → short delay → re-inject pre-delay.
struct FeedbackLoop
{
    OnePoleHP tapHP;
    FreqShifter shifter;
    DCBlock dc;
    DelayLine dl;
    Smooth sAmt, sTone, sTim, sShf;
    float sr = 48000;
    float ic1 = 0, ic2 = 0;                        // TPT SVF states
    float a1 = 0, a2 = 0, a3 = 0, kq = 1.25f;
    float wLP = 1, wBP = 0, wHP = 0;
    float gAmt = 0, hz = 0;
    float tCur = 480, tTgt = 480;
    float meterTap = 0;

    void prepare(float s)
    {
        sr = s;
        tapHP.setHz(70.0f, sr);        // bass anchor: DC/sub out, low harmonics still loop
        shifter.prepare(sr);
        dl.prepare((int)(0.3f * sr));
        control(0.0f);
    }
    void resetState()
    {
        ic1 = ic2 = 0; dc.reset(); shifter.reset(); dl.reset();
    }

    void control(float toneDrift)
    {
        float tone = clampf(sTone.y + toneDrift, 0, 1);
        float cut  = 120.0f * std::pow(66.7f, tone);
        float gg   = std::tan(kPi * clampf(cut, 40.0f, 0.4f * sr) / sr);
        a1 = 1.0f / (1.0f + gg * (gg + kq));
        a2 = gg * a1;
        a3 = gg * a2;
        // overlapping morph: BP always present so mid positions stay full-bodied
        wLP = clampf(1.2f - 2.0f * tone, 0, 1);
        wHP = clampf(2.0f * tone - 0.8f, 0, 1);
        wBP = 1.0f - std::fabs(2.0f * tone - 1.0f) * 0.8f;
        float sh = 2.0f * (sShf.y - 0.5f);
        hz = sh * sh * sh * 12.0f;
        // reaches slightly PAST unity loop gain at max — the tanh bound turns
        // that into the spec'd musical scream instead of runaway; hot enough
        // to ignite from ~0.8 instead of only at the very top
        gAmt = std::pow(clampf(sAmt.y, 0, 1), 1.1f) * 1.18f;
        tTgt = clampf(0.002f * std::pow(125.0f, sTim.y) * sr, 24.0f, (float) dl.size - 8.0f);
    }

    float process(float tap, float amtT, float toneT, float timT, float shfT)
    {
        sAmt.step(amtT); sTone.step(toneT); sTim.step(timT); sShf.step(shfT);
        float x = tapHP.step(tap) * gAmt;
        // TPT SVF (Zavalishin) — stable at any cutoff
        float v3 = x - ic2;
        float v1 = a1 * ic1 + a2 * v3;
        float v2 = ic2 + a2 * ic1 + a3 * v3;
        ic1 = 2.0f * v1 - ic1;
        ic2 = 2.0f * v2 - ic2;
        float low = v2, band = v1, high = x - kq * v1 - v2;
        float y = low * wLP + band * wBP * 1.6f + high * wHP;
        y = shifter.process(y, hz);
        y = std::tanh(y * 1.3f) * (1.0f / 1.3f);
        y = dc.step(y);
        tCur += 0.0008f * (tTgt - tCur);
        dl.write(y);
        float o = dl.readCubic(tCur) * 0.9f;
        if (!finitef(o)) { resetState(); o = 0; }
        meterTap = std::fabs(o);
        return o;
    }
};

// ═══════════════════════════════ TILT + CLIP ═══════════════════════════════
struct TiltClip
{
    OnePoleLP split[2];
    Smooth sTilt, sOut;
    float gLo = 1, gHi = 1, d = 1.5f, invTanhD = 1.0f / 0.905f;

    void prepare(float sr) { for (int c = 0; c < 2; ++c) split[c].setHz(800.0f, sr); }
    void reset() { split[0].reset(); split[1].reset(); }

    void control(float ottNudge)
    {
        float db = (sTilt.y - 0.5f) * 12.0f;
        gLo = std::pow(10.0f, -db / 40.0f);
        gHi = std::pow(10.0f,  db / 40.0f);
        d = 0.7f + clampf(sOut.y + ottNudge, 0, 1.05f) * 2.3f;
        invTanhD = 1.0f / std::tanh(d);
    }

    float process(float x, int c, float tiltT, float outT)
    {
        if (c == 0) { sTilt.step(tiltT); sOut.step(outT); }
        float lo = split[c].step(x);
        float v = lo * gLo + (x - lo) * gHi;
        return std::tanh(v * d) * invTanhD;
    }
};

// ═══════════════════════════════ MOVE (chaos) ═══════════════════════════════
// Lorenz attractor at control rate → three correlated drift outputs. Depths are
// subtle (felt, not heard); feedback-adjacent targets only ever drift the tone,
// never the loop gain.
struct ChaosMod
{
    Lorenz lz;
    Smooth sMove;
    float xS = 0, yS = 0, zS = 0, depth = 0;

    void control(float moveT)
    {
        float mv = sMove.y;
        for (int i = 0; i < kCtrlInterval; ++i) sMove.step(moveT);
        lz.step(0.0012f + mv * 0.0028f);
        depth = mv * mv;
        xS += 0.05f * (lz.xn() - xS);
        yS += 0.05f * (lz.yn() - yS);
        zS += 0.05f * (lz.zn() - zS);
    }
    float morphDrift()   const { return xS * 0.09f * depth; }
    float toneDrift()    const { return yS * 0.15f * depth; }
    float stretchDrift() const { return zS * 0.07f * depth; }   // inharmonicity breathes
    float fltDrift()     const { return 1.0f + zS * 0.08f * depth; }   // swarm center drifts
    float verbExtra()    const { return std::fabs(xS) * depth; }
};

// ══════════════════════════════ COUPLINGS ══════════════════════════════
// The fixed "alive wiring" (research §7): envelope followers on key taps drive
// small tuned couplings. Half of them are negative/stabilising by design.
struct Couplings
{
    EnvFollow inFast, inSlow, ottAct, loopBus;
    float gap = 0, gk = 1e-5f;

    void prepare(float sr)
    {
        inFast.setTimes(0.002f, 0.06f, sr);
        inSlow.setTimes(0.08f,  0.3f,  sr);
        ottAct.setTimes(0.01f,  0.3f,  sr);
        loopBus.setTimes(0.01f, 0.3f,  sr);
        gk = 1.0f / (2.0f * sr);
    }
    void reset() { inFast.reset(); inSlow.reset(); ottAct.reset(); loopBus.reset(); gap = 0; }

    void trackInput(float x)
    {
        inFast.step(x); inSlow.step(x);
        gap += gk * ((1.0f - norm01(inSlow.e)) - gap);         // ~2 s "silence blooms" integrator
    }
    float transient() const { return std::max(0.0f, norm01(inFast.e) - norm01(inSlow.e)); }
};

// ═══════════════════════════════ BUS CHAIN ═══════════════════════════════
struct BusChain
{
    FilterStage  filt;
    DriveStage   drive;
    GrindStage   grind;
    MetalBank    metal;
    SwarmFilters swarm;
    SyncDelay    dly;
    ShimmerVerb  verb;
    OttChain     ott;
    FeedbackLoop fbloop;
    WidthStage   widthFx;
    TiltClip     tiltclip;
    ChaosMod     chaos;
    Couplings    couple;
    Smooth       sMix, sDuck;
    Smooth sOnDrive, sOnGrind, sOnMetal, sOnFlt, sOnVerb, sOnFb, sOnOtt,   // power switches
           sOnDly, sOnFilt;
    float loopPrev = 0;
    int   ctrlCnt = 0;
    float sr = 48000;

    // meter followers (audio side) + atomics (UI side)
    static constexpr int kNumMeters = 11; // in filt drive grind metal swarm dly verb ott loop out
    EnvFollow mf[kNumMeters];
    std::atomic<float> meters[kNumMeters] = {};
    std::atomic<float> accent { 0 };     // loop-bus energy → UI accent

    void prepare(float s)
    {
        sr = s;
        filt.prepare(s); drive.prepare(s);
        grind.prepare(s); metal.prepare(s); swarm.prepare(s); dly.prepare(s); verb.prepare(s);
        ott.prepare(s); fbloop.prepare(s); widthFx.prepare(s); tiltclip.prepare(s); couple.prepare(s);
        for (auto& f : mf) f.setCoeffs(0.01f, 0.0005f);
        loopPrev = 0; ctrlCnt = 0;
    }
    void reset()
    {
        filt.reset(); drive.reset(); grind.reset(); metal.reset(); swarm.reset();
        dly.reset(); verb.reset();
        ott.reset(); fbloop.resetState(); widthFx.reset(); tiltclip.reset(); couple.reset();
        loopPrev = 0;
    }
    void retune(float f0) { metal.retune(f0); }

    // jump every smoother to the current targets (called from prepareToPlay so a
    // freshly-loaded plugin doesn't fade in from all-zero smoother states)
    void snapParams(const FxParams& p)
    {
        drive.sAm.snap(p.driveAmt); drive.sMx.snap(p.driveMix);
        drive.snapPos(p.driveType, p.driveMorph);
        drive.sFc.snap(p.drvFltCut); drive.sFq.snap(p.drvFltRes);
        filt.sCut.snap(p.filtCutoff); filt.sRes.snap(p.filtRes); filt.sMix.snap(p.filtMix);
        dly.sMix.snap(p.dlyMix); dly.sTim.snap(p.dlyTime); dly.sFb.snap(p.dlyFb);
        widthFx.sW.snap(p.width);
        grind.sCr.snap(p.crush); grind.sGr.snap(p.grind);
        metal.sMet.snap(p.metal); metal.sMat.snap(p.material);
        swarm.sMix.snap(p.fltMix); swarm.sFrq.snap(p.fltFreq); swarm.sRate.snap(p.fltRate);
        swarm.sDep.snap(p.fltDepth); swarm.sShp.snap(p.fltShape);
        verb.sSpace.snap(p.space); verb.sShim.snap(p.shimmer);
        ott.sCol.snap(p.ott);
        fbloop.sAmt.snap(p.fbAmt); fbloop.sTone.snap(p.fbTone);
        fbloop.sTim.snap(p.fbTime); fbloop.sShf.snap(p.fbShift);
        tiltclip.sTilt.snap(p.tilt); tiltclip.sOut.snap(p.outDrive);
        chaos.sMove.snap(p.move);
        sMix.snap(p.mix); sDuck.snap(p.fbAmt);
        sOnDrive.snap(p.driveOn); sOnGrind.snap(p.grindOn); sOnMetal.snap(p.metalOn);
        sOnFlt.snap(p.fltOn); sOnVerb.snap(p.verbOn); sOnFb.snap(p.fbOn); sOnOtt.snap(p.ottOn);
        sOnDly.snap(p.dlyOn); sOnFilt.snap(p.filtOn);
        metal.control(); swarm.control(1.0f); verb.control(0.0f, 0.0f);
        filt.control(p.filtType); drive.control(p.drvFltType);
        dly.control(p.dlySyncBeats, p.bpm, p.dlyPP > 0.5f);
        fbloop.control(0.0f); tiltclip.control(0.0f);
    }

    void processSample(float mono, float& L, float& R, const FxParams& p, float lastF0)
    {
        if (ctrlCnt-- <= 0)
        {
            ctrlCnt = kCtrlInterval - 1;
            chaos.control(p.move);
            metal.control();
            swarm.control(chaos.fltDrift());
            filt.control(p.filtType);
            drive.control(p.drvFltType);
            dly.control(p.dlySyncBeats, p.bpm, p.dlyPP > 0.5f);
            verb.control(couple.gap, chaos.verbExtra());
            fbloop.control(chaos.toneDrift());
            tiltclip.control(norm01(couple.ottAct.e) * 0.15f);   // density audibly "works" the clip
        }

        couple.trackInput(mono);
        // every stage keeps processing while bypassed (tails stay warm); the
        // power switches crossfade the chain around it, click-free
        float d  = drive.process(mono, p.driveAmt, p.driveType, p.driveMorph, p.driveMix,
                                 p.drvFltCut, p.drvFltRes, couple.transient());
        d = lerpf(mono, d, sOnDrive.step(p.driveOn));
        float g  = grind.process(d, p.crush, p.grind);
        g = lerpf(d, g, sOnGrind.step(p.grindOn));
        float mt = metal.process(g, p.metal, p.material);
        mt = lerpf(g, mt, sOnMetal.step(p.metalOn));
        // master filter AFTER the dirt: the always-on grind/drive saturation
        // regenerates harmonics, so a pre-dirt filter was barely audible
        float fl = filt.process(mt, p.filtCutoff, p.filtRes, p.filtMix, sOnFilt.step(p.filtOn));

        float duck = sDuck.step(p.fbAmt) * 0.12f;
        float inj  = fl * (1.0f - duck) + loopPrev;
        (void) lastF0;

        float dl, dr;
        swarm.process(inj, dl, dr, p.fltMix, p.fltFreq, p.fltRate, p.fltDepth, p.fltShape,
                      sOnFlt.step(p.fltOn));
        // sync delay in the loop circle (post-swarm) — wet gated by its power
        {
            float preL = dl, preR = dr;
            dly.process(dl, dr, p.dlyMix, p.dlyTime, p.dlyFb);
            const float onDly = sOnDly.step(p.dlyOn);
            dl = lerpf(preL, dl, onDly); dr = lerpf(preR, dr, onDly);
        }
        float vl, vr;
        verb.process(dl, dr, vl, vr, p.space, p.shimmer);
        const float onVerb = sOnVerb.step(p.verbOn);
        vl = lerpf(dl, vl, onVerb); vr = lerpf(dr, vr, onVerb);
        float ol, orr;
        ott.process(vl, vr, ol, orr, p.ott);
        const float onOtt = sOnOtt.step(p.ottOn);
        ol = lerpf(vl, ol, onOtt); orr = lerpf(vr, orr, onOtt);
        couple.ottAct.step(ott.meterTap * onOtt);

        loopPrev = fbloop.process((ol + orr) * 0.5f, p.fbAmt, p.fbTone, p.fbTime, p.fbShift)
                   * sOnFb.step(p.fbOn);
        couple.loopBus.step(loopPrev);

        widthFx.process(ol, orr, p.width);   // after the tap: the loop never sees the Haas comb

        float tl = tiltclip.process(ol,  0, p.tilt, p.outDrive);
        float tr = tiltclip.process(orr, 1, p.tilt, p.outDrive);

        // dry anchor is soft-bounded: a full poly stack can't blow past the wet
        // ceiling (the wet path keeps the raw sum — drive character parity)
        float mixv = sMix.step(p.mix);
        float dryA = std::tanh(mono * 0.6f) * (1.0f / 0.6f);
        L = dryA * (1.0f - mixv) + tl * mixv;
        R = dryA * (1.0f - mixv) + tr * mixv;

        // meters (post-switch, so the rail shows what's actually in the chain)
        mf[0].step(mono); mf[1].step(d); mf[2].step(g); mf[3].step(mt); mf[4].step(fl);
        mf[5].step(swarm.meterTap);
        mf[6].step(dly.meterTap * sOnDly.y);
        mf[7].step(verb.meterTap * onVerb);
        mf[8].step(ott.meterTap * onOtt);
        mf[9].step(loopPrev); mf[10].step((L + R) * 0.5f);
    }

    void publishMeters()
    {
        for (int i = 0; i < kNumMeters; ++i)
            meters[i].store(mf[i].e, std::memory_order_relaxed);
        accent.store(norm01(couple.loopBus.e), std::memory_order_relaxed);
    }
};

} // namespace cru
