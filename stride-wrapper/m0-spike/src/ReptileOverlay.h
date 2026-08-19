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
    static constexpr float kVisibleH = 152.0f;  // how tall the creature stands above the plugin

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
        const int yOff = juce::roundToInt (riseOffset() + bob);

        g.setOpacity (1.0f);
        g.drawImage (idle, 0, yOff, w, h, 0, 0, idle.getWidth(), idle.getHeight(), false);
        if (blinkAmt > 0.001f && blink.isValid())
        {
            g.setOpacity (juce::jlimit (0.0f, 1.0f, blinkAmt));
            g.drawImage (blink, 0, yOff, w, h, 0, 0, blink.getWidth(), blink.getHeight(), false);
        }
        if (blepAmt > 0.001f && blep.isValid())
        {
            g.setOpacity (juce::jlimit (0.0f, 1.0f, blepAmt));
            g.drawImage (blep, 0, yOff, w, h, 0, 0, blep.getWidth(), blep.getHeight(), false);
        }
    }

    /** Opt-in switch. Starts the reveal when turned on. */
    void setActive (bool shouldBeActive)
    {
        if (active == shouldBeActive) return;
        active = shouldBeActive;
        rise = active ? 1.0f : rise;             // start fully tucked behind the plugin
        if (! active) { setVisible (false); }
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

    float scale() const noexcept { return kVisibleH / (float) kArtEdge; }
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

        if (now > nextIdleMs && rise <= 0.0f)
        {
            const int r = rng.nextInt (100);
            if (r < 62) { blinking = true; blinkT = 0.0; }
            else if (r < 78) { bleping = true; blepT = 0.0; }
            nextIdleMs = now + 2600.0 + rng.nextInt (4200);
        }
        else if (std::abs (bob - lastBob) > 0.25) { lastBob = bob; repaint(); }
    }

    /** Park the window so the paws land on the editor's top edge, horizontally centred. */
    void follow()
    {
        const auto b = target.getScreenBounds();
        if (b.isEmpty()) return;
        const float s = scale();
        const int w = juce::roundToInt (kArtW * s);
        const int h = juce::roundToInt (kArtH * s);
        const int x = b.getCentreX() - w / 2;
        const int y = b.getY() - juce::roundToInt (kArtEdge * s);
        const auto want = juce::Rectangle<int> (x, y, w, h);
        if (want != getBounds()) setBounds (want);
    }

    juce::Component& target;
    juce::Image idle, blink, blep;
    bool  active = false, blinking = false, bleping = false;
    float rise = 1.0f, blinkAmt = 0.0f, blepAmt = 0.0f;
    double blinkT = 0.0, blepT = 0.0, lastMs = 0.0, nextIdleMs = 0.0, bob = 0.0, lastBob = 0.0;
    juce::Random rng;

    JUCE_DECLARE_NON_COPYABLE_WITH_LEAK_DETECTOR (ReptileOverlay)
};
