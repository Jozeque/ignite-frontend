#pragma once
#include <juce_core/juce_core.h>
#include <array>
#include <cstdint>
#include <utility>

// ============================================================
// TENDRIL — FX routing model
// 5 modules, each in exactly one slot, each assigned to lane A or B.
// Slot order = processing order within a lane. Lane B empty = pure series.
// Encoded into one uint32 (5 slots x 4 bits: 3 bits module id + 1 lane bit)
// so the audio thread reads it lock-free.
// Routing is PLUGIN STATE (hand-set, hidden from Stride) per PRD §6.4.
// ============================================================
namespace tendril {

enum ModuleId : int { ModFilter = 0, ModDrive = 1, ModCrush = 2, ModDelay = 3, ModSpace = 4, ModReson = 5, kNumModules = 6 };

inline const char* moduleName(int id)
{
    switch (id) { case ModFilter: return "filter"; case ModDrive: return "drive";
                  case ModCrush:  return "crush";  case ModDelay: return "delay";
                  case ModSpace:  return "space";  case ModReson: return "reson";
                  default: return "?"; }
}

inline int moduleIdFromName(const juce::String& n)
{
    for (int i = 0; i < kNumModules; ++i)
        if (n.equalsIgnoreCase(moduleName(i))) return i;
    return -1;
}

struct RoutingSlot { int module; bool laneB; };
using Routing = std::array<RoutingSlot, kNumModules>;

inline Routing defaultRouting()
{
    return {{ {ModFilter,false}, {ModDrive,false}, {ModCrush,false},
              {ModReson,false},  {ModDelay,false}, {ModSpace,false} }};
}

inline uint32_t encodeRouting(const Routing& r)
{
    uint32_t w = 0;
    for (int i = 0; i < kNumModules; ++i)
        w |= (uint32_t(((r[(size_t) i].module & 7) | (r[(size_t) i].laneB ? 8 : 0))) << (i * 4));
    return w;
}

inline Routing decodeRouting(uint32_t w)
{
    Routing r {};
    for (int i = 0; i < kNumModules; ++i)
    {
        const uint32_t nib = (w >> (i * 4)) & 0xF;
        r[(size_t) i] = { int(nib & 7), (nib & 8) != 0 };
    }
    return r;
}

// validate: every module appears exactly once
inline bool routingValid(const Routing& r)
{
    bool seen[kNumModules] = {};
    for (const auto& s : r)
    {
        if (s.module < 0 || s.module >= kNumModules || seen[s.module]) return false;
        seen[s.module] = true;
    }
    return true;
}

// JSON {"a":["filter",...],"b":[...]} -> Routing (returns false on bad input)
inline bool routingFromVar(const juce::var& v, Routing& out)
{
    auto* a = v.getProperty("a", {}).getArray();
    auto* b = v.getProperty("b", {}).getArray();
    int slot = 0;
    Routing r {};
    auto take = [&](juce::Array<juce::var>* arr, bool laneB) -> bool
    {
        if (arr == nullptr) return true;
        for (const auto& item : *arr)
        {
            if (slot >= kNumModules) return false;
            const int id = moduleIdFromName(item.toString());
            if (id < 0) return false;
            r[(size_t) slot++] = { id, laneB };
        }
        return true;
    };
    if (!take(a, false) || !take(b, true)) return false;
    if (slot != kNumModules || !routingValid(r)) return false;
    out = r;
    return true;
}

// "Mingle" knob: a deterministic table of scrambled chain ORDERS (pure series
// reorders — no parallel splits, so it never doubles CPU). knob 0 -> default
// order; turning it indexes wilder permutations. Deterministic => recallable +
// automatable (Stride can sweep it). FXChain declicks each order change.
inline Routing routingForOrder(float order01)
{
    static std::array<Routing, 32> table;
    static bool init = false;
    if (!init)
    {
        uint32_t rng = 0x9E3779B9u;
        auto next = [&]() { rng ^= rng << 13; rng ^= rng >> 17; rng ^= rng << 5; return rng; };
        table[0] = defaultRouting();
        for (int p = 1; p < (int) table.size(); ++p)
        {
            int idx[kNumModules];
            for (int i = 0; i < kNumModules; ++i) idx[i] = i;
            for (int i = kNumModules - 1; i > 0; --i)
            {
                const int j = (int) (next() % (uint32_t)(i + 1));
                std::swap(idx[i], idx[j]);
            }
            Routing r {};
            for (int i = 0; i < kNumModules; ++i)
                r[(size_t) i] = { idx[i], false };          // series only
            table[(size_t) p] = r;
        }
        init = true;
    }
    const int n = (int) table.size();
    const int i = juce::jlimit(0, n - 1, (int) (order01 * (float) n));
    return table[(size_t) i];
}

inline juce::String routingToJson(const Routing& r)
{
    juce::StringArray a, b;
    for (const auto& s : r) (s.laneB ? b : a).add(moduleName(s.module));
    auto quote = [](const juce::StringArray& xs)
    {
        juce::StringArray q;
        for (const auto& x : xs) q.add("\"" + x + "\"");
        return "[" + q.joinIntoString(",") + "]";
    };
    return "{\"a\":" + quote(a) + ",\"b\":" + quote(b) + "}";
}

} // namespace tendril
