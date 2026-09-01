// macOS keyboard interop — the Mac counterpart of the Windows paths in PluginEditor.cpp
// (the WH_GETMESSAGE hook + the JS "transportKey" forward).
//
// THE ROOT PROBLEM: a plugin that owns windows inside the DAW's process breaks the DAW's
// own idea of "which of my windows is active", and both Live's transport keys and its
// computer-MIDI keyboard are gated on exactly that. Three separate mechanisms below.
//
//   1. TRANSPORT (Space / Return)
//      A hosted synth lives in OUR NSWindow, so Space goes to it, not the DAW. A local
//      NSEvent monitor catches it on tagged windows and re-dispatches to a DAW window
//      that is NOT ours. "Ours" = tagged hosted-synth windows + every instance's plugin
//      frame. Two details matter:
//        - [NSApp mainWindow] alone is WRONG when a hosted synth window is focused, so we
//          skip our own windows and fall back to the frontmost regular window.
//        - Sandboxed hosts (Bitwig's per-plugin process) have NO DAW window here at all —
//          only the plugin frame. Last resort: hand the key to the frame window OBJECT,
//          which skips the first responder (our WebView would just swallow it again).
//      A 150ms debounce means any misdelivery bounce terminates after a single cycle.
//
//   2. MAIN-WINDOW HYGIENE  (the "typing keyboard dead + Live shortcuts fire" bug)
//      JUCE returns YES from canBecomeMainWindow for any ResizableWindow, so clicking a
//      hosted synth made it [NSApp mainWindow]; Live's keyboard gate failed and STAYED
//      failed (a plugin panel can't take main back) until the user clicked Live itself.
//      Fixed with public API only: a become-main observer hands main straight back to
//      the DAW. (1.1.8 ISA-swizzled canBecomeMainWindow instead — object_setClass on a
//      live NSWindow, which AppKit may already have KVO-subclassed. It crashed Live.
//      Never again.)
//
//   3. NOTE KEYS — CONSUME AND INJECT, NEVER RELAY  (the latency / random-length bug)
//      Two facts, both learned the hard way, make relaying keystrokes unwinnable here:
//        - AppKit routes keyboard events to the KEY window no matter what windowNumber
//          an event carries. While Stride is focused, OUR frame is key — so the 1.1.9
//          synthetic re-post boomeranged straight back into our own WKWebView, took the
//          same WebProcess round trip as an organic key (keyDown and keyUp delayed
//          INDEPENDENTLY — hence random note lengths), and surfaced late. The monitor
//          "worked"; the delivery could not.
//        - Live's typing piano only claims keys when the KEY window is one of Live's
//          own. With a hosted synth window key, the letters dispatch into that window's
//          responder chain instead — caterpillar's "F made Pro-Q fullscreen".
//      So notes are no longer relayed AT ALL. The monitor consumes them before the
//      WebView (or the hosted synth) can see them, and hands them to the editor's sink,
//      which enqueues REAL MIDI into the wrapper's own processBlock: next-block latency,
//      exact lengths, chords, zero dependence on Live's window gating. The one deliberate
//      exception: while Live is RECORDING we stand down completely, so the keys travel
//      Live's own piano (organic path, WebView latency and all) and land in the clip.
#import <Cocoa/Cocoa.h>
#include "MacKeyForward.h"
#include <array>
#include <vector>

static id     g_strideKeyMonitor  = nil;
static id     g_strideResignObs   = nil;       // app-deactivate observer — releases notes held when focus leaves the app entirely
static id     g_strideMainObs     = nil;       // become-main observer — hands main back to the DAW (see main-window hygiene above)
static int    g_strideMonitorRefs = 0;         // one monitor shared by every open editor — dies with the LAST one (multi-instance)
static std::vector<void*> g_strideEditorViews; // every live Stride editor's NSView* — so ALL instances' frame windows count as "ours"
static void*  g_strideLastEditorView = nullptr;// most recently refreshed view — the frame-fallback delivery target
static double g_strideLastPost   = 0.0;
static bool   g_strideSuppressed = false;      // Logic/GarageBand (out-of-process AU): never post synthetic transport keys
static bool   g_strideNoteForward = true;      // master enable for note handling (injection is self-contained -> on in every host)
static bool   g_strideRecording   = false;     // Live rolling in record: stand down, its own piano must take (and record) the keys
static bool   g_strideTextFocus   = false;     // the page has a text field focused: hands off the note keys (the user is typing)

