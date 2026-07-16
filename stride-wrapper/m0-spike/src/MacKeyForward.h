#pragma once
// macOS transport-key forwarding (the Mac counterpart of BOTH Windows paths in
// PluginEditor.cpp: the WH_GETMESSAGE hook for hosted synth windows AND the JS
// "transportKey" forward for Stride's own WebView). Implemented in MacKeyForward.mm
// (Objective-C++), compiled only on Apple. The C interface lets the cross-platform
// editor call it under #if JUCE_MAC without pulling in Cocoa.
#ifdef __cplusplus
extern "C" {
#endif

void strideMacKeyForward_install (void);            // start the NSEvent monitor (REFCOUNTED — one monitor shared by every open editor)
void strideMacKeyForward_remove  (void);            // drop one ref; the monitor dies only when the LAST editor goes (multi-instance:
                                                    // closing one Stride window must not kill forwarding for the others)
void strideMacKeyForward_setSuppressed (bool s);    // Logic/GarageBand: AUs run OUT-OF-PROCESS (AUHostingService) — no DAW window
                                                    // exists in this process and Logic sees unconsumed keys itself, so a synthetic
                                                    // re-post could only misfire/double-toggle. Suppresses BOTH forward paths.
void strideMacKeyForward_tagWindow (void* nsview);  // mark a hosted synth window so Space/Return forward to the DAW
void strideMacKeyForward_registerEditorView (void* nsview);   // Stride editor NSView (idempotent; refreshed by each editor's timer).
                                                              // The REGISTRY identifies every instance's plugin frame window as "ours"
                                                              // so a re-post never lands in another Stride's frame.
void strideMacKeyForward_unregisterEditorView (void* nsview); // editor going away — drops ONLY its own view (never another instance's)
void strideMacKeyForward_post (bool isReturn);                // WebView Space/Return (JS-forwarded) -> the DAW's transport
void strideMacKeyForward_postSave (void);                     // WebView Cmd+S -> the DAW (project save); same discovery/debounce/suppression policy

#ifdef __cplusplus
}
#endif
