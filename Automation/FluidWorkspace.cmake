#============================================================================================================================================
#                                                           FLUIDWORKSPACE.CMAKE
#============================================================================================================================================
# Fluid workspace validation: headless interaction checks and PPM evidence for the U3 UI shell.

if(BUILD_TESTING)
    add_executable(FluidWorkspaceValidation
        Exhibits/FluidWorkspace/Code/FluidWorkspaceValidation.cpp)
    target_include_directories(FluidWorkspaceValidation PRIVATE "${CMAKE_SOURCE_DIR}")
    target_link_libraries(FluidWorkspaceValidation PRIVATE FrontierSceneEditorUI)
    add_test(NAME FluidWorkspaceValidation COMMAND FluidWorkspaceValidation "${CMAKE_BINARY_DIR}/FluidWorkspaceValidation.ppm" "${CMAKE_SOURCE_DIR}/EngineContent/FontArchives")
    set_tests_properties(FluidWorkspaceValidation PROPERTIES TIMEOUT 180)
endif()
