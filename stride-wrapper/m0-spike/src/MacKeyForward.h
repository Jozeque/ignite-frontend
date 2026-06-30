#pragma once
// macOS transport-key forwarding for hosted synth windows (the Mac counterpart of
// the Windows WH_GETMESSAGE hook in PluginEditor.cpp). Implemented in
// MacKeyForward.mm (Objective-C++), compiled only on Apple. The C interface lets
// the cross-platform editor call it under #if JUCE_MAC without pulling in Cocoa.
#ifdef __cplusplus
extern "C" {
#endif

void strideMacKeyForward_install (void);            // start the NSEvent monitor
void strideMacKeyForward_remove  (void);            // stop it
void strideMacKeyForward_tagWindow (void* nsview);  // mark a hosted synth window so Space/Return forward to the DAW

#ifdef __cplusplus
}
#endif
