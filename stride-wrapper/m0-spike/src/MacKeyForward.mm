// macOS transport + note-key forwarding — Mac counterpart of BOTH Windows paths in
// PluginEditor.cpp (the WH_GETMESSAGE hook + the JS "transportKey"/"musicKey" forwards).
//
// Two broken-by-default cases, one shared delivery:
//   1. A hosted synth lives in OUR NSWindow, so Space/Return — and Live's computer-MIDI
//      note keys — go to it, not the DAW. A local NSEvent monitor catches those keys on
//      tagged windows (install/tag).
//   2. Stride's own WebView holds keyboard focus after drawing — WKWebView consumes
//      keys outright, so the page JS forwards Space and native re-posts it (_post);
//      note keys ride the same route as real down/up pairs (_postNoteKey).
//
// Both funnel into stridePostTransport(): find a DAW window that is NOT ours and
// re-dispatch a fresh Space/Return there. "Ours" = tagged hosted-synth windows + the
// plugin frame window that embeds Stride's editor view. Two details matter:
//   - [NSApp mainWindow] alone is WRONG: when a hosted synth window is focused, macOS
//     makes OUR window key AND main, so the old monitor forwarded nowhere (the Bitwig
//     "space only works when I click the DAW" report). We skip our windows and fall
//     back to the frontmost regular window that isn't ours.
//   - Sandboxed hosts (e.g. Bitwig's per-plugin process) have NO DAW window in this
//     process at all — only the plugin frame. Last resort: hand the key to the frame
//     window OBJECT directly. That skips the first responder (our WebView, which would
//     just swallow it again) and lands in the host frame's own key handling if it has
//     any; a harmless no-op otherwise.
// A 150ms debounce means any misdelivery bounce terminates after a single cycle.
#import <Cocoa/Cocoa.h>
#include "MacKeyForward.h"
#include <vector>

static id     g_strideKeyMonitor  = nil;
static int    g_strideMonitorRefs = 0;         // one monitor shared by every open editor — dies with the LAST one (multi-instance)
static std::vector<void*> g_strideEditorViews; // every live Stride editor's NSView* — so ALL instances' frame windows count as "ours"
static void*  g_strideLastEditorView = nullptr;// most recently refreshed view — the frame-fallback delivery target
static double g_strideLastPost   = 0.0;
static bool   g_strideSuppressed = false;      // Logic/GarageBand (out-of-process AU): never post synthetic keys
static bool   g_strideNoteForward = false;     // keyboard-mode notes: Ableton only (set from the editor) — other DAWs treat bare letters as commands
static unsigned g_strideMacNotesDown = 0;      // hosted-synth monitor: bit per letter we forwarded a DOWN for — its UP always forwards (else: stuck note)

void strideMacKeyForward_setSuppressed (bool s) { g_strideSuppressed = s; }
void strideMacKeyForward_setNoteForwardEnabled (bool on) { g_strideNoteForward = on; }

// Live's computer-MIDI keyboard note set (A-row notes + Z/X octave + C/V velocity), as
// kVK_ANSI_* keycodes — hardcoded like Space/Return below (no Carbon import). Live maps
// notes by the PHYSICAL key, which is exactly what these keycodes are — so this stays
// correct on non-Latin layouts too.
static char strideNoteCharForKeyCode (unsigned short kc)
{
    switch (kc)
    {
        case 0:  return 'a';  case 1:  return 's';  case 2:  return 'd';  case 3:  return 'f';
        case 4:  return 'h';  case 5:  return 'g';  case 6:  return 'z';  case 7:  return 'x';
        case 8:  return 'c';  case 9:  return 'v';  case 13: return 'w';  case 14: return 'e';
        case 16: return 'y';  case 17: return 't';  case 32: return 'u';  case 37: return 'l';
        case 38: return 'j';  case 40: return 'k';
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
        case 'y': return 16; case 't': return 17; case 'u': return 32; case 'l': return 37;
        case 'j': return 38; case 'k': return 40;
        default:  return -1;
    }
}

void strideMacKeyForward_tagWindow (void* nsview)
{
    if (nsview == nullptr) return;
    NSView* v = (__bridge NSView*) nsview;
    NSWindow* w = [v window];
    if (w != nil) w.identifier = @"StrideHostedSynth";
}

void strideMacKeyForward_registerEditorView (void* nsview)
{
    if (nsview == nullptr) return;
    g_strideLastEditorView = nsview;           // refreshed at 30Hz by each editor's timer — last-focused wins the fallback
    for (void* v : g_strideEditorViews) if (v == nsview) return;   // idempotent
    g_strideEditorViews.push_back (nsview);
}

