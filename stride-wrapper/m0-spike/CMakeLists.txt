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
#   build-mac/StrideWrapperM0_artefacts/Release/AU/Stride.component   (macOS only — Logic/GarageBand)
# ============================================================
cmake_minimum_required(VERSION 3.22)
project(StrideWrapperM0 VERSION 1.4.1 LANGUAGES C CXX)

set(CMAKE_CXX_STANDARD 17)
set(CMAKE_CXX_STANDARD_REQUIRED ON)

# JUCE is pinned NEWER than Tendril's 8.0.4 on purpose: a VST3 that is itself a VST3
# host only links after a fix that shipped ~Oct 2025. 8.0.13 (May 2026) is the current
# release and the API this code targets (createEditorIfNeeded; addFormat). Its own
# FetchContent cache, so it never clashes with Tendril's pin.
# Override if needed:  -DSTRIDE_JUCE_TAG=<tag>
set(STRIDE_JUCE_TAG "8.0.13" CACHE STRING "JUCE git tag (must be >= the Oct-2025 VST3-host-VST3 fix)")

include(FetchContent)
# PATCH_COMMAND backs JUCE's inactive-VST3-bus channel pointers with real scratch memory
# instead of nullptr — NI Reaktor 6 memsets every bus it declares regardless of host-side
# activation, so the stock nullptrs crash the DAW on the first block after loading it
# inside Stride (field crash reports, Live/mac, 2026-07-26). The script is idempotent
# (re-configures are no-ops); it hard-fails the configure if the patch stops applying —
# re-diff it when bumping STRIDE_JUCE_TAG.
FetchContent_Declare(
    JUCE
    GIT_REPOSITORY https://github.com/juce-framework/JUCE.git
    GIT_TAG        ${STRIDE_JUCE_TAG}
    GIT_SHALLOW    TRUE
    PATCH_COMMAND  ${CMAKE_COMMAND}
                   -DJUCE_SOURCE_DIR=<SOURCE_DIR>
                   -DPATCH_FILE=${CMAKE_CURRENT_SOURCE_DIR}/ci/juce-vst3-inactive-bus-scratch.patch
                   -P ${CMAKE_CURRENT_SOURCE_DIR}/ci/apply-juce-patch.cmake
)
FetchContent_MakeAvailable(JUCE)

# Trust, then verify: apply-juce-patch.cmake hard-fails if `git apply` fails, but if the
# PATCH_COMMAND were ever skipped outright (FetchContent cache quirk, CMake behavior change)
# the build would silently ship STOCK JUCE — i.e. the Reaktor null-bus crash back in the wild
# with nothing in the logs. So every configure asserts the marker is present in the populated
# tree; a missing patch is a hard configure error, never a quiet regression.
file(READ "${juce_SOURCE_DIR}/modules/juce_audio_processors_headless/format_types/juce_VST3Common.h" _stride_vst3common_src)
string(FIND "${_stride_vst3common_src}" "STRIDE PATCH" _stride_patch_pos)
if(_stride_patch_pos EQUAL -1)
    message(FATAL_ERROR "Stride: the JUCE inactive-bus patch is MISSING from the populated JUCE tree "
                        "(${juce_SOURCE_DIR}) — refusing to build a binary that would crash on Reaktor-class plugins")
endif()
unset(_stride_vst3common_src)

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
    # Reptile Mode + Compact View (wrapper-only presentation layers). The character
    # art is deliberately separate files, not baked into the JS, so it can be swapped
    # without touching a line of layout code.
    ui/reptile.js
    ui/compact.js
    ui/reptile_idle.webp
    ui/reptile_blink.webp
    ui/reptile_blep.webp
    # mouth open with NO tongue painted in - the strike frame. The blep pose has a tongue
    # in the artwork, so using it for a strike gave him two tongues at once.
    ui/reptile_open.webp
    ui/reptile2_idle.webp
    ui/reptile2_blink.webp
    ui/reptile2_open.webp
    # PNG copies for the FLOATING overlay: that one is drawn in C++ and JUCE cannot
    # decode WebP. Smaller (440px) because the overlay never renders larger than that.
    ui/rep_idle.png
    ui/rep_blink.png
    ui/rep_blep.png
    ui/rep_open.png
    # SECOND character set - switchable at runtime, so trying one and going back is a click
    ui/rep2_idle.png
    ui/rep2_blink.png
    ui/rep2_open.png
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
    # AU is macOS-only and silently skipped elsewhere by JUCE. The AU identity triple
    # (aumu / SwM0 / Strd) is derived from the codes above and is FROZEN the moment the
    # first .component ships — changing any of them would orphan every Logic project.
    FORMATS                     AU VST3 Standalone
    AU_MAIN_TYPE                kAudioUnitType_MusicDevice   # instrument ("aumu") — Logic lists it in the Instrument slot
    IS_SYNTH                    TRUE      # MIDI in, audio out (it wraps an instrument)
    NEEDS_MIDI_INPUT            TRUE
    NEEDS_WEB_BROWSER           TRUE      # M1: the UI is now a JUCE WebView
    NEEDS_WEBVIEW2              TRUE
    EDITOR_WANTS_KEYBOARD_FOCUS TRUE
    PLUGINHOST_AU               TRUE      # macOS: host the user's AU plugins inside Stride (links AudioUnit + CoreAudioKit; no-op on Windows)
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
    # JUCE_PLUGINHOST_AU=1 comes from PLUGINHOST_AU above (JUCE also links the frameworks);
    # the AU-hosting code itself is additionally guarded JUCE_MAC (the class only exists there)
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
