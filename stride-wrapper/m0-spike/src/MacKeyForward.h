#pragma once
// macOS keyboard interop between Stride, the synths it hosts, and the DAW.
// Implemented in MacKeyForward.mm (Objective-C++), compiled only on Apple. The C
// interface lets the cross-platform editor call it under #if JUCE_MAC without pulling
// in Cocoa.
//
// Three jobs, all of them fallout from a plugin owning windows inside the DAW's process:
//   1. TRANSPORT — a hosted synth lives in OUR NSWindow, so Space/Return go to it, not
//      the DAW. A local NSEvent monitor catches them on tagged windows and re-posts.
//   2. MAIN-WINDOW HYGIENE — a hosted synth window must never become [NSApp mainWindow].
//      JUCE lets any ResizableWindow take main, which broke Live's computer-MIDI keyboard
//      (see tagWindow). Native plugin windows are utility panels that never take main.
//   3. NOTE KEYS — with Stride's WebView focused, WKWebView hands unhandled keys to the
//      web process and only re-injects them into [NSApp sendEvent:] after the round trip,
//      so Live's typing piano played LATE and with random note lengths (down and up are
//      delayed independently). The monitor intercepts note keys BEFORE the WebView and
//      re-posts them itself, which removes the web process from the path entirely.
#ifdef __cplusplus
extern "C" {
#endif

void strideMacKeyForward_install (void);            // start the NSEvent monitor (REFCOUNTED — one monitor shared by every open editor)
void strideMacKeyForward_remove  (void);            // drop one ref; the monitor dies only when the LAST editor goes (multi-instance:
                                                    // closing one Stride window must not kill forwarding for the others)
void strideMacKeyForward_setSuppressed (bool s);    // Logic/GarageBand: AUs run OUT-OF-PROCESS (AUHostingService) — no DAW window
                                                    // exists in this process and Logic sees unconsumed keys itself, so a synthetic
                                                    // re-post could only misfire/double-toggle. Suppresses EVERY path below.
void strideMacKeyForward_tagWindow (void* nsview);  // mark a hosted synth window: Space/Return forward to the DAW, and the become-main
                                                    // guard hands main-window status back to the DAW if this window ever takes it.
                                                    // Call at window CREATION only — it performs a one-off main-window catch-up.
void strideMacKeyForward_registerEditorView (void* nsview);   // Stride editor NSView (idempotent; refreshed by each editor's timer).
                                                              // The REGISTRY does double duty: it identifies every instance's plugin
                                                              // frame as "ours" (never re-post into one) and marks the windows whose
                                                              // note keys we intercept ahead of the WebView.
void strideMacKeyForward_unregisterEditorView (void* nsview); // editor going away — drops ONLY its own view (never another instance's)
                                                              // and releases any note it still owes, so nothing sticks on.
void strideMacKeyForward_post (bool isReturn);                // WebView Space/Return (JS-forwarded) -> the DAW's transport
void strideMacKeyForward_postSave (void);                     // WebView Cmd+S -> the DAW (project save); same discovery/debounce/suppression policy
void strideMacKeyForward_setNoteForwardEnabled (bool on);     // Ableton only — other DAWs treat bare letters as single-key COMMANDS, not notes
void strideMacKeyForward_setTextFocus (bool on);              // the page has a text field focused: stop intercepting note keys so the
                                                              // user can type a license key / plugin search / BPM without playing notes

#ifdef __cplusplus
}
#endif