void strideMacKeyForward_unregisterEditorView (void* nsview)
{
    if (nsview == nullptr) return;
    for (size_t i = 0; i < g_strideEditorViews.size(); ++i)
        if (g_strideEditorViews[i] == nsview) { g_strideEditorViews.erase (g_strideEditorViews.begin() + (long) i); break; }
    if (g_strideLastEditorView == nsview)
        g_strideLastEditorView = g_strideEditorViews.empty() ? nullptr : g_strideEditorViews.back();
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
static bool stridePostTransport (bool isReturn, NSWindow* avoid)
{
    if (g_strideSuppressed) return false;   // Logic/GarageBand: no DAW window in this process — don't synthesize keys

    const double now = [[NSProcessInfo processInfo] systemUptime];
    if (now - g_strideLastPost < 0.15) return false;   // debounce: one toggle per press, kills any bounce

    // A real host window: prefer the main window, else the frontmost regular window
    // that isn't ours (covers "our synth window became key AND main").
    NSWindow* target = [NSApp mainWindow];
    if (target == nil || target == avoid || strideIsOurWindow (target) || ! [target isVisible])
    {
        target = nil;
        for (NSWindow* w in [NSApp orderedWindows])
            if (w != nil && w != avoid && ! strideIsOurWindow (w) && [w isVisible] && [w canBecomeMainWindow])
            {
                target = w;
                break;
            }
    }

    if (target != nil)
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

    NSWindow* target = [NSApp mainWindow];
    if (target == nil || strideIsOurWindow (target) || ! [target isVisible])
    {
        target = nil;
        for (NSWindow* w in [NSApp orderedWindows])
            if (w != nil && ! strideIsOurWindow (w) && [w isVisible] && [w canBecomeMainWindow]) { target = w; break; }
    }
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

// A note key (Ableton's computer-MIDI keyboard) -> Live. ONE event per call: real
// down/up pairs, because a note has a release — and NO debounce, because chords and
// fast playing are the whole point (the transport's g_strideLastPost stays untouched
// so notes can't starve the Space toggle either). No frame fallback: Ableton hosts
// in-process, so "no DAW window found" means there is nothing that could play anyway.
void strideMacKeyForward_postNoteKey (char c, bool isDown)
{
    if (g_strideSuppressed || ! g_strideNoteForward) return;
    const short kc = strideNoteKeyCodeForChar (c);
    if (kc < 0) return;

    NSWindow* target = [NSApp mainWindow];
    if (target == nil || strideIsOurWindow (target) || ! [target isVisible])
    {
        target = nil;
        for (NSWindow* w in [NSApp orderedWindows])
            if (w != nil && ! strideIsOurWindow (w) && [w isVisible] && [w canBecomeMainWindow]) { target = w; break; }
    }
    if (target == nil) return;

    NSString* s = [NSString stringWithFormat: @"%c", c];
    [target sendEvent: [NSEvent keyEventWithType: isDown ? NSEventTypeKeyDown : NSEventTypeKeyUp
                                        location: NSZeroPoint
                                   modifierFlags: 0
                                       timestamp: [[NSProcessInfo processInfo] systemUptime]
                                    windowNumber: [target windowNumber]
                                         context: nil
                                      characters: s
                     charactersIgnoringModifiers: s
                                       isARepeat: NO
                                         keyCode: (unsigned short) kc]];
}

void strideMacKeyForward_install (void)
{
    ++g_strideMonitorRefs;
    if (g_strideKeyMonitor != nil) return;
    g_strideKeyMonitor = [NSEvent addLocalMonitorForEventsMatchingMask: (NSEventMaskKeyDown | NSEventMaskKeyUp)
        handler: ^NSEvent* (NSEvent* e)
        {
            NSWindow* w = [e window];
            if (w == nil || ! [[w identifier] isEqualToString: @"StrideHostedSynth"])
                return e;   // only hosted synth windows are ours to forward from

            const bool down = ([e type] == NSEventTypeKeyDown);
            const unsigned short kc = [e keyCode];   // 49 = Space, 36 = Return

            if (kc == 49 || kc == 36)
            {
                if (down && ! [e isARepeat]          // one toggle per press — a synthesized down+up per repeat would rapid-toggle
                     && stridePostTransport (kc == 36, w))
                    return nil;   // consumed: the hosted synth shouldn't also act on it
                return e;
            }

            // Keyboard-mode notes (Live only): REAL down/up pairs, NOT consumed — the synth
            // keeps its own keys (preset search boxes still type). A DOWN forwards only
            // unmodified (a forwarded letter under a held Cmd would land as a command); an
            // UP we owe forwards regardless of what's held by then, or the note sticks.
            // Repeats never forward — each would re-post as a fresh retriggering down.
            const char nc = strideNoteCharForKeyCode (kc);
            if (nc != 0 && g_strideNoteForward && ! g_strideSuppressed)
            {
                const unsigned bit = 1u << (nc - 'a');
                const NSUInteger mods = [e modifierFlags]
                    & (NSEventModifierFlagCommand | NSEventModifierFlagControl
                        | NSEventModifierFlagOption | NSEventModifierFlagShift);
                if (down)
                {
                    if (mods == 0 && ! [e isARepeat])
                    {
                        g_strideMacNotesDown |= bit;
                        strideMacKeyForward_postNoteKey (nc, true);
                    }
                }
                else if ((g_strideMacNotesDown & bit) != 0)
                {
                    g_strideMacNotesDown &= ~bit;
                    strideMacKeyForward_postNoteKey (nc, false);
                }
            }
            return e;
        }];
}

void strideMacKeyForward_remove (void)
{
    if (--g_strideMonitorRefs > 0) return;   // other Stride instances still need the monitor
    g_strideMonitorRefs = 0;                 // floor (a stray extra remove can't go negative)
    if (g_strideKeyMonitor != nil)
    {
        [NSEvent removeMonitor: g_strideKeyMonitor];
        g_strideKeyMonitor = nil;
    }
}
