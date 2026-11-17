#============================================================================================================================================
#                                                       STUDIOCONTROLS.CMAKE
#============================================================================================================================================
# Remastered Studio kit validation: headless interaction checks and PPM evidence for the shared controls.

if(BUILD_TESTING)
    add_executable(StudioControlsValidation
        Exhibits/StudioControls/Code/StudioControlsValidation.cpp)
    target_include_directories(StudioControlsValidation PRIVATE "${CMAKE_SOURCE_DIR}")
    target_link_libraries(StudioControlsValidation PRIVATE FrontierSceneEditorUI)
    add_test(NAME StudioControlsValidation COMMAND StudioControlsValidation "${CMAKE_BINARY_DIR}/StudioControlsValidation.ppm")
    set_tests_properties(StudioControlsValidation PROPERTIES TIMEOUT 120)
endif()