// The editor's note sink: consumed note keys become MIDI in the processor's typed-note
// queue. Last registered editor wins — with several Strides open, typed notes go to the
// most recently opened one (its editor refreshes last).
static void* g_strideNoteSinkCtx = nullptr;
static void (*g_strideNoteSink) (void*, int, int, bool) = nullptr;

// QWERTY piano state, mirroring Live's semantics: A-row plays, Z/X shift the octave,
// C/V step the velocity. Per-letter HELD NOTE (not just a flag): an octave shift while a
// key is down must release the pitch that actually started, or it rings forever.
static int g_strideOctaveBase = 60;    // Live's default: A = C3 — and in LIVE'S labeling C3 IS middle C
                                       // (MIDI 60). 48 was C3 in the Yamaha convention and played one
                                       // octave below Live's own piano (field report 2026-07-27). The
                                       // octave itself stays independent of Live's — Live doesn't expose
                                       // it, and key-relay is unwinnable (see the header comment) — but
                                       // matching defaults means both start in unison; Z/X shift ours.
static int g_strideTypedVel   = 100;
static std::array<int, 26> g_strideHeldNote = [] { std::array<int, 26> a {}; a.fill (-1); return a; }();

void strideMacKeyForward_setSuppressed (bool s) { g_strideSuppressed = s; }
void strideMacKeyForward_setRecording (bool r)  { g_strideRecording  = r; }
void strideMacKeyForward_setTextFocus (bool on) { g_strideTextFocus  = on; }

void strideMacKeyForward_setNoteSink (void* ctx, void (*sink) (void*, int, int, bool))
{
    g_strideNoteSinkCtx = ctx;
    g_strideNoteSink    = sink;
}

// Live's computer-MIDI keyboard key set as kVK_ANSI_* keycodes — hardcoded like
// Space/Return below (no Carbon import). Live maps notes by the PHYSICAL key, which is
// exactly what these keycodes are, so this stays correct on non-Latin layouts too.
// (';' — the top E of Live's two-octave layout — is deliberately left out: the only
// non-letter in the set, and it would need special-casing everywhere for one note.)
static char strideNoteCharForKeyCode (unsigned short kc)
{
    switch (kc)
    {
        case 0:  return 'a';  case 1:  return 's';  case 2:  return 'd';  case 3:  return 'f';
        case 4:  return 'h';  case 5:  return 'g';  case 6:  return 'z';  case 7:  return 'x';
        case 8:  return 'c';  case 9:  return 'v';  case 13: return 'w';  case 14: return 'e';
        case 16: return 'y';  case 17: return 't';  case 31: return 'o';  case 32: return 'u';
        case 35: return 'p';  case 37: return 'l';  case 38: return 'j';  case 40: return 'k';
        default: return 0;
    }
}

// Live's piano layout: A=C W=C# S=D E=D# D=E F=F T=F# G=G Y=G# H=A U=A# J=B, then
// K/O/L/P continue into the next octave. -1 = a control key (z/x octave, c/v velocity).
static int strideSemitoneForChar (char c)
{
    switch (c)
    {
        case 'a': return 0;  case 'w': return 1;  case 's': return 2;  case 'e': return 3;
        case 'd': return 4;  case 'f': return 5;  case 't': return 6;  case 'g': return 7;
        case 'y': return 8;  case 'h': return 9;  case 'u': return 10; case 'j': return 11;
        case 'k': return 12; case 'o': return 13; case 'l': return 14; case 'p': return 15;
        default:  return -1;
    }
}

// Release every note we still owe an UP for — focus loss, editor teardown, note-handling
// getting disabled: nothing may be left ringing.
static void strideReleaseHeldNotes (void)
{
    for (int i = 0; i < 26; ++i)
        if (g_strideHeldNote[(size_t) i] >= 0)
        {
            if (g_strideNoteSink != nullptr)
                g_strideNoteSink (g_strideNoteSinkCtx, g_strideHeldNote[(size_t) i], 0, false);
            g_strideHeldNote[(size_t) i] = -1;
        }
}

void strideMacKeyForward_setNoteForwardEnabled (bool on)
{
    if (! on) strideReleaseHeldNotes();
    g_strideNoteForward = on;
}

void strideMacKeyForward_registerEditorView (void* nsview)
{
    if (nsview == nullptr) return;
    g_strideLastEditorView = nsview;           // refreshed at 30Hz by each editor's timer — last-focused wins the fallback
    for (void* v : g_strideEditorViews) if (v == nsview) return;   // idempotent
    g_strideEditorViews.push_back (nsview);
}

