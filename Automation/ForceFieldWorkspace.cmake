#============================================================================================================================================
#                                                         FORCEFIELDWORKSPACE.CMAKE                                                          
#============================================================================================================================================
# Force Field + Wind workspace validation: native evaluation, Levelspace load round-trip, scripted UI interactions, and PPM evidence.

if(BUILD_TESTING)
    add_executable(ForceFieldWorkspaceValidation
        Exhibits/ForceFieldWorkspace/Code/ForceFieldWorkspaceValidation.cpp)
    target_include_directories(ForceFieldWorkspaceValidation PRIVATE "${CMAKE_SOURCE_DIR}")
    target_link_libraries(ForceFieldWorkspaceValidation PRIVATE FrontierSceneEditorUI)
    add_test(NAME ForceFieldWorkspaceValidation COMMAND ForceFieldWorkspaceValidation "${CMAKE_BINARY_DIR}/ForceFieldWorkspaceValidation.ppm" "${CMAKE_SOURCE_DIR}/EngineContent/FontArchives")
    set_tests_properties(ForceFieldWorkspaceValidation PROPERTIES TIMEOUT 180)
endif()
