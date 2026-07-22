// Crucible — the voice: spectral-morph oscillator + ADSR + modal resonator bank.
// Each block is a 1:1 translation of the corresponding gen~ codebox in
// crucible/build_crucible.py (OSC / ENV / MODAL). One VoiceCore per poly voice —
// playing monophonically reproduces the M4L device exactly (including the glide
// from the smoothed-f0 History and the initial 55 Hz swoop on first note).
#pragma once
#include "DspUtil.h"
#include "MorphTable.h"
#include <atomic>

namespace cru {

// per-block parameter targets shared by all voices (written by the processor)
struct VoiceParams
{
    float morph = 0, morph2 = 0.35f, pulsar = 0, formant = 0.5f, rips = 0, ripshape = 0.3f;
    float drift = 0, stretch = 0.5f, fractal = 0;
    float volA = 1, volB = 1, onA = 1, onB = 1, fm = 0.5f;   // A/B mixer + bipolar FM
    int   waveA = 0, waveB = 0;                              // 0 sine 1 tri 2 square 3 saw
    int   octA = 2, octB = 2;                                // index into {-2,-1,0,+1,+2}
    float attack = 0.02f, decay = 0.25f, sustain = 0.7f, release = 0.3f, curveA = 0.5f;
    float attackB = 0.02f, decayB = 0.25f, sustainB = 0.7f, releaseB = 0.3f, curveB = 0.5f;
    float modalRes = 0, modalTune = 0, modalRing = 0.5f;
};

// Base-wave harmonic beds, ADDED under each osc's morph vector (bins 2..16
// only — bin 1 stays owned by the morph vector, so the fundamental anchor is
// untouched). SINE adds nothing = exact legacy behavior; SAW at morph 0 IS a
// saw. The morph then layers its timbre on top of the chosen bed.
struct BaseWaves
{
    float w[4][MorphTable::NH];
    float comp[4] = { 1.0f, 1.10f, 1.05f, 0.95f };   // loudness compensation
    BaseWaves()
    {
        for (int k = 1; k <= MorphTable::NH; ++k)
        {
            w[0][k - 1] = 0.0f;                                                       // sine (bed empty)
            w[1][k - 1] = (k >= 3 && k % 2 == 1) ? 1.0f / (float) (k * k) : 0.0f;      // triangle
            w[2][k - 1] = (k >= 3 && k % 2 == 1) ? 1.0f / (float) k : 0.0f;            // square
            w[3][k - 1] = (k >= 2) ? 1.0f / (float) k : 0.0f;                          // saw
        }
    }
};
inline const BaseWaves& baseWaves() { static BaseWaves b; return b; }

constexpr float kOctMult[5] = { 0.25f, 0.5f, 1.0f, 2.0f, 4.0f };

// phase-locked rip operator (the RIPS math, factored): tear only the non-peak
// regions, in `cnt` windows locked to the cycle phase — precise and morph-safe
// because the mask protects the anchored fundamental's peaks.
inline float ripLayer(float sig, float ph, float cnt, float sharp, float driveK, float amt)
{
    float wa = clampf(1.0f - std::fabs(sig) * 3.5f, 0.0f, 1.0f);
    float cp = fracf(ph * cnt);
    float ga = std::pow(clampf(1.0f - std::fabs(2.0f * cp - 1.0f), 0.0f, 1.0f), sharp);
    float rp = std::tanh(sig * driveK);
    return sig + (rp - sig) * wa * ga * amt;
}

// ── shared bin-domain manipulations (DRIFT + STRETCH) ─────────────────────
// DRIFT: each harmonic's amplitude breathes on its own slow cycle (per-bin
// rate spread; the fundamental is exempt so the bass anchor holds).
// STRETCH: bipolar partial stretch f0*k^(1+s³·0.16) — organ-cluster ↔
// bell/metal inharmonicity, exact harmonic lock at center. The inharmonic
// remainder accumulates in its own phase offset so center = original phases.
struct BinFx
{
    Smooth sDr, sSt;
    float dphk[MorphTable::NH] = {};   // accumulated inharmonic phase offsets
    float drp[MorphTable::NH]  = {};   // per-harmonic drift LFO phasors
    float rk[MorphTable::NH]   = {};   // stretched partial ratios (k^e)
    int   stCnt = 0;
    float stLast = -1.0f;
    float dr = 0, st = 0.5f;

