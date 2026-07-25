// macOS keyboard interop — the Mac counterpart of the Windows paths in PluginEditor.cpp
// (the WH_GETMESSAGE hook + the JS "transportKey" forward).
//
// THE ROOT PROBLEM: a plugin that owns windows inside the DAW's process breaks the DAW's
// own idea of "which of my windows is active", and both Live's transport keys and its
// computer-MIDI keyboard are gated on exactly that. Three separate consequences, three
// separate mechanisms below.
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
//   2. MAIN-WINDOW THEFT  (the "typing keyboard goes dead on a hosted synth" bug)
//      JUCE's peer returns YES from canBecomeMainWindow for ANY ResizableWindow
//      (juce_NSViewComponentPeer_mac.mm), and our HostedWindow is a DocumentWindow. So
//      clicking a hosted synth made it key AND [NSApp mainWindow] — Live's computer-MIDI
//      keyboard gate reads main-window status, failed, and dropped the letters through to
//      Live's single-key SHORTCUTS (draw mode, deactivate clip…) with the keyboard button
//      still lit. And because a plugin panel cannot take main back, clicking Stride again
//      did NOT fix it — only clicking Live's own window did. Native plugin windows are
//      utility panels that never take main; strideMakeWindowNonMain makes ours behave the
//      same. The check isn't overridable from outside JUCE, hence the ISA subclass.
//
//   3. NOTE KEYS THROUGH THE WEBVIEW  (the "latency + random note length" bug)
//      With Stride's canvas focused, WKWebView forwards each key to the WEB process and
//      only re-injects it into [NSApp sendEvent:] once that process reports it unhandled.
//      Letters aren't handled by the page, so Live received them late — and keyDown and
//      keyUp are delayed INDEPENDENTLY, so a short tap came out as a random mid/long note.
//      (Space never showed this because the page consumes it, which is why Space alone
//      needed an explicit forward.) The monitor now intercepts note keys BEFORE the
//      WebView sees them and re-posts them itself: no web process in the path, so the
//      note length is whatever the user actually played. Re-posting via
//      [NSApp postEvent:] rather than [window sendEvent:] is deliberate — postEvent goes
//      through the same [NSApp sendEvent:] dispatch the bounce-back used, which is the one
//      path we have PROOF reaches Live's typing keyboard.
#import <Cocoa/Cocoa.h>
#import <objc/runtime.h>
#include "MacKeyForward.h"
#include <vector>
#include <cstdio>

static id     g_strideKeyMonitor  = nil;
static id     g_strideResignObs   = nil;       // app-deactivate observer — releases notes held when focus leaves the app entirely
static int    g_strideMonitorRefs = 0;         // one monitor shared by every open editor — dies with the LAST one (multi-instance)
static std::vector<void*> g_strideEditorViews; // every live Stride editor's NSView* — so ALL instances' frame windows count as "ours"
static void*  g_strideLastEditorView = nullptr;// most recently refreshed view — the frame-fallback delivery target
static double g_strideLastPost   = 0.0;
static bool   g_strideSuppressed = false;      // Logic/GarageBand (out-of-process AU): never post synthetic keys
static bool   g_strideNoteForward = false;     // keyboard-mode notes: Ableton only (set from the editor) — other DAWs treat bare letters as commands
static bool   g_strideTextFocus   = false;     // the page has a text field focused: hands off the note keys (the user is typing)
static unsigned g_strideNotesDown = 0;         // bit per letter we forwarded a DOWN for — its UP always forwards (else: stuck note)

static NSWindow* strideFindHostWindow (NSWindow* avoid);   // defined below (needs strideIsOurWindow)
static void      strideReleaseHeldNotes (void);

void strideMacKeyForward_setSuppressed (bool s) { g_strideSuppressed = s; }

