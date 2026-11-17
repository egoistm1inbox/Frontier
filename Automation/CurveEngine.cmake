#=======================================================================================================================
#                                                       CURVEENGINE.CMAKE
#=======================================================================================================================
# 🧩 Scalar curve profiles, monotone interpolation, `.curvespace` codec, and numerical validation.

if(BUILD_TESTING)
    add_executable(CurveSpaceValidation
        Exhibits/Curves/Code/CurveSpaceValidation.cpp)
    target_include_directories(CurveSpaceValidation PRIVATE
        "${CMAKE_SOURCE_DIR}"
        "${CMAKE_SOURCE_DIR}/ExternalPackages/tomlpp/include")
    target_compile_features(CurveSpaceValidation PRIVATE cxx_std_20)
    add_test(NAME CurveSpaceValidation COMMAND CurveSpaceValidation)
    set_tests_properties(CurveSpaceValidation PROPERTIES TIMEOUT 60)

    add_executable(CurvePlotValidation Exhibits/Curves/Code/CurvePlotValidation.cpp)
    target_include_directories(CurvePlotValidation PRIVATE "${CMAKE_SOURCE_DIR}")
    target_link_libraries(CurvePlotValidation PRIVATE FrontierSceneEditorUI)
    add_test(NAME CurvePlotValidation COMMAND CurvePlotValidation "${CMAKE_BINARY_DIR}/CurvePlotValidation.ppm")
    set_tests_properties(CurvePlotValidation PROPERTIES TIMEOUT 60)
endif()