    void snap(const VoiceParams& p) { sDr.snap(p.drift); sSt.snap(p.stretch); }

    void step(const VoiceParams& p)
    {
        dr = sDr.step(p.drift);
        st = sSt.step(p.stretch);
        if (--stCnt <= 0 || std::fabs(st - stLast) > 5e-4f)
        {
            stCnt = 64; stLast = st;
            float s = (st - 0.5f) * 2.0f;
            // the ENTIRE knob is the sweet zone (tuned by ear over two passes):
            // full travel ≈ -11%..+17% of the original ±0.02 exponent range —
            // slow, calm beating everywhere, slightly more reach on the bell side
            float sh = 0.55f * s + 0.45f * s * s * s;
            float e = 1.0f + sh * (s >= 0.0f ? 0.0035f : 0.0022f);
            for (int k = 1; k <= MorphTable::NH; ++k)
                rk[k - 1] = std::pow((float) k, e);
        }
    }

    // amplitude breathing for harmonic k (1-based); isr = 1/samplerate
    float driftMod(int k, float isr)
    {
        if (dr <= 1e-4f) return 1.0f;
        float& ph = drp[k - 1];
        ph += (0.05f + dr * 0.35f) * (1.0f + (float) k * 0.13f) * isr;
        ph -= std::floor(ph);
        float ramp = clampf(((float) k - 1.0f) * 0.25f, 0.0f, 1.0f);
        return clampf(1.0f + dr * 0.55f * ramp * sinTurns(ph), 0.0f, 2.0f);
    }

    // advance + return the inharmonic phase offset; phInc = the base phasor's
    // per-sample increment (f0/sr for the audio path, 1/512 for the display)
    float stretchPhase(int k, float phInc)
    {
        float& dp = dphk[k - 1];
        dp += phInc * (rk[k - 1] - (float) k);
        dp -= std::floor(dp);
        return dp;
    }
};

// ---- OSC: two additive spectral-morph oscillators (audio path) ----
struct MorphOsc
{
    float sr = 48000, isr = 1.0f / 48000, nyq = 24000;
    float fsm = 55.0f;      // History fsm(55) — smoothed f0 (the built-in glide)
    float mph = 0.0f;       // reference phasor (base f0): pulsar/rips window lock
    float mphA = 0.0f, mphB = 0.0f;   // per-osc phasors (octave multipliers, click-free)
    float prevA = 0, prevB = 0;   // last raw osc outputs (FM modulator taps)
    Smooth sM1, sM2, sRp, sRp2, sPu, sFo, sFr, sVa, sVb, sFm;
    BinFx bfx;

    void prepare(float s) { sr = s; isr = 1.0f / s; nyq = 0.5f * s; }
    void snapParams(const VoiceParams& p)
    {
        sM1.snap(p.morph); sM2.snap(p.morph2); sRp.snap(p.rips);
        sRp2.snap(p.ripshape); sPu.snap(p.pulsar); sFo.snap(p.formant);
        sFr.snap(p.fractal);
        sVa.snap(p.volA * p.onA); sVb.snap(p.volB * p.onB); sFm.snap(p.fm);
        bfx.snap(p);
    }