// Live's computer-MIDI keyboard note set (A-row notes + the black-key row + Z/X octave,
// C/V velocity), as kVK_ANSI_* keycodes — hardcoded like Space/Return below (no Carbon
// import). Live maps notes by the PHYSICAL key, which is exactly what these keycodes are,
// so this stays correct on non-Latin layouts too. (';' — the top E of Live's two-octave
// layout — is deliberately left out: it is the only non-letter in the set and would need
// special-casing in three places for one note.)
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
static short strideNoteKeyCodeForChar (char c)
{
    switch (c)
    {
        case 'a': return 0;  case 's': return 1;  case 'd': return 2;  case 'f': return 3;
        case 'h': return 4;  case 'g': return 5;  case 'z': return 6;  case 'x': return 7;
        case 'c': return 8;  case 'v': return 9;  case 'w': return 13; case 'e': return 14;
        case 'y': return 16; case 't': return 17; case 'o': return 31; case 'u': return 32;
        case 'p': return 35; case 'l': return 37; case 'j': return 38; case 'k': return 40;
        default:  return -1;
    }
}

// ── main-window hygiene ─────────────────────────────────────────────────────
static BOOL strideNeverMain (id, SEL) { return NO; }

// Reassign this window's class to a subclass that refuses main-window status (case 2 in
// the header comment). Per-baseclass and cached — objc_allocateClassPair fails on a
// duplicate name — and idempotent, so the editor tick can call it forever for free.
// No ivars are added, so re-classing a live window is safe.
static void strideMakeWindowNonMain (NSWindow* w)
{
    if (w == nil) return;

    Class base = object_getClass (w);
    NSString* baseName = NSStringFromClass (base);
    if ([baseName hasPrefix: @"StrideNonMain_"]) return;   // already done

    NSString* subName = [@"StrideNonMain_" stringByAppendingString: baseName];
    Class sub = NSClassFromString (subName);
    if (sub == Nil)
    {
        sub = objc_allocateClassPair (base, [subName UTF8String], 0);
        if (sub == Nil) return;                            // lost a race, or the name is taken: leave the window as it was
        char sig[8];
        std::snprintf (sig, sizeof (sig), "%s@:", @encode (BOOL));   // BOOL is 'c' on x86_64 and 'B' on arm64 — resolve it per slice
        class_addMethod (sub, @selector (canBecomeMainWindow), (IMP) strideNeverMain, sig);
        objc_registerClassPair (sub);
    }
    object_setClass (w, sub);
}

void strideMacKeyForward_tagWindow (void* nsview)
{
    if (nsview == nullptr) return;
    NSView* v = (__bridge NSView*) nsview;
    NSWindow* w = [v window];
    if (w == nil) return;

    if (! [[w identifier] isEqualToString: @"StrideHostedSynth"])
        w.identifier = @"StrideHostedSynth";               // transport keys forward from here

    // Logic/GarageBand host AUs out-of-process, where our window may be the only
    // main-capable one in the service process — leave main alone there.
    if (! g_strideSuppressed)
    {
        strideMakeWindowNonMain (w);
        // Lost the race — it was shown and took main before we got here? Hand main
        // straight back, or the DAW stays gated until the user clicks it.
        if ([w isMainWindow])
            if (NSWindow* daw = strideFindHostWindow (w))
                [daw makeMainWindow];
    }
}

void strideMacKeyForward_setTextFocus (bool on) { g_strideTextFocus = on; }

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
// events would otherwise disappear into our WebView. These are the windows we intercept
// note keys from (a tagged hosted-synth window is handled separately and has no WebView).
static bool strideIsEditorFrameWindow (NSWindow* w)
{
    if (w == nil) return false;
    for (void* view : g_strideEditorViews)
        if (view != nullptr && [(__bridge NSView*) view window] == w) return true;
    return false;
}

