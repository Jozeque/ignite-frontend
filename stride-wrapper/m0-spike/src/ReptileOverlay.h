#pragma once
#include <juce_gui_extra/juce_gui_extra.h>
#include "BinaryData.h"

/*
  FLOATING REPTILE OVERLAY - opt-in, off by default.

  A borderless, transparent, always-on-top desktop window that sits just above the Stride
  editor so the creature can use the empty screen around the plugin instead of costing
  Stride a strip of its own height.

  WHY THIS FILE IS CAUTIOUS
  This codebase already has an open bug in exactly this class: the unowned always-on-top
  hosted-synth windows are the prime suspect in the Windows note-forwarding failure, where
  after certain focus transitions forwarded keys start landing on Live's single-key
  SHORTCUTS and stay there. A second always-on-top window is an invitation to the same
  failure, so this one is deliberately defensive:

    - it NEVER takes focus (no toFront with focus, no grabKeyboardFocus)
    - it is completely transparent to the mouse (windowIgnoresMouseClicks + no hit test)
    - it HIDES whenever our application is not the foreground app, so it can never float
      over other software or sit in the middle of a focus handover
    - it hides when the editor is not showing (plugin window closed / track hidden)
    - it owns no product state and reads nothing but the editor's screen bounds
    - it is opt-in per session and defaults OFF

  If the note-forward bug ever reappears, THIS is the first thing to switch off.
*/
class ReptileOverlay : public juce::Component,
                       private juce::Timer
{
public:
    // Art anchors, in the source image's own pixels. Swapping the art = changing these.
    static constexpr int   kArtW = 440, kArtH = 432;
    static constexpr int   kArtEdge = 383;      // wrist line: the paws grip here
    static constexpr float kVisibleH = 132.0f;     // shortest he ever stands above the plugin
    static constexpr float kMaxVisibleH = 232.0f;  // and the tallest, so a big window can't summon a monster
    static constexpr float kSpanOfWindow = 0.23f;  // his arm span, as a fraction of Stride's width
    static constexpr int   kGrip = 11;             // px of Stride's top edge his fingers curl over
    static constexpr int   kMouthX = 215, kMouthY = 239;   // where the tongue leaves the face, in art pixels

    explicit ReptileOverlay (juce::Component& editorToFollow)
        : target (editorToFollow)
    {
        idle  = loadPng ("rep_idle.png");
        blink = loadPng ("rep_blink.png");
        blep  = loadPng ("rep_blep.png");

        setOpaque (false);
        setInterceptsMouseClicks (false, false);
        setAlwaysOnTop (true);
        setWantsKeyboardFocus (false);

        addToDesktop (juce::ComponentPeer::windowIsTemporary
                    | juce::ComponentPeer::windowIgnoresMouseClicks);
        setVisible (false);                      // the timer decides, after the first follow()
        startTimerHz (30);
    }

    ~ReptileOverlay() override { stopTimer(); removeFromDesktop(); }

    // Never let anything hit-test into this window, belt and braces over the peer flag.
    bool hitTest (int, int) override { return false; }

    void paint (juce::Graphics& g) override
    {
        if (idle.isNull()) return;

        const float s = scale();
        const int w = juce::roundToInt (kArtW * s), h = juce::roundToInt (kArtH * s);
        const int ax = artOrigin.x, ay = artOrigin.y + juce::roundToInt (riseOffset() + bob);

        {
            // HOLDING THE WINDOW, not sitting on top of it. The creature is drawn so his
            // body continues DOWN past Stride's top edge, and then everything from kGrip
            // below that edge is clipped away - so the window occludes him exactly as if he
            // were behind it, while his fingers stay in front and curl over the frame.
            // Everywhere he is not drawn the window is transparent, so what shows through
            // is the DAW itself.
            juce::Graphics::ScopedSaveState body (g);
            if (! editorLocal.isEmpty())
                g.excludeClipRegion (editorLocal.withTrimmedTop (kGrip));

            g.setOpacity (1.0f);
            g.drawImage (idle, ax, ay, w, h, 0, 0, idle.getWidth(), idle.getHeight(), false);
            if (blinkAmt > 0.001f && blink.isValid())
            {
                g.setOpacity (juce::jlimit (0.0f, 1.0f, blinkAmt));
                g.drawImage (blink, ax, ay, w, h, 0, 0, blink.getWidth(), blink.getHeight(), false);
            }
            if (blepAmt > 0.001f && blep.isValid())
            {
                g.setOpacity (juce::jlimit (0.0f, 1.0f, blepAmt));
                g.drawImage (blep, ax, ay, w, h, 0, 0, blep.getWidth(), blep.getHeight(), false);
            }
        }

        // The tongue is drawn OUTSIDE that clip, on purpose: it is the one part of him that
        // reaches out IN FRONT of the window, which is what makes a lick at a knob read as
        // touching it rather than as happening behind the glass.
        if (tongueExt > 0.002f)
        {
            g.setOpacity (1.0f);
            drawTongue (g, { (float) ax + kMouthX * s, (float) ay + kMouthY * s }, s);
        }
    }

    /** A tapered RIBBON on a whipping S-curve with a forked tip - the same construction the
        in-window SVG creature uses, rather than a line with a blob on the end. The body
        narrows toward the tip, swells once just before it (the spade), then splits. */
    void drawTongue (juce::Graphics& g, juce::Point<float> mouth, float s) const
    {
        const auto tgt = tongueTargetLocal.toFloat();
        const float full = mouth.getDistanceFrom (tgt);
        if (full < 2.0f) return;

        const float ang = std::atan2 (tgt.y - mouth.y, tgt.x - mouth.x);
        const float len = full * tongueExt;
        const juce::Point<float> D (std::cos (ang), std::sin (ang));
        const juce::Point<float> U (-D.y, D.x);
        const juce::Point<float> E = mouth + D * len;

        // The body LAGS the tip: a strong S-bend while it is travelling, flattening as it
        // lands, with a little wobble left over so it never looks pinned in place.
        const float travel = 1.0f - tongueExt;
        const float wob = std::sin ((float) (animMs / 110.0)) * (0.30f + 0.70f * travel);
        const float sag = (24.0f + wob * 22.0f) * s * 2.2f * (0.30f + 0.70f * travel);
        const auto c1 = mouth + D * (len * 0.30f) + U * sag;
        const auto c2 = mouth + D * (len * 0.70f) - U * (sag * 0.55f);

        const int N = 26;
        const float base = juce::jmax (1.6f, 19.0f * s);
        juce::Point<float> top[N + 1], bot[N + 1];
        juce::Point<float> endD = D, endU = U;
        for (int i = 0; i <= N; ++i)
        {
            const float t = (float) i / (float) N, mt = 1.0f - t;
            const auto p = mouth * (mt * mt * mt) + c1 * (3.0f * mt * mt * t)
                         + c2 * (3.0f * mt * t * t) + E * (t * t * t);
            auto d = (c1 - mouth) * (3.0f * mt * mt) + (c2 - c1) * (6.0f * mt * t)
                   + (E - c2) * (3.0f * t * t);
            const float l = juce::jmax (1.0e-4f, d.getDistanceFromOrigin());
            const juce::Point<float> u (-d.y / l, d.x / l);
            float w = base * (1.0f - 0.72f * t);
            if (t > 0.78f)
                w += base * 0.34f * std::sin ((t - 0.78f) / 0.22f * juce::MathConstants<float>::pi);
            top[i] = p + u * w;
            bot[i] = p - u * w;
            if (i == N) { endD = { d.x / l, d.y / l }; endU = u; }
        }

        // The fork is built on the spine's OWN end tangent, not on the straight
        // mouth-to-target line: on a whipping curve those disagree, and building it on the
        // straight line twists the tip into a one-sided hook instead of a fork.
        const float fl = base * 1.05f, spread = base * 0.62f;
        const auto tipL  = E + endD * fl + endU * spread;
        const auto tipR  = E + endD * fl - endU * spread;
        const auto notch = E + endD * (fl * 0.12f);

        juce::Path path;
        path.startNewSubPath (top[0]);
        for (int i = 1; i <= N; ++i) path.lineTo (top[i]);
        path.lineTo (tipL);
        path.lineTo (notch);            // the split between the two prongs
        path.lineTo (tipR);
        for (int i = N; i >= 0; --i) path.lineTo (bot[i]);
        path.closeSubPath();

        g.setColour (juce::Colour (0xffc8425f));
        g.fillPath (path);

        // a wet highlight down the middle, fading out before the fork
        juce::Path spine;
        spine.startNewSubPath (mouth);
        spine.cubicTo (c1, c2, mouth + D * (len * 0.88f));
        g.setColour (juce::Colours::white.withAlpha (0.15f));
        g.strokePath (spine, juce::PathStrokeType (juce::jmax (1.0f, base * 0.26f),
                                                   juce::PathStrokeType::curved,
                                                   juce::PathStrokeType::rounded));
    }

    /** Flick the tongue at a point on screen (a knob, a card, a lane). */
    void strikeAt (juce::Point<int> screenPoint)
    {
        if (! active) return;
        tongueTargetScreen = screenPoint;
        tonguePhase = 1;             // 1 = out, 2 = hold, 3 = back
        tongueT = 0.0;
        // NOT the blep frame: that artwork already has a tongue painted into it, so raising
        // it here gave him TWO tongues at once (field report 2026-08-19). Until there is an
        // open-mouth frame WITHOUT a tongue, the drawn one is the only one.
        follow();                    // the window must cover the target before we paint there
        repaint();
    }

    /** 0.55 .. 1.5 multiplier on his stature, so he can be sized to taste. */
    void setScaleMul (float m)
    {
        const float v = juce::jlimit (0.55f, 1.5f, m);
        if (std::abs (v - scaleMul) < 1.0e-3f) return;
        scaleMul = v;
        follow();
        repaint();
    }

    /** Opt-in switch. Starts the reveal when turned on. */
    void setActive (bool shouldBeActive)
    {
        if (active == shouldBeActive) return;
        active = shouldBeActive;
        rise = active ? 1.0f : rise;             // start fully tucked behind the plugin
        if (! active) { tonguePhase = 0; tongueExt = 0.0f; setVisible (false); }
    }
    bool isActive() const noexcept { return active; }

private:
    static juce::Image loadPng (const char* originalName)
    {
        for (int i = 0; i < BinaryData::namedResourceListSize; ++i)
            if (juce::String (BinaryData::originalFilenames[i]).equalsIgnoreCase (originalName))
            {
                int sz = 0;
                if (const char* d = BinaryData::getNamedResource (BinaryData::namedResourceList[i], sz))
                    return juce::ImageFileFormat::loadFrom (d, (size_t) sz);
            }
        return {};
    }

    /** He grows with the window he is holding, between a readable floor and a sane ceiling.
        The art is a creature seen head-on, so scaling him to a wide window's FULL width
        would put his head three times the window's height into the sky - hence the cap. */
    float scale() const noexcept
    {
        const float w = (float) juce::jmax (320, target.getWidth());
        return scaleMul * juce::jlimit (kVisibleH / (float) kArtEdge,
                                        kMaxVisibleH / (float) kArtEdge,
                                        w * kSpanOfWindow / (float) kArtW);
    }
    float riseOffset() const noexcept { return rise * (kArtEdge * scale()); }

    void timerCallback() override
    {
        // ── the safety gate, checked every tick ───────────────────────────────
        // Not our app in front, or no visible editor: get off the screen entirely.
        const bool allowed = active
                          && target.isShowing()
                          && juce::Process::isForegroundProcess();
        if (! allowed)
        {
            if (isVisible()) setVisible (false);
            return;
        }

        follow();
        if (! isVisible()) setVisible (true);

        // ── motion: a slow reveal, then breathing with the occasional blink ──
        const double now = juce::Time::getMillisecondCounterHiRes();
        const double dt  = juce::jlimit (0.0, 100.0, now - lastMs); lastMs = now;
        animMs = now;

        if (rise > 0.0f)
        {
            rise = juce::jmax (0.0f, rise - (float) (dt / 900.0));   // ~0.9s climb
            repaint();
        }

        bob = std::sin (now / 1500.0) * 1.6;

        if (blinkAmt > 0.0f || blinking)
        {
            blinkT += dt;
            const double D = 210.0;
            blinkAmt = (float) (blinkT < D * 0.4 ? blinkT / (D * 0.4)
                                                 : 1.0 - (blinkT - D * 0.4) / (D * 0.6));
            blinkAmt = juce::jlimit (0.0f, 1.0f, blinkAmt);
            if (blinkT > D) { blinking = false; blinkAmt = 0.0f; }
            repaint();
        }
        if (blepAmt > 0.0f || bleping)
        {
            blepT += dt;
            const double D = 900.0;
            blepAmt = (float) (blepT < 160.0 ? blepT / 160.0
                             : (blepT > 700.0 ? (D - blepT) / 200.0 : 1.0));
            blepAmt = juce::jlimit (0.0f, 1.0f, blepAmt);
            if (blepT > D) { bleping = false; blepAmt = 0.0f; }
            repaint();
        }

        if (tonguePhase != 0)
        {
            tongueT += dt;
            const double OUT = 165.0, HOLD = 360.0, BACK = 240.0;
            if (tonguePhase == 1)
            {
                tongueExt = (float) juce::jlimit (0.0, 1.0, tongueT / OUT);
                if (tongueT >= OUT) { tonguePhase = 2; tongueT = 0.0; }
            }
            else if (tonguePhase == 2)
            {
                tongueExt = 1.0f;
                if (tongueT >= HOLD) { tonguePhase = 3; tongueT = 0.0; }
            }
            else
            {
                tongueExt = (float) juce::jlimit (0.0, 1.0, 1.0 - tongueT / BACK);
                if (tongueT >= BACK) { tonguePhase = 0; tongueExt = 0.0f; follow(); }   // shrink back to the art
            }
            repaint();
        }

        if (now > nextIdleMs && rise <= 0.0f)
        {
            const int r = rng.nextInt (100);
            if (r < 62) { blinking = true; blinkT = 0.0; }
            // the idle blep pose carries its own painted tongue, so it waits its turn
            else if (r < 78 && tonguePhase == 0) { bleping = true; blepT = 0.0; }
            nextIdleMs = now + 2600.0 + rng.nextInt (4200);
        }
        else if (std::abs (bob - lastBob) > 0.25) { lastBob = bob; repaint(); }
    }

    /** Park the window so the paws grip the editor's top edge, horizontally centred. */
    void follow()
    {
        const auto b = target.getScreenBounds();
        if (b.isEmpty()) return;
        const float s = scale();
        const int w = juce::roundToInt (kArtW * s);
        const int h = juce::roundToInt (kArtH * s);
        const int x = b.getCentreX() - w / 2;
        // wrist line kGrip px INSIDE the window, so the paws overlap the frame
        const int y = b.getY() + kGrip - juce::roundToInt (kArtEdge * s);
        const auto artRect = juce::Rectangle<int> (x, y, w, h);

        // Normally the window is just big enough for the creature. While the tongue is out
        // it has to REACH the target, so the window grows to include it - transparent and
        // click-through, so covering part of the plugin costs nothing.
        auto want = artRect;
        if (tonguePhase != 0)
            want = want.getUnion (juce::Rectangle<int> (tongueTargetScreen.x - 12,
                                                        tongueTargetScreen.y - 12, 24, 24));
        if (want != getBounds()) setBounds (want);

        artOrigin = { artRect.getX() - want.getX(), artRect.getY() - want.getY() };
        tongueTargetLocal = tongueTargetScreen - want.getPosition();

        // Stride's rectangle in OUR coordinates - what paint() clips out. Recomputed every
        // tick because the plugin window moves, and a stale rect would paint over the UI.
        const auto local = b.translated (-want.getX(), -want.getY());
        if (local != editorLocal) { editorLocal = local; repaint(); }
    }

    juce::Component& target;
    juce::Rectangle<int> editorLocal;    // Stride's rect in overlay coords (the clip-out)
    juce::Point<int> artOrigin;          // where the art sits inside the window
    juce::Point<int> tongueTargetScreen, tongueTargetLocal;
    int   tonguePhase = 0;               // 0 idle, 1 out, 2 hold, 3 back
    double tongueT = 0.0;
    float tongueExt = 0.0f, scaleMul = 1.0f;
    double animMs = 0.0;                 // clock the tongue's wobble reads in paint()
    juce::Image idle, blink, blep;
    bool  active = false, blinking = false, bleping = false;
    float rise = 1.0f, blinkAmt = 0.0f, blepAmt = 0.0f;
    double blinkT = 0.0, blepT = 0.0, lastMs = 0.0, nextIdleMs = 0.0, bob = 0.0, lastBob = 0.0;
    juce::Random rng;

    JUCE_DECLARE_NON_COPYABLE_WITH_LEAK_DETECTOR (ReptileOverlay)
};
