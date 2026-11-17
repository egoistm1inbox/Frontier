#============================================================================================================================================
#                                                       VISUALEFFECTS.CMAKE
#============================================================================================================================================
# 🧩 Declarative EffectSpace schema and semantic/codec validation. GPU evaluations are a later milestone.

if(BUILD_TESTING)
    add_executable(EffectSpaceValidation
        Exhibits/VisualEffects/Code/EffectSpaceValidation.cpp)
    target_include_directories(EffectSpaceValidation PRIVATE
        "${CMAKE_SOURCE_DIR}"
        "${CMAKE_SOURCE_DIR}/ExternalPackages/tomlpp/include")
    target_compile_features(EffectSpaceValidation PRIVATE cxx_std_20)
    add_test(NAME EffectSpaceValidation COMMAND EffectSpaceValidation)
    set_tests_properties(EffectSpaceValidation PROPERTIES TIMEOUT 60)
endif()