static NSEvent* strideMakeNoteEvent (char c, short kc, bool isDown, NSInteger windowNumber)
{
    NSString* s = [NSString stringWithFormat: @"%c", c];
    return [NSEvent keyEventWithType: isDown ? NSEventTypeKeyDown : NSEventTypeKeyUp
                            location: NSZeroPoint
                       modifierFlags: 0
                           timestamp: [[NSProcessInfo processInfo] systemUptime]
                        windowNumber: windowNumber
                             context: nil
                          characters: s
         charactersIgnoringModifiers: s
                           isARepeat: NO
                             keyCode: (unsigned short) kc];
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

void strideMacKeyForward_unregisterEditorView (void* nsview)
{
    if (nsview == nullptr) return;
    for (size_t i = 0; i < g_strideEditorViews.size(); ++i)
        if (g_strideEditorViews[i] == nsview) { g_strideEditorViews.erase (g_strideEditorViews.begin() + (long) i); break; }
    if (g_strideLastEditorView == nsview)
        g_strideLastEditorView = g_strideEditorViews.empty() ? nullptr : g_strideEditorViews.back();
    if (g_strideEditorViews.empty())
        strideReleaseHeldNotes();   // last editor gone mid-hold: don't leave a note ringing in Live
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
// UNCHANGED delivery (sendEvent) — this path is field-proven working on Live/Mac and the
// note path's problem was never delivery, so there is nothing here to "fix".
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

// Cmd+S -> the DAW (project save). Same discovery + debounce + Logic/GB suppression as the
// transport keys; its own event builder because Save carries the Command flag + "s"
// (kVK_ANSI_S = 1). Cmd combos dispatch through the window's key-equivalent chain, which is
// exactly what [target sendEvent:] feeds.
void strideMacKeyForward_postSave (void)
{
    if (g_strideSuppressed) return;
    const double now = [[NSProcessInfo processInfo] systemUptime];
    if (now - g_strideLastPost < 0.15) return;

    NSWindow* target = strideFindHostWindow (nil);
    const bool viaFrame = (target == nil);
    if (viaFrame) target = strideEditorFrameWindow();   // per-plugin-process host: the frame forwards or drops it
    if (target == nil) return;

    g_strideLastPost = now;
    NSString* s = @"s";
    NSEvent* down = [NSEvent keyEventWithType: NSEventTypeKeyDown
                                     location: NSZeroPoint
                                modifierFlags: NSEventModifierFlagCommand
                                    timestamp: [[NSProcessInfo processInfo] systemUptime]
                                 windowNumber: [target windowNumber]
                                      context: nil
                                   characters: s
                  charactersIgnoringModifiers: s
                                    isARepeat: NO
                                      keyCode: (unsigned short) 1];
    NSEvent* up = [NSEvent keyEventWithType: NSEventTypeKeyUp
                                   location: NSZeroPoint
                              modifierFlags: NSEventModifierFlagCommand
                                  timestamp: [[NSProcessInfo processInfo] systemUptime]
                               windowNumber: [target windowNumber]
                                    context: nil
                                 characters: s
                charactersIgnoringModifiers: s
                                  isARepeat: NO
                                    keyCode: (unsigned short) 1];
    if (viaFrame) { [target keyDown: down]; [target keyUp: up]; }
    else          { [target sendEvent: down]; [target sendEvent: up]; }
}

// A note key -> Live's computer-MIDI keyboard. ONE event per call: real down/up pairs,
// because a note has a release — and NO debounce, because chords and fast playing are the
// whole point (the transport's g_strideLastPost stays untouched so notes can't starve the
// Space toggle either).
//
// postEvent, not sendEvent: sendEvent pokes a window directly and skips [NSApp sendEvent:],
// which is where Live's typing keyboard actually lives — a letter delivered that way lands
// on Live's SHORTCUT path instead (draw mode, deactivate clip…). postEvent puts the event in
// the normal application queue, which is the same route WebKit's unhandled-key re-injection
// took, and that route is PROVEN to produce notes. atStart:NO so a chord keeps its order.
static void stridePostNoteKey (char c, bool isDown)
{
    if (g_strideSuppressed || ! g_strideNoteForward) return;
    const short kc = strideNoteKeyCodeForChar (c);
    if (kc < 0) return;

    NSWindow* target = strideFindHostWindow (nil);
    if (target == nil) return;   // no DAW window in this process: nothing could play anyway

    [NSApp postEvent: strideMakeNoteEvent (c, kc, isDown, [target windowNumber]) atStart: NO];
}

// Release every note we still owe an UP for. Called when note forwarding is turned off and
// when an editor goes away — a focus change or a window closing mid-hold must not leave a
// note ringing in Live forever.
static void strideReleaseHeldNotes (void)
{
    for (char c = 'a'; c <= 'z'; ++c)
    {
        const unsigned bit = 1u << (c - 'a');
        if ((g_strideNotesDown & bit) != 0)
        {
            g_strideNotesDown &= ~bit;
            stridePostNoteKey (c, false);
        }
    }
}

void strideMacKeyForward_setNoteForwardEnabled (bool on)
{
    if (! on) strideReleaseHeldNotes();
    g_strideNoteForward = on;
}

void strideMacKeyForward_install (void)
{
    ++g_strideMonitorRefs;
    if (g_strideKeyMonitor != nil) return;

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
            // outright, which is how a note key gets taken away from the WebView (and from
            // Live's shortcut handler) instead of merely being copied.
            const bool down = ([e type] == NSEventTypeKeyDown);
            const unsigned short kc = [e keyCode];   // 49 = Space, 36 = Return
            NSWindow* w = [e window];

            const bool hosted = (w != nil && [[w identifier] isEqualToString: @"StrideHostedSynth"]);
            const bool frame  = (! hosted && strideIsEditorFrameWindow (w));

            // An UP for a note WE started always forwards, from whatever window it arrives
            // in — clicking away mid-hold sends the release somewhere else, and a skipped UP
            // is a note that rings forever.
            if (! down)
            {
                const char nc = strideNoteCharForKeyCode (kc);
                if (nc != 0)
                {
                    const unsigned bit = 1u << (nc - 'a');
                    if ((g_strideNotesDown & bit) != 0)
                    {
                        g_strideNotesDown &= ~bit;
                        stridePostNoteKey (nc, false);
                        return (hosted || frame) ? nil : e;
                    }
                }
            }

            if (hosted)
            {
                // Transport: forward once per press and ALWAYS consume. Consuming even the
                // repeats and the UP matters now that our window no longer takes main —
                // an un-consumed Space would ALSO reach Live on its own and double-toggle,
                // and holding Space would rapid-toggle.
                if (kc == 49 || kc == 36)
                {
                    if (down && ! [e isARepeat]) stridePostTransport (kc == 36, w);
                    return nil;
                }
                // Note keys need NOTHING here: with main-window status left where it
                // belongs (strideMakeWindowNonMain), Live's typing keyboard claims the
                // letter itself. Forwarding as well would play every note twice.
                return e;
            }

            // Stride's own WebView: take the note keys before WKWebView can send them on a
            // round trip through the web process (see case 3 in the header comment).
            if (frame && down && g_strideNoteForward && ! g_strideSuppressed && ! g_strideTextFocus)
            {
                const char nc = strideNoteCharForKeyCode (kc);
                const NSUInteger mods = [e modifierFlags]
                    & (NSEventModifierFlagCommand | NSEventModifierFlagControl
                        | NSEventModifierFlagOption | NSEventModifierFlagShift);
                if (nc != 0 && mods == 0)
                {
                    // Repeats are consumed but not re-sent: Live retriggers nothing on a
                    // repeat, and re-posting each one would restart the note.
                    if (! [e isARepeat])
                    {
                        g_strideNotesDown |= (1u << (nc - 'a'));
                        stridePostNoteKey (nc, true);
                    }
                    return nil;
                }
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
    if (g_strideKeyMonitor != nil)
    {
        [NSEvent removeMonitor: g_strideKeyMonitor];
        g_strideKeyMonitor = nil;
    }
}
