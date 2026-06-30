// macOS transport-key forwarding — Mac counterpart of the Windows WH_GETMESSAGE
// hook. A hosted synth lives in OUR NSWindow, so Space/Return go to it, not the
// DAW. A local NSEvent monitor catches those keys when they target a tagged
// hosted-synth window and re-dispatches them to the DAW's main window so the
// transport responds, like a native plugin window.
#import <Cocoa/Cocoa.h>
#include "MacKeyForward.h"

static id g_strideKeyMonitor = nil;

void strideMacKeyForward_tagWindow (void* nsview)
{
    if (nsview == nullptr) return;
    NSView* v = (__bridge NSView*) nsview;
    NSWindow* w = [v window];
    if (w != nil) w.identifier = @"StrideHostedSynth";
}

void strideMacKeyForward_install (void)
{
    if (g_strideKeyMonitor != nil) return;
    g_strideKeyMonitor = [NSEvent addLocalMonitorForEventsMatchingMask:NSEventMaskKeyDown
        handler:^NSEvent* (NSEvent* e)
        {
            const unsigned short kc = [e keyCode];   // 49 = Space, 36 = Return
            if ((kc == 49 || kc == 36)
                 && [e window] != nil
                 && [[[e window] identifier] isEqualToString:@"StrideHostedSynth"])
            {
                NSWindow* host = [NSApp mainWindow];
                if (host != nil && host != [e window])
                {
                    [host sendEvent:e];   // hand Space/Return to the DAW's main window -> transport
                    return nil;           // consume so the hosted synth doesn't also act on it
                }
            }
            return e;
        }];
}

void strideMacKeyForward_remove (void)
{
    if (g_strideKeyMonitor != nil)
    {
        [NSEvent removeMonitor:g_strideKeyMonitor];
        g_strideKeyMonitor = nil;
    }
}
