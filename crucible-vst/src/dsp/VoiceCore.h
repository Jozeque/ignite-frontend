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
    float attack = 0.02f, decay = 0.25f, sustain = 0.7f, release = 0.3f;
    float modalRes = 0, modalTune = 0, modalRing = 0.5f;
};

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
    float mph = 0.0f;       // audio phasor
    Smooth sM1, sM2, sRp, sRp2, sPu, sFo, sFr;
    BinFx bfx;

    void prepare(float s) { sr = s; isr = 1.0f / s; nyq = 0.5f * s; }
    void snapParams(const VoiceParams& p)
    {
        sM1.snap(p.morph); sM2.snap(p.morph2); sRp.snap(p.rips);
        sRp2.snap(p.ripshape); sPu.snap(p.pulsar); sFo.snap(p.formant);
        sFr.snap(p.fractal);
        bfx.snap(p);
    }

    float process(float f0target, const VoiceParams& p)
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

        mph += f0 * isr; mph -= std::floor(mph);

        const float aaf = 1.0f / 2200.0f;
        float acc = 0.0f;
        for (int k = 1; k <= MorphTable::NH; ++k)
        {
            float aa = clampf((nyq - f0 * bfx.rk[k - 1]) * aaf, 0.0f, 1.0f);
            if (aa <= 0.0f) break;                       // ratios rise with k: all above clamp too
            float ak = (T.bin(p1, k - 1) + T.bin(p2, k - 1)) * aa;
            ak *= bfx.driftMod(k, isr);
            float dp = bfx.stretchPhase(k, f0 * isr);
            if (ak > 1e-6f)
                acc += sinTurns((float) k * mph + dp) * ak;
        }
        float sig = acc * 0.25f;

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

// ---- ENV: linear ADSR (gen~ semantics: retrigger continues from current level,
//      decay clamps at sustain, release full-scale-normalised) ----
struct ADSREnv
{
    float sr = 48000;
    float env = 0.0f;
    int   stg = 0;          // 1=attack, 2=decay/sustain, 0=release
    bool  pg  = false;      // previous gate

    void prepare(float s) { sr = s; }
    void hardReset() { env = 0; stg = 0; pg = false; }
    bool idle() const { return stg == 0 && env <= 0.0f; }

    float process(bool gate, const VoiceParams& p)
    {
        float asec = 0.002f + p.attack  * 3.0f;
        float dsec = 0.002f + p.decay   * 3.0f;
        float rsec = 0.002f + p.release * 4.0f;
        bool rising = gate && !pg; pg = gate;
        stg = rising ? 1 : (!gate ? 0 : stg);
        float ainc = 1.0f / (asec * sr), dinc = 1.0f / (dsec * sr), rinc = 1.0f / (rsec * sr);
        env = (stg == 1) ? clampf(env + ainc, 0.0f, 1.0f)
            : (stg == 2) ? clampf(env - dinc, clampf(p.sustain, 0.0f, 1.0f), 1.0f)
                         : clampf(env - rinc, 0.0f, 1.0f);
        if (stg == 1 && env >= 1.0f) stg = 2;
        return env;
    }
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
    ADSREnv   env;
    ModalBank modal;
    float noteF0 = 55.0f;
    bool  gate   = false;

    void prepare(float s) { osc.prepare(s); env.prepare(s); modal.prepare(s); }
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
    void kill()    { gate = false; env.hardReset(); modal.reset(); }
    bool active() const { return gate || !env.idle() || modal.ringing(); }

    float render(const VoiceParams& p)
    {
        float e = env.process(gate, p);
        float s = osc.process(noteF0, p) * e;
        return modal.process(s, noteF0, p);
    }
};

// ---- the 1-cycle waveform display oscillator (gen~ display path: dph phasor with
//      a 512-sample period, same harmonic weights, own pulsar/rips processing) ----
struct DisplayOsc
{
    float sr = 48000, nyq = 24000;
    float dph = 0.0f;
    Smooth sM1, sM2, sRp, sRp2, sPu, sFo, sFr;
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
        const float aaf = 1.0f / 2200.0f;
        float dacc = 0.0f, nrm = 0.0001f;
        for (int k = 1; k <= MorphTable::NH; ++k)
        {
            float aa = clampf((nyq - f0 * bfx.rk[k - 1]) * aaf, 0.0f, 1.0f);
            float ak = (T.bin(p1, k - 1) + T.bin(p2, k - 1)) * aa;
            ak *= bfx.driftMod(k, 1.0f / sr);
            float dp = bfx.stretchPhase(k, 1.0f / 512.0f);
            if (ak > 1e-6f)
                dacc += sinTurns((float) k * dph + dp) * ak;
            nrm += ak * ak;
        }
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