    float process(float f0target, const VoiceParams& p, float eA, float eB)
    {
        const auto& T = MorphTable::get();
        float f0in = fsm + 0.0016f * (f0target - fsm); fsm = f0in;
        float f0   = clampf(f0in, 8.0f, nyq);

        float m1  = sM1.step(p.morph);
        float m2  = sM2.step(p.morph2);
        float rps = sRp.step(p.rips);
        float shp = sRp2.step(p.ripshape);
        float pu  = sPu.step(p.pulsar);
        float fo  = sFo.step(p.formant);
        bfx.step(p);

        float p1 = m1 * (float) (MorphTable::KP - 1);
        float p2 = m2 * (float) (MorphTable::KP - 1);

        const float multA = kOctMult[p.octA];
        const float multB = kOctMult[p.octB];
        mph  += f0 * isr;          mph  -= std::floor(mph);
        mphA += f0 * multA * isr;  mphA -= std::floor(mphA);
        mphB += f0 * multB * isr;  mphB -= std::floor(mphB);

        // A/B mixer + bipolar FM (true phase modulation of the additive stack:
        // partial k of the carrier gets a k-scaled phase offset from the other
        // osc's previous raw sample — DX-style, one-sample feedback)
        const auto& BW = baseWaves();
        const float* bwA = BW.w[p.waveA & 3];
        const float* bwB = BW.w[p.waveB & 3];
        float gA = sVa.step(p.volA * p.onA) * BW.comp[p.waveA & 3];
        float gB = sVb.step(p.volB * p.onB) * BW.comp[p.waveB & 3];
        float fmv = (sFm.step(p.fm) - 0.5f) * 2.0f;
        float phA = (fmv < 0.0f) ? fmv * fmv * 0.35f * prevB : 0.0f;   // B → A
        float phB = (fmv > 0.0f) ? fmv * fmv * 0.35f * prevA : 0.0f;   // A → B

        const float aaf = 1.0f / 2200.0f;
        float accA = 0.0f, accB = 0.0f;
        for (int k = 1; k <= MorphTable::NH; ++k)
        {
            float aaA = clampf((nyq - f0 * multA * bfx.rk[k - 1]) * aaf, 0.0f, 1.0f);
            float aaB = clampf((nyq - f0 * multB * bfx.rk[k - 1]) * aaf, 0.0f, 1.0f);
            if (aaA <= 0.0f && aaB <= 0.0f) break;       // ratios rise with k: all above clamp too
            float dm = bfx.driftMod(k, isr);
            float dp = bfx.stretchPhase(k, f0 * isr);
            float akA = (T.bin(p1, k - 1) + bwA[k - 1]) * dm * aaA;
            float akB = (T.bin(p2, k - 1) + bwB[k - 1]) * dm * aaB;
            if (akA > 1e-6f) accA += sinTurns((float) k * mphA + dp + (float) k * phA) * akA;
            if (akB > 1e-6f) accB += sinTurns((float) k * mphB + dp + (float) k * phB) * akB;
        }
        // FM taps are post-envelope: a decaying modulator fades its modulation (DX-style)
        prevA = clampf(accA * eA * 0.25f, -2.0f, 2.0f);
        prevB = clampf(accB * eB * 0.25f, -2.0f, 2.0f);
        float sig = (accA * gA * eA + accB * gB * eB) * 0.25f;

        // PULSAR: FORMANT -> duty + level-comp so it sweeps audibly
        float duty = 0.08f + (1.0f - fo) * 0.9f;
        float pg   = 1.0f / std::sqrt(duty + 0.05f);
        float wpa  = (mph < duty) ? std::sin((mph / duty) * kPi) : 0.0f;
        sig += (sig * wpa * pg - sig) * pu;

        // RIPS layer 1 (the original, via the factored operator — identical math)
        float fr2 = sFr.step(p.fractal);
        float cnt = 1.0f + std::floor(shp * 3.99f);
        float y = ripLayer(sig, mph, cnt, 1.0f + shp * 6.0f, 1.5f + rps * 35.0f, rps);
        // FRACTAL layer 2: finer interleaved tears (odd multiple of the window
        // count so the two lattices never align), sharper taper, hotter shaper
        if (fr2 > 1e-4f)
            y = ripLayer(y, mph, cnt * 2.0f + 1.0f, 2.0f + shp * 8.0f, 2.0f + fr2 * 45.0f, fr2 * 0.9f);
        return y;
    }
};

// ---- ENV: ADSR (gen~ semantics: retrigger continues from current level,
//      decay clamps at sustain, release full-scale-normalised) + CURVE.
//      The linear state machine is unchanged (parity anchor); CURVE reshapes
//      each segment with sustain/edges anchored: 0.5 = exactly linear (gen~),
//      < 0.5 log (fast start), > 0.5 exponential (punchy analog tails). ----
struct ADSREnv
{
    float sr = 48000;
    float env = 0.0f;
    int   stg = 0;          // 1=attack, 2=decay/sustain, 0=release
    bool  pg  = false;      // previous gate
    float aStart = 0.0f;    // level when the attack began (retrigger-safe)
    float rStart = 0.0f;    // level when the release began
    float lastOut = 0.0f;   // last SHAPED output (segment handoffs stay continuous)

