#============================================================================================================================================
#                                                         ASSETBROWSERWORKSPACE.CMAKE
#============================================================================================================================================
# Asset Browser validation: headless census, filter, sheet, notch, link, and keyboard checks plus PPM evidence.

if(BUILD_TESTING)
    add_executable(AssetBrowserWorkspaceValidation
        Exhibits/AssetBrowser/Code/AssetBrowserWorkspaceValidation.cpp)
    target_include_directories(AssetBrowserWorkspaceValidation PRIVATE "${CMAKE_SOURCE_DIR}")
    target_link_libraries(AssetBrowserWorkspaceValidation PRIVATE FrontierSceneEditorUI)
    add_test(NAME AssetBrowserWorkspaceValidation COMMAND AssetBrowserWorkspaceValidation "${CMAKE_BINARY_DIR}/AssetBrowserWorkspaceValidation.ppm" "${CMAKE_SOURCE_DIR}/EngineContent/FontArchives")
    set_tests_properties(AssetBrowserWorkspaceValidation PROPERTIES TIMEOUT 180)
endif()
