#============================================================================================================================================
#                                                           PHOTOMETRICWORKSPACE.CMAKE
#============================================================================================================================================
# Photometric workspace validation: headless interaction checks and PPM evidence for the U5 UI shell.

if(BUILD_TESTING)
    add_executable(PhotometricWorkspaceValidation
        Exhibits/PhotometricWorkspace/Code/PhotometricWorkspaceValidation.cpp)
    target_include_directories(PhotometricWorkspaceValidation PRIVATE "${CMAKE_SOURCE_DIR}")
    target_link_libraries(PhotometricWorkspaceValidation PRIVATE FrontierSceneEditorUI FrontierGlobalIllumination)
    add_test(NAME PhotometricWorkspaceValidation COMMAND PhotometricWorkspaceValidation
        "${CMAKE_BINARY_DIR}/PhotometricWorkspaceValidation.ppm" "${CMAKE_SOURCE_DIR}/EngineContent/FontArchives"
        "${CMAKE_SOURCE_DIR}/Exhibits/PhotometricWorkspace/Fixtures/TypeC_Imported.ies")
    set_tests_properties(PhotometricWorkspaceValidation PROPERTIES TIMEOUT 180)

    # 📝 The actual Photometric Studio stage through stored C++ ReSTIR GI shaders on a CPU Vulkan device, then CPU-composited UI evidence.
    add_executable(PhotometricWorkspaceCapture
        Exhibits/PhotometricWorkspace/Code/PhotometricWorkspaceCapture.cpp
        Engine/Render/StbImageWriteImplementation.cpp)
    target_include_directories(PhotometricWorkspaceCapture PRIVATE
        "${CMAKE_SOURCE_DIR}"
        "${CMAKE_SOURCE_DIR}/ExternalPackages/stb")
    target_link_libraries(PhotometricWorkspaceCapture PRIVATE EverestProjectEditor)
endif()
