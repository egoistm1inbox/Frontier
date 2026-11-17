#============================================================================================================================================
#                                                           FRACTUREWORKSPACE.CMAKE
#============================================================================================================================================
# Fracture workspace validation: native solver/runtime checks, scripted UI interactions, and PPM evidence.

if(BUILD_TESTING)
    add_executable(FractureWorkspaceValidation
        Exhibits/FractureWorkspace/Code/FractureWorkspaceValidation.cpp)
    target_include_directories(FractureWorkspaceValidation PRIVATE "${CMAKE_SOURCE_DIR}"
        "${CMAKE_SOURCE_DIR}/ExternalPackages/JoltPhysics")
    target_link_libraries(FractureWorkspaceValidation PRIVATE FrontierPhysicsExtension)
    add_test(NAME FractureWorkspaceValidation COMMAND FractureWorkspaceValidation "${CMAKE_BINARY_DIR}/FractureWorkspaceValidation.ppm" "${CMAKE_SOURCE_DIR}/EngineContent/FontArchives")
    set_tests_properties(FractureWorkspaceValidation PROPERTIES TIMEOUT 180)
endif()
