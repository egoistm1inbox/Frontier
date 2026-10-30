cmake_minimum_required(VERSION 3.22)

if(NOT TARGET FrontierClusteredGeometry)
    add_library(FrontierClusteredGeometry STATIC
        FacetTierBuild.cpp
        QuadricTierBuild.cpp
        GlassAwareClusterExtension.cpp
    )

    target_include_directories(FrontierClusteredGeometry PUBLIC
        "${CMAKE_CURRENT_SOURCE_DIR}/../.."
    )

    target_compile_features(FrontierClusteredGeometry PUBLIC cxx_std_20)
    target_compile_options(FrontierClusteredGeometry PRIVATE -Wall -Wextra -Werror)
endif()