    void prepare(float s) { sr = s; }
    void hardReset() { env = 0; stg = 0; pg = false; aStart = 0; rStart = 0; lastOut = 0; }
    bool idle() const { return stg == 0 && env <= 0.0f; }

    static float curveFn(float u, float curve)   // u in 0..1, curve knob 0..1
    {
        float e = std::pow(2.0f, (curve - 0.5f) * 4.0f);   // exp 0.25 .. 4, 1 at center
        return std::pow(clampf(u, 0.0f, 1.0f), e);
    }

    float process(bool gate, float attack, float decay, float sustain, float release, float curve)
    {
        float asec = 0.002f + attack  * 3.0f;
        float dsec = 0.002f + decay   * 3.0f;
        float rsec = 0.002f + release * 4.0f;
        bool rising  = gate && !pg;
        bool falling = !gate && pg;
        pg = gate;
        if (rising)  { env = lastOut; aStart = env; }   // resume from the audible level
        if (falling) { env = lastOut; rStart = env; }
        stg = rising ? 1 : (!gate ? 0 : stg);
        float sus = clampf(sustain, 0.0f, 1.0f);
        float ainc = 1.0f / (asec * sr), dinc = 1.0f / (dsec * sr), rinc = 1.0f / (rsec * sr);
        env = (stg == 1) ? clampf(env + ainc, 0.0f, 1.0f)
            : (stg == 2) ? clampf(env - dinc, sus, 1.0f)
                         : clampf(env - rinc, 0.0f, 1.0f);
        if (stg == 1 && env >= 1.0f) stg = 2;

        // segment-local curving (linear position -> shaped level, endpoints anchored)
        float out;
        if (stg == 1)
        {
            float span = 1.0f - aStart;
            float u = span > 1e-4f ? (env - aStart) / span : 1.0f;
            out = aStart + span * curveFn(u, curve);
        }
        else if (stg == 2)
        {
            float span = 1.0f - sus;
            float u = span > 1e-4f ? (1.0f - env) / span : 0.0f;
            out = 1.0f - span * curveFn(u, curve);
        }
        else
        {
            float rs = std::max(rStart, 1e-4f);
            float u = 1.0f - env / rs;
            out = env <= 0.0f ? 0.0f : rs * (1.0f - curveFn(u, curve));
        }
        lastOut = out;
        return out;
    }

    void retrigger() { env = lastOut; aStart = env; stg = 1; }
};

// ---- MODAL: 6 two-pole resonators tuned to f0*ratio (Fors Tela/Mass concept) ----
struct ModalBank
{
    static constexpr int N = 6;
    float sr = 48000, nyq = 24000;
    float a[N] = {}, b[N] = {};
    Smooth sRe, sTn, sDe;

