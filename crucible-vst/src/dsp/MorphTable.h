// Crucible — the spectral-morph position table.
// 8 positions x 16 harmonic bin amplitudes, built with the SAME math as
// crucible/build_crucible.py (bin1 = 1 in every position -> the fundamental is
// mathematically constant across the whole morph; the bass never thins).
#pragma once
#include <cmath>

namespace cru {

struct MorphTable
{
    static constexpr int NH = 16;   // harmonics
    static constexpr int KP = 8;    // morph positions
    float pos[KP][NH];

    MorphTable()
    {
        auto sinc = [](double x) { return std::fabs(x) < 1e-9 ? 1.0 : std::sin(3.14159265358979323846 * x) / (3.14159265358979323846 * x); };
        double p[KP][NH] = {};

        // 0 sine
        p[0][0] = 1.0;
        // 1 (user)
        p[1][0] = 1.0; p[1][1] = 0.5; p[1][2] = 1.0;
        // 2 (user)
        p[2][0] = 1.0; p[2][1] = 0.1; p[2][2] = 0.333; p[2][3] = 0.75;
        // 3 organ (exp decay 0.65^k)
        for (int k = 0; k < NH; ++k) p[3][k] = std::pow(0.65, (double) k);
        // 4 vowel (two formant humps)
        {
            const double v[10] = { 1, 0.3, 0.85, 0.6, 0.3, 0.45, 0.55, 0.3, 0.12, 0.08 };
            for (int k = 0; k < 10; ++k) p[4][k] = v[k];
        }
        // 5 square (odd 1/k) — bin1 already 1
        for (int k = 0; k < NH; ++k) p[5][k] = (k % 2 == 0) ? 1.0 / (k + 1) : 0.0;
        // 6 pulse (25% pulse, sinc envelope), normalised so bin1 = 1
        {
            double b1 = std::fabs(sinc(0.25));
            for (int k = 0; k < NH; ++k) p[6][k] = std::fabs(sinc((k + 1) * 0.25)) / b1;
        }
        // 7 saw (1/k)
        for (int k = 0; k < NH; ++k) p[7][k] = 1.0 / (k + 1);

        for (int j = 0; j < KP; ++j)
            for (int k = 0; k < NH; ++k)
                pos[j][k] = (float) p[j][k];
    }

    static const MorphTable& get() { static MorphTable m; return m; }

    // tent-basis interpolation == linear interp between adjacent positions
    // (identical to the gen~ u0..u7 weight sum, 8x cheaper)
    float bin(float posIdx, int k) const   // posIdx in [0, KP-1]
    {
        if (posIdx <= 0.0f)               return pos[0][k];
        if (posIdx >= (float) (KP - 1))   return pos[KP - 1][k];
        int   j  = (int) posIdx;
        float fr = posIdx - (float) j;
        return pos[j][k] + (pos[j + 1][k] - pos[j][k]) * fr;
    }
};

} // namespace cru
