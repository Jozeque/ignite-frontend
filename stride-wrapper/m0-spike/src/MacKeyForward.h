#pragma once
// macOS transport-key forwarding (the Mac counterpart of BOTH Windows paths in
// PluginEditor.cpp: the WH_GETMESSAGE hook for hosted synth windows AND the JS
// "transportKey" forward for Stride's own WebView). Implemented in MacKeyForward.mm
// (Objective-C++), compiled only on Apple. The C interface lets the cross-platform
// editor call it under #if JUCE_MAC without pulling in Cocoa.
#ifdef __cplusplus
extern "C" {
#endif

void strideMacKeyForward_install (void);            // start the NSEvent monitor
void strideMacKeyForward_remove  (void);            // stop it
void strideMacKeyForward_setSuppressed (bool s);    // Logic/GarageBand: AUs run OUT-OF-PROCESS (AUHostingService) — no DAW window
                                                    // exists in this process and Logic sees unconsumed keys itself, so a synthetic
                                                    // re-post could only misfire/double-toggle. Suppresses BOTH forward paths.
void strideMacKeyForward_tagWindow (void* nsview);  // mark a hosted synth window so Space/Return forward to the DAW
void strideMacKeyForward_setEditorView (void* nsview);   // Stride's editor NSView — identifies the DAW's plugin frame window
void strideMacKeyForward_clearEditorView (void);          // editor going away (drop the raw pointer)
void strideMacKeyForward_post (bool isReturn);            // WebView Space/Return (JS-forwarded) -> the DAW's transport

#ifdef __cplusplus
}
#endif
