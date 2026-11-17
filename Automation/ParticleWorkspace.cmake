#============================================================================================================================================
#                                                         PARTICLEWORKSPACE.CMAKE
#============================================================================================================================================
# Particle workspace validation: headless interaction checks and PPM evidence for the U2 UI shell.

if(BUILD_TESTING)
    add_executable(ParticleWorkspaceValidation
        Exhibits/ParticleWorkspace/Code/ParticleWorkspaceValidation.cpp)
    target_include_directories(ParticleWorkspaceValidation PRIVATE "${CMAKE_SOURCE_DIR}")
    target_link_libraries(ParticleWorkspaceValidation PRIVATE FrontierSceneEditorUI)
    add_test(NAME ParticleWorkspaceValidation COMMAND ParticleWorkspaceValidation "${CMAKE_BINARY_DIR}/ParticleWorkspaceValidation.ppm" "${CMAKE_SOURCE_DIR}/EngineContent/FontArchives")
    set_tests_properties(ParticleWorkspaceValidation PROPERTIES TIMEOUT 180)
endif()
