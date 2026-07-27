# Applies ci/juce-vst3-inactive-bus-scratch.patch to the FetchContent'd JUCE source.
# Why: JUCE's VST3 host hands INACTIVE buses null channel pointers; plugins that
# memset their declared buses unconditionally (NI Reaktor 6) crash on the first
# block. The patch backs inactive buses with real scratch memory instead.
#
# Idempotent on purpose — CMake can re-run PATCH_COMMAND on reconfigure, and a
# second `git apply` of an applied patch would fail the configure. If the patch
# is already in (reverse-check succeeds), this is a no-op.
#
# Usage: cmake -DJUCE_SOURCE_DIR=<dir> -DPATCH_FILE=<file> -P apply-juce-patch.cmake

execute_process (COMMAND git apply --reverse --check --ignore-whitespace "${PATCH_FILE}"
                 WORKING_DIRECTORY "${JUCE_SOURCE_DIR}"
                 RESULT_VARIABLE stride_patch_already_applied
                 OUTPUT_QUIET ERROR_QUIET)

if (stride_patch_already_applied EQUAL 0)
    message (STATUS "Stride: JUCE inactive-bus patch already applied")
else()
    execute_process (COMMAND git apply --ignore-whitespace "${PATCH_FILE}"
                     WORKING_DIRECTORY "${JUCE_SOURCE_DIR}"
                     RESULT_VARIABLE stride_patch_result)
    if (NOT stride_patch_result EQUAL 0)
        message (FATAL_ERROR "Stride: JUCE inactive-bus patch FAILED to apply — "
                             "check ci/juce-vst3-inactive-bus-scratch.patch against the pinned JUCE tag")
    endif()
    message (STATUS "Stride: JUCE inactive-bus patch applied")
endif()