    void prepare(float s) { sr = s; nyq = 0.5f * s; }
    void reset() { for (int i = 0; i < N; ++i) a[i] = b[i] = 0; }
    void snapParams(const VoiceParams& p) { sRe.snap(p.modalRes); sTn.snap(p.modalTune); sDe.snap(p.modalRing); }
    bool ringing() const
    {
        float e = 0; for (int i = 0; i < N; ++i) e += std::fabs(a[i]) + std::fabs(b[i]);
        return e > 1e-5f;
    }

    float process(float exc, float f0, const VoiceParams& p)
    {
        float re = sRe.step(p.modalRes);
        float tn = sTn.step(p.modalTune);
        float de = sDe.step(p.modalRing);
        float r = 0.9f + de * 0.0985f, rr = r * r, ig = 1.0f - r;
        float acc = 0.0f;
        for (int i = 0; i < N; ++i)
        {
            float rat = std::pow((float) (i + 1), 1.0f + tn * 0.55f);
            float wf  = kTwoPi * clampf(f0 * rat, 8.0f, nyq * 0.99f) / sr;
            float cf  = 2.0f * r * std::cos(wf);
            float yo  = exc * ig + cf * a[i] - rr * b[i];
            b[i] = a[i]; a[i] = yo;
            acc += yo;
        }
        return exc + (acc * 0.3f - exc) * re;
    }
};

// ---- one playable voice: osc -> env -> modal (matches the M4L patch cords) ----
struct VoiceCore
{
    MorphOsc  osc;
    ADSREnv   envA, envB;   // per-osc amplitude envelopes
    ModalBank modal;
    float noteF0 = 55.0f;
    float bend   = 1.0f;    // pitch-wheel multiplier (±2 semitones), glide-smoothed downstream
    float lastEnv = 0.0f;   // loudest shaped env (UI)
    bool  gate   = false;

    void prepare(float s) { osc.prepare(s); envA.prepare(s); envB.prepare(s); modal.prepare(s); }
    void snapParams(const VoiceParams& p) { osc.snapParams(p); modal.snapParams(p); }

    // glideFrom reproduces the mono device's glide: a silent voice starts its
    // smoothed-f0 History at the PREVIOUS note's pitch (or 55 on very first note)
    void noteOn(float f0, float glideFrom, bool wasSilent)
    {
        noteF0 = f0;
        if (wasSilent) osc.fsm = glideFrom;
        gate = true;
    }
    void noteOff() { gate = false; }
    void kill()    { gate = false; envA.hardReset(); envB.hardReset(); modal.reset(); }
    bool active() const { return gate || !envA.idle() || !envB.idle() || modal.ringing(); }

    float render(const VoiceParams& p)
    {
        float eA = envA.process(gate, p.attack,  p.decay,  p.sustain,  p.release,  p.curveA);
        float eB = envB.process(gate, p.attackB, p.decayB, p.sustainB, p.releaseB, p.curveB);
        lastEnv = std::max(eA, eB);
        float f0 = noteF0 * bend;
        float s = osc.process(f0, p, eA, eB);
        return modal.process(s, f0, p);
    }
};

// ---- the 1-cycle waveform display oscillator (gen~ display path: dph phasor with
//      a 512-sample period, same harmonic weights, own pulsar/rips processing) ----
struct DisplayOsc
{
    float sr = 48000, nyq = 24000;
    float dph = 0.0f;
    float prevA = 0, prevB = 0;
    Smooth sM1, sM2, sRp, sRp2, sPu, sFo, sFr, sVa, sVb, sFm;
    BinFx bfx;
    float ring[512] = {};
    int   wi = 0;
    std::atomic<int> phase0 { 0 };   // ring index where dph wrapped (trace start)

    void prepare(float s) { sr = s; nyq = 0.5f * s; }
    void snapParams(const VoiceParams& p)
    {
        sM1.snap(p.morph); sM2.snap(p.morph2); sRp.snap(p.rips);
        sRp2.snap(p.ripshape); sPu.snap(p.pulsar); sFo.snap(p.formant);
        sFr.snap(p.fractal);
        sVa.snap(p.volA * p.onA); sVb.snap(p.volB * p.onB); sFm.snap(p.fm);
        bfx.snap(p);
    }

