# ============================================================
# CRUCIBLE — JUCE plugin build
# ============================================================
# Bass spectral-morph synth + character multi-FX forge.
# Ported from the M4L gen~ prototype (crucible/) — every module
# translated 1:1, then extended with the multi-FX chain from
# docs/crucible-multifx-spec.md + research additions.
#
# Targets:
#   Crucible_VST3 / Crucible_Standalone   the plugin (WebView forge UI)
#   CrucibleTests                         headless test suite (exit 0 = green)
#
# Build:
#   cmake -S . -B build -G "Visual Studio 17 2022" -A x64
#   cmake --build build --config Release
#   build/CrucibleTests_artefacts/Release/CrucibleTests.exe
#
# Tip: pass -DFETCHCONTENT_SOURCE_DIR_JUCE=<path to an existing JUCE 8.0.4
# checkout> (e.g. ../tendril/build/_deps/juce-src) to skip the git clone.
# ============================================================
cmake_minimum_required(VERSION 3.22)
project(Crucible VERSION 0.1.0 LANGUAGES C CXX)

set(CMAKE_CXX_STANDARD 17)
set(CMAKE_CXX_STANDARD_REQUIRED ON)

# WebView2 SDK location — reuse the package vendored by the Tendril project
# (same repo). Override with -DJUCE_WEBVIEW2_PACKAGE_LOCATION if it moves.
set(JUCE_WEBVIEW2_PACKAGE_LOCATION "${CMAKE_CURRENT_SOURCE_DIR}/../tendril/3rdparty/webview2"
    CACHE PATH "Folder containing the Microsoft.Web.WebView2 package")

include(FetchContent)
FetchContent_Declare(
    JUCE
    GIT_REPOSITORY https://github.com/juce-framework/JUCE.git
    GIT_TAG        8.0.4
    GIT_SHALLOW    TRUE
)
FetchContent_MakeAvailable(JUCE)

# ---- embedded assets: the web UI + brand font ----
juce_add_binary_data(CrucibleData SOURCES
    ui/crucible_webui.html
    assets/Outfit.ttf
)

# ---- the plugin ----
juce_add_plugin(Crucible
    PRODUCT_NAME            "Crucible"
    COMPANY_NAME            "Patchbay"
    BUNDLE_ID               io.stridehub.crucible
    PLUGIN_MANUFACTURER_CODE Ptby
    PLUGIN_CODE             Crcb
    FORMATS                 VST3 Standalone
    IS_SYNTH                TRUE
    NEEDS_MIDI_INPUT        TRUE
    NEEDS_WEB_BROWSER       TRUE
    NEEDS_WEBVIEW2          TRUE
    EDITOR_WANTS_KEYBOARD_FOCUS TRUE
    COPY_PLUGIN_AFTER_BUILD FALSE
)

target_sources(Crucible PRIVATE
    src/PluginProcessor.cpp
    src/PluginEditor.cpp
)

target_compile_definitions(Crucible PUBLIC
    JUCE_WEB_BROWSER=1
    JUCE_USE_WIN_WEBVIEW2_WITH_STATIC_LINKING=1
    JUCE_USE_CURL=0
    JUCE_VST3_CAN_REPLACE_VST2=0
    JUCE_DISPLAY_SPLASH_SCREEN=0
)

target_link_libraries(Crucible
    PRIVATE
        CrucibleData
        juce::juce_audio_utils
        juce::juce_dsp
        juce::juce_gui_extra
    PUBLIC
        juce::juce_recommended_config_flags
        juce::juce_recommended_warning_flags
)

# ---- headless tests ----
juce_add_console_app(CrucibleTests PRODUCT_NAME "CrucibleTests")

target_sources(CrucibleTests PRIVATE
    test/Tests.cpp
    src/PluginProcessor.cpp
)

# tests are headless: no WebView, no editor — CRUCIBLE_TESTS swaps in a generic editor
target_compile_definitions(CrucibleTests PRIVATE
    CRUCIBLE_TESTS=1
    JUCE_WEB_BROWSER=0
    JUCE_USE_CURL=0
    JUCE_MODAL_LOOPS_PERMITTED=0
)

target_link_libraries(CrucibleTests PRIVATE
    CrucibleData
    juce::juce_audio_utils
    juce::juce_dsp
    juce::juce_gui_extra
    juce::juce_recommended_config_flags
    juce::juce_recommended_warning_flags
)
