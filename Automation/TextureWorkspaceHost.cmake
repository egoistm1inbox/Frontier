#============================================================================================================================================
#                                                         TEXTUREWORKSPACEHOST.CMAKE
#============================================================================================================================================
# Texture Workspace host validation: headless in-process open/close, backend protocol, selection publishing, and PPM evidence.

if(BUILD_TESTING)
    add_executable(TextureWorkspaceHostValidation
        Exhibits/TextureWorkspaceHost/Code/TextureWorkspaceHostValidation.cpp)
    target_include_directories(TextureWorkspaceHostValidation PRIVATE "${CMAKE_SOURCE_DIR}")
    target_link_libraries(TextureWorkspaceHostValidation PRIVATE FrontierEditorUI FrontierTextureStudioUI)
    add_test(NAME TextureWorkspaceHostValidation COMMAND TextureWorkspaceHostValidation
        "${CMAKE_BINARY_DIR}/TextureWorkspaceHostValidation.ppm"
        "${CMAKE_SOURCE_DIR}/EngineContent/FontArchives"
        "${CMAKE_SOURCE_DIR}/EngineContent/MaterialArchives/TextureStudio")
    set_tests_properties(TextureWorkspaceHostValidation PROPERTIES TIMEOUT 180)
endif()