// The DAW-owned window that embeds the most recently active Stride editor (nil when none).
static NSWindow* strideEditorFrameWindow (void)
{
    if (g_strideLastEditorView == nullptr) return nil;
    NSView* v = (__bridge NSView*) g_strideLastEditorView;
    return [v window];
}

// Tagged hosted-synth window, or ANY instance's plugin frame — a re-post must never land in
// another Stride's frame (its WebView would just swallow the key).
static bool strideIsOurWindow (NSWindow* w)
{
    if (w == nil) return true;
    if ([[w identifier] isEqualToString: @"StrideHostedSynth"]) return true;
    for (void* view : g_strideEditorViews)
        if (view != nullptr && [(__bridge NSView*) view window] == w) return true;
    return false;
}

// A DAW-owned plugin frame that embeds one of OUR editors — i.e. the window whose key
// events would otherwise disappear into our WebView.
static bool strideIsEditorFrameWindow (NSWindow* w)
{
    if (w == nil) return false;
    for (void* view : g_strideEditorViews)
        if (view != nullptr && [(__bridge NSView*) view window] == w) return true;
    return false;
}

// The DAW window to deliver into: the main window when it is really the DAW's, else the
// frontmost regular window that isn't ours. nil in a per-plugin-process host.
static NSWindow* strideFindHostWindow (NSWindow* avoid)
{
    NSWindow* target = [NSApp mainWindow];
    if (target != nil && target != avoid && ! strideIsOurWindow (target) && [target isVisible])
        return target;

    for (NSWindow* w in [NSApp orderedWindows])
        if (w != nil && w != avoid && ! strideIsOurWindow (w) && [w isVisible] && [w canBecomeMainWindow])
            return w;

    return nil;
}

// Typing INSIDE a hosted synth's own text field (preset search): the field editor a
// native text control installs is an NSTextView, so this catches AU/native UIs. (A JUCE
// synth funnels all keys through one NSView, so its search boxes are invisible to this
// check — those keys will play notes, same trade Live's own piano makes. Toggle-able
// later if it bites.)
static bool strideHostedFirstResponderIsText (NSWindow* w)
{
    NSResponder* r = [w firstResponder];
    return r != nil && [r isKindOfClass: [NSText class]];
}

// ── main-window hygiene ─────────────────────────────────────────────────────
// Watch for one of our tagged windows becoming main and immediately hand main back to
// the DAW. Our window is still main for an instant — harmless, nobody can type in that
// gap — but it can never STAY main, which is the entire bug. Loop-safe by construction:
// the DAW window that takes main isn't tagged, so its own notification is ignored.
static void strideInstallMainWindowGuard (void)
{
    if (g_strideMainObs != nil) return;
    g_strideMainObs = [[[NSNotificationCenter defaultCenter]
        addObserverForName: NSWindowDidBecomeMainNotification
                    object: nil
                     queue: [NSOperationQueue mainQueue]
                usingBlock: ^(NSNotification* n)
        {
            // Logic/GarageBand host AUs out-of-process, where our window may be the only
            // main-capable one in the service process — leave main alone there.
            if (g_strideSuppressed) return;

            NSWindow* w = (NSWindow*) [n object];
            if (w == nil || ! [[w identifier] isEqualToString: @"StrideHostedSynth"]) return;

            if (NSWindow* daw = strideFindHostWindow (w))
                [daw makeMainWindow];
        }] retain];   // non-ARC target: removeObserver: on a dead token would crash
}

void strideMacKeyForward_tagWindow (void* nsview)
{
    if (nsview == nullptr) return;
    NSView* v = (__bridge NSView*) nsview;
    NSWindow* w = [v window];
    if (w == nil) return;

    // The tag does three jobs: transport keys forward from a window carrying it, the
    // guard above hands main back whenever one takes main, and note keys on it are
    // consumed + injected.
    // NOTE (2026-07-28): this hook is deliberately 1:1 with the 1.1.10 behavior the mac
    // testers validated. A collectionBehavior/toggleFullScreen "fix" briefly lived here
    // (1.2.3) and made things WORSE (oversized windows with the title bar off-screen =
    // undraggable). Do not add window-management side effects to the tag.
    if (! [[w identifier] isEqualToString: @"StrideHostedSynth"])
        w.identifier = @"StrideHostedSynth";

    // Shown before we get here, so it may ALREADY hold main — the notification for that
    // has been and gone. One catch-up, on the tagging call only (never on a timer).
    if (! g_strideSuppressed && [w isMainWindow])
        if (NSWindow* daw = strideFindHostWindow (w))
            [daw makeMainWindow];
}

