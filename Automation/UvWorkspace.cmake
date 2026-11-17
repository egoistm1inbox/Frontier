#============================================================================================================================================
#                                                           UVWORKSPACE.CMAKE
#============================================================================================================================================
# UV workspace validation: headless interaction checks and PPM evidence for the U6 UI shell.

if(BUILD_TESTING)
    add_executable(UvWorkspaceValidation
        Exhibits/UvWorkspace/Code/UvWorkspaceValidation.cpp)
    target_include_directories(UvWorkspaceValidation PRIVATE "${CMAKE_SOURCE_DIR}")
    target_link_libraries(UvWorkspaceValidation PRIVATE FrontierSceneEditorUI)
    add_test(NAME UvWorkspaceValidation COMMAND UvWorkspaceValidation "${CMAKE_BINARY_DIR}/UvWorkspaceValidation.ppm" "${CMAKE_SOURCE_DIR}/EngineContent/FontArchives")
    set_tests_properties(UvWorkspaceValidation PROPERTIES TIMEOUT 180)
endif()
