#pragma once
// macOS keyboard interop between Stride, the synths it hosts, and the DAW.
// Implemented in MacKeyForward.mm (Objective-C++), compiled only on Apple. The C
// interface lets the cross-platform editor call it under #if JUCE_MAC without pulling
// in Cocoa.
//
// Three jobs, all of them fallout from a plugin owning windows inside the DAW's process:
//   1. TRANSPORT — a hosted synth lives in OUR NSWindow, so Space/Return go to it, not
//      the DAW. A local NSEvent monitor catches them on tagged windows and re-posts.
//   2. MAIN-WINDOW HYGIENE — a hosted synth window must never KEEP [NSApp mainWindow]:
//      Live gates its keyboard handling on it and a plugin panel can't take main back.
//      A become-main observer hands main straight back to the DAW (public API only —
//      the 1.1.8 ISA-swizzle of canBecomeMainWindow crashed Live).
//   3. NOTE KEYS — relaying keystrokes to Live is unwinnable: Live's typing piano only
//      accepts keys whose KEY window is one of Live's own, and AppKit routes keyboard
//      events to the key window regardless of an event's windowNumber — a synthetic
//      posted while Stride is focused boomerangs into our own WebView (that was the
//      1.1.9 latency), and one posted while a hosted synth is focused dies in that
//      window's responder chain (that was "F made Pro-Q fullscreen"). So notes are not
//      relayed at all: the monitor CONSUMES them on our windows and the editor injects
//      real MIDI into the wrapper's own processBlock. While Live is RECORDING the
//      monitor stands down instead, so the keys travel Live's own piano and record.
#ifdef __cplusplus
extern "C" {
#endif

void strideMacKeyForward_install (void);            // start the NSEvent monitor (REFCOUNTED — one monitor shared by every open editor)
void strideMacKeyForward_remove  (void);            // drop one ref; the monitor dies only when the LAST editor goes (multi-instance:
                                                    // closing one Stride window must not kill forwarding for the others)
void strideMacKeyForward_setSuppressed (bool s);    // Logic/GarageBand: AUs run OUT-OF-PROCESS (AUHostingService) — no DAW window
                                                    // exists in this process, so never post synthetic TRANSPORT keys or touch main-
                                                    // window state there. (Note injection is self-contained and stays available.)
void strideMacKeyForward_tagWindow (void* nsview);  // mark a hosted synth window: transport keys forward from it, the become-main
                                                    // guard watches it, and note keys on it are consumed+injected. Call at window
                                                    // CREATION only — it performs a one-off main-window catch-up.
void strideMacKeyForward_registerEditorView (void* nsview);   // Stride editor NSView (idempotent; refreshed by each editor's timer).
                                                              // The registry identifies every instance's plugin frame window as "ours":
                                                              // never re-post into one, and consume+inject note keys arriving on one.
void strideMacKeyForward_unregisterEditorView (void* nsview); // editor going away — drops ONLY its own view (never another instance's)
                                                              // and releases any note it still owes, so nothing sticks on.
void strideMacKeyForward_post (bool isReturn);                // WebView Space/Return (JS-forwarded) -> the DAW's transport
void strideMacKeyForward_postSave (void);                     // WebView Cmd+S -> the DAW (project save); same discovery/debounce/suppression policy
void strideMacKeyForward_postUndo (bool redo);                // WebView Cmd+Z / Cmd+Shift+Z -> the DAW, when the undo belongs to the host and not to Stride
void strideMacKeyForward_setNoteSink (void* ctx,              // where consumed note keys become MIDI: the editor routes them into the
        void (*sink) (void* ctx, int midiNote,                // processor's typed-note queue. Last registered editor wins (multi-instance:
                      int velocity, bool isDown));            // typed notes go to the most recently opened Stride). nullptr = disable.
void strideMacKeyForward_setNoteForwardEnabled (bool on);     // master enable for note handling (kept for symmetry; injection is
                                                              // self-contained, so this is safe to leave ON in every host)
void strideMacKeyForward_setRecording (bool recording);       // Live rolling in record: stand down — the keys must travel Live's own
                                                              // piano so they RECORD into the clip (accepting the WebView latency there)
void strideMacKeyForward_setTextFocus (bool on);              // the page has a text field focused: stop consuming note keys so the
                                                              // user can type a license key / plugin search / BPM without playing notes

// ── window-pin helpers (the half-screen pin modes) ──────────────────────────
int  strideMacHostWindowFrameOverhead (void* nsview);         // host window frame height minus content height (title bar, in points)
void strideMacMoveHostWindow (void* nsview, int juceX, int juceY);   // move the HOST window so its frame's top-left lands on the given
                                                                     // JUCE global coords (top-left origin; AppKit Y-flip handled inside)

#ifdef __cplusplus
}
#endif