void strideMacKeyForward_unregisterEditorView (void* nsview)
{
    if (nsview == nullptr) return;
    for (size_t i = 0; i < g_strideEditorViews.size(); ++i)
        if (g_strideEditorViews[i] == nsview) { g_strideEditorViews.erase (g_strideEditorViews.begin() + (long) i); break; }
    if (g_strideLastEditorView == nsview)
        g_strideLastEditorView = g_strideEditorViews.empty() ? nullptr : g_strideEditorViews.back();
    if (g_strideEditorViews.empty())
        strideReleaseHeldNotes();   // last editor gone mid-hold: don't leave a note ringing
}

static NSEvent* strideMakeKeyEvent (NSEventType type, bool isReturn, NSInteger windowNumber)
{
    NSString* chars = isReturn ? @"\r" : @" ";
    return [NSEvent keyEventWithType: type
                            location: NSZeroPoint
                       modifierFlags: 0
                           timestamp: [[NSProcessInfo processInfo] systemUptime]
                        windowNumber: windowNumber
                             context: nil
                          characters: chars
         charactersIgnoringModifiers: chars
                           isARepeat: NO
                             keyCode: (unsigned short) (isReturn ? 36 : 49)];   // 36 = Return, 49 = Space
}

// Deliver Space/Return to the DAW. Returns true when something plausibly received it.
// sendEvent delivery — FIELD-PROVEN for the transport (Live's play/stop handling accepts
// it); the note path's failure was never about this pair of keys.
static bool stridePostTransport (bool isReturn, NSWindow* avoid)
{
    if (g_strideSuppressed) return false;   // Logic/GarageBand: no DAW window in this process — don't synthesize keys

    const double now = [[NSProcessInfo processInfo] systemUptime];
    if (now - g_strideLastPost < 0.15) return false;   // debounce: one toggle per press, kills any bounce

    if (NSWindow* target = strideFindHostWindow (avoid))
    {
        g_strideLastPost = now;
        [target sendEvent: strideMakeKeyEvent (NSEventTypeKeyDown, isReturn, [target windowNumber])];
        [target sendEvent: strideMakeKeyEvent (NSEventTypeKeyUp,   isReturn, [target windowNumber])];
        return true;
    }

    // Sandboxed host (per-plugin process): the only windows here are plugin frames.
    // Hand the key to the frame window OBJECT — skips the first responder (our WebView)
    // so it can't loop; a frame that forwards keys to the DAW picks it up.
    NSWindow* frame = strideEditorFrameWindow();
    if (frame != nil && frame != avoid)
    {
        g_strideLastPost = now;
        [frame keyDown: strideMakeKeyEvent (NSEventTypeKeyDown, isReturn, [frame windowNumber])];
        [frame keyUp:   strideMakeKeyEvent (NSEventTypeKeyUp,   isReturn, [frame windowNumber])];
        return true;
    }
    return false;
}

// Stride's WebView (JS-forwarded Space/Return, keyboard focus inside the web page).
void strideMacKeyForward_post (bool isReturn)
{
    stridePostTransport (isReturn, nil);
}

// Cmd-key forwarding to the DAW: Cmd+S (project save) and Cmd+Z / Cmd+Shift+Z (undo and
// redo, when the undo belongs to the host and not to Stride). Same discovery + debounce +
// Logic/GB suppression as the transport keys, but a Cmd combo carries its modifier in the
// event and dispatches through the window's key-equivalent chain, which is exactly what
// [target sendEvent:] feeds. kVK_ANSI_S = 1, kVK_ANSI_Z = 6.
// Post one synthesized Cmd-key to the host window. Shared by save and undo so the window
// discovery, the suppression check and the two delivery paths stay in ONE place.
static void stridePostCmdKey (NSString* ch, unsigned short keyCode, NSEventModifierFlags flags,
                              double guardSecs, double* lastPost)
{
    if (g_strideSuppressed) return;
    const double now = [[NSProcessInfo processInfo] systemUptime];
    if (now - *lastPost < guardSecs) return;

    NSWindow* target = strideFindHostWindow (nil);
    const bool viaFrame = (target == nil);
    if (viaFrame) target = strideEditorFrameWindow();   // per-plugin-process host: the frame forwards or drops it
    if (target == nil) return;

    *lastPost = now;
    NSEvent* down = [NSEvent keyEventWithType: NSEventTypeKeyDown
                                     location: NSZeroPoint
                                modifierFlags: flags
                                    timestamp: [[NSProcessInfo processInfo] systemUptime]
                                 windowNumber: [target windowNumber]
                                      context: nil
                                   characters: ch
                  charactersIgnoringModifiers: ch
                                    isARepeat: NO
                                      keyCode: keyCode];
    NSEvent* up = [NSEvent keyEventWithType: NSEventTypeKeyUp
                                   location: NSZeroPoint
                              modifierFlags: flags
                                  timestamp: [[NSProcessInfo processInfo] systemUptime]
                               windowNumber: [target windowNumber]
                                    context: nil
                                 characters: ch
                charactersIgnoringModifiers: ch
                                  isARepeat: NO
                                    keyCode: keyCode];
    if (viaFrame) { [target keyDown: down]; [target keyUp: up]; }
    else          { [target sendEvent: down]; [target sendEvent: up]; }
}

