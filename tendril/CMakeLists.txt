# ============================================================
# TENDRIL — JUCE plugin build
# ============================================================
# Targets:
#   Tendril_VST3 / Tendril_Standalone   the plugin (WebView Patchbay UI)
#   TendrilTests                        headless test suite (exit 0 = green)
#
# Build:
#   cmake -S . -B build -G "Visual Studio 17 2022" -A x64
#   cmake --build build --config Release
#   build/TendrilTests_artefacts/Release/TendrilTests.exe
# ============================================================
cmake_minimum_required(VERSION 3.22)
project(Tendril VERSION 0.2.0 LANGUAGES C CXX)

set(CMAKE_CXX_STANDARD 17)
set(CMAKE_CXX_STANDARD_REQUIRED ON)

# WebView2 SDK location (downloaded NuGet package, vendored in 3rdparty/)
set(JUCE_WEBVIEW2_PACKAGE_LOCATION "${CMAKE_CURRENT_SOURCE_DIR}/3rdparty/webview2"
    CACHE PATH "Folder containing the Microsoft.Web.WebView2 package" FORCE)

include(FetchContent)
FetchContent_Declare(
    JUCE
    GIT_REPOSITORY https://github.com/juce-framework/JUCE.git
    GIT_TAG        8.0.4
    GIT_SHALLOW    TRUE
)
FetchContent_MakeAvailable(JUCE)

# ---- embedded assets: the web UI (oscillators are procedural — no wavetable files) ----
juce_add_binary_data(TendrilData SOURCES
    ui/tendril_webui.html
)

# ---- the plugin ----
juce_add_plugin(Tendril
    PRODUCT_NAME            "Tendril"
    COMPANY_NAME            "Patchbay"
    BUNDLE_ID               io.stridehub.tendril
    PLUGIN_MANUFACTURER_CODE Ptby
    PLUGIN_CODE             Tndr
    FORMATS                 VST3 Standalone
    IS_SYNTH                TRUE
    NEEDS_MIDI_INPUT        TRUE
    NEEDS_WEB_BROWSER       TRUE
    NEEDS_WEBVIEW2          TRUE
    EDITOR_WANTS_KEYBOARD_FOCUS TRUE
    COPY_PLUGIN_AFTER_BUILD FALSE   # install handled by the build script (a host
)                                   # holding the loaded .vst3 must not fail the build

target_sources(Tendril PRIVATE
    src/PluginProcessor.cpp
    src/PluginEditor.cpp
)

target_compile_definitions(Tendril PUBLIC
    JUCE_WEB_BROWSER=1
    JUCE_USE_WIN_WEBVIEW2_WITH_STATIC_LINKING=1
    JUCE_USE_CURL=0
    JUCE_VST3_CAN_REPLACE_VST2=0
    JUCE_DISPLAY_SPLASH_SCREEN=0
)

target_link_libraries(Tendril
    PRIVATE
        TendrilData
        juce::juce_audio_utils
        juce::juce_dsp
        juce::juce_gui_extra
    PUBLIC
        juce::juce_recommended_config_flags
        juce::juce_recommended_warning_flags
)

# ---- headless tests ----
juce_add_console_app(TendrilTests PRODUCT_NAME "TendrilTests")

target_sources(TendrilTests PRIVATE
    test/Tests.cpp
    src/PluginProcessor.cpp
)

# tests are headless: no WebView, no editor — TENDRIL_TESTS swaps in a generic editor
target_compile_definitions(TendrilTests PRIVATE
    TENDRIL_TESTS=1
    JUCE_WEB_BROWSER=0
    JUCE_USE_CURL=0
    JUCE_MODAL_LOOPS_PERMITTED=0
)

target_link_libraries(TendrilTests PRIVATE
    TendrilData
    juce::juce_audio_utils
    juce::juce_dsp
    juce::juce_gui_extra
    juce::juce_recommended_config_flags
    juce::juce_recommended_warning_flags
)