    void process(const VoiceParams& p, float f0ForAA)
    {
        const auto& T = MorphTable::get();
        float m1  = sM1.step(p.morph);
        float m2  = sM2.step(p.morph2);
        float rps = sRp.step(p.rips);
        float shp = sRp2.step(p.ripshape);
        float pu  = sPu.step(p.pulsar);
        float fo  = sFo.step(p.formant);
        bfx.step(p);
        float p1 = m1 * (float) (MorphTable::KP - 1);
        float p2 = m2 * (float) (MorphTable::KP - 1);

        dph += 1.0f / 512.0f;
        if (dph >= 1.0f) { dph -= std::floor(dph); phase0.store(wi, std::memory_order_relaxed); }

        float f0 = clampf(f0ForAA, 8.0f, nyq);
        const auto& BW = baseWaves();
        const float* bwA = BW.w[p.waveA & 3];
        const float* bwB = BW.w[p.waveB & 3];
        float gA = sVa.step(p.volA * p.onA) * BW.comp[p.waveA & 3];
        float gB = sVb.step(p.volB * p.onB) * BW.comp[p.waveB & 3];
        float fmv = (sFm.step(p.fm) - 0.5f) * 2.0f;
        float phA = (fmv < 0.0f) ? fmv * fmv * 0.35f * prevB : 0.0f;
        float phB = (fmv > 0.0f) ? fmv * fmv * 0.35f * prevA : 0.0f;

        const float multA = kOctMult[p.octA];
        const float multB = kOctMult[p.octB];
        const float aaf = 1.0f / 2200.0f;
        float dacc = 0.0f, daccA = 0.0f, daccB = 0.0f, nrm = 0.0001f;
        for (int k = 1; k <= MorphTable::NH; ++k)
        {
            float aaA = clampf((nyq - f0 * multA * bfx.rk[k - 1]) * aaf, 0.0f, 1.0f);
            float aaB = clampf((nyq - f0 * multB * bfx.rk[k - 1]) * aaf, 0.0f, 1.0f);
            float dm = bfx.driftMod(k, 1.0f / sr);
            float dp = bfx.stretchPhase(k, 1.0f / 512.0f);
            float akA = (T.bin(p1, k - 1) + bwA[k - 1]) * dm * aaA;
            float akB = (T.bin(p2, k - 1) + bwB[k - 1]) * dm * aaB;
            if (akA > 1e-6f) daccA += sinTurns((float) k * multA * dph + dp + (float) k * phA) * akA;
            if (akB > 1e-6f) daccB += sinTurns((float) k * multB * dph + dp + (float) k * phB) * akB;
            float ak = akA * gA + akB * gB;
            nrm += ak * ak;
        }
        prevA = clampf(daccA * 0.25f, -2.0f, 2.0f);
        prevB = clampf(daccB * 0.25f, -2.0f, 2.0f);
        dacc = daccA * gA + daccB * gB;
        float disp = dacc / (std::sqrt(nrm) + 0.5f);

        float duty = 0.08f + (1.0f - fo) * 0.9f;
        float pgc  = 1.0f / std::sqrt(duty + 0.05f);
        float wpd  = (dph < duty) ? std::sin((dph / duty) * kPi) : 0.0f;
        disp += (disp * wpd * pgc - disp) * pu;

        float fr2 = sFr.step(p.fractal);
        float cnt = 1.0f + std::floor(shp * 3.99f);
        float out2 = ripLayer(disp, dph, cnt, 1.0f + shp * 6.0f, 1.5f + rps * 35.0f, rps);
        if (fr2 > 1e-4f)
            out2 = ripLayer(out2, dph, cnt * 2.0f + 1.0f, 2.0f + shp * 8.0f, 2.0f + fr2 * 45.0f, fr2 * 0.9f);

        ring[wi] = out2;
        wi = (wi + 1) & 511;
    }
};

} // namespace cru