// Cmd+Z / Cmd+Shift+Z, for when the undo belongs to the DAW rather than to Stride (see
// canvas.js). Its own timestamp and a shorter guard: undo is a key people hammer, and
// sharing the transport lock would read as dropped presses.
static double g_strideLastUndoPost = 0.0;
void strideMacKeyForward_postUndo (bool redo)
{
    stridePostCmdKey (@"z", (unsigned short) 6,
                      redo ? (NSEventModifierFlagCommand | NSEventModifierFlagShift)
                           : NSEventModifierFlagCommand,
                      0.06, &g_strideLastUndoPost);
}

void strideMacKeyForward_postSave (void)
{
    stridePostCmdKey (@"s", (unsigned short) 1, NSEventModifierFlagCommand, 0.15, &g_strideLastPost);
}

void strideMacKeyForward_install (void)
{
    ++g_strideMonitorRefs;
    if (g_strideKeyMonitor != nil) return;

    strideInstallMainWindowGuard();   // hosted synth windows must never KEEP main-window status

    // Cmd-Tab away mid-hold and the key-UP is delivered to the OTHER app — our local
    // monitor never sees it and the note rings forever. Releasing on deactivate closes
    // the only hole the owed-UP rule below can't.
    // Retained explicitly: this target is built WITHOUT ARC (JUCE's own .mm files use
    // retain/release), so the autoreleased token would otherwise be ours only until the
    // pool drains — and removeObserver: on a dead token is a crash.
    g_strideResignObs = [[[NSNotificationCenter defaultCenter]
        addObserverForName: NSApplicationDidResignActiveNotification
                    object: nil
                     queue: [NSOperationQueue mainQueue]
                usingBlock: ^(NSNotification*) { strideReleaseHeldNotes(); }] retain];

    g_strideKeyMonitor = [NSEvent addLocalMonitorForEventsMatchingMask: (NSEventMaskKeyDown | NSEventMaskKeyUp)
        handler: ^NSEvent* (NSEvent* e)
        {
            // A local monitor runs BEFORE the event is dispatched — returning nil drops it
            // outright, which is how a note key is taken away from the WebView (and from a
            // hosted synth's shortcut handling) instead of merely being observed.
            const bool down = ([e type] == NSEventTypeKeyDown);
            const unsigned short kc = [e keyCode];   // 49 = Space, 36 = Return
            NSWindow* w = [e window];

            const bool hosted = (w != nil && [[w identifier] isEqualToString: @"StrideHostedSynth"]);
            const bool frame  = (! hosted && strideIsEditorFrameWindow (w));

            // ── notes ──
            const char nc = strideNoteCharForKeyCode (kc);
            if (nc != 0 && g_strideNoteForward && g_strideNoteSink != nullptr)
            {
                int& held = g_strideHeldNote[(size_t) (nc - 'a')];

                // An UP for a note WE started ALWAYS releases, from whatever window it
                // arrives in — clicking away mid-hold delivers the release elsewhere, and
                // a skipped UP is a note that rings forever. Consumed only on our windows
                // (a stray keyUp is harmless to others, and swallowing theirs is not).
                if (! down)
                {
                    if (held >= 0)
                    {
                        g_strideNoteSink (g_strideNoteSinkCtx, held, 0, false);
                        held = -1;
                        return (hosted || frame) ? nil : e;
                    }
                    return e;
                }

                if (hosted || frame)
                {
                    if (g_strideRecording) return e;                    // Live records: its piano must take (and record) the keys
                    if (frame  && g_strideTextFocus) return e;          // typing in a Stride field
                    if (hosted && strideHostedFirstResponderIsText (w)) return e;   // typing in the synth's preset search

                    const NSUInteger mods = [e modifierFlags]
                        & (NSEventModifierFlagCommand | NSEventModifierFlagControl
                            | NSEventModifierFlagOption | NSEventModifierFlagShift);
                    if (mods != 0) return e;                            // any modifier = a shortcut, ours or the DAW's

                    if ([e isARepeat]) return nil;                      // repeats retrigger nothing; still consumed

                    const int semi = strideSemitoneForChar (nc);
                    if (semi >= 0)
                    {
                        if (held >= 0) g_strideNoteSink (g_strideNoteSinkCtx, held, 0, false);   // same key re-down without an up (edge): end the old one
                        const int note = g_strideOctaveBase + semi;
                        if (note >= 0 && note <= 127)
                        {
                            held = note;
                            g_strideNoteSink (g_strideNoteSinkCtx, note, g_strideTypedVel, true);
                        }
                    }
                    else if (nc == 'z') g_strideOctaveBase = g_strideOctaveBase >= 12 ? g_strideOctaveBase - 12 : g_strideOctaveBase;
                    else if (nc == 'x') g_strideOctaveBase = g_strideOctaveBase <= 96 ? g_strideOctaveBase + 12 : g_strideOctaveBase;
                    else if (nc == 'c') g_strideTypedVel   = g_strideTypedVel > 21   ? g_strideTypedVel - 20   : 1;
                    else if (nc == 'v') g_strideTypedVel   = g_strideTypedVel < 108  ? g_strideTypedVel + 20   : 127;

                    return nil;   // consumed: the WebView never round-trips it, the synth never sees a stray letter
                }
            }

            // ── transport (hosted synth windows only — the WebView case arrives via JS) ──
            if (hosted && (kc == 49 || kc == 36))
            {
                // Forward once per press and ALWAYS consume: an un-consumed Space would
                // ALSO reach Live on its own and double-toggle, and holding Space would
                // rapid-toggle.
                if (down && ! [e isARepeat]) stridePostTransport (kc == 36, w);
                return nil;
            }

            return e;
        }];
}

