# Stride Wrapper — CTO Decision Memo

**Date:** 2026-06-29
**For:** Founder
**Reads with:** `stride-cross-daw-vst3-research.md` (why) · `stride-wrapper-vst3-spec.md` (how)
**One-line:** Build the M0 spike now; it's cheap, it reuses Tendril's stack, and it de-risks a genuinely uncontested product. Defer the full build until you've made the Tendril resourcing call below.

---

## The recommendation

**GO — but staged, and start small.** Do the **M0 spike** (host Serum + drive one parameter from a curve, in Ableton, Windows VST3) before committing to anything bigger. Rationale:

- The thesis is sound and the category gap is real: **nobody ships drawn-curve modulation of a hosted synth, cross-DAW.** That's a defensible, ownable position.
- M0 is **days-to-weeks**, not months, because you already have the JUCE/CMake toolchain and the embedded-web-UI pattern from Tendril. It costs little and proves or kills the hardest technical assumptions (hosting works in-DAW, your curve fidelity carries, the WebView focus bug is manageable).
- Everything expensive (cross-DAW QA, macOS notarization, signing) lives in the *back half* and shouldn't be funded until M0 says "yes."

**Do NOT** promise cross-DAW support, build the macro/bake feature, or touch Pro Tools until M0–M1 are green.

---

## Cost & effort (solo + Claude, realistic)

| Phase | What | Calendar (part-time) |
|---|---|---|
| M0 spike | Host Serum, modulate 1 param, show its editor, in Ableton | **~1–2 weeks** |
| M1 | Reuse `canvas.js` in WebView + bridge + param mapping | ~1–3 weeks |
| M2 | Productionize: out-of-proc scanner, state, macro bank, smoothing | ~3–5 weeks |
| M3 | AUv2/Logic, cross-DAW + cross-OS QA, signing + notarization, top-20-synth QA | **~1–3 months (the long tail)** |

**Honest framing:** the engine is the fun, fast part. **The calendar is dominated by M3** — signing/notarization/QA is serial, fiddly, and needs a Mac. A usable cross-DAW v1 is a **~3–5 month part-time effort**, with a credible **proof in 2 weeks**.

**Out-of-pocket (verify current pricing):**
- **JUCE commercial license** (free tier is AGPL — unusable for closed source). ~Indie tier; you likely already hold this for Tendril — **confirm it covers a second product.**
- Apple Developer Program (~$99/yr) + a Mac for AU/notarization.
- Windows code-signing cert (Azure Trusted Signing is now the cheap path).
- PACE/iLok only if/when Pro Tools — **defer.**

---

## The real decision: Tendril vs. Stride-Wrapper (same resource)

This is the call only you can make. **Both are JUCE/C++ plugins with embedded web UIs, both depend on your solo C++ bandwidth + Claude pairing.** You cannot build both well in parallel. Three paths:

1. **Sequence** — finish Tendril, then wrapper (or vice versa). Cleanest focus, slowest coverage.
2. **Converge (recommended to evaluate)** — treat them as **one modulation engine, two products.** The wrapper's curve-modulation layer and Tendril's modulation-viz are the *same DNA*; the wrapper could even ship Tendril as its flagship paired synth, and Tendril could ship Stride-style curve modulation natively. Building the wrapper *advances* Tendril and vice versa.
3. **Spike-then-decide (recommended now)** — do the cheap M0 spike (it reuses Tendril infra, so it's not wasted either way), *then* choose sequence vs. converge with real data in hand.

**My recommendation:** run M0 now (low cost, high information), and in parallel seriously scope the **convergence** option before treating these as two separate roadmaps. The synergy is large enough that "two products, one engine" may be the highest-leverage path.

---

## Packaging (early thoughts, not decisions)

- The wrapper is a **distinct product** from today's Ableton Stride (one-time Lemon Squeezy purchase). Likely a **separate SKU or higher tier**, with a cross-grade for existing customers.
- Keep **"inject curves straight into your clips, zero MIDI"** as the **Ableton + Reaper exclusive** — it's a real differentiator there and honest everywhere else (the wrapper is live modulation, not clip injection).
- Messaging to the cross-DAW users asking today: *"Coming: Stride as a plugin that hosts your instrument and shapes it with drawn curves — same workflow, every DAW."* (No "AI," no "same as Ableton.")

---

## Go/no-go checklist before M3 funding

- [ ] M0: hosting + modulation + hosted-editor confirmed working in Ableton (Win VST3).
- [ ] M1: `canvas.js` renders + drives the synth in the WebView; keyboard-focus bug worked around.
- [ ] Curve fidelity A/B'd against today's M4L inject — looks/sounds equivalent.
- [ ] Tendril resourcing decided (sequence vs. converge).
- [ ] JUCE license confirmed to cover the product.

**Immediate next step:** greenlight the M0 spike and I'll scaffold a minimal JUCE VST3 project (CMake, hosting one `AudioPluginInstance`, a hardcoded sine driving one mapped param, hosted-editor window) — matching Tendril's build setup so it compiles in your existing loop.
