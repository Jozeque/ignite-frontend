// Crucible — shared DSP helpers.
// Everything here is plain std C++ (no JUCE) so the modules stay unit-testable.
// Several coefficients are ABSOLUTE per-sample values (0.0022 smoothing, 0.01/0.0008
// envelope coeffs, 0.9995 DC pole...) — copied verbatim from the M4L gen~ code for
// sonic parity. They were written for ~44.1/48k and behave slightly faster at 96k,
// exactly as the gen~ device would.
#pragma once
#include <cmath>
#include <cstdint>
#include <algorithm>
#include <vector>

namespace cru {

constexpr float kPi    = 3.14159265358979323846f;
constexpr float kTwoPi = 6.28318530717958647692f;

inline float clampf(float v, float lo, float hi) { return v < lo ? lo : (v > hi ? hi : v); }
inline float lerpf(float a, float b, float t)    { return a + (b - a) * t; }
inline float fracf(float x)                      { return x - std::floor(x); }
inline bool  finitef(float v)                    { return std::isfinite(v); }

// gen~-style parameter smoother: History s; s += 0.0022*(target - s)
struct Smooth
{
    float y = 0.0f;
    void  snap(float v)        { y = v; }
    float step(float target)   { y += 0.0022f * (target - y); return y; }
};

// ---- sine lookup (linear interp, ~-80 dB error) for the additive oscillator ----
struct SineTable
{
    static constexpr int N = 4096;
    float t[N + 1];
    SineTable() { for (int i = 0; i <= N; ++i) t[i] = (float) std::sin((double) kTwoPi * i / N); }
    // phase in turns, caller guarantees [0,1)
    float turns(float ph) const
    {
        float f = ph * N;
        int   i = (int) f;
        float fr = f - (float) i;
        return t[i] + (t[i + 1] - t[i]) * fr;
    }
};
inline const SineTable& sineTable() { static SineTable s; return s; }
inline float sinTurns(float ph) { return sineTable().turns(ph - std::floor(ph)); }

// ---- filters ----
struct DCBlock            // y = x - x1 + 0.9995*y1  (same pole as the gen~ DRIVE)
{
    float x1 = 0, y1 = 0;
    float step(float x) { float y = x - x1 + 0.9995f * y1; x1 = x; y1 = y; return y; }
    void  reset() { x1 = y1 = 0; }
};

struct OnePoleLP          // gen~ style: k = 1 - exp(-2pi*hz/sr)
{
    float k = 0.1f, y = 0;
    void  setHz(float hz, float sr) { k = 1.0f - std::exp(-kTwoPi * hz / sr); }
    void  setK(float kk)            { k = kk; }
    float step(float x) { y += k * (x - y); return y; }
    void  reset() { y = 0; }
};

struct OnePoleHP
{
    OnePoleLP lp;
    void  setHz(float hz, float sr) { lp.setHz(hz, sr); }
    float step(float x) { return x - lp.step(x); }
    void  reset() { lp.reset(); }
};

struct EnvFollow          // asymmetric one-pole on |x|
{
    float a = 0.01f, r = 0.001f, e = 0;
    void  setTimes(float atkSec, float relSec, float sr)
    {
        a = 1.0f - std::exp(-1.0f / (atkSec * sr));
        r = 1.0f - std::exp(-1.0f / (relSec * sr));
    }
    void  setCoeffs(float atk, float rel) { a = atk; r = rel; }
    float step(float x)
    {
        float ax = std::fabs(x);
        e += (ax > e ? a : r) * (ax - e);
        return e;
    }
    void reset() { e = 0; }
};
inline float norm01(float e) { return e / (e + 0.25f); }   // soft-normalise a follower to 0..1

// ---- Lorenz attractor (the MOVE chaos source) — integrated at control rate ----
struct Lorenz
{
    float x = 0.9f, y = 0.0f, z = 0.0f;
    void step(float dt)
    {
        float dx = 10.0f * (y - x);
        float dy = x * (28.0f - z) - y;
        float dz = x * y - (8.0f / 3.0f) * z;
        x += dx * dt; y += dy * dt; z += dz * dt;
        if (!finitef(x) || !finitef(y) || !finitef(z)
            || std::fabs(x) > 100.0f || std::fabs(y) > 100.0f || std::fabs(z) > 100.0f)
        { x = 0.9f; y = 0.0f; z = 0.0f; }
    }
    float xn() const { return clampf(x / 20.0f, -1.0f, 1.0f); }
    float yn() const { return clampf(y / 27.0f, -1.0f, 1.0f); }
    float zn() const { return clampf((z - 25.0f) / 25.0f, -1.0f, 1.0f); }
};

// ---- fractional delay line (linear + cubic reads) ----
struct DelayLine
{
    std::vector<float> buf;
    int size = 0, wi = 0;
    void prepare(int samples)
    {
        size = 1; while (size < samples) size <<= 1;
        buf.assign((size_t) size, 0.0f);
        wi = 0;
    }
    void write(float v) { buf[(size_t) wi] = v; wi = (wi + 1) & (size - 1); }
    float readLin(float delaySamples) const
    {
        float rp = (float) wi - delaySamples;
        int   i0 = (int) std::floor(rp);
        float fr = rp - (float) i0;
        int   m  = size - 1;
        float a = buf[(size_t)(i0       & m)];
        float b = buf[(size_t)((i0 + 1) & m)];
        return a + (b - a) * fr;
    }
    float readCubic(float delaySamples) const
    {
        float rp = (float) wi - delaySamples;
        int   i1 = (int) std::floor(rp);
        float fr = rp - (float) i1;
        int   m  = size - 1;
        float y0 = buf[(size_t)((i1 - 1) & m)];
        float y1 = buf[(size_t)((i1)     & m)];
        float y2 = buf[(size_t)((i1 + 1) & m)];
        float y3 = buf[(size_t)((i1 + 2) & m)];
        float c0 = y1;
        float c1 = 0.5f * (y2 - y0);
        float c2 = y0 - 2.5f * y1 + 2.0f * y2 - 0.5f * y3;
        float c3 = 0.5f * (y3 - y0) + 1.5f * (y1 - y2);
        return ((c3 * fr + c2) * fr + c1) * fr + c0;
    }
    void reset() { std::fill(buf.begin(), buf.end(), 0.0f); }
};

} // namespace cru