void strideMacKeyForward_remove (void)
{
    if (--g_strideMonitorRefs > 0) return;   // other Stride instances still need the monitor
    g_strideMonitorRefs = 0;                 // floor (a stray extra remove can't go negative)
    strideReleaseHeldNotes();                // last editor going away: nothing may be left ringing
    if (g_strideResignObs != nil)
    {
        [[NSNotificationCenter defaultCenter] removeObserver: g_strideResignObs];
        [g_strideResignObs release];
        g_strideResignObs = nil;
    }
    if (g_strideMainObs != nil)
    {
        [[NSNotificationCenter defaultCenter] removeObserver: g_strideMainObs];
        [g_strideMainObs release];
        g_strideMainObs = nil;
    }
    if (g_strideKeyMonitor != nil)
    {
        [NSEvent removeMonitor: g_strideKeyMonitor];
        g_strideKeyMonitor = nil;
    }
}

// ── window-pin helpers (the half-screen pin modes) ──────────────────────────
// The editor sizes its CONTENT via setSize and the host re-frames around it; these
// two give the editor what it can't reach through JUCE — the HOST window's chrome
// height and a way to MOVE that window. Coordinates arriving here are JUCE global
// (top-left origin at the primary screen's top-left); AppKit wants bottom-left, so
// Y flips against the primary screen height.
int strideMacHostWindowFrameOverhead (void* nsview)
{
    NSView* v = (NSView*) nsview; if (v == nil) return 0;
    NSWindow* w = [v window];     if (w == nil) return 0;
    const NSRect f = [w frame];
    const NSRect c = [w contentRectForFrameRect: f];
    return (int) llround (f.size.height - c.size.height);   // title bar, in points (no side borders on modern macOS)
}

void strideMacMoveHostWindow (void* nsview, int juceX, int juceY)
{
    NSView* v = (NSView*) nsview; if (v == nil) return;
    NSWindow* w = [v window];     if (w == nil) return;
    if ([[NSScreen screens] count] == 0) return;
    const CGFloat primaryH = [[NSScreen screens] objectAtIndex: 0].frame.size.height;
    const NSRect f = [w frame];
    [w setFrameOrigin: NSMakePoint ((CGFloat) juceX, primaryH - (CGFloat) juceY - f.size.height)];
}
