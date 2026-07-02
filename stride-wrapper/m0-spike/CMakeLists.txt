# ============================================================
# Stride Wrapper — M0/M1 spike (a JUCE VST3 that HOSTS a synth)
# ============================================================
# M0: load a VST3 (e.g. Serum) inside our VST3, enumerate its params,
#     drive ONE from a transport-synced sine LFO, open the hosted GUI.
# M1: swap the native panel for a JUCE WebView UI (same pattern Tendril
#     ships) over a window.__JUCE__ bridge. See docs/stride-wrapper-vst3-spec.md.
#
# Build (Windows — same loop as Tendril):
#   cmake -S . -B build -G "Visual Studio 17 2022" -A x64
#   cmake --build build --config Release
#
# Artefacts:
#   build/StrideWrapperM0_artefacts/Release/Standalone/Stride.exe
#   build/StrideWrapperM0_artefacts/Release/VST3/Stride.vst3
# ============================================================
cmake_minimum_required(VERSION 3.22)
project(StrideWrapperM0 VERSION 1.0.0 LANGUAGES C CXX)

set(CMAKE_CXX_STANDARD 17)
set(CMAKE_CXX_STANDARD_REQUIRED ON)

# JUCE is pinned NEWER than Tendril's 8.0.4 on purpose: a VST3 that is itself a VST3
# host only links after a fix that shipped ~Oct 2025. 8.0.13 (May 2026) is the current
# release and the API this code targets (createEditorIfNeeded; addFormat). Its own
# FetchContent cache, so it never clashes with Tendril's pin.
# Override if needed:  -DSTRIDE_JUCE_TAG=<tag>
set(STRIDE_JUCE_TAG "8.0.13" CACHE STRING "JUCE git tag (must be >= the Oct-2025 VST3-host-VST3 fix)")

include(FetchContent)
FetchContent_Declare(
    JUCE
    GIT_REPOSITORY https://github.com/juce-framework/JUCE.git
    GIT_TAG        ${STRIDE_JUCE_TAG}
    GIT_SHALLOW    TRUE
)
FetchContent_MakeAvailable(JUCE)

# ---- WebView (M1): reuse Tendril's already-vendored Microsoft WebView2 SDK ----
set(JUCE_WEBVIEW2_PACKAGE_LOCATION "${CMAKE_CURRENT_SOURCE_DIR}/../../tendril/3rdparty/webview2"
    CACHE PATH "Folder containing the Microsoft.Web.WebView2 NuGet package" FORCE)

# ---- embedded UI: the REAL Stride canvas (M1b). index.html/shim.js/tailwind.js are
#      wrapper-local; canvas.js + helpers are referenced from the live source tree so
#      they stay in sync (symbol names derive from the filename, not the path).
juce_add_binary_data(StrideWrapperM0Data SOURCES
    ui/index.html
    ui/shim.js
    ui/tailwind.js
    ${CMAKE_CURRENT_SOURCE_DIR}/../../stride-vst/app/renderer/canvas.js
    ${CMAKE_CURRENT_SOURCE_DIR}/../../stride-vst/app/renderer/midi-parser.js
    ${CMAKE_CURRENT_SOURCE_DIR}/../../stride-vst/app/renderer/audition.js
    ${CMAKE_CURRENT_SOURCE_DIR}/../../stride-vst/app/renderer/pattern-loader.js
    ${CMAKE_CURRENT_SOURCE_DIR}/../../stride-vst/app/renderer/pattern-library.js
    ${CMAKE_CURRENT_SOURCE_DIR}/../../docs/_fonts/Outfit.ttf
)

juce_add_plugin(StrideWrapperM0
    PRODUCT_NAME                "Stride"
    COMPANY_NAME                "Stride"
    BUNDLE_ID                   io.stridehub.wrapper.m0
    PLUGIN_MANUFACTURER_CODE    Strd
    PLUGIN_CODE                 SwM0
    FORMATS                     VST3 Standalone
    IS_SYNTH                    TRUE      # MIDI in, audio out (it wraps an instrument)
    NEEDS_MIDI_INPUT            TRUE
    NEEDS_WEB_BROWSER           TRUE      # M1: the UI is now a JUCE WebView
    NEEDS_WEBVIEW2              TRUE
    EDITOR_WANTS_KEYBOARD_FOCUS TRUE
    COPY_PLUGIN_AFTER_BUILD     FALSE     # a DAW holding the loaded .vst3 must not fail the build
)

target_sources(StrideWrapperM0 PRIVATE
    src/PluginProcessor.cpp
    src/PluginEditor.cpp
    src/third_party/monocypher/monocypher.c            # Ed25519 entitlement verify
    src/third_party/monocypher/monocypher-ed25519.c    # standard (SHA-512) Ed25519
)
target_include_directories(StrideWrapperM0 PRIVATE src/third_party/monocypher)

# macOS transport-key forwarding (Objective-C++) — Mac only
if(APPLE)
    target_sources(StrideWrapperM0 PRIVATE src/MacKeyForward.mm)
endif()

target_compile_definitions(StrideWrapperM0 PUBLIC
    JUCE_PLUGINHOST_VST3=1                          # the whole point — host VST3s
    JUCE_PLUGINHOST_AU=0                            # AU hosting is a later macOS milestone
    JUCE_WEB_BROWSER=1                              # M1: WebView UI
    JUCE_USE_WIN_WEBVIEW2_WITH_STATIC_LINKING=1     # no WebView2Loader.dll to ship
    JUCE_USE_CURL=0
    JUCE_VST3_CAN_REPLACE_VST2=0
    JUCE_DISPLAY_SPLASH_SCREEN=0
)

target_link_libraries(StrideWrapperM0
    PRIVATE
        StrideWrapperM0Data
        juce::juce_audio_utils      # brings in juce_audio_processors (hosting) + gui_basics
        juce::juce_gui_extra        # WebBrowserComponent
        juce::juce_cryptography     # SHA-256 for the built-in license keys
    PUBLIC
        juce::juce_recommended_config_flags
        juce::juce_recommended_warning_flags
)
